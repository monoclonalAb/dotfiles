import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { findPi, loadCatalog, loadPiModules, readStartupDefaults } from "./pi-runtime.mjs";
import { rpc } from "./rpc.mjs";
import { runRequest } from "./runner.mjs";
import { PLUGIN_ID, TaskLaunch, discoverRepo, initialSelection, readPreferences, sourceContext } from "./task.mjs";
import { createTaskForm } from "./ui.mjs";

const stateDir = () => process.env.HERDR_PLUGIN_STATE_DIR
  || join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "herdr", "plugins", PLUGIN_ID);

async function pause(message) {
  console.error(message);
  if (!process.stdin.isTTY) return "";
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return await input.question("Type retry to start Pi fresh and resend the task, or Enter to close: "); }
  finally { input.close(); }
}

export async function main(args) {
  const [command, id] = args;
  if (command === "open") {
    const context = sourceContext(process.env.HERDR_PLUGIN_CONTEXT_JSON);
    await rpc("plugin.pane.open", {
      plugin_id: PLUGIN_ID, entrypoint: "launcher", placement: "popup", focus: true,
      env: { HERDR_TASK_SOURCE: JSON.stringify(context) },
    });
    return;
  }
  if (!["form", "run", "--check"].includes(command)) {
    console.log("Pi Tasks: launch.sh open | form | run <request-id> | --check");
    return;
  }
  const installation = await findPi();
  if (command === "run") {
    for (;;) {
      let message;
      try {
        const result = await runRequest({ stateDir: stateDir(), id: id || process.env.HERDR_TASK_ID, executable: installation.executable });
        if (result.code === 0) {
          if (result.warning) console.error(result.warning);
          return;
        }
        message = [`Pi exited (${result.signal || result.code}). Checkout kept: ${result.request.cwd}`, result.warning].filter(Boolean).join("\n");
      } catch (error) {
        message = `Pi could not start: ${error.message}`;
      }
      const answer = await pause(`${message}\nTask request: ${stateDir()}/requests/${id || process.env.HERDR_TASK_ID}.json\nTo resume an existing conversation instead, use pi --continue in its checkout.`);
      if (answer.trim() !== "retry") return;
    }
  }
  const modules = await loadPiModules(installation);
  if (command === "--check") {
    console.log(`Pi Tasks dependencies OK: npm Pi ${installation.version}; ModelRuntime, clipboard, shared editor/keybindings, and TUI APIs available.`);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Pi Tasks needs an interactive Herdr popup.");
  const context = process.env.HERDR_TASK_SOURCE ? JSON.parse(process.env.HERDR_TASK_SOURCE)
    : sourceContext(process.env.HERDR_PLUGIN_CONTEXT_JSON);
  const repo = await discoverRepo(context.cwd);
  const defaults = await readStartupDefaults(modules.sdk.getAgentDir());
  const [{ models, cycleModels, summarize }, remembered] = await Promise.all([
    loadCatalog(modules, {}, defaults.enabledModels), readPreferences(stateDir(), repo.key),
  ]);
  const keybindings = modules.bindings.KeybindingsManager.create(modules.sdk.getAgentDir());
  if (models.length === 0) throw new Error("No available Pi models. Configure a provider with /login in Pi, then reopen Pi Tasks.");
  const renderer = new modules.tui.TuiMainScreen(new modules.tui.ProcessTerminal());
  const launch = new TaskLaunch({ repo, stateDir: stateDir(), rpc, summarize });
  await new Promise((resolve) => {
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      renderer.stop();
      process.stdin.pause();
      resolve();
    };
    const form = createTaskForm(modules.tui, {
      renderer, repo, models, cycleModels, defaults, keybindings, CustomEditor: modules.sdk.CustomEditor,
      readClipboard: modules.readClipboard,
      selection: initialSelection(models, defaults, remembered), launch, onClose: close,
    });
    renderer.addChild(form);
    renderer.setFocus(form);
    renderer.start();
  });
}

if (process.argv[1] && await realpath(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    console.error(`Pi Tasks: ${error.message}`);
    // Keep a failed popup visible; action commands have no TTY and exit promptly.
    if (process.stdin.isTTY) {
      const input = createInterface({ input: process.stdin, output: process.stdout });
      try { await input.question("Press Enter to close. "); } finally { input.close(); }
    }
    process.exitCode = 1;
  }
}
