import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const MAX_OUTPUT_BYTES = 64 * 1024;
const UPDATE_TIMEOUT_MS = 10 * 60_000;
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
  compatible: boolean;
  latestVersion?: string;
  installedVersion?: string;
  updateAttempted: boolean;
  error?: string;
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
      timeout: UPDATE_TIMEOUT_MS, signal, env: commandEnvironment() }, (error, stdout) => {
      if (error) reject(new Error(`${executable} failed during OMP preflight`, { cause: error }));
      else resolve(stdout); // Preserve formula bytes for hash verification.
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

export async function withUpdateLock(directory: string, operation: () => Promise<void>, signal?: AbortSignal): Promise<void> {
  await mkdir(join(directory, ".."), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + UPDATE_TIMEOUT_MS;
  for (;;) {
    signal?.throwIfAborted();
    try { await mkdir(directory, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`OMP update lock is busy: ${directory}. Inspect its owner before removing a stale lock.`);
      await delay(100, undefined, { signal });
    }
  }
  try {
    await writeFile(join(directory, "owner"), `${process.pid}\n`, { mode: 0o600 });
    await operation();
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** One CLI freshness check per runtime, including failures. This updates the
 * token CLI, not the independently reviewed wire adapter. The caller must still
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

  resolve(signal?: AbortSignal): Promise<OmpCompatibilityStatus> {
    this.resolved ??= this.check(signal);
    return this.resolved;
  }

  private async installedVersion(signal?: AbortSignal): Promise<string | undefined> {
    return parseOmpVersion(await this.command("omp", ["--version"], signal));
  }

  private async check(signal?: AbortSignal): Promise<OmpCompatibilityStatus> {
    const status: OmpCompatibilityStatus = { compatible: false, updateAttempted: false };
    this.status = status;
    try {
      signal?.throwIfAborted();
      // HEAD avoids the unauthenticated GitHub API's low shared rate limit. Only
      // a canonical release URL is accepted; redirect text is never executable.
      status.latestVersion = parseLatestRelease(await this.command("curl", ["--fail", "--silent", "--show-error", "--head", "--location",
        "--proto", "=https", "--proto-redir", "=https", "--max-time", "20", "--output", "/dev/null", "--write-out", "%{url_effective}", LATEST_RELEASE_URL], signal));
      const targetVersion = status.latestVersion;
      status.installedVersion = await this.installedVersion(signal);
      if (!status.installedVersion) throw new Error("OMP is missing or returned an unrecognized version; install OMP with Homebrew before retrying.");
      if (status.installedVersion !== targetVersion) {
        const installed = stableVersionParts(status.installedVersion), target = stableVersionParts(targetVersion)!;
        const difference = installed?.map((v, i) => v - target[i]).find(v => v !== 0);
        if (!installed || difference === undefined || difference > 0) {
          throw new Error("Installed OMP is newer or non-stable; automatic downgrade is disabled.");
        }
        await this.lock(async () => {
          // Another Pi request may have completed this upgrade while we waited.
          status.installedVersion = await this.installedVersion(signal);
          if (status.installedVersion === targetVersion) return;
          if (status.installedVersion !== installed.join(".")) throw new Error("OMP changed while waiting for the update lock; /reload to recheck.");
          const tap = (await this.command("brew", ["--repository", "can1357/tap"], signal)).trim();
          if (!tap.startsWith("/") || /[\r\n]/.test(tap)) throw new Error("Homebrew returned an invalid OMP tap directory.");
          const git = (args: readonly string[]) => this.command("git", ["-C", tap, ...args], signal);
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
          await this.command("brew", ["upgrade", "can1357/tap/omp"], signal);
          status.installedVersion = await this.installedVersion(signal);
        }, signal);
      }
      if (status.installedVersion !== targetVersion) throw new Error("OMP upgrade did not install the latest stable version; inference remains blocked.");
      status.compatible = true;
    } catch (error) {
      status.error = error instanceof Error ? error.message.split(/\r?\n/, 1)[0].slice(0, 500) : "OMP preflight failed";
    }
    return status;
  }
}
