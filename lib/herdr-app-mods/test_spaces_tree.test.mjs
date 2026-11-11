// node --test lib/herdr-app-mods/*.test.mjs
// Pull-request rules of herdr/plugins/pr-status/pr_status.py, titles and moves, against the app mod.
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { PR_TTL, applyOutcome, conversationTitle, currentEntry, ghOutcome, gitWhere, prDue, prFromGh, stripTitle, worktreeMove } = await loadMod("spaces-tree");

test("gh output maps to the four states", () => {
  assert.deepEqual(prFromGh({ number: 12, title: "Fix", state: "OPEN", isDraft: false }), { number: 12, title: "Fix", state: "open" });
  assert.equal(prFromGh({ number: 12, title: "Fix", state: "OPEN", isDraft: true }).state, "draft");
  assert.equal(prFromGh({ number: 12, state: "MERGED" }).state, "merged");
  assert.equal(prFromGh({ number: 12, state: "CLOSED" }).state, "closed");
  assert.equal(prFromGh({ number: 0, state: "OPEN" }), null);
  assert.equal(prFromGh({ number: 3, state: "WEIRD" }), null);
});

test("gh failures keep the last result; no pull request clears it", () => {
  assert.equal(ghOutcome({ code: 1, stderr: "no pull requests found for branch \"x\"" }).outcome, "none");
  assert.deepEqual(ghOutcome({ code: 4, stderr: "To get started with GitHub CLI, please run:  gh auth login\nmore" }),
    { outcome: "error", detail: "To get started with GitHub CLI, please run:  gh auth login" });
  assert.equal(ghOutcome({ code: 0, stdout: "{" }).outcome, "error");
  const kept = applyOutcome({ checkout: "/c", branch: "b", pr: { number: 1, title: "t", state: "open" }, at: 0 }, { outcome: "error", detail: "x" }, 5);
  assert.equal(kept.pr.number, 1);
  assert.equal(kept.at, 5);
  assert.equal(applyOutcome(kept, { outcome: "none", pr: null }, 6).pr, null);
});

test("a changed checkout or branch forgets the old pull request", () => {
  const entry = { checkout: "/c", branch: "a", pr: { number: 1 }, at: 100 };
  assert.equal(currentEntry(entry, "/c", "a"), entry);
  assert.deepEqual(currentEntry(entry, "/c", "b"), { checkout: "/c", branch: "b", pr: null, at: 0 });
});

test("the shown Space is looked up more often than others, finished ones least", () => {
  const open = { pr: { state: "open" }, at: 0 };
  assert.equal(prDue(open, true, PR_TTL.current), true);
  assert.equal(prDue(open, false, PR_TTL.current), false);
  assert.equal(prDue(open, false, PR_TTL.other), true);
  assert.equal(prDue({ pr: { state: "merged" }, at: 0 }, false, PR_TTL.other), false);
  assert.equal(prDue({ pr: { state: "merged" }, at: 0 }, false, PR_TTL.final), true);
});

test("titles lose the program's leading mark", () => {
  assert.equal(stripTitle("π - .config"), ".config");
  assert.equal(stripTitle("π > Fix the login spinner"), "Fix the login spinner");
  assert.equal(stripTitle("⠋ Working on it"), "Working on it");
});

test("a conversation is named by its summary, a telling title, a named tab, then its program", () => {
  const row = { title: "π - beacon", cwd: "/Users/e/beacon", spaceName: "beacon", tabName: "2", tabNamed: false, program: "Pi" };
  assert.deepEqual(conversationTitle({ ...row, summary: "Repair login redirect" }), { text: "Repair login redirect", strong: true });
  assert.deepEqual(conversationTitle({ ...row, title: "π > Migrate the store" }), { text: "Migrate the store", strong: true });
  assert.deepEqual(conversationTitle(row), { text: "Pi", strong: false });
  // The app reports an untitled terminal by its address.
  assert.deepEqual(conversationTitle({ ...row, title: "t15", address: "t15" }), { text: "Pi", strong: false });
  assert.deepEqual(conversationTitle({ ...row, pending: true }), { text: "Naming…", strong: false });
  assert.deepEqual(conversationTitle({ ...row, tabName: "review", tabNamed: true }), { text: "review", strong: false });
});

test("a Space row names its branch, main included, unless its name or pull request says it", () => {
  const g = (branch) => ({ name: "dotfiles", branch });
  assert.deepEqual(gitWhere(g("main"), { name: ".config" }), { repo: "dotfiles", branch: "main" });
  assert.deepEqual(gitWhere(g("master"), { name: "dotfiles" }), { repo: "", branch: "master" });
  assert.deepEqual(gitWhere(g("spike"), { name: ".config" }), { repo: "dotfiles", branch: "spike" });
  assert.deepEqual(gitWhere(g(null), { name: ".config" }), { repo: "dotfiles", branch: "detached" });
  // A worktree under its repository, named after its branch or showing its pull request.
  assert.deepEqual(gitWhere(g("fix-login"), { tree: true, name: "Fix-Login" }), { repo: "", branch: "" });
  assert.deepEqual(gitWhere(g("fix-login"), { tree: true, name: "#4 Fix login", pr: { number: 4 } }), { repo: "", branch: "" });
  assert.deepEqual(gitWhere(g("fix-login"), { tree: true, name: "login work" }), { repo: "", branch: "fix-login" });
});

test("a worktree moves among its repository's worktrees and stops at either end", () => {
  const rows = [
    { id: "main", repo: "r", nested: false },
    { id: "w1", repo: "r", nested: true },
    { id: "w2", repo: "r", nested: true },
    { id: "other", repo: "s", nested: true },
  ];
  assert.deepEqual(worktreeMove(rows, "w2", "up"), { neighbour: "w1" });
  assert.deepEqual(worktreeMove(rows, "w1", "down"), { neighbour: "w2" });
  assert.equal(worktreeMove(rows, "w1", "up").message, "Already the first worktree");
  assert.equal(worktreeMove(rows, "w2", "down").message, "Already the last worktree");
  assert.equal(worktreeMove(rows, "main", "down").message, "Only a linked worktree moves, within its repository");
});

// The tree itself, outside the app (its init is not run): only nest() is used.
const { default: SpacesTree } = await loadMod("spaces-tree");

test("a folded repository's worktrees stay listed but hidden, so folding can slide them shut", () => {
  const tree = new SpacesTree();
  tree.foldedRepos = new Set(["r"]);
  const main = { w: { id: "main" }, g: { repo: "r", linked: false } };
  const wt = (id, active = false) => ({ w: { id, active }, g: { repo: "r", linked: true } });
  const hidden = (rows) => rows.map((r) => [r.w.id, Boolean(r.hidden)]);
  assert.deepEqual(hidden(tree.nest([main, wt("w1"), wt("w2")], true)), [["main", false], ["w1", true], ["w2", true]]);
  // The shown Space keeps its repository open; the full list (folding off) hides nothing.
  assert.deepEqual(hidden(tree.nest([main, wt("w1", true), wt("w2")], true)), [["main", false], ["w1", false], ["w2", false]]);
  assert.deepEqual(hidden(tree.nest([main, wt("w1"), wt("w2")], false)), [["main", false], ["w1", false], ["w2", false]]);
});
