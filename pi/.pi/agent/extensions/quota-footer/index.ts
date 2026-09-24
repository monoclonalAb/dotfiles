import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createAccountMonitor, createMonitor, detailText, statusText, type AccountSource, type MonitorOptions } from "./monitor.ts";
import { createAccountSource } from "./quota.ts";
import { ACCOUNTS_CHANGED_EVENT } from "../quota-router/accounts.ts";

// Put the compact quota entry before MCP and optional statuses.
export const STATUS_KEY = "00-quota-footer";

type Options = Partial<Pick<MonitorOptions, "read" | "intervalMs" | "timeoutMs" | "now">> & {
  source?: AccountSource;
  accountCheckMs?: number;
};

export function registerQuotaFooter(pi: ExtensionAPI, options: Options = {}): void {
  let monitor: ReturnType<typeof createMonitor> | ReturnType<typeof createAccountMonitor> | undefined;
  let current: ExtensionContext | undefined;
  let generation = 0;
  let unsubscribe: (() => void) | undefined;
  let initializing: Promise<void> | undefined;

  function stop(): void {
    generation++;
    unsubscribe?.();
    unsubscribe = undefined;
    initializing = undefined;
    monitor?.stop();
    monitor = undefined;
    current?.ui.setStatus(STATUS_KEY, undefined);
    current = undefined;
  }

  pi.on("session_start", (_event, ctx) => {
    stop();
    if (ctx.mode !== "tui") return;
    current = ctx;
    const activeGeneration = generation;
    const publish = (states: Parameters<typeof statusText>[0]) => {
      if (activeGeneration === generation) ctx.ui.setStatus(STATUS_KEY, statusText(states, ctx.ui.theme, options.now?.()));
    };
    const start = (source: AccountSource) => {
      if (activeGeneration !== generation) return;
      const accounts = createAccountMonitor({ ...options, source, publish });
      monitor = accounts;
      unsubscribe = pi.events?.on(ACCOUNTS_CHANGED_EVENT, () => accounts.changed());
      accounts.start();
    };
    // Injected single-provider reader is retained for synthetic UI/cache fixtures.
    if (options.read) {
      monitor = createMonitor({ ...options, read: options.read, publish });
      monitor.start();
    } else if (options.source) start(options.source);
    else {
      publish({ "openai-codex": { status: "loading" }, anthropic: { status: "loading" } });
      initializing = createAccountSource(ctx.modelRegistry).then(start)
        .catch(() => publish({ "openai-codex": { status: "error", code: "cache" }, anthropic: { status: "error", code: "cache" } }));
    }
  });

  pi.on("session_shutdown", stop);

  pi.registerCommand("usage", {
    description: "Show usage and resets for all saved Codex/Claude accounts (no Spark)",
    handler: async (_argument, ctx) => {
      if (ctx.mode !== "tui") return;
      const activeGeneration = generation;
      await initializing;
      const active = monitor;
      if (!active || activeGeneration !== generation) return;
      await active.refresh();
      if (monitor !== active) return;
      ctx.ui.notify("details" in active ? active.details() : detailText(active.snapshot(), options.now?.()), "info");
    },
  });
}

export default function quotaFooter(pi: ExtensionAPI): void {
  registerQuotaFooter(pi);
}
