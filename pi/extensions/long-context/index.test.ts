import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import longContextExtension, {
  LONG_CONTEXT_WINDOW,
  SHORT_CONTEXT_WINDOW,
  isLongContextEnabled,
  supportsLongContext,
} from "./index";

type RegisteredCommand = {
  handler: (argument: string, ctx: any) => Promise<void>;
};

type Model = {
  provider: string;
  id: string;
  contextWindow: number;
};

function createHarness(initialModel: Model, idle = true) {
  let model = initialModel;
  let command: RegisteredCommand | undefined;
  const notifications: Array<{ message: string; type: string }> = [];
  const statuses: Array<string | undefined> = [];

  const pi = {
    registerCommand(_name: string, value: RegisteredCommand) {
      command = value;
    },
    on() {},
    async setModel(nextModel: Model) {
      model = nextModel;
      return true;
    },
  } as unknown as ExtensionAPI;

  longContextExtension(pi);

  const ctx = {
    get model() {
      return model;
    },
    isIdle: () => idle,
    ui: {
      notify(message: string, type: string) {
        notifications.push({ message, type });
      },
      setStatus(_key: string, value: string | undefined) {
        statuses.push(value);
      },
    },
  };

  return {
    get model() {
      return model;
    },
    notifications,
    statuses,
    run: async (argument = "") => {
      if (!command) throw new Error("command was not registered");
      await command.handler(argument, ctx);
    },
  };
}

const sol: Model = {
  provider: "openai-codex",
  id: "gpt-5.6-sol",
  contextWindow: SHORT_CONTEXT_WINDOW,
};

const toggleCases = [
  ["openai-codex", "gpt-5.6-sol"],
  ["openai-codex", "gpt-6-astra"],
  ["openai", "gpt-6-astra"],
];

describe("long-context extension", () => {
  test("recognizes only supported OpenAI GPT-5.6 variants and GPT-6 Astra", () => {
    for (const provider of ["openai", "openai-codex"]) {
      for (const id of ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra"]) {
        expect(supportsLongContext({ ...sol, provider, id })).toBe(true);
      }
      expect(supportsLongContext({ ...sol, provider, id: "gpt-4o" })).toBe(false);
    }
    expect(supportsLongContext({ ...sol, provider: "openrouter", id: "gpt-6-astra" })).toBe(false);
  });

  test.each(toggleCases)("toggles %s/%s between short and long windows", async (provider, id) => {
    const harness = createHarness({ ...sol, provider, id });

    await harness.run();
    expect(harness.model.contextWindow).toBe(LONG_CONTEXT_WINDOW);
    expect(isLongContextEnabled(harness.model)).toBe(true);
    expect(harness.statuses.at(-1)).toBe("ctx:1.05M");
    expect(harness.notifications.at(-1)?.type).toBe("warning");

    await harness.run();
    expect(harness.model.contextWindow).toBe(SHORT_CONTEXT_WINDOW);
    expect(harness.statuses.at(-1)).toBeUndefined();
    expect(harness.notifications.at(-1)?.type).toBe("info");
  });

  test.each(toggleCases)("supports explicit mode and status for %s/%s", async (provider, id) => {
    const harness = createHarness({ ...sol, provider, id });

    await harness.run("on");
    await harness.run("status");
    expect(harness.model.contextWindow).toBe(LONG_CONTEXT_WINDOW);
    expect(harness.notifications.at(-1)?.message).toContain("1.05M (long)");

    await harness.run("off");
    expect(harness.model.contextWindow).toBe(SHORT_CONTEXT_WINDOW);
  });

  test("does not switch unsupported models or switch during a response", async () => {
    const unsupported = createHarness({ ...sol, id: "gpt-4o" });
    await unsupported.run("on");
    expect(unsupported.model.contextWindow).toBe(SHORT_CONTEXT_WINDOW);
    expect(unsupported.notifications.at(-1)?.type).toBe("warning");

    const busy = createHarness({ ...sol, id: "gpt-6-astra" }, false);
    await busy.run("on");
    expect(busy.model.contextWindow).toBe(SHORT_CONTEXT_WINDOW);
    expect(busy.notifications.at(-1)?.message).toContain("current response");
  });

  test("preserves Astra's identity and provider metadata in both modes", async () => {
    const astra = {
      ...sol,
      id: "gpt-6-astra",
      api: "openai-codex-responses",
      maxTokens: 128_000,
      thinkingLevelMap: { off: null, xhigh: "xhigh", max: "max" },
      compat: { supportsToolSearch: true },
      cost: {
        input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5,
        tiers: [{ inputTokensAbove: 272_000, input: 20, output: 75, cacheRead: 2, cacheWrite: 25 }],
      },
    };
    const original = structuredClone(astra);
    const harness = createHarness(astra);

    await harness.run("on");
    expect(harness.model).toEqual({ ...original, contextWindow: LONG_CONTEXT_WINDOW });
    expect(harness.notifications.at(-1)?.message).toContain("requests above 272K may use long-context pricing");
    expect(astra).toEqual(original);

    await harness.run("off");
    expect(harness.model).toEqual(original);
  });

  test("reports invalid arguments", async () => {
    const harness = createHarness(sol);
    await harness.run("maybe");
    expect(harness.notifications.at(-1)).toEqual({
      message: "Usage: /long-context [on|off|status]",
      type: "error",
    });
  });
});
