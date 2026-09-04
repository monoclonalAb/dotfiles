import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, mock, test } from "bun:test";

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

const { VimNavigationEditor } = await import("./index");

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
