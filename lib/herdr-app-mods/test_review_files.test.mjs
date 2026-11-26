// node --test lib/herdr-app-mods/*.test.mjs
// Review mode's Files view (docs/plans/active/2026-11-25-review-mode.md,
// step 3): Viewed ticks in the pull request's state file (the contract in
// docs/HERDR-APP.md), the diff's line numbers, and the keys.
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { statePath, viewedIn, withViewed, saveViewed, navKey, MAX_STATE } = await loadMod("review-nav");
const { numbered } = await loadMod("review-page");

const LINK = "https://github.com/Example/App/pull/42";
const SNAP = `${"a".repeat(40)}:${"b".repeat(40)}:main`;
const OLD = `${"c".repeat(40)}:${"b".repeat(40)}:main`;

test("the state file sits where the contract says, owner and repository lower-cased", () => {
  assert.equal(statePath("/Users/e", LINK), "/Users/e/.local/state/herdr-review/example/app/42.json");
});

test("viewed ticks are kept per snapshot, with everything else in the file", () => {
  const before = JSON.stringify({ pr: LINK, snapshots: { [OLD]: { viewed: ["x.ts"] }, [SNAP]: { drafts: [1] } }, later: true });
  const after = withViewed(before, LINK, SNAP, "src/a.ts", true);
  const parsed = JSON.parse(after);
  assert.deepEqual(parsed.snapshots[SNAP], { drafts: [1], viewed: ["src/a.ts"] });
  assert.deepEqual(parsed.snapshots[OLD], { viewed: ["x.ts"] });
  assert.equal(parsed.later, true);
  assert.deepEqual(viewedIn(after, LINK, SNAP), ["src/a.ts"]);
  assert.deepEqual(viewedIn(after, LINK, OLD), ["x.ts"]);
  assert.deepEqual(viewedIn(withViewed(after, LINK, SNAP, "src/a.ts", false), LINK, SNAP), []);
});

test("a new file gets the pull request's link; nothing on disk means nothing viewed", () => {
  assert.deepEqual(viewedIn(null, LINK, SNAP), []);
  assert.equal(JSON.parse(withViewed(null, LINK, SNAP, "a.ts", true)).pr, LINK);
});

test("a file that names another pull request is neither read nor written", () => {
  const other = JSON.stringify({ pr: "https://github.com/example/app/pull/43", snapshots: { [SNAP]: { viewed: ["a.ts"] } } });
  assert.deepEqual(viewedIn(other, LINK, SNAP), []);
  assert.throws(() => withViewed(other, LINK, SNAP, "a.ts", true), /another pull request/);
  assert.deepEqual(viewedIn("{not json", LINK, SNAP), []);
  assert.throws(() => withViewed("{not json", LINK, SNAP, "a.ts", true), /not readable/);
});

// A disk that refuses a write whose expected text is out of date, as
// writeTextFile does.
function disk(text, { racer } = {}) {
  const d = { text, writes: 0 };
  d.read = async () => d.text;
  d.write = async (_path, next, expected) => {
    if (racer) { d.text = racer(d.text); racer = null; }
    if (expected !== d.text) throw new Error("stale snapshot");
    d.text = next;
    d.writes += 1;
  };
  return d;
}

test("a save that lost a race to another view reads again and re-applies only its own tick", async () => {
  const d = disk(null, { racer: (t) => withViewed(t, LINK, SNAP, "theirs.ts", true) });
  await saveViewed(d, "/h", LINK, SNAP, "mine.ts", true);
  assert.deepEqual(viewedIn(d.text, LINK, SNAP).sort(), ["mine.ts", "theirs.ts"]);
  assert.equal(d.writes, 1);
});

test("a save that would pass 1 MiB is refused and the file stays as it was", async () => {
  // Drafts of later steps count too: the file is 100 bytes under the cap.
  const empty = JSON.stringify({ pr: LINK, snapshots: { [SNAP]: { viewed: [], drafts: "" } } }, null, 1);
  const text = JSON.stringify({ pr: LINK, snapshots: { [SNAP]: { viewed: [], drafts: "x".repeat(MAX_STATE - 100 - empty.length) } } }, null, 1);
  assert.equal(text.length, MAX_STATE - 100);
  const d = disk(text);
  await saveViewed(disk(text), "/h", LINK, SNAP, "short.ts", true);
  await assert.rejects(saveViewed(d, "/h", LINK, SNAP, `src/${"long/".repeat(30)}file.ts`, true), /1 MiB/);
  assert.equal(d.text, text);
  assert.equal(d.writes, 0);
});

test("diff lines get their old and new line numbers from the hunk headers", () => {
  const lines = ["@@ -41,4 +41,5 @@ export function f() {", " a", "-b", "+B", "+C", " d", "@@ -90 +91 @@", "-x", "+y", "\\ No newline at end of file"];
  assert.deepEqual(numbered(lines).map((l) => [l.kind, l.old, l.new]), [
    ["hunk", null, null], ["same", 41, 41], ["del", 42, null], ["add", null, 42], ["add", null, 43], ["same", 43, 44],
    ["hunk", null, null], ["del", 90, null], ["add", null, 91], ["note", null, null],
  ]);
});

test("in the Files view, Esc goes back and v ticks Viewed; chords still pass through", () => {
  const key = (k, modifiers = {}) => navKey({ key: k, modifiers });
  assert.equal(key("escape"), "back");
  assert.equal(key("v"), "viewed");
  assert.equal(key("v", { control: true }), null);
  assert.equal(key("v", { shift: true }), null);
});
