import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CustomEditor,
  copyToClipboard,
  getPackageDir,
  type ExtensionAPI,
  type KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type EditorTheme,
  type Keybinding,
  type KeybindingsConfig,
  type TUI,
} from "@earendil-works/pi-tui";

export type VimNavigationMode = "insert" | "normal";

const VIEWPORT_BINDINGS = [
  ["tui.altScreen.lineUp", ["k"]],
  ["tui.altScreen.lineDown", ["j"]],
  ["tui.altScreen.pageUp", ["ctrl+b"]],
  ["tui.altScreen.halfPageUp", ["ctrl+u"]],
  ["tui.altScreen.halfPageDown", ["ctrl+d"]],
  ["tui.altScreen.pageDown", ["ctrl+f"]],
  ["tui.altScreen.previousPrompt", ["shift+k"]],
  ["tui.altScreen.nextPrompt", ["shift+j"]],
  ["tui.altScreen.bottom", ["shift+g"]],
] as const satisfies ReadonlyArray<readonly [Keybinding, readonly string[]]>;

function addViewportBindings(
  keybindings: KeybindingsManager,
  baseBindings: KeybindingsConfig,
): KeybindingsConfig {
  const overrides = Object.fromEntries(
    VIEWPORT_BINDINGS.map(([action, keys]) => [
      action,
      [...new Set([...keybindings.getKeys(action), ...keys])],
    ]),
  ) as KeybindingsConfig;

  return { ...baseBindings, ...overrides };
}

const PASTE_START = "\x1b[200~";
const EMPTY_PASTE = `${PASTE_START}\x1b[201~`;
const clipboardPrefix = join(tmpdir(), "pi-clipboard-").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clipboardPathPattern = new RegExp(
  `${clipboardPrefix}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(?:png|jpg|jpeg|gif|webp)\\b`,
  "g",
);

export type ClipboardContent =
  | { type: "image"; bytes: Uint8Array; extension: string }
  | { type: "text"; text: string }
  | undefined;

export interface ClipboardOptions {
  read?: () => Promise<ClipboardContent>;
  write?: (text: string) => Promise<void>;
  reportError?: (operation: "paste" | "copy") => void;
}

/** Lazy, version-sensitive adapter to the same clipboard readers Pi uses. */
export async function readClipboardContent(): Promise<ClipboardContent> {
  const utility = (name: string) => pathToFileURL(join(getPackageDir(), "dist/utils", name)).href;
  const { readClipboardImage, extensionForImageMimeType } = await import(utility("clipboard-image.js"));
  const image = await readClipboardImage();
  if (image) {
    const extension = extensionForImageMimeType(image.mimeType);
    if (!extension) throw new Error("Unsupported clipboard image format");
    return { type: "image", bytes: image.bytes, extension };
  }
  const { readClipboardText } = await import(utility("clipboard.js"));
  const text = await readClipboardText();
  return text ? { type: "text", text } : undefined;
}

/**
 * Display-only chips for Pi's native clipboard files. Pi still receives the
 * original paths, not invented attachment syntax or injected image content.
 * Keep the registry for history/undo; getText expands it for editor replacement
 * and /reload, and setText collapses those native paths again.
 */
export class ClipboardImageEditor extends CustomEditor {
  private readonly imagePaths = new Map<string, string>();
  private pendingEmptyPaste = "";
  private clipboardPending = false;
  private disposed = false;
  private readonly queuedInput: string[] = [];

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly clipboardOptions: ClipboardOptions = {},
  ) {
    super(tui, theme, keybindings);
    this.onPasteImage = () => { void this.pasteClipboard(); };
  }

  disposeClipboard(): void {
    this.disposed = true;
    this.queuedInput.length = 0;
  }

  private async pasteClipboard(): Promise<void> {
    if (this.clipboardPending || this.disposed) return;
    this.clipboardPending = true;
    try {
      const content = await (this.clipboardOptions.read ?? readClipboardContent)();
      if (this.disposed || !content) return;
      if (content.type === "image") {
        // Match Pi's native path format, but keep clipboard files private. Like
        // Pi, leave them in the OS temp directory for subsequent read-tool use.
        const path = join(tmpdir(), `pi-clipboard-${randomUUID()}.${content.extension}`);
        await writeFile(path, content.bytes, { mode: 0o600, flag: "wx" });
        if (this.disposed) await unlink(path);
        else this.insertTextAtCursor(path);
      } else {
        // Like native Ctrl+V, insert text directly. Replaying clipboard text as
        // terminal input would allow embedded paste delimiters to execute keys.
        this.insertTextAtCursor(content.text);
      }
    } catch {
      if (!this.disposed) this.clipboardOptions.reportError?.("paste");
    } finally {
      this.clipboardPending = false;
      if (!this.disposed) {
        this.tui.requestRender();
        for (const chunk of this.queuedInput.splice(0)) this.handleInput(chunk);
      }
    }
  }

  private collapseImages(text: string): string {
    return text.replace(clipboardPathPattern, (path) => {
      let marker = this.imagePaths.get(path);
      if (!marker) {
        marker = `[img #${this.imagePaths.size + 1}]`;
        this.imagePaths.set(path, marker);
      }
      return marker;
    });
  }

  private expandImages(text: string): string {
    const paths = new Map([...this.imagePaths].map(([path, marker]) => [marker, path]));
    return text.replace(/\[img #\d+\]/g, (marker) => paths.get(marker) ?? marker);
  }

  override getText(): string {
    return this.expandImages(super.getText());
  }

  override getExpandedText(): string {
    return this.expandImages(super.getExpandedText());
  }

  override setText(text: string): void {
    super.setText(this.collapseImages(text));
  }

  override insertTextAtCursor(text: string): void {
    let collapsed = this.collapseImages(text);
    if (collapsed !== text && /^\[img #\d+\]$/.test(collapsed)) {
      const { line, col } = this.getCursor();
      const current = this.getLines()[line] ?? "";
      const before = current.slice(0, col);
      const after = current.slice(col);
      // Keep consecutive clipboard paths and adjacent prose separate on submit.
      collapsed = `${before && !/\s$/.test(before) ? " " : ""}${collapsed}${/^\s/.test(after) ? "" : " "}`;
    }
    super.insertTextAtCursor(collapsed);
  }

  override addToHistory(text: string): void {
    super.addToHistory(this.collapseImages(text));
  }

  override handleInput(data: string): void {
    if (this.disposed) return;
    // Preserve paste → typing/Enter order, even when clipboard reads are async.
    if (this.clipboardPending) {
      this.queuedInput.push(data);
      return;
    }
    // Alacritty's Cmd+V sends this even for an image-only pasteboard. Herdr
    // forwards it locally. OMP handles it as image paste; Pi drops it. The TUI
    // assembles start markers, but accept a split end marker as well. Never
    // inspect the clipboard for nonempty text pastes (including whitespace).
    if (this.pendingEmptyPaste || data.startsWith(PASTE_START)) {
      const pending = this.pendingEmptyPaste + data;
      this.pendingEmptyPaste = "";
      if (pending.startsWith(EMPTY_PASTE)) {
        this.onPasteImage?.();
        const remaining = pending.slice(EMPTY_PASTE.length);
        if (remaining) this.handleInput(remaining);
        return;
      }
      if (EMPTY_PASTE.startsWith(pending)) {
        this.pendingEmptyPaste = pending;
        return;
      }
      data = pending;
    }
    this.handleEditorInput(data);
  }

  private async copyClearedDraft(text: string): Promise<void> {
    try {
      await (this.clipboardOptions.write ?? copyToClipboard)(text);
    } catch {
      if (!this.disposed) this.clipboardOptions.reportError?.("copy");
    }
  }

  protected handleEditorInput(data: string): void {
    // Pi copies app handlers directly into this map when mounting the editor.
    // Wrap the routed action, not the raw key: remaps and shortcut/history
    // precedence still work, and a second Ctrl+C still uses Pi's exit timing.
    const clear = this.actionHandlers.get("app.clear");
    if (clear) this.actionHandlers.set("app.clear", () => {
      const draft = this.getExpandedText();
      clear();
      if (draft && this.getText() === "") void this.copyClearedDraft(draft);
    });
    // Editor.submitValue expands its own large-paste markers directly rather
    // than using getExpandedText. Expand our display chips at that same UI
    // boundary; app actions (Alt+Enter, external editor, copy) use the getter.
    const onSubmit = this.onSubmit;
    if (onSubmit) this.onSubmit = (text) => onSubmit(this.expandImages(text));
    try {
      super.handleInput(data);
    } finally {
      this.onSubmit = onSubmit;
      if (clear) this.actionHandlers.set("app.clear", clear);
    }
  }
}

export class VimNavigationEditor extends ClipboardImageEditor {
  private mode: VimNavigationMode = "insert";
  private readonly baseBindings: KeybindingsConfig;
  private readonly normalBindings: KeybindingsConfig;
  private readonly navigationKeybindings: KeybindingsManager;
  private warnedAboutRegularMode = false;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly onRegularModeNavigation?: () => void,
    clipboardOptions: ClipboardOptions = {},
  ) {
    super(tui, theme, keybindings, clipboardOptions);
    this.navigationKeybindings = keybindings;
    this.baseBindings = keybindings.getUserBindings();
    this.normalBindings = addViewportBindings(keybindings, this.baseBindings);
  }

  getMode(): VimNavigationMode {
    return this.mode;
  }

  restoreKeybindings(): void {
    if (this.mode === "normal") {
      this.navigationKeybindings.setUserBindings(this.baseBindings);
      this.mode = "insert";
    }
  }

  private enterNormalMode(): void {
    this.mode = "normal";
    this.navigationKeybindings.setUserBindings(this.normalBindings);
  }

  private enterInsertMode(): void {
    this.restoreKeybindings();
  }

  private isViewportNavigation(data: string): boolean {
    return VIEWPORT_BINDINGS.some(([action]) =>
      this.navigationKeybindings.matches(data, action),
    );
  }

  protected override handleEditorInput(data: string): void {
    // Ctrl+[ mirrors Esc for entering normal mode. Legacy terminals send it
    // as a bare ESC byte (handled by the escape branch below); this branch
    // covers the distinct Kitty-protocol report. Unlike Esc it never falls
    // through to interrupt, so it is a no-op when already in normal mode.
    if (matchesKey(data, "ctrl+[") && !matchesKey(data, "escape")) {
      if (this.mode === "insert" && !this.isShowingAutocomplete()) {
        this.enterNormalMode();
      }
      return;
    }

    if (matchesKey(data, "escape")) {
      if (this.mode === "insert" && !this.isShowingAutocomplete()) {
        this.enterNormalMode();
        return;
      }

      super.handleEditorInput(data);
      return;
    }

    if (this.mode === "insert") {
      super.handleEditorInput(data);
      return;
    }

    if (data === "i" || data === "a") {
      this.enterInsertMode();
      return;
    }

    // These are common ways to start editing a prompt from the transcript
    // view. Leave normal mode, then preserve the key's native editor action:
    // slash starts a slash command and Delete/backspace edits the draft.
    if (matchesKey(data, "/") || matchesKey(data, "delete") || matchesKey(data, "backspace")) {
      this.enterInsertMode();
      super.handleEditorInput(data);
      return;
    }

    // Fullscreen Pi consumes these bindings before they reach the editor. Keep
    // them from falling through to editor/app actions if regular mode was
    // explicitly requested, where there is no application-owned transcript.
    if (this.isViewportNavigation(data)) {
      if (this.tui.mode !== "fullscreen" && !this.warnedAboutRegularMode) {
        this.warnedAboutRegularMode = true;
        this.onRegularModeNavigation?.();
      }
      return;
    }

    // Normal mode ignores unbound printable input instead of editing the draft.
    if (data.length === 1 && data.charCodeAt(0) >= 32) return;

    super.handleEditorInput(data);
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (lines.length === 0) return lines;

    const label = this.mode === "normal" ? " NORMAL " : " INSERT ";
    const last = lines.length - 1;
    if (visibleWidth(lines[last]!) >= label.length) {
      lines[last] = `${truncateToWidth(lines[last]!, width - label.length, "")}${label}`;
    }
    return lines;
  }
}

export default function vimNavigation(pi: ExtensionAPI): void {
  let editor: VimNavigationEditor | undefined;

  pi.registerMarkdownTransformer((markdown, { messageType }) => {
    if (messageType !== "user") return markdown;
    let number = 0;
    const markers = new Map<string, string>();
    return markdown.replace(clipboardPathPattern, (path) => {
      if (!markers.has(path)) markers.set(path, `[img #${++number}]`);
      return markers.get(path)!;
    });
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      editor = new VimNavigationEditor(
        tui, theme, keybindings,
        () => ctx.ui.notify(
          "Vim transcript navigation requires fullscreen mode; restart Pi without --tui-mode regular",
          "warning",
        ),
        { reportError: (operation) => ctx.ui.notify(`Clipboard ${operation} failed; check Pi's clipboard support`, "warning") },
      );
      return editor;
    });
  });

  pi.on("session_shutdown", () => {
    editor?.restoreKeybindings();
    editor?.disposeClipboard();
    editor = undefined;
  });
}
