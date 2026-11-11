import { expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
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
const nativeTheme = await import(pathToFileURL(join(codingAgentRoot, "dist/modes/interactive/theme/theme.js")).href);
const tuiPackage = await import(pathToFileURL(join(
  codingAgentRoot,
  "node_modules/@earendil-works/pi-tui/dist/index.js",
)).href);
mock.module("@earendil-works/pi-coding-agent", () => codingAgent);
mock.module("@earendil-works/pi-tui", () => tuiPackage);

const { AssistantMessageComponent, getMarkdownTheme, ToolExecutionComponent } = codingAgent;
const { visibleWidth } = tuiPackage;
const { catppuccinTheme } = await import("../theme-sync/index.ts");
const { tidyThinking } = await import("../gemini-thinking-tidy/index.ts");
const {
  createReadableToolResolver,
  displayPath,
  formatExpandedCodemodeOutput,
  formatNestedCall,
  formatThinkingMarkdown,
  HIDDEN_THINKING_LABEL,
  registerReadableTranscript,
  summarizeCodemodeOutput,
} = await import("./index.ts");

function setupLatteTheme() {
  const theme = catppuccinTheme("latte", "truecolor");
  nativeTheme.setThemeInstance(theme);
  return theme;
}

test("formatThinkingMarkdown frames reasoning in one continuous quote rail and leaves blank text empty", () => {
  expect(formatThinkingMarkdown("   \n\t  ", false)).toBe("   \n\t  ");

  const streaming = formatThinkingMarkdown("\nFirst check `pi/settings.json`.\n\n```ts\nconst x = 1;\n```\n", true);
  expect(streaming).toBe([
    "> ## Thinking…",
    ">",
    "> First check `pi/settings.json`.",
    ">",
    "> ```ts",
    "> const x = 1;",
    "> ```",
  ].join("\n"));

  const settled = formatThinkingMarkdown("Step 1\r\n\r\nStep 2", false);
  expect(settled).toBe([
    "> ## Thinking",
    ">",
    "> Step 1",
    ">",
    "> Step 2",
  ].join("\n"));
  expect(formatThinkingMarkdown(settled, false)).toBe(settled);
});

test("AssistantMessageComponent renders framed thinking distinctly from reply text and composes with gemini-thinking-tidy", () => {
  const theme = setupLatteTheme();
  const transformers = [
    (md: string, ctx: { messageType: string; isStreaming: boolean }) =>
      ctx.messageType === "assistant-thinking" ? tidyThinking(md, ctx.isStreaming) : md,
    (md: string, ctx: { messageType: string; isStreaming: boolean }) =>
      ctx.messageType === "assistant-thinking" ? formatThinkingMarkdown(md, ctx.isStreaming) : md,
  ];
  const geminiNote = [
    "Thinking Process:",
    "1. Analyze the Request: Summarize in 3-7 words.",
    "**Inspecting theme configuration**",
    "",
    "Checking how Catppuccin tokens map to Markdown borders.",
  ].join("\n");

  const component = new AssistantMessageComponent(
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: geminiNote },
        { type: "text", text: "Here is the final answer." },
      ],
      stopReason: "stop",
    } as never,
    false,
    getMarkdownTheme(),
    HIDDEN_THINKING_LABEL,
    1,
    transformers as never,
  );

  const rendered = component.render(80);
  const plain = rendered.map((line: string) => stripVTControlCharacters(line)).join("\n");
  expect(plain).toContain("│ Thinking");
  expect(plain).toContain("│ Inspecting theme configuration");
  expect(plain).toContain("│ Checking how Catppuccin tokens map to Markdown borders.");
  expect(plain).not.toContain("Thinking Process:");
  expect(plain).toContain("Here is the final answer.");
  expect(rendered.join("\n")).toContain(theme.getFgAnsi("mdQuoteBorder"));

  // Collapsing shows the explicit expandable label instead of a stuck-looking "Thinking...".
  component.setHideThinkingBlock(true);
  const collapsed = component.render(80).map((line: string) => stripVTControlCharacters(line)).join("\n");
  expect(collapsed).toContain(HIDDEN_THINKING_LABEL);
  expect(collapsed).toContain("Here is the final answer.");
});

test("nested codemode calls format paths, line ranges, shell snippets, truncated JSON and errors cleanly", () => {
  const theme = setupLatteTheme();
  const cwd = "/Users/example/dotfiles";

  expect(displayPath("/Users/example/dotfiles/pi/settings.json", cwd, "/Users/example")).toBe("pi/settings.json");
  expect(displayPath("/Users/example/.config/nvim/init.lua", cwd, "/Users/example")).toBe("~/.config/nvim/init.lua");

  const readLine = stripVTControlCharacters(formatNestedCall({
    id: "1/0",
    name: "read",
    args: JSON.stringify({ path: "/Users/example/dotfiles/docs/THEME.md", offset: 10, limit: 25 }),
    status: "ok",
    durationMs: 4,
  }, theme, cwd, false));
  expect(readLine).toBe("  ✓ read docs/THEME.md:10-34 4ms");

  const bashLine = stripVTControlCharacters(formatNestedCall({
    id: "1/1",
    name: "bash",
    args: JSON.stringify({ command: "pwd && git status --short\nls -la", timeout: 10 }),
    status: "ok",
    durationMs: 120,
  }, theme, cwd, false));
  expect(bashLine).toBe("  ✓ bash $ pwd && git status --short (+1 lines) 120ms");

  // Truncated JSON from CodemodeNestedCall still recovers the target file path.
  const truncatedEdit = stripVTControlCharacters(formatNestedCall({
    id: "1/2",
    name: "edit",
    args: '{"path":"/Users/example/dotfiles/pi/extensions/theme-sync/index.ts","edits":[{"oldText":"long...',
    status: "error",
    error: "Could not match oldText\nin target file",
  }, theme, cwd, false));
  expect(truncatedEdit).toContain("✗ edit pi/extensions/theme-sync/index.ts");
  expect(truncatedEdit).toContain("↳ Could not match oldText");
});

test("codemode ToolExecutionComponent collapses boilerplate and JSON soup, and expands into readable sections", () => {
  setupLatteTheme();
  const resolver = createReadableToolResolver();
  const codemodeDef = resolver("codemode", () => undefined);
  const ui = { requestRender() {} };
  const script = [
    "const a = await tools.read({ path: 'docs/README.md', offset: 1, limit: 20 });",
    "const b = await tools.bash({ command: 'git status --short', timeout: 10 });",
    "const c = 3;",
    "const d = 4;",
    "return { readme: a, status: b.output };",
  ].join("\n");

  const row = new ToolExecutionComponent("codemode", "cm-1", { code: script }, {}, codemodeDef as never, ui as never, "/repo");
  row.markExecutionStarted();
  row.updateResult({
    content: [
      { type: "text", text: "Script completed\nWall time 0.1 seconds\nOutput:\n" },
      { type: "text", text: JSON.stringify({ readme: "# Docs\nLine 2", status: " M README.md\n M links" }) },
    ],
    details: {
      calls: [
        { id: "cm-1/0", name: "read", args: '{"path":"/repo/docs/README.md","offset":1,"limit":20}', status: "ok", durationMs: 3 },
        { id: "cm-1/1", name: "bash", args: '{"command":"git status --short","timeout":10}', status: "ok", durationMs: 11 },
      ],
    },
    isError: false,
    durationMs: 120,
  } as never, false);

  const collapsedLines = row.render(80);
  expect(collapsedLines.every((line: string) => visibleWidth(line) <= 80)).toBe(true);
  const collapsed = collapsedLines.map((line: string) => stripVTControlCharacters(line)).join("\n");
  expect(collapsed).toContain("▸ codemode · 2 calls · 5 lines");
  expect(collapsed).not.toContain("await tools.read");
  expect(collapsed).toContain("✓ read docs/README.md:1-20 3ms");
  expect(collapsed).toContain("✓ bash $ git status --short 11ms");
  expect(collapsed).toContain("↳ returned { readme, status } · Took 0.1s");
  expect(collapsed).not.toContain("\\n");

  row.setExpanded(true);
  const expanded = row.render(80).map((line: string) => stripVTControlCharacters(line)).join("\n");
  expect(expanded).toContain("▾ codemode · 2 calls · 5 lines");
  expect(expanded).toContain("│ const a = await tools.read");
  expect(expanded).toContain("[readme]");
  expect(expanded).toContain("  # Docs");
  expect(expanded).toContain("[status]");
  expect(expanded).toContain("   M README.md");

  expect(summarizeCodemodeOutput("[1,2,3]")).toBe("returned [3 items]");
  expect(stripVTControlCharacters(formatExpandedCodemodeOutput('{"count":2}', catppuccinTheme("latte", "truecolor")))).toContain('"count": 2');
});

test("bash ToolExecutionComponent highlights and folds multi-line scripts while preserving native result output", () => {
  setupLatteTheme();
  const resolver = createReadableToolResolver();
  const nativeBashResult = (_result: any, _options: any, theme: any) => new tuiPackage.Text(theme.fg("toolOutput", "\nok-out"), 0, 0);
  const bashDef = resolver("bash", () => ({ renderResult: nativeBashResult }));
  const ui = { requestRender() {} };
  const script = ["set -eu", "for f in a b c; do", "  echo \"$f\"", "done", "echo done", "exit 0"].join("\n");

  const row = new ToolExecutionComponent("bash", "sh-1", { command: script, timeout: 15 }, {}, bashDef as never, ui as never, "/repo");
  row.updateResult({ content: [{ type: "text", text: "ok-out" }], isError: false } as never, false);

  const collapsed = row.render(80).map((line: string) => stripVTControlCharacters(line)).join("\n");
  expect(collapsed).toContain("$ set -eu (timeout 15s)");
  expect(collapsed).toContain("│ for f in a b c; do");
  expect(collapsed).toContain("(+2 script lines,");
  expect(collapsed).not.toContain("exit 0");
  expect(collapsed).toContain("ok-out");

  row.setExpanded(true);
  const expanded = row.render(80).map((line: string) => stripVTControlCharacters(line)).join("\n");
  expect(expanded).toContain("│ exit 0");
});

test("extension registration is strictly display-only and restores hidden thinking label on shutdown", () => {
  const events = new Map<string, Function>();
  let markdownOpts: unknown;
  let toolResolver: unknown;
  const labels: (string | undefined)[] = [];

  registerReadableTranscript({
    on(name: string, handler: Function) { events.set(name, handler); },
    registerMarkdownTransformer(_fn: unknown, opts: unknown) { markdownOpts = opts; },
    registerToolRenderer(resolver: unknown) { toolResolver = resolver; },
  } as never);

  expect([...events.keys()]).toEqual(["session_start", "session_shutdown"]);
  expect(markdownOpts).toEqual({ messageTypes: ["assistant-thinking"] });
  expect(typeof toolResolver).toBe("function");

  const ctx = {
    mode: "tui",
    ui: { setHiddenThinkingLabel(label?: string) { labels.push(label); } },
  };
  events.get("session_start")!({}, ctx);
  events.get("session_shutdown")!({}, ctx);
  expect(labels).toEqual([HIDDEN_THINKING_LABEL, undefined]);

  events.get("session_start")!({}, { mode: "rpc", ui: ctx.ui });
  expect(labels).toHaveLength(2);
});
