import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, rename, unlink, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AccountStore, normalizeLabel, parkedKey } from "../quota-router/accounts.ts";
import type { createRuntimeBackend, createStateStore } from "../quota-router/backend.ts";
import type { AccountSource, QuotaAccount } from "./monitor.ts";

export const PROVIDERS = ["openai-codex", "anthropic"] as const;
export type Provider = (typeof PROVIDERS)[number];
export const LABELS: Record<Provider, string> = { "openai-codex": "Codex", anthropic: "Claude" };
export const POLL_MS = 5 * 60_000;
export const TIMEOUT_MS = 15_000;
export const SHARED_ANTHROPIC_THROTTLE_MS = 15 * 60_000;
export const MAX_CACHE_AGE_MS = 60 * 60_000;
const THROTTLE_LOCK_MS = 30_000;

const ENDPOINTS: Record<Provider, { base: string; usage: string }> = {
  "openai-codex": {
    base: "https://chatgpt.com/backend-api",
    usage: "https://chatgpt.com/backend-api/wham/usage",
  },
  anthropic: {
    base: "https://api.anthropic.com",
    usage: "https://api.anthropic.com/api/oauth/usage",
  },
};

export interface WindowUsage {
  usedPercent: number;
  resetsAt?: number;
}
export interface Quota {
  weekly?: WindowUsage;
  fiveHour?: WindowUsage;
}
export type ErrorCode = "login" | "oauth" | "unsupported" | "timeout" | "rate-limit" | "response" | "network" | "cooldown" | "cache";
/** Display metadata is separate from the whitelisted quota saved in the cache. */
export interface QuotaReading extends Quota {
  fetchedAt?: number;
  cached?: boolean;
  stale?: boolean;
  retryAt?: number;
  warning?: ErrorCode;
}
export class QuotaError extends Error {
  constructor(readonly code: ErrorCode, readonly retryAfterMs?: number) {
    // Never include provider bodies, credentials, account identity or native auth errors.
    super(code);
  }
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectValue : undefined;
}
function windowUsage(percent: unknown, reset: unknown): WindowUsage | undefined {
  if (percent === undefined || percent === null) return undefined;
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new QuotaError("response");
  }
  const result: WindowUsage = { usedPercent: percent };
  if (typeof reset === "number" && Number.isFinite(reset) && reset > 0) result.resetsAt = reset;
  return result;
}

/** Whitelist account-wide windows. additional_rate_limits (including Spark) is never traversed. */
export function parseCodex(value: unknown): Quota {
  const root = object(value);
  if (!root || !("rate_limit" in root)) throw new QuotaError("response");
  const limits = object(root.rate_limit);
  if (root.rate_limit !== null && !limits) throw new QuotaError("response");
  const result: Quota = {};
  for (const key of ["primary_window", "secondary_window"]) {
    const raw = limits?.[key];
    if (raw === undefined || raw === null) continue;
    const window = object(raw);
    if (!window) throw new QuotaError("response");
    const target = window.limit_window_seconds === 604800 ? "weekly"
      : window.limit_window_seconds === 18000 ? "fiveHour" : undefined;
    if (!target) continue;
    const parsed = windowUsage(window.used_percent,
      typeof window.reset_at === "number" ? window.reset_at * 1000 : undefined);
    if (parsed) result[target] = parsed;
  }
  return result;
}

/** Model-specific, routines, and paid-extra buckets are intentionally not account quotas. */
export function parseClaude(value: unknown): Quota {
  const root = object(value);
  if (!root || !("seven_day" in root || "five_hour" in root)) throw new QuotaError("response");
  const result: Quota = {};
  for (const [key, target] of [["seven_day", "weekly"], ["five_hour", "fiveHour"]] as const) {
    const raw = root[key];
    if (raw === undefined || raw === null) continue;
    const window = object(raw);
    if (!window) throw new QuotaError("response");
    const parsed = windowUsage(window.utilization,
      typeof window.resets_at === "string" ? Date.parse(window.resets_at) : undefined);
    if (parsed) result[target] = parsed;
  }
  return result;
}

export type Registry = Pick<ExtensionContext["modelRegistry"], "getProvider" | "getProviderAuth">;
export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type ReadQuota = (
  provider: Provider, signal: AbortSignal, onCached?: (reading: QuotaReading) => void,
) => Promise<QuotaReading | undefined>;
export interface QuotaReaderOptions {
  /** Shared throttle + sanitized snapshot directory. Omit for an uncached reader in tests. */
  throttleDir?: string;
  minIntervalMs?: number;
  now?: () => number;
  /** Separate each resolved login's cache/lease; reuse a still-throttled legacy snapshot. */
  accountScoped?: boolean;
}

export function quotaStateDir(): string {
  return join(homedir(), ".local", "state", "pi", "quota-footer");
}

/** Called only at TUI startup. No auth store is opened during extension discovery. */
export async function createAccountSource(registry: Registry, options: {
  backend?: ReturnType<typeof createRuntimeBackend>;
  state?: ReturnType<typeof createStateStore>;
  fetch?: Fetch;
  readerOptions?: QuotaReaderOptions;
} = {}): Promise<AccountSource> {
  const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
  const backendModule = await import("../quota-router/backend.ts");
  const backend = options.backend ?? backendModule.createRuntimeBackend({ agentDir: getAgentDir() });
  const state = options.state ?? backendModule.createStateStore(backendModule.stateDirectory());
  const accounts = new AccountStore({ backend, state });

  return {
    async list() {
      return state.withLock(async () => {
        const result: QuotaAccount[] = [];
        for (const provider of PROVIDERS) {
          const summary = await accounts.summary(provider);
          // An unlabelled native route remains visible without stored credentials:
          // Pi may resolve explicit runtime auth; API keys/proxies are still rejected.
          result.push({ provider, label: summary.active, active: true });
          for (const slot of summary.slots) {
            if (!slot.active && normalizeLabel(slot.label) === slot.label) {
              result.push({ provider, label: slot.label, active: false });
            }
          }
        }
        return result;
      });
    },
    async read(account, signal, onCached) {
      const read = createQuotaReader({
        getProvider: (provider) => registry.getProvider(provider),
        getProviderAuth: async (provider) => {
          // Below the move lock's 15s stale boundary. Native getAuth propagates
          // cancellation to Pi's locked refresh, including its persistence step.
          const authSignal = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
          return state.withLock(async () => {
            authSignal.throwIfAborted();
            const keys = await backend.keys();
            authSignal.throwIfAborted();
            const active = account.label === undefined ||
              (keys.includes(provider) && accounts.activeLabel(provider) === account.label);
            if (active) return abortable(registry.getProviderAuth(provider), authSignal);
            return backend.getAuth(provider, parkedKey(provider, account.label!), authSignal);
          });
        },
      }, options.fetch, { throttleDir: quotaStateDir(), ...options.readerOptions, accountScoped: true });
      return read(account.provider, signal, onCached);
    },
  };
}

/** Pi's facade cannot cancel auth resolution. Stop waiting without letting late auth start a quota request. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function accountId(token: string): string {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error();
    const payload = object(JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")));
    const account = object(payload?.["https://api.openai.com/auth"])?.chatgpt_account_id;
    if (typeof account !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(account)) throw new Error();
    return account;
  } catch {
    throw new QuotaError("oauth");
  }
}

async function jsonBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new QuotaError("response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > 64 * 1024) throw new QuotaError("response");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (signal.aborted) throw error;
    throw new QuotaError("response");
  } finally {
    void reader.cancel().catch(() => {});
  }
}

export function retryAfterMs(header: string | null, now = Date.now()): number {
  const seconds = header?.trim() ? Number(header) : NaN;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header ?? "") - now;
  return Number.isFinite(delay) ? Math.min(60 * 60_000, Math.max(POLL_MS, delay)) : 15 * 60_000;
}

interface SharedUsage {
  version: 1;
  /** One-way fingerprint, not a token or inferred account ID. Rotation is a miss. */
  scope: string;
  snapshot?: { quota: Quota; fetchedAt: number };
  failure?: ErrorCode;
}
const SHARED_FAILURES: ErrorCode[] = ["login", "timeout", "rate-limit", "response", "network"];

async function readSmallFile(path: string): Promise<string | undefined> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await handle.stat();
    if (!info.isFile() || info.size > 4096) return undefined;
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead <= 4096 ? buffer.subarray(0, bytesRead).toString("utf8") : undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function atomicState(directory: string, name: string, value: string): Promise<void> {
  const temporary = join(directory, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, value, { flag: "wx", mode: 0o600 });
    await rename(temporary, join(directory, name));
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Reconstruct only allowlisted fields; malformed, future and wrong-login records are misses. */
async function readSharedUsage(directory: string, scope: string, now: number): Promise<SharedUsage | undefined> {
  try {
    const value = object(JSON.parse(await readSmallFile(join(directory, "anthropic.json")) ?? "null"));
    if (value?.version !== 1 || value.scope !== scope) return undefined;
    const result: SharedUsage = { version: 1, scope };
    if (value.failure !== undefined) {
      if (!SHARED_FAILURES.includes(value.failure as ErrorCode)) return undefined;
      result.failure = value.failure as ErrorCode;
    }
    if (value.snapshot !== undefined) {
      const snapshot = object(value.snapshot);
      const quota = object(snapshot?.quota);
      const fetchedAt = snapshot?.fetchedAt;
      if (!quota || typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)
        || fetchedAt < 0 || fetchedAt > now) return undefined;
      const normalized: Quota = {};
      for (const key of ["weekly", "fiveHour"] as const) {
        if (quota[key] === undefined) continue;
        const window = object(quota[key]);
        if (!window || typeof window.usedPercent !== "number") return undefined;
        if (window.resetsAt !== undefined && (typeof window.resetsAt !== "number"
          || !Number.isFinite(window.resetsAt) || window.resetsAt <= 0)) return undefined;
        normalized[key] = windowUsage(window.usedPercent, window.resetsAt);
      }
      if (now - fetchedAt < MAX_CACHE_AGE_MS) result.snapshot = { quota: normalized, fetchedAt };
    }
    // An explicit authentication rejection never permits fallback, even if a record was damaged.
    if (result.failure === "login") delete result.snapshot;
    return result;
  } catch {
    return undefined;
  }
}

/** Recheck at display/fallback time too: a deadline can cross a reset or the age limit. */
export function unexpiredReading(reading: QuotaReading, now: number): QuotaReading | undefined {
  const { weekly, fiveHour, ...metadata } = reading;
  if (metadata.fetchedAt === undefined || now < metadata.fetchedAt
    || now - metadata.fetchedAt >= MAX_CACHE_AGE_MS) return undefined;
  const quota: Quota = {};
  let expired = false;
  for (const [key, window] of [["weekly", weekly], ["fiveHour", fiveHour]] as const) {
    if (window?.resetsAt && window.resetsAt <= now) expired = true;
    else if (window) quota[key] = window;
  }
  if (expired && !quota.weekly && !quota.fiveHour) return undefined;
  return { ...metadata, ...quota, stale: expired || metadata.stale };
}

function cachedReading(shared: SharedUsage | undefined, now: number, interval: number, retryAt?: number): QuotaReading | undefined {
  const snapshot = shared?.snapshot;
  if (!snapshot) return undefined;
  return unexpiredReading({
    ...snapshot.quota, fetchedAt: snapshot.fetchedAt, cached: true,
    stale: !!shared?.failure || now - snapshot.fetchedAt >= interval,
    ...(retryAt ? { retryAt } : {}), ...(shared?.failure ? { warning: shared.failure } : {}),
  }, now);
}

async function readNextAllowed(path: string, now: number): Promise<number> {
  const text = await readSmallFile(path);
  const value = text && /^\d+$/.test(text.trim()) ? Number(text) : 0;
  return Number.isSafeInteger(value) && value > now && value <= now + MAX_CACHE_AGE_MS ? value : 0;
}

type RequestLease = { release(cooldownMs?: number, shared?: SharedUsage): Promise<number> };
type LeaseResult = RequestLease | { retryAt: number; busy?: boolean };

/** Keep legacy lock/next names so not-yet-reloaded Pi processes still share the cadence. */
async function claimAnthropicLease(directory: string, now: () => number, minIntervalMs: number): Promise<LeaseResult> {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory()) throw new Error();
    await chmod(directory, 0o700);
  } catch {
    // Fail closed: an unwritable shared throttle must not multiply provider requests.
    throw new QuotaError("cache");
  }

  const lockPath = join(directory, "anthropic.lock");
  const nextPath = join(directory, "anthropic.next");
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = now();
    const next = await readNextAllowed(nextPath, current);
    if (next) return { retryAt: next };

    let handle;
    try {
      handle = await open(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new QuotaError("cache");
      try {
        const age = current - (await lstat(lockPath)).mtimeMs;
        if (age > THROTTLE_LOCK_MS || age < -THROTTLE_LOCK_MS) {
          await unlink(lockPath);
          continue;
        }
      } catch {}
      return { retryAt: current + THROTTLE_LOCK_MS, busy: true };
    }

    const identity = await handle.stat();
    const ownsLock = async () => {
      const current = await lstat(lockPath).catch(() => undefined);
      return current?.ino === identity.ino && current?.dev === identity.dev;
    };
    const unlock = async () => {
      if (await ownsLock()) await unlink(lockPath).catch(() => {});
      await handle.close().catch(() => {});
    };
    const lockedNext = await readNextAllowed(nextPath, now());
    if (lockedNext) {
      await unlock();
      return { retryAt: lockedNext };
    }

    let released = false;
    let nextAllowed = 0;
    return {
      release: async (cooldownMs = 0, shared) => {
        if (released) return nextAllowed;
        released = true;
        nextAllowed = now() + Math.max(minIntervalMs, cooldownMs);
        try {
          if (await ownsLock()) {
            // Publish the result before opening the lease to other readers.
            try {
              if (shared) await atomicState(directory, "anthropic.json", JSON.stringify(shared));
            } finally {
              await atomicState(directory, "anthropic.next", String(nextAllowed));
            }
          }
        } catch {
          throw new QuotaError("cache");
        } finally {
          await unlock();
        }
        return nextAllowed;
      },
    };
  }
  return { retryAt: now() + THROTTLE_LOCK_MS, busy: true };
}

export function createQuotaReader(
  registry: Registry,
  fetchImpl: Fetch = fetch,
  options: QuotaReaderOptions = {},
): ReadQuota {
  // A timed-out native auth refresh may still be running. Reuse it instead of starting duplicates.
  const pendingAuth = new Map<Provider, ReturnType<Registry["getProviderAuth"]>>();
  const now = options.now ?? Date.now;
  return async (provider, signal, onCached) => {
    const endpoint = ENDPOINTS[provider];
    const owner = registry.getProvider(provider);
    if (!owner) throw new QuotaError("login");
    if (owner.baseUrl?.replace(/\/$/, "") !== endpoint.base) throw new QuotaError("unsupported");
    let auth;
    try {
      signal.throwIfAborted();
      let pending = pendingAuth.get(provider);
      if (!pending) {
        pending = registry.getProviderAuth(provider);
        pendingAuth.set(provider, pending);
        const clear = () => { if (pendingAuth.get(provider) === pending) pendingAuth.delete(provider); };
        void pending.then(clear, clear);
      }
      auth = (await abortable(pending, signal))?.auth;
    } catch {
      signal.throwIfAborted();
      throw new QuotaError("login");
    }
    signal.throwIfAborted();
    if (!auth) throw new QuotaError("login");
    if (auth.baseUrl && auth.baseUrl.replace(/\/$/, "") !== endpoint.base) throw new QuotaError("unsupported");
    const token = auth.apiKey;
    if (!token) throw new QuotaError("oauth");
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (provider === "openai-codex") headers["ChatGPT-Account-Id"] = accountId(token);
    else {
      if (!token.startsWith("sk-ant-oat")) throw new QuotaError("oauth");
      headers["anthropic-beta"] = "oauth-2025-04-20";
    }
    const root = provider === "anthropic" ? options.throttleDir : undefined;
    const interval = options.minIntervalMs ?? SHARED_ANTHROPIC_THROTTLE_MS;
    const scope = root ? createHash("sha256").update(token).digest("hex") : "";
    const directory = root && options.accountScoped ? join(root, scope) : root;
    if (root && options.accountScoped) {
      // Honour existing sessions' legacy backoff for this login during adoption.
      // Unknown legacy ownership is conservatively treated as shared backoff.
      const next = await readNextAllowed(join(root, "anthropic.next"), now());
      if (next) {
        let legacyScope: unknown;
        try { legacyScope = object(JSON.parse(await readSmallFile(join(root, "anthropic.json")) ?? "null"))?.scope; } catch {}
        if (legacyScope === scope || typeof legacyScope !== "string" || !/^[a-f0-9]{64}$/.test(legacyScope)) {
          const legacy = await readSharedUsage(root, scope, now());
          const cached = cachedReading(legacy, now(), interval, next);
          if (cached) return cached;
          throw new QuotaError(legacy?.failure ?? "cooldown", next - now());
        }
      }
    }
    let lease: RequestLease | undefined;
    let shared: SharedUsage | undefined;
    let cooldownMs = 0;
    try {
      if (directory) {
        while (true) {
          signal.throwIfAborted();
          const claim = await claimAnthropicLease(directory, now, interval);
          if ("release" in claim) lease = claim;
          shared = await readSharedUsage(directory, scope, now());
          signal.throwIfAborted();
          const cached = cachedReading(shared, now(), interval,
            "retryAt" in claim ? claim.retryAt : now() + interval);
          if (lease) {
            if (cached) onCached?.(cached);
            break;
          }
          if (cached) return cached;
          if ("retryAt" in claim && !claim.busy) {
            throw new QuotaError(shared?.failure ?? "cooldown", claim.retryAt - now());
          }
          // A cold reader follows the winning request locally instead of waiting
          // another five-minute monitor tick or issuing a duplicate HTTP request.
          await delay(100, undefined, { signal });
        }
      }
      signal.throwIfAborted();
      const response = await abortable(fetchImpl(endpoint.usage, { method: "GET", headers, signal, redirect: "error" }), signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (response.status === 401 || response.status === 403) throw new QuotaError("login");
        if (response.status === 429) {
          cooldownMs = retryAfterMs(response.headers.get("retry-after"), now());
          throw new QuotaError("rate-limit", cooldownMs);
        }
        throw new QuotaError("network");
      }
      const value = await jsonBody(response, signal);
      signal.throwIfAborted();
      const quota = provider === "openai-codex" ? parseCodex(value) : parseClaude(value);
      const fetchedAt = now();
      if (!lease) return { ...quota, fetchedAt };
      const retryAt = await lease.release(0, { version: 1, scope, snapshot: { quota, fetchedAt } });
      return { ...quota, fetchedAt, cached: false, stale: false, retryAt };
    } catch (error) {
      signal.throwIfAborted();
      const safe = error instanceof QuotaError ? error : new QuotaError("network");
      if (lease && SHARED_FAILURES.includes(safe.code)) {
        const failed: SharedUsage = {
          version: 1, scope, failure: safe.code,
          ...(safe.code !== "login" && shared?.snapshot ? { snapshot: shared.snapshot } : {}),
        };
        const retryAt = await lease.release(cooldownMs, failed);
        const cached = cachedReading(failed, now(), interval, retryAt);
        if (cached) return cached;
        throw new QuotaError(safe.code, retryAt - now());
      }
      throw safe;
    } finally {
      await lease?.release(cooldownMs);
    }
  };
}
