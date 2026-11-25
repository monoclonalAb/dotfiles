// The review server: serves one page's folder on 127.0.0.1 with the review
// script added to its HTML, takes notes from that page, and tells the page to
// reload when a file in the folder changes.
//
// Every path starts with a random token, so other pages in the browser cannot
// guess the address. Requests must name 127.0.0.1 or localhost as their Host
// (against DNS rebinding), and notes must come from the server's own origin as
// JSON. Files outside the folder, including through symlinks, are never served.
import { randomBytes } from "node:crypto";
import { type FSWatcher, watch } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { type Batch, NoteError, parseBatch } from "./notes.ts";

export const REVIEW_PATH = "__review";
const MAX_BODY = 512 * 1024;
const HEARTBEAT_MS = 20_000;

export interface Delivery {
  /** True when Pi was busy, so the notes wait until it finishes. */
  queued: boolean;
  /** The message as Pi received it, so the page can offer a copy. */
  text: string;
}

export interface ReviewServerOptions {
  /** Folder to serve. */
  folder: string;
  /** The page, relative to the folder. */
  entry: string;
  /** The browser script added to every HTML page. */
  overlayPath: string;
  deliver(batch: Batch): Delivery | Promise<Delivery>;
  /** Whether Pi is working, for pages that connect. */
  busy(): boolean;
  title?: string;
  /** Milliseconds to wait for more changes before reloading. */
  debounceMs?: number;
  watch?: boolean;
}

export interface ReviewServer {
  url: string;
  origin: string;
  token: string;
  /** Sends an event to every open review page. */
  broadcast(event: string, data: unknown): void;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** Files whose changes never reload the page: metadata and editor temp files. */
export function ignoredChange(file: string): boolean {
  const name = basename(file);
  return name === "artifact.json" || name.startsWith(".") || name.endsWith("~") || name.endsWith(".swp");
}

/** Adds the review script before the page's last </body>, else at the end. Works on bytes so any encoding survives. */
export function injectScript(html: Buffer, src: string): Buffer {
  const tag = Buffer.from(`<script src="${src}" defer></script>`);
  const at = html.toString("latin1").toLowerCase().lastIndexOf("</body");
  if (at < 0) return Buffer.concat([html, tag]);
  return Buffer.concat([html.subarray(0, at), tag, html.subarray(at)]);
}

function htmlType(html: Buffer): string {
  // A page that names its own charset keeps it; otherwise assume UTF-8.
  return /charset\s*=/i.test(html.subarray(0, 2048).toString("latin1")) ? "text/html" : "text/html; charset=utf-8";
}

function send(res: ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown) {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new NoteError("too much to send at once");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function startReviewServer(options: ReviewServerOptions): Promise<ReviewServer> {
  const folder = await realpath(options.folder);
  const token = randomBytes(16).toString("base64url");
  const clients = new Set<ServerResponse>();
  let origins: string[] = [];
  let hosts: string[] = [];

  function broadcast(event: string, data: unknown) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.write(message);
  }

  /** The file a request path names, or undefined when it is outside the folder or missing. */
  async function fileFor(rest: string): Promise<string | undefined> {
    let relativePath: string;
    try {
      relativePath = decodeURIComponent(rest);
    } catch {
      return undefined;
    }
    if (relativePath.includes("\0")) return undefined;
    let candidate = resolve(folder, relativePath);
    if (candidate !== folder && !candidate.startsWith(folder + sep)) return undefined;
    try {
      if ((await stat(candidate)).isDirectory()) candidate = join(candidate, "index.html");
      const real = await realpath(candidate);
      if (real !== folder && !real.startsWith(folder + sep)) return undefined;
      return (await stat(real)).isFile() ? real : undefined;
    } catch {
      return undefined;
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!hosts.includes(req.headers.host ?? "")) return send(res, 403, "Wrong host");
    const url = new URL(req.url ?? "/", "http://placeholder");
    const prefix = `/${token}/`;
    if (url.pathname === `/${token}`) {
      res.writeHead(302, { location: prefix + options.entry });
      return res.end();
    }
    if (!url.pathname.startsWith(prefix)) return send(res, 404, "Not found");
    const rest = url.pathname.slice(prefix.length);

    if (rest === `${REVIEW_PATH}/notes`) {
      if (req.method !== "POST") return send(res, 405, "Use POST");
      if (!origins.includes(String(req.headers.origin ?? ""))) return sendJson(res, 403, { ok: false, error: "Notes must come from the review page" });
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return sendJson(res, 415, { ok: false, error: "Notes must be JSON" });
      try {
        const batch = parseBatch(JSON.parse(await readBody(req)));
        const delivery = await options.deliver(batch);
        return sendJson(res, 200, { ok: true, queued: delivery.queued, count: batch.notes.length, text: delivery.text });
      } catch (error) {
        const reason = error instanceof NoteError ? error.message : error instanceof SyntaxError ? "not valid JSON" : `Pi could not take the notes: ${(error as Error).message}`;
        return sendJson(res, error instanceof NoteError || error instanceof SyntaxError ? 400 : 500, { ok: false, error: reason });
      }
    }

    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Read only");

    if (rest === `${REVIEW_PATH}/events`) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ busy: options.busy(), title: options.title ?? "" })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (rest === `${REVIEW_PATH}/overlay.js`) {
      return send(res, 200, await readFile(options.overlayPath), "text/javascript; charset=utf-8");
    }

    const file = await fileFor(rest);
    if (!file) return send(res, 404, "Not found");
    const body = await readFile(file);
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    if (type === "text/html") return send(res, 200, injectScript(body, `${prefix}${REVIEW_PATH}/overlay.js`), htmlType(body));
    return send(res, 200, body, type);
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      if (!res.headersSent) send(res, 500, `Review server error: ${(error as Error).message}`);
      else res.end();
    });
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", fail);
      done();
    });
  });
  const port = (server.address() as AddressInfo).port;
  hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  origins = hosts.map((host) => `http://${host}`);
  const origin = origins[0];

  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = new Set<string>();
  if (options.watch !== false) {
    try {
      watcher = watch(folder, { recursive: true }, (_event, name) => {
        const file = name ? String(name) : "";
        if (!file || ignoredChange(file)) return;
        changed.add(relative(folder, resolve(folder, file)));
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = undefined;
          broadcast("reload", { files: [...changed].sort() });
          changed.clear();
        }, options.debounceMs ?? 250);
      });
      watcher.on("error", () => watcher?.close());
    } catch {
      watcher = undefined;
    }
  }
  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  let closed: Promise<void> | undefined;
  return {
    url: `${origin}/${token}/${options.entry.split("/").map(encodeURIComponent).join("/")}`,
    origin,
    token,
    broadcast,
    close() {
      closed ??= (async () => {
        clearInterval(heartbeat);
        if (timer) clearTimeout(timer);
        watcher?.close();
        broadcast("stopped", {});
        for (const client of clients) client.end();
        clients.clear();
        await new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections();
        });
      })();
      return closed;
    },
  };
}
