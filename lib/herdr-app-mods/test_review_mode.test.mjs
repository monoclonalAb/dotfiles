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
    if (name === "review-nav") {
      assert.match(source, /\.on_key_down\(\(e, cx\) => this\.key\(e, cx\)\)/);
      assert.match(source, /\n  key\(e, cx\) \{\n    const step = navKey\(e\);\n    if \(step === null\) return;\n/);
    }
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
      // review-nav's Files view, before anything is loaded or shared.
      if (name === "review-nav") { view.files = true; assert.ok(view.render(cx)); }
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

test("line heights in pixels are lengths: a bare number is a multiplier in the app", () => {
  // line_height(46) drew each title line 46 lines tall. A multiplier (1.25)
  // is fine; a bare number of 3 or more was meant as pixels.
  for (const name of MODS) {
    const source = readFileSync(new URL(`mods/${name}/main.js`, app), "utf8");
    assert.doesNotMatch(source, /line_height\(\s*([3-9]|\d{2,})/, name);
  }
});

test("the review layout's UI font has a file per weight, so bold draws bold", () => {
  // The app draws only Nunito's regular weight (one variable-font file); the
  // sidebar uses SF Pro Rounded for the same reason (spaces-tree).
  assert.equal(json("layouts/review.json").ui_font, "SF Pro Rounded");
});

test("Review mode paints solid surfaces like the Paper design, not the theme's see-through ones", async () => {
  // The layout leaves no gap the see-through window background shows in; the
  // mods paint the canvas and their panels with the theme's colours made solid.
  const layout = json("layouts/review.json");
  const body = nodes(layout).find((node) => node.id === "review-body");
  assert.deepEqual([body.padding ?? 0, body.gap ?? 0], [0, 0]);
  assert.deepEqual(nodes(layout).filter((node) => node.type === "block" && node.background).map((node) => node.id), []);
  const latte = { background: "#eff1f58b", canvas: "#dce0e873", chrome: "#e6e9ef74", foreground: "#1b1b1e", muted: "#6c6f85", accent: "#8839ef" };
  for (const name of MODS) {
    const { lookOf } = await loadMod(name);
    assert.deepEqual(lookOf(latte, "#4c4f69"), { ...latte, background: "#eff1f5", canvas: "#dce0e8", chrome: "#e6e9ef", foreground: "#4c4f69" }, name);
    assert.equal(lookOf(latte, null).foreground, "#1b1b1e", `${name}: the app's text colour until the theme file is read`);
    // Paper's text sits at about 1.25 times its size; the app's default is about 1.6.
    assert.match(readFileSync(new URL(`mods/${name}/main.js`, app), "utf8"), /\.line_height\(1\.25\)/, name);
  }
});
