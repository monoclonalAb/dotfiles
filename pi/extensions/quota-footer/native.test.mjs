import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageDir = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const source = fileURLToPath(new URL('.', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'quota-native-'));
const path = process.env.PATH;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, { HOME: root, PATH: path, PI_CODING_AGENT_DIR: join(root, 'agent'), XDG_STATE_HOME: join(root, 'state'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1' });
const requests = [];
globalThis.fetch = async (url, init) => {
  assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
  assert.equal(init.method, 'GET');
  const account = init.headers['ChatGPT-Account-Id'];
  assert.ok(['main', 'work'].includes(account));
  requests.push(account);
  return Response.json({ rate_limit: { primary_window: { limit_window_seconds: 18000, used_percent: account === 'main' ? 100 : 12 } } });
};
const sdk = await import(pathToFileURL(join(packageDir, 'dist/index.js')));

async function until(fn) {
  for (let i = 0; i < 400; i++) { if (fn()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('native quota footer did not settle');
}

test('native Pi loads the per-file symlink layout; /usage reads all accounts and /accounts use updates the footer', { timeout: 20000 }, async () => {
  let session;
  try {
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    // Reproduce the deployed view using existing runtime modules only.
    // This feature must load without introducing new helper-file links.
    for (const [extension, files] of [
      ['quota-footer', ['index.ts', 'monitor.ts', 'quota.ts']],
      ['quota-router', ['index.ts', 'accounts.ts', 'backend.ts', 'router.ts']],
    ]) {
      const dir = join(agentDir, 'extensions', extension);
      mkdirSync(dir, { recursive: true });
      for (const name of files) symlinkSync(join(source, '..', extension, name), join(dir, name));
    }
    const token = account => `h.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.s`;
    const credential = account => ({ type: 'oauth', access: token(account), refresh: `refresh-${account}`, expires: Date.now() + 3_600_000, accountId: account });
    const authPath = join(agentDir, 'auth.json');
    const original = { 'openai-codex': credential('main'), 'openai-codex@work': credential('work') };
    writeFileSync(authPath, JSON.stringify(original), { mode: 0o600 });
    const services = await sdk.createAgentSessionServices({
      cwd: root, agentDir, settingsManager: sdk.SettingsManager.inMemory(),
      resourceLoaderOptions: { noExtensions: true,
        additionalExtensionPaths: ['quota-footer', 'quota-router'].map(name => join(agentDir, 'extensions', name, 'index.ts')),
        noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPromptOverride: () => 'Synthetic only.' },
    });
    assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
    ({ session } = await sdk.createAgentSessionFromServices({ services, sessionManager: sdk.SessionManager.inMemory(root),
      model: services.modelRuntime.getModel('openai-codex', 'gpt-6-astra'), tools: [], thinkingLevel: 'low' }));
    const statuses = new Map(), notices = [], errors = [];
    await session.bindExtensions({ mode: 'tui', onError: error => errors.push(error), uiContext: {
      theme: { fg: (_color, text) => text, bold: text => text },
      setStatus: (key, value) => statuses.set(key, value), notify: text => notices.push(text),
    } });
    await until(() => statuses.get('00-quota-footer') === '100% | /login');
    assert.deepEqual(requests, ['main']);
    await session.prompt('/usage');
    assert.match(notices.at(-1), /Codex \/ main \(active\): wk:- 5h:100% used/);
    assert.match(notices.at(-1), /Codex \/ work \(parked\): wk:- 5h:12% used/);
    assert.deepEqual(JSON.parse(readFileSync(authPath, 'utf8')), original, 'usage must not move credentials');
    await session.prompt('/accounts use openai-codex work');
    await until(() => statuses.get('00-quota-footer') === '12% | /login');
    await session.prompt('/usage');
    assert.match(notices.at(-1), /Codex \/ main \(parked\): wk:- 5h:100% used/);
    assert.match(notices.at(-1), /Codex \/ work \(active\): wk:- 5h:12% used/);
    assert.equal(JSON.parse(readFileSync(authPath, 'utf8'))['openai-codex'].accountId, 'work');
    assert.equal(session.messages.length, 0, 'commands must not add model context');
    assert.deepEqual(errors, []);
  } finally {
    if (session) { await session.abort(); session.dispose(); }
    rmSync(root, { recursive: true, force: true });
  }
});
