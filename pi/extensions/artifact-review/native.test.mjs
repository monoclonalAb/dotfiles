// node --test pi/extensions/artifact-review/native.test.mjs
//
// A real Pi SDK session (isolated HOME, synthetic provider) with this extension
// loaded: /artifact-review serves a page, notes posted the way the review page
// posts them reach the model as the user's message, at once when Pi is idle
// and after the current run when it is busy, and /reload ends the review.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve installed code before isolating HOME.
const packageDir = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'artifact-review-native-')));
const path = process.env.PATH;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, {
  HOME: root, PATH: path, PI_CODING_AGENT_DIR: join(root, 'agent'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1',
  PI_ARTIFACT_REVIEW_NO_OPEN: '1',
});
mkdirSync(process.env.PI_CODING_AGENT_DIR);
after(() => rmSync(root, { recursive: true, force: true }));
const sdk = await import(pathToFileURL(join(packageDir, 'dist/index.js')));
const ai = await import(pathToFileURL(join(packageDir, 'node_modules/@earendil-works/pi-ai/dist/index.js')));
const extensionPath = fileURLToPath(new URL('index.ts', import.meta.url));

const PROVIDER = 'anthropic';
const MODEL = 'claude-opus-5-5';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assistantMessage(model, text) {
  return {
    role: 'assistant', content: [{ type: 'text', text }], api: model.api ?? 'anthropic-messages', provider: model.provider, model: model.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  };
}

const userText = (message) => (typeof message.content === 'string' ? message.content : message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n'));

async function waitFor(check, what, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('notes from the review page reach the model as the user message, idle or busy', { timeout: 30000 }, async () => {
  let session;
  let reloaded = false;
  try {
    const folder = join(root, 'artifacts', '2026-11-25-demo');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'index.html'), '<!doctype html><title>Demo</title><body><h1>Demo</h1></body>');
    writeFileSync(join(folder, 'artifact.json'), JSON.stringify({ title: 'Demo page', project: root }));

    const models = await sdk.ModelRuntime.create({
      credentials: new ai.InMemoryCredentialStore(), modelsPath: null,
      modelsStore: new ai.InMemoryModelsStore(), allowModelNetwork: false, refreshOnCreate: false,
    });
    const requests = []; // the last user message the model saw on each call
    models.registerProvider(PROVIDER, {
      api: 'anthropic-messages', baseUrl: 'http://127.0.0.1:1', apiKey: 'synthetic-test-key',
      models: [{ id: MODEL, name: MODEL, reasoning: false, input: ['text'], contextWindow: 272000, maxTokens: 2048, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }],
      streamSimple(model, context) {
        const last = [...context.messages].reverse().find((message) => message.role === 'user');
        requests.push(userText(last));
        const stream = ai.createAssistantMessageEventStream();
        (async () => {
          const reply = assistantMessage(model, `reply ${requests.length}`);
          stream.push({ type: 'start', partial: reply });
          // The first reply is slow, so notes can arrive while Pi is busy.
          await sleep(requests.length === 2 ? 800 : 10);
          stream.push({ type: 'done', reason: 'stop', message: reply });
        })();
        return stream;
      },
    });
    const settings = sdk.SettingsManager.inMemory({ retry: { enabled: false, provider: { maxRetries: 0, timeoutMs: 5000 } }, compaction: { enabled: false } });
    const loader = new sdk.DefaultResourceLoader({
      cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager: settings,
      noExtensions: true, additionalExtensionPaths: [extensionPath],
      noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      systemPromptOverride: () => 'Synthetic system prompt.',
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    ({ session } = await sdk.createAgentSession({
      cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, resourceLoader: loader, settingsManager: settings,
      modelRuntime: models, model: models.getModel(PROVIDER, MODEL), thinkingLevel: 'off', tools: [],
      sessionManager: sdk.SessionManager.inMemory(root),
    }));
    const notifications = [], statuses = [], errors = [], confirms = [];
    let confirmAnswer = false;
    const noop = () => {};
    await session.bindExtensions({
      mode: 'tui', onError: (error) => errors.push(error),
      uiContext: {
        select: async (title, options) => {
          if (!options.includes('Keep them on the page')) return undefined;
          confirms.push(title);
          return confirmAnswer ? options[1] : options[0];
        },
        confirm: async () => true, input: async () => undefined, editor: async () => undefined, custom: async () => undefined,
        notify: (text) => notifications.push(text), onTerminalInput: () => noop, setStatus: (key, value) => key === 'artifact-review' && statuses.push(value),
        setWorkingMessage: noop, setWorkingVisible: noop, setWorkingIndicator: noop, setHiddenThinkingLabel: noop, setWidget: noop, setFooter: noop,
        setHeader: noop, setTitle: noop, theme: { fg: (_color, text) => text, bold: (text) => text },
      },
    });

    // The command adds nothing to the conversation and asks no model.
    await session.prompt(`/artifact-review ${folder}`);
    assert.deepEqual(errors, []);
    assert.equal(session.messages.filter((message) => message.role !== 'system').length, 0);
    assert.equal(requests.length, 0);
    const url = notifications.join('\n').match(/http:\/\/127\.0\.0\.1:\d+\/[\w-]+\/index\.html/)?.[0];
    assert.ok(url, `no review address in ${JSON.stringify(notifications)}`);
    assert.deepEqual(statuses, ['reviewing 2026-11-25-demo']);
    const page = await (await fetch(url)).text();
    assert.match(page, /<script src="\/[\w-]+\/__review\/overlay\.js" defer><\/script><\/body>/);

    const post = async (note, status = 200) => {
      const response = await fetch(new URL('__review/notes', url), {
        method: 'POST', headers: { origin: new URL(url).origin, 'content-type': 'application/json' },
        body: JSON.stringify({ notes: [{ kind: 'element', note, target: { tag: 'h1', selector: 'h1', text: 'Demo' }, screen: { hash: 'tab=2' } }] }),
      });
      assert.equal(response.status, status);
      return response.json();
    };

    // Declined in Pi: nothing reaches the conversation or the model.
    const declined = await post('unasked note from a page script', 400);
    assert.equal(declined.ok, false);
    assert.match(confirms[0], /unasked note from a page script/);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(requests.length, 0);
    assert.equal(session.messages.filter((message) => message.role !== 'system').length, 0);
    confirmAnswer = true;

    // Idle: the note starts a turn at once.
    const idle = await post('make the title bigger');
    assert.equal(idle.queued, false);
    await waitFor(() => requests.length === 1 && !session.isStreaming, 'the first reply');
    const expected = [
      `A note from reviewing the page "Demo page" in the browser.`,
      `File: ${join(folder, 'index.html')}`,
      `Project: ${root}`,
      '',
      '1. On a h1 "Demo"',
      '   Showing: address #tab=2',
      '   CSS: h1',
      '   make the title bigger',
    ].join('\n');
    assert.ok(requests[0].startsWith(expected), `model saw:\n${requests[0]}`);
    assert.equal(idle.text, requests[0], 'the page gets the exact message for its Copy button');
    const turns = () => session.messages.filter((message) => message.role !== 'system');
    assert.equal(turns()[0].role, 'user');
    assert.equal(userText(turns()[0]), requests[0]);

    // Busy: the note waits for the current run, then goes as a follow-up.
    const running = session.prompt('Synthetic typed request');
    await waitFor(() => requests.length === 2, 'the slow reply to start');
    const busy = await post('and the subtitle');
    assert.equal(busy.queued, true);
    assert.equal(requests.length, 2, 'a busy Pi must not get the note mid-reply');
    await running;
    await waitFor(() => requests.length === 3 && !session.isStreaming, 'the follow-up');
    assert.match(requests[2], /\n   and the subtitle\n/);
    assert.deepEqual(turns().map((message) => message.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
    assert.deepEqual(errors, []);

    // /reload (any session end) closes the review.
    await session.reload();
    reloaded = true;
    await assert.rejects(fetch(url));
  } finally {
    // A failed run still ends the review, so its server cannot keep Node alive.
    if (session && !reloaded) { await session.abort(); await session.reload().catch(() => {}); }
    if (session) { await session.abort(); session.dispose(); }
  }
});
