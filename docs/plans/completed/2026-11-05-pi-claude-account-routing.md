# Claude requests follow Pi's selected account

**Status:** Complete — source fix and isolated integration checks; live retry pending
**Scope:** `pi/extensions/omp-anthropic-route/`, its interaction with
`pi/extensions/quota-router/`, and their operating documentation.

## Objective

Selecting an Anthropic account in Pi changes the credential used for the model
probe and actual Claude request. A generic HTTP 429 is not described as proof
that the subscription allowance is exhausted.

## Non-goals

- No credential-file inspection, account login/logout, quota purchase, or claim
  that a provider rate limit can be removed locally.
- No protocol fingerprint changes, application restarts, or input sent to other
  agent panes. No unrelated Herdr changes.

## Context and constraints

- Pi authenticates first, but the bridge currently replaces its resolved token
  with `omp token anthropic`. The quota display/router use Pi's accounts instead.
- Keep OMP compatibility/update checks and the bounded, fail-closed model probe.
  API-key and proxy requests remain untouched. Pi owns refresh and account choice.
- Pre-existing edits include the extension-policy README and plan index; preserve
  them with narrow edits. Existing native-compaction work is unrelated.

## Acceptance criteria

- [x] A real isolated Pi session switches with `/accounts use anthropic work`;
      probe and inference both use that account, never OMP's saved login.
- [x] Different credentials cannot reuse one another's successful or failed
      probes; concurrent requests keep their own credentials.
- [x] Existing protocol, cancellation, passive-startup and bypass tests pass.
- [x] Generic 429 warnings distinguish rate limiting from explicit usage limits.
- [x] Operating docs describe the single credential owner and recovery steps.

## Approach

1. Add an isolated native regression and observe it fail on the current bridge.
2. Preserve each request's Pi-resolved credential; key probes by model and a
   memory-only credential fingerprint. Remove the unused OMP credential helper.
3. Exercise account switching, probe failures, concurrency, and quota warnings.
4. Update docs, inspect link preview and diffs, and report the live-check gap.

## Progress

- [x] Read provider/extension APIs, affected sources and nearest tests.
- [x] Red-first regression: the native session sent the synthetic OMP token
      instead of Pi's; different logins also shared successful/failed probes.
- [x] Implementation: preserve Pi's credential and cache probes by its fingerprint;
      remove the unused OMP credential resolver and account pinning.
- [x] Native tests cover manual switching, automatic same-turn 429 fallback,
      concurrent credentials, and credential-specific failed probes.
- [x] Warning tests retain `rate limit` for generic 429 and `usage limit` for
      explicit exhaustion. Updated operating docs and the policy's auth boundary.
- [x] Reviewed link preview: only two obsolete helper links; applied that cleanup.
      No session restart or reload and no real provider request.

## Decisions

- Pi is the sole credential owner for Pi requests. OMP continues to supply the
  compatibility/version prerequisite and reviewed wire reference, not the login.
- A changed access token receives a new bounded probe, even on a same-account
  refresh. No account is inferred from labels and no automatic OMP fallback occurs.

## Verification

Run from the repository root on 2026-11-05. Tests use temporary HOME,
synthetic credentials and fake commands; no real login was changed.

- `node --test --test-name-pattern='accounts use changes|failed probe belongs|concurrent credentials' pi/extensions/omp-anthropic-route/runtime.test.mjs`
  — failed on the original bridge for all three intended regressions, then passed.
  The existing fixture first needed its removed `ai.Type` export changed to the
  installed TypeBox module. The automatic-fallback fixture also supplies the UI
  theme/status methods used by the real router.
- `node --test pi/extensions/omp-anthropic-route/{native,runtime}.test.mjs`
  — passed, 28 tests, including the bridge plus real Pi account commands/retry.
- `bun test ./pi/extensions/omp-anthropic-route/*.test.ts`
  — passed, 42 tests after removal of the four obsolete OMP-token tests.
- `bun test ./pi/extensions/quota-router/router.test.ts`
  — passed, 25 tests. The new 429 warning assertions also failed before the fix.
- `node --test pi/extensions/quota-router/native.test.mjs`
  — passed, three isolated Codex retry/account tests.
- `bun test ./pi/extensions/quota-router/accounts.test.ts`
  — **failed**, 16 pass / 1 fail in the unchanged parked-refresh cancellation
  test. Reproduced alone with `--test-name-pattern='cancelled parked refresh'`.
  Its expectation is that cancellation prevents saving a late refreshed
  credential; the installed Pi deliberately completes and persists an in-flight
  OAuth refresh under its lock to avoid losing a rotated refresh token.
  The test and its account-store/backend/quota-reader sources have no diff and
  were left intact. This is a pre-existing SDK-contract mismatch, not a routing
  regression; the expectation still needs reconciliation in its owning task.
- `bin/dotfiles-link check` — preview listed only the two deleted helper links
  (expected exit 1 for drift), with no conflicts/unrelated actions.
  `bin/dotfiles-link apply` removed only those links; the following check passed.
- `git diff --check` — passed; reviewed task diffs and preserved concurrent work.
- **Not run:** live Anthropic inference or reloading any current session. The
  next owner retry after `/reload` must establish actual service acceptance and
  whether the selected account still has a provider-side limit.

## Risks and recovery

- Reauthentication cannot create quota. A valid selected account can still get
  429 responses. A live retry is a separate check after `/reload`.
- Source files are already linked; idle sessions require `/reload` to use changes.
- Reverting only this task's diff restores the old routing; unrelated work stays.

## Outcome

Pi's selected request login now owns both preflight and inference through the
reviewed OMP-shaped transport. The quota display/router no longer point at a
different credential source. No credentials were logged, copied, or changed.

The owner must `/reload` in existing Pi sessions before retrying. `/accounts`
shows current labels and cooldowns; `/route forget` can clear marks recorded by
the old routing, but cannot reset provider limits. Reauthentication or this fix
cannot guarantee that an account has remaining allowance. The unchanged
account-storage cancellation test's SDK-contract mismatch remains explicit above.
