# Architecture

**Status:** Current system map. This document describes ownership and dependency
boundaries; the linked configuration and scripts remain authoritative for exact
values and behaviour.

## System boundary

The repository stores desired workstation configuration and the source needed
to produce a few local artefacts. GNU Stow deploys package files as leaf
symlinks beneath real `$HOME` directories. Applications then read those links
alongside mutable state that remains outside Git.

```text
Brewfile --------------------------> installed tools and applications
tracked <package>/ paths -- Stow --> real $HOME parents + managed leaf symlinks
tracked source + local choice -----> generated state outside the repository
managed configuration ------------> shell, editors, terminals, agents, services
application/runtime writes --------> untracked local state (never back to source)
```

The key boundary is not simply "inside or outside `~/.config`". It is ownership:
a managed symlink is repository-owned desired state; a real file or directory is
normally application-owned state. `gh` is intentionally mixed: its public
`config.yml` is managed while credential-bearing `hosts.yml` is local.

## Repository map

| Area | Paths | Responsibility |
| --- | --- | --- |
| Bootstrap and deployment policy | [`Brewfile`](../Brewfile), [`.stowrc`](../.stowrc), [`.gitignore`](../.gitignore) | Install prerequisites, define link behaviour, and exclude known runtime outputs |
| Shell and editor | [`zsh/`](../zsh/), [`nvim/`](../nvim/) | Interactive environment, language tooling, editor plugins, and theme consumer |
| Terminal and window environment | [`alacritty/`](../alacritty/), [`ghostty/`](../ghostty/), [`aerospace/`](../aerospace/) | Terminal defaults, key handling, and macOS workspace routing |
| Terminal workspaces | [`herdr/`](../herdr/), [`tmux/`](../tmux/) | Primary and fallback multiplexing, navigation, persistence, and attention state |
| User commands and automation | [`bin/`](../bin/) | Cross-application orchestration and audited builds. Machine-local scheduled jobs (LaunchAgents and their scripts) stay in `$HOME`, outside this repository: the repo carries portable per-tool configuration for a new Mac, not single-machine workflows |
| Git clients | [`git/`](../git/), [`gh/`](../gh/) | Global ignore behaviour and non-secret GitHub CLI preferences |
| Agent harnesses | [`omp/`](../omp/), [`pi/`](../pi/), [`.omp/`](../.omp/) | Global OMP configuration and skills, Pi extensions, and this repository's project-scoped tools |
| Human operations | [`README.md`](../README.md) | New-machine setup, live operation, common tasks, and troubleshooting |
| Agent knowledge | [`AGENTS.md`](../AGENTS.md), [`docs/`](./) | Progressive task routing, architecture, principles, quality, and plans |
| Frozen history | [`.archive/`](../.archive/) | Inactive packages retained for explicit restoration only |

All top-level non-hidden directories participate in the documented `stow */`
workflow except `docs/`. [`docs/.stow-local-ignore`](.stow-local-ignore) excludes
all documentation payloads, so the conventional knowledge path does not create
`~/ARCHITECTURE.md` or similar targets.

## Important flows

### 1. Package deployment

1. A package mirrors its destination below `$HOME`; for example,
   `nvim/.config/nvim/init.lua` maps to `~/.config/nvim/init.lua`.
2. [`.stowrc`](../.stowrc) enables `--no-folding`. Stow creates or retains real
   parent directories and links managed leaves rather than replacing a whole
   application directory with one symlink.
3. Ignore rules keep known generated files out of the deployment plan.
4. A structural package change is previewed package-by-package before Stow is
   allowed to update the live target.

This layout lets managed configuration and unmanaged app state coexist. A
content edit to an existing managed file is already live through its symlink; a
new, moved, or deleted package path needs a Stow operation.

### 2. Shared theme orchestration

[`bin/.local/bin/theme`](../bin/.local/bin/theme) is the canonical owner of the
selected Catppuccin flavour and terminal opacity.

```text
vendored Alacritty palettes + tracked Herdr base config
                         + ~/.local/state/theme/{flavour,opacity}
                                      |
                                    theme
            +----------------+--------+--------+----------------+
            v                v                 v                v
  Alacritty overlay  generated Herdr config  tmux option  Neovim RPC reload
            |                |                 |
     live reload       Herdr reload      source-file
```

Generated theme state belongs in `~/.local/state/theme/`. Herdr is the exception
in location but not ownership: because it lacks an include mechanism,
`~/.config/herdr/config.toml` is generated from the tracked
`config.base.toml` plus theme tables. It must remain a real, untracked output;
editing it or making it a repository symlink reverses the ownership boundary.
Writes use temporary files and rename so consumers do not observe partial
configuration. Pushes to live applications are best-effort, while `theme status`
provides the diagnostic path.

### 3. Herdr source and plugin customisation

There are three distinct owners:

- [`herdr/.config/herdr/config.base.toml`](../herdr/.config/herdr/config.base.toml)
  owns stable user configuration.
- [`herdr/.config/herdr/patches/`](../herdr/.config/herdr/patches/) plus
  [`install-herdr-focus`](../bin/.local/bin/install-herdr-focus) own the audited,
  pinned local binary variant. The installer fetches one commit, preflights the
  patch, builds with explicit tool versions, and publishes atomically.
- [`herdr/.config/herdr/plugins/next-agent/`](../herdr/.config/herdr/plugins/next-agent/)
  owns pane-attention behaviour and its focused unit tests.

The installed binary, generated Herdr config, plugin runtime ledger, and server
process are deployment/runtime outputs and do not belong in Git.

### 4. Agent configuration

[`omp/.omp/agent/`](../omp/.omp/agent/) contains cross-repository OMP defaults,
tooling catalogues, agents, and global or scoped skills. Scoped skills are inert
until a project links them. [`pi/.pi/agent/extensions/`](../pi/.pi/agent/extensions/)
contains globally discovered Pi extensions and an explicit policy for any hook
that can alter model-visible context.

The root [`.omp/mcp.json`](../.omp/mcp.json) is project-specific configuration for
this repository, not a global default. Credentials, model caches, databases,
memories, lock files, and session state are local outputs even when their tools'
static configuration is managed here.

### 5. GUI and scheduled execution

Interactive shells initialise rich paths; GUI hotkeys and launchd do not.
Commands reached from Alacritty, AeroSpace, Herdr, or launchd
must assume a minimal macOS environment and set an explicit `PATH` or use audited
absolute executable paths. A command that works only after `.zshrc` is sourced is
not valid for this boundary.

## Dependency rules

1. **One canonical writer per choice.** Consumers may import generated theme
   output; they must not separately pin the same flavour or opacity.
2. **Static configuration may produce runtime state, never the reverse.** Do not
   copy generated files back into a package as an update mechanism.
3. **Cross-package scripts own and document their fan-out.** Individual consumer
   configs should stay passive when a coordinator already owns the choice.
4. **Secrets terminate at local boundaries.** Managed files may name environment
   variables or public endpoints, but not contain credential values.
5. **Archived configuration has no active dependants.** Restore it explicitly
   before relying on it.
6. **External source modifications are reproducible.** Pin identity, retain the
   patch or source, verify before applying, and keep a build-only path where
   practical.
7. **Host-specific behaviour needs a diagnostic.** Prefer status, dry-run, config
   check, or focused test output over silent assumptions about a running app.

## Where to add new work

- New managed home configuration: a purpose-named Stow package or the existing
  owning package.
- New mutable state: an application-owned directory or `~/.local/state/<tool>`.
- New cross-application command: `bin/.local/bin/`, with minimal-`PATH` handling
  if reachable outside a shell.
- New global OMP capability: `omp/.omp/agent/`; keep repository-specific skills
  scoped and explicitly linked.
- New Pi extension: `pi/.pi/agent/extensions/`, after applying that directory's
  context-neutrality policy.
- New repository-wide decision or long-running migration: this knowledge base
  and, when warranted, an active execution plan.
