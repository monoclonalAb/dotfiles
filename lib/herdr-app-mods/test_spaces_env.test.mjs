// node --test lib/herdr-app-mods/*.test.mjs
// Behaviour of herdr/plugins/spaces-env/spaces_env.py, against the app mod.
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { assign, blank, currentEnv, normalise, pickTarget, planFocused, planSend, planToggle, reconcile, visible } = await loadMod("spaces-env");
const state = (assignments, active = "personal", mru = {}) =>
  normalise({ active, assign: assignments, mru: { personal: [], work: [], ...mru } });

test("unknown Spaces default to Personal, new ones to the active environment", () => {
  const first = reconcile(blank(), ["a", "b"]);
  assert.deepEqual(first.state.assign, { a: "personal", b: "personal" });
  assert.deepEqual(first.added, ["a", "b"]);
  const later = reconcile({ ...first.state, active: "work" }, ["a", "b", "c"], { fresh: "work" });
  assert.equal(later.state.assign.c, "work");
});

test("gone Spaces are forgotten everywhere", () => {
  const { state: next } = reconcile(state({ a: "personal", b: "work" }, "personal", { work: ["b"] }), ["a"], { gone: ["b"] });
  assert.equal("b" in next.assign, false);
  assert.deepEqual(next.mru.work, []);
});

test("garbage state is normalised", () => {
  const s = normalise({ active: "nope", assign: { a: "work", b: "mars" }, mru: { work: ["a", "a", 3] } });
  assert.deepEqual(s, { active: "personal", assign: { a: "work" }, mru: { personal: [], work: ["a"] } });
});

test("toggle goes to the other environment's most recent Space, and back", () => {
  const s = state({ p1: "personal", w1: "work", w2: "work" }, "personal", { work: ["w2", "w1"] });
  const plan = planToggle(s, ["p1", "w1", "w2"], "p1");
  assert.equal(plan.dest, "work");
  assert.equal(plan.target, "w2");
  assert.equal(plan.state.active, "work");
  assert.equal(planToggle(plan.state, ["p1", "w1", "w2"], "w2").target, "p1");
});

test("toggling into an empty environment returns on the next toggle", () => {
  const into = planToggle(state({ p1: "personal" }), ["p1"], "p1");
  assert.equal(into.target, null);
  assert.equal(into.state.active, "work");
  assert.equal(currentEnv(into.state, "p1", ["p1"]), "work");
  assert.equal(planToggle(into.state, ["p1"], "p1").dest, "personal");
});

test("missed focus changes: the focused Space's environment wins", () => {
  assert.equal(currentEnv(state({ p1: "personal", w1: "work" }), "w1", ["p1", "w1"]), "work");
});

test("send stays in the source while it has another Space", () => {
  const plan = planSend(state({ p1: "personal", p2: "personal" }, "personal", { personal: ["p1", "p2"] }), ["p1", "p2"], "p1");
  assert.equal(plan.dest, "work");
  assert.equal(plan.remaining, "p2");
  assert.equal(plan.state.assign.p1, "work");
  assert.equal(plan.state.active, "personal");
});

test("sending the last Space follows it", () => {
  const plan = planSend(state({ p1: "personal" }), ["p1"], "p1");
  assert.equal(plan.remaining, null);
  assert.equal(plan.state.active, "work");
});

test("focus moves the active environment and the MRU", () => {
  const next = planFocused(state({ p1: "personal", w1: "work", w2: "work" }, "personal", { work: ["w1", "w2"] }), "w2");
  assert.equal(next.active, "work");
  assert.deepEqual(next.mru.work, ["w2", "w1"]);
  assert.equal(pickTarget(next, "work", ["p1", "w1", "w2"]), "w2");
});

test("the sidebar shows the active environment and the focused Space", () => {
  const s = state({ p1: "personal", w1: "work", w2: "work" }, "work");
  assert.deepEqual(visible(s, ["p1", "w1", "w2"], "p1"), ["p1", "w1", "w2"]);
  assert.deepEqual(visible(s, ["p1", "w1", "w2"], "w1"), ["w1", "w2"]);
});

test("assign moves a Space to the front of its environment", () => {
  const s = assign(state({ a: "personal", b: "work" }, "personal", { work: ["b"] }), "a", "work");
  assert.deepEqual(s.mru.work, ["a", "b"]);
  assert.deepEqual(s.mru.personal, []);
});
