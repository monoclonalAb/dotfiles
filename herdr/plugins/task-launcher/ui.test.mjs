import assert from "node:assert/strict";
import test from "node:test";
import { findPi, loadPiModules } from "./pi-runtime.mjs";
import { createTaskForm } from "./ui.mjs";

// Exercise installed Pi editor/key parsing without creating a model runtime,
// loading global extensions, touching credentials, or starting a terminal.
const { tui, sdk, bindings } = await loadPiModules(await findPi());
const models = [
  { key: "test/reasoner", provider: "test", id: "reasoner", name: "Reasoner", input: ["text", "image"], levels: ["off", "high", "max"] },
  { key: "test/simple", provider: "test", id: "simple", name: "Simple", levels: ["off"] },
];
const flush = () => new Promise((resolve) => setImmediate(resolve));
const upstream = { remote: "origin", branch: "main", ref: "refs/remotes/origin/main" };
function fixture(options = {}) {
  const calls = [];
  const saved = [];
  const copied = [];
  const renderer = { terminal: { rows: 22, columns: 76 }, requestRender() {} };
  let closed = 0;
  const launch = { start: async (form) => { calls.push(form); return {}; }, recoveryMessage: () => "", ...options.launch };
  const form = createTaskForm(tui, {
    renderer, models, repo: { name: "website", head: "0123456789abcdef", branch: "main", dirty: true, upstream, ...options.repo },
    keybindings: new bindings.KeybindingsManager(options.userBindings), CustomEditor: sdk.CustomEditor,
    cycleModels: options.cycleModels, defaults: options.defaults, now: options.now,
    readClipboard: options.readClipboard, copyText: async (text) => { copied.push(text); },
    draft: options.draft, saveDraft: (draft) => { saved.push(draft); }, history: options.history,
    autocomplete: options.autocomplete, namer: options.namer,
    selection: { model: models[0], thinking: "high", notice: "", ...options.selection }, launch, onClose: () => { closed++; },
  });
  form.focused = true;
  return { form, renderer, calls, launch, saved, copied, closed: () => closed };
}

test("opens directly with focused task input; Escape has no task effects", () => {
  const f = fixture();
  assert.match(f.form.render(76).join("\n"), /NEW TASK/);
  assert.doesNotMatch(f.form.render(76).join("\n"), /PI TASKS|t \/ Enter open/);
  assert.equal(f.form.phase, "form");
  assert.equal(f.form.editor.focused, true);
  f.form.handleInput("Add keyboard navigation");
  assert.equal(f.form.editor.getExpandedText(), "Add keyboard navigation");
  f.form.handleInput("\x1b");
  assert.equal(f.closed(), 1);
  assert.equal(f.calls.length, 0);
});

test("Kitty t, multiline paste and Enter submit without clearing task text", async () => {
  const f = fixture();
  f.form.handleInput("\x1b[116u");
  const prompt = Array.from({ length: 15 }, (_, i) => `task line ${i}`).join("\n");
  f.form.handleInput(`\x1b[200~${prompt.slice(1)}\x1b[201~`);
  assert.equal(f.form.editor.getExpandedText(), prompt);
  f.form.handleInput("\r");
  await flush();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].prompt, prompt);
  assert.equal(f.calls[0].model, models[0]);
  assert.equal(f.form.editor.getExpandedText(), prompt);
});

test("model dropdown filters, selects, and restricts thinking using metadata", () => {
  const f = fixture();
  f.form.handleInput("\t");
  assert.equal(f.form.field, "model");
  f.form.handleInput("\r");
  f.form.handleInput("simple");
  f.form.handleInput("\r");
  assert.equal(f.form.model, models[1]);
  assert.equal(f.form.thinking, "off");
  f.form.handleInput("\t");
  f.form.handleInput("\r");
  assert.match(f.form.render(76).join("\n"), /off/);
  assert.doesNotMatch(f.form.render(76).join("\n"), /high|max/);
  f.form.handleInput("\x1b"); // back from dropdown, not closing form
  assert.equal(f.form.phase, "form");
  assert.equal(f.closed(), 0);
});

test("failure retains input and selections; busy input cannot duplicate or fake-cancel", async () => {
  let reject;
  const pending = new Promise((_, no) => { reject = no; });
  const f = fixture({ launch: { start: () => pending, recoveryMessage: () => "Checkout kept" } });
  f.form.handleInput("Preserve this prompt");
  f.form.handleInput("\r");
  f.form.handleInput("\r");
  f.form.handleInput("\x1b");
  assert.equal(f.closed(), 0);
  assert.equal(f.form.busy, true);
  reject(new Error("cannot open pane"));
  await flush();
  assert.equal(f.form.busy, false);
  assert.equal(f.form.editor.getExpandedText(), "Preserve this prompt");
  assert.equal(f.form.model, models[0]);
  assert.equal(f.form.thinking, "high");
  assert.match(f.form.render(76).join("\n"), /cannot open pane.*Checkout kept/);
});

test("all form states stay within viewport, including Unicode and advanced/error content", () => {
  const f = fixture();
  for (const phase of ["form", "select", "done"]) {
    f.form.phase = phase;
    if (phase === "select") f.form.openSelector("model");
    f.form.editor.setText("日本語 toolbar 🔧 ".repeat(80));
    f.form.message = "A long error with a checkout path ".repeat(20);
    f.form.advanced = true;
    for (const field of ["prompt", "model", "branch", "base", "path", "start"]) {
      f.form.field = field;
      f.form.syncFocus();
      for (const rows of [1, 10, 12, 18, 22]) {
        f.renderer.terminal.rows = rows;
        for (const width of [1, 20, 28, 42, 76]) {
          const lines = f.form.render(width);
          assert.ok(lines.length <= rows, `${phase}/${field}: ${lines.length} > ${rows}`);
          assert.ok(lines.every((line) => tui.visibleWidth(line) <= width), `${phase}/${field} width ${width}`);
        }
      }
    }
  }
});

test("Ctrl+J and Shift+Enter insert newlines before any submit handling", () => {
  for (const key of ["\n", "\x1b[106;5u", "\x1b[13;2u", "\x1b[27;2;13~"]) {
    const f = fixture();
    f.form.handleInput("alpha");
    f.form.handleInput(key);
    f.form.handleInput("beta");
    assert.equal(f.form.editor.getExpandedText(), "alpha\nbeta", JSON.stringify(key));
    assert.equal(f.calls.length, 0);
    assert.equal(f.form.field, "prompt");
    assert.equal(f.closed(), 0);
  }
});

test("Ctrl+J on a non-prompt field cannot accidentally start a task", () => {
  const f = fixture();
  f.form.editor.setText("Do not start this");
  f.form.field = "start";
  f.form.handleInput("\n");
  assert.equal(f.calls.length, 0);
});

test("Shift+Tab cycles compatible effort in place, including wraparound", () => {
  for (const key of ["\x1b[Z", "\x1b[9;2u"]) {
    const f = fixture();
    f.form.editor.setText("keep my draft");
    f.form.handleInput(key);
    assert.equal(f.form.thinking, "max");
    f.form.handleInput(key);
    assert.equal(f.form.thinking, "off");
    assert.equal(f.form.field, "prompt");
    assert.equal(f.form.editor.focused, true);
    assert.equal(f.form.editor.getExpandedText(), "keep my draft");
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  f.form.model = models[1];
  f.form.thinking = "off";
  f.form.handleInput("\x1b[Z");
  assert.equal(f.form.thinking, "off");
  f.form.model = undefined;
  f.form.handleInput("\x1b[Z");
  assert.match(f.form.message, /Choose a model/);
});

test("Ctrl+L selects a model and returns to the unchanged draft and input focus", () => {
  const f = fixture();
  f.form.editor.setText("alpha\nbeta");
  f.form.handleInput("\x0c");
  assert.equal(f.form.phase, "select");
  f.form.handleInput("simple");
  f.form.handleInput("\r");
  assert.equal(f.form.model, models[1]);
  assert.equal(f.form.thinking, "off");
  assert.equal(f.form.phase, "form");
  assert.equal(f.form.field, "prompt");
  assert.equal(f.form.editor.focused, true);
  assert.equal(f.form.editor.getExpandedText(), "alpha\nbeta");
  assert.equal(f.calls.length, 0);
});

test("Ctrl+P and Shift+Ctrl+P cycle the configured scope with effort overrides", () => {
  const f = fixture({ cycleModels: [{ model: models[0], thinkingLevel: "max" }, { model: models[1] }] });
  f.form.editor.setText("draft");
  f.form.handleInput("\x10");
  assert.equal(f.form.model, models[1]);
  f.form.handleInput("\x1b[112;6u");
  assert.equal(f.form.model, models[0]);
  assert.equal(f.form.thinking, "max");
  assert.equal(f.form.field, "prompt");
  assert.equal(f.form.editor.getExpandedText(), "draft");
  assert.equal(f.calls.length, 0);
  const empty = fixture({ cycleModels: [] });
  empty.form.handleInput("\x10");
  assert.equal(empty.form.model, models[0]);
  assert.match(empty.form.message, /No available models/);
});

test("Pi's explicit history shortcut wins over model cycling", () => {
  const f = fixture({ userBindings: { "tui.editor.historyPrevious": "ctrl+p", "app.model.cycleForward": "ctrl+p" } });
  f.form.handleInput("\x10");
  assert.equal(f.form.model, models[0]);
});

test("Ctrl+C clears the draft first; only a second press within 500ms closes", () => {
  let time = 1000;
  const f = fixture({ now: () => time });
  f.form.editor.setText("retain the popup, clear this draft");
  f.form.handleInput("\x03");
  assert.equal(f.form.editor.getExpandedText(), "");
  assert.equal(f.closed(), 0);
  assert.equal(f.form.model, models[0]);
  assert.equal(f.form.thinking, "high");
  time += 600;
  f.form.handleInput("\x03");
  assert.equal(f.closed(), 0);
  time += 100;
  f.form.handleInput("\x03");
  assert.equal(f.closed(), 1);
  assert.equal(f.calls.length, 0);
});

test("Ctrl+C in a selector cancels the selector, not the task or its draft", () => {
  const f = fixture();
  f.form.editor.setText("draft");
  f.form.handleInput("\x0c");
  f.form.handleInput("\x03");
  assert.equal(f.form.phase, "form");
  assert.equal(f.form.editor.getExpandedText(), "draft");
  assert.equal(f.closed(), 0);
});

test("Ctrl+D deletes forward in a draft, and closes only an empty prompt", () => {
  const f = fixture();
  f.form.editor.setText("ab");
  f.form.handleInput("\x01");
  f.form.handleInput("\x04");
  assert.equal(f.form.editor.getExpandedText(), "b");
  assert.equal(f.closed(), 0);
  f.form.editor.setText("");
  f.form.handleInput("\x04");
  assert.equal(f.closed(), 1);
});

test("native word deletion, yank and line movement remain editor actions", () => {
  const f = fixture();
  f.form.editor.setText("alpha beta");
  f.form.handleInput("\x17");
  assert.equal(f.form.editor.getExpandedText(), "alpha ");
  f.form.handleInput("\x19");
  assert.equal(f.form.editor.getExpandedText(), "alpha beta");
  f.form.handleInput("\x01");
  f.form.handleInput(">");
  f.form.handleInput("\x05");
  f.form.handleInput("!");
  assert.equal(f.form.editor.getExpandedText(), ">alpha beta!");
});

test("configured Pi bindings replace defaults and drive editor, app actions and selectors", async () => {
  const f = fixture({ userBindings: {
    "tui.input.newLine": "alt+n", "app.thinking.cycle": "alt+e", "app.model.select": "alt+m",
    "tui.input.submit": "ctrl+s", "tui.select.cancel": "alt+q",
  } });
  f.form.handleInput("one");
  f.form.handleInput("\x1bn");
  f.form.handleInput("two");
  f.form.handleInput("\x1be");
  assert.equal(f.form.thinking, "max");
  f.form.handleInput("\x1b[Z"); // no hardcoded old Shift+Tab behavior
  assert.equal(f.form.thinking, "max");
  assert.equal(f.form.field, "prompt");
  f.form.handleInput("\x1bm");
  assert.equal(f.form.phase, "select");
  f.form.handleInput("\x1bq");
  assert.equal(f.form.phase, "form");
  assert.match(f.form.render(76).join("\n"), /alt\+n/);
  assert.equal(f.form.editor.getExpandedText(), "one\ntwo");
  f.form.handleInput("\x13");
  await flush();
  assert.equal(f.calls[0].prompt, "one\ntwo");
});

test("Advanced is reachable via its row without stealing Ctrl+G", () => {
  const f = fixture();
  f.form.handleInput("\x07");
  assert.equal(f.form.advanced, false);
  for (let i = 0; i < 5; i++) f.form.handleInput("\t");
  assert.equal(f.form.field, "advanced");
  f.form.handleInput("\r");
  assert.equal(f.form.advanced, true);
  assert.equal(f.calls.length, 0);
});

test("form discloses automatic naming request; an explicit branch bypasses it", () => {
  const f = fixture({ namer: (model) => model === models[0] ? models[1] : undefined });
  f.form.field = "start";
  assert.match(f.form.render(76).join("\n"), /Auto-name: one short request to test\/simple/);
  f.form.model = models[1];
  assert.match(f.form.render(76).join("\n"), /no usable naming model; a placeholder name/);
  f.form.inputs.branch.setValue("fix/keyboard");
  assert.doesNotMatch(f.form.render(76).join("\n"), /Auto-name/);
});

test("tiny viewport cannot submit invisible controls, but Escape still cancels", () => {
  const f = fixture();
  f.form.editor.setText("Do not submit invisibly");
  f.form.render(20);
  f.form.handleInput("\r");
  assert.equal(f.calls.length, 0);
  f.form.handleInput("\x1b");
  assert.equal(f.closed(), 1);
});

const image = { type: "image", mimeType: "image/png", data: "AQID" };
const imageContent = { mimeType: image.mimeType, data: image.data };

test("Ctrl+V and Cmd+V empty paste show inline markers and submit image content, not markers", async () => {
  for (const keys of [["\x16"], ["\x1b[118;5u"], ["\x1b[200~\x1b[201~"], ["\x1b[200~", "\x1b[20", "1~"]]) {
    const f = fixture({ readClipboard: async () => image });
    f.form.handleInput("Describe: ");
    for (const key of keys) f.form.handleInput(key);
    await flush();
    assert.equal(f.form.editor.getExpandedText(), "Describe: [img #1]");
    assert.match(f.form.render(76).join("\n"), /\[img #1\]/);
    f.form.handleInput("\r");
    await flush();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].prompt, "Describe: ");
    assert.deepEqual(f.calls[0].images, [imageContent]);
  }
});

test("image paste shortcut uses Pi remaps and only the prompt reads the clipboard", async () => {
  let reads = 0;
  const f = fixture({ userBindings: { "app.clipboard.pasteImage": "alt+v" }, readClipboard: async () => { reads++; return image; } });
  f.form.handleInput("\x16");
  assert.equal(reads, 0);
  f.form.handleInput("\x1bv");
  await flush();
  assert.equal(reads, 1);
  f.form.handleInput("\t");
  f.form.handleInput("\x1bv");
  f.form.openSelector("model");
  f.form.handleInput("\x1bv");
  assert.equal(reads, 1);
});

test("nonempty bracketed paste never reads clipboard; Ctrl+V text is inserted, never executed", async () => {
  let reads = 0;
  const text = "literal\x1b[201~\r\x1b[200~payload";
  const f = fixture({ readClipboard: async () => { reads++; return { type: "text", text }; } });
  for (const content of [" ", "\n", "text\nmore text"]) {
    f.form.handleInput(`\x1b[200~${content}\x1b[201~`);
  }
  assert.equal(reads, 0);
  f.form.handleInput("\x16");
  await flush();
  assert.equal(reads, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.closed(), 0);
  assert.ok(f.form.editor.getExpandedText().endsWith(text.replace(/\r/g, "\n")));
});

test("native undo removes an image insertion; clear/undo and model selection preserve its bytes", async () => {
  const f = fixture({ readClipboard: async () => image });
  f.form.handleInput("Task ");
  f.form.handleInput("\x16");
  await flush();
  f.form.handleInput("\x1f"); // Ctrl+-: undo atomic marker insertion.
  assert.equal(f.form.editor.getExpandedText(), "Task ");
  assert.deepEqual(f.form.draft().images, []);
  f.form.handleInput("\x16");
  await flush();
  f.form.handleInput("\x03");
  assert.deepEqual(f.form.draft(), { prompt: "", images: [] });
  f.form.handleInput("\x1f");
  assert.deepEqual(f.form.draft(), { prompt: "Task ", images: [imageContent] });
  f.form.handleInput("\x0c");
  f.form.handleInput("\x1b");
  assert.deepEqual(f.form.draft().images, [imageContent]);
  f.form.editor.setText("Task [img #999]");
  assert.deepEqual(f.form.draft(), { prompt: "Task [img #999]", images: [] });
});

test("multiple markers select only remaining images, ordered by their position in the draft", async () => {
  let number = 0;
  const f = fixture({ readClipboard: async () => ({ ...image, data: Buffer.from([++number]).toString("base64") }) });
  for (let i = 0; i < 3; i++) { f.form.handleInput("\x16"); await flush(); }
  f.form.editor.setText("Compare [img #3] with [img #1] and [img #3]");
  assert.deepEqual(f.form.draft(), { prompt: "Compare  with  and ", images: [
    { mimeType: "image/png", data: "Aw==" }, { mimeType: "image/png", data: "AQ==" },
  ] });
});

test("async paste queues typing and Enter in order; Escape closes without late insertion or submit", async () => {
  for (const cancel of [false, true]) {
    let release;
    const f = fixture({ readClipboard: () => new Promise((resolve) => { release = resolve; }) });
    f.form.handleInput("Task ");
    f.form.handleInput("\x16");
    f.form.handleInput("after");
    f.form.handleInput("\r");
    assert.equal(f.calls.length, 0);
    if (cancel) f.form.handleInput("\x1b");
    release(image);
    await flush();
    assert.equal(f.closed(), 1);
    assert.equal(f.calls.length, cancel ? 0 : 1);
    if (!cancel) {
      assert.equal(f.calls[0].prompt, "Task after");
      assert.deepEqual(f.calls[0].images, [imageContent]);
    } else assert.equal(f.form.editor.getExpandedText(), "Task ");
  }
});

test("clipboard failures retain draft, show an error, and suppress an already-queued Start", async () => {
  for (const result of [undefined, new Error("denied"), { ...image, mimeType: "image/svg+xml" }]) {
    const f = fixture({ readClipboard: async () => { if (result instanceof Error) throw result; return result; } });
    f.form.handleInput("Task ");
    f.form.handleInput("\x16");
    f.form.handleInput("still typing");
    f.form.handleInput("\r");
    await flush();
    assert.equal(f.calls.length, 0);
    assert.equal(f.form.editor.getExpandedText(), "Task still typing");
    assert.match(f.form.message, /Clipboard paste failed/);
    assert.deepEqual(f.form.draft().images, []);
  }
});

test("startup failure retains image draft for a retry; popup image count is bounded", async () => {
  const f = fixture({ readClipboard: async () => image, launch: { start: async () => { throw new Error("retry me"); } } });
  f.form.handleInput("Task ");
  for (let i = 0; i < 9; i++) { f.form.handleInput("\x16"); await flush(); }
  assert.equal(f.form.draft().images.length, 8);
  assert.match(f.form.message, /At most 8/);
  f.form.handleInput("\r");
  await flush();
  assert.match(f.form.message, /retry me/);
  assert.equal(f.form.draft().images.length, 8);
});

test("pasting an image does not reinterpret existing literal marker-shaped text", async () => {
  const f = fixture({ readClipboard: async () => image });
  f.form.handleInput("Explain [img #1]: ");
  await f.form.pasteClipboard();
  assert.equal(f.form.editor.getExpandedText(), "Explain [img #1]: [img #2]");
  assert.deepEqual(f.form.draft(), { prompt: "Explain [img #1]: ", images: [imageContent] });
});

test("failed paste also suppresses queued Space activation of the Start row", async () => {
  const f = fixture({ readClipboard: async () => undefined });
  f.form.handleInput("Task");
  f.form.handleInput("\x16");
  for (let i = 0; i < 6; i++) f.form.handleInput("\t");
  f.form.handleInput(" ");
  await flush();
  assert.equal(f.form.field, "start");
  assert.equal(f.calls.length, 0);
  assert.match(f.form.message, /Clipboard paste failed/);
});

test("Escape keeps the draft with its images; reopening restores it; a started task clears it", async () => {
  const f = fixture({ readClipboard: async () => image });
  f.form.handleInput("Fix the chart ");
  f.form.handleInput("\x16");
  await flush();
  f.form.handleInput("\x1b");
  assert.equal(f.closed(), 1);
  assert.deepEqual(f.saved, [{ text: "Fix the chart [img #1]", images: [{ marker: "[img #1]", ...imageContent }] }]);
  f.form.persistDraft(); // A later hangup cannot overwrite it without its images.
  assert.equal(f.saved.length, 1);
  const reopened = fixture({ draft: f.saved[0], readClipboard: async () => image });
  assert.equal(reopened.form.editor.getExpandedText(), "Fix the chart [img #1]");
  assert.match(reopened.form.message, /Restored your unsent draft/);
  await reopened.form.pasteClipboard();
  assert.equal(reopened.form.editor.getExpandedText(), "Fix the chart [img #1][img #2]");
  reopened.launch.launched = true;
  reopened.form.close();
  assert.deepEqual(reopened.saved, []);
  const empty = fixture();
  empty.form.handleInput("\x1b");
  assert.deepEqual(empty.saved, [undefined]); // Nothing to keep: any old draft is removed.
});

test("Ctrl+C copies the cleared draft to the clipboard", async () => {
  const f = fixture();
  f.form.handleInput("Keep a copy of this");
  f.form.handleInput("\x03");
  await flush();
  assert.deepEqual(f.copied, ["Keep a copy of this"]);
  assert.match(f.form.message, /copied to the clipboard/);
  f.form.handleInput("\x03");
  assert.equal(f.closed(), 1);
  assert.deepEqual(f.saved, [undefined]);
});

test("Start from and Changes rows toggle, stay consistent, and reach the launch", async () => {
  const f = fixture();
  const render = () => f.form.render(76).join("\n");
  assert.match(render(), /Start from\s+\[ current: main @ 0123456 ⇄ \]/);
  assert.match(render(), /Changes\s+\[ leave uncommitted changes in website ⇄ \]/);
  f.form.field = "startFrom";
  f.form.handleInput("\r");
  assert.match(render(), /latest origin\/main \(fetched on start\)/);
  f.form.field = "changes";
  f.form.handleInput(" ");
  assert.equal(f.form.carry, true);
  assert.equal(f.form.startFrom, "current");
  assert.match(f.form.message, /Start from is now current/);
  f.form.editor.setText("Ship it");
  f.form.field = "start";
  f.form.handleInput("\r");
  await flush();
  assert.equal(f.calls[0].startFrom, "current");
  assert.equal(f.calls[0].carry, true);
  const remembered = fixture({ selection: { startFrom: "latest" } });
  assert.equal(remembered.form.startFrom, "latest");
  const local = fixture({ repo: { upstream: undefined, dirty: false }, selection: { startFrom: "latest" } });
  assert.equal(local.form.startFrom, "current");
  assert.equal(local.form.fields().includes("changes"), false);
  local.form.field = "startFrom";
  local.form.handleInput("\r");
  assert.equal(local.form.startFrom, "current");
  assert.match(local.form.message, /No origin default branch/);
});

test("Up recalls previous tasks; Tab accepts a completion instead of leaving the prompt", async () => {
  const f = fixture({ history: ["Older task", "Previous task"],
    autocomplete: new tui.CombinedAutocompleteProvider([{ name: "ship", description: "Commit and push" }], "/nonexistent", null) });
  f.form.handleInput("\x1b[A");
  assert.equal(f.form.editor.getExpandedText(), "Previous task");
  f.form.editor.setText("");
  f.form.handleInput("/sh");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(f.form.editor.isShowingAutocomplete(), true);
  f.form.handleInput("\t");
  assert.equal(f.form.field, "prompt");
  assert.match(f.form.editor.getExpandedText(), /^\/ship/);
  f.form.handleInput("\t");
  assert.equal(f.form.field, "model");
});
