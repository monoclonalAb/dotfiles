// node --test lib/herdr-app-mods/*.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { panelPlan, zoomFix, repeatDirection, emptyTrail, visitTrail, stepTrail } = await loadMod("pane-keys");

const tree = (hidden, active) => ({
  id: "root", type: "row", children: [
    { id: "main", type: "block" },
    { id: "panel", type: "column", hidden, children: [{ id: "panel-body", type: "stack", active, children: [{ id: "sidebar" }, { id: "files" }] }] },
  ],
});

test("the configured panel and keys expose only the sidebar and Files", () => {
  const layout = JSON.parse(readFileSync(new URL("../../herdr-app/layouts/eric.json", import.meta.url), "utf8"));
  const keys = JSON.parse(readFileSync(new URL("../../herdr-app/keys.json", import.meta.url), "utf8"));
  const nodes = [];
  const visit = (node) => { nodes.push(node); node.children?.forEach(visit); };
  visit(layout);
  const body = nodes.find((node) => node.id === "panel-body");
  assert.deepEqual(body.children.map((node) => node.id), ["sidebar", "files"]);
  assert.equal(body.active, "sidebar");
  assert.equal(keys["layout:eric"]["ctrl-a b"], "pane-keys.panel:sidebar");
  assert.equal(keys["layout:eric"]["ctrl-a f"], "pane-keys.panel:files");
  assert.doesNotMatch(JSON.stringify(keys), /brief|"ctrl-a i"/);
});

test("a closed panel opens on the view", () => {
  assert.deepEqual(panelPlan(tree(true, "sidebar"), "files"), {
    commands: [["layout.select", { stack: "panel-body", child: "files" }], ["layout.show", { id: "panel" }]],
  });
});

test("an open panel on another view switches to it", () => {
  assert.deepEqual(panelPlan(tree(false, "sidebar"), "files").commands[0], ["layout.select", { stack: "panel-body", child: "files" }]);
});

test("the sidebar takes the panel's place like any view", () => {
  // Files showing; C-a b swaps in the sidebar, and C-a b again closes it.
  assert.deepEqual(panelPlan(tree(false, "files"), "sidebar").commands[0], ["layout.select", { stack: "panel-body", child: "sidebar" }]);
  assert.deepEqual(panelPlan(tree(false, "sidebar"), "sidebar"), { commands: [["layout.hide", { id: "panel" }]] });
});

test("the panel already on the view closes", () => {
  assert.deepEqual(panelPlan(tree(false, "files"), "files"), { commands: [["layout.hide", { id: "panel" }]] });
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
  assert.deepEqual(panelPlan({ id: "root", children: [] }, "files"), { error: "This layout has no files panel" });
  assert.deepEqual(panelPlan(tree(true, "files"), "notes"), { error: "This layout has no notes panel" });
  assert.deepEqual(panelPlan(tree(true, "files"), "changes"), { error: "This layout has no changes panel" });
});

test("resize keys use the app's pane.resize, with the repeat in the eric layout", () => {
  const keys = JSON.parse(readFileSync(new URL("../../herdr-app/keys.json", import.meta.url), "utf8"));
  // Ctrl+Alt+arrows: the app's command in every layout; holding one repeats it.
  for (const direction of ["left", "right", "up", "down"]) {
    assert.equal(keys.global[`ctrl-alt-${direction}`], `pane.resize:${direction}`);
    assert.equal(keys.terminal[`ctrl-alt-${direction}`], undefined);
    assert.equal(keys["layout:eric"][`ctrl-alt-${direction}`], undefined);
  }
  // C-a H/J/K/L: one step elsewhere; in eric, pane-keys adds the H/J/K/L repeat.
  const letters = { h: "left", j: "down", k: "up", l: "right" };
  for (const [letter, direction] of Object.entries(letters)) {
    assert.equal(keys.global[`ctrl-a shift-${letter}`], `pane.resize:${direction}`);
    assert.equal(keys["layout:eric"][`ctrl-a shift-${letter}`], `pane-keys.resize:${direction}`);
  }
});

const visits = (...panes) => panes.reduce((trail, pane) => visitTrail(trail, pane), emptyTrail());

test("back and forward walk the panes you were in, as a browser does", () => {
  const all = () => true;
  let trail = visits("A", "B", "C", "D");
  let step = stepTrail(trail, -1, all);
  assert.equal(step.pane, "C");
  step = stepTrail(step.trail, -1, all);
  assert.equal(step.pane, "B");
  // Focus landing where back went is no new visit.
  assert.equal(visitTrail(step.trail, "B"), step.trail);
  step = stepTrail(step.trail, 1, all);
  assert.equal(step.pane, "C");
  assert.equal(stepTrail(stepTrail(step.trail, 1, all).trail, 1, all), null);
  assert.equal(stepTrail(emptyTrail(), -1, all), null);
  assert.equal(stepTrail(visitTrail(emptyTrail(), "A"), -1, all), null);
});

test("a new visit after going back drops what was ahead", () => {
  const all = () => true;
  const trail = visits("A", "B", "C", "D");
  const back = stepTrail(stepTrail(trail, -1, all).trail, -1, all).trail; // on B
  const clicked = visitTrail(back, "E");
  assert.deepEqual(clicked, { list: ["A", "B", "E"], at: 2 });
  assert.equal(stepTrail(clicked, 1, all), null);
});

test("a pane is in the trail once, at its latest visit", () => {
  const trail = visits("A", "B", "A", "B", "C");
  assert.deepEqual(trail, { list: ["A", "B", "C"], at: 2 });
  assert.equal(visitTrail(trail, "C"), trail);
  assert.equal(visitTrail(trail, null), trail);
  assert.equal(visitTrail(trail, "D", 3).list.join(""), "BCD");
});

test("back and forward pass over closed panes", () => {
  const trail = visits("A", "B", "C", "D");
  const live = (p) => p !== "C" && p !== "B";
  const back = stepTrail(trail, -1, live);
  assert.deepEqual(back, { trail: { list: ["A", "B", "C", "D"], at: 0 }, pane: "A" });
  assert.equal(stepTrail(back.trail, 1, live).pane, "D");
  assert.equal(stepTrail(trail, -1, () => false), null);
});

test("C-a [ and C-a ] go back and forward in the eric layout", () => {
  const keys = JSON.parse(readFileSync(new URL("../../herdr-app/keys.json", import.meta.url), "utf8"));
  assert.equal(keys["layout:eric"]["ctrl-a ["], "pane-keys.back");
  assert.equal(keys["layout:eric"]["ctrl-a ]"], "pane-keys.forward");
  // The previous / next agent keep C-a S-Up/Down and Cmd+[ / Cmd+] everywhere.
  assert.equal(keys["layout:eric"]["cmd-["], undefined);
  assert.equal(keys["layout:eric"]["cmd-]"], undefined);
  assert.equal(keys.global["ctrl-a shift-up"], "agent.prev");
  assert.equal(keys.global["ctrl-a shift-down"], "agent.next");
  assert.equal(keys.global["cmd-["], "agent.prev");
  assert.equal(keys.global["cmd-]"], "agent.next");
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
