import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { registerHerdrTaskSummary } from "./index.ts";
import {
  EMPTY_SESSION_SUMMARY,
  HERDR_SUMMARY_SOURCE,
  HERDR_SUMMARY_TOKEN,
  MAX_RECENT_REQUESTS,
  MAX_REQUEST_LENGTH,
  generateTaskSummary,
  loadingSummaryFrame,
  recentRequests,
  reportTaskSummary,
  substantiveRequest,
  validateSummary,
  type CommandRunner,
} from "./summary.ts";

const environment = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2", HERDR_BIN_PATH: "/opt/herdr" };
const user = (content: unknown) => ({ type: "message", message: { role: "user", content } });
const response = (text: string, stopReason = "stop") => ({ stopReason, content: [{ type: "text", text }] });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(predicate: () => boolean) {
  for (let index = 0; index < 200; index++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail("Timed out waiting for background summary");
}
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(complete: (...args: any[]) => Promise<any> = async () => response("Diagnose login hang"),
  options: { debounceMs?: number; timeoutMs?: number; animationMs?: number } = { debounceMs: 0, timeoutMs: 1000 },
  env = environment) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const calls: any[][] = [];
  const reports: string[] = [];
  const entries: any[] = [];
  const ctx = {
    model: { provider: "test", id: "selected" },
    modelRegistry: { complete: async (...args: any[]) => { calls.push(args); return complete(...args); } },
    sessionManager: { getBranch: () => entries },
  };
  const pi = {
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    async exec(command: string, args: string[], options: any) {
      assert.equal(command, environment.HERDR_BIN_PATH);
      assert.equal(options.timeout, 2000);
      reports.push(args.at(-1)!);
      return { code: 0, stdout: "", stderr: "", killed: false };
    },
  };
  registerHerdrTaskSummary(pi as never, env, options);
  const emit = (name: string, event = {}) => handlers.get(name)?.(event, ctx);
  return { ctx, calls, reports, entries, handlers, emit,
    async message(content: unknown) {
      const entry = user(content);
      const before = JSON.stringify(entry);
      assert.equal(await emit("message_end", entry), undefined);
      assert.equal(JSON.stringify(entry), before);
      // Match Pi: finalized user messages are persisted after extension handlers.
      entries.push(entry);
    },
    title: () => reports.at(-1)?.slice(`${HERDR_SUMMARY_TOKEN}=`.length),
  };
}

test("naming material preserves meaning instead of extracting an action/prefix", () => {
  const request = "Could you please fix the labels, but first review how agents are named?";
  assert.equal(substantiveRequest(`/tmp/pi-clipboard-123.png\n${request}`), request);
  assert.equal(substantiveRequest([
    { type: "image", data: "not sent" }, { type: "text", text: request },
  ]), request);
  assert.equal(substantiveRequest("Remove the /tmp/pi-clipboard.png redundant storage?"), "Remove the redundant storage?");
  for (const content of ["/tmp/image.webp", [{ type: "image", data: "ignored" }], "Okay, sounds good!",
    "Can you do that for me?", "continue", "/reload", "j /reload",
    "spin up a new pi instance and do that for me", null]) {
    assert.equal(substantiveRequest(content), undefined);
  }
});

test("recent context is bounded, chronological, deduplicated and user-text only", () => {
  const entries = [
    user("Old discarded task"), user("The Herdr names are unhelpful"),
    { type: "message", message: { role: "assistant", content: "not naming input" } },
    { type: "message", message: { role: "toolResult", content: "private tool output" } },
    user("They show the opening words"), user("continue"), user("/tmp/clipboard.png"),
  ];
  assert.deepEqual(recentRequests(entries, "Could those describe the meaning instead?"), [
    "Old discarded task", "The Herdr names are unhelpful", "They show the opening words",
    "Could those describe the meaning instead?",
  ]);
  assert.deepEqual(recentRequests([user("Fix login"), user("Fix login")], "Fix login"), ["Fix login"]);
  const bounded = recentRequests(Array.from({ length: 10 }, (_, i) => user(`task ${i} ${"x".repeat(9000)} end ${i}`)));
  assert.equal(bounded.length, MAX_RECENT_REQUESTS);
  assert.ok(bounded.every((text) => text.length <= MAX_REQUEST_LENGTH));
  assert.match(bounded[0]!, /^task 6/);
  assert.match(bounded.at(-1)!, /end 9$/);
});

test("loading frames shuffle alphabetic bands without changing case, spacing or width", () => {
  for (const label of ["Repair OAuth redirect", "Review café URL (v2)"]) {
    const frames = Array.from({ length: 12 }, (_, frame) => loadingSummaryFrame(label, frame));
    assert.equal(new Set(frames).size, frames.length);
    for (const text of frames) {
      assert.equal(text.length, label.length);
      assert.equal(text.replace(/[a-z]/gi, ""), label.replace(/[a-z]/gi, ""));
      assert.equal(text.replace(/[a-z]/g, "a").replace(/[A-Z]/g, "A"),
        label.replace(/[a-z]/g, "a").replace(/[A-Z]/g, "A"));
    }
  }
  assert.equal(loadingSummaryFrame(EMPTY_SESSION_SUMMARY, 0), loadingSummaryFrame("Generating title", 0));
  assert.equal(loadingSummaryFrame("日本語", 0), loadingSummaryFrame("Generating title", 0));
});

test("pending titles animate, then settle without extra model calls or lingering frames", async () => {
  for (const base of [EMPTY_SESSION_SUMMARY, "Repair login redirect"]) {
    const pending = deferred();
    const responses = base === EMPTY_SESSION_SUMMARY ? [pending.promise]
      : [Promise.resolve(response(base)), pending.promise];
    const h = harness(async () => responses.shift(), { debounceMs: 0, timeoutMs: 1000, animationMs: 5 });
    await h.emit("session_start");
    if (base !== EMPTY_SESSION_SUMMARY) {
      await h.message("Fix login");
      await until(() => h.title() === base);
    }
    const firstFrame = h.reports.length;
    await h.message("Now name the changed task");
    await until(() => h.reports.length >= firstFrame + 3);
    assert.deepEqual(h.reports.slice(firstFrame, firstFrame + 3),
      [0, 1, 2].map((frame) => `${HERDR_SUMMARY_TOKEN}=${loadingSummaryFrame(base, frame)}`));
    pending.resolve(response("Generate semantic task titles"));
    await until(() => h.title() === "Generate semantic task titles");
    const count = h.reports.length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(h.reports.length, count, "animation must stop when naming finishes");
    assert.equal(h.calls.length, base === EMPTY_SESSION_SUMMARY ? 1 : 2);
    // Cached branch restore must show stable text, not restart the animation.
    await h.emit("session_tree");
    await tick();
    assert.equal(h.title(), "Generate semantic task titles");
    assert.equal(h.calls.length, base === EMPTY_SESSION_SUMMARY ? 1 : 2);
    await h.emit("session_shutdown");
  }
});

test("failed and timed-out naming stops the animation and restores stable text", async () => {
  for (const failure of ["error", "invalid", "timeout"]) {
    const pending = deferred();
    let calls = 0;
    const h = harness(async () => {
      if (++calls === 1) return response("Repair login redirect");
      await pending.promise;
      if (failure === "error") throw Error("Provider unavailable");
      return response("This explanation has far too many words to be a title");
    }, { debounceMs: 0, timeoutMs: 60, animationMs: 5 });
    await h.emit("session_start");
    await h.message("Fix login");
    await until(() => h.title() === "Repair login redirect");
    const before = h.reports.length;
    await h.message("Change the task");
    await until(() => h.reports.length >= before + 2);
    if (failure !== "timeout") pending.resolve(undefined);
    await until(() => h.title() === "Repair login redirect");
    const count = h.reports.length;
    pending.resolve(undefined);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(h.reports.length, count);
    await h.emit("session_shutdown");
  }
});

test("branch navigation and shutdown stop pending animation and restore a stable label", async () => {
  for (const event of ["session_tree", "session_shutdown"]) {
    const pending = deferred();
    const h = harness(async () => pending.promise, { debounceMs: 0, timeoutMs: 1000, animationMs: 5 });
    await h.emit("session_start");
    await h.message("Fix login");
    await until(() => h.reports.length >= 3);
    h.entries.length = 0;
    await h.emit(event);
    await until(() => h.title() === EMPTY_SESSION_SUMMARY);
    const count = h.reports.length;
    pending.resolve(response("Wrong branch title"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(h.reports.length, count);
    if (event !== "session_shutdown") await h.emit("session_shutdown");
  }
});

test("slow metadata IPC never queues a backlog of animation frames", async () => {
  const gate = deferred();
  const pending = deferred();
  const h = harness(async () => pending.promise);
  const handlers = new Map<string, (...args: any[]) => any>();
  const titles: string[] = [];
  registerHerdrTaskSummary({
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    async exec(_command: string, args: string[]) {
      titles.push(args.at(-1)!);
      await gate.promise;
      return { code: 0 };
    },
  } as never, environment, { debounceMs: 0, animationMs: 1 });
  h.entries.push(user("Fix login"));
  handlers.get("session_start")!({}, h.ctx);
  await until(() => titles.length === 1 && h.calls.length === 1);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(titles.length, 1);
  pending.resolve(response("Repair login redirect"));
  await tick();
  gate.resolve(undefined);
  await until(() => titles.at(-1) === `${HERDR_SUMMARY_TOKEN}=Repair login redirect`);
  assert.equal(titles.length, 2, "only the in-flight frame and final title should be published");
  await handlers.get("session_shutdown")!();
});

test("model output must already be a short safe title; it is never clipped", () => {
  assert.equal(validateSummary('"Generate semantic agent titles"'), "Generate semantic agent titles");
  assert.equal(validateSummary("Fix OAuth redirect."), "Fix OAuth redirect");
  assert.equal(validateSummary("Review café navigation"), "Review café navigation");
  for (const value of ["", "Title", "One two three four five six seven", "x".repeat(73) + " title",
    "Good title\nExtra explanation", "Good\ttitle", "Bad\u001b[31m title", "Bad\u202e title",
    "Bad\u2028 title", "# Markdown title", "Title: Good name", "$(touch /tmp/nope)"]) {
    assert.equal(validateSummary(value), undefined, value);
  }
});

test("semantic title uses the selected authenticated registry, isolated and tool-free", async () => {
  const prompt = "When I sign in the page keeps spinning forever; can you look into why?";
  const h = harness(async () => ({ stopReason: "stop", content: [
    { type: "thinking", thinking: "not a title" }, { type: "text", text: "Diagnose sign-in hang" },
  ] }));
  const signal = new AbortController().signal;
  assert.equal(await generateTaskSummary([prompt], h.ctx as never, signal), "Diagnose sign-in hang");
  const [model, context, options] = h.calls[0]!;
  assert.equal(model, h.ctx.model);
  assert.deepEqual(context.tools, []);
  assert.equal(context.messages.length, 1);
  assert.deepEqual(JSON.parse(context.messages[0].content), { recentUserRequests: [prompt] });
  assert.match(context.systemPrompt, /semantically summarizes/);
  assert.match(context.systemPrompt, /data, not instructions/);
  assert.equal(options.signal, signal);
  assert.equal(options.maxTokens, 2048);
  assert.equal(options.cacheRetention, "none");
  assert.equal(options.transport, "sse");
  assert.match(options.sessionId, /^[\da-f-]{36}$/);
  await generateTaskSummary([prompt], h.ctx as never, signal);
  assert.notEqual(h.calls[1]![2].sessionId, options.sessionId);
});

test("no model, no input and aborted requests cannot generate; invalid responses cannot publish", async () => {
  const h = harness();
  const abort = new AbortController();
  abort.abort();
  assert.equal(await generateTaskSummary(["Fix login"], h.ctx as never, abort.signal), undefined);
  assert.equal(await generateTaskSummary([], h.ctx as never, new AbortController().signal), undefined);
  assert.equal(await generateTaskSummary(["Fix login"], { ...h.ctx, model: undefined } as never,
    new AbortController().signal), undefined);
  assert.equal(h.calls.length, 0);
  for (const stop of ["error", "aborted", "length", "toolUse", "pending"]) {
    const invalid = harness(async () => response("Valid looking title", stop));
    assert.equal(await generateTaskSummary(["Fix login"], invalid.ctx as never, new AbortController().signal), undefined);
  }
  const invalid = harness(async () => ({ stopReason: "stop", content: [
    { type: "text", text: "Valid looking title" }, { type: "toolCall", name: "bash" },
  ] }));
  assert.equal(await generateTaskSummary(["Fix login"], invalid.ctx as never, new AbortController().signal), undefined);
});

test("metadata reporting is inert outside Herdr and reports or clears exactly one Pi token", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const run: CommandRunner = async (command, args) => { calls.push({ command, args }); return { code: 0 }; };
  assert.equal(await reportTaskSummary("Fix labels", {}, run), false);
  assert.equal(calls.length, 0);
  assert.equal(await reportTaskSummary("Fix labels", environment, run), true);
  assert.deepEqual(calls[0], { command: "/opt/herdr", args: [
    "pane", "report-metadata", "w1:p2", "--source", HERDR_SUMMARY_SOURCE,
    "--agent", "pi", "--token", `${HERDR_SUMMARY_TOKEN}=Fix labels`,
  ] });
  assert.equal(await reportTaskSummary(undefined, environment, run), true);
  assert.deepEqual(calls[1]?.args.slice(-2), ["--clear-token", HERDR_SUMMARY_TOKEN]);
  assert.equal(await reportTaskSummary("Task", environment, async () => ({ code: 1 })), false);
  assert.equal(await reportTaskSummary("Task", environment, async () => { throw Error("socket unavailable"); }), false);
});

test("extension is completely inert outside Herdr", async () => {
  const h = harness(undefined, undefined, {} as never);
  assert.equal(h.handlers.size, 0);
  await h.emit("session_start");
  await h.message("Fix login");
  await tick();
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.reports, []);
});

test("empty sessions get a placeholder; only observational lifecycle hooks are registered", async () => {
  const h = harness();
  await h.emit("session_start");
  await until(() => h.title() === EMPTY_SESSION_SUMMARY);
  assert.equal(h.calls.length, 0);
  assert.deepEqual([...h.handlers.keys()].sort(), [
    "message_end", "model_select", "session_shutdown", "session_start", "session_tree",
  ]);
  await h.emit("session_shutdown");
});

test("restores semantic titles on reload without awaiting the model or changing messages", async () => {
  const pending = deferred();
  const h = harness(async () => pending.promise);
  h.entries.push(user("My browser keeps spinning after login, why?"));
  const before = JSON.stringify(h.entries);
  assert.equal(h.emit("session_start"), undefined);
  await until(() => h.calls.length === 1);
  assert.notEqual(h.title(), EMPTY_SESSION_SUMMARY, "pending naming displays a loading frame");
  pending.resolve(response("Diagnose login hang"));
  await until(() => h.title() === "Diagnose login hang");
  assert.equal(JSON.stringify(h.entries), before);
  await h.message("continue");
  await h.message("/tmp/pi-clipboard.png");
  await h.emit("message_end", { message: { role: "assistant", content: "Some reply" } });
  await tick();
  assert.equal(h.calls.length, 1);
  await h.emit("session_shutdown");
});

test("new tasks carry recent user context; duplicate messages and acknowledgements don't bill again", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.message("The Herdr labels are the first words of my prompt");
  await until(() => h.calls.length === 1);
  await h.message("Could they describe the meaning instead?");
  await until(() => h.calls.length === 2);
  assert.deepEqual(JSON.parse(h.calls[1]![1].messages[0].content).recentUserRequests, [
    "The Herdr labels are the first words of my prompt", "Could they describe the meaning instead?",
  ]);
  await h.message("Could they describe the meaning instead?");
  await h.message("Thanks!");
  await tick();
  assert.equal(h.calls.length, 2);
  await h.emit("session_shutdown");
});

test("bursts debounce into one request and shutdown cancels a pending timer", async () => {
  const h = harness(undefined, { debounceMs: 30, timeoutMs: 1000 });
  await h.emit("session_start");
  await h.message("Fix login");
  await h.message("Actually fix logout instead");
  assert.equal(h.calls.length, 0);
  await until(() => h.calls.length === 1);
  await h.message("Now fix registration");
  await h.emit("session_shutdown");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(h.calls.length, 1);
});

test("late stale completions cannot overwrite a newer task", async () => {
  const old = deferred();
  const h = harness(async (_model, context) => context.messages[0].content.includes("New task")
    ? response("Repair signup form") : old.promise);
  await h.emit("session_start");
  await h.message("Old task login");
  await until(() => h.calls.length === 1);
  await h.message("New task signup");
  await until(() => h.title() === "Repair signup form");
  assert.equal(h.calls[0]![2].signal.aborted, true);
  old.resolve(response("Stale login title"));
  await tick();
  assert.equal(h.title(), "Repair signup form");
  await h.emit("session_shutdown");
});

test("provider failures and invalid output retain the previous title, never the prompt prefix", async () => {
  let attempt = 0;
  const h = harness(async () => {
    attempt++;
    if (attempt === 1) return response("Repair login redirect");
    if (attempt === 2) throw Error("No auth or provider unavailable");
    return response("This is a very long explanation not a title");
  });
  await h.emit("session_start");
  await h.message("First request login");
  await until(() => h.title() === "Repair login redirect");
  await h.message("Second request signup");
  await until(() => attempt === 2);
  await h.message("Third request accounts");
  await until(() => attempt === 3);
  await tick();
  assert.equal(h.title(), "Repair login redirect");
  await h.emit("session_shutdown");
});

test("deadline aborts a hung provider and rejects even a later successful result", async () => {
  const pending = deferred();
  const h = harness(async () => pending.promise, { debounceMs: 0, timeoutMs: 15 });
  await h.emit("session_start");
  await h.message("Please fix login");
  await until(() => h.calls.length === 1 && h.calls[0]![2].signal.aborted);
  pending.resolve(response("Too late title"));
  await tick();
  assert.equal(h.title(), EMPTY_SESSION_SUMMARY);
  await h.emit("session_shutdown");
});

test("tree navigation restores cached branch titles and clears unrelated titles on empty branches", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.message("Fix login");
  await until(() => h.title() === "Diagnose login hang");
  const branch = [...h.entries];
  h.entries.length = 0;
  await h.emit("session_tree");
  await until(() => h.title() === EMPTY_SESSION_SUMMARY);
  h.entries.push(...branch);
  await h.emit("session_tree");
  await until(() => h.title() === "Diagnose login hang");
  assert.equal(h.calls.length, 1);
  await h.emit("session_shutdown");
});

test("model switch aborts old request and uses the newly selected model", async () => {
  const pending = deferred();
  const h = harness(async (model) => model.id === "other" ? response("New model title") : pending.promise);
  await h.emit("session_start");
  await h.message("Fix login");
  await until(() => h.calls.length === 1);
  h.ctx.model = { provider: "different", id: "other" };
  await h.emit("model_select");
  await until(() => h.title() === "New model title");
  assert.equal(h.calls[0]![2].signal.aborted, true);
  assert.deepEqual(h.calls[1]![0], h.ctx.model);
  pending.resolve(response("Old model title"));
  await tick();
  assert.equal(h.title(), "New model title");
  await h.emit("session_shutdown");
});

test("shutdown/reload cancels work and old responses cannot name a new empty session", async () => {
  const pending = deferred();
  const h = harness(async () => pending.promise);
  await h.emit("session_start");
  await h.message("Fix login");
  await until(() => h.calls.length === 1);
  await h.emit("session_shutdown");
  assert.equal(h.calls[0]![2].signal.aborted, true);
  h.entries.length = 0;
  await h.emit("session_start");
  pending.resolve(response("Wrong session title"));
  await tick();
  assert.equal(h.title(), EMPTY_SESSION_SUMMARY);
  await h.emit("session_shutdown");
});

test("metadata publications are serialized and shutdown drains in-flight IPC", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const first = deferred();
  const second = deferred();
  const started: string[] = [];
  const finished: string[] = [];
  const ctx = harness().ctx;
  registerHerdrTaskSummary({
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    async exec(_command: string, args: string[]) {
      const title = args.at(-1)!;
      started.push(title);
      await (started.length === 1 ? first.promise : second.promise);
      finished.push(title);
      return { code: 0 };
    },
  } as never, environment, { debounceMs: 0 });
  handlers.get("session_start")!({}, ctx);
  await until(() => started.length === 1);
  handlers.get("message_end")!({ message: { role: "user", content: "Fix login" } }, ctx);
  await tick();
  assert.equal(started.length, 1, "new IPC must wait for the old publication");
  first.resolve(undefined);
  await until(() => started.length === 2);
  let stopped = false;
  const shutdown = handlers.get("session_shutdown")!().then(() => { stopped = true; });
  await tick();
  assert.equal(stopped, false);
  second.resolve(undefined);
  await shutdown;
  assert.deepEqual(finished, started);
  assert.equal(started.length, 3, "only the stable-title restore may follow in-flight IPC on shutdown");
  assert.equal(started.at(-1), `${HERDR_SUMMARY_TOKEN}=Diagnose login hang`);
});

test("installed Pi ModelRegistry supports the side call with a faux provider, no network or sessions", async () => {
  const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const packageRoot = join(root, "@earendil-works/pi-coding-agent");
  const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
  const ai = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-ai/dist/index.js")).href);
  const dir = await mkdtemp(join(tmpdir(), "pi-summary-test-"));
  try {
    const runtime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null, modelsStorePath: join(dir, "store.json"), refreshOnCreate: false, allowModelNetwork: false });
    const faux = ai.fauxProvider({ provider: "summary-test", models: [{ id: "namer", reasoning: false }] });
    runtime.registerNativeProvider(faux.provider);
    faux.setResponses([ai.fauxAssistantMessage([ai.fauxText("Diagnose login hang")])]);
    const registry = new sdk.ModelRegistry(runtime);
    const model = registry.find("summary-test", "namer");
    assert.ok(model);
    assert.equal(await generateTaskSummary(["My login page keeps spinning forever"],
      { model, modelRegistry: registry }, new AbortController().signal), "Diagnose login hang");
    assert.equal(faux.state.callCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
