import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

// Resolve installed code, then isolate all auth/config/history before importing Pi.
const pkg = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const root = mkdtempSync(join(tmpdir(), 'agent-stuff-native-'));
const source = fileURLToPath(new URL('.', import.meta.url));
const path = process.env.PATH;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, { HOME: root, PATH: path, PI_CODING_AGENT_DIR: join(root, 'agent'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1' });
const agentDir = process.env.PI_CODING_AGENT_DIR;
const deployed = join(agentDir, 'extensions/agent-stuff');
mkdirSync(deployed, { recursive: true });
for (const name of ['index.ts', 'answer.ts', 'btw.ts', 'goal.ts', 'review.ts', 'session-breakdown.ts']) symlinkSync(join(source, name), join(deployed, name));
after(() => rmSync(root, { recursive: true, force: true }));
const sdk = await import(pathToFileURL(join(pkg, 'dist/index.js')));
sdk.initTheme('dark', false);
const ai = await import(pathToFileURL(join(pkg, 'node_modules/@earendil-works/pi-ai/dist/index.js')));
const tui = await import(pathToFileURL(join(pkg, 'node_modules/@earendil-works/pi-tui/dist/index.js')));
const { createJiti } = await import(pathToFileURL(join(pkg, 'node_modules/jiti/lib/jiti.mjs')));
const jiti = createJiti(import.meta.url, { fsCache: false, alias: {
  '@earendil-works/pi-coding-agent': join(pkg, 'dist/index.js'),
  '@earendil-works/pi-ai': join(pkg, 'node_modules/@earendil-works/pi-ai/dist/index.js'),
  '@earendil-works/pi-tui': join(pkg, 'node_modules/@earendil-works/pi-tui/dist/index.js'),
  typebox: join(pkg, 'node_modules/typebox/build/index.mjs'),
} });
const answerModule = await jiti.import(join(source, 'answer.ts'));
const btwModule = await jiti.import(join(source, 'btw.ts'));
const breakdown = await jiti.import(join(source, 'session-breakdown.ts'));
const goalModule = await jiti.import(join(source, 'goal.ts'));
const reviewModule = await jiti.import(join(source, 'review.ts'));
const theme = { fg: (_c, text) => text, bg: (_c, text) => text, bold: text => text };
const fakeTui = { requestRender() {}, terminal: { columns: 80, rows: 40 } };
const { KeybindingsManager } = await import(pathToFileURL(join(pkg, 'dist/core/keybindings.js')));
const keybindings = new KeybindingsManager();
// Match Pi's host: native Editor consults the active TUI manager internally.
tui.setKeybindings(keybindings);
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(predicate, label = 'condition') {
  for (let i = 0; i < 500; i++) { if (predicate()) return; await tick(); }
  assert.fail(`Timed out waiting for ${label}`);
}
const text = content => typeof content === 'string' ? content : (content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n');
// Pi 0.87 providers receive a transcript whose system messages carry the prompt
// and tool changes; fold them back into the prompt/tools/messages view asserted here.
function flatten(context) {
  if (!context.messages?.some(m => m.role === 'system')) return context;
  const prompt = [], tools = new Map(), messages = [];
  for (const m of context.messages) {
    if (m.role !== 'system') { messages.push(m); continue; }
    prompt.push(text(m.content), ...Object.values(m.sections ?? {}).filter(Boolean));
    for (const t of m.toolsAdded ?? []) tools.set(t.name, t);
    for (const t of m.toolsRemoved ?? []) tools.delete(t.name);
  }
  return { systemPrompt: prompt.join('\n'), messages, tools: tools.size ? [...tools.values()] : undefined };
}
const reply = value => ai.fauxAssistantMessage(value);
const tool = (name, args) => ai.fauxAssistantMessage(ai.fauxToolCall(name, args), { stopReason: 'toolUse' });

async function fixture({ mode = 'tui', tools = ['read'], allowGoals = true, responses = [] } = {}) {
  const cwd = mkdtempSync(join(root, 'repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main', cwd]);
  writeFileSync(join(cwd, 'fixture.txt'), 'read-only evidence');
  const calls = [], errors = [], notices = [], dialogs = [], components = [], navigations = [];
  let draft = 'draft 日本';
  const faux = ai.fauxProvider({ provider: 'agent-stuff-test', models: [{ id: 'fixture', contextWindow: 200000 }], tokensPerSecond: 100000 });
  faux.setResponses(responses);
  const provider = { ...faux.provider, headers: { 'x-static-fixture': 'static' }, auth: { apiKey: {
    name: 'Synthetic only',
    resolve: async () => ({ auth: { apiKey: 'synthetic-key', headers: { 'x-auth-fixture': 'dynamic' }, baseUrl: 'http://127.0.0.1:1/unused' }, env: { FIXTURE: 'synthetic' } }),
  } } };
  for (const method of ['stream', 'streamSimple']) provider[method] = (model, context, options) => {
    calls.push({ model, context: flatten(JSON.parse(JSON.stringify(context))), method, auth: { apiKey: options?.apiKey, headers: options?.headers, env: options?.env } });
    return faux.provider[method](model, context, options);
  };
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, modelsStore: new ai.InMemoryModelsStore(), refreshOnCreate: false });
  modelRuntime.registerNativeProvider(provider);
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager: settings, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPromptOverride: () => 'Fixture system prompt. Preserve instructions.' });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  assert.equal(loader.getExtensions().extensions.length, 1);
  const sm = sdk.SessionManager.inMemory(cwd);
  const { session } = await sdk.createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager: settings, modelRuntime, model: faux.getModel(), thinkingLevel: 'off', tools: allowGoals ? [...tools, 'get_goal', 'create_goal', 'update_goal'] : tools, sessionManager: sm });
  const ui = {
    theme, notify: (message, level) => notices.push({ message, level }),
    setStatus() {}, setWidget() {}, setEditorText: value => { draft = value; }, getEditorText: () => draft,
    select: async (title, options) => { const value = dialogs.shift(); if (value !== undefined) assert(options.includes(value), `${title}: unexpected ${value}`); return value; },
    confirm: async () => dialogs.shift() === true,
    editor: async () => dialogs.shift(),
    custom: (factory, options) => new Promise((resolve, reject) => {
      let component, finished = false;
      const done = result => { if (finished) return; finished = true; component?.dispose?.(); resolve(result); };
      Promise.resolve(factory(fakeTui, theme, keybindings, done)).then(value => {
        component = value;
        components.push({ component, done, overlay: !!options?.overlay });
        if (finished) component?.dispose?.();
        options?.onHandle?.({ hide() {}, focus() {}, isFocused: () => true, setHidden() {} });
      }, reject);
    }),
  };
  await session.bindExtensions({ mode, uiContext: ui, onError: error => errors.push(error), commandContextActions: {
    waitForIdle: () => session.waitForIdle(),
    navigateTree: async (id, options) => { navigations.push({ id, options }); return session.navigateTree(id, options); },
  } });
  return { cwd, session, sm, calls, errors, notices, dialogs, components, navigations, faux, ui, loader,
    latestGoal: () => sm.getBranch().filter(e => e.type === 'custom' && e.customType === 'goal').at(-1)?.data.goal,
    async close() {
      await session.abort();
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      for (const view of components) view.done(null);
      session.dispose();
      assert.deepEqual(errors, []);
    },
  };
}

test('native discovery through Stow leaf links: six commands, no tools/context/default requests', async () => {
  const f = await fixture({ responses: [reply('ordinary response')] });
  try {
    const ext = f.loader.getExtensions().extensions[0];
    assert.deepEqual([...ext.commands.keys()].sort(), ['answer', 'btw', 'end-review', 'goal', 'review', 'session-breakdown']);
    assert(ext.shortcuts.has('ctrl+.'));
    assert.deepEqual(f.session.getActiveToolNames(), ['read']);
    assert.equal(f.calls.length, 0);
    await f.session.prompt('/goal');
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.session.messages, []);
    await f.session.prompt('ordinary task');
    assert.equal(f.calls.length, 1, JSON.stringify({ messages: f.session.messages, notices: f.notices }));
    assert(!f.calls[0].context.systemPrompt.includes('Active thread goal'));
    assert(!JSON.stringify(f.calls[0].context).includes('No goal is currently set'));
    assert.deepEqual(f.calls[0].context.tools.map(t => t.name), ['read']);
  } finally { await f.close(); }
});

test('goal opt-in, automatic continuation, completion and tool deactivation use native agent loop', async () => {
  const f = await fixture({ responses: [reply('one step done'), tool('update_goal', { status: 'complete' }), reply('objective achieved')] });
  try {
    await f.session.prompt('/goal achieve the fixture objective');
    await until(() => f.latestGoal()?.status === 'complete' && f.session.isIdle, 'goal completion').catch(error => {
      assert.fail(`${error.message}: ${JSON.stringify({ goal: f.latestGoal(), messages: f.session.messages, notices: f.notices, calls: f.calls.length })}`);
    });
    assert.equal(f.calls.length, 3);
    assert(f.calls[0].context.tools.some(t => t.name === 'get_goal'));
    assert(text(f.calls[0].context.messages[0].content).includes('achieve the fixture objective'));
    assert.equal(f.latestGoal().objective, 'achieve the fixture objective');
    assert(f.latestGoal().tokensUsed > 0);
    assert.deepEqual(f.session.getActiveToolNames(), ['read']);
    assert(!f.calls.some(c => c.context.messages.some(m => m.customType === 'goal-ui')));
    await f.session.prompt('/goal clear');
    assert.equal(f.latestGoal(), null);
    assert.equal(f.calls.length, 3);
  } finally { await f.close(); }
});

for (const stopReason of ['aborted', 'error']) test(`goal ${stopReason} stops without another automatic request; reload remains paused`, async () => {
  const f = await fixture({ responses: [ai.fauxAssistantMessage('', { stopReason, errorMessage: 'quota limit fixture' })] });
  try {
    await f.session.prompt('/goal do not loop past a stop');
    await until(() => f.calls.length && f.session.isIdle);
    assert.equal(f.calls.length, 1);
    assert.equal(f.latestGoal().status, stopReason === 'aborted' ? 'paused' : 'usageLimited');
    assert.deepEqual(f.session.getActiveToolNames(), ['read']);
    await f.session.reload();
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.session.getActiveToolNames(), ['read']);
  } finally { await f.close(); }
});

test('goal pause during a native request prevents settled continuation; resume and clear are explicit', async () => {
  let release;
  const f = await fixture({ responses: [() => new Promise(resolve => { release = () => resolve(reply('stopped step')); })] });
  try {
    await f.session.prompt('/goal work until paused');
    await until(() => release);
    await f.session.prompt('/goal pause');
    release();
    await until(() => f.session.isIdle);
    assert.equal(f.latestGoal().status, 'paused');
    assert.equal(f.calls.length, 1);
    f.faux.setResponses([tool('update_goal', { status: 'blocked' }), reply('Need permission')]);
    await f.session.prompt('/goal resume');
    await until(() => f.latestGoal()?.status === 'blocked' && f.session.isIdle);
    assert.equal(f.calls.length, 3);
    await f.session.prompt('/goal clear');
    assert.equal(f.latestGoal(), null);
  } finally { release?.(); await f.close(); }
});

test('review empty branch and /end-review return preserve original native session path', async () => {
  const f = await fixture({ responses: [reply('original response'), reply('## Findings\nNone.\n## Verdict\ncorrect')] });
  try {
    await f.session.prompt('original user task');
    const original = structuredClone(f.session.messages);
    f.dialogs.push('Empty branch');
    await f.session.prompt('/review folder "folder with spaces" docs --extra "Check failure handling"');
    await until(() => f.calls.length === 2 && f.session.isIdle);
    const request = f.calls[1].context;
    assert.equal(request.messages.filter(m => m.role === 'user').length, 1);
    assert(text(request.messages.at(-1).content).includes('folder with spaces, docs'));
    assert(text(request.messages.at(-1).content).includes('diff-only restrictions above do not apply'));
    assert(text(request.messages.at(-1).content).includes('Check failure handling'));
    f.dialogs.push('Return only');
    await f.session.prompt('/end-review');
    assert.deepEqual(f.session.messages, original);
    assert.equal(f.calls.length, 2);
    assert.equal(f.navigations.length, 2);
    await f.session.reload();
    assert.equal(f.calls.length, 2);
  } finally { await f.close(); }
});

for (const target of ['uncommitted', 'branch main', 'commit abc123']) test(`review target ${target} dispatch and summary return`, async () => {
  const f = await fixture({ responses: [reply('## Findings\n- [P2] Fixture finding'), reply('## Findings\nFixture summary')] });
  try {
    await f.session.prompt(`/review ${target}`);
    await until(() => f.calls.length === 1 && f.session.isIdle);
    const prompt = text(f.calls[0].context.messages.at(-1).content);
    assert(prompt.includes(target === 'uncommitted' ? 'staged, unstaged, and untracked' : target === 'branch main' ? "base branch 'main'" : 'commit abc123'));
    f.dialogs.push('Return and summarize');
    await f.session.prompt('/end-review');
    assert.equal(f.calls.length, 2);
    assert(f.sm.getBranch().some(e => e.type === 'branch_summary'));
    assert(!f.sm.getBranch().findLast(e => e.customType === 'review-session').data.active);
  } finally { await f.close(); }
});

test('answer uses selected registry, real Q&A confirmation, no submission on Escape', async () => {
  const f = await fixture({ responses: [reply('Which database?'), reply('{"questions":[{"question":"Which database?"}]}'), reply('Thanks')] });
  try {
    await f.session.prompt('ask a question');
    const run = f.session.prompt('/answer');
    await until(() => f.components.some(v => v.component.constructor.name === 'QnAComponent')).catch(error => {
      assert.fail(`${error.message}: ${JSON.stringify({ notices: f.notices, errors: f.errors, calls: f.calls.length, components: f.components.map(v => v.component.constructor.name) })}`);
    });
    const view = f.components.find(v => v.component.constructor.name === 'QnAComponent');
    for (const width of [10, 50, 80, 100]) for (const line of view.component.render(width)) assert(tui.visibleWidth(line) <= width);
    view.component.handleInput('SQLite');
    view.component.handleInput('\r');
    assert.equal(f.calls.length, 2); // confirmation, not yet submitted
    view.component.handleInput('\r');
    await run;
    await until(() => f.calls.length === 3 && f.session.isIdle);
    assert(text(f.calls[2].context.messages.at(-1).content).includes('A: SQLite'));
    assert.equal(f.calls[1].model.id, f.calls[0].model.id);
    assert.equal(f.calls[1].context.tools, undefined);
    assert.equal(f.calls[1].context.messages.length, 1);
    f.faux.setResponses([reply('{"questions":[{"question":"Another?"}]}')]);
    const cancelled = f.session.prompt('/answer');
    await until(() => f.components.filter(v => v.component.constructor.name === 'QnAComponent').length === 2);
    f.components.at(-1).component.handleInput('\x1b');
    await cancelled;
    assert.equal(f.calls.length, 4);
  } finally { await f.close(); }
});

test('BTW uses inherited native read tools, never sends its thread to the parent until explicit summary', async () => {
  const f = await fixture({ responses: [reply('Main response'), tool('read', { path: 'fixture.txt' }), reply('Side answer from evidence'), reply('Side handoff'), reply('Main acknowledges')] });
  try {
    await f.session.prompt('main task');
    const main = structuredClone(f.session.messages);
    await f.session.prompt('/btw read the fixture and explain it');
    assert.equal(f.calls.length, 3);
    assert.deepEqual(f.calls[1].context.tools.map(t => t.name), ['read']);
    assert.deepEqual(f.calls[1].auth, f.calls[0].auth);
    assert.equal(f.calls[1].auth.headers['x-auth-fixture'], 'dynamic');
    assert.equal(f.calls[1].model.baseUrl, f.calls[0].model.baseUrl);
    assert(f.calls[2].context.messages.some(m => m.role === 'toolResult' && text(m.content).includes('read-only evidence')));
    assert.deepEqual(f.session.messages, main);
    assert(f.sm.getBranch().some(e => e.customType === 'btw-thread-entry'));
    const overlay = f.components.find(v => v.overlay);
    for (const width of [10, 50, 80, 100]) for (const line of overlay.component.render(width)) assert(tui.visibleWidth(line) <= width);
    f.dialogs.push('Inject summary into main chat');
    overlay.component.handleInput('\x1b');
    await until(() => f.calls.length === 5 && f.session.isIdle);
    assert(text(f.calls[4].context.messages.at(-1).content).includes('Side handoff'));
    assert(f.sm.getBranch().some(e => e.customType === 'btw-thread-reset'));
    assert.equal(readFileSync(join(f.cwd, 'fixture.txt'), 'utf8'), 'read-only evidence');
  } finally { await f.close(); }
});

test('BTW overlay scrolls its full transcript while keeping the prompt interactive', () => {
  let renderRequests = 0;
  const viewportTui = { ...fakeTui, requestRender: () => { renderRequests++; } };
  const transcript = Array.from({ length: 40 }, (_, index) => `Transcript line ${index + 1}`);
  const overlay = new btwModule.BtwOverlay(
    viewportTui,
    theme,
    keybindings,
    () => transcript,
    () => 'Ready',
    () => {},
    () => {},
  );
  const renderedText = () => overlay.render(60).join('\n');
  const wheel = wheelDelta => overlay.handleMouse({
    type: 'wheel', button: 'none', x: 10, y: 8, screenX: 10, screenY: 8,
    width: 60, height: 30, shift: false, alt: false, ctrl: false, wheelDelta,
  });

  assert(renderedText().includes('Transcript line 40'));
  assert(!renderedText().match(/Transcript line 1(?:\s|│)/));
  assert.equal(wheel(-3)?.handled, true);
  assert(!renderedText().includes('Transcript line 40'));
  overlay.handleInput('\x1b[5~');
  assert(renderedText().match(/Transcript line 1(?:\s|│)/));
  overlay.handleInput('draft');
  assert.equal(overlay.getDraft(), 'draft');
  for (let page = 0; page < 3; page++) {
    overlay.handleInput('\x1b[6~');
    renderedText();
  }
  assert(renderedText().includes('Transcript line 40'));

  transcript.push('Transcript line 41');
  assert(renderedText().includes('Transcript line 41'));
  wheel(-1);
  transcript.push('Transcript line 42');
  assert(!renderedText().includes('Transcript line 42'));
  assert.equal(wheel(3)?.handled, true);
  assert(renderedText().includes('Transcript line 42'));
  assert(renderedText().includes('PgUp/PgDn scroll'));
  assert(renderRequests > 0);
  for (const line of overlay.render(60)) assert(tui.visibleWidth(line) <= 60);
});

test('BTW native editor owns history, multiline input, paste, undo and focus', () => {
  const submitted = [];
  let dismissed = 0;
  const overlay = new btwModule.BtwOverlay(fakeTui, theme, keybindings, () => [], () => 'Ready',
    value => submitted.push(value), () => dismissed++, { history: ['older question', 'newer question'] });
  overlay.focused = true;
  const frame = () => overlay.render(60);
  assert(frame().join('\n').includes(tui.CURSOR_MARKER));
  overlay.handleInput('\x1b[A');
  assert.equal(overlay.getDraft(), 'newer question');
  overlay.handleInput('\x1b[A');
  assert.equal(overlay.getDraft(), 'older question');
  overlay.handleInput('\x1b[B');
  assert.equal(overlay.getDraft(), 'newer question');
  overlay.handleInput('\x1b[B');
  assert.equal(overlay.getDraft(), '');

  overlay.setDraft('draft 日本');
  overlay.handleInput('\x01'); // Home, then Up enters history; Down restores draft.
  overlay.handleInput('\x1b[A');
  overlay.handleInput('\x1b[B');
  assert.equal(overlay.getDraft(), 'draft 日本');
  overlay.handleInput('\x05');
  overlay.handleInput('\n'); // Ctrl+J does not submit.
  overlay.handleInput('second line');
  overlay.handleInput('\x1b[13;2u'); // Shift+Enter also stays native.
  overlay.handleInput('third line');
  assert.equal(overlay.getDraft(), 'draft 日本\nsecond line\nthird line');
  assert.equal(submitted.length, 0);
  assert(frame().join('\n').includes('second line'));
  overlay.handleInput('\x1b[A'); // Moves within multiline draft, not the transcript.
  overlay.handleInput('\x01');
  overlay.handleInput('prefix ');
  assert.equal(overlay.getDraft(), 'draft 日本\nprefix second line\nthird line');
  overlay.handleInput('\r');
  assert.deepEqual(submitted, ['draft 日本\nprefix second line\nthird line']);

  overlay.setDraft('');
  overlay.handleInput('line\\');
  overlay.handleInput('\r'); // Pi's backslash+Enter fallback.
  assert.equal(overlay.getDraft(), 'line\n');
  assert.equal(submitted.length, 1);
  overlay.setDraft('');
  const pasted = Array.from({ length: 20 }, (_, i) => `日本 pasted line ${i}`).join('\n');
  overlay.handleInput(`\x1b[200~${pasted}\x1b[201~`);
  assert.equal(overlay.getDraft(), pasted);
  assert(frame().join('\n').includes('[paste #'));
  overlay.handleInput('\r');
  assert.equal(submitted.at(-1), pasted);
  overlay.setDraft('undo me');
  overlay.setDraft('');
  overlay.handleInput('\x1f');
  assert.equal(overlay.getDraft(), 'undo me');
  overlay.focused = false;
  assert(!frame().join('\n').includes(tui.CURSOR_MARKER));
  overlay.handleInput('\x1b');
  assert.equal(dismissed, 1);
});

test('BTW copy gestures target the full side draft, clear is undoable, empty/programmatic clears never copy', async () => {
  const copied = [], notices = [];
  let dismissed = 0;
  const overlay = new btwModule.BtwOverlay(fakeTui, theme, keybindings, () => [], () => 'Ready',
    () => assert.fail('copy must not submit'), () => dismissed++, {
      copy: async value => { copied.push(value); },
      notify: (message, level) => notices.push({ message, level }),
    });
  const prompt = Array.from({ length: 20 }, (_, i) => `日本 line ${i}`).join('\n');
  overlay.handleInput(`\x1b[200~${prompt}\x1b[201~`);
  for (const key of ['\x1bC', '\x1b[99;4u']) { // legacy and Kitty Option+Shift+C
    overlay.handleInput(key);
    await tick();
    assert.equal(copied.at(-1), prompt);
    assert.equal(overlay.getDraft(), prompt);
  }
  overlay.handleInput('\x1b[99;9u'); // Kitty Command+C
  assert.equal(overlay.getDraft(), '');
  await tick();
  assert.equal(copied.length, 3);
  overlay.handleInput('\x1f');
  assert.equal(overlay.getDraft(), prompt);
  overlay.handleInput('\x03');
  assert.equal(overlay.getDraft(), '');
  await tick();
  assert.equal(copied.length, 4);
  overlay.handleInput('\x03');
  overlay.handleInput('\x1b[99;9u');
  overlay.setDraft('programmatic');
  overlay.setDraft('');
  await tick();
  assert.equal(copied.length, 4);
  assert.equal(dismissed, 0);
  assert(notices.every(n => n.level === 'info'));

  const failed = new btwModule.BtwOverlay(fakeTui, theme, keybindings, () => [], () => 'Ready', () => {}, () => {}, {
    copy: async () => { throw new Error('synthetic clipboard failure'); },
    notify: (message, level) => notices.push({ message, level }),
  });
  failed.setDraft('recover this');
  failed.handleInput('\x03');
  failed.handleInput('next draft'); // Async completion must not clear newer input.
  await tick();
  assert.equal(failed.getDraft(), 'next draft');
  assert.equal(notices.at(-1).level, 'error');
  failed.handleInput('\x1f');
  failed.handleInput('\x1f');
  assert.equal(failed.getDraft(), 'recover this');
});

for (const pasteKey of ['\x16', '\x1b[200~\x1b[201~']) test(`BTW image paste ${JSON.stringify(pasteKey)} reuses native chips, ordering, history and read-tool paths`, async () => {
  let resolveRead;
  const pending = new Promise(resolve => { resolveRead = resolve; });
  const submitted = [], copied = [];
  let reads = 0;
  const overlay = new btwModule.BtwOverlay(fakeTui, theme, keybindings, () => [], () => 'Ready',
    value => submitted.push(value), () => {}, {
      readClipboard: () => { reads++; return pending; }, copy: async text => { copied.push(text); },
    });
  // Real PNG in a private OS temporary file, never the real clipboard.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  let imagePath;
  let f;
  try {
    overlay.handleInput(pasteKey);
    overlay.handleInput('describe this image');
    overlay.handleInput('\r');
    assert.equal(submitted.length, 0);
    resolveRead({ type: 'image', bytes, extension: 'png' });
    await until(() => submitted.length === 1);
    imagePath = submitted[0].split(' ')[0];
    assert.equal(reads, 1);
    assert.equal(submitted[0], `${imagePath} describe this image`);
    assert.deepEqual(readFileSync(imagePath), bytes);
    assert.equal(statSync(imagePath).mode & 0o777, 0o600);
    assert(stripVTControlCharacters(overlay.render(80).join('\n')).includes('[img #1]'));
    overlay.handleInput('\x1b[99;4u');
    await until(() => copied.length === 1);
    assert.equal(copied[0], submitted[0]);
    overlay.addToHistory(submitted[0]);
    overlay.setDraft('');
    overlay.handleInput('\x1b[A');
    assert.equal(overlay.getDraft(), submitted[0]);
    assert(stripVTControlCharacters(overlay.render(80).join('\n')).includes('[img #1]'));
    overlay.handleInput('\x03');
    assert.equal(overlay.getDraft(), '');
    await until(() => copied.length === 2);
    overlay.handleInput('\x1f');
    assert.equal(overlay.getDraft(), submitted[0]);
    overlay.setDraft(`${imagePath} `);
    for (let i = 0; i < '[img #1] '.length; i++) overlay.handleInput('\x7f');
    assert.equal(overlay.getDraft(), '');
    // The accepted prompt crosses the normal side-session/native read boundary.
    f = await fixture({ responses: [tool('read', { path: imagePath }), reply('Image inspected')] });
    await f.session.prompt(`/btw ${submitted[0]}`);
    const imageResult = f.calls[1].context.messages.find(m => m.role === 'toolResult');
    assert(imageResult?.content.some(c => c.type === 'image'), JSON.stringify(imageResult));
    assert.deepEqual(f.session.messages, []);
  } finally {
    overlay.dispose();
    if (f) await f.close();
    if (imagePath) rmSync(imagePath, { force: true });
  }
});

test('BTW ordinary text paste never reads the clipboard; paste failures and late results are safe', async () => {
  let reads = 0, resolveRead;
  const notices = [];
  const pending = new Promise(resolve => { resolveRead = resolve; });
  const overlay = new btwModule.BtwOverlay(fakeTui, theme, keybindings, () => [], () => 'Ready',
    () => assert.fail('must not submit'), () => overlay.dispose(), {
      readClipboard: () => { reads++; return pending; },
      notify: (message, level) => notices.push({ message, level }),
    });
  overlay.handleInput('\x1b[200~ordinary text 日本\x1b[201~');
  assert.equal(reads, 0);
  assert.equal(overlay.getDraft(), 'ordinary text 日本');
  overlay.handleInput('\x16');
  overlay.handleInput('\r');
  overlay.handleInput('\x1b');
  resolveRead({ type: 'image', bytes: new Uint8Array([1]), extension: 'png' });
  await tick();
  assert.equal(overlay.getDraft(), 'ordinary text 日本');
  assert.equal(reads, 1);
  assert.deepEqual(notices, []);

  const failed = new btwModule.BtwOverlay(fakeTui, theme, keybindings, () => [], () => 'Ready', () => {}, () => {}, {
    readClipboard: async () => { throw new Error('synthetic failure'); },
    notify: (message, level) => notices.push({ message, level }),
  });
  failed.setDraft('keep me');
  failed.handleInput('\x16');
  await until(() => notices.length === 1);
  assert.equal(failed.getDraft(), 'keep me');
  assert.equal(notices[0].level, 'warning');
  failed.dispose();
});

test('BTW respects configured native newline/history/clear bindings', async () => {
  const kb = new KeybindingsManager({
    'app.clear': 'ctrl+k', 'tui.input.newLine': 'ctrl+n',
    'tui.editor.historyPrevious': 'ctrl+p', 'tui.editor.historyNext': 'ctrl+o',
  });
  tui.setKeybindings(kb);
  try {
    const copied = [];
    const overlay = new btwModule.BtwOverlay(fakeTui, theme, kb, () => [], () => 'Ready', () => {}, () => {},
      { history: ['previous'], copy: async value => { copied.push(value); } });
    overlay.setDraft('draft');
    overlay.handleInput('\x10');
    assert.equal(overlay.getDraft(), 'previous');
    overlay.handleInput('\x0f');
    assert.equal(overlay.getDraft(), 'draft');
    overlay.handleInput('\x0e');
    overlay.handleInput('next');
    assert.equal(overlay.getDraft(), 'draft\nnext');
    overlay.handleInput('\x0b');
    assert.equal(overlay.getDraft(), '');
    await tick();
    assert.deepEqual(copied, ['draft\nnext']);
  } finally { tui.setKeybindings(keybindings); }
});

test('BTW multiline viewport fits short/tall terminals and routes mouse clicks to each prompt row', () => {
  const terminal = { columns: 80, rows: 40 };
  const overlay = new btwModule.BtwOverlay({ ...fakeTui, terminal }, theme, keybindings, () => [], () => 'Ready',
    () => assert.fail('hidden editor must not submit'), () => {});
  overlay.focused = true;
  overlay.setDraft('first\nsecond');
  const frame = overlay.render(60);
  const row = frame.findIndex(line => line.includes('first'));
  assert(overlay.handleMouse({ type: 'click', button: 'left', x: 2, y: row,
    screenX: 2, screenY: row, width: 60, height: frame.length,
    shift: false, alt: false, ctrl: false })?.handled);
  overlay.handleInput('X');
  assert.equal(overlay.getDraft(), 'Xfirst\nsecond');
  overlay.setDraft(Array.from({ length: 100 }, (_, i) => `long multiline draft 日本 ${i}`).join('\n'));
  for (const rows of [20, 24, 40, 120]) {
    terminal.rows = rows;
    for (const width of [10, 50, 80, 100]) {
      const lines = overlay.render(width);
      assert(lines.length <= Math.min(30, Math.floor(rows * 0.75)), `${rows} rows/${width} columns`);
      assert(lines.some(line => line.includes(tui.CURSOR_MARKER)));
      for (const line of lines) assert(tui.visibleWidth(line) <= width);
    }
  }
  terminal.rows = 12;
  assert.equal(overlay.render(60).length, 1);
  overlay.handleInput('\r');
});

test('BTW accepts multiline questions, keeps busy drafts, and restores only its own history', async () => {
  let release;
  const f = await fixture({ responses: [reply('first answer'), () => new Promise(resolve => {
    release = () => resolve(reply('second answer'));
  })] });
  try {
    await f.session.prompt('/btw first side question');
    const overlay = f.components.find(v => v.overlay).component;
    overlay.handleInput('\x1b[A');
    assert.equal(overlay.getDraft(), 'first side question');
    overlay.setDraft('second side question\nwith details');
    overlay.handleInput('\r');
    await until(() => release);
    assert.equal(overlay.getDraft(), '');
    assert.equal(text(f.calls[1].context.messages.at(-1).content), 'second side question\nwith details');
    assert(overlay.render(80).join('\n').includes('with details'));
    overlay.handleInput('keep this next draft 日本');
    overlay.handleInput('\r');
    assert.equal(overlay.getDraft(), 'keep this next draft 日本');
    assert.equal(f.calls.length, 2);
    release();
    await until(() => f.sm.getBranch().filter(e => e.customType === 'btw-thread-entry').length === 2);
    assert.equal(overlay.getDraft(), 'keep this next draft 日本');
    assert.equal(f.ui.getEditorText(), 'draft 日本');
    assert.deepEqual(f.session.messages, []);
    f.dialogs.push('Keep side thread');
    overlay.handleInput('\x1b');
    await tick();
    f.dialogs.push('Continue previous conversation');
    await f.session.prompt('/btw');
    await until(() => f.components.filter(v => v.overlay).length === 2);
    const reopened = f.components.at(-1).component;
    assert.equal(reopened.getDraft(), 'keep this next draft 日本');
    await f.session.reload();
    f.dialogs.push('Continue previous conversation');
    await f.session.prompt('/btw');
    await until(() => f.components.filter(v => v.overlay).length === 3);
    const restored = f.components.at(-1).component;
    restored.handleInput('\x1b[A');
    assert.equal(restored.getDraft(), 'second side question\nwith details');
    restored.handleInput('\x1b[A');
    assert.equal(restored.getDraft(), 'first side question');
    f.dialogs.push('Keep side thread');
    restored.handleInput('\x1b');
    await tick();
    f.dialogs.push('Start fresh');
    await f.session.prompt('/btw');
    await until(() => f.components.filter(v => v.overlay).length === 4);
    f.components.at(-1).component.handleInput('\x1b[A');
    assert.equal(f.components.at(-1).component.getDraft(), '');
    assert.equal(f.calls.length, 2);
  } finally { release?.(); await f.close(); }
});

test('restored BTW scrolling reaches saved messages older than six turns', async () => {
  const f = await fixture();
  try {
    for (let index = 1; index <= 7; index++) {
      f.sm.appendCustomEntry('btw-thread-entry', {
        question: `Side question ${index}`,
        answer: index === 1 ? 'Oldest side answer' : `Side answer ${index}`,
        timestamp: Date.now() + index,
        provider: 'agent-stuff-test',
        model: 'fixture',
        thinkingLevel: 'off',
      });
    }
    await f.session.reload();
    f.dialogs.push('Continue previous conversation');
    await f.session.prompt('/btw');
    await until(() => f.components.some(view => view.overlay));
    const overlay = f.components.find(view => view.overlay).component;
    overlay.render(60);
    for (let page = 0; page < 10; page++) overlay.handleInput('\x1b[5~');
    assert(overlay.render(60).join('\n').includes('Oldest side answer'));
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('non-TUI modes reject terminal-only commands without reading sessions or calling providers', async () => {
  for (const mode of ['rpc', 'json', 'print']) {
    const f = await fixture({ mode });
    try {
      for (const cmd of ['/answer', '/btw question', '/session-breakdown', '/review uncommitted', '/end-review']) await f.session.prompt(cmd);
      assert.equal(f.calls.length, 0);
      assert.deepEqual(f.session.messages, []);
      assert.equal(f.components.length, 0);
    } finally { await f.close(); }
  }
});

test('usage parser: native disjoint cache buckets, summary usage, malformed tail and faux exclusion', async () => {
  const sessions = join(agentDir, 'sessions');
  mkdirSync(sessions, { recursive: true });
  const file = join(sessions, 'fixture.jsonl');
  const usage = { input: 10, output: 5, cacheRead: 100, cacheWrite: 3, cost: { total: 0.25 } };
  const entries = [
    { type: 'session', timestamp: new Date().toISOString(), cwd: '/fixture' },
    { type: 'model_change', provider: 'test', modelId: 'model' },
    { type: 'message', message: { role: 'user', content: 'not displayed in stats' } },
    { type: 'message', message: { role: 'assistant', provider: 'test', model: 'model', usage } },
    { type: 'compaction', usage: { totalTokens: 20, cost: { total: 0.1 } }, retainedTail: [{ usage }] },
    { type: 'message', message: { role: 'assistant', provider: 'faux', model: 'faux-1', usage } },
  ];
  writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n{"partial":');
  const parsed = await breakdown.parseSessionFile(file);
  assert.equal(parsed.tokens, 138);
  assert.equal(parsed.messages, 2);
  assert.equal(parsed.totalCost, 0.35);
  assert.equal(goalModule.assistantUsageTokens([{ role: 'assistant', usage }]), 18);
  assert.equal(breakdown.extractTokensTotal({ total_tokens: '42' }), 42);
  const data = await breakdown.computeBreakdown();
  for (const days of [7, 30, 90]) assert.equal(data.ranges.get(days).totalTokens, 138);
  const view = new breakdown.BreakdownComponent(data, fakeTui, () => {});
  for (const width of [20, 50, 80, 100]) {
    for (const key of ['1', '2', '3', 'j', 'j', 'j', 't', 'p']) {
      view.handleInput(key);
      for (const line of view.render(width)) assert(tui.visibleWidth(line) <= width);
    }
  }
  assert.equal(answerModule.parseExtractionResult('```json\n{"questions":[]}\n```').questions.length, 0);
  assert.equal(answerModule.parseExtractionResult('{"questions":[{}]}'), null);
  rmSync(file);
});

test('goal budgets stop the next continuation; excluded goal tools fail closed without provider calls', async () => {
  const f = await fixture({ responses: [reply('progress, not complete')] });
  try {
    await f.session.prompt('/goal --budget 1 tiny budget');
    await until(() => f.latestGoal()?.status === 'budgetLimited' && f.session.isIdle);
    assert.equal(f.calls.length, 1);
    await f.session.prompt('/goal resume');
    assert.equal(f.calls.length, 1);
    assert.equal(f.latestGoal().status, 'budgetLimited');
    assert.deepEqual(f.session.getActiveToolNames(), ['read']);
  } finally { await f.close(); }
  const restricted = await fixture({ allowGoals: false, tools: ['read', 'get_goal'] });
  try {
    await restricted.session.prompt('/goal cannot enable excluded tools');
    assert.equal(restricted.calls.length, 0);
    assert.equal(restricted.latestGoal().status, 'paused');
    assert.deepEqual(restricted.session.getActiveToolNames(), ['read']);
    assert(restricted.sm.getBranch().some(e => e.customType === 'goal-ui' && e.data.includes('allowlist')));
  } finally { await restricted.close(); }
});

test('native abort signal pauses goal before another settled continuation', async () => {
  let started = false;
  const f = await fixture({ responses: [(_context, options) => new Promise(resolve => {
    started = true;
    options.signal.addEventListener('abort', () => resolve(reply('discard this response')), { once: true });
  })] });
  try {
    await f.session.prompt('/goal abort the pending request');
    await until(() => started);
    await f.session.abort();
    await until(() => f.session.isIdle);
    assert.equal(f.latestGoal().status, 'paused');
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.session.getActiveToolNames(), ['read']);
  } finally { await f.close(); }
});

test('restoring an active goal pauses it; review and goal modes cannot run together', async () => {
  const f = await fixture({ responses: [reply('review complete')] });
  try {
    f.sm.appendCustomEntry('goal', { version: 2, goal: { id: 'old-goal', objective: 'restored objective', status: 'active' } });
    await f.session.reload();
    assert.equal(f.latestGoal().status, 'paused');
    assert.equal(f.calls.length, 0);
    await f.session.prompt('/review uncommitted');
    await until(() => f.calls.length === 1 && f.session.isIdle);
    await f.session.prompt('/goal do something else');
    assert.equal(f.calls.length, 1);
    assert(f.notices.some(n => n.message.includes('/end-review')));
    f.dialogs.push('Return only');
    await f.session.prompt('/end-review');
    // An active goal is deliberately inserted as fixture state to test the review guard.
    f.sm.appendCustomEntry('goal', { version: 2, goal: { id: 'active-fixture', objective: 'fixture', status: 'active' } });
    await f.session.prompt('/review uncommitted');
    assert(f.notices.some(n => n.message.includes('/goal pause')));
    assert.equal(f.calls.length, 1);
  } finally { await f.close(); }
});

test('BTW Escape and session-tree cancellation suppress late side results; history restores on reload', async () => {
  let release;
  const f = await fixture({ responses: [reply('kept side answer'), () => new Promise(resolve => { release = () => resolve(reply('late cancelled answer')); })] });
  try {
    await f.session.prompt('/btw first question');
    assert.equal(f.calls.length, 1);
    f.dialogs.push('Keep side thread');
    f.components.find(v => v.overlay).component.handleInput('\x1b');
    await tick();
    await f.session.reload();
    f.dialogs.push('Continue previous conversation');
    await f.session.prompt('/btw');
    await until(() => f.components.filter(v => v.overlay).length === 2);
    const run = f.session.prompt('/btw second question');
    await until(() => release);
    assert(f.calls[1].context.messages.some(m => text(m.content).includes('kept side answer')));
    f.dialogs.push('Keep side thread');
    f.components.filter(v => v.overlay).at(-1).component.handleInput('\x1b');
    release();
    await run;
    await tick();
    assert.equal(f.sm.getBranch().filter(e => e.customType === 'btw-thread-entry').length, 1);
    assert.equal(f.session.messages.length, 0);
    f.faux.setResponses([() => new Promise(resolve => { release = () => resolve(reply('late tree answer')); })]);
    release = undefined;
    const treeRun = f.session.prompt('/btw third question');
    await until(() => release);
    const navigation = f.session.extensionRunner.emit({ type: 'session_tree' });
    release();
    await Promise.all([treeRun, navigation]);
    assert.equal(f.sm.getBranch().filter(e => e.customType === 'btw-thread-entry').length, 1);
  } finally { release?.(); await f.close(); }
});

test('breakdown command opens fixture-only TUI, closes without messages or provider calls', async () => {
  const f = await fixture();
  try {
    const run = f.session.prompt('/session-breakdown');
    await until(() => f.components.some(v => v.component.constructor.name === 'BreakdownComponent'));
    f.components.at(-1).component.handleInput('q');
    await run;
    assert.deepEqual(f.session.messages, []);
    assert.equal(f.calls.length, 0);
  } finally { await f.close(); }
});

test('PR checkout is confirmed, keeps full repository URL, rechecks dirtiness, and has no cross-runtime review state', async () => {
  const ref = 'https://github.com/owner/other-repo/pull/123';
  function mockReview({ confirm = true, statuses = ['', ''], statusCode = 0 } = {}) {
    const commands = new Map(), hooks = new Map(), calls = [], prompts = [], entries = [];
    reviewModule.default({
      registerCommand: (name, command) => commands.set(name, command),
      on: (name, handler) => hooks.set(name, handler),
      appendEntry: (customType, data) => entries.push({ id: String(entries.length), type: 'custom', customType, data }),
      sendUserMessage: prompt => prompts.push(prompt),
      exec: async (command, args) => {
        calls.push([command, ...args]);
        if (command === 'gh' && args[1] === 'view') return { code: 0, stdout: JSON.stringify({ title: 'fixture', baseRefName: 'main', headRefName: 'pr-branch' }) };
        if (args[0] === 'status') return { code: statusCode, stdout: statuses.shift() ?? '' };
        return { code: 0, stdout: args.includes('--show-current') ? 'main' : '', stderr: '' };
      },
    });
    const ctx = { mode: 'tui', hasUI: true, cwd: root, isIdle: () => true, isProjectTrusted: () => false,
      sessionManager: { getBranch: () => entries, getEntries: () => entries, getLeafId: () => entries.at(-1)?.id },
      ui: { notify() {}, setWidget() {}, confirm: async () => confirm, custom: async () => null, setEditorText() {} },
    };
    return { run: () => commands.get('review').handler(`pr ${ref}`, ctx), calls, prompts };
  }
  const yes = mockReview();
  await yes.run();
  assert(yes.calls.some(c => c.join('|') === ['gh', 'pr', 'checkout', ref].join('|')));
  assert(yes.calls.some(c => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'view' && c[3] === ref));
  assert.equal(yes.calls.filter(c => c[1] === 'status').length, 2);
  assert.equal(yes.prompts.length, 1);
  for (const options of [{ confirm: false }, { statuses: ['', ' M changed.ts'] }, { statuses: [' M changed.ts'] }]) {
    const no = mockReview(options);
    await no.run();
    assert(!no.calls.some(c => c[0] === 'gh' && c[2] === 'checkout'));
    assert.equal(no.prompts.length, 0);
  }
  const failed = mockReview({ statusCode: 1 });
  await assert.rejects(failed.run(), /Cannot verify/);
  assert(!failed.calls.some(c => c[0] === 'gh'));
});
