import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createNamer, findExecutable, findPi, loadCatalog, loadPiModules, loadPiSdk, projectTrust, readStartupDefaults,
  sessionLookup } from "./pi-runtime.mjs";
import { rpc } from "./rpc.mjs";
import { runTask } from "./runner.mjs";
import { PLUGIN_ID, TaskLaunch, discoverRepo, initialSelection, loadPromptTemplates, readDraft, readHistory,
  readLauncherConfig, readPalette, readPreferences, sourceContext, sweepRequests, writeDraftSync } from "./task.mjs";
import { createTaskForm } from "./ui.mjs";

const stateDir = () => process.env.HERDR_PLUGIN_STATE_DIR
  || join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "herdr", "plugins", PLUGIN_ID);
const configDir = () => process.env.HERDR_PLUGIN_CONFIG_DIR
  || join(homedir(), ".config", "herdr", "plugins", "config", PLUGIN_ID);
const herdrConfig = () => process.env.HERDR_CONFIG_PATH || join(homedir(), ".config", "herdr", "config.toml");

// The retry prompt in a Pi tab whose Pi exited with an error. A Herdr hangup
// aborts it; the runner then cleans up without writing to the closed terminal.
async function askRetry({ message, resumable, session, signal }) {
  if (!process.stdin.isTTY) return "close";
  console.error(`\n${message}`);
  console.error(resumable
    ? ["  Enter  resume this task's conversation", "  new    start a new conversation with the original task",
      `  q      close (later, in the checkout: pi --session-id ${session})`].join("\n")
    : ["  Enter  start Pi again with the original task", "  q      close (the task text is kept for 30 days)"].join("\n"));
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await input.question("> ", { signal })).trim().toLowerCase();
      if (["q", "quit", "close"].includes(answer)) return "close";
      if (!answer) return resumable ? "resume" : "start";
      if (resumable && answer === "new") return "new";
    }
  } catch (error) {
    if (error.name === "AbortError") return "close";
    throw error;
  } finally {
    input.close();
  }
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
    // After Herdr closes the tab, writes to the terminal fail; cleanup must not.
    for (const stream of [process.stdout, process.stderr]) stream.on("error", () => {});
    const taskId = id || process.env.HERDR_TASK_ID;
    let lookup;
    const sessionExists = async (request) => {
      if (!lookup) {
        const sdk = await loadPiSdk(installation);
        lookup = sessionLookup(sdk, (await readStartupDefaults(sdk.getAgentDir())).sessionDir);
      }
      return lookup(request, taskId);
    };
    process.exitCode = await runTask({
      stateDir: stateDir(), id: taskId, executable: installation.executable, sessionExists,
      ask: (options) => askRetry({ ...options, session: options.request.sessionId ?? taskId }),
      log: (line) => { try { console.error(line); } catch { /* terminal closed */ } },
      notify: (title, body) => rpc("notification.show", { title, body }, { timeoutMs: 5_000 }),
    });
    return;
  }
  const modules = await loadPiModules(installation);
  if (command === "--check") {
    console.log(`Pi Tasks dependencies OK: npm Pi ${installation.version}; ModelRuntime, trust, session, clipboard, autocomplete, shared editor/keybindings, and TUI APIs available.`);
    return;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Pi Tasks needs an interactive Herdr popup.");
  const context = process.env.HERDR_TASK_SOURCE ? JSON.parse(process.env.HERDR_TASK_SOURCE)
    : sourceContext(process.env.HERDR_PLUGIN_CONTEXT_JSON);
  // Best effort: clear out requests no runner can use any more.
  void sweepRequests(stateDir()).catch(() => {});
  const repo = await discoverRepo(context.cwd);
  const agentDir = modules.sdk.getAgentDir();
  const notices = [];
  const defaults = await readStartupDefaults(agentDir);
  const config = await readLauncherConfig(configDir()).catch((error) => {
    notices.push(`Pi Tasks ${error.message}; using defaults.`);
    return {};
  });
  let trust = null;
  try { trust = projectTrust(modules.sdk, agentDir, [repo.source, repo.root]); }
  catch (error) { notices.push(`Pi trust decision unreadable (${error.message}); Pi will ask.`); }
  const [{ models, cycleModels, runtime }, remembered, draft, history, templates, fd, palette] = await Promise.all([
    loadCatalog(modules, {}, defaults.enabledModels), readPreferences(stateDir(), repo.key),
    readDraft(stateDir(), repo.key), readHistory(stateDir(), repo.key),
    // Project templates load only where Pi itself would load them (trusted).
    loadPromptTemplates([join(agentDir, "prompts"), ...(trust === true ? [join(repo.source, ".pi", "prompts")] : [])]),
    findExecutable("fd", process.env.PATH, [join(agentDir, "bin")]),
    readPalette(herdrConfig()).catch(() => undefined),
  ]);
  const keybindings = modules.bindings.KeybindingsManager.create(agentDir);
  if (models.length === 0) throw new Error("No available Pi models. Configure a provider with /login in Pi, then reopen Pi Tasks.");
  const namer = createNamer(runtime, models, [config.naming_model, defaults.model].filter(Boolean));
  const renderer = new modules.tui.TuiMainScreen(new modules.tui.ProcessTerminal());
  const launch = new TaskLaunch({ repo, stateDir: stateDir(), rpc, summarize: namer.summarize, trust, templates });
  const selection = initialSelection(models, defaults, remembered);
  selection.notice = [selection.notice, ...notices].filter(Boolean).join(" ");
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
      readClipboard: modules.readClipboard, copyText: modules.sdk.copyToClipboard,
      draft, saveDraft: (value) => writeDraftSync(stateDir(), repo.key, value), history,
      autocomplete: new modules.tui.CombinedAutocompleteProvider(templates, repo.source, fd ?? null),
      namer: (model) => namer.pick(model), palette, selection, launch, onClose: close,
    });
    // Herdr closing the popup: keep the draft, skip terminal teardown, exit.
    for (const signal of ["SIGHUP", "SIGTERM"]) {
      process.once(signal, () => {
        form.persistDraft();
        process.exit(129);
      });
    }
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
