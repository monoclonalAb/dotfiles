// Native Pi check for mcp-idle-stop: in a real SDK session with Pi's built-in MCP
// and codemode extensions, an idle session's stdio server is stopped, the next
// codemode call starts it again, and a running bash child is left alone.
// Run: node --test pi/extensions/mcp-idle-stop/native.test.mjs
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve installed code, then isolate HOME, auth and config before importing Pi.
const pkg = join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent');
const root = mkdtempSync(join(tmpdir(), 'mcp-idle-stop-native-'));
const path = process.env.PATH;
for (const key of Object.keys(process.env)) delete process.env[key];
const IDLE_SECONDS = 1;
Object.assign(process.env, {
  HOME: root, PATH: path, PI_CODING_AGENT_DIR: join(root, 'agent'), PI_OFFLINE: '1', PI_TELEMETRY: '0', PI_SKIP_VERSION_CHECK: '1',
  PI_MCP_IDLE_STOP_SECONDS: String(IDLE_SECONDS),
});
const agentDir = process.env.PI_CODING_AGENT_DIR;
mkdirSync(agentDir);
after(() => rmSync(root, { recursive: true, force: true }));
const sdk = await import(pathToFileURL(join(pkg, 'dist/index.js')));
const { builtInExtensions } = await import(pathToFileURL(join(pkg, 'dist/extensions/index.js')));
const ai = await import(pathToFileURL(join(pkg, 'node_modules/@earendil-works/pi-ai/dist/index.js')));
const extensionPath = fileURLToPath(new URL('index.ts', import.meta.url));

// A stdio MCP server with one tool that answers with its pid.
const server = join(root, 'fake-mcp.mjs');
writeFileSync(server, `
import { createInterface } from 'node:readline';
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  if (method === 'initialize') send({ id, result: { protocolVersion: params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } } });
  else if (method === 'tools/list') send({ id, result: { tools: [{ name: 'whoami', inputSchema: { type: 'object', properties: {} } }] } });
  else if (method === 'tools/call') send({ id, result: { content: [{ type: 'text', text: 'pid ' + process.pid }] } });
  else send({ id, error: { code: -32601, message: 'unknown method' } });
}).on('close', () => process.exit(0));
`);
writeFileSync(join(agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { fake: { command: process.execPath, args: [server], description: 'Fake server.' } } }));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// This process's children, as `ps` sees them.
function children() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).split('\n').flatMap((line) => {
    const [, pid, ppid, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/) ?? [];
    return Number(ppid) === process.pid ? [{ pid: Number(pid), command }] : [];
  });
}
const serverPids = () => children().filter((child) => child.command.includes(server)).map((child) => child.pid);
async function until(check, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(50)) if (check()) return true;
  return false;
}

test('an idle session stops its stdio server; the next codemode call starts it again', async () => {
  const faux = ai.fauxProvider({ provider: 'mcp-idle-stop-test', models: [{ id: 'fixture', contextWindow: 200000 }], tokensPerSecond: 100000 });
  faux.setResponses([
    ai.fauxAssistantMessage(ai.fauxToolCall('codemode', { code: 'return await tools.mcp__fake__whoami({})' })),
    ai.fauxAssistantMessage('done'),
  ]);
  const provider = { ...faux.provider, auth: { apiKey: { name: 'Synthetic only', resolve: async () => ({ auth: { apiKey: 'synthetic-key' } }) } } };
  const modelRuntime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, modelsStore: new ai.InMemoryModelsStore(), refreshOnCreate: false });
  modelRuntime.registerNativeProvider(provider);
  const settings = sdk.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
  const cwd = mkdtempSync(join(root, 'repo-'));
  const loader = new sdk.DefaultResourceLoader({
    cwd, agentDir, settingsManager: settings, extensionFactories: builtInExtensions, noExtensions: true,
    additionalExtensionPaths: ['builtin:mcp', 'builtin:codemode', extensionPath],
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const { session } = await sdk.createAgentSession({ cwd, agentDir, resourceLoader: loader, settingsManager: settings, modelRuntime, model: faux.getModel(), thinkingLevel: 'off', tools: ['bash', 'codemode'], sessionManager: sdk.SessionManager.inMemory(cwd) });
  const errors = [];
  await session.bindExtensions({ mode: 'rpc', uiContext: { notify: () => {}, setStatus: () => {} }, onError: (error) => errors.push(error) });
  let bash;
  try {
    assert(await until(() => serverPids().length === 1), 'the server starts with the session');
    const [first] = serverPids();

    bash = session.executeBash('sleep 30');
    assert(await until(() => children().some((child) => child.command.includes('sleep 30'))), 'the bash child starts');
    const bashPid = children().find((child) => child.command.includes('sleep 30')).pid;

    assert(await until(() => serverPids().length === 0, IDLE_SECONDS * 1000 + 5000), 'the idle session stops the server');
    assert(children().some((child) => child.pid === bashPid), 'the bash child is still running');

    await session.prompt('/mcp reconnect fake');
    assert.equal(serverPids().length, 1, '/mcp reconnect starts the server again');
    assert(await until(() => serverPids().length === 0, IDLE_SECONDS * 1000 + 5000), 'the reconnected server is stopped after another idle time');

    await session.prompt('Who serves fake?');
    const result = session.messages.find((message) => message.role === 'toolResult' && message.toolName === 'codemode');
    const text = result.content.map((part) => part.text ?? '').join('\n');
    assert(!result.isError, text);
    const [second] = serverPids();
    assert(second !== undefined && second !== first, 'a new server process runs');
    assert.match(text, new RegExp(`pid ${second}\\b`), 'the codemode call reached the new server');
    assert.deepEqual(errors, []);
  } finally {
    session.abortBash();
    await bash?.catch(() => {});
    await session.abort();
    // As Pi does on quit, so the MCP extension closes the restarted server.
    await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    session.dispose();
  }
});
