# Click Pi file links into Neovim

**Status:** Complete
**Scope:** Pi display-only extension, Alacritty hints, bin opener, owning docs.

## Objective

Open local Markdown file links in Pi with a deliberate mouse gesture into a
separate Neovim terminal, without interrupting Pi or changing model context.

## Non-goals

- Global macOS file associations, Ghostty support, Herdr changes, or pane input.
- Changes to existing concurrent launcher, editor, and documentation work.

## Context and constraints

- Screenshot shows relative Markdown links; current Alacritty/Pi environment
  falls back to visible URL text (OSC 8 auto-detection is off).
- Pi's documented `registerMarkdownTransformer` is display-only and supports
  finalized/restored assistant messages. Relative targets need `ctx.cwd`.
- Alacritty hints accept both visible URLs and OSC 8 links. A single dispatcher
  must handle both because OSC 8 matching does not filter by regex.
- New managed paths need package-specific reviewed Stow previews. Existing
  Alacritty config is live-linked; deploy the opener before changing hints.

## Acceptance criteria

- [x] Local inline Markdown destinations become absolute file URLs for the session cwd.
- [x] Web destinations, code examples, user input, and model/session messages stay unchanged.
- [x] Cmd-click (Shift as needed for mouse-reporting apps) and Ctrl+Shift+O are configured and argv-tested for file/URL dispatch; actual GUI gesture remains manual.
- [x] Opener handles escaped paths and line references without shell interpolation;
  rejects remote files, malformed URLs, missing files, and unsupported protocols.
- [x] Tests, docs, and reviewed deployment evidence recorded; actual click explicitly distinguished.

## Approach

1. Add and test the display transformer and argv-based opener.
2. Preview/link only new paths for the affected packages; configure Alacritty hints.
3. Run focused checks and inspect diffs; leave Pi reload/click verification to user.

## Progress

- [x] Read source owners, Pi extension/TUI APIs, Alacritty manual and nearest tests.
- [x] Implemented display transformer and macOS opener, with focused suites.
- [x] Updated root README, extension policy/README, architecture route and verification runbook.
- [x] Reviewed bin/pi previews (only this task's new files), linked bin before
  changing live Alacritty hints, then linked pi. No restarts or agent input.

## Decisions

- **Separate Neovim window:** no keystrokes sent into Pi, no native Herdr changes.
- **No forced OSC 8:** support the visible file URL fallback rather than guessing
  multiplexer support or changing all hyperlink capability settings.
- **Conservative Markdown scope:** inline Markdown links in finalized assistant
  prose; do not introduce a package install or patch Pi internals.

## Verification

All commands ran from `/Users/eric/dotfiles`:

- `bun test ./pi/.pi/agent/extensions/local-file-links/index.test.ts` — **passed**, 38 tests;
  installed Pi Markdown renderer with OSC 8 both on/off, fake extension lifecycle.
  Initial fence-preservation failures were fixed and the suite rerun successfully.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s bin/.local/lib/terminal-links -p 'test_*.py'`
  — **passed**, 12 tests, including real Neovim with `-u NONE`, literal unusual
  filenames and line/column positioning. Initial test expected `/var` rather than
  Neovim's canonical `/private/var`; changed to verify file identity and reran.
- Node inline smoke using the installed Pi dependency `createJiti`, `fsCache:false`,
  importing only the new extension and invoking its fake lifecycle/transform API
  — **passed**, no fresh Pi session, model request, or global hooks.
- `stow -n -v -t "$HOME" bin`, `pi`, and `alacritty` (separate commands) — **passed**;
  only task-owned new bin/pi files were proposed. `stow -v -t "$HOME" bin` and
  `stow -v -t "$HOME" pi` — **applied** those links; Alacritty was already linked.
- `env -i HOME="$HOME" PATH=/usr/bin:/bin "$HOME/.local/bin/terminal-open" --check "file://$HOME/dotfiles/README.md#L10"`
  — **passed**, proposed a new Alacritty window with absolute Homebrew Neovim argv;
  no GUI launched.
- New extension README local ownership links — **passed**, targets exist.
- `git diff --check` — **passed**; final diff/status reviewed, unrelated work retained.
- Alacritty native reload-log inspection — **blocked**: inherited `ALACRITTY_LOG`
  points to a nonexistent file. TOML/regex/hint command covered by source tests;
  no claim that the live terminal reload was observed.
- Pi `/reload`, GUI click, browser opening and full user Neovim startup — **not run**.
  User must reload their idle conversation and verify these interactively.

## Risks and recovery

- Unsupported Markdown forms stay unchanged; visible file URLs may be long when
  OSC 8 is unavailable. Remote/SSH files cannot be opened locally.
- Remove the custom hints rule to restore Alacritty's default opener; unlink the
  new Pi extension and reload Pi to stop display transformations.

## Outcome

Implemented and linked the new bin/pi sources; changed the already-linked
Alacritty hints. No Neovim configuration changes or Herdr restart are needed.
User action: `/reload`, then Cmd+Shift-click the visible `file://` URL inside Herdr
(or Cmd-click in plain Alacritty). GUI verification is the remaining boundary;
see the [operating guide](../../../pi/extensions/local-file-links/README.md).
