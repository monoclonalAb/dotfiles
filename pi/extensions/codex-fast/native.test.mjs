import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';

// Resolve installed code before isolating HOME and removing credential-bearing env.
const packageDir = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const root = mkdtempSync(join(tmpdir(), 'codex-fast-native-'));
const path = process.env.PATH;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, { HOME: root, PATH: path, PI_CODING_AGENT_DIR: join(root, 'agent'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1' });
mkdirSync(process.env.PI_CODING_AGENT_DIR);
after(() => rmSync(root, { recursive: true, force: true }));
const sdk = await import(pathToFileURL(join(packageDir, 'dist/index.js')));
const ai = await import(pathToFileURL(join(packageDir, 'node_modules/@earendil-works/pi-ai/dist/index.js')));
const { WebSocketServer } = await import(pathToFileURL(join(packageDir, 'node_modules/ws/wrapper.mjs')));
const codexApi = await import(pathToFileURL(join(packageDir, 'node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js')));
const extensionPath = fileURLToPath(new URL('index.ts', import.meta.url));
const syntheticToken = `test.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'fixture' } })).toString('base64url')}.test`;

function responseEvents(body, anthropic) {
  if (anthropic) return [
    { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  return [{ type: 'response.completed', response: {
    id: 'resp_test', status: 'completed', service_tier: body.service_tier ?? 'default',
    output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  } }];
}

async function fixture(transport) {
  const requests = [], before = [], errors = [];
  let session;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let data = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'zstd') data = zstdDecompressSync(data);
      const body = JSON.parse(data.toString());
      requests.push({ transport: 'sse', body, headers: req.headers });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of responseEvents(body, req.url.includes('/messages'))) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  const ws = new WebSocketServer({ server });
  ws.on('connection', socket => socket.on('message', data => {
    const body = JSON.parse(data.toString());
    requests.push({ transport: 'websocket', body });
    for (const event of responseEvents(body, false)) socket.send(JSON.stringify(event));
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    if (session) {
      await session.abort();
      codexApi.closeOpenAICodexWebSocketSessions(session.sessionId);
      session.dispose();
    }
    for (const client of ws.clients) client.terminate();
    await new Promise(resolve => ws.close(resolve));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  try {
    const models = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, modelsStore: new ai.InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false });
    for (const [provider, api, id] of [
      ['openai-codex', 'openai-codex-responses', 'gpt-6-astra'],
      ['openai', 'openai-responses', 'gpt-6-astra'],
      ['anthropic', 'anthropic-messages', 'claude-opus-5'],
    ]) {
      const nativeApi = await import(pathToFileURL(join(packageDir, `node_modules/@earendil-works/pi-ai/dist/api/${api}.js`)));
      models.registerProvider(provider, {
        api, baseUrl: `${baseUrl}/v1`, apiKey: provider === 'openai-codex' ? syntheticToken : 'synthetic-test-key',
        models: [{ id, name: id, reasoning: true, input: ['text'], contextWindow: 272000, maxTokens: 2048, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }],
        streamSimple(model, context, options) {
          return nativeApi.streamSimple(model, context, { ...options, onPayload: async (payload, model) => {
            before.push(JSON.parse(JSON.stringify(payload)));
            const result = await options.onPayload?.(payload, model);
            if (model.provider !== 'openai-codex') assert.equal(result, payload);
            return result;
          } });
        },
      });
    }
    const settings = sdk.SettingsManager.inMemory({ transport, retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: 5000 } }, compaction: { enabled: false } });
    const loader = new sdk.DefaultResourceLoader({
      cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager: settings,
      noExtensions: true, additionalExtensionPaths: [extensionPath],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => 'Synthetic system prompt: do not change.',
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await sdk.createAgentSession({
      cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, resourceLoader: loader,
      settingsManager: settings, modelRuntime: models, model: models.getModel('openai-codex', 'gpt-6-astra'),
      thinkingLevel: 'low', tools: [], sessionManager: sdk.SessionManager.inMemory(root),
    }));
    await session.bindExtensions({ mode: 'json', onError: error => errors.push(error) });
    return { session, requests, before, errors, models, close };
  } catch (error) { await close(); throw error; }
}

for (const transport of ['sse', 'websocket', 'websocket-cached']) {
  test(`native Pi command → Codex ${transport} wire tier; off/reload/provider isolation`, { timeout: 20000 }, async () => {
    const f = await fixture(transport);
    try {
      const prompt = async expectedTier => {
        const count = f.requests.length;
        await f.session.prompt('Synthetic request');
        assert.equal(f.requests.length, count + 1);
        assert.equal(f.session.messages.at(-1).stopReason, 'stop', f.session.messages.at(-1).errorMessage);
        const { body, transport: actualTransport } = f.requests.at(-1);
        assert.equal(body.service_tier, expectedTier);
        if (f.session.model.provider === 'openai-codex') {
          assert.equal(actualTransport, transport === 'sse' ? 'sse' : 'websocket');
          // Crossing a tier boundary must not reuse cached WebSocket input.
          assert.equal(body.previous_response_id, undefined);
        }
        // Compare wire payload with the native body before extension hooks. Only tier and
        // the WebSocket envelope are allowed to differ; context/reasoning/tools stay exact.
        const { type, ...wire } = body;
        const expected = { ...f.before.at(-1) };
        if (f.session.model.provider === 'anthropic') {
          // Anthropic's SDK moves the native `betas` field into an HTTP header.
          for (const beta of expected.betas ?? []) assert(f.requests.at(-1).headers['anthropic-beta'].includes(beta));
          delete expected.betas;
        }
        assert.deepEqual(wire, expectedTier ? { ...expected, service_tier: expectedTier } : expected);
      };
      await prompt(undefined);
      const commandsOnly = f.requests.length;
      const messages = structuredClone(f.session.messages);
      await f.session.prompt('/fast');
      await f.session.prompt('/fast status');
      assert.equal(f.requests.length, commandsOnly);
      assert.deepEqual(f.session.messages, messages);
      await prompt('priority');
      await f.session.prompt('/fast off');
      await prompt(undefined);
      await f.session.prompt('/fast on');
      await prompt('priority');
      await f.session.reload();
      await prompt(undefined);
      for (const [provider, id] of [['anthropic', 'claude-opus-5'], ['openai', 'gpt-6-astra']]) {
        await f.session.prompt('/fast on');
        await prompt('priority');
        await f.session.setModel(f.models.getModel(provider, id));
        await f.session.prompt('/fast on');
        await prompt(undefined);
        await f.session.setModel(f.models.getModel('openai-codex', 'gpt-6-astra'));
        await prompt(undefined);
      }
      assert.equal(f.session.thinkingLevel, 'low');
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
