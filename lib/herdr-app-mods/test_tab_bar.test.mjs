// node --test lib/herdr-app-mods/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { lightsPadding } = await loadMod("tab-bar");

const mac = { platform: "macos", titlebar: "none", fullscreen: false };
const root = (order, sidebar = {}) => ({
  id: "root", traffic_lights: [12, 16],
  children: order.map((id) => (id === "sidebar" ? { id, size: { px: 300 }, ...sidebar } : { id })),
});

test("a sidebar on the right leaves the window buttons' room to the tab bar", () => {
  assert.equal(lightsPadding(root(["work", "sidebar"]), mac, 1), 76);
  assert.equal(lightsPadding(root(["work", "sidebar"]), mac, 0.5), 152);
});

test("a shown sidebar on the left already makes room", () => {
  assert.equal(lightsPadding(root(["sidebar", "work"]), mac, 1), 10);
  assert.equal(lightsPadding(root(["sidebar", "work"], { size: { px: 44 } }), mac, 1), 32);
  assert.equal(lightsPadding(root(["sidebar", "work"], { hidden: true }), mac, 1), 76);
});

test("no window buttons over the layout, no room", () => {
  assert.equal(lightsPadding(root(["work", "sidebar"]), { ...mac, fullscreen: true }, 1), 10);
  assert.equal(lightsPadding(root(["work", "sidebar"]), { ...mac, titlebar: "system" }, 1), 10);
  assert.equal(lightsPadding(root(["work", "sidebar"]), { platform: "linux", titlebar: "none" }, 1), 10);
  assert.equal(lightsPadding({ id: "root", children: [] }, mac, 1), 10);
});
