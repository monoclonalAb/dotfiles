import { describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import codexFastExtension, { supportsCodexFast } from "./index";

type Model = NonNullable<ExtensionContext["model"]>;
const codex = {
  provider: "openai-codex", api: "openai-codex-responses", id: "gpt-6-astra",
  contextWindow: 272_000, maxTokens: 128_000,
} as Model;

function harness(initialModel: Model | undefined = codex) {
  let model = initialModel;
  let idle = true;
  let command: any;
  const handlers = new Map<string, (event: any, ctx: any) => any>();
  const notifications: Array<{ message: string; type: string }> = [];
  const statuses = new Map<string, string | undefined>();
  // Deliberately expose no model/context/tool/persistence APIs.
  codexFastExtension({
    registerCommand(name: string, value: any) {
      expect(name).toBe("fast");
      command = value;
    },
    on(name: string, handler: any) { handlers.set(name, handler); },
  } as unknown as ExtensionAPI);
  const ctx = {
    get model() { return model; },
    hasUI: true,
    isIdle: () => idle,
    ui: {
      notify(message: string, type: string) { notifications.push({ message, type }); },
      setStatus(key: string, value: string | undefined) { statuses.set(key, value); },
    },
  };
  return {
    ctx, notifications, statuses, handlers,
    run: (args = "") => command.handler(args, ctx),
    completions: (prefix: string) => command.getArgumentCompletions(prefix),
    request: (payload: unknown) => handlers.get("before_provider_request")!({ payload }, ctx),
    start: (reason: string) => handlers.get("session_start")!({ reason }, ctx),
    select(next: Model | undefined) {
      model = next;
      handlers.get("model_select")!({ model: next }, ctx);
    },
    // Also test the per-request gate without relying on a model_select event.
    setModel(next: Model | undefined) { model = next; },
    setBusy(value: boolean) { idle = !value; },
  };
}

const payload = () => ({
  model: codex.id,
  instructions: "Keep this system prompt exactly",
  input: [{ role: "user", content: [{ type: "input_text", text: "Keep this too" }] }],
  tools: [{ type: "function", name: "read", parameters: { type: "object" } }],
  reasoning: { effort: "xhigh", summary: "auto" },
  prompt_cache_key: "test-session", store: false, stream: true,
});

const unsupported = [
  { ...codex, provider: "anthropic", api: "anthropic-messages", id: "claude-opus-5" },
  { ...codex, provider: "openai", api: "openai-responses" },
  { ...codex, provider: "openrouter" },
  { ...codex, provider: "custom-codex" },
  { ...codex, api: "openai-responses" },
  { ...codex, id: "gpt-5.3-codex-spark" },
  { ...codex, id: "gpt-5.3-codex" },
  { ...codex, id: "future-unreviewed-model" },
] as Model[];

describe("Codex-only /fast", () => {
  test("accepts only reviewed Codex models on the Codex API", () => {
    for (const id of ["gpt-5.4", "gpt-5.5", "gpt-5.6", "gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.6-terra", "gpt-6-astra"]) {
      expect(supportsCodexFast({ ...codex, id })).toBe(true);
    }
    for (const model of [...unsupported, undefined]) expect(supportsCodexFast(model)).toBe(false);
  });

  test("defaults off; bare command toggles only service_tier without mutating input", async () => {
    const h = harness();
    h.start("startup");
    const original = payload();
    const snapshot = structuredClone(original);
    Object.freeze(original);
    expect(h.request(original)).toBeUndefined();
    await h.run("status");
    expect(h.notifications.at(-1)?.message).toContain("OFF");
    expect(h.request(original)).toBeUndefined();

    await h.run();
    const fast = h.request(original);
    expect(fast).toEqual({ ...snapshot, service_tier: "priority" });
    for (const key of Object.keys(original)) expect(fast[key]).toBe(original[key as keyof typeof original]);
    expect(original).toEqual(snapshot);
    expect(h.ctx.model).toBe(codex);
    expect(h.statuses.get("codex-fast")).toBe("fast:codex");
    expect(h.notifications.at(-1)).toMatchObject({ type: "warning" });
    expect(h.notifications.at(-1)?.message).toContain("more ChatGPT credits");

    await h.run();
    expect(h.request(original)).toBeUndefined();
    expect(h.statuses.get("codex-fast")).toBeUndefined();
  });

  test("explicit on/off is idempotent, status read-only, completion and invalid input", async () => {
    const h = harness();
    await h.run(" ON ");
    await h.run("on");
    await h.run("status");
    expect(h.request(payload()).service_tier).toBe("priority");
    await h.run("on extra");
    expect(h.notifications.at(-1)?.message).toBe("Usage: /fast [on|off|status]");
    expect(h.request(payload()).service_tier).toBe("priority");
    await h.run("off");
    await h.run("off");
    expect(h.request(payload())).toBeUndefined();
    expect(h.completions("o")).toEqual([{ value: "on", label: "on" }, { value: "off", label: "off" }]);
    expect(h.completions("x")).toBeNull();
  });

  test("never enables or rewrites other providers, APIs or unsupported models", async () => {
    for (const model of unsupported) {
      const h = harness(model);
      await h.run("on");
      expect(h.request({ ...payload(), model: model.id, service_tier: "auto" })).toBeUndefined();
      expect(h.notifications.at(-1)?.type).toBe("warning");
      h.select(codex);
      expect(h.request(payload())).toBeUndefined();

      await h.run("on");
      h.setModel(model);
      expect(h.request({ ...payload(), model: model.id })).toBeUndefined();
    }
    const h = harness();
    h.setModel(undefined);
    await h.run();
    expect(h.request(payload())).toBeUndefined();
  });

  test("off preserves existing tiers and on changes no field besides the tier", async () => {
    const h = harness();
    for (const service_tier of ["auto", "default", "flex", "priority"]) {
      const original = { ...payload(), service_tier };
      expect(h.request(original)).toBeUndefined();
      await h.run("on");
      expect(h.request(original)).toEqual({ ...original, service_tier: "priority" });
      expect(original.service_tier).toBe(service_tier);
      await h.run("off");
    }
  });

  test("busy mode rejects changes but allows status; malformed/mismatched payloads pass through", async () => {
    const h = harness();
    h.setBusy(true);
    await h.run();
    expect(h.request(payload())).toBeUndefined();
    expect(h.notifications.at(-1)?.message).toContain("current response");
    h.setBusy(false);
    await h.run("on");
    h.setBusy(true);
    await h.run("off");
    await h.run("status");
    expect(h.notifications.at(-1)?.message).toContain("ON");
    expect(h.request(payload()).service_tier).toBe("priority");
    for (const value of [null, undefined, [], "payload", 42, {}, { model: "other" }]) {
      expect(h.request(value)).toBeUndefined();
    }
  });

  test("session lifecycle and switching away clear opt-in; supported Codex switching retains it", async () => {
    const h = harness();
    for (const reason of ["startup", "reload", "new", "resume", "fork"]) {
      await h.run("on");
      h.start(reason);
      expect(h.request(payload())).toBeUndefined();
      expect(h.statuses.get("codex-fast")).toBeUndefined();
    }
    await h.run("on");
    h.select({ ...codex, id: "gpt-5.4" });
    expect(h.request({ ...payload(), model: "gpt-5.4" }).service_tier).toBe("priority");
    h.select(unsupported[0]);
    expect(h.statuses.get("codex-fast")).toBeUndefined();
    h.select(codex);
    expect(h.request(payload())).toBeUndefined();
  });

  test("registers only command/request/lifecycle hooks; separate runtimes do not share state", async () => {
    const a = harness();
    const b = harness();
    await a.run("on");
    expect(b.request(payload())).toBeUndefined();
    expect([...a.handlers.keys()]).toEqual(["before_provider_request", "session_start", "model_select"]);
  });
});
