# Pi-only task launcher

**Status:** Complete (source implementation; deployment not performed)
**Scope:** Herdr task-launcher plugin, base keybinding, and owning documentation; installed Pi SDK/TUI as read-only dependencies.

## Objective

`C-a a t` opens a task-first form with prompt, model, and compatible thinking level. Submit creates an isolated Git worktree beneath the workflow and opens only Pi in a focused conversation. Existing worktree shortcuts remain intact.

## Non-goals

- OMP/other agent selection, automatic commits, pushes, dependency installation, or worktree cleanup.
- Changing Pi extensions or the patched Herdr binary.
- Deployment, application restarts, or sending prompts to live agent panes during verification.

## Context and constraints

- Canonical owner: `herdr/.config/herdr/plugins/task-launcher/`, consumed by `config.base.toml` via a plugin action.
- Initial unrelated changes were root README, verification guide, Pi extension README, and untracked `long-context/`. An external checkpoint commit (`34b60d4`) included those changes and the in-progress launcher while this session was working. Current files were re-read before continuation; this session made no commits.
- Inspected pinned Herdr source at `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c` and installed 0.8.2 schema: plugin popup, worktree create/open, and argv-based plugin tabs exist. CLI placement help omits popup, so use the socket API/manifest.
- Installed Pi SDK documents `ModelRuntime.create({allowModelNetwork:false})`, `getAvailable()`, and pi-ai `getSupportedThinkingLevels`; use catalog metadata rather than model-name guesses. Do not load extensions or create an agent session in the launcher.
- Runtime preferences and transient launch requests stay under Herdr plugin state, never source. Commands establish a minimal macOS PATH and resolve installed Pi without sourcing interactive shell setup.

## Acceptance criteria

- [x] `a` menu then `t` focuses task input; Escape before submit has no Git/task effects.
- [x] Pi-only model picker and model-compatible thinking levels, remembered launcher choices.
- [x] Submit uses a fresh branch/worktree, preserves source dirt, and requests a focused Pi tab; no shell interpretation of task text.
- [x] Errors preserve form contents; partial creation is retained and reported, not force-deleted or blindly duplicated.
- [x] Focused tests cover form/key flow, safe argv, filesystem state, Git discovery/validation, and mocked Herdr orchestration.
- [x] Docs and affected-package Stow preview reviewed; deployment/integration gaps reported explicitly.

## Approach

1. Build a standalone plugin with Pi's installed TUI and cached model runtime.
2. Use Herdr-native worktree creation and argv-based Pi runner tab (retain the initial shell tab).
3. Test with temporary repositories/state and fake socket/runner consumers, without a live model or Herdr server.
4. Document setup, behavior, failure recovery, and limitations.

## Progress

- [x] Inspected ownership, source consumers, pinned Herdr APIs, and installed Pi docs/examples.
- [x] Implemented plugin, Node tests and own-PTY smoke test with fake Herdr/Pi and temporary Git fixtures.
- [x] Updated plugin README, root setup/operator guide, architecture routing and verification runbook; reviewed affected-package Stow preview.

## Decisions

- **Pi only:** explicit user requirement; no agent selector or fallback executable.
- **Plugin popup:** supported by pinned source and installed schema; no extra Herdr patch.
- **Fresh Pi tab:** plugin argv entrypoint avoids sending shell text into an existing pane. Keep the worktree's initial shell available.
- **Base:** default to the source checkout's committed HEAD; show that uncommitted edits are not copied. Advanced fields can override before submit. No stash, reset, commit, or fetch.
- **Remembered model:** last selection that opened a Pi tab, not session-history mining; use global Pi startup defaults initially, visibly require selection if unavailable.
- **Ambiguous outcomes:** disable replay for any mutation whose response was lost or lacked target identity. This is safer than trying to infer completion while the server may still be working. Explicit pane rejection can retry in the known checkout.
- **Consumer compatibility:** resolve npm Pi through its package metadata (including bundled CLI and import-only exports); model search wraps SelectList with substring filtering; the Pi tab resolves its shell entrypoint through `HERDR_PLUGIN_ROOT` because cwd is the new checkout.

## Verification

- `herdr --version` and bundled `herdr api schema --json` — passed: local 0.8.2 declares popup, plugin tabs and worktree APIs; no server contacted.
- `node --test herdr/.config/herdr/plugins/task-launcher/*.test.mjs` — passed: 31 tests, installed Pi 0.85.1 libraries; no live model or server. Earlier fixture canonical-path and prefix-only picker failures were fixed and the full suite rerun.
- `PYTHONDONTWRITEBYTECODE=1 python3 herdr/.config/herdr/plugins/task-launcher/pty-smoke.py` — passed: actual action → own-PTY menu/form → temporary worktree → fake Pi child. Cancel-before-submit allocated nothing; source dirt preserved and task argv/cwd checked.
- `sh -n herdr/.config/herdr/plugins/task-launcher/launch.sh` — passed.
- `env -i HOME="$HOME" PATH=/usr/bin:/bin /bin/sh herdr/.config/herdr/plugins/task-launcher/launch.sh --check` — passed: nvm default, npm Pi 0.85.1 and required SDK/TUI APIs; no credentials/session reads.
- `HERDR_CONFIG_PATH="$PWD/herdr/.config/herdr/config.base.toml" herdr config check` — passed against the source base, not generated/live config.
- Python TOML binding/manifest consistency and changed-document local link-target checks — passed; existing worktree keybindings retained.
- `stow -n -v -t "$HOME" herdr` — passed, with only the new task-launcher directory/leaves proposed; not deployed.
- `git diff --check` — passed.
- Native Herdr popup, environment filtering, real Pi trust/auth/model/lifecycle behavior — not run. No Stow apply, plugin linking, theme regeneration, server restart, or live prompt was performed.

## Risks and recovery

- A timed-out mutating socket request can have completed server-side. The UI reports the branch/check-out identity and blocks replay; inspect the task Space before manually starting again.
- Pi startup/auth/project trust remain Pi's responsibility. A runner failure must leave the checkout and an explicit retry path.
- Global SDK catalog excludes extension-only registrations; document this rather than executing arbitrary extensions before submit.

## Outcome

Pi-only task-first launcher is implemented and source/isolated-integration checks pass. Enablement remains an explicit operator step in `herdr/.config/herdr/plugins/task-launcher/README.md`; native Herdr and provider integration remain unverified until that rollout.
