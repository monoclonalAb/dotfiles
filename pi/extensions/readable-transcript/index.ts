import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
import {
  formatReadLineRange,
  highlightCode,
  truncateToVisualLines,
  type CodemodeToolDetails,
  type ExtensionAPI,
  type Theme,
  type ToolRenderContext,
  type ToolRendererResolver,
  type ToolRenderers,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text, type Component } from "@earendil-works/pi-tui";

export const HIDDEN_THINKING_LABEL = "▸ Thinking · click to expand";

const BASH_CALL_PREVIEW_LINES = 4;
const CODEMODE_SCRIPT_PREVIEW_LINES = 3;
const CODEMODE_CALL_PREVIEW_COUNT = 8;
const CODEMODE_OUTPUT_PREVIEW_LINES = 4;
const COLLAPSED_ARG_CHARS = 76;
const MAX_PRETTY_JSON_CHARS = 200_000;
const SCRIPT_HEADER = /^Script (completed|failed)\nWall time [\d.]+\s*seconds\nOutput:\n$/;

type CodemodeCall = CodemodeToolDetails["calls"][number];

interface HighlightCache {
  key: string;
  theme: Theme;
  lines: string[];
}

interface ToolRowState {
  startedAt?: number;
  endedAt?: number;
  interval?: ReturnType<typeof setInterval>;
  callCount?: number;
  highlight?: HighlightCache;
}

/**
 * Wrap assistant thinking Markdown in one continuous blockquote with a heading so Pi renders a
 * distinct `│` left rail and title above the reasoning without altering session or model text.
 */
export function formatThinkingMarkdown(markdown: string, isStreaming = false): string {
  if (!markdown.trim()) return markdown;
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (/^> ## Thinking…?\n>(?:\n|$)/.test(normalized)) return normalized;

  const lines = normalized.split("\n");
  while (lines.length > 0 && !lines[0]!.trim()) lines.shift();
  while (lines.length > 0 && !lines.at(-1)!.trim()) lines.pop();
  if (lines.length === 0) return markdown;

  const heading = isStreaming ? "> ## Thinking…" : "> ## Thinking";
  const quoted = lines.map((line) => (line.length > 0 ? `> ${line}` : ">"));
  return [heading, ">", ...quoted].join("\n");
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export function displayPath(rawPath: string, cwd: string, home = homedir()): string {
  if (!rawPath) return "";
  const expanded = rawPath === "~"
    ? home
    : rawPath.startsWith("~/")
      ? resolve(home, rawPath.slice(2))
      : rawPath;
  const absolute = resolve(cwd, expanded);
  const rel = relative(resolve(cwd), absolute);
  if (rel === "") return ".";
  if (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)) {
    return toPosix(rel);
  }
  const homeResolved = resolve(home);
  if (absolute === homeResolved) return "~";
  if (absolute.startsWith(`${homeResolved}${sep}`)) {
    return `~/${toPosix(absolute.slice(homeResolved.length + 1))}`;
  }
  return rawPath;
}

function readStringArg(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return null;
}

function clipText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
}

function unescapeJsonFragment(fragment: string): string {
  return fragment.replace(/\\(["\\/bfnrt]|u[0-9a-fA-F]{4})/g, (_match, token: string) => {
    switch (token) {
      case "\"":
      case "\\":
      case "/":
        return token;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return String.fromCharCode(Number.parseInt(token.slice(1), 16));
    }
  });
}

function parseNestedArgs(rawArgs: string): Record<string, unknown> | undefined {
  const trimmed = rawArgs.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Codemode truncates long argument JSON strings; recover key string fields when cut mid-object.
    const recovered: Record<string, unknown> = {};
    const pattern = /"(file_path|path|command|pattern|query|url|id)"\s*:\s*"((?:\\.|[^"\\])*)/g;
    for (const match of trimmed.matchAll(pattern)) {
      recovered[match[1]!] = unescapeJsonFragment(match[2]!);
    }
    if (Object.keys(recovered).length > 0) return recovered;
  }
  return undefined;
}

function formatShellSnippet(command: string, theme: Theme, expanded: boolean): string {
  const cleaned = command.replace(/\r/g, "").replace(/\t/g, "   ").trim();
  if (!cleaned) return theme.fg("muted", "$ ...");
  const lines = cleaned.split("\n");
  const prompt = theme.fg("muted", "$ ");
  if (expanded) {
    const [first, ...rest] = lines;
    return [
      `${prompt}${theme.fg("toolOutput", first!)}`,
      ...rest.map((line) => `      ${theme.fg("toolOutput", line)}`),
    ].join("\n");
  }
  const first = clipText(lines[0]!.trim(), COLLAPSED_ARG_CHARS);
  const more = lines.length > 1 ? theme.fg("dim", ` (+${lines.length - 1} lines)`) : "";
  return `${prompt}${theme.fg("toolOutput", first)}${more}`;
}

function summarizeParsedArgs(
  toolName: string,
  parsed: Record<string, unknown>,
  theme: Theme,
  cwd: string,
  expanded: boolean,
): string | undefined {
  if (toolName === "read") {
    const raw = typeof parsed.file_path === "string" ? parsed.file_path : typeof parsed.path === "string" ? parsed.path : "";
    if (!raw) return undefined;
    const range = formatReadLineRange(parsed.offset as never, parsed.limit as never);
    return `${theme.fg("accent", displayPath(raw, cwd))}${range ? theme.fg("warning", range) : ""}`;
  }
  if (toolName === "bash" || toolName === "powershell") {
    if (typeof parsed.command !== "string") return undefined;
    return formatShellSnippet(parsed.command, theme, expanded);
  }
  if (toolName === "edit" || toolName === "write") {
    const raw = typeof parsed.file_path === "string" ? parsed.file_path : typeof parsed.path === "string" ? parsed.path : "";
    if (!raw) return undefined;
    const edits = toolName === "edit" && Array.isArray(parsed.edits) && parsed.edits.length > 1
      ? theme.fg("dim", ` (${parsed.edits.length} edits)`)
      : "";
    return `${theme.fg("accent", displayPath(raw, cwd))}${edits}`;
  }
  if (toolName === "grep" || toolName === "find" || toolName === "ls") {
    const parts: string[] = [];
    if (typeof parsed.pattern === "string" && parsed.pattern) {
      parts.push(theme.fg("toolOutput", clipText(parsed.pattern, 40)));
    }
    if (typeof parsed.path === "string" && parsed.path) {
      parts.push(theme.fg("accent", displayPath(parsed.path, cwd)));
    }
    if (parts.length > 0) return parts.join(" ");
  }

  const entries = Object.entries(parsed).filter(([, value]) => value !== null && value !== undefined);
  if (entries.length === 0) return "";
  if (expanded) {
    return entries.map(([key, value]) => {
      const rendered = typeof value === "string" ? value : JSON.stringify(value);
      return `\n      ${theme.fg("muted", `${key}: ${rendered.replace(/\r/g, "").split("\n").join("\n        ")}`)}`;
    }).join("");
  }
  const compact = entries.map(([key, value]) => {
    const rendered = typeof value === "string"
      ? (/\s/.test(value) ? JSON.stringify(clipText(value, 36)) : clipText(value, 36))
      : clipText(JSON.stringify(value) ?? String(value), 36);
    return `${key}=${rendered}`;
  }).join(" ");
  return theme.fg("muted", clipText(compact, COLLAPSED_ARG_CHARS));
}

function formatCallDuration(ms: number | undefined): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  return `$${cost >= 0.01 ? cost.toFixed(2) : cost.toPrecision(2)}`;
}

function callStatusGlyph(status: CodemodeCall["status"], theme: Theme): string {
  switch (status) {
    case "running":
      return theme.fg("warning", "…");
    case "ok":
      return theme.fg("success", "✓");
    case "error":
      return theme.fg("error", "✗");
    case "cancelled":
      return theme.fg("muted", "⊘");
  }
}

export function formatNestedCall(
  call: CodemodeCall,
  theme: Theme,
  cwd: string,
  expanded: boolean,
): string {
  const parsed = call.args ? parseNestedArgs(call.args) : undefined;
  const formattedArgs = parsed !== undefined
    ? summarizeParsedArgs(call.name, parsed, theme, cwd, expanded)
    : undefined;
  const fallbackArgs = !expanded && call.args.length > COLLAPSED_ARG_CHARS
    ? clipText(call.args, COLLAPSED_ARG_CHARS)
    : call.args;
  const argText = formattedArgs !== undefined
    ? formattedArgs
    : fallbackArgs
      ? theme.fg("muted", fallbackArgs)
      : "";

  let line = `  ${callStatusGlyph(call.status, theme)} ${theme.fg("toolTitle", call.name)}`;
  if (argText) {
    line += argText.startsWith("\n") ? argText : ` ${argText}`;
  }
  const duration = formatCallDuration(call.durationMs);
  if (duration) line += ` ${theme.fg("dim", duration)}`;
  if (call.cost) line += ` ${theme.fg("dim", formatCost(call.cost))}`;

  if (call.error) {
    const errLines = call.error.replace(/\r/g, "").split("\n");
    if (expanded) {
      line += `\n      ${theme.fg("error", errLines.join("\n      "))}`;
    } else if (errLines[0]?.trim()) {
      line += `\n      ${theme.fg("error", `↳ ${clipText(errLines[0].trim(), COLLAPSED_ARG_CHARS)}`)}`;
    }
  }
  return line;
}

function parseJsonValue(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.length > MAX_PRETTY_JSON_CHARS) return { ok: false };
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

/** One-line structural summary for JSON script output when nested calls are already listed above. */
export function summarizeCodemodeOutput(output: string): string | undefined {
  const parsed = parseJsonValue(output);
  if (!parsed.ok || parsed.value === null || typeof parsed.value !== "object") return undefined;
  if (Array.isArray(parsed.value)) {
    const count = parsed.value.length;
    return `returned [${count} ${count === 1 ? "item" : "items"}]`;
  }
  const keys = Object.keys(parsed.value);
  if (keys.length === 0) return "returned {}";
  const shown = keys.slice(0, 4).join(", ");
  const more = keys.length > 4 ? `, +${keys.length - 4} more` : "";
  return `returned { ${shown}${more} }`;
}

/**
 * Expanded codemode output: objects holding multi-line strings (such as batched `read`/`bash`
 * results) render as `[key]` sections with real line breaks instead of `\n`-escaped JSON strings.
 */
export function formatExpandedCodemodeOutput(output: string, theme: Theme): string {
  const cleaned = output.replace(/\r/g, "").replace(/\t/g, "   ");
  const parsed = parseJsonValue(cleaned);
  if (!parsed.ok) {
    return cleaned.split("\n").map((line) => theme.fg("toolOutput", line)).join("\n");
  }

  const value = parsed.value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    const hasMultilineString = entries.some(([, v]) => typeof v === "string" && v.includes("\n"));
    if (hasMultilineString) {
      return entries.map(([key, v]) => {
        const heading = theme.fg("mdHeading", theme.bold(`[${key}]`));
        if (typeof v === "string") {
          const body = v.replace(/\r/g, "").replace(/\t/g, "   ").trimEnd()
            .split("\n")
            .map((line) => theme.fg("toolOutput", `  ${line}`))
            .join("\n");
          return `${heading}\n${body}`;
        }
        const pretty = JSON.stringify(v, null, 2) ?? String(v);
        const body = highlightCode(pretty, "json").map((line) => `  ${line}`).join("\n");
        return `${heading}\n${body}`;
      }).join("\n\n");
    }
  }

  const pretty = JSON.stringify(value, null, 2) ?? String(value);
  return highlightCode(pretty, "json").join("\n");
}

function highlightCached(state: ToolRowState, lang: string, code: string, theme: Theme): string[] {
  const key = `${lang}\0${code}`;
  if (state.highlight?.key === key && state.highlight.theme === theme) {
    return state.highlight.lines;
  }
  const lines = highlightCode(code, lang);
  state.highlight = { key, theme, lines };
  return lines;
}

function startTimer(context: ToolRenderContext<ToolRowState>): void {
  const state = context.state;
  if (context.executionStarted && state.startedAt === undefined) {
    state.startedAt = Date.now();
    state.endedAt = undefined;
  }
}

function formatElapsedDuration(ms: number): string {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainder = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${remainder}s`;
}

function resolveTimerText(context: ToolRenderContext<ToolRowState>, isPartial: boolean): string | undefined {
  const state = context.state;
  if (state.startedAt !== undefined && isPartial && !state.interval) {
    state.interval = setInterval(() => context.invalidate(), 1000);
    state.interval.unref?.();
  }
  if (!isPartial || context.isError) {
    state.endedAt ??= Date.now();
    if (state.interval) {
      clearInterval(state.interval);
      state.interval = undefined;
    }
  }
  if (!isPartial && context.durationMs !== undefined) {
    return `Took ${formatElapsedDuration(context.durationMs)}`;
  }
  if (state.startedAt === undefined) return undefined;
  const endTime = state.endedAt ?? Date.now();
  return `${isPartial ? "Elapsed" : "Took"} ${formatElapsedDuration(endTime - state.startedAt)}`;
}

function expandMoreHint(
  theme: Theme,
  context: Pick<ToolRenderContext, "keyHint">,
  hidden: number,
  noun: string,
): string {
  return `${theme.fg("muted", `... (+${hidden} ${noun},`)} ${context.keyHint("app.tools.expand", "to expand")}${theme.fg("muted", ")")}`;
}

class PreviewLines implements Component {
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(
    private readonly text: string,
    private readonly maxVisualLines: number,
    private readonly formatHint: (hidden: number) => string,
  ) {}

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    const { visualLines, skippedCount } = truncateToVisualLines(
      this.text,
      this.maxVisualLines,
      width,
      0,
      "start",
    );
    const lines = skippedCount > 0 ? [...visualLines, this.formatHint(skippedCount)] : visualLines;
    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }
}

class CodemodeCallView implements Component {
  private readonly text = new Text("", 0, 0);
  private args: { code?: unknown } | undefined;
  private theme!: Theme;
  private context!: ToolRenderContext<ToolRowState>;

  update(args: { code?: unknown } | undefined, theme: Theme, context: ToolRenderContext<ToolRowState>): this {
    this.args = args;
    this.theme = theme;
    this.context = context;
    this.text.invalidate();
    return this;
  }

  render(width: number): string[] {
    const { args, theme, context } = this;
    const state = context.state;
    const code = readStringArg(args?.code);
    const title = theme.fg("toolTitle", theme.bold("codemode"));
    if (code === null) {
      this.text.setText(`${title} ${theme.fg("error", "[invalid arg]")}`);
      return this.text.render(width);
    }

    const normalized = code.replace(/\r/g, "").replace(/\t/g, "   ").trimEnd();
    const rawLines = normalized ? normalized.split("\n") : [];
    const marker = theme.fg("muted", context.expanded ? "▾" : "▸");
    const meta: string[] = [];
    const callCount = state.callCount ?? 0;
    if (callCount > 0) meta.push(`${callCount} ${callCount === 1 ? "call" : "calls"}`);
    if (rawLines.length > 0) meta.push(`${rawLines.length} ${rawLines.length === 1 ? "line" : "lines"}`);
    if (!context.expanded) meta.push(context.keyText("app.tools.expand") || "ctrl+o");
    const header = `${marker} ${title}${meta.length > 0 ? theme.fg("dim", ` · ${meta.join(" · ")}`) : ""}`;

    if (rawLines.length === 0 || (!context.expanded && callCount > 0)) {
      this.text.setText(header);
      return this.text.render(width);
    }

    const highlighted = highlightCached(state, "javascript", normalized, theme);
    const rail = theme.fg("borderMuted", "  │ ");
    if (context.expanded) {
      this.text.setText([header, ...highlighted.map((line) => `${rail}${line}`)].join("\n"));
      return this.text.render(width);
    }

    const shown = highlighted.slice(0, CODEMODE_SCRIPT_PREVIEW_LINES).map((line) => `${rail}${line}`);
    const hidden = highlighted.length - shown.length;
    if (hidden > 0) {
      shown.push(`  ${expandMoreHint(theme, context, hidden, "script lines")}`);
    }
    this.text.setText([header, ...shown].join("\n"));
    return this.text.render(width);
  }

  invalidate(): void {
    this.text.invalidate();
  }
}

function extractCodemodeOutput(
  result: { content: readonly { type: string; text?: string; mimeType?: string }[] },
  showImages: boolean,
): string {
  const [first, ...rest] = result.content;
  const hasHeader = first?.type === "text" && typeof first.text === "string" && SCRIPT_HEADER.test(first.text);
  const blocks = hasHeader ? rest : result.content;
  const textParts = blocks
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => stripVTControlCharacters(block.text!).replace(/\r/g, ""));
  if (!showImages) {
    for (const block of blocks) {
      if (block.type === "image") {
        textParts.push(`[image: ${block.mimeType ?? "image/unknown"}]`);
      }
    }
  }
  return textParts.join("\n").trim();
}

export function createCodemodeRenderers(): ToolRenderers {
  return {
    renderCall(args: { code?: unknown } | undefined, theme: Theme, context: ToolRenderContext<ToolRowState>) {
      startTimer(context);
      context.state.callCount = 0;
      const view = context.lastComponent instanceof CodemodeCallView
        ? context.lastComponent
        : new CodemodeCallView();
      return view.update(args, theme, context);
    },

    renderResult(
      result,
      options: ToolRenderResultOptions,
      theme: Theme,
      context: ToolRenderContext<ToolRowState>,
    ) {
      const details = result.details as CodemodeToolDetails | undefined;
      const calls = details?.calls ?? [];
      context.state.callCount = calls.length;
      const timerText = resolveTimerText(context, options.isPartial);
      const container = context.lastComponent instanceof Container ? context.lastComponent : new Container();
      container.clear();

      if (calls.length > 0) {
        const shown = options.expanded ? calls : calls.slice(-CODEMODE_CALL_PREVIEW_COUNT);
        const lines = shown.map((call) => formatNestedCall(call, theme, context.cwd, options.expanded));
        if (shown.length < calls.length) {
          lines.unshift(`  ${expandMoreHint(theme, context, calls.length - shown.length, "earlier calls")}`);
        }
        const priced = calls.filter((call) => call.cost);
        if (priced.length > 1) {
          const total = priced.reduce((sum, call) => sum + (call.cost ?? 0), 0);
          lines.push(`  ${theme.fg("muted", `Model calls: ${formatCost(total)}`)}`);
        }
        container.addChild(new Spacer(1));
        container.addChild(new Text(lines.join("\n"), 0, 0));
      }

      const output = options.isPartial ? "" : extractCodemodeOutput(result, context.showImages);
      let timerMerged = false;

      if (output) {
        if (context.isError) {
          const styled = output.replace(/\t/g, "   ").split("\n").map((line) => theme.fg("error", line)).join("\n");
          container.addChild(new Spacer(1));
          container.addChild(options.expanded
            ? new Text(styled, 0, 0)
            : new PreviewLines(styled, 6, (hidden) => expandMoreHint(theme, context, hidden, "lines")));
        } else if (options.expanded) {
          container.addChild(new Spacer(1));
          container.addChild(new Text(formatExpandedCodemodeOutput(output, theme), 0, 0));
        } else {
          const summary = calls.length > 0 ? summarizeCodemodeOutput(output) : undefined;
          if (summary && !details?.fullOutputPath) {
            const suffix = timerText ? theme.fg("dim", ` · ${timerText}`) : "";
            container.addChild(new Spacer(1));
            container.addChild(new Text(`  ${theme.fg("muted", `↳ ${summary}`)}${suffix}`, 0, 0));
            timerMerged = true;
          } else {
            const parsed = calls.length === 0 ? parseJsonValue(output) : { ok: false as const };
            const indent = calls.length > 0 ? "  " : "";
            const styled = parsed.ok
              ? highlightCode(JSON.stringify(parsed.value, null, 2) ?? output, "json")
                  .map((line) => `${indent}${line}`)
                  .join("\n")
              : output.replace(/\t/g, "   ").split("\n")
                  .map((line) => `${indent}${theme.fg("toolOutput", line)}`)
                  .join("\n");
            container.addChild(new Spacer(1));
            container.addChild(new PreviewLines(
              styled,
              CODEMODE_OUTPUT_PREVIEW_LINES,
              (hidden) => `${indent}${expandMoreHint(theme, context, hidden, "lines")}`,
            ));
            if (details?.fullOutputPath) {
              container.addChild(new Text(`${indent}${theme.fg("muted", `Full output: ${details.fullOutputPath}`)}`, 0, 0));
            }
          }
        }
      }

      if (timerText && !timerMerged) {
        const prefix = calls.length > 0 ? "  " : "";
        container.addChild(new Spacer(1));
        container.addChild(new Text(`${prefix}${theme.fg("muted", timerText)}`, 0, 0));
      }

      return container;
    },
  };
}

export function renderBashCall(
  args: { command?: unknown; timeout?: unknown } | undefined,
  theme: Theme,
  context: ToolRenderContext<ToolRowState>,
): Component {
  startTimer(context);
  const view = context.lastComponent instanceof Text ? context.lastComponent : new Text("", 0, 0);
  const command = readStringArg(args?.command);
  const timeout = typeof args?.timeout === "number" && Number.isFinite(args.timeout)
    ? theme.fg("muted", ` (timeout ${args.timeout}s)`)
    : "";
  const prompt = theme.fg("toolTitle", theme.bold("$"));

  if (command === null) {
    view.setText(`${prompt} ${theme.fg("error", "[invalid arg]")}${timeout}`);
    return view;
  }
  const normalized = command.replace(/\r/g, "").replace(/\t/g, "   ").trimEnd();
  if (!normalized) {
    view.setText(`${prompt} ${theme.fg("toolOutput", "...")}${timeout}`);
    return view;
  }

  const highlighted = highlightCached(context.state, "bash", normalized, theme);
  if (highlighted.length === 1) {
    view.setText(`${prompt} ${highlighted[0]}${timeout}`);
    return view;
  }

  const rail = theme.fg("borderMuted", "  │ ");
  const limit = context.expanded ? highlighted.length : BASH_CALL_PREVIEW_LINES;
  const shown = highlighted.slice(0, limit);
  const lines = [
    `${prompt} ${shown[0]}${timeout}`,
    ...shown.slice(1).map((line) => `${rail}${line}`),
  ];
  if (shown.length < highlighted.length) {
    lines.push(`  ${expandMoreHint(theme, context, highlighted.length - shown.length, "script lines")}`);
  }
  view.setText(lines.join("\n"));
  return view;
}

export function createReadableToolResolver(): ToolRendererResolver {
  const codemode = createCodemodeRenderers();
  return (toolName, next) => {
    if (toolName === "codemode") {
      const base = next();
      return { ...base, ...codemode };
    }
    if (toolName === "bash") {
      const base = next();
      return { ...base, renderCall: renderBashCall };
    }
    return next();
  };
}

export function registerReadableTranscript(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setHiddenThinkingLabel(HIDDEN_THINKING_LABEL);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setHiddenThinkingLabel();
  });

  pi.registerMarkdownTransformer(
    (markdown, { isStreaming }) => formatThinkingMarkdown(markdown, isStreaming),
    { messageTypes: ["assistant-thinking"] },
  );

  pi.registerToolRenderer(createReadableToolResolver());
}

export default function readableTranscript(pi: ExtensionAPI): void {
  registerReadableTranscript(pi);
}
