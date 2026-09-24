#!/usr/bin/env python3
"""Native Herdr attention regression: own PTY/server, isolated HOME, synthetic agents.

Requires installed Herdr and Python 3.11+. No existing-pane input, credentials,
model requests or production reloads. Optionally pass an older next_agent.py
path to reproduce the jump regression. Set HERDR_TEST_BIN to a build-only
candidate to check native click events. The fixture manifest uses this interpreter.
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
SOURCE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE / "next_agent.py"
# Disjoint repeated markers avoid retained-frame elision of identical cells.
ORIGIN = b"AAAAAAAAAAAAAAAAAAAA"
DESTINATION = b"BBBBBBBBBBBBBBBBBBBB"
ANSI = re.compile(rb"\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*?(?:\x07|\x1b\\)")


class Screen:
    """Small VT text projection for locating/clicking this fixture's sidebar rows."""

    def __init__(self):
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.pending = ""
        self.rows = [[" "] * 110 for _ in range(32)]
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
                    self.row = min(31, n - 1)
                    self.col = min(109, (args[1] or 1) - 1 if len(args) > 1 else 0)
                elif final == "G":
                    self.col = min(109, n - 1)
                elif final == "d":
                    self.row = min(31, n - 1)
                elif final in "ABCD":
                    self.row = max(0, min(31, self.row + (n if final == "B" else -n if final == "A" else 0)))
                    self.col = max(0, min(109, self.col + (n if final == "C" else -n if final == "D" else 0)))
                elif final == "J" and args[0] in (2, 3):
                    self.rows = [[" "] * 110 for _ in range(32)]
                elif final == "K":
                    start, end = (0 if args[0] in (1, 2) else self.col), (110 if args[0] != 1 else self.col + 1)
                    self.rows[self.row][start:end] = [" "] * (end - start)
                continue
            char, self.pending = self.pending[0], self.pending[1:]
            if char == "\r":
                self.col = 0
            elif char == "\n":
                self.row = min(31, self.row + 1)
            elif char == "\b":
                self.col = max(0, self.col - 1)
            elif char >= " ":
                self.rows[self.row][self.col] = char
                self.col = min(109, self.col + 1)

    def find(self, label):
        for row, cells in enumerate(self.rows):
            text = "".join(cells)
            if label in text:
                return text.index(label) + 1, row + 1
        return None

    def line(self, label):
        return next(("".join(row) for row in self.rows if label in "".join(row)), "")


def smoke(kind, navigation="hotkey"):
    with tempfile.TemporaryDirectory(prefix="next-agent-native-", dir="/tmp") as root:
        root = Path(root)
        shell = root / "fixture-shell"
        shell.write_text('#!/bin/sh\nprintf "\\033[2J\\033[H%s\\n" "$FIXTURE_MARKER"\nexec /bin/sleep 120\n')
        shell.chmod(0o700)
        config = root / "config.toml"
        config.write_text(f'''onboarding = false
[terminal]
default_shell = {json.dumps(str(shell))}
shell_mode = "non_login"
[update]
version_check = false
manifest_check = false
[keys]
prefix = "ctrl+a"
[[keys.command]]
key = "prefix+u"
type = "plugin_action"
command = "martinro.next-agent.jump"
[[keys.command]]
key = "prefix+shift+u"
type = "plugin_action"
command = "martinro.next-agent.back"
[ui.sidebar.spaces]
inline_agents = true
[ui.sidebar.agents]
rows = [["$dot_review", "$dot_idle", "$dot_working", "$dot_blocked", "$task_summary"]]
[ui.toast]
delivery = "off"
[ui.sound]
enabled = false
''')
        env = {
            "HOME": str(root), "PATH": f"{Path(sys.executable).parent}:/usr/bin:/bin",
            "SHELL": "/bin/sh", "TERM": "xterm-256color", "LANG": "en_US.UTF-8",
            "HERDR_CONFIG_PATH": str(config), "HERDR_SOCKET_PATH": str(root / "herdr.sock"),
            "XDG_CONFIG_HOME": str(root / "config"), "XDG_STATE_HOME": str(root / "state"),
            "XDG_CACHE_HOME": str(root / "cache"), "FIXTURE_MARKER": ORIGIN.decode(),
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        plugin = root / "plugin"
        plugin.mkdir()
        shutil.copyfile(SOURCE, plugin / "next_agent.py")
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

        def snapshot():
            return api("session.snapshot")["snapshot"]

        cli("config", "check")
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 32, 110, 0, 0))
        client = subprocess.Popen([HERDR], env=env, cwd=root, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()
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
                    output.extend(chunk)
                    screen.feed(chunk)
                    if b"\x1b[6n" in chunk:
                        os.write(master, b"\x1b[1;1R")

        def wait_for(check, description, seconds=8):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                drain(0.1)
                try:
                    if check():
                        return
                except (OSError, KeyError):
                    pass
            raise AssertionError(description)

        try:
            wait_for(lambda: ORIGIN in ANSI.sub(b"", output), "origin never rendered")
            initial = snapshot()
            origin = initial["focused_pane_id"]
            old_panes = {p["pane_id"] for p in initial["panes"]}
            cli("plugin", "link", str(plugin), "--enabled")
            args = [kind, "create", "--label", "Fixture target", "--no-focus", "--env", f"FIXTURE_MARKER={DESTINATION.decode()}"]
            if kind == "tab":
                args.extend(["--workspace", initial["focused_workspace_id"]])
            cli(*args)
            target = next(p["pane_id"] for p in snapshot()["panes"] if p["pane_id"] not in old_panes)
            sibling = None
            if navigation == "click":
                before_split = {p["pane_id"] for p in snapshot()["panes"]}
                cli("pane", "split", target, "--direction", "down", "--no-focus")
                sibling = next(p["pane_id"] for p in snapshot()["panes"] if p["pane_id"] not in before_split)
                for pane, label in ((target, "Review target"), (sibling, "Unread sibling")):
                    cli("pane", "report-metadata", pane, "--source", "fixture-label", "--token", f"task_summary={label}")
                cli("pane", "report-agent", sibling, "--source", "fixture", "--agent", "pi", "--state", "working", "--seq", "1")
                drain(0.3)
                cli("pane", "report-agent", sibling, "--source", "fixture", "--agent", "pi", "--state", "idle", "--seq", "2")
            cli("pane", "report-agent", target, "--source", "fixture", "--agent", "pi", "--state", "working", "--seq", "1")
            drain(0.3)
            cli("pane", "report-agent", target, "--source", "fixture", "--agent", "pi", "--state", "idle", "--seq", "2")
            wait_for(lambda: any(a["pane_id"] == target and a["agent_status"] == "done" for a in snapshot()["agents"]), "no completion")
            drain(0.5)
            assert DESTINATION not in ANSI.sub(b"", output), "target was already visible"
            output.clear()
            if navigation == "click":
                def token(pane_id, name):
                    return next(p for p in snapshot()["panes"] if p["pane_id"] == pane_id).get("tokens", {}).get(name)

                wait_for(lambda: token(target, "dot_review") and token(sibling, "dot_review"), "missing initial review dots")
                wait_for(lambda: screen.find("Review target"), "target sidebar label missing")
                x, y = screen.find("Review target")
                os.write(master, f"\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m".encode())
                wait_for(lambda: DESTINATION in ANSI.sub(b"", output), "click did not render destination")
                wait_for(lambda: snapshot()["focused_pane_id"] == target, "click focus drifted")
                wait_for(lambda: token(target, "dot_idle") and not token(target, "dot_review"), "click left the review dot orange")
                wait_for(lambda: "○" in screen.line("Review target"), "reviewed glyph not rendered")
                assert token(sibling, "dot_review"), "click incorrectly acknowledged sibling"
                assert "●" in screen.line("Unread sibling"), "sibling review glyph lost"
                print(f"PASS: sidebar click across {kind}s clears review and leaves split sibling unread")
                # Also click the sibling's actual terminal body, not its sidebar row.
                wait_for(lambda: screen.find(ORIGIN.decode()), "split sibling body missing")
                x, y = screen.find(ORIGIN.decode())
                os.write(master, f"\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m".encode())
                wait_for(lambda: snapshot()["focused_pane_id"] == sibling, "pane body click did not focus sibling")
                wait_for(lambda: token(sibling, "dot_idle") and not token(sibling, "dot_review"), "pane body click left review unread")
                wait_for(lambda: "○" in screen.line("Unread sibling"), "pane body click did not render reviewed glyph")
                print("PASS: clicking a split pane's body acknowledges that conversation too")
                api("pane.focus", {"pane_id": origin})
                wait_for(lambda: snapshot()["focused_pane_id"] == origin, "return to origin failed")
                cli("pane", "report-agent", target, "--source", "fixture", "--agent", "pi", "--state", "working", "--seq", "3")
                wait_for(lambda: token(target, "dot_working"), "new work did not update the dot")
                cli("pane", "report-agent", target, "--source", "fixture", "--agent", "pi", "--state", "idle", "--seq", "4")
                wait_for(lambda: token(target, "dot_review"), "new completion was not raised")
                print("PASS: subsequent completion raises review again")
                return
            os.write(master, b"\x01u")
            wait_for(lambda: DESTINATION in ANSI.sub(b"", output), "jump did not render destination in client")
            wait_for(lambda: snapshot()["focused_pane_id"] == target, "jump focus drifted")
            print(f"PASS: C-a u rendered the completed conversation across {kind}s")
            output.clear()
            os.write(master, b"\x01U")
            wait_for(lambda: ORIGIN in ANSI.sub(b"", output), "back did not render origin")
            wait_for(lambda: snapshot()["focused_pane_id"] == origin, "back focus drifted")
            print("PASS: C-a Shift-u returned to the original shell")
            os.write(master, b"\x01u")
            wait_for(
                lambda: any("candidates []" in (log.get("stdout") or "") for log in json.loads(cli("plugin", "log", "list", "--plugin", "martinro.next-agent", "--limit", "12"))["result"]["logs"]),
                "reviewed conversation was not excluded",
            )
            assert snapshot()["focused_pane_id"] == origin
            print("PASS: reviewed conversation is not revisited")
        except BaseException:
            print("Recent terminal:", repr(bytes(output[-2000:])))
            print("Screen:\n" + "\n".join("".join(row) for row in screen.rows))
            if Path(env["HERDR_SOCKET_PATH"]).exists():
                print("Plugin logs:", cli("plugin", "log", "list", "--plugin", "martinro.next-agent", "--limit", "12"))
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
        raise SystemExit("Herdr must already be installed and on PATH")
    for navigation in ("hotkey", "click"):
        for kind in ("workspace", "tab"):
            smoke(kind, navigation)
