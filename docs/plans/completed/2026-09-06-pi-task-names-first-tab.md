# Summarized task names and Pi in tab 1

**Status:** Complete
**Scope:** Herdr Pi Tasks plugin; no existing branch/worktree renames or live task requests.

## Objective

`C-a t` creates a branch/worktree named for a concise summary of the work, and
focuses Pi in the first tab rather than behind the default shell.

## Context and constraints

- Preserve extensive pre-existing uncommitted launcher and Pi extension changes.
- Current launcher slugifies the raw prompt and appends a tab; tests encoded that
  implementation rather than these user-visible outcomes.
- Installed Herdr schema and pinned 0.8.2 source support `tab.move` with zero-based
  `insert_index`; preserve the shell instead of terminating it.
- Pi's installed ModelRuntime supports a tool-free `completeSimple` request with
  normal provider auth, without loading agent resources or creating a session.

## Acceptance criteria

- [x] Default names use a bounded model-generated work summary; original prompt reaches Pi unchanged.
- [x] Naming failure allocates nothing; explicit branch bypasses naming; startup retry retains identity.
- [x] Pi is tab 1; ordering failure never launches a duplicate session.
- [x] Focused Node/own-PTY checks pass; owning docs reflect naming request and tab order.

## Approach and progress

- [x] Trace source, consumers, tests, installed API and pinned Herdr implementation.
- [x] Implement title generation, naming handoff and safe tab ordering with regressions.
- [x] Exercise isolated consumers and inspect diff; document remaining real-provider gap.

## Decisions

- Generate the title on submission using the selected model, lowest supported
  effort, bounded request, no tools/resources/history. Do not disguise a truncated
  prompt as a fallback summary. Explicit Advanced branch is the offline escape.
- Move the new Pi tab to index 0, leaving the default shell in tab 2. After Pi
  opens, ordering/preferences failures are warnings, never a startup retry.

## Verification

From the repository root:

- `herdr api schema --json` and pinned source inspected; no production topology
  reads or mutations.
- `node --test herdr/.config/herdr/plugins/task-launcher/*.test.mjs` — passed,
  50 tests, including installed SDK faux-provider naming and recovery regressions.
- `PYTHONDONTWRITEBYTECODE=1 python3 herdr/.config/herdr/plugins/task-launcher/pty-smoke.py`
  — passed: actual form/runner, loopback provider adapter, fake Herdr/Pi; original
  prompt, summarized branch/Space title and tab-move request verified.
- `PYTHONDONTWRITEBYTECODE=1 python3 /tmp/pi-task-first-tab-native-check.py` — passed:
  isolated native Herdr, disposable Git repo/HOME, injected title and fake Pi;
  actual branch/directory/Space naming, Pi first and focused, shell second, source
  dirt preserved. Test instance stopped. Initial verifier failed by treating
  stable tab `number` as visual position; corrected to array order and reran.
  Fake fixtures and owning verification docs now reflect the observed API.
- `env -i HOME="$HOME" PATH=/usr/bin:/bin /bin/sh herdr/.config/herdr/plugins/task-launcher/launch.sh --check`
  — passed with npm Pi 0.85.1.
- `stow -n -v -t "$HOME" herdr` — passed with no link/unlink actions; existing
  launcher source links verified. No deployment/reload needed for content edits.
- `git diff --check` — passed; scoped diff and status inspected, unrelated work preserved.
- Real provider title quality/auth/billing and real Pi task startup — not run;
  no paid requests or live user task were started.

## Feedback ownership

The earliest gap was the launcher outcome contract: prompt slugification was
accepted as naming, and opening any focused Pi tab was accepted as placement.
Fixes and regression assertions belong in this plugin, not a broad agent rule.
Read the supplemental harness-engineering `AGENTS.md` via its HEAD URL; local
source/user feedback resolved ownership, so no thesis or harness edits were needed.

## Risks and recovery

Title generation adds one provider request on submission and can fail on auth,
network, or invalid output. Preserve the form; do not allocate until it succeeds.
No deployment, restarts, existing task renames, or paid verification requests.

## Outcome

The next newly opened `C-a t` form uses the updated source through existing Stow
links. Automatic names use a concise selected-model summary; Pi is first, shell
second, with no prompt rewrite or duplicate-session retry after an ordering error.
Existing branches/worktrees remain unchanged. Real-provider output remains an
explicit unverified boundary.
