import { isRetryableAssistantError } from "@earendil-works/pi-ai";

export const DEFAULT_COOLDOWN_MS = 30 * 60_000;
export const MIN_COOLDOWN_MS = 60_000;
export const MAX_COOLDOWN_MS = 7 * 24 * 60 * 60_000;

export interface RouterConfig {
  /** Cooldown applied when a provider reports no reset time. */
  cooldownMs: number;
  /** Switch back to the account the user had once its cooldown has passed. */
  returnToPreferred: boolean;
}

export const DEFAULT_CONFIG: RouterConfig = {
  cooldownMs: DEFAULT_COOLDOWN_MS,
  returnToPreferred: true,
};

/** Parse `quota-router.json`. Invalid fields fall back to defaults and are reported as warnings. */
export function parseConfig(text: string | undefined): { config: RouterConfig; warnings: string[] } {
  const warnings: string[] = [];
  const config: RouterConfig = { ...DEFAULT_CONFIG };
  if (text === undefined || text.trim() === "") return { config, warnings };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    warnings.push(`quota-router.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return { config, warnings };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warnings.push("quota-router.json must contain a JSON object");
    return { config, warnings };
  }
  const record = parsed as Record<string, unknown>;
  if (record.cooldownMinutes !== undefined) {
    const minutes = record.cooldownMinutes;
    if (typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0) {
      config.cooldownMs = Math.min(MAX_COOLDOWN_MS, minutes * 60_000);
    } else {
      warnings.push("cooldownMinutes must be a positive number");
    }
  }
  if (record.returnToPreferred !== undefined) {
    if (typeof record.returnToPreferred === "boolean") config.returnToPreferred = record.returnToPreferred;
    else warnings.push("returnToPreferred must be true or false");
  }
  return { config, warnings };
}

export interface LimitSignal {
  /** Absolute epoch milliseconds when the provider expects to accept requests again, if reported. */
  resetAt?: number;
  /** Quota/billing exhaustion rather than a throttle: applies even to API-key providers. */
  hard: boolean;
  reason: string;
}

// Context overflow is handled by Pi's compaction and must never be treated as a quota signal.
const OVERFLOW_PATTERN =
  /context (?:window|length)|too long|maximum (?:context|input)|input tokens exceed|context_length_exceeded/i;

// Subscription/account exhaustion. Mirrors pi-ai's non-retryable provider limit wording
// plus the Codex and Anthropic subscription messages seen through Pi.
const HARD_LIMIT_PATTERN =
  /usage_limit_reached|usage_not_included|ChatGPT usage limit|GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i;

// Throttling that, for a subscription login, means the five-hour or weekly window is used up.
const SOFT_LIMIT_PATTERN =
  /rate_limit_error|rate_limit_exceeded|rate.?limit|too many requests|usage limit|\b429\b/i;

function parseMinutes(message: string): number | undefined {
  const match = message.match(/(?:try again|resets?|retry)[^.\n]*?~?\s*(\d+(?:\.\d+)?)\s*min/i);
  if (!match) return undefined;
  const minutes = Number(match[1]);
  return Number.isFinite(minutes) ? minutes : undefined;
}

/** Classify a finalized assistant error message. */
export function classifyError(errorMessage: string | undefined, now: number): LimitSignal | undefined {
  if (!errorMessage) return undefined;
  if (OVERFLOW_PATTERN.test(errorMessage)) return undefined;
  const hard = HARD_LIMIT_PATTERN.test(errorMessage);
  if (!hard && !SOFT_LIMIT_PATTERN.test(errorMessage)) return undefined;
  const minutes = parseMinutes(errorMessage);
  const signal: LimitSignal = { hard, reason: hard ? "usage limit" : "rate limit" };
  if (minutes !== undefined) signal.resetAt = now + minutes * 60_000;
  return signal;
}

function parseEpoch(value: string | undefined, now: number): number | undefined {
  if (value === undefined) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 1e12 ? numeric : numeric * 1000;
    return ms > now ? ms : undefined;
  }
  const date = Date.parse(value);
  return Number.isFinite(date) && date > now ? date : undefined;
}

function parseSeconds(value: string | undefined, now: number): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) return now + seconds * 1000;
  return parseEpoch(value, now);
}

/**
 * Classify a provider HTTP response. Only 429 is a limit signal; reset hints come from
 * `retry-after`, Anthropic's unified rate-limit reset and Codex window headers.
 */
export function classifyResponse(
  status: number,
  headers: Record<string, string | null | undefined>,
  now: number,
): LimitSignal | undefined {
  if (status !== 429) return undefined;
  const lower = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") lower.set(key.toLowerCase(), value);
  }
  const candidates: number[] = [];
  const unified = parseEpoch(lower.get("anthropic-ratelimit-unified-reset"), now);
  if (unified !== undefined) candidates.push(unified);
  const codexWindows: Array<{ resetAt: number; exhausted: boolean }> = [];
  for (const window of ["primary", "secondary"]) {
    const resetAt =
      parseSeconds(lower.get(`x-codex-${window}-reset-after-seconds`), now) ??
      parseEpoch(lower.get(`x-codex-${window}-resets-at`) ?? lower.get(`x-codex-${window}-reset-at`), now);
    if (resetAt === undefined) continue;
    const used = Number(lower.get(`x-codex-${window}-used-percent`));
    codexWindows.push({ resetAt, exhausted: Number.isFinite(used) && used >= 100 });
  }
  const exhaustedWindows = codexWindows.filter((window) => window.exhausted);
  if (exhaustedWindows.length > 0) candidates.push(Math.max(...exhaustedWindows.map((window) => window.resetAt)));
  else if (codexWindows.length > 0) candidates.push(Math.min(...codexWindows.map((window) => window.resetAt)));
  const retryAfter = parseSeconds(lower.get("retry-after"), now);
  if (retryAfter !== undefined) candidates.push(retryAfter);
  const signal: LimitSignal = { hard: false, reason: "HTTP 429" };
  if (candidates.length > 0) signal.resetAt = candidates[0];
  return signal;
}

/** Bound a reported or defaulted reset time so the router neither flaps nor waits for days. */
export function clampReset(resetAt: number | undefined, now: number, cooldownMs: number): number {
  const target = resetAt ?? now + cooldownMs;
  return Math.min(now + MAX_COOLDOWN_MS, Math.max(now + MIN_COOLDOWN_MS, target));
}

const ANNOTATION_PREFIX = "[quota-router: subscription rate limit; retrying on account ";

type RetryProbe = Parameters<typeof isRetryableAssistantError>[0];

/** pi-ai's policy reads only stopReason and errorMessage; a minimal probe avoids fabricating usage/model fields. */
function retryProbe(errorMessage: string): RetryProbe {
  return { role: "assistant", content: [], stopReason: "error", errorMessage } as unknown as RetryProbe;
}

/**
 * Pi only auto-retries errors matching pi-ai's transient patterns, and the Codex usage-limit
 * text does not. Append a bounded note that makes the same retry policy continue the turn on
 * the next account. Returns undefined when Pi would still refuse (for example billing wording).
 */
export function annotateForRetry(errorMessage: string, label: string): string | undefined {
  if (errorMessage.includes(ANNOTATION_PREFIX)) return undefined;
  const annotated = `${errorMessage.trimEnd()} ${ANNOTATION_PREFIX}${label}]`;
  return isRetryableAssistantError(retryProbe(annotated)) ? annotated : undefined;
}

export function isRetryableByPi(errorMessage: string | undefined): boolean {
  return errorMessage ? isRetryableAssistantError(retryProbe(errorMessage)) : false;
}

export function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
}
