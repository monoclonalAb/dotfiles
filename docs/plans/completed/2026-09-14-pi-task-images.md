# Paste images into the Pi Tasks form

**Status:** Complete
**Scope:** Herdr task-launcher plugin and its operating documentation

## Objective

`C-a t` accepts clipboard images in the task input and delivers real image
attachments with the initial Pi prompt.

## Non-goals

- No Herdr binary/keymap changes, Pi extension changes, remote clipboard transport,
  real provider requests, application restarts or unrelated worktree cleanup.

## Context and constraints

- The launcher and docs have substantial pre-existing edits; preserve them.
- Existing plugin files are live Stow links. Each popup loads fresh source.
- Pi CustomEditor exposes `onPasteImage`; installed clipboard utilities provide
  image/text reads. Native CLI `@file` inputs become image content.
- Clipboard payloads must stay out of Git, argv and the automatic naming request.

## Acceptance criteria

- [x] Ctrl+V and Alacritty's empty Cmd+V paste show image markers in the input.
- [x] Normal text paste, undo/removal, clear/cancel, remaps and async Enter ordering work.
- [x] Private bounded handoff retains images on failure; runner passes native image
  file arguments, cleans temporary files, and keeps literal prompt handling.
- [x] Text-only models reject attached images before naming/allocation.
- [x] Installed-editor/CLI tests and own-PTY smoke pass; docs describe actual scope.

## Approach

1. Read installed editor/clipboard/CLI contracts and existing tests.
2. Add in-memory attachment markers and native clipboard adapter.
3. Validate/persist attachments with the request; materialize private files only
   while the Pi runner is alive.
4. Test synthetic clipboard input through installed editor and CLI processing,
   including failures and cleanup; update operator docs.

## Progress

- [x] Located source owner, consumers and current tests; read task-relevant Pi docs.
- [x] Implemented clipboard adapter, inline markers, bounded image handoff and
  runner-owned native CLI image files; updated plugin/root README and runbook.
- [x] Verified synthetic clipboard paths and existing terminal workflow; all five
  changed production source files already resolve through live Stow links.

## Decisions

- Use Pi's existing clipboard readers and CLI image handling, not a new extension
  or shell-interpolated task command.
- Keep description text required; automatic naming sees only that text, not images.
- Keep draft bytes in memory until Start; use the mode-600 request for retry data.

## Verification

From `/Users/eric/dotfiles`:

- `node --test herdr/.config/herdr/plugins/task-launcher/*.test.mjs` — **passed**,
  68 tests with installed Pi 0.85.1. Includes synthetic clipboard → installed
  editor → private request → runner → native CLI image decoding, no real clipboard.
- `PYTHONDONTWRITEBYTECODE=1 python3 herdr/.config/herdr/plugins/task-launcher/pty-smoke.py`
  — **passed**, existing text/shortcut/cancel/start journey in an owned PTY with
  fake Herdr/Pi and loopback naming; not real GUI image-paste evidence.
- `env -i HOME="$HOME" PATH=/usr/bin:/bin /bin/sh herdr/.config/herdr/plugins/task-launcher/launch.sh --check`
  — **passed**, installed clipboard/library APIs resolve under minimal PATH.
- Python `Path.is_symlink()` / `resolve()` assertions for `main.mjs`,
  `pi-runtime.mjs`, `runner.mjs`, `task.mjs`, `ui.mjs` — **passed**, existing live
  links point to this checkout; no Stow/deployment operation needed or run.
- `git diff --check` and diff/status inspection — **passed**, unrelated changes
  preserved; package layout unchanged.
- Real clipboard/GUI, remote clipboard transport and real-provider task startup
  — **not run**. No existing panes received input; no application restarted.

## Risks and recovery

- Clipboard utilities are a version-sensitive installed Pi boundary.
- Interrupted runners may leave private temporary images alongside retained
  requests; document manual recovery. No worktree/branch cleanup is automatic.

## Outcome

Complete. Reopen `C-a t`, keep task input focused, then Ctrl+V (or Alacritty
Cmd+V). Markers select real attachments; a text description and image-capable
model remain required. Operator behavior and recovery are documented in
[Pi Tasks](../../../herdr/.config/herdr/plugins/task-launcher/README.md#clipboard-images).
Real Mac clipboard/GUI acceptance remains an explicit manual check.
