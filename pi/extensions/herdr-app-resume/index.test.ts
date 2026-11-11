// bun test ./pi/extensions/herdr-app-resume/*.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { registerHerdrAppResume } from "./index.ts";

function harness(env: Record<string, string> = { HC_TERMINAL_ID: "t7" }, { file = "/s/one.jsonl", pid = 4242 as unknown } = {}) {
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
  registerHerdrAppResume(pi as never, env);
  const ctx = { sessionManager: { getSessionFile: () => sessionFile } };
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

test("a failing hc never throws into Pi", async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  registerHerdrAppResume({
    on(name: string, handler: (...args: any[]) => any) { handlers.set(name, handler); },
    async exec() { throw new Error("hc missing"); },
  } as never, { HC_TERMINAL_ID: "t7" });
  const ctx = { sessionManager: { getSessionFile: () => "/s/x.jsonl" } };
  await handlers.get("session_start")!({ reason: "startup" }, ctx);
  await handlers.get("session_shutdown")!({ reason: "quit" }, ctx);
});
