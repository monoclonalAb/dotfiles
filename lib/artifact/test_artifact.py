"""Tests for bin/artifact with a temporary store, HOME, Git repository and fake `open`."""

import datetime
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[2] / "bin" / "artifact"
TODAY = datetime.date.today().isoformat()


class ArtifactTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()).resolve()
        self.addCleanup(shutil.rmtree, self.tmp)
        self.store = self.tmp / "store"
        self.work = self.tmp / "work"
        self.work.mkdir()
        fake_bin = self.tmp / "bin"
        fake_bin.mkdir()
        self.opened = self.tmp / "opened.txt"
        (fake_bin / "open").write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" >> "{self.opened}"\n')
        (fake_bin / "open").chmod(0o755)
        self.env = {"HOME": str(self.tmp / "home"), "ARTIFACTS_DIR": str(self.store),
                    "PATH": f"{fake_bin}:/usr/bin:/bin:/opt/homebrew/bin"}

    def run_artifact(self, *args, cwd=None, env=None, ok=True):
        result = subprocess.run([str(SCRIPT), *args], cwd=cwd or self.work, capture_output=True,
                                text=True, env={**self.env, **(env or {})})
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def new(self, slug, title="Title", summary="Summary", tags="", *extra, cwd=None, env=None):
        out = self.run_artifact("new", slug, "--title", title, "--summary", summary,
                                "--tags", tags, *extra, cwd=cwd, env=env).stdout.strip()
        return Path(out)

    def meta(self, folder):
        return json.loads((folder / "artifact.json").read_text())

    def git(self, *args, cwd):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)

    def test_new_makes_a_dated_folder_with_details_and_lists_it_in_the_gallery(self):
        folder = self.new("PR 284 Audit!", "PR 284 audit", "Checks each file", "Audit, pr,audit",
                          env={"PI_SESSION_FILE": "/sessions/s.jsonl"})
        self.assertEqual(folder, self.store / f"{TODAY}-pr-284-audit")
        self.assertTrue(folder.is_dir())
        meta = self.meta(folder)
        self.assertEqual(meta["title"], "PR 284 audit")
        self.assertEqual(meta["summary"], "Checks each file")
        self.assertEqual(meta["tags"], ["audit", "pr"])
        self.assertEqual(meta["entry"], "index.html")
        self.assertEqual(meta["session"], "/sessions/s.jsonl")
        self.assertEqual(meta["project"], str(self.work))
        self.assertEqual(self.store.stat().st_mode & 0o777, 0o700)
        gallery = (self.store / "index.html").read_text()
        self.assertIn(f'href="{TODAY}-pr-284-audit/index.html"', gallery)
        self.assertIn("no page yet", gallery)

    def test_same_slug_on_the_same_day_gets_a_new_folder(self):
        first = self.new("report")
        second = self.new("report")
        self.assertEqual(second.name, f"{TODAY}-report-2")
        self.assertNotEqual(first, second)

    def test_project_is_the_main_checkout_even_from_a_worktree(self):
        repo = self.tmp / "repos" / "website"
        repo.mkdir(parents=True)
        self.git("init", "-q", "-b", "main", cwd=repo)
        self.git("-c", "user.name=t", "-c", "user.email=t@example.com",
                 "commit", "-q", "--allow-empty", "-m", "init", cwd=repo)
        worktree = self.tmp / "worktrees" / "website-books"
        self.git("worktree", "add", "-q", "-b", "books", str(worktree), cwd=repo)
        (worktree / "sub").mkdir()
        folder = self.new("books", cwd=worktree / "sub")
        self.assertEqual(self.meta(folder)["project"], str(repo))
        listed = self.run_artifact("list", "--here", "--json", cwd=repo).stdout
        self.assertEqual([m["id"] for m in json.loads(listed)], [folder.name])
        self.assertEqual(json.loads(self.run_artifact("list", "--here", "--json").stdout), [])

    def test_from_copies_an_earlier_page_and_records_where_it_came_from(self):
        source = self.new("first-audit")
        (source / "index.html").write_text("<p>layout</p>")
        (source / "assets").mkdir()
        (source / "assets" / "app.css").write_text("body{}")
        copy = self.new("second-audit", "Second", "Next one", "", "--from", "first-aud")
        self.assertEqual((copy / "index.html").read_text(), "<p>layout</p>")
        self.assertTrue((copy / "assets" / "app.css").is_file())
        meta = self.meta(copy)
        self.assertEqual(meta["from"], source.name)
        self.assertEqual(meta["title"], "Second")

    def test_add_copies_a_file_or_folder_and_leaves_the_original(self):
        page = self.tmp / "desk" / "rundown.html"
        page.parent.mkdir()
        page.write_text("<html><head><title> AI &amp; 12a\n rundown </title></head></html>")
        folder = Path(self.run_artifact("add", str(page), "--summary", "What 12a does").stdout.strip())
        self.assertTrue(page.is_file())
        meta = self.meta(folder)
        self.assertEqual(meta["title"], "AI & 12a rundown")
        self.assertEqual(meta["entry"], "rundown.html")
        self.assertEqual(meta["imported_from"], str(page))
        self.assertEqual((folder / "rundown.html").read_text(), page.read_text())

        mock = self.tmp / "desk" / "mock"
        mock.mkdir()
        (mock / "index.html").write_text("<p>mock</p>")
        (mock / "a.html").write_text("<p>other</p>")
        folder = Path(self.run_artifact("add", str(mock), "--summary", "A mock",
                                        "--slug", "outlook-mock").stdout.strip())
        self.assertTrue(folder.name.endswith("-outlook-mock"))
        self.assertEqual(self.meta(folder)["entry"], "index.html")
        self.assertEqual(self.meta(folder)["title"], "index")
        self.assertTrue((mock / "index.html").is_file())

    def test_add_refuses_a_repository_or_the_store(self):
        repo = self.tmp / "repo"
        repo.mkdir()
        (repo / ".git").mkdir()
        (repo / "page.html").write_text("x")
        result = self.run_artifact("add", str(repo), "--summary", "s", ok=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("repository", result.stderr)
        self.new("existing")
        result = self.run_artifact("add", str(self.tmp), "--summary", "s", ok=False)
        self.assertEqual(result.returncode, 1)

    def test_list_filters_by_all_words_and_tags_newest_first(self):
        old = self.new("old-audit", "Old PR audit", "Billing service", "audit")
        new = self.new("new-audit", "New PR audit", "Search service", "audit,pr")
        self.new("explainer", "Queues explained", "How the job queue retries", "explainer")
        meta = self.meta(old)
        meta["updated"] = "2020-01-01T00:00:00+13:00"
        (old / "artifact.json").write_text(json.dumps(meta))

        out = self.run_artifact("list", "AUDIT").stdout
        self.assertLess(out.index(new.name), out.index(old.name))
        self.assertNotIn("explainer", out)
        self.assertIn("(no page yet)", out)
        ids = [m["id"] for m in json.loads(self.run_artifact("list", "audit", "billing", "--json").stdout)]
        self.assertEqual(ids, [old.name])
        ids = [m["id"] for m in json.loads(self.run_artifact("list", "--tag", "pr", "--json").stdout)]
        self.assertEqual(ids, [new.name])
        limited = self.run_artifact("list", "-n", "1").stdout
        self.assertIn("... 2 more", limited)
        self.assertEqual(self.run_artifact("list", "nothing-like-this").stdout.strip(), "no artifacts match")

    def test_update_marks_a_change_and_replaces_details(self):
        folder = self.new("report", "Old", "Old summary", "a,b")
        meta = self.meta(folder)
        meta["updated"] = "2020-01-01T00:00:00+13:00"
        (folder / "artifact.json").write_text(json.dumps(meta))
        self.run_artifact("update", "report", "--summary", "New summary", "--tags", "c")
        meta = self.meta(folder)
        self.assertEqual(meta["title"], "Old")
        self.assertEqual(meta["summary"], "New summary")
        self.assertEqual(meta["tags"], ["c"])
        self.assertTrue(meta["updated"].startswith(TODAY))

    def test_ambiguous_or_unknown_ids_fail_with_the_candidates(self):
        self.new("audit-one")
        self.new("audit-two")
        result = self.run_artifact("show", "audit", ok=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("matches 2 artifacts", result.stderr)
        result = self.run_artifact("open", "missing", ok=False)
        self.assertIn("no artifact matches", result.stderr)

    def test_gallery_escapes_page_details(self):
        self.new("x", "<script>alert(1)</script>", 'say "hi" & <b>', "<i>")
        gallery = (self.store / "index.html").read_text()
        self.assertNotIn("<script>alert", gallery)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", gallery)
        self.assertIn("&lt;b&gt;", gallery)

    def test_open_opens_the_page_or_the_gallery(self):
        folder = self.new("page")
        result = self.run_artifact("open", "page", ok=False)
        self.assertIn("does not exist yet", result.stderr)
        (folder / "index.html").write_text("<p>hi</p>")
        self.run_artifact("open", "page")
        self.run_artifact("open")
        self.assertEqual(self.opened.read_text().splitlines(),
                         [str(folder / "index.html"), str(self.store / "index.html")])

    def test_show_and_path(self):
        folder = self.new("page")
        (folder / "index.html").write_text("x")
        shown = json.loads(self.run_artifact("show", "page").stdout)
        self.assertEqual(shown["entry_path"], str(folder / "index.html"))
        self.assertEqual(shown["files"], ["index.html"])
        self.assertEqual(self.run_artifact("path").stdout.strip(), str(self.store))
        self.assertEqual(self.run_artifact("path", "page").stdout.strip(), str(folder))

    def test_broken_details_are_skipped_not_fatal(self):
        self.new("good")
        broken = self.store / "2020-01-01-broken"
        broken.mkdir()
        (broken / "artifact.json").write_text("{not json")
        result = self.run_artifact("list")
        self.assertIn("-good", result.stdout)
        self.assertIn("skipping", result.stderr)


if __name__ == "__main__":
    unittest.main()
