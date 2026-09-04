import {
  CustomEditor,
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

export class VimNavigationEditor extends CustomEditor {
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
  ) {
    super(tui, theme, keybindings);
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

  override handleInput(data: string): void {
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

      super.handleInput(data);
      return;
    }

    if (this.mode === "insert") {
      super.handleInput(data);
      return;
    }

    if (data === "i" || data === "a") {
      this.enterInsertMode();
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

    super.handleInput(data);
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

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      editor = new VimNavigationEditor(tui, theme, keybindings, () => {
        ctx.ui.notify(
          "Vim transcript navigation requires fullscreen mode; restart Pi without --tui-mode regular",
          "warning",
        );
      });
      return editor;
    });
  });

  pi.on("session_shutdown", () => {
    editor?.restoreKeybindings();
    editor = undefined;
  });
}
