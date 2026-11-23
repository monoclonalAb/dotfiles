#!/usr/bin/env python3
"""Exercise the real account picker in its own Pi PTY using fake, local-only logins."""
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import signal
import struct
import subprocess
import tempfile
import termios
import time

SOURCE = Path(__file__).resolve().parent / "index.ts"
NODE = shutil.which("node")
NPM = shutil.which("npm")
assert NODE and NPM, "Requires the already installed Node and npm Pi"
PACKAGE = Path(subprocess.check_output([NPM, "root", "-g"], text=True).strip()) / "@earendil-works/pi-coding-agent"
ANSI = re.compile(rb"\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]")


def main(theme):
    with tempfile.TemporaryDirectory(prefix="pi-accounts-pty-", dir="/tmp") as temporary:
        root = Path(temporary).resolve()
        home = root / "home"
        agent = home / ".pi/agent"
        agent.mkdir(parents=True)
        (agent / "settings.json").write_text(json.dumps({
            "defaultProvider": "openai-codex", "defaultModel": "gpt-6-astra",
            "theme": theme, "quietStartup": True,
        }))
        expiry = int(time.time() * 1000) + 3_600_000
        credential = lambda name: {"type": "oauth", "access": f"synthetic-{name}",
                                   "refresh": f"synthetic-refresh-{name}", "expires": expiry, "accountId": name}
        original_auth = {"openai-codex": credential("work"), "openai-codex@main": credential("main")}
        auth = agent / "auth.json"
        auth.write_text(json.dumps(original_auth))
        auth.chmod(0o600)
        state = root / "state/pi/quota-router/state.json"
        state.parent.mkdir(parents=True)
        initial = {"providers": {"openai-codex": {"active": "work", "preferred": "main"}},
                   "cooldowns": {"openai-codex@main": {"until": expiry, "reason": "usage limit"}}}
        state.write_text(json.dumps(initial))
        unexpected = root / "unexpected-network"
        closed = root / "closed-dialogs"
        fixture = root / "fixture.ts"
        fixture.write_text(f"""
import {{ registerQuotaRouter }} from {json.dumps(str(SOURCE))};
import {{ appendFileSync, writeFileSync }} from 'node:fs';
export default function(pi) {{
  pi.on('ui_prompt_end', () => appendFileSync({json.dumps(str(closed))}, 'closed\\n'));
  globalThis.fetch = async () => {{
    writeFileSync({json.dumps(str(unexpected))}, 'unexpected network request');
    throw new Error('No network in the account picker smoke test');
  }};
  pi.on('before_provider_request', () => {{
    writeFileSync({json.dumps(str(unexpected))}, 'unexpected model request');
    throw new Error('No model request expected');
  }});
  registerQuotaRouter(pi);
}}
""")
        environment = {
            "HOME": str(home), "PATH": os.environ["PATH"], "TERM": "xterm-256color",
            "PI_CODING_AGENT_DIR": str(agent), "XDG_STATE_HOME": str(root / "state"),
            "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_SKIP_VERSION_CHECK": "1",
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
        }
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 80, 0, 0))
        child = subprocess.Popen([
            NODE, str(PACKAGE / "dist/cli.js"), "--no-extensions", "-e", str(fixture),
            "--no-skills", "--no-prompt-templates", "--no-themes", "--no-session", "--tui-mode", "fullscreen",
        ], cwd=root, env=environment, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()

        def wait_for(value, start=0):
            deadline = time.monotonic() + 20
            while value not in ANSI.sub(b"", bytes(output[start:])):
                assert time.monotonic() < deadline, f"Missing {value!r}: {output[-3000:]!r}"
                assert child.poll() is None, f"Pi exited: {output[-3000:]!r}"
                if select.select([master], [], [], 0.1)[0]:
                    output.extend(os.read(master, 65536))

        def send(value):
            start = len(output)
            os.write(master, value)
            return start

        def wait_closed(count):
            deadline = time.monotonic() + 10
            while not closed.exists() or len(closed.read_text().splitlines()) < count:
                assert time.monotonic() < deadline, "Escape did not dismiss the picker"
                if select.select([master], [], [], 0.05)[0]:
                    output.extend(os.read(master, 65536))

        try:
            wait_for(b"@work (main: main)")
            for count, columns in enumerate((50, 100, 80), 1):
                fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 30, columns, 0, 0))
                os.kill(child.pid, signal.SIGWINCH)
                start = send(b"/accounts\r")
                wait_for(b"Choose main account", start)
                wait_for(b"using now", start)
                send(b"\x1b")
                wait_closed(count)
                assert json.loads(state.read_text()) == initial, "Escape changed account preference"
            start = send(b"/accounts\r")
            wait_for(b"Choose main account", start)
            start = send(b"\r")  # Work is the first row: already active, but not yet main.
            wait_for(b"it is now main", start)
            assert json.loads(state.read_text())["providers"]["openai-codex"] == {"active": "work"}
            start = send(b"/accounts main main\r")
            wait_for(b"Staying on work", start)
            assert json.loads(state.read_text())["providers"]["openai-codex"] == {"active": "work", "preferred": "main"}
            assert json.loads(auth.read_text()) == original_auth, "Picker moved a cooling login or duplicated tokens"
            assert not unexpected.exists(), "Unexpected network access"
            assert not (agent / "sessions").exists(), "Account commands persisted model context"
            assert child.poll() is None
            print(f"PASS ({theme}): real fullscreen account picker at 50/80/100 columns; Escape is inert; choosing the active fallback changes main; a cooling main waits; no network or session persistence.")
        finally:
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
            os.close(master)


if __name__ == "__main__":
    for theme in ("dark", "light"):
        main(theme)
