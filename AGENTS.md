# Repository guide

This is a personal macOS dotfiles repository managed with GNU Stow. Treat the
repository as desired state and the linked files under `$HOME` as its deployed
view.

## Start here

1. Run `git status --short` and preserve every unrelated change already present.
2. Read [`docs/README.md`](docs/README.md), then follow only the links relevant
   to the task.
3. Read the affected source and its consumer before editing. For setup or
   operator behaviour, consult the relevant section of [`README.md`](README.md).
4. For multi-package, migration, or safety-sensitive work, use the execution-plan
   convention in [`docs/plans/README.md`](docs/plans/README.md).

## Knowledge map

| Need | Source of truth |
| --- | --- |
| Repository boundaries and data flows | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Engineering invariants and agent guidance | [`docs/ENGINEERING_PRINCIPLES.md`](docs/ENGINEERING_PRINCIPLES.md) |
| New-Mac setup, commands, and troubleshooting | [`README.md`](README.md) |
| Pi extension constraints | [`pi/.pi/agent/extensions/README.md`](pi/.pi/agent/extensions/README.md) |
| OMP tools and alternatives | [`omp/.omp/agent/TOOLING.md`](omp/.omp/agent/TOOLING.md) |

## Non-negotiable boundaries

- Edit package sources in this repository, never their `$HOME` symlink targets.
- Every top-level non-hidden directory is a Stow package except `docs/`, whose
  `.stow-local-ignore` deliberately excludes the knowledge base.
- Keep mutable state and generated output outside the repository. In particular,
  `~/.local/state/theme/` and generated `~/.config/herdr/config.toml` are outputs,
  not source files.
- Never commit credentials, tokens, histories, caches, generated lock state, or
  app-owned runtime data. Do not broaden an ignore rule before identifying the
  unexpected file.
- Do not modify `.archive/` unless the user explicitly asks to restore or retire
  archived configuration.
- GUI, hotkey, and launchd processes have a minimal `PATH`; scripts used there
  must establish the paths they require.
- Do not overwrite, revert, reformat, or stow unrelated worktree changes.

## Change workflow

1. Locate the canonical owner of the behaviour; avoid duplicate configuration.
2. Make the smallest coherent change at that owner.
3. For files created, moved, or removed inside a Stow package, run a package-only
   dry run: `stow -n -v -t "$HOME" <package>`. Apply it only after reviewing the
   plan and when updating this machine is part of the task.
4. Exercise the changed path, not just its parser. Use the focused check first,
   then the broader native check when practical.
5. Inspect `git diff --check` and `git status --short` before reporting.
6. Update documentation only for durable behaviour, decisions, or verification
   gaps. Prefer links to canonical code over copied implementation detail.

## Verification routing

| Area | Minimum useful evidence |
| --- | --- |
| Stow layout | package-only `stow -n -v -t "$HOME" <package>` |
| Shell | `zsh -ic 'exit'` plus the affected command |
| Theme | `theme status` plus the affected live consumer |
| Herdr | `herdr config check`; focused plugin tests when changed |
| tmux | `tmux source-file ~/.config/tmux/tmux.conf` |
| Neovim | headless/focused check, then `nvim +checkhealth` when appropriate |
| Pi TypeScript | focused `bun test` or a fresh Pi session, depending on the path |
| Documentation | resolve local links and confirm `stow -n -v -t "$HOME" docs` is empty |

Never claim a check passed unless it was run. Record environment-blocked checks
as gaps rather than silently weakening the acceptance criteria.
