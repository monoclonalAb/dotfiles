import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  }).skills.sort((left, right) => left.name.localeCompare(right.name));
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
    let savedPaths: string[] = [];

    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
      const data = entry.data as SkillsState | undefined;
      if (Array.isArray(data?.enabledPaths)) savedPaths = data.enabledPaths;
    }

    enabledPaths = new Set(savedPaths);
    refreshCandidates(ctx);
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
