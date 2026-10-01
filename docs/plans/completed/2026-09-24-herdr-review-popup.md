# Comment on agent changes from Herdr and send them back

**Status:** Complete — deployed 2026-09-24; the first manual `C-a v` round trip is the user's
**Scope:** `bin` (new script and tests), Herdr base keybinding, Brewfile, owning docs.

## Objective

`C-a v` in an agent's pane opens a popup diff review of that agent's working tree.
Line/range comments saved with `:wq`/`ZZ` arrive in that agent as one prompt.

## Non-goals

- A Herdr plugin, patched binary, Neovim integration or agent-side skill.
- Sending input to a real agent pane as verification.
- Unrelated pending work in the same packages (for example the unlinked
  `herdr/.config/herdr/plugins/next-agent/pty-smoke.py`).

## Context and constraints

- Herdr 0.9.1 `src/app/custom_commands.rs`: popup commands run via `/bin/sh -c`
  in the focused pane's cwd, with `HERDR_ACTIVE_PANE_ID`/`HERDR_ACTIVE_TAB_ID`,
  `HERDR_SOCKET_PATH` and `HERDR_BIN_PATH`, but without the pane's own identity.
- `herdr agent prompt <pane> <text>` bracketed-pastes then sends Enter; it refuses
  a blocked agent. Pi's Vim editor passes multi-character pastes through in both modes.
- tuicr 0.27.0 `--stdout`: TUI on `/dev/tty`, export on stdout only after
  `:wq`/`ZZ` with comments; `tuicr-session:` on stderr. Comments persist across
  runs, so sent comments must be cleared (`tuicr review clearc`) or they repeat.

## Acceptance criteria

- [x] Focused agent, or the only agent in the focused tab, is the target; ambiguity opens nothing.
- [x] Saved comments are sent once and then cleared; cancel/no comments send nothing.
- [x] Failures stay visible in the popup; refused prompts keep comments and copy them.
- [x] Minimal PATH pinned; base config validates; docs describe use and checks.
- [x] tuicr installed, script linked, config regenerated and reloaded.
- [ ] Manual `C-a v` round trip in a disposable task (not observed by the agent).

## Progress

- [x] Script [`herdr-review`](../../../bin/herdr-review), tests, keybinding, Brewfile, README/architecture/verification rows.
- [x] Deployment, approved by the user ("MAKE IT LIVE").

## Decisions

- **tuicr over hunk/custom Neovim:** vim keys, line/range comments and a pipeable
  export already exist; hunk's agent loop is skill-driven rather than push.
- **Python script, not a plugin:** matches `terminal-open`; popup env provides the target.
- **Clear after a successful send only:** unsent comments must survive failures.
- **Adopt live toast delivery into the base:** the deployed `config.toml` had
  `[ui.toast] delivery = "system"` (Herdr's settings UI writes that key directly;
  `src/config/write.rs`), while the base said `"herdr"`. Regenerating would have
  silently reverted it, so the base now records `"system"`, keeping live behaviour.

## Verification

From `/Users/eric/dotfiles`, 2026-09-24, before deployment:

- `PYTHONDONTWRITEBYTECODE=1 HERDR_REVIEW_TUICR_TEST_BIN=/tmp/tuicr-eval/tuicr /usr/bin/python3 -m unittest discover -s bin/.local/lib/herdr-review -p 'test_*.py'`
  — **passed**, 14 tests (Python 3.9.6), including real tuicr 0.27.0 (release
  tarball, SHA-256 matched GitHub's digest) in an own PTY. Also passed under
  Python 3.14 without the real binary (1 skipped). A mutation that broke the
  clear step failed both the fake and real-PTY cases.
- `HERDR_CONFIG_PATH=<base or base+current theme tables> herdr config check` —
  **passed**; a deliberately invalid key variant **failed** as expected.
- Live read-only `herdr-review --check` under `env -i` minimal PATH — **passed**:
  resolved an agent pane directly, a shell pane to its tab's only agent, and
  reported ambiguous and agent-less tabs; missing tuicr reported with install hint.
- `stow -n -v -t "$HOME" herdr` — only unrelated `pty-smoke.py` pending; the base
  config was already linked, so `herdr` was not stowed.

Deployment, same day:

- `brew install tuicr` — **passed**; `/opt/homebrew/bin/tuicr` 0.27.0 (Homebrew
  also ran its routine cleanup of old logs).
- `stow -n -v -t "$HOME" bin` re-run (only this task's three entries), then
  `stow -v -t "$HOME" bin` — **applied**; a repeat dry run plans nothing.
- Pre-apply comparison of the deployed config's base section with the tracked
  base — only the new binding and comments differed after adopting the toast value.
- `theme apply` — **passed**: Herdr written and server reloaded (server log shows
  `server.reload_config` ok); Alacritty overlay rewritten with the unchanged
  mocha/1.0 state; no tmux server or Neovim instances. The before/after diff of
  `~/.config/herdr/config.toml` is exactly the new block and comments.
- `herdr config check` (deployed) — **passed**. Minimal-PATH
  `~/.local/bin/herdr-review --check` — **passed**, resolving the installed tuicr
  with `--theme catppuccin-mocha`.
- The suite above re-run with installed tuicr (real-PTY case not skipped) —
  **passed**, 14 tests.
- Actual `C-a v` press, popup rendering and Pi receiving a prompt — **not run**:
  it needs keyboard input to the live client and an agent pane.

## Risks and recovery

- A prompt sent while Pi is working is queued into that run, and any unsent draft
  in Pi's editor is submitted with it; review when the agent is idle.
- Roll back by removing the `prefix+v` block and running `theme apply`;
  `brew uninstall tuicr` removes the tool and leaves its app state.

## Outcome

`C-a v` is bound in the running Herdr server and `herdr-review` is linked with
tuicr installed. Remaining gap: the first real popup/prompt round trip.
