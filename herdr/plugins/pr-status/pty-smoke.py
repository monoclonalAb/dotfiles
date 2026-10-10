#!/usr/bin/env python3
"""Native pr-status check: own PTY/server, isolated HOME, real Git worktree, fake gh.

Needs a Herdr build carrying the pr_* sidebar tokens (set HERDR_TEST_BIN to a
build-only candidate) and Python 3.11+. No GitHub requests, credentials, existing
panes or production server are touched. The fixture manifest uses this interpreter.
"""
import codecs
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import time

HERE = Path(__file__).resolve().parent
HERDR = os.environ.get("HERDR_TEST_BIN") or shutil.which("herdr")
ROWS, COLS = 30, 110
GLYPHS = {"open": "\uf407", "draft": "\uf4dd", "merged": "\uf419", "closed": "\uf4dc"}
FAKE_GH = """#!{python}
import json, os, subprocess, sys
branch = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True).stdout.strip()
with open(os.environ["FAKE_GH_LOG"], "a") as log:
    log.write(json.dumps({{"cwd": os.getcwd(), "branch": branch}}) + "\\n")
reply = json.load(open(os.environ["FAKE_GH_REPLY"]))
sys.stdout.write(reply.get("stdout", ""))
sys.stderr.write(reply.get("stderr", ""))
sys.exit(reply.get("code", 0))
"""


class Screen:
    """Minimal VT text projection: enough to read sidebar rows."""

    def __init__(self):
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.pending = ""
        self.rows = [[" "] * COLS for _ in range(ROWS)]
        self.row = self.col = 0

    def feed(self, chunk):
        self.pending += self.decoder.decode(chunk)
        while self.pending:
            if self.pending.startswith("\x1b"):
                match = re.match(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*?(?:\x07|\x1b\\)|[^\[\]])", self.pending)
                if not match:
                    return
                command = match[0]
                self.pending = self.pending[len(command):]
                if not command.startswith("\x1b["):
                    continue
                raw, final = command[2:-1], command[-1]
                if raw and not all(c.isdigit() or c == ";" for c in raw):
                    continue
                args = [int(v or 0) for v in raw.split(";")]
                n = args[0] or 1
                if final in "Hf":
                    self.row = min(ROWS - 1, n - 1)
                    self.col = min(COLS - 1, (args[1] or 1) - 1 if len(args) > 1 else 0)
                elif final == "G":
                    self.col = min(COLS - 1, n - 1)
                elif final == "d":
                    self.row = min(ROWS - 1, n - 1)
                elif final in "ABCD":
                    self.row = max(0, min(ROWS - 1, self.row + (n if final == "B" else -n if final == "A" else 0)))
                    self.col = max(0, min(COLS - 1, self.col + (n if final == "C" else -n if final == "D" else 0)))
                elif final == "J" and args[0] in (2, 3):
                    self.rows = [[" "] * COLS for _ in range(ROWS)]
                elif final == "K":
                    start, end = (0 if args[0] in (1, 2) else self.col), (COLS if args[0] != 1 else self.col + 1)
                    self.rows[self.row][start:end] = [" "] * (end - start)
                continue
            char, self.pending = self.pending[0], self.pending[1:]
            if char == "\r":
                self.col = 0
            elif char == "\n":
                self.row = min(ROWS - 1, self.row + 1)
            elif char == "\b":
                self.col = max(0, self.col - 1)
            elif char >= " ":
                self.rows[self.row][self.col] = char
                self.col = min(COLS - 1, self.col + 1)

    def line(self, text):
        return next(("".join(row) for row in self.rows if text in "".join(row)), "")

    def dump(self):
        return "\n".join("".join(row).rstrip() for row in self.rows)


def git(*args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def main():
    with tempfile.TemporaryDirectory(prefix="pr-status-native-", dir="/tmp") as root:
        root = Path(root)
        shell = root / "fixture-shell"
        shell.write_text("#!/bin/sh\nexec /bin/sleep 120\n")
        shell.chmod(0o700)
        repo, worktree = root / "repo", root / "repo-feat"
        repo.mkdir()
        git("init", "-q", "-b", "main", cwd=repo)
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init", cwd=repo)
        git("worktree", "add", "-q", "-b", "feat/fixture-branch", str(worktree), cwd=repo)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        (bin_dir / "gh").write_text(FAKE_GH.format(python=sys.executable))
        (bin_dir / "gh").chmod(0o755)
        reply_file, gh_log = root / "gh-reply.json", root / "gh.log"

        def reply(state=None, draft=False, title="Add the fixture feature"):
            if state is None:
                body = {"code": 1, "stderr": 'no pull requests found for branch "feat/fixture-branch"\n'}
            else:
                body = {"stdout": json.dumps({"number": 12, "title": title, "state": state, "isDraft": draft})}
            reply_file.write_text(json.dumps(body))

        reply("OPEN", draft=True)
        config = root / "config.toml"
        config.write_text(f'''onboarding = false
[terminal]
default_shell = {json.dumps(str(shell))}
shell_mode = "non_login"
[update]
version_check = false
manifest_check = false
[ui]
sidebar_width = 40
[ui.sidebar.spaces]
inline_agents = true
rows = [["state_icon", "workspace"]]
[ui.toast]
delivery = "off"
[ui.sound]
enabled = false
''')
        env = {
            "HOME": str(root), "PATH": f"{bin_dir}:{Path(sys.executable).parent}:/usr/bin:/bin",
            "SHELL": "/bin/sh", "TERM": "xterm-256color", "LANG": "en_US.UTF-8",
            "HERDR_CONFIG_PATH": str(config), "HERDR_SOCKET_PATH": str(root / "herdr.sock"),
            "XDG_CONFIG_HOME": str(root / "config"), "XDG_STATE_HOME": str(root / "state"),
            "XDG_CACHE_HOME": str(root / "cache"), "PYTHONDONTWRITEBYTECODE": "1",
            "FAKE_GH_LOG": str(gh_log), "FAKE_GH_REPLY": str(reply_file),
        }
        plugin = root / "plugin"
        plugin.mkdir()
        shutil.copyfile(HERE / "pr_status.py", plugin / "pr_status.py")
        manifest = (HERE / "herdr-plugin.toml").read_text()
        (plugin / "herdr-plugin.toml").write_text(manifest.replace('"python3.14"', json.dumps(sys.executable)))

        def cli(*args):
            result = subprocess.run([HERDR, *args], env=env, cwd=root, text=True, capture_output=True, timeout=10)
            if result.returncode:
                raise AssertionError((args, result.stdout, result.stderr))
            return result.stdout

        def api(method, params=None):
            with socket.socket(socket.AF_UNIX) as conn:
                conn.settimeout(5)
                conn.connect(env["HERDR_SOCKET_PATH"])
                conn.sendall(json.dumps({"id": "fixture", "method": method, "params": params or {}}).encode() + b"\n")
                data = b""
                while b"\n" not in data:
                    chunk = conn.recv(65536)
                    if not chunk:
                        raise AssertionError("closed fixture socket")
                    data += chunk
            response = json.loads(data.split(b"\n")[0])
            if "error" in response:
                raise AssertionError(response)
            return response["result"]

        def workspaces():
            return api("workspace.list")["workspaces"]

        def lookups():
            return [json.loads(line) for line in gh_log.read_text().splitlines()] if gh_log.exists() else []

        cli("config", "check")
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
        client = subprocess.Popen([HERDR], env=env, cwd=root, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        screen = Screen()

        def drain(seconds=0.3):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                if select.select([master], [], [], min(0.05, max(0, deadline - time.monotonic())))[0]:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError:
                        break
                    if not chunk:
                        break
                    screen.feed(chunk)
                    if b"\x1b[6n" in chunk:
                        os.write(master, b"\x1b[1;1R")

        def wait_for(check, description, seconds=15):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                drain(0.1)
                try:
                    if check():
                        return
                except (OSError, KeyError, StopIteration):
                    pass
            raise AssertionError(description)

        def row_shows(glyph, text):
            line = screen.line(text)
            return glyph in line and line.index(glyph) < line.index(text)

        try:
            wait_for(lambda: Path(env["HERDR_SOCKET_PATH"]).exists() and workspaces(), "server never came up")
            cli("plugin", "link", str(plugin), "--enabled")
            cli("workspace", "create", "--cwd", str(repo), "--no-focus")
            # Herdr records worktree membership when it opens the checkout itself.
            cli("worktree", "open", "--cwd", str(repo), "--path", str(worktree), "--no-focus", "--trust-repository")

            def linked_id():
                return next(
                    ws["workspace_id"] for ws in workspaces()
                    if (ws.get("worktree") or {}).get("is_linked_worktree")
                )

            wait_for(linked_id, "Herdr never recognised the linked worktree")
            wt = linked_id()
            # Events may race worktree discovery; the action always rechecks everything.
            cli("plugin", "action", "invoke", "martinro.pr-status.refresh")

            def tokens():
                return next(ws for ws in workspaces() if ws["workspace_id"] == wt).get("tokens", {})

            wait_for(lambda: tokens().get("pr_state") == "draft", "draft PR tokens never reported")
            wait_for(lambda: row_shows(GLYPHS["draft"], "#12 Add the fixture feature"), "draft row not rendered")
            assert all(Path(entry["cwd"]).resolve() == worktree.resolve() for entry in lookups()), lookups()
            print("PASS: a linked worktree with a draft PR is named '#12 <title>' after a draft glyph")
            print("      " + screen.line("#12").rstrip())

            for state, draft, label in (("OPEN", False, "open"), ("MERGED", False, "merged"), ("CLOSED", True, "closed")):
                reply(state, draft=draft)
                cli("plugin", "action", "invoke", "martinro.pr-status.refresh")
                wait_for(lambda: row_shows(GLYPHS[label], "#12 Add the fixture feature"), f"{label} row not rendered")
                print(f"PASS: {label} state glyph rendered")

            # Event path: focusing the Space refreshes it once its short TTL has passed.
            reply(None)
            state_file = root / "state" / "herdr" / "plugins" / "martinro.pr-status" / "state.json"
            if not state_file.exists():
                state_file = next(root.rglob("martinro.pr-status/state.json"))
            cached = json.loads(state_file.read_text())
            cached["workspaces"][wt]["checked_at"] = 0
            state_file.write_text(json.dumps(cached))
            before = len(lookups())
            api("workspace.focus", {"workspace_id": wt})
            wait_for(lambda: len(lookups()) > before, "focus event did not trigger a lookup")
            wait_for(lambda: "pr_number" not in tokens(), "tokens not cleared once the PR is gone")
            wait_for(lambda: screen.line("feat/fixture-branch") and not screen.line("#12"), "branch name not restored")
            print("PASS: focus event rechecks; without a PR the Space shows its branch again")
        except BaseException:
            print("Screen:\n" + screen.dump())
            if Path(env["HERDR_SOCKET_PATH"]).exists():
                print("Plugin logs:", cli("plugin", "log", "list", "--plugin", "martinro.pr-status", "--limit", "12"))
            raise
        finally:
            # Only this fixture socket/server; never stop the user's server.
            try:
                if Path(env["HERDR_SOCKET_PATH"]).exists():
                    cli("server", "stop")
            finally:
                client.terminate()
                try:
                    client.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    client.kill()
                    client.wait(timeout=5)
                os.close(master)


if __name__ == "__main__":
    if not HERDR:
        raise SystemExit("Herdr must be installed, or HERDR_TEST_BIN set to a build")
    main()
