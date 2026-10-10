import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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

export function formatTps(tps: number): string {
  const value = tps >= 10 ? Math.round(tps) : Math.round(tps * 10) / 10;
  return `${value} tok/s`;
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

export function registerTokenSpeed(pi: ExtensionAPI): void {
  let responses: TimedResponse[] = [];

  const publish = (ctx: ExtensionContext, text: string | undefined) => {
    if (ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, text);
  };

  // Pi stores usage and a monotonic duration on every finished assistant
  // message, so rebuild from the branch instead of tracking stream deltas.
  // Resumed sessions and /reload then report the same numbers, and nothing is
  // written to the session or sent to the model.
  const refresh = (ctx: ExtensionContext) => {
    responses = sessionResponses(ctx);
    const last = responses[responses.length - 1];
    publish(ctx, last ? formatTps(tokensPerSecond(last)) : undefined);
  };

  pi.on("session_start", (_event, ctx) => refresh(ctx));
  pi.on("agent_end", (_event, ctx) => refresh(ctx));
  pi.on("session_shutdown", (_event, ctx) => {
    responses = [];
    publish(ctx, undefined);
  });

  pi.registerCommand("tps", {
    description: "Show output tokens per second for this session",
    handler: async (_argument, ctx) => {
      refresh(ctx);
      ctx.ui.notify(summaryText(responses), "info");
    },
  });
}

export default function tokenSpeed(pi: ExtensionAPI): void {
  registerTokenSpeed(pi);
}