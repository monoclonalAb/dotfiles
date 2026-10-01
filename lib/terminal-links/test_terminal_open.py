"""Source-only opener/config checks; never launch an app or read user state."""

import contextlib
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2] / "bin" / "terminal-open"
REPO = SOURCE.parents[1]
loader = SourceFileLoader("terminal_open", str(SOURCE))
module = module_from_spec(spec_from_loader(loader.name, loader))
loader.exec_module(module)


class TerminalOpenTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="terminal links ")
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "a b #日本%(');$file.md"
        self.path.write_text("line one\nline two\n")
        self.uri = self.path.as_uri()

    def command(self, uri):
        return module.command_for(uri, lambda _: "/opt/homebrew/bin/nvim")

    def test_file_path_is_one_literal_argument_after_double_dash(self):
        command = self.command(self.uri)
        self.assertEqual(command[:4], ["/usr/bin/open", "-na", "Alacritty", "--args"])
        self.assertEqual(command[4:8], ["--working-directory", str(self.path.parent), "-e", "/opt/homebrew/bin/nvim"])
        self.assertEqual(command[-2:], ["--", str(self.path)])
        self.assertNotIn("sh", command)
        self.assertIn("set nomodeline noexrc", command)

    def test_localhost_and_encoded_spaces(self):
        self.assertEqual(self.command(self.uri.replace("file:///", "file://localhost/")), self.command(self.uri))

    def test_line_and_column_anchors(self):
        for fragment, cursor in [("L42", "42,1"), ("L2:7", "2,7"), ("L2-L5", "2,1")]:
            self.assertIn(f"+call cursor({cursor})", self.command(self.uri + "#" + fragment))

    def test_heading_or_malicious_fragments_never_become_commands(self):
        for fragment in ["setup", "L0", "L1:0", "L999999999999999", "L1%7C!touch%20pwned", "!quit"]:
            self.assertEqual(self.command(self.uri + "#" + fragment), self.command(self.uri))

    def test_external_urls_keep_default_macos_open(self):
        for url in ["https://example.com/a?q=b#c", "http://localhost:3000", "mailto:me@example.com", "ssh://host/a"]:
            self.assertEqual(self.command(url), ["/usr/bin/open", url])

    def test_rejects_invalid_remote_or_non_regular_files(self):
        for url in [
            "", "README.md", "--help", "javascript:alert(1)", "vscode://file/a",
            "file:relative.md", "file://server/a.md", "file://user@localhost/a.md",
            "file:////server/a.md", "file:///%2Fserver/a.md", "file://localhost:3/a.md",
            self.uri + "?command=quit", self.uri + "%ZZ", self.uri + "%00", self.uri + "%FF",
            self.uri + "\n", "file:///not/a/real/file.md", Path(self.temp.name).as_uri(),
        ]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.command(url)
        fifo = Path(self.temp.name) / "fifo"
        os.mkfifo(fifo)
        with self.assertRaises(ValueError):
            self.command(fifo.as_uri())

    def test_missing_nvim_is_actionable(self):
        with self.assertRaisesRegex(ValueError, "Neovim was not found"):
            module.command_for(self.uri, lambda _: None)

    def test_check_and_launch_boundary(self):
        with patch.dict(os.environ), patch.object(module.subprocess, "run") as run:
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(module.main(["--check", self.uri]), 0)
            self.assertEqual(json.loads(output.getvalue())[-1], str(self.path))
            run.assert_not_called()
            self.assertEqual(os.environ["PATH"], module.PATH)
            self.assertEqual(module.main(["https://example.com"]), 0)
            run.assert_called_once_with(["/usr/bin/open", "https://example.com"], check=True)

    def test_minimal_path_real_entrypoint_without_gui(self):
        result = subprocess.run([str(SOURCE), "--check", self.uri], text=True, capture_output=True,
                                env={"PATH": "/usr/bin:/bin", "HOME": self.temp.name, "PYTHONDONTWRITEBYTECODE": "1"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)[-1], str(self.path))

    def test_errors_never_fall_back_to_external_open(self):
        with patch.dict(os.environ), patch.object(module.subprocess, "run") as run:
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(module.main(["file://remote/a.md"]), 1)
                self.assertEqual(module.main([]), 2)
                self.assertEqual(module.main(["https://a", "https://b"]), 2)
            run.assert_not_called()

    def test_real_neovim_reads_literal_path_and_line_without_user_config(self):
        command = module.command_for(self.uri + "#L2:3")
        argv = command[command.index("-e") + 1:]
        report = '+lua io.stdout:write(vim.json.encode({path=vim.api.nvim_buf_get_name(0), line=vim.fn.line("."), col=vim.fn.col(".")}))'
        result = subprocess.run([argv[0], "--headless", "-u", "NONE", "-i", "NONE", "-n",
                                 *argv[1:-2], report, "+qa!", *argv[-2:]],
                                capture_output=True, text=True, timeout=15,
                                env={"HOME": self.temp.name, "PATH": module.PATH})
        self.assertEqual(result.returncode, 0, result.stderr)
        result = json.loads(result.stdout)
        self.assertTrue(self.path.samefile(result.pop("path")))
        self.assertEqual(result, {"line": 2, "col": 3})

    def test_config_dispatcher_keeps_hint_as_a_positional_argument(self):
        import tomllib  # Tests require Python 3.11+; the executable supports macOS Python 3.9.
        config = tomllib.loads((REPO / "alacritty/alacritty.toml").read_text())
        rules = config["hints"]["enabled"]
        self.assertEqual(len(rules), 1)
        rule = rules[0]
        self.assertTrue(rule["hyperlinks"])
        self.assertTrue(rule["post_processing"])
        self.assertEqual(rule["mouse"], {"enabled": True, "mods": "Command"})
        self.assertEqual(rule["binding"], {"key": "O", "mods": "Control|Shift"})
        # Replace only the trusted executable with an argv recorder in a fake HOME.
        home = Path(self.temp.name)
        target = home / ".local/bin/terminal-open"
        target.parent.mkdir(parents=True)
        target.write_text('#!/usr/bin/python3\nimport json,sys\nprint(json.dumps(sys.argv[1:]))\n')
        target.chmod(0o755)
        command = rule["command"]
        result = subprocess.run([command["program"], *command["args"], self.uri],
                                env={"HOME": str(home), "PATH": "/usr/bin:/bin"}, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [self.uri])
        regex = re.compile(rule["regex"])
        self.assertEqual(regex.search(f"guide ({self.uri})")[0].rstrip(")"), self.uri)
        self.assertEqual(regex.search("https://example.com")[0], "https://example.com")


if __name__ == "__main__":
    unittest.main()
