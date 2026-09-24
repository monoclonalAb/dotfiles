import os
import tempfile
import unittest
from unittest.mock import patch

import next_agent  # pyright: ignore[reportImplicitRelativeImport]


class AttentionLedgerTests(unittest.TestCase):
    def observe(self, entry, status, *, focused=False, seq=None, terminal_id="term"):
        return next_agent.apply_observation(entry, status, focused, seq, terminal_id)

    def test_focusing_one_pane_keeps_the_sibling_unread(self):
        pane_a = self.observe(None, "working", seq=1, terminal_id="term_a")
        pane_a = self.observe(pane_a, "done", seq=2, terminal_id="term_a")
        pane_b = self.observe(None, "working", seq=1, terminal_id="term_b")
        pane_b = self.observe(pane_b, "done", seq=2, terminal_id="term_b")

        pane_a = self.observe(pane_a, "idle", focused=True, seq=3, terminal_id="term_a")
        pane_b = self.observe(pane_b, "idle", seq=3, terminal_id="term_b")

        self.assertIsNone(next_agent.attention_bucket("idle", pane_a))
        self.assertEqual("done", next_agent.attention_bucket("idle", pane_b))

    def test_blocked_raise_survives_downgrade_to_idle(self):
        entry = self.observe(None, "blocked", seq=1)
        self.assertEqual("blocked", entry["raised_as"])

        entry = self.observe(entry, "idle", seq=2)

        self.assertEqual("blocked", next_agent.attention_bucket("idle", entry))

    def test_completion_recovered_when_status_event_missed(self):
        entry = self.observe(None, "working", seq=1)
        entry = self.observe(entry, "idle", seq=2)

        self.assertEqual("done", next_agent.attention_bucket("idle", entry))

    def test_idle_pane_that_never_worked_is_not_a_candidate(self):
        entry = self.observe(None, "idle", seq=1)

        self.assertIsNone(next_agent.attention_bucket("idle", entry))

    def test_working_pane_is_never_a_candidate_and_clears_unread(self):
        entry = self.observe(None, "done", seq=1)
        entry = self.observe(entry, "working", seq=2)

        self.assertFalse(entry["unread"])
        self.assertIsNone(next_agent.attention_bucket("working", entry))

    def test_recycled_pane_id_resets_the_entry(self):
        entry = {
            "terminal_id": "term_a",
            "status": "done",
            "unread": True,
            "raised_as": "done",
            "worked": True,
            "seen_seq": None,
        }

        entry = self.observe(entry, "idle", seq=1, terminal_id="term_b")

        self.assertFalse(entry["worked"])
        self.assertIsNone(next_agent.attention_bucket("idle", entry))

    def test_focus_records_seen_seq_so_later_work_reraises(self):
        entry = self.observe(None, "idle", focused=True, seq=10)
        entry = self.observe(entry, "working", seq=11)
        entry = self.observe(entry, "idle", seq=12)

        self.assertEqual("done", next_agent.attention_bucket("idle", entry))

    def test_legacy_entry_upgrades(self):
        entry = self.observe({"status": "done", "unread": True}, "idle", seq=1)

        self.assertEqual("done", entry["raised_as"])
        self.assertEqual("done", next_agent.attention_bucket("idle", entry))



class SidebarDotTests(unittest.TestCase):
    def observe(self, entry, status, *, focused=False, seq=None, terminal_id="term"):
        return next_agent.apply_observation(entry, status, focused, seq, terminal_id)

    def dot(self, status, entry):
        return next_agent.dot_kind(status, next_agent.attention_bucket(status, entry))

    def test_unreviewed_completion_keeps_the_review_dot_after_the_tab_downgrade(self):
        entry = self.observe(None, "working", seq=1)
        entry = self.observe(entry, "idle", seq=2)

        self.assertEqual("review", self.dot("idle", entry))

    def test_focusing_the_pane_drops_it_to_the_idle_dot(self):
        entry = self.observe(None, "working", seq=1)
        entry = self.observe(entry, "idle", focused=True, seq=2)

        self.assertEqual("idle", self.dot("idle", entry))

    def test_blocked_pane_keeps_the_blocked_dot_while_focused(self):
        entry = self.observe(None, "blocked", focused=True, seq=1)

        self.assertEqual("blocked", self.dot("blocked", entry))

    def test_working_pane_shows_the_working_dot(self):
        entry = self.observe(None, "working", seq=1)

        self.assertEqual("working", self.dot("working", entry))

    def test_only_one_dot_token_is_ever_set(self):
        names = {name for name, _ in next_agent.DOT_TOKENS.values()}

        self.assertEqual(4, len(names))
        for status, bucket in (("blocked", "blocked"), ("idle", "done"), ("working", None), ("idle", None)):
            wanted = next_agent.wanted_tokens(status, bucket)
            self.assertEqual(1, len(wanted))
            self.assertTrue(set(wanted) <= names)


class JumpTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="next-agent-test-")
        self.addCleanup(temporary.cleanup)
        self.enterContext(patch.dict(os.environ, {"HERDR_PLUGIN_STATE_DIR": temporary.name}))
        self.enterContext(patch.object(next_agent, "plugin_config", return_value=(["blocked", "done"], "all")))
        self.live = {"focused_pane_id": "w0:p1", "focused_workspace_id": "w0", "panes": [], "agents": []}
        self.enterContext(patch.object(next_agent, "snapshot", side_effect=lambda: self.live))
        self.api = self.enterContext(patch.object(next_agent, "api"))
        self.toast = self.enterContext(patch.object(next_agent, "toast"))
        self.enterContext(patch.object(next_agent, "report_dot"))
        self.enterContext(patch.object(next_agent, "run", side_effect=AssertionError("use the pane.focus API")))
        self.add_pane("w0:p1")  # A shell is a valid return target.

    def add_pane(self, pane_id, status=None):
        workspace_id = pane_id.split(":")[0]
        pane = {"pane_id": pane_id, "workspace_id": workspace_id, "tab_id": f"{workspace_id}:t1"}
        self.live["panes"].append(pane)
        if status:
            self.live["agents"].append({**pane, "agent_status": status, "terminal_id": f"term-{pane_id}"})

    def test_jump_projects_focus_to_the_visible_client_across_workspaces(self):
        self.add_pane("w1:p1", "done")

        next_agent.main()

        self.api.assert_called_once_with("pane.focus", {"pane_id": "w1:p1"})
        self.assertEqual({"origin_pane_id": "w0:p1", "last_jump_pane_id": "w1:p1"}, next_agent.load_state())

    def test_failed_focus_preserves_the_previous_return_target(self):
        self.add_pane("w1:p1", "done")
        next_agent.save_state("w2:p1", "w3:p1")
        self.api.side_effect = SystemExit("pane is gone")

        with self.assertRaisesRegex(SystemExit, "pane is gone"):
            next_agent.main()

        self.assertEqual({"origin_pane_id": "w2:p1", "last_jump_pane_id": "w3:p1"}, next_agent.load_state())

    def test_blocked_has_priority_over_unreviewed_completion(self):
        self.add_pane("w1:p1", "done")
        self.add_pane("w2:p1", "blocked")

        next_agent.main()

        self.api.assert_called_once_with("pane.focus", {"pane_id": "w2:p1"})

    def test_workspace_scope_does_not_jump_outside_the_workspace(self):
        self.add_pane("w0:p2", "done")
        self.add_pane("w1:p1", "blocked")
        with patch.object(next_agent, "plugin_config", return_value=(["blocked", "done"], "workspace")):
            next_agent.main()

        self.api.assert_called_once_with("pane.focus", {"pane_id": "w0:p2"})

    def test_no_attention_does_not_focus_or_change_return_target(self):
        self.add_pane("w1:p1", "idle")
        self.add_pane("w2:p1", "working")
        next_agent.save_state("w2:p1", "w3:p1")

        next_agent.main()

        self.api.assert_not_called()
        self.toast.assert_called_once_with("No agent needs attention")
        self.assertEqual({"origin_pane_id": "w2:p1", "last_jump_pane_id": "w3:p1"}, next_agent.load_state())

    def test_jump_chain_returns_to_the_original_shell(self):
        self.add_pane("w1:p1", "done")
        self.add_pane("w2:p1", "done")
        next_agent.main()
        self.live.update(focused_pane_id="w1:p1", focused_workspace_id="w1")
        self.live["agents"][0]["agent_status"] = "idle"

        next_agent.main()

        self.api.assert_called_with("pane.focus", {"pane_id": "w2:p1"})
        self.assertEqual({"origin_pane_id": "w0:p1", "last_jump_pane_id": "w2:p1"}, next_agent.load_state())
        self.live.update(focused_pane_id="w2:p1", focused_workspace_id="w2")
        next_agent.back()
        self.api.assert_called_with("pane.focus", {"pane_id": "w0:p1"})
        self.assertEqual({"origin_pane_id": "w2:p1", "last_jump_pane_id": None}, next_agent.load_state())


if __name__ == "__main__":
    unittest.main()
