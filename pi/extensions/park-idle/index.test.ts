// bun test ./pi/extensions/park-idle/*.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { hasLiveChild, hasShellChild, registerParkIdle } from "./index.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const AFTER = 0.05; // seconds
const WAIT = 120; // ms: past AFTER and the checks

interface World {
  idle: boolean;
  pending: boolean;
  draft: string;
  session: string | undefined;
  ps: string;
  lsof: string;
  hc: string;
}

function harness(over: Partial<World> = {}, env: Record<string, string> = {}, ui = true) {
  const dir = mkdtempSync(join(tmpdir(), "park-idle-"));
  const session = join(dir, "session.jsonl");
  writeFileSync(session, "{}\n");
  const parkFile = join(dir, "park");
  const world: World = { idle: true, pending: false, draft: "", session, ps: `1 launchd\n${process.ppid} zsh\n`, lsof: "",
    hc: JSON.stringify({ id: 2, result: { terminals: [{ address: "t7", parent: null, state: "live" }] } }), ...over };
  const handlers = new Map<string, (...args: any[]) => any>();
  const calls: string[][] = [];
  let input: (() => unknown) | undefined;
  let shutdowns = 0;
  const pi = {
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    async exec(command: string, args: string[]) {
      calls.push([command, ...args]);
      const stdout = command === "/bin/ps" ? world.ps : command === "/usr/sbin/lsof" ? world.lsof : world.hc;
      return { code: command === "/usr/sbin/lsof" && !stdout ? 1 : 0, stdout, stderr: "", killed: false };
    },
  };
  const ctx = {
    hasUI: ui,
    isIdle: () => world.idle,
    hasPendingMessages: () => world.pending,
    shutdown: () => { shutdowns++; },
    ui: { getEditorText: () => world.draft, onTerminalInput: (handler: () => unknown) => { input = handler; return () => { input = undefined; }; } },
    sessionManager: { getSessionFile: () => world.session },
  };
  registerParkIdle(pi as never, { PI_PARK_FILE: parkFile, PI_PARK_PID: "4242", PI_PARK_AFTER: String(AFTER),
    HC_TERMINAL_ID: "t7", ...env }, 4242);
  return {
    world, handlers, calls, parkFile, session,
    emit: (name: string, event: object = {}) => handlers.get(name)?.(event, ctx),
    type: () => input?.(),
    get shutdowns() { return shutdowns; },
    parked: () => existsSync(parkFile) ? readFileSync(parkFile, "utf8") : undefined,
  };
}

test("only a Pi run by the wrapper, with a period, parks", () => {
  for (const env of [{ PI_PARK_FILE: "" }, { PI_PARK_PID: "1" }, { PI_PARK_AFTER: "0" }, { PI_PARK_AFTER: "soon" }]) {
    assert.equal(harness({}, env).handlers.size, 0, JSON.stringify(env));
  }
});

test("an idle Pi writes its session file for the wrapper and quits", async () => {
  const h = harness();
  h.emit("session_start", { reason: "startup" });
  await sleep(WAIT);
  assert.equal(h.parked(), h.session);
  assert.equal(h.shutdowns, 1);
});

test("a key, or a run that starts, puts it off until a full period after", async () => {
  const h = harness();
  h.emit("session_start", { reason: "startup" });
  await sleep(AFTER * 600);
  h.type();
  await sleep(AFTER * 600);
  assert.equal(h.shutdowns, 0, "typed 30 ms ago");
  h.emit("agent_start");
  await sleep(WAIT);
  assert.equal(h.shutdowns, 0, "working");
  h.emit("agent_settled");
  await sleep(WAIT);
  assert.equal(h.shutdowns, 1);
});

test("nothing that would be lost is parked, and it tries again later", async () => {
  const cases: [string, Partial<World>][] = [
    ["agent run", { idle: false }],
    ["queued message", { pending: true }],
    ["draft", { draft: "half a thought" }],
    ["unsaved session", { session: undefined }],
    ["`!cmd` running", { ps: `${process.pid} bash\n${process.pid} node\n` }],
    ["page served", { lsof: `${process.pid}\n` }],
    ["hc sub-terminal", { hc: JSON.stringify({ id: 2, result: { terminals: [{ address: "t8", parent: "t7", state: "live" }] } }) }],
    ["hc unreachable", { hc: "" }],
  ];
  for (const [name, over] of cases) {
    const h = harness(over);
    h.emit("session_start", { reason: "startup" });
    await sleep(WAIT);
    assert.equal(h.shutdowns, 0, name);
    assert.equal(h.parked(), undefined, name);
    Object.assign(h.world, { idle: true, pending: false, draft: "", session: h.session, ps: "", lsof: "",
      hc: JSON.stringify({ id: 2, result: { terminals: [] } }) });
    await sleep(WAIT);
    assert.equal(h.shutdowns, 1, `${name}: parks once it clears`);
  }
});

test("outside Herdr it skips the sub-terminal check; without a UI it never arms", async () => {
  const h = harness({}, { HC_TERMINAL_ID: "" });
  h.emit("session_start", { reason: "startup" });
  await sleep(WAIT);
  assert.equal(h.shutdowns, 1);
  assert.ok(!h.calls.some((c) => c[0] === "/bin/sh"));
  const print = harness({}, {}, false);
  print.emit("session_start", { reason: "startup" });
  await sleep(WAIT);
  assert.equal(print.shutdowns, 0);
});

test("a quit or a session switch stops the timer", async () => {
  const h = harness();
  h.emit("session_start", { reason: "startup" });
  h.emit("session_shutdown", { reason: "quit" });
  await sleep(WAIT);
  assert.equal(h.shutdowns, 0);
});

test("shell children and live sub-terminals are read from ps and hc", () => {
  assert.equal(hasShellChild("  10 zsh\n 4242 node\n 4242 bash\n", 4242), true);
  assert.equal(hasShellChild(" 4242 node\n 4243 bash\n", 4242), false);
  const reply = (terminals: object[]) => `${JSON.stringify({ id: 1, result: {} })}\n${JSON.stringify({ id: 2, result: { terminals } })}\n`;
  assert.equal(hasLiveChild(reply([{ parent: "t7", state: "live" }]), "t7"), true);
  assert.equal(hasLiveChild(reply([{ parent: "t7", state: "finished" }, { parent: "t9", state: "live" }]), "t7"), false);
  assert.throws(() => hasLiveChild("", "t7"));
});
