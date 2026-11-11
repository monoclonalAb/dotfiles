import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  getSettingsListTheme,
  loadSkills,
  SettingsManager,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  type SettingItem,
  SettingsList,
  Text,
  type AutocompleteItem,
} from "@earendil-works/pi-tui";

const STATE_TYPE = "selective-skills-state";
const STATUS_KEY = "selective-skills";

interface SkillsState {
  enabledPaths: string[];
}

// Skills tied to one folder. A new session started anywhere inside the folder
// begins with them on (/skill can still turn them off). Outside the folder,
// /skill does not offer them at all. A linked Git worktree, such as a Herdr
// task in ~/.herdr/worktrees/<repo>/<branch>, counts as inside the folder
// when its main checkout is.
const FOLDER_SKILLS: { folder: string; skills: string[] }[] = [
  {
    folder: join(homedir(), "Desktop", "projects", "DE"),
    skills: ["everyday-ai-frontend-styleguide"],
  },
];

function isInside(path: string, folder: string): boolean {
  const fromFolder = relative(resolve(folder), resolve(path));
  return fromFolder === "" || (!fromFolder.startsWith("..") && !isAbsolute(fromFolder));
}

// The main checkout of the Git repository containing cwd. In a linked
// worktree, .git is a file ("gitdir: <main>/.git/worktrees/<name>") whose
// commondir file leads back to <main>/.git.
function mainCheckout(cwd: string): string | undefined {
  let current = resolve(cwd);
  while (true) {
    const dotGit = join(current, ".git");
    if (existsSync(dotGit)) {
      if (statSync(dotGit).isDirectory()) return current;

      const pointer = readFileSync(dotGit, "utf8").match(/^gitdir:\s*(.+)$/m);
      if (!pointer) return undefined;
      const gitDir = resolve(current, pointer[1].trim());
      const commonFile = join(gitDir, "commondir");
      const commonDir = existsSync(commonFile)
        ? resolve(gitDir, readFileSync(commonFile, "utf8").trim())
        : gitDir;
      return basename(commonDir) === ".git" ? dirname(commonDir) : undefined;
    }

    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function inFolder(cwd: string, folder: string): boolean {
  if (isInside(cwd, folder)) return true;
  const main = mainCheckout(cwd);
  return main !== undefined && isInside(main, folder);
}

function folderAllows(skill: Skill, cwd: string): boolean {
  const scopes = FOLDER_SKILLS.filter((scope) => scope.skills.includes(skill.name));
  return scopes.length === 0 || scopes.some((scope) => inFolder(cwd, scope.folder));
}

function folderDefaults(cwd: string): Set<string> {
  return new Set(
    FOLDER_SKILLS
      .filter((scope) => inFolder(cwd, scope.folder))
      .flatMap((scope) => scope.skills),
  );
}

function uniqueExistingPaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => resolve(path)))].filter((path) => existsSync(path));
}

function projectSkillRoots(cwd: string): string[] {
  const roots = [
    join(cwd, CONFIG_DIR_NAME, "skills"),
    join(cwd, ".claude", "skills"),
    join(cwd, ".codex", "skills"),
    join(cwd, ".omp", "skills"),
  ];

  let current = resolve(cwd);
  while (true) {
    roots.push(join(current, ".agents", "skills"));
    if (existsSync(join(current, ".git"))) break;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return roots;
}

// Pi's own `skills` setting lists extra skill files or folders. The pi wrapper
// passes --no-skills, so Pi ignores that list; /skill offers its skills instead,
// off until enabled like every other candidate. Entries resolve as Pi resolves
// them: user settings from the agent directory, project settings from the
// project's .pi folder. Pi's include/exclude patterns (entries starting with !,
// + or -, or containing * or ?) are skipped.
function isPatternEntry(entry: string): boolean {
  return /^[!+-]/.test(entry) || /[*?]/.test(entry);
}

function settingsEntryPaths(entries: unknown, baseDir: string): string[] {
  if (!Array.isArray(entries)) return [];

  return entries
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && !isPatternEntry(entry))
    .map((entry) => {
      if (entry === "~") return homedir();
      if (entry.startsWith("~/")) return join(homedir(), entry.slice(2));
      return resolve(baseDir, entry);
    });
}

function settingsSkillRoots(ctx: ExtensionContext, agentDir: string): string[] {
  const projectTrusted = ctx.isProjectTrusted();
  const settings = SettingsManager.create(ctx.cwd, agentDir, { projectTrusted });
  const roots = settingsEntryPaths(settings.getGlobalSettings().skills, agentDir);

  if (projectTrusted) {
    roots.push(...settingsEntryPaths(
      settings.getProjectSettings().skills,
      join(ctx.cwd, CONFIG_DIR_NAME),
    ));
  }

  return roots;
}

function discoverSkills(ctx: ExtensionContext): Skill[] {
  const home = homedir();
  const agentDir = getAgentDir();
  const roots = [
    join(agentDir, "skills"),
    join(home, ".agents", "skills"),
    join(home, ".claude", "skills"),
    join(home, ".codex", "skills"),
    join(home, ".omp", "agent", "skills"),
  ];

  if (ctx.isProjectTrusted()) {
    roots.push(...projectSkillRoots(ctx.cwd));
  }

  // Last, because the first skill found with a name wins: a folder from the
  // setting adds skills but never replaces one found in the usual folders.
  roots.push(...settingsSkillRoots(ctx, agentDir));

  return loadSkills({
    cwd: ctx.cwd,
    agentDir,
    skillPaths: uniqueExistingPaths(roots),
    includeDefaults: false,
  }).skills
    .filter((skill) => folderAllows(skill, ctx.cwd))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export default function selectiveSkills(pi: ExtensionAPI) {
  let candidates: Skill[] = [];
  let enabledPaths = new Set<string>();

  function refreshCandidates(ctx: ExtensionContext): void {
    candidates = discoverSkills(ctx);
    const availablePaths = new Set(candidates.map((skill) => skill.filePath));
    enabledPaths = new Set([...enabledPaths].filter((path) => availablePaths.has(path)));
  }

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus(
      STATUS_KEY,
      enabledPaths.size > 0 ? `skills: ${enabledPaths.size}` : undefined,
    );
  }

  function persistState(): void {
    pi.appendEntry<SkillsState>(STATE_TYPE, {
      enabledPaths: [...enabledPaths].sort(),
    });
  }

  function restoreState(ctx: ExtensionContext): void {
    let savedPaths: string[] | undefined;

    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
      const data = entry.data as SkillsState | undefined;
      if (Array.isArray(data?.enabledPaths)) savedPaths = data.enabledPaths;
    }

    enabledPaths = new Set(savedPaths ?? []);
    refreshCandidates(ctx);

    // No /skill choice saved in this session yet: start with the folder's skills.
    if (!savedPaths) {
      const defaults = folderDefaults(ctx.cwd);
      for (const skill of candidates) {
        if (defaults.has(skill.name)) enabledPaths.add(skill.filePath);
      }
    }

    updateStatus(ctx);
  }

  function findCandidate(name: string): Skill | undefined {
    const exact = candidates.find((skill) => skill.name === name);
    if (exact) return exact;

    const prefixMatches = candidates.filter((skill) => skill.name.startsWith(name));
    return prefixMatches.length === 1 ? prefixMatches[0] : undefined;
  }

  async function reloadWithState(ctx: ExtensionCommandContext): Promise<void> {
    persistState();
    await ctx.reload();
  }

  pi.on("session_start", (_event, ctx) => {
    restoreState(ctx);
  });

  pi.on("resources_discover", (_event, ctx) => {
    refreshCandidates(ctx);
    return { skillPaths: [...enabledPaths] };
  });

  pi.registerCommand("skill", {
    description: "Select which skills are loaded for this session",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const values = [
        "list",
        "clear",
        ...candidates.map((skill) => skill.name),
        ...candidates.flatMap((skill) => [`on ${skill.name}`, `off ${skill.name}`]),
      ];
      const matches = values
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      refreshCandidates(ctx);
      const argument = args.trim();

      if (argument === "list") {
        if (candidates.length === 0) {
          ctx.ui.notify("No skills found", "info");
          return;
        }
        const lines = candidates.map((skill) =>
          `${enabledPaths.has(skill.filePath) ? "on " : "off"}  ${skill.name}`,
        );
        ctx.ui.notify(lines.join("\n"), "info");
        return;
      }

      if (argument === "clear") {
        if (enabledPaths.size === 0) {
          ctx.ui.notify("No skills are enabled", "info");
          return;
        }
        enabledPaths.clear();
        await reloadWithState(ctx);
        return;
      }

      if (argument) {
        const match = argument.match(/^(?:(on|off)\s+)?([a-z0-9-]+)$/);
        if (!match) {
          ctx.ui.notify("Usage: /skill [list|clear|[on|off] <name>]", "error");
          return;
        }

        const [, requestedState, name] = match;
        const skill = findCandidate(name);
        if (!skill) {
          ctx.ui.notify(`Unknown or ambiguous skill: ${name}`, "error");
          return;
        }

        const shouldEnable = requestedState === "on"
          ? true
          : requestedState === "off"
            ? false
            : !enabledPaths.has(skill.filePath);

        if (shouldEnable) enabledPaths.add(skill.filePath);
        else enabledPaths.delete(skill.filePath);

        await reloadWithState(ctx);
        return;
      }

      if (ctx.mode !== "tui") {
        ctx.ui.notify("Use /skill list or /skill [on|off] <name> outside TUI mode", "error");
        return;
      }

      if (candidates.length === 0) {
        ctx.ui.notify("No skills found in standard Pi or compatible harness locations", "info");
        return;
      }

      const before = new Set(enabledPaths);
      await ctx.ui.custom((tui, theme, _keybindings, done) => {
        const container = new Container();
        container.addChild(new Text(theme.fg("accent", theme.bold("Session Skills")), 1, 1));

        const items: SettingItem[] = candidates.map((skill) => ({
          id: skill.filePath,
          label: skill.name,
          description: `${skill.description}\n${skill.filePath}`,
          currentValue: enabledPaths.has(skill.filePath) ? "enabled" : "disabled",
          values: ["enabled", "disabled"],
        }));

        const settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 15),
          getSettingsListTheme(),
          (path, value) => {
            if (value === "enabled") enabledPaths.add(path);
            else enabledPaths.delete(path);
          },
          () => done(undefined),
          { enableSearch: true },
        );
        container.addChild(settingsList);

        return {
          render: (width: number) => container.render(width),
          invalidate: () => container.invalidate(),
          handleInput: (data: string) => {
            settingsList.handleInput(data);
            tui.requestRender();
          },
        };
      });

      const changed = before.size !== enabledPaths.size
        || [...before].some((path) => !enabledPaths.has(path));
      if (changed) {
        await reloadWithState(ctx);
      }
    },
  });
}
