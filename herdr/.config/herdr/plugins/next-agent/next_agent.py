#!/usr/bin/env python3
"""Focus the next Herdr agent that needs attention."""

import json
import os
import shutil
import subprocess
import tomllib
from pathlib import Path

# `blocked` needs an answer now; `done` is a completed conversation that has
# not yet been reviewed. Idle agents are intentionally excluded.
DEFAULT_PRIORITY = ["blocked", "done"]


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
    main()
