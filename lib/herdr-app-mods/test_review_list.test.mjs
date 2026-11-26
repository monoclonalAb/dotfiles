// node --test lib/herdr-app-mods/*.test.mjs
// Review mode's pull request list (docs/plans/active/2026-11-25-review-mode.md,
// step 2): review-nav's loadPullRequests against a fake `gh` that answers the
// way GitHub does, and the state chip of each pull request.
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { loadPullRequests, chip, CHIPS, navKey } = await loadMod("review-nav");

// `-f name=value` pairs of a gh command line.
const fields = (args) => {
  const out = {};
  args.forEach((arg, i) => {
    if (arg !== "-f") return;
    const [name, ...rest] = args[i + 1].split("=");
    const value = rest.join("=");
    if (name.endsWith("[]")) (out[name] ??= []).push(value);
    else out[name] = value;
  });
  return out;
};

// A pull request as GitHub's GraphQL `nodes(ids:)` returns it.
const node = (id, over = {}) => ({
  id,
  number: Number(id.replace(/\D/g, "")) || 1,
  title: `Pull request ${id}`,
  url: `https://github.com/example/app/pull/${id.replace(/\D/g, "") || 1}`,
  isDraft: false,
  body: "Does a thing.",
  repository: { nameWithOwner: "example/app" },
  author: { login: "teammate" },
  headRefName: "feature",
  baseRefName: "main",
  additions: 22,
  deletions: 4,
  changedFiles: 3,
  mergeable: "MERGEABLE",
  mergeStateStatus: "CLEAN",
  reviewDecision: null,
  labels: { nodes: [] },
  reviewRequests: { nodes: [{ requestedReviewer: { login: "you" } }] },
  latestReviews: { nodes: [] },
  commits: { nodes: [{ commit: { statusCheckRollup: rollup("SUCCESS", { SUCCESS: 3 }) } }] },
  ...over,
});

function rollup(state, runs = {}, statuses = {}) {
  const counts = (by) => Object.entries(by).map(([s, count]) => ({ state: s, count }));
  const sum = (by) => Object.values(by).reduce((a, b) => a + b, 0);
  return { state, contexts: { checkRunCount: sum(runs), checkRunCountsByState: counts(runs), statusContextCount: sum(statuses), statusContextCountsByState: counts(statuses) } };
}

// GitHub: issue search pages (REST, as `gh search prs` uses) and the details
// query. Search stops at 1000 results, like GitHub's, and `nodes` takes at
// most 100 ids.
function github({ review = [], mine = [], totals = {}, incomplete = {}, nodes = {} } = {}) {
  const calls = [];
  const lists = { review, mine };
  const gh = async (args) => {
    calls.push(args);
    const f = fields(args);
    if (args.includes("search/issues")) {
      const key = /review-requested:@me/.test(f.q) ? "review" : /author:@me/.test(f.q) ? "mine" : null;
      assert.ok(key, `unexpected search ${f.q}`);
      const page = Number(f.page), per = Number(f.per_page);
      if ((page - 1) * per >= 1000) return { code: 1, stdout: "", stderr: "gh: Only the first 1000 search results are available (HTTP 422)" };
      const items = lists[key].slice((page - 1) * per, page * per).map((id) => ({ node_id: id }));
      return { code: 0, stdout: JSON.stringify({ total_count: totals[key] ?? lists[key].length, incomplete_results: (incomplete[key] ?? []).includes(page), items }), stderr: "" };
    }
    assert.ok(args.includes("graphql"), `unexpected gh ${args.join(" ")}`);
    const ids = f["ids[]"] ?? [];
    if (ids.length > 100) return { code: 1, stdout: "", stderr: "gh: too many ids" };
    return { code: 0, stdout: JSON.stringify({ data: { nodes: ids.map((id) => (id in nodes ? nodes[id] : node(id))) } }), stderr: "" };
  };
  return { gh, calls };
}

const ids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
const section = (list, key) => list.sections.find((s) => s.key === key);

test("review requests and your own pull requests are fetched across two pages", async () => {
  const { gh, calls } = github({ review: ids("R", 150), mine: ids("M", 3) });
  const list = await loadPullRequests(gh);
  assert.deepEqual(section(list, "review").prs.map((p) => p.number), Array.from({ length: 150 }, (_, i) => i + 1));
  assert.equal(section(list, "mine").prs.length, 3);
  const pages = calls.filter((a) => a.includes("search/issues")).map((a) => `${/review/.test(fields(a).q) ? "R" : "M"}${fields(a).page}`);
  assert.deepEqual(pages, ["R1", "R2", "M1"]);
  assert.equal(section(list, "review").more, 0);
  assert.equal(section(list, "review").incomplete, false);
});

test("past GitHub's 1000-result cap, the list shows 1000 and says how many more", async () => {
  const { gh, calls } = github({ mine: ids("M", 1000), totals: { mine: 1234 } });
  const mine = section(await loadPullRequests(gh), "mine");
  assert.equal(mine.prs.length, 1000);
  assert.equal(mine.more, 234);
  assert.ok(calls.filter((a) => a.includes("graphql")).every((a) => fields(a)["ids[]"].length <= 100));
});

test("a search page GitHub marks incomplete makes the section say so", async () => {
  const { gh } = github({ review: ids("R", 120), incomplete: { review: [2] } });
  const list = await loadPullRequests(gh);
  assert.equal(section(list, "review").incomplete, true);
  assert.equal(section(list, "mine").incomplete, false);
});

test("a pull request GitHub no longer returns is left out, the rest still show", async () => {
  const { gh } = github({ review: ["R1", "R2"], nodes: { R1: null } });
  assert.deepEqual(section(await loadPullRequests(gh), "review").prs.map((p) => p.number), [2]);
});

test("a failed search rejects with gh's message", async () => {
  const gh = async () => ({ code: 1, stdout: "", stderr: "gh: To get started with GitHub CLI, please run:  gh auth login\n" });
  await assert.rejects(loadPullRequests(gh), /gh auth login/);
});

// The plan's states, each with GitHub's fields for it.
const STATES = [
  ["clean", { mergeStateStatus: "CLEAN", reviewDecision: "APPROVED" }, "Ready to merge"],
  ["blocked by review", { mergeStateStatus: "BLOCKED", reviewDecision: "REVIEW_REQUIRED" }, "Review required"],
  ["failing checks", { mergeStateStatus: "UNSTABLE", commits: { nodes: [{ commit: { statusCheckRollup: rollup("FAILURE", { SUCCESS: 2, FAILURE: 1 }) } }] } }, "CI failing"],
  ["checks running", { mergeStateStatus: "BLOCKED", commits: { nodes: [{ commit: { statusCheckRollup: rollup("PENDING", { SUCCESS: 1, IN_PROGRESS: 2 }) } }] } }, "Checks running"],
  ["conflicts", { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }, "Conflicts"],
  ["changes requested", { mergeStateStatus: "BLOCKED", reviewDecision: "CHANGES_REQUESTED" }, "Changes requested"],
  ["draft", { isDraft: true, mergeStateStatus: "DRAFT" }, "Draft"],
  ["unknown", { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }, "Unknown"],
];

test("each state gets its own chip", async () => {
  const review = STATES.map((_, i) => `R${i + 1}`);
  const nodes = Object.fromEntries(STATES.map(([, over], i) => [`R${i + 1}`, node(`R${i + 1}`, over)]));
  const prs = section(await loadPullRequests(github({ review, nodes }).gh), "review").prs;
  assert.deepEqual(prs.map((p) => CHIPS[p.chip]), STATES.map(([, , label]) => label));
});

test("approved alone never shows as Ready to merge", () => {
  const MERGE_STATES = ["BEHIND", "BLOCKED", "CLEAN", "DIRTY", "DRAFT", "HAS_HOOKS", "UNKNOWN", "UNSTABLE"];
  for (const mergeState of MERGE_STATES) {
    for (const mergeable of ["MERGEABLE", "CONFLICTING", "UNKNOWN"]) {
      const pr = { draft: mergeState === "DRAFT", mergeable, mergeState, reviewDecision: "APPROVED", checks: { state: "SUCCESS" } };
      const clean = ["CLEAN", "HAS_HOOKS"].includes(mergeState) && mergeable === "MERGEABLE";
      assert.equal(chip(pr) === "ready", clean, `${mergeState}/${mergeable}`);
    }
  }
});

test("checks count passed and total across check runs and commit statuses", async () => {
  const over = { commits: { nodes: [{ commit: { statusCheckRollup: rollup("FAILURE", { SUCCESS: 2, SKIPPED: 1, FAILURE: 1 }, { SUCCESS: 1, PENDING: 1 }) } }] } };
  const [pr] = section(await loadPullRequests(github({ review: ["R1"], nodes: { R1: node("R1", over) } }).gh), "review").prs;
  assert.deepEqual(pr.checks, { state: "FAILURE", passed: 4, total: 6 });
});

test("only plain j, k, arrows and Enter move or open; C-a p and other chords pass through", () => {
  const key = (key, modifiers = {}) => navKey({ key, modifiers });
  assert.equal(key("j"), 1);
  assert.equal(key("down"), 1);
  assert.equal(key("k"), -1);
  assert.equal(key("up"), -1);
  assert.equal(key("enter"), "open");
  for (const [k, m] of [["a", { control: true }], ["p", {}], ["p", { control: true }], ["j", { control: true }], ["j", { platform: true }], ["k", { alt: true }], ["J", { shift: true }]]) {
    assert.equal(key(k, m), null, `${JSON.stringify(m)} ${k}`);
  }
});
