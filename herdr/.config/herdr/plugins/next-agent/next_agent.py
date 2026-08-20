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
STATUS_FILE = "agent-status.json"


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

def swap_last_status(pane_id, status):
    """Record `status` for `pane_id`; return the status recorded before this event."""
    directory = state_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / STATUS_FILE
    with open(directory / f"{STATUS_FILE}.lock", "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            try:
                statuses = json.loads(path.read_text())
            except (OSError, json.JSONDecodeError):
                statuses = {}
            if not isinstance(statuses, dict):
                statuses = {}
            previous = statuses.get(pane_id)
            statuses[pane_id] = status
            temporary = directory / f"{STATUS_FILE}.tmp"
            temporary.write_text(json.dumps(statuses))
            temporary.replace(path)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    return previous if isinstance(previous, str) else None


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
    previous = swap_last_status(pane_id, status)
    if data.get("agent") != "omp":
        return
    if status == "blocked":
        notify_hidden_omp(pane_id, "blocked", "omp needs attention", "none")
    elif status in ("done", "idle") and previous == "working":
        # omp emits `done` in hook events, then the live snapshot settles to `idle`.
        notify_hidden_omp(pane_id, "idle", "omp finished", "done")


def main():
    priority, scope = plugin_config()
    live = snapshot()
    agents = live.get("agents", [])
    if scope == "workspace":
        workspace = live.get("focused_workspace_id")
        if workspace:
            agents = [agent for agent in agents if agent.get("workspace_id") == workspace]

    ranked = sorted(
        (agent for agent in agents if agent.get("agent_status") in priority),
        key=lambda agent: (priority.index(agent["agent_status"]), agent.get("pane_id", "")),
    )
    if not ranked:
        toast("No agent needs attention")
        return

    focused = live.get("focused_pane_id")
    target = ranked[0]
    for index, agent in enumerate(ranked):
        if agent.get("pane_id") == focused:
            target = ranked[(index + 1) % len(ranked)]
            break

    if focused and target["pane_id"] != focused:
        state = load_state()
        # Continue an active chain; otherwise start a new one from this pane.
        origin = state.get("origin_pane_id") if focused == state.get("last_jump_pane_id") else focused
        save_state(origin, target["pane_id"])

    run("agent", "focus", target["pane_id"])


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
    elif event is None:
        subcommand = sys.argv[1] if len(sys.argv) > 1 else "jump"
        if subcommand == "jump":
            main()
        elif subcommand == "back":
            back()
        else:
            raise SystemExit(f"unknown subcommand: {subcommand}")
