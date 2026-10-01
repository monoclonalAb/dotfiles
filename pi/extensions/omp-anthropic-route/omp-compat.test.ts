import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { OmpCompatibilityResolver, type OmpCommandRunner, OMP_FORMULA_TEMPLATE, validateOmpFormula, parseOmpVersion, parseLatestRelease, withUpdateLock, commandEnvironment } from "./omp-compat.ts";
import { OMP_PROTOCOL_REVIEW_VERSION } from "./transport.ts";

const version = "18.3.2";
const formulaFor = (version: string) => OMP_FORMULA_TEMPLATE.replace("@VERSION@", version).replaceAll("@SHA256@", "a".repeat(64));
const formula = formulaFor(version);
function fixture(options: { installed?: string; latest?: string; dirty?: boolean; formula?: string; origin?: string; fails?: string; afterUpgrade?: string; worktreeChanged?: boolean; headFormula?: string; onLockVersion?: string } = {}) {
  const calls: string[] = [];
  const latest = options.latest ?? version;
  const candidate = options.formula ?? formulaFor(latest);
  let installed = options.installed ?? version;
  const command: OmpCommandRunner = async (exe, args) => {
    const call = [exe, ...args].join(" "); calls.push(call);
    if (options.fails && call.includes(options.fails)) throw new Error("synthetic command failure");
    if (exe === "curl") return `https://github.com/can1357/oh-my-pi/releases/tag/v${latest}\n`;
    if (exe === "omp") return `omp/${installed}`;
    if (exe === "brew" && args[0] === "--repository") return "/test/tap\n";
    if (exe === "brew" && args[0] === "upgrade") { installed = options.afterUpgrade ?? latest; return ""; }
    if (exe === "git") {
      if (args[2] === "status") return options.dirty ? " M Formula/omp.rb" : "";
      if (args[2] === "remote") return options.origin ?? "https://github.com/can1357/homebrew-tap\n";
      if (args[2] === "rev-parse") return "a".repeat(40);
      if (args[2] === "show") return args[3] === "HEAD:Formula/omp.rb" ? options.headFormula ?? candidate : candidate;
      if (args[2] === "hash-object") return options.worktreeChanged ? "b".repeat(40) : createHash("sha1").update(`blob ${Buffer.byteLength(candidate)}\0`).update(candidate).digest("hex");
      return "";
    }
    throw new Error(`Unexpected test command: ${call}`);
  };
  const resolver = new OmpCompatibilityResolver(command, async op => {
    if (options.onLockVersion) installed = options.onLockVersion;
    await op();
  });
  return { resolver, calls };
}

test("CLI and latest release parsers are strict", () => {
  assert.equal(parseOmpVersion("omp/18.3.2"), version);
  assert.equal(parseOmpVersion("omp v19.0.0-beta.1"), "19.0.0-beta.1");
  assert.equal(parseOmpVersion(version), undefined);
  assert.equal(parseLatestRelease(`https://github.com/can1357/oh-my-pi/releases/tag/v${version}`), version);
  for (const url of ["https://example.com/releases/tag/v18.3.1", "18.3.1", "https://github.com/can1357/oh-my-pi/releases/tag/v18.3.1;id"]) assert.throws(() => parseLatestRelease(url));
});

test("an up-to-date CLI still checks freshness, once per runtime", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.resolver.resolve(), f.resolver.resolve()]);
  assert.equal(a, b); assert.equal(a.compatible, true); assert.equal(a.latestVersion, version);
  assert.equal(a.updateAttempted, false); assert.equal(a.updateError, undefined);
  assert.equal(f.calls.length, 3); assert.equal(f.calls[0], "omp --version"); assert.match(f.calls[1], /^curl /); assert.equal(f.calls[2], "omp --version");
  assert.equal(await f.resolver.resolve(), a);
});

for (const latest of ["18.3.2", "18.4.0", "19.0.0"]) test(`new stable CLI ${latest} upgrades without changing the wire reference`, async () => {
  const f = fixture({ installed: OMP_PROTOCOL_REVIEW_VERSION, latest });
  const result = await f.resolver.resolve();
  assert.equal(result.compatible, true); assert.equal(result.installedVersion, latest);
  assert.equal(result.updateAttempted, true);
  const count = f.calls.length;
  await f.resolver.resolve(); assert.equal(f.calls.length, count, "successful checks are cached");
});

for (const installed of ["18.1.5", "18.2.11", "18.3.0", "18.3.1"]) test(`upgrade from ${installed} validates the tap/formula, upgrades OMP only and rechecks`, async () => {
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
  ["HEAD changed after formula validation", { headFormula: formulaFor("18.3.3") }, /tap changed/],
  ["formula release races latest lookup", { formula: formulaFor("18.3.3") }, /formula needs review/],
  ["unexpected origin", { origin: "https://example.com/tap" }, /origin/],
  ["tap fetch failure", { fails: "fetch" }, /synthetic command failure/],
] as const) {
  test(`${name} skips brew upgrade but keeps the installed CLI usable`, async () => {
    const f = fixture({ installed: "18.1.5", ...options });
    const r = await f.resolver.resolve(); assert.equal(r.compatible, true); assert.equal(r.error, undefined);
    assert.match(r.updateError!, message); assert.equal(r.installedVersion, "18.1.5");
    assert.equal(r.updateAttempted, false); assert.ok(!f.calls.some(c => c.includes("brew upgrade")));
    const count = f.calls.length;
    await f.resolver.resolve(); assert.equal(f.calls.length, count, "update failures are cached for the runtime");
  });
}
for (const installed of ["19.0.0", "18.3.3", "18.3.2-beta.1", "18.1.5-beta.1"]) test(`no automatic downgrade or pre-release replacement from ${installed}`, async () => {
  const f = fixture({ installed }); const r = await f.resolver.resolve();
  assert.equal(r.compatible, true); assert.equal(r.installedVersion, installed); assert.equal(r.updateError, undefined);
  assert.ok(!f.calls.some(c => c.startsWith("brew") || c.startsWith("git"))); assert.equal(f.calls.length, 3);
});

test("a second process finishes the upgrade while this one waits for the lock", async () => {
  const f = fixture({ installed: "18.3.1", onLockVersion: version });
  const result = await f.resolver.resolve();
  assert.equal(result.compatible, true); assert.equal(result.updateAttempted, false); assert.equal(result.updateError, undefined);
  assert.deepEqual(f.calls.filter(c => !c.startsWith("curl")), ["omp --version", "omp --version", "omp --version"]);
});

test("an unexpected version change while waiting is kept rather than upgraded or downgraded", async () => {
  const f = fixture({ installed: "18.3.1", onLockVersion: "18.3.3" });
  const result = await f.resolver.resolve();
  assert.equal(result.compatible, true); assert.equal(result.installedVersion, "18.3.3");
  assert.ok(!f.calls.some(c => c.startsWith("brew")));
});

test("a missing CLI blocks without an update and is rechecked on the next request", async () => {
  let installed: string | undefined;
  const calls: string[] = [];
  const resolver = new OmpCompatibilityResolver(async (exe, args) => {
    calls.push([exe, ...args].join(" "));
    if (exe === "omp") { if (!installed) throw new Error("omp failed during OMP preflight: spawn omp ENOENT"); return `omp/${installed}`; }
    if (exe === "curl") return `https://github.com/can1357/oh-my-pi/releases/tag/v${version}`;
    throw new Error(`Unexpected test command: ${exe}`);
  }, async op => op());
  const missing = await resolver.resolve();
  assert.equal(missing.compatible, false); assert.match(missing.error!, /missing or unusable \(omp failed during OMP preflight: spawn omp ENOENT\)/);
  assert.deepEqual(calls, ["omp --version"]);
  installed = version;
  const fixed = await resolver.resolve();
  assert.notEqual(fixed, missing); assert.equal(fixed.compatible, true); assert.equal(fixed.installedVersion, version);
});

test("formula recipe permits only the matching stable version and four binary hashes", () => {
  validateOmpFormula(formula, version);
  validateOmpFormula(formula.replaceAll("a".repeat(64), "b".repeat(64)), version);
  for (const changed of [
    formulaFor("18.3.3"),
    formula + "system 'unreviewed'\n",
    formula.replace('  license "MIT"', '  depends_on "unreviewed"'),
    formula.replace("https://github.com/can1357/oh-my-pi/releases/download/", "https://example.com/"),
    formula.replace("omp-darwin-arm64", "another-binary"),
    formula.replace("(bin/\"omp\").chmod 0555", "system 'unreviewed'"),
    formula.replace('version "18.3.2"', 'version "#{system(\'unreviewed\')}"'),
    formula.replace("a".repeat(64), "#{system('unreviewed')}"),
    formula.replace("a".repeat(64), "a".repeat(63)),
    formula.replace('  license "MIT"', '  version "18.3.2"\n  license "MIT"'),
    formula.replace('  license "MIT"', '      sha256 "' + "a".repeat(64) + '"'),
  ]) assert.throws(() => validateOmpFormula(changed, version), /formula needs review/);
  assert.throws(() => validateOmpFormula(formula, "18.3.2-beta.1"), /formula needs review/);
});

test("failed install or wrong installed version warns and keeps the installed CLI", async () => {
  for (const [options, message] of [[{ fails: "brew upgrade" }, /synthetic command failure/], [{ afterUpgrade: "18.1.5" }, /Homebrew finished but OMP is 18\.1\.5, not 18\.3\.2/]] as const) {
    const f = fixture({ installed: "18.1.5", ...options }); const r = await f.resolver.resolve();
    assert.equal(r.compatible, true); assert.equal(r.updateAttempted, true); assert.match(r.updateError!, message);
    assert.equal(r.installedVersion, "18.1.5"); assert.equal(f.calls.at(-1), "omp --version");
  }
});

test("offline release check warns without upgrading", async () => {
  const f = fixture({ fails: "curl" }); const r = await f.resolver.resolve();
  assert.equal(r.compatible, true); assert.match(r.updateError!, /synthetic command failure/);
  assert.equal(r.latestVersion, undefined);
  assert.deepEqual(f.calls.filter(c => !c.startsWith("curl")), ["omp --version", "omp --version"]);
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

test("a lock left by a dead or never-recorded owner is reclaimed; a live owner's is not", async () => {
  const root = await mkdtemp(join(tmpdir(), "omp-stale-lock-")); const lock = join(root, "lock");
  try {
    const child = await promisify(execFile)(process.execPath, ["--eval", "console.log(process.pid)"]);
    await mkdir(lock); await writeFile(join(lock, "owner"), child.stdout);
    let ran = false;
    await withUpdateLock(lock, async () => { ran = true; }); assert.ok(ran, "dead owner's lock was reclaimed");
    await mkdir(lock); const old = new Date(Date.now() - 120_000); await utimes(lock, old, old);
    ran = false; await withUpdateLock(lock, async () => { ran = true; }); assert.ok(ran, "old unowned lock was reclaimed");
    await mkdir(lock); await writeFile(join(lock, "owner"), `${process.pid}\n`);
    const waiting = new AbortController(); setTimeout(() => waiting.abort(), 300);
    await assert.rejects(withUpdateLock(lock, async () => {}, waiting.signal));
    assert.equal((await readFile(join(lock, "owner"), "utf8")).trim(), String(process.pid), "live owner keeps its lock");
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
