#!/usr/bin/env python3
"""Own-PTY smoke test: isolated HOME, temporary Git repo, fake Herdr and fake Pi.

Never contacts a live Herdr socket, reads user credentials/sessions, or starts a
model. Requires the already installed Node/Pi libraries and Python 3.11+.
"""
import fcntl
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import pty
import select
import shutil
import socket
import struct
import subprocess
import tempfile
import termios
import threading
import time
import tomllib

ROOT = Path(__file__).resolve().parent
NODE = shutil.which("node")
assert NODE, "Node must already be installed"


def popup_task_id(requests):
    return next(r["params"]["env"]["HERDR_TASK_ID"] for r in requests if r["params"].get("entrypoint") == "pi")


def hangup_check(env, pi_command, state, checkout, source, fake_pi):
    """Closing a Pi tab's terminal (as Herdr does) must remove its task files."""
    task_id = "0f0f0f0f-0000-4000-8000-000000000001"
    requests = state / "requests"
    requests.mkdir(mode=0o700, exist_ok=True)
    request = requests / f"{task_id}.json"
    request.write_text(json.dumps({"cwd": str(checkout), "root": str(source), "prompt": "long task", "thinking": "off",
                                   "sessionId": task_id, "model": {"provider": "task-test", "id": "reasoner", "levels": ["off"]}}))
    request.chmod(0o600)
    pi_pid = state / "fake-pi.pid"
    fake_pi.write_text(f"#!{NODE}\nrequire('node:fs').writeFileSync({json.dumps(str(pi_pid))}, String(process.pid));\nsetTimeout(() => {{}}, 60000);\n")
    master, slave = pty.openpty()
    child = subprocess.Popen(pi_command, cwd=checkout, env={**env, "HERDR_TASK_ID": task_id}, stdin=slave, stdout=slave,
                             stderr=slave, start_new_session=True)
    os.close(slave)
    try:
        deadline = time.monotonic() + 20
        while not (pi_pid.exists() and (requests / f"{task_id}.runner").exists()):
            assert time.monotonic() < deadline, "Fake Pi did not start"
            if select.select([master], [], [], 0.1)[0]:
                os.read(master, 65536)
        os.close(master)  # The tab closes: the kernel hangs up its processes.
        master = None
        child.wait(timeout=20)
        assert not request.exists(), "Closed tab left its task request"
        assert not (requests / f"{task_id}.runner").exists(), "Closed tab left its runner file"
        try:
            os.kill(int(pi_pid.read_text()), 0)
            raise AssertionError("Pi kept running after its tab closed")
        except ProcessLookupError:
            pass
    finally:
        if master is not None:
            os.close(master)
        if child.poll() is None:
            child.kill()
            child.wait()


def run_smoke():
    with tempfile.TemporaryDirectory(prefix="pi-task-pty-", dir="/tmp") as temporary:
        base = Path(temporary).resolve()
        home = base / "home"
        source = base / "website"
        checkout = base / "task"
        state = base / "state"
        capture = base / "pi-argv.json"
        agent = home / ".pi/agent"
        agent.mkdir(parents=True)
        (home / ".local/bin").mkdir(parents=True)
        source.mkdir()
        env = {
            "HOME": str(home), "PATH": os.environ["PATH"], "TERM": "xterm-256color",
            "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": "/dev/null", "HERDR_PLUGIN_ROOT": str(ROOT),
            "HERDR_PLUGIN_STATE_DIR": str(state), "HERDR_SOCKET_PATH": str(base / "socket"),
            "HERDR_PLUGIN_CONTEXT_JSON": json.dumps({"workspace_id": "source", "focused_pane_cwd": str(source), "selected_text": "must-not-propagate"}),
        }

        def git(cwd, *args):
            return subprocess.check_output(["git", "-c", "core.hooksPath=/dev/null", "-C", str(cwd), *args], env=env, stderr=subprocess.PIPE)

        git(source, "init", "-b", "main")
        (source / "README.md").write_text("base\n")
        git(source, "add", "README.md")
        git(source, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture")
        (source / "README.md").write_text("uncommitted user's work\n")
        naming_calls = []

        class NamingHandler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                naming_calls.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                chunk = {"id": "title-test", "object": "chat.completion.chunk", "created": 1,
                         "model": "reasoner", "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Implement keyboard controls"}, "finish_reason": None}]}
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\n").encode())
                chunk["choices"] = [{"index": 0, "delta": {}, "finish_reason": "stop"}]
                self.wfile.write(("data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n").encode())

        naming_server = ThreadingHTTPServer(("127.0.0.1", 0), NamingHandler)
        naming_thread = threading.Thread(target=naming_server.serve_forever, daemon=True)
        naming_thread.start()
        (agent / "models.json").write_text(json.dumps({"providers": {"task-test": {
            "baseUrl": f"http://127.0.0.1:{naming_server.server_port}/v1", "api": "openai-completions", "apiKey": "test-only",
            "models": [{"id": "reasoner", "reasoning": True}],
        }}}))
        (agent / "settings.json").write_text(json.dumps({"defaultProvider": "task-test", "defaultModel": "reasoner", "defaultThinkingLevel": "high"}))
        fake_pi = home / ".local/bin/pi"
        fake_pi.write_text(f"#!{NODE}\nrequire('node:fs').writeFileSync({json.dumps(str(capture))},JSON.stringify({{args:process.argv.slice(2),cwd:process.cwd(),pane:process.env.HERDR_PANE_ID}}));\n")
        fake_pi.chmod(0o700)
        manifest = tomllib.loads((ROOT / "herdr-plugin.toml").read_text())
        pi_command = next(pane["command"] for pane in manifest["panes"] if pane["id"] == "pi")
        launcher_command = next(pane["command"] for pane in manifest["panes"] if pane["id"] == "launcher")
        config = tomllib.loads((ROOT / "../../config.base.toml").resolve().read_text())
        bindings = [item for item in config["keys"]["command"] if item["command"] == manifest["id"] + ".open"]
        assert len(bindings) == 1 and bindings[0]["key"] == "prefix+t"
        requests, errors, popup_env, tabs = [], [], {}, []
        runner_done = threading.Event()
        service = socket.socket(socket.AF_UNIX)
        service.bind(env["HERDR_SOCKET_PATH"])
        service.listen()
        service.settimeout(0.1)
        stopping = threading.Event()

        def serve():
            while not stopping.is_set():
                try:
                    connection, _ = service.accept()
                except socket.timeout:
                    continue
                try:
                    with connection:
                        line = connection.makefile("rb").readline()
                        request = json.loads(line)
                        requests.append(request)
                        params = request["params"]
                        if request["method"] == "worktree.create":
                            git(params["cwd"], "worktree", "add", "-b", params["branch"], str(checkout), params["base"])
                            tabs.append({"tab_id": "shell-tab", "pane_count": 1})
                            result = {"type": "worktree_created", "workspace": {"workspace_id": "task", "active_tab_id": "shell-tab", "tab_count": 1}, "worktree": {"path": str(checkout)}}
                        elif request["method"] == "tab.list":
                            assert params == {"workspace_id": "task"}
                            result = {"type": "tab_list", "tabs": tabs}
                        elif request["method"] == "tab.close":
                            assert params == {"tab_id": "shell-tab"}
                            assert any(tab["tab_id"] == "pi-tab" for tab in tabs)
                            tabs[:] = [tab for tab in tabs if tab["tab_id"] != "shell-tab"]
                            result = {"type": "ok"}
                        elif params["entrypoint"] == "launcher":
                            popup_env.update(params["env"])
                            result = {"type": "ok"}
                        else:
                            assert params["entrypoint"] == "pi" and params["focus"] is True
                            tabs.append({"tab_id": "pi-tab", "pane_count": 1, "focused": True})
                            result = {"type": "plugin_pane_opened", "plugin_pane": {"pane": {"pane_id": "new-pi", "tab_id": "pi-tab"}}}
                        connection.sendall((json.dumps({"id": request["id"], "result": result}) + "\n").encode())
                    if params.get("entrypoint") == "pi":
                        subprocess.run(pi_command, cwd=params["cwd"], env={**env, **params["env"], "HERDR_PANE_ID": "new-pi"}, check=True, timeout=20, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                        runner_done.set()
                except Exception as error:
                    errors.append(error)
                    runner_done.set()

        thread = threading.Thread(target=serve)
        thread.start()
        try:
            # Exercise the actual action caller, then supply its captured context
            # to the popup that this fake server simulates below.
            subprocess.run(["/bin/sh", str(ROOT / "launch.sh"), "open"], cwd=ROOT, env=env, check=True, timeout=20)
            assert "must-not-propagate" not in json.dumps(popup_env)
            for submit in (False, True):
                master, slave = pty.openpty()
                fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 22, 76, 0, 0))
                child = subprocess.Popen(launcher_command, cwd=ROOT, env={**env, **popup_env}, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
                os.close(slave)
                output = bytearray()

                def wait_for(text, start=0):
                    deadline = time.monotonic() + 20
                    while text not in output[start:]:
                        assert time.monotonic() < deadline, f"Timed out waiting for {text!r}: {output[-2000:]!r}"
                        if select.select([master], [], [], 0.1)[0]:
                            output.extend(os.read(master, 65536))

                try:
                    wait_for(b"Pi task")
                    wait_for(b"options")  # Key hints for the focused task editor.
                    assert b"PI TASKS" not in output, "Unexpected intermediate menu"
                    draft = b"Add keyboard navigation; $(false)\nKeep the second line"
                    if not submit:
                        # Ctrl+C on an empty draft: nothing reaches the real clipboard.
                        start = len(output)
                        os.write(master, b"\x03")
                        wait_for(b"Draft cleared", start)
                        assert child.poll() is None, "First Ctrl+C closed the popup"
                        os.write(master, draft)  # LF is Ctrl+J, not submit.
                    else:
                        wait_for(b"Restored your unsent draft")  # Saved by the Esc run below.
                    wait_for(b"second line")
                    start = len(output)
                    os.write(master, b"\x1b[Z")
                    wait_for(b"Thinking: off", start)
                    start = len(output)
                    os.write(master, b"\x0c")
                    wait_for(b"choose model", start)
                    start = len(output)
                    os.write(master, b"\x1b")
                    wait_for(b"options", start)
                    os.write(master, b"\r" if submit else b"\x1b")
                    deadline = time.monotonic() + 20
                    while child.poll() is None:
                        assert time.monotonic() < deadline, f"Popup did not close: {output[-2000:]!r}"
                        if select.select([master], [], [], 0.1)[0]:
                            try:
                                output.extend(os.read(master, 65536))
                            except OSError:
                                break
                    assert child.wait(timeout=5) == 0, output[-2000:]
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait()
                    os.close(master)
                if not submit:
                    assert len(requests) == 1, "Cancellation sent a mutation"
                    assert sorted(path.name for path in state.iterdir()) == ["drafts"] and not checkout.exists()
                    saved = json.loads(next((state / "drafts").glob("*.json")).read_text())
                    assert saved["text"] == draft.decode(), saved
                    assert (next((state / "drafts").glob("*.json")).stat().st_mode & 0o777) == 0o600
                    assert not naming_calls, "Cancellation sent a naming request"
            assert runner_done.wait(20), "Pi runner did not complete"
            assert not errors, errors
            result = json.loads(capture.read_text())
            assert result["cwd"] == str(checkout) and result["pane"] == "new-pi"
            assert result["args"][-2:] == ["--", "Add keyboard navigation; $(false)\nKeep the second line"]
            assert result["args"][result["args"].index("--model") + 1] == "reasoner"
            assert result["args"][result["args"].index("--thinking") + 1] == "off"
            assert result["args"][result["args"].index("--name") + 1] == "implement keyboard controls"
            assert result["args"][result["args"].index("--session-id") + 1] == popup_task_id(requests)
            assert "--approve" not in result["args"] and "--tui-mode" not in result["args"]
            assert len(naming_calls) == 1
            assert naming_calls[0]["model"] == "reasoner"
            assert not naming_calls[0].get("tools")
            assert naming_calls[0]["messages"][-1]["content"] == result["args"][-1]
            created = next(r["params"] for r in requests if r["method"] == "worktree.create")
            assert created["branch"] == "task/implement-keyboard-controls"
            assert created["label"] == "implement keyboard controls"
            assert requests[-1]["method"] == "tab.list"
            assert tabs == [{"tab_id": "pi-tab", "pane_count": 1, "focused": True}]
            assert [r["params"] for r in requests if r["method"] == "tab.close"] == [{"tab_id": "shell-tab"}]
            assert (source / "README.md").read_text() == "uncommitted user's work\n"
            assert (checkout / "README.md").read_text() == "base\n"
            assert len(list((state / "preferences").glob("*.json"))) == 1
            assert not list((state / "drafts").glob("*.json")), "A started task left its draft behind"
            assert len(list((state / "history").glob("*.json"))) == 1
            assert not list((state / "requests").iterdir()), "Normal Pi exit left task files behind"
            hangup_check(env, pi_command, state, checkout, source, fake_pi)
            print("Passed: direct form → Esc keeps draft → reopen restores it → loopback task summary → named worktree → exactly one focused fake Pi tab with its session ID; literal prompt, shortcuts, cleanup and closed-tab hangup verified.")
        finally:
            stopping.set()
            thread.join(timeout=25)
            service.close()
            naming_server.shutdown()
            naming_server.server_close()
            naming_thread.join(timeout=5)


if __name__ == "__main__":
    run_smoke()
