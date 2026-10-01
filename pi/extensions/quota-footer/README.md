# Subscription quotas in Pi's footer

Shows the **active** Codex and Claude accounts' usage in Pi's footer, and every saved
account (including logins parked with [`/accounts`](../quota-router/README.md)) in
`/usage`. No desktop app or daemon.

```text
31% | 14% · 0%
```

Percentages are **used**, not remaining. Codex (blue) is left of `|`, Claude
(yellow) right; each shows weekly then five-hour usage. Unreported windows are
omitted, `n/a` means neither was reported, and Spark/model-specific buckets are
ignored. A trailing `*` marks a **stale** reading (15+ minutes old, a failed refresh,
or an elapsed reset window). Other states: `…` loading, `wait Nm` backoff, `/login`,
`OAuth needed`, `unsupported route`, `timeout`, `rate limited`, `unavailable`,
`offline`. Waiting on the usage endpoint does not mean the subscription is exhausted.

## Behaviour

- Only interactive (TUI) sessions poll, and only for active accounts. Codex
  refreshes every five minutes per process. Claude readings are shared across Pi
  sessions on the same login and fetched by one process at a time, at most every
  15 minutes; `Retry-After` is honoured (5–60 minutes). Readings expire after an hour.
- `/usage` checks every saved account with resets, cache age and backoff. It is UI
  output only and never enters the conversation.
- The footer follows account switches immediately in this session and within five
  seconds in others. Polling never switches accounts; the router does.
- With [`compact-ui`](../compact-ui/README.md), `MCP: N/M` shares the same line.

## Auth and data

Active accounts use Pi's `modelRegistry.getProviderAuth()`; parked accounts use a
private `ModelRuntime.getAuth()` on their parked key, so Pi refreshes their OAuth
tokens in place without activating them. Use Pi's `/login`: Claude Code or Codex CLI
logins are not used, and API keys have no subscription quota.

Only GETs to the fixed OpenAI/Anthropic usage endpoints are made (no redirects,
bounded bodies, errors reduced to labels). Codex state stays in memory. Claude
snapshots live in `~/.local/state/pi/quota-footer/<sha256-of-token>/` (mode 700,
files 600) and contain only percentages, resets, timestamps and a failure code.
Keying by token hash means a new login never reuses another login's numbers. The
extension never touches model input, tools or request payloads.

## Tests

```sh
bun test ./pi/extensions/quota-footer/*.test.ts
bun test ./pi/extensions/quota-router/accounts.test.ts
node --test pi/extensions/quota-footer/native.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 pi/extensions/quota-footer/pty-smoke.py
```

All use synthetic credentials and responses: multi-process cache sharing, login
changes, expiry, backoff, parked-account refresh, `/usage` and `/accounts use` in a
real Pi session, and fullscreen rendering at 50/80/100 columns in light and dark
themes. None contact a provider. Live check: `/usage` in two sessions should agree.
