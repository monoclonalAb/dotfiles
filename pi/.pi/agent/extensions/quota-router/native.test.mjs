import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zstdDecompressSync } from 'node:zlib';

// Resolve installed code before isolating HOME and removing credential-bearing env.
const packageDir = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const root = mkdtempSync(join(tmpdir(), 'quota-router-native-'));
const path = process.env.PATH;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, {
  HOME: root, PATH: path, PI_CODING_AGENT_DIR: join(root, 'agent'), XDG_STATE_HOME: join(root, 'state'),
  PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1',
});
mkdirSync(process.env.PI_CODING_AGENT_DIR);
after(() => rmSync(root, { recursive: true, force: true }));
const sdk = await import(pathToFileURL(join(packageDir, 'dist/index.js')));
const codexApi = await import(pathToFileURL(join(packageDir, 'node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js')));
const extensionPath = fileURLToPath(new URL('index.ts', import.meta.url));
const authPath = join(process.env.PI_CODING_AGENT_DIR, 'auth.json');
const statePath = join(process.env.XDG_STATE_HOME, 'pi', 'quota-router', 'state.json');

const token = account => `test.${Buffer.from(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: account } })).toString('base64url')}.test`;
const credential = account => ({ type: 'oauth', access: token(account), refresh: `refresh-${account}`, expires: Date.now() + 3_600_000, accountId: account });
const readAuth = () => JSON.parse(readFileSync(authPath, 'utf8'));
const readState = () => JSON.parse(readFileSync(statePath, 'utf8'));

function completed() {
  return [{ type: 'response.completed', response: {
    id: 'resp_test', status: 'completed',
    output: [{ type: 'message', id: 'msg_test', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  } }];
}

async function fixture() {
  const requests = [], errors = [], events = [];
  const limited = new Set();
  let session;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      let data = Buffer.concat(chunks);
      if (req.headers['content-encoding'] === 'zstd') data = zstdDecompressSync(data);
      const body = JSON.parse(data.toString());
      const account = req.headers['chatgpt-account-id'];
      requests.push({ account, authorization: req.headers.authorization, body });
      if (limited.has(account)) {
        res.writeHead(429, { 'content-type': 'application/json', 'x-codex-primary-used-percent': '100', 'x-codex-primary-reset-after-seconds': '7200' });
        res.end(JSON.stringify({ error: { type: 'usage_limit_reached', message: 'The usage limit has been reached', plan_type: 'pro', resets_at: Math.floor(Date.now() / 1000) + 7200 } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of completed()) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const close = async () => {
    if (session) {
      await session.abort();
      codexApi.closeOpenAICodexWebSocketSessions(session.sessionId);
      session.dispose();
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  try {
    // Two Codex logins in Pi's own credential file: the active one under the provider id, the other parked.
    writeFileSync(authPath, JSON.stringify({ 'openai-codex': credential('main'), 'openai-codex@work': credential('work') }), { mode: 0o600 });
    rmSync(statePath, { force: true });
    writeFileSync(join(process.env.PI_CODING_AGENT_DIR, 'models.json'), JSON.stringify({ providers: { 'openai-codex': { baseUrl: `${baseUrl}/v1` } } }));
    const settings = sdk.SettingsManager.inMemory({ transport: 'sse', retry: { enabled: true, maxRetries: 3, baseDelayMs: 10, provider: { maxRetries: 0, timeoutMs: 5000 } }, compaction: { enabled: false } });
    const services = await sdk.createAgentSessionServices({
      cwd: root, agentDir: process.env.PI_CODING_AGENT_DIR, settingsManager: settings,
      resourceLoaderOptions: {
        noExtensions: true, additionalExtensionPaths: [extensionPath],
        noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        systemPromptOverride: () => 'Synthetic system prompt.',
      },
    });
    assert.deepEqual(services.diagnostics, []);
    assert.deepEqual(services.resourceLoader.getExtensions().errors, []);
    const model = services.modelRuntime.getModel('openai-codex', 'gpt-6-astra');
    ({ session } = await sdk.createAgentSessionFromServices({ services, sessionManager: sdk.SessionManager.inMemory(root), model, tools: [], thinkingLevel: 'low' }));
    session.subscribe(event => events.push(event));
    await session.bindExtensions({ mode: 'json', onError: error => errors.push(error) });
    return { session, requests, errors, events, limited, close };
  } catch (error) { await close(); throw error; }
}

const failedMessages = events => events
  .filter(event => event.type === 'message_end' && event.message.role === 'assistant' && event.message.stopReason === 'error')
  .map(event => event.message);

test('native Pi: account main hits its limit → same turn, same model continues with account work; /route back restores', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    await f.session.prompt('first');
    assert.deepEqual(f.requests.map(r => r.account), ['main']);
    assert.equal(f.requests[0].authorization, `Bearer ${token('main')}`);

    f.limited.add('main');
    await f.session.prompt('second');
    // One 429 on main, then Pi's own retry re-issued the same turn with the parked account's token.
    assert.deepEqual(f.requests.map(r => r.account), ['main', 'main', 'work']);
    assert.equal(f.requests.at(-1).authorization, `Bearer ${token('work')}`);
    assert.equal(f.session.model.provider, 'openai-codex');
    assert.equal(f.session.model.id, 'gpt-6-astra');
    const last = f.session.messages.at(-1);
    assert.equal(last.role, 'assistant');
    assert.equal(last.stopReason, 'stop');
    assert.equal(last.provider, 'openai-codex');
    const [failed, ...otherFailures] = failedMessages(f.events);
    assert.ok(failed, 'error message observed');
    assert.deepEqual(otherFailures, []);
    assert.match(failed.errorMessage, /^You have hit your ChatGPT usage limit \(pro plan\)\. Try again in ~\d+ min\. \[quota-router: subscription rate limit; retrying on account work\]$/);
    const retries = f.events.filter(event => event.type === 'auto_retry_start' || event.type === 'auto_retry_end');
    assert.deepEqual(retries.map(event => `${event.type}:${event.attempt}:${event.success ?? ''}`), ['auto_retry_start:1:', 'auto_retry_end:1:true']);
    assert.equal(f.session.messages.filter(message => message.role === 'user').length, 2);
    assert.equal(f.session.messages.filter(message => message.role === 'custom').length, 0);

    // Pi's credential file now holds work under the provider id and main parked, owner-only.
    const auth = readAuth();
    assert.equal(auth['openai-codex'].access, token('work'));
    assert.equal(auth['openai-codex@main'].access, token('main'));
    assert.equal(auth['openai-codex@work'], undefined);
    assert.equal(statSync(authPath).mode & 0o777, 0o600);
    const state = readState();
    assert.deepEqual(state.providers['openai-codex'], { active: 'work', preferred: 'main' });
    assert.ok(state.cooldowns['openai-codex@main'].until > Date.now());
    assert.equal(statSync(statePath).mode & 0o777, 0o600);

    // Later prompts keep using the active (work) credential without touching main.
    await f.session.prompt('third');
    assert.equal(f.requests.at(-1).account, 'work');

    // Commands neither prompt a model nor change history.
    const requestCount = f.requests.length;
    const before = structuredClone(f.session.messages);
    await f.session.prompt('/accounts list');
    await f.session.prompt('/route status');
    assert.equal(f.requests.length, requestCount);
    assert.deepEqual(f.session.messages, before);

    // Manual return moves the credentials back; the session picks the change up on its next request.
    f.limited.delete('main');
    await f.session.prompt('/route back');
    assert.equal(readAuth()['openai-codex'].access, token('main'));
    assert.equal(readAuth()['openai-codex@work'].access, token('work'));
    assert.deepEqual(readState().providers['openai-codex'], { active: 'main' });
    await f.session.prompt('fourth');
    assert.equal(f.requests.at(-1).account, 'main');
    assert.equal(f.session.messages.at(-1).stopReason, 'stop');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('native Pi: every account exhausted leaves the error; /accounts use switches by hand and remove parks nothing twice', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    f.limited.add('main');
    f.limited.add('work');
    await f.session.prompt('hello');
    // main → work (retry), work 429 → no further account: the error stands and Pi does not loop.
    assert.deepEqual(f.requests.map(r => r.account), ['main', 'work']);
    assert.equal(f.session.messages.at(-1).stopReason, 'error');
    assert.doesNotMatch(f.session.messages.at(-1).errorMessage, /quota-router/);
    assert.deepEqual(readState().providers['openai-codex'], { active: 'work', preferred: 'main' });
    assert.ok(readState().cooldowns['openai-codex@work']);

    await f.session.prompt('/accounts use openai-codex main');
    assert.deepEqual(readState().providers['openai-codex'], { active: 'main' });
    assert.equal(readAuth()['openai-codex'].access, token('main'));
    await f.session.prompt('/accounts remove openai-codex work');
    assert.deepEqual(Object.keys(readAuth()), ['openai-codex']);
    await f.session.prompt('/accounts remove openai-codex main');
    assert.deepEqual(Object.keys(readAuth()), ['openai-codex']);

    // Nothing parked any more: a further limit is reported without changing credentials.
    await f.session.prompt('again');
    assert.equal(f.session.messages.at(-1).stopReason, 'error');
    assert.equal(readAuth()['openai-codex'].access, token('main'));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('native Pi: /route off leaves Pi behaviour and credentials unchanged', { timeout: 20000 }, async () => {
  const f = await fixture();
  try {
    await f.session.prompt('/route off');
    f.limited.add('main');
    await f.session.prompt('disabled');
    assert.deepEqual(f.requests.map(r => r.account), ['main']);
    assert.equal(f.session.messages.at(-1).stopReason, 'error');
    assert.doesNotMatch(f.session.messages.at(-1).errorMessage, /quota-router/);
    assert.equal(readAuth()['openai-codex'].access, token('main'));
    assert.equal(readAuth()['openai-codex@work'].access, token('work'));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
