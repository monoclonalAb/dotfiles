import { afterEach, expect, test } from "bun:test";
import { createAccountMonitor, type AccountSource, type QuotaAccount } from "./monitor.ts";
import { statusText } from "./monitor.ts";
import { registerQuotaFooter, STATUS_KEY } from "./index.ts";
import { ACCOUNTS_CHANGED_EVENT } from "../quota-router/accounts.ts";
import { QuotaError } from "./quota.ts";

const sleep = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn: () => boolean) {
  for (let i = 0; i < 200; i++) { if (fn()) return; await sleep(); }
  throw new Error("account monitor did not settle");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}
const cleanup: (() => void)[] = [];
afterEach(() => { for (const stop of cleanup.splice(0)) stop(); });
function fixture(read?: AccountSource["read"], accountCheckMs = 100_000) {
  let accounts: QuotaAccount[] = [
    { provider: "openai-codex", label: "main", active: true },
    { provider: "openai-codex", label: "work", active: false },
    { provider: "anthropic", label: "main", active: true },
    { provider: "anthropic", label: "other", active: false },
  ];
  let clock = 1_000_000;
  const calls: string[] = [];
  const source: AccountSource = {
    list: async () => accounts.map((account) => ({ ...account })),
    read: async (account, signal, cached) => {
      calls.push(`${account.provider}/${account.label}`);
      return read ? read(account, signal, cached) : { weekly: { usedPercent: account.label === "main" ? 100 : 12 }, fiveHour: { usedPercent: 0 } };
    },
  };
  const publications: string[] = [];
  const monitor = createAccountMonitor({ source, now: () => clock, accountCheckMs,
    publish: (states) => publications.push(statusText(states)), timeoutMs: 500 });
  cleanup.push(monitor.stop);
  return { source, monitor, calls, publications,
    set accounts(next: QuotaAccount[]) { accounts = next; },
    get accounts() { return accounts; },
    tick() { clock += 300_001; },
    switchToWork(notify = true) {
      accounts = accounts.map((account) => account.provider === "openai-codex" ? { ...account, active: account.label === "work" } : account);
      if (notify) monitor.changed();
    },
  };
}

test("discovery is inert; poll active accounts only, /usage shows every account with independent windows", async () => {
  const f = fixture();
  expect(f.calls).toEqual([]);
  f.monitor.start();
  await until(() => f.publications.at(-1) === "100% · 0% | 100% · 0%");
  expect(f.calls.sort()).toEqual(["anthropic/main", "openai-codex/main"]);
  await f.monitor.refresh();
  const text = f.monitor.details();
  for (const heading of ["Codex / main (active): wk:100% 5h:0", "Codex / work (parked): wk:12% 5h:0",
    "Claude / main (active): wk:100% 5h:0", "Claude / other (parked): wk:12% 5h:0"]) expect(text).toContain(heading);
  expect(statusText(f.monitor.snapshot())).toBe("100% · 0% | 100% · 0%");
  expect(text).not.toMatch(/112%/);
});

test("one parked account's error/backoff never masks another account and manual usage respects it", async () => {
  const f = fixture(async (account) => {
    if (account.label === "main" && account.provider === "openai-codex") throw new QuotaError("rate-limit", 900_000);
    if (account.label === "other") throw new Error("Bearer SECRET email@example.invalid");
    return { weekly: { usedPercent: 12 } };
  });
  f.monitor.start();
  await f.monitor.refresh();
  await f.monitor.refresh();
  expect(f.calls.filter((id) => id === "openai-codex/main")).toHaveLength(1);
  expect(f.monitor.details()).toContain("Codex / main (active): rate limited");
  expect(f.monitor.details()).toContain("Retry in 15m");
  expect(f.monitor.details()).toContain("Codex / work (parked): wk:12% 5h:- used");
  expect(f.monitor.details()).not.toMatch(/SECRET|email@/);
  f.switchToWork();
  await until(() => f.publications.at(-1) === "12% | 12%");
  expect(f.monitor.details()).toContain("Codex / work (active)");
  expect(f.monitor.details()).toContain("Codex / main (parked)");
});

test("switch while an old account request is pending never publishes its late result as the active quota", async () => {
  const pending = deferred<any>();
  const f = fixture(async (account) => account.provider === "openai-codex" && account.label === "main"
    ? pending.promise : { weekly: { usedPercent: 12 } });
  f.monitor.start();
  await until(() => f.calls.includes("openai-codex/main"));
  f.switchToWork();
  await until(() => f.publications.at(-1) === "12% | 12%");
  const index = f.publications.length;
  pending.resolve({ weekly: { usedPercent: 99 } });
  await sleep(20);
  expect(f.publications.slice(index).every((text) => !text.includes("99%"))).toBe(true);
  expect(statusText(f.monitor.snapshot())).toBe("12% | 12%");
});

test("metadata polling notices another session's switch without querying parked quotas", async () => {
  const f = fixture(undefined, 10);
  f.monitor.start();
  await until(() => f.publications.at(-1) === "100% · 0% | 100% · 0%");
  f.switchToWork(false);
  await until(() => f.publications.at(-1) === "12% · 0% | 100% · 0%");
  await sleep(30);
  expect(f.calls.sort()).toEqual(["anthropic/main", "openai-codex/main", "openai-codex/work"]);
  f.tick();
  await until(() => f.calls.length === 5);
  expect(f.calls).not.toContain("anthropic/other");
});

test("add/remove update the list and removed in-flight requests are cancelled", async () => {
  let removedSignal: AbortSignal | undefined;
  const f = fixture(async (account, signal) => {
    if (account.label === "work") { removedSignal = signal; return new Promise(() => {}); }
    return {};
  });
  f.monitor.start();
  const usage = f.monitor.refresh();
  await until(() => !!removedSignal);
  f.accounts = f.accounts.filter((account) => account.label !== "work");
  f.monitor.changed();
  await until(() => removedSignal!.aborted);
  await usage;
  expect(f.monitor.details()).not.toContain("work");
  f.accounts = [...f.accounts, { provider: "openai-codex", label: "new", active: false }];
  await f.monitor.refresh();
  expect(f.monitor.details()).toContain("Codex / new (parked)");
});

test("account-list failure is explicit and never prints credential-store exceptions", async () => {
  const f = fixture();
  f.source.list = async () => { throw new Error("SECRET auth.json body"); };
  f.monitor.start();
  await f.monitor.refresh();
  expect(f.monitor.details()).toContain("could not list saved accounts");
  expect(f.monitor.details()).not.toContain("SECRET");
  expect(f.calls).toEqual([]);
});

test("shutdown cancels requests; slow discovery and late reads cannot publish", async () => {
  const pending = deferred<QuotaAccount[]>();
  const f = fixture();
  f.source.list = () => pending.promise;
  f.monitor.start();
  await sleep();
  f.monitor.stop();
  const count = f.publications.length;
  pending.resolve(f.accounts);
  await sleep();
  expect(f.calls).toEqual([]);
  expect(f.publications).toHaveLength(count);
});

test("extension command is UI-only, router notifications update it and reload unsubscribes", async () => {
  const f = fixture();
  const events = new Map<string, Function>();
  const subscribers = new Map<string, Function>();
  let command: any;
  const statuses = new Map<string, string>();
  const notices: string[] = [];
  const pi = {
    on: (name: string, fn: Function) => events.set(name, fn),
    events: { on: (name: string, fn: Function) => { subscribers.set(name, fn); return () => { subscribers.delete(name); }; } },
    registerCommand: (name: string, value: any) => { expect(name).toBe("usage"); command = value; },
  };
  const ctx = { mode: "tui", ui: {
    theme: { fg: (_: string, text: string) => text, bold: (text: string) => text },
    setStatus: (key: string, value: string) => statuses.set(key, value),
    notify: (text: string) => notices.push(text),
  } };
  registerQuotaFooter(pi as never, { source: f.source });
  expect(f.calls).toEqual([]);
  events.get("session_start")!({}, ctx);
  cleanup.push(() => events.get("session_shutdown")!());
  await command.handler("", ctx);
  expect(notices[0]).toContain("Codex / work (parked)");
  f.switchToWork(false);
  subscribers.get(ACCOUNTS_CHANGED_EVENT)!();
  await until(() => statuses.get(STATUS_KEY) === "12% · 0% | 100% · 0%");
  events.get("session_shutdown")!();
  expect(subscribers.size).toBe(0);
  const count = notices.length;
  await command.handler("", ctx);
  expect(notices).toHaveLength(count);
});

test.each(["rpc", "print", "json"])("%s does not enumerate saved accounts", async (mode) => {
  const f = fixture();
  let lists = 0;
  f.source.list = async () => { lists++; return []; };
  const events = new Map<string, Function>();
  let command: any;
  registerQuotaFooter({ on: (name: string, fn: Function) => events.set(name, fn),
    registerCommand: (_: string, value: any) => { command = value; } } as never, { source: f.source });
  events.get("session_start")!({}, { mode });
  await command.handler("", { mode });
  expect(lists).toBe(0);
});
