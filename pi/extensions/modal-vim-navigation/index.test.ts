import { execFileSync } from "node:child_process";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ClipboardContent, ClipboardOptions } from "./index";

const globalNodeModules = execFileSync("npm", ["root", "--global"], {
  encoding: "utf8",
}).trim();
const codingAgentRoot = join(
  globalNodeModules,
  "@earendil-works/pi-coding-agent",
);
// pi-coding-agent 0.85.0 re-exports dist/main.js from its public barrel, and
// main.js imports the experimental server's `@earendil-works/pi-server`, which
// the package does not declare or ship. Stub the undeclared module so the real
// barrel still imports; nothing under test touches the experimental server.
mock.module("@earendil-works/pi-server", () => ({
  ServerError: class ServerError extends Error {},
  SessionAmbiguousError: class SessionAmbiguousError extends Error {},
  SessionNotFoundError: class SessionNotFoundError extends Error {},
}));
mock.module("@earendil-works/pi-server/unix", () => ({
  createUnixServer: () => {
    throw new Error("@earendil-works/pi-server stub");
  },
  getUnixSocketPath: () => "",
}));

const codingAgent = await import(
  pathToFileURL(join(codingAgentRoot, "dist/index.js")).href
);
const codingKeybindings = await import(
  pathToFileURL(join(codingAgentRoot, "dist/core/keybindings.js")).href
);
const tuiPackage = await import(
  pathToFileURL(
    join(
      codingAgentRoot,
      "node_modules/@earendil-works/pi-tui/dist/index.js",
    ),
  ).href
);

mock.module("@earendil-works/pi-coding-agent", () => codingAgent);
mock.module("@earendil-works/pi-tui", () => tuiPackage);

const { default: vimNavigation, CURSOR_SHAPES, VimNavigationEditor, readClipboardContent } = await import("./index");
const temporaryImages = new Set<string>();
afterEach(() => {
  mock.restore();
  for (const path of temporaryImages) unlinkSync(path);
  temporaryImages.clear();
});

const imagePath = (id = "00000000-0000-0000-0000-000000000001") =>
  join(tmpdir(), `pi-clipboard-${id}.png`);
const bracketed = (text: string) => `\x1b[200~${text}\x1b[201~`;

async function eventually(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return;
    await Bun.sleep(5);
  }
  throw new Error("Timed out waiting for clipboard input");
}

function clipboardEditor(options: ClipboardOptions = {}) {
  const editor = new VimNavigationEditor(createTui() as never, theme,
    createKeybindings() as never, undefined, options);
  editor.onChange = () => {
    for (const path of editor.getText().match(/\S*pi-clipboard-[\w-]+\.png/g) ?? []) {
      temporaryImages.add(path);
    }
  };
  return editor;
}

const theme = {
  borderColor: (text: string) => text,
  selectList: {
    selectedPrefix: (text: string) => text,
    selectedText: (text: string) => text,
    description: (text: string) => text,
    scrollInfo: (text: string) => text,
    noMatch: (text: string) => text,
  },
};

function createTui(mode: "regular" | "fullscreen" = "fullscreen") {
  return {
    mode,
    children: [],
    terminal: { rows: 24, columns: 80 },
    fullRedraws: 0,
    addChild() {},
    removeChild() {},
    clear() {},
    getShowHardwareCursor: () => false,
    setShowHardwareCursor() {},
    getClearOnShrink: () => true,
    setClearOnShrink() {},
    setFocus() {},
    showOverlay: () => ({
      hide() {},
      setHidden() {},
      isHidden: () => false,
      focus() {},
      unfocus() {},
      isFocused: () => false,
    }),
    hideOverlay() {},
    hasOverlay: () => false,
    start() {},
    stop() {},
    render: () => [],
    renderNow() {},
    requestRender() {},
    addInputListener: () => () => {},
    removeInputListener() {},
    onTerminalColorSchemeChange: () => () => {},
    setTerminalColorSchemeNotifications() {},
    queryTerminalBackgroundColor: async () => undefined,
    queryTerminalColorScheme: async () => undefined,
    invalidate() {},
  };
}

function createKeybindings(userBindings = {}) {
  return new codingKeybindings.KeybindingsManager(userBindings);
}

type Editor = InstanceType<typeof VimNavigationEditor>;
const ESC = "\x1b";
const APC = /\x1b_[^\x07]*\x07/g;

/** The draft with `|` at the cursor. */
function shown(editor: Editor): string {
  const lines = editor.getLines();
  const { line, col } = editor.getCursor();
  lines[line] = `${lines[line]!.slice(0, col)}|${lines[line]!.slice(col)}`;
  return lines.join("\n");
}

/** Type keys. Escape is sent on its own; other runs arrive as one read, like fast typing. */
function press(editor: Editor, ...keys: string[]) {
  for (const key of keys) {
    for (const part of key.split(/(\x1b)(?![[O])/).filter(Boolean)) editor.handleInput(part);
  }
}

function viewportTui() {
  const calls: unknown[][] = [];
  let offset = 0;
  const tui = {
    ...createTui(),
    written: [] as string[],
    hardwareCursor: false,
    isFollowingOutput: true,
    setShowHardwareCursor(enabled: boolean) { tui.hardwareCursor = enabled; },
    scrollBy(lines: number) {
      calls.push(["scrollBy", lines]);
      offset = Math.max(0, offset - lines);
      tui.isFollowingOutput = offset === 0;
    },
    scrollToTop() { calls.push(["top"]); offset = 100; tui.isFollowingOutput = false; },
    scrollToBottom() { calls.push(["bottom"]); offset = 0; tui.isFollowingOutput = true; },
    scrollToPrompt(direction: number) { calls.push(["prompt", direction]); },
    getPrimaryScrollView: () => ({ viewportHeight: 20 }),
  };
  tui.terminal = { rows: 24, columns: 80, write: (data: string) => { tui.written.push(data); } } as never;
  return { tui, calls };
}

function vim(text = "", options: { tui?: unknown; read?: ClipboardOptions["read"]; warn?: () => void } = {}) {
  const writes: string[] = [];
  const editor = new VimNavigationEditor((options.tui ?? createTui()) as never, theme,
    createKeybindings() as never, options.warn, {
      write: async (copied: string) => { writes.push(copied); },
      read: options.read ?? (async () => undefined),
    });
  if (text) editor.setText(text);
  return { editor, writes };
}

/** Normal mode with the cursor where `|` is. */
function normal(withCursor: string, options: Parameters<typeof vim>[1] = {}) {
  const result = vim(withCursor.replace("|", ""), options);
  press(result.editor, ESC);
  const before = withCursor.slice(0, withCursor.indexOf("|")).split("\n");
  const state = (result.editor as any).state;
  state.cursorLine = before.length - 1;
  state.cursorCol = before.at(-1)!.length;
  return result;
}

describe("Vim modes and the cursor", () => {
  test("Escape steps back onto the last character; i a I A o O insert where Vim does", () => {
    const { editor } = vim();
    press(editor, "hello world", ESC);
    expect(editor.getMode()).toBe("normal");
    expect(shown(editor)).toBe("hello worl|d");
    press(editor, "iX", ESC);
    expect(shown(editor)).toBe("hello worl|Xd");
    press(editor, "aY", ESC);
    expect(shown(editor)).toBe("hello worlX|Yd");
    press(editor, "A!", ESC);
    expect(shown(editor)).toBe("hello worlXYd|!");
    press(editor, "I>", ESC);
    expect(shown(editor)).toBe("|>hello worlXYd!");
    press(editor, "otwo", ESC, "Oone", ESC);
    expect(shown(editor)).toBe(">hello worlXYd!\non|e\ntwo");
  });

  test("the terminal cursor is a bar to insert, a block in normal and visual mode, an underline while a key waits", () => {
    const { tui } = viewportTui();
    const { editor } = vim("text", { tui });
    expect(tui.hardwareCursor).toBe(true);
    expect(tui.written).toEqual([]);
    editor.focused = true;
    press(editor, ESC, "d", ESC, "v", ESC, "rx", "i");
    editor.focused = false; // A dialog's input takes focus: a bar there, whatever this prompt's mode.
    press(editor, ESC);
    editor.focused = true;
    editor.dispose();
    const { insert, normal: block, pending, reset } = CURSOR_SHAPES;
    expect(tui.written).toEqual([insert, block, pending, block, pending, block, insert, block, reset]);
    expect(editor.getText()).toBe("texx");
  });

  test("Escape cancels a waiting operator or count; otherwise it is still Pi's interrupt", () => {
    const { editor } = vim("text");
    let interrupts = 0;
    editor.onEscape = () => interrupts++;
    press(editor, ESC, "d", ESC, "2", ESC, "x");
    expect(editor.getText()).toBe("tex");
    expect(interrupts).toBe(0);
    press(editor, ESC);
    expect(interrupts).toBe(1);
    expect(editor.getMode()).toBe("normal");
  });

  test("Ctrl+[ enters normal mode and never falls through to interrupt", () => {
    const { editor } = vim();
    let interrupted = 0;
    editor.onEscape = () => interrupted++;
    // Kitty CSI-u encoding of ctrl+[ ('[' = 91, modifier 5 = 1 + ctrl)
    editor.handleInput("\x1b[91;5u");
    expect(editor.getMode()).toBe("normal");
    editor.handleInput("\x1b[91;5u");
    expect(editor.getMode()).toBe("normal");
    expect(interrupted).toBe(0);
    press(editor, "ix");
    expect(editor.getText()).toBe("x");
  });

  test("a submitted, queued or cleared prompt starts the next one in insert mode", () => {
    const { editor } = vim("first");
    const submitted: string[] = [];
    editor.onSubmit = (text: string) => { submitted.push(text); };
    press(editor, ESC, "\r");
    expect(submitted).toEqual(["first"]);
    expect(editor.getMode()).toBe("insert");
    editor.setText("draft");
    press(editor, ESC);
    editor.setText(""); // How Pi clears it for Ctrl+C and Alt+Enter.
    expect(editor.getMode()).toBe("insert");
    press(editor, "j");
    expect(editor.getText()).toBe("j");
  });

  test("slash starts a slash command from normal mode; Backspace and Delete act as in Vim", () => {
    const slash = vim();
    press(slash.editor, ESC, "/");
    expect(slash.editor.getMode()).toBe("insert");
    expect(slash.editor.getText()).toBe("/");
    const { editor } = normal("draf|t");
    press(editor, "\x7f");
    expect(shown(editor)).toBe("dra|ft");
    press(editor, "\x1b[3~");
    expect(shown(editor)).toBe("dra|t");
    expect(editor.getMode()).toBe("normal");
  });

  test("arrow keys still browse prompt history in normal mode", () => {
    const { editor } = vim();
    editor.addToHistory("older prompt");
    editor.addToHistory("newer prompt");
    press(editor, ESC);
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("newer prompt");
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("older prompt");
    editor.handleInput("\x1b[B");
    expect(editor.getText()).toBe("newer prompt");
  });

  test("no method accidentally shadows one of Pi's editor methods (TypeScript private is only a name)", () => {
    const names = (prototype: object) => Object.getOwnPropertyNames(prototype);
    const pi = new Set([...names(tuiPackage.Editor.prototype), ...names(codingAgent.CustomEditor.prototype)]);
    const intended = new Set(["constructor", "getText", "getExpandedText", "setText", "insertTextAtCursor",
      "addToHistory", "handleInput", "render"]);
    const ours = [VimNavigationEditor.prototype, Object.getPrototypeOf(VimNavigationEditor.prototype)].flatMap(names);
    expect(ours.filter((name) => pi.has(name) && !intended.has(name))).toEqual([]);
  });

  test("Kitty-encoded keys work in normal mode", () => {
    const { editor } = normal("hello worl|d");
    for (const key of ["b", "d", "w"]) editor.handleInput(`\x1b[${key.charCodeAt(0)}u`);
    expect(shown(editor)).toBe("hello| ");
  });
});

describe("Vim motions", () => {
  test.each([
    ["one tw|o three", "0", "|one two three"],
    ["  one tw|o", "^", "  |one two"],
    ["o|ne two three", "$", "one two thre|e"],
    ["|one two three", "w", "one |two three"],
    ["|one two three", "2w", "one two |three"],
    ["|one, two", "w", "one|, two"],
    ["|one, two", "W", "one, |two"],
    ["one two thr|ee", "b", "one two |three"],
    ["one, two |three", "2B", "|one, two three"],
    ["|one two", "e", "on|e two"],
    ["on|e two", "e", "one tw|o"],
    ["one tw|o", "ge", "on|e two"],
    ["|one two", "fw", "one t|wo"],
    ["|one two", "tw", "one |two"],
    ["one tw|o", "Fo", "|one two"],
    ["one tw|o", "To", "o|ne two"],
    ["|a-b-c-d", "f-;", "a-b|-c-d"],
    ["|a-b-c-d", "f-;;,", "a-b|-c-d"],
    ["|a-b-c-d", "t-;", "a-|b-c-d"],
    ["|a-b-c-d", "2f-", "a-b|-c-d"],
    ["f|(a, (b))", "%", "f(a, (b)|)"],
    ["|hello", "3l", "hel|lo"],
    ["hel|lo", "9l", "hell|o"],
    ["hel|lo", "h", "he|llo"],
    ["one\n|two\nthree", "j", "one\ntwo\n|three"],
    ["|one\ntwo\nthree", "G", "one\ntwo\n|three"],
    ["|one\ntwo\nthree", "2G", "one\n|two\nthree"],
    ["one\ntwo\nthr|ee", "gg", "|one\ntwo\nthree"],
    ["|para one\nline\n\npara two", "}", "para one\nline\n|\npara two"],
    ["para one\nline\n\npara |two", "{", "para one\nline\n|\npara two"],
    ["|one\n\ntwo", "w", "one\n|\ntwo"],
    ["one\n|\ntwo", "w", "one\n\n|two"],
    ["|héllo 👋 wörld", "w", "héllo |👋 wörld"],
    ["|héllo 👋 wörld", "2w", "héllo 👋 |wörld"],
  ])("%j  %s  →  %j", (before, keys, after) => {
    const { editor } = normal(before);
    press(editor, keys);
    expect(shown(editor)).toBe(after);
    expect(editor.getMode()).toBe("normal");
  });
});

describe("Vim operators", () => {
  test.each([
    ["one |two three", "dw", "one |three"],
    ["one two |three", "dw", "one two| "],
    ["one |two\nthree", "dw", "one| \nthree"],
    ["one |two three", "cwX\x1b", "one |X three"],
    ["one |two three", "dd", "|"],
    ["|one\ntwo\nthree", "2dd", "|three"],
    ["one\ntwo\nth|ree", "dk", "|one"],
    ["one\n|two\nthree", "ccX\x1b", "one\n|X\nthree"],
    ["one |two three", "d$", "one| "],
    ["one |two three", "D", "one| "],
    ["one |two three", "C!\x1b", "one |!"],
    ["one |two three", "x", "one |wo three"],
    ["one |two three", "3x", "one | three"],
    ["one |two three", "X", "one|two three"],
    ["one |two three", "sX\x1b", "one |Xwo three"],
    ["one |two three", "S\x1b", "|"],
    ["one |two three", "dtt", "one |three"],
    ["one |two three", "dfo", "one | three"],
    ["one t|wo three", "diw", "one | three"],
    ["one t|wo three", "daw", "one |three"],
    ['say "he|llo" now', 'ci"X\x1b', 'say "|X" now'],
    ['say "he|llo" now', 'da"', "say |now"],
    ["f(a, (|b))", "di(", "f(a, (|))"],
    ["f(a|, (b))", "da(", "|f"],
    ["if {\n  fo|o\n}", "di{", "if {\n|}"],
    ["if {\n  fo|o\n}", "ci{X\x1b", "if {\n|X\n}"],
    ["one\n|two\n\nthree", "dap", "|three"],
    ["one |two three", "yiwP", "one tw|otwo three"],
    ["|one\ntwo", "yyp", "one\n|one\ntwo"],
    ["|one\ntwo", "yyP", "|one\none\ntwo"],
    ["|one\ntwo", "ddp", "two\n|one"],
    ["one |two three", "g~w", "one |TWO three"],
    ["one |two three", "gUiw", "one |TWO three"],
    ["ONE |TWO", "guu", "one |two"],
    ["|abc", "~~", "AB|c"],
    ["|abc", "3rx", "xx|x"],
    ["|one two three", "cwX\x1bw.w.", "X X |X"],
    ["|abcd", "x..", "|d"],
    ["|one\ntwo\nthree", "dd.", "|three"],
    ["|one\ntwo", "A!\x1bj.", "one!\ntwo|!"],
  ])("%j  %j  →  %j", async (before, keys, after) => {
    const { editor } = normal(before);
    press(editor, keys);
    await eventually(() => shown(editor) === after).catch(() => {});
    expect(shown(editor)).toBe(after);
    expect(editor.getMode()).toBe("normal");
  });

  test("u undoes a whole insert session, Ctrl+R redoes it", () => {
    const { editor } = vim();
    press(editor, "hello", ESC, "A world again", ESC);
    expect(editor.getText()).toBe("hello world again");
    press(editor, "u");
    expect(editor.getText()).toBe("hello");
    press(editor, "u");
    expect(editor.getText()).toBe("");
    press(editor, "\x12");
    expect(editor.getText()).toBe("hello");
    press(editor, "\x12");
    expect(editor.getText()).toBe("hello world again");
    press(editor, "x", "\x12");
    expect(editor.getText()).toBe("hello world agai");
  });

  test("x on a large paste deletes the whole marker and copies the pasted text", () => {
    const pasted = "pasted line\n".repeat(20);
    const { editor, writes } = vim();
    editor.handleInput(bracketed(pasted));
    expect(editor.getLines()[0]).toMatch(/^\[paste #1 \+\d+ lines\]$/);
    press(editor, ESC, "0x");
    expect(editor.getText()).toBe("");
    expect(writes).toEqual([pasted]);
  });
});

describe("Vim visual mode", () => {
  test.each([
    ["one |two three", "viwd", "one | three"],
    ["one |two three", "veyP", "one tw|otwo three"],
    ["|one\ntwo\nthree", "Vjd", "|three"],
    ["|one\ntwo\nthree", "vjd", "|wo\nthree"],
    ["one |two three", "vllohd", "one| three"],
    ["one |two three", "vU", "one |Two three"],
    ["one |two three", "viwc!\x1b", "one |! three"],
    ["one |two three", "vipd", "|"],
  ])("%j  %j  →  %j", async (before, keys, after) => {
    const { editor } = normal(before);
    press(editor, keys);
    await eventually(() => shown(editor) === after).catch(() => {});
    expect(shown(editor)).toBe(after);
    expect(editor.getMode()).toBe("normal");
  });

  test("p replaces the selection with the clipboard and copies what it replaced", async () => {
    const { editor, writes } = normal("one |two three", { read: async () => ({ type: "text", text: "X" }) });
    press(editor, "viwp");
    await eventually(() => editor.getText() === "one X three");
    expect(shown(editor)).toBe("one |X three");
    expect(writes).toEqual(["two"]);
  });

  test("the selection is painted on Pi's rendered rows, a line selection one cell past each line", () => {
    const { editor } = normal("one |two three");
    editor.selectionStyle = (text: string) => `<${text}>`;
    press(editor, "viw");
    expect(editor.getMode()).toBe("visual");
    expect(editor.render(40)[1]!.replace(APC, "")).toBe(`one <tw><o> three${" ".repeat(27)}`);
    const lines = normal("|one\ntwo").editor;
    lines.selectionStyle = (text: string) => `<${text}>`;
    press(lines, "Vj");
    const rows = lines.render(20).map((row: string) => row.replace(APC, ""));
    expect(rows[1]!.startsWith("<one >")).toBe(true);
    expect(rows[2]!.startsWith("<t><wo >")).toBe(true);
    lines.selectionStyle = (text: string) => `\x1b[7m${text}\x1b[27m`;
    for (const row of lines.render(20)) expect(tuiPackage.visibleWidth(row)).toBe(20);
    press(lines, ESC);
    expect(lines.render(20).join("")).not.toContain("<");
  });
});

describe("Vim registers and the system clipboard", () => {
  test("yanks and deletes copy to the clipboard; p reads it back, as with clipboard=unnamedplus", async () => {
    let clipboard: ClipboardContent = undefined;
    const { editor, writes } = normal("|one two", { read: async () => clipboard });
    press(editor, "yiw", "dd");
    expect(writes).toEqual(["one", "one two\n"]);
    clipboard = { type: "text", text: "copied line\n" };
    editor.setText("abc");
    press(editor, ESC, "p");
    await eventually(() => editor.getText() === "abc\ncopied line");
    expect(shown(editor)).toBe("abc\n|copied line");
    clipboard = { type: "text", text: "word" };
    press(editor, "p");
    await eventually(() => editor.getText() === "abc\ncwordopied line");
    expect(shown(editor)).toBe("abc\ncwor|dopied line");
  });

  test("a failed clipboard read falls back to the last yank", async () => {
    const { editor } = normal("|one two", { read: async () => { throw new Error("no clipboard"); } });
    press(editor, "yiw$p");
    await eventually(() => editor.getText() === "one twoone");
    expect(shown(editor)).toBe("one twoon|e");
  });
});

describe("transcript navigation", () => {
  test("k past the prompt's top line scrolls the transcript; while it is scrolled up, j and k scroll it", () => {
    const { tui, calls } = viewportTui();
    const { editor } = normal("one\ntw|o", { tui });
    press(editor, "k");
    expect(shown(editor)).toBe("on|e\ntwo");
    expect(calls).toEqual([]);
    press(editor, "k");
    expect(calls).toEqual([["scrollBy", -1]]);
    press(editor, "j");
    expect(calls.at(-1)).toEqual(["scrollBy", 1]);
    expect(shown(editor)).toBe("on|e\ntwo");
    press(editor, "j");
    expect(shown(editor)).toBe("one\ntw|o");
    press(editor, "3k");
    expect(shown(editor)).toBe("on|e\ntwo");
    expect(calls.at(-1)).toEqual(["scrollBy", -2]);
    press(editor, "5j");
    expect(calls.at(-1)).toEqual(["scrollBy", 5]);
    expect(shown(editor)).toBe("on|e\ntwo");
  });

  test("gg and G reach the prompt's first or last line, then the transcript's top or bottom", () => {
    const { tui, calls } = viewportTui();
    const { editor } = normal("one\ntw|o", { tui });
    press(editor, "gg");
    expect(shown(editor)).toBe("|one\ntwo");
    expect(calls).toEqual([]);
    press(editor, "gg");
    expect(calls).toEqual([["top"]]);
    press(editor, "G");
    expect(calls).toEqual([["top"], ["bottom"]]);
    expect(shown(editor)).toBe("|one\ntwo");
    press(editor, "G");
    expect(shown(editor)).toBe("one\n|two");
  });

  test("J and K jump between messages; Ctrl+E Y D U F B scroll, in normal mode only", () => {
    const { tui, calls } = viewportTui();
    const { editor } = vim("draft", { tui });
    press(editor, "\x05", "\x19", "\x04");
    expect(calls).toEqual([]);
    expect(editor.getText()).toBe("draft");
    press(editor, ESC, "K", "2J", "\x05", "\x19", "\x04", "\x15", "\x06", "\x02");
    expect(calls).toEqual([
      ["prompt", -1], ["prompt", 1], ["prompt", 1],
      ["scrollBy", 1], ["scrollBy", -1], ["scrollBy", 10], ["scrollBy", -10], ["scrollBy", 16], ["scrollBy", -16],
    ]);
    expect(editor.getText()).toBe("draft");
  });

  test("Ctrl+D never exits Pi in normal mode, and regular mode warns once instead of scrolling", () => {
    let warned = 0;
    const { editor } = vim("", { tui: createTui("regular"), warn: () => warned++ });
    let exited = 0;
    editor.onCtrlD = () => exited++;
    press(editor, ESC, "\x04", "\x04", "k");
    expect(exited).toBe(0);
    expect(warned).toBe(1);
  });
});

describe("copy cleared draft", () => {
  function mountedEditor(options: ClipboardOptions = {}, bindings = {}) {
    const ui = createTui();
    const keybindings = createKeybindings(bindings);
    const write = mock(async (_text: string) => {});
    const defaultEditor = new codingAgent.CustomEditor(ui, theme, keybindings);
    const host = {
      ui, keybindings, defaultEditor, editor: defaultEditor,
      editorContainer: new tuiPackage.Container(),
      disposeActiveSelector() {},
      lastSigintTime: 0,
      extensionDialogs: [],
      shutdown: mock(async () => {}),
      clearEditor: codingAgent.InteractiveMode.prototype.clearEditor,
    };
    defaultEditor.onAction("app.clear", () => codingAgent.InteractiveMode.prototype.handleCtrlC.call(host));
    // Exercise Pi's real factory wiring, which copies the handlers via Map.set
    // rather than calling the custom editor's onAction method.
    codingAgent.InteractiveMode.prototype.setCustomEditorComponent.call(host,
      (tui: any, editorTheme: any, kb: any) => new VimNavigationEditor(
        tui, editorTheme, kb, undefined, { write, ...options }));
    return { editor: host.editor as InstanceType<typeof VimNavigationEditor>, host, write };
  }

  test.each(["\x03", "\x1b[99;5u"])("copies the cleared draft in both Vim modes using %j", (key) => {
    for (const mode of ["insert", "normal"]) {
      const { editor, write } = mountedEditor();
      const draft = "  keep this 👋\nsecond line  ";
      editor.setText(draft);
      if (mode === "normal") editor.handleInput("\x1b");
      const handler = editor.actionHandlers.get("app.clear");
      editor.handleInput(key);
      expect(write.mock.calls).toEqual([[draft]]);
      expect(editor.getText()).toBe("");
      // The next prompt starts in insert mode either way.
      expect(editor.getMode()).toBe("insert");
      expect(editor.actionHandlers.get("app.clear")).toBe(handler);
      editor.handleInput("\x1f"); // Native undo still restores the cleared draft.
      expect(editor.getText()).toBe(draft);
    }
  });

  test("empty clears leave the clipboard alone and a rapid second Ctrl+C still exits", () => {
    const { editor, host, write } = mountedEditor();
    const now = spyOn(Date, "now").mockReturnValue(10_000);
    editor.handleInput("\x03");
    expect(write).not.toHaveBeenCalled();
    editor.setText("not cleared on exit");
    now.mockReturnValue(10_100);
    editor.handleInput("\x03");
    expect(host.shutdown).toHaveBeenCalledTimes(1);
    expect(editor.getText()).toBe("not cleared on exit");
    expect(write).not.toHaveBeenCalled();
  });

  test("copies expanded large pastes and image paths, not display markers", () => {
    const { editor, write } = mountedEditor();
    const pasted = "long pasted text\n".repeat(20);
    editor.handleInput(bracketed(pasted));
    editor.insertTextAtCursor(imagePath());
    const draft = editor.getExpandedText();
    expect(editor.getLines().join("\n")).toContain("[paste #");
    expect(editor.getLines().join("\n")).toContain("[img #1]");
    editor.handleInput("\x03");
    expect(write.mock.calls).toEqual([[draft]]);
    expect(draft).toContain(pasted);
    expect(draft).toContain(imagePath());
    expect(editor.getText()).toBe("");
  });

  test("respects remapped clear actions and extension shortcut precedence", () => {
    const { editor, write } = mountedEditor({}, { "app.clear": "ctrl+q" });
    editor.setText("remapped draft");
    editor.handleInput("\x03");
    expect(editor.getText()).toBe("remapped draft");
    expect(write).not.toHaveBeenCalled();
    editor.handleInput("\x11");
    expect(write.mock.calls).toEqual([["remapped draft"]]);
    const intercepted = mountedEditor();
    intercepted.editor.setText("handled elsewhere");
    intercepted.editor.onExtensionShortcut = () => {
      intercepted.editor.setText("");
      return true;
    };
    intercepted.editor.handleInput("\x03");
    expect(intercepted.write).not.toHaveBeenCalled();
  });

  test("ordinary deletion, submission and programmatic clears do not copy", () => {
    const { editor, write } = mountedEditor();
    editor.setText("draft text");
    editor.handleInput("\x7f");
    editor.handleInput("\x15"); // Ctrl+U
    editor.setText("submit this");
    editor.onSubmit = () => {};
    editor.handleInput("\r");
    editor.setText("clear this");
    editor.setText("");
    expect(write).not.toHaveBeenCalled();
  });

  test("reports copy failure without delaying clear or changing subsequent typing", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, fail) => { reject = fail; });
    const reportError = mock();
    const { editor } = mountedEditor({ write: () => pending, reportError });
    editor.setText("old draft");
    editor.handleInput("\x03");
    expect(editor.getText()).toBe("");
    editor.handleInput("new draft");
    reject(new Error("clipboard unavailable"));
    await eventually(() => reportError.mock.calls.length > 0);
    expect(reportError.mock.calls).toEqual([["copy"]]);
    expect(editor.getText()).toBe("new draft");
  });
});

describe("clipboard images", () => {
  test("renders image chips but submits and exposes original native paths", () => {
    const editor = clipboardEditor();
    editor.onChange = undefined; // Synthetic paths, no files to clean up.
    editor.setText(`inspect ${imagePath()} please`);
    expect(editor.getLines()).toEqual(["inspect [img #1] please"]);
    expect(editor.getText()).toBe(`inspect ${imagePath()} please`);
    expect(editor.getExpandedText()).toBe(editor.getText());
    for (const width of [10, 20, 80]) {
      const lines = editor.render(width);
      expect(lines.every((line: string) => tuiPackage.visibleWidth(line) <= width)).toBe(true);
      expect(lines.join("\n")).not.toContain("pi-clipboard-");
    }
    let submitted = "";
    editor.onSubmit = (text: string) => { submitted = text; };
    editor.handleInput("\r");
    expect(submitted).toBe(`inspect ${imagePath()} please`);
    expect(editor.getText()).toBe("");
  });

  test("preserves chips through history, undo, and editor recreation", () => {
    const editor = clipboardEditor();
    editor.onChange = undefined;
    editor.setText("explain");
    editor.insertTextAtCursor(imagePath());
    expect(editor.getLines()).toEqual(["explain [img #1] "]);
    editor.handleInput("\x1f"); // Ctrl+-: native editor undo.
    expect(editor.getText()).toBe("explain");
    editor.insertTextAtCursor(imagePath());
    const text = editor.getText();
    editor.addToHistory(text);
    editor.setText("");
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe(text.trim());
    expect(editor.getLines().join("\n")).toContain("[img #1]");
    const replacement = clipboardEditor();
    replacement.onChange = undefined;
    replacement.setText(editor.getText()); // Pi's actual factory handoff.
    expect(replacement.getExpandedText()).toBe(text.trim());
    expect(replacement.getLines()).toEqual(["explain [img #1]"]);
  });

  test("separates successive images and never sends a removed reference", () => {
    const editor = clipboardEditor();
    editor.onChange = undefined;
    const second = imagePath("00000000-0000-0000-0000-000000000002");
    editor.insertTextAtCursor(imagePath());
    editor.insertTextAtCursor(second);
    expect(editor.getExpandedText()).toBe(`${imagePath()} ${second} `);
    // Delete the complete second display marker and its trailing separator.
    for (const _ of "[img #2] ") editor.handleInput("\x7f");
    expect(editor.getExpandedText()).toBe(`${imagePath()} `);
    editor.setText("");
    expect(editor.getExpandedText()).toBe("");
    editor.setText("literal [img #999] and /tmp/unrelated.png");
    expect(editor.getExpandedText()).toBe("literal [img #999] and /tmp/unrelated.png");
  });

  test.each(["\x16", bracketed("")])("pastes a private image using %j before queued typing and Enter", async (key) => {
    let resolve!: (value: any) => void;
    const pending = new Promise<any>((done) => { resolve = done; });
    let reads = 0;
    const editor = clipboardEditor({ read: () => { reads++; return pending; } });
    let submitted = "";
    editor.onSubmit = (text: string) => { submitted = text; };
    editor.handleInput(key);
    editor.handleInput("describe");
    editor.handleInput("\r");
    expect(submitted).toBe("");
    const bytes = new Uint8Array([137, 80, 78, 71]);
    resolve({ type: "image", bytes, extension: "png" });
    await eventually(() => submitted.length > 0);
    expect(reads).toBe(1);
    const [path, prompt] = submitted.split(" ");
    expect(prompt).toBe("describe");
    expect(readFileSync(path!)).toEqual(Buffer.from(bytes));
    expect(statSync(path!).mode & 0o777).toBe(0o600);
    expect(editor.getText()).toBe("");
  });

  test("orders two async image pastes and handles normal-mode paste", async () => {
    const editor = clipboardEditor({
      read: async () => ({ type: "image", bytes: new Uint8Array([1]), extension: "png" }),
    });
    editor.handleInput("\x1b");
    editor.handleInput(bracketed(""));
    editor.handleInput("\x16");
    editor.handleInput("A");
    editor.handleInput("done");
    await eventually(() => editor.getText().endsWith("done"));
    expect(editor.getLines()).toEqual(["[img #1] [img #2] done"]);
    expect(temporaryImages.size).toBe(2);
  });

  test("does not consult the clipboard for text or whitespace paste", () => {
    const editor = clipboardEditor({ read: async () => { throw new Error("Unexpected clipboard read"); } });
    for (const text of ["hello", " ", "\n", "x".repeat(1100)]) {
      editor.handleInput(bracketed(text));
    }
    expect(editor.getExpandedText()).toBe(`hello \n${"x".repeat(1100)}`);
    expect(editor.getLines().join("\n")).toContain("[paste #");
  });

  test("Ctrl+V text fallback inserts literally, without executing embedded terminal keys", async () => {
    const text = `${"line\n".repeat(15)}\x1b[201~\rdo not submit`;
    const editor = clipboardEditor({ read: async () => ({ type: "text", text }) });
    let submitted = false;
    editor.onSubmit = () => { submitted = true; };
    editor.handleInput("\x16");
    await eventually(() => editor.getExpandedText().includes("do not submit"));
    expect(editor.getExpandedText()).toBe(text.replace(/\r/g, "\n"));
    expect(submitted).toBe(false);
  });

  test("accepts empty-paste delimiters split at the editor boundary", async () => {
    let reads = 0;
    const editor = clipboardEditor({ read: async () => { reads++; return undefined; } });
    editor.handleInput("\x1b[200~");
    editor.handleInput("\x1b[20");
    expect(reads).toBe(0);
    editor.handleInput("1~");
    expect(reads).toBe(1);
    expect(editor.getText()).toBe("");
  });

  test("installed StdinBuffer preserves a fragmented Alacritty empty paste and trailing Enter", async () => {
    const { StdinBuffer } = await import(pathToFileURL(join(codingAgentRoot,
      "node_modules/@earendil-works/pi-tui/dist/stdin-buffer.js")).href);
    const editor = clipboardEditor({ read: async () => ({ type: "text", text: "clipboard text" }) });
    const buffer = new StdinBuffer();
    buffer.on("data", (data: string) => editor.handleInput(data));
    buffer.on("paste", (text: string) => editor.handleInput(bracketed(text)));
    let submitted = "";
    editor.onSubmit = (text: string) => { submitted = text; };
    try {
      for (const char of `${bracketed("")}\r`) buffer.process(char);
      await eventually(() => submitted.length > 0);
      expect(submitted).toBe("clipboard text");
    } finally {
      buffer.destroy();
    }
  });

  test("reports read errors and does not insert after shutdown/reload", async () => {
    let errors = 0;
    const editor = clipboardEditor({ read: async () => { throw new Error("unavailable"); },
      reportError: () => { errors++; } });
    editor.handleInput("\x16");
    await eventually(() => errors === 1);
    expect(editor.getText()).toBe("");
    let resolve!: (value: any) => void;
    const pending = new Promise<any>((done) => { resolve = done; });
    const disposed = clipboardEditor({ read: () => pending });
    disposed.handleInput("\x16");
    disposed.handleInput("queued text");
    disposed.disposeClipboard();
    resolve({ type: "image", bytes: new Uint8Array([1]), extension: "png" });
    await Bun.sleep(10);
    expect(disposed.getText()).toBe("");
    expect(temporaryImages.size).toBe(0);
  });

  test("native Alt+Enter queues full paths rather than display markers", async () => {
    const editor = clipboardEditor();
    editor.onChange = undefined;
    editor.setText(`compare ${imagePath()}`);
    const prompt = mock(async () => {});
    await codingAgent.InteractiveMode.prototype.handleFollowUp.call({
      editor,
      session: { isStreaming: true, isCompacting: false, prompt },
      ui: createTui(),
      updatePendingMessagesDisplay() {},
    });
    expect(prompt).toHaveBeenCalledWith(`compare ${imagePath()}`, { streamingBehavior: "followUp" });
    expect(editor.getText()).toBe("");
    editor.handleInput("\x1b[A");
    expect(editor.getLines()).toEqual(["compare [img #1]"]);
  });

  test("extension registration is UI-only and transcript formatting leaves assistant text alone", () => {
    const handlers = new Map<string, Function>();
    let transformer!: (markdown: string, context: any) => string;
    vimNavigation({
      on: (name: string, handler: Function) => { handlers.set(name, handler); },
      registerMarkdownTransformer: (handler: typeof transformer) => { transformer = handler; },
    } as never);
    expect([...handlers.keys()]).toEqual(["session_start", "session_shutdown"]);
    const text = `look at ${imagePath()}`;
    expect(transformer(text, { messageType: "user" })).toBe("look at [img #1]");
    expect(transformer(text, { messageType: "assistant" })).toBe(text);
    expect(transformer(text, { messageType: "assistant-thinking" })).toBe(text);
    for (const mode of ["rpc", "print", "json"]) {
      handlers.get("session_start")!({}, { mode, ui: { setEditorComponent() { throw new Error("Not TUI"); } } });
    }
  });

  test("installed clipboard adapter prefers images, then text, without reading the real clipboard", async () => {
    const imageModule = await import(pathToFileURL(join(codingAgentRoot, "dist/utils/clipboard-image.js")).href);
    const textModule = await import(pathToFileURL(join(codingAgentRoot, "dist/utils/clipboard.js")).href);
    const bytes = new Uint8Array([1]);
    const imageReader = spyOn(imageModule, "readClipboardImage").mockResolvedValue({ bytes, mimeType: "image/png" });
    const textReader = spyOn(textModule, "readClipboardText").mockResolvedValue("text fallback");
    expect(await readClipboardContent()).toEqual({ type: "image", bytes, extension: "png" });
    expect(textReader).not.toHaveBeenCalled();
    imageReader.mockResolvedValue(null);
    expect(await readClipboardContent()).toEqual({ type: "text", text: "text fallback" });
    textReader.mockResolvedValue(null);
    expect(await readClipboardContent()).toBeUndefined();
  });
});

describe("/copy alias", () => {
  // Mount through the extension's own session_start, as Pi does in the TUI.
  function mounted(commands: Array<{ name: string; source: string }>) {
    const handlers = new Map<string, Function>();
    let editor!: InstanceType<typeof VimNavigationEditor>;
    let wrap!: (current: any) => any;
    vimNavigation({
      on: (name: string, handler: Function) => { handlers.set(name, handler); },
      registerMarkdownTransformer() {},
      getCommands: () => commands,
    } as never);
    handlers.get("session_start")!({}, { mode: "tui", ui: {
      notify() {},
      setEditorComponent: (factory: Function) => { editor = factory(createTui(), theme, createKeybindings()); },
      addAutocompleteProvider: (factory: typeof wrap) => { wrap = factory; },
    } });
    const submitted: string[] = [];
    editor.onSubmit = (text: string) => { submitted.push(text); };
    const submit = (text: string) => { editor.setText(text); editor.handleInput("\r"); return submitted.at(-1); };
    const menu = new tuiPackage.CombinedAutocompleteProvider([
      { name: "copy", description: "Copy last agent message to clipboard" },
      { name: "copy-session", description: "Copy this session's file path to the clipboard" },
    ], tmpdir());
    const suggest = async (text: string) => (await wrap(menu).getSuggestions(
      [text], 0, text.length, { signal: new AbortController().signal }))?.items;
    return { submit, suggest };
  }

  test("submits an exact /copy as /copy-session and leaves everything else alone", () => {
    const { submit } = mounted([{ name: "copy-session", source: "extension" }]);
    expect(submit("/copy")).toBe("/copy-session");
    expect(submit("  /copy ")).toBe("/copy-session");
    for (const text of ["/copy now", "/copy-session", "/copyx", "please /copy", "/session"]) {
      expect(submit(text)).toBe(text);
    }
  });

  test("keeps Pi's own /copy when the copy-session extension is not loaded", () => {
    for (const commands of [[], [{ name: "copy-session", source: "prompt" }]]) {
      const { submit } = mounted(commands);
      expect(submit("/copy")).toBe("/copy");
    }
  });

  test("the command menu describes /copy as the session-path copy only while the alias is active", async () => {
    const active = mounted([{ name: "copy-session", source: "extension" }]);
    const items = await active.suggest("/cop");
    expect(items.find((item: any) => item.value === "copy").description).toContain("session's file path");
    expect(items.find((item: any) => item.value === "copy-session").description)
      .toBe("Copy this session's file path to the clipboard");
    expect(await active.suggest("look at @nothing-here-xyz")).toBeUndefined();
    const inactive = mounted([]);
    expect((await inactive.suggest("/cop")).find((item: any) => item.value === "copy").description)
      .toBe("Copy last agent message to clipboard");
  });
});
