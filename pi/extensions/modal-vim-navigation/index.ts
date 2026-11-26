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
  decodeKittyPrintable,
  matchesKey,
  visibleWidth,
  type AutocompleteProvider,
  type EditorTheme,
  type TUI,
} from "@earendil-works/pi-tui";
import { changeCase, Draft, isBracketObject, type FindKind, type Pos, type Range } from "./draft";

export type VimNavigationMode = "insert" | "normal" | "visual" | "visual-line";

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
  /** Last change to a submitted draft before Pi sees it (the /copy alias). */
  rewriteSubmit: (text: string) => string = (text) => text;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly clipboardOptions: ClipboardOptions = {},
  ) {
    super(tui, theme, keybindings);
    this.onPasteImage = () => { this.pasteClipboard(); };
  }

  disposeClipboard(): void {
    this.disposed = true;
    this.queuedInput.length = 0;
  }

  /**
   * Read the clipboard, then apply it before any input typed meanwhile, which
   * waits in a queue. With `fallback`, a failed read applies `undefined`.
   */
  protected withClipboard(apply: (content: ClipboardContent) => Promise<void> | void, fallback = false): void {
    if (this.clipboardPending || this.disposed) return;
    this.clipboardPending = true;
    void (async () => {
      try {
        let content: ClipboardContent;
        try {
          content = await (this.clipboardOptions.read ?? readClipboardContent)();
        } catch (error) {
          if (!fallback) throw error;
          content = undefined;
        }
        if (!this.disposed) await apply(content);
      } catch {
        if (!this.disposed) this.clipboardOptions.reportError?.("paste");
      } finally {
        this.clipboardPending = false;
        if (!this.disposed) {
          this.clipboardApplied();
          this.tui.requestRender();
          for (const chunk of this.queuedInput.splice(0)) this.handleInput(chunk);
        }
      }
    })();
  }

  /** Called after a clipboard read was applied, before queued input runs. */
  protected clipboardApplied(): void {}

  private pasteClipboard(): void {
    this.withClipboard(async (content) => {
      if (content?.type === "image") await this.insertClipboardImage(content);
      // Like native Ctrl+V, insert text directly. Replaying clipboard text as
      // terminal input would allow embedded paste delimiters to execute keys.
      else if (content) this.insertTextAtCursor(content.text);
    });
  }

  protected async insertClipboardImage(content: { bytes: Uint8Array; extension: string }): Promise<void> {
    // Match Pi's native path format, but keep clipboard files private. Like
    // Pi, leave them in the OS temp directory for subsequent read-tool use.
    const path = join(tmpdir(), `pi-clipboard-${randomUUID()}.${content.extension}`);
    await writeFile(path, content.bytes, { mode: 0o600, flag: "wx" });
    if (this.disposed) await unlink(path);
    else this.insertTextAtCursor(path);
  }

  protected collapseImages(text: string): string {
    return text.replace(clipboardPathPattern, (path) => {
      let marker = this.imagePaths.get(path);
      if (!marker) {
        marker = `[img #${this.imagePaths.size + 1}]`;
        this.imagePaths.set(path, marker);
      }
      return marker;
    });
  }

  protected expandImages(text: string): string {
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

  protected async writeClipboard(text: string): Promise<void> {
    try {
      await (this.clipboardOptions.write ?? copyToClipboard)(text);
    } catch {
      if (!this.disposed) this.clipboardOptions.reportError?.("copy");
    }
  }

  /** Called when a draft is submitted, before Pi receives it. */
  protected submitted(): void {}

  protected handleEditorInput(data: string): void {
    // Pi copies app handlers directly into this map when mounting the editor.
    // Wrap the routed action, not the raw key: remaps and shortcut/history
    // precedence still work, and a second Ctrl+C still uses Pi's exit timing.
    const clear = this.actionHandlers.get("app.clear");
    if (clear) this.actionHandlers.set("app.clear", () => {
      const draft = this.getExpandedText();
      clear();
      if (draft && this.getText() === "") void this.writeClipboard(draft);
    });
    // Editor.submitValue expands its own large-paste markers directly rather
    // than using getExpandedText. Expand our display chips at that same UI
    // boundary; app actions (Alt+Enter, external editor, copy) use the getter.
    const onSubmit = this.onSubmit;
    if (onSubmit) this.onSubmit = (text) => {
      this.submitted();
      onSubmit(this.rewriteSubmit(this.expandImages(text)));
    };
    try {
      super.handleInput(data);
    } finally {
      this.onSubmit = onSubmit;
      if (clear) this.actionHandlers.set("app.clear", clear);
    }
  }
}

/**
 * Pi editor internals this editor drives (pi-tui's Editor). They are private
 * in Pi's types, so a Pi upgrade can move them; the tests exercise every one.
 */
interface EditorInternals {
  state: { lines: string[]; cursorLine: number; cursorCol: number };
  undoStack: { stack: unknown[]; length: number };
  pastes: Map<number, string>;
  pasteCounter: number;
  lastAction: string | null;
  preferredVisualCol: number | null;
  scrollOffset: number;
  lastWidth: number;
  renderedVisibleLineCount: number;
  isInPaste: boolean;
  jumpMode: unknown;
  pushUndoSnapshot(): void;
  undo(): void;
  moveCursor(deltaLine: number, deltaCol: number): void;
  isOnFirstVisualLine(): boolean;
  isOnLastVisualLine(): boolean;
  buildVisualLineMap(width: number): Array<{ logicalLine: number; startCol: number; length: number }>;
  segment(text: string, mode: "grapheme"): Iterable<{ index: number; segment: string }>;
  setCursorCol(col: number): void;
  exitHistoryBrowsing(): void;
  cancelAutocomplete(): void;
  expandPasteMarkers(text: string): string;
}

/** Pi's fullscreen renderer (TuiAltScreen); scrollToPrompt and getPrimaryScrollView are private. */
interface ViewportTui {
  mode: string;
  terminal: { rows: number; write?(data: string): void };
  isFollowingOutput?: boolean;
  scrollBy?(lines: number): void;
  scrollToTop?(): void;
  scrollToBottom?(): void;
  scrollToPrompt?(direction: 1 | -1): void;
  getPrimaryScrollView?(): { viewportHeight: number } | undefined;
  setShowHardwareCursor?(enabled: boolean): void;
}

interface Snapshot {
  state: EditorInternals["state"];
  pastes: Map<number, string>;
  pasteCounter: number;
}

type Operator = "d" | "c" | "y" | "g~" | "gu" | "gU";
type MotionType = "exclusive" | "inclusive" | "linewise";
interface Motion {
  target: number;
  type: MotionType;
  key: string;
}
interface Pending {
  count: string;
  operatorCount: string;
  operator?: Operator;
  g?: boolean;
  char?: FindKind | "r";
  object?: "i" | "a";
}

/** DECSCUSR shapes: steady bar, block and underline, as zsh-vi-mode uses. */
export const CURSOR_SHAPES = {
  insert: "\x1b[6 q",
  normal: "\x1b[2 q",
  pending: "\x1b[4 q",
  reset: "\x1b[0 q",
} as const;

const OPERATORS = new Set(["d", "c", "y", "g~", "gu", "gU"]);
const CASE_OPERATORS = { "g~": "toggle", gu: "lower", gU: "upper" } as const;
const TERMINAL_ESCAPE = /\x1b_[^\x07]*\x07|\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/y;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const emptyPending = (): Pending => ({ count: "", operatorCount: "" });

const NAMED_KEYS = [
  ["escape", "<esc>"], ["ctrl+[", "<c-[>"], ["backspace", "<bs>"], ["delete", "<del>"],
  ["ctrl+d", "<c-d>"], ["ctrl+u", "<c-u>"], ["ctrl+f", "<c-f>"], ["ctrl+b", "<c-b>"],
  ["ctrl+e", "<c-e>"], ["ctrl+y", "<c-y>"], ["ctrl+r", "<c-r>"],
] as const;

/** One Vim key: a printable grapheme, or a name such as `<esc>` and `<c-d>`. */
function decodeKey(data: string): string | undefined {
  for (const [id, name] of NAMED_KEYS) if (matchesKey(data, id)) return name;
  if (/^[^\x00-\x1f\x7f]+$/u.test(data)) return data;
  return decodeKittyPrintable(data);
}

const isNamedKey = (key: string) => key.length > 2 && key.startsWith("<") && key.endsWith(">");

/** Apply `style` to the cells [from, to) of a rendered line, keeping its escape sequences intact. */
function styleColumns(row: string, from: number, to: number, style: (text: string) => string): string {
  let output = "";
  let run = "";
  let column = 0;
  let index = 0;
  const flush = () => {
    if (run) output += style(run);
    run = "";
  };
  while (index < row.length) {
    TERMINAL_ESCAPE.lastIndex = index;
    const escape = row[index] === "\x1b" ? TERMINAL_ESCAPE.exec(row) : null;
    if (escape) {
      flush();
      output += escape[0];
      index += escape[0].length;
      continue;
    }
    let end = row.indexOf("\x1b", index + 1);
    if (end < 0) end = row.length;
    for (const { segment } of graphemes.segment(row.slice(index, end))) {
      if (column >= from && column < to) run += segment;
      else {
        flush();
        output += segment;
      }
      column += visibleWidth(segment);
    }
    index = end;
  }
  flush();
  return output;
}

/**
 * Vim editing for Pi's prompt, plus transcript scrolling with the same keys.
 * The terminal cursor shows the mode: a bar while inserting, a block in normal
 * and visual mode, an underline while an operator waits for its motion.
 */
export class VimNavigationEditor extends ClipboardImageEditor {
  private mode: VimNavigationMode = "insert";
  private pending: Pending = emptyPending();
  /** Visual-mode anchor, as an offset into the draft. */
  private anchor = 0;
  private lastFind?: { kind: FindKind; char: string };
  /** Neovim's unnamed register; also written to the system clipboard (clipboard=unnamedplus). */
  private register = { text: "", linewise: false };
  private readonly redoStack: Snapshot[] = [];
  /** Undo depth when insert mode began: one insert session undoes as one step. */
  private insertUndoBase = 0;
  /** Keys of the command being typed, the change being recorded, and the last change for `.`. */
  private commandKeys: string[] = [];
  private isChange = false;
  private recording?: string[];
  private lastChange: string[] = [];
  private replaying = false;
  private warnedAboutRegularMode = false;
  private shape?: string;
  private closed = false;
  /** Visual selection style; the extension uses the theme's selection background. */
  selectionStyle: (text: string) => string = (text) => `\x1b[7m${text}\x1b[27m`;

  constructor(
    tui: TUI,
    theme: EditorTheme,
    keybindings: KeybindingsManager,
    private readonly onRegularModeNavigation?: () => void,
    clipboardOptions: ClipboardOptions = {},
  ) {
    super(tui, theme, keybindings, clipboardOptions);
    // The terminal draws the cursor, so its shape can show the mode. Pi's own
    // reverse-video cursor cannot change shape.
    this.view.setShowHardwareCursor?.(true);
    // Pi sets `focused` when focus moves to a dialog and back; the dialog's
    // input gets a bar cursor even while this prompt is in normal mode.
    let focused = this.focused;
    Object.defineProperty(this, "focused", {
      configurable: true,
      enumerable: true,
      get: () => focused,
      set: (value: boolean) => {
        focused = value;
        this.syncCursorShape();
      },
    });
  }

  getMode(): VimNavigationMode {
    return this.mode;
  }

  /** Reset the terminal cursor and stop clipboard work; the editor is going away. */
  dispose(): void {
    if (this.shape !== undefined && !this.closed) this.view.terminal.write?.(CURSOR_SHAPES.reset);
    this.closed = true;
    this.disposeClipboard();
  }

  private get internals(): EditorInternals {
    return this as unknown as EditorInternals;
  }

  private get view(): ViewportTui {
    return this.tui as unknown as ViewportTui;
  }

  private syncCursorShape(): void {
    // Pi moves focus off a replaced editor after shutdown: leave the reset alone.
    if (this.closed) return;
    let shape: string = CURSOR_SHAPES.insert;
    if (this.focused && this.mode !== "insert") {
      shape = this.pending.operator || this.pending.char === "r" ? CURSOR_SHAPES.pending : CURSOR_SHAPES.normal;
    }
    if (shape === this.shape) return;
    this.shape = shape;
    this.view.terminal.write?.(shape);
  }

  private setMode(mode: VimNavigationMode): void {
    this.mode = mode;
    this.syncCursorShape();
  }

  override setText(text: string): void {
    const cleared = text === "" && this.getLines().join("\n") !== "";
    super.setText(text);
    // Ctrl+C and Alt+Enter empty the prompt through setText.
    if (cleared) this.newPrompt();
    else this.clampCursor();
  }

  protected override submitted(): void {
    this.newPrompt();
  }

  protected override clipboardApplied(): void {
    this.clampCursor();
  }

  /** A new prompt starts in insert mode, as with zsh-vi-mode. */
  private newPrompt(): void {
    this.pending = emptyPending();
    this.commandKeys = [];
    this.recording = undefined;
    this.redoStack.length = 0;
    this.insertUndoBase = this.internals.undoStack.length;
    this.setMode("insert");
  }

  override render(width: number): string[] {
    const lines = super.render(width);
    if (this.mode !== "visual" && this.mode !== "visual-line") return lines;
    return this.highlightSelection(lines, width);
  }

  protected override handleEditorInput(data: string): void {
    try {
      this.dispatch(data);
    } finally {
      this.syncCursorShape();
    }
  }

  private dispatch(data: string): void {
    const internals = this.internals;
    // Bracketed pastes and Pi's own Ctrl+] character jump keep their editor behaviour.
    if (internals.isInPaste || data.startsWith(PASTE_START) || internals.jumpMode !== null) {
      if (this.mode !== "insert") this.leaveVisual();
      this.passThrough(data);
      return;
    }
    if (this.mode === "insert") {
      this.insertKey(data);
      return;
    }
    const key = decodeKey(data);
    // Several printable keys in one read: handle each one, as typed.
    if (key !== undefined && !isNamedKey(key) && data === key) {
      const keys = [...graphemes.segment(key)].map(({ segment }) => segment);
      if (keys.length > 1) {
        for (const single of keys) this.handleEditorInput(single);
        return;
      }
    }
    if (!this.replaying) this.commandKeys.push(data);
    this.commandKey(key, data);
    this.finishCommand();
  }

  private passThrough(data: string): void {
    super.handleEditorInput(data);
  }

  // ---------------------------------------------------------------- insert

  private insertKey(data: string): void {
    const escape = matchesKey(data, "escape");
    const ctrlBracket = !escape && matchesKey(data, "ctrl+[");
    if (escape || ctrlBracket) {
      // Escape closes an open autocomplete menu first. Ctrl+[ (a separate key
      // with the Kitty protocol) never reaches Pi's interrupt.
      if (this.isShowingAutocomplete()) {
        if (escape) this.passThrough(data);
        return;
      }
      this.leaveInsert(data);
      return;
    }
    if (!this.replaying) this.recording?.push(data);
    this.passThrough(data);
  }

  private startInsert(offset: number, undoBase = this.internals.undoStack.length): void {
    this.isChange = true;
    this.setCursor(this.draft().pos(offset));
    this.insertUndoBase = undoBase;
    this.setMode("insert");
  }

  private leaveInsert(data: string): void {
    const internals = this.internals;
    const stack = internals.undoStack;
    if (stack.length > this.insertUndoBase + 1) stack.stack.length = this.insertUndoBase + 1;
    if (stack.length > this.insertUndoBase) this.redoStack.length = 0;
    if (this.recording && !this.replaying) this.lastChange = [...this.recording, data];
    this.recording = undefined;
    this.setMode("normal");
    // Like Vim, the cursor steps back onto the last inserted character.
    const { cursorLine, cursorCol } = internals.state;
    if (cursorCol > 0) {
      const before = [...internals.segment((internals.state.lines[cursorLine] ?? "").slice(0, cursorCol), "grapheme")];
      internals.setCursorCol(cursorCol - (before.at(-1)?.segment.length ?? 1));
    }
  }

  // --------------------------------------------------------------- commands

  private hasPending(): boolean {
    const pending = this.pending;
    return Boolean(pending.count || pending.operatorCount || pending.operator || pending.g || pending.char || pending.object);
  }

  private finishCommand(): void {
    if (this.hasPending()) return;
    const keys = this.commandKeys;
    const isChange = this.isChange;
    this.commandKeys = [];
    this.isChange = false;
    if (this.replaying || !isChange) return;
    if (this.mode === "insert") this.recording = keys;
    else this.lastChange = keys;
  }

  private cancelPending(): void {
    this.pending = emptyPending();
    this.commandKeys = [];
    this.isChange = false;
  }

  private count(): number {
    const { count, operatorCount } = this.pending;
    return (Number(operatorCount) || 1) * (Number(count) || 1);
  }

  private hasCount(): boolean {
    return Boolean(this.pending.count || this.pending.operatorCount);
  }

  private commandKey(key: string | undefined, data: string): void {
    const visual = this.mode === "visual" || this.mode === "visual-line";
    if (key === "<esc>" || key === "<c-[>") {
      if (this.hasPending()) return this.cancelPending();
      if (visual) return this.leaveVisual();
      this.commandKeys = [];
      // Escape in normal mode is Pi's: interrupt, or double Escape for /tree.
      if (key === "<esc>") this.passThrough(data);
      return;
    }
    // Keys Vim does not use here (Enter, arrows, Tab, Ctrl+C, ...) are Pi's.
    if (key === undefined) {
      this.cancelPending();
      if (visual) this.leaveVisual();
      this.passThrough(data);
      if (this.mode === "normal") this.clampCursor();
      return;
    }
    const pending = this.pending;
    if (pending.char) {
      const kind = pending.char;
      pending.char = undefined;
      if (isNamedKey(key)) return this.cancelPending();
      if (kind === "r") return this.replaceChars(key);
      this.lastFind = { kind, char: key };
      return this.runMotion(this.findMotion(kind, key, this.count(), false));
    }
    if (pending.object) {
      const around = pending.object === "a";
      pending.object = undefined;
      const range = this.textObject(key, around);
      if (!range) return this.cancelPending();
      if (visual) return this.selectObject(range);
      const operator = pending.operator!;
      pending.operator = undefined;
      pending.count = pending.operatorCount = "";
      return this.applyOperator(operator, range);
    }
    if (pending.g) {
      pending.g = false;
      key = `g${key}`;
    } else if (key === "g") {
      pending.g = true;
      return;
    }
    if (/^[1-9]$/.test(key) || (key === "0" && pending.count !== "")) {
      pending.count += key;
      return;
    }
    if (visual) {
      // Visual changes are not repeated with `.`.
      this.visualCommand(key);
      this.isChange = false;
      return;
    }
    if (pending.operator) return this.operatorKey(key);
    this.normalCommand(key, data);
  }

  private normalCommand(key: string, data: string): void {
    const count = this.count();
    const hasCount = this.hasCount();
    const draft = this.draft();
    const cursor = this.cursorOffset(draft);
    const index = draft.indexAt(cursor);
    const line = draft.pos(cursor).line;
    this.pending = emptyPending();
    if (OPERATORS.has(key)) {
      this.pending.operator = key as Operator;
      this.pending.operatorCount = hasCount ? String(count) : "";
      return;
    }
    switch (key) {
      case "i":
        return this.startInsert(cursor);
      case "a":
        return this.startInsert(draft.offsetOf(Math.min(draft.lineEnd(line), index + 1)));
      case "I":
        return this.startInsert(draft.offsetOf(draft.firstNonBlank(line)));
      case "A":
        return this.startInsert(draft.offset({ line, col: Infinity }));
      case "o":
      case "O": {
        const undoBase = this.internals.undoStack.length;
        const at = key === "o" ? line + 1 : line;
        this.edit([...draft.lines.slice(0, at), "", ...draft.lines.slice(at)], { line: at, col: 0 });
        return this.startInsert(this.draft().offset({ line: at, col: 0 }), undoBase);
      }
      case "v":
      case "V":
        this.anchor = cursor;
        return this.setMode(key === "V" ? "visual-line" : "visual");
      case "x":
      case "<del>":
        return this.operateMotion("d", "l", count);
      case "X":
        return this.operateMotion("d", "h", count);
      case "s":
        return this.operateMotion("c", "l", count);
      case "S":
        return this.applyOperator("c", { kind: "lines", first: line, last: Math.min(draft.lastLine, line + count - 1) });
      case "D":
      case "C":
      case "Y":
        return this.operateMotion(key === "D" ? "d" : key === "C" ? "c" : "y", "$", count);
      case "r":
        this.pending.char = "r";
        this.pending.count = hasCount ? String(count) : "";
        return;
      case "~":
        return this.toggleCaseChars(count);
      case "p":
      case "P":
        this.isChange = true;
        return this.put(key === "P", count);
      case "u":
        return this.undoChanges(count);
      case "<c-r>":
        return this.redoChanges(count);
      case ".":
        return this.repeatChange(count);
      case "/":
        // Slash still starts a slash command, as before.
        this.setMode("insert");
        this.insertUndoBase = this.internals.undoStack.length;
        this.passThrough(data);
        return;
      case "j":
      case "k":
        return this.lineOrTranscript(key === "j" ? 1 : -1, count);
      case "gg":
      case "G":
        return this.goToLine(key, count, hasCount);
      case "J":
      case "K":
        return this.withViewport((view) => {
          for (let step = 0; step < count; step++) view.scrollToPrompt?.(key === "J" ? 1 : -1);
        });
      default:
        this.moveOrScroll(key, count, hasCount);
    }
  }

  private moveOrScroll(key: string, count: number, hasCount: boolean): void {
    if (this.scrollKey(key, count)) return;
    const motion = this.motion(key, count, hasCount);
    if (motion === "pending") return this.awaitChar(key as FindKind, count, hasCount);
    this.runMotion(motion);
  }

  private awaitChar(kind: FindKind, count: number, hasCount: boolean, operator?: Operator): void {
    this.pending = { ...emptyPending(), char: kind, count: hasCount ? String(count) : "", operator };
  }

  private visualCommand(key: string): void {
    const count = this.count();
    const hasCount = this.hasCount();
    const draft = this.draft();
    const selection = this.selection(draft);
    const lines = this.linesOf(draft, selection);
    this.pending = emptyPending();
    switch (key) {
      case "v":
      case "V": {
        const mode = key === "V" ? "visual-line" : "visual";
        return this.mode === mode ? this.leaveVisual() : this.setMode(mode);
      }
      case "o": {
        const cursor = this.cursorOffset(draft);
        this.setCursor(draft.pos(this.anchor));
        this.anchor = cursor;
        return;
      }
      case "i":
      case "a":
        this.pending.object = key;
        return;
      case "d":
      case "x":
      case "<del>":
      case "c":
      case "s":
      case "y":
        this.setMode("normal");
        return this.applyOperator(key === "c" || key === "s" ? "c" : key === "y" ? "y" : "d", selection);
      case "D":
      case "X":
      case "C":
      case "S":
      case "R":
      case "Y":
        this.setMode("normal");
        return this.applyOperator("CSR".includes(key) ? "c" : key === "Y" ? "y" : "d", lines);
      case "~":
      case "u":
      case "U":
      case "g~":
      case "gu":
      case "gU":
        this.setMode("normal");
        return this.applyOperator(key.length === 2 ? (key as Operator) : key === "~" ? "g~" : key === "u" ? "gu" : "gU", selection);
      case "p":
      case "P":
        this.setMode("normal");
        return this.put(false, count, selection);
      case "j":
      case "k":
        for (let step = 0; step < count; step++) this.internals.moveCursor(key === "j" ? 1 : -1, 0);
        return this.clampCursor();
      default:
        this.moveOrScroll(key, count, hasCount);
    }
  }

  private operatorKey(key: string): void {
    const operator = this.pending.operator!;
    const count = this.count();
    const hasCount = this.hasCount();
    if (key === operator || key === operator.slice(-1)) {
      const line = this.draft().pos(this.cursorOffset()).line;
      this.pending = emptyPending();
      return this.applyOperator(operator, { kind: "lines", first: line, last: Math.min(this.draft().lastLine, line + count - 1) });
    }
    if (key === "i" || key === "a") {
      this.pending.object = key;
      return;
    }
    this.operateMotion(operator, key, count, hasCount);
  }

  private operateMotion(operator: Operator, key: string, count: number, hasCount = false): void {
    const motion = this.motion(key, count, hasCount, operator === "c");
    if (motion === "pending") return this.awaitChar(key as FindKind, count, hasCount, operator);
    this.pending = emptyPending();
    if (!motion) return;
    const range = this.motionRange(motion);
    if (range) this.applyOperator(operator, range);
  }

  // ---------------------------------------------------------------- motions

  /** A motion's target, or "pending" while `f` `t` `F` `T` wait for their character. */
  private motion(key: string, count: number, hasCount: boolean, forChange = false): Motion | "pending" | undefined {
    const draft = this.draft();
    const cursor = this.cursorOffset(draft);
    const index = draft.indexAt(cursor);
    const line = draft.pos(cursor).line;
    const exclusive = (at: number): Motion => ({ target: draft.offsetOf(at), type: "exclusive", key });
    const inclusive = (at: number): Motion => ({ target: draft.offsetOf(at), type: "inclusive", key });
    const linewise = (to: number): Motion => {
      const target = Math.max(0, Math.min(draft.lastLine, to));
      return { target: draft.offsetOf(draft.firstNonBlank(target)), type: "linewise", key };
    };
    switch (key) {
      case "h":
      case "<bs>":
        return exclusive(Math.max(draft.lineStart(line), index - count));
      case "l":
      case " ":
        return exclusive(Math.min(draft.lineEnd(line), index + count));
      case "0":
        return exclusive(draft.lineStart(line));
      case "^":
        return exclusive(draft.firstNonBlank(line));
      case "$": {
        const last = Math.min(draft.lastLine, line + count - 1);
        if (draft.lines[last] === "") return exclusive(draft.lineStart(last));
        return inclusive(draft.lastChar(last));
      }
      case "w":
      case "W": {
        const bigWord = key === "W";
        if (forChange && draft.cls(index, bigWord) !== 0) {
          // `cw` changes to the end of the word, like `ce`, but never into the next one.
          let end = index;
          const kind = draft.cls(index, bigWord);
          while (end + 1 < draft.lineEnd(line) && draft.cls(end + 1, bigWord) === kind) end++;
          return inclusive(count > 1 ? draft.wordEnd(end, bigWord, count - 1) : end);
        }
        return exclusive(draft.wordForward(index, bigWord, count));
      }
      case "b":
      case "B":
        return exclusive(draft.wordBackward(index, key === "B", count));
      case "e":
      case "E":
        return inclusive(draft.wordEnd(index, key === "E", count));
      case "ge":
      case "gE":
        return inclusive(draft.wordEndBackward(index, key === "gE", count));
      case "f":
      case "F":
      case "t":
      case "T":
        return "pending";
      case ";":
      case ",": {
        if (!this.lastFind) return undefined;
        const { kind, char } = this.lastFind;
        const reverse = { f: "F", F: "f", t: "T", T: "t" } as const;
        return this.findMotion(key === ";" ? kind : reverse[kind], char, count, true);
      }
      case "j":
      case "k":
        return linewise(line + (key === "j" ? count : -count));
      case "G":
        return linewise(hasCount ? count - 1 : draft.lastLine);
      case "gg":
        return linewise(hasCount ? count - 1 : 0);
      case "}":
        return { target: draft.offset(draft.paragraphForward(line, count)), type: "exclusive", key };
      case "{":
        return { target: draft.offset(draft.paragraphBackward(line, count)), type: "exclusive", key };
      case "%": {
        const match = draft.matchBracket(index);
        return match === undefined ? undefined : inclusive(match);
      }
      default:
        return undefined;
    }
  }

  private findMotion(kind: FindKind, char: string, count: number, repeat: boolean): Motion | undefined {
    const draft = this.draft();
    const found = draft.find(draft.indexAt(this.cursorOffset(draft)), kind, char, count, repeat);
    if (found === undefined) return undefined;
    return { target: draft.offsetOf(found), type: kind === "f" || kind === "t" ? "inclusive" : "exclusive", key: kind };
  }

  /** Move the cursor, or finish a pending operator, with a computed motion. */
  private runMotion(motion: Motion | undefined): void {
    const operator = this.pending.operator;
    this.pending = emptyPending();
    if (!motion) return;
    if (operator) {
      const range = this.motionRange(motion);
      if (range) this.applyOperator(operator, range);
      return;
    }
    this.setCursor(this.draft().pos(motion.target));
    this.clampCursor();
  }

  /** The text an operator covers, with Vim's adjustments for exclusive motions. */
  private motionRange(motion: Motion): Range | undefined {
    const draft = this.draft();
    const cursor = this.cursorOffset(draft);
    if (motion.type === "linewise") {
      const from = draft.pos(cursor).line;
      const to = draft.pos(motion.target).line;
      return { kind: "lines", first: Math.min(from, to), last: Math.max(from, to) };
    }
    const start = Math.min(cursor, motion.target);
    let end = Math.max(cursor, motion.target);
    if (motion.type === "inclusive") return { kind: "chars", start, end: draft.after(end) };
    if (end === start) return undefined;
    const startPos = draft.pos(start);
    let endPos = draft.pos(end);
    // `dw` on a line's last word stops at the line end instead of joining lines.
    if ((motion.key === "w" || motion.key === "W") && endPos.line > startPos.line) {
      end = draft.offset({ line: endPos.line - 1, col: Infinity });
      endPos = draft.pos(end);
    }
    // An exclusive motion that ends at the start of a later line: `:help exclusive-linewise`.
    if (endPos.col === 0 && endPos.line > startPos.line) {
      const firstNonBlank = draft.pos(draft.offsetOf(draft.firstNonBlank(startPos.line))).col;
      if (startPos.col <= firstNonBlank) return { kind: "lines", first: startPos.line, last: endPos.line - 1 };
      end = draft.offset({ line: endPos.line - 1, col: Infinity });
    }
    return end > start ? { kind: "chars", start, end } : undefined;
  }

  private textObject(key: string, around: boolean): Range | undefined {
    const draft = this.draft();
    const cursor = this.cursorOffset(draft);
    const index = draft.indexAt(cursor);
    if (key === "w" || key === "W") return draft.wordObject(index, key === "W", around);
    if (key === '"' || key === "'" || key === "`") return draft.quoteObject(index, key, around);
    if (key === "p") return draft.paragraphObject(draft.pos(cursor).line, around);
    if (isBracketObject(key)) return draft.bracketObject(index, key, around);
    return undefined;
  }

  // -------------------------------------------------------------- editing

  private draft(): Draft {
    const internals = this.internals;
    return new Draft(this.getLines(), (text) => internals.segment(text, "grapheme"));
  }

  private cursorOffset(draft = this.draft()): number {
    const { cursorLine, cursorCol } = this.internals.state;
    return draft.offset({ line: cursorLine, col: cursorCol });
  }

  private setCursor(pos: Pos): void {
    this.internals.state.cursorLine = pos.line;
    this.internals.setCursorCol(pos.col);
  }

  /** Normal mode rests on a character, never past a line's end. Keeps Pi's sticky column. */
  private clampCursor(): void {
    if (this.mode === "insert") return;
    const draft = this.draft();
    const cursor = this.cursorOffset(draft);
    const clamped = draft.clampNormal(cursor);
    if (clamped !== cursor) this.internals.state.cursorCol = draft.pos(clamped).col;
  }

  /** Replace the draft as one undo step. */
  private edit(lines: string[], cursor: Pos): void {
    const internals = this.internals;
    internals.cancelAutocomplete();
    internals.exitHistoryBrowsing();
    internals.pushUndoSnapshot();
    this.redoStack.length = 0;
    internals.state.lines = lines.length > 0 ? lines : [""];
    this.setCursor(cursor);
    internals.lastAction = null;
    this.onChange?.(this.getText());
  }

  private editText(text: string, cursor: number): void {
    const lines = text.split("\n");
    this.edit(lines, new Draft(lines).pos(cursor));
  }

  private yankText(text: string, linewise: boolean): void {
    const expanded = this.expandImages(this.internals.expandPasteMarkers(text));
    this.register = { text: expanded, linewise };
    void this.writeClipboard(expanded);
  }

  private applyOperator(operator: Operator, range: Range): void {
    const draft = this.draft();
    if (range.kind === "chars" && range.end <= range.start && operator !== "c") return;
    const text = draft.textOf(range);
    if (operator === "y") {
      this.yankText(text, range.kind === "lines");
      const cursor = draft.pos(this.cursorOffset(draft));
      if (range.kind === "chars") this.setCursor(draft.pos(range.start));
      else if (range.first < cursor.line) this.setCursor({ line: range.first, col: cursor.col });
      return this.clampCursor();
    }
    this.isChange = true;
    if (operator === "g~" || operator === "gu" || operator === "gU") {
      const how = CASE_OPERATORS[operator];
      if (range.kind === "lines") {
        const cursor = draft.pos(this.cursorOffset(draft));
        const lines = draft.lines.map((line, index) => (index >= range.first && index <= range.last ? changeCase(line, how) : line));
        this.edit(lines, { line: range.first, col: range.first === cursor.line ? cursor.col : 0 });
      } else {
        this.editText(draft.text.slice(0, range.start) + changeCase(text, how) + draft.text.slice(range.end), range.start);
      }
      return this.clampCursor();
    }
    if (text) this.yankText(text, range.kind === "lines");
    const undoBase = this.internals.undoStack.length;
    if (range.kind === "chars") {
      this.editText(draft.text.slice(0, range.start) + draft.text.slice(range.end), range.start);
      if (operator === "c") return this.startInsert(range.start, undoBase);
      return this.clampCursor();
    }
    const before = draft.lines.slice(0, range.first);
    const after = draft.lines.slice(range.last + 1);
    if (operator === "c") {
      this.edit([...before, "", ...after], { line: range.first, col: 0 });
      return this.startInsert(this.draft().offset({ line: range.first, col: 0 }), undoBase);
    }
    const lines = [...before, ...after];
    const line = Math.min(range.first, Math.max(0, lines.length - 1));
    this.edit(lines, { line, col: 0 });
    const updated = this.draft();
    this.setCursor(updated.pos(updated.offsetOf(updated.firstNonBlank(line))));
  }

  private replaceChars(char: string): void {
    const count = this.count();
    this.pending = emptyPending();
    const draft = this.draft();
    const index = draft.indexAt(this.cursorOffset(draft));
    if (index + count > draft.lineEnd(draft.lineOf(index))) return;
    this.isChange = true;
    const start = draft.offsetOf(index);
    this.editText(draft.text.slice(0, start) + char.repeat(count) + draft.text.slice(draft.offsetOf(index + count)), start + (count - 1) * char.length);
  }

  private toggleCaseChars(count: number): void {
    const draft = this.draft();
    const index = draft.indexAt(this.cursorOffset(draft));
    const end = Math.min(draft.lineEnd(draft.lineOf(index)), index + count);
    if (end <= index) return;
    this.isChange = true;
    const start = draft.offsetOf(index);
    const changed = changeCase(draft.text.slice(start, draft.offsetOf(end)), "toggle");
    this.editText(draft.text.slice(0, start) + changed + draft.text.slice(draft.offsetOf(end)), start + changed.length);
    this.clampCursor();
  }

  /** `p` `P`, and `p` over a visual selection: from the system clipboard, like clipboard=unnamedplus. */
  private put(before: boolean, count: number, selection?: Range): void {
    this.withClipboard(async (content) => {
      try {
        if (content?.type === "image") {
          if (selection) this.applyOperator("d", selection);
          await this.insertClipboardImage(content);
          return;
        }
        let { text, linewise } = this.register;
        if (content?.type === "text") {
          linewise = content.text === text ? linewise : content.text.endsWith("\n");
          text = content.text;
        }
        if (text) this.applyPut(text, linewise, before, count, selection);
      } finally {
        // The put command already finished; nothing typed since may count as a change.
        this.isChange = false;
      }
    }, true);
  }

  private applyPut(text: string, linewise: boolean, before: boolean, count: number, selection?: Range): void {
    const draft = this.draft();
    const body = this.collapseImages(text);
    const block = Array<string>(count).fill(linewise && body.endsWith("\n") ? body.slice(0, -1) : body).join(linewise ? "\n" : "");
    const firstNonBlank = (lines: string[], line: number) => {
      const updated = new Draft(lines);
      return updated.pos(updated.offsetOf(updated.firstNonBlank(line)));
    };
    if (selection?.kind === "lines" || (!selection && linewise)) {
      let at = before ? draft.pos(this.cursorOffset(draft)).line : draft.pos(this.cursorOffset(draft)).line + 1;
      let kept = draft.lines;
      if (selection?.kind === "lines") {
        this.yankText(draft.textOf(selection), true);
        kept = [...draft.lines.slice(0, selection.first), ...draft.lines.slice(selection.last + 1)];
        at = selection.first;
      }
      const lines = [...kept.slice(0, at), ...block.split("\n"), ...kept.slice(at)];
      this.edit(lines, firstNonBlank(lines, at));
      return this.clampCursor();
    }
    let insertAt: number;
    let remaining = draft.text;
    if (selection) {
      this.yankText(draft.textOf(selection), false);
      remaining = draft.text.slice(0, selection.start) + draft.text.slice(selection.end);
      insertAt = selection.start;
    } else {
      const cursor = this.cursorOffset(draft);
      const empty = draft.lines[draft.pos(cursor).line] === "";
      insertAt = before || empty ? cursor : draft.after(cursor);
    }
    const inserted = linewise ? `\n${block}\n` : block;
    const last = [...graphemes.segment(inserted)].at(-1)?.segment.length ?? 0;
    const cursor = inserted.includes("\n") ? insertAt + (linewise ? 1 : 0) : insertAt + inserted.length - last;
    this.editText(remaining.slice(0, insertAt) + inserted + remaining.slice(insertAt), cursor);
    this.clampCursor();
  }

  private snapshot(): Snapshot {
    const internals = this.internals;
    return structuredClone({ state: internals.state, pastes: internals.pastes, pasteCounter: internals.pasteCounter });
  }

  private undoChanges(count: number): void {
    const internals = this.internals;
    for (let step = 0; step < count && internals.undoStack.length > 0; step++) {
      this.redoStack.push(this.snapshot());
      internals.undo();
    }
    this.clampCursor();
  }

  private redoChanges(count: number): void {
    const internals = this.internals;
    for (let step = 0; step < count; step++) {
      const snapshot = this.redoStack.pop();
      if (!snapshot) break;
      internals.pushUndoSnapshot();
      Object.assign(internals.state, snapshot.state);
      internals.pastes = snapshot.pastes;
      internals.pasteCounter = snapshot.pasteCounter;
      internals.lastAction = null;
      internals.preferredVisualCol = null;
      this.onChange?.(this.getText());
    }
    this.clampCursor();
  }

  private repeatChange(count: number): void {
    const keys = this.lastChange;
    this.commandKeys = [];
    if (keys.length === 0) return;
    this.replaying = true;
    try {
      for (let step = 0; step < count; step++) {
        for (const key of keys) this.handleEditorInput(key);
      }
    } finally {
      this.replaying = false;
      this.commandKeys = [];
      this.isChange = false;
    }
  }

  // ----------------------------------------------------------------- visual

  private selection(draft: Draft): Range {
    const cursor = this.cursorOffset(draft);
    const anchor = Math.min(this.anchor, draft.text.length);
    if (this.mode === "visual-line") {
      const lines = [draft.pos(anchor).line, draft.pos(cursor).line];
      return { kind: "lines", first: Math.min(...lines), last: Math.max(...lines) };
    }
    return { kind: "chars", start: Math.min(anchor, cursor), end: draft.after(Math.max(anchor, cursor)) };
  }

  private linesOf(draft: Draft, range: Range): Range {
    if (range.kind === "lines") return range;
    return { kind: "lines", first: draft.pos(range.start).line, last: draft.pos(Math.max(range.start, range.end - 1)).line };
  }

  private selectObject(range: Range): void {
    const draft = this.draft();
    this.pending = emptyPending();
    if (range.kind === "lines") {
      this.anchor = draft.offset({ line: range.first, col: 0 });
      this.setCursor({ line: range.last, col: 0 });
      return this.setMode("visual-line");
    }
    if (range.end <= range.start) return;
    this.anchor = range.start;
    this.setCursor(draft.pos(draft.offsetOf(draft.indexAt(range.end) - 1)));
  }

  private leaveVisual(): void {
    if (this.mode === "visual" || this.mode === "visual-line") this.setMode("normal");
    this.clampCursor();
  }

  /** Paint the selection over the rendered rows (Pi's own layout; only the cells change). */
  private highlightSelection(rendered: string[], width: number): string[] {
    const internals = this.internals;
    const draft = this.draft();
    const selection = this.selection(draft);
    const spans = new Map<number, { start: number; end: number; newline: boolean }>();
    if (selection.kind === "lines") {
      for (let line = selection.first; line <= selection.last; line++) {
        spans.set(line, { start: 0, end: draft.lines[line]!.length, newline: true });
      }
    } else {
      const start = draft.pos(selection.start);
      const end = draft.pos(selection.end);
      for (let line = start.line; line <= end.line; line++) {
        const span = {
          start: line === start.line ? start.col : 0,
          end: line === end.line ? end.col : draft.lines[line]!.length,
          newline: line < end.line,
        };
        if (span.start < span.end || span.newline) spans.set(line, span);
      }
    }
    const visualLines = internals.buildVisualLineMap(internals.lastWidth);
    const padding = Math.min(this.getPaddingX(), Math.max(0, Math.floor((width - 1) / 2)));
    const output = [...rendered];
    for (let row = 0; row < internals.renderedVisibleLineCount; row++) {
      const visual = visualLines[internals.scrollOffset + row];
      const span = visual && spans.get(visual.logicalLine);
      if (!visual || !span || output[row + 1] === undefined) continue;
      const chunkEnd = visual.startCol + visual.length;
      const chunk = draft.lines[visual.logicalLine]!.slice(visual.startCol, chunkEnd);
      const start = Math.max(span.start, visual.startCol);
      const end = Math.min(span.end, chunkEnd);
      let from = -1;
      let to = -1;
      if (start < end) {
        from = padding + visibleWidth(chunk.slice(0, start - visual.startCol));
        to = padding + visibleWidth(chunk.slice(0, end - visual.startCol));
      }
      const lastChunk = visualLines[internals.scrollOffset + row + 1]?.logicalLine !== visual.logicalLine;
      if (span.newline && lastChunk) {
        const lineEnd = padding + visibleWidth(chunk);
        if (from < 0) from = lineEnd;
        to = lineEnd + 1;
      }
      if (from >= 0 && to > from) output[row + 1] = styleColumns(output[row + 1]!, from, to, this.selectionStyle);
    }
    return output;
  }

  // ------------------------------------------------------------- transcript

  private viewport(): ViewportTui | undefined {
    const view = this.view;
    return view.mode === "fullscreen" && typeof view.scrollBy === "function" ? view : undefined;
  }

  /** Pi follows the transcript's end until you scroll up; then j/k and gg/G move the transcript. */
  private readingTranscript(): boolean {
    return this.viewport()?.isFollowingOutput === false;
  }

  private withViewport(action: (view: ViewportTui) => void): void {
    const view = this.viewport();
    if (view) return action(view);
    if (this.warnedAboutRegularMode) return;
    this.warnedAboutRegularMode = true;
    this.onRegularModeNavigation?.();
  }

  private scrollKey(key: string, count: number): boolean {
    const height = (view: ViewportTui) => view.getPrimaryScrollView?.()?.viewportHeight ?? Math.max(1, view.terminal.rows - 6);
    const amounts: Record<string, (view: ViewportTui) => number> = {
      "<c-e>": () => count,
      "<c-y>": () => -count,
      "<c-d>": (view) => Math.max(1, Math.floor(height(view) / 2)),
      "<c-u>": (view) => -Math.max(1, Math.floor(height(view) / 2)),
      "<c-f>": (view) => count * Math.max(1, height(view) - 4),
      "<c-b>": (view) => -count * Math.max(1, height(view) - 4),
    };
    const amount = amounts[key];
    if (!amount) return false;
    this.withViewport((view) => view.scrollBy!(amount(view)));
    return true;
  }

  /**
   * j/k move through the prompt's lines; k on its top line carries on up into
   * the transcript. While the transcript is scrolled up, j/k scroll it.
   */
  private lineOrTranscript(direction: 1 | -1, count: number): void {
    const internals = this.internals;
    if (this.readingTranscript()) return this.withViewport((view) => view.scrollBy!(direction * count));
    for (let step = 0; step < count; step++) {
      if (direction < 0 ? internals.isOnFirstVisualLine() : internals.isOnLastVisualLine()) {
        if (direction < 0) this.withViewport((view) => view.scrollBy!(-(count - step)));
        break;
      }
      internals.moveCursor(direction, 0);
    }
    this.clampCursor();
  }

  /** gg and G: the prompt's first or last line, then the transcript's top or bottom. */
  private goToLine(key: "gg" | "G", count: number, hasCount: boolean): void {
    const draft = this.draft();
    const line = draft.pos(this.cursorOffset(draft)).line;
    const toLine = (target: number) => {
      const clamped = Math.max(0, Math.min(draft.lastLine, target));
      this.setCursor(draft.pos(draft.offsetOf(draft.firstNonBlank(clamped))));
    };
    if (hasCount) return toLine(count - 1);
    const reading = this.readingTranscript();
    if (key === "G") {
      if (reading) return this.withViewport((view) => view.scrollToBottom?.());
      return toLine(draft.lastLine);
    }
    if (!reading && line > 0) return toLine(0);
    this.withViewport((view) => view.scrollToTop?.());
  }
}

// Pi runs its built-in /copy (copy the last reply) before any extension
// command, so no extension can register over it. While ../copy-session.ts is
// loaded, this editor submits an exact /copy as /copy-session instead, and the
// command menu describes /copy accordingly.
const COPY_ALIAS_TARGET = "copy-session";
const COPY_ALIAS_DESCRIPTION = "Copy this session's file path to the clipboard (/copy-session)";

function copyAlias(pi: Pick<ExtensionAPI, "getCommands">) {
  const active = () =>
    pi.getCommands().some((command) => command.source === "extension" && command.name === COPY_ALIAS_TARGET);
  return {
    rewriteSubmit: (text: string) => (text.trim() === "/copy" && active() ? `/${COPY_ALIAS_TARGET}` : text),
    autocomplete: (current: AutocompleteProvider): AutocompleteProvider => ({
      triggerCharacters: current.triggerCharacters,
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const suggestions = await current.getSuggestions(lines, cursorLine, cursorCol, options);
        if (!suggestions?.prefix.startsWith("/") || !active()) return suggestions;
        return {
          ...suggestions,
          items: suggestions.items.map((item) =>
            item.value === "copy" ? { ...item, description: COPY_ALIAS_DESCRIPTION } : item,
          ),
        };
      },
      applyCompletion: (lines, cursorLine, cursorCol, item, prefix) =>
        current.applyCompletion(lines, cursorLine, cursorCol, item, prefix),
      shouldTriggerFileCompletion: (lines, cursorLine, cursorCol) =>
        current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true,
    }),
  };
}

export default function vimNavigation(pi: ExtensionAPI): void {
  registerVimNavigation(pi);
}

/** The extension, with an optional clipboard stand-in for the PTY smoke test. */
export function registerVimNavigation(pi: ExtensionAPI, clipboard: Omit<ClipboardOptions, "reportError"> = {}): void {
  let editor: VimNavigationEditor | undefined;
  const alias = copyAlias(pi);

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
        { ...clipboard, reportError: (operation) => ctx.ui.notify(`Clipboard ${operation} failed; check Pi's clipboard support`, "warning") },
      );
      editor.rewriteSubmit = alias.rewriteSubmit;
      editor.selectionStyle = (text) => ctx.ui.theme.bg("selectedBg", text);
      return editor;
    });
    ctx.ui.addAutocompleteProvider(alias.autocomplete);
  });

  pi.on("session_shutdown", () => {
    editor?.dispose();
    editor = undefined;
  });
}
