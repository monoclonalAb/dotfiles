import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createNamer, findExecutable, findPi, generateTaskTitle, loadCatalog, loadPiModules, needsExtensionRoute, projectTrust,
  readClipboardContent, readStartupDefaults, sessionLookup } from "./pi-runtime.mjs";
import { chooseThinking, piArgs, resumeArgs } from "./task.mjs";

const exec = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
async function temporary(t) {
  const path = await realpath(await mkdtemp(join(tmpdir(), "pi-task-runtime-")));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("Pi resolution supports bundled npm CLI and skips the managed wrapper", async (t) => {
  const dir = await temporary(t);
  const wrapper = join(dir, "wrapper");
  const bin = join(dir, "node", "bin");
  const packagePath = join(dir, "node", "lib", "node_modules", "@earendil-works", "pi-coding-agent", "package.json");
  await mkdir(wrapper);
  await mkdir(bin, { recursive: true });
  await mkdir(join(dirname(packagePath), "dist", "bundle"), { recursive: true });
  await writeFile(join(wrapper, "pi"), "#!/bin/sh\nexit 99\n", { mode: 0o700 });
  await writeFile(packagePath, JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "test" }));
  const cli = join(dirname(packagePath), "dist", "bundle", "cli.js");
  await writeFile(cli, "", { mode: 0o700 });
  await symlink(cli, join(bin, "pi"));
  assert.deepEqual(await findPi(`${wrapper}:${bin}`), { executable: join(wrapper, "pi"), packagePath, version: "test" });
  await assert.rejects(findPi(wrapper), /no other agent/);
});

test("catalog construction explicitly disables network and uses supported thinking metadata", async () => {
  let options;
  const modules = {
    sdk: { ModelRuntime: { create: async (received) => {
      options = received;
      return { getAvailable: async () => [{ provider: "test", id: "model", name: "Model" }], getError: () => undefined };
    } }, createAgentSession: () => { throw new Error("must not start an agent"); } },
    ai: { getSupportedThinkingLevels: () => ["high", "max"] },
  };
  const catalog = await loadCatalog(modules, { allowModelNetwork: true });
  assert.deepEqual(catalog.models, [
    { provider: "test", id: "model", key: "test/model", name: "Model", input: [], levels: ["high", "max"] },
  ]);
  assert.equal(catalog.cycleModels[0].model, catalog.models[0]);
  assert.equal(options.allowModelNetwork, false);
  assert.ok(options.signal instanceof AbortSignal);
});

test("installed SDK loads a custom catalog in isolated HOME without any network", async (t) => {
  const dir = await temporary(t);
  const installation = await findPi();
  const modelsPath = join(dir, "models.json");
  await writeFile(modelsPath, JSON.stringify({ providers: { "task-test": {
    baseUrl: "http://127.0.0.1:1", api: "openai-completions", apiKey: "test-only-not-a-secret",
    models: [{ id: "reasoner", input: ["text", "image"], reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, high: "high", max: "max" } }],
  } } }));
  const program = `
    let networkCalls = 0;
    globalThis.fetch = async () => { networkCalls++; throw new Error('Network is forbidden'); };
    const { loadCatalog, loadPiModules } = await import(${JSON.stringify(pathToFileURL(join(root, "pi-runtime.mjs")).href)});
    const modules = await loadPiModules(${JSON.stringify(installation)});
    const {models, cycleModels} = await loadCatalog(modules, {modelsPath:${JSON.stringify(modelsPath)}, authPath:${JSON.stringify(join(dir, "auth.json"))}, modelsStorePath:${JSON.stringify(join(dir, "store.json"))}}, ['task-test/reasoner:max']);
    console.log(JSON.stringify({models:models.filter(m=>m.provider==='task-test'),cycleModels,networkCalls}));
  `;
  const { stdout } = await exec(process.execPath, ["--input-type=module", "-e", program], {
    env: { HOME: dir, PATH: process.env.PATH, PI_OFFLINE: "1" }, timeout: 30_000,
  });
  const result = JSON.parse(stdout);
  assert.equal(result.networkCalls, 0);
  assert.deepEqual(result.models[0].levels, ["high", "max"]);
  assert.deepEqual(result.models[0].input, ["text", "image"]);
  assert.deepEqual(result.cycleModels.map((choice) => [choice.model.key, choice.thinkingLevel]), [["task-test/reasoner", "max"]]);
});

test("naming uses the exact selected model in a bounded tool-free request", async () => {
  const model = { provider: "test", id: "reasoner", levels: ["low", "high"] };
  const prompt = "When I sign in the page keeps spinning forever; could you investigate?";
  let calls = 0;
  const runtime = {
    getModel: (provider, id) => { assert.equal(provider, model.provider); assert.equal(id, model.id); return model; },
    completeSimple: async (selected, context, options) => {
      calls++;
      assert.equal(selected, model);
      assert.deepEqual(context.tools, []);
      assert.equal(context.messages.length, 1);
      assert.equal(context.messages[0].content, prompt);
      assert.match(context.systemPrompt, /Summarize the intended change/);
      // A reasoning model must not get even its lowest level: thinking derails naming.
      assert.equal("reasoning" in options, false);
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.maxTokens, 2048);
      assert.equal(options.cacheRetention, "none");
      assert.equal(options.sessionId, undefined);
      return { stopReason: "stop", content: [{ type: "thinking", thinking: "not a title" }, { type: "text", text: '"Fix sign in hang"' }] };
    },
  };
  assert.equal(await generateTaskTitle(runtime, { prompt, model }), "fix sign in hang");
  assert.equal(calls, 1);
  for (const stopReason of ["error", "aborted", "length", "toolUse"]) {
    await assert.rejects(generateTaskTitle({ ...runtime, completeSimple: async () => ({ stopReason, content: [] }) }, { prompt, model }), /naming failed/);
  }
  for (const text of ["", "word", "one two three four five six seven", "x".repeat(49), "../../bad", "$(touch nope)", "日本語の名前"]) {
    await assert.rejects(generateTaskTitle({ ...runtime, completeSimple: async () => ({ stopReason: "stop", content: [{ type: "text", text }] }) }, { prompt, model }), /invalid task title/);
  }
  await assert.rejects(generateTaskTitle({ getModel: () => undefined }, { prompt, model }), /unavailable/);
});

test("installed ModelRuntime naming supports a faux provider without sessions or network", async (t) => {
  const dir = await temporary(t);
  const { sdk, ai } = await loadPiModules(await findPi());
  const runtime = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(),
    modelsPath: null, modelsStorePath: join(dir, "store.json"), refreshOnCreate: false, allowModelNetwork: false });
  const faux = ai.fauxProvider({ provider: "task-title-test", models: [{ id: "namer", reasoning: false }] });
  runtime.registerNativeProvider(faux.provider);
  faux.setResponses([ai.fauxAssistantMessage([ai.fauxText("Fix login spinner")])]);
  assert.equal(await generateTaskTitle(runtime, { prompt: "The login page keeps spinning and never finishes.",
    model: { provider: "task-title-test", id: "namer", levels: ["off"] } }), "fix login spinner");
  assert.equal(faux.state.callCount, 1);
});

test("startup preferences are read-only, and malformed config is visible", async (t) => {
  const dir = await temporary(t);
  const path = join(dir, "settings.json");
  const settings = JSON.stringify({ defaultProvider: "test", defaultModel: "model", defaultThinkingLevel: "high", modelThinkingLevels: { "test/model": "max" }, enabledModels: ["test/model:max"] });
  await writeFile(path, settings);
  assert.deepEqual(await readStartupDefaults(dir), { model: "test/model", thinking: "high", modelThinkingLevels: { "test/model": "max" }, enabledModels: ["test/model:max"] });
  assert.equal(await readFile(path, "utf8"), settings);
  await writeFile(path, "broken");
  await assert.rejects(readStartupDefaults(dir), /Cannot read Pi startup preferences/);
});

test("Pi keybinding loader reuses defaults and migrates overrides without writing the file", async (t) => {
  const dir = await temporary(t);
  const { bindings } = await loadPiModules(await findPi());
  const path = join(dir, "keybindings.json");
  const raw = JSON.stringify({ newLine: "alt+n", cycleThinkingLevel: "alt+e" });
  await writeFile(path, raw);
  const keys = bindings.KeybindingsManager.create(dir);
  assert.deepEqual(keys.getKeys("tui.input.newLine"), ["alt+n"]);
  assert.deepEqual(keys.getKeys("app.thinking.cycle"), ["alt+e"]);
  assert.deepEqual(keys.getKeys("app.model.select"), ["ctrl+l"]);
  assert.equal(await readFile(path, "utf8"), raw);
});

test("model-switch effort clamping matches installed Pi, including capability holes", async () => {
  const { ai } = await loadPiModules(await findPi());
  for (const model of [
    { reasoning: false },
    { reasoning: true, thinkingLevelMap: { minimal: null, low: null, high: null, max: "max" } },
    { reasoning: true, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null, xhigh: null, max: "max" } },
  ]) {
    const levels = ai.getSupportedThinkingLevels(model);
    for (const requested of ["off", "minimal", "low", "medium", "high", "xhigh", "max"]) {
      assert.equal(chooseThinking({ levels }, requested), ai.clampThinkingLevel(model, requested));
    }
  }
});

test("installed Pi CLI parser treats task text as message, not flags or @files", async () => {
  const installation = await findPi();
  const { parseArgs } = await import(pathToFileURL(join(dirname(installation.packagePath), "dist", "cli", "args.js")).href);
  const { ai } = await loadPiModules(installation);
  const levels = ai.getSupportedThinkingLevels({ reasoning: true, thinkingLevelMap: { xhigh: null, max: "max" } });
  const model = { provider: "test", id: "model", levels };
  const id = "12345678-1234-4123-8123-123456789abc";
  for (const prompt of ["--skill bad", "@file.txt", "A 'quoted' task; $(false)\nSecond line"]) {
    const parsed = parseArgs(piArgs({ prompt, model, thinking: "high", approve: true }, [], id));
    assert.equal(parsed.sessionId, id);
    assert.equal(parsed.projectTrustOverride, true);
    assert.deepEqual(parsed.fileArgs, []);
    assert.equal(parsed.messages.length, 1);
    assert.equal(parsed.messages[0].trim(), prompt.trim());
    assert.equal(parsed.provider, "test");
    assert.equal(parsed.model, "model");
    assert.equal(parsed.continue, undefined);
    assert.deepEqual(parsed.diagnostics, []);
  }
  const resumed = parseArgs(resumeArgs({ approve: false }, id));
  assert.equal(resumed.sessionId, id);
  assert.equal(resumed.projectTrustOverride, false);
  assert.deepEqual(resumed.messages, []);
  assert.deepEqual(resumed.diagnostics, []);
});

test("Pi pane manifest resolves its entrypoint from plugin root, not checkout cwd", async (t) => {
  const dir = await temporary(t);
  const plugin = join(dir, "plugin's root");
  const checkout = join(dir, "checkout");
  await mkdir(plugin);
  await mkdir(checkout);
  await writeFile(join(plugin, "launch.sh"), 'printf "%s\\n" "$1" "$PWD"\n');
  const manifest = await readFile(join(root, "herdr-plugin.toml"), "utf8");
  const command = JSON.parse(manifest.match(/id = "pi"[\s\S]*?command = (\[.*\])/)[1]);
  const { stdout } = await exec(command[0], command.slice(1), {
    cwd: checkout, env: { HOME: dir, PATH: "/usr/bin:/bin", HERDR_PLUGIN_ROOT: plugin },
  });
  assert.deepEqual(stdout.trim().split("\n"), ["run", checkout]);
});

test("managed Pi wrapper preserves literal task argv and fullscreen/no-skills defaults", async (t) => {
  const dir = await temporary(t);
  const capture = join(dir, "argv.json");
  await writeFile(join(dir, "pi"), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.CAPTURE,JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
  const wrapper = resolve(root, "../../../bin/pi");
  const args = piArgs({ prompt: "--skill user text, not an option", model: { provider: "test", id: "model", levels: ["high"] }, thinking: "high" });
  await exec("/bin/sh", [wrapper, ...args], { env: { HOME: dir, PATH: dir, CAPTURE: capture } });
  const received = JSON.parse(await readFile(capture, "utf8"));
  assert.equal(received.at(-1), args.at(-1));
  assert.equal(received.at(-2), "--");
  assert.equal(received.filter((arg) => arg === "--tui-mode").length, 1);
  assert.ok(received.indexOf("--no-skills") < received.indexOf("--"));
});

test("clipboard adapter reads image first, falls back to text, and preserves read errors", async () => {
  const text = { readClipboardText: async () => "literal\x1b[201~\rtext" };
  const image = { readClipboardImage: async () => ({ mimeType: "image/png", bytes: Uint8Array.of(1, 2, 3) }) };
  assert.deepEqual(await readClipboardContent(image, { readClipboardText: () => assert.fail("image wins") }),
    { type: "image", mimeType: "image/png", data: "AQID" });
  const emptyImage = { readClipboardImage: async () => null };
  assert.deepEqual(await readClipboardContent(emptyImage, text), { type: "text", text: await text.readClipboardText() });
  assert.equal(await readClipboardContent(emptyImage, { readClipboardText: async () => null }), undefined);
  await assert.rejects(readClipboardContent({ readClipboardImage: async () => { throw new Error("denied"); } }, text), /denied/);
});

test("naming prefers the configured, then default, model and never sends Claude subscription traffic", async () => {
  const model = (provider, id) => ({ key: `${provider}/${id}`, provider, id, levels: ["off"] });
  const fast = model("lithosai", "flash");
  const claude = model("anthropic", "claude-opus-5-5");
  const codex = model("openai-codex", "gpt-6-astra");
  const named = [];
  const runtime = (oauth) => ({
    isUsingOAuth: (provider) => provider === "anthropic" && oauth,
    getModel: (provider, id) => ({ provider, id, baseUrl: provider === "anthropic" ? "https://api.anthropic.com" : "https://example.invalid" }),
    completeSimple: async (selected) => { named.push(`${selected.provider}/${selected.id}`); return { stopReason: "stop", content: [{ type: "text", text: "fix login hang" }] }; },
  });
  const models = [fast, claude, codex];
  assert.equal(needsExtensionRoute(runtime(true), claude), true);
  assert.equal(needsExtensionRoute(runtime(false), claude), false);
  assert.equal(needsExtensionRoute(runtime(true), codex), false);
  assert.equal(createNamer(runtime(true), models, ["missing/model", fast.key]).pick(codex), fast);
  assert.equal(createNamer(runtime(true), models, [claude.key]).pick(codex), codex); // Route-only config is skipped.
  assert.equal(createNamer(runtime(true), models, []).pick(claude), undefined);
  assert.equal(createNamer(runtime(false), models, []).pick(claude), claude); // API keys need no route.
  assert.equal(await createNamer(runtime(true), models, [fast.key]).summarize({ prompt: "Login hangs", model: claude }), "fix login hang");
  assert.deepEqual(named, ["lithosai/flash"]);
  await assert.rejects(createNamer(runtime(true), models, []).summarize({ prompt: "x", model: claude }), /set naming_model/);
});

test("trust and session lookups use Pi's own stores without writing them", async (t) => {
  const dir = await temporary(t);
  const { sdk } = await loadPiModules(await findPi());
  const agent = join(dir, "agent");
  const source = join(dir, "projects", "website");
  const checkout = join(dir, "worktrees", "website", "task-a");
  await mkdir(agent);
  await mkdir(source, { recursive: true });
  await mkdir(checkout, { recursive: true });
  assert.equal(projectTrust(sdk, agent, [source]), null);
  const trust = JSON.stringify({ [join(dir, "projects")]: true, [checkout]: false });
  await writeFile(join(agent, "trust.json"), trust);
  assert.equal(projectTrust(sdk, agent, [source]), true); // A trusted parent folder counts.
  assert.equal(projectTrust(sdk, agent, [checkout, source]), false);
  assert.equal(await readFile(join(agent, "trust.json"), "utf8"), trust);
  const sessions = join(dir, "sessions");
  const id = "12345678-1234-4123-8123-123456789abc";
  const lookup = sessionLookup(sdk, sessions);
  assert.equal(lookup({ cwd: checkout }, id), false);
  await mkdir(sessions);
  await writeFile(join(sessions, `2026-10-13T00-00-00-000Z_${id}.jsonl`),
    JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd: checkout }) + "\n");
  assert.equal(lookup({ cwd: checkout }, id), true);
  assert.equal(lookup({ cwd: checkout, sessionId: "another-session" }, id), false);
});

test("fd is found on PATH or in Pi's tool directory", async (t) => {
  const dir = await temporary(t);
  await writeFile(join(dir, "fd"), "#!/bin/sh\n", { mode: 0o700 });
  assert.equal(await findExecutable("fd", "/nonexistent:relative", [dir]), join(dir, "fd"));
  assert.equal(await findExecutable("fd", "", []), undefined);
});
