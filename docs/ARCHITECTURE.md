# Architecture

**Status:** Current system map. This document describes ownership and dependency
boundaries; the linked configuration and scripts remain authoritative for exact
values and behaviour.

## System boundary

The repository stores desired workstation configuration and the source needed
to produce a few local artefacts. [`bin/dotfiles-link`](../bin/dotfiles-link)
deploys each flat tool folder, as listed in [`links`](../links), as leaf symlinks
beneath real `$HOME` directories. Applications then read those links alongside
mutable state that remains outside Git.

```text
Brewfile --------------------------> installed tools and applications
tracked <tool>/ -- dotfiles-link --> real $HOME parents + managed leaf symlinks
tracked source + local choice -----> generated state outside the repository
managed configuration ------------> shell, editors, terminals, agents, services
application/runtime writes --------> untracked local state (never back to source)
```

The key boundary is not simply "inside or outside `~/.config`". It is ownership:
a file symlink resolving into this checkout is repository-owned desired state;
real parent directories can hold both managed leaves and application-owned
state. `gh` demonstrates this: its public `config.yml` is managed while
credential-bearing `hosts.yml` is local.

## Repository map

| Area | Paths | Responsibility |
| --- | --- | --- |
| Bootstrap and deployment policy | [`Brewfile`](../Brewfile), [`links`](../links), [`bin/dotfiles-link`](../bin/dotfiles-link), [`.gitignore`](../.gitignore) | Install prerequisites, define where each folder links and how, and exclude known runtime outputs |
| Shell and editor | [`zsh/`](../zsh/), [`nvim/`](../nvim/) | Interactive environment, language tooling, editor plugins, and theme consumer |
| Terminal and window environment | [`alacritty/`](../alacritty/), [`ghostty/`](../ghostty/), [`aerospace/`](../aerospace/) | Terminal defaults, key handling, and macOS workspace routing |
| Terminal workspaces | [`herdr/`](../herdr/), [`tmux/`](../tmux/) | Primary and fallback multiplexing, navigation, persistence, and attention state |
| User commands and automation | [`bin/`](../bin/), [`lib/`](../lib/) (helpers and tests, linked to `~/.local/lib/`) | Cross-application orchestration and audited builds. Machine-local scheduled jobs (LaunchAgents and their scripts) stay in `$HOME`, outside this repository: the repo carries portable per-tool configuration for a new Mac, not single-machine workflows |
| Git clients | [`git/`](../git/), [`gh/`](../gh/), [`tuicr/`](../tuicr/), [`worktrunk/`](../worktrunk/) | Global identity and ignore behaviour, non-secret GitHub CLI preferences, tuicr review-view defaults, and Worktrunk's worktree layout and `.worktreeinclude` copy |
| Agent harnesses | [`omp/`](../omp/), [`pi/`](../pi/), [`.omp/`](../.omp/) | Global OMP configuration and skills, Pi extensions, and this repository's project-scoped tools |
| Human operations | [`README.md`](../README.md), [`SETUP.md`](SETUP.md), [`HERDR.md`](HERDR.md), [`THEME.md`](THEME.md), [`AGENT-TOOLS.md`](AGENT-TOOLS.md) | Short entry point, then new-machine setup, live operation, and troubleshooting per topic |
| Agent knowledge | [`AGENTS.md`](../AGENTS.md), [`docs/`](./) | Progressive task routing, architecture, principles, quality, and plans |
| Frozen history | [`.archive/`](../.archive/) | Inactive tool folders in the same flat layout, each belonging in `~/.config/<tool>/`; retained for explicit restoration only |

Every top-level non-hidden directory except `docs/` is deployed by a `links`
line. `docs/`, root files and hidden folders are never linked, and
`dotfiles-link check` reports any tracked file in another top-level folder that
no line deploys.

## Task-to-owner routing

Paths below are relative to the repository root. Follow a producer through its
consumer; do not fix generated output or add a second writer.

| Requested change | Start at source | Follow through / focused evidence |
| --- | --- | --- |
| Install or update the workstation | `Brewfile`, `links`, `bin/dotfiles-link`, `bin/dotfiles-bootstrap`, `bin/dotfiles-update` | Root README and `docs/SETUP.md` → `dotfiles-link check` preview; `dotfiles-bootstrap --check` for missing prerequisites; installs and updates have live side effects |
| Theme, colour, opacity | `bin/theme` | Alacritty imports, Herdr base, tmux source, Neovim `lua/theme.lua` → generated output → live consumer; Pi `theme-sync` polls the flavour |
| Herdr attention glyphs or jumps | `herdr/plugins/next-agent/next_agent.py` | Lifecycle integration → attention ledger → theme metadata rows and pinned patch; ledger tests alone do not prove lifecycle delivery |
| Personal/Work Space filtering | `herdr/plugins/spaces-env/spaces_env.py` | Runtime assignment state → sidebar/agent-view metadata; `test_spaces_env.py` |
| Worktree pull-request names and state icons | `herdr/plugins/pr-status/pr_status.py` | Herdr events → `gh pr view` per linked worktree → `pr_*` Space tokens → pinned patch's Spaces tree; `test_pr_status.py`, then `pty-smoke.py` with the build |
| Herdr rendering or binary behaviour | `herdr/patches/` | `bin/install-herdr-focus` → built binary → next client attach / server start |
| Start a Pi task from Herdr | `herdr/plugins/task-launcher/README.md` | `prefix+t` → plugin popup → Herdr worktree API → Pi tab; Node suite and PTY smoke test |
| Review an agent's changes | `bin/herdr-review` | `prefix+v` / `prefix+V` (`--branch`) popups → tuicr in the agent's cwd → `herdr agent prompt`; unittest suite, then `--check` |
| Open a worktree as a Tern session | `tw` in `zsh/zshrc`, `worktrunk/config.toml` | `wt switch --create` → pre-start `.worktreeinclude` copy → `tern new session` → `omp` typed into its shell; isolated-daemon smoke in `docs/VERIFICATION.md` |
| Pi extension command, UI, or display metadata | `pi/extensions/README.md`, then owning extension | `bin/pi` and installed Pi API → focused suite → safe fresh-session check |
| Pi prompt template | `pi/prompts/*.md` | Global prompt discovery → explicit `/name` invocation |
| Click Pi file links into Neovim | `pi/extensions/local-file-links/README.md` | File URLs → Alacritty hint → `bin/terminal-open` → Neovim |
| Add an MCP server | `pi/mcp.json`, optionally `omp/mcp.json` | Pi's built-in MCP support; `pi mcp list` connects it, then `/reload` and `/mcp` |
| OMP defaults, tools, skills | `omp/` | Global deployment versus project `.omp/`; consuming task and installed harness, not the model name |
| Workspace repository index for agents | `lib/workspace-context-mcp/README.md` | Launcher → stdio MCP; Node suite, then `workspace-context-mcp doctor` |
| Shell or editor startup | `zsh/zshenv`, `zsh/zshrc`, `nvim/init.lua` | Startup sources → command/plugin consumer; distinguish syntax from startup side effects |

Exact commands and prerequisites live in [`VERIFICATION.md`](VERIFICATION.md).

## Important flows

### 1. Deployment

1. Each tool's folder is flat, with undotted names; [`links`](../links) maps it
   to its destination. `nvim/ ~/.config/nvim/` maps `nvim/init.lua` to
   `~/.config/nvim/init.lua`; `zsh/zshrc ~/.config/zsh/.zshrc` renames on the way.
2. A trailing slash mirrors a folder: `dotfiles-link` creates or retains real
   directories and links each file, rather than replacing a whole application
   directory with one symlink. It refuses any directory symlink in a target's
   path and any location that is the checkout by filesystem identity (so a
   differently cased path is caught). It applies changes through directories
   opened without following symlinks and verified in place before and after
   each change; see the script's docstring for the residual race it accepts.
3. The ignore list in `dotfiles-link` keeps known generated files out of the
   deployment plan.
4. `dotfiles-link check` previews every create, repair and removal plus conflicts,
   unlisted tracked files and stale links; `apply` changes nothing while a
   conflict remains. Links are absolute; a link into the checkout that points at
   an old path is repaired, and a dangling one in a mirrored folder is removed.

This layout lets managed configuration and unmanaged app state coexist. A
content edit to an existing managed file is already live through its symlink; a
new, moved, or deleted file needs `dotfiles-link apply`.

### 2. Shared theme orchestration

[`bin/theme`](../bin/theme) is the canonical owner of the
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
Generated overlays use temporary files and rename so consumers do not observe
partial configuration. Pushes to live applications are best-effort, while
`theme status` provides the diagnostic path.

Pi is a reader, not a push target: [`theme-sync`](../pi/extensions/theme-sync/README.md)
polls the same `flavour` file and applies an in-memory theme. It writes nothing.

### 3. Herdr source and plugin customisation

There are six distinct owners:

- [`herdr/config.base.toml`](../herdr/config.base.toml)
  owns stable user configuration.
- [`herdr/patches/`](../herdr/patches/) plus
  [`install-herdr-focus`](../bin/install-herdr-focus) own the pinned,
  patched binary. The installer fetches one upstream commit, applies the patch,
  runs the patch's tests, and installs atomically. The build identifies itself as
  `dotfiles.<patch-hash>` and its updater refuses stock replacements. Since 0.9
  the **server** renders pane content (attention borders and opacity) and the
  **client** draws the sidebar (Spaces tree, `sidebar_hidden` filtering, footer,
  machine keys), so each half activates separately.
- [`herdr/plugins/next-agent/`](../herdr/plugins/next-agent/)
  owns the per-pane attention ledger and metadata consumed by navigation, the
  sidebar, and split-pane chrome.
- [`herdr/plugins/spaces-env/`](../herdr/plugins/spaces-env/)
  owns the fixed Personal/Work Space environments. Its assignments and MRU order
  are runtime state under `~/.local/state/herdr/plugins/martinro.spaces-env/`.
- [`herdr/plugins/pr-status/`](../herdr/plugins/pr-status/)
  owns the pull-request lookup for linked worktrees. It reports display-only
  `pr_number` / `pr_title` / `pr_state` Space tokens; the patched client draws
  the name and state icon. Its lookup cache is runtime state under
  `~/.local/state/herdr/plugins/martinro.pr-status/`.
- [`herdr/plugins/task-launcher/`](../herdr/plugins/task-launcher/README.md)
  owns the Pi Tasks popup: it names the task with a quick naming model, creates a
  worktree Space through Herdr, and starts Pi as that Space's only tab with the
  source checkout's saved Pi trust decision. Preferences, drafts, history and prompt
  handoffs live under `~/.local/state/herdr/plugins/martinro.task-launcher/`.

The installed binary, generated Herdr config, plugin runtime ledger, and server
process are deployment/runtime outputs and do not belong in Git.

### 4. Agent configuration

**Pi is the primary interactive harness; OMP is secondary.** Register and verify
agent capabilities for Pi first, then optionally mirror them to OMP. Pi's managed
MCP registrations are in [`pi/mcp.json`](../pi/mcp.json), read
by Pi's built-in MCP support; a trusted project's `.pi/mcp.json` replaces entries
of the same name. [`omp/`](../omp/) contains
cross-repository OMP defaults, tooling catalogues, agents, and global or scoped
skills. Scoped skills are inert until a project links them.
[`pi/extensions/`](../pi/extensions/) contains globally
discovered Pi extensions and the policy for any hook that can alter model-visible
context. [`pi/prompts/`](../pi/prompts/) holds prompt templates
that only enter context when invoked. The [Pi wrapper](../bin/pi)
disables automatic skill discovery; `/skill` enables selected skills per session.
OMP defaults are not automatically Pi defaults, and a catalogue entry does not
prove a tool is exposed in the current session.

Pi's own [`settings.json`](../pi/settings.json) (models, packages, UI) and
[`models.json`](../pi/models.json) (model overrides) are managed too. Pi
rewrites `settings.json` in place, following the link, so `/settings`, `/model` and
upgrade bookkeeping surface as repository diffs to review; they are desired state,
not runtime output. Its credentials, trust decisions, caches and installed packages
stay in `~/.pi/agent/`.

The [Workspace Context MCP](../lib/workspace-context-mcp/README.md)
is the one locally owned MCP server: a read-only, dependency-free stdio process
that indexes repositories under `~/Desktop/projects` and `~/dotfiles` in memory.

The root [`.omp/mcp.json`](../.omp/mcp.json) and [`.pi/mcp.json`](../.pi/mcp.json)
are project-specific configuration for this repository, not global defaults.
Credentials, model caches, databases, memories, lock files, and session state are
local outputs even when their tools' static configuration is managed here.

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
   copy generated files back into a tool folder as an update mechanism.
3. **Cross-tool scripts own and document their fan-out.** Individual consumer
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

- New managed home configuration: a purpose-named top-level folder with a
  `links` line, or the existing owning folder.
- New mutable state: an application-owned directory or `~/.local/state/<tool>`.
- New cross-application command: `bin/`, with minimal-`PATH` handling
  if reachable outside a shell.
- New global OMP capability: `omp/`; keep repository-specific skills
  scoped and explicitly linked.
- New Pi extension: `pi/extensions/`, after applying that directory's
  context-neutrality policy.
- New repository-wide decision or long-running migration: this knowledge base
  and, when warranted, an active execution plan.
