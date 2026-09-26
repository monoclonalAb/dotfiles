# OMP-style Anthropic route for Pi

This global extension wraps Pi's native Anthropic provider so that **direct
Anthropic OAuth** requests use a wire adapter reviewed against Oh My Pi (OMP)
v18.3.1. The OMP CLI updates independently to the latest stable release; it supplies
the logged-in account's access token (`omp token anthropic`), not the bridge code.
Only the HTTPS `api.anthropic.com` origin uses it. API keys, proxies and other
providers keep Pi's own credentials and transport.

Pi keeps its model catalogue, tools, sessions and stream parser. At the HTTP
boundary the route adds OMP's Claude Code shape:

- `Authorization: Bearer` to `/v1/messages?beta=true` through a streaming Bun
  subprocess with OMP's TLS settings;
- OMP's pinned Claude Code/Stainless headers and base betas, plus only the
  reviewed `NATIVE_PROTOCOL_BETAS` that Pi's serializer needs;
- **request-level** thinking effort (per-turn effort is disabled on a per-request
  model copy, because Anthropic rejects it for models without per-turn support);
- the billing-header body attestation (`cch`), install/session metadata and
  account bootstrap identity;
- the Claude Code system block, 64K output cap, context management, cache
  breakpoints and `_`-prefixed tool names (decoded back on responses);
- removal of Pi's built-in `Pi documentation (read only...)` block, which Anthropic
  classifies as third-party traffic. Project and user instructions are kept.

## Request preflight

The **first direct Claude OAuth request** in each session/reloaded runtime runs:

1. An unauthenticated HEAD request for the latest stable OMP release.
2. If the installed OMP is older, `brew upgrade can1357/tap/omp` under a
   cross-process lock (`~/.local/state/pi-omp-update.lock`). The tap must be clean,
   have the expected upstream origin, and fast-forward successfully. Its formula
   must match the exact reviewed recipe in [`omp-compat.ts`](omp-compat.ts), with
   only the matching stable version and four binary SHA-256 values substituted.
   URLs, install commands, dependencies and all other bytes cannot change.
   Worktree/formula bytes are rechecked before Homebrew; the installed version is
   rechecked afterwards. No downgrades, unrelated package upgrades or cleanup.
3. Resolve the OMP OAuth credential, then send one synthetic, tool-free request to
   the **requested model** (512 output tokens, 45 s, no retries). It must stream the
   expected reply from that model before the real request is allowed through.

A newer CLI release alone no longer blocks Claude. The wire reference in
[`transport.ts`](transport.ts) is **not a CLI version pin**. Neither the bridge
source nor its Claude Code fingerprint updates automatically.

Session startup, model selection, `/reload` and `/omp-anthropic-route` do not
upgrade OMP or probe Claude themselves. The provider boundary guards both normal
prompts and SDK/extension requests. The release/update result (including failures)
is cached until reload, and each model is probed at most once per runtime. This
avoids checks on every tool turn or changing OMP midway through a conversation.
The probe uses subscription quota but does not enter conversation history/totals.

To activate changed source, run `/reload`, then send a Claude prompt. Use
`/omp-anthropic-route` to inspect the cached CLI and model-test status. An old
`needs protocol review` version error means the previous runtime is still loaded.
Formula changes still need source review; network, upgrade, credential and probe
failures still block without a native/account/model fallback. Fix the reported
cause, `/reload`, and send another prompt; failures do not automatically retry.

`Could not resolve the logged-in OMP Anthropic credential` means `omp token`
failed: log in with `/login` → Anthropic in OMP (Pi and OMP logins are separate).
A stale update lock records its owner PID; check that process before removing it.

## Risk

The wire reference is OMP **18.3.1** / Claude Code **2.1.280** (SDK 0.112.1).
Automatic CLI updates trust upstream release binaries and checksums; those binaries
are **not individually source-reviewed**. The recipe guard constrains installation,
not the binary's behavior, and a successful probe is not a complete protocol or
security audit. OMP and Anthropic can change this private wire contract at any time.
This is not an Anthropic-supported integration, does not control which quota or billing bucket
applies, and may conflict with Anthropic's terms; Pi's extra-usage warning stays on.
It does not reproduce OMP's multi-account rotation, cache-decimation, subscription
slow mode or fallback-credit redemption.

Credentials are never logged or stored: the token lives in memory for at most 60 s.
The route reuses OMP's non-secret `~/.omp/install-id`, falling back to a mode-600
`~/.pi/agent/omp-anthropic-route/install-id`.

## Tests

```sh
bun test ./pi/.pi/agent/extensions/omp-anthropic-route/*.test.ts
node --test pi/.pi/agent/extensions/omp-anthropic-route/{native,runtime}.test.mjs
```

The Bun suites cover transport, token, future-release upgrades, exact formula
recipe validation, downgrade/race guards and a real cross-process lock. The Node
suites load the extension through Stow-style links in a real Pi SDK session with
fake OMP/Homebrew/Git/Bun commands: lazy preflight, automatic upgrade, blocked
formula drift, effort, tools, reloads and credential isolation. None upgrade the
real CLI or contact Anthropic.
Live checks on 2026-09-24 (Pi 0.87.1) passed for Opus 5.5, Fable 5, Sonnet 4.6 and
Haiku 4.5; see [the Opus 5.5 plan](../../../../../docs/plans/completed/2026-09-24-pi-opus-5-5.md).

## Source and licence

Request shaping is adapted from
[`can1357/oh-my-pi` v18.3.1](https://github.com/can1357/oh-my-pi/tree/6204b7508014bcdf12d95f0b3fd470905fd99344)
(`packages/ai/src/providers/anthropic.ts` and `claude-code-fingerprint.ts`), MIT licensed.
