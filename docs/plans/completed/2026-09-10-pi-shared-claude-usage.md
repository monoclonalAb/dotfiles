# Share Claude usage readings across Pi sessions

**Status:** Complete
**Scope:** `pi/.pi/agent/extensions/quota-footer/` and owning operator/verification docs.

## Objective

All Pi sessions using the same resolved Claude login display the last successful
usage reading instead of competing for a cooldown that shares no result.

## Non-goals

- No Claude Code auth/cache import, token-based estimates, model requests, daemon,
  credential-store scan, changes to Codex polling, or other-pane input.
- No unrelated worktree changes, commits, package-wide deployment or restarts.

## Context and constraints

- The entire quota-footer directory is pre-existing untracked work; preserve it.
- The existing global `anthropic.next`/`anthropic.lock` cadence is shared, while
  successful readings currently remain private to each process.
- Installed Pi's public auth facade exposes resolved tokens, not stable Anthropic
  account IDs. Use a one-way token fingerprint for conservative isolation; token
  rotation is a cache miss, never permission to reuse ambiguous numbers.
- Existing source leaves may be live symlinks. Mutable state stays outside Git.

## Acceptance criteria

- [x] A second reader/reloaded session gets the first reader's sanitized snapshot
  without another provider request; concurrent cold readers converge.
- [x] Cache age is preserved, stale readings are marked, expired readings/windows
  are not presented as current, and `/usage` explains source/backoff.
- [x] Auth failures and changed tokens cannot retain another login's values.
- [x] Real 429 backoff is shared and respected; transient failures can retain a
  bounded same-login snapshot without concealing the failure.
- [x] Private, bounded, validated, atomic cache writes contain no credentials,
  account names, raw payloads or histories. Corruption cannot imply zero usage.
- [x] Focused suite and isolated native Pi PTY check pass; docs match.

## Approach

1. Add a bounded shared snapshot alongside the existing compatible request lease.
2. Carry freshness/retry metadata to the monitor without changing conversation UI APIs.
3. Exercise synthetic transport, actual process sharing, auth isolation and terminal flow.
4. Update docs and inspect only the scoped diff against a temporary baseline.

## Progress

- [x] Revalidated source, consumers, nearest tests and installed Pi docs/types.
- [x] Implement cache and monitor behavior in existing source leaves only.
- [x] Run checks and update extension README/policy, root operations guide and
  verification runbook. Reviewed the scoped directory diff against the external
  pre-edit baseline; unrelated worktree changes remain intact.

## Decisions

- **Identity:** SHA-256 fingerprint of the resolved OAuth access token; stricter
  than account identity and no added auth API/credential-store access.
- **Storage:** one versioned snapshot slot, outside Git under the existing state
  directory, with owner-only permissions and atomic replacement; no growing history.
- **Migration:** retain the old global throttle names so not-yet-reloaded processes
  still coordinate. They cannot publish cache data until reloaded.

## Verification

- `bun test ./pi/.pi/agent/extensions/quota-footer/*.test.ts` — **passed**:
  81 tests, 277 assertions, including four OS processes sharing one GET and original
  timestamp. Baseline before editing was 51 tests/175 assertions. An intermediate
  cancellation fixture hung with `AbortSignal.timeout`; replacing that fixture's
  timer with an explicit AbortController deadline passes (including the final rerun).
- `PYTHONDONTWRITEBYTECODE=1 python3 pi/.pi/agent/extensions/quota-footer/pty-smoke.py`
  — **passed**, dark and light: isolated native Pi, 50/80/100-column footer, draft
  editing, stale snapshot/429 details, and reload with no additional quota GET.
- `tsc --project <temporary-tsconfig>` via a Python TemporaryDirectory wrapper —
  **passed**, strict/noEmit source checking of index/monitor/quota against installed
  Pi public types; no dependency installation or generated repository files.
- `git diff --check` and `git diff --no-index --check` against the external
  quota-footer baseline — **passed**, no whitespace diagnostics (no-index exits 1
  for the expected directory difference). Reviewed source and scoped diff.
- Python assertions on existing `~/.pi/agent/extensions/quota-footer/` symlink
  destinations — **passed** for all three runtime source leaves. No package layout
  change, Stow operation, application restart or existing-session reload performed.
- Live `/usage` versus Claude Code — **not run**; user-operated check, no real auth
  accessed or provider request made. Synthetic GETs only in tests.

## Risks and recovery

- Token rotation or a legacy process winning the lease can leave a cold cache until
  a new reader is allowed. Show an explicit retry time; do not bypass backoff.
- Reverting scoped source changes restores the old reader; new cache data is ignored.

## Outcome

Implemented [shared Claude usage](../../../pi/extensions/quota-footer/README.md).
Existing sessions need a user-initiated `/reload` once idle. All old readers should
be reloaded so the next permitted success publishes a cache; an existing cooldown
may still need to elapse. No daemon, new dependency, credentials on disk, model
context change, commit or push. Live provider/account comparison remains manual.
