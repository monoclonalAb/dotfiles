# OMP-style Anthropic route for Pi

This global Pi extension wraps Pi's native Anthropic provider and aligns **direct
Anthropic OAuth** requests with the request route used by Oh My Pi v18.1.5.
When Pi's Anthropic OAuth mode is selected, the extension resolves the current
access token from the logged-in OMP account with `omp token anthropic`. API-key
requests and non-Anthropic proxy URLs pass through unchanged.

It keeps Pi's model catalogue, tools, session handling, and stream parser. At
the final HTTP boundary it aligns the parts of OMP's Claude Code route that
affect request attribution and protocol compatibility:

- `Authorization: Bearer` OAuth transport to `/v1/messages?beta=true` through
  a streaming Bun subprocess with OMP's TLS settings;
- OMP's pinned Claude Code and Stainless headers/beta set;
- Claude Code billing-header body attestation (`cch`);
- stable install/session metadata and best-effort account bootstrap identity;
- Claude Code system block, 64K OAuth output cap, context-management request,
  cache breakpoints, and `_`-prefixed tool names;
- removal of Pi's built-in `Pi documentation (read only...)` locator block,
  which Anthropic classifies as third-party traffic; project instructions,
  user-authored system content, and the rest of Pi's prompt are preserved;
- response-side tool-name decoding back to Pi's registered names.

The route is enabled by default: no command is needed to turn it on. It becomes
active when the current model uses direct Anthropic OAuth and the installed OMP
version matches the reviewed compatibility target. Run `/omp-anthropic-route`
inside Pi to inspect the current route, version, update, and credential state;
the command is diagnostic rather than a toggle.

## Compatibility and risk

The implementation is pinned to OMP **18.1.5** and its Claude Code fingerprint.
At session start, the extension compares that target with `omp --version`. A
mismatch triggers one automatic, package-only `brew upgrade omp` attempt and a
version recheck. If the installed version still differs—including when Homebrew
has upgraded to a newer OMP release whose route has not yet been reviewed—the
pinned route stays disabled and direct Anthropic OAuth falls back to Pi's native
transport. This avoids silently presenting an obsolete fingerprint; update and
re-test this source before advancing `OMP_TARGET_VERSION`.

OMP and Anthropic can change this private wire contract at any time. Updating the
OMP binary cannot safely rewrite this extension from unreviewed upstream source.
The Bun bridge mirrors OMP's direct socket/TLS path, but this extension does not
recreate OMP's full multi-account quota rotation. This is not an
Anthropic-supported third-party integration, does not guarantee which quota or
billing bucket Anthropic applies, and may be inconsistent with Anthropic's terms
or account policy. Pi's existing extra-usage warning is deliberately left
enabled.

No credential is logged or persisted by the extension. OMP resolves and refreshes
its own credential; the access token exists only in the Pi process for the
request and is cached in memory for at most 60 seconds. Pi's existing OAuth
credential remains unchanged and acts as the route-selection signal. The route
reuses OMP's non-secret `~/.omp/install-id` device identity when available; its
mode-`0600` Pi fallback is `~/.pi/agent/omp-anthropic-route/install-id`.

## Source and licence

Request-shaping details were adapted from
[`can1357/oh-my-pi` v18.1.5](https://github.com/can1357/oh-my-pi/tree/v18.1.5),
particularly `packages/ai/src/providers/anthropic.ts` and
`packages/ai/src/providers/claude-code-fingerprint.ts`. OMP is MIT licensed;
its copyright notice is retained here by reference to its upstream licence.
