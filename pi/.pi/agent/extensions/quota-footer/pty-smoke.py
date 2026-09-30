#!/usr/bin/env python3
"""Own-PTY Pi footer journey with synthetic quotas and an isolated HOME.

No provider access, real credentials, existing sessions, or other-pane input.
Requires the already installed npm Pi and Node; uses only Python's stdlib.
"""
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

ROOT = Path(__file__).resolve().parent
NODE = shutil.which("node")
assert NODE, "Node must already be installed"
NPM = shutil.which("npm")
assert NPM, "npm must already be installed"
PACKAGE = Path(subprocess.check_output([NPM, "root", "-g"], text=True).strip()) / "@earendil-works/pi-coding-agent"
ANSI = re.compile(rb"\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]")
QUOTA_VALUES = "31% | 14% · 0%".encode()
MCP_STATUS = "MCP: 0/2".encode()
MCP_EDITED = "MCP: 1/2".encode()
SUMMARY = "Context: AGENTS.md · Extensions: 1 · ctrl+o".encode()


def main(theme):
    with tempfile.TemporaryDirectory(prefix="pi-quota-pty-", dir="/tmp") as temp:
        base = Path(temp).resolve()
        home = base / "home"
        agent = home / ".pi/agent"
        agent.mkdir(parents=True)
        (agent / "settings.json").write_text(json.dumps({
            "defaultProvider": "quota-test", "defaultModel": "fixture", "theme": theme,
            "quietStartup": True,
        }))
        (base / "AGENTS.md").write_text("Synthetic context; no secrets.\n")
        # Native MCP config; --no-extensions leaves builtin:mcp unloaded, so nothing connects.
        mcp_config = agent / "mcp.json"
        mcp_servers = {
            "stdio": {"command": "false", "enabled": False},
            "http": {"url": "http://127.0.0.1:1/mcp", "enabled": False},
        }
        mcp_config.write_text(json.dumps({"mcpServers": mcp_servers}))
        (agent / "models.json").write_text(json.dumps({"providers": {"quota-test": {
            "baseUrl": "http://127.0.0.1:1/v1", "api": "openai-completions", "apiKey": "synthetic-only",
            "models": [{"id": "fixture", "reasoning": False}],
        }}}))
        fixture = base / "fixture.ts"
        network_marker = base / "unexpected-request"
        clock = base / "clock"
        requests = base / "quota-requests"
        initial_time = int(time.time() * 1000)
        clock.write_text(str(initial_time))
        fixture.write_text(f"""
import {{ createQuotaReader }} from {json.dumps(str(ROOT / 'quota.ts'))};
import {{ registerQuotaFooter }} from {json.dumps(str(ROOT / 'index.ts'))};
import {{ ACCOUNTS_CHANGED_EVENT }} from {json.dumps(str(ROOT.parent / 'quota-router' / 'accounts.ts'))};
import {{ registerCompactUi }} from {json.dumps(str(ROOT.parent / 'compact-ui' / 'index.ts'))};
import {{ appendFileSync, readFileSync, writeFileSync }} from 'node:fs';
export default function(pi) {{
  registerCompactUi(pi);
  pi.on('before_provider_request', () => {{
    writeFileSync({json.dumps(str(network_marker))}, 'unexpected model request');
    throw new Error('This smoke test must never request a model');
  }});
  const now = () => Number(readFileSync({json.dumps(str(clock))}, 'utf8'));
  const reader = createQuotaReader({{
    getProvider: () => ({{ baseUrl: 'https://api.anthropic.com' }}),
    getProviderAuth: async () => ({{ auth: {{ apiKey: 'sk-ant-oat-synthetic-only' }} }}),
  }}, async () => {{
    appendFileSync({json.dumps(str(requests))}, 'GET\\n');
    return now() > {initial_time}
      ? new Response(null, {{ status: 429, headers: {{ 'retry-after': '1200' }} }})
      : Response.json({{ seven_day: {{ utilization: 14 }}, five_hour: {{ utilization: 0 }} }});
  }}, {{ throttleDir: {json.dumps(str(base / 'quota-state'))}, now }});
  let work = false;
  const source = {{
    list: async () => [
      {{ provider: 'openai-codex', label: 'main', active: !work }},
      {{ provider: 'openai-codex', label: 'work', active: work }},
      {{ provider: 'anthropic', label: 'main', active: true }},
    ],
    read: (account, signal, onCached) => account.provider === 'openai-codex'
      ? Promise.resolve({{ weekly: {{ usedPercent: account.label === 'work' ? 7 : 31 }} }})
      : reader(account.provider, signal, onCached),
  }};
  registerQuotaFooter(pi, {{ now, source }});
  pi.registerCommand('quota-test-switch', {{ handler: async () => {{
    work = !work;
    pi.events.emit(ACCOUNTS_CHANGED_EVENT, undefined);
  }} }});
}}
""")
        env = {
            "HOME": str(home), "PATH": os.environ["PATH"], "TERM": "xterm-256color",
            "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_SKIP_VERSION_CHECK": "1",
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
        }
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
        child = subprocess.Popen([
            NODE, str(PACKAGE / "dist/cli.js"), "--no-extensions", "-e", str(fixture),
            "--no-skills", "--no-prompt-templates", "--no-themes", "--no-session", "--tui-mode", "fullscreen",
        ], cwd=base, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()

        def wait_for(text, start=0):
            deadline = time.monotonic() + 20
            while text not in ANSI.sub(b"", bytes(output[start:])):
                assert time.monotonic() < deadline, f"Timed out waiting for {text!r}: {output[-2000:]!r}"
                if select.select([master], [], [], 0.1)[0]:
                    output.extend(os.read(master, 65536))

        def resize(columns):
            start = len(output)
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, columns, 0, 0))
            os.kill(child.pid, signal.SIGWINCH)
            wait_for(QUOTA_VALUES, start)
            wait_for(MCP_STATUS, start)

        try:
            wait_for(QUOTA_VALUES)
            wait_for(MCP_STATUS)
            wait_for(SUMMARY)
            startup = ANSI.sub(b"", bytes(output))
            for unwanted in (b"escape interrupt", b"Press ctrl+o", b"Pi can explain", b"[Context]", b"Codex", b"Claude"):
                assert unwanted not in startup, f"Unexpected startup fluff {unwanted!r}: {startup[-3000:]!r}"
            os.write(master, b"draft stays editable")
            wait_for(b"draft stays editable")
            resize(100)
            resize(50)
            resize(80)
            # A /mcp toggle rewrites mcp.json; the footer recounts on its next render.
            mcp_servers["stdio"].pop("enabled")
            mcp_config.write_text(json.dumps({"mcpServers": mcp_servers}, indent=2))
            later = time.time() + 5
            os.utime(mcp_config, (later, later))
            start = len(output)
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 90, 0, 0))
            os.kill(child.pid, signal.SIGWINCH)
            wait_for(MCP_EDITED, start)
            mcp_servers["stdio"]["enabled"] = False
            mcp_config.write_text(json.dumps({"mcpServers": mcp_servers}))
            later += 5
            os.utime(mcp_config, (later, later))
            resize(80)
            os.write(master, b"\x03")  # Clear only this isolated draft.
            time.sleep(0.1)
            assert requests.read_text() == "GET\n", "Startup must perform one synthetic quota GET"
            clock.write_text(str(initial_time + 16 * 60_000))
            start = len(output)
            os.write(master, b"/usage\r")
            wait_for(b"Account quota used", start)
            wait_for(b"Codex / main (active): wk:31%", start)
            wait_for(b"Codex / work (parked): wk:7%", start)
            wait_for(QUOTA_VALUES + b"*", start)
            wait_for(b"Shared cache", start)
            wait_for(b"Refresh: rate limited", start)
            start = len(output)
            os.write(master, b"/reload\r")
            wait_for(QUOTA_VALUES + b"*", start)
            wait_for(MCP_STATUS, start)
            resize(100)
            assert requests.read_text() == "GET\nGET\n", "Reload/backoff must reuse the shared snapshot without another quota GET"
            start = len(output)
            os.write(master, b"/quota-test-switch\r")
            wait_for("7% | 14% · 0%*".encode(), start)
            start = len(output)
            os.write(master, b"/usage\r")
            wait_for(b"Codex / main (parked): wk:31%", start)
            wait_for(b"Codex / work (active): wk:7%", start)
            assert requests.read_text() == "GET\nGET\n", "Account switch must retain Claude backoff"
            assert not network_marker.exists(), "Unexpected model request"
            assert not (agent / "sessions").exists(), "Unexpected session persistence"
            assert child.poll() is None, "Pi unexpectedly exited"
            print(f"PASS ({theme}): quiet fullscreen Pi shows a one-line resource summary plus compact colored quotas/native MCP counts at 50/80/100 columns, recounts an edited mcp.json, preserves draft input and stale shared usage through all-account /usage, account switches, 429 backoff and /reload; no model request or session persistence.")
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
