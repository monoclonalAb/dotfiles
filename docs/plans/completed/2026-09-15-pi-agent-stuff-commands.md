# Selected agent-stuff Pi commands

**Status:** Complete (source implementation; live activation separate)
**Scope:** `pi/.pi/agent/extensions/agent-stuff/` and owning documentation

## Objective

Provide `/review [target]`, `/end-review`, `/answer`, `/session-breakdown`,
`/btw [question]`, and `/goal <objective>` from mitsuhiko/agent-stuff, adapted to
installed Pi and this repository's opt-in/context-neutral defaults.

## Non-goals

- Installing the full mitsupi package or unrelated upstream extensions.
- Reading live credentials/history, calling real providers, deploying or reloading live sessions.
- Changing unrelated concurrent work (the worktree was already extensively dirty).

## Context and constraints

- Upstream source pinned at `122e2994adddb113c04764c5697217dae120fcc6`, Apache-2.0.
- Existing wrapper selects fullscreen TUI and opt-in skills; extensions are Stow leaf links.
- Goal tools/context/continuations require opt-in; status/usage views must not inject prompts.
- Side chat must not bypass parent tool restrictions to edit shared files.

## Acceptance criteria

- [x] All six slash commands load in native Pi with no added active tools by default.
- [x] Review targets and branch return, Q&A confirmation, separate BTW thread,
      usage aggregation, and goal continuation/stop paths are exercised with fixtures.
- [x] Native abort and lifecycle fixture checks suppress late goal/side continuation.
- [x] Attribution, local deviations, usage costs, state ownership, and activation are documented.
- [x] Focused checks, diff hygiene, and Pi-only Stow preview are reviewed.

## Approach

1. Vendor only five requested extensions and license; retain upstream provenance.
2. Adapt installed APIs and narrow safety/lifecycle boundaries.
3. Add synthetic native/behavior/TUI checks and run them without live state.
4. Update owners and finish with deployment explicitly separate.

## Progress

- [x] Read repository policy, installed Pi docs/examples, upstream selected source and consumers.
- [x] Implement/adapt and test against installed Pi 0.85.1.
- [x] Document and inspect upstream/local diff and Pi-only Stow preview.

## Decisions

- **Source vendoring:** Keeps this subset reproducible without installing other commands/tools.
- **Local safeguards:** Goal starts opt-in and pauses on abort/restore; PR checkout confirms;
  BTW uses only active native read tools, with no extension discovery in its side session.

## Verification

From the repository root, this session:

- `node --test pi/.pi/agent/extensions/agent-stuff/native.test.mjs` — passed, 19 checks;
  native discovery through leaf symlinks, goal continuation/completion/pause/abort/restore,
  partial tool allowlist fail-closed behavior, budget limits, review target/summary return,
  Q&A confirmation, read-only BTW with parent auth/header/env/endpoint parity, side history
  restoration and late-result suppression, non-TUI guards, usage parser and TUI widths,
  plus mocked PR confirmation/dirty-tree/URL/runtime-isolation guards.
- `node pi/.pi/agent/extensions/agent-stuff/typecheck.mjs` — passed for all five extensions.
  Initial upstream `modelRegistry` SDK incompatibility was corrected using the public
  `ModelRuntime`/effective-provider APIs; no private runtime fields are accessed.
- `git diff --check` and per-new-file `git diff --no-index --check /dev/null <file>` — passed.
- `stow -n -v -t "$HOME" pi` — passed, no conflicts. New `agent-stuff` leaf links are pending;
  preview also includes unrelated quota-footer, subagent and task-observer work. Applied nothing.
- Apache license byte comparison with pinned upstream — passed; owning documentation paths exist.
- Real providers, GitHub checkout, live history scanning, terminal appearance, Stow deployment,
  live `/reload`, commits and pushes — not run.

## Risks and recovery

- Goal mode intentionally adds paid automatic turns once invoked; pause/clear stops continuation.
- Review is not a filesystem sandbox; optional fix actions are explicit UI choices.
- New files are not live until individually linked from a reviewed Stow preview.
- Recovery: remove only this extension's entrypoint link and reload an idle session.

## Outcome

All six commands are implemented under `pi/.pi/agent/extensions/agent-stuff/` with
pinned attribution, opt-in/context safeguards, fixture checks and an operator guide.
Owning extension policy, root tooling guide, architecture routing and verification
runbook are updated. Unrelated work remains intact. Activation is a separate user
decision: link only this extension's reviewed Stow leaves, then reload an idle Pi.
See [the operator guide](../../../pi/.pi/agent/extensions/agent-stuff/README.md) for
costs, local upstream differences and unverified live boundaries.
