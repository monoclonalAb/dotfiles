import { describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Credential } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type * as Accounts from "./accounts.ts";
import type * as Router from "./router.ts";

// Pi aliases "@earendil-works/pi-ai" for extensions to the installed compat entry point;
// resolve the same installed modules here instead of duplicating Pi's retry policy.
const codingAgentRoot = join(
  execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(),
  "@earendil-works/pi-coding-agent",
);
const aiRoot = join(codingAgentRoot, "node_modules/@earendil-works/pi-ai/dist");
const ai = await import(pathToFileURL(join(aiRoot, "compat.js")).href);
mock.module("@earendil-works/pi-ai", () => ai);
mock.module("@earendil-works/pi-ai/providers/all", () => ({ builtinProviders: () => [] }));
mock.module("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => "/nonexistent", ModelRuntime: class {} }));
const { isRetryableAssistantError } = ai;
const { AccountStore, emptyState } = (await import("./accounts.ts")) as typeof Accounts;
const { CONFIG_FILE, registerQuotaRouter, STATUS_KEY } = await import("./index.ts");
const {
  annotateForRetry,
  classifyError,
  classifyResponse,
  clampReset,
  DEFAULT_COOLDOWN_MS,
  formatClock,
  formatDuration,
  isRetryableByPi,
  MAX_COOLDOWN_MS,
  MIN_COOLDOWN_MS,
  parseConfig,
} = (await import("./router.ts")) as typeof Router;

const T0 = Date.UTC(2026, 8, 12, 12, 0, 0);
const CODEX_LIMIT = "You have hit your ChatGPT usage limit (pro plan). Try again in ~120 min.";
const ANTHROPIC_LIMIT =
  '429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit."}}';

type ActiveModel = NonNullable<ExtensionContext["model"]>;
function model(provider: string, id: string): ActiveModel {
  return { provider, id, name: id, api: "test", contextWindow: 200_000, maxTokens: 8192 } as unknown as ActiveModel;
}
const codex = model("openai-codex", "gpt-6-astra");
const claude = model("anthropic", "claude-fable-5-1");
const cred = (tag: string): Credential =>
  ({ type: "oauth", access: `access-${tag}`, refresh: `refresh-${tag}`, expires: T0 + 3_600_000, accountId: tag }) as Credential;

describe("config", () => {
  test("defaults, invalid text and field warnings", () => {
    expect(parseConfig(undefined).config).toEqual({ cooldownMs: DEFAULT_COOLDOWN_MS, returnToPreferred: true });
    expect(parseConfig("  ").config.cooldownMs).toBe(DEFAULT_COOLDOWN_MS);
    expect(parseConfig("{nope").warnings[0]).toContain("not valid JSON");
    expect(parseConfig("[]").warnings[0]).toContain("JSON object");
    const { config, warnings } = parseConfig(JSON.stringify({ cooldownMinutes: 45, returnToPreferred: false }));
    expect(config).toEqual({ cooldownMs: 45 * 60_000, returnToPreferred: false });
    expect(warnings).toEqual([]);
    expect(parseConfig('{"cooldownMinutes":-1,"returnToPreferred":"yes"}').warnings).toHaveLength(2);
    expect(parseConfig('{"cooldownMinutes":1e9}').config.cooldownMs).toBe(MAX_COOLDOWN_MS);
  });
});

describe("classification", () => {
  test("Codex subscription text is a hard limit with the reported reset", () => {
    expect(classifyError(CODEX_LIMIT, T0)).toEqual({ hard: true, reason: "usage limit", resetAt: T0 + 120 * 60_000 });
    expect(classifyError("The usage limit has been reached (usage_limit_reached)", T0)?.hard).toBe(true);
  });

  test("Anthropic 429 body is a soft limit without a reset", () => {
    expect(classifyError(ANTHROPIC_LIMIT, T0)).toEqual({ hard: false, reason: "rate limit" });
    expect(classifyError("429 Too Many Requests", T0)?.hard).toBe(false);
  });

  test("overflow, transport and unrelated errors are not limits", () => {
    expect(classifyError("prompt is too long: 250000 tokens > 200000 maximum", T0)).toBeUndefined();
    expect(classifyError("context_length_exceeded: rate limit note", T0)).toBeUndefined();
    expect(classifyError("fetch failed", T0)).toBeUndefined();
    expect(classifyError("500 internal error", T0)).toBeUndefined();
    expect(classifyError(undefined, T0)).toBeUndefined();
  });

  test("responses: only 429 counts and reset hints are parsed", () => {
    expect(classifyResponse(200, {}, T0)).toBeUndefined();
    expect(classifyResponse(500, { "retry-after": "5" }, T0)).toBeUndefined();
    expect(classifyResponse(429, {}, T0)).toEqual({ hard: false, reason: "HTTP 429" });
    expect(classifyResponse(429, { "Retry-After": "600" }, T0)?.resetAt).toBe(T0 + 600_000);
    expect(classifyResponse(429, { "retry-after": new Date(T0 + 90_000).toUTCString() }, T0)?.resetAt).toBe(T0 + 90_000);
    const unified = String(Math.floor((T0 + 3_600_000) / 1000));
    expect(classifyResponse(429, { "anthropic-ratelimit-unified-reset": unified, "retry-after": "5" }, T0)?.resetAt).toBe(T0 + 3_600_000);
  });

  test("Codex window headers prefer the exhausted window, else the earliest reset", () => {
    const headers = {
      "x-codex-primary-used-percent": "100",
      "x-codex-primary-reset-after-seconds": "1800",
      "x-codex-secondary-used-percent": "40",
      "x-codex-secondary-reset-after-seconds": "500000",
    };
    expect(classifyResponse(429, headers, T0)?.resetAt).toBe(T0 + 1800_000);
    expect(classifyResponse(429, { ...headers, "x-codex-secondary-used-percent": "100" }, T0)?.resetAt).toBe(T0 + 500_000_000);
    const unknownUse = { "x-codex-primary-reset-after-seconds": "1800", "x-codex-secondary-resets-at": String(Math.floor((T0 + 120_000) / 1000)) };
    expect(classifyResponse(429, unknownUse, T0)?.resetAt).toBe(T0 + 120_000);
    expect(classifyResponse(429, { "x-codex-primary-reset-after-seconds": "garbage" }, T0)?.resetAt).toBeUndefined();
  });

  test("reset clamping keeps a floor and a ceiling", () => {
    expect(clampReset(undefined, T0, 10 * 60_000)).toBe(T0 + 10 * 60_000);
    expect(clampReset(T0 + 5_000, T0, 10 * 60_000)).toBe(T0 + MIN_COOLDOWN_MS);
    expect(clampReset(T0 + 30 * 24 * 3_600_000, T0, 10 * 60_000)).toBe(T0 + MAX_COOLDOWN_MS);
    expect(formatDuration(45_000)).toBe("1m");
    expect(formatDuration(125 * 60_000)).toBe("2h05");
    expect(formatDuration(120 * 60_000)).toBe("2h");
  });
});

describe("retry annotation against the installed Pi policy", () => {
  test("Codex usage-limit text becomes retryable for Pi with the account named once", () => {
    expect(isRetryableByPi(CODEX_LIMIT)).toBe(false);
    const annotated = annotateForRetry(CODEX_LIMIT, "work");
    expect(annotated).toBeDefined();
    expect(annotated!.startsWith(CODEX_LIMIT)).toBe(true);
    expect(annotated).toContain("retrying on account work]");
    expect(isRetryableAssistantError({ role: "assistant", content: [], stopReason: "error", errorMessage: annotated } as never)).toBe(true);
    expect(annotateForRetry(annotated!, "work")).toBeUndefined();
  });

  test("billing wording stays non-retryable and Anthropic 429 is already retryable", () => {
    expect(annotateForRetry("Your billing account is out of budget", "work")).toBeUndefined();
    expect(isRetryableByPi(ANTHROPIC_LIMIT)).toBe(true);
  });
});

type Handler = (event: any, ctx: any) => any;

function memoryAccounts(initial: Record<string, Credential>, now: () => number) {
  const data = new Map(Object.entries(initial));
  let state = emptyState();
  const backend: Accounts.AccountsBackend = {
    read: async (key) => data.get(key),
    swap: async (key, next) => {
      const previous = data.get(key);
      data.set(key, next);
      return previous;
    },
    remove: async (key) => {
      data.delete(key);
    },
    keys: async () => [...data.keys()],
    login: async (provider, key, interaction) => {
      interaction.notify({ type: "auth_url", url: "https://example.invalid/login", instructions: "Open it" });
      const code = await interaction.prompt({ type: "manual_code", message: "code?" });
      const credential = { ...cred(code), accountId: code } as Credential;
      data.set(key, credential);
      return credential;
    },
    supportsLogin: (provider) => provider === "openai-codex" || provider === "anthropic",
  };
  const stateStore: Accounts.StateStore = {
    read: () => structuredClone(state),
    write: (next) => {
      state = structuredClone(next);
    },
    withLock: async (fn) => fn(),
  };
  return { store: new AccountStore({ backend, state: stateStore, now }), data, get state() { return state; } };
}

function harness(options: {
  initial?: ActiveModel;
  credentials?: Record<string, Credential>;
  configText?: string;
  oauthProviders?: string[];
  input?: () => Promise<string | undefined>;
} = {}) {
  let current = options.initial ?? codex;
  let idle = true;
  let clock = T0;
  const handlers = new Map<string, Handler>();
  const notifications: Array<{ message: string; type: string }> = [];
  const statuses: Array<string | undefined> = [];
  const timers: Array<{ delay: number; fire: () => void; cancelled: boolean }> = [];
  const opened: string[] = [];
  const commands = new Map<string, any>();
  const oauth = new Set(options.oauthProviders ?? ["openai-codex", "anthropic"]);
  const accounts = memoryAccounts(
    options.credentials ?? { "openai-codex": cred("main"), "openai-codex@work": cred("work"), anthropic: cred("a") },
    () => clock,
  );
  const api = {
    on(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    registerCommand(name: string, value: any) {
      commands.set(name, value);
    },
    setModel: async () => {
      throw new Error("the router must not change models");
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    get model() {
      return current;
    },
    hasUI: true,
    mode: "tui",
    isIdle: () => idle,
    ui: {
      notify: (message: string, type: string) => notifications.push({ message, type }),
      setStatus: (key: string, text: string | undefined) => {
        expect(key).toBe(STATUS_KEY);
        statuses.push(text);
      },
      input: options.input ?? (async () => "acct-new"),
      select: async () => undefined,
    },
    modelRegistry: { isUsingOAuth: (m: ActiveModel) => oauth.has(m.provider) },
  } as unknown as ExtensionContext;
  registerQuotaRouter(api, {
    now: () => clock,
    readConfig: () => options.configText,
    accounts: accounts.store,
    openUrl: (url) => opened.push(url),
    setTimer: (fire, delay) => {
      const entry = { delay, fire, cancelled: false };
      timers.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  });
  const start = () => handlers.get("session_start")!({ type: "session_start", reason: "startup" }, ctx);
  return {
    handlers, ctx, notifications, statuses, timers, opened, accounts, start,
    command: (name: string, argument = "") => commands.get(name).handler(argument, ctx),
    completions: (name: string, prefix: string) => commands.get(name).getArgumentCompletions(prefix),
    setModel: (m: ActiveModel) => {
      current = m;
      handlers.get("model_select")?.({ type: "model_select", model: m, previousModel: current, source: "set" }, ctx);
    },
    setIdle: (value: boolean) => {
      idle = value;
    },
    setClock: (ms: number) => {
      clock = ms;
    },
  };
}

function errorMessage(errorMessage: string, provider = "openai-codex", id = "gpt-6-astra") {
  return { role: "assistant", content: [], stopReason: "error", errorMessage, provider, model: id };
}

async function failTurn(h: ReturnType<typeof harness>, message: string, status?: number, headers: Record<string, string> = {}, provider = "openai-codex") {
  if (status !== undefined) {
    await h.handlers.get("after_provider_response")!({ type: "after_provider_response", status, headers }, h.ctx);
  }
  const replacement = await h.handlers.get("message_end")!({ type: "message_end", message: errorMessage(message, provider) }, h.ctx);
  await h.handlers.get("agent_end")!({ type: "agent_end", messages: [] }, h.ctx);
  return replacement;
}

describe("router lifecycle", () => {
  test("Codex limit: annotates for Pi's retry, swaps to the parked account, then returns after the reset", async () => {
    const h = harness();
    await h.start();
    expect(h.statuses.at(-1)).toBeUndefined();
    const replacement = await failTurn(h, CODEX_LIMIT, 429, { "x-codex-primary-used-percent": "100", "x-codex-primary-reset-after-seconds": "3600" });
    expect(replacement?.message.errorMessage.startsWith(CODEX_LIMIT)).toBe(true);
    expect(replacement?.message.content).toEqual([]);
    expect(isRetryableByPi(replacement?.message.errorMessage)).toBe(true);
    // Credentials moved under Pi's provider key; the model is untouched.
    expect(h.accounts.data.get("openai-codex")).toEqual(cred("work"));
    expect(h.accounts.data.get("openai-codex@main")).toEqual(cred("main"));
    expect(h.accounts.data.has("openai-codex@work")).toBe(false);
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "work", preferred: "main" });
    expect(h.ctx.model).toBe(codex);
    // The message-reported reset (120 min) wins over the header hint (60 min).
    expect(h.accounts.state.cooldowns["openai-codex@main"].until).toBe(T0 + 120 * 60_000);
    expect(h.statuses.at(-1)).toBe(`acct:work ↩${formatClock(T0 + 120 * 60_000)}`);
    expect(h.notifications.map((n) => n.type)).toEqual(["warning"]);
    expect(h.notifications[0].message).toContain("account main usage limit");
    expect(h.notifications[0].message).toContain("switched to account work");
    expect(h.notifications[0].message).toContain("~2h");
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0].delay).toBe(120 * 60_000);

    // Settling within the cooldown changes nothing; the timer firing while streaming defers.
    await h.handlers.get("agent_settled")!({ type: "agent_settled" }, h.ctx);
    expect(h.accounts.state.providers["openai-codex"].active).toBe("work");
    h.setClock(T0 + 121 * 60_000);
    h.setIdle(false);
    h.timers[0].fire();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.accounts.state.providers["openai-codex"].active).toBe("work");
    h.setIdle(true);
    await h.handlers.get("agent_settled")!({ type: "agent_settled" }, h.ctx);
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "main" });
    expect(h.accounts.data.get("openai-codex")).toEqual(cred("main"));
    expect(h.accounts.data.get("openai-codex@work")).toEqual(cred("work"));
    expect(h.statuses.at(-1)).toBeUndefined();
    expect(h.notifications.at(-1)?.message).toContain("back on account main");
  });

  test("Anthropic 429 is already retryable: no replacement; with no parked account the error is left alone once", async () => {
    const h = harness({ initial: claude });
    await h.start();
    expect(await failTurn(h, ANTHROPIC_LIMIT, undefined, {}, "anthropic")).toBeUndefined();
    expect(h.accounts.data.get("anthropic")).toEqual(cred("a"));
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0].message).toContain("no other signed-in anthropic account");
    expect(h.notifications[0].message).toContain("/accounts add anthropic <label>");
    // Pi retries the same provider within its own budget: the warning is not repeated.
    expect(await failTurn(h, ANTHROPIC_LIMIT, undefined, {}, "anthropic")).toBeUndefined();
    expect(h.notifications).toHaveLength(1);
    expect(h.accounts.state.cooldowns["anthropic@main"].until).toBe(T0 + DEFAULT_COOLDOWN_MS);
  });

  test("a second exhaustion on the fallback keeps the original preferred account and stops when nothing is left", async () => {
    const h = harness({ credentials: { "openai-codex": cred("main"), "openai-codex@work": cred("work"), "openai-codex@home": cred("home") } });
    await h.start();
    await failTurn(h, CODEX_LIMIT);
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "home", preferred: "main" });
    await failTurn(h, CODEX_LIMIT.replace("120", "30"));
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "work", preferred: "main" });
    expect(await failTurn(h, CODEX_LIMIT.replace("120", "45"))).toBeUndefined();
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "work", preferred: "main" });
    expect(h.notifications.at(-1)?.message).toContain("no other signed-in openai-codex account");
    // home resets first but main is preferred: return waits for main, then goes straight back.
    h.setClock(T0 + 46 * 60_000);
    await h.handlers.get("agent_settled")!({ type: "agent_settled" }, h.ctx);
    expect(h.accounts.state.providers["openai-codex"].active).toBe("work");
    h.setClock(T0 + 121 * 60_000);
    await h.handlers.get("agent_settled")!({ type: "agent_settled" }, h.ctx);
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "main" });
  });

  test("API-key throttling is left to Pi; hard quota wording still rotates", async () => {
    const h = harness({ oauthProviders: [] });
    await h.start();
    expect(await failTurn(h, ANTHROPIC_LIMIT, 429)).toBeUndefined();
    expect(h.accounts.state.providers["openai-codex"]).toBeUndefined();
    expect(h.notifications).toEqual([]);
    expect(await failTurn(h, "insufficient_quota: your organization is out of budget")).toBeUndefined();
    expect(h.accounts.state.providers["openai-codex"].active).toBe("work");
    expect(h.notifications.at(-1)?.message).toContain("re-send your last message");
  });

  test("a bare 429 with a non-descriptive message still rotates for OAuth logins", async () => {
    const h = harness();
    await h.start();
    const replacement = await failTurn(h, "Request failed", 429, { "retry-after": "900" });
    expect(replacement?.message.errorMessage).toContain("Request failed [quota-router");
    expect(h.accounts.state.providers["openai-codex"].active).toBe("work");
    expect(h.timers[0].delay).toBe(900_000);
  });

  test("successful and non-limit errors never touch accounts", async () => {
    const h = harness();
    await h.start();
    await h.handlers.get("message_end")!({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } }, h.ctx);
    await h.handlers.get("agent_end")!({ type: "agent_end", messages: [] }, h.ctx);
    expect(await failTurn(h, "fetch failed", 503)).toBeUndefined();
    expect(await failTurn(h, "prompt is too long", 400)).toBeUndefined();
    await h.handlers.get("message_end")!({ type: "message_end", message: { role: "user", content: [] } }, h.ctx);
    expect(h.accounts.state).toEqual(emptyState());
    expect(h.notifications).toEqual([]);
  });

  test("returnToPreferred=false keeps the fallback; /route back returns manually", async () => {
    const h = harness({ configText: JSON.stringify({ returnToPreferred: false, cooldownMinutes: 5 }) });
    await h.start();
    await failTurn(h, ANTHROPIC_LIMIT);
    expect(h.timers).toHaveLength(0);
    expect(h.accounts.state.cooldowns["openai-codex@main"].until).toBe(T0 + 5 * 60_000);
    h.setClock(T0 + 200 * 60_000);
    await h.handlers.get("agent_settled")!({ type: "agent_settled" }, h.ctx);
    expect(h.accounts.state.providers["openai-codex"].active).toBe("work");
    h.setIdle(false);
    await h.command("route", "back");
    expect(h.accounts.state.providers["openai-codex"].active).toBe("work");
    h.setIdle(true);
    await h.command("route", "back");
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "main" });
    await h.command("route", "back");
    expect(h.notifications.at(-1)?.message).toContain("already on your chosen account");
  });

  test("a return that another session already performed is a quiet no-op", async () => {
    const h = harness();
    await h.start();
    await failTurn(h, CODEX_LIMIT);
    // Simulate another Pi process moving main back in and clearing the preference.
    await h.accounts.store.activate("openai-codex", "main", { preferred: null });
    h.setClock(T0 + 121 * 60_000);
    const count = h.notifications.length;
    await h.handlers.get("agent_settled")!({ type: "agent_settled" }, h.ctx);
    expect(h.notifications).toHaveLength(count);
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "main" });
  });

  test("session start performs an overdue return left by an earlier session", async () => {
    const h = harness();
    await h.accounts.store.activate("openai-codex", "work", { preferred: "main" });
    h.accounts.store.markCooldown("openai-codex", "main", T0 - 1, "usage limit");
    await h.start();
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "main" });
    expect(h.notifications.at(-1)?.message).toContain("back on account main");
  });

  test("/route off disables rotation; on/forget/status/usage behave", async () => {
    const h = harness();
    await h.start();
    await h.command("route", "off");
    expect(h.statuses.at(-1)).toBe("route:off");
    expect(await failTurn(h, CODEX_LIMIT, 429)).toBeUndefined();
    expect(h.accounts.state).toEqual(emptyState());
    await h.command("route", "on");
    expect(h.statuses.at(-1)).toBeUndefined();
    await failTurn(h, CODEX_LIMIT);
    expect(h.accounts.state.providers["openai-codex"].active).toBe("work");
    await h.command("route", "forget");
    expect(h.timers.at(-1)?.cancelled).toBe(true);
    expect(h.accounts.state.cooldowns).toEqual({});
    await h.command("route", "status");
    const status = h.notifications.at(-1)!.message;
    expect(status).toContain("quota-router on; auto-return on");
    expect(status).toContain("openai-codex: work (active), main (parked, return here)");
    await h.command("route", "bogus");
    expect(h.notifications.at(-1)?.type).toBe("error");
    expect(h.completions("route", "f")).toEqual([{ value: "forget", label: "forget" }]);
    expect(h.completions("accounts", "zz")).toBeNull();
  });

  test("/accounts list, add (with duplicate warning), use and remove", async () => {
    const h = harness({ credentials: { "openai-codex": cred("main") } });
    await h.start();
    await h.command("accounts");
    expect(h.notifications.at(-1)?.message).toBe("openai-codex: main (active)");
    await h.command("accounts", "add openai-codex");
    expect(h.notifications.at(-1)?.type).toBe("error");
    await h.command("accounts", "add openai-codex work");
    expect(h.opened).toEqual(["https://example.invalid/login"]);
    expect(h.accounts.data.get("openai-codex@work")).toMatchObject({ accountId: "acct-new" });
    expect(h.notifications.at(-1)?.message).toContain("account work signed in and parked");
    // Signing the same ChatGPT account in twice is flagged (the fake login always returns acct-new).
    await h.command("accounts", "add openai-codex dup");
    expect(h.notifications.at(-1)?.message).toContain("account dup is the same login as work");
    await h.command("accounts", "remove openai-codex dup");
    expect(h.accounts.data.has("openai-codex@dup")).toBe(false);
    await h.command("accounts", "remove openai-codex main");
    expect(h.notifications.at(-1)?.message).toContain("use /logout");
    h.setIdle(false);
    await h.command("accounts", "use openai-codex work");
    expect(h.accounts.state.providers["openai-codex"]).toBeUndefined();
    h.setIdle(true);
    await h.command("accounts", "use openai-codex work");
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "work" });
    expect(h.notifications.at(-1)?.message).toContain("now uses account work (main parked)");
    await h.command("accounts", "use openai-codex work");
    expect(h.notifications.at(-1)?.message).toContain("already uses account work");
    await h.command("accounts", "list");
    expect(h.notifications.at(-1)?.message).toBe("openai-codex: work (active), main (parked)");
    await h.command("accounts", "add anthropic Bad-Label");
    expect(h.accounts.data.has("anthropic@bad-label")).toBe(true);
    await h.command("accounts", "add google x");
    expect(h.notifications.at(-1)?.message).toContain("not a built-in OAuth provider");
  });

  test("a cancelled login dialog aborts the add", async () => {
    const h = harness({ credentials: { "openai-codex": cred("main") }, input: async () => undefined });
    await h.start();
    await h.command("accounts", "add openai-codex work");
    expect(h.notifications.at(-1)?.message).toContain("Login cancelled");
    expect(h.accounts.data.has("openai-codex@work")).toBe(false);
  });

  test("a manual account choice becomes the baseline: no auto-return", async () => {
    const h = harness();
    await h.start();
    await failTurn(h, CODEX_LIMIT);
    await h.command("accounts", "use openai-codex main");
    expect(h.accounts.state.providers["openai-codex"]).toEqual({ active: "main" });
    expect(h.timers.at(-1)?.cancelled).toBe(true);
    expect(h.statuses.at(-1)).toBeUndefined();
  });

  test("an unreadable config file is reported and defaults apply", async () => {
    const h = harness();
    // Replace the reader through a fresh registration: simplest is to rely on the harness option.
    const thrown = harnessWithThrowingConfig();
    await thrown.start();
    expect(thrown.notifications[0].message).toContain(`could not read ${CONFIG_FILE}`);
    expect(h.notifications).toEqual([]);
  });
});

function harnessWithThrowingConfig() {
  const handlers = new Map<string, Handler>();
  const notifications: Array<{ message: string; type: string }> = [];
  const accounts = memoryAccounts({}, () => T0);
  registerQuotaRouter(
    { on: (name: string, handler: Handler) => handlers.set(name, handler), registerCommand: () => {} } as unknown as ExtensionAPI,
    {
      accounts: accounts.store,
      readConfig: () => {
        throw new Error("EACCES");
      },
    },
  );
  const ctx = {
    model: codex,
    hasUI: false,
    isIdle: () => true,
    ui: { notify: (message: string, type: string) => notifications.push({ message, type }), setStatus: () => {} },
    modelRegistry: { isUsingOAuth: () => true },
  } as unknown as ExtensionContext;
  return { notifications, start: () => handlers.get("session_start")!({ type: "session_start", reason: "startup" }, ctx) };
}
