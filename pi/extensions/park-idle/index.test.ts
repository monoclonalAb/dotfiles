// bun test ./pi/extensions/park-idle/*.test.ts
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { childPids, hasCommandChild, hasLiveChild, isActivity, registerParkIdle } from "./index.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const AFTER = 0.05; // seconds
const WAIT = 120; // ms: past AFTER and the checks

interface World {
  idle: boolean;
  pending: boolean;
  draft: string;
  session: string | undefined;
  leaf: string | null;
  ps: string;
  stdin: string;
  lsof: string;
  hc: string;
  onExec?: () => void;
}

// Pi's children as in a real session: MCP servers reading a socket from Pi.
// 709 is the `ps` that listed them, gone by the time lsof runs.
const MCP = { ps: `1 0\n701 ${process.pid}\n702 ${process.pid}\n703 1\n709 ${process.pid}\n`, stdin: "p701\nf0\ntunix\np702\nf0\ntunix\n" };

function harness(over: Partial<World> = {}, env: Record<string, string> = {}, ui = true) {
  const dir = mkdtempSync(join(tmpdir(), "park-idle-"));
  const session = join(dir, "session.jsonl");
  writeFileSync(session, "{}\n");
  const parkFile = join(dir, "park");
  const world: World = { idle: true, pending: false, draft: "", session, leaf: "e2", ...MCP, lsof: "",
    hc: JSON.stringify({ id: 2, result: { terminals: [{ address: "t7", parent: null, state: "live" }] } }), ...over };
  const handlers = new Map<string, (...args: any[]) => any>();
  const calls: string[][] = [];
  let input: (() => unknown) | undefined;
  // The terminal's raw input, as process.stdin delivers it.
  const terminal = new EventEmitter();
  let shutdowns = 0;
  const pi = {
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    async exec(command: string, args: string[]) {
      calls.push([command, ...args]);
      world.onExec?.();
      await sleep(1);
      const stdout = command === "/bin/ps" ? world.ps : command === "/bin/sh" ? world.hc
        : args.includes("-d") ? world.stdin : world.lsof;
      return { code: command === "/usr/sbin/lsof" && !stdout ? 1 : 0, stdout, stderr: "", killed: false };
    },
  };
  const ctx = {
    hasUI: ui,
    isIdle: () => world.idle,
    hasPendingMessages: () => world.pending,
    shutdown: () => { shutdowns++; },
    ui: { getEditorText: () => world.draft, onTerminalInput: (handler: () => unknown) => { input = handler; return () => { input = undefined; }; } },
    sessionManager: { getSessionFile: () => world.session, getLeafId: () => world.leaf,
      getEntries: () => [{ id: "e1" }, { id: "e2" }] },
  };
  registerParkIdle(pi as never, { PI_PARK_FILE: parkFile, PI_PARK_PID: "4242", PI_PARK_AFTER: String(AFTER),
    HC_TERMINAL_ID: "t7", ...env }, 4242, terminal as never);
  return {
    world, handlers, calls, parkFile, session, dir,
    emit: (name: string, event: object = {}) => handlers.get(name)?.(event, ctx),
    // A key reaches Pi's input listeners and stdin.
    type: () => { terminal.emit("data", Buffer.from("a")); input?.(); },
    // Fullscreen Pi takes the wheel, clicks and focus reports before its input
    // listeners see them (measured on Pi 1.6.1); only stdin carries them.
    scroll: () => terminal.emit("data", Buffer.from("\x1b[<64;10;10M")),
    report: (bytes: string) => terminal.emit("data", Buffer.from(bytes)),
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

test("scrolling or clicking the transcript puts it off too", async () => {
  const h = harness();
  h.emit("session_start", { reason: "startup" });
  await sleep(AFTER * 600);
  h.scroll();
  await sleep(AFTER * 600);
  assert.equal(h.shutdowns, 0, "scrolled 30 ms ago");
  await sleep(WAIT);
  assert.equal(h.shutdowns, 1);
});

test("the terminal's own reports are not activity", async () => {
  // A light/dark switch: the scheme report, then the replies to Pi's colour queries.
  for (const reports of ["\x1b[?997;1n", "\x1b]11;rgb:ffff/ffff/ffff\x07\x1b[?1;2c", "\x1b]10;rgb:0/0/0\x1b\\", "\x1b[?2026;2$y"]) {
    const h = harness();
    h.emit("session_start", { reason: "startup" });
    await sleep(AFTER * 600);
    h.report(reports);
    await sleep(AFTER * 600);
    assert.equal(h.shutdowns, 1, `parked on time after ${JSON.stringify(reports)}`);
  }
});

test("keys, the mouse and focus are activity", () => {
  for (const bytes of ["a", "\r", "\x1b", "\x1b[A", "\x1b[97;5u", "\x1bOP", "\x1b[<35;4;5M", "\x1b[I", "\x1b[O"]) {
    assert.equal(isActivity(bytes), true, JSON.stringify(bytes));
  }
  assert.equal(isActivity("\x1b[?997;2n\x1b[?1;2c"), false);
  assert.equal(isActivity("\x1b[?1;2cj"), true, "a key read together with a reply");
});

test("nothing that would be lost is parked, and it tries again later", async () => {
  const cases: [string, Partial<World>][] = [
    ["agent run", { idle: false }],
    ["queued message", { pending: true }],
    ["draft", { draft: "half a thought" }],
    ["unsaved session", { session: undefined }],
    ["`!sleep 40` running (bash has exec'd sleep)", { ps: `${MCP.ps}704 ${process.pid}\n`, stdin: `${MCP.stdin}p704\nf0\ntCHR\n` }],
    ["Ctrl+G editor open", { ps: `${MCP.ps}705 ${process.pid}\n`, stdin: `${MCP.stdin}p705\nf0\ntCHR\n` }],
    ["earlier /tree point", { leaf: "e1" }],
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
    Object.assign(h.world, { idle: true, pending: false, draft: "", session: h.session, leaf: "e2", ...MCP, lsof: "",
      hc: JSON.stringify({ id: 2, result: { terminals: [] } }) });
    await sleep(WAIT);
    assert.equal(h.shutdowns, 1, `${name}: parks once it clears`);
  }
});

test("an open dialog holds it until the dialog closes", async () => {
  const h = harness();
  h.emit("session_start", { reason: "startup" });
  h.emit("ui_prompt_start", { kind: "input" });
  await sleep(WAIT);
  assert.equal(h.shutdowns, 0);
  h.emit("ui_prompt_end", { kind: "input" });
  await sleep(WAIT);
  assert.equal(h.shutdowns, 1);
});

test("a key while the checks run (Ctrl+D to quit) cancels the park", async () => {
  const h = harness();
  h.world.onExec = () => { h.world.onExec = undefined; h.type(); };
  h.emit("session_start", { reason: "startup" });
  await sleep(AFTER * 1000 + 20);
  h.emit("session_shutdown", { reason: "quit" });
  await sleep(WAIT);
  assert.equal(h.parked(), undefined);
  assert.equal(h.shutdowns, 0);
});

test("a park file it cannot write leaves Pi running", async () => {
  const h = harness({}, { PI_PARK_FILE: "/nonexistent-park-dir/park" });
  h.emit("session_start", { reason: "startup" });
  await sleep(WAIT);
  assert.equal(h.shutdowns, 0);
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

test("children, their input and live sub-terminals are read from ps, lsof and hc", () => {
  assert.deepEqual(childPids("  10     1\n 4300  4242\n 4301  4243\n 4302  4242\n", 4242), [4300, 4302]);
  assert.equal(hasCommandChild("p1\nf0\ntunix\np2\nf0\ntunix\n", [1, 2]), false, "MCP servers");
  assert.equal(hasCommandChild("p1\nf0\ntunix\np2\nf0\ntCHR\n", [1, 2]), true, "a command on /dev/null");
  assert.equal(hasCommandChild("p1\nf0\ntunix\np2\nf0\ntPIPE\n", [1, 2]), true, "`!cmd < <(…)`");
  assert.equal(hasCommandChild("p1\nf0\ntunix\n", [1, 2]), false, "2 exited before lsof, as the listing ps does");
  const reply = (terminals: object[]) => `${JSON.stringify({ id: 1, result: {} })}\n${JSON.stringify({ id: 2, result: { terminals } })}\n`;
  assert.equal(hasLiveChild(reply([{ parent: "t7", state: "live" }]), "t7"), true);
  assert.equal(hasLiveChild(reply([{ parent: "t7", state: "finished" }, { parent: "t9", state: "live" }]), "t7"), false);
  assert.throws(() => hasLiveChild("", "t7"));
});
