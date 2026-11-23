# Same-provider account fallback

Sign in **more than one account for the same provider** (for example two ChatGPT
subscriptions for Codex) and let Pi continue on the next one when the active
account hits its usage limit — same model, same turn — and move back once the limit
resets.

```text
· @work (main: personal)
```

The footer identifies the active subscription. When away from main it also names
main; when using main it shows just `· @<label>`. `route:off` means automation is
disabled. Other tabs refresh this account marker on their next activity; the
[quota footer](../quota-footer/README.md) follows switches within five seconds.

## Easiest workflow

1. Run `/accounts`. The picker shows **using now**, **main**, and **ready** or the
   known limit's reset time. Accounts for the current model's provider come first.
2. Pick an account to use it and make it main. Picking the current fallback also
   makes it main, so Pi will not unexpectedly return to your old choice.
3. If that account is cooling down, Pi keeps using the current account and returns
   to the new main after its reset (with automatic switching and return enabled).
4. Choose **Manage accounts…** to add or remove a saved login, switch immediately,
   list accounts, or toggle automatic switching and return to main for this tab.
   Cancelling a dialog makes no change; removal asks for confirmation.

**Main is a preference, not a special account name.** The initial `/login` account
is labelled `main`, but an account labelled `work` can be your main account.
**Ready means no known router cooldown**, not a fresh login or quota check; use
`/usage` to inspect reported allowances. Main-account choices and credential
switches are shared by **all Pi tabs** using the same auth file. Management-menu
automation toggles are session-local and reset on reload. They do not edit the optional startup configuration below.

## Commands

Commands complete provider IDs and saved labels. For `main`, `use` and `remove`,
omitting the provider uses the current model's provider.

- `/accounts` opens the picker; `/accounts list` prints the account list.
- `/accounts main work` makes `work` main and uses it when ready. `/accounts main`
  opens the picker. Explicit form: `/accounts main anthropic work`.
- `/accounts use work` **forces an immediate switch**, even during a known cooldown,
  and makes it main. The older `/accounts use <provider> <label>` still works.
- `/accounts add` guides provider selection and naming, then runs the provider's
  OAuth login. Sign in with the *other* browser account. Explicit example:
  `/accounts add openai-codex work`. A cancelled login is informational, not an error.
- `/accounts remove` picks an inactive saved account and confirms removal. Explicit
  `/accounts remove <provider> <label>` removes it without a dialog. Sign out the
  active login with Pi's `/logout`.
- `/route` shows status; `/route on|off` toggles automation for the session;
  `/route back` forces a return now, ignoring cooldown; `/route forget` clears cooldowns.
- `/usage` (from [quota-footer](../quota-footer/README.md)) shows every account's quota.

The picker and account commands do not send model requests or change conversation
history. Non-interactive `/accounts` retains the list behavior.

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
logged or put in UI/completions. Parked OAuth refreshes combine the caller's
cancellation signal with Pi's refresh signal and reject late results before Pi
can persist them; this also protects the quota reader during account moves.

When the active account reports a rate or usage limit (a 429 with reset hints, or
the limit text in the assistant error), the extension records a cooldown (the
reported reset, else `cooldownMinutes`, bounded to 1 minute – 7 days), activates an
eligible saved account, and lets **Pi's own auto-retry** finish the turn. Main is
preferred when ready, then other labels in alphabetical order. Duplicate Codex
account IDs or matching OAuth tokens/refresh tokens share the known cooldown and
are skipped, including duplicates of accounts tried earlier in the turn. Different
Claude tokens for the same remote account cannot always be identified as duplicates.
Fallback and return recheck the selection under the move lock, so a stale plan
cannot overwrite a newer account choice. A turn-start label snapshot prevents a
slow old error from penalising a different tab's new active label.
Codex's limit text does not match Pi's retry policy, so `message_end` appends
`[quota-router: …]` to that failed message's `errorMessage`; nothing else changes.
Context-overflow, transport and 5xx errors never count, a plain 429 counts only for
OAuth logins, and it never switches provider. When the preferred account's cooldown
passes, an idle session moves back. If every tried account is cooling down, it can
select the first recovered account while main still waits, then return to main
later. This recovery follows the automatic-return setting. With nothing left to
try, the error stands and a warning gives the `/accounts add` hint. Recovery does
not silently re-send an old failed task: re-send it when an account is ready.
Warnings retain the detected limit type: a generic 429 says `rate limit`, not that
the subscription allowance is exhausted.
The no-account warning means no parked login is currently eligible (including
cooldowns); it does not identify which browser account you signed into.

Caveats: Pi's `/logout` lists parked keys as `openai-codex@work` — use
`/accounts remove` instead. The [OMP Anthropic route](../omp-anthropic-route/README.md)
keeps Pi's selected request credential, so account moves also apply to Claude
requests through that bridge. Each new credential must pass its own model probe;
OMP's separately saved login is not used. Existing sessions need `/reload` after
the bridge source changes, not after each account switch.

## Tests

```sh
bun test ./pi/extensions/quota-router/accounts.test.ts
bun test ./pi/extensions/quota-router/router.test.ts
node --test pi/extensions/quota-router/native.test.mjs
PYTHONDONTWRITEBYTECODE=1 python3 pi/extensions/quota-router/pty-smoke.py
```

The Bun suites cover the account store, state file and locks, the real backend on a
temporary `auth.json` with a fake OAuth login, limit classification against Pi's
retry policy, and the router lifecycle. The native suite runs a real Pi session with
synthetic Codex logins and a loopback endpoint: a limit on `main` continues the
same turn on `work`, and `/route back`, `/accounts use|remove` and `/route off`
behave as described. They also cover the main-account picker, a current fallback
becoming main, duplicate-login skipping across multiple failures, main cooldowns,
and cancellation of parked refreshes. The PTY check exercises the actual fullscreen
picker at 50/80/100 columns in light/dark themes, Escape, making the active fallback
main, and waiting for a cooling main. No real login or billing is exercised.
Provider errors, revoked logins, Pi's retry budget and upstream availability still
apply; this extension cannot guarantee an error-free remote service.
