# Open Pi Tasks directly with C-a t

**Status:** Complete
**Scope:** Herdr task binding, launcher entrypoint/UI, focused tests, owning docs, and deployment of the correction.

## Objective

User clarified the intended shortcut is `C-a t`, opening the task form directly with no intermediate menu.

## Non-goals

- No changes to task/worktree creation semantics, real Pi startup, or model requests.
- No production restarts, input to existing agent panes, commits, or unrelated cleanup.

## Context and constraints

- Pi Tasks is already deployed; existing source edits affect managed leaves immediately.
- Preserve the uncommitted implementation/docs/tests and completed historical plans.
- Canonical owner: `herdr/.config/herdr/config.base.toml` and `plugins/task-launcher/` beneath that config directory.
- `prefix+t` is unclaimed in the source and installed Herdr defaults inspected this session.

## Acceptance criteria

- [x] `C-a t` opens and focuses task input directly; `C-a a` is no longer the launcher binding.
- [x] Updated tests/docs and focused source checks pass.
- [x] Production config/plugin refreshed; native direct-open/picker/cancel check passes in an isolated test instance.

## Approach and progress

- [x] Re-read binding, manifest, caller, UI, tests, docs, and live config health.
- [x] Removed menu step, updated entrypoint/binding/tests/docs.
- [x] Ran focused checks, deployed correction, and verified native UI without submitting a task.

## Decisions

- **Direct form:** remove the obsolete menu, rather than retaining an extra shortcut or hidden prefix requirement.
- **Live verification:** use deployed sources in an isolated native Herdr PTY; keep the task empty and touch no existing agent pane.

## Verification

- Preflight `herdr config check` and `herdr status server` — passed.
- `node --test herdr/.config/herdr/plugins/task-launcher/*.test.mjs` — passed: 31 tests, including directly focused input and ordinary Kitty `t` typing.
- `PYTHONDONTWRITEBYTECODE=1 python3 herdr/.config/herdr/plugins/task-launcher/pty-smoke.py` — passed: checks the sole `prefix+t` binding and manifest entrypoint, then direct form/cancel/start with fake Herdr/Pi and temporary Git fixtures.
- Source-targeted `herdr config check` and `git diff --check` — passed.
- `stow -n -v -t "$HOME" herdr` — passed with no pending actions; all changed package files were already linked.
- `herdr plugin link "$HOME/.config/herdr/plugins/task-launcher" --enabled`, `theme apply`, and production `herdr config check` — passed. Manifest now invokes `form`; generated config has exactly one task binding, `prefix+t`. No production restart.
- `PYTHONDONTWRITEBYTECODE=1 python3 /tmp/pi-task-direct.zsMgtv/native-ui-check.py` — passed with installed native Herdr and the deployed plugin: `C-a t` opens New Task directly without the menu; model/thinking selectors and cancel/reopen pass. No worktree changes, task requests, preference writes, or agent startup; isolated process stopped.
- Final `herdr status server` — passed: production remains running and compatible.
- Real Pi task/model request — not run, outside the UI-only verification scope.

## Risks and recovery

Regenerate config only through `theme`; refresh the plugin's cached manifest after changing its entrypoint. Do not restart production. Keep previous generated config in a temporary audit directory outside the repository for recovery.

## Outcome

Corrected and deployed `C-a t` for direct task entry. The old menu and launcher binding on `C-a a` are removed. Source and native isolated-UI checks pass. Prior implementation/rollout plans remain historical; the pre-change generated config and current native-test evidence are outside the repository in `/tmp/pi-task-direct.zsMgtv/`.
