import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const pkg = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const root = mkdtempSync(join(tmpdir(), "omp-anthropic-runtime-"));
const source = dirname(fileURLToPath(import.meta.url));
const testContext = process.env.NODE_TEST_CONTEXT;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, { HOME: root, PATH: join(root, "bin"), PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1" });
if (testContext) process.env.NODE_TEST_CONTEXT = testContext;
mkdirSync(join(root, "bin"));
mkdirSync(process.env.PI_CODING_AGENT_DIR);
after(() => rmSync(root, { recursive: true, force: true }));
const commandLog = join(root, "commands.jsonl");
const requestLog = join(root, "requests.jsonl");
const modeFile = join(root, "mode");
const releaseFile = join(root, "latest");
const releaseLog = join(root, "release-checks.jsonl");
const probeModeFile = join(root, "probe-mode");
writeFileSync(modeFile, "text");
writeFileSync(releaseFile, "18.3.1");
writeFileSync(probeModeFile, "pass");
function lines(path) {
  try { return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
}
function executable(name, source) {
  writeFileSync(join(root, "bin", name), `#!${process.execPath}\n${source}`, { mode: 0o700 });
}
executable("omp", `
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify(args) + '\\n');
if (args[0] === '--version') console.log('omp/18.3.1');
else if (args.join(' ') === 'token anthropic') console.log('sk-ant-oat-synthetic-omp');
else process.exitCode = 99;
`);
executable("brew", "throw new Error('A matching fixture must never attempt an upgrade');");
executable("git", "throw new Error('A matching fixture must never alter a tap');");
executable("curl", `
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(releaseLog)}, JSON.stringify(process.argv.slice(2)) + '\\n');
console.log('https://github.com/can1357/oh-my-pi/releases/tag/v' + fs.readFileSync(${JSON.stringify(releaseFile)}, 'utf8'));
`);
// Exercise the real Bun subprocess IPC, but never run a network-capable child.
// This is a synthetic protocol validator, not proof of Anthropic acceptance.
executable("bun", `
const fs = require('node:fs');
(async () => {
  let raw = ''; for await (const chunk of process.stdin) raw += chunk;
  const request = JSON.parse(raw);
  if (request.url.includes('/bootstrap')) {
    console.log(JSON.stringify({ status: 200, statusText: 'OK', headers: [['content-type', 'application/json']] }));
    process.stdout.write(JSON.stringify({ oauth_account: {} })); return;
  }
  const body = JSON.parse(request.body);
  const probe = JSON.stringify(body.messages).includes('PI_ROUTE_OK');
  const probeMode = fs.readFileSync(${JSON.stringify(probeModeFile)}, 'utf8');
  fs.appendFileSync(${JSON.stringify(requestLog)}, JSON.stringify({ ...request, body }) + '\\n');
  const betas = (request.headers['anthropic-beta'] ?? '').split(',');
  const blocks = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []);
  const changes = blocks.filter(b => b.type === 'tool_addition' || b.type === 'tool_removal');
  const names = new Set((body.tools ?? []).map(t => t.name));
  let error;
  if (body.messages.some(m => m.output_config)) error = 'output_config.effort requires a model that supports per-turn effort; this model does not';
  if (body.thinking?.block_binding && !betas.includes('thinking-binding-controls-2026-08-01')) error = 'thinking.block_binding: missing beta';
  if (changes.length && !betas.includes('mid-conversation-tool-changes-2026-07-01')) error = 'tool changes: missing beta';
  if (changes.some(b => !names.has(b.tool?.name))) error = 'tool changes: undeclared tool reference';
  if (probe && probeMode === 'reject') error = 'synthetic probe rejection';
  if (error) {
    console.log(JSON.stringify({ status: 400, statusText: 'Bad Request', headers: [['content-type', 'application/json']] }));
    process.stdout.write(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: error } })); return;
  }
  const mode = fs.readFileSync(${JSON.stringify(modeFile)}, 'utf8');
  const tool = (body.tools ?? []).find(t => t.name.toLowerCase() === '_' + mode.toLowerCase());
  if (tool) fs.writeFileSync(${JSON.stringify(modeFile)}, 'text');
  const events = [
    { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: probe && probeMode === 'wrong-model' ? 'claude-wrong-model' : body.model, content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: tool ? { type: 'tool_use', id: 'tool_fixture', name: tool.name, input: {} } : { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: tool ? { type: 'input_json_delta', partial_json: '{}' } : { type: 'text_delta', text: probe ? (probeMode === 'bad-reply' ? 'wrong reply' : 'PI_ROUTE_OK') : 'fixture ok' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  console.log(JSON.stringify({ status: 200, statusText: 'OK', headers: [['content-type', 'text/event-stream']] }));
  for (const event of events) process.stdout.write('event: ' + event.type + '\\ndata: ' + JSON.stringify(event) + '\\n\\n');
})().catch(() => { process.exitCode = 1; });
`);
globalThis.fetch = async () => { throw new Error("Unexpected external request blocked"); };
const sdk = await import(pathToFileURL(join(pkg, "dist/index.js")));
const ai = await import(pathToFileURL(join(pkg, "node_modules/@earendil-works/pi-ai/dist/index.js")));
const { anthropicProvider } = await import(pathToFileURL(join(pkg, "node_modules/@earendil-works/pi-ai/dist/providers/anthropic.js")));
const baseModel = anthropicProvider().getModels().find(m => m.compat?.forceAdaptiveThinking);
assert.ok(baseModel);
const modelsPath = join(root, "models.json");
writeFileSync(modelsPath, JSON.stringify({ providers: { anthropic: { modelOverrides: {
  [baseModel.id]: { compat: { supportsMidConvoEffort: true, supportsMidConvoSystemMessages: true, supportsMidConvoToolChanges: true } },
} } } }));
const deployed = join(process.env.PI_CODING_AGENT_DIR, "extensions/omp-anthropic-route");
mkdirSync(deployed, { recursive: true });
for (const name of ["index.ts", "transport.ts", "omp-compat.ts", "omp-token.ts", "bun-fetch.ts", "bun-fetch-bridge.ts"]) {
  symlinkSync(join(source, name), join(deployed, name));
}

async function fixture(options = {}) {
  const credentials = new ai.InMemoryCredentialStore();
  await credentials.modify("anthropic", async () => options.apiKey ? { type: "api_key", key: "sk-ant-api-synthetic" }
    : { type: "oauth", access: "sk-ant-oat-synthetic-pi", refresh: "synthetic", expires: Date.now() + 3_600_000 });
  if (options.otherProvider) await credentials.modify("openai", async () => ({ type: "api_key", key: "synthetic-openai" }));
  const fixtureModelsPath = join(mkdtempSync(join(root, "models-")), "models.json");
  const config = JSON.parse(readFileSync(modelsPath, "utf8"));
  if (options.baseUrl) config.providers.anthropic.baseUrl = options.baseUrl;
  writeFileSync(fixtureModelsPath, JSON.stringify(config));
  const models = await sdk.ModelRuntime.create({ credentials, modelsPath: fixtureModelsPath, modelsStore: new ai.InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
  const model = options.otherProvider ? models.getModels("openai")[0]
    : { ...models.getModel("anthropic", options.id ?? baseModel.id), ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}) };
  const settings = sdk.SettingsManager.inMemory({ retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: 5000 } }, compaction: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({
    cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager: settings,
    noExtensions: true, additionalExtensionPaths: [join(deployed, "index.ts")],
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    systemPromptOverride: () => "Synthetic fixture only",
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const executed = [];
  const { session } = await sdk.createAgentSession({
    cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, resourceLoader: loader,
    settingsManager: settings, modelRuntime: models, model, thinkingLevel: "high",
    tools: ["read", "mcp_search"], customTools: ["read", "mcp_search"].map(name => ({
      name, label: name, description: "Synthetic no-I/O tool", parameters: ai.Type.Object({}),
      execute: async () => { executed.push(name); return { content: [{ type: "text", text: "synthetic tool result" }] }; },
    })), sessionManager: sdk.SessionManager.inMemory(root),
  });
  const errors = [];
  const notices = [];
  await session.bindExtensions({ mode: "json", onError: error => errors.push(error),
    uiContext: { notify: (message, type) => notices.push({ message, type }) },
  });
  return { session, models, model, executed, errors, notices, async close() { await session.abort(); session.dispose(); } };
}

test("native Pi loads the linked route, executes tools, changes tools/thinking, follows up and reloads", { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    f.session.setActiveToolsByName(["read"]);
    writeFileSync(modeFile, "read");
    await f.session.prompt("First synthetic request");
    assert.equal(f.session.messages.at(-1).stopReason, "stop", f.session.messages.at(-1).errorMessage);
    assert.deepEqual(f.executed, ["read"]);
    assert.ok(lines(requestLog).at(-1).body.tools.some(tool => tool.name === "_read"), "native normalized tool declarations must reach the route");
    f.session.setActiveToolsByName(["mcp_search"]);
    f.session.setThinkingLevel("low");
    writeFileSync(modeFile, "mcp_search");
    await f.session.prompt("Second synthetic request");
    assert.equal(f.session.messages.at(-1).stopReason, "stop", f.session.messages.at(-1).errorMessage);
    assert.deepEqual(f.executed, ["read", "mcp_search"]);
    const body = lines(requestLog).at(-1).body;
    const changes = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(b => b.type === "tool_addition" || b.type === "tool_removal");
    assert.ok(changes.some(b => b.type === "tool_addition" && b.tool.name === "_mcp_search"));
    assert.ok(changes.some(b => b.type === "tool_removal" && b.tool.name === "_read"));
    assert.equal(body.output_config.effort, "low");
    assert.ok(!body.messages.some(message => message.output_config));
    assert.equal(f.session.model.compat.supportsMidConvoEffort, true, "only the per-request copy is restricted");
    assert.equal(body.messages.filter(m => m.role === "assistant").flatMap(m => m.content).find(b => b.type === "tool_use").name, "_read");
    const beforeStatus = structuredClone(f.session.messages);
    const requestsBeforeStatus = lines(requestLog).length;
    await f.session.prompt("/omp-anthropic-route");
    assert.deepEqual(f.session.messages, beforeStatus);
    assert.equal(lines(requestLog).length, requestsBeforeStatus);
    for (let reload = 0; reload < 2; reload++) {
      await f.session.reload();
      await f.session.prompt("Follow up after reload");
      assert.equal(f.session.messages.at(-1).stopReason, "stop", f.session.messages.at(-1).errorMessage);
      assert.ok(!lines(requestLog).at(-1).body.tools.some(t => t.name === "__read" || t.name === "__mcp_search"));
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("Opus 5.5 startup verifies once; status is passive, subsequent requests reuse the check, reload rechecks", async () => {
  const requestsBefore = lines(requestLog).length, releasesBefore = lines(releaseLog).length;
  const f = await fixture({ id: "claude-opus-5-5" });
  try {
    assert.equal(f.model.id, "claude-opus-5-5");
    assert.equal(lines(releaseLog).length, releasesBefore + 1);
    assert.equal(lines(requestLog).length, requestsBefore + 1);
    const probe = lines(requestLog).at(-1);
    assert.equal(probe.body.model, f.model.id);
    assert.equal(probe.body.max_tokens, 512);
    assert.equal(probe.body.tools.length, 0);
    assert.equal(probe.headers.authorization, "Bearer sk-ant-oat-synthetic-omp");
    assert.match(probe.headers['user-agent'], /2\.1\.280/);
    assert.match(probe.body.system[0].text, /cc_version=2\.1\.280\./);
    assert.doesNotMatch(JSON.stringify(probe.body), /Synthetic fixture only|synthetic tool result/);
    assert.deepEqual(f.session.messages, [], "probe must not enter the conversation");
    const commandsBeforeStatus = lines(commandLog).length;
    for (let invocation = 0; invocation < 2; invocation++) {
      await f.session.prompt("/omp-anthropic-route");
      const notice = f.notices.at(-1);
      assert.equal(notice.type, "info");
      assert.match(notice.message, /active \(startup verified\)/);
      assert.match(notice.message, /Live model test: passed; served claude-opus-5-5/);
      assert.match(notice.message, /Reviewed pair: OMP 18\.3\.1 \/ Claude Code 2\.1\.280/);
      assert.match(notice.message, /Latest OMP release: 18\.3\.1/);
    }
    assert.equal(lines(commandLog).length, commandsBeforeStatus);
    assert.equal(lines(requestLog).length, requestsBefore + 1);
    assert.deepEqual(f.session.messages, []);
    await f.session.prompt("User request");
    assert.equal(f.session.messages.at(-1).stopReason, "stop");
    assert.equal(lines(requestLog).length, requestsBefore + 2);
    await f.session.reload();
    assert.equal(lines(releaseLog).length, releasesBefore + 2);
    assert.equal(lines(requestLog).length, requestsBefore + 3);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const mode of ["reject", "wrong-model", "bad-reply"]) test(`failed startup ${mode} blocks user inference without retry/fallback`, async () => {
  writeFileSync(probeModeFile, mode);
  const before = lines(requestLog).length;
  const f = await fixture({ id: "claude-opus-5-5" });
  try {
    assert.match(f.notices.at(-1).message, /startup test failed/);
    assert.equal(lines(requestLog).length, before + 1);
    await f.session.prompt("Do not send this after a failed preflight");
    assert.equal(f.session.messages.at(-1).stopReason, "error");
    assert.match(f.session.messages.at(-1).errorMessage, /startup test failed/);
    assert.equal(lines(requestLog).length, before + 1);
  } finally { await f.close(); writeFileSync(probeModeFile, "pass"); }
});

test("unreviewed latest release blocks before token lookup or model requests even with matching local pins", async () => {
  writeFileSync(releaseFile, "18.3.2");
  const before = lines(requestLog).length, commandsBefore = lines(commandLog).length;
  const f = await fixture();
  try {
    assert.match(f.notices.at(-1).message, /needs protocol review/);
    await f.session.prompt("Must not reach Anthropic");
    assert.equal(f.session.messages.at(-1).stopReason, "error");
    assert.equal(lines(requestLog).length, before);
    assert.equal(lines(commandLog).length, commandsBefore);
  } finally { await f.close(); writeFileSync(releaseFile, "18.3.1"); }
});

for (const options of [{ apiKey: true }, { baseUrl: "https://proxy.invalid" }, { baseUrl: "http://api.anthropic.com" }, { otherProvider: true }]) {
  test(`startup bypass has no update or probe effects: ${JSON.stringify(options)}`, async () => {
    const requestsBefore = lines(requestLog).length, commandsBefore = lines(commandLog).length, releasesBefore = lines(releaseLog).length;
    const f = await fixture(options);
    try {
      await f.session.prompt("/omp-anthropic-route");
      assert.match(f.notices.at(-1).message, /standby/);
      assert.equal(lines(requestLog).length, requestsBefore);
      assert.equal(lines(commandLog).length, commandsBefore);
      assert.equal(lines(releaseLog).length, releasesBefore);
    } finally { await f.close(); }
  });
}

test("selecting Claude later triggers one preflight and returning to it does not retest", async () => {
  const f = await fixture({ otherProvider: true });
  const before = lines(requestLog).length;
  try {
    const opus = f.models.getModel("anthropic", "claude-opus-5-5");
    await f.session.setModel(opus);
    assert.equal(lines(requestLog).length, before + 1);
    await f.session.setModel(f.model);
    await f.session.setModel(opus);
    assert.equal(lines(requestLog).length, before + 1);
  } finally { await f.close(); }
});

test("both stream entrypoints use the selected request-level effort without mutating model or history", async () => {
  const f = await fixture();
  try {
    const context = { messages: [
      { role: "system", content: "Synthetic instructions", timestamp: 0 },
      { role: "user", content: "First", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "Prior answer" }], api: f.model.api,
        provider: "anthropic", model: f.model.id, providerThinkingLevel: "high", stopReason: "stop",
        timestamp: 2, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } },
      { role: "user", content: "Follow-up", timestamp: 3 },
    ] };
    const before = structuredClone(context);
    for (const method of ["stream", "streamSimple"]) {
      const result = await f.models[method](f.model, context, { maxTokens: 512, maxRetries: 0,
        ...(method === "stream" ? { effort: "low", thinkingEnabled: true } : { reasoning: "low" }),
      }).result();
      assert.equal(result.stopReason, "stop", result.errorMessage);
      const request = lines(requestLog).at(-1);
      assert.equal(request.body.output_config.effort, "low");
      assert.equal(request.body.thinking.type, "adaptive");
      assert.ok(!request.body.messages.some(message => message.output_config));
      assert.doesNotMatch(request.headers["anthropic-beta"], /mid-conversation-output-config|thinking-binding-controls/);
      assert.equal(f.model.compat.supportsMidConvoEffort, true);
      assert.deepEqual(context, before);
    }
  } finally { await f.close(); }
});

test("all bundled Anthropic models stream with low/high reasoning through the registered route", { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    for (const model of f.models.getModels("anthropic")) {
      for (const reasoning of ["low", "high"]) {
        const result = await f.models.completeSimple(model, {
          messages: [{ role: "user", content: "Synthetic catalog smoke", timestamp: 0 }],
        }, { reasoning, maxTokens: 2048, maxRetries: 0 });
        assert.equal(result.stopReason, "stop", `${model.id}/${reasoning}: ${result.errorMessage}`);
        assert.equal(result.content[0].text, "fixture ok");
        const request = lines(requestLog).at(-1);
        assert.equal(request.body.model, model.id);
        assert.equal(request.headers.authorization, "Bearer sk-ant-oat-synthetic-omp");
        assert.ok(request.body.max_tokens <= 64_000);
        if (request.body.thinking?.type === "enabled") assert.ok(request.body.max_tokens > request.body.thinking.budget_tokens);
      }
    }
  } finally { await f.close(); }
});

for (const [label, baseUrl, apiKey] of [
  ["proxy OAuth", "https://proxy.invalid", "sk-ant-oat-synthetic-pi"],
  ["insecure endpoint", "http://api.anthropic.com", "sk-ant-oat-synthetic-pi"],
  ["direct API key", "https://api.anthropic.com", "sk-ant-api-synthetic"],
]) {
  test(`${label}: runtime preserves the caller's credential and does not run OMP token lookup`, async () => {
    const f = await fixture();
    try {
      for (const method of ["stream", "streamSimple"]) {
        const start = lines(commandLog).filter(args => args[0] === "token").length;
        let observed;
        const result = await f.models[method]({ ...f.model, baseUrl }, { messages: [{ role: "user", content: "synthetic", timestamp: 0 }] }, {
          apiKey, maxTokens: 128, fetch: async (_input, init) => {
            observed = new Headers(init.headers);
            return Response.json({ type: "error", error: { type: "invalid_request_error", message: "synthetic stop" } }, { status: 400 });
          }, maxRetries: 0,
        }).result();
        assert.equal(result.stopReason, "error");
        assert.match(result.errorMessage, /synthetic stop/);
        assert.equal(lines(commandLog).filter(args => args[0] === "token").length, start, "unexpected OMP credential lookup");
        if (apiKey.includes("oat")) assert.equal(observed.get("authorization"), `Bearer ${apiKey}`);
        else assert.equal(observed.get("x-api-key"), apiKey);
      }
    } finally { await f.close(); }
  });
}
