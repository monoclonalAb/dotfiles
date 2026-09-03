# Keep the OMP Anthropic route version-compatible by default

**Status:** Complete
**Scope:** Pi `omp-anthropic-route` extension and the Homebrew-managed OMP runtime

## Objective

Keep direct Anthropic OAuth routing enabled by default when the installed OMP wire contract matches the extension, automatically ask Homebrew to update OMP after a mismatch, and never silently send the pinned route after versions still differ.

## Non-goals

- Automatically rewriting the extension from unreviewed upstream source.
- Selecting Anthropic as Pi's default model or changing Pi's app-owned settings.
- Recreating OMP's account rotation.

## Context and constraints

- Homebrew metadata exposed OMP 18.1.5 while the installed binary and route initially targeted 18.1.2.
- Review of upstream v18.1.2..v18.1.5 found unchanged Claude Code fingerprint, headers, betas, bootstrap, attestation, and TLS settings. The relevant route change skips turn-scoped `clear_at` system messages when choosing the two cache breakpoints.
- The route is already auto-selected for direct Anthropic OAuth; `/omp-anthropic-route` is a diagnostic command, not an enable toggle.
- A newer OMP binary does not prove that this extension matches its private wire contract. Runtime source generation would violate the repository's desired-state boundary.
- Existing unrelated worktree changes must remain untouched.

## Acceptance criteria

- [x] Matching OMP versions route direct Anthropic OAuth through the pinned transport without running Homebrew.
- [x] A mismatch triggers one coalesced `brew upgrade omp` attempt and a version recheck.
- [x] If the post-update version still differs, Pi uses its native Anthropic provider rather than the stale route.
- [x] `/omp-anthropic-route` reports installed, target, update, and route state clearly.
- [x] Focused tests cover matching, repaired, unresolved, and failed-update states.

## Approach

1. Add an injectable, cached OMP compatibility resolver around `omp --version` and `brew upgrade omp`.
2. Gate both Anthropic streaming paths on compatibility while preserving default automatic activation.
3. Expand status output and colocated documentation.
4. Run focused tests, a Pi extension-load check where practical, Stow dry-run, and repository hygiene checks.

## Progress

- [x] Inspected the extension, its consumer APIs, installed OMP/Pi versions, and repository boundaries.
- [x] Implemented and tested cached compatibility resolution and automatic Homebrew update.
- [x] Reviewed OMP v18.1.5, advanced the route, and integrated fail-safe routing and diagnostics.
- [x] Upgraded this Mac from OMP 18.1.2 to 18.1.5 through the new resolver and verified the deployed extension.

## Decisions

- **Update then fail safe:** A mismatch attempts a package-only Homebrew upgrade. The pinned route is used only if the rechecked installed version equals the reviewed target; otherwise Pi's native route remains available.
- **Command remains diagnostic:** The extension has no opt-in toggle. Matching direct Anthropic OAuth traffic is routed automatically.
- **No self-modifying adapter:** Updating a binary cannot safely regenerate a reviewed private protocol implementation.

## Verification

- `bun test ./pi/.pi/agent/extensions/omp-anthropic-route/*.test.ts` — passed: 11 tests across compatibility, token, Bun bridge, and transport paths.
- `bun build ./pi/.pi/agent/extensions/omp-anthropic-route/index.ts --target=node --packages=external` — passed.
- `pi --list-models` — passed from the deployed extension set; 22 models listed.
- `omp token anthropic >/dev/null` — passed; credential is available without exposing it.
- live compatibility resolver — passed: detected 18.1.2, ran `brew upgrade omp`, and rechecked 18.1.5 as compatible.
- `brew info --json=v2 omp` — passed: installed and stable are 18.1.5; not outdated.
- `stow -n -v -t "$HOME" pi` — passed after applying the reviewed two-link plan; no pending package changes.
- `git diff --check` plus checks for the untracked extension files — passed.

## Risks and recovery

- Homebrew update can be slow or unavailable. It is attempted only after a mismatch, is cached per extension runtime, and failure falls back to Pi's native provider.
- A newly upgraded OMP can remain incompatible with the pinned adapter. Status exposes that state; update the reviewed transport and target together before it routes again.
- Remove the compatibility gate integration to restore the previous behavior; no Homebrew state is written when versions already match.

## Outcome

OMP and the reviewed route now target 18.1.5. The route is enabled without a toggle, proactively checks compatibility at session start, upgrades a mismatched Homebrew OMP once, and uses Pi's native Anthropic transport if the versions remain different. Future upstream releases still require source review before advancing the pinned route; automatic binary updates deliberately do not self-modify repository code.
