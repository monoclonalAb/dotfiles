import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { registerQuotaFooter, STATUS_KEY } from "./index.ts";
import { createMonitor, detailText, statusText, type States } from "./monitor.ts";
import { MAX_CACHE_AGE_MS, QuotaError, type ReadQuota } from "./quota.ts";

const sleep = (ms = 5) => new Promise((done) => setTimeout(done, ms));
async function until(predicate: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await sleep();
  }
  throw new Error("Timed out waiting for quota state");
}
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const cleanups: Array<() => void> = [];
afterEach(() => { for (const stop of cleanups.splice(0)) stop(); });
const ready: States = {
  "openai-codex": { status: "ready", quota: { weekly: { usedPercent: 31, resetsAt: Date.parse("2026-09-15T00:00:00Z") } }, fetchedAt: 1000 },
  anthropic: { status: "ready", quota: { weekly: { usedPercent: 14 }, fiveHour: { usedPercent: 0 } }, fetchedAt: 1000 },
};

function harness(mode = "tui", read: ReadQuota = async (provider) => (ready[provider] as any).quota, intervalMs = 300_000) {
  const events = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, any>();
  const statuses = new Map<string, string>([["long-context", "ctx:1.05M"]]);
  const publications: Array<string | undefined> = [];
  const notices: string[] = [];
  const pi = {
    on(name: string, handler: any) { events.set(name, handler); },
    registerCommand(name: string, command: any) { commands.set(name, command); },
  };
  // No auth, conversation, model request, setFooter, tool or provider mutation APIs are available.
  const ctx = {
    mode,
    model: { provider: "unrelated", id: "other-model" },
    ui: {
      theme: { fg: (_color: string, text: string) => text, bold: (text: string) => text },
      setStatus(key: string, text: string | undefined) {
        publications.push(text);
        if (text === undefined) statuses.delete(key); else statuses.set(key, text);
      },
      notify(text: string) { notices.push(text); },
    },
  };
  registerQuotaFooter(pi as never, { read, intervalMs, timeoutMs: 500 });
  const emit = (event: string) => events.get(event)?.({}, ctx);
  cleanups.push(() => emit("session_shutdown"));
  return { ctx, events, commands, statuses, publications, notices, emit };
}

test("compact status keeps zero usage, hides labels/missing windows and leaves detail semantics intact", () => {
  expect(statusText(ready)).toBe("31% | 14% · 0%");
  expect(statusText({ "openai-codex": { status: "ready", quota: {}, fetchedAt: 0 }, anthropic: { status: "error", code: "login" } })).toBe("n/a | /login");
  expect(statusText(ready)).not.toMatch(/spark|codex|claude|wk|5h|Used:/i);
  expect(detailText(ready, 61_000)).toContain("Codex: wk:31% 5h:- used");
  expect(detailText(ready, 61_000)).toContain("Weekly reset:");
  expect(detailText(ready, 61_000)).toContain("Checked 1m ago");
});

const markedTheme = {
  fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  bold: (text: string) => `<b>${text}</b>`,
};

test("Codex percentages use the blue accent and Claude percentages use the heading yellow", () => {
  const text = statusText(ready, markedTheme);
  expect(text).toContain("<accent><b>31%</b></accent>");
  expect(text).toContain("<dim> | </dim>");
  expect(text).toContain("<mdHeading><b>14%</b></mdHeading><dim> · </dim><mdHeading><b>0%</b></mdHeading>");
  expect(text).not.toMatch(/<success>|<error>/);
});

test("empty, loading and error states remain labelled and never acquire healthy usage colors", () => {
  const text = statusText({ "openai-codex": { status: "ready", quota: {}, fetchedAt: 0 }, anthropic: { status: "error", code: "network" } }, markedTheme);
  expect(text).toContain("<dim>n/a</dim>");
  expect(text).toContain("<warning>offline</warning>");
  expect(text).not.toContain("<success>");
  expect(statusText({ "openai-codex": { status: "loading" }, anthropic: { status: "loading" } }, markedTheme)).toContain("<dim>…</dim>");
});

test("factory is inert; TUI startup immediately populates footer without waiting for network", async () => {
  const pending = deferred();
  let calls = 0;
  const h = harness("tui", async () => { calls++; return pending.promise; });
  expect(h.publications).toEqual([]);
  expect(calls).toBe(0);
  expect(h.emit("session_start")).toBeUndefined();
  expect(h.statuses.get(STATUS_KEY)).toBe("… | …");
  await until(() => calls === 2);
  pending.resolve({ weekly: { usedPercent: 20 } });
  await until(() => h.statuses.get(STATUS_KEY) === "20% | 20%");
  expect(h.statuses.get("long-context")).toBe("ctx:1.05M");
  expect([...h.events.keys()].sort()).toEqual(["session_shutdown", "session_start"]);
  expect([...h.commands.keys()]).toEqual(["usage"]);
});

test.each(["rpc", "print", "json"])("%s never starts quota reads or timers", async (mode) => {
  let calls = 0;
  const h = harness(mode, async () => { calls++; return {}; }, 5);
  h.emit("session_start");
  await h.commands.get("usage").handler("", h.ctx);
  await sleep(20);
  expect(calls).toBe(0);
  expect(h.publications).toEqual([]);
});

test("periodic refreshes both providers independently of active model and preserves other statuses", async () => {
  const counts = { "openai-codex": 0, anthropic: 0 };
  const h = harness("tui", async (provider) => ({ weekly: { usedPercent: ++counts[provider] } }), 15);
  h.emit("session_start");
  await until(() => counts.anthropic >= 2);
  expect(counts["openai-codex"]).toBeGreaterThanOrEqual(2);
  expect(h.statuses.get(STATUS_KEY)).toContain("2%");
  expect(h.statuses.get("long-context")).toBe("ctx:1.05M");
});

test("manual and timer refreshes are single-flight", async () => {
  const pending = deferred();
  let calls = 0;
  const monitor = createMonitor({ read: async () => { calls++; return pending.promise; }, publish() {}, intervalMs: 5, timeoutMs: 1000 });
  cleanups.push(monitor.stop);
  monitor.start();
  const first = monitor.refresh();
  const second = monitor.refresh();
  await sleep(20);
  expect(calls).toBe(2);
  pending.resolve({});
  await Promise.all([first, second]);
});

test("provider failure does not blank the other provider or leak errors", async () => {
  const h = harness("tui", async (provider) => {
    if (provider === "anthropic") throw new Error("Bearer SECRET private@example.invalid");
    return { weekly: { usedPercent: 31 } };
  });
  h.emit("session_start");
  await h.commands.get("usage").handler("", h.ctx);
  expect(h.statuses.get(STATUS_KEY)).toBe("31% | offline");
  expect(h.notices.join("\n")).not.toMatch(/SECRET|private@/);
});

test("shared readings preserve their real age, explain backoff, and mark stale usage", async () => {
  const monitor = createMonitor({
    read: async () => ({ weekly: { usedPercent: 44 }, fetchedAt: 1000, cached: true,
      stale: true, retryAt: 1_200_000, warning: "rate-limit" }),
    now: () => 961_000, publish() {},
  });
  cleanups.push(monitor.stop);
  monitor.start();
  await monitor.refresh();
  await monitor.refresh();
  expect(monitor.snapshot().anthropic).toMatchObject({
    status: "ready", quota: { weekly: { usedPercent: 44 } }, fetchedAt: 1000, cached: true, stale: true,
  });
  expect(statusText(monitor.snapshot(), undefined, 961_000)).toBe("44%* | 44%*");
  const text = detailText(monitor.snapshot(), 961_000);
  expect(text).toContain("Checked 16m ago. Shared cache.");
  expect(text).toContain("* Stale: last known usage");
  expect(text).toContain("Refresh: rate limited.");
  expect(text).toContain("Next refresh allowed in 4m.");
});

test("an initially throttled provider is not left looking like an in-flight request", async () => {
  const monitor = createMonitor({
    read: async (provider) => provider === "anthropic" ? undefined : { weekly: { usedPercent: 31 } },
    publish() {},
  });
  cleanups.push(monitor.stop);
  monitor.start();
  await monitor.refresh();
  expect(statusText(monitor.snapshot())).toBe("31% | waiting");
  expect(detailText(monitor.snapshot())).toContain("Claude: waiting for a shared usage reading (not a subscription limit)");
});

test("validated cache preview is visible during a slow refresh and survives a timeout as stale", async () => {
  const now = Date.now();
  const monitor = createMonitor({ read: async (provider, _signal, onCached) => {
    if (provider === "openai-codex") return { weekly: { usedPercent: 31 } };
    onCached?.({ weekly: { usedPercent: 44 }, fetchedAt: now - 960_000,
      cached: true, stale: true, retryAt: now + 900_000 });
    return new Promise(() => {});
  }, now: () => now, timeoutMs: 30, publish() {} });
  cleanups.push(monitor.stop);
  monitor.start();
  await until(() => monitor.snapshot().anthropic.status === "ready");
  expect(statusText(monitor.snapshot(), undefined, now)).toBe("31% | 44%*");
  await monitor.refresh();
  expect(monitor.snapshot().anthropic).toMatchObject({
    status: "ready", fetchedAt: now - 960_000, cached: true, stale: true, warning: "timeout",
  });
  expect(detailText(monitor.snapshot(), now)).toContain("Refresh: timeout.");
});

test.each(["age", "reset"])("a cached preview crossing its %s boundary during a timeout is discarded", async (boundary) => {
  let now = Date.now();
  const monitor = createMonitor({ read: async (_provider, _signal, onCached) => {
    onCached?.({ weekly: { usedPercent: 44, ...(boundary === "reset" ? { resetsAt: now + 1 } : {}) },
      fetchedAt: boundary === "age" ? now - MAX_CACHE_AGE_MS + 1 : now, cached: true });
    now += 2;
    return new Promise(() => {});
  }, now: () => now, timeoutMs: 15, publish() {} });
  cleanups.push(monitor.stop);
  monitor.start();
  await monitor.refresh();
  expect(statusText(monitor.snapshot(), undefined, now)).toBe("timeout | timeout");
});

test("rendering rechecks cache age and resets without relabeling old windows as current", () => {
  const states: States = { ...ready, anthropic: { status: "ready", fetchedAt: 1000, cached: true,
    quota: { weekly: { usedPercent: 14 }, fiveHour: { usedPercent: 88, resetsAt: 2000 } } } };
  expect(statusText(states, undefined, 2000)).toBe("31% | 14%*");
  expect(detailText(states, 2000)).toContain("Claude: wk:14% 5h:- used");
  expect(statusText(states, undefined, 1000 + MAX_CACHE_AGE_MS)).toBe("31% | waiting");
});

test("cold-cache retry has a countdown and cannot keep the previous login's values", async () => {
  let call = 0;
  const monitor = createMonitor({ read: async (provider) => {
    if (provider === "openai-codex") return {};
    if (++call === 1) return { weekly: { usedPercent: 44 } };
    throw new QuotaError("cooldown", 720_000);
  }, now: () => 1000, publish() {} });
  cleanups.push(monitor.stop);
  monitor.start();
  await monitor.refresh();
  await monitor.refresh();
  expect(statusText(monitor.snapshot(), undefined, 1000)).toBe("n/a | wait 12m");
  expect(detailText(monitor.snapshot(), 1000)).toContain("Retry in 12m.");
});

test("Claude's shared reader is still consulted during backoff to see new cache/auth state", async () => {
  let call = 0;
  const monitor = createMonitor({ read: async (provider) => {
    if (provider === "openai-codex") return {};
    if (++call === 1) throw new QuotaError("rate-limit", 900_000);
    return { weekly: { usedPercent: 44 }, fetchedAt: 1000, cached: true };
  }, now: () => 1000, publish() {} });
  cleanups.push(monitor.stop);
  monitor.start();
  await monitor.refresh();
  await monitor.refresh();
  expect(statusText(monitor.snapshot(), undefined, 1000)).toBe("n/a | 44%");
  expect(call).toBe(2);
});

test("failed refresh replaces previous quota rather than displaying stale/account-ambiguous numbers", async () => {
  let fail = false;
  const monitor = createMonitor({ read: async () => {
    if (fail) throw new QuotaError("login");
    return { weekly: { usedPercent: 44 } };
  }, publish() {} });
  cleanups.push(monitor.stop);
  monitor.start();
  await monitor.refresh();
  fail = true;
  await monitor.refresh();
  expect(statusText(monitor.snapshot())).not.toContain("44%");
  expect(statusText(monitor.snapshot())).toContain("/login");
});

test("deadlines produce visible timeouts and shutdown cancels in-flight requests", async () => {
  const signals: AbortSignal[] = [];
  const publications: States[] = [];
  const monitor = createMonitor({
    read: (_provider, signal) => { signals.push(signal); return new Promise(() => {}); },
    publish: (states) => publications.push(states), timeoutMs: 15,
  });
  cleanups.push(monitor.stop);
  monitor.start();
  await monitor.refresh();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(statusText(monitor.snapshot())).toBe("timeout | timeout");
  monitor.stop();
  const count = publications.length;
  await monitor.refresh();
  expect(publications.length).toBe(count);
});

test("Codex rate-limit backoff survives manual refresh without blocking the healthy provider", async () => {
  let now = 10_000;
  const calls = { "openai-codex": 0, anthropic: 0 };
  const monitor = createMonitor({ read: async (provider) => {
    calls[provider]++;
    if (provider === "openai-codex") throw new QuotaError("rate-limit", 900_000);
    return {};
  }, now: () => now, publish() {} });
  cleanups.push(monitor.stop);
  monitor.start();
  await monitor.refresh();
  await monitor.refresh();
  expect(calls).toEqual({ "openai-codex": 1, anthropic: 2 });
  expect(detailText(monitor.snapshot(), now)).toContain("Retry in 15m");
  now += 900_001;
  await monitor.refresh();
  expect(calls["openai-codex"]).toBe(2);
});

test("reload cancels old generation and late completion cannot overwrite the new footer", async () => {
  const pending = deferred();
  let calls = 0;
  const h = harness("tui", async () => {
    calls++;
    return calls <= 2 ? pending.promise : { weekly: { usedPercent: 9 } };
  });
  h.emit("session_start");
  await until(() => calls === 2);
  h.emit("session_shutdown");
  expect(h.statuses.has(STATUS_KEY)).toBe(false);
  h.emit("session_start");
  await until(() => h.statuses.get(STATUS_KEY) === "9% | 9%");
  pending.resolve({ weekly: { usedPercent: 99 } });
  await sleep(15);
  expect(h.statuses.get(STATUS_KEY)).not.toContain("99%");
});

test("immediate teardown never starts queued provider reads", async () => {
  let calls = 0;
  const h = harness("tui", async () => { calls++; return {}; });
  h.emit("session_start");
  h.emit("session_shutdown");
  await sleep();
  expect(calls).toBe(0);
});

test("shutdown is idempotent, clears only its status and prevents future timer work", async () => {
  let calls = 0;
  const h = harness("tui", async () => { calls++; return {}; }, 5);
  h.emit("session_start");
  await until(() => calls >= 2);
  h.emit("session_shutdown");
  h.emit("session_shutdown");
  const final = calls;
  await sleep(25);
  expect(calls).toBe(final);
  expect(h.statuses.has(STATUS_KEY)).toBe(false);
  expect(h.statuses.get("long-context")).toBe("ctx:1.05M");
});

test("/usage shows details through UI only; finishing after shutdown cannot notify", async () => {
  const h = harness();
  h.emit("session_start");
  await h.commands.get("usage").handler("", h.ctx);
  expect(h.notices[0]).toContain("Codex: wk:31% 5h:- used");
  const pending = deferred();
  const late = harness("tui", async () => pending.promise);
  late.emit("session_start");
  const command = late.commands.get("usage").handler("", late.ctx);
  late.emit("session_shutdown");
  pending.resolve({});
  await command;
  expect(late.notices).toEqual([]);
});

test("native footer preserves colors/widths in light and dark themes without replacing normal stats", async () => {
  const root = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
  const load = (path: string) => import(pathToFileURL(join(root, path)).href);
  const { FooterComponent } = await load("dist/modes/interactive/components/footer.js");
  const themes = await load("dist/modes/interactive/theme/theme.js");
  const { visibleWidth } = await load("node_modules/@earendil-works/pi-tui/dist/index.js");
  themes.initTheme("dark", false);
  const h = harness();
  h.ctx.ui.theme = themes.theme;
  h.emit("session_start");
  await until(() => stripVTControlCharacters(h.statuses.get(STATUS_KEY) ?? "") === "31% | 14% · 0%");
  const session = {
    state: { model: { id: "test-model", provider: "openai-codex", contextWindow: 272000 }, thinkingLevel: "high" },
    sessionManager: {
      getEntries: () => [], getEntryCount: () => 0, getSessionId: () => "quota-test", getLeafId: () => null,
      getCwd: () => "/tmp/quota-test", getSessionName: () => undefined,
    },
    getContextUsage: () => ({ percent: 10, contextWindow: 272000 }),
    modelRuntime: { isUsingSubscription: () => true },
  };
  const footer = new FooterComponent(session, {
    getGitBranch: () => "test-branch", getExtensionStatuses: () => h.statuses, getAvailableProviderCount: () => 2,
  });
  const colored: string[] = [];
  for (const name of ["dark", "light"]) {
    themes.initTheme(name, false);
    h.ctx.ui.theme = themes.theme;
    await h.commands.get("usage").handler("", h.ctx);
    const status = h.statuses.get(STATUS_KEY)!;
    colored.push(status);
    expect(status).toContain(themes.theme.fg("accent", themes.theme.bold("31%")));
    expect(status).toContain(themes.theme.fg("mdHeading", themes.theme.bold("14%")));
    expect(status).toContain(themes.theme.fg("mdHeading", themes.theme.bold("0%")));
    for (const width of [30, 50, 80, 120]) {
      const lines: string[] = footer.render(width);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      if (width >= 50) expect(stripVTControlCharacters(lines.at(-1)!)).toContain("31% | 14% · 0%");
      if (width >= 80) {
        const text = lines.map(stripVTControlCharacters).join("\n");
        expect(text).toContain("ctx:1.05M");
        expect(text).toContain("test-branch");
        expect(text).toContain("test-model");
        expect(text).toContain("10.0%/272k");
      }
    }
  }
  expect(colored[0]).not.toBe(colored[1]);
  expect(colored.map(stripVTControlCharacters)).toEqual([statusText(ready), statusText(ready)]);
});
