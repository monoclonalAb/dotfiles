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
  for (const node of all) assert.ok(["block", "row", "column", "stack"].includes(node.type), `${node.id}: no layout node type "${node.type}"`);
  const blocks = all.filter((node) => node.type === "block");
  assert.deepEqual([...new Set(blocks.map((node) => node.content?.mod))].sort(), MODS);
  assert.equal(blocks.find((node) => node.window_drag)?.content.props?.part, "bar", "the top bar drags the window");
});

for (const name of MODS) {
  test(`${name} leaves C-a p alone, imports no helper files and draws`, async () => {
    const source = readFileSync(new URL(`mods/${name}/main.js`, app), "utf8");
    // C-a p must reach the layout's binding: only review-nav reads keys, only
    // through navKey (which ignores chords, test_review_list), and it never
    // stops a key from going on.
    assert.equal((source.match(/on_key_down/g) ?? []).length, name === "review-nav" ? 1 : 0);
    if (name === "review-nav") assert.match(source, /on_key_down\(\(e, cx\) => \{\s*const step = navKey\(e\);/);
    assert.doesNotMatch(source, /nextCommand|stop_propagation|prevent_default/);
    // A linked main.js cannot import files beside it (docs/HERDR-APP.md).
    assert.doesNotMatch(source, /from\s+["']\.{1,2}\//);
    assert.equal(json(`mods/${name}/mod.json`).place, "none");
    const { default: Mod } = await loadMod(name);
    const cx = { notify() {}, spawn() {}, timer: { every() {}, after() {} }, focus_handle: () => ({ focus() {} }) };
    for (const props of [{}, { part: "bar" }]) {
      globalThis.herdrStub = { props: () => props };
      const view = new Mod();
      view.init?.(undefined, cx);
      assert.ok(view.render(cx));
      delete globalThis.herdrStub;
    }
  });
}

test("review-page is the top bar where the layout gives it { part: \"bar\" }", async () => {
  // The app hands a block's props to its mod through herdr's props(), as the
  // shipped workspace-chrome reads { footer: true }; init's argument carries
  // none of them.
  const { default: Page } = await loadMod("review-page");
  const cx = { notify() {}, spawn() {}, timer: { every() {}, after() {} } };
  const bar = nodes(json("layouts/review.json")).find((node) => node.window_drag);
  for (const [props, isBar] of [[bar.content.props, true], [{}, false], [null, false]]) {
    globalThis.herdrStub = { props: () => props };
    const view = new Page();
    view.init(undefined, cx);
    delete globalThis.herdrStub;
    assert.equal(view.bar, isBar, JSON.stringify(props));
  }
});
