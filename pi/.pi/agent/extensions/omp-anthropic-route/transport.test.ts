import assert from "node:assert/strict";
import test from "node:test";
import {
  AnthropicIdentityResolver,
  CLAUDE_CODE_SYSTEM_INSTRUCTION,
  CLAUDE_CODE_VERSION,
  createOmpAnthropicFetch,
  inspectOmpRoutedRequest,
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
  assert.deepEqual(headers.get("anthropic-beta")!.split(","), [
    "claude-code-20250219", "oauth-2025-04-20", "interleaved-thinking-2025-05-14",
    "thinking-token-count-2026-05-13", "context-management-2025-06-27",
    "prompt-caching-scope-2026-01-05", "mid-conversation-system-2026-04-07",
    "effort-2025-11-24", "fallback-credit-2026-06-01",
  ]);
  assert.equal(headers.get("anthropic-usage-limit"), null, "OMP 18.3.1 slow mode remains opt-in upstream");
  assert.doesNotMatch(headers.get("anthropic-beta") ?? "", /server-side-fallback/);
  assert.doesNotMatch(headers.get("anthropic-beta") ?? "", /mid-conversation-output-config|thinking-binding-controls/);

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
  // OMP 18.3.0 switched SHA-256 to Bun; these fixed vectors keep Node's
  // implementation byte-compatible with the reviewed upstream calculation.
  assert.match(body.system[0].text, /^x-anthropic-billing-header: cc_version=2\.1\.280\.01e;/);
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
  assert.deepEqual(body.tools[0].cache_control, { type: "ephemeral" });
  assert.equal(body.messages[1].content[0].name, "_read");
  assert.deepEqual(body.context_management, {
    edits: [{ type: "clear_thinking_20251015", keep: "all" }],
  });
  assert.equal(body.fallbacks, undefined);
  assert.equal(body.fallback_credit_token, undefined, "no fallback-credit redemption is introduced by the review");
  assert.deepEqual(body.messages[0].content[0].cache_control, { type: "ephemeral" });
  assert.deepEqual(body.messages[1].content[0].cache_control, { type: "ephemeral" });
  assert.equal(body.messages[2].clear_at, "next_user_message");
  assert.equal(body.messages[2].content[0].cache_control, undefined);

  const metadata = JSON.parse(body.metadata.user_id);
  assert.equal(metadata.account_uuid, accountId);
  assert.equal(metadata.session_id, sessionId);
  assert.equal(metadata.device_id, "09b34d0a373565ef4c91564b0a1efe3389b3687a12fba350c54dd4c108c1bf8b");

  const responseText = await response.text();
  assert.match(responseText, /"name":"read"/);
  assert.doesNotMatch(responseText, /"name":"_read"/);
});

test("OMP 18.3.1 retains the utility profile without opting into compaction or user profiles", async () => {
  const result = await inspectOmpRoutedRequest("https://api.anthropic.com/v1/messages", {
    headers: {
      authorization: "Bearer sk-ant-oat-test",
      "anthropic-beta": "compact-2026-09-04,user-profiles-2026-09-04",
    },
    body: JSON.stringify({ model: "claude-opus-5-5", messages: [{ role: "user", content: "Synthetic" }], max_tokens: 512 }),
  }, {
    installId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", modelId: "claude-opus-5-5",
    messages: [], identityResolver: new AnthropicIdentityResolver(),
  });
  assert.equal(result.headers!.get("user-agent"), "claude-cli/2.1.280 (external, cli)");
  assert.equal(result.headers!.get("x-stainless-package-version"), "0.112.1");
  assert.equal(result.headers!.get("x-stainless-runtime-version"), "v26.3.0");
  assert.deepEqual(result.headers!.get("anthropic-beta")!.split(","), [
    "oauth-2025-04-20", "interleaved-thinking-2025-05-14", "thinking-token-count-2026-05-13",
    "context-management-2025-06-27", "prompt-caching-scope-2026-01-05", "structured-outputs-2025-12-15",
  ]);
  const body = JSON.parse(result.body!);
  assert.equal(JSON.parse(body.metadata.user_id).device_id, "6b324f4745d86b980fcb0f70bef69ccf83a0b8ae2b4164ed23d79e4598ad2a63");
  assert.equal(body.compaction, undefined);
  assert.equal(body.context_management, undefined);
  assert.equal(body.max_tokens, 512);
});

test("native per-message effort retains its required betas without forwarding unrelated betas", async () => {
  const outputConfigBeta = "mid-conversation-output-config-2026-07-01";
  const bindingBeta = "thinking-binding-controls-2026-08-01";
  const messages = [
    { role: "user", content: "First question" },
    { role: "system", content: [], output_config: { effort: "low" } },
    { role: "assistant", content: [{ type: "text", text: "Prior answer" }] },
    { role: "user", content: "Follow-up question" },
    { role: "system", content: [], output_config: { effort: "max" } },
  ];
  const thinking = {
    type: "adaptive",
    display: "summarized",
    block_binding: { prefix_mismatch_behavior: "drop_block" },
  };
  const result = await inspectOmpRoutedRequest("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      authorization: "Bearer sk-ant-oat-test-token",
      "anthropic-beta": ` ${outputConfigBeta},${bindingBeta},${outputConfigBeta},server-side-fallback-2026-06-01,unreviewed-beta`,
    },
    body: JSON.stringify({
      model: "claude-fable-5", messages, thinking,
      output_config: { effort: "high" },
      fallbacks: [{ model: "claude-opus-4-8" }],
    }),
  }, {
    installId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    modelId: "claude-fable-5",
    messages: [],
    identityResolver: new AnthropicIdentityResolver(),
  });
  const betas = result.headers!.get("anthropic-beta")!.split(",");
  assert.equal(betas.filter((beta) => beta === outputConfigBeta).length, 1);
  assert.equal(betas.filter((beta) => beta === bindingBeta).length, 1);
  assert.ok(!betas.includes("server-side-fallback-2026-06-01"));
  assert.ok(!betas.includes("unreviewed-beta"));
  const body = JSON.parse(result.body!);
  assert.deepEqual(body.messages.filter((message: any) => message.output_config),
    messages.filter((message) => message.output_config));
  assert.deepEqual(body.thinking, thinking);
  assert.deepEqual(body.output_config, { effort: "high" });
});

test("reviewed long-cache beta and tool head anchor stay within four breakpoints", async () => {
  const result = await inspectOmpRoutedRequest("https://api.anthropic.com/v1/messages", {
    headers: { authorization: "Bearer sk-ant-oat-test" },
    body: JSON.stringify({ model: "claude-opus-5-5", messages: [
      { role: "user", content: "first" }, { role: "assistant", content: "answer" }, { role: "user", content: "next" },
    ], system: [{ type: "text", text: "Synthetic", cache_control: { type: "ephemeral", ttl: "1h" } }],
    tools: [{ name: "first" }, { name: "second" }, { name: "deferred", defer_loading: true }] }),
  }, { installId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", modelId: "claude-opus-5-5", messages: [], identityResolver: new AnthropicIdentityResolver() });
  assert.match(result.headers!.get("anthropic-beta")!, /extended-cache-ttl-2025-04-11/);
  const body = JSON.parse(result.body!);
  assert.equal(body.tools[0].cache_control, undefined);
  assert.deepEqual(body.tools[1].cache_control, { type: "ephemeral", ttl: "1h" });
  assert.equal(body.tools[2].cache_control, undefined);
  assert.equal((result.body!.match(/"cache_control":/g) ?? []).length, 4);
});

for (const origin of ["http://api.anthropic.com", "https://api.anthropic.com:8443", "https://proxy.invalid"]) {
  test(`OAuth alignment bypasses non-official origin ${origin}`, async () => {
    const input = `${origin}/v1/messages`;
    const init = { headers: { authorization: "Bearer sk-ant-oat-caller" }, body: '{"model":"claude-opus-5-5"}' };
    let calls = 0;
    const routed = createOmpAnthropicFetch(async (url, options) => {
      calls++; assert.equal(url, input); assert.equal(options, init); return new Response("ok");
    }, { installId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", modelId: "claude-opus-5-5", messages: [], identityResolver: new AnthropicIdentityResolver() });
    await routed(input, init); assert.equal(calls, 1, "must not bootstrap");
  });
}

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

test("identity lookup is cached per access token and repeated after a refresh", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    const token = new Headers(init?.headers).get("authorization")!;
    seen.push(token);
    return new Response(JSON.stringify({ oauth_account: { account_uuid: token.endsWith("b") ? "account-b" : "account-a" } }),
      { status: 200, headers: { "content-type": "application/json" } });
  };
  const resolver = new AnthropicIdentityResolver();
  assert.equal((await resolver.resolve("sk-ant-oat-a", fetchImpl)).accountId, "account-a");
  assert.equal((await resolver.resolve("sk-ant-oat-a", fetchImpl)).accountId, "account-a");
  assert.equal((await resolver.resolve("sk-ant-oat-b", fetchImpl)).accountId, "account-b");
  assert.deepEqual(seen, ["Bearer sk-ant-oat-a", "Bearer sk-ant-oat-b"]);
});
