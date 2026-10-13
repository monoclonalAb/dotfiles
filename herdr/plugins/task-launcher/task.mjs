import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { constants, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { access, cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";

export const PLUGIN_ID = "martinro.task-launcher";
export const IMAGE_EXTENSIONS = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" });
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Pi's --session-id rule: letters, numbers, ".", "_" and "-", starting and ending alphanumeric.
const SESSION_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const DAY = 24 * 60 * 60 * 1000;

// Shared by the draft, persisted handoff and runner. Never accept file paths
// from the clipboard/request as implicit attachments or unbounded base64 data.
export function validateImages(images = []) {
  if (!Array.isArray(images) || images.length > 8) throw new Error("At most 8 clipboard images per popup; reopen to reset.");
  let size = 0;
  for (const image of images) {
    if (!image || !Object.hasOwn(IMAGE_EXTENSIONS, image.mimeType) || typeof image.data !== "string"
        || !image.data.length || image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) {
      throw new Error("Clipboard images must be PNG, JPEG, GIF or WebP, at most 20 MiB total per popup.");
    }
    const bytes = Buffer.from(image.data, "base64");
    size += bytes.length;
    if (size > MAX_IMAGE_BYTES) throw new Error("Clipboard images exceed 20 MiB per popup; reopen to reset.");
    if (bytes.toString("base64") !== image.data) throw new Error("Invalid clipboard image encoding.");
  }
  return images;
}

const exec = promisify(execFile);
export const textLabel = (text) => String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 72);
const gitEnv = () => ({ ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" });

export async function git(cwd, ...args) {
  const { stdout } = await exec("git", ["-C", cwd, ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024, env: gitEnv(),
  });
  return stdout;
}

// For stdin, binary output, long operations and network commands. Detached from
// the popup's terminal, so SSH or credential helpers cannot prompt into the form.
export function gitProcess(cwd, args, { input, timeout = 15_000, maxBuffer = 4 * 1024 * 1024, binary = false, okCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, ...args], {
      env: gitEnv(), detached: true, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const stdout = [];
    let size = 0;
    let stderr = "";
    let failure;
    const stop = (error) => {
      failure ??= error;
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    };
    const timer = setTimeout(() => stop(new Error(`git ${args[0]} timed out after ${timeout / 1000} s`)), timeout);
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBuffer) stop(new Error(`git ${args[0]} output is larger than ${Math.round(maxBuffer / 1024 / 1024)} MiB`));
      else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4096); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      if (!okCodes.includes(code)) {
        const reason = stderr.trim().split("\n").filter(Boolean).at(-1) || `exited with code ${code}`;
        return reject(new Error(`git ${args[0]}: ${reason.replace(/^(fatal|error): /, "")}`));
      }
      const output = Buffer.concat(stdout);
      resolve(binary ? output : output.toString("utf8"));
    });
    if (input !== undefined) {
      child.stdin.on("error", () => {}); // A failing git reports through its exit code.
      child.stdin.end(input);
    }
  });
}

export function sourceContext(raw) {
  const context = typeof raw === "string" ? JSON.parse(raw) : raw;
  const cwd = context?.focused_pane_cwd || context?.workspace_cwd;
  if (!cwd || !isAbsolute(cwd)) throw new Error("The focused Herdr pane needs a local Git working directory.");
  // Do not propagate selected text, source agent status, or unrelated context.
  return { cwd, workspaceId: context.workspace_id };
}

const optional = (promise) => promise.then((value) => value.trim(), () => "");

// origin's default branch, for starting from the latest upstream. Read-only; nothing is fetched here.
async function defaultUpstream(root) {
  if (!(await optional(git(root, "remote"))).split("\n").includes("origin")) return undefined;
  let ref = await optional(git(root, "symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"));
  for (const candidate of ["refs/remotes/origin/main", "refs/remotes/origin/master"]) {
    if (ref) break;
    if (await optional(git(root, "rev-parse", "--verify", "--quiet", candidate))) ref = candidate;
  }
  const prefix = "refs/remotes/origin/";
  if (!ref.startsWith(prefix) || ref.length === prefix.length) return undefined;
  return { remote: "origin", branch: ref.slice(prefix.length), ref };
}

export async function discoverRepo(cwd) {
  const source = await realpath((await git(cwd, "rev-parse", "--show-toplevel")).trim());
  const commonDir = await realpath((await git(source, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim());
  // Git lists the main worktree first. Herdr only accepts the repo parent as
  // a create source, even when the user starts this task in a linked checkout.
  const listing = await git(source, "worktree", "list", "--porcelain", "-z");
  const first = listing.split("\0").find((field) => field.startsWith("worktree "));
  if (!first) throw new Error("Cannot locate the main Git checkout.");
  const root = await realpath(first.slice("worktree ".length));
  await git(root, "rev-parse", "--show-toplevel"); // Reject bare repositories.
  const head = (await git(source, "rev-parse", "--verify", "HEAD^{commit}")).trim();
  const [status, branch, upstream] = await Promise.all([
    git(source, "status", "--porcelain", "-z"), optional(git(source, "symbolic-ref", "--quiet", "--short", "HEAD")),
    defaultUpstream(root),
  ]);
  return { source, root, commonDir, head, dirty: status.length > 0, branch: branch || undefined, upstream,
    name: textLabel(root.split(sep).at(-1)), key: createHash("sha256").update(commonDir).digest("hex") };
}

// Update only origin's tracking ref for the default branch, then start from it.
export async function fetchUpstream(repo) {
  const { remote, branch, ref } = repo.upstream;
  try {
    await gitProcess(repo.root, ["fetch", "--quiet", "--no-tags", remote, `+refs/heads/${branch}:${ref}`], { timeout: 60_000 });
  } catch (error) {
    throw new Error(`Could not fetch ${remote}/${branch} (${error.message}). Retry, or start from the current commit.`);
  }
}

// Make the new checkout match the source's working tree: tracked edits as a
// binary patch on the same base commit, then untracked (not ignored) files as
// copy-on-write clones. The source checkout is only read.
export async function carryChanges(source, base, target, { maxFiles = 5000 } = {}) {
  const untracked = (await gitProcess(source, ["ls-files", "-z", "--others", "--exclude-standard"], {
    timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
  })).split("\0").filter(Boolean);
  if (untracked.length > maxFiles) {
    throw new Error(`${untracked.length} untracked files is more than ${maxFiles}; commit, ignore or remove some first`);
  }
  const patch = await gitProcess(source, ["diff", "--binary", "--no-color", "--no-ext-diff", "--no-textconv",
    "--ignore-submodules=all", base, "--"], { binary: true, timeout: 60_000, maxBuffer: 256 * 1024 * 1024 });
  // git apply is all-or-nothing, so a failed attempt leaves the checkout clean for a retry.
  if (patch.length) await gitProcess(target, ["apply", "--binary", "--whitespace=nowarn"], { input: patch, timeout: 60_000 });
  for (const path of untracked) {
    const destination = join(target, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(source, path), destination, { force: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
  }
  return { patched: patch.length > 0, files: untracked.length };
}

// Claude Code's convention: .worktreeinclude (gitignore syntax) names ignored
// files to bring into new worktrees, such as .env files or dependency folders.
// Only paths that are both listed and Git-ignored qualify.
export async function worktreeIncludes(root) {
  const file = join(root, ".worktreeinclude");
  try { await access(file); } catch { return []; }
  const listed = (await gitProcess(root, ["ls-files", "-z", "--others", "--ignored", "--directory", `--exclude-from=${file}`], {
    timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  })).split("\0").filter(Boolean);
  if (!listed.length) return [];
  const ignored = await gitProcess(root, ["check-ignore", "-z", "--stdin"], {
    input: `${listed.join("\0")}\0`, okCodes: [0, 1], timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  });
  return ignored.split("\0").filter(Boolean);
}

export const cloneCopy = (from, to) => new Promise((resolve, reject) => {
  // macOS cp -c clones on APFS (instant, no extra space) and falls back to a
  // normal copy elsewhere; -p keeps timestamps so build caches stay valid.
  const child = spawn("/bin/cp", ["-c", "-R", "-p", "--", from, to], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-2048); });
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `cp exited with code ${code}`)));
});

export async function copyIncluded(root, target, paths, { copy = cloneCopy, log = () => {} } = {}) {
  const failures = [];
  for (const path of paths) {
    const clean = path.replace(/\/+$/, "");
    const destination = join(target, clean);
    if (!clean || clean.split("/").includes("..")) continue;
    try {
      if (await lstat(destination).then(() => true, () => false)) continue; // Never overwrite or nest.
      log(`  ${clean}`);
      await mkdir(dirname(destination), { recursive: true });
      await copy(join(root, clean), destination);
    } catch (error) {
      failures.push(`${clean}: ${error.message}`);
    }
  }
  return failures;
}

export function chooseThinking(model, requested = "high") {
  if (!model) return requested;
  if (model.levels.includes(requested)) return requested;
  // Same clamping direction as Pi: next supported level at/above the request,
  // otherwise the highest available level. Capabilities come from Pi metadata.
  const order = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const index = order.indexOf(requested);
  return model.levels.find((level) => order.indexOf(level) >= index) ?? model.levels.at(-1);
}

export function initialSelection(models, defaults, remembered) {
  const key = remembered?.model ?? defaults.model;
  const model = models.find((entry) => entry.key === key);
  const thinking = remembered?.thinking ?? defaults.modelThinkingLevels?.[key] ?? defaults.thinking ?? "high";
  return { model, thinking: chooseThinking(model, thinking), startFrom: remembered?.startFrom ?? "current",
    notice: key && !model ? "Previous/default model is unavailable. Choose a model explicitly." : "" };
}

export function branchName(title) {
  const slug = title.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48).replace(/-$/, "");
  return `task/${slug || "new-task"}`;
}

async function canonicalFuturePath(path) {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(await canonicalFuturePath(parent), path.split(sep).at(-1));
  }
}

export async function requireOutside(path, roots) {
  if (!isAbsolute(path)) throw new Error("Runtime and worktree paths must be absolute.");
  const canonical = await canonicalFuturePath(path);
  for (const root of roots) {
    const rel = relative(root, canonical);
    if (!rel || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) {
      throw new Error("Keep task state and new worktrees outside the source checkout.");
    }
  }
  return canonical;
}

export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

// Synchronous twin for signal handlers, where the process exits right after.
function atomicJsonSync(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

const repoFile = (stateDir, folder, key) => {
  if (!/^[0-9a-f]{64}$/.test(key ?? "")) throw new Error("Invalid repository key.");
  return join(stateDir, folder, `${key}.json`);
};

export async function readPreferences(stateDir, repoKey) {
  const value = await readJson(repoFile(stateDir, "preferences", repoKey));
  if (typeof value?.model !== "string" || typeof value?.thinking !== "string") return undefined;
  return { model: value.model, thinking: value.thinking,
    ...(["current", "latest"].includes(value.startFrom) ? { startFrom: value.startFrom } : {}) };
}

// Unsent drafts survive Esc, a closed popup and Herdr hangups. Written only when
// the popup closes (never while typing), private like task requests.
export async function readDraft(stateDir, repoKey) {
  const value = await readJson(repoFile(stateDir, "drafts", repoKey));
  if (typeof value?.text !== "string" || !Array.isArray(value.images)) return undefined;
  try {
    validateImages(value.images.map(({ mimeType, data }) => ({ mimeType, data })));
    if (!value.images.every((image) => /^\[img #\d+\]$/.test(image.marker))) return undefined;
  } catch { return undefined; }
  return { text: value.text, images: value.images.map(({ marker, mimeType, data }) => ({ marker, mimeType, data })) };
}

export function writeDraftSync(stateDir, repoKey, draft) {
  const path = repoFile(stateDir, "drafts", repoKey);
  if (!draft) rmSync(path, { force: true });
  else atomicJsonSync(path, { text: draft.text, images: draft.images ?? [], savedAt: new Date().toISOString() });
}

export async function readHistory(stateDir, repoKey) {
  const value = await readJson(repoFile(stateDir, "history", repoKey));
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.trim()) : [];
}

export async function appendHistory(stateDir, repoKey, prompt, limit = 20) {
  const entries = (await readHistory(stateDir, repoKey)).filter((entry) => entry !== prompt);
  await atomicJson(repoFile(stateDir, "history", repoKey), [...entries, prompt].slice(-limit));
}

// Minimal TOML subset for the plugin's own config.toml: `key = "string"` lines.
export async function readLauncherConfig(directory) {
  if (!directory) return {};
  let text;
  try { text = await readFile(join(directory, "config.toml"), "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  const config = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/.exec(line);
    if (!match) throw new Error(`config.toml line ${index + 1}: expected key = "value"`);
    config[match[1]] = JSON.parse(`"${match[2]}"`);
  }
  return config;
}

// The shared Catppuccin palette, as `theme` writes it into Herdr's generated
// config ([theme.custom]). Reading the generated file keeps `theme` the only
// owner of colour values; a missing or older file just means default colours.
export async function readPalette(path) {
  let text;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
  const palette = {};
  let inside = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) inside = line === "[theme.custom]";
    const match = inside && /^([a-z0-9_]+)\s*=\s*"(#[0-9a-fA-F]{6})"/.exec(line);
    if (match) palette[match[1]] = match[2];
  }
  return Object.keys(palette).length ? palette : undefined;
}

// Pi prompt templates for /name completion: global first, then trusted project.
export async function loadPromptTemplates(directories) {
  const templates = new Map();
  for (const directory of directories) {
    let names;
    try { names = await readdir(directory); } catch { continue; }
    for (const file of names.sort()) {
      const name = file.slice(0, -3);
      if (!file.endsWith(".md") || !/^[\w.:-]+$/.test(name)) continue;
      let text;
      try { text = await readFile(join(directory, file), "utf8"); } catch { continue; }
      const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      const fields = {};
      for (const line of front?.[1].split(/\r?\n/) ?? []) {
        const field = /^([\w-]+):\s*(.*)$/.exec(line);
        if (field) fields[field[1]] = field[2].trim().replace(/^(["'])(.*)\1$/, "$2");
      }
      const firstLine = (front ? text.slice(front[0].length) : text).split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
      if (templates.has(name)) continue; // First directory wins, like the completion list order.
      templates.set(name, { name, description: textLabel(fields.description || firstLine.replace(/^#+\s*/, "")).slice(0, 60),
        ...(fields["argument-hint"] ? { argumentHint: textLabel(fields["argument-hint"]) } : {}) });
    }
  }
  return [...templates.values()];
}

// "/ship fix tests" names after the template's purpose, not the literal command.
export function namingMaterial(prompt, templates = []) {
  const match = /^\/([\w.:-]+)(?:\s+([\s\S]*))?$/.exec(prompt.trim());
  const template = match && templates.find((entry) => entry.name === match[1]);
  return template ? [template.description || template.name, match[2]?.trim()].filter(Boolean).join("\n") : prompt;
}

export function requestPath(stateDir, id) {
  if (!UUID.test(id ?? "")) throw new Error("Invalid task request ID.");
  return join(stateDir, "requests", `${id}.json`);
}

// Holds the live runner's PID; the request sweep never touches a live runner's files.
export const runnerPath = (stateDir, id) => requestPath(stateDir, id).replace(/\.json$/, ".runner");

export async function readRequest(stateDir, id) {
  const path = requestPath(stateDir, id);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > MAX_REQUEST_BYTES || (stat.mode & 0o077) !== 0) {
    throw new Error("Task request must be a private regular file (mode 600).");
  }
  const request = JSON.parse(await readFile(path, "utf8"));
  validateTask(request.prompt, request.model, request.thinking, request.images);
  if (!isAbsolute(request.cwd ?? "")) throw new Error("Task request has no absolute checkout path.");
  if (request.root !== undefined && !isAbsolute(request.root)) throw new Error("Task request has an invalid source path.");
  if (request.sessionId !== undefined && !SESSION_ID.test(request.sessionId)) throw new Error("Task request has an invalid session ID.");
  if (request.approve !== undefined && typeof request.approve !== "boolean") throw new Error("Task request has an invalid trust decision.");
  return request;
}

export async function updateRequest(stateDir, id, changes) {
  const request = { ...(await readRequest(stateDir, id)), ...changes };
  await atomicJson(requestPath(stateDir, id), request);
  return request;
}

export function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === "EPERM"; }
}

// Requests exist only to start (or restart) Pi. Remove them once nobody can use
// them: the checkout is gone, the runner died without cleaning up, or they are
// older than 30 days. A live runner's files are never touched.
export async function sweepRequests(stateDir, { now = Date.now(), alive = processAlive, maxAge = 30 * DAY } = {}) {
  const directory = join(stateDir, "requests");
  let names;
  try { names = await readdir(directory); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const ids = new Set(names.map((name) => name.slice(0, 36)).filter((id) => UUID.test(id)));
  const removed = [];
  for (const id of ids) {
    const runner = Number.parseInt(await readFile(runnerPath(stateDir, id), "utf8").catch(() => ""), 10);
    if (alive(runner)) continue;
    let remove = Number.isSafeInteger(runner);
    if (!remove) {
      try {
        const info = await lstat(requestPath(stateDir, id));
        const request = info.size <= MAX_REQUEST_BYTES ? JSON.parse(await readFile(requestPath(stateDir, id), "utf8")) : {};
        remove = now - info.mtimeMs > maxAge || !isAbsolute(request.cwd ?? "")
          || !(await stat(request.cwd).then(() => true, (error) => error.code !== "ENOENT"));
      } catch (error) {
        remove = error.code === "ENOENT" || error instanceof SyntaxError;
      }
    }
    if (!remove) continue;
    for (const name of names.filter((entry) => entry.startsWith(id))) {
      await rm(join(directory, name), { recursive: true, force: true });
    }
    removed.push(id);
  }
  return removed;
}

function validateTask(prompt, model, thinking, images) {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Describe the task first.");
  if (Buffer.byteLength(prompt) > 32 * 1024 || prompt.includes("\0")) throw new Error("Task text must be at most 32 KiB, without NUL characters.");
  if (!model || typeof model.provider !== "string" || typeof model.id !== "string"
      || !model.provider || !model.id || model.provider.includes("\0") || model.id.includes("\0")) {
    throw new Error("Choose an available Pi model first.");
  }
  if (!Array.isArray(model.levels) || !model.levels.includes(thinking)
      || !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(thinking)) {
    throw new Error("Choose a thinking level supported by this model.");
  }
  if (validateImages(images).length && !model.input?.includes("image")) {
    throw new Error("Choose an image-capable model or remove the image markers.");
  }
}

// The source checkout's saved Pi trust decision carries over to its task
// checkouts, so Pi does not ask again for every new folder. No saved decision:
// no flag, and Pi asks as usual.
const trustArgs = (request) => request.approve === true ? ["--approve"] : request.approve === false ? ["--no-approve"] : [];
const sessionOf = (request, id) => request.sessionId ?? id;

export function piArgs(request, imagePaths = [], id) {
  validateTask(request.prompt, request.model, request.thinking, request.images);
  if (imagePaths.length !== (request.images?.length ?? 0)
      || imagePaths.some((path) => typeof path !== "string" || !isAbsolute(path) || path.includes("\0"))) {
    throw new Error("Task images must be materialized before starting Pi.");
  }
  const session = sessionOf(request, id);
  // Pi still interprets @file after --. A leading space keeps task text literal.
  const prompt = request.prompt.startsWith("@") ? ` ${request.prompt}` : request.prompt;
  // Skills and fullscreen come from the managed `pi` wrapper and Pi settings.
  return ["--name", textLabel(request.title || request.prompt), "--provider", request.model.provider,
    "--model", request.model.id, "--thinking", request.thinking,
    ...(session ? ["--session-id", session] : []), ...trustArgs(request),
    "--", ...imagePaths.map((path) => `@${path}`), prompt];
}

// Reopen the task's own conversation: no prompt, model or name overrides.
export function resumeArgs(request, id) {
  const session = sessionOf(request, id);
  if (!session) throw new Error("This task has no session to resume.");
  return ["--session-id", session, ...trustArgs(request)];
}

export function piEnvironment(env) {
  const clean = { ...env };
  for (const key of Object.keys(clean)) {
    if (key.startsWith("HERDR_PLUGIN_") || key.startsWith("HERDR_TASK_")
        || ["PI_SESSION_ID", "PI_SESSION_FILE", "PI_PROVIDER", "PI_MODEL", "PI_REASONING_LEVEL"].includes(key)) delete clean[key];
  }
  // Keep HERDR_PANE_ID/SOCKET_PATH/BIN_PATH for Pi's normal lifecycle bridge.
  return clean;
}

export class TaskLaunch {
  constructor({ repo, stateDir, rpc, summarize, id = randomUUID(), trust = null, templates = [],
    fetch = fetchUpstream, carry = carryChanges }) {
    Object.assign(this, { repo, stateDir, rpc, summarize, id, trust, templates, fetch, carry });
    this.busy = false;
    this.uncertain = false;
    this.launched = false;
  }

  async start(form) {
    if (this.busy || this.launched) throw new Error("This task is already starting or open.");
    if (this.uncertain) throw new Error("The previous request may have completed. Inspect the task Space before reopening the launcher; automatic retry is disabled.");
    validateTask(form.prompt, form.model, form.thinking, form.images);
    this.busy = true;
    try {
      if (!this.spec) {
        await requireOutside(this.stateDir, [this.repo.root, this.repo.source]);
        let branch = form.branch?.trim();
        if (branch) {
          if (branch.startsWith("-")) throw new Error("Branch cannot start with a dash.");
          await git(this.repo.root, "check-ref-format", `refs/heads/${branch}`);
        }
        let path;
        if (form.path?.trim()) {
          const expanded = form.path.trim().replace(/^~(?=\/)/, homedir());
          path = await requireOutside(expanded, [this.repo.root, this.repo.source]);
        }
        const custom = form.base?.trim();
        const latest = !custom && form.startFrom === "latest";
        if (latest && !this.repo.upstream) throw new Error("This repository has no origin default branch; start from the current commit.");
        if (form.carry && (latest || custom)) throw new Error("Bringing uncommitted changes needs the current commit as the start point, without a custom base.");
        if (latest) await this.fetch(this.repo);
        // Pin a commit now: later source edits and HEAD changes are not followed.
        const baseRef = custom || (latest ? this.repo.upstream.ref : this.repo.head);
        const base = (await git(this.repo.source, "rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`)).trim();
        let label;
        if (branch) label = textLabel(branch.replace(/[/_-]+/g, " "));
        else {
          try {
            label = (await this.summarize({ prompt: namingMaterial(form.prompt, this.templates), model: form.model })).toLowerCase();
          } catch (error) {
            // An honest placeholder, not a truncated prompt dressed up as a summary.
            label = `untitled task ${this.id.slice(0, 4)}`;
            this.namingWarning = `Automatic naming failed (${error.message}), so the branch is ${branchName(label)}.`;
          }
        }
        branch ||= branchName(label);
        await git(this.repo.root, "check-ref-format", `refs/heads/${branch}`);
        this.spec = { branch, base, label, ...(path ? { path } : {}) };
      }
      if (!this.created) {
        this.created = await this.mutate("worktree.create", {
          cwd: this.repo.root, ...this.spec, focus: false,
        });
      }
      const cwd = this.created.worktree?.path;
      const workspaceId = this.created.workspace?.workspace_id;
      if (typeof cwd !== "string" || !isAbsolute(cwd) || !workspaceId) {
        this.uncertain = true;
        throw new Error("Herdr created a checkout but returned no task Space identity. Inspect it before retrying.");
      }
      if (form.carry && !this.carried) {
        if (this.spec.base !== this.repo.head) throw new Error("Uncommitted changes can only be copied onto the current commit.");
        try { await this.carry(this.repo.source, this.spec.base, cwd); }
        catch (error) {
          throw new Error(`Checkout created, but your uncommitted changes could not be copied: ${error.message}. Retry, or switch to leave changes.`);
        }
        this.carried = true;
      }
      const request = { cwd, root: this.repo.root, title: this.spec.label, prompt: form.prompt, model: form.model,
        thinking: form.thinking, sessionId: this.id, ...(typeof this.trust === "boolean" ? { approve: this.trust } : {}),
        ...(form.images?.length ? { images: form.images.map(({ mimeType, data }) => ({ mimeType, data })) } : {}) };
      await atomicJson(requestPath(this.stateDir, this.id), request);
      const opened = await this.mutate("plugin.pane.open", {
        plugin_id: PLUGIN_ID, entrypoint: "pi", placement: "tab",
        workspace_id: workspaceId, cwd, focus: true,
        env: { HERDR_TASK_ID: this.id },
      });
      if (!opened.plugin_pane?.pane?.pane_id) {
        this.uncertain = true;
        throw new Error("Herdr returned no Pi pane identity. Inspect the task Space before retrying.");
      }
      this.launched = true; // No later failure may resend a task already running.
      const warnings = this.namingWarning ? [this.namingWarning] : [];
      try {
        const tabId = opened.plugin_pane.pane.tab_id;
        // Only the bootstrap tab from this allocation is ours to remove. Never
        // infer ownership from position, or close arbitrary extra/user tabs.
        const shellId = this.created.workspace.tab_count === 1 ? this.created.workspace.active_tab_id : undefined;
        if (!tabId || !shellId || tabId === shellId) throw new Error("Herdr returned no distinct initial shell/Pi tab identities");
        const { tabs } = await this.rpc("tab.list", { workspace_id: workspaceId });
        if (!(tabs?.length === 1 && tabs[0].tab_id === tabId)) {
          const shell = tabs?.find((tab) => tab.tab_id === shellId);
          if (tabs?.length !== 2 || !tabs.some((tab) => tab.tab_id === tabId) || shell?.pane_count !== 1) {
            throw new Error("Task tabs changed; initial shell was not closed");
          }
          await this.rpc("tab.close", { tab_id: shellId });
          const remaining = await this.rpc("tab.list", { workspace_id: workspaceId });
          if (remaining.tabs?.length !== 1 || remaining.tabs[0].tab_id !== tabId) {
            throw new Error("Herdr did not confirm a single Pi tab");
          }
        }
      } catch (error) {
        warnings.push(`Pi is open, but single-tab cleanup was not confirmed: ${error.message}. Inspect the task Space; do not relaunch the task.`);
      }
      try {
        await atomicJson(repoFile(this.stateDir, "preferences", this.repo.key), {
          model: form.model.key, thinking: form.thinking, startFrom: form.startFrom === "latest" ? "latest" : "current",
        });
        writeDraftSync(this.stateDir, this.repo.key, undefined);
        await appendHistory(this.stateDir, this.repo.key, form.prompt);
      } catch (error) {
        warnings.push(`Pi tab opened, but launcher preferences could not be saved: ${error.message}`);
      }
      return { cwd, warning: warnings.join(" ") };
    } finally {
      this.busy = false;
    }
  }

  async mutate(method, params) {
    try { return await this.rpc(method, params); }
    catch (error) {
      if (error.uncertain) this.uncertain = true;
      throw error;
    }
  }

  recoveryMessage() {
    const checkout = this.created?.worktree?.path;
    const kept = checkout ? `Checkout kept: ${checkout}.${this.uncertain ? "" : " Retry uses this checkout."}` : "";
    const uncertain = this.uncertain
      ? `Outcome unknown for ${this.spec?.branch ?? "task"}; inspect the task Space. No automatic retry.` : "";
    return [kept, uncertain].filter(Boolean).join(" ");
  }
}
