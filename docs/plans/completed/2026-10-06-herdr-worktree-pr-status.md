# Show pull-request number, title and state on worktree Spaces

**Status:** Complete
**Scope:** Herdr pinned patch (client Spaces tree), new `herdr/plugins/pr-status/`
plugin, bootstrap plugin list, owning docs. Isolated source/build:
`/tmp/herdr-pr-status.2kQE44/`.

## Objective

In the Spaces tree, a linked worktree whose branch has a GitHub pull request is
named `#<number> <title>` and leads with a glyph showing the PR state (open,
draft, merged, closed). Spaces without a PR keep today's name.

## Non-goals

- No change to the persistent Space label (no `workspace.rename`), branch, or
  worktree; no GitHub writes.
- Main checkouts and non-git Spaces are not queried.
- No review-decision/CI status (possible follow-up).
- No install, server restart, plugin link or `dotfiles-link apply` without the
  user's go-ahead.

## Context and constraints

- Workspace metadata tokens (`workspace.report_metadata`) reach the client in
  `ClientShellWorkspace.tokens`; the patched tree already honours the reserved
  `sidebar_hidden` token. Tokens are in-memory, so a startup hook must reapply.
- Herdr has no periodic plugin hook; startup hooks are one-shot. Refresh is
  event-driven (startup, Space/worktree creation, pane focus, agent status).
- Client-local navigation emits `pane.focused`, not always `workspace.focused`.
- `gh pr view` (no argument) in a checkout resolves the branch's PR the way gh
  does (fork-aware head, prefers OPEN, ignores merged/closed PRs whose head is
  the default branch). Exit 1 with `no pull requests found` means none.
- Herdr only records worktree membership for checkouts it opens or creates
  (`worktree.open` / `worktree.create`), not for a plain `workspace create --cwd`.
- Alacritty uses JetBrainsMono Nerd Font; Octicons U+F407/F4DD/F419/F4DC are
  present (checked in the installed font's cmap).

## Acceptance criteria

- [x] Tree Space rows with `pr_number` show `#N title`; `pr_state` adds a
      palette-coloured glyph; unknown state shows no glyph; no tokens: unchanged.
- [x] Long titles truncate without hiding the glyph or the conversation counts.
- [x] Plugin reports/clears tokens only for linked worktrees, throttles `gh`
      calls, keeps last result on gh/network errors, reapplies cache at startup.
- [x] Patch applies to pinned upstream, builds, and the installer's test set passes.

## Approach

1. Client: reserved `pr_number` / `pr_title` / `pr_state` tokens in `tree.rs`.
2. Plugin `martinro.pr-status` (Python, like spaces-env) with unit tests.
3. Regenerate the patch; build-only; docs and bootstrap list.

## Progress

- [x] Client change and two tree tests (`src/client/shell/tree.rs`, `tests/tree.rs`).
- [x] Plugin, unit tests and native PTY check.
- [x] Patch regenerated (`git diff` of upstream → working tree, reproduces the old
      patch byte-for-byte before the change); build ID `7df3894bdb02`.
- [x] Docs: README Herdr section and troubleshooting, ARCHITECTURE owners and
      routing, VERIFICATION row, bootstrap plugin list, installer comment.

## Decisions

- **Display-only tokens, not a rename:** a rename would overwrite the task
  launcher's Space name and need undoing when the PR goes away.
- **Client owns glyphs/colours:** follows the flavour without theme changes,
  like the conversation glyphs; the plugin reports a state word.
- **PR name wins over a custom Space name:** the request was for the PR name to
  become the title; the custom name returns when the PR tokens clear.
- **Title kept verbatim** (including `feat:` prefixes) to match "number + PR name".
- **Inherited PATH first, Homebrew paths appended:** the server's own `gh` wins;
  the fallback covers minimal GUI/launchd environments.
- **TTLs:** event Space 30 s, others 5 min, merged/closed others 30 min. At ~11
  worktrees this is a few hundred GraphQL calls an hour at most while active.

## Verification

- `cargo test --offline --locked --release --bin herdr -- client::shell::tests::tree`
  in the isolated source — **passed**, 25 tests (2 new). Mutations (no glyph, no
  label, glyph width not reserved) each made the new tests fail; sources restored.
- `bin/install-herdr-focus --build-only /tmp/herdr-pr-status.2kQE44/herdr-pr-status`
  — **passed**: fresh fetch of the pinned commit, patch applied, built
  `0.9.1-dotfiles.7df3894bdb02`; installer test selection 347 passed, 0 failed.
  Installed binary untouched.
- `PYTHONDONTWRITEBYTECODE=1 python3.14 -m unittest discover -s herdr/plugins/pr-status -p 'test_*.py'`
  — **passed**, 14 tests, including an end-to-end run with a real Git worktree,
  fake `gh` and fake Herdr socket. Five mutations each failed the suite.
- `HERDR_TEST_BIN=<build> python3.14 herdr/plugins/pr-status/pty-smoke.py` —
  **passed**: isolated server/client, plugin linked there, draft/open/merged/closed
  glyphs rendered before `#12 <title>`, focus event rechecked and restored the
  branch name. Against the installed (old) client it fails at "draft row not
  rendered" while tokens are reported, as expected.
- Read-only real lookups with `env -i HOME=… PATH=/usr/bin:/bin`: `gh` found via
  the fallback; open/draft/merged/closed/none mapped correctly for real worktrees.
- `bin/dotfiles-link check` — only the four new plugin files to create.
- `git diff --check`, `sh -n bin/install-herdr-focus bin/dotfiles-bootstrap` — passed.
- Activation (user approved): `install-herdr-focus` — **passed**, 347 tests,
  installed `0.9.1-dotfiles.7df3894bdb02`; `dotfiles-link apply` created only the
  four plugin links; `herdr plugin link … --enabled` succeeded; the refresh action
  reported 8 PRs (open/draft) and 2 none across the 10 live linked worktrees, and
  `workspace list` shows the matching `pr_*` tokens. Event hooks ran without errors.
- **Not observed:** the user's own client after reattaching (old client still attached).

## Risks and recovery

- A stock or older patched client ignores the tokens: names stay unchanged.
- Disable with `herdr plugin disable martinro.pr-status`; tokens vanish at the
  next server start (or clear via `workspace.report_metadata` with null values).
- `gh` failures keep the last result, so a PR closed while offline shows its old
  state until the next successful lookup.

## Outcome

Built, installed, linked and enabled on this Mac; the live server holds PR tokens
for every linked worktree with a PR. The sidebar shows them once the user
reattaches with the new client (detach `C-a C-d`, then `herdr`). No server
restart was needed or done.
