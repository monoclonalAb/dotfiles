// bun test ./pi/extensions/pi-compat/*.test.ts
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, mock, test } from "bun:test";
import type { CheckResult, PiCompatOptions } from "./index.ts";

mock.module("@earendil-works/pi-coding-agent", () => ({ getPackageDir: () => "/nowhere" }));
const { checkState, failureNotice, installedVersion, launchCheck, registerPiCompat, STATUS_KEY } = await import("./index.ts");

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function result(version: string, failed: [string, string][] = [], finished = "2026-11-26T10:02:00+00:00"): CheckResult {
  const suites = [
    { name: "restart", workflow: "/restart", status: "pass", log: "/l/restart.log" },
    ...failed.map(([name, workflow]) => ({ name, workflow, status: "fail", log: `/l/${name}.log` })),
  ];
  return { version, passed: failed.length === 0, finished, suites };
}

function harness(options: PiCompatOptions = {}, { mode = "tui" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-compat-"));
  roots.push(root);
  const state = join(root, "state");
  mkdirSync(state);
  const packageJson = join(root, "package.json");
  const handlers = new Map<string, (...args: any[]) => any>();
  const statuses: (string | undefined)[] = [];
  const notes: [string, string][] = [];
  let launches = 0;
  const finishers: (() => void)[] = [];
  const live = new Set<number>();
  const memory = { launched: new Map<string, number>(), announced: new Set<string>() };
  const pi = { on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); } };
  registerPiCompat(pi as never, {
    packageJson, stateDir: state, alive: (pid) => live.has(pid), launch: (done) => { launches += 1; finishers.push(done); },
    every: 60_000, memory, ...options,
  });
  const ctx = {
    mode, hasUI: true,
    ui: {
      theme: { fg: (colour: string, text: string) => `<${colour}>${text}` },
      setStatus: (key: string, text: string | undefined) => { assert.equal(key, STATUS_KEY); statuses.push(text); },
      notify: (message: string, level: string) => notes.push([message, level]),
    },
  };
  const h = {
    statuses, notes, live, state,
    get launches() { return launches; },
    finish: () => finishers.shift()!(),
    install: (version: string) => writeFileSync(packageJson, JSON.stringify({ name: "@earendil-works/pi-coding-agent", version })),
    running: (pid: number, version: string) => { live.add(pid); writeFileSync(join(state, "running.json"), JSON.stringify({ pid, version })); },
    stopped: (pid: number) => { live.delete(pid); rmSync(join(state, "running.json"), { force: true }); },
    save: (value: CheckResult) => {
      mkdirSync(join(state, value.version), { recursive: true });
      writeFileSync(join(state, value.version, "result.json"), JSON.stringify(value));
    },
    start: () => handlers.get("session_start")!({}, ctx),
    stop: () => handlers.get("session_shutdown")?.({}, ctx),
  };
  return h;
}

test("a version with no result starts one background check, once per process", async () => {
  const h = harness();
  h.install("1.7.0");
  await h.start();
  assert.equal(h.launches, 1);
  assert.deepEqual(h.statuses, ["<dim>checking Pi 1.7.0"]);
  // /reload or /new: the same process does not start another.
  await h.start();
  assert.equal(h.launches, 1);
  await h.stop();
});

test("a check another session is running shows as running and starts nothing", async () => {
  const h = harness();
  h.install("1.7.0");
  h.running(51003, "1.7.0");
  await h.start();
  assert.equal(h.launches, 0);
  assert.deepEqual(h.statuses, ["<dim>checking Pi 1.7.0"]);
  await h.stop();
});

test("failures stay in the footer and are announced once per process", async () => {
  const h = harness();
  h.install("1.7.0");
  h.save(result("1.7.0", [["quota-router", "Account switching"], ["quota-router-pty", "Account switching"], ["vim", "Vim editing"]]));
  await h.start();
  assert.equal(h.launches, 0);
  assert.deepEqual(h.statuses, ["<warning>Pi 1.7.0: 3 checks failed"]);
  assert.deepEqual(h.notes, [[
    "Pi 1.7.0 failed 3 of 4 extension checks. Affected: Account switching; Vim editing. Details and logs: pi-compat-check --status",
    "warning",
  ]]);
  await h.start(); // a new session in the same Pi
  assert.equal(h.notes.length, 1);
  assert.deepEqual(h.statuses.at(-1), "<warning>Pi 1.7.0: 3 checks failed");
  await h.stop();
});

test("a pass is announced only to a session that saw the check run", async () => {
  const quiet = harness();
  quiet.install("1.7.0");
  quiet.save(result("1.7.0"));
  await quiet.start();
  assert.deepEqual(quiet.statuses, []);
  assert.deepEqual(quiet.notes, []);
  await quiet.stop();

  const h = harness({ every: 5 });
  h.install("1.7.0");
  h.running(51003, "1.7.0");
  await h.start();
  h.save(result("1.7.0"));
  h.stopped(51003);
  await Bun.sleep(30);
  await h.stop();
  assert.deepEqual(h.statuses, ["<dim>checking Pi 1.7.0", undefined]);
  assert.deepEqual(h.notes, [["Pi 1.7.0 passed all 1 extension checks.", "info"]]);
});

test("the result shows as soon as the check this session started exits", async () => {
  const h = harness(); // polls only every minute
  h.install("1.7.0");
  await h.start();
  assert.deepEqual(h.statuses, ["<dim>checking Pi 1.7.0"]);
  h.save(result("1.7.0", [["vim", "Vim editing"]]));
  h.finish();
  assert.deepEqual(h.statuses, ["<dim>checking Pi 1.7.0", "<warning>Pi 1.7.0: 1 check failed"]);
  assert.equal(h.notes.length, 1);
  await h.stop();
});

test("a check that exits after the session ended changes nothing", async () => {
  const h = harness();
  h.install("1.7.0");
  await h.start();
  await h.stop();
  h.save(result("1.7.0", [["vim", "Vim editing"]]));
  h.finish();
  assert.deepEqual(h.statuses, ["<dim>checking Pi 1.7.0"]);
  assert.deepEqual(h.notes, []);
});

test("a newer install is checked even when the previous version passed", async () => {
  const h = harness({ every: 5 });
  h.install("1.7.0");
  h.save(result("1.7.0"));
  await h.start();
  assert.equal(h.launches, 0);
  h.install("1.7.1");
  await Bun.sleep(30);
  await h.stop();
  assert.equal(h.launches, 1);
  assert.equal(h.statuses.at(-1), "<dim>checking Pi 1.7.1");
});

test("a started check that never runs or saves a result is reported after a grace period", async () => {
  let clock = 1_000_000;
  const h = harness({ now: () => clock, every: 5 });
  h.install("1.7.0");
  await h.start();
  assert.equal(h.launches, 1);
  clock += 60_000;
  await Bun.sleep(20);
  assert.equal(h.statuses.at(-1), "<dim>checking Pi 1.7.0");
  clock += 3 * 60_000;
  await Bun.sleep(20);
  await h.stop();
  assert.equal(h.launches, 1, "not retried every minute");
  assert.equal(h.statuses.at(-1), "<warning>Pi 1.7.0 not checked: run pi-compat-check");
});

test("print mode and half-written installs do nothing", async () => {
  const printed = harness({}, { mode: "print" });
  printed.install("1.7.0");
  await printed.start();
  assert.equal(printed.launches, 0);
  assert.deepEqual(printed.statuses, []);

  const h = harness();
  await h.start(); // package.json missing mid-install
  assert.equal(h.launches, 0);
  assert.deepEqual(h.statuses, []);
  await h.stop();
});

test("reading Pi's version and the saved state", () => {
  assert.equal(installedVersion("/p", () => JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.7.0" })), "1.7.0");
  assert.equal(installedVersion("/p", () => JSON.stringify({ name: "other", version: "1.7.0" })), undefined);
  assert.equal(installedVersion("/p", () => "{ half"), undefined);
  const files: Record<string, string> = {
    "/s/running.json": JSON.stringify({ pid: 7, version: "1.7.0" }),
    "/s/1.7.0/result.json": JSON.stringify(result("1.7.0")),
  };
  const read = (path: string) => { if (path in files) return files[path]!; throw new Error("ENOENT"); };
  assert.deepEqual(checkState("/s", "1.7.0", read, () => true), { kind: "running", version: "1.7.0" });
  assert.equal(checkState("/s", "1.7.0", read, () => false).kind, "done", "a dead check's lock is ignored");
  assert.deepEqual(checkState("/s", "1.7.1", read, () => false), { kind: "none" });
  assert.match(failureNotice(result("1.7.0", [["a", "A"]])), /failed 1 of 2 extension checks\. Affected: A\./);
});

test("a missing check script does not crash Pi", async () => {
  launchCheck("/nowhere/pi-compat-check");
  await Bun.sleep(50);
});

test("the launcher reports when the check exits", async () => {
  const exited = await new Promise<boolean>((resolve) => {
    launchCheck("/usr/bin/true", () => resolve(true));
    setTimeout(() => resolve(false), 5000);
  });
  assert.equal(exited, true);
});
