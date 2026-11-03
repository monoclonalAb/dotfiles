"""Tests for bin/rho-may-merge with temporary repositories and HOME."""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "bin" / "rho-may-merge"


class RhoMayMergeTest(unittest.TestCase):
    def setUp(self):
        self.home = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.home)
        self.personal = self.home / "Desktop/projects/personal"

    def git(self, *args, cwd):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)

    def repo(self, path, origin=None):
        path.mkdir(parents=True)
        self.git("init", "-q", "-b", "main", cwd=path)
        self.git("-c", "user.name=t", "-c", "user.email=t@example.com",
                 "commit", "-q", "--allow-empty", "-m", "init", cwd=path)
        if origin:
            self.git("remote", "add", "origin", origin, cwd=path)
        return path

    def check(self, cwd):
        result = subprocess.run([str(SCRIPT)], cwd=cwd, capture_output=True, text=True,
                                env={"HOME": str(self.home), "PATH": "/usr/bin:/bin:/opt/homebrew/bin"})
        return result.returncode, result.stdout.strip()

    def test_own_repository_in_the_personal_folder_is_allowed(self):
        for origin in ("https://github.com/monoclonalAb/website.git",
                       "git@github.com:monoclonalAb/website.git",
                       "https://github.com/monoclonalAb/website"):
            with self.subTest(origin=origin):
                shutil.rmtree(self.personal, ignore_errors=True)
                repo = self.repo(self.personal / "website", origin)
                code, out = self.check(repo)
                self.assertEqual(code, 0, out)
                self.assertEqual(out, "yes: monoclonalAb/website is a personal repository")

    def test_linked_worktree_elsewhere_counts_as_its_main_repository(self):
        repo = self.repo(self.personal / "beacon", "https://github.com/monoclonalAb/beacon.git")
        worktree = self.home / ".herdr/worktrees/beacon/task-x"
        self.git("worktree", "add", "-q", "-b", "task-x", str(worktree), cwd=repo)
        self.assertEqual(self.check(worktree)[0], 0)

    def test_someone_elses_repository_in_the_personal_folder_is_refused(self):
        repo = self.repo(self.personal / "umsa", "https://github.com/UoaWDCC/umsa.git")
        code, out = self.check(repo)
        self.assertEqual(code, 1)
        self.assertIn("belongs to UoaWDCC", out)

    def test_own_repository_outside_the_personal_folder_is_refused(self):
        repo = self.repo(self.home / "Desktop/projects/DE/thing",
                         "https://github.com/monoclonalAb/thing.git")
        code, out = self.check(repo)
        self.assertEqual(code, 1)
        self.assertIn("is not under", out)

    def test_similar_folder_name_is_not_the_personal_folder(self):
        repo = self.repo(self.home / "Desktop/projects/personal-old/x",
                         "https://github.com/monoclonalAb/x.git")
        self.assertEqual(self.check(repo)[0], 1)

    def test_missing_or_non_github_origin_is_refused(self):
        code, out = self.check(self.repo(self.personal / "local-only"))
        self.assertEqual(code, 1)
        self.assertIn("no origin", out)
        code, out = self.check(self.repo(self.personal / "gitlab",
                                         "https://gitlab.com/monoclonalAb/gitlab.git"))
        self.assertEqual(code, 1)

    def test_outside_any_repository_is_refused(self):
        self.personal.mkdir(parents=True)
        code, out = self.check(self.personal)
        self.assertEqual(code, 1)
        self.assertIn("not inside a Git repository", out)


if __name__ == "__main__":
    unittest.main()
