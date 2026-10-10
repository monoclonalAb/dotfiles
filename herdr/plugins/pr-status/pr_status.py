#!/usr/bin/env python3
"""Show each linked worktree's GitHub pull request in the Herdr Spaces tree.

For every linked-worktree Space, `gh pr view` in its checkout finds the pull
request for the checked-out branch using gh's own lookup (fork-aware head,
open PRs first, no merged/closed PRs for the default branch). The result is
reported as display-only workspace metadata:

    pr_number  "123"
    pr_title   the PR title
    pr_state   open | draft | merged | closed

The custom Herdr build then names the Space "#123 <title>" and leads it with a
state glyph; a stock build ignores the tokens. Nothing is renamed, and nothing
is written to Git or GitHub.

Herdr has no timer hook, so refreshes ride on events: startup, Space/worktree
creation, focus and agent status changes. A per-Space cache in
HERDR_PLUGIN_STATE_DIR throttles gh. The Space an event comes from is checked
again after CURRENT_TTL; other Spaces after OTHER_TTL, or FINAL_TTL once merged
or closed. A failed lookup (offline, signed out, not GitHub) keeps the last
result. Tokens live only in server memory, so startup re-reports the cache
before refreshing everything.
"""

import fcntl
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

TOKENS = ("pr_number", "pr_title", "pr_state")
STATES = ("open", "draft", "merged", "closed")
FINAL_STATES = ("merged", "closed")
CURRENT_TTL = 30
OTHER_TTL = 300
FINAL_TTL = 1800
GH_TIMEOUT = 20
MAX_LOOKUPS_IN_PARALLEL = 4
# Herdr normalises token values this way; match it so unchanged tokens are not re-sent.
MAX_TOKEN_VALUE_LEN = 80
STATE_FILE = "state.json"
# Herdr and GUI processes may lack an interactive shell's PATH; appended as a fallback.
TOOL_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"


# --- pure model ---------------------------------------------------------------


def blank_state():
    return {"workspaces": {}}


def normalise_pr(raw):
    if not isinstance(raw, dict):
        return None
    number, title, state = raw.get("number"), raw.get("title"), raw.get("state")
    if not isinstance(number, int) or isinstance(number, bool) or number <= 0:
        return None
    if state not in STATES:
        return None
    return {"number": number, "title": title if isinstance(title, str) else "", "state": state}


def normalise_state(raw):
    state = blank_state()
    workspaces = raw.get("workspaces") if isinstance(raw, dict) else None
    if not isinstance(workspaces, dict):
        return state
    for ws_id, entry in workspaces.items():
        if not isinstance(ws_id, str) or not isinstance(entry, dict):
            continue
        checkout, branch, checked_at = entry.get("checkout"), entry.get("branch"), entry.get("checked_at")
        if not isinstance(checkout, str):
            continue
        state["workspaces"][ws_id] = {
            "checkout": checkout,
            "branch": branch if isinstance(branch, str) else None,
            "checked_at": float(checked_at) if isinstance(checked_at, (int, float)) else 0.0,
            "pr": normalise_pr(entry.get("pr")),
        }
    return state


def pr_from_gh(data):
    """Map `gh pr view --json number,title,state,isDraft` output to the cached shape."""
    if not isinstance(data, dict):
        return None
    state = {"MERGED": "merged", "CLOSED": "closed", "OPEN": "open"}.get(data.get("state"))
    if state == "open" and data.get("isDraft") is True:
        state = "draft"
    return normalise_pr({"number": data.get("number"), "title": data.get("title"), "state": state})


def linked_worktrees(workspaces):
    """{workspace_id: checkout_path} for live linked-worktree Spaces."""
    targets = {}
    for ws in workspaces:
        ws_id = ws.get("workspace_id")
        worktree = ws.get("worktree")
        if not isinstance(ws_id, str) or not isinstance(worktree, dict):
            continue
        checkout = worktree.get("checkout_path")
        if worktree.get("is_linked_worktree") is True and isinstance(checkout, str) and checkout:
            targets[ws_id] = checkout
    return targets


def ttl_for(entry, ws_id, current):
    if ws_id == current:
        return CURRENT_TTL
    pr = entry.get("pr")
    if pr and pr["state"] in FINAL_STATES:
        return FINAL_TTL
    return OTHER_TTL


def plan_refresh(state, targets, branches, current, now, force=False):
    """Fold live checkouts into the cache and claim the Spaces due a lookup.

    Spaces that are gone or no longer linked worktrees are forgotten. A Space
    whose checkout or branch changed loses its cached PR at once, since it
    belonged to another branch. Claimed Spaces get checked_at = now so that
    concurrent event processes skip them. Returns the claimed workspace IDs.
    """
    workspaces = state["workspaces"]
    for ws_id in list(workspaces):
        if ws_id not in targets:
            del workspaces[ws_id]
    due = []
    for ws_id, checkout in targets.items():
        branch = branches.get(ws_id)
        entry = workspaces.get(ws_id)
        if entry is None or entry["checkout"] != checkout or entry["branch"] != branch:
            entry = {"checkout": checkout, "branch": branch, "checked_at": 0.0, "pr": None}
            workspaces[ws_id] = entry
        if branch is None:
            # Detached HEAD: no branch, so no pull request to look up.
            entry["pr"] = None
            continue
        if force or now - entry["checked_at"] >= ttl_for(entry, ws_id, current):
            entry["checked_at"] = now
            due.append(ws_id)
    return due


def apply_results(state, results):
    """Store lookups. results: {ws_id: (branch, outcome, pr)}; outcome found|none|error."""
    for ws_id, (branch, outcome, pr) in results.items():
        entry = state["workspaces"].get(ws_id)
        if entry is None or entry["branch"] != branch:
            continue  # closed or switched branch while gh ran; the next event retries
        if outcome == "found":
            entry["pr"] = pr
        elif outcome == "none":
            entry["pr"] = None
        # error: keep the last known result


def normalise_value(value):
    """Herdr's own token normalisation: trim, drop control characters, cap length."""
    cleaned = "".join(ch for ch in value.strip() if unicodedata.category(ch) != "Cc")
    return cleaned[:MAX_TOKEN_VALUE_LEN].strip() or None


def wanted_tokens(pr):
    if pr is None:
        return {key: None for key in TOKENS}
    return {
        "pr_number": str(pr["number"]),
        "pr_title": normalise_value(pr["title"]) if pr["title"] else None,
        "pr_state": pr["state"],
    }


def token_patches(state, workspaces):
    """Per-Space token patches that bring live metadata in line with the cache.

    Covers every live Space, so tokens left on a Space that stopped being a
    linked worktree, or whose PR disappeared, are cleared too.
    """
    patches = {}
    for ws in workspaces:
        ws_id = ws.get("workspace_id")
        if not isinstance(ws_id, str):
            continue
        live = ws.get("tokens") if isinstance(ws.get("tokens"), dict) else {}
        entry = state["workspaces"].get(ws_id)
        wanted = wanted_tokens(entry["pr"] if entry else None)
        patch = {key: value for key, value in wanted.items() if live.get(key) != value}
        if patch:
            patches[ws_id] = patch
    return patches


# --- I/O plumbing ---------------------------------------------------------------


def plugin_source():
    return os.environ.get("HERDR_PLUGIN_ID", "martinro.pr-status")


def state_dir():
    configured = os.environ.get("HERDR_PLUGIN_STATE_DIR")
    if configured:
        return Path(configured)
    return Path.home() / ".local" / "state" / "herdr" / "plugins" / plugin_source()


class Locked:
    """Exclusive lock on the cache; `state` is loaded on entry and saved on exit."""

    def __enter__(self):
        directory = state_dir()
        directory.mkdir(parents=True, exist_ok=True)
        self.path = directory / STATE_FILE
        self.lock = open(directory / f"{STATE_FILE}.lock", "a+")
        fcntl.flock(self.lock, fcntl.LOCK_EX)
        try:
            raw = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            raw = {}
        self.state = normalise_state(raw)
        return self

    def __exit__(self, kind, _value, _traceback):
        try:
            if kind is None:
                temporary = self.path.with_suffix(".tmp")
                temporary.write_text(json.dumps(self.state))
                temporary.replace(self.path)
        finally:
            fcntl.flock(self.lock, fcntl.LOCK_UN)
            self.lock.close()


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
            json.dumps({"id": f"pr-status:{method}", "method": method, "params": params}).encode()
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


def live_workspaces():
    workspaces = api("workspace.list", {}).get("workspaces")
    return workspaces if isinstance(workspaces, list) else []


def tool_env():
    env = dict(os.environ)
    inherited = env.get("PATH")
    env["PATH"] = f"{inherited}:{TOOL_PATH}" if inherited else TOOL_PATH
    env["GH_PROMPT_DISABLED"] = "1"
    env["NO_COLOR"] = "1"
    return env


def tool(name):
    return shutil.which(name, path=tool_env()["PATH"]) or name


def current_branch(checkout):
    """Checked-out branch, or None for a detached HEAD or a missing checkout."""
    try:
        result = subprocess.run(
            [tool("git"), "-C", checkout, "symbolic-ref", "--quiet", "--short", "HEAD"],
            capture_output=True,
            text=True,
            timeout=10,
            env=tool_env(),
        )
    except (OSError, subprocess.SubprocessError):
        return None
    branch = result.stdout.strip()
    return branch if result.returncode == 0 and branch else None


def lookup(checkout):
    """(outcome, pr) for the checkout's branch: found, none, or error."""
    try:
        result = subprocess.run(
            [tool("gh"), "pr", "view", "--json", "number,title,state,isDraft"],
            cwd=checkout,
            capture_output=True,
            text=True,
            timeout=GH_TIMEOUT,
            env=tool_env(),
        )
    except (OSError, subprocess.SubprocessError) as error:
        return "error", str(error)
    if result.returncode == 0:
        try:
            pr = pr_from_gh(json.loads(result.stdout))
        except json.JSONDecodeError:
            pr = None
        return ("found", pr) if pr else ("error", "unexpected gh output")
    message = (result.stderr or result.stdout).strip()
    if message.startswith("no pull requests found"):
        return "none", None
    return "error", message.splitlines()[0] if message else f"gh exited {result.returncode}"


def report(patches):
    """Display-only: a failed report never aborts the run."""
    for ws_id, tokens in patches.items():
        try:
            api(
                "workspace.report_metadata",
                {"workspace_id": ws_id, "source": plugin_source(), "tokens": tokens},
            )
        except (SystemExit, OSError, json.JSONDecodeError) as error:
            print(f"tokens not updated for {ws_id}: {error}")


# --- entry point ----------------------------------------------------------------


def refresh(current=None, force=False):
    with Locked() as locked:
        workspaces = live_workspaces()
        targets = linked_worktrees(workspaces)
        branches = {ws_id: current_branch(checkout) for ws_id, checkout in targets.items()}
        due = plan_refresh(locked.state, targets, branches, current, time.time(), force)
        # Re-report first: restores tokens after a restart and clears stale ones.
        report(token_patches(locked.state, workspaces))
        jobs = {ws_id: (targets[ws_id], branches[ws_id]) for ws_id in due}
    if not jobs:
        return
    with ThreadPoolExecutor(max_workers=MAX_LOOKUPS_IN_PARALLEL) as pool:
        futures = {ws_id: pool.submit(lookup, checkout) for ws_id, (checkout, _) in jobs.items()}
        results = {}
        for ws_id, future in futures.items():
            outcome, detail = future.result()
            results[ws_id] = (jobs[ws_id][1], outcome, detail if outcome == "found" else None)
            if outcome == "error":
                print(f"{ws_id}: gh lookup failed, keeping last result: {detail}")
    with Locked() as locked:
        apply_results(locked.state, results)
        report(token_patches(locked.state, live_workspaces()))
    summary = ", ".join(f"{ws_id}={outcome}" for ws_id, (_, outcome, _) in sorted(results.items()))
    print(f"checked {summary}")


if __name__ == "__main__":
    event = os.environ.get("HERDR_PLUGIN_EVENT")
    if event is None and sys.argv[1:] != ["refresh"]:
        raise SystemExit("usage: pr_status.py refresh  (events need no arguments)")
    refresh(
        current=os.environ.get("HERDR_WORKSPACE_ID"),
        # Startup and the manual action recheck everything.
        force=event in (None, "startup"),
    )
