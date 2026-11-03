"""Tests for bin/pi-agent with a fake `pi` on PATH. No model is called."""

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "bin" / "pi-agent"

FAKE_PI = """#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
system = None
if "--append-system-prompt" in args:
    with open(args[args.index("--append-system-prompt") + 1]) as f:
        system = f.read()
with open(os.environ["FAKE_PI_LOG"], "w") as f:
    json.dump({"args": args, "cwd": os.getcwd(), "system": system,
               "depth": os.environ.get("PI_AGENT_DEPTH")}, f)
print("reply from fake pi")
"""

AGENT_FILE = """---
name: helper
description: test agent
---

# Helper

Do the thing.
"""


class PiAgentTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        fake = bin_dir / "pi"
        fake.write_text(FAKE_PI)
        fake.chmod(0o755)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.pstack = self.tmp / "pstack"
        (self.pstack / "plugins" / "pstack" / "agents").mkdir(parents=True)
        (self.pstack / "plugins" / "pstack" / "agents" / "helper.md").write_text(AGENT_FILE)
        self.log = self.tmp / "fake-pi.json"
        self.env = {
            "PATH": f"{bin_dir}:/usr/bin:/bin",
            "HOME": str(self.home),
            "TMPDIR": str(self.tmp),
            "PSTACK_HOME": str(self.pstack),
            "FAKE_PI_LOG": str(self.log),
        }
        self.addCleanup(shutil.rmtree, self.tmp)

    def run_agent(self, *args, env=None, cwd=None, stdin=None):
        result = subprocess.run(
            [str(SCRIPT), *args],
            env={**self.env, **(env or {})},
            cwd=cwd or self.tmp,
            input=stdin,
            capture_output=True,
            text=True,
            timeout=30,
        )
        call = json.loads(self.log.read_text()) if self.log.exists() else None
        return result, call

    def option(self, call, name):
        args = call["args"]
        return args[args.index(name) + 1] if name in args else None

    def test_inherits_the_calling_sessions_model_and_thinking(self):
        result, call = self.run_agent("-p", "hi", env={
            "PI_PROVIDER": "anthropic", "PI_MODEL": "claude-opus-5-5",
            "PI_REASONING_LEVEL": "xhigh"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.option(call, "--model"), "anthropic/claude-opus-5-5")
        self.assertEqual(self.option(call, "--thinking"), "xhigh")
        self.assertEqual(call["args"][-1], "hi")

    def test_provider_without_model_passes_no_model(self):
        result, call = self.run_agent("-p", "hi", env={"PI_PROVIDER": "anthropic"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("--model", call["args"])

    def test_pstack_model_names_map_to_both_providers(self):
        expected = {
            "claude": "anthropic/claude-opus-5-5",
            "gpt": "openai-codex/gpt-6.1-sol",
            "fast": "openai-codex/gpt-6-luna",
            "opus": "anthropic/claude-opus-5-5",
            "fable": "anthropic/claude-fable-5-1",
            "sonnet": "openai-codex/gpt-6.1-sol",
            "haiku": "openai-codex/gpt-6-luna",
            "openai-codex/gpt-6-astra": "openai-codex/gpt-6-astra",
        }
        for alias, model in expected.items():
            _, call = self.run_agent("-m", alias, "-p", "hi")
            self.assertEqual(self.option(call, "--model"), model, alias)
        _, call = self.run_agent("-m", "inherit-parent", "-p", "hi", env={
            "PI_PROVIDER": "openai-codex", "PI_MODEL": "gpt-6-astra"})
        self.assertEqual(self.option(call, "--model"), "openai-codex/gpt-6-astra")

    def test_other_picks_the_other_provider_than_the_caller(self):
        _, call = self.run_agent("-m", "other", "-p", "hi", env={
            "PI_PROVIDER": "anthropic", "PI_MODEL": "claude-opus-5-5"})
        self.assertEqual(self.option(call, "--model"), "openai-codex/gpt-6.1-sol")
        _, call = self.run_agent("-m", "other", "-p", "hi", env={
            "PI_PROVIDER": "openai-codex", "PI_MODEL": "gpt-6-astra"})
        self.assertEqual(self.option(call, "--model"), "anthropic/claude-opus-5-5")
        self.log.unlink()
        result, call = self.run_agent("-m", "other", "-p", "hi")
        self.assertEqual(result.returncode, 2)
        self.assertIsNone(call)

    def test_child_is_isolated_by_default(self):
        _, call = self.run_agent("-p", "hi")
        for flag in ("-p", "--no-session", "--no-extensions", "--no-mcp",
                     "--no-prompt-templates"):
            self.assertIn(flag, call["args"])
        self.assertNotIn("-e", call["args"])
        self.assertEqual(call["depth"], "1")

    def test_loads_only_the_claude_route_extension_when_present(self):
        route = self.home / ".pi/agent/extensions/omp-anthropic-route/index.ts"
        route.parent.mkdir(parents=True)
        route.write_text("")
        _, call = self.run_agent("-p", "hi")
        self.assertEqual(self.option(call, "-e"), str(route))

    def test_readonly_and_mcp_switches(self):
        _, call = self.run_agent("-r", "--mcp", "-p", "hi")
        self.assertEqual(self.option(call, "--exclude-tools"), "edit,write")
        self.assertNotIn("--no-mcp", call["args"])

    def test_agent_body_without_front_matter_becomes_system_prompt(self):
        result, call = self.run_agent("-a", "pstack:helper", "-p", "hi")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("name: helper", call["system"])
        self.assertIn("Do the thing.", call["system"])
        self.assertIn(f"{self.pstack}/plugins/pstack/skills/poteto-mode/SKILL.md",
                      call["system"])
        self.assertEqual(list(self.tmp.glob("pi-agent.*")), [], "temp file left behind")

    def test_unknown_agent_fails_before_running(self):
        result, call = self.run_agent("-a", "nobody", "-p", "hi")
        self.assertEqual(result.returncode, 1)
        self.assertIn("no agent file", result.stderr)
        self.assertIsNone(call)

    def test_out_is_relative_to_the_caller_not_the_child_directory(self):
        work = self.tmp / "worktree"
        work.mkdir()
        result, call = self.run_agent("-C", str(work), "-o", "reply.md", "-p", "hi")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(call["cwd"], str(work.resolve()))
        self.assertEqual((self.tmp / "reply.md").read_text(), "reply from fake pi\n")
        self.assertTrue((self.tmp / "reply.md.log").exists())
        self.assertFalse((work / "reply.md").exists())

    def test_prompt_from_arguments_or_stdin(self):
        _, call = self.run_agent("review", "this", "diff")
        self.assertEqual(call["args"][-1], "review this diff")
        _, call = self.run_agent(stdin="from stdin\n")
        self.assertEqual(call["args"][-1], "from stdin")
        _, call = self.run_agent("-p", "- a prompt that looks like an option")
        self.assertEqual(call["args"][-2:], ["--", "- a prompt that looks like an option"])

    def test_rejects_two_prompts_and_deep_nesting(self):
        result, _ = self.run_agent("-p", "one", "two")
        self.assertEqual(result.returncode, 2)
        result, call = self.run_agent("-p", "hi", env={"PI_AGENT_DEPTH": "3"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("refusing to nest", result.stderr)
        self.assertIsNone(call)


if __name__ == "__main__":
    unittest.main()
