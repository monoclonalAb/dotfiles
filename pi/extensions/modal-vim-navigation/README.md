# Pi editor: Vim editing, transcript navigation and clipboard images

This UI-only extension replaces Pi's prompt editor with one that edits like Vim,
scrolls the fullscreen transcript with the same keys, and shows pasted screenshots
as compact `[img #N]` markers. It changes nothing in the conversation or the model's
context.

## Modes and the cursor

There is no `INSERT` or `NORMAL` label. The terminal's own cursor shows the mode,
the same way zsh-vi-mode does in the shell:

| Cursor | Mode |
| --- | --- |
| Bar | Insert: typing goes into the prompt |
| Block | Normal or visual mode |
| Underline | A key is waiting: a motion after `d` `c` `y` `g~` `gu` `gU`, or a character after `r` |

- `Esc` (or `Ctrl+[`) leaves insert mode and steps back onto the last character,
  as Vim does. In normal mode `Esc` cancels a half-typed command; with nothing
  pending it is Pi's again (stop the agent, or double `Esc` for `/tree`).
- Every new prompt starts in insert mode: after Enter, Alt+Enter (queue) and
  Ctrl+C (clear).
- To get a cursor the terminal can reshape, the extension turns on Pi's hardware
  cursor (the `showHardwareCursor` setting) for the session. The shapes are the
  DECSCUSR sequences `ESC [6 q` (bar), `ESC [2 q` (block) and `ESC [4 q`
  (underline); quitting sends `ESC [0 q`, the terminal's default. The Herdr app,
  Ghostty and Alacritty draw them. A terminal that ignores them shows the same
  cursor in every mode.

## Editing the prompt

Normal mode, with counts (`3w`, `2dd`, `d3w`):

- **Insert:** `i` `a` `I` `A` `o` `O`. `/` still starts a slash command.
- **Move:** `h` `l` `0` `^` `$` `w` `b` `e` `ge` `W` `B` `E` `gE` `f` `F` `t` `T`
  `;` `,` `%` `{` `}`. Backspace and Space move left and right.
- **Operators:** `d` `c` `y`, and `g~` `gu` `gU` for case, with a motion or a text
  object: `iw` `aw` `iW` `aW`, `i"` `i'` `` i` ``, `i(` `ib` `i[` `i{` `iB` `i<`,
  `ip`, and their `a` forms. Doubled, they act on whole lines: `dd` `cc` `yy` `g~~`
  `guu` `gUU`.
- **Shorthands:** `x` (also Delete) `X` `s` `S` `D` `C`, `Y` (to the line end, as
  in Neovim), `r{char}`, `~`.
- **Put, undo, repeat:** `p` `P`; `u` undo, `Ctrl+R` redo; `.` repeats the last
  change. An insert (`cw` and the typing after it, say) undoes as one step; while
  typing, Pi's `Ctrl+-` still undoes word by word.
- **Visual:** `v` (characters) or `V` (lines), then motions or text objects, then
  `d` `x` `c` `s` `y` `p` `~` `u` `U`, or `o` to swap ends. `D` `X` `C` `S` `Y`
  act on whole lines. The selection uses the theme's selection colour.
- `↑` and `↓` keep Pi's behaviour, recalling older and newer prompts. Enter
  submits from either mode.

Not supported: macros, marks, named registers, search within the prompt, `R`,
`>` and `<`, visual block mode, and `J` for joining lines (`J` moves through the
transcript instead). Visual-mode changes are not repeated by `.`.

### The clipboard

As with Neovim's `clipboard=unnamedplus` (set in
[`nvim/lua/options.lua`](../../../nvim/lua/options.lua)), every yank, delete and
change also copies its text to the system clipboard, and `p` and `P` paste from the
system clipboard. Text yanked here pastes back as whole lines or as characters, as
it was yanked; text copied elsewhere pastes as whole lines when it ends with a
newline. If the clipboard cannot be read, `p` uses the last yank. A clipboard image
pastes as an `[img #N]` marker.

## Reading the transcript

In normal mode the transcript sits above the prompt, and the same keys move
through both. For example, with a two-line prompt and the cursor on its second
line:

1. `k` moves to the prompt's first line.
2. `k` again carries on into the transcript and scrolls it up one line. Pi shows
   its `↓ Jump to latest message` label while the transcript is scrolled up.
3. While it is, `j` and `k` scroll the transcript, a line per press.
4. When `j` brings it back to the end, `j` and `k` move through the prompt again.

| Key | Action |
| --- | --- |
| `gg` | The prompt's first line; pressed again (or on a one-line prompt), the top of the transcript |
| `G` | Back to the end of the transcript when it is scrolled up, otherwise the prompt's last line |
| `J` / `K` | Next / previous message (Pi marks both your prompts and its replies) |
| `Ctrl+E` / `Ctrl+Y` | Scroll down / up one line |
| `Ctrl+D` / `Ctrl+U` | Scroll down / up half a page |
| `Ctrl+F` / `Ctrl+B` | Scroll down / up a page |

In insert mode these Ctrl keys keep Pi's editing behaviour, and Ctrl+D in normal
mode never quits Pi. The transcript keys need fullscreen mode, which the global Pi
wrapper ([`bin/pi`](../../../bin/pi)) turns on; with `--tui-mode regular` they warn
once and do nothing.

## Copy cleared drafts

**Ctrl+C** (Pi's `app.clear`) also copies a nonempty draft to the clipboard before
clearing it, including full large pastes and image paths. Pi's clear/exit timing
and undo are unchanged. Deleting while typing (Backspace, Ctrl+W) does not copy;
Vim's deletes do (see [The clipboard](#the-clipboard)). A failed copy only warns.

## `/copy` copies the session path

Pi's own `/copy` copies the last reply. Pi checks its own commands before
extension commands, so no extension can take over the name. This editor therefore
sends an exact `/copy`, submitted with Enter (or Alt+Enter while Pi is idle), as `/copy-session` ([`../copy-session.ts`](../copy-session.ts)),
which copies this session's file path, and the command menu describes `/copy` that
way. `/copy` with anything after it is sent unchanged. If `copy-session.ts` is not
loaded, `/copy` is Pi's again. To copy the last reply, select its text.

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
`getPackageDir()`; a Pi upgrade may move them. This is not a remote-SSH clipboard
bridge.

## Pi internals

Vim editing drives Pi's own editor through members its types mark private: the
text and cursor state, the undo stack, line layout and cursor movement
([`index.ts`](index.ts) lists them in `EditorInternals`). Transcript keys call the
fullscreen renderer's `scrollBy`, `scrollToTop`, `scrollToBottom`, and the private
`scrollToPrompt` and `getPrimaryScrollView`. Checked against Pi 1.6; a Pi upgrade
can move them, which the tests below catch. Motions and text objects are plain
functions over the draft's text in [`draft.ts`](draft.ts).

## Verification

```sh
bun test ./pi/extensions/modal-vim-navigation/index.test.ts
PYTHONDONTWRITEBYTECODE=1 python3 pi/extensions/modal-vim-navigation/pty-smoke.py
```

The first uses the installed Pi editor, renderer and clipboard adapter with a fake
terminal and fake clipboard reads and writes. The second starts fullscreen Pi in its
own pseudo-terminal with an isolated HOME and a clipboard stand-in: it checks the
cursor-shape sequences, a few edits, `gg` `j` `G` in a long transcript, and the
reset on quit. Neither shows how a terminal draws the cursor. After `/reload`,
check by eye that `Esc`, `d` and `i` change the cursor, paste a screenshot with
Cmd+V and Ctrl+V (two markers), and clear without submitting.
