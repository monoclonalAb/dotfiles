// node --test lib/herdr-app-mods/*.test.mjs
// Pull-request rules of herdr/plugins/pr-status/pr_status.py, titles and moves, against the app mod.
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { PR_TTL, activityGroups, activityWhere, applyOutcome, byTab, conversationTitle, currentEntry, editorTitle, formatAge, ghOutcome, gitWhere, ink, isEditor, mixHex, prDue, prFromGh, stripTitle, trackSince, unstarted, worktreeMove } = await loadMod("spaces-tree");

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

test("a pane is an editor while Neovim runs in it, never an agent or a mod pane", () => {
  const nvim = { key: "nvim", name: "Neovim", shell: false, agent: false };
  assert.equal(isEditor({ pane: "p1", terminal: "t1", program: nvim }), true);
  assert.equal(isEditor({ pane: "p1", terminal: "t1", program: { key: "shell", shell: true, agent: false } }), false);
  assert.equal(isEditor({ pane: "p1", terminal: "t1", program: { key: "pi", agent: true } }), false);
  assert.equal(isEditor({ pane: "p1", terminal: null, mod: "files", program: nvim }), false);
  assert.equal(isEditor(null), false);
});

test("an editor is named by the file in Neovim's title, then the pane, a named tab, then its folder", () => {
  const row = { title: "", address: "t14n", name: null, tabName: "1", tabNamed: false, cwd: "/Users/e/cppshell" };
  // Neovim's default titlestring, modified or not, and a bare file name.
  assert.equal(editorTitle({ ...row, title: "main.cpp + (~/cppshell/src) - Nvim" }), "main.cpp");
  assert.equal(editorTitle({ ...row, title: "init.lua (~/dotfiles/nvim) - NVIM" }), "init.lua");
  assert.equal(editorTitle({ ...row, title: "shell.cpp" }), "shell.cpp");
  assert.equal(editorTitle({ ...row, title: "~/cppshell/src/shell.cpp" }), "shell.cpp");
  // This repository's nvim/lua/options.lua titles: a file, an Oil folder, nothing open yet.
  assert.equal(editorTitle({ ...row, title: "options.lua - Nvim" }), "options.lua");
  assert.equal(editorTitle({ ...row, title: "src/ - Nvim" }), "src/");
  assert.equal(editorTitle({ ...row, title: "100% - Nvim" }), "100%");
  assert.equal(editorTitle({ ...row, title: "Nvim" }), "cppshell");
  // No title (the app reports an untitled terminal by its address): the folder.
  assert.equal(editorTitle(row), "cppshell");
  assert.equal(editorTitle({ ...row, title: "t14n" }), "cppshell");
  assert.equal(editorTitle({ ...row, title: "nvim" }), "cppshell");
  assert.equal(editorTitle({ ...row, tabName: "notes", tabNamed: true }), "notes");
  assert.equal(editorTitle({ ...row, name: "scratch", tabName: "notes", tabNamed: true }), "scratch");
  assert.equal(editorTitle({ ...row, cwd: null }), "Neovim");
});

test("a Space's rows go tab by tab, then pane by pane, conversations and editors mixed", () => {
  const rows = [
    { tab: "tab1", pane: "p1", kind: "agent" },
    { tab: "tab2", pane: "p4", kind: "agent" },
    { tab: "tab1", pane: "p2", kind: "editor" },
    { tab: "tab2", pane: "p3", kind: "editor" },
  ];
  const sorted = byTab(rows, ["tab1", "tab2"], ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(sorted.map((r) => r.pane), ["p1", "p2", "p3", "p4"]);
  // Tabs in the Space's order, not the panes' order.
  assert.deepEqual(byTab(rows, ["tab2", "tab1"], ["p1", "p2", "p3", "p4"]).map((r) => r.pane), ["p3", "p4", "p1", "p2"]);
  // An unknown tab or pane goes last, in its first order.
  assert.deepEqual(byTab([{ tab: "x", pane: "q" }, ...rows], ["tab1", "tab2"], ["p1", "p2", "p3"]).map((r) => r.pane), ["p1", "p2", "p3", "p4", "q"]);
});

test("a Pi conversation stays out of the sidebar until it starts", () => {
  const fresh = { task_summary: "New conversation" };
  assert.equal(unstarted(fresh, "idle"), true);
  // Its first request: the title is being generated, then it works.
  assert.equal(unstarted({ ...fresh, task_summary_pending: "1" }, "idle"), false);
  assert.equal(unstarted(fresh, "working"), false);
  assert.equal(unstarted(fresh, "review"), false);
  assert.equal(unstarted(fresh, "blocked"), false);
  // Naming failed: it has requests but kept the empty title.
  assert.equal(unstarted({ ...fresh, task_summary_error: "no model selected" }, "idle"), false);
  assert.equal(unstarted({ task_summary: "Repair login redirect" }, "idle"), false);
  // Other agents have no task summary.
  assert.equal(unstarted({}, "idle"), false);
  assert.equal(unstarted(undefined, "idle"), false);
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

test("activity rows split into Needs you, To review, Saved and Running sections, never idle", () => {
  const items = [
    { address: "t1", dot: "idle", title: "Read one" },
    { address: "t2", dot: "review", title: "Finished first" },
    { address: "t3", dot: "working", title: "Running one" },
    { address: "t4", dot: "blocked", title: "Needs answer" },
    { address: "t5", dot: "review", title: "Finished second" },
    { address: "t6", dot: "working", title: "Running two" },
    { address: "t7", dot: "saved", title: "Come back later" },
  ];
  const grouped = activityGroups(items);
  assert.deepEqual(grouped.blocked.map((x) => x.address), ["t4"]);
  assert.deepEqual(grouped.review.map((x) => x.address), ["t2", "t5"]);
  assert.deepEqual(grouped.saved.map((x) => x.address), ["t7"]);
  assert.deepEqual(grouped.running.map((x) => x.address), ["t3", "t6"]);
  assert.deepEqual(grouped.counts, { blocked: 1, review: 2, saved: 1, running: 2 });
});

test("activity subtitles name the repo, pull request, non-default branch, remote machine and multi-tab", () => {
  assert.equal(
    activityWhere({
      spaceName: "fix-login",
      git: { name: "beacon", branch: "task/fix-login", linked: true },
      pr: { number: 293, title: "Fix login spinner", state: "draft" },
    }),
    "beacon · #293 Fix login spinner",
  );
  assert.equal(
    activityWhere({
      spaceName: "fix-sync",
      git: { name: "beacon", branch: "task/fix-sync", linked: true },
      pr: null,
    }),
    "beacon · fix-sync",
  );
  assert.equal(
    activityWhere({
      spaceName: ".config",
      git: { name: "dotfiles", branch: "main", linked: false },
    }),
    ".config",
  );
  assert.equal(
    activityWhere({
      spaceName: ".config",
      git: { name: "dotfiles", branch: "herdr-sidebar-activity", linked: false },
    }),
    ".config · herdr-sidebar-activity",
  );
  assert.equal(
    activityWhere({
      spaceName: "website",
      git: { name: "website", branch: "main", linked: false },
      tabName: "blog",
      tabNamed: true,
      tabCount: 3,
      machine: "vps",
    }),
    "vps · website · blog",
  );
  assert.equal(
    activityWhere({
      spaceName: "website",
      git: { name: "website", branch: "main", linked: false },
      tabName: "1",
      tabNamed: false,
      tabCount: 2,
    }),
    "website",
  );
});

test("state timestamps seed once, hold steady until the dot changes, reset on recycled addresses and prune dead terminals", () => {
  const first = trackSince(
    { stale: { dot: "review", at: 500, created: 10 }, garbage: "bad" },
    [
      { address: "t1", dot: "working", created: 100, seedAt: 1_000 },
      { address: "t2", dot: "review", created: 200, seedAt: null },
    ],
    5_000,
    new Set(["t1", "t2"]),
  );
  assert.deepEqual(first, {
    t1: { dot: "working", at: 1_000, created: 100 },
    t2: { dot: "review", at: 5_000, created: 200 },
  });

  // Unchanged dots keep their timestamp; an empty live set during startup keeps unseen entries.
  const steady = trackSince(first, [{ address: "t1", dot: "working", created: 100, seedAt: 2_000 }], 9_000, new Set());
  assert.equal(steady.t1.at, 1_000);
  assert.equal(steady.t2.at, 5_000);

  // A dot transition stamps now (ignoring old seedAt), and a recycled terminal resets.
  const moved = trackSince(
    steady,
    [
      { address: "t1", dot: "blocked", created: 100, seedAt: 1_000 },
      { address: "t2", dot: "review", created: 999, seedAt: null },
    ],
    12_000,
    new Set(["t1", "t2"]),
  );
  assert.equal(moved.t1.at, 12_000);
  assert.equal(moved.t1.dot, "blocked");
  assert.equal(moved.t2.at, 12_000);
  assert.equal(moved.t2.created, 999);
});

test("folded repositories and folded Spaces still surface their due and running conversations in the top band", () => {
  const tree = new SpacesTree();
  tree.foldedRepos = new Set(["r"]);
  tree.foldedSpaces = new Set(["w1"]);
  tree.prs = { w1: { checkout: "/w1", branch: "fix-a", pr: { number: 42, title: "Fix A", state: "open" }, at: 1_000 } };
  tree.since = {};

  const mainRow = {
    w: { id: "main", name: "app", active: false, tabs: [{ id: "tb1", name: "1", named: false }] },
    g: { name: "app", repo: "r", branch: "main", linked: false },
  };
  const wtRow = {
    w: { id: "w1", name: "fix-a", active: false, tabs: [{ id: "tb2", name: "1", named: false, working_since: 60_000 }] },
    g: { name: "app", repo: "r", branch: "fix-a", linked: true },
  };
  const shown = tree.nest([mainRow, wtRow], true);
  assert.equal(shown[1].hidden, true);

  const model = tree.activity(shown, {
    agents: [
      { address: "t1", pane: "p1", space: "main", tab: "tb1", status: "idle", title: "π - app", program: { name: "Pi" }, focused: false },
      { address: "t2", pane: "p2", space: "w1", tab: "tb2", status: "working", title: "π - fix-a", program: { name: "Pi" }, focused: false },
      { address: "t3", pane: "p3", space: "w1", tab: "tb2", status: "done", title: "π - fix-a", program: { name: "Pi" }, focused: false },
      { address: "t4", pane: "missing", space: "w1", tab: "tb2", status: "blocked", title: "orphan", program: { name: "Pi" }, focused: false },
    ],
    panes: [
      { pane: "p1", tab: "tb1", terminal: "t1", cwd: "/app" },
      { pane: "p2", tab: "tb2", terminal: "t2", cwd: "/w1" },
      { pane: "p3", tab: "tb2", terminal: "t3", cwd: "/w1" },
    ],
    terminals: [
      { address: "t1", state: "live", created_ms: 10, labels: { task_summary: "Idle task" } },
      { address: "t2", state: "live", created_ms: 20, labels: { task_summary: "Port batch worker" } },
      { address: "t3", state: "live", created_ms: 30, labels: { task_summary: "Audit PR threads" } },
    ],
    dots: { t1: "idle", t2: "working", t3: "review", t4: "blocked" },
    now: 300_000,
  });

  assert.equal(model.blocked.length, 0);
  assert.equal(model.review.length, 1);
  assert.equal(model.review[0].address, "t3");
  assert.equal(model.review[0].title, "Audit PR threads");
  assert.equal(model.review[0].where, "app · #42 Fix A");
  assert.equal(model.running.length, 1);
  assert.equal(model.running[0].address, "t2");
  assert.equal(model.running[0].title, "Port batch worker");
  assert.equal(model.running[0].age, "4m");
});

test("invariants hold across generated combinations of dots, ages and repeat observations", () => {
  assert.equal(formatAge(-500), "<1m");
  assert.equal(formatAge(NaN), "<1m");
  assert.equal(formatAge(59_999), "<1m");
  assert.equal(formatAge(8 * 60_000), "8m");
  assert.equal(formatAge(80 * 60_000), "1h 20m");
  assert.equal(formatAge(14 * 3_600_000 + 25 * 60_000), "14h");
  assert.equal(formatAge(50 * 3_600_000), "2d");

  for (const ms of [-1e9, -1, 0, 1, 59_999, 60_000, 3_599_999, 3_600_000, 36_000_000, 86_400_000, 1e11, Infinity, NaN]) {
    const out = formatAge(ms);
    assert.ok(out.length > 0 && !out.includes("-") && !out.includes("NaN"), `bad age for ${ms}: ${out}`);
  }

  const dots = ["idle", "working", "review", "blocked", "saved"];
  for (let mask = 0; mask < 625; mask++) {
    const items = [0, 1, 2, 3].map((i) => ({
      address: `t${i}`,
      dot: dots[Math.floor(mask / 5 ** i) % 5],
      created: 100 + i,
      seedAt: 1_000 + i * 500,
    }));
    const g = activityGroups(items);
    assert.ok(g.blocked.every((x) => x.dot === "blocked"));
    assert.ok(g.review.every((x) => x.dot === "review"));
    assert.ok(g.saved.every((x) => x.dot === "saved"));
    assert.ok(g.running.every((x) => x.dot === "working"));
    assert.equal(g.counts.blocked, g.blocked.length);
    assert.equal(g.counts.review, g.review.length);
    assert.equal(g.counts.saved, g.saved.length);
    assert.equal(g.counts.running, g.running.length);
    assert.equal(g.blocked.length + g.review.length + g.saved.length + g.running.length, items.filter((x) => x.dot !== "idle").length);

    const live = new Set(items.map((x) => x.address));
    const once = trackSince({}, items, 10_000, live);
    const twice = trackSince(once, items, 25_000, live);
    assert.deepEqual(twice, once);
  }
});

const { REVIEW_LABEL, reviewRef, reviewsOf, splitReviews } = await loadMod("spaces-tree");

test("a Space is a review when one of its terminals carries bin/review's label", () => {
  const spaceList = [
    { id: "s1", tabs: [{ id: "tb1" }, { id: "tb2" }] },
    { id: "s2", tabs: [{ id: "tb3" }] },
    { id: "s3", tabs: [{ id: "tb4" }] },
  ];
  const paneList = [
    { pane: "p1", tab: "tb1", terminal: "t1" },
    { pane: "p2", tab: "tb2", terminal: "t2" },
    { pane: "p3", tab: "tb3", terminal: "t3" },
    { pane: "p4", tab: "tb4", terminal: null, mod: "files" },
  ];
  const link = "https://github.com/monoclonalab/dotfiles/pull/8";
  const terminalList = [
    { address: "t1", labels: { task_summary: "Fix login" } },
    { address: "t2", labels: { [REVIEW_LABEL]: link } },
    { address: "t3", labels: {} },
    // A labelled helper shown in no pane marks nothing.
    { address: "t9", labels: { [REVIEW_LABEL]: "https://github.com/a/b/pull/1" } },
  ];
  assert.equal(REVIEW_LABEL, "review.pr");
  assert.deepEqual(reviewsOf(spaceList, paneList, terminalList), { s1: link });
  assert.deepEqual(reviewRef(link), { owner: "monoclonalab", repo: "dotfiles", number: 8 });
  assert.equal(reviewRef("https://github.com/a/b/issues/3"), null);
});

test("a review in a repository's main checkout leaves the tree and never adopts its worktrees", () => {
  const tree = new SpacesTree();
  tree.foldedRepos = new Set();
  const row = (id, linked) => ({ w: { id }, g: { repo: "r", linked } });
  const link = "https://github.com/o/r/pull/8";
  // Only the review sits in the main checkout: the worktree stays at the top level.
  let split = splitReviews([row("review", false), row("w1", true)], { review: link });
  assert.deepEqual(split.review.map((r) => [r.w.id, r.review]), [["review", link]]);
  assert.deepEqual(tree.nest(split.tree, true).map((r) => [r.w.id, r.tree]), [["w1", null]]);
  // With the repository's own Space too, the worktree nests under that one.
  split = splitReviews([row("review", false), row("main", false), row("w1", true)], { review: link });
  assert.deepEqual(tree.nest(split.tree, true).map((r) => [r.w.id, Boolean(r.tree)]), [["main", false], ["w1", true]]);
});

test("a review's finished conversation reads as its repository and pull request in the top band", () => {
  const tree = new SpacesTree();
  tree.since = {};
  const review = {
    w: { id: "rv", name: "#8 Align the window buttons", active: false, tabs: [{ id: "tb1", name: "1", named: false }] },
    g: { name: "dotfiles", repo: "r", branch: "main", linked: false },
    review: "https://github.com/monoclonalab/dotfiles/pull/8",
  };
  const opts = {
    agents: [{ address: "t1", pane: "p1", space: "rv", tab: "tb1", status: "done", title: "π - dotfiles", program: { name: "Pi" }, focused: false }],
    panes: [{ pane: "p1", tab: "tb1", terminal: "t1", cwd: "/dotfiles" }],
    terminals: [{ address: "t1", state: "live", labels: {} }],
    dots: { t1: "review" },
    now: 1_000,
  };
  tree.prs = {};
  assert.equal(tree.activity([review], opts).review[0].where, "dotfiles · #8 Align the window buttons");
  tree.prs = { rv: { checkout: review.review, branch: "review", pr: { number: 8, title: "Align the Herdr window buttons", state: "merged" }, at: 1 } };
  assert.equal(tree.activity([review], opts).review[0].where, "dotfiles · #8 Align the Herdr window buttons");
});

test("the sidebar's grey text moves halfway to the foreground", () => {
  assert.equal(mixHex("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixHex("#8c8fa1", "#4c4f69", 0), "#8c8fa1");
  assert.equal(mixHex("#8c8fa1", "#4c4f69", 1), "#4c4f69");
  assert.equal(mixHex("#e6e9ef74", "#4c4f69", 0.5), "#e6e9ef74");
  // Latte: muted becomes Subtext 1, dim the theme's muted (Subtext 0).
  const latte = ink({ foreground: "#4c4f69", muted: "#6c6f85", dim: "#8c8fa1", accent: "#8839ef" });
  assert.deepEqual(latte, { foreground: "#4c4f69", muted: "#5c5f77", dim: "#6c6f85", accent: "#8839ef" });
  // Mocha (dark): the same step makes them lighter.
  const mocha = ink({ foreground: "#cdd6f4", muted: "#a6adc8", dim: "#7f849c" });
  assert.ok(parseInt(mocha.dim.slice(1, 3), 16) > 0x7f);
});

test("a restarted sidebar draws the tree it last knew at once, then asks git again", async (t) => {
  // C-a p to Review mode and back restarts the eric layout's mods. git takes
  // seconds for every Space, and until it answers nothing says which Space is
  // a worktree of which repository.
  const store = new Map();
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  });
  const asked = [];
  const branch = { "/code/app": "main", "/wt/app/fix": "fix" };
  let active = true;
  globalThis.herdrStub = {
    spaces: () => [{ id: "app", name: "app", folder: "/code/app", tabs: [] }, { id: "fix", name: "fix login", folder: "/wt/app/fix", tabs: [] }],
    panes: () => [],
    window: () => ({ active, platform: "macos" }),
    exec: async (command, args, { cwd } = {}) => {
      if (command !== "git") return { code: 1, stdout: "", stderr: "" };
      asked.push(cwd);
      if (args.includes("status")) return { code: 0, stdout: `# branch.head ${branch[cwd]}\n`, stderr: "" };
      if (args.includes("--show-toplevel")) return { code: 0, stdout: `${cwd}\n`, stderr: "" };
      return { code: 0, stdout: "/code/app/.git\n", stderr: "" };
    },
  };
  t.after(() => {
    delete globalThis.herdrStub;
    if (before) Object.defineProperty(globalThis, "localStorage", before);
    else delete globalThis.localStorage;
  });
  const cx = { notify() {}, spawn: (task) => task(cx), timer: { every() {}, after() {} } };
  const settled = async (tree) => { while (tree.refreshing) await new Promise((done) => setImmediate(done)); };
  const shape = (tree) => tree.ordered().shown.map((r) => [r.w.id, r.g?.branch ?? null, Boolean(r.tree)]);
  const nested = [["app", "main", false], ["fix", "fix", true]];

  const first = new SpacesTree();
  first.init({}, cx);
  first.checkNew(cx);
  await settled(first);
  assert.deepEqual(shape(first), nested);

  // Meanwhile the worktree changed branch, and the window is behind another
  // app, so only the restart itself can make the sidebar ask again.
  asked.length = 0;
  branch["/wt/app/fix"] = "fix-2";
  active = false;
  const again = new SpacesTree();
  again.init({}, cx);
  assert.deepEqual(shape(again), nested, "drawn before git answers");
  again.checkNew(cx);
  await settled(again);
  assert.deepEqual([...new Set(asked)].sort(), ["/code/app", "/wt/app/fix"]);
  assert.deepEqual(shape(again), [["app", "main", false], ["fix", "fix-2", true]]);
});

test("a kept git answer of the wrong shape is dropped, not drawn", (t) => {
  const good = { name: "app", branch: "main", ahead: 0, behind: 2, repo: JSON.stringify([null, "/code/app/.git"]), linked: false };
  const kept = { [JSON.stringify([null, "/code/app"])]: good };
  for (const [i, bad] of [{ branch: 42 }, { name: null }, { repo: "{}" }, { ahead: "2" }, { linked: "yes" }, { repo: "not json" }].entries()) {
    kept[JSON.stringify([null, `/bad/${i}`])] = { ...good, ...bad };
  }
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k) => (k === "git" ? JSON.stringify(kept) : null), setItem() {} } });
  t.after(() => { if (before) Object.defineProperty(globalThis, "localStorage", before); else delete globalThis.localStorage; });
  const tree = new SpacesTree();
  tree.init({}, { notify() {}, spawn() {}, timer: { every() {}, after() {} } });
  assert.deepEqual(tree.git, { [JSON.stringify([null, "/code/app"])]: good });
});
