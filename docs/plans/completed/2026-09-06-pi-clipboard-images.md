# Visible Pi clipboard images through Alacritty and Herdr

**Status:** Complete
**Scope:** Pi's existing custom editor and its tests/docs; no terminal remapping or Herdr configuration changes.

## Objective

Cmd+V and Ctrl+V paste clipboard images into Pi with compact `[img #N]` draft markers instead of long temporary filenames. Preserve ordinary text paste and Pi's native model-visible file references.

## Non-goals

- No provider/input hooks, automatic image-message injection, or OMP dependency.
- No terminal hotkey changes, application restarts, clipboard inspection during tests, or input to other agent panes.

## Context and constraints

- User runs Pi through local Herdr in Alacritty.
- Installed Alacritty 0.17.0 (94e7c88) sends empty bracketed paste for image-only clipboard text. Reviewed source emits both delimiters even for empty text; local Herdr 0.8.2 forwards this. Installed OMP 18.1.5 handles empty paste as image paste, while Pi 0.85.1 ignores it.
- Existing `modal-vim-navigation/index.ts` is the sole Pi editor owner. Preserve the concurrent task-launcher changes and their documentation.
- Reuse Pi's clipboard helpers lazily via public `getPackageDir()` and an explicitly tested internal-module adapter. Like native Pi, clipboard files live in the OS temporary directory, never the repository; use private file permissions.

## Acceptance criteria

- [x] Both paste paths produce visible markers without modifying other programs' shortcuts.
- [x] Normal/large text paste, submission, copy/external-editor expansion, history, undo and editor recreation preserve native content.
- [x] Async clipboard work preserves input order and cannot update a disposed editor.
- [x] Source tests and isolated rendered integration pass; any real clipboard/GUI boundary is reported untested.

## Approach and progress

- [x] Trace terminal → multiplexer → Pi editor and compare OMP behavior.
- [x] Implement empty-paste routing, clipboard-reader adapter, UI marker expansion, ordered input and disposal.
- [x] Add regressions, inspect integration behavior and update owning docs.

## Decisions

- **No Cmd+V remap:** the terminal already sends enough information; globally mapping it to Ctrl+V would break programs such as Neovim.
- **Context neutral:** markers expand to Pi's existing temporary file paths. The read tool still loads images when needed; no new model-visible instructions or message content types.

## Verification

All checks ran from `/Users/eric/dotfiles` against installed Pi 0.85.1.

- `bun test ./pi/.pi/agent/extensions/modal-vim-navigation/index.test.ts` — **passed**, 19 tests / 83 assertions, including native renderer widths, StdinBuffer framing, native follow-up routing, clipboard adapter with spies, private temporary fixture files, literal text fallback and lifecycle disposal.
- `tsc -p <temporary-tsconfig>` — **passed**, strict/noEmit source check with aliases to installed Pi declarations; temporary config removed.
- `node --input-type=module` isolated RPC harness — **passed** bundled CLI loading the production extension and responding to `get_state`. Isolated HOME/agent directory, offline, no auto-discovered extensions/context/skills, no prompt or provider request.
- `python3` own-PTY harness — **passed** bundled Pi fullscreen rendering of Ctrl+V and Alacritty-style empty bracketed paste as `[img #1]` / `[img #2]`, followed by ordinary text paste. Injected reader used synthetic PNGs; confirmed two mode-0600 files, then removed the isolated fixture tree. No submitted prompt, real clipboard read or other-pane input.
- `stow -n -v -t "$HOME" docs` — **passed**, no link/unlink actions. Package source paths are unchanged; the existing deployed editor symlink resolves to the edited source, so no Stow deployment is required.
- `git diff --check` — **passed**. Unrelated task-launcher changes remain intact.
- Real macOS clipboard through a live Alacritty/Herdr window — **not run**. User should `/reload`, paste a screenshot with each shortcut and clear the draft; [operator instructions](../../../pi/.pi/agent/extensions/modal-vim-navigation/README.md#clipboard-images).

## Risks and recovery

Pi's internal clipboard helper paths may change after an upgrade; report failures in the UI and verify against the installed package. File references have Pi's native temporary-file lifetime. Disabling/reverting the editor change restores native Pi handling. No generated clipboard data or credentials enter Git.

## Outcome

Implemented and verified the UI and native file-reference path without terminal remapping or model-context hooks. Draft/transcript markers are editable text, not OMP's atomic attachment widgets; image files retain Pi's native temporary-file lifetime. Existing conversations need `/reload`; no application restart, clipboard mutation, model request, deployment command, commit or push was performed.
