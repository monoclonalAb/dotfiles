import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { RpcError } from "./rpc.mjs";
import { findPi, loadPiModules } from "./pi-runtime.mjs";
import { createTaskForm } from "./ui.mjs";
import { spawnPi, runRequest } from "./runner.mjs";
import { TaskLaunch, atomicJson, branchName, discoverRepo, initialSelection, piArgs, piEnvironment,
  readPreferences, readRequest, requestPath, requireOutside, sourceContext, validateImages } from "./task.mjs";

const exec = promisify(execFile);
const model = { key: "test/reasoner", provider: "test", id: "reasoner", levels: ["off", "high", "max"] };
const form = { prompt: "Add keyboard navigation", model, thinking: "high" };
const id = "12345678-1234-4123-8123-123456789abc";
const git = async (cwd, ...args) => (await exec("git", ["-c", "core.hooksPath=/dev/null", "-C", cwd, ...args], {
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, encoding: "utf8",
})).stdout;

async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-tasks-test-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, "website's source");
  await mkdir(source);
  await git(source, "init", "-b", "main");
  await writeFile(join(source, "README.md"), "base\n");
  await git(source, "add", "README.md");
  await git(source, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
  const repo = await discoverRepo(source);
  const stateDir = join(dir, "state");
  const checkout = join(dir, "task checkout");
  const calls = [];
  const tabs = [];
  const summaries = [];
  const summarize = async (submitted) => { summaries.push(submitted); return "Implement keyboard controls"; };
  const rpc = async (method, params) => {
    calls.push({ method, params });
    if (method === "worktree.create") {
      await git(params.cwd, "worktree", "add", "-b", params.branch, params.path ?? checkout, params.base);
      tabs.splice(0, tabs.length, { tab_id: "tab-shell", number: 1, pane_count: 1, focused: false });
      return { type: "worktree_created", workspace: { workspace_id: "workspace-task", active_tab_id: "tab-shell", tab_count: 1 }, worktree: { path: params.path ?? checkout } };
    }
    if (method === "tab.list") {
      assert.deepEqual(params, { workspace_id: "workspace-task" });
      return { type: "tab_list", tabs: [...tabs] };
    }
    if (method === "tab.close") {
      assert.deepEqual(params, { tab_id: "tab-shell" });
      assert.ok(tabs.some((tab) => tab.tab_id === "tab-pi"), "Pi must exist before closing the shell");
      tabs.splice(tabs.findIndex((tab) => tab.tab_id === "tab-shell"), 1);
      return { type: "ok" };
    }
    assert.equal(method, "plugin.pane.open");
    tabs.push({ tab_id: "tab-pi", number: 2, pane_count: 1, focused: true });
    return { type: "plugin_pane_opened", plugin_pane: { pane: { pane_id: "pane-pi", tab_id: "tab-pi" } } };
  };
  return { dir, source, repo, stateDir, checkout, calls, rpc, summarize, summaries, tabs };
}

test("source context is the focused checkout, without unrelated session data", () => {
  assert.deepEqual(sourceContext({ workspace_id: "w1", focused_pane_cwd: "/code/sub", workspace_cwd: "/other", selected_text: "private" }),
    { cwd: "/code/sub", workspaceId: "w1" });
  assert.throws(() => sourceContext({}), /Git working directory/);
});

test("remembered model wins, unavailable choices never silently switch provider", () => {
  const defaults = { model: model.key, thinking: "high" };
  assert.equal(initialSelection([model], defaults).model, model);
  assert.equal(initialSelection([model], defaults, { model: "missing", thinking: "max" }).model, undefined);
  assert.match(initialSelection([model], defaults, { model: "missing" }).notice, /unavailable/);
  assert.equal(initialSelection([model], { ...defaults, modelThinkingLevels: { [model.key]: "max" } }).thinking, "max");
  assert.equal(branchName("日本語"), "task/new-task");
  assert.equal(branchName("Implement Keyboard Controls"), "task/implement-keyboard-controls");
  assert.match(branchName("-- $(touch /tmp/no); toolbar"), /^task\/[a-z0-9-]+$/);
});

test("Git discovery from subdirectory and linked checkout shares preferences", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.source, "sub"));
  assert.equal((await discoverRepo(join(f.source, "sub"))).key, f.repo.key);
  await git(f.source, "worktree", "add", "-b", "linked", f.checkout);
  const linked = await discoverRepo(f.checkout);
  assert.equal(linked.root, f.repo.root);
  assert.notEqual(linked.source, linked.root);
  assert.equal(linked.key, f.repo.key);
});

test("submit uses summarized names and leaves exactly one focused Pi tab without changing the prompt", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.source, "README.md"), "user's uncommitted work\n");
  const before = await git(f.source, "status", "--porcelain");
  const launch = new TaskLaunch({ ...f, id });
  assert.equal((await readdir(f.dir)).includes("state"), false); // construction has no writes
  const result = await launch.start(form);
  assert.equal(result.cwd, f.checkout);
  assert.equal(result.warning, "");
  assert.equal(f.calls[0].params.branch, "task/implement-keyboard-controls");
  assert.equal(f.calls[0].params.label, "implement keyboard controls");
  assert.equal(f.summaries.length, 1);
  const request = await readRequest(f.stateDir, id);
  assert.equal(request.title, "implement keyboard controls");
  assert.equal(piArgs(request)[1], request.title);
  assert.equal(await readFile(join(f.source, "README.md"), "utf8"), "user's uncommitted work\n");
  assert.equal(await git(f.source, "status", "--porcelain"), before);
  assert.equal(await readFile(join(f.checkout, "README.md"), "utf8"), "base\n");
  assert.equal(f.calls[0].params.base, f.repo.head);
  assert.equal(f.calls[0].params.focus, false);
  assert.deepEqual(f.calls[1], { method: "plugin.pane.open", params: {
    plugin_id: "martinro.task-launcher", entrypoint: "pi", placement: "tab", workspace_id: "workspace-task",
    cwd: f.checkout, focus: true, env: { HERDR_TASK_ID: id },
  } });
  assert.deepEqual(await readPreferences(f.stateDir, f.repo.key), { model: model.key, thinking: "high" });
  assert.equal((await stat(requestPath(f.stateDir, id))).mode & 0o777, 0o600);
  assert.equal((await readRequest(f.stateDir, id)).prompt, form.prompt);
  await assert.rejects(launch.start(form), /already/);
  assert.equal(f.calls.length, 5);
  assert.deepEqual(f.calls[3], { method: "tab.close", params: { tab_id: "tab-shell" } });
  assert.deepEqual(f.tabs.map((tab) => [tab.tab_id, tab.focused]), [["tab-pi", true]]);
});

test("invalid prompt, model, base, branch, or in-repo path cannot allocate", async (t) => {
  const f = await fixture(t);
  for (const change of [{ prompt: " " }, { model: undefined }, { thinking: "low" }, { prompt: "a\0b" },
    { base: "does-not-exist" }, { branch: "--bad" }, { branch: "two dots.." }, { path: join(f.source, "nested") }, { path: "relative" }]) {
    await assert.rejects(new TaskLaunch(f).start({ ...form, ...change }));
  }
  assert.equal(f.calls.length, 0);
  assert.equal(f.summaries.length, 0);
  await assert.rejects(stat(f.stateDir), { code: "ENOENT" });
  await symlink(f.source, join(f.dir, "alias"));
  await assert.rejects(requireOutside(join(f.dir, "alias", "nested"), [f.repo.root]), /outside/);
});

test("explicit base and path are respected; existing branch is never adopted", async (t) => {
  const f = await fixture(t);
  await assert.rejects(new TaskLaunch(f).start({ ...form, branch: "main" }));
  const launch = new TaskLaunch(f);
  await launch.start({ ...form, branch: "feature/keys", base: "main", path: join(f.dir, "explicit path") });
  assert.equal(launch.created.worktree.path, join(f.dir, "explicit path"));
  assert.equal(f.calls.findLast((call) => call.method === "worktree.create").params.branch, "feature/keys");
  assert.equal(f.summaries.length, 0); // An explicit branch needs no naming request.
});

test("Pi pane rejection retains form request and retries only startup in same checkout", async (t) => {
  const f = await fixture(t);
  let rejectPane = true;
  const launch = new TaskLaunch({ ...f, id, rpc: async (method, params) => {
    if (method === "plugin.pane.open" && rejectPane) throw new RpcError("pane spawn failed", false);
    return f.rpc(method, params);
  } });
  await assert.rejects(launch.start(form), /pane spawn failed/);
  assert.match(launch.recoveryMessage(), /Checkout kept/);
  assert.deepEqual(f.tabs.map((tab) => tab.tab_id), ["tab-shell"]);
  assert.equal(f.calls.some((call) => call.method === "tab.close"), false);
  assert.equal((await readRequest(f.stateDir, id)).prompt, form.prompt);
  rejectPane = false;
  await launch.start({ ...form, prompt: "Updated task prompt" });
  assert.equal(f.calls.filter((call) => call.method === "worktree.create").length, 1);
  assert.equal(f.summaries.length, 1);
  assert.equal((await readRequest(f.stateDir, id)).title, "implement keyboard controls");
  assert.equal((await readRequest(f.stateDir, id)).prompt, "Updated task prompt");
});

test("transport uncertainty blocks automatic mutation replay", async (t) => {
  const f = await fixture(t);
  for (const uncertainMethod of ["worktree.create", "plugin.pane.open"]) {
    const launch = new TaskLaunch({ ...f, rpc: async (method, params) => {
      if (method === uncertainMethod) throw new RpcError("lost reply", true);
      return f.rpc(method, params);
    } });
    await assert.rejects(launch.start(form), /lost reply/);
    assert.match(launch.recoveryMessage(), /No automatic retry/);
    await assert.rejects(launch.start(form), /automatic retry is disabled/);
  }
});

test("missing pane identity prevents claiming success or replaying startup", async (t) => {
  const f = await fixture(t);
  const launch = new TaskLaunch({ ...f, rpc: (method, params) => method === "plugin.pane.open" ? Promise.resolve({}) : f.rpc(method, params) });
  await assert.rejects(launch.start(form), /no Pi pane identity/);
  assert.equal(launch.launched, false);
  await assert.rejects(launch.start(form), /automatic retry is disabled/);
});

test("preference write failure after launch is a warning, not a retryable startup failure", async (t) => {
  const f = await fixture(t);
  await mkdir(f.stateDir);
  await writeFile(join(f.stateDir, "preferences"), "not a directory");
  const launch = new TaskLaunch(f);
  const result = await launch.start(form);
  assert.match(result.warning, /Pi tab opened/);
  assert.equal(launch.launched, true);
  await assert.rejects(launch.start(form), /already/);
  assert.equal(f.calls.length, 5);
});

test("concurrent Enter cannot create two worktrees", async (t) => {
  const f = await fixture(t);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const launch = new TaskLaunch({ ...f, rpc: async (method, params) => { await gate; return f.rpc(method, params); } });
  const first = launch.start(form);
  await assert.rejects(launch.start(form), /already/);
  release();
  await first;
  assert.equal(f.calls.length, 5);
});

test("naming failure retains an unallocated editable task; retry uses current prompt", async (t) => {
  const f = await fixture(t);
  const launch = new TaskLaunch({ ...f, summarize: async () => { throw new Error("naming unavailable"); } });
  await assert.rejects(launch.start(form), /naming unavailable/);
  assert.equal(launch.spec, undefined);
  assert.equal(launch.busy, false);
  assert.equal(f.calls.length, 0);
  await assert.rejects(stat(f.stateDir), { code: "ENOENT" });
  launch.summarize = f.summarize;
  await launch.start({ ...form, prompt: "Please fix keyboard focus when switching forms" });
  assert.equal(f.summaries[0].prompt, "Please fix keyboard focus when switching forms");
});

test("shell cleanup failures are warnings, never a retry that resends the prompt", async (t) => {
  const f = await fixture(t);
  const failures = [() => { throw new RpcError("lost close reply", true); },
    () => { throw new RpcError("close rejected", false); }, () => ({ type: "ok" })]; // False success must be detected by tab.list.
  for (const fail of failures) {
    const launch = new TaskLaunch({ ...f, rpc: (method, params) => method === "tab.close" ? fail() : f.rpc(method, params) });
    const result = await launch.start(form);
    assert.match(result.warning, /Pi is open.*do not relaunch/);
    assert.equal(launch.launched, true);
    await assert.rejects(launch.start(form), /already/);
    await git(f.source, "worktree", "remove", f.checkout); // fixture only
    await git(f.source, "branch", "-D", "task/implement-keyboard-controls");
  }
});

test("changed topology never closes an unidentified, split, or additional user tab", async (t) => {
  const f = await fixture(t);
  for (const change of [
    (tabs) => { tabs[0].tab_id = "unrelated-shell"; },
    (tabs) => { tabs[0].pane_count = 2; },
    (tabs) => { tabs.push({ tab_id: "user-tab", pane_count: 1 }); },
    (tabs) => { tabs.pop(); }, // Pi disappeared; never close the last shell.
  ]) {
    f.calls.length = 0;
    const launch = new TaskLaunch({ ...f, rpc: async (method, params) => {
      const result = await f.rpc(method, params);
      if (method === "plugin.pane.open") change(f.tabs);
      return result;
    } });
    assert.match((await launch.start(form)).warning, /Task tabs changed/);
    assert.equal(f.calls.some((call) => call.method === "tab.close"), false);
    await git(f.source, "worktree", "remove", f.checkout);
    await git(f.source, "branch", "-D", "task/implement-keyboard-controls");
  }
});

test("missing initial shell identity is a warning, not permission to close by position", async (t) => {
  const f = await fixture(t);
  const launch = new TaskLaunch({ ...f, rpc: async (method, params) => {
    const result = await f.rpc(method, params);
    if (method === "worktree.create") delete result.workspace.active_tab_id;
    return result;
  } });
  assert.match((await launch.start(form)).warning, /no distinct initial shell/);
  assert.equal(f.calls.some((call) => call.method === "tab.close"), false);
});

test("shell already gone leaves the single Pi tab alone", async (t) => {
  const f = await fixture(t);
  const launch = new TaskLaunch({ ...f, rpc: async (method, params) => {
    const result = await f.rpc(method, params);
    if (method === "plugin.pane.open") f.tabs.shift();
    return result;
  } });
  assert.equal((await launch.start(form)).warning, "");
  assert.equal(f.calls.some((call) => call.method === "tab.close"), false);
  assert.deepEqual(f.tabs.map((tab) => tab.tab_id), ["tab-pi"]);
});

test("argv and child env preserve literal task text without inheriting source session identity", () => {
  for (const prompt of ["--skill bad", "@file.txt", "a 'quoted' $(touch nope)\n`whoami`"]) {
    const args = piArgs({ ...form, prompt });
    assert.equal(args.at(-2), "--");
    assert.equal(args.at(-1).trim(), prompt.trim());
    assert.equal(args.includes("--continue"), false);
    assert.equal(args.includes("--approve"), false);
  }
  assert.deepEqual(piEnvironment({ HERDR_PANE_ID: "new", HERDR_SOCKET_PATH: "socket", HERDR_PLUGIN_CONTEXT_JSON: "old",
    PI_SESSION_FILE: "old.jsonl", HERDR_TASK_SOURCE: "old", PI_MODEL: "old", PATH: "bin" }),
  { HERDR_PANE_ID: "new", HERDR_SOCKET_PATH: "socket", PATH: "bin" });
});

test("runner exercises real child argv/cwd with a fake Pi, never a shell command", async (t) => {
  const f = await fixture(t);
  const executable = join(f.dir, "fake-pi");
  const capture = join(f.dir, "capture.json");
  await writeFile(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.CAPTURE, JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),pane:process.env.HERDR_PANE_ID,session:process.env.PI_SESSION_FILE}));\n`, { mode: 0o700 });
  const request = { ...form, prompt: `$(touch '${join(f.dir, "must-not-exist")}')`, cwd: f.source };
  await atomicJson(requestPath(f.stateDir, id), request);
  await runRequest({ stateDir: f.stateDir, id, executable,
    env: { PATH: process.env.PATH, CAPTURE: capture, HERDR_PANE_ID: "new-pane", PI_SESSION_FILE: "old" } });
  const output = JSON.parse(await readFile(capture, "utf8"));
  assert.deepEqual(output.args, piArgs(request));
  assert.equal(output.cwd, f.repo.source);
  assert.equal(output.pane, "new-pane");
  assert.equal(output.session, undefined);
  await assert.rejects(stat(join(f.dir, "must-not-exist")), { code: "ENOENT" });
  await assert.rejects(stat(requestPath(f.stateDir, id)), { code: "ENOENT" });
  await atomicJson(requestPath(f.stateDir, id), request);
  const failed = await runRequest({ stateDir: f.stateDir, id, executable, run: async () => ({ code: 1 }) });
  assert.equal(failed.code, 1);
  assert.equal((await readRequest(f.stateDir, id)).prompt, request.prompt);
  await assert.rejects(spawnPi(join(f.dir, "missing-pi"), request), { code: "ENOENT" });
  assert.throws(() => requestPath(f.stateDir, "../../bad"), /Invalid/);
});

const png = { mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" };
const visionModel = { ...model, input: ["text", "image"] };

test("image form → private handoff → runner → installed Pi CLI yields actual image content", async (t) => {
  const f = await fixture(t);
  const installation = await findPi();
  const { sdk, tui, bindings } = await loadPiModules(installation);
  const utility = (path) => import(pathToFileURL(join(dirname(installation.packagePath), "dist", path)).href);
  const { parseArgs } = await utility("cli/args.js");
  const { processFileArguments } = await utility("cli/file-processor.js");
  const launch = new TaskLaunch({ ...f, id });
  const ui = createTaskForm(tui, {
    renderer: { terminal: { rows: 24 }, requestRender() {} }, repo: f.repo, models: [visionModel],
    keybindings: new bindings.KeybindingsManager(), CustomEditor: sdk.CustomEditor,
    selection: { model: visionModel, thinking: "high" }, launch, onClose() {},
    readClipboard: async () => ({ type: "image", ...png }),
  });
  ui.handleInput("Compare: ");
  await ui.pasteClipboard();
  await ui.pasteClipboard();
  assert.equal(ui.editor.getExpandedText(), "Compare: [img #1][img #2]");
  await assert.rejects(stat(f.stateDir), { code: "ENOENT" }); // Draft images never hit disk.
  await ui.submit();
  assert.equal(launch.launched, true, ui.message);
  assert.deepEqual(f.summaries, [{ prompt: "Compare: ", model: visionModel }]); // Naming gets no image data.
  const request = await readRequest(f.stateDir, id);
  assert.deepEqual(request.images, [png, png]);
  assert.equal((await stat(requestPath(f.stateDir, id))).mode & 0o777, 0o600);
  assert.throws(() => piArgs(request), /materialized/);
  let imagePaths;
  await runRequest({ stateDir: f.stateDir, id, executable: "unused", run: async (_exe, received, _env, paths) => {
    imagePaths = paths;
    assert.equal((await stat(dirname(paths[0]))).mode & 0o777, 0o700);
    for (const path of paths) {
      assert.equal((await stat(path)).mode & 0o777, 0o600);
      assert.equal((await readFile(path)).toString("base64"), png.data);
    }
    const parsed = parseArgs(piArgs(received, paths));
    assert.deepEqual(parsed.fileArgs, paths);
    assert.deepEqual(parsed.messages, ["Compare: "]);
    assert.deepEqual(parsed.diagnostics, []);
    const processed = await processFileArguments(parsed.fileArgs);
    assert.equal(processed.images.length, 2);
    assert.ok(processed.images.every((image) => image.type === "image" && image.mimeType === "image/png" && image.data.length > 0));
    return { code: 0 };
  } });
  await assert.rejects(stat(dirname(imagePaths[0])), { code: "ENOENT" });
  await assert.rejects(stat(requestPath(f.stateDir, id)), { code: "ENOENT" });
});

test("image runner retains retry bytes after failure and removes materialized files even on spawn error", async (t) => {
  const f = await fixture(t);
  const request = { ...form, cwd: f.source, model: visionModel, images: [png] };
  await atomicJson(requestPath(f.stateDir, id), request);
  for (const throwing of [false, true]) {
    let directory;
    const pending = runRequest({ stateDir: f.stateDir, id, executable: "unused", run: async (_exe, received, _env, paths) => {
      assert.deepEqual(received.images, [png]);
      assert.equal((await readFile(paths[0])).toString("base64"), png.data);
      directory = dirname(paths[0]);
      if (throwing) throw new Error("spawn failed");
      return { code: 1 };
    } });
    if (throwing) await assert.rejects(pending, /spawn failed/);
    else assert.equal((await pending).code, 1);
    await assert.rejects(stat(directory), { code: "ENOENT" });
    assert.deepEqual((await readRequest(f.stateDir, id)).images, [png]);
  }
});

test("invalid/oversized images and non-vision models fail before naming or worktree allocation", async (t) => {
  const f = await fixture(t);
  for (const images of [null, {}, Array(9).fill(png), [{ ...png, mimeType: "image/svg+xml" }],
    [{ ...png, data: "!!!" }], [{ ...png, data: "" }], [{ ...png, data: "A".repeat(28 * 1024 * 1024) }]]) {
    await assert.rejects(new TaskLaunch(f).start({ ...form, model: visionModel, images }));
  }
  for (const badModel of [model, { ...model, input: ["text"] }]) {
    await assert.rejects(new TaskLaunch(f).start({ ...form, model: badModel, images: [png] }), /image-capable/);
  }
  await assert.rejects(new TaskLaunch(f).start({ ...form, prompt: " ", model: visionModel, images: [png] }), /Describe the task/);
  const large = { ...png, data: Buffer.alloc(11 * 1024 * 1024).toString("base64") };
  assert.throws(() => validateImages([large, large]), /exceed 20 MiB/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.summaries.length, 0);
  await assert.rejects(stat(f.stateDir), { code: "ENOENT" });
});

test("private image requests over the old text limit load; malformed stored attachments are rejected", async (t) => {
  const f = await fixture(t);
  const image = { ...png, data: Buffer.alloc(200 * 1024).toString("base64") };
  const request = { ...form, model: visionModel, cwd: f.source, images: [image] };
  await atomicJson(requestPath(f.stateDir, id), request);
  assert.deepEqual((await readRequest(f.stateDir, id)).images, [image]);
  await atomicJson(requestPath(f.stateDir, id), { ...request, images: [{ path: "/private/not-an-attachment.png" }] });
  await assert.rejects(readRequest(f.stateDir, id), /Clipboard images/);
});
