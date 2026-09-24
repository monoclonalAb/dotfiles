import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Theme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Catppuccin palette values, matching bin/.local/bin/theme. Only that script
// owns the selected flavour; these are Pi's semantic colour mappings.
const palettes = {
  latte: {
    base: "#eff1f5", mantle: "#e6e9ef", surface0: "#ccd0da", surface1: "#bcc0cc",
    overlay0: "#9ca0b0", overlay1: "#8c8fa1", text: "#4c4f69", subtext0: "#6c6f85",
    mauve: "#8839ef", green: "#40a02b", yellow: "#df8e1d", red: "#d20f39",
    blue: "#1e66f5", teal: "#179299", peach: "#fe640b",
  },
  frappe: {
    base: "#303446", mantle: "#292c3c", surface0: "#414559", surface1: "#51576d",
    overlay0: "#737994", overlay1: "#838ba7", text: "#c6d0f5", subtext0: "#a5adce",
    mauve: "#ca9ee6", green: "#a6d189", yellow: "#e5c890", red: "#e78284",
    blue: "#8caaee", teal: "#81c8be", peach: "#ef9f76",
  },
  macchiato: {
    base: "#24273a", mantle: "#1e2030", surface0: "#363a4f", surface1: "#494d64",
    overlay0: "#6e738d", overlay1: "#8087a2", text: "#cad3f5", subtext0: "#a5adcb",
    mauve: "#c6a0f6", green: "#a6da95", yellow: "#eed49f", red: "#ed8796",
    blue: "#8aadf4", teal: "#8bd5ca", peach: "#f5a97f",
  },
  mocha: {
    base: "#1e1e2e", mantle: "#181825", surface0: "#313244", surface1: "#45475a",
    overlay0: "#6c7086", overlay1: "#7f849c", text: "#cdd6f4", subtext0: "#a6adc8",
    mauve: "#cba6f7", green: "#a6e3a1", yellow: "#f9e2af", red: "#f38ba8",
    blue: "#89b4fa", teal: "#94e2d5", peach: "#fab387",
  },
};

type Flavour = keyof typeof palettes;
type ColorMode = ConstructorParameters<typeof Theme>[2];

export function parseFlavour(value: string): Flavour | undefined {
  const flavour = value.trim();
  return Object.hasOwn(palettes, flavour) ? flavour as Flavour : undefined;
}

function tint(background: string, foreground: string): string {
  return "#" + [1, 3, 5].map((offset) => {
    const bg = Number.parseInt(background.slice(offset, offset + 2), 16);
    const fg = Number.parseInt(foreground.slice(offset, offset + 2), 16);
    return Math.round(bg * 0.88 + fg * 0.12).toString(16).padStart(2, "0");
  }).join("");
}

export function catppuccinTheme(flavour: Flavour, mode: ColorMode): Theme {
  const p = palettes[flavour];
  return new Theme({
    accent: p.mauve,
    border: p.blue,
    borderAccent: p.mauve,
    borderMuted: p.surface1,
    success: p.green,
    error: p.red,
    warning: p.yellow,
    muted: p.subtext0,
    dim: p.overlay1,
    text: p.text,
    thinkingText: p.subtext0,
    scrollbarTrack: p.surface0,
    scrollbarThumb: p.overlay1,
    searchMatchText: p.text,
    userMessageText: p.text,
    customMessageText: p.text,
    customMessageLabel: p.mauve,
    toolTitle: p.mauve,
    toolOutput: flavour === "latte" ? p.text : p.subtext0,
    mdHeading: p.mauve,
    mdLink: p.blue,
    mdLinkUrl: p.overlay1,
    mdCode: p.teal,
    mdCodeBlock: p.text,
    mdCodeBlockBorder: p.overlay0,
    mdQuote: p.subtext0,
    mdQuoteBorder: p.overlay0,
    mdHr: p.surface1,
    mdListBullet: p.teal,
    toolDiffAdded: p.green,
    toolDiffRemoved: p.red,
    toolDiffContext: p.subtext0,
    syntaxComment: p.overlay1,
    syntaxKeyword: p.mauve,
    syntaxFunction: p.blue,
    syntaxVariable: p.text,
    syntaxString: p.green,
    syntaxNumber: p.peach,
    syntaxType: p.yellow,
    syntaxOperator: p.teal,
    syntaxPunctuation: p.subtext0,
    thinkingOff: p.surface1,
    thinkingMinimal: p.overlay1,
    thinkingLow: p.blue,
    thinkingMedium: p.teal,
    thinkingHigh: p.mauve,
    thinkingXhigh: p.peach,
    thinkingMax: p.red,
    bashMode: p.yellow,
  }, {
    selectedBg: p.surface1,
    searchMatchBg: p.surface1,
    userMessageBg: p.surface0,
    customMessageBg: p.mantle,
    // No bright green/red slabs: settled tools sit below the terminal's base
    // colour; pending tools use base and errors get only a subtle red tint.
    toolPendingBg: p.base,
    toolSuccessBg: p.mantle,
    toolErrorBg: tint(p.mantle, p.red),
  }, mode, { name: `catppuccin-${flavour}` });
}

export function registerThemeSync(
  pi: ExtensionAPI,
  flavourPath = join(homedir(), ".local/state/theme/flavour"),
  interval = 500,
): void {
  let stop = () => {};

  pi.on("session_start", (_event, ctx) => {
    stop();
    if (ctx.mode !== "tui") return;
    let stopped = false;
    let warned = false;
    const sync = () => {
      if (stopped) return;
      let next: Flavour | undefined;
      try {
        next = parseFlavour(readFileSync(flavourPath, "utf8"));
      } catch {
        // Missing state (including a fresh machine) leaves Pi's current theme
        // alone. Keep watching so the first `theme set` takes effect too.
        return;
      }
      // `theme` currently truncates then writes flavour. Ignore partial or
      // invalid state instead of briefly flashing Latte in a dark terminal.
      if (!next || ctx.ui.theme.name === `catppuccin-${next}`) return;
      try {
        const result = ctx.ui.setTheme(catppuccinTheme(next, ctx.ui.theme.getColorMode()));
        if (!result.success) throw new Error(result.error ?? "Theme rejected");
      } catch {
        if (!warned) {
          ctx.ui.notify("Could not sync Pi's Catppuccin theme; try /reload.", "warning");
          warned = true;
        }
      }
    };
    // Poll just this tiny state file: works across rename, deletion/recreation
    // and absent parents. Also repairs Pi reapplying its saved theme AFTER
    // session_start during /reload. The shared choice wins over /settings.
    // No subprocess, settings write or IPC; unchanged colours do not repaint.
    const timer = setInterval(sync, interval);
    timer.unref();
    stop = () => {
      stopped = true;
      clearInterval(timer);
    };
    sync();
  });
  pi.on("session_shutdown", () => stop());
}

export default function (pi: ExtensionAPI): void {
  registerThemeSync(pi);
}
