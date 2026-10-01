"""dotfiles-link checks against a throwaway repository and HOME; never touches $HOME.

Each test copies the real script into a temporary Git repository, so the
repository root is resolved exactly as it is for ~/.local/bin/dotfiles-link.
"""

from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2] / "bin" / "dotfiles-link"

MANIFEST = """\
# comment
app/          ~/.config/app/
shell/rc      ~/.shellrc
bin/          ~/.local/bin/
"""


class DotfilesLinkTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(os.path.realpath(tempfile.mkdtemp(prefix="dotfiles-link-")))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.repo = self.tmp / "repo"
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.write("links", MANIFEST)
        self.write("app/config.toml", "a = 1\n")
        self.write("app/nested/theme.toml", "b = 2\n")
        self.write("shell/rc", "export X=1\n")
        self.write("docs/README.md", "not deployed\n")
        (self.repo / "bin").mkdir()
        shutil.copy2(SOURCE, self.repo / "bin" / "dotfiles-link")
        self.git("init", "-q")
        self.git("add", ".")

    def write(self, relpath, text, root=None):
        path = (root or self.repo) / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def git(self, *args):
        subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True)

    def run_link(self, *args):
        return subprocess.run(["/usr/bin/python3", str(self.repo / "bin" / "dotfiles-link"), *args,
                               "--home", str(self.home)], capture_output=True, text=True)

    def assertLinked(self, home_relpath, repo_relpath):
        path = self.home / home_relpath
        self.assertTrue(path.is_symlink(), f"{path} is not a symlink")
        self.assertEqual(os.readlink(path), str(self.repo / repo_relpath))

    def load_module(self):
        """The fixture copy as a module, so tests can act between planning and applying."""
        loader = SourceFileLoader("dotfiles_link_fixture", str(self.repo / "bin" / "dotfiles-link"))
        module = module_from_spec(spec_from_loader(loader.name, loader))
        loader.exec_module(module)
        return module

    def execute(self, module, plan):
        fd = os.open(self.home, os.O_RDONLY | os.O_DIRECTORY)
        try:
            return module.execute(plan, fd)
        finally:
            os.close(fd)

    def snapshot(self):
        return sorted((str(p.relative_to(self.home)), os.readlink(p) if p.is_symlink() else None)
                      for p in self.home.rglob("*"))

    def test_apply_mirrors_folders_links_single_paths_and_is_idempotent(self):
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLinked(".config/app/config.toml", "app/config.toml")
        self.assertLinked(".config/app/nested/theme.toml", "app/nested/theme.toml")
        self.assertLinked(".shellrc", "shell/rc")
        # Mirrored directories are real, so applications can add their own files.
        self.assertFalse((self.home / ".config/app").is_symlink())
        self.assertFalse((self.home / ".config/app/nested").is_symlink())
        self.assertFalse((self.home / "docs").exists())
        self.assertFalse((self.home / ".config/app/links").exists())

        check = self.run_link("check")
        self.assertEqual(check.returncode, 0, check.stdout + check.stderr)
        self.assertIn("4 links in place, 0 to create", check.stdout)
        before = self.snapshot()
        again = self.run_link("apply")
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertIn("0 created, 0 repaired, 0 removed", again.stdout)
        self.assertEqual(self.snapshot(), before)

    def test_check_changes_nothing_and_reports_pending_work(self):
        result = self.run_link("check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("create   ~/.shellrc -> shell/rc", result.stdout)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_conflict_refuses_before_changing_anything(self):
        self.write(".shellrc", "local edits\n", root=self.home)
        (self.home / ".config/app").mkdir(parents=True)
        os.symlink("/somewhere/else", self.home / ".config/app/config.toml")
        before = self.snapshot()
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("conflict ~/.shellrc is a real file in the way of shell/rc", result.stderr)
        self.assertIn("links to /somewhere/else, outside this repository", result.stderr)
        self.assertIn("changed nothing", result.stderr)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual((self.home / ".shellrc").read_text(), "local edits\n")

    def test_repairs_links_left_by_an_older_layout_and_removes_dangling_ones(self):
        # Relative Stow-style links to paths that no longer exist in the repository.
        (self.home / ".config/app").mkdir(parents=True)
        old = os.path.relpath(self.repo / "app/.config/app/config.toml", self.home / ".config/app")
        os.symlink(old, self.home / ".config/app/config.toml")
        os.symlink(os.path.relpath(self.repo / "app/.config/app/gone.toml", self.home / ".config/app"),
                   self.home / ".config/app/gone.toml")
        self.write(".config/app/state.json", "{}", root=self.home)
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("repair   ~/.config/app/config.toml -> app/config.toml (was app/.config/app/config.toml)",
                      result.stdout)
        self.assertIn("remove   ~/.config/app/gone.toml", result.stdout)
        self.assertLinked(".config/app/config.toml", "app/config.toml")
        self.assertFalse(os.path.lexists(self.home / ".config/app/gone.toml"))
        self.assertEqual((self.home / ".config/app/state.json").read_text(), "{}")

    def test_ignored_runtime_files_are_never_linked(self):
        for name in ("app/.DS_Store", "app/__pycache__/x.pyc", "app/config.yml.lock",
                     "app/auth.json", "app/alacritty.toml.2026.bak"):
            self.write(name, "x")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        names = {p.name for p in (self.home / ".config/app").rglob("*")}
        self.assertEqual(names, {"config.toml", "nested", "theme.toml"})

    def test_reports_tracked_files_that_no_line_deploys(self):
        self.write("shell/aliases", "alias x=y\n")
        self.git("add", "shell/aliases")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("unlisted shell/aliases is tracked but no links line deploys it", result.stderr)
        self.assertEqual(self.run_link("check").returncode, 1)

    def test_reports_valid_links_that_links_no_longer_lists(self):
        (self.home / ".config/app").mkdir(parents=True)
        os.symlink(self.repo / "docs/README.md", self.home / ".config/app/README.md")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("stale    ~/.config/app/README.md -> docs/README.md", result.stderr)
        self.assertTrue((self.home / ".config/app/README.md").is_symlink())

    def test_refuses_to_link_through_a_directory_link_into_the_repository(self):
        (self.home / ".config").mkdir()
        os.symlink(self.repo / "app", self.home / ".config/app")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("conflict ~/.config/app is a directory link into the repository", result.stderr)
        self.assertEqual(result.stderr.count("conflict ~"), 1, result.stderr)
        self.assertEqual(sorted(p.name for p in (self.repo / "app").iterdir()), ["config.toml", "nested"])

    def test_rejects_targets_outside_home(self):
        self.write("links", "shell/rc ~/../escaped\nbin/ ~/.local/bin/\n")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("links:1: ~/../escaped is not inside the home directory", result.stderr)
        self.assertFalse(os.path.lexists(self.tmp / "escaped"))
        self.assertEqual(list(self.home.iterdir()), [])

    def test_rejects_a_link_inside_another_links_destination(self):
        # ~/.app would link to repo/app, so ~/.app/new would land in the checkout.
        self.write("links", "app ~/.app\nshell/rc ~/.app/new\nbin/ ~/.local/bin/\n")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("~/.app/new lies inside ~/.app, which is itself listed as a link", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertEqual(sorted(p.name for p in (self.repo / "app").iterdir()), ["config.toml", "nested"])

    def test_never_scans_or_prunes_through_a_directory_link_into_the_repository(self):
        # An empty mirror has no links to classify; its stale scan must still stop.
        (self.repo / "empty").mkdir()
        self.write("links", MANIFEST + "empty/ ~/.config/holder/\n")
        (self.repo / "holder/holder").mkdir(parents=True)
        os.symlink(self.repo / "gone", self.repo / "holder/holder/dangling")
        os.symlink(self.repo / "holder", self.home / ".config")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("conflict ~/.config is a directory link into the repository", result.stderr)
        self.assertTrue(os.path.islink(self.repo / "holder/holder/dangling"))

    def test_directory_links_elsewhere_are_refused_too(self):
        outside = self.tmp / "outside"
        (outside / "holder").mkdir(parents=True)
        os.symlink(self.repo / "gone", outside / "holder/dangling")
        (self.repo / "empty").mkdir()
        os.symlink(outside, self.home / ".config")          # ancestor of every ~/.config target
        (self.home / ".local").mkdir()
        os.symlink(outside, self.home / ".local/bin")       # a mirrored root itself
        self.write("links", MANIFEST + "empty/ ~/.config/holder/\n")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("conflict ~/.config is a directory link elsewhere", result.stderr)
        self.assertIn("conflict ~/.local/bin is a directory link elsewhere", result.stderr)
        self.assertEqual(sorted(p.name for p in outside.iterdir()), ["holder"])
        self.assertTrue(os.path.islink(outside / "holder/dangling"))
        self.assertFalse(os.path.lexists(self.home / ".shellrc"))

    def test_a_parent_swapped_after_planning_cannot_redirect_creation(self):
        module = self.load_module()
        plan = module.build_plan(str(self.home))
        self.assertEqual((plan.conflicts, plan.errors), ([], []))
        (self.repo / "holder").mkdir()
        os.symlink(self.repo / "holder", self.home / ".config")
        created, repaired, removed, changed = self.execute(module, plan)
        self.assertEqual(list((self.repo / "holder").iterdir()), [])
        self.assertTrue(any(line.startswith("~/.config/app/config.toml has a parent") for line in changed), changed)
        self.assertLinked(".shellrc", "shell/rc")

    def test_a_parent_swapped_after_planning_cannot_redirect_repair_or_removal(self):
        (self.home / ".config/app").mkdir(parents=True)
        old = str(self.repo / "app/old/config.toml")
        gone = str(self.repo / "app/old/gone.toml")
        os.symlink(old, self.home / ".config/app/config.toml")
        os.symlink(gone, self.home / ".config/app/gone.toml")
        module = self.load_module()
        plan = module.build_plan(str(self.home))
        self.assertEqual((len(plan.repair), len(plan.prune)), (1, 1))
        # Same link values, but now inside the checkout behind a swapped parent.
        (self.repo / "trap").mkdir()
        os.symlink(old, self.repo / "trap/config.toml")
        os.symlink(gone, self.repo / "trap/gone.toml")
        os.rename(self.home / ".config/app", self.home / ".config/app.moved")
        os.symlink(self.repo / "trap", self.home / ".config/app")
        created, repaired, removed, changed = self.execute(module, plan)
        self.assertEqual((repaired, removed), (0, 0))
        self.assertEqual(os.readlink(self.repo / "trap/config.toml"), old)
        self.assertEqual(os.readlink(self.repo / "trap/gone.toml"), gone)

    def test_overlapping_mirrors_remove_a_dangling_link_once(self):
        (self.repo / "empty").mkdir()
        self.write("links", MANIFEST + "empty/ ~/.config/app/nested/\n")
        (self.home / ".config/app/nested").mkdir(parents=True)
        os.symlink(self.repo / "app/gone.toml", self.home / ".config/app/nested/gone.toml")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 removed", result.stdout)
        self.assertFalse(os.path.lexists(self.home / ".config/app/nested/gone.toml"))
        self.assertEqual(self.run_link("check").returncode, 0)

    def test_rejects_targets_inside_the_repository(self):
        self.write("links", "shell/rc ~/repo/rc-copy\nbin/ ~/.local/bin/\n")
        # Put the fixture repository inside home, as ~/dotfiles is.
        result = subprocess.run(["/usr/bin/python3", str(self.repo / "bin" / "dotfiles-link"), "apply",
                                 "--home", str(self.tmp)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn("links:1: ~/repo/rc-copy is inside the repository", result.stderr)
        self.assertFalse(os.path.lexists(self.repo / "rc-copy"))

    def run_link_with_home(self, home, *args):
        return subprocess.run(["/usr/bin/python3", str(self.repo / "bin" / "dotfiles-link"), *args,
                               "--home", str(home)], capture_output=True, text=True)

    def test_a_mirror_containing_the_checkout_never_scans_or_prunes_inside_it(self):
        (self.repo / "empty").mkdir()
        os.symlink(self.repo / "missing", self.repo / "owned-link")
        self.write("links", "empty/ ~/\n")
        result = self.run_link_with_home(self.tmp, "apply")  # the repository lives in this home
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(os.path.islink(self.repo / "owned-link"))

    def test_a_differently_cased_path_into_the_checkout_is_refused(self):
        variant = self.tmp / "REPO"
        if not variant.exists():
            self.skipTest("case-sensitive filesystem")
        self.write("links", "shell/rc ~/REPO/injected\nbin/ ~/.local/bin/\n")
        result = self.run_link_with_home(self.tmp, "apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("conflict ~/REPO resolves into the repository", result.stderr)
        self.assertFalse(os.path.lexists(self.repo / "injected"))

    def test_home_replaced_after_planning_is_refused(self):
        module = self.load_module()
        trap = self.repo / "trap"
        trap.mkdir()
        moved = self.tmp / "home.moved"
        original = module.build_plan

        def swap_home_after_planning(home):
            plan = original(home)
            os.rename(self.home, moved)
            os.symlink(trap, self.home)
            return plan
        module.build_plan = swap_home_after_planning
        fd = os.open(self.home, os.O_RDONLY | os.O_DIRECTORY)  # pinned before planning, as main() does
        try:
            self.assertEqual(module.run("apply", True, str(self.home), fd), 1)
        finally:
            os.close(fd)
        self.assertEqual(list(trap.iterdir()), [])
        self.assertEqual(list(moved.iterdir()), [])

    def test_a_parent_moved_after_opening_is_skipped(self):
        module = self.load_module()
        plan = module.build_plan(str(self.home))
        original = module.open_parent
        captured = self.repo / "captured"

        def move_parent_into_checkout(home_fd, plan, target, create):
            fd, name = original(home_fd, plan, target, create)
            if target.endswith("app/config.toml") and not captured.exists():
                os.rename(os.path.dirname(target), captured)
            return fd, name
        module.open_parent = move_parent_into_checkout
        created, repaired, removed, changed = self.execute(module, plan)
        self.assertFalse(os.path.lexists(captured / "config.toml"))
        self.assertIn("~/.config/app/config.toml has a parent that moved while apply ran; left alone", changed)

    def test_a_change_made_while_the_parent_had_moved_is_undone(self):
        module = self.load_module()
        plan = module.build_plan(str(self.home))
        calls = {}

        def moved_on_second_check(fd, directory):
            calls[directory] = calls.get(directory, 0) + 1
            return not (directory.endswith("/.config/app") and calls[directory] == 2)
        module.still_in_place = moved_on_second_check
        created, repaired, removed, changed = self.execute(module, plan)
        self.assertFalse(os.path.lexists(self.home / ".config/app/config.toml"))
        self.assertIn("~/.config/app/config.toml has a parent that moved while apply ran (change undone); left alone",
                      changed)

    def test_targets_differing_only_in_case_are_an_error(self):
        self.write("links", "app/config.toml ~/Config\nshell/rc ~/config\nbin/ ~/.local/bin/\n")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("~/Config and ~/config differ only in case", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])

    def test_case_aliased_mirrors_remove_a_dangling_link_once(self):
        (self.home / "app").mkdir()
        if not (self.home / "APP").exists():
            self.skipTest("case-sensitive filesystem")
        (self.repo / "empty").mkdir()
        self.write("links", "empty/ ~/app/\nempty/ ~/APP/\nbin/ ~/.local/bin/\n")
        os.symlink(self.repo / "gone", self.home / "app/gone")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 removed", result.stdout)

    def test_repair_and_removal_made_while_the_parent_had_moved_are_undone(self):
        (self.home / ".config/app").mkdir(parents=True)
        old = str(self.repo / "app/old/config.toml")
        gone = str(self.repo / "app/old/gone.toml")
        os.symlink(old, self.home / ".config/app/config.toml")
        os.symlink(gone, self.home / ".config/app/gone.toml")
        module = self.load_module()
        plan = module.build_plan(str(self.home))
        plan.create = []
        calls = {}

        def moved_on_every_second_check(fd, directory):
            calls[directory] = calls.get(directory, 0) + 1
            return calls[directory] % 2 == 1
        module.still_in_place = moved_on_every_second_check
        created, repaired, removed, changed = self.execute(module, plan)
        self.assertEqual((repaired, removed), (0, 0))
        self.assertEqual(os.readlink(self.home / ".config/app/config.toml"), old)
        self.assertEqual(os.readlink(self.home / ".config/app/gone.toml"), gone)
        self.assertEqual(len([line for line in changed if "(change undone)" in line]), 2)

    def test_permission_errors_are_reported_per_target(self):
        (self.home / ".config/app/nested").mkdir(parents=True)
        os.chmod(self.home / ".config/app/nested", 0o555)
        self.addCleanup(os.chmod, self.home / ".config/app/nested", 0o755)
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("conflict ~/.config/app/nested/theme.toml could not be changed: Permission denied",
                      result.stderr)
        self.assertIn("links in place", result.stdout)
        self.assertLinked(".config/app/config.toml", "app/config.toml")

    def test_a_target_created_after_planning_is_never_overwritten(self):
        module = self.load_module()
        plan = module.build_plan(str(self.home))
        self.assertEqual(plan.conflicts, [])
        self.write(".shellrc", "written by an application\n", root=self.home)
        created, repaired, removed, changed = self.execute(module, plan)
        self.assertEqual((self.home / ".shellrc").read_text(), "written by an application\n")
        self.assertEqual(changed, ["~/.shellrc appeared while apply ran; left alone"])
        self.assertLinked(".config/app/config.toml", "app/config.toml")

    def test_repair_and_removal_recheck_the_target_first(self):
        (self.home / ".config/app").mkdir(parents=True)
        os.symlink(self.repo / "app/old/config.toml", self.home / ".config/app/config.toml")
        os.symlink(self.repo / "app/old/gone.toml", self.home / ".config/app/gone.toml")
        module = self.load_module()
        plan = module.build_plan(str(self.home))
        self.assertEqual(len(plan.repair), 1)
        self.assertEqual(len(plan.prune), 1)
        for name in ("config.toml", "gone.toml"):
            os.unlink(self.home / ".config/app" / name)
            self.write(f".config/app/{name}", "application data\n", root=self.home)
        created, repaired, removed, changed = self.execute(module, plan)
        self.assertEqual((repaired, removed), (0, 0))
        self.assertEqual(len(changed), 2)
        for name in ("config.toml", "gone.toml"):
            self.assertEqual((self.home / ".config/app" / name).read_text(), "application data\n")

    def test_ignore_rules_match_path_endings_like_stow(self):
        self.write("links", "tmux/ ~/.config/tmux/\napp/ ~/.config/app/\nbin/ ~/.local/bin/\n")
        self.write("tmux/tmux.conf", "set -g x y\n")
        self.write("tmux/plugins/tpm/tpm", "x")
        for name in ("mcp-auth.json", "models-store.json", "auth.json.bak", ".zcompdump-host-5.9"):
            self.write(f"app/{name}", "x")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLinked(".config/tmux/tmux.conf", "tmux/tmux.conf")
        self.assertFalse((self.home / ".config/tmux/plugins").exists())
        names = {p.name for p in (self.home / ".config/app").iterdir()}
        # Stow anchored each --ignore regex at the end of the path only.
        self.assertIn("auth.json.bak", names)
        self.assertFalse(names & {"mcp-auth.json", "models-store.json", ".zcompdump-host-5.9"})

    def test_rejects_malformed_manifest_lines(self):
        self.write("links", "app/ ~/.config/app\nmissing ~/.missing\nshell/rc /abs/rc\n")
        result = self.run_link("apply")
        self.assertEqual(result.returncode, 1)
        self.assertIn("links:1: put a trailing slash on both paths or on neither", result.stderr)
        self.assertIn("links:2: missing does not exist", result.stderr)
        self.assertIn("links:3: the home path must start with ~/", result.stderr)
        self.assertEqual(list(self.home.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
