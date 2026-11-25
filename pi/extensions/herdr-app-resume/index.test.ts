// bun test ./pi/extensions/herdr-app-resume/*.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { registerHerdrAppResume } from "./index.ts";

function harness(env: Record<string, string> = { HC_TERMINAL_ID: "t7" },
  { file = "/s/one.jsonl", pid = 4242 as unknown, mode = "tui", parent = 1 } = {}) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const calls: string[][] = [];
  let sessionFile: string | undefined = file;
  const pi = {
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    async exec(command: string, args: string[]) {
      calls.push([command, ...args]);
      if (args[0] === "get") return { code: 0, stdout: JSON.stringify({ address: "t7", pid }), stderr: "", killed: false };
      return { code: 0, stdout: "", stderr: "", killed: false };
    },
  };
  registerHerdrAppResume(pi as never, env, parent);
  const ctx = { mode, sessionManager: { getSessionFile: () => sessionFile } };
  return {
    calls, handlers,
    setFile(next: string | undefined) { sessionFile = next; },
    emit: (name: string, event: object = {}) => handlers.get(name)?.(event, ctx),
    labels: () => calls.filter((c) => c[1] === "label").map((c) => c.slice(3)),
  };
}

test("outside the Herdr app it registers nothing", () => {
  assert.equal(harness({}).handlers.size, 0);
});

test("a session labels its terminal with the file and the shell's pid", async () => {
  const h = harness({ HC_TERMINAL_ID: "t7", HC_BIN_PATH: "/x/hc" });
  await h.emit("session_start", { reason: "startup" });
  assert.deepEqual(h.calls, [["/x/hc", "get", "t7", "--json"], ["/x/hc", "label", "t7", "pi.session=/s/one.jsonl", "pi.shell=4242"]]);
});

test("switching sessions relabels; only quitting clears", async () => {
  const h = harness();
  await h.emit("session_start", { reason: "startup" });
  await h.emit("session_shutdown", { reason: "new" });
  h.setFile("/s/two.jsonl");
  await h.emit("session_start", { reason: "new" });
  await h.emit("session_shutdown", { reason: "quit" });
  assert.deepEqual(h.labels(), [
    ["pi.session=/s/one.jsonl", "pi.shell=4242"],
    ["pi.session=/s/two.jsonl", "pi.shell=4242"],
    ["pi.session=", "pi.shell="],
  ]);
  assert.equal(h.calls.filter((c) => c[1] === "get").length, 1, "the shell pid is asked once");
});

test("an ephemeral session or an unknown shell leaves nothing to resume", async () => {
  const ephemeral = harness();
  ephemeral.setFile(undefined);
  await ephemeral.emit("session_start", { reason: "startup" });
  assert.deepEqual(ephemeral.labels(), [["pi.session=", "pi.shell="]]);
  const unknown = harness({ HC_TERMINAL_ID: "t7" }, { pid: "nope" });
  await unknown.emit("session_start", { reason: "startup" });
  assert.deepEqual(unknown.labels(), [["pi.session=", "pi.shell="]]);
});

test("a Pi that a program in this terminal runs, such as `pi -p` from an agent's shell, leaves its labels alone", async () => {
  for (const mode of ["print", "json", "rpc"]) {
    const h = harness({ HC_TERMINAL_ID: "t7" }, { mode });
    await h.emit("session_start", { reason: "startup" });
    await h.emit("session_shutdown", { reason: "quit" });
    assert.deepEqual(h.calls, [], mode);
  }
});

test("a failing hc never throws into Pi", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  registerHerdrAppResume({
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    async exec() { throw new Error("hc missing"); },
  } as never, { HC_TERMINAL_ID: "t7" });
  const ctx = { mode: "tui", sessionManager: { getSessionFile: () => "/s/x.jsonl" } };
  await handlers.get("session_start")!({ reason: "startup" }, ctx);
  await handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
});

test("parking keeps the labels, so a reboot still reopens the conversation", async () => {
  const park = join(mkdtempSync(join(tmpdir(), "herdr-app-resume-")), "park");
  const env = { HC_TERMINAL_ID: "t7", PI_PARK_FILE: park, PI_PARK_PID: "900" };
  const parked = harness(env, { parent: 900 });
  await parked.emit("session_start", { reason: "startup" });
  writeFileSync(park, "/s/one.jsonl");
  await parked.emit("session_shutdown", { reason: "quit" });
  assert.deepEqual(parked.labels(), [["pi.session=/s/one.jsonl", "pi.shell=4242"]]);

  const quit = harness(env, { parent: 900 });
  await quit.emit("session_start", { reason: "startup" });
  writeFileSync(park, "");
  await quit.emit("session_shutdown", { reason: "quit" });
  assert.deepEqual(quit.labels().at(-1), ["pi.session=", "pi.shell="], "an empty park file is a quit");

  const nested = harness(env, { parent: 901 });
  await nested.emit("session_start", { reason: "startup" });
  writeFileSync(park, "/s/one.jsonl");
  await nested.emit("session_shutdown", { reason: "quit" });
  assert.deepEqual(nested.labels().at(-1), ["pi.session=", "pi.shell="], "another Pi's park file");
});
