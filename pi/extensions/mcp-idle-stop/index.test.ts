// bun test ./pi/extensions/mcp-idle-stop/*.test.ts
import assert from "node:assert/strict";
import childProcess, { type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, mock, test } from "bun:test";

mock.module("@earendil-works/pi-coding-agent", () => ({ CONFIG_DIR_NAME: ".pi", getAgentDir: () => agentDir }));
const { idleMilliseconds, registerMcpIdleStop, stdioServers } = await import("./index.ts");

const IDLE_MS = 100;
const root = mkdtempSync(join(tmpdir(), "mcp-idle-stop-"));
const server = join(root, "fake-mcp");
writeFileSync(server, "#!/bin/sh\nexec sleep 30\n");
chmodSync(server, 0o755);
const agentDir = join(root, "agent");
mkdirSync(agentDir);
writeFileSync(join(agentDir, "mcp.json"), JSON.stringify({
  mcpServers: {
    local: { command: server, args: ["serve"] },
    remote: { url: "http://127.0.0.1:1/mcp" },
  },
}));

const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Spawned the way Pi's MCP transport (through cross-spawn) and its bash tool spawn: detached, own process group.
function spawn(command: string, args: string[], detached = true) {
  const child = childProcess.spawn(command, args, { detached, stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  return child;
}

async function running(child: ChildProcess) {
  await sleep(IDLE_MS * 3);
  return child.exitCode === null && child.signalCode === null;
}

function harness({ idle = true } = {}) {
  const handlers = new Map<string, (event: object, ctx: object) => void>();
  const pi = { on: (name: string, handler: (event: object, ctx: object) => void) => handlers.set(name, handler) };
  const state = { idle };
  const ctx = { cwd: root, isProjectTrusted: () => false, isIdle: () => state.idle };
  registerMcpIdleStop(pi as never, { idleMs: IDLE_MS, agentDir });
  return { state, emit: (name: string) => handlers.get(name)?.({}, ctx) };
}

test("after the idle time only children running a configured stdio server are stopped", async () => {
  const h = harness();
  const mcp = spawn(server, ["serve"]);
  const bashTool = spawn("/bin/bash", ["-c", "sleep 30"]);
  const otherArgs = spawn(server, ["serve", "--other"]);
  const notDetached = spawn(server, ["serve"], false);
  h.emit("session_start");
  assert.equal(await running(mcp), false, "the MCP server is stopped");
  assert.equal(await running(bashTool), true, "a bash child is untouched");
  assert.equal(await running(otherArgs), true, "the same command with other arguments is untouched");
  assert.equal(await running(notDetached), true, "a child without its own process group is untouched");
});

test("nothing is stopped while Pi is busy, and a run restarts the idle clock", async () => {
  const h = harness();
  const mcp = spawn(server, ["serve"]);
  h.emit("session_start");
  h.emit("agent_start");
  assert.equal(await running(mcp), true, "a run longer than the idle time keeps the server");
  h.emit("agent_settled");
  await sleep(IDLE_MS / 2);
  h.emit("agent_start");
  assert.equal(await running(mcp), true, "a run that starts before the idle time ends keeps the server");
  h.emit("agent_settled");
  assert.equal(await running(mcp), false, "the full idle time after the run stops it");
});

test("nothing is stopped when Pi reports busy as the time runs out", async () => {
  const h = harness({ idle: false });
  const mcp = spawn(server, ["serve"]);
  h.emit("session_start");
  assert.equal(await running(mcp), true);
});

test("session shutdown cancels the pending stop", async () => {
  const h = harness();
  const mcp = spawn(server, ["serve"]);
  h.emit("session_start");
  h.emit("session_shutdown");
  assert.equal(await running(mcp), true);
});

test("stdio servers follow Pi's config rules: project entries replace, overrides keep, URLs are skipped", () => {
  const project = join(root, "project.json");
  writeFileSync(project, JSON.stringify({
    mcpServers: {
      local: { enabled: false },
      replaced: { command: "/bin/new", args: ["x"] },
      home: { command: "~/bin/tool", args: ["~/data", "a~/b"] },
      typed: { type: "stdio", command: "/bin/typed" },
      both: { url: "http://127.0.0.1:1/mcp", command: "/bin/never" },
      broken: { command: "/bin/broken", args: [1] },
    },
  }));
  const global = join(root, "global.json");
  writeFileSync(global, JSON.stringify({ mcpServers: { local: { command: server, args: ["serve"] }, replaced: { command: "/bin/old" } } }));
  assert.deepEqual(stdioServers([global, project, join(root, "missing.json")]), [
    { command: server, args: ["serve"] },
    { command: "/bin/new", args: ["x"] },
    { command: join(homedir(), "bin/tool"), args: [join(homedir(), "data"), "a~/b"] },
    { command: "/bin/typed", args: [] },
  ]);
});

test("the idle time defaults to 10 minutes and takes seconds from the environment", () => {
  assert.equal(idleMilliseconds(undefined), 600_000);
  assert.equal(idleMilliseconds(""), 600_000);
  assert.equal(idleMilliseconds("nope"), 600_000);
  assert.equal(idleMilliseconds("0"), 600_000);
  assert.equal(idleMilliseconds("2.5"), 2500);
});
