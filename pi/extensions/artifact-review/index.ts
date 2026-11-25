// /artifact-review: review an HTML page in the browser and send notes to Pi.
//
//   /artifact-review cove-october   an artifact id (any unique part), as `artifact show` takes
//   /artifact-review ./page.html    a file, folder or file:// URL
//   /artifact-review                pick from recent artifacts
//   /artifact-review stop
//
// The page opens from a local server (server.ts) with a review panel added
// (overlay.js). Option-click part of the page, or select text, and write a
// note; Send asks you to confirm the notes in Pi, then delivers them to this
// session as your next message, queued as a follow-up while Pi is working. When a file in the page's folder changes,
// the page reloads where you were. One review per session; it stops when the
// session ends, is replaced, or reloads.
//
// Policy exception (pi/extensions/README.md): this extension calls
// sendUserMessage, but only with notes sent from the review page of a review you
// started with this command, after you confirm each batch in Pi.
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatBatch, NoteError, type PageInfo } from "./notes.ts";
import { type ReviewServer, startReviewServer } from "./server.ts";

export const COMMAND = "artifact-review";
const STATUS_KEY = "artifact-review";
const LIST_TTL_MS = 15_000;

/** A page to review: its folder, its HTML file inside, and what artifact.json says. */
export interface Page {
  folder: string;
  entry: string;
  id?: string;
  title?: string;
  project?: string;
  session?: string;
}

interface ArtifactMeta {
  id?: string;
  title?: string;
  path?: string;
  entry?: string;
  project?: string;
  session?: string;
}

export interface Dependencies {
  /** Opens the review address in the browser. */
  open(url: string): Promise<void>;
  /** Runs the `artifact` command and returns its stdout. */
  artifact(args: string[]): Promise<string>;
  overlayPath: string;
}

function artifactCommand(): string {
  const local = join(homedir(), ".local", "bin", "artifact");
  return existsSync(local) ? local : "artifact";
}

export function defaultDependencies(pi: ExtensionAPI): Dependencies {
  return {
    async open(url) {
      if (process.env.PI_ARTIFACT_REVIEW_NO_OPEN === "1") return;
      await pi.exec("open", [url], { timeout: 10_000 });
    },
    async artifact(args) {
      const result = await pi.exec(artifactCommand(), args, { timeout: 15_000 });
      if (result.code !== 0) throw new Error((result.stderr || result.stdout).trim() || `artifact ${args.join(" ")} failed`);
      return result.stdout;
    },
    overlayPath: fileURLToPath(new URL("./overlay.js", import.meta.url)),
  };
}

function readMeta(folder: string): ArtifactMeta {
  try {
    const meta = JSON.parse(readFileSync(join(folder, "artifact.json"), "utf8"));
    return meta && typeof meta === "object" ? meta : {};
  } catch {
    return {};
  }
}

function fromMeta(meta: ArtifactMeta, folder: string, entry: string): Page {
  return { folder, entry, id: meta.id ?? (meta.title ? basename(folder) : undefined), title: meta.title, project: meta.project, session: meta.session };
}

/** True when the argument names something on disk rather than an artifact id. */
function looksLikePath(argument: string, cwd: string): boolean {
  return /^(file:|\/|~|\.\.?\/)/.test(argument) || /\.html?$/i.test(argument) || existsSync(resolve(cwd, argument));
}

function expand(argument: string, cwd: string): string {
  if (argument.startsWith("file:")) return fileURLToPath(argument);
  if (argument === "~" || argument.startsWith("~/")) return join(homedir(), argument.slice(1));
  return isAbsolute(argument) ? argument : resolve(cwd, argument);
}

/** Resolves a file, folder, file:// URL or artifact id to the page to serve. */
export async function resolvePage(argument: string, cwd: string, deps: Pick<Dependencies, "artifact">): Promise<Page> {
  if (looksLikePath(argument, cwd)) {
    const path = expand(argument, cwd);
    if (!existsSync(path)) throw new Error(`No such file or folder: ${path}`);
    if (statSync(path).isDirectory()) {
      const meta = readMeta(path);
      const entry = meta.entry ?? "index.html";
      if (!existsSync(join(path, entry))) throw new Error(`No ${entry} in ${path}`);
      return fromMeta(meta, path, entry);
    }
    const folder = dirname(path);
    return fromMeta(readMeta(folder), folder, basename(path));
  }
  const meta = JSON.parse(await deps.artifact(["show", argument])) as ArtifactMeta;
  if (!meta.path) throw new Error(`artifact show ${argument} gave no folder`);
  return { folder: meta.path, entry: meta.entry ?? "index.html", id: meta.id, title: meta.title, project: meta.project, session: meta.session };
}

interface Review {
  server: ReviewServer;
  page: Page;
}

export function registerArtifactReview(pi: ExtensionAPI, deps: Dependencies = defaultDependencies(pi)) {
  let review: Review | undefined;
  let busy = false;
  let listCache: { at: number; items: ArtifactMeta[] } | undefined;

  async function recent(): Promise<ArtifactMeta[]> {
    if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.items;
    const items = JSON.parse(await deps.artifact(["list", "--json", "-n", "0"])) as ArtifactMeta[];
    listCache = { at: Date.now(), items: Array.isArray(items) ? items : [] };
    return listCache.items;
  }

  async function stop(ctx?: { ui: ExtensionCommandContext["ui"]; hasUI: boolean }) {
    const current = review;
    review = undefined;
    if (!current) return false;
    await current.server.close();
    if (ctx?.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
    return true;
  }

  async function choose(ctx: ExtensionCommandContext): Promise<string | undefined> {
    if (!ctx.hasUI) throw new Error(`Usage: /${COMMAND} <artifact id, file or folder> | stop`);
    const items = await recent();
    if (!items.length) throw new Error("The artifact store is empty");
    const mine = ctx.sessionManager.getSessionFile();
    const ordered = [...items.filter((item) => mine && item.session === mine), ...items.filter((item) => !mine || item.session !== mine)].slice(0, 30);
    const labels = ordered.map((item) => `${item.id}${item.title ? ` — ${item.title}` : ""}`);
    const picked = await ctx.ui.select("Review which page?", labels);
    return picked ? ordered[labels.indexOf(picked)]?.id : undefined;
  }

  async function start(argument: string, ctx: ExtensionCommandContext) {
    const page = await resolvePage(argument, ctx.cwd, deps);
    await stop(ctx);
    const thisSession = ctx.sessionManager.getSessionFile();
    const info: PageInfo = {
      id: page.id,
      title: page.title,
      file: join(page.folder, page.entry),
      project: page.project,
      madeInSession: page.session,
      thisSession,
    };
    const server = await startReviewServer({
      folder: page.folder,
      entry: page.entry,
      overlayPath: deps.overlayPath,
      title: page.title,
      busy: () => busy,
      async deliver(batch) {
        const text = formatBatch(batch, info);
        // Scripts in the page share the panel's origin and could post notes, so a person confirms each batch.
        const count = `${batch.notes.length} note${batch.notes.length === 1 ? "" : "s"}`;
        if (!ctx.hasUI || !(await ctx.ui.confirm(`Send ${count} from the review page?`, text))) {
          throw new NoteError("you declined them in Pi");
        }
        const queued = !ctx.isIdle();
        // Sent at once when Pi is idle; otherwise waits until the current run ends.
        pi.sendUserMessage(text, { deliverAs: "followUp" });
        return { queued, text };
      },
    });
    review = { server, page };
    const name = page.id ?? basename(page.folder);
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, `reviewing ${name.length > 32 ? `${name.slice(0, 31)}…` : name}`);
      const elsewhere = page.session && page.session !== thisSession ? `\nThis page was made in another Pi session (${page.session}). Notes will come here.` : "";
      ctx.ui.notify(`Reviewing ${name}: ${server.url}\nOption-click any part of the page, or select text, to add a note. /${COMMAND} stop ends it.${elsewhere}`, elsewhere ? "warning" : "info");
    }
    try {
      await deps.open(server.url);
    } catch (error) {
      if (ctx.hasUI) ctx.ui.notify(`Could not open the browser (${(error as Error).message}); open ${server.url} yourself.`, "warning");
    }
  }

  pi.on("agent_start", () => {
    busy = true;
    review?.server.broadcast("busy", { busy });
  });
  pi.on("agent_settled", () => {
    busy = false;
    review?.server.broadcast("busy", { busy });
  });
  // Any end, replacement or reload of the session ends its review.
  pi.on("session_shutdown", async () => {
    await stop();
  });

  pi.registerCommand(COMMAND, {
    description: "Review a page in the browser: Option-click to leave notes, Send delivers them here, edits reload the page",
    getArgumentCompletions: async (prefix: string) => {
      const wanted = prefix.trim().toLowerCase();
      const items: { value: string; label: string; description?: string }[] = [];
      if (review && "stop".startsWith(wanted)) items.push({ value: "stop", label: "stop", description: "end the current review" });
      try {
        for (const item of await recent()) {
          if (item.id && item.id.toLowerCase().includes(wanted)) items.push({ value: item.id, label: item.id, description: item.title });
          if (items.length >= 30) break;
        }
      } catch {
        // No store or no `artifact` command: offer nothing.
      }
      return items.length ? items : null;
    },
    handler: async (args, ctx) => {
      const argument = args.trim();
      try {
        if (argument === "stop") {
          const stopped = await stop(ctx);
          if (ctx.hasUI) ctx.ui.notify(stopped ? "Review stopped." : "No review is running.", "info");
          return;
        }
        const target = argument || (await choose(ctx));
        if (!target) return;
        await start(target, ctx);
      } catch (error) {
        if (ctx.hasUI) ctx.ui.notify(`/${COMMAND}: ${(error as Error).message}`, "error");
        else throw error;
      }
    },
  });
}

export default function artifactReview(pi: ExtensionAPI) {
  registerArtifactReview(pi);
}
