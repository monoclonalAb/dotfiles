#!/usr/bin/env python3
"""Focus the next Herdr agent that needs attention."""

import fcntl
import json
import os
import shutil
import socket
import subprocess
import sys
import tomllib
import time
from pathlib import Path

# `blocked` needs an answer now; `done` is a completed conversation that has
# not yet been reviewed. Idle agents are intentionally excluded.
DEFAULT_PRIORITY = ["blocked", "done"]
TOAST_DELAY_SECONDS = 1


def herdr_bin():
    configured = os.environ.get("HERDR_BIN_PATH", "").removesuffix(" (deleted)")
    if configured and Path(configured).is_file():
        return configured
    return shutil.which("herdr") or str(Path.home() / ".local/bin/herdr")


def plugin_config():
    config_dir = os.environ.get("HERDR_PLUGIN_CONFIG_DIR")
    if not config_dir:
        return DEFAULT_PRIORITY, "all"
    path = Path(config_dir) / "config.toml"
    if not path.exists():
        return DEFAULT_PRIORITY, "all"
    try:
        raw = tomllib.loads(path.read_text())
    except (OSError, tomllib.TOMLDecodeError):
        return DEFAULT_PRIORITY, "all"
    priority = raw.get("priority", DEFAULT_PRIORITY)
    scope = raw.get("scope", "all")
    if not isinstance(priority, list) or not all(isinstance(item, str) for item in priority):
        priority = DEFAULT_PRIORITY
    if scope not in ("all", "workspace"):
        scope = "all"
    return priority, scope


def run(*args):
    result = subprocess.run([herdr_bin(), *args], capture_output=True, text=True, timeout=10)
    if result.returncode:
        raise SystemExit(result.stderr.strip() or f"herdr {' '.join(args)} failed")
    return result.stdout

STATE_FILE = "focus-origin.json"
ATTENTION_FILE = "attention.json"
# One token per state, so each can carry its own colour in the sidebar config. Exactly one is ever
# set for a pane; Herdr drops missing tokens and their separators, so exactly one dot renders.
DOT_TOKENS = {
    "blocked": ("dot_blocked", "◆"),
    "review": ("dot_review", "●"),
    "working": ("dot_working", "◐"),
    "idle": ("dot_idle", "○"),
}

ATTENTION_BUCKETS = ("blocked", "done")


def blank_entry(terminal_id=None):
    return {
        "terminal_id": terminal_id,
        "status": None,
        "unread": False,
        "raised_as": None,
        "worked": False,
        "seen_seq": None,
    }


def normalise_entry(entry, terminal_id):
    """Upgrade a pre-0.5 entry and reset it when this pane id was recycled onto a new terminal."""
    if not isinstance(entry, dict):
        return blank_entry(terminal_id)
    known = entry.get("terminal_id")
    if terminal_id and known and known != terminal_id:
        return blank_entry(terminal_id)
    status = entry.get("status") if isinstance(entry.get("status"), str) else None
    unread = entry.get("unread") is True
    raised = entry.get("raised_as")
    seen = entry.get("seen_seq")
    return {
        "terminal_id": terminal_id or known,
        "status": status,
        "unread": unread,
        "raised_as": raised if raised in ATTENTION_BUCKETS else ("done" if unread else None),
        "worked": entry.get("worked") is True or status == "working",
        "seen_seq": seen if isinstance(seen, int) else None,
    }


def apply_observation(entry, status, focused, seq, terminal_id):
    """Fold one observation of a pane's agent into its ledger entry and return the entry.

    Only the focused pane is ever cleared, so seeing one pane can never clear a sibling; Herdr's
    own `seen` flag is per tab, which is what this ledger exists to survive.
    """
    entry = normalise_entry(entry, terminal_id)
    if focused:
        entry.update(
            status=status,
            unread=False,
            raised_as=None,
            worked=status == "working",
            seen_seq=seq if isinstance(seq, int) else entry["seen_seq"],
        )
        return entry
    if status == "working":
        entry.update(status=status, unread=False, raised_as=None, worked=True)
        return entry
    if status in ("done", "blocked"):
        entry.update(
            status=status,
            unread=True,
            raised_as="blocked" if status == "blocked" else "done",
        )
        return entry
    # idle/unknown: Herdr downgrades an unseen completion to `idle` as soon as any pane in the
    # tab is focused, so fall back to work observed since this pane was last focused.
    if not entry["unread"] and entry["worked"]:
        moved = entry["seen_seq"] is None or (isinstance(seq, int) and seq > entry["seen_seq"])
        if moved:
            entry.update(unread=True, raised_as="done")
    entry["status"] = status
    return entry


def attention_bucket(status, entry):
    """Priority bucket for a live agent, or None when it needs no attention.

    A completion needs review only while the ledger holds it unread. Herdr reports the focused
    pane's completion as `done` when the terminal app is unfocused, then downgrades it to `idle`
    on return without any event, and clicking the already-focused row emits no pane.focused.
    Trusting the raw `done` would therefore pin a review dot to the pane in front of you.
    """
    if status == "blocked":
        return "blocked"
    if status in ("done", "idle", "unknown") and entry.get("unread") is True:
        return entry.get("raised_as") or "done"
    return None


def state_dir():
    configured = os.environ.get("HERDR_PLUGIN_STATE_DIR")
    if configured:
        return Path(configured)
    config_path = os.environ.get("HERDR_CONFIG_PATH")
    root = Path(config_path).parent if config_path else Path.home() / ".config" / "herdr"
    return root / "plugins" / "runtime" / os.environ.get("HERDR_PLUGIN_ID", "martinro.next-agent")


def load_state():
    try:
        state = json.loads((state_dir() / STATE_FILE).read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return state if isinstance(state, dict) else {}


def save_state(origin_pane_id, last_jump_pane_id):
    directory = state_dir()
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / f"{STATE_FILE}.tmp"
    temporary.write_text(
        json.dumps({"origin_pane_id": origin_pane_id, "last_jump_pane_id": last_jump_pane_id})
    )
    temporary.replace(directory / STATE_FILE)

def plugin_source():
    return os.environ.get("HERDR_PLUGIN_ID", "martinro.next-agent")


def load_attention():
    try:
        entries = json.loads((state_dir() / ATTENTION_FILE).read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(entries, dict):
        return {}
    return {pane: entry for pane, entry in entries.items() if isinstance(entry, dict)}


def mutate_attention(update):
    """Apply `update` to the attention ledger under an exclusive lock; return its result."""
    directory = state_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / ATTENTION_FILE
    with open(directory / f"{ATTENTION_FILE}.lock", "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            entries = load_attention()
            result = update(entries)
            temporary = directory / f"{ATTENTION_FILE}.tmp"
            temporary.write_text(json.dumps(entries))
            temporary.replace(path)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    return result


def socket_path():
    configured = os.environ.get("HERDR_SOCKET_PATH")
    if configured:
        return configured
    return json.loads(run("status", "--json"))["server"]["socket"]


def api(method, params):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(10)
        connection.connect(socket_path())
        connection.sendall(
            json.dumps({"id": f"next-agent:{method}", "method": method, "params": params}).encode()
            + b"\n"
        )
        buffer = b""
        while b"\n" not in buffer:
            chunk = connection.recv(65536)
            if not chunk:
                raise SystemExit(f"{method}: herdr closed the connection")
            buffer += chunk
    response = json.loads(buffer.split(b"\n", 1)[0])
    if "error" in response:
        error = response["error"]
        raise SystemExit(f"{method}: {error.get('message') or error.get('code', 'failed')}")
    return response["result"]

def dot_kind(status, bucket):
    """Sidebar dot for a pane, from this ledger rather than Herdr's per-tab `seen` flag."""
    if bucket == "blocked":
        return "blocked"
    if bucket:
        return "review"
    if status == "working":
        return "working"
    return "idle"


def wanted_tokens(status, bucket):
    name, glyph = DOT_TOKENS[dot_kind(status, bucket)]
    return {name: glyph}


def current_dots(tokens):
    names = {name for name, _ in DOT_TOKENS.values()}
    return {key: value for key, value in (tokens or {}).items() if key in names and value is not None}


def report_dot(pane_id, status, bucket):
    """Stamp the sidebar dot. Display-only: a failure must never abort a jump."""
    kind = dot_kind(status, bucket)
    tokens = {name: (glyph if key == kind else None) for key, (name, glyph) in DOT_TOKENS.items()}
    try:
        api(
            "pane.report_metadata",
            {"pane_id": pane_id, "source": plugin_source(), "tokens": tokens},
        )
    except (SystemExit, OSError, json.JSONDecodeError) as error:
        print(f"dot not updated for {pane_id}: {error}")
    return kind

def probe_agent(pane_id):
    """(status, focused, seq, terminal_id) for a pane; status None when it has no agent.

    A probe failure must keep a queued completion queued, so focused defaults to False.
    """
    try:
        agent = api("agent.get", {"target": pane_id}).get("agent", {})
    except (SystemExit, OSError, json.JSONDecodeError):
        return None, False, None, None
    return (
        agent.get("agent_status"),
        agent.get("focused") is True,
        agent.get("state_change_seq"),
        agent.get("terminal_id"),
    )


def snapshot():
    return json.loads(run("api", "snapshot"))["result"]["snapshot"]


def toast(title):
    subprocess.run(
        [herdr_bin(), "notification", "show", title, "--sound", "none"],
        capture_output=True,
        timeout=10,
    )


def notification_context(snapshot, target):
    workspace = next(
        (item for item in snapshot.get("workspaces", []) if item.get("workspace_id") == target["workspace_id"]),
        None,
    )
    workspace_id = target["workspace_id"]
    workspace_label = workspace.get("label", workspace_id) if workspace else workspace_id
    workspace_number = workspace.get("number", workspace_id) if workspace else workspace_id
    context = f"{workspace_label} · {workspace_number}"

    if workspace and workspace.get("tab_count", 0) > 1:
        tab_id = target["tab_id"]
        tab = next((item for item in snapshot.get("tabs", []) if item.get("tab_id") == tab_id), None)
        context += f" · {tab.get('label', tab_id) if tab else tab_id}"

    return context


def notify_hidden_omp(pane_id, expected_status, title, sound):
    """Notify for an omp pane that Herdr leaves silent because its tab is active."""
    time.sleep(TOAST_DELAY_SECONDS)
    live = snapshot()
    target = next(
        (item for item in live.get("agents", []) if item.get("pane_id") == pane_id), None
    )
    if (
        not target
        or target.get("agent") != "omp"
        or target.get("agent_status") != expected_status
        or target.get("tab_id") != live.get("focused_tab_id")
        or target.get("pane_id") == live.get("focused_pane_id")
    ):
        return
    response = json.loads(
        run(
            "notification",
            "show",
            title,
            "--body",
            notification_context(live, target),
            "--position",
            "bottom-right",
            "--sound",
            sound,
        )
    )
    result = response.get("result", {})
    if result.get("shown") is True:
        print(f"notified {pane_id}")
        return
    raise SystemExit(f"notification not shown: {result.get('reason', 'unknown')}")



def handle_agent_status_change():
    try:
        data = json.loads(os.environ["HERDR_PLUGIN_EVENT_JSON"])["data"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return
    if not isinstance(data, dict):
        return
    pane_id = data.get("pane_id")
    status = data.get("agent_status")
    if not isinstance(pane_id, str) or not isinstance(status, str):
        return
    _, focused, seq, terminal_id = probe_agent(pane_id)

    def observe(entries):
        previous = (entries.get(pane_id) or {}).get("status")
        entry = apply_observation(entries.get(pane_id), status, focused, seq, terminal_id)
        entries[pane_id] = entry
        return previous if isinstance(previous, str) else None, attention_bucket(status, entry)

    previous, bucket = mutate_attention(observe)
    kind = report_dot(pane_id, status, bucket)
    print(f"status {pane_id} {previous}->{status} focused={focused} seq={seq} bucket={bucket} dot={kind}")
    if data.get("agent") != "omp":
        return
    if status == "blocked":
        notify_hidden_omp(pane_id, "blocked", "omp needs attention", "none")
    elif status in ("done", "idle") and previous == "working":
        # omp emits `done` in hook events, then the live snapshot settles to `idle`.
        notify_hidden_omp(pane_id, "idle", "omp finished", "done")


def handle_agent_detected():
    """Stamp a dot as soon as a pane gains an agent, before its first status change."""
    try:
        data = json.loads(os.environ["HERDR_PLUGIN_EVENT_JSON"])["data"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return
    pane_id = data.get("pane_id") if isinstance(data, dict) else None
    if not isinstance(pane_id, str):
        return
    status, focused, seq, terminal_id = probe_agent(pane_id)
    if not isinstance(status, str):
        return

    def observe(entries):
        entry = apply_observation(entries.get(pane_id), status, focused, seq, terminal_id)
        entries[pane_id] = entry
        return attention_bucket(status, entry)

    bucket = mutate_attention(observe)
    print(f"detected {pane_id} status={status} dot={report_dot(pane_id, status, bucket)}")


def handle_pane_focused():
    try:
        data = json.loads(os.environ["HERDR_PLUGIN_EVENT_JSON"])["data"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return
    pane_id = data.get("pane_id") if isinstance(data, dict) else None
    if not isinstance(pane_id, str):
        return
    status, _, seq, terminal_id = probe_agent(pane_id)
    if not isinstance(status, str):
        # A plain shell pane: never in the Agent panel, so never stamp one.
        print(f"focus {pane_id} status=None")
        return

    def seen(entries):
        updated = apply_observation(entries.get(pane_id), status, True, seq, terminal_id)
        entries[pane_id] = updated
        return attention_bucket(status, updated)

    bucket = mutate_attention(seen)
    # Focus is the explicit review action, so always restamp: the ledger's previous verdict can
    # match while the sidebar still shows a stale dot (an older rule or a failed display write).
    kind = report_dot(pane_id, status, bucket)
    print(f"focus {pane_id} status={status} seq={seq} bucket={bucket} dot={kind}")




def reconcile(live):
    """Fold every live agent into the ledger, stamp its dot, and return (agents, attention buckets)."""
    focused = live.get("focused_pane_id")
    panes = live.get("panes", [])
    live_ids = {pane.get("pane_id") for pane in panes}
    agents = {
        agent.get("pane_id"): agent
        for agent in live.get("agents", [])
        if isinstance(agent.get("pane_id"), str)
    }

    def fold(entries):
        for pane_id in list(entries):
            if pane_id not in live_ids:
                del entries[pane_id]
        buckets = {}
        for pane_id, agent in agents.items():
            status = agent.get("agent_status")
            entry = apply_observation(
                entries.get(pane_id),
                status,
                pane_id == focused,
                agent.get("state_change_seq"),
                agent.get("terminal_id"),
            )
            entries[pane_id] = entry
            buckets[pane_id] = attention_bucket(status, entry)
        return buckets

    buckets = mutate_attention(fold)
    tokens_by_pane = {pane.get("pane_id"): pane.get("tokens") for pane in panes}
    for pane_id, agent in agents.items():
        status = agent.get("agent_status")
        bucket = buckets.get(pane_id)
        if current_dots(tokens_by_pane.get(pane_id)) != wanted_tokens(status, bucket):
            report_dot(pane_id, status, bucket)
    return agents, {pane_id: bucket for pane_id, bucket in buckets.items() if bucket}


def main():
    priority, scope = plugin_config()
    live = snapshot()
    focused = live.get("focused_pane_id")
    agents, buckets = reconcile(live)
    candidates = list(agents.values())
    if scope == "workspace":
        workspace = live.get("focused_workspace_id")
        if workspace:
            candidates = [a for a in candidates if a.get("workspace_id") == workspace]

    ranked = sorted(
        (
            (agent, buckets[agent["pane_id"]])
            for agent in candidates
            if buckets.get(agent["pane_id"]) in priority
        ),
        key=lambda pair: (priority.index(pair[1]), pair[0].get("pane_id", "")),
    )
    print(f"candidates {[(a['pane_id'], b) for a, b in ranked]} focused={focused}")
    if not ranked:
        toast("No agent needs attention")
        return

    target = ranked[0][0]
    for index, (agent, _) in enumerate(ranked):
        if agent.get("pane_id") == focused:
            target = ranked[(index + 1) % len(ranked)][0]
            break

    # Herdr 0.9's agent.focus marks the agent seen but does not project a tab/workspace
    # change to the client shell. pane.focus moves both the server and visible client.
    # Save the return chain only after focus succeeds (the target may have closed).
    api("pane.focus", {"pane_id": target["pane_id"]})

    if focused and target["pane_id"] != focused:
        state = load_state()
        # Continue an active chain; otherwise start a new one from this pane.
        origin = state.get("origin_pane_id") if focused == state.get("last_jump_pane_id") else focused
        save_state(origin, target["pane_id"])


def back():
    origin_id = load_state().get("origin_pane_id")
    if not origin_id:
        toast("No pane to return to")
        return

    live = snapshot()
    origin = next(
        (pane for pane in live.get("panes", []) if pane.get("pane_id") == origin_id), None
    )
    if origin is None:
        save_state(None, None)
        toast("Previous pane is gone")
        return

    focused = live.get("focused_pane_id")
    if origin_id == focused:
        toast("Already on the previous pane")
        return

    api("workspace.focus", {"workspace_id": origin["workspace_id"]})
    api("tab.focus", {"tab_id": origin["tab_id"]})
    api("pane.focus", {"pane_id": origin_id})
    # Toggle: the pane just left becomes the next return target, ending the chain.
    save_state(focused, None)
    print(f"focused {origin_id}")


if __name__ == "__main__":
    event = os.environ.get("HERDR_PLUGIN_EVENT")
    if event == "pane.agent_status_changed":
        handle_agent_status_change()
    elif event == "pane.focused":
        handle_pane_focused()
    elif event == "pane.agent_detected":
        handle_agent_detected()
    elif event == "startup":
        reconcile(snapshot())
    elif event is None:
        subcommand = sys.argv[1] if len(sys.argv) > 1 else "jump"
        if subcommand == "jump":
            main()
        elif subcommand == "back":
            back()
        else:
            raise SystemExit(f"unknown subcommand: {subcommand}")
