// node --test lib/herdr-app-mods/*.test.mjs
// Review mode (docs/plans/active/2026-11-25-review-mode.md, step 1): C-a p
// switches between the eric and review layouts, and the review layout is the
// three Review mode mods.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { loadMod } from "./load.mjs";

const app = new URL("../../herdr-app/", import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, app), "utf8"));
const keys = json("keys.json");
const MODS = ["review-nav", "review-page", "review-side"];

const nodes = (layout) => {
  const all = [];
  const visit = (node) => { all.push(node); node.children?.forEach(visit); };
  visit(layout);
  return all;
};

test("C-a p switches eric to review, and review back to eric", () => {
  assert.equal(keys["layout:eric"]["ctrl-a p"], "layout.switch:review");
  assert.equal(keys["layout:review"]["ctrl-a p"], "layout.switch:eric");
});

test("no other key section takes C-a p", () => {
  // A global binding would cycle other layouts into Review mode; terminal and
  // mod sections win over a layout's while they have the keyboard.
  const others = Object.entries(keys)
    .filter(([section, bindings]) => !["layout:eric", "layout:review"].includes(section) && "ctrl-a p" in bindings)
    .map(([section]) => section);
  assert.deepEqual(others, []);
});

test("the review layout is the three Review mode mods", () => {
  assert.ok(existsSync(new URL("layouts/review.json", app)), "layout:review needs layouts/review.json");
  const all = nodes(json("layouts/review.json"));
  const ids = all.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, "node ids are unique");
  const blocks = all.filter((node) => node.type === "block");
  assert.deepEqual([...new Set(blocks.map((node) => node.content?.mod))].sort(), MODS);
  assert.equal(blocks.find((node) => node.window_drag)?.content.props?.part, "bar", "the top bar drags the window");
});

for (const name of MODS) {
  test(`${name} takes no keys, imports no helper files and draws`, async () => {
    const source = readFileSync(new URL(`mods/${name}/main.js`, app), "utf8");
    // Without key handlers, C-a p always reaches the layout's binding.
    assert.doesNotMatch(source, /on_key_down|nextCommand/);
    // A linked main.js cannot import files beside it (docs/HERDR-APP.md).
    assert.doesNotMatch(source, /from\s+["']\.{1,2}\//);
    assert.equal(json(`mods/${name}/mod.json`).place, "none");
    const { default: Mod } = await loadMod(name);
    const cx = { notify() {}, spawn() {}, timer: { every() {}, after() {} } };
    for (const props of [{}, { part: "bar" }]) {
      const view = new Mod();
      view.init?.(props, cx);
      assert.ok(view.render(cx));
    }
  });
}
