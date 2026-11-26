import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { stripVTControlCharacters } from "node:util";
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
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface ExtensionDescriptor {
  path: string;
  label: string;
}

type UiTheme = Pick<Theme, "bold" | "fg">;
type RegisterOptions = { agentDir?: string; version?: string; footer?: FooterClass };
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

/** Pi's own footer folder: the home folder shown as `~`. */
function footerCwd(cwd: string, home = process.env.HOME || process.env.USERPROFILE): string {
  if (!home) return cwd;
  const inHome = relative(resolve(home), resolve(cwd));
  const inside = inHome === "" || (inHome !== ".." && !inHome.startsWith(`..${sep}`) && !isAbsolute(inHome));
  if (!inside) return cwd;
  return inHome === "" ? "~" : `~${sep}${inHome}`;
}

/**
 * Pi's folder line, `~/dotfiles (main) • name`, with the folder in teal and the branch in green.
 * Separators stay dim. Pi's own line is kept if it shows anything else.
 */
export function colourPath(
  native: string,
  parts: { cwd: string; branch: string | null; sessionName?: string },
  theme: UiTheme,
): string {
  const dim = (text: string) => theme.fg("dim", text);
  let line = theme.fg("syntaxVariable", footerCwd(parts.cwd));
  if (parts.branch) line += dim(" (") + theme.fg("success", parts.branch) + dim(")");
  if (parts.sessionName) line += dim(" • ") + parts.sessionName;
  return stripVTControlCharacters(line) === stripVTControlCharacters(native) ? line : native;
}

/** Pi's usage line split into the usage figures on its left and the model on its right. */
export function splitStatsLine(native: string): { stats: string; model: string } {
  const plain = stripVTControlCharacters(native);
  // Pi pads at least two spaces between the usage figures and the right-aligned model.
  const split = /^(.*?) {2,}(.*)$/.exec(plain);
  return split ? { stats: split[1]!, model: split[2]! } : { stats: plain, model: "" };
}

const TOKEN_COUNT = /^([↑↓RW])(\d+(?:\.\d+)?[kM]?)$/;
const CACHE_HIT = /^CH(\d+(?:\.\d+)?%)$/;
const COST = /^\$\d+\.\d+$/;
const CONTEXT = /^(\d+(?:\.\d+)?)%(\/\S+)$/;

/**
 * Pi's usage figures, styled like the extension statuses: each value bold in its own colour,
 * labels and separators dim. Token counts are blue, cost orange and the context share green
 * (yellow over 70%, red over 90%, as Pi warns). Words it does not recognise stay dim, as Pi
 * draws them.
 */
export function colourStats(stats: string, theme: UiTheme): string {
  const dim = (text: string) => theme.fg("dim", text);
  const value = (color: Parameters<UiTheme["fg"]>[0], text: string) => theme.fg(color, theme.bold(text));
  const words = stats.split(" ");
  return words.map((word, index) => {
    let match: RegExpExecArray | null;
    if ((match = TOKEN_COUNT.exec(word))) return dim(match[1]!) + value("mdLink", match[2]!);
    if ((match = CACHE_HIT.exec(word))) return dim("CH") + value("mdLink", match[1]!);
    if (COST.test(word)) return value("syntaxString", word);
    if ((match = CONTEXT.exec(word))) {
      const percent = Number(match[1]);
      const color = percent > 90 ? "error" : percent > 70 ? "warning" : "success";
      return value(color, `${match[1]}%`) + dim(match[2]!);
    }
    if (word === "xp" && words[index - 1] === "•") return value("warning", word);
    return dim(word);
  }).join(dim(" "));
}

/** `(provider) model • level`: provider dim, model violet, thinking level yellow. */
export function colourModel(model: string, theme: UiTheme): string {
  const dim = (text: string) => theme.fg("dim", text);
  let line = "";
  let rest = model;
  const provider = /^(\([^)]*\) )(.*)$/.exec(model);
  if (provider) {
    line += dim(provider[1]!);
    rest = provider[2]!;
  }
  // A virtual model adds ` → model • level` for where the latest response went.
  return line + rest.split(" → ").map((part) => {
    if (!part) return "";
    const [name, ...levels] = part.split(" • ");
    return theme.fg("accent", name!) + levels.map((level) =>
      dim(" • ") + (level === "thinking off" ? dim(level) : theme.fg("mdHeading", level))).join("");
  }).join(dim(" → "));
}

/**
 * One footer row: `left` at the left edge, and at the right edge the first of `rights` that fits
 * beside it with at least two spaces between. When none fits, the right part moves to its own
 * row below, still right-aligned, so nothing is lost on a narrow terminal.
 */
export function footerRow(left: string, rights: readonly string[], width: number, ellipsis: string): string[] {
  const fit = (text: string) => truncateToWidth(text, Math.max(0, width), ellipsis);
  const alignRight = (text: string) => " ".repeat(Math.max(0, width - visibleWidth(text))) + text;
  const options = rights.filter((right) => right.length > 0);
  if (options.length === 0) return left ? [fit(left)] : [];
  if (!left) return [alignRight(options.find((right) => visibleWidth(right) <= width) ?? fit(options.at(-1)!))];
  for (const right of options) {
    const gap = width - visibleWidth(left) - visibleWidth(right);
    if (gap >= 2) return [left + " ".repeat(gap) + right];
  }
  return [fit(left), ...footerRow("", options, width, ellipsis)];
}

/** Pi draws its footer this wide so nothing is cut; `layoutFooter` fits the parts itself. */
const UNCUT_WIDTH = 1000;

/**
 * Pi's footer lines, drawn at `UNCUT_WIDTH`, in two coloured rows: the folder with the model on
 * the right, then the extension statuses with the usage figures on the right. A row too wide for
 * the terminal splits in two.
 */
export function layoutFooter(
  lines: readonly string[],
  parts: { cwd: string; branch: string | null; sessionName?: string },
  theme: UiTheme,
  width: number,
): string[] {
  // Pi's lines: folder, usage figures with the model, then extension statuses (if any).
  const [pathLine = "", statsLine = "", statusLine = ""] = lines;
  const { stats, model } = splitStatsLine(statsLine);
  // Like Pi, drop the provider before anything else when the model does not fit.
  const withoutProvider = model.replace(/^\([^)]*\) /, "");
  const models = withoutProvider === model ? [model] : [model, withoutProvider];
  const ellipsis = theme.fg("dim", "...");
  return [
    ...footerRow(colourPath(pathLine, parts, theme), models.map((text) => colourModel(text, theme)), width, ellipsis),
    ...footerRow(statusLine, [colourStats(stats, theme)], width, ellipsis),
  ];
}

type FooterRender = (this: unknown, width: number) => string[];
type FooterClass = { prototype: object };
/** The fields of Pi's own footer that the layout reads. */
type NativeFooter = {
  session?: { sessionManager?: { getCwd(): string; getSessionName(): string | undefined } };
  footerData?: Pick<ReadonlyFooterDataProvider, "getGitBranch">;
};
interface FooterPatch {
  original: FooterRender;
  /** The loaded extension's drawing code; a reload replaces it, the wrapper stays. */
  draw: (footer: unknown, width: number, original: FooterRender) => string[];
}

const FOOTER_PATCH = Symbol.for("dotfiles.compact-ui.footer");
// Pi keeps its theme here so every module loader sees the same one (see Pi's theme.js).
const PI_THEME = Symbol.for("@earendil-works/pi-coding-agent:theme");

/** Pi's current theme, from before the first session starts (when no `ctx` has one yet). */
function piTheme(): UiTheme | undefined {
  return (globalThis as Record<symbol, UiTheme | undefined>)[PI_THEME];
}

/**
 * Give Pi's own footer the two-row layout, by wrapping its class's `render`.
 *
 * Not `ctx.ui.setFooter`: Pi removes every extension footer while it replaces a session (`/new`,
 * `/resume`, `/fork`, `/reload`) and shows its own three-line footer until the new session's
 * extensions start. Pi's own footer stays through that, so changing it keeps the footer still.
 * Extensions share Pi's modules, so this is the class Pi draws. It is wrapped once per process;
 * a reloaded extension swaps in its own drawing code and theme. Anything unexpected draws Pi's
 * footer unchanged.
 */
export function installFooterLayout(target: FooterClass, theme: () => UiTheme | undefined): void {
  const draw: FooterPatch["draw"] = (self, width, original) => {
    const footer = self as NativeFooter;
    const sessionManager = footer.session?.sessionManager;
    const currentTheme = theme();
    if (!currentTheme || !sessionManager || !footer.footerData) return original.call(self, width);
    try {
      return layoutFooter(original.call(self, UNCUT_WIDTH), {
        cwd: sessionManager.getCwd(),
        branch: footer.footerData.getGitBranch(),
        sessionName: sessionManager.getSessionName(),
      }, currentTheme, width);
    } catch {
      return original.call(self, width);
    }
  };
  const prototype = target.prototype as { render: FooterRender; [FOOTER_PATCH]?: FooterPatch };
  const existing = prototype[FOOTER_PATCH];
  if (existing) {
    existing.draw = draw;
    return;
  }
  const patch: FooterPatch = { original: prototype.render, draw };
  prototype.render = function render(this: unknown, width: number): string[] {
    return patch.draw(this, width, patch.original);
  };
  prototype[FOOTER_PATCH] = patch;
}

/** Put Pi's own footer `render` back (tests; Pi itself keeps the layout until it exits). */
export function removeFooterLayout(target: FooterClass): void {
  const prototype = target.prototype as { render: FooterRender; [FOOTER_PATCH]?: FooterPatch };
  const patch = prototype[FOOTER_PATCH];
  if (!patch) return;
  prototype.render = patch.original;
  delete prototype[FOOTER_PATCH];
}

export function registerCompactUi(pi: ExtensionAPI, options: RegisterOptions = {}): void {
  // Before the first session starts there is no `ctx`; read Pi's theme directly until then.
  let sessionTheme: UiTheme | undefined;
  installFooterLayout(options.footer ?? FooterComponent, () => sessionTheme ?? piTheme());

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    sessionTheme = ctx.ui.theme;
    const agentDir = options.agentDir ?? getAgentDir();
    const contexts = contextPaths(ctx.getSystemPrompt());
    const extensions = extensionDescriptors(pi, ctx, agentDir);
    ctx.ui.setHeader((_tui, theme) => new StartupSummary(
      theme,
      contexts,
      extensions,
      options.version ?? VERSION,
    ));
  });
}

export default function compactUi(pi: ExtensionAPI): void {
  registerCompactUi(pi);
}
