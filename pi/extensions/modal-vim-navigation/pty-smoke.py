#!/usr/bin/env python3
"""Own-PTY Pi journey for the Vim editor: cursor shapes, editing and transcript keys.

Isolated HOME, a fake clipboard, no model requests, no session files and no
input to other panes. Requires the already installed npm Pi and Node; uses only
Python's stdlib.
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

ROOT = Path(__file__).resolve().parent
NODE = shutil.which("node")
assert NODE, "Node must already be installed"
NPM = shutil.which("npm")
assert NPM, "npm must already be installed"
PACKAGE = Path(subprocess.check_output([NPM, "root", "-g"], text=True).strip()) / "@earendil-works/pi-coding-agent"
ANSI = re.compile(rb"\x1b_[^\x07]*\x07|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]")
BAR, BLOCK, UNDERLINE, RESET = b"\x1b[6 q", b"\x1b[2 q", b"\x1b[4 q", b"\x1b[0 q"
SHAPES = re.compile(rb"\x1b\[[0246] q")


def main():
    with tempfile.TemporaryDirectory(prefix="pi-vim-pty-", dir="/tmp") as temp:
        base = Path(temp).resolve()
        home = base / "home"
        agent = home / ".pi/agent"
        agent.mkdir(parents=True)
        (agent / "settings.json").write_text(json.dumps({
            "defaultProvider": "vim-test", "defaultModel": "fixture", "quietStartup": True,
        }))
        (agent / "models.json").write_text(json.dumps({"providers": {"vim-test": {
            "baseUrl": "http://127.0.0.1:1/v1", "api": "openai-completions", "apiKey": "synthetic-only",
            "models": [{"id": "fixture", "reasoning": False}],
        }}}))
        copied = base / "copied"
        network_marker = base / "unexpected-request"
        fixture = base / "fixture.ts"
        fixture.write_text(f"""
import {{ appendFileSync }} from 'node:fs';
import {{ registerVimNavigation }} from {json.dumps(str(ROOT / 'index.ts'))};
export default function(pi) {{
  registerVimNavigation(pi, {{
    read: async () => ({{ type: 'text', text: 'from clipboard' }}),
    write: async (text) => {{ appendFileSync({json.dumps(str(copied))}, JSON.stringify(text) + '\\n'); }},
  }});
  pi.on('before_provider_request', () => {{
    appendFileSync({json.dumps(str(network_marker))}, 'unexpected model request');
    throw new Error('This smoke test must never request a model');
  }});
  pi.registerCommand('fill', {{ handler: async () => {{
    const lines = Array.from({{ length: 80 }}, (_, i) => `fill line ${{String(i + 1).padStart(3, '0')}}`);
    pi.sendMessage({{ customType: 'vim-fill', content: lines.join('\\n'), display: true }});
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

        def read_for(seconds):
            deadline = time.monotonic() + seconds
            while time.monotonic() < deadline:
                if select.select([master], [], [], 0.05)[0]:
                    output.extend(os.read(master, 65536))

        def wait_for(check, what, start=0):
            deadline = time.monotonic() + 20
            while not check(bytes(output[start:])):
                assert time.monotonic() < deadline, f"Timed out waiting for {what}: {bytes(output[-1500:])!r}"
                if select.select([master], [], [], 0.1)[0]:
                    output.extend(os.read(master, 65536))

        def text(start=0):
            return ANSI.sub(b"", bytes(output[start:]))

        def shape(start=0):
            found = SHAPES.findall(bytes(output[start:]))
            return found[-1] if found else None

        def send(keys, *, settle=0.15):
            start = len(output)
            for key in keys:
                os.write(master, key)
                time.sleep(0.03)
            read_for(settle)
            return start

        def editor_row():
            """The prompt row of the last frame: the row after the editor's top border."""
            frame = bytes(output)
            rows = {}
            for match in re.finditer(rb"\x1b\[(\d+);1H\x1b\[2K([^\x1b]*(?:\x1b(?!\[\d+;1H)[^\x1b]*)*)", frame):
                rows[int(match.group(1))] = ANSI.sub(b"", match.group(2)).decode(errors="replace")
            borders = [row for row, value in rows.items() if value.startswith("─" * 10)]
            assert len(borders) >= 2, f"No editor borders in {rows!r}"
            return rows.get(sorted(borders)[-2] + 1, "").rstrip()

        try:
            wait_for(lambda data: b"fixture" in ANSI.sub(b"", data), "startup footer")
            read_for(0.5)
            assert shape() == BAR, f"Insert mode must show a bar cursor, saw {shape()!r}"
            assert b"\x1b[?25h" in bytes(output), "Pi must show the terminal's own cursor"

            send([b"/fill\r"], settle=0.5)
            wait_for(lambda data: b"fill line 080" in ANSI.sub(b"", data), "transcript fill")

            start = send([b"hello world"])
            assert editor_row() == "hello world", editor_row()
            start = send([b"\x1b"])
            assert shape(start) == BLOCK, "Escape must switch to a block cursor"
            send([b"b", b"d", b"w"])
            assert editor_row() == "hello", f"dw must delete the last word: {editor_row()!r}"
            assert copied.read_text() == '"world"\n', "The deleted word must reach the clipboard"
            send([b"u"])
            assert editor_row() == "hello world", f"u must restore it: {editor_row()!r}"
            start = send([b"c"])
            assert shape(start) == UNDERLINE, "An operator waiting for its motion shows an underline"
            start = send([b"i", b"w"])
            assert shape(start) == BAR, "ciw enters insert mode"
            send([b"there", b"\x1b"])
            assert editor_row() == "hello there", f"ciw must change the word: {editor_row()!r}"
            send([b"0", b"P"], settle=0.4)
            assert editor_row() == "from clipboardhello there", f"P must put the clipboard: {editor_row()!r}"

            # Single-line prompt: gg climbs into the transcript's top, G returns to its end.
            assert b"fill line 001" not in text(len(output) - 4000), "Precondition: the top is off screen"
            start = send([b"g", b"g"], settle=0.4)
            assert b"fill line 001" in text(start), "gg must scroll the transcript to its top"
            start = send([b"j", b"j"], settle=0.3)
            assert b"fill line" in text(start), "j must scroll the transcript while it is scrolled up"
            start = send([b"G"], settle=0.4)
            assert b"fill line 080" in text(start), "G must return the transcript to its end"
            assert editor_row() == "from clipboardhello there", "Transcript keys must not edit the prompt"

            start = send([b"\x1b"])
            assert child.poll() is None, "Escape in normal mode must not quit Pi"
            start = send([b"\x03"])
            assert shape(start) == BAR, "Ctrl+C clears the prompt and starts the next one in insert mode"
            send([b"\x03"], settle=0.1)
            child.wait(timeout=10)
            read_for(0.2)
            assert bytes(output).rfind(RESET) > bytes(output).rfind(BAR), "Quitting must reset the cursor shape"
            assert not network_marker.exists(), "Unexpected model request"
            assert not (agent / "sessions").exists(), "Unexpected session persistence"
            print("PASS: fullscreen Pi shows its own cursor as a bar to insert, a block in normal mode and an "
                  "underline while an operator waits; dw/u/ciw/P edit the prompt through the clipboard stand-in; "
                  "gg/j/G move the transcript; quitting resets the cursor; no model request or session file.")
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
    main()
