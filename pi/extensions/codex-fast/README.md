# Codex-only fast mode

`/fast` toggles fast mode; `/fast on`, `/fast off` and `/fast status` are also
available. Enable it while Pi is idle. The footer shows `fast:codex` when enabled.

Only Pi's `openai-codex` provider with the native `openai-codex-responses` API is
targeted. Supported models are GPT-5.4, GPT-5.5, GPT-5.6 (including Sol, Terra and
Luna) and GPT-6 Astra; the reviewed allowlist lives in [`index.ts`](index.ts).
Claude, direct OpenAI API, proxies under other provider names, Spark and unknown
models are untouched. The command does not select a different model.

- Starts **off** on startup, `/reload` and every new/resumed/forked session.
- Switching to an unsupported model turns it off; supported Codex models keep it.
- When on, the request hook sets only `service_tier: "priority"` on main-agent
  requests; nothing else in the payload changes. When off, payloads are untouched.

Fast mode uses **more ChatGPT credits**. The indicator shows the requested tier, not
proof the account has fast access; Pi's cost estimates may not include the
surcharge. The wire value follows Codex's
[`ServiceTier::Fast` mapping](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/config_types.rs);
see [OpenAI's speed guide](https://developers.openai.com/codex/speed/) for availability.

## Verification

```sh
bun test ./pi/extensions/codex-fast/index.test.ts
node --test pi/extensions/codex-fast/native.test.mjs
```

Unit tests cover commands, lifecycle and model gating. The native suite checks the
priority tier on the wire through Pi's real SSE/WebSocket serializers against
loopback servers, and that Anthropic and direct OpenAI requests are untouched.
