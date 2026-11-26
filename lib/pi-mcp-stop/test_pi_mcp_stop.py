"""pi-mcp-stop against real process trees and a fake herdr-core; never touches live sessions.

Each fake session is a shell running a Node process that names itself `pi` and
spawns its servers as Pi does (detached, through the wrapper commands in an
isolated HOME's mcp.json and the project's .pi/mcp.json).
"""

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

COMMAND = Path(__file__).resolve().parents[2] / "bin" / "pi-mcp-stop"
NODE = shutil.which("node")

FAKE_HERDR = r'''#!/usr/bin/python3
import json, os, sys
state = json.load(open(os.environ["FAKE_HERDR_STATE"]))
if sys.argv[1] == "ls":
    print(json.dumps({"terminals": [
        {"address": a, "agent": "pi", "status": t["ls"], "where": a, "state": "live"}
        for a, t in state.items()]}))
elif sys.argv[1] == "get":
    t = state[sys.argv[2]]
    print(json.dumps({"address": sys.argv[2], "pid": t["shell"],
                      "status": {"app": "pi", "state": t["get"]}}))
'''

# Spawns each [command, ...args] detached with piped stdio, as Pi's stdio
# transport does, plus one child that is not detached, then reports the pids.
FAKE_PI = r'''
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
process.title = "pi";
const [out, ...specs] = process.argv.slice(2);
const pids = {};
for (const spec of specs) {
  const [key, detached, ...argv] = JSON.parse(spec);
  const child = spawn(argv[0], argv.slice(1), { detached: detached === "detached", stdio: "pipe" });
  pids[key] = child.pid;
}
setTimeout(() => writeFileSync(out, JSON.stringify(pids)), 300);
setInterval(() => {}, 1000);
'''

# A server that also starts a child in its own process group, as `npx` did.
SERVER = r'''
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const helper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(process.env.HELPER_PID_FILE + "." + process.pid, String(helper.pid));
process.stdin.resume();
'''

IDLE = "setInterval(() => {}, 1000)"


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # A killed child stays a zombie until its parent reaps it.
    state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout
    return bool(state.strip()) and not state.strip().startswith("Z")


def wait_until(predicate, seconds=5):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.1)
    return predicate()


@unittest.skipUnless(NODE, "needs node")
class PiMcpStopTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        herdr = bin_dir / "herdr-core"
        herdr.write_text(FAKE_HERDR)
        herdr.chmod(0o755)
        self.state_file = self.tmp / "herdr.json"
        self.state = {}
        self.env = {**os.environ, "HOME": str(self.home), "PATH": f"{bin_dir}:{os.environ['PATH']}",
                    "FAKE_HERDR_STATE": str(self.state_file), "HELPER_PID_FILE": str(self.tmp / "helper")}
        # Wrappers like the real ones: hark-mcp runs .../hark-mcp/server.mjs, and
        # npm-mcp turns its package argument into the path of the package's server.
        self.wrapper("hark-mcp", f'exec "{NODE}" "$HOME/apps/hark-mcp/server.mjs" "$@"', "apps/hark-mcp")
        self.wrapper("npm-mcp", f'spec=$1; shift; exec "{NODE}" "$HOME/.local/share/npm-mcp/$spec/bin/server.mjs" "$@"',
                     ".local/share/npm-mcp/@scope/gcloud-mcp@1.0.0/bin")
        self.wrapper("project-mcp", f'exec "{NODE}" "$HOME/apps/project-mcp/server.mjs" "$@"', "apps/project-mcp")
        self.write_json(self.home / ".pi" / "agent" / "mcp.json", {"mcpServers": {
            "hark": {"command": "~/.local/bin/hark-mcp"},
            "gcloud": {"command": "~/.local/bin/npm-mcp", "args": ["@scope/gcloud-mcp@1.0.0", "-c", "~/allow.json"]},
            "remote": {"url": "http://127.0.0.1:1/mcp"},
        }})
        self.project = self.tmp / "project"
        self.write_json(self.project / ".pi" / "mcp.json", {"mcpServers": {
            "project": {"command": "~/.local/bin/project-mcp", "args": ["serve"]},
        }})

    def wrapper(self, name, body, server_dir):
        path = self.home / ".local" / "bin" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"#!/bin/sh\n{body}\n")
        path.chmod(0o755)
        server = self.home / server_dir / "server.mjs"
        server.parent.mkdir(parents=True, exist_ok=True)
        server.write_text(SERVER)

    def write_json(self, path, data):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))

    def session(self, address, ls_status, get_status=None):
        """Start a shell running a fake Pi with its servers and two other children."""
        bin_dir = self.home / ".local" / "bin"
        specs = [
            ["hark", "detached", str(bin_dir / "hark-mcp")],
            ["gcloud", "detached", str(bin_dir / "npm-mcp"), "@scope/gcloud-mcp@1.0.0", "-c", str(self.home / "allow.json")],
            ["project", "detached", str(bin_dir / "project-mcp"), "serve"],
            # A detached child that is no configured server, as a bash tool command is.
            ["other_detached", "detached", NODE, str(self.home / "apps" / "hark-mcp" / "server.mjs"), "--other"],
            # A child in Pi's own group, as an extension's helper process is.
            ["attached", "attached", NODE, "-e", IDLE],
        ]
        pi_script = self.tmp / "fake-pi.mjs"
        pi_script.write_text(FAKE_PI)
        out = self.tmp / f"{address}.pids"
        shell = subprocess.Popen(
            ["/bin/sh", "-c", 'node "$@"; :', "sh", str(pi_script), str(out), *map(json.dumps, specs)],
            cwd=self.project, env=self.env, start_new_session=True)
        self.addCleanup(self.kill_tree, shell, out)
        self.assertTrue(wait_until(lambda: out.exists() and out.read_text()), "fake Pi did not start")
        pids = json.loads(out.read_text())
        pi = int(subprocess.check_output(["pgrep", "-P", str(shell.pid)]).split()[0])
        helpers = {}
        for key in ("hark", "gcloud", "project"):
            helper = Path(f"{self.env['HELPER_PID_FILE']}.{pids[key]}")
            self.assertTrue(wait_until(helper.exists), f"{key} did not start its helper")
            helpers[key] = int(helper.read_text())
        self.state[address] = {"shell": shell.pid, "ls": ls_status, "get": get_status or ls_status}
        self.state_file.write_text(json.dumps(self.state))
        return dict(pi=pi, **pids, **{f"{key}_helper": pid for key, pid in helpers.items()})

    def kill_tree(self, shell, out):
        pids = json.loads(out.read_text()) if out.exists() and out.read_text() else {}
        for pid in [shell.pid, *pids.values()]:
            try:
                os.killpg(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        shell.wait()

    def run_command(self, *args):
        return subprocess.run([sys.executable, str(COMMAND), *args], env=self.env,
                              capture_output=True, text=True, check=True).stdout

    SERVERS = ("hark", "hark_helper", "gcloud", "gcloud_helper", "project", "project_helper")

    def test_stops_every_server_group_of_done_and_idle_sessions_and_nothing_else(self):
        done = self.session("t1", "done")
        idle = self.session("t2", "idle")
        output = self.run_command()
        for session in (done, idle):
            for key in self.SERVERS:
                self.assertTrue(wait_until(lambda: not alive(session[key])), f"{key} still running")
            for key in ("pi", "other_detached", "attached"):
                self.assertTrue(alive(session[key]), f"{key} was stopped")
        self.assertIn("Stopped 6 MCP servers in 2 sessions.", output)

    def test_leaves_working_sessions_alone(self):
        working = self.session("t1", "working")
        output = self.run_command()
        time.sleep(0.5)
        for key in self.SERVERS:
            self.assertTrue(alive(working[key]), f"{key} was stopped")
        self.assertIn("Stopped 0 MCP servers in 0 sessions.", output)

    def test_rereads_the_status_and_skips_a_session_that_started_working(self):
        session = self.session("t1", "done", get_status="working")
        self.run_command()
        time.sleep(0.5)
        for key in self.SERVERS:
            self.assertTrue(alive(session[key]), f"{key} was stopped")

    def test_named_terminals_limit_it_to_those_sessions(self):
        named = self.session("t1", "done")
        other = self.session("t2", "done")
        working = self.session("t3", "working")
        output = self.run_command("t1", "t3", "t9")
        for key in self.SERVERS:
            self.assertTrue(wait_until(lambda: not alive(named[key])), f"{key} still running")
        for session in (other, working):
            for key in self.SERVERS:
                self.assertTrue(alive(session[key]), f"{key} was stopped")
        self.assertIn("t3\tskipped: working", output)
        self.assertIn("t9\tskipped: no such terminal", output)
        self.assertIn("Stopped 3 MCP servers in 1 sessions.", output)

    def test_dry_run_lists_without_stopping(self):
        session = self.session("t1", "done")
        output = self.run_command("--dry-run")
        time.sleep(0.5)
        for key in self.SERVERS:
            self.assertTrue(alive(session[key]), f"{key} was stopped")
        self.assertIn("would stop 3", output)
        self.assertIn("Would stop 3 MCP servers in 1 sessions.", output)


if __name__ == "__main__":
    unittest.main()
