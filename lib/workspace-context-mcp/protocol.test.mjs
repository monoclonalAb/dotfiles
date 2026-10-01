import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { after, before, describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createFixtureWorkspace } from "./fixture.mjs";
import { JSON_RPC_ERRORS, LATEST_PROTOCOL_VERSION, createMcpDispatcher, toTextResult } from "./protocol.mjs";

const here = dirname(fileURLToPath(import.meta.url));

describe("MCP dispatcher", () => {
  const tools = [{ name: "echo", description: "echo", inputSchema: { type: "object", properties: {} } }];
  const handlers = {
    echo: async (args) => ({ echoed: args }),
    fails: async () => {
      throw new Error("boom");
    },
    softError: async () => ({ error: "not found" }),
  };
  const dispatcher = createMcpDispatcher({ serverInfo: { name: "t", version: "0" }, instructions: "hi", tools, handlers });

  it("negotiates a supported protocol version and falls back to the latest", async () => {
    const known = await dispatcher.handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
    assert.equal(known.result.protocolVersion, "2024-11-05");
    const unknown = await dispatcher.handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    assert.equal(unknown.result.protocolVersion, LATEST_PROTOCOL_VERSION);
    assert.deepEqual(unknown.result.capabilities, { tools: { listChanged: false } });
    assert.equal(unknown.result.instructions, "hi");
  });

  it("answers ping, tools/list and empty resources/prompts lists", async () => {
    assert.deepEqual((await dispatcher.handle({ jsonrpc: "2.0", id: 1, method: "ping" })).result, {});
    assert.deepEqual((await dispatcher.handle({ jsonrpc: "2.0", id: 2, method: "tools/list" })).result, { tools });
    assert.deepEqual((await dispatcher.handle({ jsonrpc: "2.0", id: 3, method: "resources/list" })).result, { resources: [] });
    assert.deepEqual((await dispatcher.handle({ jsonrpc: "2.0", id: 4, method: "prompts/list" })).result, { prompts: [] });
  });

  it("calls tools and reports failures inside the result", async () => {
    const ok = await dispatcher.handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "echo", arguments: { a: 1 } } });
    assert.deepEqual(JSON.parse(ok.result.content[0].text), { echoed: { a: 1 } });
    assert.equal(ok.result.isError, undefined);
    const thrown = await dispatcher.handle({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "fails" } });
    assert.equal(thrown.result.isError, true);
    assert.match(thrown.result.content[0].text, /boom/);
    const soft = await dispatcher.handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "softError" } });
    assert.equal(soft.result.isError, true);
    const unknown = await dispatcher.handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } });
    assert.equal(unknown.error.code, JSON_RPC_ERRORS.invalidParams);
  });

  it("rejects invalid messages and unknown methods, ignores notifications and responses", async () => {
    assert.equal((await dispatcher.handle({ jsonrpc: "2.0", id: 1, method: "nope" })).error.code, JSON_RPC_ERRORS.methodNotFound);
    assert.equal((await dispatcher.handle({ id: 1, method: "ping" })).error.code, JSON_RPC_ERRORS.invalidRequest);
    assert.equal(await dispatcher.handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
    assert.equal(dispatcher.isInitialized(), true);
    assert.equal(await dispatcher.handle({ jsonrpc: "2.0", id: 9, result: {} }), null);
    const batch = await dispatcher.handle([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }]);
    assert.equal(batch.length, 1);
    assert.equal((await dispatcher.handle([])).error.code, JSON_RPC_ERRORS.invalidRequest);
  });

  it("serialises text results", () => {
    assert.deepEqual(toTextResult("x"), { content: [{ type: "text", text: "x" }] });
    assert.equal(toTextResult({ a: 1 }, true).isError, true);
  });
});

describe("stdio server process", () => {
  let fixture;
  before(() => {
    fixture = createFixtureWorkspace();
  });
  after(() => fixture.cleanup());

  function runServer(lines, extraArgs = []) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [join(here, "server.mjs"), "serve", "--root", fixture.root, ...extraArgs], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, WORKSPACE_CONTEXT_DEBUG: "0" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stderr, messages: stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) }));
      child.stdin.write(lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n");
      child.stdin.end();
    });
  }

  it("completes initialize, tools/list and tools/call over newline-delimited JSON", async () => {
    const { code, messages, stderr } = await runServer([
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_repositories", arguments: { group: "DE" } } },
      "{not json",
      { jsonrpc: "2.0", id: 4, method: "ping" },
    ]);
    assert.equal(code, 0, stderr);
    assert.equal(messages.length, 5);
    assert.equal(messages[0].result.serverInfo.name, "workspace-context");
    assert.equal(messages[1].result.tools.length, 9);
    const listed = JSON.parse(messages[2].result.content[0].text);
    assert.equal(listed.count, 6);
    assert.equal(messages[3].error.code, JSON_RPC_ERRORS.parse);
    assert.deepEqual(messages[4].result, {});
    assert.ok(messages.every((message) => message.jsonrpc === "2.0"));
  });

  it("keeps stdout clean of logging even in debug mode", async () => {
    const { messages, stderr } = await runServer([{ jsonrpc: "2.0", id: 1, method: "ping" }], ["--debug"]);
    assert.equal(messages.length, 1);
    assert.match(stderr, /\[workspace-context\] serving/);
  });
});
