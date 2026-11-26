// Checks the workflows that rely on Pi internals once per installed Pi version,
// and shows failures in the footer. The checking itself is bin/pi-compat-check;
// this extension only notices a version with no result, starts that script in
// the background, and reads what it saved. Example:
//
//   1. 10:00: `pi update` (or `npm install -g`) installs Pi 1.7.0.
//   2. 10:01: within a minute an open Pi session sees no result for 1.7.0 and
//      starts `pi-compat-check --if-new`; the footer shows "checking Pi 1.7.0".
//      Other sessions see it running and start nothing.
//   3. 10:02: two suites fail. Every session's footer shows "Pi 1.7.0: 2 checks
//      failed", and each Pi process says once which workflows and to run
//      `pi-compat-check --status` for the logs. When all pass, a session that
//      saw the check running says so once; the footer stays clear.
//
// A session that starts after the update finds the missing result the same way,
// so the check runs however Pi was updated. Only interactive (TUI) sessions take
// part. Nothing reaches the model.
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getPackageDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export const STATUS_KEY = "pi-compat";
export const CHECK_MS = 60_000;
// How long a check this process started may take to appear (`npm root -g`, the lock).
export const START_GRACE_MS = 3 * 60_000;
const PACKAGE_NAME = "@earendil-works/pi-coding-agent";

export interface SuiteResult { name: string; workflow: string; status: string; log: string }
export interface CheckResult { version: string; passed: boolean; finished: string; suites: SuiteResult[] }
export type CheckState =
  | { kind: "none" }
  | { kind: "running"; version: string }
  | { kind: "unchecked"; version: string } // started here, but it never ran or saved a result
  | { kind: "done"; result: CheckResult };

type Read = (path: string) => string;
const readText: Read = (path) => readFileSync(path, "utf8");

function readJson(path: string, read: Read): unknown {
  try { return JSON.parse(read(path)); } catch { return undefined; }
}

/** The version in Pi's package.json, if it is Pi's and readable (not mid-install). */
export function installedVersion(packageJson: string, read: Read = readText): string | undefined {
  const meta = readJson(packageJson, read) as { name?: unknown; version?: unknown } | undefined;
  return meta?.name === PACKAGE_NAME && typeof meta.version === "string" ? meta.version : undefined;
}

export function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/** A running check comes first; otherwise the saved result for `version`, if any. */
export function checkState(stateDir: string, version: string, read: Read = readText,
  alive: (pid: number) => boolean = processAlive): CheckState {
  const lock = readJson(join(stateDir, "running.json"), read) as { pid?: unknown; version?: unknown } | undefined;
  if (typeof lock?.pid === "number" && alive(lock.pid)) {
    return { kind: "running", version: typeof lock.version === "string" ? lock.version : version };
  }
  const result = readJson(join(stateDir, version, "result.json"), read) as CheckResult | undefined;
  return result && Array.isArray(result.suites) && result.version === version ? { kind: "done", result } : { kind: "none" };
}

/** Workflow names of the failed suites, in order, once each. */
export function failedWorkflows(result: CheckResult): string[] {
  return [...new Set(result.suites.filter((suite) => suite.status !== "pass").map((suite) => suite.workflow))];
}

export function statusText(state: CheckState): { text: string; colour: "dim" | "warning" } | undefined {
  if (state.kind === "running") return { text: `checking Pi ${state.version}`, colour: "dim" };
  if (state.kind === "unchecked") return { text: `Pi ${state.version} not checked: run pi-compat-check`, colour: "warning" };
  if (state.kind === "done" && !state.result.passed) {
    const failed = state.result.suites.filter((suite) => suite.status !== "pass").length;
    return { text: `Pi ${state.result.version}: ${failed} check${failed === 1 ? "" : "s"} failed`, colour: "warning" };
  }
  return undefined;
}

export function failureNotice(result: CheckResult): string {
  const failed = result.suites.filter((suite) => suite.status !== "pass").length;
  return `Pi ${result.version} failed ${failed} of ${result.suites.length} extension checks. Affected: `
    + `${failedWorkflows(result).join("; ")}. Details and logs: pi-compat-check --status`;
}

export const passNotice = (result: CheckResult) =>
  `Pi ${result.version} passed all ${result.suites.length} extension checks.`;

// <repo>/bin/pi-compat-check, from this file's real place in <repo>/pi/extensions/pi-compat/.
function defaultScript(): string {
  return join(dirname(realpathSync(fileURLToPath(import.meta.url))), "..", "..", "..", "bin", "pi-compat-check");
}

/**
 * Detached, so it outlives this Pi; `done` runs when it exits, so the result shows
 * at once. A missing script is ignored rather than crashing Pi.
 */
export function launchCheck(script: string, done: () => void = () => {}): void {
  const child = spawn(script, ["--if-new", "--quiet"], { detached: true, stdio: "ignore", cwd: homedir() });
  child.on("error", () => {});
  child.on("exit", () => done());
  child.unref();
}

// Per process, so /reload or /new neither restarts a check nor repeats a notice.
const MEMORY = Symbol.for("dotfiles.pi-compat.memory");
interface Memory { launched: Map<string, number>; announced: Set<string> }
function processMemory(): Memory {
  const holder = globalThis as { [MEMORY]?: Memory };
  return (holder[MEMORY] ??= { launched: new Map(), announced: new Set() });
}

export interface PiCompatOptions {
  packageJson?: string;
  stateDir?: string;
  read?: Read;
  alive?: (pid: number) => boolean;
  launch?: (done: () => void) => void;
  every?: number;
  memory?: Memory;
  now?: () => number;
}

export function registerPiCompat(pi: ExtensionAPI, options: PiCompatOptions = {}) {
  const stateDir = options.stateDir ?? join(homedir(), ".local", "state", "pi", "compat");
  const read = options.read ?? readText;
  const launch = options.launch ?? ((done) => launchCheck(defaultScript(), done));
  const memory = options.memory ?? processMemory();
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setInterval> | undefined;
  let current: ExtensionContext | undefined;
  let shown: string | undefined;
  let sawRunning = false;

  const tick = (ctx: ExtensionContext) => {
    try {
      const version = installedVersion(options.packageJson ?? join(getPackageDir(), "package.json"), read);
      if (!version) return;
      let state = checkState(stateDir, version, read, options.alive);
      if (state.kind === "none") {
        const launched = memory.launched.get(version);
        if (launched === undefined) {
          memory.launched.set(version, now());
          launch(() => { if (current) tick(current); });
        }
        state = now() - (launched ?? now()) < START_GRACE_MS ? { kind: "running", version } : { kind: "unchecked", version };
      }
      const status = statusText(state);
      const text = status && ctx.ui.theme.fg(status.colour, status.text);
      if (text !== shown) {
        shown = text;
        ctx.ui.setStatus(STATUS_KEY, text);
      }
      if (state.kind === "running") sawRunning = true;
      if (state.kind !== "done") return;
      const key = `${state.result.version} ${state.result.finished}`;
      if (!memory.announced.has(key) && (!state.result.passed || sawRunning)) {
        memory.announced.add(key);
        if (state.result.passed) ctx.ui.notify(passNotice(state.result), "info");
        else ctx.ui.notify(failureNotice(state.result), "warning");
      }
      sawRunning = false;
    } catch { /* a check notice is never worth an error */ }
  };

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui" || !ctx.hasUI) return;
    shown = undefined; // a reload or new session starts with no statuses
    current = ctx;
    tick(ctx);
    clearInterval(timer);
    timer = setInterval(() => tick(ctx), options.every ?? CHECK_MS);
    timer.unref?.();
  });

  pi.on("session_shutdown", async () => {
    clearInterval(timer);
    timer = undefined;
    current = undefined;
  });
}

export default function piCompat(pi: ExtensionAPI) {
  registerPiCompat(pi);
}
