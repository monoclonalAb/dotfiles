import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { commandEnvironment } from "./omp-compat.ts";

const TOKEN_CACHE_MS = 60_000;
const MAX_OUTPUT_BYTES = 64 * 1024;

type TokenCommand = (signal?: AbortSignal) => Promise<string>;

function runOmpTokenCommand(signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "omp",
      ["token", "anthropic"],
      {
        encoding: "utf8",
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: 15_000,
        env: commandEnvironment(),
        signal,
      },
      (error, stdout) => {
        if (error) {
          reject(new Error(
            signal?.aborted
              ? "OMP Anthropic token resolution was aborted"
              : "Could not resolve the logged-in OMP Anthropic credential",
            { cause: error },
          ));
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

/**
 * Resolve OMP's current Anthropic access token without persisting or logging it.
 * The short cache coalesces Pi tool turns while leaving refresh/account choice
 * under OMP's credential manager.
 */
export class OmpAnthropicTokenResolver {
  private cached: { value: string; expiresAt: number } | undefined;
  private inflight: Promise<string> | undefined;
  private readonly command: TokenCommand;

  constructor(command: TokenCommand = runOmpTokenCommand) {
    this.command = command;
  }

  async resolve(signal?: AbortSignal): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt) return this.cached.value;
    if (this.inflight) return this.inflight;

    this.inflight = this.command(signal)
      .then((value) => {
        if (!value.includes("sk-ant-oat") || /\r|\n/.test(value)) {
          throw new Error("OMP did not return an Anthropic OAuth credential");
        }
        this.cached = { value, expiresAt: Date.now() + TOKEN_CACHE_MS };
        return value;
      })
      .finally(() => {
        this.inflight = undefined;
      });
    return this.inflight;
  }

  invalidate(): void {
    this.cached = undefined;
  }
}

export const ACCOUNT_CHANGED_ERROR =
  "OMP returned a different or unverifiable Anthropic account since the preflight test; /reload to verify it. No automatic account fallback.";

/**
 * Pins a runtime to the Anthropic account behind its first OMP credential.
 * OMP refreshes OAuth access tokens every few hours, so a new token is accepted
 * when Anthropic reports the same account UUID. A different account, or one that
 * cannot be identified, blocks. Only SHA-256 fingerprints are kept, in memory.
 */
export class OmpAccountGuard {
  private verified: { credential: string; account: Promise<string | undefined> } | undefined;
  private rotation: { credential: string; sameAccount: Promise<boolean> } | undefined;
  private readonly accountOf: (accessToken: string) => Promise<string | undefined>;

  constructor(accountOf: (accessToken: string) => Promise<string | undefined>) {
    this.accountOf = (accessToken) => accountOf(accessToken).catch(() => undefined);
  }

  async accept(accessToken: string): Promise<void> {
    const credential = createHash("sha256").update(accessToken).digest("hex");
    const verified = this.verified;
    if (!verified) {
      this.verified = { credential, account: this.accountOf(accessToken) };
      return;
    }
    if (verified.credential === credential) return;
    if (this.rotation?.credential !== credential) {
      this.rotation = { credential, sameAccount: Promise.all([verified.account, this.accountOf(accessToken)])
        .then(([expected, actual]) => expected !== undefined && actual === expected) };
    }
    const rotation = this.rotation;
    const sameAccount = await rotation.sameAccount;
    if (this.rotation === rotation) this.rotation = undefined;
    if (!sameAccount) throw new Error(ACCOUNT_CHANGED_ERROR);
    if (this.verified === verified) this.verified = { credential, account: verified.account };
  }
}
