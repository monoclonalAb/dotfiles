# Pi-only task launcher

**Status:** Active
**Scope:** Herdr task-launcher plugin, base keybinding, and owning documentation; installed Pi SDK/TUI as read-only dependencies.

## Objective

`C-a a t` opens a task-first form with prompt, model, and compatible thinking level. Submit creates an isolated Git worktree beneath the workflow and opens only Pi in a focused conversation. Existing worktree shortcuts remain intact.

## Non-goals

- OMP/other agent selection, automatic commits, pushes, dependency installation, or worktree cleanup.
- Changing Pi extensions or the patched Herdr binary.
- Deployment, application restarts, or sending prompts to live agent panes during verification.

## Context and constraints

- Canonical owner: `herdr/.config/herdr/plugins/task-launcher/`, consumed by `config.base.toml` via a plugin action.
- Existing unrelated changes: root README, verification guide, Pi extension README, and untracked `long-context/`; preserve and re-read shared docs before editing.
- Inspected pinned Herdr source at `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c` and installed 0.8.2 schema: plugin popup, worktree create/open, and argv-based plugin tabs exist. CLI placement help omits popup, so use the socket API/manifest.
- Installed Pi SDK documents `ModelRuntime.create({allowModelNetwork:false})`, `getAvailable()`, and pi-ai `getSupportedThinkingLevels`; use catalog metadata rather than model-name guesses. Do not load extensions or create an agent session in the launcher.
- Runtime preferences and transient launch requests stay under Herdr plugin state, never source. Commands establish a minimal macOS PATH and resolve installed Pi without sourcing interactive shell setup.

## Acceptance criteria

- [ ] `a` menu then `t` focuses task input; Escape before submit has no Git/task effects.
- [ ] Pi-only model picker and model-compatible thinking levels, remembered launcher choices.
- [ ] Submit uses a fresh branch/worktree, preserves source dirt, and focuses a Pi tab; no shell interpretation of task text.
- [ ] Errors preserve form contents; partial creation is retained and reported, not force-deleted or blindly duplicated.
- [ ] Focused tests cover form/key flow, safe argv, filesystem state, Git discovery/validation, and mocked Herdr orchestration.
- [ ] Docs and affected-package Stow preview reviewed; deployment/integration gaps reported explicitly.

## Approach

1. Build a standalone plugin with Pi's installed TUI and cached model runtime.
2. Use Herdr-native worktree creation and argv-based Pi runner tab (retain the initial shell tab).
3. Test with temporary repositories/state and fake socket/runner consumers, without a live model or Herdr server.
4. Document setup, behavior, failure recovery, and limitations.

## Progress

- [x] Inspected ownership, source consumers, pinned Herdr APIs, and installed Pi docs/examples.
- [ ] Implement plugin and focused tests.
- [ ] Update owning docs and verify.

## Decisions

- **Pi only:** explicit user requirement; no agent selector or fallback executable.
- **Plugin popup:** supported by pinned source and installed schema; no extra Herdr patch.
- **Fresh Pi tab:** plugin argv entrypoint avoids sending shell text into an existing pane. Keep the worktree's initial shell available.
- **Base:** default to the source checkout's committed HEAD; show that uncommitted edits are not copied. Advanced fields can override before submit. No stash, reset, commit, or fetch.
- **Remembered model:** last successful launcher selection, not session-history mining; use global Pi startup defaults initially, visibly require selection if unavailable.

## Verification

- `herdr --version` and bundled `herdr api schema --json` — passed: local 0.8.2 declares popup, plugin tabs and worktree APIs; no server contacted.
- Focused tests, config parsing, diff checks and Stow dry run — not run yet.
- Live popup and provider/agent startup — not run; no deployment or live prompts authorized for verification.

## Risks and recovery

- A timed-out mutating socket request can have completed server-side. Reconcile known worktree identity before retry; do not automatically retry an ambiguous pane launch.
- Pi startup/auth/project trust remain Pi's responsibility. A runner failure must leave the checkout and an explicit retry path.
- Global SDK catalog excludes extension-only registrations; document this rather than executing arbitrary extensions before submit.

## Outcome

Pending.
