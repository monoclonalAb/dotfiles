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
const IO_TOKEN_COUNT = /^[↑↓]\d+(?:\.\d+)?[kM]?$/;
const CACHE_TOKEN_COUNT = /^[RW]\d+(?:\.\d+)?[kM]?$/;
const CACHE_HIT = /^CH(\d+(?:\.\d+)?%)$/;
const COST = /^\$\d+\.\d+$/;
const CONTEXT = /^(\d+(?:\.\d+)?)%(\/\S+)$/;
const STATIC_STAT_TAGS = new Set(["(sub)", "(auto)"]);

function trimStatWord(word: string): string {
  let match: RegExpExecArray | null;
  if ((match = CACHE_HIT.exec(word))) return `CH${Math.round(Number(match[1]!.slice(0, -1)))}%`;
  if (COST.test(word)) return `$${Number(word.slice(1)).toFixed(2)}`;
  if ((match = CONTEXT.exec(word))) {
    const percent = match[1]!.replace(/\.0+$/, "");
    const limit = match[2]!.replace(/\.0+(?=[kM]?$)/, "");
    return `${percent}%${limit}`;
  }
  return word;
}

/**
 * Progressive compact variants of Pi's usage figures, from full down to essentials:
 * 1. `full`: Pi's exact text
 * 2. `trimmed`: drops static `(sub)`/`(auto)` tags and trims extra decimals
 * 3. `noCacheRw`: drops raw `R…`/`W…` cache counts (`CH…%` summarizes caching)
 * 4. `noIo`: drops `↑…`/`↓…` token counts
 * 5. `essential`: keeps cost, context share, and any unrecognised words
 */
export function compactStats(stats: string): {
  full: string;
  trimmed: string;
  noCacheRw: string;
  noIo: string;
  essential: string;
} {
  if (!stats) return { full: "", trimmed: "", noCacheRw: "", noIo: "", essential: "" };
  const words = stats.split(" ").filter((word) => word.length > 0);
  const trimmedWords = words.filter((word) => !STATIC_STAT_TAGS.has(word)).map(trimStatWord);
  const noCacheRwWords = trimmedWords.filter((word) => !CACHE_TOKEN_COUNT.test(word));
  const noIoWords = noCacheRwWords.filter((word) => !IO_TOKEN_COUNT.test(word));
  const essentialWords = noIoWords.filter((word) => !CACHE_HIT.test(word));
  return {
    full: stats,
    trimmed: trimmedWords.join(" "),
    noCacheRw: noCacheRwWords.join(" "),
    noIo: noIoWords.join(" "),
    essential: essentialWords.join(" "),
  };
}

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

/**
 * `(provider) model • level`: provider dim, model violet, thinking level yellow. A model status
 * (codex-fast's `fast`) goes right after the model name, bold orange like the cost.
 */
export function colourModel(model: string, theme: UiTheme, modelStatus = ""): string {
  const dim = (text: string) => theme.fg("dim", text);
  let line = "";
  let rest = model;
  const provider = /^(\([^)]*\) )(.*)$/.exec(model);
  if (provider) {
    line += dim(provider[1]!);
    rest = provider[2]!;
  }
  const status = modelStatus ? dim(" • ") + theme.fg("syntaxString", theme.bold(modelStatus)) : "";
  // A virtual model adds ` → model • level` for where the latest response went.
  return line + rest.split(" → ").map((part, index) => {
    if (!part) return "";
    const [name, ...levels] = part.split(" • ");
    return theme.fg("accent", name!) + (index === 0 ? status : "") + levels.map((level) =>
      dim(" • ") + (level === "thinking off" ? dim(level) : theme.fg("mdHeading", level))).join("");
  }).join(dim(" → "));
}

/** The extension status drawn beside the model instead of in the status row: codex-fast's `fast`. */
export const MODEL_STATUS_KEY = "codex-fast";
const QUOTA_ROUTER_KEY = "quota-router";
const SELECTIVE_SKILLS_KEY = "selective-skills";
const TOKEN_SPEED_KEY = "token-speed";

/** A status on one line, as Pi shows it. */
const oneLine = (text: string) => text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();

/** Pi's status row: the extension statuses sorted by key, each on one line, joined by spaces. */
export function statusRow(statuses: ReadonlyMap<string, string>): string {
  return [...statuses].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => oneLine(text)).join(" ");
}

/**
 * Compacted extension status row: hides the default `· @main` account label (keeping switched
 * accounts such as `@work`), shortens `N skills` → `Ns` and `tok/s` → `t/s` while preserving
 * ANSI styling, and optionally drops the skill count on very narrow terminals.
 */
export function compactStatuses(
  statuses: ReadonlyMap<string, string>,
  options: { dropModelStatus?: boolean; dropSkills?: boolean } = {},
): string {
  const next = new Map<string, string>();
  for (const [key, raw] of statuses) {
    if (options.dropModelStatus && key === MODEL_STATUS_KEY) continue;
    const text = oneLine(raw);
    if (key === QUOTA_ROUTER_KEY && stripVTControlCharacters(text) === "· @main") continue;
    if (key === SELECTIVE_SKILLS_KEY) {
      if (options.dropSkills) continue;
      next.set(key, text.replace(/ skills?\b/, "s"));
      continue;
    }
    if (key === TOKEN_SPEED_KEY) {
      next.set(key, text.replace(/ tok\/s\b/, "t/s"));
      continue;
    }
    next.set(key, text);
  }
  return statusRow(next);
}

/**
 * Pi's status row without the model status, and that status. If Pi's row is not the one these
 * statuses make (Pi changed how it draws them), it is kept whole and nothing moves.
 */
export function takeModelStatus(
  statusLine: string,
  statuses: ReadonlyMap<string, string> | undefined,
): { statusLine: string; modelStatus: string } {
  const modelStatus = statuses?.get(MODEL_STATUS_KEY);
  if (!statuses || !modelStatus) return { statusLine, modelStatus: "" };
  if (stripVTControlCharacters(statusRow(statuses)) !== stripVTControlCharacters(statusLine)) {
    return { statusLine, modelStatus: "" };
  }
  const rest = new Map(statuses);
  rest.delete(MODEL_STATUS_KEY);
  return { statusLine: statusRow(rest), modelStatus: oneLine(modelStatus) };
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

/**
 * Progressive single-row layout for status + usage figures: tries `(left, right)` pairs from
 * richest to most compact and picks the first that fits on one line with a 2-space gap. If none
 * fits, splits into two lines using the widest variant of each side that fits `width`.
 */
export function footerPairRow(
  pairs: readonly { left: string; right: string }[],
  leftFallbacks: readonly string[],
  rightFallbacks: readonly string[],
  width: number,
  ellipsis: string,
): string[] {
  const fit = (text: string) => truncateToWidth(text, Math.max(0, width), ellipsis);
  const alignRight = (text: string) => " ".repeat(Math.max(0, width - visibleWidth(text))) + text;
  const pickFit = (options: readonly string[]) => {
    const nonEmpty = options.filter((text) => text.length > 0);
    if (nonEmpty.length === 0) return "";
    return nonEmpty.find((text) => visibleWidth(text) <= width) ?? fit(nonEmpty.at(-1)!);
  };
  for (const { left, right } of pairs) {
    if (!left && !right) continue;
    if (!right) {
      if (visibleWidth(left) <= width) return [left];
      continue;
    }
    if (!left) {
      if (visibleWidth(right) <= width) return [alignRight(right)];
      continue;
    }
    const gap = width - visibleWidth(left) - visibleWidth(right);
    if (gap >= 2) return [left + " ".repeat(gap) + right];
  }
  const left = pickFit(leftFallbacks);
  const right = pickFit(rightFallbacks);
  const rows: string[] = [];
  if (left) rows.push(left);
  if (right) rows.push(alignRight(right));
  return rows;
}

/** Pi draws its footer this wide so nothing is cut; `layoutFooter` fits the parts itself. */
const UNCUT_WIDTH = 1000;

/**
 * Pi's footer lines, drawn at `UNCUT_WIDTH`, in two coloured rows: the folder with the model on
 * the right, then the extension statuses with the usage figures on the right. codex-fast's status
 * moves from the statuses to beside the model. On narrower terminals, Row 2 progressively compacts
 * low-priority tags and labels before splitting into two rows.
 */
export function layoutFooter(
  lines: readonly string[],
  parts: {
    cwd: string;
    branch: string | null;
    sessionName?: string;
    statuses?: ReadonlyMap<string, string>;
  },
  theme: UiTheme,
  width: number,
): string[] {
  // Pi's lines: folder, usage figures with the model, then extension statuses (if any).
  const [pathLine = "", statsLine = "", piStatusLine = ""] = lines;
  const { stats, model } = splitStatsLine(statsLine);
  // With no model to sit beside, the model status stays in the status row.
  const { statusLine, modelStatus } = model
    ? takeModelStatus(piStatusLine, parts.statuses)
    : { statusLine: piStatusLine, modelStatus: "" };
  const canCompactStatuses = Boolean(
    parts.statuses && stripVTControlCharacters(statusRow(parts.statuses)) === stripVTControlCharacters(piStatusLine),
  );
  const l0 = statusLine;
  const l1 = canCompactStatuses
    ? compactStatuses(parts.statuses!, { dropModelStatus: Boolean(model), dropSkills: false })
    : l0;
  const l2 = canCompactStatuses
    ? compactStatuses(parts.statuses!, { dropModelStatus: Boolean(model), dropSkills: true })
    : l0;

  const s = compactStats(stats);
  const r0 = s.full ? colourStats(s.full, theme) : "";
  const r1 = s.trimmed ? colourStats(s.trimmed, theme) : "";
  const r2 = s.noCacheRw ? colourStats(s.noCacheRw, theme) : "";
  const r3 = s.noIo ? colourStats(s.noIo, theme) : "";
  const r4 = s.essential ? colourStats(s.essential, theme) : "";

  // Like Pi, drop the provider before anything else when the model does not fit.
  const withoutProvider = model.replace(/^\([^)]*\) /, "");
  const models = withoutProvider === model ? [model] : [model, withoutProvider];
  const ellipsis = theme.fg("dim", "...");
  return [
    ...footerRow(
      colourPath(pathLine, parts, theme),
      models.map((text) => colourModel(text, theme, modelStatus)),
      width,
      ellipsis,
    ),
    ...footerPairRow(
      [
        { left: l0, right: r0 },
        { left: l0, right: r1 },
        { left: l0, right: r2 },
        { left: l1, right: r2 },
        { left: l1, right: r3 },
        { left: l2, right: r4 },
      ],
      [l0, l1, l2],
      [r0, r1, r2, r3, r4],
      width,
      ellipsis,
    ),
  ];
}

type FooterRender = (this: unknown, width: number) => string[];
type FooterClass = { prototype: object };
/** The fields of Pi's own footer that the layout reads. */
type NativeFooter = {
  session?: { sessionManager?: { getCwd(): string; getSessionName(): string | undefined } };
  footerData?: Pick<ReadonlyFooterDataProvider, "getGitBranch" | "getExtensionStatuses">;
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
        statuses: footer.footerData.getExtensionStatuses(),
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
