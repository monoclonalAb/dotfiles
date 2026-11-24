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
        # A caller's GIT_DIR or GIT_INDEX_FILE would aim these at another repository.
        git_env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True, env=git_env)
        subprocess.run(["git", "add", "-A"], cwd=self.repo, check=True, env=git_env)

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

    def test_failed_steps_are_named_after_the_manual_steps_and_exit_1(self):
        run = self.bootstrap(PLUGINS[:2])
        self.assertEqual(run.returncode, 1, run.stdout)
        last_screen = run.stdout[run.stdout.index("Manual steps"):]
        self.assertIn("task-launcher", last_screen, run.stdout)
        self.assertIn("pr-status", last_screen, run.stdout)

    def offline(self):
        executable(self.home / ".local" / "bin" / "curl", "#!/bin/sh\necho 'curl: (6) Could not resolve host' >&2\nexit 6\n")

    def test_failed_downloads_and_installs_are_listed_too(self):
        shutil.rmtree(self.home / ".nvm")
        shutil.rmtree(self.home / ".config" / "tmux" / "plugins")
        (self.home / ".config" / "tmux" / "plugins").write_text("a file where tpm's folder goes\n")
        self.offline()
        run = self.bootstrap(PLUGINS)
        self.assertEqual(run.returncode, 1, run.stdout)
        self.assertIn("Manual steps", run.stdout)
        last_screen = run.stdout[run.stdout.index("Manual steps"):]
        for step in ("nvm", "Node", "pi-coding-agent", "tpm"):
            self.assertIn(step, last_screen, run.stdout)

    def test_a_failed_rust_install_stops_before_linking(self):
        # The linked ~/.zshenv sources ~/.cargo/env, so linking without it breaks every shell.
        (self.home / ".cargo" / "env").unlink()
        self.offline()
        run = self.bootstrap(PLUGINS)
        self.assertEqual(run.returncode, 1, run.stdout)
        self.assertIn("rustup", run.stdout.strip().splitlines()[-1], run.stdout)
        self.assertFalse((self.home / ".config" / "app" / "config").exists(), run.stdout)

    def test_a_run_with_nothing_failing_exits_0(self):
        run = self.bootstrap(PLUGINS)
        self.assertEqual(run.returncode, 0, run.stdout)
        self.assertNotIn("failed", run.stdout)


if __name__ == "__main__":
    unittest.main()
