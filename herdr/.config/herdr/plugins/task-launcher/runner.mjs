import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { piArgs, piEnvironment, readRequest, requestPath } from "./task.mjs";

export function spawnPi(executable, request, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, piArgs(request), {
      cwd: request.cwd, env: piEnvironment(env), stdio: "inherit", shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

// A retry is explicit and starts a fresh session. No task text is sent through
// Herdr pane input APIs, and Pi's normal project trust/auth flow stays intact.
export async function runRequest({ stateDir, id, executable, env = process.env, run = spawnPi }) {
  const request = await readRequest(stateDir, id);
  const result = await run(executable, request, env);
  if (result.code === 0) await rm(requestPath(stateDir, id), { force: true });
  return { ...result, request };
}
