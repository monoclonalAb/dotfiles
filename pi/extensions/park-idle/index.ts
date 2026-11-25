// Park idle: quit a Pi that has sat idle for two hours, so its memory and its
// MCP servers' memory are freed. The `pi` wrapper (bin/pi) started it as a child
// with PI_PARK_FILE; it keeps the terminal and reopens the session written there
// when the pane gets focus or a key. Without that wrapper this does nothing.
//
// Example: 10:20 Pi finishes a reply. Nothing reaches Pi for two hours. 12:20
// the timer fires, every check passes, the session file goes to PI_PARK_FILE and
// Pi quits. 15:00 you click the pane and the same conversation is back.
//
// Never parks while something would be lost: an agent run or queued message, a
// draft in the editor, a shell command still running under Pi (`!cmd`), a page
// Pi serves (/artifact-review listens on a local port), or a live `hc`
// sub-terminal (its notes would be typed into the parked pane). It then tries
// again after another full period. Quitting writes nothing, so it never reopens.
import { existsSync, writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PARK_AFTER_SECONDS = 2 * 60 * 60;
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "csh", "tcsh"]);
const HC_LIST = `printf '%s\\n' '{"jsonrpc":"2.0","id":1,"method":"hello","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"terminal.list","params":{}}' | "$0" connect`;

export interface ParkEnvironment {
  PI_PARK_FILE?: string;
  PI_PARK_PID?: string;
  PI_PARK_AFTER?: string;
  HC_TERMINAL_ID?: string;
  HC_BIN_PATH?: string;
}

// Whether `ps -A -o ppid=,ucomm=` lists a shell whose parent is `pid`.
export function hasShellChild(ps: string, pid: number) {
  return ps.split("\n").some((line) => {
    const [ppid, name] = line.trim().split(/\s+/);
    return Number(ppid) === pid && SHELLS.has(name ?? "");
  });
}

// Whether the `hc connect` replies list a live terminal whose parent is `terminal`.
export function hasLiveChild(replies: string, terminal: string) {
  for (const line of replies.split("\n")) {
    let reply: { id?: number; result?: { terminals?: { parent?: string | null; state?: string }[] } };
    try { reply = JSON.parse(line); } catch { continue; }
    if (reply.id !== 2) continue;
    return (reply.result?.terminals ?? []).some((t) => t.parent === terminal && t.state === "live");
  }
  throw new Error("hc gave no terminal list");
}

export function registerParkIdle(pi: ExtensionAPI, environment: ParkEnvironment = process.env as ParkEnvironment,
  parentPid = process.ppid) {
  const file = environment.PI_PARK_FILE;
  const seconds = Number(environment.PI_PARK_AFTER || PARK_AFTER_SECONDS);
  // A Pi the agent started inherits the variables but not the wrapper.
  if (!file || environment.PI_PARK_PID !== String(parentPid) || !(seconds > 0)) return;
  const terminal = environment.HC_TERMINAL_ID?.trim();
  const hc = environment.HC_BIN_PATH?.trim() || "hc";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: ExtensionContext | undefined;
  let stopListening: (() => void) | undefined;

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void park(), seconds * 1000);
    timer.unref?.();
  };

  // What would be lost by quitting now; empty when nothing.
  async function blockers(ctx: ExtensionContext) {
    const found: string[] = [];
    if (!ctx.isIdle() || ctx.hasPendingMessages()) found.push("agent busy");
    if (ctx.ui.getEditorText().trim()) found.push("draft");
    const session = ctx.sessionManager.getSessionFile();
    if (!session || !existsSync(session)) found.push("no session file");
    if (found.length) return found;
    try {
      const ps = await pi.exec("/bin/ps", ["-A", "-o", "ppid=,ucomm="], { timeout: 5000 });
      if (ps.code !== 0 || hasShellChild(ps.stdout, process.pid)) found.push("shell command running");
    } catch { found.push("ps failed"); }
    try {
      const lsof = await pi.exec("/usr/sbin/lsof", ["-nP", "-a", "-p", String(process.pid), "-iTCP", "-sTCP:LISTEN", "-t"], { timeout: 5000 });
      if (lsof.stdout.trim()) found.push("serving a page");
    } catch { found.push("lsof failed"); }
    if (terminal) {
      try {
        const list = await pi.exec("/bin/sh", ["-c", HC_LIST, hc], { timeout: 5000 });
        if (hasLiveChild(list.stdout, terminal)) found.push("hc sub-terminal live");
      } catch { found.push("hc list failed"); }
    }
    return found;
  }

  async function park() {
    const ctx = current;
    if (!ctx) return;
    if ((await blockers(ctx)).length) return arm();
    // Input or a run may have started while the checks ran.
    if (ctx !== current || !ctx.isIdle() || ctx.ui.getEditorText().trim()) return arm();
    writeFileSync(file!, ctx.sessionManager.getSessionFile()!);
    ctx.shutdown();
  }

  pi.on("session_start", (_event, ctx) => {
    current = ctx;
    if (!ctx.hasUI) return;
    stopListening?.();
    stopListening = ctx.ui.onTerminalInput(() => {
      arm();
      return undefined;
    });
    arm();
  });
  pi.on("agent_start", () => clearTimeout(timer));
  pi.on("agent_settled", (_event, ctx) => {
    current = ctx;
    if (ctx.hasUI) arm();
  });
  pi.on("session_shutdown", () => {
    clearTimeout(timer);
    stopListening?.();
    stopListening = undefined;
    current = undefined;
  });
}

export default registerParkIdle;
