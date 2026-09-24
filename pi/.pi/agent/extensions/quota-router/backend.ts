import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AuthInteraction, AuthResult, Credential, Provider } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type AccountsBackend, emptyState, parseState, type RouterState, type StateStore } from "./accounts.ts";

/** Minimal shape of Pi's `RuntimeCredentials`/`AuthStorage` this extension relies on. */
interface CredentialStoreLike {
  read(key: string): Promise<Credential | undefined>;
  modify(key: string, fn: (current: Credential | undefined) => Promise<Credential | undefined>): Promise<Credential | undefined>;
  delete(key: string): Promise<void>;
  list(): Promise<readonly { providerId: string }[]>;
}

/**
 * A provider sharing the base provider's OAuth method and catalogue under another id, used
 * only inside the private runtime so `runtime.login(key)` runs the real login and persists
 * under that key.
 */
export function loginClone(base: Provider, id: string): Provider {
  return {
    id,
    name: `${base.name} (${id})`,
    baseUrl: base.baseUrl,
    headers: base.headers,
    auth: base.auth,
    getModels: () => base.getModels().map((model) => ({ ...model, provider: id })),
    stream: (model, context, options) => base.stream(model, context, options),
    streamSimple: (model, context, options) => base.streamSimple(model, context, options),
  };
}

export interface RuntimeBackendOptions {
  agentDir: string;
  providers?: () => readonly Provider[];
}

/**
 * Credential access through Pi's own locked, owner-only `auth.json` writer. A private
 * `ModelRuntime` on the same file shares Pi's lock; it never streams or refreshes catalogs.
 */
export function createRuntimeBackend(options: RuntimeBackendOptions): AccountsBackend & {
  getAuth(provider: string, key: string, signal: AbortSignal): Promise<AuthResult | undefined>;
} {
  const bases = new Map<string, Provider>();
  for (const provider of (options.providers ?? builtinProviders)()) bases.set(provider.id, provider);
  const registered = new Set<string>();
  let runtimePromise: Promise<{ runtime: ModelRuntime; credentials: CredentialStoreLike }> | undefined;

  function runtime() {
    runtimePromise ??= (async () => {
      const created = await ModelRuntime.create({
        authPath: join(options.agentDir, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      const credentials = (created as unknown as { credentials?: Partial<CredentialStoreLike> }).credentials;
      if (
        !credentials ||
        typeof credentials.read !== "function" ||
        typeof credentials.modify !== "function" ||
        typeof credentials.delete !== "function" ||
        typeof credentials.list !== "function"
      ) {
        throw new Error("quota-router: the installed Pi no longer exposes its credential store as expected");
      }
      return { runtime: created, credentials: credentials as CredentialStoreLike };
    })();
    return runtimePromise;
  }

  return {
    async read(key) {
      return (await runtime()).credentials.read(key);
    },
    async swap(key, next) {
      let previous: Credential | undefined;
      await (await runtime()).credentials.modify(key, async (current) => {
        previous = current;
        return next;
      });
      return previous;
    },
    async remove(key) {
      await (await runtime()).credentials.delete(key);
    },
    async keys() {
      return (await (await runtime()).credentials.list()).map((entry) => entry.providerId);
    },
    supportsLogin(provider) {
      return bases.get(provider)?.auth.oauth !== undefined;
    },
    // Caller holds the account-move lock. Resolve/refresh in place; never activate
    // a parked login merely to inspect its quota. No ambient/API-key fallback.
    async getAuth(provider, key, signal) {
      signal.throwIfAborted();
      const base = bases.get(provider);
      if (!base?.auth.oauth) return undefined;
      const { runtime: created, credentials } = await runtime();
      signal.throwIfAborted();
      if ((await credentials.read(key))?.type !== "oauth") return undefined;
      signal.throwIfAborted();
      if (!registered.has(key)) {
        created.registerNativeProvider(loginClone(base, key));
        registered.add(key);
      }
      return created.getAuth(key, { signal });
    },
    async login(provider, key, interaction) {
      const base = bases.get(provider);
      if (!base?.auth.oauth) throw new Error(`${provider} is not a built-in OAuth provider`);
      const { runtime: created } = await runtime();
      if (!registered.has(key)) {
        created.registerNativeProvider(loginClone(base, key));
        registered.add(key);
      }
      return created.login(key, "oauth", interaction);
    },
  };
}

const LOCK_STALE_MS = 15_000;
const LOCK_WAIT_MS = 5_000;
const STATE_FILE = "state.json";

/** Owner-only state file with atomic replacement and a mkdir lock shared by Pi processes. */
export function createStateStore(dir: string): StateStore {
  const file = join(dir, STATE_FILE);
  const lock = join(dir, "lock");

  function ensureDir(): void {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  return {
    read(): RouterState {
      try {
        return parseState(readFileSync(file, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
        throw error;
      }
    },
    write(state: RouterState): void {
      ensureDir();
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, file);
    },
    async withLock<T>(fn: () => Promise<T>): Promise<T> {
      ensureDir();
      const deadline = Date.now() + LOCK_WAIT_MS;
      for (;;) {
        try {
          mkdirSync(lock);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          try {
            if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
              rmdirSync(lock);
              continue;
            }
          } catch {
            continue;
          }
          if (Date.now() > deadline) throw new Error("quota-router: another Pi session is changing accounts; try again");
          await delay(25);
        }
      }
      try {
        return await fn();
      } finally {
        try {
          rmdirSync(lock);
        } catch {
          // Already removed as stale by another process.
        }
      }
    },
  };
}

export function stateDirectory(): string {
  const xdg = process.env.XDG_STATE_HOME;
  const base = xdg && xdg.trim() !== "" ? xdg : join(process.env.HOME ?? "", ".local", "state");
  return join(base, "pi", "quota-router");
}
