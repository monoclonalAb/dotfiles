// node --test lib/herdr-app-mods/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { panelPlan, zoomFix, resizePlan, resizeSteps, repeatDirection } = await loadMod("pane-keys");

const tree = (hidden, active) => ({
  id: "root", type: "row", children: [
    { id: "main", type: "block" },
    { id: "panel", type: "column", hidden, children: [{ id: "panel-body", type: "stack", active, children: [{ id: "sidebar" }, { id: "files" }, { id: "brief" }] }] },
  ],
});

test("a closed panel opens on the view", () => {
  assert.deepEqual(panelPlan(tree(true, "files"), "brief"), {
    commands: [["layout.select", { stack: "panel-body", child: "brief" }], ["layout.show", { id: "panel" }]],
  });
});

test("an open panel on another view switches to it", () => {
  assert.deepEqual(panelPlan(tree(false, "files"), "brief").commands[0], ["layout.select", { stack: "panel-body", child: "brief" }]);
});

test("the sidebar takes the panel's place like any view", () => {
  // Brief showing; C-a b swaps in the sidebar, and C-a b again closes it.
  assert.deepEqual(panelPlan(tree(false, "brief"), "sidebar").commands[0], ["layout.select", { stack: "panel-body", child: "sidebar" }]);
  assert.deepEqual(panelPlan(tree(false, "sidebar"), "sidebar"), { commands: [["layout.hide", { id: "panel" }]] });
});

test("the panel already on the view closes", () => {
  assert.deepEqual(panelPlan(tree(false, "brief"), "brief"), { commands: [["layout.hide", { id: "panel" }]] });
});

test("focus that moves to a pane the zoom hides shows the whole tab", () => {
  // B zoomed; C-a u, a sidebar click or agent.next focuses A in the same tab.
  assert.deepEqual(zoomFix({ pane: "B", zoomed: "B" }, { pane: "A", zoomed: "B" }), ["pane.zoom", { pane: "B" }]);
  // Arriving from another tab whose zoom already hides the focused pane.
  assert.deepEqual(zoomFix({ pane: "X", zoomed: null }, { pane: "A", zoomed: "B" }), ["pane.zoom", { pane: "B" }]);
  assert.deepEqual(zoomFix(null, { pane: "A", zoomed: "B" }), ["pane.zoom", { pane: "B" }]);
});

test("a zoom moved onto another pane takes the focus", () => {
  // A focused; B's header zoom button zooms B without focusing it.
  assert.deepEqual(zoomFix({ pane: "A", zoomed: null }, { pane: "A", zoomed: "B" }), ["pane.focus", { pane: "B" }]);
  assert.deepEqual(zoomFix({ pane: "A", zoomed: "C" }, { pane: "A", zoomed: "B" }), ["pane.focus", { pane: "B" }]);
});

test("a zoom showing the focused pane, or no zoom, needs nothing", () => {
  assert.equal(zoomFix({ pane: "A", zoomed: null }, { pane: "B", zoomed: "B" }), null);
  assert.equal(zoomFix({ pane: "B", zoomed: "B" }, { pane: "A", zoomed: null }), null);
  assert.equal(zoomFix(null, { pane: null, zoomed: null }), null);
});

test("a layout without the panel or the view says so", () => {
  assert.deepEqual(panelPlan({ id: "root", children: [] }, "brief"), { error: "This layout has no brief panel" });
  assert.deepEqual(panelPlan(tree(true, "files"), "notes"), { error: "This layout has no notes panel" });
  assert.deepEqual(panelPlan(tree(true, "files"), "changes"), { error: "This layout has no changes panel" });
});

// herdr-core's "herdr-app" document, shaped as the app 0.1.12 writes it.
const block = (id, weight) => ({ id, type: "block", content: { terminal: `t-${id}` }, ...(weight === undefined ? {} : { size: { weight } }) });
const split = (type, children, weight) => ({ id: `${type}-${children.map((c) => c.id).join("")}`, type, children, ...(weight === undefined ? {} : { size: { weight } }) });
const docOf = (root) => ({ spaces: [{ id: "sp1", tabs: [{ id: "tb0", root: split("row", [block("x")]) }, { id: "tb1", root }] }] });
const weights = (plan, ...path) => {
  let node = plan.doc.spaces[0].tabs[1].root;
  for (const i of path) node = node.children[i];
  return node.children.map((c) => c.size?.weight);
};

test("resize moves the shared edge of two side-by-side panes, as tmux does", () => {
  const doc = docOf(split("row", [block("a", 0.5), block("b", 0.5)]));
  // Left pane focused: its right edge moves.
  assert.deepEqual(weights(resizePlan(doc, "a", "right")), [0.55, 0.45]);
  assert.deepEqual(weights(resizePlan(doc, "a", "left")), [0.45, 0.55]);
  // Right pane focused: it has no right edge, so its left edge moves.
  assert.deepEqual(weights(resizePlan(doc, "b", "right")), [0.55, 0.45]);
  assert.deepEqual(weights(resizePlan(doc, "b", "left")), [0.45, 0.55]);
  // The input is left alone, and so is every other tab.
  assert.deepEqual(doc.spaces[0].tabs[1].root.children.map((c) => c.size.weight), [0.5, 0.5]);
  assert.deepEqual(resizePlan(doc, "a", "right").doc.spaces[0].tabs[0], doc.spaces[0].tabs[0]);
});

test("resize takes the nearest split in that direction and leaves the others", () => {
  // Left half split top/bottom (a over b), c on the right; the app leaves a and b unweighted.
  const doc = docOf(split("row", [split("column", [block("a"), block("b")], 0.5), block("c", 0.5)]));
  const across = resizePlan(doc, "a", "right");
  assert.deepEqual(weights(across), [0.55, 0.45]);
  assert.deepEqual(weights(across, 0), [undefined, undefined]);
  // Missing weights are shares of 1 each.
  const down = resizePlan(doc, "b", "down");
  assert.deepEqual(weights(down, 0), [1.1, 0.9]);
  assert.deepEqual(weights(down), [0.5, 0.5]);
});

test("resize of a middle pane moves its right edge only", () => {
  const doc = docOf(split("row", [block("a", 0.25), block("b", 0.25), block("c", 0.5)]));
  assert.deepEqual(weights(resizePlan(doc, "b", "right")), [0.25, 0.3, 0.45]);
  assert.deepEqual(weights(resizePlan(doc, "b", "left")), [0.25, 0.2, 0.55]);
});

test("resize stops at a tenth of the split, and does nothing without a split that way", () => {
  const doc = docOf(split("row", [block("a", 0.12), block("b", 0.88)]));
  const once = resizePlan(doc, "a", "left");
  assert.deepEqual(weights(once), [0.1, 0.9]);
  assert.equal(resizePlan(once.doc, "a", "left"), null);
  assert.equal(resizePlan(doc, "a", "up"), null);
  assert.equal(resizePlan(docOf(split("row", [block("a")])), "a", "right"), null);
});

test("resize reports a document it does not recognise instead of guessing", () => {
  const doc = docOf(split("row", [block("a", 0.5), block("b", 0.5)]));
  assert.deepEqual(resizePlan(doc, "zz", "right"), { error: "The focused pane is not in Herdr's layout document" });
  assert.deepEqual(resizePlan({ tabs: [] }, "a", "right"), { error: "The focused pane is not in Herdr's layout document" });
  const fixed = docOf(split("row", [{ ...block("a"), size: { px: 300 } }, block("b", 0.5)]));
  assert.deepEqual(resizePlan(fixed, "a", "right"), { error: "This split's sizes are not weights" });
});

test("presses that queued up are saved as one write, in order", () => {
  const doc = docOf(split("row", [block("a", 0.5), block("b", 0.5)]));
  assert.deepEqual(weights(resizeSteps(doc, "a", ["left", "left", "left"])), [0.35, 0.65]);
  assert.deepEqual(weights(resizeSteps(doc, "a", ["left", "right", "right"])), [0.55, 0.45]);
  // Presses past the limit, or with no split that way, are skipped.
  assert.deepEqual(weights(resizeSteps(doc, "a", Array(20).fill("left"))), [0.1, 0.9]);
  assert.equal(resizeSteps(doc, "a", ["up", "down"]), null);
  assert.deepEqual(resizeSteps(doc, "zz", ["left"]), { error: "The focused pane is not in Herdr's layout document" });
});

test("only Shift with h/j/k/l repeats a resize", () => {
  const key = (key, mods = {}) => ({ key, modifiers: { shift: false, control: false, alt: false, platform: false, function: false, ...mods } });
  assert.equal(repeatDirection(key("h", { shift: true })), "left");
  assert.equal(repeatDirection(key("j", { shift: true })), "down");
  assert.equal(repeatDirection(key("k", { shift: true })), "up");
  assert.equal(repeatDirection(key("L", { shift: true })), "right");
  assert.equal(repeatDirection(key("h")), null);
  assert.equal(repeatDirection(key("h", { shift: true, control: true })), null);
  assert.equal(repeatDirection(key("x", { shift: true })), null);
  assert.equal(repeatDirection(key("escape")), null);
  assert.equal(repeatDirection({}), null);
});
