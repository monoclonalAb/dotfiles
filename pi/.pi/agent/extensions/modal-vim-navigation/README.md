# Pi editor: Vim navigation and clipboard images

This UI-only extension gives Pi's fullscreen transcript a temporary Vim-style
normal mode and compact clipboard-image markers without changing conversation
or model context.

- `Esc` or `Ctrl+[`: enter normal mode (`Esc` again keeps Pi's normal
  interrupt behavior)
- `i` or `a`: return to insert mode
- `/`, `Delete`, or `Backspace`: return to insert mode and pass the key through
  to the editor (`/` starts a slash command; deletion still deletes)
- `j` / `k`: scroll down / up one transcript line
- `Ctrl+D` / `Ctrl+U`: scroll down / up half a page
- `Ctrl+F` / `Ctrl+B`: scroll down / up a page
- `J` / `K`: jump to the next / previous message block in the transcript
  (Pi marks both your prompts and each assistant response as jump targets,
  so alternate presses land on either; this granularity is Pi's built-in
  transcript navigation and cannot be narrowed to user prompts only)
- `↑` / `↓`: unchanged editor behavior — recall older / newer submitted prompts
  into the editor (this session's history), cursor movement otherwise
- `G`: jump to the transcript bottom

The editor border shows `INSERT` or `NORMAL`. The global Pi wrapper starts
interactive sessions in fullscreen mode so the application owns transcript
scrolling; pass `--tui-mode regular` explicitly to opt out.

## Copy cleared drafts

**Ctrl+C** (Pi's `app.clear`) also copies a nonempty draft to the clipboard before
clearing it, including full large pastes and image paths. Pi's clear/exit timing
and undo are unchanged; other deletions do not copy. A failed copy only warns.

## Clipboard images

- **Ctrl+V** pastes a clipboard image (falling back to text). **Cmd+V** in Alacritty
  through Herdr also works: Alacritty sends an empty bracketed paste for image-only
  clipboards, which the editor treats as an image paste. Nonempty text paste never
  reads the clipboard.
- Images appear as editable `[img #N]` markers; undo or delete the marker to drop one.
- On submit the markers expand to Pi's native temporary image paths, which Pi reads
  with its read tool. No image blocks are injected and provider requests are not
  modified; the transcript only abbreviates the paths for display.

The clipboard readers are internal modules of the installed Pi package, loaded via
`getPackageDir()` (checked against Pi 0.87.1); a Pi upgrade may move them. This is
not a remote-SSH clipboard bridge.

## Verification

```sh
bun test ./pi/.pi/agent/extensions/modal-vim-navigation/index.test.ts
```

Uses the installed Pi editor, renderer and clipboard adapter with fake clipboard
reads and writes. Manual check after `/reload`: paste a screenshot with Cmd+V and
Ctrl+V (two markers), confirm text paste still works, and clear without submitting.
