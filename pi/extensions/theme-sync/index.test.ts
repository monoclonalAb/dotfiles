import { expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(),
  "@earendil-works/pi-coding-agent");
const nativeTheme = await import(pathToFileURL(join(root, "dist/modes/interactive/theme/theme.js")).href);
mock.module("@earendil-works/pi-coding-agent", () => ({ Theme: nativeTheme.Theme }));
const { catppuccinTheme, parseFlavour, registerThemeSync } = await import("./index.ts");
const { THEME_APPLIED_EVENT } = await import("./events.ts");
const { ToolExecutionComponent } = await import(pathToFileURL(join(root,
  "dist/modes/interactive/components/tool-execution.js")).href);
const { colors } = JSON.parse(readFileSync(join(root, "dist/modes/interactive/theme/light.json"), "utf8"));
const backgrounds = new Set(["selectedBg", "searchMatchBg", "userMessageBg", "customMessageBg",
  "toolPendingBg", "toolSuccessBg", "toolErrorBg"]);
const flavours = ["latte", "frappe", "macchiato", "mocha"] as const;
const ansi = (hex: string, kind = 48) => `\x1b[${kind};2;${hex.match(/../g)!.map((c) => parseInt(c, 16)).join(";")}m`;

function luminance(sequence: string) {
  const rgb = sequence.match(/;2;(\d+);(\d+);(\d+)m/)!.slice(1).map(Number);
  const [r, g, b] = rgb.map((n) => n / 255).map((n) => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function until(check: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for theme update");
    await Bun.sleep(20);
  }
}

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "pi-theme-test-"));
  const path = join(dir, "state", "flavour");
  const handlers = new Map<string, Function>();
  const applied: any[] = [];
  const warnings: string[] = [];
  const emitted: string[] = [];
  let theme = catppuccinTheme("latte", "truecolor");
  const ctx = { mode: "tui", ui: {
    get theme() { return theme; },
    setTheme(next: any) { applied.push(next); theme = next; return { success: true }; },
    notify(message: string) { warnings.push(message); },
  } };
  // Only lifecycle and the event bus are exposed: registering tools or context hooks fails the test.
  registerThemeSync({
    on: (name: string, handler: Function) => handlers.set(name, handler),
    events: { emit: (channel: string) => emitted.push(channel), on: () => () => {} },
  } as never, path, 30);
  const write = (value: string, atomic = false) => {
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(atomic ? path + ".tmp" : path, value);
    if (atomic) renameSync(path + ".tmp", path);
  };
  return { dir, path, handlers, applied, warnings, emitted, ctx, write,
    start: () => handlers.get("session_start")!({}, ctx),
    stop: () => handlers.get("session_shutdown")!({}, ctx),
    dispose() { handlers.get("session_shutdown")!({}, ctx); rmSync(dir, { recursive: true, force: true }); },
  };
}

test("only the four shared flavours are accepted", () => {
  for (const flavour of flavours) expect(parseFlavour(` ${flavour}\n`)).toBe(flavour);
  for (const invalid of ["", "mo", "dark", "MOCHA", "toString", "__proto__", "../../light"])
    expect(parseFlavour(invalid)).toBeUndefined();
});

test("all installed Pi tokens resolve in both truecolor and 256-color modes", () => {
  for (const flavour of flavours) for (const mode of ["truecolor", "256color"] as const) {
    const theme = catppuccinTheme(flavour, mode);
    expect(theme.name).toBe(`catppuccin-${flavour}`);
    expect(theme.getColorMode()).toBe(mode);
    for (const token of Object.keys(colors)) {
      const escape = backgrounds.has(token) ? theme.getBgAnsi(token as never) : theme.getFgAnsi(token as never);
      expect(escape).toContain(mode === "truecolor" ? ";2;" : ";5;");
      expect(escape).not.toContain("undefined");
      expect(escape).not.toContain("NaN");
    }
  }
});

test("native read/edit tool rows recolour in place, with subdued dark panels and readable output", () => {
  nativeTheme.setThemeInstance(catppuccinTheme("latte", "truecolor"));
  const ui = { requestRender() {} };
  const read = new ToolExecutionComponent("read", "read-test", { path: "file.txt" }, {}, undefined, ui, "/tmp");
  read.updateResult({ content: [{ type: "text", text: "hello" }], isError: false });
  const edit = new ToolExecutionComponent("edit", "edit-test", { path: "file.txt", edits: [] }, {}, undefined, ui, "/tmp");
  edit.updateResult({ content: [{ type: "text", text: "not found" }], isError: true });
  const pending = new ToolExecutionComponent("bash", "pending-test", { command: "true" }, {}, undefined, ui, "/tmp");
  const mantles = ["e6e9ef", "292c3c", "1e2030", "181825"];
  for (const [i, flavour] of flavours.entries()) {
    const theme = catppuccinTheme(flavour, "truecolor");
    nativeTheme.setThemeInstance(theme);
    for (const [row, token] of [[read, "toolSuccessBg"], [edit, "toolErrorBg"], [pending, "toolPendingBg"]] as const) {
      row.invalidate();
      expect(row.render(80).join("\n")).toContain(theme.getBgAnsi(token));
      const bg = luminance(theme.getBgAnsi(token));
      const fg = luminance(theme.getFgAnsi("toolOutput"));
      expect((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05)).toBeGreaterThan(4.5);
      if (flavour !== "latte") expect(bg).toBeLessThan(0.07);
    }
    expect(theme.getBgAnsi("toolSuccessBg")).toBe(ansi(mantles[i]));
  }
});

test("startup and file changes follow every flavour; duplicate/partial/missing state never flashes light", async () => {
  const f = fixture();
  try {
    expect([...f.handlers.keys()]).toEqual(["session_start", "session_shutdown"]);
    expect(f.applied).toHaveLength(0); // Factory is inert.
    f.write("mocha\n");
    f.start();
    expect(f.applied.map((t) => t.name)).toEqual(["catppuccin-mocha"]);
    for (const flavour of flavours) {
      f.write(flavour + "\n", true);
      await until(() => f.applied.at(-1).name === `catppuccin-${flavour}`);
    }
    const count = f.applied.length;
    f.write("mocha\n");
    await Bun.sleep(100);
    f.write("");
    await Bun.sleep(100);
    f.write("invalid");
    await Bun.sleep(100);
    rmSync(f.path);
    await Bun.sleep(100);
    expect(f.applied).toHaveLength(count);
    f.write("frappe");
    await until(() => f.applied.length === count + 1);
    expect(f.warnings).toEqual([]);
  } finally { f.dispose(); }
});

test("absent state is read-only and first creation works; shared choice repairs Pi's saved-theme restore", async () => {
  const f = fixture();
  try {
    f.start();
    expect(f.applied).toHaveLength(0);
    f.write("mocha");
    await until(() => f.applied.length === 1);
    f.ctx.ui.setTheme(catppuccinTheme("latte", "truecolor")); // Pi's post-/reload settings restore
    await until(() => f.ctx.ui.theme.name === "catppuccin-mocha");
    f.write("frappe");
    await until(() => f.ctx.ui.theme.name === "catppuccin-frappe");
  } finally { f.dispose(); }
});

test("emits one event per applied flavour and stays silent on unchanged state", async () => {
  const f = fixture();
  try {
    f.start();
    expect(f.emitted).toEqual([]);
    f.write("mocha");
    await until(() => f.applied.length === 1);
    expect(f.emitted).toEqual([THEME_APPLIED_EVENT]);
    await Bun.sleep(100); // Repeated polls of the same flavour emit nothing more.
    expect(f.emitted).toEqual([THEME_APPLIED_EVENT]);
    f.write("frappe");
    await until(() => f.applied.length === 2);
    expect(f.emitted).toEqual([THEME_APPLIED_EVENT, THEME_APPLIED_EVENT]);
  } finally { f.dispose(); }
});

test("shutdown/reload stops the old poller and reapplies current state exactly once", async () => {
  const f = fixture();
  try {
    f.write("mocha");
    f.start();
    f.stop();
    f.stop();
    f.write("latte");
    await Bun.sleep(100);
    expect(f.applied).toHaveLength(1);
    f.start();
    expect(f.applied).toHaveLength(2);
    f.start(); // Defensive duplicate startup also disposes its poller.
    f.write("macchiato");
    await until(() => f.applied.length >= 3);
    await Bun.sleep(100);
    expect(f.applied).toHaveLength(3);
    expect(f.ctx.ui.theme.name).toBe("catppuccin-macchiato");
  } finally { f.dispose(); }
});

test("RPC, JSON and print modes create no UI updates or pollers", async () => {
  const f = fixture();
  try {
    for (const mode of ["rpc", "json", "print"]) {
      f.ctx.mode = mode;
      f.start();
      f.write("mocha");
      await Bun.sleep(100);
      expect(f.applied).toHaveLength(0);
    }
  } finally { f.dispose(); }
});
