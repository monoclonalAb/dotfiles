// node --test lib/herdr-app-mods/*.test.mjs
// Review mode's design D (Paper file "Review", frames "D · Mix"): a pull
// request opens on its Description tab with the list still on the left; the
// Files tab turns the left into its files; the right column is a "Your
// review" checklist. The three mods share state through herdr's shared().
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { default: Nav, OPEN, SNAPSHOT, FILE, VIEWED, TAB, TOGGLE } = await loadMod("review-nav");
const { tabsFor, ago, toggleViewed } = await loadMod("review-page");
const { reviewSteps, nextUnviewed } = await loadMod("review-side");

const pr = (n, over = {}) => ({
  id: `PR${n}`, number: n, url: `https://github.com/example/app/pull/${n}`, title: `Pull request ${n}`,
  repo: "example/app", author: "sam", base: "main", head: `branch-${n}`, draft: false, body: "", additions: 3,
  deletions: 1, files: 2, mergeState: "BLOCKED", mergeable: "MERGEABLE", reviewDecision: "REVIEW_REQUIRED",
  checks: { state: "SUCCESS", passed: 4, total: 4 }, labels: [], reviewers: [], chip: "review", ...over,
});
const list = (...prs) => ({ at: Date.now(), sections: [{ key: "review", title: "Needs your review", prs, more: 0, missing: 0, incomplete: false }] });
const files = (...paths) => paths.map((path) => ({ path, old_path: null, status: "modified", additions: 1, deletions: 1, binary: false, too_large: false }));
const SNAP = `${"a".repeat(40)}:${"b".repeat(40)}:main`;

// The app's shared state, exec and files for one test. review-analyse
// answers `snapshot` with `answer` (or never).
function app(t, { answer, files: disk = new Map() } = {}) {
  const state = new Map();
  const calls = [];
  globalThis.herdrStub = {
    shared: (k) => state.get(k),
    setShared: (k, v) => state.set(k, v),
    window: () => ({ visible: true }),
    exec: (command, args) => {
      calls.push([command, ...args]);
      if (command.endsWith("review-analyse") && args[0] === "snapshot" && answer) return Promise.resolve({ code: 0, stdout: JSON.stringify(answer(args[1])), stderr: "" });
      return new Promise(() => {});
    },
    readTextFile: async (path) => disk.get(path) ?? null,
    writeTextFile: async (path, text, expected) => {
      if ((disk.get(path) ?? null) !== expected) throw new Error("stale snapshot");
      disk.set(path, text);
    },
  };
  t.after(() => { delete globalThis.herdrStub; });
  return { state, calls, disk };
}
const cx = { notify() {}, spawn: (task) => task(cx), timer: { every() {}, after() {} }, focus_handle: () => ({ focus() {} }) };
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((done) => setImmediate(done)); };
const press = (nav, key) => nav.key({ key, modifiers: {} }, cx);
const snapshotOf = (url) => ({ pr: url, snapshot: SNAP, head: "a".repeat(40), merge_base: "b".repeat(40), base: "main", changed_files: 2, additions: 2, deletions: 2, files: files("src/a.ts", "src/b.ts") });

test("Enter opens a pull request on its description; Enter again goes to its files; Esc comes back", async (t) => {
  const { state } = app(t, { answer: snapshotOf });
  const nav = new Nav();
  nav.init(undefined, cx);
  nav.list = list(pr(1), pr(2));
  nav.selected = pr(1).url;

  press(nav, "enter");
  await settle();
  assert.equal(state.get(OPEN).url, pr(1).url);
  assert.equal(state.get(TAB), "description");
  assert.equal(nav.inFiles(), false, "the list stays on the left");
  assert.equal(state.get(FILE)?.path, "src/a.ts", "the first file is ready for the Files tab");

  press(nav, "enter");
  assert.equal(state.get(TAB), "files");
  assert.equal(nav.inFiles(), true);
  press(nav, "j");
  assert.equal(state.get(FILE).path, "src/b.ts");

  press(nav, "escape");
  assert.equal(state.get(TAB), "description");
  assert.equal(state.get(FILE).path, "src/b.ts", "coming back to Files returns to the same file");

  press(nav, "j");
  assert.equal(nav.selected, pr(2).url, "back in the list, j moves through pull requests");
  press(nav, "enter");
  assert.equal(state.get(OPEN).url, pr(2).url);
  assert.equal(state.get(TAB), "description");
});

test("the Files view follows the shared tab, so the page's tabs and the checklist's button can switch it", (t) => {
  const { state } = app(t);
  const nav = new Nav();
  nav.init(undefined, cx);
  state.set(OPEN, pr(1));
  state.set(TAB, "files");
  assert.equal(nav.inFiles(), true);
  state.set(TAB, "checks");
  assert.equal(nav.inFiles(), false);
});

test("a snapshot left loading by a layout switch is taken again", (t) => {
  const { state, calls } = app(t);
  state.set(OPEN, pr(1));
  state.set(TAB, "files");
  state.set(SNAPSHOT, { pr: pr(1).url, status: "loading", request: "gone" });
  const nav = new Nav();
  nav.init(undefined, cx);
  assert.deepEqual(calls.filter(([c, a]) => c.endsWith("review-analyse") && a === "snapshot").map((c) => c[2]), [pr(1).url]);
  assert.equal(state.get(TAB), "files", "and the tab stays");
});

test("a Viewed click in the middle column is saved once by the list's mod", async (t) => {
  const { state, disk } = app(t);
  state.set(OPEN, pr(1));
  state.set(SNAPSHOT, { ...snapshotOf(pr(1).url), status: "ready" });
  state.set(VIEWED, { pr: pr(1).url, snapshot: SNAP, paths: [] });
  state.set(FILE, { pr: pr(1).url, snapshot: SNAP, path: "src/a.ts" });
  const nav = new Nav();
  nav.init(undefined, cx);
  toggleViewed(state.get(FILE));
  assert.deepEqual({ ...state.get(TOGGLE), nonce: 0 }, { pr: pr(1).url, snapshot: SNAP, path: "src/a.ts", nonce: 0 });
  nav.render(cx);
  nav.render(cx);
  await settle();
  assert.deepEqual(state.get(VIEWED).paths, ["src/a.ts"]);
  assert.equal(disk.size, 1);
  const saved = [...disk.values()][0];

  // A restart doesn't replay the old click.
  const again = new Nav();
  again.init(undefined, cx);
  again.render(cx);
  await settle();
  assert.equal([...disk.values()][0], saved);
  assert.deepEqual(state.get(VIEWED).paths, ["src/a.ts"]);
});

test("the tabs: Description, Files and Checks with their counts", () => {
  assert.deepEqual(tabsFor(pr(1), null).map((x) => [x.key, x.label, x.count]), [["description", "Description", null], ["files", "Files", 2], ["checks", "Checks", 4]]);
  assert.deepEqual(tabsFor(pr(1, { checks: { state: null, passed: 0, total: 0 } }), { status: "ready", changed_files: 9 }).map((x) => x.count), [null, 9, null]);
});

test("ages read like GitHub's", () => {
  const now = Date.parse("2026-11-27T13:00:00Z");
  assert.equal(ago("2026-11-27T12:59:40Z", now), "just now");
  assert.equal(ago("2026-11-27T12:15:00Z", now), "45 minutes ago");
  assert.equal(ago("2026-11-27T10:00:00Z", now), "3 hours ago");
  assert.equal(ago("2026-11-26T12:00:00Z", now), "1 day ago");
  assert.equal(ago(undefined, now), null);
});

test("the checklist: read the description, then the files; tour and submit come later", () => {
  const all = files("a.ts", "b.ts", "c.ts");
  const at = (tab, viewed, f = all) => reviewSteps({ tab, files: f, viewed });

  let r = at("description", []);
  assert.deepEqual(r.steps.map((s) => s.state), ["now", "todo", "todo", "todo"]);
  assert.equal(r.done, 0);
  assert.deepEqual(r.action, { label: "Start with the files", key: "↵", go: "files" });

  r = at("files", ["a.ts"]);
  assert.deepEqual(r.steps.map((s) => s.state), ["done", "now", "todo", "todo"]);
  assert.equal(r.steps[1].sub, "1 of 3 viewed · next: b.ts");
  assert.equal(r.done, 1);
  assert.deepEqual(r.action, { label: "Next file", key: "j", go: "next" });

  r = at("description", ["a.ts", "b.ts", "c.ts"]);
  assert.deepEqual(r.steps.map((s) => s.state), ["done", "done", "todo", "todo"]);
  assert.equal(r.steps[1].sub, "3 of 3 viewed");
  assert.equal(r.done, 2);
  assert.equal(r.action, null);

  r = at("files", [], null);
  assert.equal(r.steps[1].sub, "Taking a snapshot…");
  assert.equal(r.action, null);
  for (const s of r.steps.slice(2)) assert.equal(s.sub, "Not available yet");
});

test("Next file goes to the next one not yet viewed, wrapping round", () => {
  const all = files("a.ts", "b.ts", "c.ts");
  assert.equal(nextUnviewed(all, ["b.ts"], "a.ts"), "c.ts");
  assert.equal(nextUnviewed(all, ["c.ts"], "b.ts"), "a.ts");
  assert.equal(nextUnviewed(all, [], null), "a.ts");
  assert.equal(nextUnviewed(all, ["a.ts", "b.ts", "c.ts"], "a.ts"), null);
});
