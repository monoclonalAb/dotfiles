"""review checks with fake herdr-app, hc and gh and real git clones in a temporary
HOME; never touch the real app, core or GitHub."""

from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2] / "bin" / "review"
loader = SourceFileLoader("review", str(SOURCE))
review = module_from_spec(spec_from_loader(loader.name, loader))
loader.exec_module(review)

LINK = "https://github.com/Owner/App/pull/8"
LABEL = "review.pr=https://github.com/owner/app/pull/8"

# Each fake logs its arguments and answers from FAKE_STATE.
FAKE_APP = r'''#!/usr/bin/python3
import json, os, sys
state = json.load(open(os.environ["FAKE_STATE"]))
args = sys.argv[1:]
open(os.environ["FAKE_LOG"], "a").write(json.dumps(["herdr-app", *args]) + "\n")
if args == ["ls"]:
    print(json.dumps({"spaces": state["spaces"]}))
elif args[:2] == ["do", "space.new"]:
    print(json.dumps({"space": "sp9", "tab": "tb9", "terminal": "t9"}))
else:
    print(json.dumps({"ok": True}))
'''

FAKE_HC = r'''#!/usr/bin/python3
import json, os, sys
state = json.load(open(os.environ["FAKE_STATE"]))
args = sys.argv[1:]
open(os.environ["FAKE_LOG"], "a").write(json.dumps(["hc", *args]) + "\n")
if args[0] == "ls":
    want = args[args.index("--label") + 1].split("=", 1)
    print(json.dumps({"terminals": [t for t in state["terminals"] if t["labels"].get(want[0]) == want[1]]}))
elif args[0] == "get":
    print(json.dumps({"address": args[1], "foreground": {"cwd": state.get("cwd", {}).get(args[1])}}))
'''

FAKE_GH = r'''#!/usr/bin/python3
import json, os, sys
state = json.load(open(os.environ["FAKE_STATE"]))
open(os.environ["FAKE_LOG"], "a").write(json.dumps(["gh", *sys.argv[1:]]) + "\n")
if state.get("gh_error"):
    sys.stderr.write(state["gh_error"] + "\n"); sys.exit(1)
print(json.dumps({"number": 8, "title": "Fix login"}))
'''


def git(*args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


class ReviewTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(os.path.realpath(self.tmp.name))
        bin_dir = self.home / ".local/bin"
        bin_dir.mkdir(parents=True)
        for name, text in (("herdr-app", FAKE_APP), ("hc", FAKE_HC), ("gh", FAKE_GH)):
            (bin_dir / name).write_text(text)
            (bin_dir / name).chmod(0o755)
        self.state_path, self.log = self.home / "state.json", self.home / "log"
        self.state = {"spaces": [], "terminals": []}
        self.env = {"HOME": str(self.home), "FAKE_STATE": str(self.state_path), "FAKE_LOG": str(self.log)}

    def tearDown(self):
        self.tmp.cleanup()

    def clone(self, relative, remote="git@github.com:owner/app.git"):
        path = self.home / relative
        path.mkdir(parents=True)
        git("init", "-q", "-b", "main", cwd=path)
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start", cwd=path)
        git("remote", "add", "origin", remote, cwd=path)
        return path

    def environments(self, assign):
        shared = self.home / ".config/herdr-app/shared.json"
        shared.parent.mkdir(parents=True, exist_ok=True)
        shared.write_text(json.dumps({"spaces-env": {"active": "personal", "assign": assign}}))

    def review(self, *args):
        self.state_path.write_text(json.dumps(self.state))
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = review.main(list(args), env=self.env)
        return code, out.getvalue(), err.getvalue()

    def calls(self, program=None):
        if not self.log.exists():
            return []
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return [c[1:] for c in calls if c[0] == program] if program else calls

    def made(self):
        return [json.loads(c[2]) for c in self.calls("herdr-app") if c[:2] == ["do", "space.new"]]

    def test_starts_in_the_main_checkout_of_a_space_showing_the_repository(self):
        main = self.clone("Desktop/projects/DE/app")
        worktree = self.home / ".herdr/worktrees/app/feature"
        git("worktree", "add", "-q", "-b", "feature", str(worktree), cwd=main)
        self.state["spaces"] = [{"id": "sp1", "folder": str(worktree / "sub"), "machine": None}]
        (worktree / "sub").mkdir()
        self.environments({"sp1": "work"})

        code, out, err = self.review(LINK + "/files")

        self.assertEqual(code, 0, err)
        self.assertEqual(out.splitlines(), ["Reviewing #8 Fix login", "app · under Reviews in Work"])
        [space] = self.made()
        self.assertEqual(space["name"], "#8 Fix login")
        self.assertEqual(space["folder"], str(main))
        self.assertIs(space["focus"], False)
        self.assertEqual(space["argv"][-1], f"/rho audit {LINK}")
        self.assertIn(["label", "t9", LABEL], self.calls("hc"))
        self.assertIn(["do", "spaces-env.assign:sp9=work"], [c[:2] for c in self.calls("herdr-app")])

    def test_finds_a_clone_no_space_shows(self):
        self.clone("Desktop/projects/personal/other", remote="https://github.com/owner/other")
        found = self.clone("Desktop/projects/DE/app", remote="https://github.com/Owner/App.git")

        code, _, err = self.review(LINK)

        self.assertEqual(code, 0, err)
        self.assertEqual(self.made()[0]["folder"], str(found))
        # No Space shows the repository: it joins the environment you are in.
        self.assertFalse([c for c in self.calls("herdr-app") if c[1:2] and c[1].startswith("spaces-env.")])

    def test_a_space_whose_terminal_moved_into_the_clone_counts(self):
        # A Space made in one folder whose shell now works in the clone, like
        # genius-de02 made from raywhite-crm-migration.
        other = self.clone("Desktop/projects/DE/crm", remote="https://github.com/owner/crm")
        main = self.clone("Desktop/projects/DE/app")
        self.state["spaces"] = [{"id": "sp1", "folder": str(other), "machine": None,
                                 "tabs": [{"id": "tb1", "terminals": [{"terminal": "t1"}]}]}]
        self.state["cwd"] = {"t1": str(main / "src")}
        (main / "src").mkdir()
        self.environments({"sp1": "work"})

        code, _, err = self.review(LINK)

        self.assertEqual(code, 0, err)
        self.assertEqual(self.made()[0]["folder"], str(main))
        self.assertIn(["do", "spaces-env.assign:sp9=work"], [c[:2] for c in self.calls("herdr-app")])

    def test_with_no_space_on_the_repository_it_joins_its_owners_environment(self):
        self.clone("Desktop/projects/DE/app")
        sibling = self.clone("Desktop/projects/DE/billing", remote="git@github.com:Owner/billing.git")
        mine = self.clone("Desktop/projects/personal/site", remote="https://github.com/me/site")
        self.state["spaces"] = [
            {"id": "sp1", "folder": str(mine), "machine": None},
            {"id": "sp2", "folder": str(sibling), "machine": None},
        ]
        self.environments({"sp1": "personal", "sp2": "work"})

        code, _, err = self.review(LINK)

        self.assertEqual(code, 0, err)
        self.assertIn(["do", "spaces-env.assign:sp9=work"], [c[:2] for c in self.calls("herdr-app")])

    def test_without_a_clone_nothing_starts(self):
        self.clone("Desktop/projects/personal/other", remote="https://github.com/owner/other")

        code, _, err = self.review(LINK)

        self.assertEqual(code, 1)
        self.assertIn("no local clone of Owner/App", err)
        self.assertEqual(self.made(), [])

    def test_a_pull_request_already_under_review_is_not_started_twice(self):
        self.clone("Desktop/projects/DE/app")
        self.state["terminals"] = [{"address": "t4", "state": "live", "labels": {"review.pr": LABEL.split("=", 1)[1]}}]

        code, out, err = self.review(LINK.replace("Owner/App", "owner/app"))

        self.assertEqual(code, 0, err)
        self.assertTrue(out.startswith("Already reviewing #8 Fix login"))
        self.assertEqual(self.made(), [])

    def test_dry_run_changes_nothing(self):
        self.clone("Desktop/projects/DE/app")

        code, out, err = self.review("--dry-run", LINK)

        self.assertEqual(code, 0, err)
        self.assertEqual(json.loads(out)["label"], LABEL)
        self.assertEqual(self.made(), [])
        self.assertFalse([c for c in self.calls("hc") if c[0] == "label"])

    def test_a_link_gh_cannot_read_starts_nothing(self):
        self.clone("Desktop/projects/DE/app")
        self.state["gh_error"] = "GraphQL: Could not resolve to a PullRequest with the number of 8."

        code, _, err = self.review(LINK)

        self.assertEqual(code, 1)
        self.assertIn("Could not resolve to a PullRequest", err)
        self.assertEqual(self.made(), [])

    def test_only_pull_request_links_are_taken(self):
        self.assertEqual(review.parse_link("https://github.com/o/r/pull/12#discussion_r1")["link"], "https://github.com/o/r/pull/12")
        for text in ("https://github.com/o/r/issues/12", "https://gitlab.com/o/r/pull/12", "o/r#12", "", "https://github.com/o/r/pull/12; rm -rf ~"):
            self.assertIsNone(review.parse_link(text), text)
        code, _, err = self.review("https://github.com/o/r/issues/12")
        self.assertEqual(code, 1)
        self.assertIn("not a GitHub pull request link", err)

    def test_the_space_runs_pi_on_rho_audit_then_leaves_a_shell(self):
        self.clone("Desktop/projects/DE/app")
        record = self.home / "pi-args"
        fake_pi = self.home / "fake pi"
        fake_pi.write_text(f'#!/bin/sh\nfor a do printf "%s\\n" "$a"; done > "{record}"\n')
        fake_pi.chmod(0o755)
        self.env["REVIEW_PI"] = str(fake_pi)

        self.assertEqual(self.review(LINK)[0], 0)
        argv = self.made()[0]["argv"]
        # As the Space's terminal would run it: a clean login shell, no input.
        subprocess.run(argv, env={"HOME": str(self.home), "PATH": "/usr/bin:/bin"}, stdin=subprocess.DEVNULL,
                       capture_output=True, timeout=30, check=True)
        self.assertEqual(record.read_text().splitlines(), ["--", f"/rho audit {LINK}"])


if __name__ == "__main__":
    unittest.main()
