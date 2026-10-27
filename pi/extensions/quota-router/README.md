# Same-provider account fallback

Sign in **more than one account for the same provider** (for example two ChatGPT
subscriptions for Codex) and let Pi continue on the next one when the active
account hits its usage limit — same model, same turn — and move back once the limit
resets.

```text
· @work
```

The footer marks the active login with a dim `· @<label>` only while a provider
is away from your preferred account; the return time is in `/accounts`, and
`route:off` means automation is disabled.

## Commands

- `/accounts add <provider> <label>` runs the provider's OAuth login (sign in with
  the *other* account) and parks it, e.g. `/accounts add openai-codex work`. The
  account from `/login` is called `main`.
- `/accounts` lists accounts as `active`, `parked`, `limit until HH:MM` or
  `return here`. `/accounts use <provider> <label>` switches by hand (when idle) and
  makes it the preferred account. `/accounts remove <provider> <label>` forgets a
  parked account; sign out the active one with Pi's `/logout`.
- `/route` shows status; `/route on|off` toggles automation for the session;
  `/route back` returns now; `/route forget` clears cooldowns.
- `/usage` (from [quota-footer](../quota-footer/README.md)) shows every account's quota.

Optional `~/.pi/agent/quota-router.json`, read at startup and `/reload`:

```json
{ "cooldownMinutes": 30, "returnToPreferred": true }
```

## How it works

Pi resolves each request through one credential per provider id in
`~/.pi/agent/auth.json`. The active account stays under `openai-codex`; others are
parked under `openai-codex@<label>` in the same file. Switching moves credentials
between the keys through Pi's own locked writer (a private `ModelRuntime` on the same
file, using Pi's internal `credentials` field, checked at first use), serialised by
a lock under `~/.local/state/pi/quota-router/`, which also holds labels, preference
and cooldowns. Pi re-reads `auth.json` per request, so a switch applies to **every
running Pi session** — intended, since limits are per account. Tokens are never
logged or copied.

When the active account reports a subscription limit (a 429 with reset hints, or
the limit text in the assistant error), the extension records a cooldown (the
reported reset, else `cooldownMinutes`, bounded to 1 minute – 7 days), activates the
first parked account without one, and lets **Pi's own auto-retry** finish the turn.
Codex's limit text does not match Pi's retry policy, so `message_end` appends
`[quota-router: …]` to that failed message's `errorMessage`; nothing else changes.
Context-overflow, transport and 5xx errors never count, a plain 429 counts only for
OAuth logins, and it never switches provider. When the preferred account's cooldown
passes, an idle session moves back. With nothing left to try, the error is shown
once with the `/accounts add` hint.

Caveats: Pi's `/logout` lists parked keys as `openai-codex@work` — use
`/accounts remove` instead. The [OMP Anthropic route](../omp-anthropic-route/README.md)
uses OMP's token, so Anthropic account moves only matter when that route is not in use.

## Tests

```sh
bun test ./pi/extensions/quota-router/accounts.test.ts
bun test ./pi/extensions/quota-router/router.test.ts
node --test pi/extensions/quota-router/native.test.mjs
```

The Bun suites cover the account store, state file and locks, the real backend on a
temporary `auth.json` with a fake OAuth login, limit classification against Pi's
retry policy, and the router lifecycle. The native suite runs a real Pi session with
two synthetic Codex logins and a loopback endpoint: a limit on `main` continues the
same turn on `work`, and `/route back`, `/accounts use|remove` and `/route off`
behave as described. No real login or billing is exercised.
