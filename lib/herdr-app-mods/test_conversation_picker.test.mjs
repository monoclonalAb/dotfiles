// node --test lib/herdr-app-mods/*.test.mjs
// The conversation picker's rules: what it knows about each conversation, how
// typing matches and orders them, where the list's rows go, and the recent list
// pane-keys keeps for it.
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const cp = await loadMod("conversation-picker");
const tree = await loadMod("spaces-tree");
const { remember } = await loadMod("pane-keys");
const { ROW, HEAD } = cp;

const conv = (address, fields = {}) => ({ address, pane: `p-${address}`, title: "", space: "", branch: "", tab: "", folder: "", machine: "", env: "", program: "Pi", here: false, ...fields });

test("a conversation is titled as the sidebar titles it", () => {
  const cases = [
    { summary: "Fix login spinner", title: "π - beacon" },
    { title: "π - beacon", cwd: "/r/beacon", spaceName: "beacon", tabName: "review", tabNamed: true, program: "Pi" },
    { title: "π - beacon", cwd: "/r/beacon", spaceName: "beacon", pending: true, program: "Pi" },
    { title: "⠋ migrate store", cwd: "/r/x", program: "Pi" },
    { title: "~/dotfiles", cwd: "/Users/e/dotfiles", program: "zsh" },
    { title: "", program: "" },
  ];
  for (const c of cases) assert.deepEqual(cp.conversationTitle(c), tree.conversationTitle(c), JSON.stringify(c));
});

test("conversations: every agent with a pane, in the sidebar's Space order, with what the search reads", () => {
  const spaceList = [
    { id: "a", name: "beacon", branch: "main", machine: null, tabs: [{ id: "a1", name: "1", named: false }] },
    { id: "b", name: "fix-login", branch: "fix-login", machine: "vps", tabs: [{ id: "b1", name: "review", named: true }] },
  ];
  const paneList = [
    { pane: "pa", tab: "a1", terminal: "t1", cwd: "/r/beacon", branch: "main" },
    { pane: "pb", tab: "b1", terminal: "t2", cwd: "/w/beacon/fix-login", branch: "fix-login" },
  ];
  const agentList = [
    { address: "t1", pane: "pa", space: "a", tab: "a1", status: "idle", title: "π - beacon", program: { name: "Pi" } },
    { address: "t2", pane: "pb", space: "b", tab: "b1", status: "blocked", title: "π - fix-login", program: { name: "Pi" } },
    { address: "t9", pane: "gone", space: "a", tab: "a1", status: "idle", title: "", program: { name: "Pi" } },
  ];
  const terminalList = [{ address: "t2", labels: { task_summary: "Fix login redirect" } }];
  const env = { active: "personal", assign: { b: "work" } };
  const list = cp.conversations({ agentList, paneList, spaceList, terminalList, order: ["b", "a"], env, here: "t1" });
  assert.deepEqual(list.map((c) => c.address), ["t2", "t1"]); // t9 has no pane
  assert.deepEqual(
    { title: list[0].title, space: list[0].space, branch: list[0].branch, tab: list[0].tab, folder: list[0].folder, machine: list[0].machine, env: list[0].env, here: list[0].here },
    { title: "Fix login redirect", space: "fix-login", branch: "fix-login", tab: "review", folder: "fix-login", machine: "vps", env: "work", here: false },
  );
  // An unnamed tab ("1") is not searched; a Space spaces-env has not assigned is Personal.
  assert.equal(list[1].tab, "");
  assert.equal(list[1].env, "personal");
  assert.equal(list[1].here, true);
  // Without environments, there is nothing to say.
  assert.equal(cp.conversations({ agentList, paneList, spaceList, terminalList, order: null, env: null, here: null })[0].env, "");
});

test("a typed word matches the whole, the start, a word's start, anywhere, the initials, then close letters", () => {
  const scores = ["beacon", "beac", "log", "ogi", "flr", "lgn", "zzz"].map((w) => cp.wordScore(w, "Beacon"));
  assert.deepEqual(scores.slice(0, 2), [100, 80]);
  assert.equal(cp.wordScore("log", "Fix login redirect"), 60);
  assert.equal(cp.wordScore("ogi", "Fix login redirect"), 40);
  assert.equal(cp.wordScore("flr", "Fix login redirect"), 30);
  assert.equal(cp.wordScore("lgn", "Fix login redirect"), 10);
  assert.equal(cp.wordScore("fxt", "Fix login redirect"), 0); // letters too far apart
  assert.equal(cp.wordScore("x", ""), 0);
});

test("every word must match somewhere; a title match beats the same match on the Space", () => {
  const titled = conv("t1", { title: "Theme sync", space: "dotfiles" });
  const placed = conv("t2", { title: "Fix login", space: "theme" });
  assert.equal(cp.matchScore("theme zzz", titled), null);
  assert.ok(cp.matchScore("theme", titled) > cp.matchScore("theme", placed));
  // Words may match different fields: "dot" the Space, "sync" the title.
  assert.ok(cp.matchScore("dot sync", titled) > 0);
  assert.equal(cp.matchScore("dot sync", placed), null);
  // The whole query at the title's start counts extra.
  assert.ok(cp.matchScore("fix log", conv("a", { title: "Fix login" })) > cp.matchScore("fix log", conv("b", { title: "Login fix" })));
});

test("with nothing typed: last visited first, the rest in sidebar order, the one you are in last", () => {
  const list = [conv("t1", { here: true }), conv("t2"), conv("t3"), conv("t4")];
  assert.deepEqual(cp.rank(list, "", ["t1", "t3", "gone"]).map((c) => c.address), ["t3", "t2", "t4", "t1"]);
  assert.deepEqual(cp.rank(list, "  ", undefined).map((c) => c.address), ["t2", "t3", "t4", "t1"]);
});

test("typed: matches only, by score, then the one you are in last, then by last visit", () => {
  const list = [
    conv("t1", { title: "Login page copy", here: true }),
    conv("t2", { title: "Fix login redirect" }),
    conv("t3", { title: "Login tests" }),
    conv("t4", { title: "Theme sync" }),
  ];
  // "login": t1 and t3 start with it (80 + 50); t2 has it at a word start (60 + 20).
  assert.deepEqual(cp.rank(list, "login", ["t2"]).map((c) => c.address), ["t3", "t1", "t2"]);
  // Equal scores: the visited one first.
  assert.deepEqual(cp.rank([conv("a", { title: "Fix x" }), conv("b", { title: "Fix y" })], "fix", ["b"]).map((c) => c.address), ["b", "a"]);
  assert.deepEqual(cp.rank(list, "nothing", []), []);
});

test("the list: Recent over everything, or Top hit over the first and Conversations over the rest", () => {
  assert.deepEqual(cp.listLayout(0, ""), { items: [], height: 0 });
  assert.deepEqual(cp.listLayout(2, "").items.map((it) => [it.kind, it.text ?? it.index, it.top]), [["head", "Recent", 0], ["row", 0, HEAD], ["row", 1, HEAD + ROW]]);
  const typed = cp.listLayout(3, "fix");
  assert.deepEqual(typed.items.map((it) => [it.kind, it.text ?? it.index, it.top]), [
    ["head", "Top hit", 0], ["row", 0, HEAD], ["head", "Conversations", HEAD + ROW], ["row", 1, 2 * HEAD + ROW], ["row", 2, 2 * HEAD + 2 * ROW],
  ]);
  assert.equal(typed.height, 2 * HEAD + 3 * ROW);
  assert.equal(cp.listLayout(1, "fix").items.length, 2); // no empty "Conversations"
});

test("moving scrolls only as far as it takes, bringing a heading right above along", () => {
  const lay = cp.listLayout(20, "fix");
  const height = HEAD + 4 * ROW;
  assert.equal(cp.reveal(lay, 0, 0, height), 0);
  const down = cp.reveal(lay, 8, 0, height);
  assert.equal(down, lay.items.find((it) => it.index === 8 && it.kind === "row").top + ROW - height);
  assert.equal(cp.reveal(lay, 8, down, height), down);
  assert.equal(cp.reveal(lay, 1, down, height), HEAD + ROW); // "Conversations" comes along
  assert.equal(cp.reveal(lay, 0, down, height), 0);
  assert.equal(cp.reveal(cp.listLayout(2, ""), 0, 500, height), 0); // a stale scroll is clamped
});

test("pane-keys keeps conversations by last visit, unchanged when already first", () => {
  const list = ["t2", "t1"];
  assert.equal(remember(list, "t2"), list);
  assert.deepEqual(remember(list, "t1"), ["t1", "t2"]);
  assert.deepEqual(remember(undefined, "t1"), ["t1"]);
  assert.deepEqual(remember([1, "t3", null], "t1"), ["t1", "t3"]);
  assert.deepEqual(remember(["a", "b", "c"], "d", 3), ["d", "a", "b"]);
  assert.deepEqual(remember(list, null), list);
});

test("the preview shows the screen's last lines, blank runs folded", () => {
  assert.deepEqual(cp.tail("a\n\n\n\nb   \n\n", 10), ["a", "", "b"]);
  assert.deepEqual(cp.tail(null, 3), []);
});
