// Native Pi check for selective-skills.ts: always-on skills (ALWAYS_ON_SKILLS)
// reach the model in every session, and /skill keeps its other choices.
// Run: node --test pi/extensions/selective-skills.test.mjs
// .mjs, so Pi never loads this file as an extension when pi/ is linked.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve installed code, then isolate HOME, auth and config before importing Pi.
const pkg = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const root = mkdtempSync(join(tmpdir(), 'selective-skills-native-'));
const path = process.env.PATH;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, { HOME: root, PATH: path, PI_CODING_AGENT_DIR: join(root, 'agent'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1' });
const agentDir = process.env.PI_CODING_AGENT_DIR;
after(() => rmSync(root, { recursive: true, force: true }));
const sdk = await import(pathToFileURL(join(pkg, 'dist/index.js')));
sdk.initTheme('dark', false);
const ai = await import(pathToFileURL(join(pkg, 'node_modules/@earendil-works/pi-ai/dist/index.js')));
const extensionPath = fileURLToPath(new URL('selective-skills.ts', import.meta.url));
const theme = { fg: (_colour, text) => text, bg: (_colour, text) => text, bold: text => text };

function writeSkill(dir, name) {
  mkdirSync(join(dir, name), { recursive: true });
  const file = join(dir, name, 'SKILL.md');
  writeFileSync(file, `---\nname: ${name}\ndescription: Fixture skill ${name}. Use in tests.\n---\n\n# ${name}\n`);
  return file;
}

const text = content => typeof content === 'string' ? content : (content ?? []).filter(p => p.type === 'text').map(p => p.text).join('\n');
// Providers receive system messages that carry the prompt; join them back up.
const systemPromptOf = context => [context.systemPrompt ?? '', ...(context.messages ?? [])
  .filter(m => m.role === 'system')
  .flatMap(m => [text(m.content), ...Object.values(m.sections ?? {}).filter(Boolean)])].join('\n');

async function fixture({ state } = {}) {
  const cwd = mkdtempSync(join(root, 'repo-'));
  execFileSync('git', ['init', '-q', '-b', 'main', cwd]);
  const calls = [], errors = [], notices = [], statuses = [];
  const faux = ai.fauxProvider({ provider: 'selective-skills-test', models: [{ id: 'fixture', contextWindow: 200000 }], tokensPerSecond: 100000 });
  faux.setResponses([ai.fauxAssistantMessage('ok')]);
  const provider = { ...faux.provider, auth: { apiKey: { name: 'Synthetic only', resolve: async () => ({ auth: { apiKey: 'synthetic-key' } }) } } };
  for (const method of ['stream', 'streamSimple']) provider[method] = (model, context, options) => {
    calls.push(JSON.parse(JSON.stringify(context)));
    return faux.provider[method](model, context, options);
  };
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, modelsStore: new ai.InMemoryModelsStore(), refreshOnCreate: false });
  modelRuntime.registerNativeProvider(provider);
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  // As the pi wrapper runs it: --no-skills, so only the extension adds skills.
  const loader = new sdk.DefaultResourceLoader({ cwd, agentDir, settingsManager: settings, noExtensions: true, additionalExtensionPaths: [extensionPath], noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const sm = sdk.SessionManager.inMemory(cwd);
  if (state) sm.appendCustomEntry('selective-skills-state', state);
  const { session } = await sdk.createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager: settings, modelRuntime, model: faux.getModel(), thinkingLevel: 'off', tools: ['read'], sessionManager: sm });
  const ui = { theme, notify: (message, level) => notices.push({ message, level }), setStatus: (key, value) => statuses.push({ key, value }) };
  await session.bindExtensions({ mode: 'tui', uiContext: ui, onError: error => errors.push(error), commandContextActions: {
    waitForIdle: () => session.waitForIdle(),
    reload: () => session.reload(),
  } });
  return {
    session, calls, notices, statuses,
    lastNotice: () => notices.at(-1)?.message,
    // The number in the footer status, whatever its styling; 0 when it is hidden.
    footerCount: () => {
      const value = statuses.filter(s => s.key === 'selective-skills').at(-1)?.value;
      return value === undefined ? 0 : Number(value.match(/\d+/)[0]);
    },
    async close() {
      await session.abort();
      session.dispose();
      assert.deepEqual(errors, []);
    },
  };
}

const userSkills = join(agentDir, 'skills');
const prPath = writeSkill(userSkills, 'pr');
const tutorPath = writeSkill(userSkills, 'socratic-tutor');
const otherPath = writeSkill(userSkills, 'other');

test('pr and socratic-tutor reach the model in a new session with no /skill choice; other skills stay off', async () => {
  const f = await fixture();
  try {
    assert(f.session.systemPrompt.includes(`<location>${prPath}</location>`));
    assert(f.session.systemPrompt.includes(`<location>${tutorPath}</location>`));
    assert(!f.session.systemPrompt.includes(otherPath));
    await f.session.prompt('hello');
    assert.equal(f.calls.length, 1);
    const sent = systemPromptOf(f.calls[0]);
    assert(sent.includes('<name>pr</name>'), sent);
    assert(sent.includes('<name>socratic-tutor</name>'), sent);
    assert(!sent.includes('<name>other</name>'));
    // The footer counts every loaded skill, always-on ones included.
    assert.equal(f.footerCount(), 2);
  } finally { await f.close(); }
});

test('a session that saved a /skill choice before pr was always on still loads pr', async () => {
  const f = await fixture({ state: { enabledPaths: [] } });
  try {
    assert(f.session.systemPrompt.includes(prPath));
    assert(f.session.systemPrompt.includes(tutorPath));
    assert(!f.session.systemPrompt.includes(otherPath));
  } finally { await f.close(); }
});

test('/skill lists pr as always on, cannot turn it off, and keeps it through on and clear', async () => {
  const f = await fixture();
  try {
    await f.session.prompt('/skill list');
    assert.equal(f.lastNotice(), 'always  pr\nalways  socratic-tutor\noff     other');

    await f.session.prompt('/skill off pr');
    assert.equal(f.lastNotice(), 'pr is always on');
    assert(f.session.systemPrompt.includes(prPath));

    await f.session.prompt('/skill on other');
    assert(f.session.systemPrompt.includes(prPath));
    assert(f.session.systemPrompt.includes(otherPath));
    assert.equal(f.footerCount(), 3);

    await f.session.prompt('/skill clear');
    assert(f.session.systemPrompt.includes(prPath));
    assert(!f.session.systemPrompt.includes(otherPath));
    assert.equal(f.footerCount(), 2);
    assert.equal(f.calls.length, 0, 'commands must not send model requests');
  } finally { await f.close(); }
});

test('a pr skill outside Pi\'s own skills folder is an ordinary /skill choice, off by default', async () => {
  rmSync(join(userSkills, 'pr'), { recursive: true });
  const elsewhere = writeSkill(join(root, '.agents', 'skills'), 'pr');
  try {
    const f = await fixture();
    try {
      assert(!f.session.systemPrompt.includes(elsewhere));
      // Only socratic-tutor, still in Pi's own folder, is always on.
      assert.equal(f.footerCount(), 1);
      await f.session.prompt('/skill list');
      assert.equal(f.lastNotice(), 'always  socratic-tutor\noff     other\noff     pr');
    } finally { await f.close(); }
  } finally {
    rmSync(join(root, '.agents'), { recursive: true });
    writeSkill(userSkills, 'pr');
  }
});
