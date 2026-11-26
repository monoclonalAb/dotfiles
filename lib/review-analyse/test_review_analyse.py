"""review-analyse checks: real Git repositories in a temporary HOME. A bare
repository stands in for GitHub (reached through url.insteadOf, as the real
https://github.com/<owner>/<repo>.git would be) and a fake gh answers
`gh pr view`. Run with:

PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover -s lib/review-analyse -p 'test_*.py'
"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
COMMAND = ROOT / "bin" / "review-analyse"
LINK = "https://github.com/example/app/pull/7"
EIGHT_MIB = 8 << 20

FAKE_GH = """#!/usr/bin/python3
import json, os, sys
home = os.environ["HOME"]
with open(os.path.join(home, "gh.log"), "a") as log:
    log.write(json.dumps(sys.argv[1:]) + "\\n")
state = json.load(open(os.path.join(home, "gh.json")))
if state.get("fail"):
    sys.stderr.write(state["fail"] + "\\n")
    sys.exit(1)
if sys.argv[1:3] == ["pr", "view"]:
    print(json.dumps(state["pr"]))
    sys.exit(0)
sys.stderr.write("fake gh: unexpected %r\\n" % sys.argv[1:])
sys.exit(2)
"""


def git(*args, cwd=None):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


class ReviewAnalyse(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.home = self.tmp / "home"
        (self.home / ".local/bin").mkdir(parents=True)
        gh = self.home / ".local/bin/gh"
        gh.write_text(FAKE_GH)
        gh.chmod(0o755)
        (self.home / ".gitconfig").write_text(
            f'[url "file://{self.tmp}/remotes/"]\n\tinsteadOf = https://github.com/\n'
            "[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n"
        )
        self.remote = self.tmp / "remotes/example/app.git"
        self.remote.parent.mkdir(parents=True)
        git("init", "-q", "--bare", str(self.remote))
        git("config", "uploadpack.allowFilter", "true", cwd=self.remote)
        git("config", "uploadpack.allowAnySHA1InWant", "true", cwd=self.remote)
        self.work = self.tmp / "work"
        self.git("init", "-q", str(self.work), cwd=self.tmp)
        self.git("remote", "add", "origin", str(self.remote))

    def env(self):
        return {"HOME": str(self.home), "PATH": "/usr/bin:/bin"}

    def git(self, *args, cwd=None):
        return subprocess.run(["git", *args], cwd=cwd or self.work, check=True, capture_output=True, text=True,
                              env={**self.env(), "GIT_CONFIG_NOSYSTEM": "1"}).stdout.strip()

    def write(self, path, text):
        target = self.work / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text) if isinstance(text, str) else target.write_bytes(text)

    def commit(self, message):
        self.git("add", "-A")
        self.git("commit", "-q", "-m", message)
        return self.git("rev-parse", "HEAD")

    def publish(self, head, base_commit, state="OPEN"):
        """Push main and the pull request's head, and have gh describe it."""
        self.git("push", "-q", "-f", "origin", "main", f"{head}:refs/pull/7/head")
        (self.home / "gh.json").write_text(json.dumps({"pr": {
            "url": LINK, "state": state, "headRefOid": head, "baseRefName": "main", "baseRefOid": base_commit,
        }}))

    def run_command(self, *args):
        return subprocess.run([str(COMMAND), *args], capture_output=True, env=self.env(), timeout=300)

    def answer(self, *args):
        result = self.run_command(*args)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        return json.loads(result.stdout), len(result.stdout)

    def base_repo(self):
        self.write("a.txt", "one\ntwo\nthree\n")
        self.write("c.txt", "1\n2\n3\n4\n")
        self.write("d.txt", "".join(f"line {i}\n" for i in range(10)))
        return self.commit("base")

    def feature(self):
        self.git("switch", "-q", "-c", "feature")
        self.write("a.txt", "one\nTWO\nthree\nfour\n")
        self.write("b.txt", "x\ny\nz\n")
        (self.work / "c.txt").unlink()
        (self.work / "d.txt").unlink()
        self.write("e.txt", "".join(f"line {i}\n" for i in range(9)) + "line nine\n")
        self.write("img.bin", bytes(range(256)) * 4)
        return self.commit("feature")

    # The files of feature() as GitHub lists them: status and +/-.
    FEATURE_FILES = {
        "a.txt": ("modified", 2, 1),
        "b.txt": ("added", 3, 0),
        "c.txt": ("removed", 0, 4),
        "e.txt": ("renamed", 1, 1),
        "img.bin": ("added", 0, 0),
    }

    def files(self, snapshot):
        return {f["path"]: (f["status"], f["additions"], f["deletions"]) for f in snapshot["files"]}

    def test_snapshot_pins_head_merge_base_and_base_and_lists_files(self):
        base = self.base_repo()
        head = self.feature()
        self.git("switch", "-q", "main")
        self.write("later.txt", "main moved on\n")
        moved = self.commit("main moves on")
        self.publish(head, moved)

        snapshot, _ = self.answer("snapshot", LINK)
        self.assertEqual(snapshot["snapshot"], f"{head}:{base}:main")
        self.assertEqual((snapshot["head"], snapshot["merge_base"], snapshot["base"]), (head, base, "main"))
        self.assertEqual(self.files(snapshot), self.FEATURE_FILES)
        renamed = next(f for f in snapshot["files"] if f["path"] == "e.txt")
        self.assertEqual(renamed["old_path"], "d.txt")
        self.assertTrue(next(f for f in snapshot["files"] if f["path"] == "img.bin")["binary"])
        self.assertTrue((self.home / ".cache/herdr-review/example/app").is_dir())

        piece, _ = self.answer("diff", LINK, snapshot["snapshot"], "a.txt")
        self.assertIn("+TWO", piece["lines"])
        self.assertIn("-two", piece["lines"])
        self.assertIn("+four", piece["lines"])
        self.assertFalse(piece["more"])

    def test_a_merged_pull_request_keeps_its_own_files(self):
        self.base_repo()
        head = self.feature()
        self.git("switch", "-q", "main")
        self.write("later.txt", "main moved on\n")
        before_merge = self.commit("main moves on")
        self.git("merge", "-q", "--no-ff", "-m", "Merge #7", "feature")
        self.publish(head, before_merge, state="MERGED")

        snapshot, _ = self.answer("snapshot", LINK)
        self.assertEqual(self.files(snapshot), self.FEATURE_FILES)

    def test_a_pull_request_over_8_mib_is_read_in_bounded_pieces(self):
        self.base_repo()
        self.git("switch", "-q", "-c", "feature")
        lines = {f"big/{n}.txt": [f"{n:02d}-{i:06d}-" + "x" * 90 for i in range(10000)] for n in range(9)}
        for path, text in lines.items():
            self.write(path, "\n".join(text) + "\n")
        head = self.commit("nine files of about 1 MiB")
        self.publish(head, git("rev-parse", "main", cwd=self.work))
        self.assertGreater(sum(len("\n".join(t)) for t in lines.values()), 8 << 20)

        snapshot, size = self.answer("snapshot", LINK)
        self.assertLess(size, 1 << 20)
        self.assertTrue(all(not f["too_large"] and f["additions"] == 10000 for f in snapshot["files"]))
        for path, text in lines.items():
            added, start = [], 0
            while True:
                piece, size = self.answer("diff", LINK, snapshot["snapshot"], path, "--from", str(start))
                self.assertLess(size, EIGHT_MIB)
                self.assertEqual(piece["from"], start)
                added += [line[1:] for line in piece["lines"] if line.startswith("+") and not line.startswith("+++")]
                start += len(piece["lines"])
                if not piece["more"]:
                    break
            self.assertEqual(added, text, path)

    def test_an_oversized_file_says_so_instead_of_a_diff(self):
        self.base_repo()
        self.git("switch", "-q", "-c", "feature")
        self.write("seed.sql", "".join(f"insert {i};\n" for i in range(25000)))
        self.write("small.txt", "small\n")
        head = self.commit("seed")
        self.publish(head, git("rev-parse", "main", cwd=self.work))

        snapshot, _ = self.answer("snapshot", LINK)
        seed = next(f for f in snapshot["files"] if f["path"] == "seed.sql")
        self.assertEqual((seed["additions"], seed["too_large"]), (25000, True))
        self.assertFalse(next(f for f in snapshot["files"] if f["path"] == "small.txt")["too_large"])
        piece, size = self.answer("diff", LINK, snapshot["snapshot"], "seed.sql")
        self.assertEqual((piece["too_large"], piece["lines"]), (True, []))
        self.assertLess(size, 4096)

    def test_a_push_while_the_snapshot_loads_keeps_the_snapshot_whole(self):
        base = self.base_repo()
        listed = self.feature()
        self.publish(listed, base)
        # GitHub described `listed`; the branch moves before the fetch.
        self.write("b.txt", "x\ny\nz\npushed\n")
        pushed = self.commit("pushed while loading")
        self.git("push", "-q", "-f", "origin", f"{pushed}:refs/pull/7/head")

        snapshot, _ = self.answer("snapshot", LINK)
        self.assertEqual((snapshot["head"], snapshot["listed_head"]), (pushed, listed))
        self.assertEqual(self.files(snapshot)["b.txt"], ("added", 4, 0))

        # Another push after the snapshot: its pieces still show the pinned head.
        self.write("b.txt", "x\ny\nz\npushed\nagain\n")
        again = self.commit("pushed again")
        self.git("push", "-q", "-f", "origin", f"{again}:refs/pull/7/head")
        piece, _ = self.answer("diff", LINK, snapshot["snapshot"], "b.txt")
        self.assertIn("+pushed", piece["lines"])
        self.assertNotIn("+again", piece["lines"])
        fresh, _ = self.answer("snapshot", LINK)
        self.assertEqual(fresh["head"], again)

    def pieces(self, snapshot, path):
        """Every piece of one file's diff: its lines and each piece's size."""
        lines, sizes, start = [], [], 0
        while True:
            piece, size = self.answer("diff", LINK, snapshot["snapshot"], "--from", str(start), "--", path)
            lines += piece["lines"]
            sizes.append(size)
            start += len(piece["lines"])
            if not piece["more"]:
                return lines, sizes

    def test_a_piece_stays_under_8_mib_whatever_the_characters(self):
        self.base_repo()
        self.git("switch", "-q", "-c", "feature")
        text = [f"{i:05d}" + "\U0001F600" * 500 for i in range(4000)]
        self.write("faces.txt", "\n".join(text) + "\n")
        head = self.commit("emoji")
        self.publish(head, git("rev-parse", "main", cwd=self.work))
        snapshot, _ = self.answer("snapshot", LINK)
        lines, sizes = self.pieces(snapshot, "faces.txt")
        self.assertTrue(all(size < EIGHT_MIB for size in sizes), sizes)
        self.assertEqual([line[1:] for line in lines if line.startswith("+")], text)

    def test_a_merged_pull_request_whose_target_branch_is_gone(self):
        self.base_repo()
        self.git("switch", "-q", "-c", "release")
        release = self.git("rev-parse", "HEAD")
        head = self.feature()
        self.git("switch", "-q", "release")
        self.git("merge", "-q", "--no-ff", "-m", "Merge #7", "feature")
        self.git("push", "-q", "origin", "main", "release", f"{head}:refs/pull/7/head")
        self.git("push", "-q", "origin", "--delete", "release")
        (self.home / "gh.json").write_text(json.dumps({"pr": {
            "url": LINK, "state": "MERGED", "headRefOid": head, "baseRefName": "release", "baseRefOid": release,
        }}))
        snapshot, _ = self.answer("snapshot", LINK)
        self.assertEqual(self.files(snapshot), self.FEATURE_FILES)
        self.assertEqual(snapshot["base"], "release")

    def test_file_names_are_names_not_patterns_or_options(self):
        self.base_repo()
        self.git("switch", "-q", "-c", "feature")
        self.write("pages/[id].tsx", "export const id = 1;\n")
        self.write("pages/i.tsx", "export const i = 2;\n")
        self.write("-rules.txt", "no dashes please\n")
        head = self.commit("names")
        self.publish(head, git("rev-parse", "main", cwd=self.work))
        snapshot, _ = self.answer("snapshot", LINK)
        lines, _ = self.pieces(snapshot, "pages/[id].tsx")
        self.assertEqual([line for line in lines if line.startswith("+")], ["+export const id = 1;"])
        lines, _ = self.pieces(snapshot, "-rules.txt")
        self.assertEqual([line for line in lines if line.startswith("+")], ["+no dashes please"])

    def test_a_mode_change_says_so(self):
        base = self.base_repo()
        self.git("switch", "-q", "-c", "feature")
        self.git("update-index", "--chmod=+x", "a.txt")
        self.git("commit", "-q", "-m", "executable")
        head = self.git("rev-parse", "HEAD")
        self.publish(head, base)
        snapshot, _ = self.answer("snapshot", LINK)
        self.assertEqual(self.files(snapshot), {"a.txt": ("modified", 0, 0)})
        lines, _ = self.pieces(snapshot, "a.txt")
        self.assertEqual(lines, ["\\ old mode 100644", "\\ new mode 100755"])

    def test_mistakes_say_what_went_wrong(self):
        result = self.run_command("snapshot", "not a link")
        self.assertEqual(result.returncode, 1)
        self.assertIn("pull request link", result.stderr.decode())
        for link in ("https://github.com/../app/pull/7", "https://github.com/example/../pull/7"):
            result = self.run_command("snapshot", link)
            self.assertEqual(result.returncode, 1, link)
            self.assertIn("pull request link", result.stderr.decode())
        self.assertFalse((self.home / ".cache").exists())

        (self.home / "gh.json").write_text(json.dumps({"fail": "gh: To get started with GitHub CLI, please run:  gh auth login"}))
        result = self.run_command("snapshot", LINK)
        self.assertEqual(result.returncode, 1)
        self.assertIn("gh auth login", result.stderr.decode())

        base = self.base_repo()
        head = self.feature()
        self.publish(head, base)
        snapshot, _ = self.answer("snapshot", LINK)
        shutil.rmtree(self.home / ".cache/herdr-review")
        result = self.run_command("diff", LINK, snapshot["snapshot"], "a.txt")
        self.assertEqual(result.returncode, 1)
        self.assertIn("open the pull request again", result.stderr.decode())
        result = self.run_command("diff", LINK, "not-a-snapshot", "a.txt")
        self.assertEqual(result.returncode, 1)
        self.assertIn("snapshot id", result.stderr.decode())


if __name__ == "__main__":
    unittest.main()
