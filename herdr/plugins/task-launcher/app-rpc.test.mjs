// node --test herdr/plugins/task-launcher/app-rpc.test.mjs
// Pi Tasks in the Herdr desktop app: TaskLaunch against a fake `herdr-app`.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { LAUNCHER, createAppRpc, readAppPalette, slug } from "./app-rpc.mjs";
import { TaskLaunch, discoverRepo, readRequest } from "./task.mjs";

const exec = promisify(execFile);
const model = { key: "test/reasoner", provider: "test", id: "reasoner", levels: ["off", "high", "max"] };
const form = { prompt: "Add keyboard navigation", model, thinking: "high" };
const id = "12345678-1234-4123-8123-123456789abc";
const git = async (cwd, ...args) => (await exec("git", ["-c", "core.hooksPath=/dev/null", "-C", cwd, ...args], {
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" }, encoding: "utf8",
})).stdout;

// A fake `herdr-app`: `do <command> <json>` and `ls`, over an in-memory window.
function fakeApp() {
  const spaces = [];
  const calls = [];
  let next = 1;
  const app = async (args) => {
    calls.push(args[0] === "do" ? [args[1], JSON.parse(args[2])] : args);
    if (args[0] === "ls") return { spaces: structuredClone(spaces) };
    const [, command, json] = args;
    const params = JSON.parse(json);
    const terminal = () => ({ terminal: `t${next}`, pane: `p${next++}` });
    if (command === "space.new") {
      const t = terminal();
      const space = { id: `sp${next}`, name: params.name, folder: params.folder, tabs: [{ id: `tb-shell`, terminals: [t] }] };
      spaces.push(space);
      return { space: space.id, tab: "tb-shell", terminal: t.terminal };
    }
    if (command === "tab.new") {
      const t = terminal();
      spaces.find((s) => s.id === params.space).tabs.push({ id: "tb-pi", terminals: [t], argv: params.argv, folder: params.folder });
      return { tab: "tb-pi", terminal: t.terminal };
    }
    if (command === "tab.close") {
      for (const space of spaces) space.tabs = space.tabs.filter((tab) => tab.id !== params.id);
      return { ok: true };
    }
    if (command === "space.select" || command === "tab.select") return { ok: true };
    return { error: `unknown command "${command}"` };
  };
  return { app, calls, spaces };
}

async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-tasks-app-test-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const source = join(dir, "website");
  await mkdir(source);
  await git(source, "init", "-b", "main");
  await writeFile(join(source, "README.md"), "base\n");
  await git(source, "add", "README.md");
  await git(source, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "-m", "fixture");
  const home = join(dir, "home");
  const fake = fakeApp();
  const logged = [];
  const rpc = createAppRpc({ app: fake.app, home, log: (line) => logged.push(line) });
  return { dir, home, source, repo: await discoverRepo(source), stateDir: join(dir, "state"), rpc, ...fake, logged,
    summarize: async () => "Implement keyboard controls" };
}

test("a task gets a worktree where the app's dialog puts them, a named Space, and one Pi tab", async (t) => {
  const f = await fixture(t);
  const result = await new TaskLaunch({ ...f, id }).start(form);
  const checkout = join(f.home, ".herdr/worktrees/website/task-implement-keyboard-controls");
  assert.equal(result.cwd, checkout);
  assert.equal(result.warning, "");
  assert.equal((await git(checkout, "branch", "--show-current")).trim(), "task/implement-keyboard-controls");
  assert.equal(await readFile(join(checkout, "README.md"), "utf8"), "base\n");
  assert.deepEqual(f.calls.map((c) => c[0]), ["space.new", "tab.new", "space.select", "tab.select", "ls", "ls", "tab.close", "ls"]);
  assert.deepEqual(f.calls[0][1], { name: "implement keyboard controls", folder: checkout });
  const [space] = f.spaces;
  assert.deepEqual(space.tabs.map((tab) => tab.id), ["tb-pi"], "the first shell tab is closed");
  assert.deepEqual(space.tabs[0].argv, ["/usr/bin/env", `HERDR_TASK_ID=${id}`, "HERDR_TASK_BACKEND=app", "/bin/sh", LAUNCHER, "run"]);
  assert.equal(space.tabs[0].folder, checkout);
  assert.equal((await readRequest(f.stateDir, id)).cwd, checkout);
});

test("an app error stops the launch with the app's message", async (t) => {
  const f = await fixture(t);
  const rpc = createAppRpc({ app: async () => ({ error: "no window" }), home: f.home });
  await assert.rejects(new TaskLaunch({ ...f, rpc, id }).start(form), /herdr-app space.new: no window/);
});

test("notifications are printed, other methods refused", async (t) => {
  const f = await fixture(t);
  await f.rpc("notification.show", { title: "Pi Tasks: some .worktreeinclude paths were not copied", body: ".env" });
  assert.deepEqual(f.logged, ["Pi Tasks: some .worktreeinclude paths were not copied: .env"]);
  await assert.rejects(f.rpc("plugin.pane.open", { entrypoint: "launcher", placement: "popup" }), /not available/);
  await assert.rejects(f.rpc("workspace.focus", {}), /not available/);
});

test("branch folders follow the app's worktree dialog", () => {
  assert.equal(slug("task/fix login"), "task-fix-login");
  assert.equal(slug("-weird--"), "weird");
});

test("the form takes its colours from the app's Catppuccin theme", async (t) => {
  const f = await fixture(t);
  assert.equal(await readAppPalette(f.home), undefined);
  await mkdir(join(f.home, ".local/state/theme"), { recursive: true });
  await writeFile(join(f.home, ".local/state/theme/flavour"), "latte\n");
  await mkdir(join(f.home, ".config/herdr-app/themes"), { recursive: true });
  const theme = await readFile(new URL("../../../herdr-app/themes/catppuccin-latte.json", import.meta.url), "utf8");
  await writeFile(join(f.home, ".config/herdr-app/themes/catppuccin-latte.json"), theme);
  assert.deepEqual(await readAppPalette(f.home), {
    accent: "#8839ef", mauve: "#8839ef", active_row_bg: "#ccd0da", surface0: "#ccd0da", surface1: "#bcc0cc",
    overlay1: "#8c8fa1", subtext0: "#6c6f85", text: "#4c4f69", peach: "#fe640b",
    red: "#d20f39", green: "#40a02b", yellow: "#df8e1d", blue: "#1e66f5", teal: "#179299",
  });
});
