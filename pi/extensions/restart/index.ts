// /restart, and a line above the input box when this session is out of date:
// a newer Pi is installed than the one running (/restart), or extensions,
// prompts, settings or context files changed since it started (/reload; see
// resources.ts).
//
// A running Pi keeps the code it started with. Installing a new Pi replaces the
// files on disk but not the running process, so a session left open for days
// keeps running the old version (and code it loads later can come from the new
// one). /reload reloads extensions, skills and settings, not Pi itself. The
// conversation lives in its session file, so a new process started with
// `pi --session <file>` continues it with nothing lost. Example:
//
//   1. Nov 20: t7 starts Pi 1.5.2.
//   2. Nov 23 14:23: Pi 1.6.0 is installed. Within a minute t7 shows, just above
//      its input box: "Pi 1.6.0 is installed; this session runs 1.5.2. Type
//      /restart to reopen it on 1.6.0."
//   3. Nov 24: you type /restart in t7. Pi quits, and relaunch.mjs (started just
//      before, detached) waits for it to exit, then types `pi --session '<file>'`
//      into the shell that comes back, with the Herdr app's `hc send`. The same
//      conversation reopens on 1.6.0.
//
// It never restarts or reloads by itself. Outside the Herdr app (no HC_TERMINAL_ID) /restart
// only shows the command to run. Nothing reaches the model.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, getAgentDir, getPackageDir, VERSION, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resourceWatch, type Where } from "./resources.ts";

export const WIDGET_KEY = "restart";
export const CHECK_MS = 60_000;
const PACKAGE_NAME = "@earendil-works/pi-coding-agent";
const HELPER = fileURLToPath(new URL("./relaunch.mjs", import.meta.url));

export type InstallChange = { kind: "updated"; version: string } | { kind: "removed" };

// Single-quoted for the shell.
export const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

// The installed Pi differs from the running one (`running` is this process's
// in-memory version: extensions import Pi's own loaded module, not the files on disk).
export function installChange(packageJson: string | undefined, running: string,
  read: (path: string) => string = (path) => readFileSync(path, "utf8")): InstallChange | undefined {
  if (!packageJson) return undefined;
  let installed: { name?: unknown; version?: unknown };
  try {
    installed = JSON.parse(read(packageJson));
  } catch (error) {
    // Half-written during an install: decide on the next check.
    return (error as NodeJS.ErrnoException)?.code === "ENOENT" ? { kind: "removed" } : undefined;
  }
  if (installed?.name !== PACKAGE_NAME || typeof installed.version !== "string") return undefined;
  return installed.version === running ? undefined : { kind: "updated", version: installed.version };
}

export const notice = (change: InstallChange, running: string) =>
  change.kind === "updated"
    ? `Pi ${change.version} is installed; this session runs ${running}. Type /restart to reopen it on ${change.version}.`
    : `Pi was reinstalled; this session runs ${running}. Type /restart to reopen it on the new one.`;

// The package.json this process started from, found once per process: once the
// install is replaced or removed, looking again could find an unrelated one.
const STARTUP = Symbol.for("dotfiles.restart.package-json");
function startupPackageJson(): string | undefined {
  const holder = globalThis as { [STARTUP]?: string | null };
  if (holder[STARTUP] === undefined) {
    try { holder[STARTUP] = join(getPackageDir(), "package.json"); } catch { holder[STARTUP] = null; }
  }
  return holder[STARTUP] ?? undefined;
}

export interface RestartOptions {
  env?: { HC_TERMINAL_ID?: string; HC_BIN_PATH?: string };
  running?: string;
  packageJson?: string;
  read?: (path: string) => string;
  exists?: (path: string) => boolean;
  launch?: (args: string[]) => void;
  pid?: number;
  every?: number;
  where?: (ctx: ExtensionContext) => Where;
}

// `a, b, c and 2 more`
export function listed(labels: string[], most = 3): string {
  const shown = labels.slice(0, labels.length > most ? most - 1 : most);
  const rest = labels.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} and ${rest} more` : shown.length > 1
    ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown.join("");
}

export const reloadNotice = (labels: string[]) =>
  `Changed since this session started: ${listed(labels)}. Type /reload to load them.`;

// The files this session loaded: context files as Pi lists them for the system prompt.
function whereOf(ctx: ExtensionContext): Where {
  const options = (ctx as { getSystemPromptOptions?: () => { contextFiles?: { path: string }[] } }).getSystemPromptOptions?.();
  const contextFiles = options?.contextFiles?.map((file) => file.path)
    ?? [...(ctx.getSystemPrompt?.() ?? "").matchAll(/<project_instructions path="([^"]+)">/g)].map((match) => match[1]!);
  return { agentDir: getAgentDir(), cwd: ctx.cwd, configDir: CONFIG_DIR_NAME, trusted: ctx.isProjectTrusted?.() ?? false, contextFiles };
}

// Detached, so it outlives this Pi; its own process group, so Pi's exit does not take it along.
function launchHelper(args: string[]) {
  spawn(process.execPath, [HELPER, ...args], { detached: true, stdio: "ignore" }).unref();
}

export function registerRestart(pi: ExtensionAPI, options: RestartOptions = {}) {
  const env = options.env ?? (process.env as RestartOptions["env"] & object);
  const terminal = env.HC_TERMINAL_ID?.trim();
  const hc = env.HC_BIN_PATH?.trim() || "hc";
  const running = options.running ?? VERSION;
  const exists = options.exists ?? existsSync;
  const launch = options.launch ?? launchHelper;
  const pid = options.pid ?? process.pid;
  let timer: ReturnType<typeof setInterval> | undefined;
  let shown: string | undefined;
  let resources: ReturnType<typeof resourceWatch> | undefined;

  // One line between the transcript and the input box, where /restart or /reload
  // is typed. A Pi update comes first: restarting also loads everything else.
  const check = (ctx: ExtensionContext) => {
    try {
      const change = installChange(options.packageJson ?? startupPackageJson(), running, options.read);
      const changed = change ? [] : resources?.changes() ?? [];
      const text = change ? notice(change, running) : changed.length ? reloadNotice(changed) : undefined;
      if (text === shown) return;
      shown = text;
      ctx.ui.setWidget(WIDGET_KEY, text ? [ctx.ui.theme.fg("warning", text)] : undefined, { placement: "aboveEditor" });
    } catch { /* a notice is never worth an error */ }
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    shown = undefined; // a reload or new session starts with no widgets
    try { resources = resourceWatch((options.where ?? whereOf)(ctx)); } catch { resources = undefined; }
    check(ctx);
    clearInterval(timer);
    timer = setInterval(() => check(ctx), options.every ?? CHECK_MS);
    timer.unref?.();
  });

  pi.on("session_shutdown", async () => {
    clearInterval(timer);
    timer = undefined;
  });

  pi.registerCommand("restart", {
    description: "Reopen this conversation in a new Pi process, e.g. after a Pi update",
    handler: async (_args, ctx) => {
      const file = ctx.sessionManager.getSessionFile();
      if (!file || !exists(file)) {
        ctx.ui.notify("Nothing to reopen: this conversation is not saved yet", "error");
        return;
      }
      const command = `pi --session ${quote(file)}`;
      if (ctx.mode !== "tui" || !terminal) {
        ctx.ui.notify(`Pi reopens itself only in the Herdr app. Quit, then run: ${command}`, "info");
        return;
      }
      if (!ctx.isIdle()) {
        ctx.ui.notify("Pi is still working. Run /restart when it has finished.", "warning");
        return;
      }
      // Nothing else could type the command once Pi has quit, so check hc answers first.
      try {
        const result = await pi.exec(hc, ["get", terminal, "--json"], { timeout: 3000 });
        if (result.code !== 0 || JSON.parse(result.stdout ?? "").state !== "live") throw new Error(result.stderr);
        launch([String(pid), hc, terminal, command]);
      } catch {
        ctx.ui.notify(`Could not reach the Herdr app (hc), so Pi stays open. To restart, quit, then run: ${command}`, "error");
        return;
      }
      ctx.shutdown();
    },
  });
}

export default function restartExtension(pi: ExtensionAPI) {
  registerRestart(pi);
}
