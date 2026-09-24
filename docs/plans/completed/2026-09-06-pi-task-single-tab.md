# Pi Tasks opens one tab only

**Status:** Complete
**Scope:** Herdr task launcher; no retroactive changes to existing live Spaces.

## Objective and acceptance

- [x] New tasks finish with exactly one focused Pi tab, not Pi plus a shell.
- [x] Close only the initial tab identified by the newly created Space, after Pi
  opens; missing/changed topology never triggers broad tab cleanup.
- [x] Cleanup failure cannot resend the task; names and prompt handoff unchanged.
- [x] Node, own-PTY, and isolated native Herdr/fake Pi checks pass; docs match.

## Context and decisions

The previous implementation misread “first tab” as permitting a second shell.
The correction belongs in launcher behavior and a one-tab regression assertion,
not a new global instruction. Herdr's create response identifies the initial tab;
`tab.close` terminates it. Preserve unrelated work and all pre-existing changes.

## Progress

- [x] Inspect current launcher/caller/tests and native create/close API.
- [x] Replace reorder with scoped initial-shell removal and verify recovery.
- [x] Update docs, run checks and inspect diff.

## Verification

All commands run from the repository root:

- `node --test herdr/.config/herdr/plugins/task-launcher/*.test.mjs` — passed,
  53 tests; single-tab cardinality, source/unknown-tab protection, failed startup,
  cleanup rejection/uncertainty and false success covered.
- `PYTHONDONTWRITEBYTECODE=1 python3 herdr/.config/herdr/plugins/task-launcher/pty-smoke.py`
  — passed; actual form/runner, loopback naming provider, fake Herdr/Pi, exactly
  one focused Pi tab and cancellation without allocation.
- `PYTHONDONTWRITEBYTECODE=1 python3 /tmp/pi-task-first-tab-native-check.py`
  — passed after updating the test to require one tab, not two: isolated native
  Herdr, disposable Git fixture/HOME, injected title, fake Pi; bootstrap shell
  removed, source panes and checkout unchanged. Only the test instance stopped.
- `git diff --check` — passed; scoped source and status reviewed.
- Existing `task.mjs` Stow link resolves to repository source; no layout change,
  Stow apply or restart needed. Next launcher process picks up the correction.
- Real provider/Pi startup and cleanup of existing production tabs — not run.

Consulted supplemental harness-engineering `AGENTS.md` read-only after correcting
and verifying the task. User feedback and local evidence resolve the owner;
no additional thesis, broad preference rule or harness edit was warranted.

## Risks and recovery

Never close the bootstrap shell until Pi's tab is confirmed present. If topology
or a mutation reply is unexpected, keep Pi running and warn; do not retry startup.
Only new launcher-owned Spaces are in scope, not existing user tabs.

## Outcome

`C-a t` now leaves exactly one Pi tab in new task Spaces, removing the extra shell
rather than merely changing its position. Naming and literal prompt handoff stay
unchanged. Tests assert the corrected one-tab outcome. Existing live task Spaces
remain untouched.
