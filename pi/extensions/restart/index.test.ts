// bun test ./pi/extensions/restart/*.test.ts
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "bun:test";
import type { RestartOptions } from "./index.ts";

mock.module("@earendil-works/pi-coding-agent", () => ({
  VERSION: "0.0.0-test", getPackageDir: () => "/nowhere", getAgentDir: () => "/nowhere", CONFIG_DIR_NAME: ".pi",
}));
const { installChange, listed, notice, quote, registerRestart, reloadNotice, WIDGET_KEY } = await import("./index.ts");
// @ts-expect-error plain JavaScript helper
import { relaunch, shellInFront } from "./relaunch.mjs";

const pkg = (version: string, name = "@earendil-works/pi-coding-agent") => JSON.stringify({ name, version });
const missing = () => { throw Object.assign(new Error("gone"), { code: "ENOENT" }); };

test("the installed Pi is compared with the running one", () => {
  assert.equal(installChange("/p/package.json", "1.5.2", () => pkg("1.5.2")), undefined);
  assert.deepEqual(installChange("/p/package.json", "1.5.2", () => pkg("1.6.0")), { kind: "updated", version: "1.6.0" });
  assert.deepEqual(installChange("/p/package.json", "1.5.2", missing), { kind: "removed" });
  assert.equal(installChange("/p/package.json", "1.5.2", () => pkg("9.9.9", "something-else")), undefined, "not Pi's package.json");
  assert.equal(installChange("/p/package.json", "1.5.2", () => "{ half written"), undefined, "mid-install: next check decides");
  assert.equal(installChange(undefined, "1.5.2", () => pkg("1.6.0")), undefined);
  assert.equal(notice({ kind: "updated", version: "1.6.0" }, "1.5.2"),
    "Pi 1.6.0 is installed; this session runs 1.5.2. Type /restart to reopen it on 1.6.0.");
});

function harness(options: RestartOptions = {}, { mode = "tui", idle = true, file = "/s/fix it's.jsonl" as string | null,
  hcGet = { code: 0, stdout: JSON.stringify({ state: "live" }), stderr: "" } as any } = {}) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, any>();
  const widgets: (string[] | undefined)[] = [];
  const notes: [string, string][] = [];
  const execs: string[][] = [];
  const launched: string[][] = [];
  let shutdowns = 0;
  let installed = pkg("1.5.2");
  const where = { agentDir: "/nowhere/agent", cwd: "/nowhere", configDir: ".pi", trusted: false, contextFiles: [] as string[] };
  const pi = {
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    async exec(command: string, args: string[]) {
      execs.push([command, ...args]);
      if (hcGet instanceof Error) throw hcGet;
      return hcGet;
    },
  };
  registerRestart(pi as never, {
    env: { HC_TERMINAL_ID: "t7" }, running: "1.5.2", packageJson: "/p/package.json", pid: 4242,
    read: () => installed, exists: () => true, launch: (args) => launched.push(args), every: 5,
    where: () => where, ...options,
  });
  const ctx = {
    mode,
    isIdle: () => idle,
    shutdown: () => { shutdowns += 1; },
    sessionManager: { getSessionFile: () => file ?? undefined },
    ui: {
      theme: { fg: (_color: string, text: string) => text },
      setWidget: (key: string, lines: string[] | undefined, options: { placement?: string }) => {
        assert.equal(key, WIDGET_KEY);
        assert.equal(options.placement, "aboveEditor");
        widgets.push(lines);
      },
      notify: (message: string, level: string) => notes.push([message, level]),
    },
  };
  return {
    widgets, notes, execs, launched, ctx,
    get shutdowns() { return shutdowns; },
    install(version: string) { installed = pkg(version); },
    where,
    emit: (name: string, event: object = {}) => handlers.get(name)?.(event, ctx),
    restart: () => commands.get("restart").handler("", ctx),
  };
}

test("a line above the input box appears once a newer Pi is installed, and checks stop on shutdown", async () => {
  const h = harness();
  await h.emit("session_start", { reason: "startup" });
  assert.deepEqual(h.widgets, [], "up to date: nothing shown");
  h.install("1.6.0");
  await new Promise((done) => setTimeout(done, 30));
  assert.deepEqual(h.widgets, [["Pi 1.6.0 is installed; this session runs 1.5.2. Type /restart to reopen it on 1.6.0."]],
    "set once, not again on every check");
  h.install("1.5.2");
  await new Promise((done) => setTimeout(done, 30));
  assert.equal(h.widgets.at(-1), undefined, "back in step (a downgrade): removed");
  await h.emit("session_shutdown", { reason: "quit" });
  h.install("1.6.0");
  const seen = h.widgets.length;
  await new Promise((done) => setTimeout(done, 30));
  assert.equal(h.widgets.length, seen);
});

test("changed extensions or settings ask for /reload; a Pi update asks for /restart instead", async () => {
  const root = mkdtempSync(join(tmpdir(), "restart-notice-"));
  try {
    writeFileSync(join(root, "AGENTS.md"), "Be brief");
    const h = harness();
    h.where.contextFiles = [join(root, "AGENTS.md")];
    await h.emit("session_start", { reason: "startup" });
    writeFileSync(join(root, "AGENTS.md"), "Be thorough");
    await new Promise((done) => setTimeout(done, 30));
    assert.deepEqual(h.widgets.at(-1), [`Changed since this session started: ${join(root, "AGENTS.md")}. Type /reload to load them.`]);
    h.install("1.6.0");
    await new Promise((done) => setTimeout(done, 30));
    assert.match(h.widgets.at(-1)![0]!, /^Pi 1\.6\.0 is installed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("names are listed in plain words", () => {
  assert.equal(listed(["a"]), "a");
  assert.equal(listed(["a", "b"]), "a and b");
  assert.equal(listed(["a", "b", "c"]), "a, b and c");
  assert.equal(listed(["a", "b", "c", "d"]), "a, b and 2 more");
  assert.equal(reloadNotice(["restart extension"]), "Changed since this session started: restart extension. Type /reload to load them.");
});

test("print and RPC sessions get no checks", async () => {
  for (const mode of ["print", "json", "rpc"]) {
    const h = harness({}, { mode });
    await h.emit("session_start", { reason: "startup" });
    assert.deepEqual(h.widgets, [], mode);
  }
});

test("/restart starts the helper with the quoted command, then quits", async () => {
  const h = harness();
  await h.restart();
  assert.deepEqual(h.execs, [["hc", "get", "t7", "--json"]]);
  assert.deepEqual(h.launched, [["4242", "hc", "t7", `pi --session '/s/fix it'\\''s.jsonl'`]]);
  assert.equal(h.shutdowns, 1);
  assert.deepEqual(h.notes, []);
});

test("/restart keeps Pi open when it could not reopen the conversation", async () => {
  const cases = [
    { name: "unsaved", h: harness({}, { file: null }), level: "error" },
    { name: "file not written yet", h: harness({ exists: () => false }), level: "error" },
    { name: "outside the Herdr app", h: harness({ env: {} }), level: "info" },
    { name: "busy", h: harness({}, { idle: false }), level: "warning" },
    { name: "hc fails", h: harness({}, { hcGet: { code: 1, stdout: "", stderr: "no core" } }), level: "error" },
    { name: "hc missing", h: harness({}, { hcGet: new Error("ENOENT") }), level: "error" },
    { name: "terminal finished", h: harness({}, { hcGet: { code: 0, stdout: JSON.stringify({ state: "finished" }) } }), level: "error" },
  ];
  for (const { name, h, level } of cases) {
    await h.restart();
    assert.equal(h.shutdowns, 0, name);
    assert.deepEqual(h.launched, [], name);
    assert.equal(h.notes.length, 1, name);
    assert.equal(h.notes[0][1], level, name);
  }
  const outside = cases[2].h;
  assert.match(outside.notes[0][0], /pi --session '\/s\/fix it'\\''s\.jsonl'/, "says what to run instead");
});

test("/restart under the pi wrapper hands the session to it and quits: no helper, no hc, any terminal", async () => {
  for (const env of [{ HC_TERMINAL_ID: "t7" }, {}]) {
    const park = join(mkdtempSync(join(tmpdir(), "restart-")), "park");
    const h = harness({ env: { ...env, PI_PARK_FILE: park, PI_PARK_PID: "900" }, parentPid: 900 });
    await h.restart();
    assert.equal(readFileSync(park, "utf8"), "/s/fix it's.jsonl");
    assert.ok(existsSync(`${park}.now`), "reopen at once, not when focused");
    assert.deepEqual([h.execs, h.launched, h.notes, h.shutdowns], [[], [], [], 1]);
  }
  const busy = harness({ env: { PI_PARK_FILE: "/nowhere/park", PI_PARK_PID: "900" }, parentPid: 900 }, { idle: false });
  await busy.restart();
  assert.deepEqual([busy.shutdowns, busy.notes[0]?.[1]], [0, "warning"]);
  const other = harness({ env: { HC_TERMINAL_ID: "t7", PI_PARK_FILE: "/nowhere/park", PI_PARK_PID: "901" }, parentPid: 900 });
  await other.restart();
  assert.equal(other.launched.length, 1, "another Pi's wrapper: the helper, as before");
});

test("quoting survives single quotes", () => {
  assert.equal(quote("/s/it's here.jsonl"), `'/s/it'\\''s here.jsonl'`);
});

// --- relaunch.mjs ------------------------------------------------------------

const live = (name: string) => ({ state: "live", foreground: { name } });

function fakeRun(screens: object[], { piLives = 2, sendCode = 0 } = {}) {
  let clock = 0;
  let checks = 0;
  const calls: string[][] = [];
  return {
    calls,
    options: {
      pid: 4242, hc: "/x/hc", terminal: "t7", command: "pi --session '/s/a.jsonl'",
      isAlive: () => checks++ < piLives,
      exec: async (command: string, args: string[]) => {
        calls.push([command, ...args]);
        if (args[0] === "send") return { code: sendCode, stdout: "" };
        const screen = screens.length > 1 ? screens.shift() : screens[0];
        return { code: 0, stdout: JSON.stringify(screen) };
      },
      sleep: async (ms: number) => { clock += ms; },
      now: () => clock,
    },
  };
}

test("relaunch waits for Pi to exit and a shell to be in front, then types the command", async () => {
  const f = fakeRun([live("node"), live("node"), live("-zsh")]);
  assert.equal(await relaunch(f.options), "sent");
  assert.deepEqual(f.calls.at(-1), ["/x/hc", "send", "t7", "pi --session '/s/a.jsonl'"]);
  assert.equal(f.calls.filter((c) => c[1] === "get").length, 3, "asked until the shell came back");
});

test("relaunch never types into anything but a shell", async () => {
  const other = fakeRun([live("nvim")]);
  assert.equal(await relaunch(other.options), "no-shell");
  assert.equal(other.calls.some((c) => c[1] === "send"), false);
  const gone = fakeRun([{ state: "finished", foreground: {} }]);
  assert.equal(await relaunch(gone.options), "terminal-gone");
  const stuck = fakeRun([live("zsh")], { piLives: Infinity });
  assert.equal(await relaunch(stuck.options), "pi-still-running");
  assert.equal(stuck.calls.length, 0);
  const refused = fakeRun([live("zsh")], { sendCode: 1 });
  assert.equal(await relaunch(refused.options), "send-failed");
});

test("a shell in front means a live terminal with a shell as its foreground program", () => {
  assert.equal(shellInFront(live("zsh")), true);
  assert.equal(shellInFront(live("/bin/bash")), true);
  assert.equal(shellInFront(live("node")), false);
  assert.equal(shellInFront({ state: "finished", foreground: { name: "zsh" } }), false);
  assert.equal(shellInFront(undefined), false);
});
