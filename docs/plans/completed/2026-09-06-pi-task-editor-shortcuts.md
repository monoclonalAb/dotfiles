# Preserve Pi editing shortcuts in the task form

**Status:** Complete
**Scope:** Existing Herdr task-launcher runtime/UI/tests/docs and UI-only verification through deployed symlinks.

## Objective

The `C-a t` form follows Pi's text-editing and model/effort controls: Ctrl+J/Shift+Enter newline, Shift+Tab effort cycle, Ctrl+L model picker, Ctrl+P/Shift+Ctrl+P model cycle, Ctrl+C clear/double-press close, and Ctrl+D exit only when the draft is empty. Respect configured Pi keybindings instead of maintaining another default table.

## Non-goals

- No agent session, task submission, provider request, production restart or input to another agent pane.
- No automatic Pi extension loading, transcript/session operations, or changes to Pi's own settings.

## Context and constraints

- Preserved all previous uncommitted implementation/docs/tests and historical plans. Concurrent Pi clipboard/Vim work appeared during verification and was left intact, including its separate active-plan index entry.
- The launcher is deployed: source leaf edits take effect the next time its popup opens.
- Installed Pi 0.85.1 docs and source confirm the action IDs, CustomEditor routing, and namespaced keybinding manager; no local keybindings.json currently exists.
- Current form handles Enter before Pi's Editor, so legacy Ctrl+J can submit; Shift+Tab incorrectly moves to the previous form field. Ctrl+G is also repurposed for Advanced.
- Reuse the installed keybinding manager (including its read-only legacy-name migration) and CustomEditor; expose any version-dependent module boundary in the dependency diagnostic/tests.

## Acceptance criteria

- [x] Default Ctrl+J/Shift+Enter insert newlines instead of starting a task; native editing and explicit key overrides work.
- [x] Effort and model controls preserve the draft and focus, respecting metadata and configured model scope.
- [x] Selector cancellation stays in the form; Ctrl+C clears before double-press closes; Ctrl+D deletes in nonempty input.
- [x] `C-a t` remains the only launcher shortcut; Advanced remains available without stealing a Pi app shortcut.
- [x] Focused tests and isolated native keyboard checks pass; no real task/model request.

## Approach and progress

- [x] Read canonical launcher/caller/tests, installed Pi keybinding/TUI/terminal docs and editor/keybinding source.
- [x] Reused Pi bindings and editor, implemented form-context model/effort controls, updated tests/docs.
- [x] Verified source/fake-PTY paths and deployed native popup in an isolated test instance.

## Decisions

- **Parity boundary:** text editing and model controls use Pi semantics; the popup is not a Pi conversation and does not load extensions or expose session/clipboard-image/external-editor features.
- **Form navigation:** Tab still traverses fields; Shift+Tab cycles effort. Advanced uses its row, not Ctrl+G.
- **Model cycling:** use Pi's cached available models and SDK scope resolver, never a guessed provider/model list.

## Verification

- `node --test "$HOME"/.config/herdr/plugins/task-launcher/*.test.mjs` — passed: 45 tests against deployed paths. Includes legacy/Kitty newlines, effort/model shortcuts, per-model/scoped effort, clamping parity with installed Pi across capability holes, explicit binding overrides/history precedence, read-only keybinding migration, clear/exit behavior and existing safety tests.
- `PYTHONDONTWRITEBYTECODE=1 python3 "$HOME/.config/herdr/plugins/task-launcher/pty-smoke.py"` — passed: actual popup text input uses Ctrl+J for a multiline draft, Shift+Tab for effort, Ctrl+L/picker cancellation, and Ctrl+C to clear without closing. Fake Pi receives the complete multiline task and selected effort; cancellation creates nothing.
- `PYTHONDONTWRITEBYTECODE=1 python3 /tmp/pi-task-keys.NQOx6h/native-ui-check.py` — passed with installed native Herdr and the deployed plugin: unchanged `C-a t`, real blank-line insertion via Ctrl+J, first Ctrl+C clears, Ctrl+L model selection, inline Shift+Tab effort, forward/backward model cycling, Ctrl+D exit, reopen/Escape cancel. No task/worktree, preference write or agent startup; isolated test instance stopped.
- Minimal-PATH deployed `launch.sh --check` — passed: Pi 0.85.1, shared editor/keybinding factory and SDK/TUI APIs available.
- `stow -n -v -t "$HOME" herdr` — passed, no pending actions. All modified package leaves were already linked; source-link assertions passed. New popups load the changes without a production reload/restart.
- `herdr config check`, `herdr status server`, unchanged `prefix+t` binding assertion, README local links and `git diff --check` — passed.
- Real Pi task startup/provider request and unrelated concurrent clipboard tests — not run; outside this task's scope.

## Risks and recovery

Changes affect newly opened popups immediately. Run isolated checks before claiming parity; no real prompt is submitted during native verification. Keep generated test outputs outside the repository.

## Outcome

New `C-a t` popups use Pi's native text editor/keybinding definitions and configured overrides for the implemented editing/model controls. Ctrl+J and Shift+Tab no longer collide with form actions. Model cycling honors global scope and compatible effort defaults; Advanced is row-only. Changes are live through existing Stow links, with no config regeneration, production restart or model request. Test script/output are outside Git under `/tmp/pi-task-keys.NQOx6h/`; concurrent clipboard work remains separate.
