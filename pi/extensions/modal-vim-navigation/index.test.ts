import { execFileSync } from "node:child_process";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { ClipboardOptions } from "./index";

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

const { default: vimNavigation, VimNavigationEditor, readClipboardContent } = await import("./index");
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

describe("VimNavigationEditor", () => {
  test("uses Escape for normal mode and i for insert mode", () => {
    const keybindings = createKeybindings();
    const editor = new VimNavigationEditor(
      createTui() as never,
      theme,
      keybindings as never,
    );

    editor.handleInput("j");
    expect(editor.getText()).toBe("j");

    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");
    editor.handleInput("j");
    expect(editor.getText()).toBe("j");

    editor.handleInput("i");
    expect(editor.getMode()).toBe("insert");
    editor.handleInput("k");
    expect(editor.getText()).toBe("jk");
  });

  test("Ctrl+[ enters normal mode and never falls through to interrupt", () => {
    const keybindings = createKeybindings();
    const editor = new VimNavigationEditor(
      createTui() as never,
      theme,
      keybindings as never,
    );
    let interrupted = 0;
    editor.onEscape = () => interrupted++;

    // Kitty CSI-u encoding of ctrl+[ ('[' = 91, modifier 5 = 1 + ctrl)
    editor.handleInput("\x1b[91;5u");
    expect(editor.getMode()).toBe("normal");

    // Already in normal mode: no interrupt, no text edit
    editor.handleInput("\x1b[91;5u");
    expect(editor.getMode()).toBe("normal");
    expect(interrupted).toBe(0);

    editor.handleInput("i");
    expect(editor.getMode()).toBe("insert");
    editor.handleInput("x");
    expect(editor.getText()).toBe("x");
  });

  test("slash and delete keys leave normal mode and keep their editor behavior", () => {
    const slash = new VimNavigationEditor(
      createTui() as never,
      theme,
      createKeybindings() as never,
    );
    slash.handleInput("\x1b");
    slash.handleInput("/");
    expect(slash.getMode()).toBe("insert");
    expect(slash.getText()).toBe("/");

    const backspace = new VimNavigationEditor(
      createTui() as never,
      theme,
      createKeybindings() as never,
    );
    backspace.setText("draft");
    backspace.handleInput("\x1b");
    backspace.handleInput("\x7f");
    expect(backspace.getMode()).toBe("insert");
    expect(backspace.getText()).toBe("draf");

    const forwardDelete = new VimNavigationEditor(
      createTui() as never,
      theme,
      createKeybindings() as never,
    );
    forwardDelete.setText("draft");
    forwardDelete.handleInput("\x1b[H");
    forwardDelete.handleInput("\x1b");
    forwardDelete.handleInput("\x1b[3~");
    expect(forwardDelete.getMode()).toBe("insert");
    expect(forwardDelete.getText()).toBe("raft");
  });

  test("installs viewport motions only while normal mode is active", () => {
    const original = { "tui.altScreen.lineUp": "alt+up" };
    const keybindings = createKeybindings(original);
    const editor = new VimNavigationEditor(
      createTui() as never,
      theme,
      keybindings as never,
    );

    expect(keybindings.matches("k", "tui.altScreen.lineUp")).toBe(false);
    editor.handleInput("\x1b");

    expect(keybindings.matches("k", "tui.altScreen.lineUp")).toBe(true);
    expect(keybindings.matches("j", "tui.altScreen.lineDown")).toBe(true);
    expect(keybindings.matches("\x02", "tui.altScreen.pageUp")).toBe(true);
    expect(keybindings.matches("\x04", "tui.altScreen.halfPageDown")).toBe(true);
    expect(keybindings.matches("K", "tui.altScreen.previousPrompt")).toBe(true);
    expect(keybindings.matches("J", "tui.altScreen.nextPrompt")).toBe(true);
    // Arrow keys stay unbound from viewport actions so they keep their
    // editor behavior (prompt-history recall) in both modes.
    expect(keybindings.matches("\x1b[A", "tui.altScreen.previousPrompt")).toBe(false);
    expect(keybindings.matches("\x1b[B", "tui.altScreen.nextPrompt")).toBe(false);

    editor.handleInput("i");
    expect(keybindings.getUserBindings()).toEqual(original);
  });

  test("arrow keys still browse prompt history in normal mode", () => {
    const keybindings = createKeybindings();
    const editor = new VimNavigationEditor(
      createTui() as never,
      theme,
      keybindings as never,
    );

    editor.addToHistory("older prompt");
    editor.addToHistory("newer prompt");

    editor.handleInput("\x1b");
    expect(editor.getMode()).toBe("normal");

    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("newer prompt");
    editor.handleInput("\x1b[A");
    expect(editor.getText()).toBe("older prompt");
    editor.handleInput("\x1b[B");
    expect(editor.getText()).toBe("newer prompt");
  });

  test("does not turn Ctrl+D into exit in regular-mode normal state", () => {
    const keybindings = createKeybindings();
    let warned = 0;
    const editor = new VimNavigationEditor(
      createTui("regular") as never,
      theme,
      keybindings as never,
      () => warned++,
    );
    let exited = 0;
    editor.onCtrlD = () => exited++;

    editor.handleInput("\x1b");
    editor.handleInput("\x04");
    editor.handleInput("\x04");

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
      expect(editor.getMode()).toBe(mode);
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
    editor.handleInput("i");
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
