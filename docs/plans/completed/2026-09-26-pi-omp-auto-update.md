# Auto-update OMP on first Claude request

**Status:** Complete
**Scope:** Pi OMP Anthropic route, owning docs, and context-separated commits.

## Objective

A new stable OMP CLI release must not require editing the bridge before sending
a Claude prompt. The first direct Claude OAuth request in a runtime checks and
updates OMP, verifies the selected model, then forwards the real request.

## Non-goals

- No automatic bridge source downloads, version spoofing changes or new wire features.
- No arbitrary formula execution, downgrades, account/model/native fallback or retries.
- No production model requests, reload, push or unrelated installation during testing.

## Context and constraints

- Latest OMP is 18.3.2; installed is 18.3.1. The exact-release gate caused the repeat failure.
- User explicitly requested automatic updates when using Claude and separate commits.
- Existing pending changes committed separately: GCloud read-only allowlist (`835078e`)
  and prior 18.3.1 protocol review (`ae6dc5a`). Working tree then clean.
- Provider-native compaction plan remains out of scope.
- Public Homebrew tap observed at `fbffe294ac114d89b8c7c71c08594a7a4ade3535`.
  Formula 18.3.2 differs from the reviewed 18.3.1 formula only in version/four hashes.

## Acceptance criteria

- [x] First routed request automatically upgrades an older OMP to latest stable,
  even when that release differs from the bridge's protocol reference.
- [x] Formula validator accepts only version and four binary SHA-256 substitutions
  in the exact reviewed recipe; origin, dirty worktree, lock, no-downgrade and
  post-upgrade version guards stay enforced.
- [x] Session startup, model selection and status command do not upgrade/probe.
- [x] One bounded same-model probe precedes user traffic; failures block without
  fallback; subsequent requests reuse the check until reload.
- [x] Synthetic resolver/transport/SDK tests pass and docs describe the trust change.
- [x] New work grouped as one coherent auto-update commit, separate from the two
  earlier contexts; task diff and worktree reviewed.

## Approach and progress

1. [x] Inspect existing changes, source, consumers and tests; commit earlier contexts.
2. [x] Separate CLI freshness from wire review and make the request boundary own preflight.
3. [x] Test future releases, rejected formula changes and lazy request lifecycle.
4. [x] Update docs and review the final diff for the separate auto-update commit.

## Decisions

- CLI binaries are now trusted upstream releases, not individually source-reviewed.
  The formula recipe is constrained byte-for-byte except stable version and hashes.
  The wire adapter remains independently reviewed and unchanged; a live probe is
  runtime evidence, not proof of billing, all features or binary safety.
- Checks run once per runtime on the first direct OAuth request (including SDK or
  extension requests), not on every tool turn. Reload resets checks without doing
  network/update work itself. Errors remain cached until reload to avoid retry loops.
- Verification uses isolated fixtures, not real credentials or Homebrew upgrades.

## Verification

- Baseline Bun (30) and Node (18) suites — passed before prior-review commit.
- GCloud allowlist JSON/read-only additions/consumer `-c` assertions — passed;
  no cloud calls or live command availability checks run.
- `bun test ./pi/.pi/agent/extensions/omp-anthropic-route/*.test.ts` — **passed**,
  40 tests with Bun 1.3.14. Future patch/minor/major CLI updates, recipe validation,
  formula/worktree drift, prerelease/downgrade rejection, lock races and wire tests.
- `node --test pi/.pi/agent/extensions/omp-anthropic-route/{native,runtime}.test.mjs`
  — **passed**, 21 tests with Node 24.19.0 / Pi 0.87.1. Includes a simulated
  18.3.1 → 18.3.2 upgrade on first prompt, unchanged bridge source, passive lifecycle,
  blocked recipe drift, probe failures, concurrent coalescing and cancelled requests.
- Public formula download from the pinned tap revision plus
  `node --input-type=module` calls to `validateOmpFormula` — **passed** for actual
  public formulas 18.3.0, 18.3.1 and 18.3.2. Artifacts remain outside Git at
  `/tmp/omp-18.3.1-review.c226dh`; no Ruby execution or binary download.
- Python documentation-link/anchor/source-leaf assertions — **passed**. Existing
  source leaves resolve into the checkout; no Stow layout/deployment changes.
- `git diff --check`, task diff and `git status --short` — **passed**.
- `omp --version` at completion — **passed**, still `omp/18.3.1`.
- Real OMP upgrade/token resolution, production Pi reload, model probe and push —
  **not run**, intentionally left to the user's next Claude request after reload.

## Risks and recovery

Upstream binaries can change token behavior; formula validation is not a binary
security audit. Probe failure still blocks user inference. Real upgrades preserve
Homebrew's previous keg. Existing source links take effect after the user's reload.

## Outcome

Implemented lazy, guarded OMP CLI updates without the exact protocol-version
roadblock. The reviewed wire adapter is unchanged; diagnostics clearly separate
its reference version from the installed CLI. All 61 focused tests passed.

Run `/reload` once to load this change, then send a Claude prompt. The first request
checks/updates OMP and verifies its model; `/omp-anthropic-route` reports the result.
If the formula or actual protocol breaks, the route still fails closed with a
specific cause. Future CLI release numbers alone do not require source edits.
