import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
// Gaps between streamed chunks, longer than the footer's 500 ms throttle, so
// each reply shows at least one live estimate before it ends.
const CHUNK_DELAY_MS = 600;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assistantMessage(model, content, stopReason) {
  return {
    role: 'assistant',
    content,
    api: model.api ?? 'anthropic-messages',
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1, output: OUTPUT_TOKENS, cacheRead: 0, cacheWrite: 0, totalTokens: 1 + OUTPUT_TOKENS,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: Date.now(),
  };
}

function noOpUi(history, notifications) {
  const noop = () => {};
  return {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    editor: async () => undefined,
    custom: async () => undefined,
    notify: (text) => notifications.push(text),
    onTerminalInput: () => noop,
    setStatus: (key, value) => { if (key === 'token-speed') history.push(value); },
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

// Same rounding and leading bar as the footer.
function exact(message) {
  const tps = message.usage.output / (message.durationMs / 1000);
  return `| ${tps >= 10 ? Math.round(tps) : Math.round(tps * 10) / 10} tok/s`;
}

const LIVE = /^\| ~\d+(\.\d+)? tok\/s$/;

test('native Pi streams a live estimate, shows exact rates between and after replies, and /tps adds no context', { timeout: 30000 }, async () => {
  let session;
  try {
    writeFileSync(join(root, 'note.txt'), 'synthetic note\n');
    const models = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(), modelsPath: null,
      modelsStore: new ai.InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false,
    });
    let calls = 0;
    models.registerProvider(PROVIDER, {
      api: 'anthropic-messages', baseUrl: 'http://127.0.0.1:1', apiKey: 'synthetic-test-key',
      models: [{ id: MODEL, name: MODEL, reasoning: false, input: ['text'], contextWindow: 272000, maxTokens: 2048, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }],
      async streamSimple(model) {
        const call = ++calls;
        const stream = ai.createAssistantMessageEventStream();
        (async () => {
          const start = assistantMessage(model, [], 'stop');
          stream.push({ type: 'start', partial: start });
          await sleep(CHUNK_DELAY_MS);
          const text = 'x'.repeat(40);
          const written = assistantMessage(model, [{ type: 'text', text }], 'stop');
          stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: written });
          await sleep(CHUNK_DELAY_MS);
          if (call === 1) {
            // First reply: ask Pi's built-in read tool for a file, then stop.
            const toolCall = { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'note.txt' } };
            const args = JSON.stringify(toolCall.arguments);
            const end = assistantMessage(model, [{ type: 'text', text }, toolCall], 'toolUse');
            stream.push({ type: 'toolcall_delta', contentIndex: 1, delta: args, partial: end });
            stream.push({ type: 'toolcall_end', contentIndex: 1, toolCall, partial: end });
            stream.push({ type: 'done', reason: 'toolUse', message: end });
          } else {
            const end = assistantMessage(model, [{ type: 'text', text: text + ' ok' }], 'stop');
            stream.push({ type: 'text_delta', contentIndex: 0, delta: ' ok', partial: end });
            stream.push({ type: 'done', reason: 'stop', message: end });
          }
        })();
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
      thinkingLevel: 'off', tools: ['read'], sessionManager: sdk.SessionManager.inMemory(root),
    }));
    const history = [], notifications = [], errors = [];
    await session.bindExtensions({ mode: 'tui', onError: (error) => errors.push(error), uiContext: noOpUi(history, notifications) });

    await session.prompt('Synthetic request');
    assert.deepEqual(errors, []);
    assert.equal(calls, 2, 'the tool call must lead to a second reply');
    const replies = session.messages.filter((message) => message.role === 'assistant');
    assert.equal(replies.length, 2);
    for (const reply of replies) {
      assert.equal(reply.usage.output, OUTPUT_TOKENS, 'synthetic usage must reach the session');
      assert.ok(reply.durationMs >= 2 * CHUNK_DELAY_MS, `Pi must time each reply (got ${reply.durationMs}ms)`);
    }
    const toolResult = session.messages.find((message) => message.role === 'toolResult');
    assert.equal(toolResult?.isError, false, 'the read tool must run');

    // Live estimate, then reply 1's exact rate while its tool runs, then a
    // live estimate for reply 2, then reply 2's exact rate.
    const firstLive = history.findIndex((value) => LIVE.test(value ?? ''));
    assert.ok(firstLive >= 0, `no live estimate in ${JSON.stringify(history)}`);
    const between = history.indexOf(exact(replies[0]), firstLive);
    assert.ok(between > firstLive, `reply 1's exact rate must follow its estimate: ${JSON.stringify(history)}`);
    const secondLive = history.findIndex((value, index) => index > between && LIVE.test(value ?? ''));
    assert.ok(secondLive > between, `reply 2 must stream a live estimate: ${JSON.stringify(history)}`);
    assert.equal(history.at(-1), exact(replies[1]));

    const messagesBefore = structuredClone(session.messages);
    await session.prompt('/tps');
    assert.equal(session.messages.length, messagesBefore.length, '/tps must not add model context');
    assert.match(notifications.at(-1), /Last reply: \d+(\.\d+)? tok\/s \(12 output tokens in \d+(\.\d)?s, anthropic\/claude-opus-5-5\)/);
    assert.match(notifications.at(-1), /Session: \d+(\.\d+)? tok\/s over 2 replies/);
    assert.deepEqual(errors, []);
  } finally {
    if (session) { await session.abort(); session.dispose(); }
    rmSync(root, { recursive: true, force: true });
  }
});
