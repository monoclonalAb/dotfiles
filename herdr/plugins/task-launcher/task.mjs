import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { promisify } from "node:util";

export const PLUGIN_ID = "martinro.task-launcher";
export const IMAGE_EXTENSIONS = Object.freeze({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" });
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 128 * 1024;

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

export async function git(cwd, ...args) {
  const { stdout } = await exec("git", ["-C", cwd, ...args], {
    encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout;
}

export function sourceContext(raw) {
  const context = typeof raw === "string" ? JSON.parse(raw) : raw;
  const cwd = context?.focused_pane_cwd || context?.workspace_cwd;
  if (!cwd || !isAbsolute(cwd)) throw new Error("The focused Herdr pane needs a local Git working directory.");
  // Do not propagate selected text, source agent status, or unrelated context.
  return { cwd, workspaceId: context.workspace_id };
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
  const dirty = (await git(source, "status", "--porcelain", "-z")).length > 0;
  return { source, root, commonDir, head, dirty, name: textLabel(root.split(sep).at(-1)),
    key: createHash("sha256").update(commonDir).digest("hex") };
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
  return { model, thinking: chooseThinking(model, thinking),
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

export async function readPreferences(stateDir, repoKey) {
  try {
    const value = JSON.parse(await readFile(join(stateDir, "preferences", `${repoKey}.json`), "utf8"));
    return typeof value?.model === "string" && typeof value?.thinking === "string" ? value : undefined;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
}

export function requestPath(stateDir, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id ?? "")) {
    throw new Error("Invalid task request ID.");
  }
  return join(stateDir, "requests", `${id}.json`);
}

export async function readRequest(stateDir, id) {
  const path = requestPath(stateDir, id);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > MAX_REQUEST_BYTES || (stat.mode & 0o077) !== 0) {
    throw new Error("Task request must be a private regular file (mode 600).");
  }
  const request = JSON.parse(await readFile(path, "utf8"));
  validateTask(request.prompt, request.model, request.thinking, request.images);
  if (!isAbsolute(request.cwd ?? "")) throw new Error("Task request has no absolute checkout path.");
  return request;
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

export function piArgs(request, imagePaths = []) {
  validateTask(request.prompt, request.model, request.thinking, request.images);
  if (imagePaths.length !== (request.images?.length ?? 0)
      || imagePaths.some((path) => typeof path !== "string" || !isAbsolute(path) || path.includes("\0"))) {
    throw new Error("Task images must be materialized before starting Pi.");
  }
  // Pi still interprets @file after --. A leading space keeps task text literal.
  const prompt = request.prompt.startsWith("@") ? ` ${request.prompt}` : request.prompt;
  return ["--name", textLabel(request.title || request.prompt), "--provider", request.model.provider,
    "--model", request.model.id, "--thinking", request.thinking,
    "--no-skills", "--tui-mode", "fullscreen", "--", ...imagePaths.map((path) => `@${path}`), prompt];
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
  constructor({ repo, stateDir, rpc, summarize, id = randomUUID() }) {
    Object.assign(this, { repo, stateDir, rpc, summarize, id });
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
        // Pin a commit now: source edits and future HEAD changes are not copied.
        const base = (await git(this.repo.source, "rev-parse", "--verify", "--end-of-options", `${form.base?.trim() || this.repo.head}^{commit}`)).trim();
        let path;
        if (form.path?.trim()) {
          const expanded = form.path.trim().replace(/^~(?=\/)/, homedir());
          path = await requireOutside(expanded, [this.repo.root, this.repo.source]);
        }
        const label = branch ? textLabel(branch.replace(/[/_-]+/g, " ")) : (await this.summarize({ prompt: form.prompt, model: form.model })).toLowerCase();
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
      const request = { cwd, title: this.spec.label, prompt: form.prompt, model: form.model, thinking: form.thinking,
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
      const warnings = [];
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
        await atomicJson(join(this.stateDir, "preferences", `${this.repo.key}.json`), {
          model: form.model.key, thinking: form.thinking,
        });
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
