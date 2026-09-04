#!/usr/bin/env python3
"""Two fixed environments — personal and work — for Herdr Spaces in one server.

Environments are an organisational/focus boundary, not a process boundary:
every Space stays inside the single persistent server, so reassigning one
never recreates it or touches its panes and running processes.

Identity is the stable `workspace_id` (persisted by Herdr across restarts);
labels are display-only. The durable mapping and MRU lists live in
HERDR_PLUGIN_STATE_DIR and are reconciled against the live snapshot on every
action, so stale IDs are pruned rather than trusted.

The sidebar follows the active environment: every action or event that can
change the active environment or its membership re-issues an `agent.view.set`
override filtering the agents panel on the member workspace IDs, and stamps
the reserved `sidebar_hidden` metadata token on inactive-environment Spaces so
the custom Herdr build drops them from the Spaces list (the focused Space is
always exempt server-side; a stock binary ignores the token). Both are
in-memory server state, so `startup` reapplies them after a restart.
"""

import fcntl
import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

ENVIRONMENTS = ("personal", "work")
DEFAULT_ENV = "personal"
STATE_FILE = "state.json"
# One badge token per environment. Exactly one is set per Space, and the
# sidebar drops missing tokens with their separators, so exactly one badge
# renders per row (config.base.toml [ui.sidebar.spaces]).
BADGE_TOKENS = {"personal": ("env_personal", "P"), "work": ("env_work", "W")}
# Reserved token honoured by the custom build's sidebar (see the local Herdr
# patch): non-empty hides the Space from the list, None removes the marker.
HIDDEN_TOKEN = "sidebar_hidden"
# Herdr rejects `in` filters with more than 32 values; chunk under an `any`.
MAX_FILTER_VALUES = 32


def other(env):
    return ENVIRONMENTS[0] if env == ENVIRONMENTS[1] else ENVIRONMENTS[1]


# --- pure state model -------------------------------------------------------


def blank_state():
    return {
        "active_env": DEFAULT_ENV,
        "assignments": {},
        "mru": {env: [] for env in ENVIRONMENTS},
    }


def normalise_state(raw):
    """Validate shape and types only; cross-checks against live IDs belong to reconcile()."""
    state = blank_state()
    if not isinstance(raw, dict):
        return state
    if raw.get("active_env") in ENVIRONMENTS:
        state["active_env"] = raw["active_env"]
    assignments = raw.get("assignments")
    if isinstance(assignments, dict):
        state["assignments"] = {
            ws: env
            for ws, env in assignments.items()
            if isinstance(ws, str) and env in ENVIRONMENTS
        }
    mru = raw.get("mru")
    if isinstance(mru, dict):
        for env in ENVIRONMENTS:
            entries = mru.get(env)
            if not isinstance(entries, list):
                continue
            deduped = []
            for ws in entries:
                if isinstance(ws, str) and ws not in deduped:
                    deduped.append(ws)
            state["mru"][env] = deduped
    return state


def reconcile(state, live_ids):
    """Fold the live workspace set into the mapping; return newly mapped IDs.

    Dead IDs are pruned everywhere, unmapped live Spaces default to
    DEFAULT_ENV (restored Spaces keep their IDs, so they keep their
    assignment), and each environment's MRU list is rebuilt from entries that
    are both live and still assigned to that environment, with missing members
    appended in sidebar order.
    """
    live = set(live_ids)
    assignments = state["assignments"]
    for ws in list(assignments):
        if ws not in live:
            del assignments[ws]
    added = []
    for ws in live_ids:
        if ws not in assignments:
            assignments[ws] = DEFAULT_ENV
            added.append(ws)
    for env in ENVIRONMENTS:
        members = [ws for ws in state["mru"][env] if assignments.get(ws) == env]
        members += [
            ws for ws in live_ids if assignments.get(ws) == env and ws not in members
        ]
        state["mru"][env] = members
    return added


def forget(state, ws_id):
    state["assignments"].pop(ws_id, None)
    for env in ENVIRONMENTS:
        if ws_id in state["mru"][env]:
            state["mru"][env].remove(ws_id)


def assign(state, ws_id, env):
    """Assign ws_id to env and make it that environment's most recent Space."""
    for candidate in ENVIRONMENTS:
        if ws_id in state["mru"][candidate]:
            state["mru"][candidate].remove(ws_id)
    state["assignments"][ws_id] = env
    state["mru"][env].insert(0, ws_id)


def touch_mru(state, ws_id):
    env = state["assignments"].get(ws_id)
    if env is None:
        return
    if ws_id in state["mru"][env]:
        state["mru"][env].remove(ws_id)
    state["mru"][env].insert(0, ws_id)


def pick_target(state, env, live_ids):
    """Most recently used live Space of env, falling back to sidebar order."""
    live = set(live_ids)
    for ws in state["mru"][env]:
        if ws in live and state["assignments"].get(ws) == env:
            return ws
    for ws in live_ids:
        if state["assignments"].get(ws) == env:
            return ws
    return None


def resolve_current_env(state, focused_env, live_ids):
    """Current environment for a toggle.

    Focus events keep active_env in sync, so normally it matches the focused
    Space. When they diverge and the stored environment still has members,
    events were missed and the live focus wins. When the stored environment is
    empty, the divergence is the declared-intent limbo left by toggling into
    an empty environment, and the stored value wins so the next toggle returns.
    """
    active = state["active_env"]
    if focused_env in ENVIRONMENTS and focused_env != active:
        if any(state["assignments"].get(ws) == active for ws in live_ids):
            return focused_env
    return active


def is_grouped(order, assignments):
    """True when the personal block precedes the work block with no interleaving."""
    seen_work = False
    for ws in order:
        if assignments.get(ws, DEFAULT_ENV) == "work":
            seen_work = True
        elif seen_work:
            return False
    return True


def regroup_plan(order, assignments):
    """Work-block IDs (in current order) to move to the end, or None if grouped."""
    if is_grouped(order, assignments):
        return None
    return [ws for ws in order if assignments.get(ws, DEFAULT_ENV) == "work"]


def visibility_patch(assignments, active):
    """Per-Space sidebar_hidden values: "1" outside active, None inside it."""
    return {
        ws: (None if env == active else "1") for ws, env in assignments.items()
    }


def agent_view_filter(assignments, env):
    """agent.view.set filter matching only agents in env's Spaces.

    Workspace IDs are compared against the builtin workspace_id field. An
    empty environment matches nothing (workspace IDs are never empty), so the
    panel shows Herdr's own "no matching agents" state. Stale IDs are harmless
    here: they match no live agent.
    """
    members = [ws for ws, assigned in assignments.items() if assigned == env]
    if not members:
        return {"op": "eq", "field": "workspace_id", "value": ""}
    chunks = [
        members[i : i + MAX_FILTER_VALUES]
        for i in range(0, len(members), MAX_FILTER_VALUES)
    ]
    filters = [
        {"op": "in", "field": "workspace_id", "values": chunk} for chunk in chunks
    ]
    if len(filters) == 1:
        return filters[0]
    return {"op": "any", "filters": filters}


# --- action/event plans (pure, run under the state lock) --------------------


def plan_toggle(state, order, focused_ws):
    added = reconcile(state, order)
    focused_env = state["assignments"].get(focused_ws)
    current = resolve_current_env(state, focused_env, order)
    dest = other(current)
    target = pick_target(state, dest, order)
    state["active_env"] = dest
    return dest, target, added


def plan_send(state, order, ws_id):
    """Reassign ws_id to the other environment; prefer staying in the source.

    Returns (src, dest, remaining, added). remaining is the source Space to
    focus, or None when ws_id was the source's last Space — then the focus
    stays on the moved Space and the active environment follows it.
    """
    added = reconcile(state, order)
    src = state["assignments"][ws_id]
    dest = other(src)
    assign(state, ws_id, dest)
    remaining = pick_target(state, src, order)
    state["active_env"] = src if remaining else dest
    return src, dest, remaining, added


def plan_created(state, order, ws_id):
    """A new Space inherits the active environment."""
    if ws_id not in state["assignments"]:
        assign(state, ws_id, state["active_env"])
    added = reconcile(state, order)
    return state["assignments"].get(ws_id), added


def plan_focused(state, ws_id):
    """Track MRU and let the active environment follow real focus."""
    newly = ws_id not in state["assignments"]
    if newly:
        assign(state, ws_id, state["active_env"])
    else:
        touch_mru(state, ws_id)
    state["active_env"] = state["assignments"][ws_id]
    return state["active_env"], newly


# --- I/O plumbing -----------------------------------------------------------


def herdr_bin():
    configured = os.environ.get("HERDR_BIN_PATH", "").removesuffix(" (deleted)")
    if configured and Path(configured).is_file():
        return configured
    return shutil.which("herdr") or str(Path.home() / ".local/bin/herdr")


def plugin_source():
    return os.environ.get("HERDR_PLUGIN_ID", "martinro.spaces-env")


def state_dir():
    configured = os.environ.get("HERDR_PLUGIN_STATE_DIR")
    if configured:
        return Path(configured)
    return Path.home() / ".local" / "state" / "herdr" / "plugins" / plugin_source()


def load_state_raw():
    try:
        raw = json.loads((state_dir() / STATE_FILE).read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def mutate_state(update):
    """Apply `update` to the normalised state under an exclusive lock; return its result."""
    directory = state_dir()
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / STATE_FILE
    with open(directory / f"{STATE_FILE}.lock", "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            state = normalise_state(load_state_raw())
            result = update(state)
            temporary = directory / f"{STATE_FILE}.tmp"
            temporary.write_text(json.dumps(state))
            temporary.replace(path)
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)
    return result


def socket_path():
    configured = os.environ.get("HERDR_SOCKET_PATH")
    if configured:
        return configured
    raise SystemExit("HERDR_SOCKET_PATH is not set")


def api(method, params):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(10)
        connection.connect(socket_path())
        connection.sendall(
            json.dumps({"id": f"spaces-env:{method}", "method": method, "params": params}).encode()
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
    return api("session.snapshot", {})["snapshot"]


def live_order(live):
    return [
        ws["workspace_id"]
        for ws in live.get("workspaces", [])
        if isinstance(ws.get("workspace_id"), str)
    ]


def labels_by_id(live):
    return {
        ws["workspace_id"]: ws.get("label", ws["workspace_id"])
        for ws in live.get("workspaces", [])
        if isinstance(ws.get("workspace_id"), str)
    }


def toast(title):
    subprocess.run(
        [herdr_bin(), "notification", "show", title, "--sound", "none"],
        capture_output=True,
        timeout=10,
    )


def stamp_badge(ws_id, env):
    """Stamp the sidebar badge. Display-only: a failure must never abort an action."""
    tokens = {
        name: (glyph if key == env else None)
        for key, (name, glyph) in BADGE_TOKENS.items()
    }
    try:
        api(
            "workspace.report_metadata",
            {"workspace_id": ws_id, "source": plugin_source(), "tokens": tokens},
        )
    except (SystemExit, OSError, json.JSONDecodeError) as error:
        print(f"badge not updated for {ws_id}: {error}")


def apply_visibility(assignments, active):
    """Hide inactive-environment Spaces from the sidebar. Display-only: never abort."""
    for ws_id, value in visibility_patch(assignments, active).items():
        try:
            api(
                "workspace.report_metadata",
                {
                    "workspace_id": ws_id,
                    "source": plugin_source(),
                    "tokens": {HIDDEN_TOKEN: value},
                },
            )
        except (SystemExit, OSError, json.JSONDecodeError) as error:
            print(f"visibility not updated for {ws_id}: {error}")


def apply_agent_view(assignments, env):
    """Filter the agents panel to env's Spaces. Display-only: never abort."""
    try:
        api(
            "agent.view.set",
            {
                "source": plugin_source(),
                "label": env.title(),
                "filter": agent_view_filter(assignments, env),
            },
        )
    except (SystemExit, OSError, json.JSONDecodeError) as error:
        print(f"agent view not updated for {env}: {error}")


def apply_grouping(order, assignments):
    """Keep the personal block above the work block. Display-only: never abort."""
    plan = regroup_plan(order, assignments)
    if not plan:
        return False
    try:
        api(
            "workspace.move_block",
            {"workspace_ids": plan, "before_workspace_id": None},
        )
    except (SystemExit, OSError, json.JSONDecodeError) as error:
        print(f"regroup failed: {error}")
        return False
    return True


# --- actions ----------------------------------------------------------------


def toggle():
    live = snapshot()
    order = live_order(live)
    focused_ws = live.get("focused_workspace_id")

    def flip(state):
        dest, target, added = plan_toggle(state, order, focused_ws)
        return dest, target, added, dict(state["assignments"])

    dest, target, added, assignments = mutate_state(flip)
    for ws in added:
        stamp_badge(ws, assignments[ws])
    if added:
        apply_grouping(order, assignments)
    apply_agent_view(assignments, dest)
    apply_visibility(assignments, dest)
    if target is None:
        print(f"toggle -> {dest}: empty")
        toast(f"{dest.title()} has no Spaces — new Spaces will start there")
        return
    try:
        api("workspace.focus", {"workspace_id": target})
    except SystemExit as error:
        toast(f"Could not focus {dest} Space: {error}")
        raise
    label = labels_by_id(live).get(target, target)
    print(f"toggle -> {dest}: focused {target}")
    toast(f"{dest.title()} · {label}")


def send():
    live = snapshot()
    order = live_order(live)
    ws_id = os.environ.get("HERDR_WORKSPACE_ID") or live.get("focused_workspace_id")
    if not ws_id or ws_id not in set(order):
        toast("No current Space to send")
        raise SystemExit(f"send: workspace {ws_id!r} is not in the live session")

    def move(state):
        src, dest, remaining, added = plan_send(state, order, ws_id)
        return src, dest, remaining, added, dict(state["assignments"])

    src, dest, remaining, added, assignments = mutate_state(move)
    stamp_badge(ws_id, dest)
    for ws in added:
        if ws != ws_id:
            stamp_badge(ws, assignments[ws])
    apply_grouping(order, assignments)
    apply_agent_view(assignments, src if remaining else dest)
    apply_visibility(assignments, src if remaining else dest)
    label = labels_by_id(live).get(ws_id, ws_id)
    if remaining is None:
        print(f"send {ws_id} {src}->{dest}: last Space, following it")
        toast(f"Sent {label} to {dest.title()} — {src.title()} is empty")
        return
    try:
        api("workspace.focus", {"workspace_id": remaining})
    except SystemExit as error:
        toast(f"Sent {label} to {dest.title()}, but could not refocus: {error}")
        raise
    print(f"send {ws_id} {src}->{dest}: staying on {remaining}")
    toast(f"Sent {label} to {dest.title()}")


def status():
    live = snapshot()
    order = live_order(live)

    def summarise(state):
        added = reconcile(state, order)
        return added, dict(state["assignments"]), state["active_env"]

    added, assignments, active = mutate_state(summarise)
    for ws in added:
        stamp_badge(ws, assignments[ws])
    apply_agent_view(assignments, active)
    apply_visibility(assignments, active)
    counts = {
        env: sum(1 for ws in order if assignments.get(ws) == env)
        for env in ENVIRONMENTS
    }
    print(f"active={active} assignments={assignments}")
    toast(
        f"Active: {active.title()} · Personal {counts['personal']} · Work {counts['work']}"
    )


# --- event handlers ---------------------------------------------------------


def event_data():
    try:
        data = json.loads(os.environ["HERDR_PLUGIN_EVENT_JSON"])["data"]
    except (json.JSONDecodeError, KeyError, TypeError):
        return None
    return data if isinstance(data, dict) else None


def handle_created():
    data = event_data()
    workspace = data.get("workspace") if data else None
    ws_id = workspace.get("workspace_id") if isinstance(workspace, dict) else None
    if not isinstance(ws_id, str):
        return
    live = snapshot()
    order = live_order(live)

    def observe(state):
        env, added = plan_created(state, order, ws_id)
        return env, added, dict(state["assignments"]), state["active_env"]

    env, added, assignments, active = mutate_state(observe)
    if env is None:
        print(f"created {ws_id}: gone before assignment")
        return
    for ws in {ws_id, *added}:
        if ws in assignments:
            stamp_badge(ws, assignments[ws])
    apply_grouping(order, assignments)
    apply_agent_view(assignments, active)
    apply_visibility(assignments, active)
    print(f"created {ws_id} -> {env}")


def handle_closed():
    data = event_data()
    ws_id = data.get("workspace_id") if data else None
    if not isinstance(ws_id, str):
        return

    def drop(state):
        forget(state, ws_id)
        return dict(state["assignments"]), state["active_env"]

    assignments, active = mutate_state(drop)
    apply_agent_view(assignments, active)
    print(f"closed {ws_id}")


def handle_focused():
    data = event_data()
    ws_id = data.get("workspace_id") if data else None
    if not isinstance(ws_id, str):
        return

    def follow(state):
        previous = state["active_env"]
        env, newly = plan_focused(state, ws_id)
        return previous, env, newly, dict(state["assignments"])

    previous, env, newly, assignments = mutate_state(follow)
    if newly:
        stamp_badge(ws_id, env)
    # Focus fires constantly; only re-issue the view when it can change.
    if newly or env != previous:
        apply_agent_view(assignments, env)
        apply_visibility(assignments, env)
    print(f"focused {ws_id} env={env} newly_mapped={newly}")


def startup():
    live = snapshot()
    order = live_order(live)

    def fold(state):
        added = reconcile(state, order)
        return added, dict(state["assignments"]), state["active_env"]

    added, assignments, active = mutate_state(fold)
    # Metadata tokens and the agent-view override do not survive a server
    # restart, so restamp every Space and re-issue the view and visibility.
    for ws in order:
        stamp_badge(ws, assignments[ws])
    apply_grouping(order, assignments)
    apply_agent_view(assignments, active)
    apply_visibility(assignments, active)
    print(f"startup: {len(order)} spaces, {len(added)} newly mapped, active={active}")


if __name__ == "__main__":
    event = os.environ.get("HERDR_PLUGIN_EVENT")
    if event == "workspace.created":
        handle_created()
    elif event == "workspace.closed":
        handle_closed()
    elif event == "workspace.focused":
        handle_focused()
    elif event == "startup":
        startup()
    elif event is None:
        subcommand = sys.argv[1] if len(sys.argv) > 1 else "status"
        if subcommand == "toggle":
            toggle()
        elif subcommand == "send":
            send()
        elif subcommand == "status":
            status()
        else:
            raise SystemExit(f"unknown subcommand: {subcommand}")
