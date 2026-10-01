import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import spaces_env  # pyright: ignore[reportImplicitRelativeImport]


def state_with(assignments=None, mru=None, active="personal"):
    state = spaces_env.blank_state()
    state["active_env"] = active
    state["assignments"] = dict(assignments or {})
    for env, entries in (mru or {}).items():
        state["mru"][env] = list(entries)
    return state


class NormaliseTests(unittest.TestCase):
    def test_garbage_becomes_blank_state(self):
        for raw in (None, [], "x", 7):
            state = spaces_env.normalise_state(raw)
            self.assertEqual(spaces_env.blank_state(), state)

    def test_invalid_fields_are_dropped_and_mru_deduped(self):
        state = spaces_env.normalise_state(
            {
                "active_env": "gaming",
                "assignments": {"w1": "work", "w2": "office", 3: "work"},
                "mru": {"work": ["w1", "w1", 5], "personal": "nope"},
            }
        )
        self.assertEqual("personal", state["active_env"])
        self.assertEqual({"w1": "work"}, state["assignments"])
        self.assertEqual(["w1"], state["mru"]["work"])
        self.assertEqual([], state["mru"]["personal"])


class ReconcileTests(unittest.TestCase):
    def test_dead_ids_pruned_and_unmapped_default_to_personal(self):
        state = state_with(
            assignments={"w1": "work", "wDead": "work"},
            mru={"work": ["wDead", "w1"], "personal": ["wGone"]},
        )

        added = spaces_env.reconcile(state, ["w1", "w2"])

        self.assertEqual(["w2"], added)
        self.assertEqual({"w1": "work", "w2": "personal"}, state["assignments"])
        self.assertEqual(["w1"], state["mru"]["work"])
        self.assertEqual(["w2"], state["mru"]["personal"])

    def test_restored_session_keeps_assignments(self):
        """Herdr restores stable workspace IDs, so a restart changes nothing."""
        state = state_with(
            assignments={"w1": "personal", "w2": "work"},
            mru={"personal": ["w1"], "work": ["w2"]},
        )
        before = json.loads(json.dumps(state))

        added = spaces_env.reconcile(state, ["w1", "w2"])

        self.assertEqual([], added)
        self.assertEqual(before, state)

    def test_mru_entry_in_wrong_environment_list_is_repaired(self):
        state = state_with(
            assignments={"w1": "work"},
            mru={"personal": ["w1"], "work": []},
        )

        spaces_env.reconcile(state, ["w1"])

        self.assertEqual([], state["mru"]["personal"])
        self.assertEqual(["w1"], state["mru"]["work"])


class AssignmentTests(unittest.TestCase):
    def test_assign_moves_between_mru_lists_and_fronts_destination(self):
        state = state_with(
            assignments={"w1": "personal", "w2": "work"},
            mru={"personal": ["w1"], "work": ["w2"]},
        )

        spaces_env.assign(state, "w1", "work")

        self.assertEqual("work", state["assignments"]["w1"])
        self.assertEqual([], state["mru"]["personal"])
        self.assertEqual(["w1", "w2"], state["mru"]["work"])

    def test_touch_mru_fronts_focused_space(self):
        state = state_with(
            assignments={"w1": "personal", "w2": "personal"},
            mru={"personal": ["w1", "w2"]},
        )

        spaces_env.touch_mru(state, "w2")

        self.assertEqual(["w2", "w1"], state["mru"]["personal"])

    def test_forget_removes_everywhere(self):
        state = state_with(assignments={"w1": "work"}, mru={"work": ["w1"]})

        spaces_env.forget(state, "w1")

        self.assertEqual({}, state["assignments"])
        self.assertEqual([], state["mru"]["work"])


class PickTargetTests(unittest.TestCase):
    def test_most_recent_live_member_wins(self):
        state = state_with(
            assignments={"w1": "work", "w2": "work"},
            mru={"work": ["w2", "w1"]},
        )
        self.assertEqual("w2", spaces_env.pick_target(state, "work", ["w1", "w2"]))

    def test_falls_back_to_sidebar_order_when_mru_is_stale(self):
        state = state_with(
            assignments={"w1": "work", "w2": "work"},
            mru={"work": ["wDead"]},
        )
        self.assertEqual("w1", spaces_env.pick_target(state, "work", ["w1", "w2"]))

    def test_empty_environment_yields_none(self):
        state = state_with(assignments={"w1": "personal"}, mru={"personal": ["w1"]})
        self.assertIsNone(spaces_env.pick_target(state, "work", ["w1"]))


class CurrentWorkspaceTests(unittest.TestCase):
    def test_action_context_wins_over_session_wide_focus(self):
        with mock.patch.dict(os.environ, {"HERDR_WORKSPACE_ID": "w-client"}):
            self.assertEqual(
                "w-client",
                spaces_env.current_workspace_id({"focused_workspace_id": "w-server"}),
            )

    def test_session_focus_is_the_non_action_fallback(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                "w-server",
                spaces_env.current_workspace_id({"focused_workspace_id": "w-server"}),
            )


class ResolveCurrentEnvTests(unittest.TestCase):
    def test_live_focus_wins_when_stored_environment_has_members(self):
        state = state_with(assignments={"w1": "personal", "w2": "work"}, active="personal")
        current = spaces_env.resolve_current_env(state, "work", ["w1", "w2"])
        self.assertEqual("work", current)

    def test_stored_intent_wins_in_empty_environment_limbo(self):
        state = state_with(assignments={"w1": "personal"}, active="work")
        current = spaces_env.resolve_current_env(state, "personal", ["w1"])
        self.assertEqual("work", current)

    def test_no_focus_information_uses_stored_environment(self):
        state = state_with(assignments={"w1": "personal"}, active="personal")
        self.assertEqual(
            "personal", spaces_env.resolve_current_env(state, None, ["w1"])
        )


class GroupingTests(unittest.TestCase):
    def test_personal_block_before_work_block_is_grouped(self):
        assignments = {"w1": "personal", "w2": "personal", "w3": "work"}
        self.assertTrue(spaces_env.is_grouped(["w1", "w2", "w3"], assignments))
        self.assertIsNone(spaces_env.regroup_plan(["w1", "w2", "w3"], assignments))

    def test_single_environment_and_empty_orders_are_grouped(self):
        self.assertTrue(spaces_env.is_grouped([], {}))
        self.assertTrue(spaces_env.is_grouped(["w1"], {"w1": "work"}))

    def test_interleaved_order_plans_the_work_block_to_the_end(self):
        assignments = {"w1": "work", "w2": "personal", "w3": "work"}
        self.assertEqual(
            ["w1", "w3"], spaces_env.regroup_plan(["w1", "w2", "w3"], assignments)
        )


class VisibilityPatchTests(unittest.TestCase):
    def test_inactive_environment_hides_and_active_unhides(self):
        assignments = {"w1": "personal", "w2": "work", "w3": "personal"}
        self.assertEqual(
            {"w1": None, "w2": "1", "w3": None},
            spaces_env.visibility_patch(assignments, "personal"),
        )
        self.assertEqual(
            {"w1": "1", "w2": None, "w3": "1"},
            spaces_env.visibility_patch(assignments, "work"),
        )

    def test_empty_assignments_patch_nothing(self):
        self.assertEqual({}, spaces_env.visibility_patch({}, "personal"))


class AgentViewFilterTests(unittest.TestCase):
    def test_members_of_the_environment_form_one_in_filter(self):
        assignments = {"w1": "personal", "w2": "work", "w3": "personal"}
        self.assertEqual(
            {"op": "in", "field": "workspace_id", "values": ["w1", "w3"]},
            spaces_env.agent_view_filter(assignments, "personal"),
        )

    def test_empty_environment_matches_nothing(self):
        """Workspace IDs are never empty, so eq "" shows no agents."""
        self.assertEqual(
            {"op": "eq", "field": "workspace_id", "value": ""},
            spaces_env.agent_view_filter({"w1": "personal"}, "work"),
        )

    def test_more_than_32_members_chunk_under_any(self):
        """Herdr caps `in` filters at 32 values."""
        assignments = {f"w{i}": "work" for i in range(40)}
        spec = spaces_env.agent_view_filter(assignments, "work")
        self.assertEqual("any", spec["op"])
        self.assertEqual(2, len(spec["filters"]))
        self.assertEqual([32, 8], [len(f["values"]) for f in spec["filters"]])
        self.assertTrue(
            all(
                f["op"] == "in" and f["field"] == "workspace_id"
                for f in spec["filters"]
            )
        )


class ToggleTests(unittest.TestCase):
    def test_toggle_focuses_destination_mru(self):
        state = state_with(
            assignments={"w1": "personal", "w2": "work", "w3": "work"},
            mru={"personal": ["w1"], "work": ["w3", "w2"]},
        )

        dest, target, added = spaces_env.plan_toggle(state, ["w1", "w2", "w3"], "w1")

        self.assertEqual(("work", "w3", []), (dest, target, added))
        self.assertEqual("work", state["active_env"])

    def test_toggle_remembers_the_space_being_left_when_focus_event_was_missed(self):
        state = state_with(
            assignments={"p-last": "personal", "p-viewed": "personal", "w1": "work"},
            mru={"personal": ["p-last", "p-viewed"], "work": ["w1"]},
        )
        order = ["p-last", "p-viewed", "w1"]

        spaces_env.plan_toggle(state, order, "p-viewed")
        dest, target, _ = spaces_env.plan_toggle(state, order, "w1")

        self.assertEqual(("personal", "p-viewed"), (dest, target))
        self.assertEqual(["p-viewed", "p-last"], state["mru"]["personal"])

    def test_toggle_into_empty_environment_flips_intent_without_target(self):
        state = state_with(assignments={"w1": "personal"}, mru={"personal": ["w1"]})

        dest, target, _ = spaces_env.plan_toggle(state, ["w1"], "w1")

        self.assertEqual("work", dest)
        self.assertIsNone(target)
        self.assertEqual("work", state["active_env"])

    def test_toggle_out_of_limbo_returns_to_the_focused_environment(self):
        state = state_with(
            assignments={"w1": "personal"}, mru={"personal": ["w1"]}, active="work"
        )

        dest, target, _ = spaces_env.plan_toggle(state, ["w1"], "w1")

        self.assertEqual(("personal", "w1"), (dest, target))
        self.assertEqual("personal", state["active_env"])

    def test_toggle_maps_unknown_spaces_before_deciding(self):
        state = spaces_env.blank_state()

        dest, target, added = spaces_env.plan_toggle(state, ["w1", "w2"], "w1")

        self.assertEqual(["w1", "w2"], added)
        self.assertEqual("work", dest)
        self.assertIsNone(target)


class SendTests(unittest.TestCase):
    def test_send_stays_in_source_and_focuses_its_mru(self):
        state = state_with(
            assignments={"w1": "personal", "w2": "personal", "w3": "personal"},
            mru={"personal": ["w1", "w3", "w2"]},
        )

        src, dest, remaining, _ = spaces_env.plan_send(state, ["w1", "w2", "w3"], "w1")

        self.assertEqual(("personal", "work", "w3"), (src, dest, remaining))
        self.assertEqual("work", state["assignments"]["w1"])
        self.assertEqual(["w1"], state["mru"]["work"])
        self.assertEqual("personal", state["active_env"])

    def test_sent_space_becomes_destination_most_recent(self):
        state = state_with(
            assignments={"w1": "personal", "w2": "personal", "w3": "work"},
            mru={"personal": ["w1", "w2"], "work": ["w3"]},
        )

        spaces_env.plan_send(state, ["w1", "w2", "w3"], "w1")

        self.assertEqual(["w1", "w3"], state["mru"]["work"])

    def test_sending_the_last_source_space_follows_it(self):
        state = state_with(
            assignments={"w1": "personal", "w2": "work"},
            mru={"personal": ["w1"], "work": ["w2"]},
        )

        src, dest, remaining, _ = spaces_env.plan_send(state, ["w1", "w2"], "w1")

        self.assertEqual(("personal", "work"), (src, dest))
        self.assertIsNone(remaining)
        self.assertEqual("work", state["active_env"])

    def test_send_then_toggle_returns_to_the_sent_space(self):
        state = state_with(
            assignments={"w1": "personal", "w2": "personal"},
            mru={"personal": ["w1", "w2"]},
        )

        spaces_env.plan_send(state, ["w1", "w2"], "w1")
        dest, target, _ = spaces_env.plan_toggle(state, ["w1", "w2"], "w2")

        self.assertEqual(("work", "w1"), (dest, target))


class LifecycleTests(unittest.TestCase):
    def test_new_space_inherits_the_active_environment(self):
        state = state_with(
            assignments={"w1": "work"}, mru={"work": ["w1"]}, active="work"
        )

        env, added = spaces_env.plan_created(state, ["w1", "w2"], "w2")

        self.assertEqual("work", env)
        self.assertEqual([], added)
        self.assertEqual(["w2", "w1"], state["mru"]["work"])

    def test_created_space_that_vanished_reports_none(self):
        state = spaces_env.blank_state()

        env, _ = spaces_env.plan_created(state, [], "w9")

        self.assertIsNone(env)
        self.assertEqual({}, state["assignments"])

    def test_focus_tracks_mru_and_active_environment(self):
        state = state_with(
            assignments={"w1": "personal", "w2": "work"},
            mru={"personal": ["w1"], "work": ["w2"]},
        )

        env, newly = spaces_env.plan_focused(state, "w2")

        self.assertEqual(("work", False), (env, newly))
        self.assertEqual("work", state["active_env"])

    def test_focusing_an_unknown_space_maps_it_to_the_active_environment(self):
        state = state_with(active="work")

        env, newly = spaces_env.plan_focused(state, "w7")

        self.assertEqual(("work", True), (env, newly))
        self.assertEqual({"w7": "work"}, state["assignments"])

    def test_rename_is_irrelevant_to_identity(self):
        """Assignments key on workspace_id, so a rename cannot move a Space."""
        state = state_with(assignments={"w1": "work"}, mru={"work": ["w1"]})
        before = json.loads(json.dumps(state))

        spaces_env.reconcile(state, ["w1"])

        self.assertEqual(before["assignments"], state["assignments"])


class ConcurrencyTests(unittest.TestCase):
    def test_concurrent_mutations_lose_no_updates(self):
        workers, per_worker = 4, 25
        script = (
            "import os, sys\n"
            "sys.path.insert(0, os.environ['PLUGIN_DIR'])\n"
            "import spaces_env\n"
            "prefix = sys.argv[1]\n"
            f"for i in range({per_worker}):\n"
            "    spaces_env.mutate_state(\n"
            "        lambda s, i=i: spaces_env.assign(s, f'{prefix}_{i}', 'work')\n"
            "    )\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            env = {
                **os.environ,
                "HERDR_PLUGIN_STATE_DIR": tmp,
                "PLUGIN_DIR": str(Path(__file__).parent),
            }
            processes = [
                subprocess.Popen(
                    [sys.executable, "-c", script, f"w{worker}"],
                    env=env,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.PIPE,
                )
                for worker in range(workers)
            ]
            for process in processes:
                _, stderr = process.communicate(timeout=60)
                self.assertEqual(0, process.returncode, stderr.decode())
            state = json.loads(Path(tmp, spaces_env.STATE_FILE).read_text())
        self.assertEqual(workers * per_worker, len(state["assignments"]))
        self.assertEqual(workers * per_worker, len(state["mru"]["work"]))


if __name__ == "__main__":
    unittest.main()
