// bun test ./pi/extensions/artifact-review/*.test.ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerArtifactReview, resolvePage } from "./index.ts";
import { formatBatch, NoteError, parseBatch } from "./notes.ts";
import { ignoredChange, injectScript, type ReviewServer, startReviewServer } from "./server.ts";

const overlayPath = new URL("./overlay.js", import.meta.url).pathname;
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

function tempFolder(files: Record<string, string> = {}) {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "artifact-review-")));
  cleanups.push(() => rmSync(folder, { recursive: true, force: true }));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(folder, name, ".."), { recursive: true });
    writeFileSync(join(folder, name), body);
  }
  return folder;
}

const PAGE = "<!doctype html><html><head><meta charset=utf-8><title>T</title></head><body><h1>Hi</h1></body></html>";

describe("notes", () => {
  const element = { kind: "element", note: "move this up", target: { tag: "H2", selector: "#six", text: "6. What this means", heading: "October" } };

  test("a batch is checked, trimmed and capped", () => {
    const batch = parseBatch({ notes: [{ ...element, note: "  move\u0007 this up \n\n" }, { kind: "page", note: "darker", target: { tag: "x" } }] });
    expect(batch.notes[0]).toEqual({ kind: "element", note: "move this up", target: { tag: "h2", selector: "#six", text: "6. What this means", heading: "October", label: undefined } });
    expect(batch.notes[1]).toEqual({ kind: "page", note: "darker" });
    const long = parseBatch({ notes: [{ ...element, note: "x".repeat(9000) }] });
    expect(long.notes[0].note.length).toBe(5000);
  });

  test("bad batches are refused with a reason", () => {
    const refuse = (body: unknown, reason: RegExp) => expect(() => parseBatch(body)).toThrow(reason);
    refuse({}, /no notes/);
    refuse({ notes: [] }, /no notes/);
    refuse({ notes: Array(51).fill(element) }, /at most 50/);
    refuse({ notes: [{ ...element, kind: "script" }] }, /unknown kind/);
    refuse({ notes: [{ ...element, note: "   " }] }, /empty/);
    refuse({ notes: [{ kind: "element", note: "x" }] }, /points at/);
    refuse({ notes: [{ ...element, kind: "selection" }] }, /selected text/);
    expect(() => parseBatch(null)).toThrow(NoteError);
  });

  test("the message names the page, each target, what was on screen, and the notes", () => {
    const batch = parseBatch({
      notes: [
        element,
        { kind: "selection", note: "say by how much\nin minutes", quote: "Google's drive time is good enough", target: { tag: "h3", selector: "h3:nth-of-type(4)", heading: "6. What this means" } },
        { kind: "element", note: "wrong day?", target: { tag: "div", selector: "#dv > div.blk:nth-of-type(3)", text: "#3 Passive · 60 min", label: "#3 Passive: booked 9:00 to 10:00" }, screen: { pressed: ["Monthlies (C): a late day"], pickers: [{ label: "Day", value: "Tue 14 Oct · 9 bookings" }], hash: "#tab=3" } },
        { kind: "page", note: "darker colours" },
      ],
    });
    const text = formatBatch(batch, { title: "Cove October", file: "/a/cove/index.html", project: "/p/ckc", madeInSession: "/s/old.jsonl", thisSession: "/s/new.jsonl" });
    expect(text).toBe(
      [
        '4 notes from reviewing the page "Cove October" in the browser.',
        "File: /a/cove/index.html",
        "Project: /p/ckc",
        "Made in another Pi session: /s/old.jsonl",
        "",
        '1. On a h2 "6. What this means", under "October"',
        "   CSS: #six",
        "   move this up",
        "",
        '2. On the text "Google\'s drive time is good enough" (in a h3, under "6. What this means")',
        "   CSS: h3:nth-of-type(4)",
        "   say by how much",
        "   in minutes",
        "",
        '3. On a div "#3 Passive · 60 min" ("#3 Passive: booked 9:00 to 10:00")',
        '   Showing: selected "Monthlies (C): a late day"; Day: "Tue 14 Oct · 9 bookings"; address #tab=3',
        "   CSS: #dv > div.blk:nth-of-type(3)",
        "   wrong day?",
        "",
        "4. On the whole page",
        "   darker colours",
        "",
        "(Sent with /artifact-review. The browser reloads the page when files in its folder change. If a script writes the page, change the script and rerun it.)",
      ].join("\n"),
    );
    const same = formatBatch(parseBatch({ notes: [element] }), { file: "/a/x.html", madeInSession: "/s/a", thisSession: "/s/a" });
    expect(same).toStartWith('A note from reviewing the page /a/x.html in the browser.\nFile: /a/x.html\n\n1.');
  });
});

describe("server", () => {
  async function serve(folder: string, deliveries: unknown[] = [], extra: Partial<Parameters<typeof startReviewServer>[0]> = {}) {
    const server = await startReviewServer({
      folder,
      entry: "index.html",
      overlayPath,
      busy: () => false,
      debounceMs: 50,
      deliver(batch) {
        deliveries.push(batch);
        return { queued: false, text: "sent text" };
      },
      ...extra,
    });
    cleanups.push(() => server.close());
    return server;
  }
  const at = (server: ReviewServer, path: string, init?: RequestInit) => fetch(`${server.origin}/${server.token}/${path}`, init);
  const post = (server: ReviewServer, body: unknown, headers: Record<string, string> = {}) =>
    at(server, "__review/notes", { method: "POST", headers: { origin: server.origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  test("serves the page with the review script, and its files", async () => {
    const folder = tempFolder({ "index.html": PAGE, "fonts/a.woff2": "font", "style.css": "h1{}" });
    const server = await serve(folder);
    expect(server.url).toBe(`${server.origin}/${server.token}/index.html`);
    expect(server.origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const page = await fetch(server.url);
    expect(page.headers.get("content-type")).toBe("text/html");
    expect(page.headers.get("cache-control")).toBe("no-store");
    expect(await page.text()).toBe(PAGE.replace("</body>", `<script src="/${server.token}/__review/overlay.js" defer></script></body>`));
    expect((await at(server, "fonts/a.woff2")).headers.get("content-type")).toBe("font/woff2");
    expect(await (await at(server, "style.css")).text()).toBe("h1{}");
    expect(await (await at(server, "__review/overlay.js")).text()).toContain("__artifactReview");
    const bare = await fetch(`${server.origin}/${server.token}`, { redirect: "manual" });
    expect(bare.headers.get("location")).toBe(`/${server.token}/index.html`);
  });

  test("injects into pages without </body> and keeps bytes in other encodings", () => {
    expect(injectScript(Buffer.from("<p>x"), "/s.js").toString()).toBe('<p>x<script src="/s.js" defer></script>');
    const latin = Buffer.from([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x42, 0x4f, 0x44, 0x59, 0x3e]); // <p>é</BODY> in Latin-1
    const out = injectScript(latin, "/s.js");
    expect(out.subarray(0, 4)).toEqual(latin.subarray(0, 4));
    expect(out.subarray(out.length - 7)).toEqual(Buffer.from("</BODY>"));
  });

  test("refuses other folders, wrong tokens and wrong hosts", async () => {
    const outside = tempFolder({ "secret.txt": "secret" });
    const folder = tempFolder({ "index.html": PAGE });
    symlinkSync(join(outside, "secret.txt"), join(folder, "link.txt"));
    const server = await serve(folder);
    for (const path of ["../secret.txt", "%2e%2e/secret.txt", "..%2fsecret.txt", "link.txt", "missing.html", `${outside}/secret.txt`]) {
      const response = await at(server, path);
      expect([path, response.status]).toEqual([path, 404]);
    }
    expect((await fetch(`${server.origin}/wrong-token/index.html`)).status).toBe(404);
    const port = new URL(server.origin).port;
    const rebound = await new Promise<number>((done) => {
      const http = require("node:http");
      http.get({ host: "127.0.0.1", port, path: `/${server.token}/index.html`, headers: { host: `evil.example:${port}` } }, (res: any) => done(res.statusCode));
    });
    expect(rebound).toBe(403);
    expect((await fetch(`http://localhost:${port}/${server.token}/index.html`)).status).toBe(200);
  });

  test("takes notes only as JSON from its own origin", async () => {
    const deliveries: unknown[] = [];
    const server = await serve(tempFolder({ "index.html": PAGE }), deliveries);
    const notes = { notes: [{ kind: "page", note: "hello" }] };
    expect((await post(server, notes, { origin: "https://evil.example" })).status).toBe(403);
    expect((await at(server, "__review/notes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(notes) })).status).toBe(403);
    expect((await post(server, notes, { "content-type": "text/plain" })).status).toBe(415);
    expect((await at(server, "__review/notes")).status).toBe(405);
    const bad = await post(server, { notes: [] });
    expect([bad.status, await bad.json()]).toEqual([400, { ok: false, error: "no notes to send" }]);
    const broken = await at(server, "__review/notes", { method: "POST", headers: { origin: server.origin, "content-type": "application/json" }, body: "{" });
    expect(broken.status).toBe(400);
    expect(deliveries).toEqual([]);
    const good = await post(server, notes);
    expect(await good.json()).toEqual({ ok: true, queued: false, count: 1, text: "sent text" });
    expect(deliveries).toEqual([{ notes: [{ kind: "page", note: "hello" }] }]);
    expect((await at(server, "index.html", { method: "PUT" })).status).toBe(405);
  });

  test("a failed delivery is reported to the page", async () => {
    const server = await serve(tempFolder({ "index.html": PAGE }), [], {
      deliver() {
        throw new Error("compaction is running");
      },
    });
    const response = await post(server, { notes: [{ kind: "page", note: "x" }] });
    expect([response.status, await response.json()]).toEqual([500, { ok: false, error: "Pi could not take the notes: compaction is running" }]);
  });

  test("tells open pages when Pi is busy, when files change, and when it stops", async () => {
    const folder = tempFolder({ "index.html": PAGE });
    const server = await serve(folder, [], { busy: () => true, title: "T" });
    const response = await at(server, "__review/events");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    let seen = "";
    const until = async (pattern: RegExp) => {
      const deadline = Date.now() + 3000;
      while (!pattern.test(seen)) {
        if (Date.now() > deadline) throw new Error(`no ${pattern} in ${JSON.stringify(seen)}`);
        const { value, done } = await reader.read();
        if (done) break;
        seen += new TextDecoder().decode(value);
      }
      expect(seen).toMatch(pattern);
    };
    await until(/event: hello\ndata: \{"busy":true,"title":"T"\}/);
    server.broadcast("busy", { busy: false });
    await until(/event: busy\ndata: \{"busy":false\}/);
    // Metadata and temp files do not reload; the page and its assets do.
    writeFileSync(join(folder, "artifact.json"), "{}");
    writeFileSync(join(folder, ".index.html.tmp"), "x");
    await new Promise((done) => setTimeout(done, 200));
    expect(seen).not.toContain("event: reload");
    writeFileSync(join(folder, "index.html"), PAGE + " ");
    await until(/event: reload\ndata: \{"files":\["index\.html"\]\}/);
    await server.close();
    await until(/event: stopped/);
  });

  test("ignored changes", () => {
    expect(["artifact.json", "a/.x.swp", ".index.html.abc", "index.html~", "page.swp"].every(ignoredChange)).toBe(true);
    expect(["index.html", "fonts/a.woff2", "data.json"].some(ignoredChange)).toBe(false);
  });
});

type Answer = "send" | "keep" | "enter" | "wait";

describe("command", () => {
  function harness(options: { idle?: boolean; sessionFile?: string; artifact?: (args: string[]) => string; answer?: Answer } = {}) {
    const handlers = new Map<string, (event: any, ctx: any) => any>();
    let command: any;
    const sent: Array<{ text: string; options: unknown }> = [];
    const opened: string[] = [];
    const notifications: Array<{ message: string; type: string }> = [];
    const statuses = new Map<string, string | undefined>();
    let idle = options.idle ?? true;
    // How the person answers Pi's dialog about sending notes. "enter" presses Enter on whatever
    // Pi preselects (Yes in a confirm, the first choice in a select); "wait" leaves it open.
    let answer: Answer = options.answer ?? "send";
    const dialogs: Array<{ text: string; settle(choice: "send" | "keep"): void }> = [];
    const ask = (text: string, pick: (choice: "send" | "keep" | "enter") => any, signal?: AbortSignal) =>
      new Promise<any>((resolve) => {
        const settle = (choice: "send" | "keep") => resolve(pick(choice));
        dialogs.push({ text, settle });
        signal?.addEventListener("abort", () => resolve(undefined), { once: true });
        if (answer !== "wait") resolve(pick(answer));
      });
    const pi = {
      on: (name: string, handler: any) => handlers.set(name, handler),
      registerCommand(name: string, value: any) {
        expect(name).toBe("artifact-review");
        command = value;
      },
      sendUserMessage: (text: string, sendOptions: unknown) => sent.push({ text, options: sendOptions }),
    };
    registerArtifactReview(pi as any, {
      overlayPath,
      open: async (url) => void opened.push(url),
      artifact: async (args) => (options.artifact ? options.artifact(args) : "[]"),
    });
    const ctx = {
      cwd: "/",
      hasUI: true,
      isIdle: () => idle,
      sessionManager: { getSessionFile: () => options.sessionFile },
      ui: {
        notify: (message: string, type: string) => notifications.push({ message, type }),
        setStatus: (key: string, value: string | undefined) => statuses.set(key, value),
        select: async (title: string, labels: string[], opts?: { signal?: AbortSignal }) =>
          labels.length === 2 && /keep/i.test(labels[0])
            ? ask(title, (choice) => (choice === "send" ? labels[1] : labels[0]), opts?.signal)
            : labels[0],
        confirm: (title: string, message: string, opts?: { signal?: AbortSignal }) =>
          ask(`${title}\n${message}`, (choice) => choice !== "keep", opts?.signal),
      },
    };
    cleanups.push(() => handlers.get("session_shutdown")?.({ reason: "quit" }, ctx));
    return {
      sent, opened, notifications, statuses, handlers, ctx, command, dialogs,
      setIdle: (value: boolean) => (idle = value),
      setAnswer: (value: Answer) => (answer = value),
      run: (args: string) => command.handler(args, ctx),
    };
  }
  const postTo = (url: string, body: unknown) =>
    fetch(new URL("__review/notes", url), { method: "POST", headers: { origin: new URL(url).origin, "content-type": "application/json" }, body: JSON.stringify(body) });

  test("a folder opens in the browser; notes arrive as the user's message", async () => {
    const folder = tempFolder({ "index.html": PAGE, "artifact.json": JSON.stringify({ title: "Cove", project: "/p", session: "/s/other.jsonl" }) });
    const h = harness({ sessionFile: "/s/this.jsonl" });
    await h.run(folder);
    expect(h.opened).toHaveLength(1);
    expect(h.opened[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[\w-]{22}\/index\.html$/);
    expect(h.statuses.get("artifact-review")).toBe(`reviewing ${folder.split("/").pop()}`.slice(0, 42));
    expect(h.notifications[0].type).toBe("warning");
    expect(h.notifications[0].message).toContain("made in another Pi session (/s/other.jsonl)");
    const response = await postTo(h.opened[0], { notes: [{ kind: "page", note: "darker" }] });
    expect((await response.json()).queued).toBe(false);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].options).toEqual({ deliverAs: "followUp" });
    expect(h.sent[0].text).toContain('A note from reviewing the page "Cove" in the browser.\nFile: ' + join(folder, "index.html"));
    expect(h.sent[0].text).toContain("Made in another Pi session: /s/other.jsonl");
    // While Pi works, the page is told the notes wait.
    h.setIdle(false);
    expect((await (await postTo(h.opened[0], { notes: [{ kind: "page", note: "again" }] })).json()).queued).toBe(true);
  });

  test("notes reach Pi only after you confirm them there, so a page script cannot send on its own", async () => {
    const folder = tempFolder({ "index.html": PAGE });
    const h = harness({ answer: "keep" });
    await h.run(folder);
    const declined = await postTo(h.opened[0], { notes: [{ kind: "page", note: "make the header darker" }] });
    expect(declined.ok).toBe(false);
    expect((await declined.json()).error).toContain("declined");
    expect(h.sent).toHaveLength(0);
    expect(h.dialogs).toHaveLength(1);
    expect(h.dialogs[0].text).toContain("make the header darker");
    h.setAnswer("send");
    expect((await postTo(h.opened[0], { notes: [{ kind: "page", note: "make the header darker" }] })).ok).toBe(true);
    expect(h.sent).toHaveLength(1);
  });

  test("Enter alone on Pi's dialog keeps the notes, so typing in Pi cannot approve a page's batch", async () => {
    const folder = tempFolder({ "index.html": PAGE });
    const h = harness({ answer: "enter" });
    await h.run(folder);
    const response = await postTo(h.opened[0], { notes: [{ kind: "page", note: "unasked" }] });
    expect(response.ok).toBe(false);
    expect(h.sent).toHaveLength(0);
  });

  test("stopping the review closes a waiting dialog; answering it later sends nothing", async () => {
    const folder = tempFolder({ "index.html": PAGE });
    const h = harness({ answer: "wait" });
    await h.run(folder);
    const pending = postTo(h.opened[0], { notes: [{ kind: "page", note: "late" }] }).catch(() => undefined);
    while (!h.dialogs.length) await Bun.sleep(5);
    await h.run("stop");
    h.dialogs[0].settle("send");
    await pending;
    await Bun.sleep(20);
    expect(h.sent).toHaveLength(0);
  });

  test("an artifact id goes through `artifact show`; file:// URLs and files work", async () => {
    const folder = tempFolder({ "index.html": PAGE, "other.html": PAGE });
    const calls: string[][] = [];
    const deps = { artifact: async (args: string[]) => (calls.push(args), JSON.stringify({ id: "2026-11-24-cove", path: folder, entry: "index.html", title: "Cove", session: "/s/a" })) };
    expect(await resolvePage("cove", "/", deps)).toEqual({ folder, entry: "index.html", id: "2026-11-24-cove", title: "Cove", project: undefined, session: "/s/a" });
    expect(calls).toEqual([["show", "cove"]]);
    expect(await resolvePage(pathToFileURL(join(folder, "other.html")).href, "/", deps)).toMatchObject({ folder, entry: "other.html" });
    expect(await resolvePage("other.html", folder, deps)).toMatchObject({ folder, entry: "other.html" });
    await expect(resolvePage(join(folder, "nope.html"), "/", deps)).rejects.toThrow(/No such file/);
    await expect(resolvePage(tempFolder({ "a.txt": "" }), "/", deps)).rejects.toThrow(/No index.html/);
  });

  test("stop, a second review, and the end of the session close the server", async () => {
    const h = harness();
    await h.run(tempFolder({ "index.html": PAGE }));
    const first = h.opened[0];
    await h.run(tempFolder({ "index.html": PAGE }));
    await expect(fetch(first)).rejects.toThrow();
    const second = h.opened[1];
    expect((await fetch(second)).status).toBe(200);
    await h.run("stop");
    await expect(fetch(second)).rejects.toThrow();
    expect(h.statuses.get("artifact-review")).toBeUndefined();
    expect(h.notifications.at(-1)!.message).toBe("Review stopped.");
    await h.run("stop");
    expect(h.notifications.at(-1)!.message).toBe("No review is running.");
    await h.run(tempFolder({ "index.html": PAGE }));
    await h.handlers.get("session_shutdown")!({ reason: "reload" }, h.ctx);
    await expect(fetch(h.opened[2])).rejects.toThrow();
  });

  test("no argument picks from recent artifacts, this session's first; errors are shown", async () => {
    const mine = tempFolder({ "index.html": PAGE });
    const list = [
      { id: "newer", title: "Newer", path: "/nowhere", session: "/s/other" },
      { id: "mine", title: "Mine", path: mine, session: "/s/this" },
    ];
    const h = harness({
      sessionFile: "/s/this",
      artifact: (args) => (args[0] === "list" ? JSON.stringify(list) : JSON.stringify({ ...list.find((item) => item.id === args[1]), entry: "index.html" })),
    });
    await h.run("");
    expect(h.opened).toHaveLength(1);
    expect(h.statuses.get("artifact-review")).toBe("reviewing mine");
    expect(await h.command.getArgumentCompletions("new")).toEqual([{ value: "newer", label: "newer", description: "Newer" }]);
    expect((await h.command.getArgumentCompletions("st"))[0]).toEqual({ value: "stop", label: "stop", description: "end the current review" });
    await h.run("/does/not/exist");
    expect(h.notifications.at(-1)).toEqual({ message: "/artifact-review: No such file or folder: /does/not/exist", type: "error" });
  });

  test("busy and idle reach open pages", async () => {
    const h = harness();
    await h.run(tempFolder({ "index.html": PAGE }));
    const events = await fetch(new URL("__review/events", h.opened[0]));
    const reader = events.body!.getReader();
    let seen = "";
    h.handlers.get("agent_start")!({}, h.ctx);
    h.handlers.get("agent_settled")!({}, h.ctx);
    while (!seen.includes('"busy":false}\n\nevent: busy') && !/busy":true[\s\S]*busy":false/.test(seen)) {
      seen += new TextDecoder().decode((await reader.read()).value);
    }
    expect(seen).toMatch(/event: hello[\s\S]*event: busy\ndata: \{"busy":true\}[\s\S]*event: busy\ndata: \{"busy":false\}/);
    await reader.cancel();
  });
});
