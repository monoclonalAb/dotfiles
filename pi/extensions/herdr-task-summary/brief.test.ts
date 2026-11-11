import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  BRIEF_ERROR_TOKEN,
  BRIEF_PENDING_TOKEN,
  BRIEF_TOKEN,
  MAX_BRIEF_LENGTH,
  MAX_BRIEF_REQUESTS,
  MAX_BRIEF_REQUEST_LENGTH,
  checkBrief,
  conversationRequests,
  generateConversationBrief,
  registerConversationBrief,
  reportBrief,
} from "./brief.ts";
import { SUMMARY_MODEL, type CommandRunner } from "./summary.ts";

const app = { HC_TERMINAL_ID: "t7" };
const user = (content: unknown) => ({ type: "message", message: { role: "user", content } });
const assistant = (text: string) => ({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } });
const response = (text: string, stopReason = "stop") => ({ stopReason, content: [{ type: "text", text }] });
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(predicate: () => boolean) {
  for (let index = 0; index < 200; index++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail("Timed out waiting for the background brief");
}
function deferred<T = any>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const luna = { ...SUMMARY_MODEL };
/** A model registry without gpt-6-luna unless `quick` is given. */
function registry(complete: (...args: any[]) => Promise<any>, quick?: any) {
  return {
    find: (provider: string, id: string) => provider === quick?.provider && id === quick?.id ? quick : undefined,
    hasConfiguredAuth: () => true,
    complete,
  };
}

function harness(complete: (...args: any[]) => Promise<any> = async () => response("Fixing the login spinner."),
  env: Record<string, string> = app) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const calls: any[][] = [];
  const labels: string[][] = [];
  const entries: any[] = [];
  const ctx = {
    model: { provider: "test", id: "selected" },
    modelRegistry: registry(async (...args: any[]) => { calls.push(args); return complete(...args); }),
    sessionManager: { getBranch: () => entries },
  };
  const pi = {
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    async exec(command: string, args: string[], options: any) {
      assert.equal(command, "hc");
      assert.equal(options.timeout, 2000);
      labels.push(args);
      return { code: 0, stdout: "", stderr: "", killed: false };
    },
  };
  registerConversationBrief(pi as never, env, { debounceMs: 0, timeoutMs: 1000 });
  const emit = (name: string, event = {}) => handlers.get(name)?.(event, ctx);
  const label = (token: string) => {
    for (let i = labels.length - 1; i >= 0; i--) {
      const found = labels[i].find((arg) => arg.startsWith(`${token}=`));
      if (found !== undefined) return found.slice(token.length + 1);
    }
    return undefined;
  };
  return { ctx, calls, labels, entries, handlers, emit, label,
    async message(content: unknown) {
      const entry = user(content);
      const before = JSON.stringify(entry);
      assert.equal(await emit("message_end", entry), undefined);
      assert.equal(JSON.stringify(entry), before, "the message is never changed");
      entries.push(entry);
    },
  };
}

test("the brief's material: every user request, oldest first; agent replies and acknowledgements left out", () => {
  const entries = [user("Why does login spin forever?"), assistant("Because of the 401 handler."), user("ok"),
    user([{ type: "text", text: "Also show the error" }, { type: "image", data: "AAAA", mimeType: "image/png" }])];
  assert.deepEqual(conversationRequests(entries, "Add a test for it"),
    ["Why does login spin forever?", "Also show the error", "Add a test for it"]);
  assert.deepEqual(conversationRequests([user("Same"), user("Same")], "Same"), ["Same"], "repeats count once");
});

test("long conversations keep their first request and the latest ones, each bounded", () => {
  const entries = Array.from({ length: 30 }, (_, i) => user(`Request number ${i}`));
  const requests = conversationRequests(entries);
  assert.equal(requests.length, MAX_BRIEF_REQUESTS);
  assert.equal(requests[0], "Request number 0");
  assert.equal(requests.at(-1), "Request number 29");
  const long = conversationRequests([user(`start ${"x".repeat(5000)} end`)])[0];
  assert.ok(long.length <= MAX_BRIEF_REQUEST_LENGTH && long.length > MAX_BRIEF_REQUEST_LENGTH - 10);
  assert.match(long, / \[…\] /u);
  assert.ok(long.startsWith("start") && long.endsWith("end"));
});

test("model output becomes one plain line, or is rejected with a reason; never clipped", () => {
  assert.deepEqual(checkBrief('Summary: "Fixing the **login** spinner;\nnow showing the error."'),
    { brief: "Fixing the login spinner; now showing the error." });
  assert.deepEqual(checkBrief("   "), { problem: "empty reply" });
  assert.deepEqual(checkBrief("y".repeat(MAX_BRIEF_LENGTH + 1)), { problem: `${MAX_BRIEF_LENGTH + 1} characters (limit ${MAX_BRIEF_LENGTH})` });
  assert.ok("brief" in checkBrief("y".repeat(MAX_BRIEF_LENGTH)));
});

test("the side request is tool-free, isolated and holds only the user requests", async () => {
  const calls: any[][] = [];
  const ctx = { model: { provider: "p", id: "m" }, modelRegistry: registry(async (...args: any[]) => { calls.push(args); return response("Fixing login."); }) };
  assert.equal(await generateConversationBrief(["Fix login"], ctx as never, new AbortController().signal), "Fixing login.");
  const [model, request, options] = calls[0];
  assert.deepEqual(model, ctx.model);
  assert.deepEqual(request.tools, []);
  assert.deepEqual(JSON.parse(request.messages[0].content), { userRequests: ["Fix login"] });
  assert.equal(options.cacheRetention, "none");
  assert.match(options.sessionId, /^[0-9a-f-]{36}$/);
});

test("installed Pi ModelRegistry supports the brief's side call with a faux provider, no network or sessions", async () => {
  const root = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
  const packageRoot = join(root, "@earendil-works/pi-coding-agent");
  const sdk = await import(pathToFileURL(join(packageRoot, "dist/index.js")).href);
  const ai = await import(pathToFileURL(join(packageRoot, "node_modules/@earendil-works/pi-ai/dist/index.js")).href);
  const dir = await mkdtemp(join(tmpdir(), "pi-brief-test-"));
  try {
    const runtime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(),
      modelsPath: null, modelsStorePath: join(dir, "store.json"), refreshOnCreate: false, allowModelNetwork: false });
    const faux = ai.fauxProvider({ provider: "brief-test", models: [{ id: "writer", reasoning: false }] });
    runtime.registerNativeProvider(faux.provider);
    faux.setResponses([ai.fauxAssistantMessage([ai.fauxText("Fixing the login spinner; now showing the error.")])]);
    const registry = new sdk.ModelRegistry(runtime);
    const model = registry.find("brief-test", "writer");
    assert.ok(model);
    assert.equal(await generateConversationBrief(["Why does login spin forever?", "Also show the error"],
      { model, modelRegistry: registry }, new AbortController().signal), "Fixing the login spinner; now showing the error.");
    assert.equal(faux.state.callCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("no requests, no model or an aborted signal make no request; bad replies give a reason", async () => {
  let calls = 0;
  const ctx = (reply: any) => ({ model: { provider: "p", id: "m" }, modelRegistry: registry(async () => { calls++; return reply; }) });
  assert.equal(await generateConversationBrief([], ctx(response("x")) as never, new AbortController().signal), undefined);
  assert.equal(await generateConversationBrief(["a"], { ...ctx(response("x")), model: undefined } as never, new AbortController().signal), undefined);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await generateConversationBrief(["a"], ctx(response("x")) as never, aborted.signal), undefined);
  assert.equal(calls, 0);
  const reasons: string[] = [];
  await generateConversationBrief(["a"], ctx(response("x", "length")) as never, new AbortController().signal, (r) => reasons.push(r));
  await generateConversationBrief(["a"], ctx({ stopReason: "stop", content: [{ type: "toolCall" }] }) as never, new AbortController().signal, (r) => reasons.push(r));
  await generateConversationBrief(["a"], ctx(response("")) as never, new AbortController().signal, (r) => reasons.push(r));
  assert.deepEqual(reasons, ['model stopped with "length"', "reply was a tool call", 'rejected "": empty reply']);
});

test("gpt-6-luna writes the brief; the conversation's model takes over when it fails", async () => {
  const tried: string[] = [];
  const ctx = (reply: (model: any) => any) => ({ model: { provider: "p", id: "m" },
    modelRegistry: registry(async (model: any) => { tried.push(model.id); return reply(model); }, luna) });
  assert.equal(await generateConversationBrief(["Fix login"], ctx(() => response("Fixing login.")) as never,
    new AbortController().signal), "Fixing login.");
  assert.deepEqual(tried.splice(0), ["gpt-6-luna"]);
  const reasons: string[] = [];
  assert.equal(await generateConversationBrief(["Fix login"], ctx((model) => {
    if (model.id === luna.id) throw Error("invalid_grant");
    return response("Fixing the login spinner.");
  }) as never, new AbortController().signal, (reason) => reasons.push(reason)), "Fixing the login spinner.");
  assert.deepEqual(tried.splice(0), ["gpt-6-luna", "m"]);
  assert.deepEqual(reasons, []);
  // With no conversation model selected, luna alone still writes it.
  assert.equal(await generateConversationBrief(["Fix login"], { ...ctx(() => response("Fixing login.")), model: undefined } as never,
    new AbortController().signal), "Fixing login.");
});

test("labels: the brief, its pending mark and its error; outside the Herdr app nothing", async () => {
  const runs: string[][] = [];
  const run: CommandRunner = async (command, args) => { runs.push([command, ...args]); return { code: 0 }; };
  assert.equal(await reportBrief("Fixing login.", app, run, null), true);
  assert.equal(await reportBrief(undefined, { ...app, HC_BIN_PATH: "/x/hc" }, run, undefined, true), true);
  assert.equal(await reportBrief(undefined, app, run, "12:00 no reply"), true);
  assert.deepEqual(runs, [
    ["hc", "label", "t7", `${BRIEF_ERROR_TOKEN}=`, `${BRIEF_PENDING_TOKEN}=`, `${BRIEF_TOKEN}=Fixing login.`],
    ["/x/hc", "label", "t7", `${BRIEF_PENDING_TOKEN}=1`],
    ["hc", "label", "t7", `${BRIEF_ERROR_TOKEN}=12:00 no reply`, `${BRIEF_PENDING_TOKEN}=`],
  ]);
  assert.equal(await reportBrief("x", { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2" }, run), false);
  assert.equal(await reportBrief("x", app, async () => { throw new Error("no hc"); }), false);
});

test("inert in terminal Herdr and outside Herdr: no handlers, no requests", () => {
  for (const env of [{}, { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2" }]) {
    const h = harness(undefined, env as never);
    assert.equal(h.handlers.size, 0);
  }
});

test("only observational hooks are registered", () => {
  assert.deepEqual([...harness().handlers.keys()].sort(), ["message_end", "session_shutdown", "session_start", "session_tree"]);
});

test("a new request is briefed with the whole conversation; the pending mark comes and goes", async () => {
  let call = 0;
  const h = harness(async () => response(++call === 1 ? "Fixing the login spinner." : "Fixing login; now showing the error."));
  h.entries.push(user("Why does login spin forever?"));
  await h.emit("session_start");
  await until(() => h.label(BRIEF_TOKEN) === "Fixing the login spinner.");
  await h.message("Also show the error message");
  await until(() => h.label(BRIEF_TOKEN) === "Fixing login; now showing the error.");
  assert.equal(h.label(BRIEF_PENDING_TOKEN), "");
  assert.deepEqual(JSON.parse(h.calls[1][1].messages[0].content).userRequests,
    ["Why does login spin forever?", "Also show the error message"]);
  assert.ok(h.labels.some((args) => args.includes(`${BRIEF_PENDING_TOKEN}=1`)));
  assert.equal(h.label(BRIEF_ERROR_TOKEN), "");
});

test("acknowledgements and reloads of the same conversation make no new request", async () => {
  const h = harness();
  await h.emit("session_start");
  await h.message("Fix the login spinner");
  await until(() => h.label(BRIEF_TOKEN) === "Fixing the login spinner.");
  await h.message("thanks");
  await h.emit("session_tree");
  await until(() => h.labels.length >= 4);
  assert.equal(h.calls.length, 1);
});

test("an empty conversation clears the brief and its error", async () => {
  const h = harness();
  await h.emit("session_start");
  await until(() => h.labels.length === 1);
  assert.deepEqual(h.labels[0], ["label", "t7", `${BRIEF_ERROR_TOKEN}=`, `${BRIEF_PENDING_TOKEN}=`, `${BRIEF_TOKEN}=`]);
  assert.equal(h.calls.length, 0);
});

test("a failure keeps the last brief and records why", async () => {
  let fail = false;
  const h = harness(async () => { if (fail) throw new Error("rate limited"); return response("Fixing login."); });
  await h.emit("session_start");
  await h.message("Fix login");
  await until(() => h.label(BRIEF_TOKEN) === "Fixing login.");
  fail = true;
  await h.message("And the signup page");
  await until(() => /request failed: rate limited$/.test(h.label(BRIEF_ERROR_TOKEN) ?? ""));
  assert.equal(h.label(BRIEF_TOKEN), "Fixing login.");
  assert.equal(h.label(BRIEF_PENDING_TOKEN), "");
});

test("a newer request supersedes an older one still waiting on the model", async () => {
  const first = deferred();
  let call = 0;
  const h = harness(async () => (++call === 1 ? (await first.promise, response("Old brief.")) : response("New brief.")));
  await h.emit("session_start");
  await h.message("Fix login");
  await until(() => h.calls.length === 1);
  await h.message("Actually fix signup");
  await until(() => h.label(BRIEF_TOKEN) === "New brief.");
  first.resolve(undefined);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(h.label(BRIEF_TOKEN), "New brief.");
});

test("shutdown cancels the request and clears the pending mark, keeping the brief", async () => {
  const never = deferred();
  const h = harness(async () => { await never.promise; return response("Late."); });
  await h.emit("session_start");
  await h.message("Fix login");
  await until(() => h.label(BRIEF_PENDING_TOKEN) === "1");
  await h.emit("session_shutdown");
  assert.deepEqual(h.labels.at(-1), ["label", "t7", `${BRIEF_PENDING_TOKEN}=`]);
  never.resolve(undefined);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(h.label(BRIEF_TOKEN), "", "only the empty start's clear; the late reply wrote nothing");
});
