import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  CONFIG_DIR_NAME,
  FooterComponent,
  getAgentDir,
  keyText,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
  type ReadonlyFooterDataProvider,
  type SourceInfo,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";

export interface ExtensionDescriptor {
  path: string;
  label: string;
}

type UiTheme = Pick<Theme, "bold" | "fg">;
type RegisterOptions = { agentDir?: string; version?: string };
type Source = Pick<SourceInfo, "path" | "source">;

function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return resolve(path);
  }
}

function extensionFile(name: string): boolean {
  return name.endsWith(".ts") || name.endsWith(".js");
}

function manifestEntries(directory: string): string[] | undefined {
  const manifestPath = join(directory, "package.json");
  if (!existsSync(manifestPath)) return undefined;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      pi?: { extensions?: unknown };
    };
    if (!Array.isArray(manifest.pi?.extensions)) return undefined;
    const entries = manifest.pi.extensions
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => resolve(directory, entry))
      .filter(existsSync);
    return entries.length > 0 ? entries : undefined;
  } catch {
    return undefined;
  }
}

function directoryEntries(directory: string): string[] {
  const manifest = manifestEntries(directory);
  if (manifest) return manifest;
  for (const name of ["index.ts", "index.js"]) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return [candidate];
  }
  return [];
}

/** Mirror Pi's one-level standard extension discovery without evaluating modules. */
export function discoverExtensionEntries(directory: string): string[] {
  if (!existsSync(directory)) return [];
  try {
    const discovered: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if ((entry.isFile() || entry.isSymbolicLink()) && extensionFile(entry.name)) {
        discovered.push(path);
      } else if (entry.isDirectory() || entry.isSymbolicLink()) {
        discovered.push(...directoryEntries(path));
      }
    }
    return discovered;
  } catch {
    return [];
  }
}

function npmLabel(source: Source): string | undefined {
  if (source.source.startsWith("npm:")) return source.source.slice(4);
  if (!source.path.includes("node_modules")) return undefined;
  let directory = dirname(source.path);
  for (let depth = 0; depth < 8; depth++) {
    const manifestPath = join(directory, "package.json");
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
          name?: unknown;
          version?: unknown;
          pi?: { extensions?: unknown };
        };
        if (typeof manifest.name === "string" && Array.isArray(manifest.pi?.extensions)) {
          return typeof manifest.version === "string"
            ? `${manifest.name}@${manifest.version}`
            : manifest.name;
        }
      } catch {
        return undefined;
      }
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

function pathLabel(path: string): string {
  let directory = dirname(path);
  for (let depth = 0; depth < 6; depth++) {
    const entries = manifestEntries(directory);
    if (entries?.some((entry) => canonical(entry) === canonical(path))) {
      try {
        const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { name?: unknown };
        if (typeof manifest.name === "string") return manifest.name;
      } catch {}
      return basename(directory);
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  const file = basename(path);
  return file === "index.ts" || file === "index.js" ? basename(dirname(path)) : file;
}

export function extensionDescriptors(
  pi: Pick<ExtensionAPI, "getAllTools" | "getCommands">,
  ctx: Pick<ExtensionContext, "cwd" | "isProjectTrusted">,
  agentDir = getAgentDir(),
): ExtensionDescriptor[] {
  const descriptors = new Map<string, ExtensionDescriptor>();
  const add = (path: string, source?: Source) => {
    // Pi's own startup list hides synthetic sources, including built-ins such as `builtin:mcp`.
    if (!path || path.startsWith("<") || path.startsWith("builtin:")) return;
    const key = canonical(path);
    const label = source ? npmLabel(source) ?? pathLabel(path) : pathLabel(path);
    if (!descriptors.has(key)) descriptors.set(key, { path, label });
  };

  for (const path of discoverExtensionEntries(join(agentDir, "extensions"))) add(path);
  if (ctx.isProjectTrusted()) {
    for (const path of discoverExtensionEntries(join(ctx.cwd, CONFIG_DIR_NAME, "extensions"))) add(path);
  }
  for (const command of pi.getCommands()) {
    if (command.source === "extension") add(command.sourceInfo.path, command.sourceInfo);
  }
  for (const tool of pi.getAllTools()) {
    const source = tool.sourceInfo;
    if (source.source !== "builtin" && source.source !== "sdk") add(source.path, source);
  }

  return [...descriptors.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Read only the path attributes Pi already placed in its active system prompt. */
export function contextPaths(systemPrompt: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const pattern = /<project_instructions path="([^"]+)">/g;
  for (const match of systemPrompt.matchAll(pattern)) {
    const path = match[1]!;
    if (!seen.has(path)) {
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

export class StartupSummary {
  private expanded = false;

  constructor(
    private readonly theme: UiTheme,
    private readonly contexts: string[],
    private readonly extensions: ExtensionDescriptor[],
    private readonly version: string,
  ) {}

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
  }

  render(width: number): string[] {
    const dim = (text: string) => this.theme.fg("dim", text);
    const heading = (text: string) => this.theme.fg("mdHeading", text);
    const logo = this.theme.bold(this.theme.fg("accent", "pi")) + dim(` v${this.version}`);
    const contextNames = this.contexts.length > 0
      ? this.contexts.map((path) => basename(path)).join(", ")
      : "none";
    const marker = this.expanded ? "▾" : "▸";
    const summary = `${marker} ${logo}${dim(" · ")}${heading("Context:")} ${dim(contextNames)}`
      + `${dim(" · ")}${heading("Extensions:")} ${dim(String(this.extensions.length))}`
      + dim(` · ${keyText("app.tools.expand") || "ctrl+o"}`);
    const fit = (line: string) => truncateToWidth(line, Math.max(0, width), "");
    if (!this.expanded) return [fit(summary)];

    const section = (title: string, entries: string[]) => [
      heading(`[${title}]`),
      ...(entries.length > 0 ? entries.map((entry) => dim(`  ${entry}`)) : [dim("  none")]),
    ];
    const lines = [
      summary,
      ...section("Context", this.contexts),
      "",
      ...section("Extensions", this.extensions.map((extension) => extension.label)),
    ];
    return lines.map(fit);
  }

  invalidate(): void {}
}

export interface McpCounts {
  enabled: number;
  total: number;
}

type McpServerLike = { enabled?: unknown };
type RegisteredMcpServerLike = { name: string; config: McpServerLike };

const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/;

/** Entries Pi's built-in MCP loader keeps: a valid name with a stdio `command` or an HTTP `url`. */
function mcpServerEntries(path: string): [string, McpServerLike][] {
  try {
    const servers = (JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: unknown } | null)?.mcpServers;
    if (!servers || typeof servers !== "object" || Array.isArray(servers)) return [];
    return Object.entries(servers).filter((entry): entry is [string, McpServerLike] => {
      const [name, value] = entry;
      if (!MCP_SERVER_NAME.test(name) || !value || typeof value !== "object" || Array.isArray(value)) return false;
      const server = value as { command?: unknown; url?: unknown; type?: unknown };
      return server.type !== "sse" && (typeof server.command === "string" || typeof server.url === "string");
    });
  } catch {
    return [];
  }
}

/**
 * Count servers as Pi's built-in MCP support merges them: later files (the trusted project's
 * `.pi/mcp.json`) replace earlier entries of the same name, extension-registered servers count
 * unless a file defines their name, and `enabled: false` disables a server.
 */
export function mcpCounts(
  configPaths: readonly string[],
  registered: readonly RegisteredMcpServerLike[] = [],
): McpCounts {
  const servers = new Map<string, McpServerLike>();
  for (const path of configPaths) {
    for (const [name, config] of mcpServerEntries(path)) servers.set(name, config);
  }
  for (const { name, config } of registered) {
    if (!servers.has(name)) servers.set(name, config);
  }
  let enabled = 0;
  for (const config of servers.values()) if (config.enabled !== false) enabled++;
  return { enabled, total: servers.size };
}

function fileSignature(path: string): string {
  try {
    const stats = statSync(path);
    return `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return "missing";
  }
}

/**
 * The footer asks on every render, so recount only when a config file or the registered servers
 * change. `/mcp` saves enable/disable toggles to the file that defines the server.
 */
export function createMcpCounter(
  configPaths: () => readonly string[],
  registered: () => readonly RegisteredMcpServerLike[],
): () => McpCounts {
  let key: string | undefined;
  let counts: McpCounts = { enabled: 0, total: 0 };
  return () => {
    const paths = configPaths();
    const servers = registered();
    const next = JSON.stringify([
      paths.map((path) => [path, fileSignature(path)]),
      servers.map(({ name, config }) => [name, config.enabled]),
    ]);
    if (next !== key) {
      key = next;
      counts = mcpCounts(paths, servers);
    }
    return counts;
  };
}

/** Keep Pi's native footer, but reserve its right edge for the MCP server count. */
export class McpAlignedFooter implements Component {
  private readonly native: FooterComponent;

  constructor(
    private readonly ctx: ExtensionContext,
    private readonly footerData: ReadonlyFooterDataProvider,
    private readonly mcpStatus: () => string | undefined,
  ) {
    const sessionView = {
      get state() {
        return { model: ctx.model, thinkingLevel: ctx.thinkingLevel };
      },
      sessionManager: ctx.sessionManager,
      getContextUsage: () => ctx.getContextUsage(),
      modelRuntime: {
        isUsingSubscription: (provider: string) => {
          const model = ctx.model;
          return model?.provider === provider && ctx.modelRegistry.isUsingOAuth(model);
        },
      },
    };
    this.native = new FooterComponent(sessionView as never, footerData);
  }

  render(width: number): string[] {
    const lines = this.native.render(width);
    const mcp = this.mcpStatus();
    if (mcp === undefined) return lines;

    // Pi renders extension statuses as the footer's last line; share it with the MCP count.
    const left = this.footerData.getExtensionStatuses().size > 0 ? lines.pop() ?? "" : "";
    const right = truncateToWidth(mcp, Math.max(0, width), "");
    if (right.length === 0) {
      lines.push("");
      return lines;
    }
    const rightWidth = visibleWidth(right);
    const availableLeft = Math.max(0, width - rightWidth - (left ? 1 : 0));
    const fittedLeft = truncateToWidth(left, availableLeft, "");
    const spacing = Math.max(0, width - visibleWidth(fittedLeft) - rightWidth);
    lines.push(`${fittedLeft}${" ".repeat(spacing)}${right}`);
    return lines;
  }

  invalidate(): void {
    this.native.invalidate();
  }

  dispose(): void {
    this.native.dispose();
  }
}

export function registerCompactUi(pi: ExtensionAPI, options: RegisterOptions = {}): void {
  let restoreFooter: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    restoreFooter?.();
    restoreFooter = undefined;
    if (ctx.mode !== "tui") return;
    const agentDir = options.agentDir ?? getAgentDir();
    const countMcp = createMcpCounter(
      () => [
        join(agentDir, "mcp.json"),
        ...(ctx.isProjectTrusted() ? [join(ctx.cwd, CONFIG_DIR_NAME, "mcp.json")] : []),
      ],
      () => pi.getMcpServers(),
    );
    const mcpStatus = () => {
      const { enabled, total } = countMcp();
      return total > 0 ? ctx.ui.theme.fg("dim", `MCP: ${enabled}/${total}`) : undefined;
    };
    const ui = ctx.ui;
    ui.setFooter((_tui, _theme, footerData) => new McpAlignedFooter(ctx, footerData, mcpStatus));
    restoreFooter = () => ui.setFooter(undefined);
    const contexts = contextPaths(ctx.getSystemPrompt());
    const extensions = extensionDescriptors(pi, ctx, agentDir);
    ctx.ui.setHeader((_tui, theme) => new StartupSummary(
      theme,
      contexts,
      extensions,
      options.version ?? VERSION,
    ));
  });

  pi.on("session_shutdown", () => {
    restoreFooter?.();
    restoreFooter = undefined;
  });
}

export default function compactUi(pi: ExtensionAPI): void {
  registerCompactUi(pi);
}
