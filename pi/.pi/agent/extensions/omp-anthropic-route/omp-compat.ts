import { execFile } from "node:child_process";

const MAX_OUTPUT_BYTES = 64 * 1024;
const UPDATE_TIMEOUT_MS = 10 * 60_000;
const OMP_VERSION_RE = /(?:^|\b)omp[\s/]v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)(?:\b|$)/i;

export type OmpCommandRunner = (
  executable: string,
  args: readonly string[],
  signal?: AbortSignal,
) => Promise<string>;

export interface OmpCompatibilityStatus {
  compatible: boolean;
  targetVersion: string;
  initialVersion?: string;
  installedVersion?: string;
  updateAttempted: boolean;
  updateError?: string;
  versionError?: string;
}

function runCommand(
  executable: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        signal,
        timeout: UPDATE_TIMEOUT_MS,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error && error.message.length > 0
    ? error.message
    : "unknown command failure";
  return message.split(/\r?\n/, 1)[0].slice(0, 300);
}

export function parseOmpVersion(output: string): string | undefined {
  return output.match(OMP_VERSION_RE)?.[1];
}

/**
 * Verify that the installed OMP matches the reviewed wire implementation.
 * A mismatch gets one package-only Homebrew upgrade attempt per extension
 * runtime. The caller must use the pinned route only when compatible is true.
 */
export class OmpCompatibilityResolver {
  private resolved: Promise<OmpCompatibilityStatus> | undefined;

  constructor(
    private readonly targetVersion: string,
    private readonly command: OmpCommandRunner = runCommand,
  ) {}

  resolve(signal?: AbortSignal): Promise<OmpCompatibilityStatus> {
    this.resolved ??= this.check(signal).catch((error) => {
      this.resolved = undefined;
      throw error;
    });
    return this.resolved;
  }

  invalidate(): void {
    this.resolved = undefined;
  }

  private async installedVersion(signal?: AbortSignal): Promise<string> {
    const output = await this.command("omp", ["--version"], signal);
    const version = parseOmpVersion(output);
    if (!version) throw new Error("OMP returned an unrecognized version");
    return version;
  }

  private async check(signal?: AbortSignal): Promise<OmpCompatibilityStatus> {
    signal?.throwIfAborted();
    let initialVersion: string | undefined;
    let versionError: string | undefined;

    try {
      initialVersion = await this.installedVersion(signal);
    } catch (error) {
      signal?.throwIfAborted();
      versionError = errorMessage(error);
    }

    if (initialVersion === this.targetVersion) {
      return {
        compatible: true,
        targetVersion: this.targetVersion,
        initialVersion,
        installedVersion: initialVersion,
        updateAttempted: false,
      };
    }

    let updateError: string | undefined;
    try {
      await this.command("brew", ["upgrade", "omp"], signal);
    } catch (error) {
      signal?.throwIfAborted();
      updateError = errorMessage(error);
    }

    let installedVersion = initialVersion;
    try {
      installedVersion = await this.installedVersion(signal);
      versionError = undefined;
    } catch (error) {
      signal?.throwIfAborted();
      versionError = errorMessage(error);
    }

    return {
      compatible: installedVersion === this.targetVersion,
      targetVersion: this.targetVersion,
      initialVersion,
      installedVersion,
      updateAttempted: true,
      ...(updateError ? { updateError } : {}),
      ...(versionError ? { versionError } : {}),
    };
  }
}
