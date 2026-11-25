// Stop this session's local (stdio) MCP servers once Pi has been idle for 10
// minutes (PI_MCP_IDLE_STOP_SECONDS overrides it). Pi starts every configured
// server when a session starts and keeps it for the session's life; a stopped
// server shows as "disconnected" in /mcp and Pi starts it again on the next call
// to one of its tools. Pi keeps the server's tools and instructions, so the model
// sees no change.
//
// Pi offers no way to disconnect a server from mcp.json, and `ps` cannot tell its
// servers apart (npx shows as `npm exec`, wrapper scripts exec node). So this
// records the detached children spawned through `child_process.spawn`, which
// Pi's MCP transport reaches through cross-spawn, and signals the process group
// of each live one whose command and arguments are exactly a stdio server from
// the mcp.json files Pi read at session start.
import childProcess, { type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";

export const DEFAULT_IDLE_SECONDS = 600;

export interface StdioServer {
  command: string;
  args: string[];
}

interface Spawned extends StdioServer {
  child: ChildProcess;
}

// Process-wide, so /reload does not wrap spawn twice or forget running servers.
const SPAWNED = Symbol.for("dotfiles.mcp-idle-stop.spawned");

export function spawnedChildren(): Set<Spawned> {
  const holder = globalThis as { [SPAWNED]?: Set<Spawned> };
  if (holder[SPAWNED]) return holder[SPAWNED];
  const spawned = new Set<Spawned>();
  holder[SPAWNED] = spawned;
  const original = childProcess.spawn;
  childProcess.spawn = function (this: unknown, ...params: unknown[]) {
    const child = (original as (...args: unknown[]) => ChildProcess).apply(this, params);
    const [command, args, options] = params as [unknown, unknown, { detached?: boolean } | undefined];
    // Only a detached child leads its own process group, which is what gets signalled.
    if (typeof command === "string" && Array.isArray(args) && options?.detached === true && child.pid !== undefined) {
      const entry = { command, args: args.map(String), child };
      spawned.add(entry);
      child.once("exit", () => spawned.delete(entry));
    }
    return child;
  } as typeof original;
  return spawned;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// As Pi expands `command` and `args` before spawning a stdio server.
function expandHome(value: string) {
  if (value === "~") return homedir();
  return value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

/** Stdio servers of these mcp.json files, later files replacing or overriding earlier entries as Pi does. */
export function stdioServers(paths: string[]): StdioServer[] {
  const entries = new Map<string, Record<string, unknown>>();
  for (const path of paths) {
    let servers: unknown;
    try {
      servers = (JSON.parse(readFileSync(path, "utf8")) as { mcpServers?: unknown } | null)?.mcpServers;
    } catch {
      continue;
    }
    if (!isRecord(servers)) continue;
    for (const [name, value] of Object.entries(servers)) {
      if (!isRecord(value)) continue;
      const override = value.command === undefined && value.url === undefined && value.type === undefined;
      entries.set(name, override ? { ...entries.get(name), ...value } : value);
    }
  }
  return [...entries.values()].flatMap(({ command, args = [], url, type }) => {
    if (typeof url === "string" && type !== "stdio") return [];
    if (typeof command !== "string" || (type !== undefined && type !== "stdio")) return [];
    if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) return [];
    return [{ command: expandHome(command), args: args.map(expandHome) }];
  });
}

export function isServerProcess(spawned: StdioServer, servers: StdioServer[]) {
  return servers.some((server) =>
    server.command === spawned.command &&
    server.args.length === spawned.args.length &&
    server.args.every((arg, index) => arg === spawned.args[index]));
}

export function idleMilliseconds(value: string | undefined) {
  const seconds = Number(value);
  return (value?.trim() && Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_IDLE_SECONDS) * 1000;
}

export interface Options {
  idleMs?: number;
  agentDir?: string;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
}

export function registerMcpIdleStop(pi: ExtensionAPI, options: Options = {}) {
  const idleMs = options.idleMs ?? idleMilliseconds(process.env.PI_MCP_IDLE_STOP_SECONDS);
  const kill = options.kill ?? ((pid: number, signal: NodeJS.Signals) => process.kill(pid, signal));
  const spawned = spawnedChildren();
  let servers: StdioServer[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
  };

  const stopServers = () => {
    for (const entry of spawned) {
      const { child } = entry;
      if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) continue;
      if (!isServerProcess(entry, servers)) continue;
      try {
        kill(-child.pid, "SIGTERM");
      } catch { /* already gone */ }
    }
  };

  const arm = (ctx: ExtensionContext) => {
    cancel();
    timer = setTimeout(() => {
      timer = undefined;
      try {
        if (ctx.isIdle()) stopServers();
      } catch { /* a stale context after shutdown: nothing to stop */ }
    }, idleMs);
    timer.unref?.();
  };

  pi.on("session_start", (_event, ctx) => {
    const agentDir = options.agentDir ?? getAgentDir();
    servers = stdioServers([
      join(agentDir, "mcp.json"),
      ...(ctx.isProjectTrusted() ? [join(ctx.cwd, CONFIG_DIR_NAME, "mcp.json")] : []),
    ]);
    arm(ctx);
  });
  pi.on("agent_start", () => cancel());
  pi.on("agent_settled", (_event, ctx) => arm(ctx));
  pi.on("session_shutdown", () => cancel());
}

export default function (pi: ExtensionAPI) {
  registerMcpIdleStop(pi);
}
