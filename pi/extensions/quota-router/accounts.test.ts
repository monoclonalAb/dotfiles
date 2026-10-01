import { describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Credential } from "@earendil-works/pi-ai";
import type * as Accounts from "./accounts.ts";
import type * as Backend from "./backend.ts";

// Resolve the installed Pi packages the way Pi aliases them for extensions.
const codingAgentRoot = join(
  execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(),
  "@earendil-works/pi-coding-agent",
);
const aiRoot = join(codingAgentRoot, "node_modules/@earendil-works/pi-ai/dist");
mock.module("@earendil-works/pi-server", () => ({
  ServerError: class ServerError extends Error {},
  SessionAmbiguousError: class SessionAmbiguousError extends Error {},
  SessionNotFoundError: class SessionNotFoundError extends Error {},
}));
mock.module("@earendil-works/pi-server/unix", () => ({
  createUnixServer: () => { throw new Error("@earendil-works/pi-server stub"); },
  getUnixSocketPath: () => "",
}));
const ai = await import(pathToFileURL(join(aiRoot, "compat.js")).href);
const providersAll = await import(pathToFileURL(join(aiRoot, "providers/all.js")).href);
const codingAgent = await import(pathToFileURL(join(codingAgentRoot, "dist/index.js")).href);
mock.module("@earendil-works/pi-ai", () => ai);
mock.module("@earendil-works/pi-ai/providers/all", () => providersAll);
mock.module("@earendil-works/pi-coding-agent", () => codingAgent);
const { AccountStore, accountIdentity, DEFAULT_LABEL, emptyState, normalizeLabel, parkedKey, parseParkedKey, parseState } =
  (await import("./accounts.ts")) as typeof Accounts;
const { createRuntimeBackend, createStateStore, loginClone } = (await import("./backend.ts")) as typeof Backend;

const { createAccountSource } = await import("../quota-footer/quota.ts");
const T0 = Date.UTC(2026, 8, 12, 12, 0, 0);
const cred = (tag: string, accountId = tag): Credential =>
  ({ type: "oauth", access: `access-${tag}`, refresh: `refresh-${tag}`, expires: T0 + 3_600_000, accountId }) as Credential;

function memoryBackend(initial: Record<string, Credential> = {}, login?: (provider: string, key: string) => Credential) {
  const data = new Map(Object.entries(initial));
  const log: string[] = [];
  const backend: Accounts.AccountsBackend = {
    read: async (key) => data.get(key),
    swap: async (key, next) => {
      const previous = data.get(key);
      data.set(key, next);
      log.push(`swap ${key}`);
      return previous;
    },
    remove: async (key) => {
      data.delete(key);
      log.push(`remove ${key}`);
    },
    keys: async () => [...data.keys()],
    login: async (provider, key) => {
      const credential = login ? login(provider, key) : cred(key);
      data.set(key, credential);
      log.push(`login ${key}`);
      return credential;
    },
    supportsLogin: (provider) => provider === "openai-codex" || provider === "anthropic",
  };
  return { backend, data, log };
}

function memoryState() {
  let state = emptyState();
  let depth = 0;
  let maxDepth = 0;
  const store: Accounts.StateStore = {
    read: () => structuredClone(state),
    write: (next) => {
      state = structuredClone(next);
    },
    withLock: async (fn) => {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      try {
        return await fn();
      } finally {
        depth--;
      }
    },
  };
  return { store, get state() { return state; }, get maxDepth() { return maxDepth; } };
}

function makeStore(initial: Record<string, Credential> = {}, now = () => T0) {
  const backend = memoryBackend(initial);
  const state = memoryState();
  const store = new AccountStore({ backend: backend.backend, state: state.store, now });
  return { store, backend, state };
}

describe("labels, keys and state parsing", () => {
  test("labels are lower-case slugs; parked keys split at the first @", () => {
    expect(normalizeLabel(" Work ")).toBe("work");
    expect(normalizeLabel("my-2nd")).toBe("my-2nd");
    expect(normalizeLabel("bad label")).toBeUndefined();
    expect(normalizeLabel(3)).toBeUndefined();
    expect(parkedKey("openai-codex", "work")).toBe("openai-codex@work");
    expect(parseParkedKey("openai-codex@work")).toEqual({ provider: "openai-codex", label: "work" });
    expect(parseParkedKey("openai-codex")).toBeUndefined();
    expect(parseParkedKey("@x")).toBeUndefined();
    expect(parseParkedKey("x@")).toBeUndefined();
  });

  test("state parsing tolerates garbage and drops invalid entries", () => {
    expect(parseState(undefined)).toEqual(emptyState());
    expect(parseState("nope")).toEqual(emptyState());
    expect(parseState("[]")).toEqual(emptyState());
    const parsed = parseState(
      JSON.stringify({
        providers: { "openai-codex": { active: "Work", preferred: "main" }, anthropic: { active: "bad label" }, x: 1, y: { active: "a", preferred: "a" } },
        cooldowns: { "openai-codex@main": { until: 5, reason: "usage limit" }, bad: { until: "x" }, z: 3 },
      }),
    );
    expect(parsed).toEqual({
      providers: { "openai-codex": { active: "work", preferred: "main" }, y: { active: "a" } },
      cooldowns: { "openai-codex@main": { until: 5, reason: "usage limit" } },
    });
  });

  test("account identity comes from the Codex accountId only", () => {
    expect(accountIdentity(cred("a", "acct-1"))).toBe("acct-1");
    expect(accountIdentity({ type: "api_key", key: "k" } as Credential)).toBeUndefined();
    expect(accountIdentity(undefined)).toBeUndefined();
  });
});

describe("AccountStore", () => {
  test("summary, next and cooldowns", async () => {
    const { store } = makeStore({ "openai-codex": cred("main"), "openai-codex@work": cred("work"), "openai-codex@home": cred("home"), anthropic: cred("a") });
    expect(store.activeLabel("openai-codex")).toBe(DEFAULT_LABEL);
    expect(await store.summary("openai-codex")).toEqual({
      provider: "openai-codex",
      active: "main",
      slots: [{ label: "main", active: true, cooldown: undefined }, { label: "home", active: false, cooldown: undefined }, { label: "work", active: false, cooldown: undefined }],
    });
    expect(await store.summary("google")).toEqual({ provider: "google", active: undefined, slots: [] });
    expect(await store.providers()).toEqual(["openai-codex"]);
    expect(await store.next("openai-codex")).toBe("home");
    store.markCooldown("openai-codex", "home", T0 + 1000, "usage limit");
    expect(await store.next("openai-codex")).toBe("work");
    expect(store.cooldown("openai-codex", "home")).toEqual({ until: T0 + 1000, reason: "usage limit" });
    store.markCooldown("openai-codex", "work", T0 + 1000, "rate limit");
    expect(await store.next("openai-codex")).toBeUndefined();
    expect(await store.next("anthropic")).toBeUndefined();
    store.clearCooldowns("anthropic");
    expect(await store.next("openai-codex")).toBeUndefined();
    store.clearCooldowns("openai-codex");
    expect(await store.next("openai-codex")).toBe("home");
  });

  test("expired cooldowns are pruned on the next mark and ignored when reading", async () => {
    let clock = T0;
    const { store, state } = makeStore({ "openai-codex@work": cred("work") }, () => clock);
    store.markCooldown("openai-codex", "main", T0 + 1000, "x");
    clock = T0 + 2000;
    expect(store.cooldown("openai-codex", "main")).toBeUndefined();
    store.markCooldown("openai-codex", "work", T0 + 5000, "y");
    expect(Object.keys(state.state.cooldowns)).toEqual(["openai-codex@work"]);
  });

  test("add validates and parks through the provider login", async () => {
    const { store, backend } = makeStore({ "openai-codex": cred("main"), "openai-codex@work": cred("work") });
    const interaction = { prompt: async () => "", notify: () => {} };
    await expect(store.add("openai-codex", "bad label", interaction)).rejects.toThrow("Invalid label");
    await expect(store.add("google", "x", interaction)).rejects.toThrow("not a built-in OAuth provider");
    await expect(store.add("openai-codex", "work", interaction)).rejects.toThrow("already has an account labelled work");
    await expect(store.add("openai-codex", "main", interaction)).rejects.toThrow("currently signed in as openai-codex");
    const added = await store.add("openai-codex", "Home", interaction);
    expect(added.label).toBe("home");
    expect(backend.data.get("openai-codex@home")).toEqual(cred("openai-codex@home"));
    expect(backend.log).toEqual(["login openai-codex@home"]);
    // A first extra account when nothing is signed in yet is fine, and `main` is free then.
    const fresh = makeStore();
    await fresh.store.add("anthropic", "main", interaction);
    expect(fresh.backend.data.has("anthropic@main")).toBe(true);
  });

  test("activate moves credentials, parks the previous account first and records state", async () => {
    const { store, backend, state } = makeStore({ "openai-codex": cred("main"), "openai-codex@work": cred("work") });
    const activation = await store.activate("openai-codex", "work", { preferred: "main" });
    expect(activation).toEqual({ provider: "openai-codex", from: "main", to: "work" });
    expect(backend.log).toEqual(["swap openai-codex@main", "swap openai-codex", "remove openai-codex@work"]);
    expect(backend.data.get("openai-codex")).toEqual(cred("work"));
    expect(backend.data.get("openai-codex@main")).toEqual(cred("main"));
    expect(backend.data.has("openai-codex@work")).toBe(false);
    expect(state.state.providers["openai-codex"]).toEqual({ active: "work", preferred: "main" });
    expect(state.maxDepth).toBe(1);
    // Already active: no-op, nothing written.
    expect(await store.activate("openai-codex", "work")).toBeUndefined();
    expect(backend.log).toHaveLength(3);
    // Return: preferred cleared because it equals the new active label.
    expect(await store.activate("openai-codex", "main", { preferred: null })).toEqual({ provider: "openai-codex", from: "work", to: "main" });
    expect(state.state.providers["openai-codex"]).toEqual({ active: "main" });
    expect(backend.data.get("openai-codex")).toEqual(cred("main"));
    expect(backend.data.get("openai-codex@work")).toEqual(cred("work"));
    await expect(store.activate("openai-codex", "nope")).rejects.toThrow("no parked account labelled nope");
    await expect(store.activate("openai-codex", "bad label")).rejects.toThrow("Invalid label");
  });

  test("activate re-parks a credential Pi refreshed between the read and the swap", async () => {
    const { store, backend } = makeStore({ "openai-codex": cred("main"), "openai-codex@work": cred("work") });
    const original = backend.backend.swap;
    backend.backend.swap = async (key, next) => {
      if (key === "openai-codex") backend.data.set("openai-codex", cred("main-refreshed", "main"));
      return original(key, next);
    };
    await store.activate("openai-codex", "work");
    expect(backend.data.get("openai-codex")).toEqual(cred("work"));
    expect(backend.data.get("openai-codex@main")).toEqual(cred("main-refreshed", "main"));
  });

  test("activate with nothing signed in simply moves the parked account in", async () => {
    const { store, backend, state } = makeStore({ "openai-codex@work": cred("work") });
    expect(await store.activate("openai-codex", "work")).toEqual({ provider: "openai-codex", from: undefined, to: "work" });
    expect(backend.log).toEqual(["swap openai-codex", "remove openai-codex@work"]);
    expect(state.state.providers["openai-codex"]).toEqual({ active: "work" });
  });

  test("remove refuses the active account and clears parked state", async () => {
    const { store, backend, state } = makeStore({ "openai-codex": cred("main"), "openai-codex@work": cred("work") });
    store.markCooldown("openai-codex", "work", T0 + 1000, "x");
    store.setPreferred("openai-codex", "work");
    await expect(store.remove("openai-codex", "main")).rejects.toThrow("use /logout");
    await expect(store.remove("openai-codex", "nope")).rejects.toThrow("no parked account");
    await store.remove("openai-codex", "work");
    expect(backend.data.has("openai-codex@work")).toBe(false);
    expect(state.state.cooldowns).toEqual({});
    expect(state.state.providers["openai-codex"]).toEqual({ active: "main" });
    expect(await store.readCredential("openai-codex", "main")).toEqual(cred("main"));
    expect(await store.readCredential("openai-codex", "work")).toBeUndefined();
  });

  test("setPreferred ignores the active label", () => {
    const { store, state } = makeStore();
    store.setPreferred("openai-codex", "main");
    expect(state.state.providers["openai-codex"]).toEqual({ active: "main" });
    store.setPreferred("openai-codex", "work");
    expect(state.state.providers["openai-codex"]).toEqual({ active: "main", preferred: "work" });
    store.setPreferred("openai-codex", undefined);
    expect(state.state.providers["openai-codex"]).toEqual({ active: "main" });
  });
});

describe("state store", () => {
  test("owner-only atomic writes, lock serialisation and stale lock recovery", async () => {
    const root = mkdtempSync(join(tmpdir(), "quota-router-state-"));
    try {
      const dir = join(root, "state");
      const store = createStateStore(dir);
      expect(store.read()).toEqual(emptyState());
      store.write({ providers: { "openai-codex": { active: "work", preferred: "main" } }, cooldowns: {} });
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      expect(statSync(join(dir, "state.json")).mode & 0o777).toBe(0o600);
      expect(store.read().providers["openai-codex"]).toEqual({ active: "work", preferred: "main" });
      expect(JSON.parse(readFileSync(join(dir, "state.json"), "utf8")).providers["openai-codex"].active).toBe("work");

      const order: string[] = [];
      await Promise.all([
        store.withLock(async () => {
          order.push("a-start");
          await new Promise((resolve) => setTimeout(resolve, 60));
          order.push("a-end");
        }),
        store.withLock(async () => {
          order.push("b-start");
          order.push("b-end");
        }),
      ]);
      expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);

      // A lock left behind by a dead process is reclaimed once stale.
      mkdirSync(join(dir, "lock"));
      const old = (Date.now() - 60_000) / 1000;
      utimesSync(join(dir, "lock"), old, old);
      expect(await store.withLock(async () => "ran")).toBe("ran");
      expect(() => statSync(join(dir, "lock"))).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("runtime backend against the installed Pi credential store", () => {
  test("reads, swaps, removes and logs in through Pi's locked auth.json", async () => {
    const root = mkdtempSync(join(tmpdir(), "quota-router-backend-"));
    try {
      const authPath = join(root, "auth.json");
      const fake = {
        id: "openai-codex",
        name: "Fake Codex",
        auth: {
          oauth: {
            name: "Fake",
            isSubscription: true,
            login: async (interaction: any) => {
              interaction.notify({ type: "auth_url", url: "https://example.invalid/login" });
              const code = await interaction.prompt({ type: "manual_code", message: "code?" });
              return { type: "oauth", access: `access-${code}`, refresh: "r", expires: Date.now() + 3_600_000, accountId: code };
            },
            refresh: async (credential: any) => credential,
            toAuth: async (credential: any) => ({ apiKey: credential.access }),
          },
        },
        getModels: () => [{ id: "m", provider: "openai-codex", api: "openai-codex-responses" }],
        stream: () => { throw new Error("no"); },
        streamSimple: () => { throw new Error("no"); },
      };
      const backend = createRuntimeBackend({ agentDir: root, providers: () => [fake as any] });
      expect(backend.supportsLogin("openai-codex")).toBe(true);
      expect(backend.supportsLogin("google")).toBe(false);
      expect(await backend.keys()).toEqual([]);
      expect(await backend.swap("openai-codex", cred("main"))).toBeUndefined();
      expect(statSync(authPath).mode & 0o777).toBe(0o600);
      expect(await backend.read("openai-codex")).toEqual(cred("main"));
      const events: string[] = [];
      const stored = await backend.login("openai-codex", "openai-codex@work", {
        prompt: async () => "acct-2",
        notify: (event: any) => events.push(event.type),
      });
      expect(events).toEqual(["auth_url"]);
      expect((stored as any).accountId).toBe("acct-2");
      expect((await backend.keys()).sort()).toEqual(["openai-codex", "openai-codex@work"]);
      expect(JSON.parse(readFileSync(authPath, "utf8"))["openai-codex@work"].access).toBe("access-acct-2");
      expect(await backend.swap("openai-codex@work", cred("work"))).toMatchObject({ accountId: "acct-2" });
      await backend.remove("openai-codex@work");
      expect(await backend.keys()).toEqual(["openai-codex"]);
      // Pi's own store on the same file sees the same data.
      expect(codingAgent.readStoredCredential("openai-codex", authPath)).toEqual(cred("main"));
      const clone = loginClone(fake as any, "openai-codex@x");
      expect(clone.auth).toBe(fake.auth);
      expect(clone.getModels()[0].provider).toBe("openai-codex@x");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function quotaCredential(id: string, provider = "openai-codex", expired = false): Credential {
  const token = provider === "anthropic" ? `sk-ant-oat-${id}` : `h.${Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: id },
  })).toString("base64url")}.s`;
  return { type: "oauth", access: token, refresh: `refresh-${id}`, expires: expired ? 1 : Date.now() + 3_600_000, accountId: id } as Credential;
}
async function quotaFixture(root: string, refresh?: (credential: any, signal: AbortSignal) => Promise<any>) {
  const bases = ["openai-codex", "anthropic"].map((id) => ({
    id, name: id, baseUrl: id === "anthropic" ? "https://api.anthropic.com" : "https://chatgpt.com/backend-api",
    auth: { oauth: { name: id, isSubscription: true, login: async () => { throw new Error("no login"); },
      refresh: refresh ?? (async (credential: any) => ({ ...credential, expires: Date.now() + 3_600_000 })),
      toAuth: async (credential: any) => ({ apiKey: credential.access }),
    } },
    getModels: () => [], stream: () => { throw new Error("no model request"); }, streamSimple: () => { throw new Error("no model request"); },
  }));
  const backend = createRuntimeBackend({ agentDir: root, providers: () => bases as any });
  const state = createStateStore(join(root, "router"));
  const registry = {
    getProvider: (provider: string) => bases.find((base) => base.id === provider),
    getProviderAuth: async (provider: string) => ({ auth: { apiKey: (await backend.read(provider) as any)?.access } }),
  };
  const requests: Array<{ url: string; headers: any }> = [];
  const source = await createAccountSource(registry as any, { backend, state, readerOptions: { throttleDir: join(root, "quotas") },
    fetch: async (url, init) => {
      const headers = init.headers as any;
      requests.push({ url, headers });
      return Response.json(url.includes("anthropic") ? { seven_day: { utilization: headers.Authorization.endsWith("main") ? 90 : 20 } }
        : { rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: headers["ChatGPT-Account-Id"] === "main" ? 100 : 12 } } });
    },
  });
  return { backend, state, source, registry, requests };
}

describe("all-account quota reader through the installed Pi store", () => {
  test("reads active and parked logins without moving them; parked OAuth refresh persists in place", async () => {
    const root = mkdtempSync(join(tmpdir(), "quota-all-accounts-"));
    try {
      let refreshes = 0;
      const f = await quotaFixture(root, async (credential) => { refreshes++; return { ...credential, refresh: "rotated", expires: Date.now() + 3_600_000 }; });
      const initial = {
        "openai-codex": quotaCredential("main"), "openai-codex@work": quotaCredential("work", "openai-codex", true),
        anthropic: quotaCredential("main", "anthropic"), "anthropic@other": quotaCredential("other", "anthropic"),
      };
      for (const [id, credential] of Object.entries(initial)) await f.backend.swap(id, credential);
      const accounts = await f.source.list();
      expect(accounts).toEqual([
        { provider: "openai-codex", label: "main", active: true }, { provider: "openai-codex", label: "work", active: false },
        { provider: "anthropic", label: "main", active: true }, { provider: "anthropic", label: "other", active: false },
      ]);
      const values = [];
      for (const account of accounts) values.push(await f.source.read(account, new AbortController().signal));
      expect(values[0]).toMatchObject({ fiveHour: { usedPercent: 100 } });
      expect(values[1]).toMatchObject({ fiveHour: { usedPercent: 12 } });
      expect(values[2]).toMatchObject({ weekly: { usedPercent: 90 } });
      expect(values[3]).toMatchObject({ weekly: { usedPercent: 20 } });
      expect(refreshes).toBe(1);
      expect(await f.backend.read("openai-codex")).toEqual(initial["openai-codex"]);
      expect(await f.backend.read("openai-codex@work")).toMatchObject({ refresh: "rotated" });
      expect((await f.backend.keys()).sort()).toEqual(Object.keys(initial).sort());
      expect(f.state.read()).toEqual(emptyState());
      for (const account of accounts.filter((account) => account.provider === "anthropic")) {
        const cached = await f.source.read(account, new AbortController().signal);
        expect(cached?.cached).toBe(true);
        const token = (initial[account.active ? "anthropic" : "anthropic@other"] as any).access;
        const path = join(root, "quotas", createHash("sha256").update(token).digest("hex"), "anthropic.json");
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(readFileSync(path, "utf8")).not.toMatch(/sk-ant|refresh-|main|other/);
      }
      expect(f.requests).toHaveLength(4);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("parked refresh and activation serialize; activation receives the refreshed credential", async () => {
    const root = mkdtempSync(join(tmpdir(), "quota-refresh-move-"));
    try {
      let release!: () => void;
      const pending = new Promise<void>((done) => { release = done; });
      let refreshing = false;
      const f = await quotaFixture(root, async (credential) => {
        refreshing = true;
        await pending;
        return { ...credential, refresh: "rotated", expires: Date.now() + 3_600_000 };
      });
      await f.backend.swap("openai-codex", quotaCredential("main"));
      await f.backend.swap("openai-codex@work", quotaCredential("work", "openai-codex", true));
      const reading = f.source.read({ provider: "openai-codex", label: "work", active: false }, new AbortController().signal);
      for (let i = 0; !refreshing && i < 100; i++) await new Promise((done) => setTimeout(done, 5));
      expect(refreshing).toBe(true);
      const store = new AccountStore({ backend: f.backend, state: f.state });
      let moved = false;
      const move = store.activate("openai-codex", "work").then(() => { moved = true; });
      await new Promise((done) => setTimeout(done, 40));
      expect(moved).toBe(false);
      release();
      await Promise.all([reading, move]);
      expect(await f.backend.read("openai-codex")).toMatchObject({ accountId: "work", refresh: "rotated" });
      expect(await f.backend.read("openai-codex@work")).toBeUndefined();
      // A stale list entry is resolved by label's current key, not its old active flag.
      await f.source.read({ provider: "openai-codex", label: "main", active: true }, new AbortController().signal);
      expect(f.requests.at(-1)?.headers["ChatGPT-Account-Id"]).toBe("main");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("cancelled parked refresh cannot persist a late credential or start a quota GET", async () => {
    const root = mkdtempSync(join(tmpdir(), "quota-refresh-cancel-"));
    try {
      let release!: () => void;
      const pending = new Promise<void>((done) => { release = done; });
      let refreshing = false;
      const f = await quotaFixture(root, async (credential) => {
        refreshing = true;
        await pending; // Deliberately ignore the signal: persistence must still reject.
        return { ...credential, refresh: "late", expires: Date.now() + 3_600_000 };
      });
      const original = quotaCredential("work", "openai-codex", true);
      await f.backend.swap("openai-codex@work", original);
      const controller = new AbortController();
      const reading = f.source.read({ provider: "openai-codex", label: "work", active: false }, controller.signal);
      for (let i = 0; !refreshing && i < 100; i++) await new Promise((done) => setTimeout(done, 5));
      expect(refreshing).toBe(true);
      controller.abort();
      await expect(reading).rejects.toThrow();
      release();
      await new Promise((done) => setTimeout(done, 30));
      expect(await f.backend.read("openai-codex@work")).toEqual(original);
      expect(f.requests).toEqual([]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test("missing active login, parked main, API keys and proxy routes cannot borrow another login", async () => {
    const root = mkdtempSync(join(tmpdir(), "quota-auth-boundary-"));
    try {
      const f = await quotaFixture(root);
      await f.backend.swap("openai-codex@main", quotaCredential("parked-main"));
      await f.backend.swap("anthropic@api", { type: "api_key", key: "sk-ant-api-SECRET" } as Credential);
      await f.backend.swap("anthropic@bad\u001b-label", quotaCredential("invalid", "anthropic"));
      const accounts = await f.source.list();
      expect(accounts.filter((account) => account.provider === "openai-codex")).toEqual([
        { provider: "openai-codex", label: undefined, active: true }, { provider: "openai-codex", label: "main", active: false },
      ]);
      expect(accounts.some((account) => account.label?.includes("\u001b"))).toBe(false);
      await expect(f.source.read(accounts[0], new AbortController().signal)).rejects.toMatchObject({ code: "oauth" });
      expect(await f.source.read(accounts[1], new AbortController().signal)).toMatchObject({ fiveHour: { usedPercent: 12 } });
      await expect(f.source.read({ provider: "anthropic", label: "api", active: false }, new AbortController().signal)).rejects.toMatchObject({ code: "login" });
      f.registry.getProvider = () => ({ baseUrl: "https://proxy.invalid" } as any);
      await expect(f.source.read(accounts[1], new AbortController().signal)).rejects.toMatchObject({ code: "unsupported" });
      expect(f.requests).toHaveLength(1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
