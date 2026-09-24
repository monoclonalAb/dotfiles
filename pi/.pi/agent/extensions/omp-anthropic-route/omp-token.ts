import { execFile } from "node:child_process";
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
