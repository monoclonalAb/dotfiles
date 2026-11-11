// node --test lib/herdr-app-mods/*.test.mjs
// The cases of herdr/plugins/next-agent/test_next_agent.py, against the app mod.
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { afterJump, blank, bucket, dot, normalise, observe, pickJump, pickLatest, planBack, setKept } = await loadMod("next-agent");
const finished = (entry = blank(), seq = 2) => observe(observe(entry, "working", false, 1), "done", false, seq);

test("focusing one pane keeps the sibling unread", () => {
  const sibling = finished();
  const seen = observe(finished(), "idle", true, 3);
  assert.equal(bucket("idle", seen), null);
  // The app downgrades the sibling to idle too when the tab is shown.
  assert.equal(bucket("idle", observe(sibling, "idle", false, 3)), "done");
});

test("a blocked raise survives the downgrade to idle", () => {
  const blocked = observe(blank(), "blocked", false, 1);
  assert.equal(bucket("idle", observe(blocked, "idle", false, 2)), "blocked");
});

test("a completion is recovered when its done status was never observed", () => {
  const entry = observe(observe(blank(), "working", false, 1), "idle", false, 2);
  assert.equal(bucket("idle", entry), "done");
});

test("an idle agent that never worked is not a candidate", () => {
  assert.equal(bucket("idle", observe(blank(), "idle", false, 1)), null);
});

test("a working agent is never a candidate and clears unread", () => {
  const entry = observe(finished(), "working", false, 3);
  assert.equal(entry.unread, false);
  assert.equal(bucket("working", entry), null);
});

test("a recycled address resets the entry", () => {
  const old = finished(blank(100));
  assert.equal(old.unread, true);
  const fresh = observe(old, "idle", false, 1, 200);
  assert.equal(fresh.unread, false);
  assert.equal(fresh.created, 200);
});

test("focus records the seen seq, so later work raises it again", () => {
  const seen = observe(finished(), "idle", true, 5);
  assert.equal(bucket("idle", observe(seen, "idle", false, 5)), null);
  const again = observe(observe(seen, "working", false, 6), "idle", false, 7);
  assert.equal(bucket("idle", again), "done");
});

test("garbage and partial entries upgrade", () => {
  assert.deepEqual(normalise(null), blank());
  const legacy = normalise({ status: "done", unread: true });
  assert.equal(legacy.raised, "done");
  assert.equal(legacy.kept, false);
});

test("a kept conversation stays unread while you come and go", () => {
  let entry = setKept(observe(blank(), "idle", true, 1), true, "idle", 1);
  entry = observe(entry, "idle", true, 1);
  entry = observe(entry, "idle", false, 1);
  entry = observe(entry, "idle", true, 1);
  assert.equal(bucket("idle", entry), "done");
});

test("replying marks it read", () => {
  let entry = setKept(blank(), true, "idle", 1);
  entry = observe(entry, "working", true, 2);
  entry = observe(entry, "idle", true, 3);
  assert.equal(entry.kept, false);
  assert.equal(bucket("idle", entry), null);
});

test("pressing again marks it read", () => {
  const kept = setKept(blank(), true, "idle", 1);
  assert.equal(bucket("idle", setKept(kept, false, "idle", 1)), null);
});

test("kept while working is unread when it finishes", () => {
  let entry = setKept(observe(blank(), "working", true, 1), true, "working", 1);
  entry = observe(entry, "idle", true, 2);
  assert.equal(bucket("idle", entry), "done");
});

test("an unreviewed completion keeps the review dot after the tab downgrade", () => {
  assert.equal(dot("idle", bucket("idle", observe(finished(), "idle", false, 3))), "review");
});

test("focusing drops it to the idle dot", () => {
  assert.equal(dot("idle", bucket("idle", observe(finished(), "idle", true, 3))), "idle");
});

test("a focused completion while the window is in the background is already reviewed", () => {
  assert.equal(bucket("done", observe(observe(blank(), "working", true, 1), "done", true, 2)), null);
});

test("a done you already looked at stays read while the app keeps reporting it", () => {
  const seen = observe(finished(), "done", true, 3);
  assert.equal(bucket("done", observe(seen, "done", false, 4)), null);
  // A new turn that finishes is new again.
  assert.equal(bucket("done", observe(observe(seen, "working", false, 5), "done", false, 6)), "done");
});

test("an unfocused completion still raises review", () => {
  assert.equal(dot("done", bucket("done", finished())), "review");
});

test("a blocked agent keeps the blocked dot while focused", () => {
  assert.equal(dot("blocked", bucket("blocked", observe(blank(), "blocked", true, 1))), "blocked");
});

test("a working agent shows the working dot", () => {
  assert.equal(dot("working", bucket("working", observe(blank(), "working", false, 1))), "working");
});

test("blocked has priority over an unreviewed completion", () => {
  assert.equal(pickJump([{ address: "t1", bucket: "done" }, { address: "t2", bucket: "blocked" }], "t9").target.address, "t2");
});

test("jumps cycle on from the focused agent", () => {
  const list = [{ address: "t1", bucket: "done" }, { address: "t2", bucket: "done" }, { address: "t3", bucket: null }];
  assert.equal(pickJump(list, "t1").target.address, "t2");
  assert.equal(pickJump(list, "t2").target.address, "t1");
});

test("only the kept conversation in front of you is not refocused", () => {
  assert.deepEqual(pickJump([{ address: "t1", bucket: "done" }], "t1"), { message: "No other agent needs attention" });
});

test("no attention does not jump", () => {
  assert.deepEqual(pickJump([{ address: "t1", bucket: null }], "t2"), { message: "No agent needs attention" });
});

test("latest goes to the agent that most recently came to need you", () => {
  const list = [{ address: "t1", bucket: "blocked", seq: 4 }, { address: "t2", bucket: "done", seq: 9 }, { address: "t3", bucket: null, seq: 12 }];
  assert.equal(pickLatest(list, "t9").target.address, "t2");
  assert.equal(pickLatest(list, "t2").target.address, "t1", "never the one in front of you");
  assert.deepEqual(pickLatest([{ address: "t3", bucket: null, seq: 1 }], "t9"), { message: "No other agent needs attention" });
});

test("a jump chain returns to the original shell, and back again", () => {
  let chain = afterJump({}, "shell", "a1");
  chain = afterJump(chain, "a1", "a2");
  assert.deepEqual(chain, { origin: "shell", last: "a2" });
  const back = planBack(chain, "a2", new Set(["shell", "a1", "a2"]));
  assert.equal(back.target, "shell");
  assert.equal(planBack(back.chain, "shell", new Set(["shell", "a2"])).target, "a2");
});

test("a chain restarts from wherever the person moved to", () => {
  assert.deepEqual(afterJump({ origin: "shell", last: "a1" }, "elsewhere", "a2"), { origin: "elsewhere", last: "a2" });
});

test("back reports a missing or current origin", () => {
  assert.deepEqual(planBack({}, "p1", new Set()), { message: "No pane to return to" });
  assert.equal(planBack({ origin: "gone" }, "p1", new Set(["p1"])).message, "Previous pane is gone");
  assert.equal(planBack({ origin: "p1" }, "p1", new Set(["p1"])).message, "Already on the previous pane");
});
