"""Tests for bin/pi parking: a fake `pi` on PATH in a pseudo-terminal. No model is called."""

import json
import os
import pty
import select
import fcntl
import shutil
import signal
import subprocess
import tempfile
import termios
import threading
import time
import unittest
from pathlib import Path

WRAPPER = Path(__file__).resolve().parents[2] / "bin" / "pi"

# Each run appends what it saw to FAKE_PI_LOG, then does the next FAKE_PI_PLAN
# step: park (write FAKE_SESSION to PI_PARK_FILE), park7 (also exit 7), quit, quit3,
# restart (park and ask for an immediate reopen, as /restart does).
FAKE_PI = """#!/usr/bin/python3
import json, os, select, sys, termios, time, tty
log = os.environ["FAKE_PI_LOG"]
runs = len(open(log).read().splitlines()) if os.path.exists(log) else 0
plan = os.environ.get("FAKE_PI_PLAN", "park,quit").split(",")
step = plan[runs] if runs < len(plan) else "quit"
got = b""
if runs and os.environ.get("FAKE_PI_READ"):
    old = termios.tcgetattr(0)
    tty.setraw(0)
    end = time.time() + 0.6
    while time.time() < end:
        if select.select([0], [], [], 0.05)[0]:
            got += os.read(0, 1024)
    termios.tcsetattr(0, termios.TCSANOW, old)
with open(log, "a") as f:
    f.write(json.dumps({"args": sys.argv[1:], "pid": os.getpid(), "ppid": os.getppid(),
                        "park_file": os.environ.get("PI_PARK_FILE"), "park_pid": os.environ.get("PI_PARK_PID"),
                        "park_args": os.environ.get("PI_PARK_ARGS"), "park_now": os.environ.get("PI_PARK_NOW"),
                        "stdin": got.hex()}) + "\\n")
if step.startswith(("park", "restart")) and "PI_PARK_FILE" in os.environ:
    if step == "restart":
        open(os.environ["PI_PARK_FILE"] + ".now", "w").close()
    with open(os.environ["PI_PARK_FILE"], "w") as f:
        f.write(os.environ["FAKE_SESSION"])
sys.exit(0 if step == "restart" else int(step[4:] or 0))
"""

IDLE = b"\x1b]7501;state=idle:app=pi\x1b\\"
NOTE = b"Pi closed while idle"
FOCUS_IN, FOCUS_OUT = b"\x1b[I", b"\x1b[O"


class Terminal:
    """The wrapper on a pseudo-terminal, with everything it prints collected."""

    def __init__(self, args, env, argv=None):
        self.master, slave = pty.openpty()
        # The pseudo-terminal is the controlling terminal, so closing it hangs up like a closed tab.
        self.proc = subprocess.Popen(argv or [str(WRAPPER), *args], stdin=slave, stdout=slave, stderr=slave, env=env,
                                     start_new_session=True, preexec_fn=lambda: fcntl.ioctl(0, termios.TIOCSCTTY, 0))
        os.close(slave)
        self.output = bytearray()
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        # Never blocked in read, so the main thread can close the master.
        while self.master is not None:
            try:
                if not select.select([self.master], [], [], 0.05)[0]:
                    continue
                chunk = os.read(self.master, 4096)
            except (OSError, TypeError, ValueError):
                return
            if not chunk:
                return
            self.output += chunk

    def type(self, data):
        os.write(self.master, data)

    def wait_for(self, check, timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            if check():
                return True
            time.sleep(0.02)
        return False

    def hang_up(self):
        master, self.master = self.master, None
        time.sleep(0.1)
        os.close(master)

    def close(self):
        if self.proc.poll() is None:
            self.proc.kill()
            self.proc.wait()
        if self.master is not None:
            os.close(self.master)


class PiParkingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp)
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        (bin_dir / "pi").write_text(FAKE_PI)
        (bin_dir / "pi").chmod(0o755)
        self.log = self.tmp / "runs.jsonl"
        self.session = str(self.tmp / "it's a session.jsonl")
        self.env = {
            "PATH": f"{bin_dir}:/usr/bin:/bin",
            "HOME": str(self.tmp / "home"),
            "XDG_STATE_HOME": str(self.tmp / "state"),
            "FAKE_PI_LOG": str(self.log),
            "FAKE_SESSION": self.session,
        }

    def start(self, *args, argv=None, **env):
        terminal = Terminal(args, {**self.env, **env}, argv)
        self.addCleanup(terminal.close)
        return terminal

    def runs(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def parked(self, terminal):
        self.assertTrue(terminal.wait_for(lambda: NOTE in terminal.output), terminal.output)

    def test_a_parked_run_waits_then_reopens_its_session_with_the_replayed_flags(self):
        t = self.start("-a", "--model", "m", "--name", "n", "--session-id", "abc", "--session-dir", "/s d/x",
                       "-ne", "-e", "builtin:mcp", "--", "hello", "--no-tools")
        self.parked(t)
        self.assertIn(IDLE, t.output)
        [first] = self.runs()
        self.assertEqual(first["args"], ["-a", "--model", "m", "--name", "n", "--session-id", "abc", "--session-dir",
                                         "/s d/x", "-ne", "-e", "builtin:mcp", "--no-skills", "--tui-mode", "fullscreen",
                                         "--", "hello", "--no-tools"])
        self.assertEqual((first["ppid"], first["park_pid"]), (t.proc.pid, str(t.proc.pid)))
        self.assertTrue(first["park_file"].startswith(self.env["XDG_STATE_HOME"]))
        self.assertEqual(first["park_args"], "-a\n--session-dir\n/s d/x\n-ne\n-e\nbuiltin:mcp\n--no-skills\n--tui-mode\nfullscreen\n",
                         "the replayed flags, one per line, for herdr-app-resume to label")
        self.assertEqual(first["park_now"], str(t.proc.pid), "tells /restart this wrapper reopens at once on PI_PARK_FILE.now")
        self.assertIsNone(t.proc.poll())

        t.type(FOCUS_OUT)
        t.type(FOCUS_OUT + FOCUS_OUT)
        time.sleep(0.5)
        self.assertEqual(len(self.runs()), 1, "a focus-out alone does not reopen it")

        t.type(b"x")
        self.assertTrue(t.wait_for(lambda: len(self.runs()) == 2))
        self.assertEqual(self.runs()[1]["args"], ["-a", "--session-dir", "/s d/x", "-ne", "-e", "builtin:mcp",
                                                  "--no-skills", "--tui-mode", "fullscreen", "--session", self.session])
        self.assertEqual(t.proc.wait(10), 0)

    def test_focus_or_any_key_reopens_it(self):
        for wake in (FOCUS_IN, b"\x03", b"\x04", b"q"):
            with self.subTest(wake=wake):
                self.log.unlink(missing_ok=True)
                t = self.start()
                self.parked(t)
                t.type(wake)
                self.assertTrue(t.wait_for(lambda: len(self.runs()) == 2))
                self.assertEqual(self.runs()[1]["args"][-2:], ["--session", self.session])
                self.assertEqual(t.proc.wait(10), 0)

    def test_keys_typed_after_waking_reach_pi(self):
        t = self.start(FAKE_PI_READ="1")
        self.parked(t)
        t.type(b"x")
        time.sleep(0.1)
        t.type(b"yz")
        self.assertTrue(t.wait_for(lambda: len(self.runs()) == 2))
        self.assertEqual(bytes.fromhex(self.runs()[1]["stdin"]), b"yz")
        self.assertEqual(t.proc.wait(10), 0)

    def test_quitting_passes_the_status_through_and_a_failed_park_is_not_parked(self):
        for plan, code in (("quit3", 3), ("quit", 0), ("park7", 7)):
            with self.subTest(plan=plan):
                self.log.unlink(missing_ok=True)
                t = self.start(FAKE_PI_PLAN=plan)
                self.assertEqual(t.proc.wait(10), code)
                self.assertNotIn(NOTE, t.output)
                self.assertEqual(len(self.runs()), 1)

    def test_closing_a_parked_pane_in_a_shell_leaves_no_park_file(self):
        t = self.start(argv=["/bin/zsh", "-fic", f"'{WRAPPER}'; exit 7"])
        self.parked(t)
        park = Path(self.env["XDG_STATE_HOME"]) / "pi-park"
        self.assertEqual(len(list(park.iterdir())), 1)
        os.kill(t.proc.pid, signal.SIGHUP)
        t.hang_up()
        self.assertTrue(t.wait_for(lambda: not list(park.iterdir()), timeout=5), list(park.iterdir()))

    def test_an_unusable_park_folder_still_runs_pi(self):
        state = Path(self.env["XDG_STATE_HOME"])
        state.mkdir()
        (state / "pi-park").write_text("not a folder")
        t = self.start(FAKE_PI_PLAN="park")
        self.assertEqual(t.proc.wait(10), 0)
        [run] = self.runs()
        self.assertEqual(run["pid"], t.proc.pid)

    def test_an_empty_value_is_replayed_as_given(self):
        t = self.start("--session-dir", "", "--no-approve")
        self.parked(t)
        t.type(b"x")
        self.assertTrue(t.wait_for(lambda: len(self.runs()) == 2))
        self.assertEqual(self.runs()[1]["args"][:3], ["--session-dir", "", "--no-approve"])

    def test_a_restart_reopens_at_once_without_waiting(self):
        t = self.start("-a", "--model", "m", "--", "hello", FAKE_PI_PLAN="restart,quit")
        self.assertEqual(t.proc.wait(10), 0)
        self.assertEqual([r["args"] for r in self.runs()][1], ["-a", "--no-skills", "--tui-mode", "fullscreen", "--session", self.session])
        self.assertNotIn(NOTE, t.output)
        self.assertEqual(list((Path(self.env["XDG_STATE_HOME"]) / "pi-park").iterdir()), [])

    def test_a_parked_start_waits_before_running_pi(self):
        # What pi-resume types into a terminal that a reboot brought back while it was parked.
        t = self.start("--parked", "-a", "--session", self.session, FAKE_PI_PLAN="quit")
        self.parked(t)
        self.assertIn(IDLE, t.output)
        time.sleep(0.3)
        self.assertEqual(self.runs(), [], "no Pi until you come back")
        t.type(FOCUS_IN)
        self.assertTrue(t.wait_for(lambda: len(self.runs()) == 1))
        self.assertEqual(self.runs()[0]["args"], ["-a", "--no-skills", "--tui-mode", "fullscreen", "--session", self.session])
        self.assertEqual(t.proc.wait(10), 0)

    def test_a_parked_start_without_a_session_or_a_terminal_just_runs_pi(self):
        t = self.start("--parked", FAKE_PI_PLAN="quit")
        self.assertEqual(t.proc.wait(10), 0)
        self.assertEqual([r["args"] for r in self.runs()], [["--no-skills", "--tui-mode", "fullscreen"]])
        self.assertNotIn(NOTE, t.output)
        self.log.unlink()
        proc = subprocess.Popen([str(WRAPPER), "--parked", "--session", self.session], env={**self.env, "FAKE_PI_PLAN": "quit"},
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        proc.communicate(timeout=10)
        [run] = self.runs()
        self.assertEqual((run["pid"], run["args"][:2]), (proc.pid, ["--session", self.session]))

    def test_runs_that_cannot_be_replayed_still_exec(self):
        for args, env in ((["-p", "hi"], {}), (["--no-tools"], {}), (["--no-session"], {}), (["--tools", "read"], {}),
                          (["--session-dir", "/two\nlines"], {}),
                          ([], {"PI_PARK_AFTER": "0"}), (["auth", "status"], {})):
            with self.subTest(args=args, env=env):
                self.log.unlink(missing_ok=True)
                t = self.start(*args, FAKE_PI_PLAN="park", **env)
                self.assertEqual(t.proc.wait(10), 0)
                [run] = self.runs()
                self.assertEqual(run["pid"], t.proc.pid, "Pi replaced the wrapper")
                self.assertIsNone(run["park_file"])
                self.assertNotIn(NOTE, t.output)

    def test_without_a_terminal_it_execs(self):
        proc = subprocess.Popen([str(WRAPPER), "hello"], env={**self.env, "FAKE_PI_PLAN": "park"},
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        proc.communicate(timeout=10)
        self.assertEqual(proc.returncode, 0)
        [run] = self.runs()
        self.assertEqual(run["pid"], proc.pid)
        self.assertIsNone(run["park_file"])


if __name__ == "__main__":
    unittest.main()
