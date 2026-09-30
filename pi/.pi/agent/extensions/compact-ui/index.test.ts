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
  contextPaths,
  discoverExtensionEntries,
  enabledMcpCount,
  extensionDescriptors,
  isRoutineMcpNotice,
  McpAlignedFooter,
  mcpCounts,
  MCP_STATUS_EVENT,
  registerCompactUi,
  StartupSummary,
} = await import("./index.ts");

const plainTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

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

test("MCP status stays at the right edge while other extension statuses stay on the left", () => {
  codingAgent.initTheme("dark", false);
  const statuses = new Map([
    ["00-quota-footer", "31% | 14% · 0%"],
    ["mcp", "MCP: 0/2"],
    ["long-context", "ctx:1.05M"],
  ]);
  const footer = new McpAlignedFooter({
    model: undefined,
    thinkingLevel: "off",
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: {
      getEntries: () => [],
      getEntryCount: () => 0,
      getSessionId: () => "test",
      getLeafId: () => null,
      getCwd: () => "/tmp",
      getSessionName: () => undefined,
    },
    getContextUsage: () => ({ percent: 0, contextWindow: 272000 }),
  } as never, {
    getGitBranch: () => null,
    getExtensionStatuses: () => statuses,
    getAvailableProviderCount: () => 1,
    onBranchChange: () => () => {},
  });
  const line = stripVTControlCharacters(footer.render(60).at(-1) ?? "");
  expect(line).toContain("31% | 14% · 0%");
  expect(line).toContain("ctx:1.05M");
  expect(line.endsWith("MCP: 0/2")).toBe(true);
  expect(visibleWidth(line)).toBe(60);
});

test("MCP count means enabled/total servers and only routine startup notices are suppressed", () => {
  const snapshot = {
    version: 1,
    servers: [{ disabled: false }, { disabled: true }, { disabled: false }],
  };
  expect(mcpCounts(snapshot)).toEqual({ enabled: 2, total: 3 });
  expect(enabledMcpCount(snapshot)).toBe(2);
  expect(enabledMcpCount({ version: 2, servers: [] })).toBeUndefined();
  expect(enabledMcpCount(null)).toBeUndefined();
  expect(isRoutineMcpNotice("MCP: All 2 server(s) are disabled", "info")).toBe(true);
  expect(isRoutineMcpNotice("MCP: 2/3 servers connected (10 tools)", "info")).toBe(true);
  expect(isRoutineMcpNotice("MCP: Failed to connect to context7", "error")).toBe(false);
  expect(isRoutineMcpNotice("MCP: All 2 server(s) are disabled", "warning")).toBe(false);
});

test("TUI registration replaces the header and wins over the adapter's verbose status", async () => {
  const { root } = await fixture();
  const lifecycle = new Map<string, (event: unknown, ctx: any) => void>();
  const bus = new Map<string, (value: unknown) => void>();
  let headerFactory: ((tui: unknown, theme: typeof plainTheme) => StartupSummary) | undefined;
  const statuses = new Map<string, string>();
  const notices: string[] = [];
  const pi = {
    events: {
      on(name: string, handler: (value: unknown) => void) {
        bus.set(name, handler);
        return () => bus.delete(name);
      },
    },
    on(name: string, handler: (event: unknown, ctx: any) => void) { lifecycle.set(name, handler); },
    getCommands: () => [],
    getAllTools: () => [],
  };
  const ctx = {
    mode: "tui",
    cwd: root,
    isProjectTrusted: () => false,
    getSystemPrompt: () => `<project_instructions path="${root}/AGENTS.md">private</project_instructions>`,
    model: undefined,
    thinkingLevel: "off",
    modelRegistry: { isUsingOAuth: () => false },
    sessionManager: {
      getEntries: () => [],
      getEntryCount: () => 0,
      getSessionId: () => "test",
      getLeafId: () => null,
      getCwd: () => root,
      getSessionName: () => undefined,
    },
    getContextUsage: () => ({ percent: 0, contextWindow: 272000 }),
    ui: {
      theme: plainTheme,
      notify(message: string, _type?: "info" | "warning" | "error") { notices.push(message); },
      setHeader(factory: typeof headerFactory) { headerFactory = factory; },
      setFooter(_factory: unknown) {},
      setStatus(key: string, value: string | undefined) {
        if (value === undefined) statuses.delete(key); else statuses.set(key, value);
      },
    },
  };
  try {
    registerCompactUi(pi as never, { agentDir: root, version: "test" });
    lifecycle.get("session_start")?.({}, ctx);
    expect(headerFactory?.({}, plainTheme).render(120)[0]).toContain("Context: AGENTS.md");
    ctx.ui.notify("MCP: All 2 server(s) are disabled", "info");
    ctx.ui.notify("MCP: Failed to connect", "error");
    expect(notices).toEqual(["MCP: Failed to connect"]);

    bus.get(MCP_STATUS_EVENT)?.({
      version: 1,
      servers: [{ disabled: true }, { disabled: true }],
    });
    statuses.set("mcp", "MCP: 0 servers enabled (2 disabled)");
    await Promise.resolve();
    expect(statuses.get("mcp")).toBe("MCP: 0/2");

    lifecycle.get("session_shutdown")?.({}, ctx);
    expect(statuses.has("mcp")).toBe(false);
    expect(bus.has(MCP_STATUS_EVENT)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
