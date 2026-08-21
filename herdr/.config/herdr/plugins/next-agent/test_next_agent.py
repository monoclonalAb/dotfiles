import unittest

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
if __name__ == "__main__":
    unittest.main()
