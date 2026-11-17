# Retire the unused Herdr Brief workflow

**Status:** Complete
**Scope:** Herdr app layout, keys and Brief mod; Pi's Brief-only generation; focused tests and operator docs; removal of their deployed symlinks.

## Objective

Remove the `C-a i` panel and automatic conversation briefs. Keep conversation titles, attention state, navigation, and the sidebar/Files panel unchanged. The user reads the latest reply or asks the agent for a recap instead.

## Non-goals

- A replacement dashboard or summary command.
- Renaming `herdr-task-summary` or its title labels.
- Restarting applications, reloading other agent conversations, or sweeping old runtime labels/state.
- Deploying unrelated pending files.

## Context and constraints

- Canonical entry points: `herdr-app/layouts/eric.json`, `herdr-app/keys.json`, and `pi/extensions/herdr-task-summary/index.ts`.
- Overlapping active work: [Herdr migration](../active/2026-11-04-herdr-app-migration.md). Preserve its historical verification; add a retirement note only.
- Existing edits in app layout/docs, Pi policy/docs, quota-router and rho are unrelated and must be preserved. In particular, keep the layout's `traffic_lights` change.
- Baseline `bin/dotfiles-link check`: 337 links in place; unrelated creates for `pi/keybindings.json` and `pi/extensions/quota-router/pty-smoke.py`. Do not run real-home `apply` while those remain.
- Baseline live `herdr-app status`: layout `eric`, no errors. App-owned generated files in the deployed Brief folder must stay untouched.

## Acceptance criteria

- [x] No Brief node, shortcut, mod, or Brief generation remains in current source.
- [x] Default Pi extension entry point registers only title generation; regression test verifies one title request and title-only labels.
- [x] Sidebar/Files toggles, title generation, attention and navigation tests pass.
- [x] Owning docs describe the two remaining panel views.
- [x] Brief-only symlinks removed without deploying unrelated files; app hot reload reports no errors.

## Approach

1. Remove Brief-only source, wiring and tests; keep shared title helpers.
2. Adapt panel tests to sidebar/Files and cover the default Pi entry point.
3. Update owning docs and the overlapping migration plan.
4. Run focused suites and link preview, remove only verified retired symlinks, then hot-reload app config and inspect its status/frame.

## Progress

- [x] Confirmed Brief summaries have their own module and labels, separate from titles.
- [x] Inspected existing diffs and deployment preview; unrelated work preserved.
- [x] Implement removal and regression coverage.
- [x] Run source and live checks.

## Decisions

- **Keep titles:** `task_summary` labels are short conversation titles used by navigation and attention; only `task_brief` generation is retired.
- **Existing Pi sessions:** user runs `/reload` when idle; do not send input to agents.
- **Scoped deployment:** remove only the retired files' verified symlinks if unrelated pending creates remain. Leave generated mod files and old labels alone.

## Verification

- `bin/dotfiles-link check` — baseline: exit 1, two unrelated creates, no conflicts.
- `PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin" herdr-app status` — baseline: layout `eric`, `errors: []`.
- `bun test ./pi/extensions/herdr-task-summary/*.test.ts` — passed, 36 tests, including the default title-only entry point and a real installed ModelRegistry with an in-memory faux provider. No real provider requests.
- `node --test lib/herdr-app-mods/*.test.mjs` — passed, 93 tests; rerun after the final tab-bar comment correction.
- `herdr-app check ~/.config/herdr-app/mods/pane-keys` and `herdr-app check ~/.config/herdr-app/mods/tab-bar` with explicit minimal PATH — passed.
- Hot reload via `touch -h` on the app's layout, keys, pane-keys and tab-bar symlinks — performed. `herdr-app status` reported layout `eric`, no errors. Screenshot `/tmp/herdr-brief-retirement.tT7o8U/window.png` inspected: conversation panes and right-hand sidebar render, no Brief panel.
- Scoped deployment — removed exactly the five previewed retired symlinks after verifying each target. Left generated Brief mod files untouched.
- Post-cleanup `bin/dotfiles-link check` — exit 1 solely for the same two unrelated creates; 332 links in place, no removals, repairs or conflicts pending. Real-home `apply` deliberately not run.
- Empty-home deployment check from `docs/VERIFICATION.md` — passed: 334 links created, subsequent check clean, no docs/archive links.
- Focused Markdown link-target check — passed, 101 local targets across 7 affected documents. Removed Brief heading has no remaining current incoming links.
- `git diff --check` — passed. Current source has no Brief wiring, implementation or docs, apart from a regression assertion guarding the removed shortcut.
- Existing live Pi sessions — not reloaded. The user must run `/reload` when each is idle; no input sent to other agents.

## Risks and recovery

- Existing Pi runtimes keep old hooks until their user reloads; no promise of immediate cessation in those sessions.
- Removing an active panel must leave sidebar/Files usable. Check the live layout and frame after hot reload, without resetting app-owned layout state.
- Recover source from Git if needed; do not reset unrelated changes.

## Outcome

Removed Brief's mod, layout node, shortcut, generation module and obsolete tests; kept the title generator and shared title request helper. Added regression checks for title-only default registration and the sidebar/Files configuration. Updated operator docs and the migration plan. App changes are live with no reported errors; old Pi runtimes need the user-initiated idle reload noted above. Unrelated edits and pending links were preserved.
