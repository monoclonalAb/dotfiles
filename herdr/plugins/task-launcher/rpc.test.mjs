import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { rpc } from "./rpc.mjs";

async function server(t, handler) {
  // macOS Unix socket paths have a small length limit.
  const dir = await mkdtemp("/tmp/pi-task-rpc-");
  const socketPath = join(dir, "socket");
  const sockets = new Set();
  const service = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (data) => {
      buffer += data;
      if (buffer.includes("\n")) handler(socket, JSON.parse(buffer.split("\n")[0]));
    });
  });
  await new Promise((resolve) => service.listen(socketPath, resolve));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => service.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  return { socketPath, timeoutMs: 200 };
}

test("socket uses LF framing and handles fragmented Unicode replies", async (t) => {
  const options = await server(t, (socket, request) => {
    assert.equal(request.method, "example.read");
    assert.deepEqual(request.params, { value: "one\ntwo" });
    const response = JSON.stringify({ id: request.id, result: { type: "ok", text: "一\u2028二" } }) + "\n";
    socket.write(response.slice(0, 10));
    socket.end(response.slice(10));
  });
  assert.deepEqual(await rpc("example.read", { value: "one\ntwo" }, options), { type: "ok", text: "一\u2028二" });
});

test("explicit server rejection is not an ambiguous outcome", async (t) => {
  const options = await server(t, (socket, request) => socket.end(JSON.stringify({ id: request.id,
    error: { code: "ui_busy", message: "busy" } }) + "\n"));
  await assert.rejects(rpc("plugin.pane.open", {}, options), (error) => error.code === "ui_busy" && !error.uncertain);
});

test("timeout, malformed reply, wrong ID and disconnect after write are ambiguous", async (t) => {
  for (const respond of [() => {}, (socket) => socket.end("not json\n"),
    (socket) => socket.end('{"id":"wrong","result":{}}\n'), (socket) => socket.end()]) {
    const options = await server(t, respond);
    await assert.rejects(rpc("worktree.create", {}, options), (error) => error.uncertain === true);
  }
});

test("partial reply traffic cannot extend the wall-clock deadline", async (t) => {
  const options = await server(t, (socket) => {
    const interval = setInterval(() => socket.write(" "), 5);
    socket.once("close", () => clearInterval(interval));
  });
  const started = Date.now();
  await assert.rejects(rpc("worktree.create", {}, { ...options, timeoutMs: 60 }), (error) => error.uncertain);
  assert.ok(Date.now() - started < 1000);
});

test("missing socket and connection failure happen before mutation", async () => {
  await assert.rejects(rpc("worktree.create", {}, { socketPath: "" }), (error) => !error.uncertain);
  await assert.rejects(rpc("worktree.create", {}, { socketPath: "/tmp/does-not-exist-pi-task.socket" }), (error) => !error.uncertain);
});
