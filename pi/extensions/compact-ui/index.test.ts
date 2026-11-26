import { expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

const codingAgentRoot = join(
  execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(),
  "@earendil-works/pi-coding-agent",
);
mock.module("@earendil-works/pi-server", () => ({
  ServerError: class ServerError extends Error {},
  SessionAmbiguousError: class SessionAmbiguousError extends Error {},
  SessionNotFoundError: class SessionNotFoundError extends Error {},
}));
mock.module("@earendil-works/pi-server/unix", () => ({
  createUnixServer: () => { throw new Error("@earendil-works/pi-server stub"); },
  getUnixSocketPath: () => "",
}));
const codingAgent = await import(pathToFileURL(join(codingAgentRoot, "dist/index.js")).href);
const tuiPackage = await import(pathToFileURL(join(
  codingAgentRoot,
  "node_modules/@earendil-works/pi-tui/dist/index.js",
)).href);
mock.module("@earendil-works/pi-coding-agent", () => codingAgent);
mock.module("@earendil-works/pi-tui", () => tuiPackage);
const { visibleWidth } = tuiPackage;
const {
  colourModel,
  colourPath,
  colourStats,
  contextPaths,
  discoverExtensionEntries,
  extensionDescriptors,
  footerRow,
  installFooterLayout,
  registerCompactUi,
  removeFooterLayout,
  splitStatsLine,
  StartupSummary,
} = await import("./index.ts");

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

// Gives each theme colour its own 256-colour code, so a test can see which colour painted a word.
const colourCodes = new Map<string, number>();
const colourStart = (color: string) => {
  if (!colourCodes.has(color)) colourCodes.set(color, 16 + colourCodes.size);
  return `\x1b[38;5;${colourCodes.get(color)}m`;
};
const ansiTheme = {
  fg: (color: string, text: string) => `${colourStart(color)}${text}\x1b[39m`,
  bold: (text: string) => `\x1b[1m${text}\x1b[22m`,
};
const painted = ansiTheme.fg;
const paintedBold = (color: string, text: string) => painted(color, ansiTheme.bold(text));

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pi-compact-ui-"));
  const extensions = join(root, "extensions");
  await mkdir(join(extensions, "directory-extension"), { recursive: true });
  await writeFile(join(extensions, "direct.ts"), "export default () => {}\n");
  await writeFile(join(extensions, "ignore.md"), "not an extension\n");
  await writeFile(join(extensions, "directory-extension", "index.ts"), "export default () => {}\n");
  await mkdir(join(extensions, "manifest-extension", "src"), { recursive: true });
  await writeFile(join(extensions, "manifest-extension", "package.json"), JSON.stringify({
    name: "manifest-extension",
    pi: { extensions: ["./src/one.ts", "./src/missing.ts"] },
  }));
  await writeFile(join(extensions, "manifest-extension", "src", "one.ts"), "export default () => {}\n");
  return { root, extensions };
}

test("context paths are taken from Pi's active prompt without exposing file contents", () => {
  const prompt = `before\n<project_instructions path="/repo/AGENTS.md">SECRET</project_instructions>\n`
    + `<project_instructions path="/repo/sub/AGENTS.md">MORE</project_instructions>\n`
    + `<project_instructions path="/repo/AGENTS.md">DUP</project_instructions>`;
  expect(contextPaths(prompt)).toEqual(["/repo/AGENTS.md", "/repo/sub/AGENTS.md"]);
  expect(contextPaths("no context")).toEqual([]);
});

test("standard extension discovery matches direct, index and manifest entry points", async () => {
  const { root, extensions } = await fixture();
  try {
    expect(discoverExtensionEntries(extensions).map((path) => path.slice(extensions.length + 1)).sort()).toEqual([
      "direct.ts",
      "directory-extension/index.ts",
      "manifest-extension/src/one.ts",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extension summary deduplicates symlinks and includes package-owned tools", async () => {
  const { root, extensions } = await fixture();
  const packageRoot = join(root, "npm", "node_modules", "example-package");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({
    name: "example-package", version: "1.2.3", pi: { extensions: ["./index.ts"] },
  }));
  await writeFile(join(packageRoot, "index.ts"), "export default () => {}\n");
  await symlink(join(extensions, "direct.ts"), join(root, "direct-link.ts"));
  try {
    const pi = {
      getCommands: () => [{
        source: "extension",
        sourceInfo: { path: join(root, "direct-link.ts"), source: "local" },
      }, {
        source: "extension",
        sourceInfo: { path: "builtin:mcp", source: "builtin" },
      }],
      getAllTools: () => [{
        sourceInfo: { path: join(packageRoot, "index.ts"), source: "npm:example-package@1.2.3" },
      }],
    };
    const descriptors = extensionDescriptors(
      pi as never,
      { cwd: root, isProjectTrusted: () => false },
      root,
    );
    expect(descriptors.map(({ label }) => label)).toEqual([
      "direct.ts",
      "directory-extension",
      "example-package@1.2.3",
      "manifest-extension",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("startup header is one compact line and expands to bounded resource lists", () => {
  const header = new StartupSummary(plainTheme as never, ["/repo/AGENTS.md"], [
    { path: "/extensions/a.ts", label: "a.ts" },
    { path: "/extensions/example/index.ts", label: "example" },
  ], "test");
  const compact = header.render(120);
  expect(compact).toHaveLength(1);
  expect(compact[0]).toContain("pi vtest · Context: AGENTS.md · Extensions: 2 · ctrl+o");
  header.setExpanded(true);
  const expanded = header.render(30);
  expect(expanded.join("\n")).toContain("[Context]");
  expect(expanded.join("\n")).toContain("[Extensions]");
  expect(expanded.join("\n")).toContain("a.ts");
  expect(expanded[3]).toBe("");
  expect(expanded.every((line) => visibleWidth(line) <= 30)).toBe(true);
});

test("usage figures and model are coloured but keep Pi's text", () => {
  const native = "↑1.2M ↓34k R5.6M W120k CH97.3% $4.210 (sub) 75.5%/272k (auto)   "
    + "(anthropic) claude-opus-4-5 • high";
  const { stats, model } = splitStatsLine(native);
  expect(stats).toBe("↑1.2M ↓34k R5.6M W120k CH97.3% $4.210 (sub) 75.5%/272k (auto)");
  expect(model).toBe("(anthropic) claude-opus-4-5 • high");
  const figures = colourStats(stats, ansiTheme);
  expect(stripVTControlCharacters(figures)).toBe(stats);
  expect(figures).toContain(painted("dim", "↑") + paintedBold("mdLink", "1.2M"));
  expect(figures).toContain(painted("dim", "W") + paintedBold("mdLink", "120k"));
  expect(figures).toContain(painted("dim", "CH") + paintedBold("mdLink", "97.3%"));
  expect(figures).toContain(paintedBold("syntaxString", "$4.210"));
  expect(figures).toContain(painted("dim", "(sub)"));
  expect(figures).toContain(paintedBold("warning", "75.5%") + painted("dim", "/272k"));
  const name = colourModel(model, ansiTheme);
  expect(stripVTControlCharacters(name)).toBe(model);
  expect(name).toContain(painted("dim", "(anthropic) ") + painted("accent", "claude-opus-4-5"));
  expect(name).toContain(painted("mdHeading", "high"));

  expect(colourStats("12.0%/272k (auto)", ansiTheme)).toContain(paintedBold("success", "12.0%"));
  expect(colourStats("95.0%/272k", ansiTheme)).toContain(paintedBold("error", "95.0%"));
  expect(colourModel("gpt-6 • thinking off", ansiTheme)).toContain(painted("dim", "thinking off"));
  // Unknown words keep Pi's text and its dim colour.
  const odd = colourStats("↑12k new:thing ?/272k • xp", ansiTheme);
  expect(stripVTControlCharacters(odd)).toBe("↑12k new:thing ?/272k • xp");
  expect(odd).toContain(painted("dim", "new:thing"));
  expect(odd).toContain(painted("dim", "?/272k"));
  expect(odd).toContain(paintedBold("warning", "xp"));
});

test("folder line colours the folder and branch, and keeps Pi's line if it differs", () => {
  const parts = { cwd: join(process.env.HOME!, "dotfiles"), branch: "main", sessionName: "Footer" };
  const line = colourPath("~/dotfiles (main) • Footer", parts, ansiTheme);
  expect(stripVTControlCharacters(line)).toBe("~/dotfiles (main) • Footer");
  expect(line).toContain(painted("syntaxVariable", "~/dotfiles"));
  expect(line).toContain(painted("success", "main"));
  expect(colourPath("/elsewhere (main)", parts, ansiTheme)).toBe("/elsewhere (main)");
  expect(colourPath("/tmp", { cwd: "/tmp", branch: null }, ansiTheme)).toContain(painted("syntaxVariable", "/tmp"));
});

test("a footer row puts both parts on one line, or splits it when they do not fit", () => {
  const row = (left: string, rights: string[], width: number) =>
    footerRow(left, rights, width, "...").map((line: string) => stripVTControlCharacters(line));
  expect(row("left", ["right"], 12)).toEqual(["left   right"]);
  // The first right part that fits wins, as Pi drops the provider before the model.
  expect(row("left", ["(p) model", "model"], 12)).toEqual(["left   model"]);
  expect(row("a long left part", ["right"], 12)).toEqual(["a long le...", "       right"]);
  expect(row("", ["right"], 8)).toEqual(["   right"]);
  expect(row("", ["far too wide"], 8)).toEqual(["far t..."]);
  expect(row("left", [""], 8)).toEqual(["left"]);
  expect(row("", [], 8)).toEqual([]);
});

/** Pi's own footer class, subclassed so wrapping its `render` stays inside one test. */
function footerClass() {
  return class TestFooter extends codingAgent.FooterComponent {};
}

function footerFixture(
  Footer: ReturnType<typeof footerClass>,
  statuses = new Map<string, string>(),
  cwd = join(process.env.HOME!, "dotfiles"),
) {
  const sessionView = {
    state: { model: { id: "claude-opus-4-5", provider: "anthropic", reasoning: true, contextWindow: 200000 }, thinkingLevel: "high" },
    sessionManager: {
      getEntries: () => [{
        type: "message",
        message: { role: "assistant", usage: { input: 1200, output: 340, cacheRead: 56000, cacheWrite: 800, cost: { total: 0.42 } } },
      }],
      getEntryCount: () => 1,
      getSessionId: () => "test",
      getLeafId: () => "leaf",
      getCwd: () => cwd,
      getSessionName: () => undefined,
    },
    getContextUsage: () => ({ percent: 81.4, contextWindow: 200000 }),
    modelRuntime: { isUsingSubscription: () => true },
  };
  const footerData = {
    getGitBranch: () => "main",
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => 2,
    onBranchChange: () => () => {},
  };
  return new Footer(sessionView as never, footerData as never);
}

const plainLines = (lines: string[]) => lines.map((line) => stripVTControlCharacters(line));

test("footer is two rows: folder and model, then statuses and usage figures", () => {
  codingAgent.initTheme("dark", false);
  const Footer = footerClass();
  installFooterLayout(Footer, () => ansiTheme);
  const footer = footerFixture(Footer, new Map([
    ["00-quota-footer", "1% | 57% · 68%"],
    ["selective-skills", "| 2 skills"],
  ]));
  const lines = footer.render(146);
  const plain = plainLines(lines);
  expect(plain).toHaveLength(2);
  expect(plain[0]).toMatch(/^~\/dotfiles \(main\) +\(anthropic\) claude-opus-4-5 • high$/);
  expect(plain[1]).toMatch(/^1% \| 57% · 68% \| 2 skills +↑1\.2k ↓340 R56k W800 CH96\.6% \$0\.420 \(sub\) 81\.4%\/200k \(auto\)$/);
  expect(lines.every((line: string) => visibleWidth(line) === 146)).toBe(true);
  expect(lines[0]).toContain(painted("success", "main"));
  expect(lines[0]).toContain(painted("accent", "claude-opus-4-5"));
  expect(lines[1]).toContain(paintedBold("warning", "81.4%"));
});

test("on a narrow terminal a row splits instead of losing text, and never overflows", () => {
  codingAgent.initTheme("dark", false);
  const Footer = footerClass();
  installFooterLayout(Footer, () => ansiTheme);
  const footer = footerFixture(Footer, new Map([["00-quota-footer", "1% | 57% · 68%"]]));
  // 60 columns: the model fits beside the folder; the usage figures move below the statuses.
  expect(plainLines(footer.render(60))).toEqual([
    expect.stringMatching(/^~\/dotfiles \(main\) +\(anthropic\) claude-opus-4-5 • high$/),
    "1% | 57% · 68%",
    expect.stringMatching(/^ +↑1\.2k .* 81\.4%\/200k \(auto\)$/),
  ]);
  // 42 columns: the provider goes first, as in Pi's own footer.
  expect(plainLines(footer.render(42))[0]).toMatch(/^~\/dotfiles \(main\) +claude-opus-4-5 • high$/);
  for (const width of [8, 20, 40, 60, 100, 146]) {
    expect(footer.render(width).every((line: string) => visibleWidth(line) <= width)).toBe(true);
  }
  // Without extension statuses the usage figures stay on the right of the second row.
  const quiet = plainLines(footerFixture(Footer).render(146));
  expect(quiet).toHaveLength(2);
  expect(quiet[1]).toMatch(/^ +↑1\.2k .*\(auto\)$/);
});

test("the layout wraps Pi's footer once, takes a reloaded version, and can be removed", () => {
  codingAgent.initTheme("dark", false);
  const Footer = footerClass();
  const footer = footerFixture(Footer);
  const native = footer.render(146);
  expect(native).toHaveLength(2);
  expect(plainLines(native)[0]).toBe("~/dotfiles (main)");

  // No theme yet: Pi's footer is drawn as it is.
  let theme: typeof ansiTheme | undefined;
  installFooterLayout(Footer, () => theme);
  expect(footer.render(146)).toEqual(native);
  theme = plainTheme;
  const once = footer.render(146);
  expect(plainLines(once)[0]).toMatch(/^~\/dotfiles \(main\) +\(anthropic\) claude-opus-4-5 • high$/);
  // A reloaded extension installs again: the theme changes, the layout is not applied twice.
  installFooterLayout(Footer, () => ansiTheme);
  expect(plainLines(footer.render(146))).toEqual(plainLines(once));
  expect(footer.render(146)[0]).toContain(painted("accent", "claude-opus-4-5"));

  removeFooterLayout(Footer);
  expect(footer.render(146)).toEqual(native);
});

test("TUI registration sets the header and keeps the two-row footer through a session change", async () => {
  const { root } = await fixture();
  const lifecycle = new Map<string, (event: unknown, ctx: any) => void>();
  let headerFactory: ((tui: unknown, theme: typeof plainTheme) => StartupSummary) | undefined;
  const pi = {
    on(name: string, handler: (event: unknown, ctx: any) => void) { lifecycle.set(name, handler); },
    getCommands: () => [],
    getAllTools: () => [],
  };
  // No setFooter: Pi drops extension footers while it changes session, so none is used.
  const ctx = {
    mode: "tui",
    cwd: root,
    isProjectTrusted: () => false,
    getSystemPrompt: () => `<project_instructions path="${root}/AGENTS.md">private</project_instructions>`,
    ui: {
      theme: ansiTheme,
      setHeader(factory: typeof headerFactory) { headerFactory = factory; },
    },
  };
  const Footer = footerClass();
  const footer = footerFixture(Footer);
  const rows = () => plainLines(footer.render(146));
  try {
    codingAgent.initTheme("dark", false);
    registerCompactUi(pi as never, { agentDir: root, version: "test", footer: Footer });
    // Before the first session starts, Pi's own theme is used.
    expect(rows()).toEqual([
      expect.stringMatching(/^~\/dotfiles \(main\) +\(anthropic\) claude-opus-4-5 • high$/),
      expect.stringMatching(/^ +↑1\.2k .*\(auto\)$/),
    ]);
    const twoRows = rows();
    lifecycle.get("session_start")?.({}, ctx);
    expect(headerFactory?.({}, plainTheme).render(120)[0]).toContain("Context: AGENTS.md");
    expect(footer.render(146)[0]).toContain(painted("accent", "claude-opus-4-5"));
    // `/new`: the old extension shuts down and a new one loads; the footer never changes shape.
    lifecycle.get("session_shutdown")?.({}, ctx);
    expect(rows()).toEqual(twoRows);
    registerCompactUi(pi as never, { agentDir: root, version: "test", footer: Footer });
    expect(rows()).toEqual(twoRows);
    lifecycle.get("session_start")?.({}, ctx);
    expect(rows()).toEqual(twoRows);
    expect(rows().join("\n")).not.toContain("MCP");
  } finally {
    removeFooterLayout(Footer);
    await rm(root, { recursive: true, force: true });
  }
});
