// node --test lib/herdr-app-mods/*.test.mjs
// Review mode's pull request list (docs/plans/active/2026-11-25-review-mode.md,
// step 2): review-nav's loadPullRequests against a fake `gh` that answers the
// way GitHub does, and the state chip of each pull request.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { loadPullRequests, recheckUnknown, openNow, chip, CHIPS, navKey, keptList } = await loadMod("review-nav");

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
    const asked = calls.filter((a) => a.includes("graphql")).length;
    const answer = (id) => (typeof nodes[id] === "function" ? nodes[id](asked) : id in nodes ? nodes[id] : node(id));
    return { code: 0, stdout: JSON.stringify({ data: { nodes: ids.map(answer) } }), stderr: "" };
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
  assert.deepEqual(pages.sort(), ["M1", "R1", "R2"], "each page once; the two searches run side by side");
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

test("a pull request whose details GitHub doesn't return is counted, the rest still show", async () => {
  const { gh } = github({ review: ["R1", "R2"], nodes: { R1: null } });
  const review = section(await loadPullRequests(gh), "review");
  assert.deepEqual(review.prs.map((p) => p.number), [2]);
  assert.equal(review.missing, 1);
});

test("the open pull request follows the list: refreshed while listed, marked when it leaves", async () => {
  const { gh } = github({ review: ["R1", "R2"], nodes: { R1: node("R1", { title: "Renamed" }) } });
  const list = await loadPullRequests(gh);
  const was = { ...section(list, "review").prs[0], title: "Old title" };
  assert.equal(openNow(was, list).title, "Renamed");
  assert.equal(openNow(was, list).gone, undefined);
  const merged = { ...was, id: "R9", url: "https://github.com/example/app/pull/9" };
  assert.equal(openNow(merged, list).gone, true);
  assert.equal(openNow(merged, list).title, merged.title);
  assert.equal(openNow(null, list), null);
  const renamed = { ...was, url: "https://github.com/example/old-name/pull/1" };
  assert.equal(openNow(renamed, list).gone, undefined, "a renamed repository's pull request is found by its id");
});

test("a reviewer asked again shows the new request and the earlier review", async () => {
  const over = { reviewRequests: { nodes: [{ requestedReviewer: { login: "sam" } }] }, latestReviews: { nodes: [{ author: { login: "sam" }, state: "CHANGES_REQUESTED" }, { author: { login: "kim" }, state: "APPROVED" }] } };
  const [pr] = section(await loadPullRequests(github({ review: ["R1"], nodes: { R1: node("R1", over) } }).gh), "review").prs;
  assert.deepEqual(pr.reviewers, [{ name: "sam", state: "REQUESTED" }, { name: "sam", state: "CHANGES_REQUESTED" }, { name: "kim", state: "APPROVED" }]);
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
      const clean = mergeState === "CLEAN" && mergeable === "MERGEABLE";
      assert.equal(chip(pr) === "ready", clean, `${mergeState}/${mergeable}`);
    }
  }
});

test("an UNKNOWN merge verdict is asked again, for those pull requests only", async () => {
  // GitHub answers UNKNOWN until it has worked the verdict out (11 of 27 real
  // pull requests on a first load), then the real one.
  const nodes = {
    R1: (asked) => node("R1", asked === 1 ? { mergeable: "UNKNOWN", mergeStateStatus: "UNKNOWN", reviewDecision: "REVIEW_REQUIRED" } : { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", reviewDecision: "REVIEW_REQUIRED" }),
    R2: node("R2"),
  };
  const { gh, calls } = github({ review: ["R1", "R2"], nodes });
  const first = await loadPullRequests(gh);
  assert.deepEqual(section(first, "review").prs.map((p) => p.chip), ["review", "ready"]);
  const { list, unknown } = await recheckUnknown(gh, first);
  assert.deepEqual(section(list, "review").prs.map((p) => p.chip), ["conflicts", "ready"]);
  assert.equal(unknown, 0);
  assert.deepEqual(fields(calls.at(-1))["ids[]"], ["R1"]);
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

const { default: Nav } = await loadMod("review-nav");

// The saved list's file, review-nav's files and gh through the app's exec,
// for one test. A write is refused unless the file still holds the text it
// was read with, as writeTextFile does.
const LIST = "/home/.cache/herdr-review/list.json";
function inApp(t, gh) {
  const files = new Map();
  globalThis.herdrStub = {
    exec: (command, args) => gh(args),
    window: () => ({ visible: true }),
    readTextFile: async (path) => files.get(path) ?? null,
    writeTextFile: async (path, text, expected) => {
      if ((files.get(path) ?? null) !== expected) throw new Error("stale snapshot");
      files.set(path, text);
    },
  };
  t.after(() => { delete globalThis.herdrStub; });
  return files;
}
const appCx = { notify() {}, spawn: (task) => task(appCx), timer: { every() {}, after() {} }, focus_handle: () => ({ focus() {} }) };
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((done) => setImmediate(done)); };
const loaded = async (nav) => { while (nav.loading) await new Promise((done) => setImmediate(done)); await settle(); };
const saved = (list) => JSON.stringify({ version: 1, list });

test("Review mode opens on the last list at once, then loads a fresh one", async (t) => {
  // C-a p restarts review-nav, and GitHub takes seconds to answer.
  const { gh } = github({ review: ["R1"], mine: ["M2", "M3"] });
  inApp(t, gh);
  const first = new Nav();
  first.init({}, appCx);
  await loaded(first);
  assert.deepEqual(first.prs().map((p) => p.number), [1, 2, 3]);

  globalThis.herdrStub.exec = () => new Promise(() => {});
  const again = new Nav();
  again.init({}, appCx);
  await settle();
  assert.deepEqual(again.prs().map((p) => p.number), [1, 2, 3], "drawn before GitHub answers");
  assert.equal(again.loading, true, "and a fresh list is on its way");
});

test("a kept list of the wrong shape is not drawn", async (t) => {
  const files = inApp(t, () => new Promise(() => {}));
  const { gh } = github({ review: ["R1"] });
  const good = await loadPullRequests(gh);
  for (const bad of [{ ...good, sections: "x" }, { ...good, sections: [{ ...good.sections[0], prs: [{ ...good.sections[0].prs[0], body: undefined }] }] }]) {
    files.set(LIST, saved(bad));
    const nav = new Nav();
    nav.init({}, appCx);
    await settle();
    assert.equal(nav.list, null);
  }
});

test("a saved list never decides the open pull request is gone; only a fresh one does", async (t) => {
  const files = inApp(t, () => new Promise(() => {}));
  const { gh } = github({ review: ["R1"] });
  files.set(LIST, saved(await loadPullRequests(gh)));
  const open = { ...node("R3"), url: "https://github.com/example/app/pull/3" };
  globalThis.herdrStub.shared = (k) => (k === "review-mode.open" ? open : undefined);
  let set = null;
  globalThis.herdrStub.setShared = (k, v) => { set = [k, v]; };
  let answer;
  const asked = new Promise((done) => { answer = done; });
  globalThis.herdrStub.exec = async (command, args) => { await asked; return gh(args); };
  const nav = new Nav();
  nav.init({}, appCx);
  await settle();
  assert.equal(nav.prs().length, 1, "the saved list is drawn");
  assert.equal(set, null, "nothing shared changed from the saved list");
  answer();
  await loaded(nav);
  assert.deepEqual(set?.[0], "review-mode.open");
  assert.equal(set[1].gone, true, "the fresh list, without #3, marks it gone");
});

test("a fresh list too big to save clears the saved one", async (t) => {
  const files = inApp(t, () => new Promise(() => {}));
  files.set(LIST, saved(await loadPullRequests(github({ review: ["R1"] }).gh)));
  const big = github({ review: ["R1", "R2"], nodes: { R2: node("R2", { body: "x".repeat(600 * 1024) }) } });
  globalThis.herdrStub.exec = (command, args) => big.gh(args);
  const nav = new Nav();
  nav.init({}, appCx);
  await loaded(nav);
  assert.deepEqual(nav.prs().map((p) => p.number), [1, 2]);
  assert.equal(keptList(files.get(LIST)), null);
});

test("the eric layout's hidden copy keeps the list fresh for Review mode, without the keyboard", async (t) => {
  // review-nav with { part: "warm" } sits in the eric layout's status bar.
  const files = inApp(t, github({ review: ["R1"], mine: ["M2"] }).gh);
  globalThis.herdrStub.props = () => ({ part: "warm" });
  let visible = true, focused = 0;
  globalThis.herdrStub.window = () => ({ visible });
  const every = [];
  const cx = { notify() {}, spawn: (task) => task(cx), timer: { every: (ms, fn) => every.push([ms, fn]), after() {} }, focus_handle: () => ({ focus() { focused++; } }) };
  const warm = new Nav();
  warm.init(undefined, cx);
  await loaded(warm);
  assert.equal(focused, 0, "never takes the keyboard");
  assert.ok(warm.render(cx));
  assert.deepEqual(keptList(files.get(LIST)).sections.flatMap((s) => s.prs).map((p) => p.number), [1, 2]);

  // Two minutes on: refreshed while the window shows, not while it is hidden.
  const [[ms, tick]] = every.filter(([ms]) => ms === 120000);
  assert.equal(ms, 120000);
  const more = github({ review: ["R1"], mine: ["M2", "M4"] });
  let asked = 0;
  globalThis.herdrStub.exec = (command, args) => { asked++; return more.gh(args); };
  visible = false;
  tick(cx);
  await loaded(warm);
  assert.equal(asked, 0);
  visible = true;
  tick(cx);
  await loaded(warm);
  assert.deepEqual(keptList(files.get(LIST)).sections.flatMap((s) => s.prs).map((p) => p.number), [1, 2, 4]);

  // C-a p: Review mode's copy opens on that list before GitHub answers.
  delete globalThis.herdrStub.props;
  globalThis.herdrStub.exec = () => new Promise(() => {});
  const nav = new Nav();
  nav.init(undefined, appCx);
  await settle();
  assert.deepEqual(nav.prs().map((p) => p.number), [1, 2, 4]);
});

test("the eric layout has the hidden copy in its status bar", () => {
  const eric = JSON.parse(readFileSync(new URL("../../herdr-app/layouts/eric.json", import.meta.url), "utf8"));
  const blocks = [];
  const visit = (n) => { if (n.type === "block") blocks.push(n); n.children?.forEach(visit); };
  visit(eric);
  const warm = blocks.filter((b) => b.content?.mod === "review-nav");
  assert.deepEqual(warm.map((b) => [b.content.props, b.size]), [[{ part: "warm" }, { px: 0 }]]);
});

test("once a details query fails, no further ones start", async () => {
  const { gh, calls } = github({ review: ids("R", 40) });
  let details = 0;
  const failing = async (args) => {
    if (args.includes("graphql") && ++details === 1) return { code: 1, stdout: "", stderr: "gh: API rate limit exceeded (HTTP 403)" };
    return gh(args);
  };
  await assert.rejects(loadPullRequests(failing), /rate limit/);
  await new Promise((done) => setImmediate(done));
  assert.ok(details <= 4, `${details} details queries; the first 4 were already under way`);
});

test("the hidden copy skips its first load when the saved list is under 2 minutes old", async (t) => {
  // Coming back from Review mode restarts the eric layout's mods.
  const files = inApp(t, () => new Promise(() => {}));
  const list = await loadPullRequests(github({ review: ["R1"] }).gh);
  globalThis.herdrStub.props = () => ({ part: "warm" });
  let asked = 0;
  globalThis.herdrStub.exec = () => { asked++; return new Promise(() => {}); };
  for (const [age, loads] of [[10000, 0], [130000, 1]]) {
    asked = 0;
    files.set(LIST, saved({ ...list, at: Date.now() - age }));
    const warm = new Nav();
    warm.init(undefined, appCx);
    await settle();
    assert.equal(asked > 0 ? 1 : 0, loads, `saved ${age / 1000} s ago`);
  }
});
