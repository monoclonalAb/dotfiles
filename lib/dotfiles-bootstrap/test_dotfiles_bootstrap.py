"""dotfiles-bootstrap's install mode against a throwaway repository and HOME.

Every step is already satisfied except what a test leaves out: the Brewfile is
empty, nvm and Herdr are fakes, theme state and tpm exist. The real
dotfiles-link and `brew bundle check` run; nothing is installed and $HOME is
never read or written.
"""

import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import unittest

BIN = Path(__file__).resolve().parents[2] / "bin"
PLUGINS = ["next-agent", "spaces-env", "task-launcher", "pr-status"]

FAKE_NVM = """\
nvm() { return 0; }
PATH="$NVM_DIR/bin:$PATH"
"""

# Lists the plugins named in $HOME/linked-plugins; `plugin link` fails.
FAKE_HERDR = """\
#!/bin/sh
case "$1 ${2-}" in
  "--version "*) echo 'herdr 0.9.5-dotfiles.test' ;;
  "plugin list") cat "$HOME/linked-plugins" ;;
  "plugin link") echo 'link refused' >&2; exit 1 ;;
  "integration status") printf 'pi: current (v9)\\nomp: current (v10)\\n' ;;
  *) exit 1 ;;
esac
"""


def executable(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(0o755)


@unittest.skipUnless(
    platform.system() == "Darwin"
    and Path("/opt/homebrew/bin/brew").exists()
    and subprocess.run(["xcode-select", "-p"], capture_output=True).returncode == 0,
    "needs macOS with Homebrew and the Command Line Tools",
)
class InstallModeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(os.path.realpath(tempfile.mkdtemp(prefix="dotfiles-bootstrap-")))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.repo = self.tmp / "dotfiles"
        self.home = self.tmp / "home"
        (self.tmp / "tmp").mkdir()

        for name in ("dotfiles-bootstrap", "dotfiles-link"):
            executable(self.repo / "bin" / name, (BIN / name).read_text())
        (self.repo / "links").write_text("app/  ~/.config/app/\nbin/  ~/.local/bin/\n")
        (self.repo / "app").mkdir()
        (self.repo / "app" / "config").write_text("x = 1\n")
        (self.repo / "Brewfile").write_text("# nothing to install\n")
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        subprocess.run(["git", "add", "-A"], cwd=self.repo, check=True)

        (self.home / ".cargo").mkdir(parents=True)
        (self.home / ".cargo" / "env").write_text("")
        (self.home / ".nvm").mkdir()
        (self.home / ".nvm" / "nvm.sh").write_text(FAKE_NVM)
        executable(self.home / ".nvm" / "bin" / "node", "#!/bin/sh\necho v26.0.0\n")
        executable(self.home / ".nvm" / "bin" / "npm", "#!/bin/sh\nexit 0\n")
        (self.home / ".local" / "state" / "theme").mkdir(parents=True)
        (self.home / ".local" / "state" / "theme" / "flavour").write_text("latte\n")
        (self.home / ".config" / "tmux" / "plugins" / "tpm").mkdir(parents=True)
        executable(self.home / ".local" / "bin" / "herdr", FAKE_HERDR)

    def bootstrap(self, linked_plugins):
        ids = [{"id": f"martinro.{name}"} for name in linked_plugins]
        (self.home / "linked-plugins").write_text(json.dumps(ids))
        env = {"HOME": str(self.home), "PATH": "/usr/bin:/bin", "TMPDIR": str(self.tmp / "tmp")}
        return subprocess.run(
            ["/bin/bash", str(self.repo / "bin" / "dotfiles-bootstrap")],
            env=env, cwd=self.tmp, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, timeout=120,
        )

    def test_a_failed_step_is_named_after_the_manual_steps_and_exits_1(self):
        run = self.bootstrap(PLUGINS[:-1])
        self.assertEqual(run.returncode, 1, run.stdout)
        last_screen = run.stdout[run.stdout.index("Manual steps"):]
        self.assertIn("pr-status", last_screen, run.stdout)

    def test_a_run_with_nothing_failing_exits_0(self):
        run = self.bootstrap(PLUGINS)
        self.assertEqual(run.returncode, 0, run.stdout)
        self.assertNotIn("failed", run.stdout)


if __name__ == "__main__":
    unittest.main()
