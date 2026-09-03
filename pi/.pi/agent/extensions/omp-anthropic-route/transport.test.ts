import assert from "node:assert/strict";
import test from "node:test";
import {
  AnthropicIdentityResolver,
  CLAUDE_CODE_SYSTEM_INSTRUCTION,
  CLAUDE_CODE_VERSION,
  createOmpAnthropicFetch,
  xxhash64,
} from "./transport.ts";

const encoder = new TextEncoder();
const CCH_SEED = 0x4d659218e32a3268n;

function low20Hash(text: string): string {
  return (xxhash64(encoder.encode(text), CCH_SEED) & 0xfffffn)
    .toString(16)
    .padStart(5, "0");
}

test("xxhash64 matches OMP's external CCH reference vectors", () => {
  const cases = [
    ["cch=00000", "a47f7"],
    ['{"messages":[],"cch=00000","x":1}', "3073d"],
    [
      "x-anthropic-billing-header: cc_version=2.1.158; cc_entrypoint=cli; cch=00000;",
      "f2b0b",
    ],
  ] as const;

  for (const [body, expected] of cases) assert.equal(low20Hash(body), expected);
});

test("OAuth requests use the OMP route and response tool names return to Pi", async () => {
  const accountId = "12345678-1234-1234-1234-1234567890ab";
  const sessionId = "167ec5b4-e711-4169-879f-84fa52679d9c";
  let bootstrapCalls = 0;
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const baseFetch: typeof globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith("https://api.anthropic.com/api/claude_cli/bootstrap")) {
      bootstrapCalls += 1;
      return new Response(
        JSON.stringify({ oauth_account: { account_uuid: accountId } }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    capturedUrl = url;
    capturedInit = init;
    return new Response(
      [
        "event: message_start",
        'data: {"type":"message_start","message":{"id":"msg_1","model":"claude-fable-5","usage":{"input_tokens":1,"output_tokens":0}}}',
        "",
        "event: content_block_start",
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tool_1","name":"_read","input":{}}}',
        "",
        "event: message_delta",
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":1}}',
        "",
        "event: message_stop",
        'data: {"type":"message_stop"}',
        "",
        "",
      ].join("\n"),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    );
  };

  const routedFetch = createOmpAnthropicFetch(baseFetch, {
    installId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    sessionId,
    modelId: "claude-fable-5",
    messages: [{ role: "user", content: "Hello from a sufficiently long user prompt" }],
    tools: [{ name: "read" }],
    identityResolver: new AnthropicIdentityResolver(),
  });

  const response = await routedFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer sk-ant-oat-test-token",
      "Content-Type": "application/json",
      "User-Agent": "pi-ai/old",
      "x-extra-safe-header": "kept",
    },
    body: JSON.stringify({
      model: "claude-fable-5",
      messages: [
        { role: "user", content: "Run the tool and preserve cch=00000" },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "tool_0", name: "Read", input: {} }],
        },
        {
          role: "system",
          content: [{ type: "text", text: "Turn-scoped instruction" }],
          clear_at: "next_user_message",
        },
      ],
      max_tokens: 128_000,
      stream: true,
      system: [
        {
          type: "text",
          text: CLAUDE_CODE_SYSTEM_INSTRUCTION,
          cache_control: { type: "ephemeral" },
        },
        {
          type: "text",
          text: [
            "Pi's actual system prompt",
            "",
            "Pi documentation (read only when asked):",
            "- Internal provider documentation",
            "<project_context>preserve this context</project_context>",
          ].join("\n"),
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [
        {
          name: "Read",
          input_schema: { type: "object", properties: {} },
          cache_control: { type: "ephemeral" },
        },
      ],
      thinking: { type: "adaptive", display: "summarized" },
      output_config: { effort: "high" },
      fallbacks: [{ model: "claude-opus-4-8" }],
    }),
  });

  assert.equal(bootstrapCalls, 1);
  assert.equal(capturedUrl, "https://api.anthropic.com/v1/messages?beta=true");
  assert.ok(capturedInit);

  const headers = new Headers(capturedInit.headers);
  assert.equal(headers.get("authorization"), "Bearer sk-ant-oat-test-token");
  assert.equal(headers.get("x-api-key"), null);
  assert.equal(headers.get("user-agent"), `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`);
  assert.equal(headers.get("x-claude-code-session-id"), sessionId);
  assert.equal(headers.get("x-stainless-package-version"), "0.112.1");
  assert.equal(headers.get("x-app"), "cli");
  assert.equal(headers.get("x-extra-safe-header"), "kept");
  assert.match(headers.get("anthropic-beta") ?? "", /claude-code-20250219/);
  assert.match(headers.get("anthropic-beta") ?? "", /oauth-2025-04-20/);
  assert.match(headers.get("anthropic-beta") ?? "", /effort-2025-11-24/);
  assert.doesNotMatch(headers.get("anthropic-beta") ?? "", /server-side-fallback/);

  assert.equal(typeof capturedInit.body, "string");
  const bodyText = capturedInit.body as string;
  // A user string can contain the placeholder; only the anchored system billing
  // block is patched and attested.
  assert.match(bodyText, /preserve cch=00000/);
  const body = JSON.parse(bodyText) as any;
  const cch = body.system[0].text.match(/cch=([0-9a-f]{5})/)?.[1];
  assert.ok(cch);
  const billingStart = bodyText.indexOf('"system":[{"type":"text","text":"x-anthropic-billing-header:');
  const cchStart = bodyText.indexOf(`cch=${cch}`, billingStart);
  assert.ok(billingStart >= 0 && cchStart >= 0);
  const restored = `${bodyText.slice(0, cchStart)}cch=00000${bodyText.slice(cchStart + 9)}`;
  assert.equal(cch, low20Hash(restored));

  assert.equal(body.max_tokens, 64_000);
  assert.equal(body.system[0].text.startsWith("x-anthropic-billing-header:"), true);
  assert.doesNotMatch(body.system[0].text, /cch=00000/);
  assert.equal(body.system[0].cache_control, undefined);
  assert.equal(body.system[1].text, CLAUDE_CODE_SYSTEM_INSTRUCTION);
  assert.deepEqual(body.system[1].cache_control, { type: "ephemeral" });
  assert.equal(
    body.system[2].text,
    "Pi's actual system prompt\n\n<project_context>preserve this context</project_context>",
  );
  assert.doesNotMatch(body.system[2].text, /Pi documentation/);
  assert.equal(body.system[2].cache_control, undefined);
  assert.equal(body.tools[0].name, "_read");
  assert.equal(body.tools[0].cache_control, undefined);
  assert.equal(body.messages[1].content[0].name, "_read");
  assert.deepEqual(body.context_management, {
    edits: [{ type: "clear_thinking_20251015", keep: "all" }],
  });
  assert.equal(body.fallbacks, undefined);
  assert.deepEqual(body.messages[0].content[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(body.messages[1].content[0].cache_control, { type: "ephemeral" });
  assert.equal(body.messages[2].clear_at, "next_user_message");
  assert.equal(body.messages[2].content[0].cache_control, undefined);

  const metadata = JSON.parse(body.metadata.user_id);
  assert.equal(metadata.account_uuid, accountId);
  assert.equal(metadata.session_id, sessionId);
  assert.match(metadata.device_id, /^[0-9a-f]{64}$/);

  const responseText = await response.text();
  assert.match(responseText, /"name":"read"/);
  assert.doesNotMatch(responseText, /"name":"_read"/);
});

test("API-key requests pass through without bootstrap or mutation", async () => {
  const input = "https://api.anthropic.com/v1/messages";
  const init: RequestInit = {
    method: "POST",
    headers: { "x-api-key": "sk-ant-api-test" },
    body: '{"model":"claude-fable-5"}',
  };
  let receivedInput: RequestInfo | URL | undefined;
  let receivedInit: RequestInit | undefined;
  const baseFetch: typeof globalThis.fetch = async (nextInput, nextInit) => {
    receivedInput = nextInput;
    receivedInit = nextInit;
    return new Response("ok", { status: 200 });
  };

  const routedFetch = createOmpAnthropicFetch(baseFetch, {
    installId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    modelId: "claude-fable-5",
    messages: [],
    identityResolver: new AnthropicIdentityResolver(),
  });
  await routedFetch(input, init);

  assert.equal(receivedInput, input);
  assert.equal(receivedInit, init);
});
