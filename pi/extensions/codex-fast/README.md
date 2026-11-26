# Codex fast mode, on by default

Fast mode is **on** whenever a supported Codex model is selected. The footer shows
`fast` right after the model name (`gpt-6.2-sol • fast • xhigh`; drawn there by
[`compact-ui`](../compact-ui/README.md), otherwise Pi lists it with the other
statuses). `/fast` toggles it; `/fast on`, `/fast off` and `/fast status` are also
available. Change it while Pi is idle.

Only Pi's `openai-codex` provider with the native `openai-codex-responses` API is
targeted. Supported models are the ones OpenAI's speed guide lists for Fast: GPT-5.6
(including Sol, Terra and Luna), GPT-6 (Astra, Sol and Luna), GPT-6.1 (Sol and
Terra) and GPT-6.2 (Astra and Sol); the reviewed allowlist lives in
[`index.ts`](index.ts). Claude, direct OpenAI API, proxies under other provider
names, Spark, retired models (GPT-5.4, GPT-5.5) and unknown models are untouched.
The command does not select a different model.

- Every new, resumed or forked session, and `/reload`, starts **on**.
- `/fast off` lasts for the rest of that session, including after switching to
  Claude and back. Switching models never turns it on or off; it simply does
  nothing while the model is unsupported, and the footer shows no `fast` then.
- When on, the request hook sets only `service_tier: "priority"` on main-agent
  requests; nothing else in the payload changes. When off, payloads are untouched.
- [`pi-agent`](../../../bin/pi-agent) helpers load this extension only with `-f`;
  without it they run at the normal tier.

Fast mode uses **more ChatGPT credits**. The indicator shows the requested tier, not
proof the account has fast access; Pi's cost estimates may not include the
surcharge. The wire value follows Codex's
[`ServiceTier::Fast` mapping](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs);
see [OpenAI's speed guide](https://developers.openai.com/codex/speed/) for availability.
Ultrafast (`service_tier: "ultrafast"`) is not supported.

## Verification

```sh
bun test ./pi/extensions/codex-fast/index.test.ts
node --test pi/extensions/codex-fast/native.test.mjs
```

Unit tests cover commands, lifecycle and model gating. The native suite checks the
priority tier on the wire through Pi's real SSE/WebSocket serializers against
loopback servers, and that Anthropic and direct OpenAI requests are untouched.
