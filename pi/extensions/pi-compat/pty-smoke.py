#!/usr/bin/env python3
"""Fullscreen Pi in its own PTY with an isolated HOME and the pi-compat extension linked
in as dotfiles-link deploys it.

1. No result for the installed Pi: the extension starts the real bin/pi-compat-check
   (with one quick fixture suite instead of the real ones), the footer shows
   "checking Pi <version>", and the pass is announced when it exits.
2. A saved failing result: a new Pi shows the failure in the footer and names the
   affected workflow once.

No model request, real state, session file or other-pane input. Requires the
installed npm Pi and Node; uses only Python's stdlib.
"""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time

SOURCE = Path(__file__).resolve().parent / "index.ts"
NODE = shutil.which("node")
assert NODE, "Node must already be installed"
NPM = shutil.which("npm")
assert NPM, "npm must already be installed"
PACKAGE = Path(subprocess.check_output([NPM, "root", "-g"], text=True).strip()) / "@earendil-works/pi-coding-agent"
VERSION = json.loads((PACKAGE / "package.json").read_text())["version"]
ANSI = re.compile(rb"\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]")


def run_pi(base, home, env, steps):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 180, 0, 0))
    child = subprocess.Popen([
        NODE, str(PACKAGE / "dist/cli.js"), "--no-skills", "--no-prompt-templates", "--no-themes",
        "--no-session", "--tui-mode", "fullscreen",
    ], cwd=base, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    output = bytearray()

    def wait_for(text, seconds=30):
        deadline = time.monotonic() + seconds
        while text.encode() not in ANSI.sub(b"", bytes(output)):
            assert child.poll() is None, f"Pi exited: {bytes(output[-2000:])!r}"
            assert time.monotonic() < deadline, f"Timed out waiting for {text!r}: {ANSI.sub(b'', bytes(output[-3000:]))!r}"
            if select.select([master], [], [], 0.1)[0]:
                output.extend(os.read(master, 65536))

    try:
        steps(wait_for)
        return ANSI.sub(b"", bytes(output)).decode(errors="replace")
    finally:
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)
        os.close(master)


def main():
    with tempfile.TemporaryDirectory(prefix="pi-compat-pty-", dir="/tmp") as temp:
        base = Path(temp).resolve()
        home = base / "home"
        agent = home / ".pi/agent"
        (agent / "extensions/pi-compat").mkdir(parents=True)
        (agent / "extensions/pi-compat/index.ts").symlink_to(SOURCE)
        (agent / "settings.json").write_text(json.dumps({"defaultProvider": "compat-test", "defaultModel": "fixture"}))
        (agent / "models.json").write_text(json.dumps({"providers": {"compat-test": {
            "baseUrl": "http://127.0.0.1:1/v1", "api": "openai-completions", "apiKey": "synthetic-only",
            "models": [{"id": "fixture", "reasoning": False}],
        }}}))
        ran = base / "suite-ran"
        suites = base / "suites.json"
        # Long enough to see "checking" in the footer before it passes.
        suites.write_text(json.dumps([{"name": "fixture", "workflow": "Fixture workflow",
                                       "command": f"sleep 2; touch {ran}"}]))
        state = home / ".local/state/pi/compat"
        env = {
            "HOME": str(home), "PATH": os.environ["PATH"], "TERM": "xterm-256color",
            "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_SKIP_VERSION_CHECK": "1",
            "PI_COMPAT_SUITES": str(suites),  # inherited by the check the extension starts
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
        }

        def first(wait_for):
            wait_for(f"checking Pi {VERSION}")
            wait_for(f"Pi {VERSION} passed all 1 extension checks.")
        run_pi(base, home, env, first)
        assert ran.exists(), "The background check did not run the suite"
        result = json.loads((state / VERSION / "result.json").read_text())
        assert result["passed"] and result["version"] == VERSION, result
        assert not (state / "running.json").exists(), "The check left its lock behind"

        result["passed"] = False
        result["suites"][0]["status"] = "fail"
        (state / VERSION / "result.json").write_text(json.dumps(result))
        ran.unlink()

        def second(wait_for):
            wait_for(f"Pi {VERSION}: 1 check failed")
            wait_for("Affected: Fixture workflow. Details and logs: pi-compat-check --status")
        screen = run_pi(base, home, env, second)
        assert not ran.exists(), "A saved result must not start another check"
        assert "checking Pi" not in screen
        assert not (agent / "sessions").exists(), "Unexpected session persistence"
        print(f"PASS: fullscreen Pi {VERSION} with the linked extension starts the real check in the background, "
              "shows it running and announces the pass; a saved failure shows in the footer with the affected "
              "workflow; no second run, model request or session file.")


if __name__ == "__main__":
    main()
