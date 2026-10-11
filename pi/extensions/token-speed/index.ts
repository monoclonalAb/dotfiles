import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { THEME_APPLIED_EVENT } from "../theme-sync/events.ts";

/** One finished assistant reply and the timing Pi recorded for it. */
export interface TimedResponse {
  provider: string;
  model: string;
  /** Output tokens, including reasoning tokens when the provider breaks them out. */
  output: number;
  /** Wall time from request start to response end, including time to first token. */
  durationMs: number;
}

/** The parts of an assistant message or session entry this extension reads. */
export type SpeedSource = {
  role: string;
  provider?: string;
  model?: string;
  usage?: { output?: number };
  durationMs?: number;
};

export interface ModelSpeed {
  provider: string;
  model: string;
  responses: number;
  output: number;
  durationMs: number;
  tps: number;
}

export interface SpeedSummary {
  responses: number;
  output: number;
  durationMs: number;
  tps: number;
  byModel: ModelSpeed[];
}

/** Footer key; kept stable so each update replaces the previous status. */
export const STATUS_KEY = "token-speed";

/** Reads a persisted assistant message that carries both usage and a duration. */
export function timedResponse(message: SpeedSource): TimedResponse | undefined {
  if (message.role !== "assistant") return undefined;
  const output = message.usage?.output;
  const durationMs = message.durationMs;
  if (typeof output !== "number" || !Number.isFinite(output) || output <= 0) return undefined;
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) return undefined;
  return {
    provider: message.provider || "unknown",
    model: message.model || "unknown",
    output,
    durationMs,
  };
}

export function tokensPerSecond(response: Pick<TimedResponse, "output" | "durationMs">): number {
  return response.output / (response.durationMs / 1000);
}

/** The theme helpers a status string needs; keeps test doubles minimal. */
type StatusTheme = Pick<Theme, "bold" | "fg">;

/**
 * Bold number in the theme's code colour (teal in Catppuccin), so it does not
 * read as part of quota-footer's mauve percentages, then a dim unit. A live
 * estimate gets a dim "~" in front.
 */
export function formatTps(tps: number, theme?: StatusTheme, estimate = false): string {
  const value = tps >= 10 ? Math.round(tps) : Math.round(tps * 10) / 10;
  const rate = String(value);
  const prefix = estimate ? "~" : "";
  return theme
    ? `${prefix && theme.fg("dim", prefix)}${theme.fg("mdCode", theme.bold(rate))}${theme.fg("dim", " tok/s")}`
    : `${prefix}${rate} tok/s`;
}

/** Pi's own rough token estimate (see its compaction code): four characters per token. */
const CHARS_PER_TOKEN = 4;
/** Live footer updates at most this often, so the number stays readable. */
export const LIVE_INTERVAL_MS = 500;
const STREAMED_TYPES = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);

/** A reply that is still streaming. */
export interface LiveReply {
  /** Request start (Unix ms): the same starting point as Pi's final `durationMs`. */
  startedAt: number;
  /** Characters of text, thinking and tool-call arguments streamed so far. */
  chars: number;
  /** When the footer last showed this reply; unset before the first token. */
  shownAt?: number;
}

/** Estimated output tokens per second so far; undefined before the first token. */
export function liveTokensPerSecond(live: LiveReply, now: number): number | undefined {
  const elapsedMs = now - live.startedAt;
  if (live.chars <= 0 || elapsedMs <= 0) return undefined;
  return live.chars / CHARS_PER_TOKEN / (elapsedMs / 1000);
}

/** Characters a streaming update added; zero for start/end markers. */
export function streamedChars(update: { type: string; delta?: unknown }): number {
  return STREAMED_TYPES.has(update.type) && typeof update.delta === "string" ? update.delta.length : 0;
}

function formatDuration(durationMs: number): string {
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

function replyCount(count: number): string {
  return `${count} ${count === 1 ? "reply" : "replies"}`;
}

/** Totals across replies are weighted by tokens and time, not averaged per reply. */
export function summarize(responses: readonly TimedResponse[]): SpeedSummary {
  let output = 0;
  let durationMs = 0;
  const models = new Map<string, ModelSpeed>();
  for (const response of responses) {
    output += response.output;
    durationMs += response.durationMs;
    const key = `${response.provider}/${response.model}`;
    const model = models.get(key) ?? {
      provider: response.provider,
      model: response.model,
      responses: 0,
      output: 0,
      durationMs: 0,
      tps: 0,
    };
    model.responses += 1;
    model.output += response.output;
    model.durationMs += response.durationMs;
    models.set(key, model);
  }
  const byModel = [...models.values()].sort((a, b) => b.output - a.output);
  for (const model of byModel) model.tps = tokensPerSecond(model);
  return {
    responses: responses.length,
    output,
    durationMs,
    tps: tokensPerSecond({ output, durationMs }),
    byModel,
  };
}

export function summaryText(responses: readonly TimedResponse[]): string {
  if (responses.length === 0) return "No timed replies in this session yet.";
  const last = responses[responses.length - 1];
  const summary = summarize(responses);
  const lines = [
    `Last reply: ${formatTps(tokensPerSecond(last))} (${last.output.toLocaleString("en-US")} output tokens in ${formatDuration(last.durationMs)}, ${last.provider}/${last.model})`,
    `Session: ${formatTps(summary.tps)} over ${replyCount(summary.responses)} · ${summary.output.toLocaleString("en-US")} output tokens in ${formatDuration(summary.durationMs)}`,
  ];
  if (summary.byModel.length > 1) {
    for (const model of summary.byModel) {
      lines.push(`  ${model.provider}/${model.model}: ${formatTps(model.tps)} over ${replyCount(model.responses)}`);
    }
  }
  return lines.join("\n");
}

function sessionResponses(ctx: ExtensionContext): TimedResponse[] {
  const responses: TimedResponse[] = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const response = timedResponse(entry.message);
    if (response) responses.push(response);
  }
  return responses;
}

export interface TokenSpeedOptions {
  /** Clock for live estimates, in Unix milliseconds. */
  now?: () => number;
}

export function registerTokenSpeed(pi: ExtensionAPI, options: TokenSpeedOptions = {}): void {
  const now = options.now ?? Date.now;
  let responses: TimedResponse[] = [];
  let current: ExtensionContext | undefined;
  let live: LiveReply | undefined;

  const publish = (ctx: ExtensionContext, text: string | undefined) => {
    if (ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, text);
  };

  // The streaming estimate while a reply is in flight and has produced
  // tokens; otherwise the last finished reply's exact rate.
  const render = (ctx: ExtensionContext, at = now()) => {
    const theme = ctx.ui.theme;
    // Pi sorts footer statuses by key, so this one follows the quota
    // percentages; a dim bar like quota-footer's own keeps them apart.
    const footer = (text: string) => `${theme.fg("dim", "| ")}${text}`;
    const rate = live && liveTokensPerSecond(live, at);
    if (rate !== undefined) return publish(ctx, footer(formatTps(rate, theme, true)));
    const last = responses[responses.length - 1];
    publish(ctx, last ? footer(formatTps(tokensPerSecond(last), theme)) : undefined);
  };

  // Pi stores usage and a monotonic duration on every finished assistant
  // message, so exact rates are rebuilt from the branch. Resumed sessions and
  // /reload then report the same numbers, and nothing is written to the
  // session or sent to the model.
  const finish = (ctx: ExtensionContext) => {
    current = ctx;
    live = undefined;
    responses = sessionResponses(ctx);
    render(ctx);
  };

  pi.on("session_start", (_event, ctx) => finish(ctx));
  pi.on("agent_end", (_event, ctx) => finish(ctx));
  // Pi saves a reply before running its tools, so swap the estimate for the
  // exact rate while tools run between replies.
  pi.on("tool_execution_start", (_event, ctx) => {
    if (live) finish(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    current = undefined;
    live = undefined;
    responses = [];
    publish(ctx, undefined);
  });

  // Streaming notifications are read-only; they cannot change the message.
  // Until the first token the footer keeps the previous reply's rate.
  pi.on("message_start", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    current = ctx;
    const at = now();
    const started = event.message.timestamp;
    live = { startedAt: Number.isFinite(started) && started <= at ? started : at, chars: 0 };
  });
  pi.on("message_update", (event, ctx) => {
    if (!live) return;
    live.chars += streamedChars(event.assistantMessageEvent);
    const at = now();
    if (live.shownAt !== undefined && at - live.shownAt < LIVE_INTERVAL_MS) return;
    if (liveTokensPerSecond(live, at) === undefined) return;
    live.shownAt = at;
    render(ctx, at);
  });

  // Status text stores the palette's ANSI codes, so a flavour change has to
  // rebuild it; theme-sync announces each successful apply on the event bus.
  pi.events?.on(THEME_APPLIED_EVENT, () => {
    if (current) render(current);
  });

  pi.registerCommand("tps", {
    description: "Show output tokens per second for this session",
    handler: async (_argument, ctx) => {
      // Finished replies only; a reply still streaming keeps its live estimate.
      responses = sessionResponses(ctx);
      render(ctx);
      ctx.ui.notify(summaryText(responses), "info");
    },
  });
}

export default function tokenSpeed(pi: ExtensionAPI): void {
  registerTokenSpeed(pi);
}