// Park idle: quit a Pi that has sat idle for two hours, so its memory (and that
// of any MCP servers still running) is freed. The `pi` wrapper (bin/pi) started it as a child
// with PI_PARK_FILE; it keeps the terminal and reopens the session written there
// when the pane gets focus or a key. Without that wrapper this does nothing.
//
// Example: 10:20 Pi finishes a reply. Nothing reaches Pi for two hours. 12:20
// the timer fires, every check passes, the session file goes to PI_PARK_FILE and
// Pi quits. 15:00 you click the pane and the same conversation is back.
//
// Never parks while something would be lost: an agent run or queued message, a
// draft in the editor or an open dialog, a command still running under Pi (a
// `!cmd`, or an editor opened with Ctrl+G), a page Pi serves (/artifact-review
// listens on a local port), a live `hc` sub-terminal (its notes would be typed
// into the parked pane), or a /tree position other than the latest entry (a
// reopen starts from the latest). It then tries again after another full period.
// Quitting writes nothing, so a conversation you quit never reopens.
import { existsSync, writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const PARK_AFTER_SECONDS = 2 * 60 * 60;
const HC_LIST = `printf '%s\\n' '{"jsonrpc":"2.0","id":1,"method":"hello","params":{}}' '{"jsonrpc":"2.0","id":2,"method":"terminal.list","params":{}}' | "$0" connect`;

export interface ParkEnvironment {
  PI_PARK_FILE?: string;
  PI_PARK_PID?: string;
  PI_PARK_AFTER?: string;
  HC_TERMINAL_ID?: string;
  HC_BIN_PATH?: string;
}

// Pids whose parent is `pid`, from `ps -A -o pid=,ppid=`.
export function childPids(ps: string, pid: number) {
  return ps.split("\n").map((line) => line.trim().split(/\s+/).map(Number))
    .filter(([child, parent]) => parent === pid && Number.isInteger(child)).map(([child]) => child);
}

// Whether one of `children` runs a command, given `lsof -F pt -d 0` for them.
// Pi's MCP servers read a unix socket from Pi; a command reads /dev/null, the
// terminal, a file or a pipe. A child lsof does not list has exited, like the
// `ps` that listed it.
export function hasCommandChild(lsof: string, children: number[]) {
  const input = new Map<number, string>();
  let pid = 0;
  for (const line of lsof.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("t")) input.set(pid, line.slice(1).trim());
  }
  return children.some((child) => input.has(child) && input.get(child) !== "unix");
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

// `input`: the terminal's raw input. Fullscreen Pi takes mouse wheel, clicks and focus
// reports before ctx.ui.onTerminalInput listeners see them, so a person reading
// by scrolling would look idle; stdin carries every byte.
export function registerParkIdle(pi: ExtensionAPI, environment: ParkEnvironment = process.env as ParkEnvironment,
  parentPid = process.ppid, input: NodeJS.ReadableStream = process.stdin) {
  const file = environment.PI_PARK_FILE;
  const seconds = Number(environment.PI_PARK_AFTER || PARK_AFTER_SECONDS);
  // A Pi the agent started inherits the variables but not the wrapper.
  if (!file || environment.PI_PARK_PID !== String(parentPid) || !(seconds > 0)) return;
  const terminal = environment.HC_TERMINAL_ID?.trim();
  const hc = environment.HC_BIN_PATH?.trim() || "hc";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let current: ExtensionContext | undefined;
  let stopListening: (() => void) | undefined;
  let inputs = 0;
  let prompts = 0;
  let checking = false;

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void park(), seconds * 1000);
    timer.unref?.();
  };

  // What would be lost by quitting now; empty when nothing.
  async function blockers(ctx: ExtensionContext) {
    const found: string[] = [];
    if (!ctx.isIdle() || ctx.hasPendingMessages()) found.push("agent busy");
    if (ctx.ui.getEditorText().trim() || prompts > 0) found.push("draft or dialog");
    const session = ctx.sessionManager.getSessionFile();
    if (!session || !existsSync(session)) found.push("no session file");
    if (ctx.sessionManager.getLeafId() !== (ctx.sessionManager.getEntries().at(-1)?.id ?? null)) found.push("earlier /tree point");
    if (found.length) return found;
    try {
      const ps = await pi.exec("/bin/ps", ["-A", "-o", "pid=,ppid="], { timeout: 5000 });
      if (ps.code !== 0) throw new Error(ps.stderr);
      const children = childPids(ps.stdout, process.pid);
      if (children.length) {
        const stdin = await pi.exec("/usr/sbin/lsof", ["-nP", "-a", "-p", children.join(","), "-d", "0", "-F", "pt"], { timeout: 5000 });
        if (hasCommandChild(stdin.stdout, children)) found.push("command running");
      }
    } catch { found.push("process check failed"); }
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
    if (!ctx || checking) return;
    checking = true;
    const seen = inputs;
    try {
      const found = await blockers(ctx);
      // A key (Ctrl+D included) or a run may have come while the checks ran.
      if (found.length || ctx !== current || inputs !== seen || prompts > 0 || !ctx.isIdle() || ctx.ui.getEditorText().trim()) return arm();
      try { writeFileSync(file!, ctx.sessionManager.getSessionFile()!); } catch { return arm(); }
      ctx.shutdown();
    } finally {
      checking = false;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    current = ctx;
    if (!ctx.hasUI) return;
    stopListening?.();
    const onInput = () => {
      inputs++;
      arm();
    };
    input.on("data", onInput);
    stopListening = () => input.off("data", onInput);
    arm();
  });
  pi.on("agent_start", () => clearTimeout(timer));
  pi.on("agent_settled", (_event, ctx) => {
    current = ctx;
    if (ctx.hasUI) arm();
  });
  pi.on("ui_prompt_start", () => { prompts++; });
  pi.on("ui_prompt_end", () => { prompts = Math.max(0, prompts - 1); });
  pi.on("session_shutdown", () => {
    clearTimeout(timer);
    stopListening?.();
    stopListening = undefined;
    current = undefined;
    prompts = 0;
  });
}

export default registerParkIdle;
