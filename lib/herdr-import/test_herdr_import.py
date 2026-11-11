"""herdr-import checks with fake herdr-app/herdr executables; never touch the real app or server."""

from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[2] / "bin" / "herdr-import"
loader = SourceFileLoader("herdr_import", str(SOURCE))
module = module_from_spec(spec_from_loader(loader.name, loader))
loader.exec_module(module)

# A fake Herdr app window: spaces -> tabs -> panes, and which pane has focus.
FAKE_APP = r'''#!/usr/bin/python3
import json, os, sys
path = os.environ["FAKE_APP_STATE"]
state = json.load(open(path))
args = sys.argv[1:]
with open(os.environ["FAKE_LOG"], "a") as log:
    log.write(json.dumps(args) + "\n")
def save():
    json.dump(state, open(path, "w"))
def new_pane(argv, folder):
    state["n"] += 1
    return {"terminal": "t%d" % state["n"], "pane": "p%d" % state["n"], "argv": argv, "folder": folder}
def find(pane):
    for s in state["spaces"]:
        for t in s["tabs"]:
            for p in t["terminals"]:
                if p["pane"] == pane:
                    return s, t
    return None, None
if args == ["status"]:
    print(json.dumps({"layout": "eric"}))
elif args == ["ls"]:
    print(json.dumps({"spaces": state["spaces"]}))
elif args[0] == "do":
    command, params = args[1], json.loads(args[2]) if len(args) > 2 else {}
    if command == "space.new":
        p = new_pane(params.get("argv"), params["folder"])
        state["n"] += 1
        space = {"id": "sp%d" % state["n"], "name": params.get("name"), "tabs": [{"id": "tb%d" % state["n"], "name": params.get("tab"), "terminals": [p]}]}
        state["spaces"].append(space)
        state["focus"] = p["pane"]
        save(); print(json.dumps({"space": space["id"], "tab": space["tabs"][0]["id"], "terminal": p["terminal"]}))
    elif command == "tab.new":
        p = new_pane(params.get("argv"), params["folder"])
        state["n"] += 1
        space = [s for s in state["spaces"] if s["id"] == params["space"]][0]
        tab = {"id": "tb%d" % state["n"], "name": params.get("name"), "terminals": [p]}
        space["tabs"].append(tab)
        state["focus"] = p["pane"]
        save(); print(json.dumps({"space": space["id"], "tab": tab["id"], "terminal": p["terminal"]}))
    elif command == "pane.focus":
        state["focus"] = params["pane"]; save(); print("{}")
    elif command == "terminal.open":
        _, tab = find(state["focus"])
        p = new_pane(params.get("argv"), params["folder"])
        p["beside"] = [state["focus"], params["place"]]
        tab["terminals"].append(p)
        save(); print(json.dumps({"pane": p["pane"], "terminal": p["terminal"]}))
    elif command.startswith("spaces-env.") and state.get("no_env_mod"):
        print(json.dumps({"error": "unknown command: a mod's need the mod loaded"})); sys.exit(1)
    else:
        print(json.dumps({"ok": True}))
'''

FAKE_HERDR = r'''#!/usr/bin/python3
import json, os, sys
state = json.load(open(os.environ["FAKE_HERDR_STATE"]))
if sys.argv[1:] == ["status", "server"]:
    print("status: " + ("running" if state["running"] else "stopped"))
elif sys.argv[1:] == ["workspace", "list"]:
    print(json.dumps({"result": {"workspaces": [{"workspace_id": w} for w in state["live"]]}}))
'''


def pane(cwd, session=None):
    p = {"cwd": cwd}
    if session:
        p["agent_session"] = {"source": "herdr:pi", "agent": "pi", "kind": "path", "value": session}
    return p


class HerdrImportTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="herdr import ")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.home = self.root / "home"
        self.bin = self.home / ".local/bin"
        self.bin.mkdir(parents=True)
        self.repo = self.root / "repo"
        self.sub = self.repo / "sub"
        self.sub.mkdir(parents=True)
        self.conversation = self.root / "conversation.jsonl"
        self.conversation.write_text("{}\n")
        self.log = self.root / "log.jsonl"
        self.app_state = self.root / "app.json"
        self.app_state.write_text(json.dumps({"spaces": [], "n": 0, "focus": None}))
        self.herdr_state = self.root / "herdr.json"
        self.herdr_state.write_text(json.dumps({"running": False, "live": []}))
        for name, source in (("herdr-app", FAKE_APP), ("herdr", FAKE_HERDR)):
            path = self.bin / name
            path.write_text(source)
            path.chmod(0o755)
        # 2x2 grid with a narrow column on the right, as terminal Herdr saves it.
        grid = {"Split": {"direction": "Vertical", "ratio": 0.86,
            "first": {"Split": {"direction": "Horizontal", "ratio": 0.5,
                "first": {"Split": {"direction": "Vertical", "ratio": 0.5, "first": {"Pane": 1}, "second": {"Pane": 2}}},
                "second": {"Split": {"direction": "Vertical", "ratio": 0.5, "first": {"Pane": 3}, "second": {"Pane": 4}}}}},
            "second": {"Pane": 5}}}
        self.session = {"version": 3, "active": 1, "workspaces": [
            {"id": "w3", "custom_name": ".config", "active_tab": 1, "tabs": [
                {"custom_name": None, "layout": grid, "focused": 4, "zoomed": False, "panes": {
                    "1": pane(str(self.repo), str(self.conversation)), "2": pane(str(self.repo)),
                    "3": pane(str(self.sub)), "4": pane(str(self.repo), str(self.root / "missing.jsonl")), "5": pane(str(self.repo))}},
                {"custom_name": "logs", "layout": {"Pane": 6}, "focused": 6, "zoomed": True, "panes": {"6": pane(str(self.root / "gone"))}},
            ]},
            {"id": "wF", "custom_name": None, "active_tab": 0, "tabs": [
                {"custom_name": None, "layout": {"Pane": 7}, "focused": 7, "panes": {"7": pane(str(self.repo), str(self.conversation))}}]},
        ]}
        self.session_path = self.root / "session.json"
        self.session_path.write_text(json.dumps(self.session))
        self.envs = self.root / "envs.json"
        self.envs.write_text(json.dumps({"assignments": {"w3": "personal", "wF": "work"}}))
        self.state = self.root / "import.json"
        self.env = {"HOME": str(self.home), "FAKE_APP_STATE": str(self.app_state), "FAKE_LOG": str(self.log),
                    "FAKE_HERDR_STATE": str(self.herdr_state)}

    def run_import(self, *argv):
        out = io.StringIO()
        status = module.main(["--from", str(self.session_path), "--state", str(self.state),
                              "--environments", str(self.envs), *argv], self.env, out)
        return status, out.getvalue()

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def app(self):
        return json.loads(self.app_state.read_text())

    def test_splits_rebuild_the_layout_parents_first(self):
        grid = self.session["workspaces"][0]["tabs"][0]["layout"]
        self.assertEqual(module.split_ops(grid), [(1, "right", 5), (1, "down", 3), (1, "right", 2), (3, "right", 4)])
        self.assertEqual(module.split_ops({"Pane": 9}), [])

    def test_dry_run_plans_and_touches_nothing(self):
        status, output = self.run_import("--dry-run")
        self.assertEqual(status, 0)
        self.assertIn("w3: .config: 2 tab(s), 6 pane(s), 1 Pi conversation(s), personal", output)
        self.assertIn(f"pi --session {self.conversation} in {self.repo}", output)
        self.assertIn("missing.jsonl is gone; a shell instead", output)
        self.assertIn("gone is gone; the pane starts in ~", output)
        self.assertEqual(self.calls(), [])
        self.assertFalse(self.state.exists())

    def test_import_makes_spaces_tabs_splits_and_resumes_pi(self):
        status, output = self.run_import()
        self.assertEqual(status, 0, output)
        [config, website] = self.app()["spaces"]
        self.assertEqual(config["name"], ".config")
        self.assertIsNone(website["name"], "an unnamed workspace stays unnamed: the app names it after its folder")
        first, logs = config["tabs"]
        self.assertEqual(logs["name"], "logs")
        panes = {p["terminal"]: p for p in first["terminals"]}
        self.assertEqual(len(panes), 5)
        root = first["terminals"][0]
        self.assertEqual(root["argv"], ["pi", "--session", str(self.conversation)])
        self.assertEqual(root["folder"], str(self.repo))
        # Each split hangs off the pane that held the area, in its own folder.
        beside = [(p["beside"][1], p["folder"]) for p in first["terminals"][1:]]
        self.assertEqual(beside, [("right", str(self.repo)), ("down", str(self.sub)), ("right", str(self.repo)), ("right", str(self.repo))])
        self.assertIsNone(first["terminals"][4]["argv"], "a missing conversation becomes a shell")
        self.assertEqual(logs["terminals"][0]["folder"], str(self.home))
        commands = [c[1] for c in self.calls() if c[0] == "do"]
        self.assertIn("pane.zoom", commands)
        self.assertIn(f"spaces-env.assign:{config['id']}=personal", commands)
        self.assertIn(f"spaces-env.assign:{website['id']}=work", commands)
        self.assertEqual(self.calls()[-1], ["do", "space.select", json.dumps({"id": website["id"]})], "ends on the active workspace")
        record = json.loads(self.state.read_text())["imported"]
        self.assertEqual({k: v["space"] for k, v in record.items()}, {"w3": config["id"], "wF": website["id"]})
        # Again: nothing new.
        status, output = self.run_import()
        self.assertIn("already imported", output)
        self.assertEqual(len(self.app()["spaces"]), 2)

    def test_shells_only_resumes_nothing(self):
        self.assertEqual(self.run_import("--shells-only", "--workspace", "wF")[0], 0)
        [space] = self.app()["spaces"]
        self.assertIsNone(space["tabs"][0]["terminals"][0]["argv"])

    def test_conversations_still_open_in_terminal_herdr_stay_there(self):
        self.herdr_state.write_text(json.dumps({"running": True, "live": ["w3"]}))
        status, output = self.run_import()
        self.assertEqual(status, 0)
        self.assertIn("terminal Herdr still has w3 open", output)
        config, website = self.app()["spaces"]
        self.assertTrue(all(p["argv"] is None for t in config["tabs"] for p in t["terminals"]))
        self.assertEqual(website["tabs"][0]["terminals"][0]["argv"], ["pi", "--session", str(self.conversation)])

    def test_an_unreadable_running_server_stops_the_import(self):
        self.herdr_state.write_text(json.dumps({"running": True, "live": []}))
        (self.bin / "herdr").write_text("#!/bin/sh\n[ \"$1\" = status ] && echo 'status: running'\nexit 0\n")
        status, output = self.run_import()
        self.assertEqual(status, 1)
        self.assertIn("did not list its workspaces", output)
        self.assertEqual(self.calls(), [])

    def test_without_the_environment_mod_the_space_is_still_made(self):
        state = self.app()
        state["no_env_mod"] = True
        self.app_state.write_text(json.dumps(state))
        status, output = self.run_import("--workspace", "wF")
        self.assertEqual(status, 0)
        self.assertIn("not put in work", output)
        self.assertEqual(len(self.app()["spaces"]), 1)

    def test_unknown_workspace_is_refused(self):
        status, output = self.run_import("--workspace", "w99")
        self.assertEqual(status, 1)
        self.assertIn("no workspace w99", output)


if __name__ == "__main__":
    unittest.main()
