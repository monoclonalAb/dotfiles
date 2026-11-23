# Easier Pi account switching

**Status:** Complete
**Scope:** `pi/extensions/quota-router/`, its operator documentation and synthetic tests.

## Objective

Choose an account and change the main account from `/accounts`, without memorising provider IDs. Keep automatic fallback on the same provider/model and avoid stale or duplicate account moves.

## Non-goals

- Per-tab credentials, new providers, live sign-ins, credential inspection, or automatic deployment/reload.
- Guaranteeing that remote providers never fail, or suppressing their errors.

## Context and constraints

- Existing unrelated modifications: `docs/HERDR-APP.md`, `herdr-app/layouts/eric.json`, `pi/extensions/README.md`, `pi/extensions/selective-skills.ts`. Preserve them.
- Existing linked source edits become available to fresh/reloaded Pi sessions. Do not reload other sessions.
- Credentials stay in Pi's private auth store. State stays outside Git. Tests use temporary stores and synthetic credentials.
- At task start, `activate` returned early for the already-active account, leaving the old preferred account intact. The regression now has unit, native Pi and terminal coverage.

## Acceptance criteria

- [x] `/accounts` offers a cancellable account picker showing active/main/cooldown; selecting an eligible account makes it main.
- [x] Selecting the current fallback makes it main and cancels the old automatic return.
- [x] Selecting a cooling-down main waits safely rather than forcing a known failing account; explicit legacy use/back behavior remains documented.
- [x] Guided management and short commands avoid memorising provider IDs; existing explicit commands remain supported.
- [x] Fallback skips duplicate logins and rechecks the active account and cooldown under the move lock.
- [x] Focused Bun and native Pi tests pass; docs describe remaining boundaries.

## Approach

1. Add regression coverage and account-store guards.
2. Add the picker and guided account actions using Pi's built-in dialogs.
3. Exercise real Pi with synthetic logins/loopback provider; update operator docs.

## Progress

- [x] Read source, consumer, extension policy, installed extension/TUI docs and examples, nearest tests.
- [x] Implement account-store fixes and UI, shared duplicate cooldowns, request-label snapshots and first-recovered-account scheduling.
- [x] Verify and document, including a real fullscreen picker smoke test.

## Decisions

- Keep the existing state format: `preferred` records a main account only while away from it. No credential migration.
- A remote outage or revoked login can still fail. Improve local management without claiming an error-free provider.
- An unchanged HEAD copy reproduced the parked-refresh cancellation failure against installed Pi. Private OAuth clones now combine the caller's signal with Pi's signal before/after refresh, preventing late persistence. The original regression passes.
- Native multi-failure coverage exposed a duplicate of an earlier exhausted login being retried after moving on. Duplicate cooldowns are now shared, and candidate selection excludes every known cooling login's identity.
- PTY cancellation waits for `ui_prompt_end`, not a fixed delay; a standalone Escape can wait for terminal escape-sequence disambiguation.

## Verification

All commands ran from the repository root with installed Pi/Node/Bun. No real credentials or provider billing were used.

- `bun test ./pi/extensions/quota-router/accounts.test.ts ./pi/extensions/quota-router/router.test.ts` — passed: 54 tests.
- `bun test ./pi/extensions/quota-footer/*.test.ts` — passed: 95 tests.
- `node --test pi/extensions/quota-router/native.test.mjs pi/extensions/quota-footer/native.test.mjs` — passed: five router cases and one footer case; temporary auth files, real Pi sessions and a loopback provider.
- `PYTHONDONTWRITEBYTECODE=1 python3 pi/extensions/quota-router/pty-smoke.py` — passed: actual fullscreen picker at 50/80/100 columns in dark/light themes, Escape, main selection and waiting on a known cooldown.
- `PYTHONDONTWRITEBYTECODE=1 python3 pi/extensions/quota-footer/pty-smoke.py` — passed: existing quota/footer terminal checks in both themes.
- `bin/dotfiles-link check` — reviewed read-only preview: only the new `quota-router/pty-smoke.py` test link is pending (exit 1 for a planned creation); no repairs, removals or conflicts. No apply run.
- `git diff --check` — passed.
- Real account login, remote provider acceptance and reload of existing sessions — not run, intentionally.

## Risks and recovery

- Account changes affect all sessions sharing Pi's auth file, as before. Reload each idle Pi tab to use the new extension code.
- The pending test-only symlink is not a runtime dependency: all changed runtime files are already linked.
- Roll back only task edits and reload idle sessions manually if needed. No real accounts are changed during implementation.

## Outcome

Implemented in `pi/extensions/quota-router/`. `/accounts` now provides a picker and guided management; main selection, cooldown recovery, duplicate handling and refresh cancellation have regression coverage. Owning operator docs and verification guidance are updated. Existing sessions have not been reloaded; no actual accounts were switched.
