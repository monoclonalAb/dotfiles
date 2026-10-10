import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

import pr_status  # pyright: ignore[reportImplicitRelativeImport]

NOW = 1_000_000.0


def entry(checkout="/wt", branch="feat/x", checked_at=0.0, pr=None):
    return {"checkout": checkout, "branch": branch, "checked_at": checked_at, "pr": pr}


def pr(number=12, title="Add thing", state="open"):
    return {"number": number, "title": title, "state": state}


class ParsingTests(unittest.TestCase):
    def test_garbage_state_becomes_blank_and_bad_entries_drop(self):
        for raw in (None, [], "x", {"workspaces": []}):
            self.assertEqual(pr_status.blank_state(), pr_status.normalise_state(raw))
        state = pr_status.normalise_state(
            {
                "workspaces": {
                    "w1": {"checkout": "/a", "branch": 3, "checked_at": "x", "pr": {"number": 0}},
                    "w2": {"branch": "b"},
                    "w3": "nope",
                }
            }
        )
        self.assertEqual({"w1": entry("/a", None, 0.0, None)}, state["workspaces"])

    def test_gh_states_map_to_display_states(self):
        cases = [
            ({"state": "OPEN", "isDraft": False}, "open"),
            ({"state": "OPEN", "isDraft": True}, "draft"),
            ({"state": "MERGED", "isDraft": False}, "merged"),
            # A closed draft is closed, not draft.
            ({"state": "CLOSED", "isDraft": True}, "closed"),
        ]
        for fields, expected in cases:
            parsed = pr_status.pr_from_gh({"number": 7, "title": "T", **fields})
            self.assertEqual(pr(7, "T", expected), parsed)
        for bad in (None, [], {"number": 7, "state": "WEIRD"}, {"number": "7", "state": "OPEN"}):
            self.assertIsNone(pr_status.pr_from_gh(bad))

    def test_only_live_linked_worktrees_are_targets(self):
        workspaces = [
            {"workspace_id": "main", "worktree": {"checkout_path": "/r", "is_linked_worktree": False}},
            {"workspace_id": "wt", "worktree": {"checkout_path": "/r-wt", "is_linked_worktree": True}},
            {"workspace_id": "plain"},
            {"workspace_id": "odd", "worktree": {"checkout_path": "", "is_linked_worktree": True}},
        ]
        self.assertEqual({"wt": "/r-wt"}, pr_status.linked_worktrees(workspaces))


class PlanTests(unittest.TestCase):
    def test_new_spaces_are_claimed_and_gone_ones_forgotten(self):
        state = {"workspaces": {"gone": entry()}}

        due = pr_status.plan_refresh(state, {"w1": "/wt"}, {"w1": "feat/x"}, None, NOW)

        self.assertEqual(["w1"], due)
        self.assertEqual({"w1": entry(checked_at=NOW)}, state["workspaces"])

    def test_claim_stops_a_concurrent_event_from_looking_up_again(self):
        state = pr_status.blank_state()
        pr_status.plan_refresh(state, {"w1": "/wt"}, {"w1": "feat/x"}, "w1", NOW)

        due = pr_status.plan_refresh(state, {"w1": "/wt"}, {"w1": "feat/x"}, "w1", NOW + 1)

        self.assertEqual([], due)

    def test_current_space_refreshes_sooner_than_others(self):
        for current, age, expected in [
            ("w1", pr_status.CURRENT_TTL, ["w1"]),
            ("w1", pr_status.CURRENT_TTL - 1, []),
            (None, pr_status.CURRENT_TTL, []),
            (None, pr_status.OTHER_TTL, ["w1"]),
        ]:
            state = {"workspaces": {"w1": entry(checked_at=NOW - age, pr=pr())}}
            due = pr_status.plan_refresh(state, {"w1": "/wt"}, {"w1": "feat/x"}, current, NOW)
            self.assertEqual(expected, due, (current, age))

    def test_merged_and_closed_are_rechecked_rarely_unless_current(self):
        for state_name in pr_status.FINAL_STATES:
            state = {"workspaces": {"w1": entry(checked_at=NOW - pr_status.OTHER_TTL, pr=pr(state=state_name))}}
            self.assertEqual([], pr_status.plan_refresh(state, {"w1": "/wt"}, {"w1": "feat/x"}, None, NOW))
            self.assertEqual(["w1"], pr_status.plan_refresh(state, {"w1": "/wt"}, {"w1": "feat/x"}, "w1", NOW))

    def test_branch_or_checkout_change_drops_the_old_pr_and_rechecks(self):
        for checkout, branch in (("/wt", "feat/y"), ("/moved", "feat/x")):
            state = {"workspaces": {"w1": entry(checked_at=NOW, pr=pr())}}

            due = pr_status.plan_refresh(state, {"w1": checkout}, {"w1": branch}, None, NOW)

            self.assertEqual(["w1"], due)
            self.assertIsNone(state["workspaces"]["w1"]["pr"])

    def test_detached_head_has_no_pr_and_no_lookup(self):
        state = {"workspaces": {"w1": entry(branch=None, checked_at=0.0, pr=pr())}}

        due = pr_status.plan_refresh(state, {"w1": "/wt"}, {"w1": None}, "w1", NOW, force=True)

        self.assertEqual([], due)
        self.assertIsNone(state["workspaces"]["w1"]["pr"])

    def test_force_rechecks_fresh_entries(self):
        state = {"workspaces": {"w1": entry(checked_at=NOW, pr=pr())}}

        due = pr_status.plan_refresh(state, {"w1": "/wt"}, {"w1": "feat/x"}, None, NOW, force=True)

        self.assertEqual(["w1"], due)


class ResultTests(unittest.TestCase):
    def test_found_replaces_none_clears_error_keeps(self):
        state = {"workspaces": {"a": entry(pr=pr(1)), "b": entry(pr=pr(2)), "c": entry(pr=pr(3))}}

        pr_status.apply_results(
            state,
            {
                "a": ("feat/x", "found", pr(9, state="merged")),
                "b": ("feat/x", "none", None),
                "c": ("feat/x", "error", None),
            },
        )

        self.assertEqual(pr(9, state="merged"), state["workspaces"]["a"]["pr"])
        self.assertIsNone(state["workspaces"]["b"]["pr"])
        self.assertEqual(pr(3), state["workspaces"]["c"]["pr"])

    def test_result_for_a_branch_switched_mid_lookup_is_dropped(self):
        state = {"workspaces": {"a": entry(branch="feat/new")}}

        pr_status.apply_results(state, {"a": ("feat/x", "found", pr())})

        self.assertIsNone(state["workspaces"]["a"]["pr"])


class TokenTests(unittest.TestCase):
    def test_patches_set_new_clear_stale_and_skip_unchanged(self):
        title = "  feat: " + "x" * 100 + "\x07 "
        state = {
            "workspaces": {
                "new": entry(pr=pr(12, "Add thing", "draft")),
                "same": entry(pr=pr(5, title, "open")),
                "untitled": entry(pr=pr(6, "", "merged")),
                "none": entry(pr=None),
            }
        }
        same_tokens = {
            "pr_number": "5",
            "pr_title": pr_status.normalise_value(title),
            "pr_state": "open",
        }
        workspaces = [
            {"workspace_id": "new"},
            {"workspace_id": "same", "tokens": dict(same_tokens, sidebar_hidden="1")},
            {"workspace_id": "untitled"},
            {"workspace_id": "none", "tokens": {"pr_number": "4", "pr_state": "open"}},
            {"workspace_id": "plain", "tokens": {"pr_title": "left over"}},
            {"workspace_id": "quiet", "tokens": {"sidebar_hidden": "1"}},
        ]

        patches = pr_status.token_patches(state, workspaces)

        self.assertEqual(80, len(same_tokens["pr_title"]))
        self.assertEqual(
            {
                "new": {"pr_number": "12", "pr_title": "Add thing", "pr_state": "draft"},
                "untitled": {"pr_number": "6", "pr_state": "merged"},
                "none": {"pr_number": None, "pr_state": None},
                "plain": {"pr_title": None},
            },
            patches,
        )


# --- end to end: real Git worktree, fake gh, fake Herdr socket -----------------

FAKE_GH = """#!{python}
import json, os, subprocess, sys
branch = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True).stdout.strip()
with open(os.environ["FAKE_GH_LOG"], "a") as log:
    log.write(json.dumps({{"cwd": os.getcwd(), "branch": branch, "argv": sys.argv[1:]}}) + "\\n")
reply = json.load(open(os.environ["FAKE_GH_REPLIES"])).get(branch, {{"code": 1, "stderr": "no pull requests found for branch " + branch}})
sys.stdout.write(reply.get("stdout", ""))
sys.stderr.write(reply.get("stderr", ""))
sys.exit(reply.get("code", 0))
"""


class FakeHerdr:
    """workspace.list and workspace.report_metadata over a Unix socket."""

    def __init__(self, path, workspaces):
        self.workspaces = workspaces
        self.reports = []
        self.server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.server.bind(path)
        self.server.listen()
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while True:
            try:
                connection, _ = self.server.accept()
            except OSError:
                return
            with connection:
                request = json.loads(connection.makefile().readline())
                connection.sendall(json.dumps({"id": request["id"], "result": self.handle(request)}).encode() + b"\n")

    def handle(self, request):
        if request["method"] == "workspace.list":
            return {"type": "workspace_list", "workspaces": json.loads(json.dumps(self.workspaces))}
        params = request["params"]
        self.reports.append((params["workspace_id"], params["tokens"]))
        workspace = next(ws for ws in self.workspaces if ws["workspace_id"] == params["workspace_id"])
        tokens = workspace.setdefault("tokens", {})
        for key, value in params["tokens"].items():
            if value is None:
                tokens.pop(key, None)
            else:
                tokens[key] = value
        return {"type": "ok"}

    def tokens(self, ws_id):
        return next(ws for ws in self.workspaces if ws["workspace_id"] == ws_id).get("tokens", {})

    def close(self):
        self.server.close()


def git(*args, cwd):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


class EndToEndTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        # Unix socket paths are short on macOS; keep this one under /tmp.
        self.sock_dir = Path(tempfile.mkdtemp(dir="/tmp"))
        self.addCleanup(subprocess.run, ["rm", "-rf", str(self.tmp), str(self.sock_dir)])
        repo, self.worktree = self.tmp / "repo", self.tmp / "repo-feat"
        repo.mkdir()
        git("init", "-q", "-b", "main", cwd=repo)
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init", cwd=repo)
        git("worktree", "add", "-q", "-b", "feat/x", str(self.worktree), cwd=repo)
        bin_dir = self.tmp / "bin"
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        gh.write_text(FAKE_GH.format(python=sys.executable))
        gh.chmod(0o755)
        self.log = self.tmp / "gh.log"
        self.replies = self.tmp / "replies.json"
        self.reply("feat/x", stdout=json.dumps({"number": 12, "title": "Add thing", "state": "OPEN", "isDraft": True}))
        self.herdr = FakeHerdr(
            str(self.sock_dir / "s"),
            [
                {"workspace_id": "main", "worktree": {"checkout_path": str(repo), "is_linked_worktree": False}},
                {"workspace_id": "wt", "worktree": {"checkout_path": str(self.worktree), "is_linked_worktree": True}},
                {"workspace_id": "plain", "tokens": {"pr_number": "3", "sidebar_hidden": "1"}},
            ],
        )
        self.addCleanup(self.herdr.close)
        for patcher in (
            mock.patch.dict(
                os.environ,
                {
                    "HERDR_SOCKET_PATH": str(self.sock_dir / "s"),
                    "HERDR_PLUGIN_STATE_DIR": str(self.tmp / "state"),
                    "FAKE_GH_LOG": str(self.log),
                    "FAKE_GH_REPLIES": str(self.replies),
                    # The inherited PATH wins over the plugin's fallback directories.
                    "PATH": f"{bin_dir}:{os.environ.get('PATH', '/usr/bin:/bin')}",
                },
            ),
            mock.patch("builtins.print"),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def reply(self, branch, stdout="", stderr="", code=0):
        replies = json.loads(self.replies.read_text()) if self.replies.exists() else {}
        replies[branch] = {"stdout": stdout, "stderr": stderr, "code": code}
        self.replies.write_text(json.dumps(replies))

    def lookups(self):
        return self.log.read_text().splitlines() if self.log.exists() else []

    def test_lifecycle(self):
        drafted = {"pr_number": "12", "pr_title": "Add thing", "pr_state": "draft"}

        # Startup: one lookup in the worktree; leftover tokens elsewhere cleared.
        pr_status.refresh(force=True)
        self.assertEqual(1, len(self.lookups()))
        self.assertEqual(str(self.worktree.resolve()), os.path.realpath(json.loads(self.lookups()[0])["cwd"]))
        self.assertEqual(drafted, self.herdr.tokens("wt"))
        self.assertEqual({"sidebar_hidden": "1"}, self.herdr.tokens("plain"))
        self.assertEqual({}, self.herdr.tokens("main"))

        # An event inside the TTL neither calls gh nor re-reports.
        reports = len(self.herdr.reports)
        pr_status.refresh(current="wt")
        self.assertEqual(1, len(self.lookups()))
        self.assertEqual(reports, len(self.herdr.reports))

        # Tokens lost with a server restart come back from the cache, without gh.
        self.herdr.tokens("wt").clear()
        pr_status.refresh(current="wt")
        self.assertEqual(1, len(self.lookups()))
        self.assertEqual(drafted, self.herdr.tokens("wt"))

        # A failed lookup keeps the last result.
        self.reply("feat/x", stderr="HTTP 502: Bad Gateway", code=1)
        pr_status.refresh(force=True)
        self.assertEqual(2, len(self.lookups()))
        self.assertEqual(drafted, self.herdr.tokens("wt"))

        # Merged on GitHub.
        self.reply("feat/x", stdout=json.dumps({"number": 12, "title": "Add thing", "state": "MERGED", "isDraft": False}))
        pr_status.refresh(force=True)
        self.assertEqual(dict(drafted, pr_state="merged"), self.herdr.tokens("wt"))

        # Switching the worktree's branch drops the old PR at once; this branch has none.
        git("switch", "-q", "-c", "feat/other", cwd=self.worktree)
        pr_status.refresh()
        self.assertEqual("feat/other", json.loads(self.lookups()[-1])["branch"])
        self.assertEqual({}, self.herdr.tokens("wt"))


if __name__ == "__main__":
    unittest.main()
