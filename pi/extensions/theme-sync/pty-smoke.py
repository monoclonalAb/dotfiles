#!/usr/bin/env python3
"""Own-PTY theme toggle journey: isolated HOME, real Pi renderer, no model calls.

Runs the actual hotkey's `theme cycle` with stubbed app reload commands, never
changes the workstation theme or sends input to an existing terminal.
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
REPO = ROOT.parents[2]
NODE = shutil.which("node")
NPM = shutil.which("npm")
assert NODE and NPM, "Node/npm must already be installed"
PACKAGE = Path(subprocess.check_output([NPM, "root", "-g"], text=True).strip()) / "@earendil-works/pi-coding-agent"
ANSI = re.compile(rb"\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]")


def main():
    with tempfile.TemporaryDirectory(prefix="pi-theme-pty-", dir="/tmp") as temp:
        base = Path(temp).resolve()
        home = base / "home"
        agent = home / ".pi/agent"
        agent.mkdir(parents=True)
        (agent / "settings.json").write_text(json.dumps({
            "defaultProvider": "theme-test", "defaultModel": "fixture",
            "theme": "light", "quietStartup": True,
        }))
        (agent / "models.json").write_text(json.dumps({"providers": {"theme-test": {
            "baseUrl": "http://127.0.0.1:1/v1", "api": "openai-completions", "apiKey": "synthetic-only",
            "models": [{"id": "fixture", "reasoning": False}],
        }}}))
        state = home / ".local/state/theme"
        state.mkdir(parents=True)
        (state / "flavour").write_text("mocha\n")
        stub_bin = home / ".local/bin"
        stub_bin.mkdir(parents=True)
        for app in ("herdr", "tmux", "nvim"):
            stub = stub_bin / app
            stub.write_text("#!/bin/sh\nexit 1\n")
            stub.chmod(0o755)
        palette_dir = home / ".config/alacritty/themes/catppuccin"
        palette_dir.parent.mkdir(parents=True)
        palette_dir.symlink_to(REPO / "alacritty/themes/catppuccin")
        fixture = base / "fixture.ts"
        network_marker = base / "unexpected-model-request"
        draft_marker = base / "draft.json"
        fixture.write_text(f"""
import themeSync from {json.dumps(str(ROOT / 'index.ts'))};
import {{ ToolExecutionComponent }} from {json.dumps(str(PACKAGE / 'dist/modes/interactive/components/tool-execution.js'))};
import {{ Container }} from '@earendil-works/pi-tui';
import {{ writeFileSync }} from 'node:fs';
export default function(pi) {{
  themeSync(pi);
  pi.on('before_provider_request', () => {{
    writeFileSync({json.dumps(str(network_marker))}, 'unexpected');
    throw new Error('No model requests allowed in theme smoke test');
  }});
  pi.on('session_start', (_event, ctx) => {{
    ctx.ui.setHeader(() => ({{
      render() {{
        writeFileSync({json.dumps(str(draft_marker))}, JSON.stringify({{theme:ctx.ui.theme.name, draft:ctx.ui.getEditorText()}}));
        return [ctx.ui.theme.fg('accent', 'Theme: ' + ctx.ui.theme.name)];
      }},
      invalidate() {{}},
    }}));
    ctx.ui.setWidget('theme-test', (tui) => {{
      const box = new Container();
      const read = new ToolExecutionComponent('read', 'read', {{path:'fixture.txt'}}, {{}}, undefined, tui, ctx.cwd);
      read.updateResult({{content:[{{type:'text', text:'settled read output'}}], isError:false}});
      const edit = new ToolExecutionComponent('edit', 'edit', {{path:'fixture.txt', edits:[]}}, {{}}, undefined, tui, ctx.cwd);
      edit.updateResult({{content:[{{type:'text', text:'synthetic edit error'}}], isError:true}});
      const pending = new ToolExecutionComponent('bash', 'pending', {{command:'pending preview'}}, {{}}, undefined, tui, ctx.cwd);
      box.addChild(read); box.addChild(edit); box.addChild(pending);
      return box;
    }});
  }});
}}
""")
        env = {
            "HOME": str(home), "PATH": os.environ["PATH"], "TERM": "xterm-256color", "COLORTERM": "truecolor",
            "USER": "pi-theme-smoke", "TMPDIR": str(base),
            "PI_OFFLINE": "1", "PI_TELEMETRY": "0", "PI_SKIP_VERSION_CHECK": "1",
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
        }
        master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 48, 90, 0, 0))
        child = subprocess.Popen([
            NODE, str(PACKAGE / "dist/cli.js"), "--no-extensions", "-e", str(fixture),
            "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-themes", "--no-session",
            "--tui-mode", "fullscreen",
        ], cwd=base, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = bytearray()

        def drain(seconds=0.1):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.05)[0]:
                    try:
                        chunk = os.read(master, 65536)
                    except OSError:
                        if child.poll() is not None:
                            return
                        raise
                    if not chunk:
                        return
                    output.extend(chunk)

        def wait_for(text, start=0, raw=False):
            deadline = time.monotonic() + 20
            while True:
                content = bytes(output[start:])
                if text in (content if raw else ANSI.sub(b"", content)):
                    return
                assert child.poll() is None, f"Pi exited: {output[-3000:]!r}"
                assert time.monotonic() < deadline, f"Timed out: {text!r}: {output[-3000:]!r}"
                drain()

        def check_theme(flavour, mantle, start):
            wait_for(f"Theme: catppuccin-{flavour}".encode(), start)
            rgb = ";".join(str(int(mantle[i:i + 2], 16)) for i in (0, 2, 4))
            wait_for(f"\x1b[48;2;{rgb}m".encode(), start, raw=True)
            wait_for(b"settled read output", start)
            wait_for(b"synthetic edit error", start)
            wait_for(b"pending preview", start)

        try:
            check_theme("mocha", "181825", 0)  # Saved Pi theme was deliberately light.
            os.write(master, "draft café stays editable".encode())
            wait_for("draft café stays editable".encode())
            for flavour, mantle in (("latte", "e6e9ef"), ("frappe", "292c3c"),
                                    ("macchiato", "1e2030"), ("mocha", "181825")):
                start = len(output)
                result = subprocess.run(["/bin/bash", str(REPO / "bin/theme"), "cycle"],
                    cwd=base, env={**env, "PATH": "/usr/bin:/bin"}, capture_output=True, text=True, timeout=10)
                assert result.returncode == 0, result.stderr
                assert result.stdout.strip() == f"{flavour} 0.6", result.stdout
                check_theme(flavour, mantle, start)
                assert json.loads(draft_marker.read_text())["draft"] == "draft café stays editable"
            # Clear only the fixture draft, then exercise native extension reload.
            os.write(master, b"\x03")
            drain(0.2)
            start = len(output)
            os.write(master, b"/reload\r")
            wait_for(b"Reloaded keybindings", start)
            drain(1.2)  # Observe after Pi's late saved-settings restore, not before it.
            assert json.loads(draft_marker.read_text())["theme"] == "catppuccin-mocha"
            start = len(output)
            (state / "flavour").write_text("frappe\n")
            check_theme("frappe", "292c3c", start)
            assert not network_marker.exists(), "Unexpected model request"
            assert json.loads((agent / "settings.json").read_text())["theme"] == "light", "Sync must not rewrite settings"
            os.write(master, b"/quit\r")
            deadline = time.monotonic() + 10
            while child.poll() is None:
                assert time.monotonic() < deadline, f"Pi did not quit: {output[-3000:]!r}"
                drain()  # Shutdown can fill the PTY buffer while restoring the screen.
            assert child.returncode == 0
            print("PASS: native Pi startup, four minimal-PATH theme cycles, tool repaints, draft preservation, /reload and shutdown")
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, signal.SIGKILL)
                    child.wait(timeout=5)
            os.close(master)


if __name__ == "__main__":
    main()
