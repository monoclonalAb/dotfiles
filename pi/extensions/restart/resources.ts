// What /reload would load differently: the files Pi read at session start that
// have since been added, changed or removed. Example:
//
//   1. 09:00: t7 starts Pi; this takes a snapshot of its extensions, prompt
//      templates, settings, keybindings, mcp.json and context files (AGENTS.md).
//   2. 11:00: another session adds pi/extensions/restart/ and `dotfiles-link
//      apply` links it into ~/.pi/agent/extensions/.
//   3. 11:01: changes() for t7 returns ["restart extension"], and t7 shows
//      "Changed since this session started: restart extension. Type /reload …".
//
// Each check lists the folders again (to see added files) and stats every file;
// a file is read only when its size or modification time moved, and counts as
// changed only when its content differs from the snapshot. So Pi rewriting a
// file with the same content, or saving the model you last picked into
// settings.json, shows nothing.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, relative } from "node:path";

export interface Where {
  agentDir: string;
  cwd: string;
  configDir: string; // ".pi"
  trusted: boolean; // project resources load only in trusted projects
  contextFiles: string[];
}

interface Watched { label: string; normalise?: (text: string) => string }

const CODE = new Set([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".json"]);
const TEST = /\.(test|spec)\.[^.]+$/;

// Pi records these in settings.json itself (`/model`, thinking levels, the
// changelog it showed); they seed new sessions and change nothing on /reload.
const PI_RECORDED = ["lastChangelogVersion", "defaultProvider", "defaultModel", "defaultThinkingLevel", "modelThinkingLevels"];
export function settingsWithoutPiRecords(text: string): string {
  try {
    const settings = JSON.parse(text) as Record<string, unknown>;
    for (const key of PI_RECORDED) delete settings[key];
    return JSON.stringify(settings);
  } catch {
    return text;
  }
}

const tilde = (path: string) => {
  const inside = relative(homedir(), path);
  return inside && !inside.startsWith("..") ? `~/${inside}` : path;
};

// Files under `directory` (following links), at most `depth` folders down.
function files(directory: string, keep: (name: string) => boolean, depth: number): string[] {
  let entries: string[];
  try { entries = readdirSync(directory); } catch { return []; }
  const found: string[] = [];
  for (const name of entries) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const path = join(directory, name);
    let stats;
    try { stats = statSync(path); } catch { continue; }
    if (stats.isDirectory()) { if (depth > 0) found.push(...files(path, keep, depth - 1)); }
    else if (keep(name)) found.push(path);
  }
  return found;
}

// Every file /reload would read again, with how to name it.
export function watched(where: Where): Map<string, Watched> {
  const out = new Map<string, Watched>();
  const extensions = (root: string, prefix: string) => {
    for (const path of files(root, (name) => CODE.has(extname(name)) && !TEST.test(name), 4)) {
      const top = relative(root, path).split("/")[0]!;
      out.set(path, { label: `${prefix}${top.replace(/\.[^.]+$/, "")} extension` });
    }
  };
  const prompts = (root: string) => {
    for (const path of files(root, (name) => extname(name) === ".md", 2)) {
      out.set(path, { label: `/${basename(path, ".md")} prompt` });
    }
  };
  const config = (root: string, prefix: string, names: string[]) => {
    for (const name of names) {
      out.set(join(root, name), {
        label: `${prefix}${name}`,
        normalise: name === "settings.json" ? settingsWithoutPiRecords : undefined,
      });
    }
  };
  extensions(join(where.agentDir, "extensions"), "");
  prompts(join(where.agentDir, "prompts"));
  config(where.agentDir, "", ["settings.json", "keybindings.json", "mcp.json"]);
  if (where.trusted) {
    const project = join(where.cwd, where.configDir);
    extensions(join(project, "extensions"), "project ");
    prompts(join(project, "prompts"));
    config(project, `${where.configDir}/`, ["settings.json", "mcp.json"]);
  }
  for (const path of where.contextFiles) out.set(path, { label: tilde(path) });
  return out;
}

interface Seen { stamp: string; hash: string }

const MISSING: Seen = { stamp: "missing", hash: "missing" };

function look(path: string, item: Watched, last: Seen | undefined): Seen {
  let stamp: string;
  try {
    const stats = statSync(path);
    stamp = `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return MISSING;
  }
  if (last && last.stamp === stamp) return last;
  try {
    const text = readFileSync(path, "utf8");
    return { stamp, hash: createHash("sha1").update(item.normalise ? item.normalise(text) : text).digest("hex") };
  } catch {
    return MISSING;
  }
}

// Snapshot at session start; `changes()` names what differs from it since.
export function resourceWatch(where: Where) {
  const baseline = new Map<string, Seen>();
  const latest = new Map<string, Seen>();
  for (const [path, item] of watched(where)) {
    const seen = look(path, item, undefined);
    baseline.set(path, seen);
    latest.set(path, seen);
  }
  return {
    changes(): string[] {
      const now = watched(where);
      const labels = new Set<string>();
      for (const [path, item] of now) {
        const seen = look(path, item, latest.get(path));
        latest.set(path, seen);
        if ((baseline.get(path) ?? MISSING).hash !== seen.hash) labels.add(item.label);
      }
      // Removed since: a whole folder (extension) or file that is gone.
      for (const [path, seen] of baseline) {
        if (!now.has(path) && seen !== MISSING) labels.add(labelOf(path, where));
      }
      return [...labels];
    },
  };
}

// Name of a file no longer listed, from the same rules as `watched`.
function labelOf(path: string, where: Where): string {
  const roots: [string, string][] = [[join(where.agentDir, "extensions"), ""]];
  if (where.trusted) roots.push([join(where.cwd, where.configDir, "extensions"), "project "]);
  for (const [root, prefix] of roots) {
    const inside = relative(root, path);
    if (inside && !inside.startsWith("..")) return `${prefix}${inside.split("/")[0]!.replace(/\.[^.]+$/, "")} extension`;
  }
  if (extname(path) === ".md" && path.includes("/prompts/")) return `/${basename(path, ".md")} prompt`;
  return tilde(path);
}
