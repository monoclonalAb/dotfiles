"""herdr-review checks with fake Herdr/tuicr executables; never touch a live server.

Set HERDR_REVIEW_TUICR_TEST_BIN=<tuicr> (or install tuicr) to also drive the real
TUI in an own PTY with an isolated HOME and temporary Git repository.
"""

import contextlib
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import io
import json
import os
from pathlib import Path
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2] / "bin" / "herdr-review"
loader = SourceFileLoader("herdr_review", str(SOURCE))
module = module_from_spec(spec_from_loader(loader.name, loader))
loader.exec_module(module)

FAKE_HERDR = r'''#!/usr/bin/python3
import json, os, sys
state = json.load(open(os.environ["FAKE_STATE"]))
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(["herdr", sys.argv[1:]]) + "\n")
command = sys.argv[1:3]
agents = state["agents"]
def fail(code, message):
    sys.stderr.write(json.dumps({"error": {"code": code, "message": message}}))
    sys.exit(1)
if command == ["agent", "get"]:
    match = [a for a in agents if a["pane_id"] == sys.argv[3]]
    if not match:
        fail("agent_not_found", "agent target %s not found" % sys.argv[3])
    print(json.dumps({"result": {"agent": match[0]}}))
elif command == ["agent", "list"]:
    print(json.dumps({"result": {"agents": agents}}))
elif command == ["agent", "prompt"]:
    if state.get("prompt_error"):
        fail("agent_blocked", state["prompt_error"])
    print(json.dumps({"result": {"agent": agents[0]}}))
else:
    fail("unknown", "unexpected command")
'''

FAKE_TUICR = r'''#!/usr/bin/python3
import json, os, sys
state = json.load(open(os.environ["FAKE_STATE"]))
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(["tuicr", sys.argv[1:], os.getcwd()]) + "\n")
if sys.argv[1:2] == ["review"]:
    sys.exit(state.get("clear_status", 0))
sys.stderr.write("tuicr-session: repo@main/staged-and-unstaged/abc123\n")
sys.stderr.write(state.get("tuicr_stderr", ""))
sys.stdout.write(state.get("export", ""))
sys.exit(state.get("tuicr_status", 0))
'''

EXPORT = "## Session: repo\n\nI reviewed your code.\n\n1. `a.py:2` - Use a named constant\n"


class HerdrReviewTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="herdr review ")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.home = self.root / "home"
        self.repo = self.root / "work tree"
        self.other = self.root / "other"
        for directory in (self.home, self.repo, self.other):
            directory.mkdir()
        self.log = self.root / "log.jsonl"
        self.state_path = self.root / "state.json"
        self.herdr = self.write_executable("herdr", FAKE_HERDR)
        self.tuicr = self.write_executable("tuicr", FAKE_TUICR)
        self.state = {
            "agents": [
                {"pane_id": "w1:p1", "tab_id": "w1:t1", "agent": "pi", "agent_status": "idle",
                 "cwd": str(self.other), "foreground_cwd": str(self.repo)},
                {"pane_id": "w1:p9", "tab_id": "w1:t2", "agent": "pi", "agent_status": "idle",
                 "cwd": str(self.other)},
            ],
            "export": EXPORT,
        }
        self.env = {
            "HOME": str(self.home),
            "HERDR_BIN_PATH": str(self.herdr),
            "HERDR_REVIEW_TUICR": str(self.tuicr),
            "HERDR_ACTIVE_PANE_ID": "w1:p1",
            "HERDR_ACTIVE_TAB_ID": "w1:t1",
            "FAKE_STATE": str(self.state_path),
            "FAKE_LOG": str(self.log),
        }
        self.pause = patch.object(module, "pause").start()
        self.clipboard = patch.object(module, "copy_to_clipboard", return_value=True).start()
        self.addCleanup(patch.stopall)

    def write_executable(self, name, source):
        path = self.root / name
        path.write_text(source)
        path.chmod(0o755)
        return path

    def run_review(self, *argv):
        self.state_path.write_text(json.dumps(self.state))
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            status = module.main(list(argv), self.env)
        return status, stdout.getvalue()

    def calls(self):
        if not self.log.exists():
            return []
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def prompts(self):
        return [args for tool, args, *_ in self.calls() if tool == "herdr" and args[:2] == ["agent", "prompt"]]

    def tuicr_runs(self):
        return [call for call in self.calls() if call[0] == "tuicr" and call[1][:1] != ["review"]]

    def clears(self):
        return [call[1] for call in self.calls() if call[0] == "tuicr" and call[1][:1] == ["review"]]

    def test_focused_agent_gets_exported_comments_and_they_are_cleared(self):
        (self.home / ".local/state/theme").mkdir(parents=True)
        (self.home / ".local/state/theme/flavour").write_text("mocha\n")
        status, _ = self.run_review()
        self.assertEqual(status, 0)
        [run] = self.tuicr_runs()
        self.assertEqual(run[1], ["-w", "--theme", "catppuccin-mocha", "--stdout", "--no-update-check"])
        self.assertEqual(os.path.realpath(run[2]), os.path.realpath(self.repo),
                         "tuicr runs in the agent's foreground cwd")
        self.assertEqual(self.prompts(), [["agent", "prompt", "w1:p1", EXPORT.strip()]])
        self.assertEqual(self.clears(), [["review", "clearc", "--session", "repo@main/staged-and-unstaged/abc123"]])
        self.pause.assert_not_called()

    def test_non_agent_focus_falls_back_to_the_only_agent_in_that_tab(self):
        self.env["HERDR_ACTIVE_PANE_ID"] = "w1:p2"
        self.assertEqual(self.run_review()[0], 0)
        self.assertEqual(self.prompts()[0][2], "w1:p1")

    def test_ambiguous_or_missing_tab_agent_opens_nothing(self):
        self.env["HERDR_ACTIVE_PANE_ID"] = "w1:p2"
        self.state["agents"].append(dict(self.state["agents"][0], pane_id="w1:p3"))
        self.assertEqual(self.run_review()[0], 1)
        self.assertIn("2 agents in this tab", self.pause.call_args[0][0])
        self.env["HERDR_ACTIVE_TAB_ID"] = "w1:t3"
        self.assertEqual(self.run_review()[0], 1)
        self.assertIn("no agent in this tab", self.pause.call_args[0][0])
        self.assertEqual(self.tuicr_runs(), [])
        self.assertEqual(self.prompts(), [])

    def test_shell_pane_in_the_agent_tab_uses_its_own_ids(self):
        del self.env["HERDR_ACTIVE_PANE_ID"], self.env["HERDR_ACTIVE_TAB_ID"]
        self.env.update(HERDR_PANE_ID="w1:p2", HERDR_TAB_ID="w1:t2")
        self.assertEqual(self.run_review("-r", "main..HEAD")[0], 0)
        self.assertEqual(self.prompts()[0][2], "w1:p9")

    def test_requires_herdr_context(self):
        del self.env["HERDR_ACTIVE_PANE_ID"]
        self.assertEqual(self.run_review()[0], 1)
        self.assertIn("run this inside Herdr", self.pause.call_args[0][0])
        self.assertEqual(self.calls(), [])

    def test_quitting_without_comments_sends_nothing(self):
        self.state["export"] = "\n"
        self.assertEqual(self.run_review()[0], 0)
        self.assertEqual(self.prompts(), [])
        self.assertEqual(self.clears(), [])
        self.pause.assert_not_called()

    def test_tuicr_failure_is_shown_and_nothing_sent(self):
        self.state.update(tuicr_status=1, export="", tuicr_stderr="Error: No changes to review\n")
        self.assertEqual(self.run_review()[0], 1)
        message = self.pause.call_args[0][0]
        self.assertIn("No changes to review", message)
        self.assertNotIn("tuicr-session", message)
        self.assertEqual(self.prompts(), [])

    def test_rejected_prompt_keeps_comments_and_copies_them(self):
        self.state["prompt_error"] = "agent w1:p1 is blocked and requires interactive input"
        self.assertEqual(self.run_review()[0], 1)
        self.clipboard.assert_called_once_with(EXPORT.strip())
        self.assertIn("is blocked", self.pause.call_args[0][0])
        self.assertEqual(self.clears(), [], "unsent comments stay in tuicr")

    def test_clear_failure_warns_about_repeat(self):
        self.state["clear_status"] = 1
        self.assertEqual(self.run_review()[0], 1)
        self.assertEqual(len(self.prompts()), 1)
        self.assertIn("sent again", self.pause.call_args[0][0])

    def test_explicit_arguments_and_theme_are_respected(self):
        (self.home / ".local/state/theme").mkdir(parents=True)
        (self.home / ".local/state/theme/flavour").write_text("not-a-flavour")
        self.run_review("-r", "main..HEAD")
        self.assertEqual(self.tuicr_runs()[-1][1], ["-r", "main..HEAD", "--stdout", "--no-update-check"])
        (self.home / ".local/state/theme/flavour").write_text("latte")
        self.run_review("-w", "--theme=nord-dark")
        self.assertEqual(self.tuicr_runs()[-1][1], ["-w", "--theme=nord-dark", "--stdout", "--no-update-check"])

    def test_check_reports_without_running_tuicr_or_sending(self):
        status, output = self.run_review("--check")
        self.assertEqual(status, 0)
        self.assertIn("agent  w1:p1 (pi, idle)", output)
        self.assertIn(f"cwd    {self.repo}", output)
        self.assertEqual(self.tuicr_runs(), [])
        self.assertEqual(self.prompts(), [])

    def test_missing_tuicr_names_the_install(self):
        self.env["HERDR_REVIEW_TUICR"] = str(self.root / "missing")
        self.env["HOME"] = str(self.root / "empty home")  # keep ~/.local/bin out of PATH
        with patch.object(module.shutil, "which", return_value=None):
            status, output = self.run_review("--check")
            self.assertEqual(status, 1)
            self.assertIn("brew install tuicr", output)
            self.assertEqual(self.run_review()[0], 1)
        self.assertIn("brew install tuicr", self.pause.call_args[0][0])

    def test_minimal_path_is_pinned(self):
        self.assertTrue(module.search_path({"HOME": "/h"}).startswith("/h/.local/bin:/opt/homebrew/bin:"))


def real_tuicr():
    candidate = os.environ.get("HERDR_REVIEW_TUICR_TEST_BIN") or shutil.which(
        "tuicr", path="/opt/homebrew/bin:/usr/local/bin")
    return candidate if candidate and os.access(candidate, os.X_OK) else None


@unittest.skipUnless(real_tuicr(), "tuicr not installed; set HERDR_REVIEW_TUICR_TEST_BIN")
class RealTuicrTests(unittest.TestCase):
    """Real tuicr in an own PTY; Herdr remains a fake."""

    def setUp(self):
        import pty  # noqa: F401  (POSIX only)
        temp = tempfile.TemporaryDirectory(prefix="herdr review tty ")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.home = self.root / "home"
        self.repo = self.root / "repo"
        self.home.mkdir()
        self.repo.mkdir()
        self.log = self.root / "log.jsonl"
        self.state_path = self.root / "state.json"
        herdr = self.root / "herdr"
        herdr.write_text(FAKE_HERDR)
        herdr.chmod(0o755)
        self.state_path.write_text(json.dumps({"agents": [
            {"pane_id": "w1:p1", "tab_id": "w1:t1", "agent": "pi", "cwd": str(self.repo)}]}))
        git_env = {"HOME": str(self.home), "PATH": "/usr/bin:/bin", "GIT_CONFIG_GLOBAL": os.devnull,
                   "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
                   "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}
        git = lambda *args: subprocess.run(["git", *args], cwd=self.repo, env=git_env, check=True, capture_output=True)
        git("init", "-q", "-b", "main")
        (self.repo / "a.py").write_text("x = 1\ny = 2\nz = 3\n")
        git("add", ".")
        git("commit", "-qm", "init")
        (self.repo / "a.py").write_text("x = 1\ny = 42\nz = 3\n")
        self.env = dict(git_env, TERM="xterm-256color", HERDR_BIN_PATH=str(herdr),
                        HERDR_REVIEW_TUICR=real_tuicr(), HERDR_ACTIVE_PANE_ID="w1:p1",
                        HERDR_ACTIVE_TAB_ID="w1:t1", FAKE_STATE=str(self.state_path),
                        FAKE_LOG=str(self.log))

    def drive(self, keys):
        import fcntl, pty, struct, termios
        pid, fd = pty.fork()
        if pid == 0:
            os.execve(sys.executable, [sys.executable, str(SOURCE)], self.env)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

        def pump(seconds):
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                if select.select([fd], [], [], 0.05)[0]:
                    try:
                        os.read(fd, 65536)
                    except OSError:
                        return

        pump(2.0)
        for key in keys:
            os.write(fd, key.encode())
            pump(0.4)
        end = time.monotonic() + 5
        while time.monotonic() < end:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                os.close(fd)
                return os.waitstatus_to_exitcode(status)
            pump(0.1)
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        os.close(fd)
        self.fail("herdr-review did not exit")

    def prompts(self):
        if not self.log.exists():
            return []
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return [args for _, args in calls if args[:2] == ["agent", "prompt"]]

    def test_comment_is_sent_once_and_cancel_sends_nothing(self):
        self.assertEqual(self.drive(["jjjj", "c", "Use a named constant", "\r", "ZZ"]), 0)
        [prompt] = self.prompts()
        self.assertEqual(prompt[2], "w1:p1")
        self.assertIn("`a.py:2` - Use a named constant", prompt[3])
        # Sent comments were cleared: saving again has nothing to send.
        self.assertEqual(self.drive(["ZZ"]), 0)
        self.assertEqual(len(self.prompts()), 1)
        # ZQ discards a new comment without sending it.
        self.assertEqual(self.drive(["jjjj", "c", "Discard me", "\r", "ZQ"]), 0)
        self.assertEqual(len(self.prompts()), 1)


if __name__ == "__main__":
    unittest.main()
