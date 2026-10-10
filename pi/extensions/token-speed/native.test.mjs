import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve installed code before isolating HOME.
const packageDir = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const root = mkdtempSync(join(tmpdir(), 'token-speed-native-'));
const path = process.env.PATH;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, { HOME: root, PATH: path, PI_CODING_AGENT_DIR: join(root, 'agent'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1' });
mkdirSync(process.env.PI_CODING_AGENT_DIR);
after(() => rmSync(root, { recursive: true, force: true }));
const sdk = await import(pathToFileURL(join(packageDir, 'dist/index.js')));
const ai = await import(pathToFileURL(join(packageDir, 'node_modules/@earendil-works/pi-ai/dist/index.js')));
const extensionPath = fileURLToPath(new URL('index.ts', import.meta.url));

const PROVIDER = 'anthropic';
const MODEL = 'claude-opus-5-5';
const OUTPUT_TOKENS = 12;
// A synthetic reply that takes half a second, so the footer rate is a normal number.
const REPLY_DELAY_MS = 500;

function assistantMessage(model, text) {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api ?? 'anthropic-messages',
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1, output: OUTPUT_TOKENS, cacheRead: 0, cacheWrite: 0, totalTokens: 1 + OUTPUT_TOKENS,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

function noOpUi(statuses, notifications) {
  const noop = () => {};
  return {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    editor: async () => undefined,
    custom: async () => undefined,
    notify: (text) => notifications.push(text),
    onTerminalInput: () => noop,
    setStatus: (key, value) => statuses.set(key, value),
    setWorkingMessage: noop,
    setWorkingVisible: noop,
    setWorkingIndicator: noop,
    setHiddenThinkingLabel: noop,
    setWidget: noop,
    setFooter: noop,
    setHeader: noop,
    setTitle: noop,
    theme: { fg: (_color, text) => text, bold: (text) => text },
  };
}

test('native Pi times replies, shows the footer rate, and /tps adds no context', { timeout: 20000 }, async () => {
  let session;
  try {
    const models = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(), modelsPath: null,
      modelsStore: new ai.InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false,
    });
    models.registerProvider(PROVIDER, {
      api: 'anthropic-messages', baseUrl: 'http://127.0.0.1:1', apiKey: 'synthetic-test-key',
      models: [{ id: MODEL, name: MODEL, reasoning: false, input: ['text'], contextWindow: 272000, maxTokens: 2048, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }],
      async streamSimple(model) {
        const stream = ai.createAssistantMessageEventStream();
        const start = assistantMessage(model, '');
        const end = assistantMessage(model, 'ok');
        stream.push({ type: 'start', partial: start });
        await new Promise((resolve) => setTimeout(resolve, REPLY_DELAY_MS));
        stream.push({ type: 'text_delta', contentIndex: 0, delta: 'ok', partial: end });
        stream.push({ type: 'done', reason: 'stop', message: end });
        return stream;
      },
    });
    const settings = sdk.SettingsManager.inMemory({
      retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: 5000 } }, compaction: { enabled: false },
    });
    const loader = new sdk.DefaultResourceLoader({
      cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager: settings,
      noExtensions: true, additionalExtensionPaths: [extensionPath],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => 'Synthetic system prompt: do not change.',
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await sdk.createAgentSession({
      cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, resourceLoader: loader, settingsManager: settings,
      modelRuntime: models, model: models.getModel(PROVIDER, MODEL),
      thinkingLevel: 'off', tools: [], sessionManager: sdk.SessionManager.inMemory(root),
    }));
    const statuses = new Map(), notifications = [], errors = [];
    await session.bindExtensions({ mode: 'tui', onError: (error) => errors.push(error), uiContext: noOpUi(statuses, notifications) });

    await session.prompt('Synthetic request');
    const reply = session.messages.at(-1);
    assert.equal(reply.role, 'assistant');
    assert.equal(reply.stopReason, 'stop', reply.errorMessage);
    assert.equal(reply.usage.output, OUTPUT_TOKENS, 'synthetic usage must reach the session');
    assert.ok(reply.durationMs >= REPLY_DELAY_MS, `Pi must time the reply (got ${reply.durationMs}ms)`);
    const rate = statuses.get('token-speed');
    assert.match(rate ?? '', /^\d+(\.\d+)? tok\/s$/, `unexpected footer status: ${rate}`);

    const messagesBefore = structuredClone(session.messages);
    await session.prompt('/tps');
    assert.equal(session.messages.length, messagesBefore.length, '/tps must not add model context');
    assert.match(notifications.at(-1), /Last reply: \d+(\.\d+)? tok\/s \(12 output tokens in 0\.\ds, anthropic\/claude-opus-5-5\)/);
    assert.match(notifications.at(-1), /Session: \d+(\.\d+)? tok\/s over 1 reply/);
    assert.deepEqual(errors, []);
  } finally {
    if (session) { await session.abort(); session.dispose(); }
    rmSync(root, { recursive: true, force: true });
  }
});