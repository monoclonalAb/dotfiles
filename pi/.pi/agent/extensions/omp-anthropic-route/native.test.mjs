import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { AnthropicIdentityResolver, createOmpAnthropicFetch, xxhash64 } from "./transport.ts";

// Only installed code is used; never load the real auth/config/session stores.
const pkg = join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent");
const home = mkdtempSync(join(tmpdir(), "omp-anthropic-native-"));
const testContext = process.env.NODE_TEST_CONTEXT;
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, { HOME: home, PI_CODING_AGENT_DIR: join(home, "agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0" });
if (testContext) process.env.NODE_TEST_CONTEXT = testContext;
after(() => rmSync(home, { recursive: true, force: true }));
globalThis.fetch = async () => { throw new Error("Unexpected real fetch blocked by native test"); };
const aiRoot = join(pkg, "node_modules/@earendil-works/pi-ai/dist");
const { normalizeContext } = await import(pathToFileURL(join(aiRoot, "index.js")));
const { anthropicProvider } = await import(pathToFileURL(join(aiRoot, "providers/anthropic.js")));
const provider = anthropicProvider();
const baseModel = provider.getModels().find((model) => model.compat?.forceAdaptiveThinking);
assert.ok(baseModel, "installed Pi must have an adaptive-thinking Anthropic model");
const outputBeta = "mid-conversation-output-config-2026-07-01";
const bindingBeta = "thinking-binding-controls-2026-08-01";
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function sse(model) {
  const events = [
    { type: "message_start", message: { id: "msg_synthetic", type: "message", role: "assistant", model: model.id, content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Synthetic reply" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ];
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } });
}

for (const method of ["stream", "streamSimple"]) {
  test(`${method}: installed Pi's historical/current effort messages keep their protocol headers`, async () => {
    // Synthetic capability metadata exercises this path even if the static catalog
    // lags behind the installed user's dynamically refreshed model catalog.
    const model = { ...baseModel, compat: { ...baseModel.compat, supportsMidConvoEffort: true } };
    const context = normalizeContext({
      systemPrompt: "Synthetic system prompt",
      messages: [
        { role: "user", content: "First question", timestamp: 0 },
        { role: "assistant", content: [{ type: "text", text: "Prior reply" }],
          api: model.api, provider: model.provider, model: model.id,
          providerThinkingLevel: "low", stopReason: "stop", usage, timestamp: 1 },
        { role: "user", content: "Follow-up", timestamp: 2 },
      ],
    });
    const unchangedContext = structuredClone(context);
    let before;
    let after;
    const routedFetch = createOmpAnthropicFetch(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/bootstrap")) return Response.json({ oauth_account: {} });
      after = { url, headers: new Headers(init.headers), body: JSON.parse(init.body), text: init.body };
      return sse(model);
    }, { installId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", modelId: model.id,
      messages: context.messages, identityResolver: new AnthropicIdentityResolver() });
    const fetch = (input, init) => {
      before = { headers: new Headers(init.headers), body: JSON.parse(init.body) };
      return routedFetch(input, init);
    };
    const options = { apiKey: "sk-ant-oat-synthetic", fetch, maxTokens: 128, maxRetries: 0,
      sessionId: "167ec5b4-e711-4169-879f-84fa52679d9c",
      ...(method === "stream" ? { effort: "high", thinkingEnabled: true } : { reasoning: "high" }) };
    const result = await provider[method](model, context, options).result();
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(result.content[0].text, "Synthetic reply");
    assert.equal(after.url, "https://api.anthropic.com/v1/messages?beta=true");
    for (const beta of [outputBeta, bindingBeta]) {
      assert.ok(before.headers.get("anthropic-beta").split(",").includes(beta), `native Pi must emit ${beta}`);
      assert.ok(after.headers.get("anthropic-beta").split(",").includes(beta), `bridge dropped required ${beta}`);
    }
    const effortMessages = (payload) => payload.messages.filter((message) => message.output_config);
    assert.deepEqual(effortMessages(after.body), effortMessages(before.body));
    assert.deepEqual(effortMessages(after.body).map((message) => message.output_config.effort), ["low", "high"]);
    assert.deepEqual(after.body.thinking, before.body.thinking);
    assert.deepEqual(after.body.thinking.block_binding, { prefix_mismatch_behavior: "drop_block" });
    assert.deepEqual(after.body.output_config, before.body.output_config);
    assert.deepEqual(context, unchangedContext);
    // The forwarded headers must not break the exact-byte body attestation.
    const cch = after.body.system[0].text.match(/cch=([0-9a-f]{5})/)[1];
    const restored = after.text.replace(`cch=${cch}`, "cch=00000");
    const expected = (xxhash64(new TextEncoder().encode(restored), 0x4d659218e32a3268n) & 0xfffffn).toString(16).padStart(5, "0");
    assert.equal(cch, expected);
  });
}
