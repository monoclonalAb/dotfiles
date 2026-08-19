#!/usr/bin/env python3
"""Focus the next Herdr agent that needs attention."""

import json
import os
import shutil
import subprocess
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


def notify_hidden_omp_blocker():
    try:
        event = json.loads(os.environ["HERDR_PLUGIN_EVENT_JSON"])
        data = event["data"]
        pane_id = data["pane_id"]
        if not isinstance(data, dict):
            return
    except (json.JSONDecodeError, KeyError, TypeError):
        return

    if data.get("agent") != "omp" or data.get("agent_status") != "blocked":
        return

    time.sleep(TOAST_DELAY_SECONDS)
    snapshot = json.loads(run("api", "snapshot"))["result"]["snapshot"]
    target = next((item for item in snapshot.get("agents", []) if item.get("pane_id") == pane_id), None)
    if (
        not target
        or target.get("agent") != "omp"
        or target.get("agent_status") != "blocked"
        or target.get("tab_id") != snapshot.get("focused_tab_id")
        or target.get("pane_id") == snapshot.get("focused_pane_id")
    ):
        return

    response = json.loads(
        run(
            "notification",
            "show",
            "omp needs attention",
            "--body",
            notification_context(snapshot, target),
            "--position",
            "bottom-right",
            "--sound",
            "none",
        )
    )
    result = response.get("result", {})
    if result.get("shown") is True:
        print(f"notified {pane_id}")
        return
    raise SystemExit(f"notification not shown: {result.get('reason', 'unknown')}")


def main():
    priority, scope = plugin_config()
    agents = json.loads(run("agent", "list"))["result"]["agents"]
    if scope == "workspace":
        workspace = os.environ.get("HERDR_ACTIVE_WORKSPACE_ID") or os.environ.get("HERDR_WORKSPACE_ID")
        if workspace:
            agents = [agent for agent in agents if agent.get("workspace_id") == workspace]

    ranked = sorted(
        (agent for agent in agents if agent.get("agent_status") in priority),
        key=lambda agent: (priority.index(agent["agent_status"]), agent.get("pane_id", "")),
    )
    if not ranked:
        subprocess.run(
            [herdr_bin(), "notification", "show", "No agent needs attention", "--sound", "none"],
            capture_output=True,
            timeout=10,
        )
        return

    target = ranked[0]
    for index, agent in enumerate(ranked):
        if agent.get("focused"):
            target = ranked[(index + 1) % len(ranked)]
            break
    run("agent", "focus", target["pane_id"])


if __name__ == "__main__":
    event = os.environ.get("HERDR_PLUGIN_EVENT")
    if event == "pane.agent_status_changed":
        notify_hidden_omp_blocker()
    elif event is None:
        main()
