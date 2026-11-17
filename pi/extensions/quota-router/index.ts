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
  reason: string;
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
  let requestAccount: { provider: string; label: string } | undefined;
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

  /** Always identify the active subscription, including while it is the main account. */
  function statusText(ctx: ExtensionContext): string | undefined {
    if (!enabled) return "route:off";
    const provider = ctx.model?.provider;
    if (!provider || !accounts().supportsLogin(provider) || !ctx.modelRegistry.isUsingOAuth(ctx.model!)) return undefined;
    const preferred = accounts().preferredLabel(provider);
    return `${ctx.ui.theme.fg("dim", "· ")}@${accounts().activeLabel(provider)}${preferred ? ` (main: ${preferred})` : ""}`;
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
      let at = cooldown && cooldown.until > now() ? cooldown.until : now();
      // If every tried account is cooling down, wake for the first recovery,
      // not just a main account whose weekly reset might be much further away.
      const activeCooldown = state.cooldowns[parkedKey(provider, entry.active)];
      if (activeCooldown && activeCooldown.until > now()) {
        for (const [key, limit] of Object.entries(state.cooldowns)) {
          if (key.startsWith(`${provider}@`) && limit.until > now()) at = Math.min(at, limit.until);
        }
      }
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
      const activeCooldown = state.cooldowns[parkedKey(provider, entry.active)];
      return !cooldown || cooldown.until <= now() || !!(activeCooldown && activeCooldown.until > now());
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
          const mainReady = !accounts().cooldown(provider, entry.preferred!);
          const target = mainReady ? entry.preferred : await accounts().next(provider);
          if (!target) continue;
          const activation = await accounts().activate(provider, target, mainReady
            ? { preferred: null, returnToMain: true }
            : { fallbackFrom: entry.active });
          if (activation) {
            ctx.ui.notify(mainReady
              ? `quota-router: ${provider} cooldown passed; back on account ${activation.to}`
              : `quota-router: ${provider} account ${activation.to} recovered; using it while main ${entry.preferred} resets`, "info");
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
    requestAccount = undefined;
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

  // Remember the account at the request boundary, not when a slow error arrives.
  // A different tab may have selected another account while this one was running.
  pi.on("turn_start", (_event, ctx) => {
    const provider = ctx.model?.provider;
    requestAccount = provider ? { provider, label: accounts().activeLabel(provider) } : undefined;
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
      from = requestAccount?.provider === provider ? requestAccount.label : accounts().activeLabel(provider);
      if (await accounts().recordLimit(provider, from, until, signal.reason)) {
        to = await accounts().next(provider);
      } else {
        // Reuse another tab's eligible selection; never penalise or overwrite it.
        const current = accounts().activeLabel(provider);
        if (!accounts().cooldown(provider, current)) to = current;
      }
    } catch (error) {
      noRouteReason = `account state unavailable: ${describe(error)}`;
      return;
    }
    if (!to) {
      noRouteReason = `${signal.reason} reached; no other signed-in ${provider} account is available (/accounts add ${provider} <label>)`;
      return;
    }

    plan = { provider, from, to, reason: signal.reason, retryable: isRetryableByPi(event.message.errorMessage), until };
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
          ctx.ui.notify(`quota-router: ${provider} ${noRouteReason}`, "warning");
        }
        noRouteReason = undefined;
        updateStatus(ctx);
        armReturn(ctx);
      }
      return;
    }

    let activation: Activation | undefined;
    try {
      activation = await accounts().activate(current.provider, current.to, { fallbackFrom: current.from });
    } catch (error) {
      ctx.ui.notify(`quota-router: could not switch ${current.provider} to account ${current.to}: ${describe(error)}`, "error");
      return;
    }
    if (!activation && accounts().activeLabel(current.provider) === current.from) {
      ctx.ui.notify(`quota-router: account ${current.to} is no longer available; use /accounts to choose another login`, "warning");
      updateStatus(ctx);
      armReturn(ctx);
      return;
    }
    const wait = formatDuration(current.until - now());
    ctx.ui.notify(
      activation
        ? `quota-router: ${current.provider} account ${current.from} ${current.reason} (retry after ~${wait}, ${formatClock(current.until)}); switched to account ${current.to}`
        : `quota-router: ${current.provider} already switched to account ${accounts().activeLabel(current.provider)} by another session`,
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

  pi.on("agent_start", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    await tryReturn(ctx);
    updateStatus(ctx);
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
      const preferred = accounts().preferredLabel(provider) ?? summary.active;
      const slots = summary.slots.map((slot) => {
        const flags = [slot.active ? "active" : "parked"];
        if (slot.cooldown) flags.push(`limit until ${formatClock(slot.cooldown.until)}`);
        if (preferred === slot.label) flags.push("main");
        return `${slot.label} (${flags.join(", ")})`;
      });
      lines.push(`${provider}: ${slots.join(", ")}`);
    }
    return lines.join("\n");
  }

  function providerName(provider: string): string {
    return provider === "anthropic" ? "Claude" : provider === "openai-codex" ? "ChatGPT / Codex" : provider;
  }

  function loginProviders(ctx: ExtensionContext): string[] {
    const ids = new Set((ctx.modelRegistry.getAll?.() ?? []).map((model) => model.provider));
    if (ctx.model) ids.add(ctx.model.provider);
    return [...ids].filter((provider) => accounts().supportsLogin(provider)).sort();
  }

  async function pickAccount(ctx: ExtensionCommandContext, provider?: string, parkedOnly = false, manage = false) {
    const providers = new Set(await accounts().providers());
    if (ctx.model) providers.add(ctx.model.provider);
    const rows: Array<{ text: string; provider: string; label: string }> = [];
    const ordered = [...providers].sort((a, b) => Number(b === ctx.model?.provider) - Number(a === ctx.model?.provider) || a.localeCompare(b));
    for (const id of ordered) {
      if (provider && id !== provider) continue;
      const summary = await accounts().summary(id);
      const main = accounts().preferredLabel(id) ?? summary.active;
      for (const slot of summary.slots) {
        if (parkedOnly && slot.active) continue;
        const flags = [slot.active ? "using now" : "saved"];
        if (slot.label === main) flags.push("main");
        flags.push(slot.cooldown ? `wait ${formatDuration(slot.cooldown.until - now())}, until ${formatClock(slot.cooldown.until)}` : "ready");
        rows.push({ text: `${providerName(id)} · ${slot.label} — ${flags.join(" · ")}`, provider: id, label: slot.label });
      }
    }
    const management = "Manage accounts…";
    if (!rows.length && !manage) {
      ctx.ui.notify(parkedOnly ? "No saved inactive accounts to remove." : "No accounts saved yet. Use /accounts add to sign in.", "info");
      return;
    }
    const choice = await ctx.ui.select(
      parkedOnly ? "Remove a saved account" : "Choose main account · applies to every Pi tab",
      [...rows.map((row) => row.text), ...(manage ? [management] : [])],
    );
    if (choice === management) {
      const switching = `Automatic switching: ${enabled ? "on" : "off"} (this tab)`;
      const autoReturn = `Return to main: ${config.returnToPreferred ? "on" : "off"} (this tab)`;
      const actions = ["Add account", "Choose main account", "Switch now (ignore cooldown)", "Remove saved account", "List accounts", switching, autoReturn];
      const action = await ctx.ui.select("Manage accounts", actions);
      if (action === switching || action === autoReturn) {
        if (action === switching) enabled = !enabled;
        else config = { ...config, returnToPreferred: !config.returnToPreferred };
        updateStatus(ctx);
        armReturn(ctx);
        ctx.ui.notify(`Automatic switching ${enabled ? "on" : "off"}; return to main ${config.returnToPreferred ? "on" : "off"}. These toggles reset on reload.`, "info");
      } else if (action) {
        const commands = ["add", "main", "use", "remove", "list"];
        await handleAccounts(commands[actions.indexOf(action)] ?? "list", ctx);
      }
      return;
    }
    return rows.find((row) => row.text === choice);
  }

  async function handleAccounts(argument: string, ctx: ExtensionCommandContext): Promise<void> {
    let [action = "pick", provider, label] = argument.trim().split(/\s+/).filter(Boolean);
    try {
      if (["main", "use", "remove"].includes(action) && provider && !label && !accounts().supportsLogin(provider)) {
        label = provider;
        provider = ctx.model?.provider;
      }
      if (action === "pick" || (["main", "use", "remove"].includes(action) && !label)) {
        if (!ctx.hasUI) {
          ctx.ui.notify(await listAccounts(ctx), "info");
          return;
        }
        const picked = await pickAccount(ctx, provider, action === "remove", action === "pick");
        if (!picked) return;
        provider = picked.provider;
        label = picked.label;
        if (action === "pick") action = "main";
        if (action === "remove" && !(await ctx.ui.confirm("Remove saved account?", `${providerName(provider)} · ${label}. You will need to sign in again to restore it.`))) return;
      }
      if (action === "add" && ctx.hasUI) {
        if (!provider) {
          const providers = loginProviders(ctx);
          if (!providers.length) {
            ctx.ui.notify("No supported subscription provider is available. Use Pi's /login first.", "info");
            return;
          }
          const choice = await ctx.ui.select("Sign in another account", providers.map(providerName));
          if (!choice) return;
          provider = providers.find((id) => providerName(id) === choice);
        }
        if (!label) {
          label = await ctx.ui.input("Name this account (letters, digits, dashes)", "work");
          if (label === undefined) return;
        }
      }
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
        case "main":
        case "use": {
          if (!provider || !label) {
            ctx.ui.notify("Usage: /accounts main|use [provider] <label>", "error");
            return;
          }
          if (!ctx.isIdle()) {
            ctx.ui.notify("Wait for the current response to finish before switching accounts", "warning");
            return;
          }
          const activation = await accounts().activate(provider, label, { preferred: null, whenReady: action === "main" });
          updateStatus(ctx);
          armReturn(ctx);
          const preferred = accounts().preferredLabel(provider);
          const cooldown = preferred ? accounts().cooldown(provider, preferred) : undefined;
          ctx.ui.notify(
            action === "main" && preferred
              ? `${providerName(provider)}: ${preferred} is now main. Staying on ${accounts().activeLabel(provider)}${cooldown ? ` until its limit resets at ${formatClock(cooldown.until)}` : " for now"}.${!enabled || !config.returnToPreferred ? " Auto-return is off; /route back switches now." : ""}`
              : activation
                ? `quota-router: ${provider} now uses account ${activation.to}${activation.from ? ` (${activation.from} parked)` : ""}; main account updated`
                : `quota-router: ${provider} already uses account ${label}; it is now main`,
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
          ctx.ui.notify("Usage: /accounts [list|add|main|use|remove] [provider] [label]", "error");
      }
    } catch (error) {
      const message = describe(error);
      ctx.ui.notify(`quota-router: ${message}`, /Login cancelled|AbortError|aborted/i.test(message) ? "info" : "error");
    }
  }

  pi.registerCommand("accounts", {
    description: "Choose or manage signed-in accounts; /accounts main [provider] <label> changes main",
    getArgumentCompletions: async (prefix) => {
      try {
        const values = ["list", "add", "main", "use", "remove"];
        const providers = new Set(await accounts().providers());
        if (statusContext) for (const provider of loginProviders(statusContext)) providers.add(provider);
        for (const provider of providers) {
          values.push(`add ${provider}`);
          const { slots } = await accounts().summary(provider);
          for (const action of ["main", "use", "remove"]) {
            values.push(`${action} ${provider}`);
            for (const slot of slots) {
              if (action === "remove" && slot.active) continue;
              values.push(`${action} ${provider} ${slot.label}`);
              if (provider === statusContext?.model?.provider) values.push(`${action} ${slot.label}`);
            }
          }
        }
        const items = values.filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value }));
        return items.length ? items : null;
      } catch {
        // A temporarily unavailable store should not turn typing into error spam.
        return null;
      }
    },
    handler: handleAccounts,
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
