import assert from "node:assert/strict";
import test from "node:test";
import {
  OmpCompatibilityResolver,
  type OmpCommandRunner,
  parseOmpVersion,
} from "./omp-compat.ts";

test("OMP version parser accepts the CLI's supported forms", () => {
  assert.equal(parseOmpVersion("omp/18.1.2"), "18.1.2");
  assert.equal(parseOmpVersion("omp 18.1.2\n"), "18.1.2");
  assert.equal(parseOmpVersion("omp/v19.0.0-beta.1"), "19.0.0-beta.1");
  assert.equal(parseOmpVersion("18.1.2"), undefined);
});

test("matching OMP skips Homebrew and is compatible", async () => {
  const calls: string[] = [];
  const command: OmpCommandRunner = async (executable, args) => {
    calls.push([executable, ...args].join(" "));
    return "omp/18.1.2";
  };

  const status = await new OmpCompatibilityResolver("18.1.2", command).resolve();

  assert.equal(status.compatible, true);
  assert.equal(status.updateAttempted, false);
  assert.equal(status.installedVersion, "18.1.2");
  assert.deepEqual(calls, ["omp --version"]);
});

test("a mismatch upgrades OMP once and rechecks compatibility", async () => {
  const calls: string[] = [];
  let versionChecks = 0;
  const command: OmpCommandRunner = async (executable, args) => {
    calls.push([executable, ...args].join(" "));
    if (executable === "brew") return "upgraded";
    versionChecks += 1;
    return versionChecks === 1 ? "omp/18.0.0" : "omp/18.1.2";
  };
  const resolver = new OmpCompatibilityResolver("18.1.2", command);

  const [first, second] = await Promise.all([resolver.resolve(), resolver.resolve()]);

  assert.equal(first.compatible, true);
  assert.equal(first.updateAttempted, true);
  assert.equal(first.initialVersion, "18.0.0");
  assert.equal(first.installedVersion, "18.1.2");
  assert.equal(second, first);
  assert.deepEqual(calls, ["omp --version", "brew upgrade omp", "omp --version"]);
});

test("a post-upgrade version mismatch disables the pinned route", async () => {
  let versionChecks = 0;
  const command: OmpCommandRunner = async (executable) => {
    if (executable === "brew") return "upgraded";
    versionChecks += 1;
    return versionChecks === 1 ? "omp/18.0.0" : "omp/19.0.0";
  };

  const status = await new OmpCompatibilityResolver("18.1.2", command).resolve();

  assert.equal(status.compatible, false);
  assert.equal(status.updateAttempted, true);
  assert.equal(status.installedVersion, "19.0.0");
});

test("a failed Homebrew update is reported and leaves the route disabled", async () => {
  const command: OmpCommandRunner = async (executable) => {
    if (executable === "brew") throw new Error("Homebrew is offline");
    return "omp/18.0.0";
  };

  const status = await new OmpCompatibilityResolver("18.1.2", command).resolve();

  assert.equal(status.compatible, false);
  assert.equal(status.updateAttempted, true);
  assert.equal(status.installedVersion, "18.0.0");
  assert.match(status.updateError ?? "", /Homebrew is offline/);
});
