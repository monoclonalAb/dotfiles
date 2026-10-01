import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { IMAGE_EXTENSIONS, piArgs, piEnvironment, readRequest, requestPath } from "./task.mjs";

export function spawnPi(executable, request, env = process.env, imagePaths = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, piArgs(request, imagePaths), {
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
  let directory;
  const warnings = [];
  let result;
  try {
    const paths = [];
    if (request.images?.length) {
      // A private, runner-owned directory beside the handoff, never in Git.
      // Request JSON owns retry data; files are only native Pi CLI inputs.
      directory = await mkdtemp(`${requestPath(stateDir, id)}.images-`);
      for (const [index, image] of request.images.entries()) {
        const path = join(directory, `${index + 1}.${IMAGE_EXTENSIONS[image.mimeType]}`);
        await writeFile(path, Buffer.from(image.data, "base64"), { mode: 0o600, flag: "wx" });
        paths.push(path);
      }
    }
    result = await run(executable, request, env, paths);
  } finally {
    if (directory) {
      try { await rm(directory, { recursive: true, force: true }); }
      catch (error) { warnings.push(`Temporary task images could not be removed: ${directory}: ${error.message}`); }
    }
  }
  if (result.code === 0) {
    try { await rm(requestPath(stateDir, id), { force: true }); }
    catch (error) { warnings.push(`Pi finished normally, but its task request could not be removed: ${error.message}`); }
  }
  return { ...result, request, warning: warnings.join(" ") || undefined };
}
