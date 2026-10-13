import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IMAGE_EXTENSIONS, copyIncluded, piArgs, piEnvironment, readRequest, requestPath, resumeArgs, runnerPath,
  updateRequest, worktreeIncludes } from "./task.mjs";

export function spawnPi(executable, args, { cwd, env = process.env, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: "inherit", shell: false });
    onSpawn?.(child);
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

// One Pi process. A new conversation gets the task text and images; a resumed
// one reopens the task's own session by ID. Task text never goes through
// Herdr pane input APIs, and images exist on disk only while Pi runs.
export async function runRequest({ stateDir, id, executable, env = process.env, run = spawnPi, request, resume = false, onSpawn }) {
  request ??= await readRequest(stateDir, id);
  let directory;
  const warnings = [];
  let result;
  try {
    const paths = [];
    if (!resume && request.images?.length) {
      // A private, runner-owned directory beside the handoff, never in Git.
      directory = await mkdtemp(`${requestPath(stateDir, id)}.images-`);
      for (const [index, image] of request.images.entries()) {
        const path = join(directory, `${index + 1}.${IMAGE_EXTENSIONS[image.mimeType]}`);
        await writeFile(path, Buffer.from(image.data, "base64"), { mode: 0o600, flag: "wx" });
        paths.push(path);
      }
    }
    const args = resume ? resumeArgs(request, id) : piArgs(request, paths, id);
    result = await run(executable, args, { cwd: request.cwd, env: piEnvironment(env), onSpawn });
  } finally {
    if (directory) {
      try { await rm(directory, { recursive: true, force: true }); }
      catch (error) { warnings.push(`Temporary task images could not be removed: ${directory}: ${error.message}`); }
    }
  }
  return { ...result, request, warning: warnings.join(" ") || undefined };
}

// Before Pi's first start: clone the source's .worktreeinclude paths in. Never fatal.
export async function prepareCheckout(request, { log = () => {}, copy } = {}) {
  if (!request.root) return [];
  let paths;
  try { paths = await worktreeIncludes(request.root); }
  catch (error) { return [`.worktreeinclude: ${error.message}`]; }
  if (!paths.length) return [];
  log(`Pi Tasks: cloning ${paths.length} .worktreeinclude path(s) from ${request.root}`);
  return copyIncluded(request.root, request.cwd, paths, { copy, log });
}

// The Pi tab's whole life. The request is deleted once it cannot be needed
// again: Pi exited normally, or the tab/Space was closed (Herdr hangup). It is
// kept only when you close at the retry prompt, for `launch.sh run <id>`.
export async function runTask({ stateDir, id, executable, env = process.env, run = spawnPi, ask, sessionExists,
  notify = async () => {}, log = () => {}, signals = process, copy, pid = process.pid }) {
  let request = await readRequest(stateDir, id);
  const pidFile = runnerPath(stateDir, id);
  await writeFile(pidFile, `${pid}\n`, { mode: 0o600 });
  const closed = new AbortController();
  const say = (line) => { if (!closed.signal.aborted) log(line); }; // The terminal is gone after a hangup.
  let child;
  const hangup = (signal) => {
    closed.abort();
    try { child?.kill(signal); } catch { /* already exited */ }
  };
  for (const signal of ["SIGHUP", "SIGTERM"]) signals.on(signal, hangup);
  let keep = true; // Unexpected errors keep the task text.
  try {
    if (!request.prepared) {
      const failures = await prepareCheckout(request, { log: say, copy });
      if (failures.length) {
        say(`Pi Tasks: not copied:\n  ${failures.join("\n  ")}`);
        await notify("Pi Tasks: some .worktreeinclude paths were not copied", failures.join("; ")).catch(() => {});
      }
      request = await updateRequest(stateDir, id, { prepared: true });
    }
    let mode = request.started && await sessionExists(request) ? "resume" : "start";
    while (!closed.signal.aborted) {
      // Mark before spawning: any later run checks for a conversation first and
      // never resends the task into an existing one.
      if (mode === "start" && !request.started) request = await updateRequest(stateDir, id, { started: true });
      let message;
      try {
        const result = await runRequest({ stateDir, id, executable, env, run, request, resume: mode === "resume",
          onSpawn: (spawned) => { child = spawned; } });
        if (result.warning) say(result.warning);
        if (result.code === 0) {
          keep = false;
          return 0;
        }
        message = `Pi exited (${result.signal || result.code}). Checkout kept: ${request.cwd}`;
      } catch (error) {
        message = `Pi could not start: ${error.message}`;
      } finally {
        child = undefined;
      }
      if (closed.signal.aborted) break;
      const resumable = await sessionExists(request);
      const answer = await ask({ message, resumable, request, signal: closed.signal });
      if (closed.signal.aborted) break;
      if (answer === "close") return 1;
      if (answer === "new") {
        request = await updateRequest(stateDir, id, { sessionId: randomUUID(), started: false });
        mode = "start";
      } else mode = answer === "resume" ? "resume" : "start";
    }
    keep = false; // The tab was closed: nobody is left to retry.
    return 129;
  } finally {
    for (const signal of ["SIGHUP", "SIGTERM"]) signals.off(signal, hangup);
    if (!keep) await rm(requestPath(stateDir, id), { force: true }).catch(() => {});
    await rm(pidFile, { force: true }).catch(() => {});
  }
}
