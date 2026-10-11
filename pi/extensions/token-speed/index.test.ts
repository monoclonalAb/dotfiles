import { describe, expect, test } from "bun:test";
import tokenSpeed, {
  STATUS_KEY,
  formatTps,
  liveTokensPerSecond,
  registerTokenSpeed,
  streamedChars,
  type TokenSpeedOptions,
  summarize,
  summaryText,
  timedResponse,
  tokensPerSecond,
} from "./index";
import { THEME_APPLIED_EVENT } from "../theme-sync/events.ts";

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
    const marked = {
      fg: (color: string, text: string) => `<${color}>${text}</${color}>`,
      bold: (text: string) => `<b>${text}</b>`,
    };
    // Teal code colour, not quota-footer's mauve accent; a live estimate adds a dim "~".
    expect(formatTps(85.4, marked)).toBe("<mdCode><b>85</b></mdCode><dim> tok/s</dim>");
    expect(formatTps(85.4, marked, true)).toBe("<dim>~</dim><mdCode><b>85</b></mdCode><dim> tok/s</dim>");
    expect(formatTps(8.46, undefined, true)).toBe("~8.5 tok/s");
  });
});

describe("live estimate", () => {
  test("uses four characters per token from the request start", () => {
    expect(liveTokensPerSecond({ startedAt: 1_000, chars: 400 }, 3_000)).toBeCloseTo(50);
    expect(liveTokensPerSecond({ startedAt: 1_000, chars: 0 }, 3_000)).toBeUndefined();
    expect(liveTokensPerSecond({ startedAt: 1_000, chars: 40 }, 1_000)).toBeUndefined();
  });

  test("counts text, thinking and tool-call deltas only", () => {
    expect(streamedChars({ type: "text_delta", delta: "abcd" })).toBe(4);
    expect(streamedChars({ type: "thinking_delta", delta: "ab" })).toBe(2);
    expect(streamedChars({ type: "toolcall_delta", delta: "{\"a\"" })).toBe(4);
    expect(streamedChars({ type: "text_end", content: "abcd" } as never)).toBe(0);
    expect(streamedChars({ type: "text_start" })).toBe(0);
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

  // Footer text: a dim bar after the quota percentages, then the rate.
  const bar = (flavour: string) => `<${flavour}:dim>| </${flavour}:dim>`;
  const number = (rate: string, flavour: string) =>
    `<${flavour}:mdCode><b>${rate}</b></${flavour}:mdCode><${flavour}:dim> tok/s</${flavour}:dim>`;
  const themed = (rate: string, flavour = "latte") => bar(flavour) + number(rate, flavour);
  const estimated = (rate: string, flavour = "latte") =>
    `${bar(flavour)}<${flavour}:dim>~</${flavour}:dim>${number(rate, flavour)}`;

  function context(mode = "tui") {
    const statuses: (string | undefined)[] = [];
    const notifications: string[] = [];
    const branch: { type: string; message: unknown }[] = [];
    let flavour = "latte";
    const ctx = {
      mode,
      sessionManager: { getBranch: () => branch },
      ui: {
        get theme() {
          return {
            fg: (color: string, text: string) => `<${flavour}:${color}>${text}</${flavour}:${color}>`,
            bold: (text: string) => `<b>${text}</b>`,
          };
        },
        setStatus: (_key: string, text: string | undefined) => statuses.push(text),
        notify: (text: string) => notifications.push(text),
      },
    };
    return { ctx, branch, statuses, notifications, setFlavour: (next: string) => { flavour = next; } };
  }

  function load(register: typeof registerTokenSpeed = registerTokenSpeed, options?: TokenSpeedOptions) {
    const handlers: Record<string, Handler> = {};
    const listeners = new Map<string, ((data: unknown) => void)[]>();
    let command: { description: string; handler: (argument: string, ctx: unknown) => unknown } | undefined;
    register({
      on: (name: string, handler: Handler) => {
        handlers[name] = handler;
      },
      registerCommand: (_name: string, definition: never) => {
        command = definition;
      },
      events: {
        on: (channel: string, listener: (data: unknown) => void) => {
          listeners.set(channel, [...listeners.get(channel) ?? [], listener]);
          return () => {};
        },
      },
    } as never, options);
    const emit = (channel: string, data: unknown) => {
      for (const listener of listeners.get(channel) ?? []) listener(data);
    };
    return { handlers, command: command!, emit };
  }

  test("observes only read-only notifications, never hooks that can change messages", () => {
    const { handlers } = load(tokenSpeed);
    expect(Object.keys(handlers).sort()).toEqual([
      "agent_end",
      "message_start",
      "message_update",
      "session_shutdown",
      "session_start",
      "tool_execution_start",
    ]);
  });

  function streaming(clock: { now: number }) {
    const loaded = load(registerTokenSpeed, { now: () => clock.now });
    const update = (ctx: unknown, type: string, delta: string) =>
      loaded.handlers.message_update({ assistantMessageEvent: { type, delta } }, ctx);
    return { ...loaded, update };
  }

  test("streams a throttled live estimate, then the exact rate when the reply ends", () => {
    const clock = { now: 10_000 };
    const { handlers, update } = streaming(clock);
    const { ctx, branch, statuses } = context();
    branch.push({ type: "message", message: source(850, 10_000) });
    handlers.session_start({}, ctx);
    expect(statuses.at(-1)).toBe(themed("85"));

    handlers.message_start({ message: { role: "user", timestamp: 9_000 } }, ctx);
    update(ctx, "text_delta", "ignored: no assistant reply is streaming");
    handlers.message_start({ message: { role: "assistant", timestamp: 10_000 } }, ctx);
    clock.now = 10_500;
    update(ctx, "thinking_start", "");
    expect(statuses.at(-1)).toBe(themed("85")); // No token yet: keep the last reply.

    clock.now = 11_000;
    update(ctx, "thinking_delta", "x".repeat(200)); // 50 tokens in 1 s
    expect(statuses.at(-1)).toBe(estimated("50"));
    const shown = statuses.length;
    clock.now = 11_200;
    update(ctx, "text_delta", "x".repeat(200)); // Counted, but within the throttle window.
    expect(statuses).toHaveLength(shown);
    clock.now = 12_000;
    update(ctx, "toolcall_delta", "x".repeat(400)); // 800 chars = 200 tokens in 2 s
    expect(statuses.at(-1)).toBe(estimated("100"));

    branch.push({ type: "message", message: source(170, 2_000) });
    handlers.agent_end({ messages: [] }, ctx);
    expect(statuses.at(-1)).toBe(themed("85")); // Pi's exact usage replaces the estimate.
    clock.now = 13_000;
    update(ctx, "text_delta", "late");
    expect(statuses.at(-1)).toBe(themed("85"));
  });

  test("shows each finished reply's exact rate while its tools run", () => {
    const clock = { now: 20_000 };
    const { handlers, update } = streaming(clock);
    const { ctx, branch, statuses } = context();
    handlers.session_start({}, ctx);
    handlers.message_start({ message: { role: "assistant", timestamp: 20_000 } }, ctx);
    clock.now = 22_000;
    update(ctx, "toolcall_delta", "x".repeat(1_000));
    expect(statuses.at(-1)).toBe(estimated("125"));

    branch.push({ type: "message", message: source(300, 2_000) });
    handlers.tool_execution_start({}, ctx);
    expect(statuses.at(-1)).toBe(themed("150"));
    const shown = statuses.length;
    handlers.tool_execution_start({}, ctx); // A second tool in the same reply.
    expect(statuses).toHaveLength(shown);
  });

  test("falls back to the time it saw the reply start when the timestamp is unusable", () => {
    const clock = { now: 30_000 };
    const { handlers, update } = streaming(clock);
    const { ctx, statuses } = context();
    handlers.session_start({}, ctx);
    handlers.message_start({ message: { role: "assistant", timestamp: 99_000 } }, ctx);
    clock.now = 31_000;
    update(ctx, "text_delta", "x".repeat(40));
    expect(statuses.at(-1)).toBe(estimated("10"));
  });

  test("publishes the last reply's rate and rebuilds on agent_end", () => {
    const { handlers } = load();
    const { ctx, branch, statuses } = context();

    handlers.session_start({}, ctx);
    expect(statuses.at(-1)).toBeUndefined();

    branch.push({ type: "message", message: source(850, 10_000) });
    handlers.agent_end({ messages: [] }, ctx);
    expect(statuses.at(-1)).toBe(themed("85"));

    branch.push({ type: "message", message: source(200, 2_000) });
    handlers.agent_end({ messages: [] }, ctx);
    expect(statuses.at(-1)).toBe(themed("100"));
  });

  test("repaints the footer in the new palette when theme-sync applies a flavour", () => {
    const { handlers, emit } = load();
    const { ctx, branch, statuses, setFlavour } = context();
    branch.push({ type: "message", message: source(850, 10_000) });
    handlers.session_start({}, ctx);
    expect(statuses.at(-1)).toBe(themed("85", "latte"));

    setFlavour("mocha");
    emit(THEME_APPLIED_EVENT, undefined);
    expect(statuses.at(-1)).toBe(themed("85", "mocha"));

    // A streaming estimate repaints too.
    handlers.message_start({ message: { role: "assistant", timestamp: Date.now() - 1_000 } }, ctx);
    handlers.message_update({ assistantMessageEvent: { type: "text_delta", delta: "x".repeat(400) } }, ctx);
    expect(statuses.at(-1)).toMatch(/^<mocha:dim>\| <\/mocha:dim><mocha:dim>~<\/mocha:dim>/);
    setFlavour("macchiato");
    emit(THEME_APPLIED_EVENT, undefined);
    expect(statuses.at(-1)).toMatch(/^<macchiato:dim>\| <\/macchiato:dim><macchiato:dim>~<\/macchiato:dim><macchiato:mdCode>/);

    // A cleared session must not publish through a stale context.
    handlers.session_shutdown({}, ctx);
    const after = statuses.length;
    setFlavour("frappe");
    emit(THEME_APPLIED_EVENT, undefined);
    expect(statuses).toHaveLength(after);
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
    handlers.message_start({ message: { role: "assistant", timestamp: Date.now() - 1_000 } }, ctx);
    handlers.message_update({ assistantMessageEvent: { type: "text_delta", delta: "x".repeat(400) } }, ctx);
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