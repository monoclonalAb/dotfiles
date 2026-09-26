import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { OmpCompatibilityResolver, type OmpCommandRunner, parseOmpVersion, parseLatestRelease, withUpdateLock, commandEnvironment } from "./omp-compat.ts";

const version = "18.3.1";
const formula = 'class Omp < Formula\n  version "18.3.1"\nend\n';
const hash = createHash("sha256").update(formula).digest("hex");
function fixture(options: { installed?: string; latest?: string; dirty?: boolean; formula?: string; origin?: string; fails?: string; afterUpgrade?: string; worktreeChanged?: boolean } = {}) {
  const calls: string[] = [];
  let installed = options.installed ?? version;
  const command: OmpCommandRunner = async (exe, args) => {
    const call = [exe, ...args].join(" "); calls.push(call);
    if (options.fails && call.includes(options.fails)) throw new Error("synthetic command failure");
    if (exe === "curl") return `https://github.com/can1357/oh-my-pi/releases/tag/v${options.latest ?? version}\n`;
    if (exe === "omp") return `omp/${installed}`;
    if (exe === "brew" && args[0] === "--repository") return "/test/tap\n";
    if (exe === "brew" && args[0] === "upgrade") { installed = options.afterUpgrade ?? version; return ""; }
    if (exe === "git") {
      if (args[2] === "status") return options.dirty ? " M Formula/omp.rb" : "";
      if (args[2] === "remote") return options.origin ?? "https://github.com/can1357/homebrew-tap\n";
      if (args[2] === "rev-parse") return "a".repeat(40);
      if (args[2] === "show") return options.formula ?? formula;
      if (args[2] === "hash-object") return options.worktreeChanged ? "b".repeat(40) : createHash("sha1").update(`blob ${Buffer.byteLength(formula)}\0`).update(formula).digest("hex");
      return "";
    }
    throw new Error(`Unexpected test command: ${call}`);
  };
  const resolver = new OmpCompatibilityResolver(version, hash, command, async op => op());
  return { resolver, calls };
}

test("CLI and latest release parsers are strict", () => {
  assert.equal(parseOmpVersion("omp/18.3.1"), version);
  assert.equal(parseOmpVersion("omp v19.0.0-beta.1"), "19.0.0-beta.1");
  assert.equal(parseOmpVersion(version), undefined);
  assert.equal(parseLatestRelease(`https://github.com/can1357/oh-my-pi/releases/tag/v${version}`), version);
  for (const url of ["https://example.com/releases/tag/v18.3.1", "18.3.1", "https://github.com/can1357/oh-my-pi/releases/tag/v18.3.1;id"]) assert.throws(() => parseLatestRelease(url));
});

test("even matching pins check freshness, once per runtime", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.resolver.resolve(), f.resolver.resolve()]);
  assert.equal(a, b); assert.equal(a.compatible, true); assert.equal(a.latestVersion, version);
  assert.equal(a.updateAttempted, false);
  assert.equal(f.calls.length, 2); assert.match(f.calls[0], /^curl /); assert.equal(f.calls[1], "omp --version");
  assert.equal(await f.resolver.resolve(), a);
});

test("matching OLD pins do not pass when upstream has an unreviewed release", async () => {
  const f = fixture({ latest: "18.3.2" });
  const result = await f.resolver.resolve();
  assert.equal(result.compatible, false); assert.match(result.error!, /needs protocol review/);
  assert.equal(f.calls.length, 1, "no binary, token, tap or install commands on unreviewed release");
  await f.resolver.resolve(); assert.equal(f.calls.length, 1, "failed checks are cached too");
});

for (const installed of ["18.1.5", "18.2.11", "18.3.0"]) test(`reviewed upgrade from ${installed} validates the tap/formula, upgrades OMP only and rechecks`, async () => {
  const f = fixture({ installed });
  const r = await f.resolver.resolve();
  assert.equal(r.compatible, true); assert.equal(r.updateAttempted, true); assert.equal(r.installedVersion, version);
  assert.deepEqual(f.calls.filter(c => c.startsWith("brew")), ["brew --repository can1357/tap", "brew upgrade can1357/tap/omp"]);
  assert.ok(f.calls.findIndex(c => c.includes("show HEAD:")) < f.calls.findIndex(c => c.includes("brew upgrade")));
  assert.equal(f.calls.at(-1), "omp --version");
});

for (const [name, options, message] of [
  ["formula drift", { formula: formula + "# unreviewed" }, /formula needs review/],
  ["dirty tap", { dirty: true }, /local changes/],
  ["modified worktree hidden from status", { worktreeChanged: true }, /tap changed/],
  ["unexpected origin", { origin: "https://example.com/tap" }, /origin/],
  ["tap fetch failure", { fails: "fetch" }, /synthetic command failure/],
] as const) {
  test(`${name} blocks before brew upgrade`, async () => {
    const f = fixture({ installed: "18.1.5", ...options });
    const r = await f.resolver.resolve(); assert.equal(r.compatible, false); assert.match(r.error!, message);
    assert.equal(r.updateAttempted, false); assert.ok(!f.calls.some(c => c.includes("brew upgrade")));
  });
}
for (const installed of ["19.0.0", "18.3.1-beta.1"]) test(`no automatic downgrade from ${installed}`, async () => {
  const f = fixture({ installed }); const r = await f.resolver.resolve();
  assert.equal(r.compatible, false); assert.match(r.error!, /downgrade/); assert.equal(f.calls.length, 2);
});

test("failed install or wrong installed version stays blocked", async () => {
  for (const options of [{ fails: "brew upgrade" }, { afterUpgrade: "18.1.5" }]) {
    const f = fixture({ installed: "18.1.5", ...options }); const r = await f.resolver.resolve();
    assert.equal(r.compatible, false); assert.equal(r.updateAttempted, true); assert.ok(r.error);
  }
});

test("offline/aborted startup is blocked without upgrade", async () => {
  const f = fixture({ fails: "curl" }); assert.equal((await f.resolver.resolve()).compatible, false);
  assert.equal(f.calls.length, 1);
  const g = fixture(); const controller = new AbortController(); controller.abort();
  assert.equal((await g.resolver.resolve(controller.signal)).compatible, false); assert.deepEqual(g.calls, []);
});

test("private filesystem lock serializes owners and releases after errors; waiter cannot remove it", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-lock-test-")); const lock = join(root, "lock");
  try {
    let inside = 0, maximum = 0;
    const operation = async () => { maximum = Math.max(maximum, ++inside); await delay(30); inside--; };
    await Promise.all([withUpdateLock(lock, operation), withUpdateLock(lock, operation)]);
    assert.equal(maximum, 1);
    await assert.rejects(withUpdateLock(lock, async () => { throw new Error("fixture"); }), /fixture/);
    await assert.rejects(stat(lock), { code: "ENOENT" });
    await withUpdateLock(lock, async () => {
      const controller = new AbortController(); controller.abort();
      await assert.rejects(withUpdateLock(lock, operation, controller.signal));
      assert.ok((await stat(lock)).isDirectory());
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("two independent processes cannot overlap an OMP update lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-process-lock-"));
  try {
    const lock = join(root, "lock"), log = join(root, "events");
    const script = `import { withUpdateLock } from ${JSON.stringify(new URL('./omp-compat.ts', import.meta.url).href)};
      import { appendFileSync } from 'node:fs';
      await withUpdateLock(${JSON.stringify(lock)}, async () => {
        appendFileSync(${JSON.stringify(log)}, process.pid + ' start\\n');
        await new Promise(resolve => setTimeout(resolve, 100));
        appendFileSync(${JSON.stringify(log)}, process.pid + ' end\\n');
      });`;
    await Promise.all([1, 2].map(() => promisify(execFile)(process.execPath, ["--eval", script], { timeout: 5000 })));
    const events = (await readFile(log, "utf8")).trim().split("\n").map(line => line.split(" "));
    assert.equal(events.length, 4);
    assert.equal(events[0][0], events[1][0]); assert.equal(events[2][0], events[3][0]);
    assert.notEqual(events[0][0], events[2][0]);
    assert.deepEqual(events.map(e => e[1]), ["start", "end", "start", "end"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("command environment supplies minimal PATH and disables unrelated brew update/cleanup", () => {
  const env = commandEnvironment(); assert.match(env.PATH!, /\/opt\/homebrew\/bin/);
  assert.equal(env.HOMEBREW_NO_AUTO_UPDATE, "1"); assert.equal(env.HOMEBREW_NO_INSTALL_CLEANUP, "1");
});
