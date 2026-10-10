import { describe, expect, test } from "bun:test";
import tokenSpeed, {
  STATUS_KEY,
  formatTps,
  registerTokenSpeed,
  summarize,
  summaryText,
  timedResponse,
  tokensPerSecond,
} from "./index";

const PROVIDER = "lithosai";
const MODEL = "deepseek-ai/DeepSeek-V4.1-Flash";

function source(output: number, durationMs: number, provider = PROVIDER, model = MODEL) {
  return { role: "assistant", provider, model, usage: { output }, durationMs };
}

function timed(output: number, durationMs: number, provider = PROVIDER, model = MODEL) {
  return { provider, model, output, durationMs };
}

describe("timed replies", () => {
  test("accepts only assistant messages with usage and a duration", () => {
    expect(timedResponse(source(850, 10_000))).toEqual({
      provider: PROVIDER,
      model: MODEL,
      output: 850,
      durationMs: 10_000,
    });
    expect(timedResponse({ role: "user", usage: { output: 10 }, durationMs: 1 })).toBeUndefined();
    expect(timedResponse({ role: "assistant", usage: { output: 10 } })).toBeUndefined();
    expect(timedResponse({ role: "assistant", durationMs: 1_000 })).toBeUndefined();
  });

  test.each([
    { role: "assistant", usage: { output: 0 }, durationMs: 1_000 },
    { role: "assistant", usage: { output: -5 }, durationMs: 1_000 },
    { role: "assistant", usage: { output: 10 }, durationMs: 0 },
    { role: "assistant", usage: { output: 10 }, durationMs: Number.NaN },
    { role: "assistant", usage: { output: Number.POSITIVE_INFINITY }, durationMs: 1_000 },
    { role: "assistant", usage: { output: 10 }, durationMs: Number.POSITIVE_INFINITY },
  ])("skips untimed or empty reply %#", (message) => {
    expect(timedResponse(message)).toBeUndefined();
  });

  test("falls back to unknown provider and model", () => {
    expect(timedResponse({ role: "assistant", usage: { output: 1 }, durationMs: 1_000 })).toMatchObject({
      provider: "unknown",
      model: "unknown",
    });
  });

  test("reports tokens per second and formats small and large rates", () => {
    expect(tokensPerSecond({ output: 850, durationMs: 10_000 })).toBeCloseTo(85);
    expect(formatTps(85.4)).toBe("85 tok/s");
    expect(formatTps(8.46)).toBe("8.5 tok/s");
    expect(formatTps(1.234)).toBe("1.2 tok/s");
  });
});

describe("session summary", () => {
  const responses = [
    timed(100, 2_000, PROVIDER, MODEL), // 50 tok/s
    timed(300, 2_000, "anthropic", "claude-opus-5-5"), // 150 tok/s
    timed(100, 6_000, PROVIDER, MODEL), // 16.7 tok/s
  ];

  test("weights totals by tokens and time", () => {
    const summary = summarize(responses);
    expect(summary.responses).toBe(3);
    expect(summary.output).toBe(500);
    expect(summary.durationMs).toBe(10_000);
    expect(summary.tps).toBeCloseTo(50);
  });

  test("groups by model, biggest first", () => {
    const summary = summarize(responses);
    expect(summary.byModel.map((model) => `${model.provider}/${model.model}`)).toEqual([
      "anthropic/claude-opus-5-5",
      `${PROVIDER}/${MODEL}`,
    ]);
    expect(summary.byModel[1].responses).toBe(2);
    expect(summary.byModel[1].tps).toBeCloseTo(25);
  });

  test("describes the last and session-wide rates", () => {
    expect(summaryText([])).toBe("No timed replies in this session yet.");
    const text = summaryText(responses);
    expect(text).toContain("Last reply: 17 tok/s (100 output tokens in 6s");
    expect(text).toContain("Session: 50 tok/s over 3 replies");
    expect(text).toContain("anthropic/claude-opus-5-5: 150 tok/s over 1 reply");
  });

  test("omits the per-model list for a single model", () => {
    expect(summaryText([timed(100, 2_000)])).not.toContain("  ");
  });
});

describe("extension wiring", () => {
  type Handler = (event: unknown, ctx: unknown) => unknown;

  function context(mode = "tui") {
    const statuses: (string | undefined)[] = [];
    const notifications: string[] = [];
    const branch: { type: string; message: unknown }[] = [];
    const ctx = {
      mode,
      sessionManager: { getBranch: () => branch },
      ui: {
        setStatus: (_key: string, text: string | undefined) => statuses.push(text),
        notify: (text: string) => notifications.push(text),
      },
    };
    return { ctx, branch, statuses, notifications };
  }

  function load(register = registerTokenSpeed) {
    const handlers: Record<string, Handler> = {};
    let command: { description: string; handler: (argument: string, ctx: unknown) => unknown } | undefined;
    register({
      on: (name: string, handler: Handler) => {
        handlers[name] = handler;
      },
      registerCommand: (_name: string, definition: never) => {
        command = definition;
      },
    } as never);
    return { handlers, command: command! };
  }

  test("uses only lifecycle notifications, not message hooks", () => {
    const { handlers } = load(tokenSpeed);
    expect(Object.keys(handlers).sort()).toEqual(["agent_end", "session_shutdown", "session_start"]);
  });

  test("publishes the last reply's rate and rebuilds on agent_end", () => {
    const { handlers } = load();
    const { ctx, branch, statuses } = context();

    handlers.session_start({}, ctx);
    expect(statuses.at(-1)).toBeUndefined();

    branch.push({ type: "message", message: source(850, 10_000) });
    handlers.agent_end({ messages: [] }, ctx);
    expect(statuses.at(-1)).toBe("85 tok/s");

    branch.push({ type: "message", message: source(200, 2_000) });
    handlers.agent_end({ messages: [] }, ctx);
    expect(statuses.at(-1)).toBe("100 tok/s");
  });

  test("ignores untimed entries and non-message entries", () => {
    const { handlers } = load();
    const { ctx, branch, statuses } = context();
    branch.push({ type: "model_change", message: null });
    branch.push({ type: "message", message: { role: "assistant", usage: { output: 10 } } });
    handlers.session_start({}, ctx);
    expect(statuses.at(-1)).toBeUndefined();
  });

  test("leaves the footer alone outside the TUI", () => {
    const { handlers } = load();
    const { ctx, branch, statuses } = context("rpc");
    branch.push({ type: "message", message: source(850, 10_000) });
    handlers.session_start({}, ctx);
    handlers.agent_end({}, ctx);
    expect(statuses).toEqual([]);
  });

  test("answers /tps with the session summary and clears on shutdown", async () => {
    const { handlers, command } = load();
    const { ctx, branch, statuses, notifications } = context();
    expect(command.description).toContain("tokens per second");

    branch.push({ type: "message", message: source(850, 10_000) });
    branch.push({ type: "message", message: source(200, 2_000) });
    await command.handler("", ctx);
    expect(notifications.at(-1)).toContain("Last reply: 100 tok/s");
    expect(notifications.at(-1)).toContain("Session: 88 tok/s over 2 replies");

    handlers.session_shutdown({}, ctx);
    expect(statuses.at(-1)).toBeUndefined();
  });
});