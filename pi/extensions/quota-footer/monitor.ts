import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  abortable, LABELS, POLL_MS, PROVIDERS, QuotaError, SHARED_ANTHROPIC_THROTTLE_MS, TIMEOUT_MS, unexpiredReading,
  type ErrorCode, type Provider, type Quota, type QuotaReading, type ReadQuota,
} from "./quota.ts";

export type QuotaState =
  | { status: "loading" }
  | { status: "cooldown"; retryAt?: number }
  | { status: "ready"; quota: Quota; fetchedAt: number; cached?: boolean; stale?: boolean; retryAt?: number; warning?: ErrorCode }
  | { status: "error"; code: ErrorCode; retryAt?: number };
export type States = Record<Provider, QuotaState>;

export interface QuotaAccount {
  provider: Provider;
  /** Absent for a native route without a stored account. */
  label?: string;
  active: boolean;
}
export interface AccountSource {
  list(): Promise<QuotaAccount[]>;
  read(account: QuotaAccount, signal: AbortSignal, onCached?: (reading: QuotaReading) => void): Promise<QuotaReading | undefined>;
}
type AccountEntry = {
  monitor: ReturnType<typeof createMonitor>;
  checkedAt?: number;
};
const accountKey = (account: QuotaAccount) => `${account.provider}@${account.label ?? ""}`;
const loading = (): States => ({ "openai-codex": { status: "loading" }, anthropic: { status: "loading" } });

/** One single-flight/backoff state per account; only active accounts poll quota endpoints. */
export function createAccountMonitor(options: Omit<MonitorOptions, "read"> & {
  source: AccountSource;
  accountCheckMs?: number;
}) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, AccountEntry>();
  let accounts: QuotaAccount[] = [];
  let stopped = false;
  let started = false;
  let invalidated = true;
  let listFailed = false;
  let revision = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let syncing = Promise.resolve();

  function snapshot(): States {
    const result = loading();
    if (listFailed) return { "openai-codex": { status: "error", code: "cache" }, anthropic: { status: "error", code: "cache" } };
    if (invalidated) return result;
    for (const account of accounts) {
      if (account.active) result[account.provider] = entries.get(accountKey(account))!.monitor.snapshot()[account.provider];
    }
    return result;
  }
  const publish = () => { if (!stopped) options.publish(snapshot()); };

  function sync(): Promise<void> {
    const requestedRevision = revision;
    const task = syncing.then(async () => {
      if (stopped) return;
      try {
        const listed = await options.source.list();
        if (stopped || requestedRevision !== revision) return;
        invalidated = true;
        const present = new Set(listed.map(accountKey));
        for (const [id, entry] of entries) {
          if (!present.has(id)) { entry.monitor.stop(); entries.delete(id); }
        }
        for (const account of listed) {
          const id = accountKey(account);
          if (entries.has(id)) continue;
          const monitor = createMonitor({
            now, timeoutMs: options.timeoutMs, providers: [account.provider], autoPoll: false,
            read: (_provider, signal, onCached) => options.source.read(account, signal, onCached),
            publish,
          });
          entries.set(id, { monitor });
          monitor.start();
        }
        accounts = listed;
        invalidated = false;
        listFailed = false;
      } catch {
        if (stopped || requestedRevision !== revision) return;
        // Never print native credential errors or pretend a partial list is complete.
        listFailed = true;
      }
      publish();
    });
    syncing = task;
    return task;
  }

  async function refresh(all = false): Promise<void> {
    if (!started || stopped) return;
    await sync();
    if (stopped || invalidated || listFailed) return;
    const selected = accounts.filter((account) => all || account.active);
    await Promise.all(selected.map(async (account) => {
      const entry = entries.get(accountKey(account))!;
      if (!all && entry.checkedAt !== undefined && now() - entry.checkedAt < (options.intervalMs ?? POLL_MS)) return;
      entry.checkedAt = now();
      await entry.monitor.refresh();
    }));
  }

  return {
    snapshot,
    refresh: () => refresh(true),
    details() {
      if (listFailed) return "Account quota unavailable: could not list saved accounts. Try /accounts, then /usage again.";
      const rows: DetailRow[] = accounts.map((account) => ({
        provider: account.provider,
        title: `${LABELS[account.provider]}${account.label ? ` / ${account.label}` : ""} (${account.active ? "active" : "parked"})`,
        state: entries.get(accountKey(account))!.monitor.snapshot()[account.provider],
        ...(!account.active ? { loginHint: `Renew this parked login with /accounts remove ${account.provider} ${account.label}, then /accounts add ${account.provider} ${account.label}.` } : {}),
      }));
      return detailText(snapshot(), now(), rows);
    },
    changed() {
      if (stopped) return;
      revision++;
      invalidated = true;
      publish();
      void refresh();
    },
    start() {
      if (started || stopped) return;
      started = true;
      publish();
      void refresh();
      // Local account metadata only every 5s: detect changes made in another Pi
      // session without polling every account's quota endpoint in the background.
      timer = setInterval(() => { void refresh(); }, options.accountCheckMs ?? 5_000);
      timer.unref?.();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      for (const entry of entries.values()) entry.monitor.stop();
      entries.clear();
    },
  };
}

const ERRORS: Record<ErrorCode, string> = {
  login: "/login", oauth: "OAuth needed", unsupported: "unsupported route",
  timeout: "timeout", "rate-limit": "rate limited", response: "unavailable", network: "offline",
  cooldown: "waiting", cache: "cache unavailable",
};

function percentages(quota: Quota): string {
  const percent = (value: number | undefined) => value === undefined ? "-" : `${Math.round(value)}%`;
  return `wk:${percent(quota.weekly?.usedPercent)} 5h:${percent(quota.fiveHour?.usedPercent)}`;
}

function currentState(state: QuotaState, now: number): QuotaState {
  if (state.status !== "ready" || state.cached === undefined) return state;
  const reading = unexpiredReading({ ...state.quota, fetchedAt: state.fetchedAt,
    stale: state.stale || now - state.fetchedAt >= SHARED_ANTHROPIC_THROTTLE_MS }, now);
  if (!reading) return { status: "cooldown", retryAt: state.retryAt };
  const { fetchedAt: _fetchedAt, stale, ...quota } = reading;
  return { ...state, quota, stale };
}

export type StatusTheme = Pick<ExtensionContext["ui"]["theme"], "fg" | "bold">;

export function statusText(states: States, theme?: StatusTheme, now = Date.now()): string {
  const fg = (color: Parameters<StatusTheme["fg"]>[0], text: string) => theme?.fg(color, text) ?? text;
  const bold = (text: string) => theme?.bold(text) ?? text;
  return PROVIDERS.map((provider) => {
    const state = currentState(states[provider], now);
    if (state.status === "loading") return fg("dim", "…");
    if (state.status === "cooldown") return fg("dim", state.retryAt
      ? `wait ${Math.max(1, Math.ceil((state.retryAt - now) / 60_000))}m` : "waiting");
    if (state.status === "error") return fg("warning", ERRORS[state.code]);
    const color = provider === "openai-codex" ? "accent" : "mdHeading";
    const windows = [state.quota.weekly, state.quota.fiveHour]
      .filter((window) => window !== undefined)
      .map((window) => fg(color, bold(`${Math.round(window.usedPercent)}%`)));
    const text = windows.length ? windows.join(fg("dim", " · ")) : fg("dim", "n/a");
    return text + (state.stale ? fg("warning", "*") : "");
  }).join(fg("dim", " | "));
}

export interface DetailRow {
  provider: Provider;
  title: string;
  state: QuotaState;
  loginHint?: string;
}

export function detailText(states: States, now = Date.now(), rows?: DetailRow[]): string {
  const lines = ["Account quota used (- = window not reported). Spark omitted."];
  for (const { provider, title, state: original, loginHint } of rows ?? PROVIDERS.map((provider) => ({
    provider, title: LABELS[provider], state: states[provider], loginHint: undefined,
  }))) {
    const state = currentState(original, now);
    if (state.status !== "ready") {
      const hint = state.status === "loading" ? "loading"
        : state.status === "cooldown" ? "waiting for a shared usage reading (not a subscription limit)" : ERRORS[state.code];
      lines.push(`${title}: ${hint}`);
      if (state.status === "error" && (state.code === "login" || state.code === "oauth")) {
        lines.push(`  ${loginHint ?? `Use Pi /login for ${provider}; the quota endpoint needs subscription OAuth access.`}`);
      }
      if (state.status !== "loading" && state.retryAt) {
        lines.push(`  Retry in ${Math.max(1, Math.ceil((state.retryAt - now) / 60_000))}m.`);
      }
      continue;
    }
    lines.push(`${title}: ${percentages(state.quota)} used`);
    for (const [name, window] of [["Weekly", state.quota.weekly], ["5-hour", state.quota.fiveHour]] as const) {
      if (window?.resetsAt) {
        lines.push(`  ${name} reset: ${new Date(window.resetsAt).toLocaleString()}`);
      }
    }
    lines.push(`  Checked ${Math.max(0, Math.floor((now - state.fetchedAt) / 60_000))}m ago.${state.cached ? " Shared cache." : ""}`);
    if (state.stale) lines.push("  * Stale: last known usage, not a fresh reading. Expired windows are omitted.");
    if (state.warning) lines.push(`  Refresh: ${ERRORS[state.warning]}.`);
    if (state.retryAt) lines.push(`  Next refresh allowed in ${Math.max(0, Math.ceil((state.retryAt - now) / 60_000))}m.`);
  }
  return lines.join("\n");
}

export interface MonitorOptions {
  read: ReadQuota;
  publish: (states: States) => void;
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  /** Restrict a child monitor to one account's provider. */
  providers?: readonly Provider[];
  /** A parent account monitor owns polling and initial reads. */
  autoPoll?: boolean;
}

/** Starts no resources until start(); owns every timer/request for exactly one TUI session. */
export function createMonitor(options: MonitorOptions) {
  const now = options.now ?? Date.now;
  const states: States = { "openai-codex": { status: "loading" }, anthropic: { status: "loading" } };
  const flights = new Map<Provider, Promise<void>>();
  const controllers = new Set<AbortController>();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stopped = false;
  let started = false;
  const publish = () => { if (!stopped) options.publish({ ...states }); };

  function refreshProvider(provider: Provider): Promise<void> {
    if (stopped) return Promise.resolve();
    const active = flights.get(provider);
    if (active) return active;
    const state = states[provider];
    // Claude's reader owns cross-process backoff. Still consult it to notice a
    // new shared result or changed login; never pin one process's old error.
    if (provider !== "anthropic" && state.status === "error" && state.retryAt && state.retryAt > now()) return Promise.resolve();
    const controller = new AbortController();
    controllers.add(controller);
    const deadline = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
    deadline.unref?.();
    const toState = (reading: QuotaReading): Extract<QuotaState, { status: "ready" }> => {
      const { fetchedAt = now(), cached, stale, retryAt, warning, ...quota } = reading;
      return { status: "ready", quota, fetchedAt,
        ...(cached !== undefined ? { cached } : {}), ...(stale !== undefined ? { stale } : {}),
        ...(retryAt !== undefined ? { retryAt } : {}), ...(warning ? { warning } : {}),
      };
    };
    // Only a cache revalidated against this request's auth may survive a failure.
    // Never fall back to arbitrary previous monitor state after a login change.
    let preview: Extract<QuotaState, { status: "ready" }> | undefined;
    const task = (async () => {
      try {
        const reading = await abortable(Promise.resolve().then(() => {
          controller.signal.throwIfAborted();
          return options.read(provider, controller.signal, (cached) => {
            if (stopped || controller.signal.aborted) return;
            preview = toState(cached);
            states[provider] = preview;
            publish();
          });
        }), controller.signal);
        if (!stopped) states[provider] = reading === undefined ? { status: "cooldown" } : toState(reading);
      } catch (error) {
        if (stopped) return;
        const code = controller.signal.aborted ? "timeout" : error instanceof QuotaError ? error.code : "network";
        const retryAt = error instanceof QuotaError && error.retryAfterMs !== undefined
          ? now() + error.retryAfterMs : undefined;
        const retained = preview && unexpiredReading({ ...preview.quota, fetchedAt: preview.fetchedAt,
          cached: true, stale: true, warning: code, retryAt: retryAt ?? preview.retryAt }, now());
        if (retained && ["timeout", "rate-limit", "network", "response", "cache"].includes(code)) {
          states[provider] = toState(retained);
        } else if (code === "cooldown") {
          states[provider] = { status: "cooldown", ...(retryAt ? { retryAt } : {}) };
        } else {
          states[provider] = {
            status: "error", code,
            ...(retryAt ? { retryAt } : code === "rate-limit" ? { retryAt: now() + 15 * 60_000 } : {}),
          };
        }
      } finally {
        clearTimeout(deadline);
        controllers.delete(controller);
        flights.delete(provider);
        publish();
      }
    })();
    flights.set(provider, task);
    return task;
  }

  async function refresh(): Promise<void> {
    if (!started || stopped) return;
    await Promise.all((options.providers ?? PROVIDERS).map(refreshProvider));
  }

  return {
    snapshot: (): States => ({ ...states }),
    refresh,
    start() {
      if (started || stopped) return;
      started = true;
      publish();
      if (options.autoPoll === false) return;
      void refresh();
      timer = setInterval(() => { void refresh(); }, options.intervalMs ?? POLL_MS);
      timer.unref?.();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer) clearInterval(timer);
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },
  };
}
