# OMP-style Anthropic route for Pi

This global extension wraps Pi's native Anthropic provider so that **direct
Anthropic OAuth** requests match the route used by Oh My Pi (OMP) v18.3.1. The
access token comes from the logged-in OMP account (`omp token anthropic`); only the
HTTPS `api.anthropic.com` origin uses it. API keys, proxies and other providers keep
Pi's own credentials and transport.

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

## Startup check

With Claude OAuth selected, each new session or `/reload` (and the first later
switch to Claude) runs:

1. An unauthenticated HEAD request for the latest stable OMP release.
2. A comparison with the reviewed OMP / Claude Code pair in [`transport.ts`](transport.ts).
   An unknown release **blocks the route** until this extension is reviewed and
   updated; bridge code is never downloaded.
3. If the installed OMP is older, `brew upgrade can1357/tap/omp` under a
   cross-process lock (`~/.local/state/pi-omp-update.lock`), after checking that the
   tap is clean and the formula matches its reviewed SHA-256. No downgrades and no
   other packages.
4. One synthetic, tool-free request to the **selected model** (512 output tokens,
   45 s, no retries) that must stream the expected reply from that model.

Only then do real requests proceed. A failure blocks the route with a visible
reason; there is no fallback to Pi's transport, another account or another model.
Each model is probed at most once per runtime; `/reload` checks again. The probe
uses real subscription quota but does not appear in conversation history or totals.
`/omp-anthropic-route` shows the cached results without making requests.

To recover, fix the reported cause and `/reload`. `OMP <version> needs protocol
review` refers to the latest upstream release, not necessarily your installed
binary. Review the upstream provider/token changes and complete Homebrew formula,
then update the version/checksum pins, tests and source reference together; do not
bypass the check or only change the version string. The
[18.3.1 review](../../../../../docs/plans/completed/2026-09-25-pi-omp-18-3-1-review.md)
records this update. Reloading alone cannot approve a future release.

`Could not resolve the logged-in OMP Anthropic credential` means `omp token`
failed: log in with `/login` → Anthropic in OMP (Pi and OMP logins are separate).
A stale update lock records its owner PID; check that process before removing it.

## Risk

The reviewed pair is OMP **18.3.1** / Claude Code **2.1.280** (SDK 0.112.1). OMP and
Anthropic can change this private wire contract at any time. This is not an
Anthropic-supported integration, does not control which quota or billing bucket
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

The Bun suites cover transport, token, update/formula guards and a real
cross-process lock. The Node suites load the extension through Stow-style links in a
real Pi SDK session with fake OMP/Bun commands and synthetic responses: effort guard,
tools, reloads, credential isolation and the startup check. None contact Anthropic.
Live checks on 2026-09-24 (Pi 0.87.1) passed for Opus 5.5, Fable 5, Sonnet 4.6 and
Haiku 4.5; see [the Opus 5.5 plan](../../../../../docs/plans/completed/2026-09-24-pi-opus-5-5.md).

## Source and licence

Request shaping is adapted from
[`can1357/oh-my-pi` v18.3.1](https://github.com/can1357/oh-my-pi/tree/6204b7508014bcdf12d95f0b3fd470905fd99344)
(`packages/ai/src/providers/anthropic.ts` and `claude-code-fingerprint.ts`), MIT licensed.
