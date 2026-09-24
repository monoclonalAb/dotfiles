# Show quota usage for every saved Pi account

**Status:** Complete
**Scope:** Pi quota-footer and quota-router account/auth integration

## Objective

`/usage` shows labelled weekly/five-hour usage and resets for all saved Codex and
Claude accounts; the compact footer follows the active account after fallback or
manual selection, without changing routing policy.

## Non-goals

- No real login/provider trial, credential inventory, model request, or deployment.
- No automatic switching based on quota polling; the router remains the owner.

## Context and constraints

- Both extensions are existing untracked work; preserve them and unrelated changes.
- Reuse Pi's credential store and native OAuth refresh, never temporarily activate
  an account to inspect usage. Keep per-account cache/backoff isolated and private.
- UI-only output; no conversation entries or raw auth/error data.

## Acceptance criteria

- [x] All saved supported accounts appear, including isolated errors and active labels.
- [x] Footer follows account changes, rejecting late old-account results.
- [x] Parked reads do not switch credentials; native refresh persists to the same key.
- [x] Cache/backoff, cancellation and non-TUI boundaries have focused coverage.

## Approach

1. Add account-scoped quota reading and monitoring using the existing account backend.
2. Connect router account-change notifications to footer refresh.
3. Test synthetic account reads/switches and the installed Pi credential boundary.
4. Update operator documentation and inspect the final diff.

## Progress

- [x] Read current extensions, nearest tests, Pi extension/TUI/SDK APIs.
- [x] Implement and verify; operator docs updated, no live provider reads or deployment.

## Decisions

- Only active accounts are polled; parked accounts are checked on `/usage`.
- Show separate account rows, not summed percentages (subscriptions have distinct limits).
- Keep account source/monitor logic in existing `quota.ts` / `monitor.ts`: the first
  isolated native Stow-layout check failed when new helper files were absent from
  the deployed view. Folding them into their existing owners fixed loading without
  linking unrelated pending extensions. The final native test proves this layout.
- Claude cache/lease directories are scoped by resolved-token fingerprint; matching
  legacy snapshots/backoff are honoured during adoption. No credential migration.

## Verification

From repository root, final source:

- `bun test ./pi/.pi/agent/extensions/quota-footer/*.test.ts` — passed, 95 tests.
- `bun test ./pi/.pi/agent/extensions/quota-router/accounts.test.ts` — passed, 17 tests.
- `bun test ./pi/.pi/agent/extensions/quota-router/router.test.ts` — passed, 23 tests.
- `node --test pi/.pi/agent/extensions/quota-footer/native.test.mjs` — passed:
  installed Pi, default source, existing symlink layout, real command dispatch,
  synthetic auth, intercepted GETs, no conversation messages.
- `node --test pi/.pi/agent/extensions/quota-router/native.test.mjs` — passed,
  three native loopback account-routing journeys.
- `PYTHONDONTWRITEBYTECODE=1 python3 pi/.pi/agent/extensions/quota-footer/pty-smoke.py`
  — passed in light/dark themes at 50/80/100 columns; all-account details and
  active-account switching, cache/backoff/reload, no model requests.
- `tsc -p <temporary tsconfig.json>` via a one-off Node runner — passed, strict
  checking of both extension entry points and imported source against installed
  Pi/pi-ai types; `skipLibCheck`, no installs, temporary configuration removed.
- `stow -n -v -t "$HOME" pi` — passed preview; only this task's two new test files
  plus unrelated subagent/observer work remain unlinked. No runtime links needed;
  did not apply Stow.
- `git diff --check` — passed. Unrelated pre-existing work preserved.
- Live account quotas, reload in the user's session, real OAuth/provider billing
  — not run. All auth/HTTP evidence is isolated/synthetic.

## Risks and recovery

Credential refresh and account moves must remain serialized. Changes are source-only;
existing sessions adopt them with the user's `/reload`. Roll back only this task's edits.

## Outcome

Implemented all-account `/usage` and an active-account footer in
`pi/.pi/agent/extensions/quota-footer/`, with native parked-auth support and
payload-free UI invalidation in `quota-router/`. Existing routing policy is
unchanged. Run `/reload` in each idle Pi session, then `/usage`; no new runtime
Stow links or live credential changes were made by this task.
