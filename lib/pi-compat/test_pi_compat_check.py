"""Tests for bin/pi-compat-check with fake suites, a fake npm Pi and a temporary state folder."""

import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile
import time
import unittest

SCRIPT = Path(__file__).resolve().parents[2] / "bin" / "pi-compat-check"


class PiCompatCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.state = self.tmp / "state"
        self.npm_root = self.tmp / "node_modules"
        self.set_version("1.7.0")
        fake_bin = self.tmp / "bin"
        fake_bin.mkdir()
        (fake_bin / "npm").write_text(f'#!/bin/sh\nprintf "%s\\n" "{self.npm_root}"\n')
        (fake_bin / "npm").chmod(0o755)
        self.marks = self.tmp / "marks"
        self.marks.mkdir()
        self.suites_file = self.tmp / "suites.json"
        self.env = {"HOME": str(self.tmp / "home"), "PATH": f"{fake_bin}:/usr/bin:/bin",
                    "PI_COMPAT_STATE": str(self.state), "PI_COMPAT_SUITES": str(self.suites_file)}

    def set_version(self, version):
        package = self.npm_root / "@earendil-works" / "pi-coding-agent"
        package.mkdir(parents=True, exist_ok=True)
        (package / "package.json").write_text(json.dumps({"name": "@earendil-works/pi-coding-agent", "version": version}))

    def set_suites(self, *suites):
        self.suites_file.write_text(json.dumps([
            {"name": name, "workflow": workflow, "command": command} for name, workflow, command in suites]))

    def run_check(self, *args, **env):
        return subprocess.run([str(SCRIPT), *args], capture_output=True, text=True,
                              env={**self.env, **env}, timeout=60)

    def result(self, version="1.7.0"):
        return json.loads((self.state / version / "result.json").read_text())

    def test_failing_suite_is_recorded_with_its_log_and_reported(self):
        self.set_suites(("ok", "Fine workflow", f"touch {self.marks}/ok; echo all good"),
                        ("broken", "Account switching", "echo expected 2 got 3; exit 4"))
        done = self.run_check()
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("1 of 2 checks failed. Affected: Account switching.", done.stdout)
        result = self.result()
        self.assertFalse(result["passed"])
        self.assertEqual([(s["name"], s["status"], s["exit"]) for s in result["suites"]],
                         [("ok", "pass", 0), ("broken", "fail", 4)])
        self.assertIn("expected 2 got 3", Path(result["suites"][1]["log"]).read_text())
        self.assertTrue((self.marks / "ok").exists())
        self.assertFalse((self.state / "running.json").exists())

        status = self.run_check("--status")
        self.assertEqual(status.returncode, 1)
        self.assertIn("FAIL    broken (Account switching)", status.stdout)
        self.assertIn(result["suites"][1]["log"], status.stdout)
        self.assertNotIn("FAIL    ok", status.stdout)

    def test_if_new_runs_once_per_installed_version(self):
        self.set_suites(("count", "Counter", f"echo run >> {self.marks}/runs"))
        self.assertEqual(self.run_check("--if-new").returncode, 0)
        self.assertEqual(self.run_check("--if-new").returncode, 0)
        self.assertEqual((self.marks / "runs").read_text(), "run\n")
        self.assertTrue(self.result()["passed"])

        self.set_version("1.7.1")
        self.assertEqual(self.run_check("--if-new").returncode, 0)
        self.assertEqual((self.marks / "runs").read_text(), "run\nrun\n")
        self.assertEqual(self.result("1.7.1")["version"], "1.7.1")
        # Without --if-new it always runs again.
        self.assertEqual(self.run_check().returncode, 0)
        self.assertEqual((self.marks / "runs").read_text().count("run"), 3)

    def test_status_without_a_result(self):
        self.set_suites()
        done = self.run_check("--status")
        self.assertEqual(done.returncode, 3)
        self.assertIn("No check has run for the installed Pi 1.7.0", done.stdout)

    def test_a_live_check_blocks_others_and_a_dead_one_is_replaced(self):
        self.set_suites(("count", "Counter", f"echo run >> {self.marks}/runs"))
        self.state.mkdir()
        sleeper = subprocess.Popen(["sleep", "30"])
        self.addCleanup(sleeper.kill)
        (self.state / "running.json").write_text(json.dumps({"pid": sleeper.pid, "version": "1.7.0"}))

        self.assertEqual(self.run_check("--if-new").returncode, 0)
        busy = self.run_check()
        self.assertEqual(busy.returncode, 2)
        self.assertIn("already running", busy.stderr)
        self.assertIn("is running", self.run_check("--status").stdout)
        self.assertFalse((self.marks / "runs").exists())

        sleeper.kill()
        sleeper.wait()
        self.assertEqual(self.run_check("--if-new").returncode, 0)
        self.assertEqual((self.marks / "runs").read_text(), "run\n")
        self.assertFalse((self.state / "running.json").exists())

    def test_timeout_stops_the_suite_and_everything_it_started(self):
        pid_file = self.marks / "child.pid"
        self.set_suites(("hang", "Hanging workflow", f"sleep 60 & echo $! > {pid_file}; wait"))
        done = self.run_check(PI_COMPAT_TIMEOUT="1")
        self.assertEqual(done.returncode, 1)
        suite = self.result()["suites"][0]
        self.assertEqual((suite["status"], suite["exit"]), ("timeout", None))
        self.assertIn("stopped after 1s", Path(suite["log"]).read_text())
        child = int(pid_file.read_text())
        time.sleep(0.2)
        with self.assertRaises(ProcessLookupError):
            os.kill(child, 0)

    def test_terminating_a_check_stops_its_suite_and_releases_the_lock(self):
        pid_file = self.marks / "child.pid"
        self.set_suites(("hang", "Hanging workflow", f"sleep 60 & echo $! > {pid_file}; wait"))
        check = subprocess.Popen([str(SCRIPT)], env=self.env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 10
        while not pid_file.exists() or not pid_file.read_text().strip():
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.05)
        self.assertTrue((self.state / "running.json").exists())
        check.send_signal(signal.SIGTERM)
        self.assertEqual(check.wait(timeout=10), 128 + signal.SIGTERM)
        self.assertFalse((self.state / "running.json").exists())
        time.sleep(0.2)
        with self.assertRaises(ProcessLookupError):
            os.kill(int(pid_file.read_text()), 0)
        self.assertFalse((self.state / "1.7.0" / "result.json").exists())

    def test_missing_pi_is_an_error(self):
        self.set_suites()
        shutil.rmtree(self.npm_root)
        done = self.run_check("--if-new")
        self.assertEqual(done.returncode, 2)
        self.assertIn("cannot find the installed npm Pi", done.stderr)

    def test_real_suite_list_names_existing_files(self):
        """Every path in the built-in commands exists, so a rename cannot silently skip a suite."""
        repo = SCRIPT.parents[1]
        source = SCRIPT.read_text()
        start = source.index("SUITES = [")
        listed = source[start:source.index("\n]\n", start)]
        paths = re.findall(r"(?<![\w/])\.?/?((?:pi|herdr)/[^\s\"')]+)", listed)
        self.assertGreaterEqual(len(paths), 19)
        for path in paths:
            with self.subTest(path=path):
                self.assertTrue(list(repo.glob(path)), path)


if __name__ == "__main__":
    unittest.main()
