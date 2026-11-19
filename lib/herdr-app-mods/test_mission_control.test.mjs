// node --test lib/herdr-app-mods/*.test.mjs
// The mission-control mod's rules: which terminals it shows, where its cards go,
// how the keys move, and what a card says.
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const mc = await loadMod("mission-control");
const tree = await loadMod("spaces-tree");
const { CARD, GAP, HEAD, MIN_CARD } = mc;

const tab = (id, name = "1", named = false) => ({ id, name, named });
const space = (id, tabs, active = false) => ({ id, name: id, tabs, active });
const pane = (id, tabId, terminal = `t-${id}`) => ({ pane: id, tab: tabId, terminal });

test("Spaces follow the sidebar's order, then the app's", () => {
  const list = [space("a", []), space("b", []), space("c", [])];
  assert.deepEqual(mc.shownSpaces(list, ["c", "a"], null).map((w) => w.id), ["c", "a", "b"]);
  assert.deepEqual(mc.shownSpaces(list, undefined, null).map((w) => w.id), ["a", "b", "c"]);
});

test("only the active environment's Spaces show, plus the focused one", () => {
  const list = [space("p", []), space("w", []), space("here", [], true), space("new", [])];
  const env = { active: "work", assign: { p: "personal", w: "work", here: "personal" } };
  assert.deepEqual(mc.shownSpaces(list, [], env).map((w) => w.id), ["w", "here"]);
  // A Space spaces-env has not assigned yet counts as Personal, as in the sidebar.
  assert.deepEqual(mc.shownSpaces(list, [], { ...env, active: "personal" }).map((w) => w.id), ["p", "here", "new"]);
});

// The app's agents() for these panes: one entry per agent pane.
const agentsOf = (...ids) => ids.map((id) => ({ pane: id, address: `t-${id}` }));

test("only agents get cards, tab by tab; shells, mod panes and Spaces without an agent are left out", () => {
  const spaces = [space("a", [tab("a1"), tab("a2")]), space("shells", [tab("s1")])];
  const panes = [pane("p3", "a2"), pane("p1", "a1"), pane("zsh", "a1"), { pane: "files", tab: "a1", terminal: null }, pane("p2", "a1"), pane("zsh2", "s1")];
  const secs = mc.sections(spaces, panes, agentsOf("p1", "p2", "p3"));
  assert.equal(secs.length, 1);
  assert.deepEqual(secs[0].cards.map((c) => c.pane.pane), ["p1", "p2", "p3"]);
});

test("columns: as many minimum-width cards as fit, at least one", () => {
  assert.equal(mc.columns(100), 1);
  assert.equal(mc.columns(MIN_CARD * 2 + GAP), 2);
  assert.equal(mc.columns(MIN_CARD * 2 + GAP - 1), 1);
});

// Space a: 5 cards (rows of 3 and 2), Space b: 1 card.
const board = () => {
  const spaces = [space("a", [tab("ta")]), space("b", [tab("tb")])];
  const panes = ["a0", "a1", "a2", "a3", "a4"].map((id) => pane(id, "ta")).concat(pane("b0", "tb"));
  return mc.grid(mc.sections(spaces, panes, agentsOf(...panes.map((p) => p.pane))), 3);
};

test("the grid puts a heading above each Space's rows of cards", () => {
  const g = board();
  assert.deepEqual(g.rows.map((r) => r.kind), ["head", "cards", "cards", "head", "cards"]);
  assert.deepEqual(g.rows.map((r) => r.top), [0, HEAD, HEAD + CARD + GAP, HEAD + 2 * (CARD + GAP), 2 * HEAD + 2 * (CARD + GAP)]);
  assert.deepEqual(g.cards.map((c) => [c.row, c.col]), [[1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [4, 0]]);
  assert.equal(g.height, 2 * HEAD + 3 * (CARD + GAP));
});

test("left and right walk the order; up and down keep the column where they can", () => {
  const g = board();
  assert.equal(mc.step(g, 2, "right"), 3); // the end of a row wraps to the next
  assert.equal(mc.step(g, 0, "left"), 0);
  assert.equal(mc.step(g, 5, "right"), 5);
  assert.equal(mc.step(g, 2, "down"), 4); // a shorter row: its last card
  assert.equal(mc.step(g, 4, "down"), 5); // across Spaces
  assert.equal(mc.step(g, 5, "up"), 3);
  assert.equal(mc.step(g, 1, "up"), 1);
  assert.equal(mc.step(g, 99, "left"), 4); // a stale index is clamped first
  assert.equal(mc.step(mc.grid([], 3), 0, "down"), 0);
});

test("moving scrolls only as far as it takes, bringing a Space's heading along", () => {
  const g = board();
  const height = CARD + 40;
  assert.equal(mc.reveal(g, 0, 0, height), 0);
  const down = mc.reveal(g, 3, 0, height); // second row of Space a
  assert.equal(down, g.rows[2].top + CARD - height);
  const b = mc.reveal(g, 5, down, height); // Space b's first row
  assert.equal(b, g.rows[4].top + CARD - height);
  assert.equal(mc.reveal(g, 0, b, height), 0); // back up: Space a's heading too
  assert.equal(mc.reveal(g, 1, 0, 10_000), 0); // everything fits
});

test("rows a screen either side of the view are drawn too, ready to slide in", () => {
  const g = board();
  const height = HEAD + CARD; // shows the heading and first row of Space a
  assert.deepEqual(mc.drawn(g.rows, 0, height), [0, 1, 2, 3]);
  assert.deepEqual(mc.drawn(g.rows, 0, 10_000), [0, 1, 2, 3, 4]);
  // Scrolled to Space b: Space a's heading is more than a screen above.
  assert.deepEqual(mc.drawn(g.rows, g.rows[4].top, height), [2, 3, 4]);
});

test("the selection ring sits over its card", () => {
  const g = board();
  assert.deepEqual(mc.ringAt(g, 0, 300), { left: 0, top: HEAD });
  assert.deepEqual(mc.ringAt(g, 4, 300), { left: 300 + GAP, top: HEAD + CARD + GAP });
  assert.deepEqual(mc.ringAt(g, 5, 300), { left: 0, top: g.rows[4].top });
  assert.equal(mc.ringAt(g, 9, 300), null);
});

test("a card shows the screen's last lines, blank runs folded", () => {
  const screen = "first\n\n\n\nsecond   \n\n\nthird\n\n\n   \n";
  assert.deepEqual(mc.tail(screen, 10), ["first", "", "second", "", "third"]);
  assert.deepEqual(mc.tail(screen, 2), ["", "third"]);
  assert.deepEqual(mc.tail("", 5), []);
  assert.deepEqual(mc.tail(null, 5), []);
  assert.equal(mc.tail("x".repeat(500), 1)[0].length, 240);
});

test("a card is titled as the sidebar titles its conversation", () => {
  const cases = [
    { summary: "Fix login spinner", title: "π - beacon" },
    { title: "π - beacon", cwd: "/r/beacon", spaceName: "beacon", tabName: "review", tabNamed: true, program: "Pi" },
    { title: "π - beacon", cwd: "/r/beacon", spaceName: "beacon", pending: true, program: "Pi" },
    { title: "⠋ migrate store", cwd: "/r/x", program: "Pi" },
    { title: "~/dotfiles", cwd: "/Users/e/dotfiles", program: "zsh" },
    { title: "npm run dev", cwd: "/r/app", program: "zsh" },
    { title: "", program: "" },
  ];
  for (const c of cases) assert.deepEqual(mc.conversationTitle(c), tree.conversationTitle(c), JSON.stringify(c));
});

// A `gh api graphql` reply for PR_QUERY, shaped like GitHub's (made-up repos).
const node = (repo, number, { draft = false, decision = null, checks } = {}) => ({
  number, title: `${repo} change ${number}`, url: `https://github.com/${repo}/pull/${number}`, isDraft: draft,
  repository: { nameWithOwner: repo }, reviewDecision: decision,
  commits: { nodes: checks === undefined ? [] : [{ commit: { statusCheckRollup: checks && { state: checks } } }] },
});
const reply = (review, mine, totals = {}) => ({
  code: 0, stderr: "",
  stdout: JSON.stringify({ data: {
    review: { issueCount: totals.review ?? review.length, nodes: review },
    mine: { issueCount: totals.mine ?? mine.length, nodes: mine },
  } }),
});

test("pull requests: review requests and your own, in GitHub's order, with their state", () => {
  const got = mc.pullRequests(reply(
    [node("acme/api", 7, { decision: "REVIEW_REQUIRED", checks: "SUCCESS" })],
    [node("me/site", 3, { draft: true }), node("acme/web", 12, { decision: "APPROVED", checks: "PENDING" })],
  ));
  assert.deepEqual(got.review.items, [
    { repo: "acme/api", number: 7, title: "acme/api change 7", url: "https://github.com/acme/api/pull/7", draft: false, ci: "pass", review: null },
  ]);
  assert.deepEqual(got.mine.items.map((p) => [p.repo, p.number, p.draft, p.ci, p.review]), [
    ["me/site", 3, true, null, null],
    ["acme/web", 12, false, "pending", "approved"],
  ]);
  assert.equal(got.error, undefined);
});

test("pull requests: checks and review decisions read as GitHub shows them", () => {
  const ci = (checks) => mc.pullRequests(reply([], [node("a/b", 1, { checks })])).mine.items[0].ci;
  assert.equal(ci("SUCCESS"), "pass");
  assert.equal(ci("FAILURE"), "fail");
  assert.equal(ci("ERROR"), "fail");
  assert.equal(ci("PENDING"), "pending");
  assert.equal(ci("EXPECTED"), "pending");
  assert.equal(ci(null), null); // a commit without checks
  assert.equal(ci(undefined), null); // no commits
  const review = (decision) => mc.pullRequests(reply([], [node("a/b", 1, { decision })])).mine.items[0].review;
  assert.equal(review("APPROVED"), "approved");
  assert.equal(review("CHANGES_REQUESTED"), "changes");
  assert.equal(review("REVIEW_REQUIRED"), null);
  assert.equal(review(null), null);
});

test("pull requests: totals count what GitHub has beyond the first page", () => {
  const got = mc.pullRequests(reply([], [node("a/b", 1)], { mine: 45 }));
  assert.equal(got.mine.total, 45);
  assert.equal(got.mine.items.length, 1);
  // Nodes that are not pull requests come back empty and are left out.
  assert.deepEqual(mc.pullRequests(reply([{}], [])).review.items, []);
});

test("pull requests: a failed gh run is an error with gh's own message", () => {
  assert.deepEqual(mc.pullRequests({ code: 1, stdout: "", stderr: "gh: Bad credentials (HTTP 401)\nTry authenticating with:  gh auth login\n" }),
    { error: "gh: Bad credentials (HTTP 401)" });
  assert.deepEqual(mc.pullRequests({ code: 4, stdout: "", stderr: "" }), { error: "gh exited with 4" });
  assert.ok(mc.pullRequests({ code: 0, stdout: "<html>", stderr: "" }).error);
  assert.ok(mc.pullRequests({ code: 0, stdout: '{"data":null}', stderr: "" }).error);
});

test("pull requests: a failed refresh keeps the last lists and says why", () => {
  const good = mc.pullRequests(reply([], [node("a/b", 1)]));
  const failed = mc.pullRequests({ code: 1, stdout: "", stderr: "gh: offline\n" });
  assert.deepEqual(mc.refreshed(good, failed), { ...good, error: "gh: offline" });
  assert.deepEqual(mc.refreshed(null, failed), failed);
  const next = mc.pullRequests(reply([node("c/d", 2)], []));
  assert.deepEqual(mc.refreshed({ ...good, error: "gh: offline" }, next), next);
});
