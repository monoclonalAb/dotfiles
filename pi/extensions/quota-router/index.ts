import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthInteraction } from "@earendil-works/pi-ai";
import {
  getAgentDir,
  type ExtensionAPI,
  type ExtensionCommandContext,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { THEME_APPLIED_EVENT } from "../theme-sync/events.ts";
import { ACCOUNTS_CHANGED_EVENT, AccountStore, accountIdentity, type Activation, parkedKey } from "./accounts.ts";
import { createRuntimeBackend, createStateStore, stateDirectory } from "./backend.ts";
import {
  annotateForRetry,
  classifyError,
  classifyResponse,
  clampReset,
  DEFAULT_CONFIG,
  formatClock,
  formatDuration,
  isRetryableByPi,
  type LimitSignal,
  parseConfig,
  type RouterConfig,
} from "./router.ts";

export const STATUS_KEY = "quota-router";
export const CONFIG_FILE = "quota-router.json";

const MAX_TIMER_MS = 2 ** 31 - 1;
const LOGIN_TIMEOUT_MS = 10 * 60_000;

export interface RouterOptions {
  now?: () => number;
  /** Returns the config file text, or undefined when absent. Errors are reported as warnings. */
  readConfig?: () => string | undefined;
  setTimer?: (callback: () => void, delayMs: number) => () => void;
  accounts?: AccountStore;
  openUrl?: (url: string) => void;
}

function defaultReadConfig(): string | undefined {
  try {
    return readFileSync(join(getAgentDir(), CONFIG_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function defaultSetTimer(callback: () => void, delayMs: number): () => void {
  const handle = setTimeout(callback, Math.min(MAX_TIMER_MS, Math.max(0, delayMs)));
  handle.unref?.();
  return () => clearTimeout(handle);
}

/** Same launcher Pi's login dialog uses: never a shell, failures are non-fatal. */
function defaultOpenUrl(url: string): void {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
        : ["xdg-open", [url]];
  spawn(command, args, { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

function defaultAccounts(now: () => number): AccountStore {
  return new AccountStore({
    backend: createRuntimeBackend({ agentDir: getAgentDir() }),
    state: createStateStore(stateDirectory()),
    now,
  });
}

interface Plan {
  provider: string;
  from: string;
  to: string;
  /** Pi's own auto-retry will continue this turn after the switch. */
  retryable: boolean;
  until: number;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerQuotaRouter(pi: ExtensionAPI, options: RouterOptions = {}): void {
  const now = options.now ?? (() => Date.now());
  const readConfig = options.readConfig ?? defaultReadConfig;
  const setTimer = options.setTimer ?? defaultSetTimer;
  const openUrl = options.openUrl ?? defaultOpenUrl;
  let accountsInstance = options.accounts;
  const accounts = () => (accountsInstance ??= defaultAccounts(now));

  let config: RouterConfig = DEFAULT_CONFIG;
  let enabled = true;
  let pendingResponse: (LimitSignal & { provider: string }) | undefined;
  let plan: Plan | undefined;
  let noRouteReason: string | undefined;
  let noRouteNotified: string | undefined;
  let cancelTimer: (() => void) | undefined;
  let returning = false;
  /** Session that last painted the account status, so a theme change can repaint it. */
  let statusContext: ExtensionContext | undefined;

  function clearTimer(): void {
    cancelTimer?.();
    cancelTimer = undefined;
  }

  /** Footer marker for the current model's provider; nothing while the preferred account is active. */
  function statusText(ctx: ExtensionContext): string | undefined {
    if (!enabled) return "route:off";
    const provider = ctx.model?.provider;
    if (!provider || !accounts().preferredLabel(provider)) return undefined;
    return `${ctx.ui.theme.fg("dim", "· ")}@${accounts().activeLabel(provider)}`;
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;
    statusContext = ctx;
    ctx.ui.setStatus(STATUS_KEY, statusText(ctx));
    pi.events?.emit(ACCOUNTS_CHANGED_EVENT, undefined);
  }

  /** Earliest moment a preferred account of any provider could be restored. */
  function nextReturnAt(): number | undefined {
    const state = accounts().readState();
    let earliest: number | undefined;
    for (const [provider, entry] of Object.entries(state.providers)) {
      if (!entry.preferred) continue;
      const cooldown = state.cooldowns[parkedKey(provider, entry.preferred)];
      const at = cooldown && cooldown.until > now() ? cooldown.until : now();
      if (earliest === undefined || at < earliest) earliest = at;
    }
    return earliest;
  }

  function armReturn(ctx: ExtensionContext): void {
    clearTimer();
    if (!enabled || !config.returnToPreferred) return;
    const at = nextReturnAt();
    if (at === undefined) return;
    const context = ctx;
    cancelTimer = setTimer(() => {
      cancelTimer = undefined;
      void tryReturn(context);
    }, Math.max(0, at - now()));
  }

  async function tryReturn(ctx: ExtensionContext): Promise<void> {
    if (!enabled || !config.returnToPreferred || returning) return;
    const state = accounts().readState();
    const due = Object.entries(state.providers).filter(([provider, entry]) => {
      if (!entry.preferred) return false;
      const cooldown = state.cooldowns[parkedKey(provider, entry.preferred)];
      return !cooldown || cooldown.until <= now();
    });
    if (due.length === 0) {
      armReturn(ctx);
      return;
    }
    if (!ctx.isIdle()) return;
    returning = true;
    try {
      for (const [provider, entry] of due) {
        try {
          const activation = await accounts().activate(provider, entry.preferred!, { preferred: null });
          if (activation) {
            ctx.ui.notify(`quota-router: ${provider} cooldown passed; back on account ${activation.to}`, "info");
          }
        } catch (error) {
          accounts().setPreferred(provider, undefined);
          ctx.ui.notify(`quota-router: could not return ${provider} to account ${entry.preferred}: ${describe(error)}`, "warning");
        }
      }
    } finally {
      returning = false;
    }
    updateStatus(ctx);
    armReturn(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    clearTimer();
    pendingResponse = undefined;
    plan = undefined;
    noRouteReason = undefined;
    noRouteNotified = undefined;
    let warnings: string[] = [];
    try {
      ({ config, warnings } = parseConfig(readConfig()));
    } catch (error) {
      config = DEFAULT_CONFIG;
      warnings = [`could not read ${CONFIG_FILE}: ${describe(error)}`];
    }
    for (const warning of warnings) ctx.ui.notify(`quota-router: ${warning}`, "warning");
    try {
      updateStatus(ctx);
      await tryReturn(ctx);
    } catch (error) {
      ctx.ui.notify(`quota-router: account state unavailable: ${describe(error)}`, "warning");
    }
  });

  pi.on("session_shutdown", () => {
    clearTimer();
    statusContext = undefined;
  });

  pi.on("after_provider_response", (event, ctx) => {
    if (!enabled || !ctx.model) return;
    const signal = classifyResponse(event.status, event.headers, now());
    pendingResponse = signal ? { ...signal, provider: ctx.model.provider } : undefined;
  });

  pi.on("message_end", async (event, ctx) => {
    if (event.message.role !== "assistant") return;
    const response = pendingResponse;
    pendingResponse = undefined;
    plan = undefined;
    noRouteReason = undefined;
    const model = ctx.model;
    if (!enabled || !model || event.message.stopReason !== "error") return;

    const fromMessage = classifyError(event.message.errorMessage, now());
    const fromResponse = response?.provider === model.provider ? response : undefined;
    const signal = fromMessage ?? fromResponse;
    if (!signal) return;
    // Throttling only counts against subscription logins; API keys get Pi's normal retry.
    if (!signal.hard && !ctx.modelRegistry.isUsingOAuth(model)) return;

    const provider = model.provider;
    const until = clampReset(signal.resetAt ?? fromResponse?.resetAt, now(), config.cooldownMs);
    let from: string;
    let to: string | undefined;
    try {
      from = accounts().activeLabel(provider);
      accounts().markCooldown(provider, from, until, signal.reason);
      to = await accounts().next(provider);
    } catch (error) {
      noRouteReason = `account state unavailable: ${describe(error)}`;
      return;
    }
    if (!to) {
      noRouteReason = `no other signed-in ${provider} account is available (/accounts add ${provider} <label>)`;
      return;
    }

    plan = { provider, from, to, retryable: isRetryableByPi(event.message.errorMessage), until };
    if (plan.retryable) return;
    const annotated = annotateForRetry(event.message.errorMessage ?? "", to);
    if (!annotated) return;
    plan.retryable = true;
    return { message: { ...event.message, errorMessage: annotated } };
  });

  pi.on("agent_end", async (_event, ctx) => {
    const current = plan;
    plan = undefined;
    if (!enabled) return;
    if (!current) {
      if (noRouteReason && ctx.model) {
        const provider = ctx.model.provider;
        const key = `${provider}:${accounts().cooldown(provider, accounts().activeLabel(provider))?.until ?? 0}`;
        if (noRouteNotified !== key) {
          noRouteNotified = key;
          ctx.ui.notify(`quota-router: ${provider} usage limit reached; ${noRouteReason}`, "warning");
        }
        noRouteReason = undefined;
        updateStatus(ctx);
      }
      return;
    }

    let activation: Activation | undefined;
    try {
      const preferred = accounts().preferredLabel(current.provider) ?? current.from;
      activation = await accounts().activate(current.provider, current.to, { preferred });
    } catch (error) {
      ctx.ui.notify(`quota-router: could not switch ${current.provider} to account ${current.to}: ${describe(error)}`, "error");
      return;
    }
    const wait = formatDuration(current.until - now());
    ctx.ui.notify(
      activation
        ? `quota-router: ${current.provider} account ${current.from} usage limit (retry after ~${wait}, ${formatClock(current.until)}); switched to account ${current.to}`
        : `quota-router: ${current.provider} already switched to account ${current.to} by another session`,
      "warning",
    );
    if (!current.retryable) {
      ctx.ui.notify("quota-router: Pi will not retry this error automatically; re-send your last message", "warning");
    }
    updateStatus(ctx);
    armReturn(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await tryReturn(ctx);
  });

  // Footer text carries the palette's ANSI code, so theme-sync's flavour changes must repaint it.
  pi.events?.on(THEME_APPLIED_EVENT, () => {
    const ctx = statusContext;
    if (ctx?.hasUI) ctx.ui.setStatus(STATUS_KEY, statusText(ctx));
  });

  function loginInteraction(ctx: ExtensionContext, signal: AbortSignal): AuthInteraction {
    return {
      signal,
      prompt: async (prompt) => {
        if (prompt.type === "select") {
          const labels = prompt.options.map((option) => option.label);
          const choice = await ctx.ui.select(prompt.message, labels, { signal: prompt.signal });
          const option = prompt.options.find((entry) => entry.label === choice);
          if (!option) throw new Error("Login cancelled");
          return option.id;
        }
        const value = await ctx.ui.input(prompt.message, prompt.placeholder, { signal: prompt.signal });
        if (value === undefined) {
          throw prompt.signal?.aborted ? new DOMException("Prompt dismissed", "AbortError") : new Error("Login cancelled");
        }
        return value;
      },
      notify: (event) => {
        if (event.type === "auth_url") {
          ctx.ui.notify(`${event.instructions ?? "Open this URL to sign in:"}\n${event.url}`, "info");
          openUrl(event.url);
        } else if (event.type === "device_code") {
          ctx.ui.notify(`Enter code ${event.userCode} at ${event.verificationUri}`, "info");
          openUrl(event.verificationUri);
        } else if ("message" in event && typeof event.message === "string") {
          ctx.ui.notify(event.message, "info");
        }
      },
    };
  }

  async function listAccounts(ctx: ExtensionContext): Promise<string> {
    const providers = new Set(await accounts().providers());
    if (ctx.model) providers.add(ctx.model.provider);
    const lines: string[] = [];
    for (const provider of [...providers].sort()) {
      const summary = await accounts().summary(provider);
      if (summary.slots.length === 0) {
        lines.push(`${provider}: no accounts signed in`);
        continue;
      }
      const preferred = accounts().preferredLabel(provider);
      const slots = summary.slots.map((slot) => {
        const flags = [slot.active ? "active" : "parked"];
        if (slot.cooldown) flags.push(`limit until ${formatClock(slot.cooldown.until)}`);
        if (preferred === slot.label) flags.push("return here");
        return `${slot.label} (${flags.join(", ")})`;
      });
      lines.push(`${provider}: ${slots.join(", ")}`);
    }
    return lines.join("\n");
  }

  pi.registerCommand("accounts", {
    description: "Extra logins per provider: /accounts [list|add|use|remove] <provider> <label>",
    getArgumentCompletions: (prefix) => {
      const items = ["list", "add", "use", "remove"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (argument, ctx: ExtensionCommandContext) => {
      const [action = "list", provider, label] = argument.trim().split(/\s+/).filter(Boolean);
      try {
        switch (action) {
          case "list":
            ctx.ui.notify(await listAccounts(ctx), "info");
            return;
          case "add": {
            if (!provider || !label) {
              ctx.ui.notify("Usage: /accounts add <provider> <label>  (for example: /accounts add openai-codex work)", "error");
              return;
            }
            if (!ctx.hasUI) {
              ctx.ui.notify("Adding an account needs Pi's interactive UI", "error");
              return;
            }
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), LOGIN_TIMEOUT_MS);
            timeout.unref?.();
            try {
              ctx.ui.notify(`Signing in another ${provider} account as ${label}; use the other account in the browser`, "info");
              const added = await accounts().add(provider, label, loginInteraction(ctx, controller.signal));
              pi.events?.emit(ACCOUNTS_CHANGED_EVENT, undefined);
              const identity = accountIdentity(added.credential);
              const summary = await accounts().summary(provider);
              let duplicate: string | undefined;
              if (identity) {
                for (const slot of summary.slots) {
                  if (slot.label === added.label) continue;
                  const other = await accounts().readCredential(provider, slot.label);
                  if (accountIdentity(other) === identity) duplicate = slot.label;
                }
              }
              ctx.ui.notify(
                duplicate
                  ? `quota-router: ${provider} account ${added.label} is the same login as ${duplicate}; remove one with /accounts remove`
                  : `quota-router: ${provider} account ${added.label} signed in and parked; it is used when the active account hits its limit`,
                duplicate ? "warning" : "info",
              );
            } finally {
              clearTimeout(timeout);
            }
            return;
          }
          case "use": {
            if (!provider || !label) {
              ctx.ui.notify("Usage: /accounts use <provider> <label>", "error");
              return;
            }
            if (!ctx.isIdle()) {
              ctx.ui.notify("Wait for the current response to finish before switching accounts", "warning");
              return;
            }
            const activation = await accounts().activate(provider, label, { preferred: null });
            clearTimer();
            updateStatus(ctx);
            ctx.ui.notify(
              activation
                ? `quota-router: ${provider} now uses account ${activation.to}${activation.from ? ` (${activation.from} parked)` : ""}`
                : `quota-router: ${provider} already uses account ${label}`,
              "info",
            );
            return;
          }
          case "remove": {
            if (!provider || !label) {
              ctx.ui.notify("Usage: /accounts remove <provider> <label>", "error");
              return;
            }
            await accounts().remove(provider, label);
            updateStatus(ctx);
            ctx.ui.notify(`quota-router: removed parked ${provider} account ${label}`, "info");
            return;
          }
          default:
            ctx.ui.notify("Usage: /accounts [list|add|use|remove] <provider> <label>", "error");
        }
      } catch (error) {
        ctx.ui.notify(`quota-router: ${describe(error)}`, "error");
      }
    },
  });

  pi.registerCommand("route", {
    description: "Same-provider account fallback: /route [status|on|off|back|forget]",
    getArgumentCompletions: (prefix) => {
      const items = ["status", "on", "off", "back", "forget"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (argument, ctx: ExtensionCommandContext) => {
      const action = argument.trim().toLowerCase() || "status";
      try {
        switch (action) {
          case "on":
          case "off": {
            enabled = action === "on";
            if (!enabled) clearTimer();
            else armReturn(ctx);
            updateStatus(ctx);
            ctx.ui.notify(`quota-router ${enabled ? "enabled" : "disabled"} for this session`, "info");
            return;
          }
          case "forget": {
            accounts().clearCooldowns();
            clearTimer();
            updateStatus(ctx);
            ctx.ui.notify("quota-router: cleared account cooldowns", "info");
            return;
          }
          case "back": {
            const provider = ctx.model?.provider;
            const preferred = provider ? accounts().preferredLabel(provider) : undefined;
            if (!provider || !preferred) {
              ctx.ui.notify("quota-router: the current provider is already on your chosen account", "info");
              return;
            }
            if (!ctx.isIdle()) {
              ctx.ui.notify("Wait for the current response to finish before returning", "warning");
              return;
            }
            const activation = await accounts().activate(provider, preferred, { preferred: null });
            clearTimer();
            updateStatus(ctx);
            ctx.ui.notify(`quota-router: ${provider} back on account ${activation?.to ?? preferred}`, "info");
            return;
          }
          case "status": {
            const lines = [`quota-router ${enabled ? "on" : "off"}; auto-return ${config.returnToPreferred ? "on" : "off"}`];
            lines.push(await listAccounts(ctx));
            ctx.ui.notify(lines.join("\n"), "info");
            return;
          }
          default:
            ctx.ui.notify("Usage: /route [status|on|off|back|forget]", "error");
        }
      } catch (error) {
        ctx.ui.notify(`quota-router: ${describe(error)}`, "error");
      }
    },
  });
}

export default function quotaRouter(pi: ExtensionAPI): void {
  registerQuotaRouter(pi);
}
