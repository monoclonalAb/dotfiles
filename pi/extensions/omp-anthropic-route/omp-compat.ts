import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const MAX_OUTPUT_BYTES = 64 * 1024;
const UPDATE_TIMEOUT_MS = 10 * 60_000;
// mkdir and the owner write are not atomic; allow a live owner time to record its PID.
const UNOWNED_LOCK_STALE_MS = 60_000;
const OMP_VERSION_RE = /(?:^|\b)omp[\s/]v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\b|$)/i;
export const LATEST_RELEASE_URL = "https://github.com/can1357/oh-my-pi/releases/latest";
const TAP_ORIGIN = "https://github.com/can1357/homebrew-tap";

// Reviewed recipe at tap fbffe294ac114d89b8c7c71c08594a7a4ade3535.
// Only a stable release number and the four binary hashes may change without
// another recipe review. Compare text, never eval Ruby or download bridge code.
export const OMP_FORMULA_TEMPLATE = `class Omp < Formula
  desc "Coding agent with the IDE wired in"
  homepage "https://omp.sh"
  version "@VERSION@"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/can1357/oh-my-pi/releases/download/v#{version}/omp-darwin-arm64",
          using: :nounzip
      sha256 "@SHA256@"
    end
    on_intel do
      url "https://github.com/can1357/oh-my-pi/releases/download/v#{version}/omp-darwin-x64",
          using: :nounzip
      sha256 "@SHA256@"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/can1357/oh-my-pi/releases/download/v#{version}/omp-linux-arm64",
          using: :nounzip
      sha256 "@SHA256@"
    end
    on_intel do
      url "https://github.com/can1357/oh-my-pi/releases/download/v#{version}/omp-linux-x64",
          using: :nounzip
      sha256 "@SHA256@"
    end
  end

  def install
    bin.install Dir["omp-*"].first => "omp"
    (bin/"omp").chmod 0555
    with_env(HOME: buildpath) do
      generate_completions_from_executable(bin/"omp", "completions", shells: [:bash, :zsh, :fish])
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/omp --version")
  end
end
`;

function stableVersionParts(version: string): number[] | undefined {
  if (!/^\d+\.\d+\.\d+$/.test(version)) return undefined;
  const parts = version.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}

export function validateOmpFormula(formula: string, version: string): void {
  const versions = [...formula.matchAll(/^  version "(\d+\.\d+\.\d+)"$/gm)];
  const hashes = [...formula.matchAll(/^      sha256 "[0-9a-f]{64}"$/gm)];
  const normalized = formula.replace(/^  version "\d+\.\d+\.\d+"$/gm, '  version "@VERSION@"')
    .replace(/^      sha256 "[0-9a-f]{64}"$/gm, '      sha256 "@SHA256@"');
  if (!stableVersionParts(version) || versions.length !== 1 || versions[0][1] !== version ||
      hashes.length !== 4 || normalized !== OMP_FORMULA_TEMPLATE) {
    throw new Error("Latest OMP formula needs review or does not match the latest release; no formula was executed or binary upgraded.");
  }
}

export type OmpCommandRunner = (executable: string, args: readonly string[], signal?: AbortSignal) => Promise<string>;
export type UpdateLock = (operation: () => Promise<void>, signal?: AbortSignal) => Promise<void>;
export interface OmpCompatibilityStatus {
  /** The installed OMP CLI is usable. Update failures do not clear this. */
  compatible: boolean;
  latestVersion?: string;
  installedVersion?: string;
  updateAttempted: boolean;
  /** Non-blocking: the best-effort update failed; the installed CLI is kept. */
  updateError?: string;
  /** Blocking: no usable OMP CLI. */
  error?: string;
}

function firstLine(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message.split(/\r?\n/, 1)[0].slice(0, 500) : fallback;
}

// Retain caller precedence (including test fixtures), but GUI launches need the
// Homebrew/system paths. Upgrades cannot refresh unrelated taps or clean up OMP's
// previous keg. No shell interpolation or credentials in command arguments.
export function commandEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env,
    PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].filter(Boolean).join(":"),
    HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_INSTALL_CLEANUP: "1",
  };
}

function runCommand(executable: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(executable, [...args], { encoding: "utf8", maxBuffer: MAX_OUTPUT_BYTES,
      timeout: UPDATE_TIMEOUT_MS, signal, env: commandEnvironment() }, (error, stdout, stderr) => {
      if (!error) { resolve(stdout); return; } // Preserve formula bytes for hash verification.
      // Keep the tool's own reason (e.g. Homebrew's "Error:" line); these
      // unauthenticated update commands never receive credentials.
      const lines = String(stderr).split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const reason = error.killed ? "timed out or was interrupted"
        : lines.find(line => /^(error|fatal)\b/i.test(line)) ?? lines.at(-1) ?? `exit ${String(error.code ?? "unknown")}`;
      reject(new Error(`${executable} failed during OMP preflight: ${reason.slice(0, 300)}`, { cause: error }));
    });
  });
}

export function parseOmpVersion(output: string): string | undefined {
  return output.match(OMP_VERSION_RE)?.[1];
}

export function parseLatestRelease(output: string): string {
  const version = output.trim().match(/^https:\/\/github\.com\/can1357\/oh-my-pi\/releases\/tag\/v(\d+\.\d+\.\d+)$/)?.[1];
  if (!version || !stableVersionParts(version)) throw new Error("Could not identify the latest stable OMP release; no upgrade or inference was attempted.");
  return version;
}

/** A lock is stale when its recorded owner process no longer exists, or when no
 * owner was recorded long after creation (the owner died between mkdir and write). */
async function isStaleLock(directory: string): Promise<boolean> {
  let owner: string | undefined;
  try { owner = await readFile(join(directory, "owner"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false; }
  const pid = owner === undefined ? NaN : Number(owner.trim());
  if (Number.isSafeInteger(pid) && pid > 0) {
    try { process.kill(pid, 0); return false; } // Signal 0 only tests existence.
    catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
  }
  try { return Date.now() - (await stat(directory)).mtimeMs > UNOWNED_LOCK_STALE_MS; }
  catch { return false; }
}

export async function withUpdateLock(directory: string, operation: () => Promise<void>, signal?: AbortSignal): Promise<void> {
  await mkdir(join(directory, ".."), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + UPDATE_TIMEOUT_MS;
  for (;;) {
    signal?.throwIfAborted();
    try { await mkdir(directory, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A killed Pi (closed pane, SIGKILL) cannot run its finally block. Reclaim
      // its lock rather than waiting out the deadline in every later runtime.
      if (await isStaleLock(directory)) { await rm(directory, { recursive: true, force: true }); continue; }
      if (Date.now() >= deadline) throw new Error(`OMP update lock is busy: ${directory}; its owner is still running.`);
      await delay(100, undefined, { signal });
    }
  }
  try {
    await writeFile(join(directory, "owner"), `${process.pid}\n`, { mode: 0o600 });
    await operation();
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** One best-effort CLI freshness check per runtime. This updates the token CLI,
 * not the independently reviewed wire adapter, so an update failure keeps the
 * installed CLI and is reported as `updateError` rather than blocking Claude.
 * Only a missing/unusable CLI blocks, and that result is not cached. The check
 * takes no caller signal: interrupting a prompt must not kill git or Homebrew
 * mid-update, and must not cache an aborted result. The caller must still
 * probe the selected model before sending real traffic. */
export class OmpCompatibilityResolver {
  private resolved: Promise<OmpCompatibilityStatus> | undefined;
  status: OmpCompatibilityStatus | undefined;

  private readonly command: OmpCommandRunner;
  private readonly lock: UpdateLock;

  constructor(
    command: OmpCommandRunner = runCommand,
    lock: UpdateLock = (operation, signal) => withUpdateLock(join(homedir(), ".local/state/pi-omp-update.lock"), operation, signal),
  ) { this.command = command; this.lock = lock; }

  resolve(): Promise<OmpCompatibilityStatus> {
    const current: Promise<OmpCompatibilityStatus> = this.resolved ??= this.check().then(status => {
      // A missing CLI is fixed outside Pi; recheck on the next request, no /reload.
      if (!status.compatible && this.resolved === current) this.resolved = undefined;
      return status;
    });
    return current;
  }

  private async installedVersion(): Promise<string | undefined> {
    return parseOmpVersion(await this.command("omp", ["--version"]));
  }

  private async check(): Promise<OmpCompatibilityStatus> {
    const status: OmpCompatibilityStatus = { compatible: false, updateAttempted: false };
    this.status = status;
    let unusable: string | undefined;
    try { status.installedVersion = await this.installedVersion(); }
    catch (error) { unusable = firstLine(error, "omp --version failed"); }
    if (!status.installedVersion) {
      status.error = `OMP is missing or unusable (${unusable ?? "unrecognized version"}); install it with \`brew install can1357/tap/omp\``;
      return status;
    }
    try { await this.update(status); }
    catch (error) { status.updateError = firstLine(error, "OMP update failed"); }
    // Re-verify whatever is installed now, including after a failed upgrade.
    try { status.installedVersion = await this.installedVersion(); }
    catch (error) { unusable = firstLine(error, "omp --version failed"); status.installedVersion = undefined; }
    if (!status.installedVersion) {
      status.error = `OMP is missing or unusable after the update check (${unusable ?? "unrecognized version"}); install it with \`brew install can1357/tap/omp\``;
      return status;
    }
    if (!status.updateError && status.updateAttempted && status.installedVersion !== status.latestVersion) {
      status.updateError = `Homebrew finished but OMP is ${status.installedVersion}, not ${status.latestVersion}`;
    }
    status.compatible = true;
    return status;
  }

  private async update(status: OmpCompatibilityStatus): Promise<void> {
    // HEAD avoids the unauthenticated GitHub API's low shared rate limit. Only
    // a canonical release URL is accepted; redirect text is never executable.
    status.latestVersion = parseLatestRelease(await this.command("curl", ["--fail", "--silent", "--show-error", "--head", "--location",
      "--proto", "=https", "--proto-redir", "=https", "--max-time", "20", "--output", "/dev/null", "--write-out", "%{url_effective}", LATEST_RELEASE_URL]));
    const targetVersion = status.latestVersion;
    if (status.installedVersion === targetVersion) return;
    const installed = stableVersionParts(status.installedVersion!), target = stableVersionParts(targetVersion)!;
    const difference = installed?.map((v, i) => v - target[i]).find(v => v !== 0);
    // Newer or manually installed pre-release CLIs are kept as-is: never downgrade.
    if (!installed || difference === undefined || difference > 0) return;
    await this.lock(async () => {
      // Another Pi request may have changed OMP while we waited; keep its result
      // (the caller re-verifies it) rather than upgrading or downgrading again.
      status.installedVersion = await this.installedVersion();
      if (status.installedVersion !== installed.join(".")) return;
      const tap = (await this.command("brew", ["--repository", "can1357/tap"])).trim();
      if (!tap.startsWith("/") || /[\r\n]/.test(tap)) throw new Error("Homebrew returned an invalid OMP tap directory.");
      const git = (args: readonly string[]) => this.command("git", ["-C", tap, ...args]);
      if ((await git(["status", "--porcelain"])).trim()) throw new Error("OMP tap has local changes; refusing to overwrite them.");
      if ((await git(["remote", "get-url", "origin"])).trim().replace(/\.git$/, "") !== TAP_ORIGIN) throw new Error("OMP tap origin is not the reviewed upstream.");
      await git(["fetch", "--quiet", "origin", "main"]);
      const revision = (await git(["rev-parse", "FETCH_HEAD"])).trim();
      if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Invalid OMP tap revision.");
      const hash = (text: string) => createHash("sha256").update(text).digest("hex");
      const candidate = await git(["show", `${revision}:Formula/omp.rb`]);
      validateOmpFormula(candidate, targetVersion);
      const candidateHash = hash(candidate);
      await git(["merge", "--ff-only", "--quiet", revision]);
      // Check actual worktree bytes too: git status alone can miss an
      // assume-unchanged file. The expected blob derives from the already
      // recipe-validated candidate; disable clean filters on the local hash.
      const reviewedBlob = createHash("sha1").update(`blob ${Buffer.byteLength(candidate)}\0`).update(candidate).digest("hex");
      const workingBlob = (await git(["hash-object", "--no-filters", "--", "Formula/omp.rb"])).trim();
      if (workingBlob !== reviewedBlob || hash(await git(["show", "HEAD:Formula/omp.rb"])) !== candidateHash || (await git(["status", "--porcelain"])).trim()) {
        throw new Error("OMP tap changed during update; refusing to run Homebrew.");
      }
      status.updateAttempted = true;
      await this.command("brew", ["upgrade", "can1357/tap/omp"]);
    });
  }
}
