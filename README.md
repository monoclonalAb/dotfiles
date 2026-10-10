# dotfiles

My macOS dotfiles. Each top-level folder holds one tool's configuration, laid
out flat (`nvim/init.lua`, `zsh/zshrc`). The [`links`](links) file says where each
folder or file goes under `$HOME`, and [`dotfiles-link`](bin/dotfiles-link) creates
the symlinks. `docs/`, root files and hidden folders are never linked.

A folder listed with a trailing slash is *mirrored*: its directories stay real under
`$HOME` and every file inside is its own symlink, so applications keep their
sessions, caches and credentials beside the managed files without writing into this
repository. Content edits here change live configuration immediately; only a new,
moved or deleted file needs `dotfiles-link apply`.

```text
nvim/            -> ~/.config/nvim/          (mirrored: one symlink per file)
zsh/zshrc        -> ~/.config/zsh/.zshrc     (file symlink)
zsh/zshenv       -> ~/.zshenv                (sets ZDOTDIR)
```

## Find the right guide

- **Coding agents:** start with [`AGENTS.md`](AGENTS.md), then the
  [`docs/` catalogue](docs/README.md). The guidance is usable with GPT-6 Astra
  without changing model selection or enabling additional tools.
- **New workstation:** [Setting up a new Mac](#setting-up-a-new-mac).
- **Existing workstation:** [Updating](#updating-an-existing-machine),
  [common tasks](#common-tasks), and [troubleshooting](#troubleshooting).
- **Ownership and safe checks:** [Architecture](docs/ARCHITECTURE.md) and
  [verification](docs/VERIFICATION.md).
- **Subsystem operation:** [Theme](#theme-toggle), [Pi tooling](#pi-agent-tooling),
  [OMP tooling](#omp-agent-tooling), and [per-tool setup](#8-set-up-each-tool).

Setup and update commands below change the workstation; they are not a checklist
for an agent doing a source or documentation edit.

## Setting up a new Mac

### Quick start

The repository is private, so sign in to GitHub before cloning. From a new Terminal:

```sh
xcode-select --install      # wait for the installer to finish
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
/opt/homebrew/bin/brew install gh
/opt/homebrew/bin/gh auth login                  # choose HTTPS and "authenticate Git"
/opt/homebrew/bin/gh repo clone monoclonalAb/dotfiles ~/dotfiles
~/dotfiles/bin/dotfiles-bootstrap
```

[`dotfiles-bootstrap`](bin/dotfiles-bootstrap) automates the numbered
steps below: Command Line Tools, Homebrew, rustup, the Brewfile, nvm + Node LTS,
Pi and TypeScript, every link, the theme seed, tpm, the patched Herdr
build, and Herdr's plugins and agent integrations. It acts only on what is missing,
so rerun it after fixing a failure. It stops rather than resolving a link conflict
(see [step 7](#7-link-everything)), never upgrades installed packages, and ends by
printing what it cannot do: sign-ins (`gh`, Pi `/login`, gcloud, Tailscale),
AeroSpace's Accessibility permission, tmux `C-a I`, and the first `nvim` launch.
`dotfiles-bootstrap --check` reports the same steps without changing any
configuration (Homebrew and Herdr may still write their own caches and locks).

What carries over: every linked file, including Pi's settings (default
and enabled models), MCP servers and model overrides, the p10k prompt, and the
git identity. What does not: credentials and sign-ins, SSH keys,
`~/.config/mcp/mcp.json`, machine-local LaunchAgents, app data (such as the
Obsidian vault), and the [personal bits](#personal-bits--edit-or-skip) tied to
this Mac.

The numbered steps are the manual equivalent and explain each prerequisite.

**Order matters.** Homebrew and rustup have to be in place *before* the first new zsh
starts, and linking has to happen *before* p10k / tpm / nvim, because those write into
directories this repo owns. Following the steps top to bottom handles that.

### 1. Xcode Command Line Tools

```sh
xcode-select --install
```

Gives you `git`, `make`, `clang` and `python3`. Neovim needs a C compiler to build
`telescope-fzf-native` and the treesitter parsers; the tmux `prefix + Space` binding
needs `python3`.

### 2. Homebrew

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

> **Apple Silicon assumed.** `.zshrc` sources several shell plugins from
> `/opt/homebrew/share/...`. On an Intel Mac (prefix `/usr/local`), review those
> source paths — see [Troubleshooting](#troubleshooting).

### 3. Rust — do this before opening a new shell

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- --no-modify-path
```

`--no-modify-path` stops rustup creating `~/.zshenv` (which would then block linking)
and editing other shell files; the linked `.zshenv` already loads Cargo.

`~/.zshenv` sources `~/.cargo/env` **unconditionally**. Skip this step and every single
zsh startup — including the ones the steps below trigger — prints
`no such file or directory: /Users/you/.cargo/env`.

### 4. Clone the repo

```sh
brew install gh && gh auth login     # the repository is private
gh repo clone monoclonalAb/dotfiles ~/dotfiles
```

Keep the clone at `~/dotfiles`: Pi and OMP MCP configuration refers to that path.
A plain clone is correct — **no `--recurse-submodules`**. The tmux plugin submodules were
removed from this repo; tpm installs them now (step 8). The Catppuccin
theme for Alacritty is vendored into the repo, so it needs nothing at install time.

### 5. Install the packages

```sh
brew bundle --file=~/dotfiles/Brewfile
```

See [`Brewfile`](Brewfile) — it's commented, and the tail has an optional block (fish,
nushell, yabai, MacTeX) that's off by default.

### 6. Node, via nvm

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash
source "$HOME/.nvm/nvm.sh"
nvm install --lts
npm install -g @earendil-works/pi-coding-agent typescript@5
```

`PROFILE=/dev/null` keeps nvm's installer from appending to a shell file. The global
packages are Pi itself (the `pi` wrapper in `bin` execs it) and the TypeScript
fallback that [`lsp.json`](omp/lsp.json) points at; install them with
nvm's npm, not Homebrew's.

Most of the Mason LSPs (`html`, `cssls`, `tailwindcss`, `jsonls`, `yamlls`) are npm
packages, and the `pwa-node` debug adapter shells out to `node`. `.zshrc` already has the
`NVM_DIR` block, guarded — it's a no-op if nvm isn't there.

### 7. Link everything

Preview first. On a Mac that has already been used, this *will* report conflicts:

```sh
~/dotfiles/bin/dotfiles-link check
```

It lists every link it would create or repair, then problems: `conflict` lines,
`unlisted` tracked files that no line in [`links`](links) deploys, and `stale` links
into the repository that `links` no longer lists. A conflict means a target is a real
file or directory or a link pointing outside this repository, or that it sits under
a directory symlink: every folder below `$HOME` that holds a link must be a real
directory. Inspect it and preserve anything valuable before moving it aside and
re-running. The following are examples, not unconditional commands; use an unused
backup name and never replace a previous backup:

```sh
mv ~/.zshenv ~/.zshenv.bak          # macOS ships one
mv ~/.config/nvim ~/.config/nvim.bak
```

Then link for real:

```sh
~/dotfiles/bin/dotfiles-link apply
```

`apply` changes nothing while any conflict remains. It creates absolute symlinks,
repairs links that point at an old location inside this repository, and removes
links in mirrored folders whose repository file no longer exists. Its ignore list
(in the script: the old `.stowrc` patterns, matched against the end of each path
under `$HOME` as Stow did) keeps runtime files that may land in the checkout from
being linked: caches, Neovim's lockfile, tmux plugins, OMP's lockfile, and Pi credentials
and model cache.

Check it landed:

```sh
dotfiles-link check   # exit 0: every link in place, nothing to review
```

### 8. Set up each tool

**zsh + prompt**

```sh
exec zsh
```

The Powerlevel10k prompt is tracked at `zsh/p10k.zsh`, so it arrives
configured. `p10k configure` deletes the link and writes a real file; to keep a new
style, move it back with
`mv ~/.config/zsh/.p10k.zsh ~/dotfiles/zsh/p10k.zsh && dotfiles-link apply`
and commit. `.zprofile` adds Homebrew to `PATH` when the installer did not (the
script installer's suggested `~/.zprofile` line is never read because `ZDOTDIR` is set).

**Terminal** — Alacritty is configured and asks for `JetBrainsMono Nerd Font`, installed
by the Brewfile. **Cmd-click** a `file://` URL to open it in a new Neovim window
(**Cmd+Shift-click** inside Herdr); web links still open in the browser and
**Ctrl+Shift+O** picks hints by keyboard. Pi's
[local-file-links](pi/extensions/local-file-links/README.md) extension makes
its file links clickable.

**Theme** — seed the shared Catppuccin state, which Alacritty, Herdr, tmux, Neovim and Pi share
(see [Theme toggle](#theme-toggle)):

```sh
theme set latte 0.6
```

Until this runs, each app falls back to its own default and Alacritty logs a missing-import
error to `$TMPDIR/Alacritty-*.log` — harmless, and this clears it.

**Tailscale**

Install the `tailscale-app` cask, sign in to the existing tailnet, and enable MagicDNS in
the tailnet's DNS settings. The cask ships no `tailscale` command on `PATH`; the
[`tailscale`](bin/tailscale) wrapper in `bin/` execs the bundled binary
instead of symlinking it, so the executable keeps its application-bundle identity.

**Herdr**

Herdr's runtime `config.toml` is generated from `config.base.toml` by `theme`, so
run the Theme step above first. This repo builds Herdr from upstream v0.9.1
(`065ef9d6a531c49fb8bee7e818ef837065b21ee9`) plus
[`herdr-0.9.1-focused-pane.patch`](herdr/patches/herdr-0.9.1-focused-pane.patch),
which adds:

- heavy focused-pane borders and attention chrome: blocked panes use the palette's
  red, finished-but-unreviewed panes peach, both at midpoint opacity; other inactive
  panes blend toward the terminal background (`ui.unfocused_pane_opacity`);
- a single **Spaces tree** sidebar (`ui.sidebar.spaces.inline_agents = true`):
  repository → worktree Space → conversations. Click a repository to fold it, or a
  Space's status counts to show/hide its conversations. Drag a linked worktree's row
  to reorder it within its repository (the main checkout stays first);
- the reserved `sidebar_hidden` Space token that spaces-env uses to hide the other
  environment (the focused Space always stays visible);
- reserved `pr_number` / `pr_title` / `pr_state` Space tokens, which pr-status uses
  to name a worktree after its pull request and show the PR state;
- `keys.next_machine` / `keys.previous_machine` for switching between saved machines,
  and `keys.move_worktree_up` / `keys.move_worktree_down` for reordering worktrees.

Install it after `brew bundle` (needs Rust via rustup and Zig 0.16.0; set `ZIG` to override):

```sh
install-herdr-focus                          # build, test, install ~/.local/bin/herdr
install-herdr-focus --build-only /tmp/herdr  # build and test only
```

The installer never restarts a server. Since 0.9 the client draws the sidebar and the
server draws panes, so sidebar features appear on the next `herdr` attach and pane
chrome on the next server start. Run `theme apply` (or `C-a R`) to regenerate the
config. The build reports `0.9.1-dotfiles.<patch-hash>` and its `herdr update`
refuses to replace itself with a stock release; upgrades need a ported patch. To swap
the binary under running agents, follow the
[live-handoff checklist](docs/VERIFICATION.md#explicitly-approved-live-herdr-handoff).

Then finish the setup:

```sh
herdr plugin link ~/.config/herdr/plugins/next-agent --enabled
herdr plugin link ~/.config/herdr/plugins/spaces-env --enabled
herdr plugin link ~/.config/herdr/plugins/task-launcher --enabled
herdr plugin link ~/.config/herdr/plugins/pr-status --enabled
herdr integration install pi
herdr integration install omp
herdr integration status      # Pi and OMP should both be current
herdr machine add <ssh-target> --label home   # optional, for C-a '
herdr config check
herdr
```

Herdr is the primary terminal workspace manager. Its config keeps the tmux `C-a`
muscle memory: `h/j/k/l` moves between panes, `\` / `-` splits right / down, `c`
closes a pane, `C-c` creates a tab, `r` renames it, `w` opens the workspace picker,
and `z` zooms. `H` / `L` changes tabs, `x` swaps down, and `Space` enters resize mode.
Splits are refused when a pane would drop below 10 columns or 4 rows. `C-a ?` shows
the live keymap. The custom keys:

| Key | Action |
| --- | --- |
| `C-a u` / `C-a Shift-u` | Jump to the next conversation needing attention / back to where the jumps started |
| `C-a m` | Keep the conversation you are looking at unread until you reply to it; press again to mark it read |
| `C-a t` | Start a [Pi task](herdr/plugins/task-launcher/README.md) in a new worktree Space |
| `C-a v` | Review the focused agent's uncommitted changes in tuicr and send the comments back |
| `C-a ;` / `C-a :` | Toggle Personal/Work / send the current Space to the other environment |
| `C-a '` | Switch this client to the next online machine (e.g. the saved `home`) |
| `C-a K` / `C-a J` | Move the focused linked worktree up / down within its repository (stops at either end) |

**Agent state.** The official Pi and OMP integrations report lifecycle state; without
them Herdr guesses from screen text. After `herdr integration install …`, `/reload`
idle sessions. The next-agent plugin keeps a per-pane ledger shown as `◐` working,
`◆` blocked/needs input, `●` finished but unreviewed and `○` idle/reviewed. Focusing
a pane (hotkey, click, or pane body) marks it reviewed; split siblings keep their own
state. `C-a m` overrides that for the conversation in front of you: it shows `●` and
`C-a u` keeps visiting it, however often you come back, until you send it a message
or press `C-a m` again. Typing without sending does not count. The focused
conversation counts as reviewed even if it finishes while the terminal is in the background (the macOS notification still fires). It also sounds the active-tab OMP prompts Herdr's own toasts skip. Its settings
live in `~/.config/herdr/plugins/config/<plugin-id>/config.toml`.
Conversation rows use OMP's terminal title, or for Pi the
[`herdr-task-summary`](pi/extensions/herdr-task-summary/summary.ts) token: a
2–6-word title generated in the background by a small, tool-free request to the
selected model (this uses provider quota). A letter-scramble animation shows while it
is pending; failures keep the previous title. Titles may include issue numbers
(`PR #450`) and colons, and up to 8 words are accepted; nothing is clipped. If a
conversation keeps `New conversation`, its pane's `task_summary_error` token says
why (rejected reply, provider error or timeout):
`herdr pane list | jq '.result.panes[] | {pane_id, tokens}'`. The next good title
clears it.

**Pull requests.** When a linked worktree's branch has a GitHub pull request, the
[pr-status](herdr/plugins/pr-status/pr_status.py) plugin renames its sidebar row to
`#123 PR title` and puts GitHub's state icon in front: green open, grey draft,
purple merged, red closed (Nerd Font Octicons). Only the sidebar changes; the Space's
real name, branch and worktree stay as they are. Main checkouts are never looked up.
The plugin asks `gh pr view` in the checkout, so `gh` must be signed in. Herdr has
no timer for plugins, so it checks again when something happens (a focus change,
an agent finishing, a new Space): the Space you are in after 30 seconds, others
after 5 minutes, merged or closed ones after 30 minutes. Herdr startup checks everything.
To check now: `herdr plugin action invoke martinro.pr-status.refresh`. If `gh`
fails (offline, signed out), the last result stays. The cache is
`~/.local/state/herdr/plugins/martinro.pr-status/state.json`.

**Reviewing changes.** `C-a v` runs [`herdr-review`](bin/herdr-review), which
opens [tuicr](https://tuicr.dev) in a popup on the focused agent's working tree
(or the only agent in the tab). Select lines with `v`/`V`, comment with `c`, then
`:wq`/`ZZ` sends all comments to the agent as one prompt; `:q`/`ZQ` sends nothing.
If the agent is waiting on a question the comments stay in tuicr and are copied to
the clipboard. For committed work run `herdr-review -r main..HEAD` from a shell pane.

**Environments and machines.** spaces-env splits Spaces into Personal and Work within
one server. `C-a ;` returns to the Space you last used in the other environment;
`C-a :` moves the current Space across. New Spaces join the active environment and
unknown ones default to Personal. The sidebar and conversation list show only the
active environment. Reset assignments by deleting
`~/.local/state/herdr/plugins/martinro.spaces-env/state.json`; inspect them with
`herdr plugin action invoke martinro.spaces-env.status`. Each machine is a separate
sidebar screen with its own server, plugins and environments; `C-a '` skips offline
machines. From a plain terminal, `herdr --remote <ssh-target>` attaches directly.

**tmux (legacy fallback)**

```sh
git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
tmux
# then press C-a followed by I  (capital i) to install the plugins
```

The prefix is remapped to `C-a`. `~/.config/tmux/plugins/` is gitignored — the plugins
are tpm's job, not this repo's.

**Neovim**

```sh
nvim
```

First launch bootstraps lazy.nvim, then Mason provisions the configured LSPs, linters,
formatters, Java tooling, and debug adapters. Node/npm must be available first: it is required
for the web-language servers, Prettier, ESLint, TypeScript Tools, and JavaScript debugging.
Mason also supplies TypeScript Tools' `tsserver`, so no global TypeScript install is needed.
The Tree-sitter parser installer likewise requires `tree-sitter-cli`, which the Brewfile installs.

Note `lazy-lock.json` is gitignored, so a fresh install pulls the latest stable version of
every plugin rather than the versions pinned on the old machine.

**git** — the `git` folder links [`~/.config/git/config`](git/config)
(name, email, `init.defaultBranch`) and the global `ignore` file; Git reads both via
XDG. Keep `~/.gitconfig` absent: when it exists, Git reads it too and
`git config --global` writes there instead of to the tracked file. Credentials use the
`osxkeychain` helper that Apple's and Homebrew's Git both configure system-wide;
`gh auth login` can add itself as the GitHub helper. Run `git lfs install` only if you
need LFS; it records its filter in the tracked config.


**AeroSpace** — launch it once and grant Accessibility in System Settings → Privacy &
Security. `start-at-login = true` is already in the config.

### 9. Verify

```sh
exec zsh                 # no errors printed
ls                       # colourised, dirs first  => gls/coreutils works
echo $ZDOTDIR            # /Users/you/.config/zsh   => .zshenv is linked
nvim +checkhealth        # lazy/mason/treesitter all green
herdr config check       # config parses and every custom key is valid
herdr                    # persistent workspace opens with the C-a prefix
```

## The rule (how to tell what's managed)

A **file symlink resolving into this checkout** is managed; a symlink elsewhere
is not necessarily ours. Parent directories normally remain real and may contain
both managed leaves and app-owned state. For example, `~/.config/gh/config.yml`
is linked while secret-bearing `hosts.yml` stays local.

```sh
ls -la ~/.config/zsh ~/.config/gh  # inspect leaves, not just parent directories
readlink ~/.config/zsh/.zshrc     # confirm the link's source before editing
```

If an older installation still has a whole-directory link into the checkout,
inspect its runtime files before migrating it; `dotfiles-link` refuses to link
through one. Do not copy app state into Git to resolve a conflict.

## Personal bits — edit or skip

These are hardcoded to one machine and one user. Nothing here breaks the shell if the
target is missing (aliases and PATH entries fail lazily), but they're dead weight on a new
machine. Fix or delete as you go.

| Where | What | Do what |
|---|---|---|
| `zsh/zshenv` — Cargo environment | `. "$HOME/.cargo/env"` | install rustup (step 3) — this one **does** error at startup |
| `zsh/zshrc` — `pmd` alias | `$HOME/pmd-bin-7.16.0` | unzip PMD 7.16.0 there, or drop the alias |
| `zsh/zshrc` — `life`, `todo`, `resumes` aliases | `~/Desktop/life`, `~/Desktop/resumes` | create the dirs, or drop the aliases |
| `zsh/zshrc` — `prosperity` alias | `/Users/ericzheng/Desktop/prosperity/…` | drop it — absolute path, old project |
| `zsh/zshrc` — PATH block | `/Library/TeX/texbin`, `/usr/local/share/dotnet` | harmless if absent; they're just PATH entries |
| `zsh/zshrc` — conda initialisation | conda block at `/opt/anaconda3` | install Anaconda there, or delete the block |
| `.archive/fish/config.fish` | the same conda block | ditto |
| `nvim/lua/plugins/obsidian.lua` | Obsidian integration loads only when `~/Documents/obsidian` exists | create your vault there; ordinary Markdown works without one |
| `pi/mcp.json`, `omp/{mcp,lsp,dap}.json` | absolute `/Users/eric/...` paths (JSON cannot expand `~`) | same username and `~/dotfiles` clone: nothing; otherwise `dotfiles-bootstrap` lists the files to edit |

## Optional extras

Not installed by the Brewfile; add them only if you want the feature.

- **MacTeX + Skim** — `brew install --cask mactex-no-gui` (Skim is already in the Brewfile).
  Needed for `vimtex`; the viewer config is macOS-only.
- **Anaconda** at `/opt/anaconda3` — for the conda blocks in `.zshrc` and archived
  `.archive/fish/config.fish`.
- **PMD 7.16.0** — unzip into `~/pmd-bin-7.16.0` for the `pmd` alias.
- **.NET SDK** — `.zshrc` puts `/usr/local/share/dotnet` on PATH.
- **Claude Code CLI** — `.zshrc` aliases `claude` with `--dangerously-skip-permissions`.
  Drop the alias if you'd rather be asked.
- **direnv** — `brew install direnv`. `.zshrc` installs its hook only when `direnv` is
  on PATH, so per-project `.envrc` files load on `cd` (after `direnv allow`).
  A new shell loads its starting directory's `.envrc` silently (to avoid p10k's
  instant-prompt warning), so errors there, such as a blocked `.envrc`, are not shown.
- **conducterm** — `tmux.conf` sources `~/.conducterm/conducterm.tmux` with `-q`, so its
  absence is completely silent. Alacritty's `option_as_alt = "Both"` exists for its
  keybindings.

### Window managers

This repo actively uses one tiling WM:

- **AeroSpace** — the current one. Installed by the Brewfile, config at
  `~/.config/aerospace/aerospace.toml`, starts at login.

## Archived configurations

The complete `fish`, `neofetch`, `yabai`, `skhd`, `wezterm`, and `yazi` configurations
are kept under `.archive/` in the same flat layout as active tools
(`.archive/yazi/yazi.toml`); they are not active, and `links` never lists hidden
folders. Each one belongs in `~/.config/<tool>/`. To restore one, move it back to the
top level and give it a `links` line, then preview and apply:

```sh
git mv .archive/yazi yazi
printf '%s\n' 'yazi/           ~/.config/yazi/' >> links
dotfiles-link check && dotfiles-link apply
```

To retire an active tool, do the reverse: list and remove its links first (see
[Common tasks](#common-tasks)), delete its `links` line, then
`git mv <tool> .archive/<tool>`.

`fish` contains only a conda init block, and fastfetch replaces `neofetch`. The archived
`yabai` and `skhd` configs are legacy; before restoring `yabai`, its scripting addition
(`yabai --load-sa`, called by `yabairc`) requires partially disabling SIP and a
passwordless sudoers entry.

## What's managed vs. left alone

| Managed (listed in `links`) | Left in `~/.config` (real dirs, untracked) |
|---|---|
| nvim, herdr, tmux, zsh (+`~/.zshenv`, p10k prompt), alacritty, ghostty, aerospace, git (identity + ignore), gh (`config.yml` only), tuicr, bin, omp, pi (settings, models, extensions, prompts, MCP) | **Games:** StardewValley · **Secrets/app-state:** gh credentials (`hosts.yml`), github-copilot, gcloud, mcp (`mcp.json`), launchpad, Herdr runtime (sessions, logs, plugin state, generated `config.toml`) · **Default templates only:** cmux, opencode, amp · **Skipped:** raycast (extension bundles), herdr-dev (plugin test fixtures) |

Also outside the repository: credentials (`~/.pi/agent/auth.json`, gcloud, `~/.ssh`),
`~/.config/mcp/mcp.json`, LaunchAgents, and other agent CLIs' settings (Claude Code,
Codex, Gemini, opencode, cmux).


Secrets and runtime state must remain outside this repo. With mirrored folders,
new app-written files normally stay in real `$HOME` directories rather than
landing in the checkout. [`.gitignore`](.gitignore) and the ignore list in
[`dotfiles-link`](bin/dotfiles-link) cover specific known outputs, not every
possible secret filename. Older folded links
or a misconfigured writer can still leak state: inspect unexpected files and
`git status` before committing, without dumping credential contents.

## Theme toggle

Alacritty, Herdr, tmux, Neovim and Pi share Catppuccin, with terminal opacity driven by
`bin/theme` (on `PATH` via `~/.local/bin`).

| Hotkey (in Alacritty) | Effect |
|---|---|
| `Ctrl+Shift+T` | next flavour — latte → frappe → macchiato → mocha → latte |
| `Ctrl+Shift+B` | next opacity — 1.0 → 0.85 → 0.6 → 1.0 |

`Ctrl+Shift+B` rather than the mnemonic `Ctrl+Shift+O`, which is Alacritty's built-in
URL-hint binding.

```sh
theme status                # what's set right now
theme set mocha 0.85        # set explicitly
theme cycle                 # same as Ctrl+Shift+T
theme opacity               # same as Ctrl+Shift+B
```

State lives in `~/.local/state/theme/` — deliberately outside this repo, so pressing the
hotkey never dirties `git status`. The repo keeps latte/0.6 as its committed default.
Changes reach Alacritty via `live_config_reload`; Herdr receives a generated config
with the exact flavour's colours; tmux uses `source-file`; and every running Neovim
updates over RPC (plus a `FocusGained` fallback). New windows read the state on startup.

Pi's [theme-sync extension](pi/extensions/theme-sync/README.md) polls the
same state and follows it within about half a second, overriding Pi's own `/settings`
theme without rewriting it.

**Alacritty's theme-driven keys must stay out of `alacritty.toml`.** Its `import` list is
merged with the *importing* file last, so a key set in `alacritty.toml` itself overrides
the generated overlay rather than being overridden by it. `window.opacity` and
`window.decorations_theme_variant` therefore live in
`alacritty/window-theme-defaults.toml` (imported before the state file),
and the `[window]` table in `alacritty.toml` leaves both unset — colours likewise. Putting
either key back into `alacritty.toml` silently pins it and makes `Ctrl+Shift+B` a no-op.

Below 1.0 opacity, Neovim also turns on `transparent_background` so the terminal shows
through; at 1.0 it paints its own background.

**The hotkey runs with a minimal `PATH`.** Alacritty spawns it as `/bin/sh -c`, which
sources no profile, so the script inherits launchd's
`/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin` — no Homebrew, no `~/.local/bin`. `theme`
therefore sets its own `PATH` at the top; don't add a bare `command -v <homebrew binary>`
without it, or that step will be skipped in silence. This is why the pushes report what
they reached — on stderr for `cycle`/`opacity`/`set`/`apply` (discarded under the hotkey,
visible when run by hand), and via `theme status`, which probes the four pushed apps
without changing anything (Pi reads the state independently):

```
$ theme status
flavour  frappe
opacity  0.6
state    /Users/you/.local/state/theme

alacritty  overlay present
tmux       server up
neovim     found 3 instance(s)
```

## pi agent tooling

Pi is the primary interactive harness on this machine. Register and verify
agent-facing capabilities for Pi first; OMP entries are optional extras.
After changing an extension, prompt or MCP file, run `/reload` in idle Pi sessions.
Pi writes `/settings`, `/model` and changelog updates through the tracked
[`settings.json`](pi/settings.json) link, so review and commit them like
any other change.

### LithosAI models

[`pi/models.json`](pi/models.json) adds DeepSeek V4.1 Flash (Base tier) through
LithosAI's OpenAI-compatible API. [`pi/settings.json`](pi/settings.json) scopes
it first at max reasoning (a `:max` thinking suffix), so a new session starts on
it and `Ctrl+P` switches to Opus 5.5 next. The model entry resolves the key from
the macOS keychain item `lithosai`; keep its value out of this repository.
Override the startup choice per session when needed:

```sh
pi --model anthropic/claude-opus-5-5
```

Opening `/model` reloads the model configuration. The entry enables text and
reasoning at low, high or max effort, with the advertised 1M-token context and a
conservative 32,768-token output ceiling (not a verified LithosAI maximum).
Confirm the provider's output limit in its console before raising that ceiling.
Cost estimates use the published Base-tier rates. See the
[LithosAI Pi guide](https://docs.lithosai.com/agent-integrations/pi) and
[pricing](https://www.lithosai.com/pricing) when updating the entry.

### Extensions and prompts

Global extensions live in [`pi/extensions/`](pi/extensions/);
read its [policy](pi/extensions/README.md) before adding anything that
touches model context.

| Extension | Adds |
| --- | --- |
| `selective-skills.ts` | `/skill` enables skills per session (the [`pi`](bin/pi) wrapper passes `--no-skills`) |
| `session-controls.ts` | `/clear` and `/drop` |
| `copy-prompt.ts` | `alt+shift+c` copies the draft |
| [`modal-vim-navigation`](pi/extensions/modal-vim-navigation/README.md) | Vim navigation of the fullscreen transcript; clipboard images as `[img #N]` (Ctrl+V / Cmd+V); Ctrl+C copies the draft it clears |
| [`agent-stuff`](pi/extensions/agent-stuff/README.md) | `/review`, `/end-review`, `/answer` (Ctrl+.), `/btw`, `/goal`, `/session-breakdown` from mitsuhiko/agent-stuff |
| `long-context` | `/long-context` switches GPT-5.6 / GPT-6 Astra to the 1.05M window (long-context pricing above 272K) |
| [`codex-fast`](pi/extensions/codex-fast/README.md) | `/fast` requests the priority tier for Codex models (uses more credits) |
| [`quota-footer`](pi/extensions/quota-footer/README.md) | Codex (blue) and Claude (yellow) usage in the footer; `/usage` for every saved account |
| [`quota-router`](pi/extensions/quota-router/README.md) | `/accounts` and `/route`: park a second login and continue on it when one hits a usage limit |
| [`compact-ui`](pi/extensions/compact-ui/README.md) | One-line startup header (enable **Quiet startup** in `/settings`) and an `MCP: N/M` footer |
| [`theme-sync`](pi/extensions/theme-sync/README.md) | Follows the shared Catppuccin flavour |
| [`local-file-links`](pi/extensions/local-file-links/README.md) | Clickable file links that open in Neovim |
| `herdr-task-summary` | Conversation titles in the Herdr sidebar (small model request per task) |
| [`omp-anthropic-route`](pi/extensions/omp-anthropic-route/README.md) | Claude OAuth requests in OMP's reviewed shape (below) |

Prompt templates in [`pi/prompts/`](pi/prompts/) run only when
invoked: `/discuss` (interview, then an implementation-ready summary), `/eli5 <topic>`
(a throwaway visual HTML explainer), `/domain-first [scope]`, `/test-sweep [scope]`,
`/feedback [correction]`, `/pr [notes]` (commit, push and open or update a
draft PR with a short description; screenshots only when asked) and
`/ship [notes]` (commit this task's changes and push them straight to the
current branch, even the default branch, with no PR; for changes small enough
to skip review).

**Claude via OMP.** The first direct Claude OAuth request after starting Pi or
`/reload` tries to update Homebrew `omp` to the latest stable release, then sends
one small synthetic request to verify the requested model (uses quota). Later
requests reuse the check. CLI updates trust upstream binaries but permit only
version/hash changes in a reviewed formula recipe; bridge code stays pinned. A
failed or refused update only warns and keeps the installed CLI (retried next
session); a missing CLI or failed model probe blocks instead of falling back.
Startup, model selection and reload are passive; API keys, proxies and other
providers are untouched. `/omp-anthropic-route` shows the cached status. See the
[request preflight](pi/extensions/omp-anthropic-route/README.md#request-preflight)
for guards and recovery.

### MCP servers

Pi's built-in MCP support reads two files; there is no MCP package to install:

| File | Owner | Use |
| --- | --- | --- |
| [`pi/mcp.json`](pi/mcp.json) → `~/.pi/agent/mcp.json` | This repository | Global servers below |
| `<repo>/.pi/mcp.json` | Each project, read only once the project is trusted | Per-project enable/disable |

A project entry **replaces** the global entry of the same name, so it must repeat the
full `command` or `url`, plus `"enabled": false` to disable it (see this repository's
[`.pi/mcp.json`](.pi/mcp.json)). `/mcp` toggles and exposure changes are written to
the file that defines the server; for global servers that is the tracked file, so
review them like `settings.json` changes. Every enabled server connects when a session
starts (there is no lazy mode); `pi mcp list` connects each one and reports errors,
and `/reload` applies changes to a running session. OAuth sign-ins (`pi mcp login
<server>`) are stored in `~/.pi/agent/mcp-auth.json`. Tools default to `codemode`
exposure: the model calls them from `codemode` scripts. Penpot stays only in the
host-local `~/.config/mcp/mcp.json`, which Pi no longer reads: its token is part of
the URL, and Pi does not expand variables in URLs.

- **gcloud** and **gcp-observability** use the same pinned packages as OMP and start
  with every session (needs `npx` and the gcloud CLI). gcloud is read-only only
  because of the `-c` [allowlist](omp/gcloud-mcp-allowlist.json); keep it.
  Neither restricts projects: they use your Google IAM, so pass explicit project IDs.
  If auth has expired, run `gcloud auth login` and `gcloud auth application-default
  login`, then `/mcp reconnect <server>`. Calling `run_gcloud_command` with
  `{"args":["version"]}` must be rejected by the allowlist.
- **paper** connects to Paper Desktop at `http://127.0.0.1:29979/mcp` when a file
  is open. It can edit the open design. While Paper is closed, each session start
  reports it as failed; `/mcp reconnect paper` after opening Paper.
- **workspace-context** is this repository's own read-only index of every repository
  under `~/Desktop/projects` and `~/dotfiles`
  ([README](lib/workspace-context-mcp/README.md)). It runs
  `~/.local/bin/workspace-context-mcp serve`, so `bin/` and `lib/` must be linked;
  `workspace-context-mcp doctor` inspects it without an agent. OMP enables it too.
  It is disabled for this repository in [`.pi/mcp.json`](.pi/mcp.json).
- **linear** and **notion** are hosted OAuth servers reached over HTTPS; sign in
  once with `pi mcp login linear` / `pi mcp login notion`.

## omp agent tooling

[`omp/mcp.json`](omp/mcp.json) is an opt-in catalogue except
for the globally enabled read-only `gcloud`, `gcp-observability`, and local
[`workspace-context`](lib/workspace-context-mcp/README.md) servers.
The remaining entries are disabled globally. This repository enables Context7,
DeepWiki, and grep.app in [`.omp/mcp.json`](.omp/mcp.json). Enable other reviewed
servers per repository in `<repo>/.omp/mcp.json`; each file
must include the complete server definition because project files cannot use `enabledServers`, and
it must sit in the directory omp is launched from because MCP project config is not searched up
the tree. Keep `disabledServers: ["node_repl"]` to suppress the Codex-provided server; never add
there a name a project needs, because the denylist outranks project files. Hosted OAuth credentials
are keyed by profile and URL, so they work in a project file without re-authentication. Semgrep is
CLI-only: install it with `uv tool install semgrep`, then run `semgrep scan --config auto` per the
`secret-sast-sweep` skill; its MCP catalogue entry stays disabled everywhere.

| Capability | omp built-in | Alternatives | Enabled where |
| --- | --- | --- | --- |
| Library/API docs | `web_search` | Context7 · Ref.tools · GitMCP · AWS Knowledge/Docs · MS Learn · Cloudflare docs · Terraform registry | context7 (dotfiles MCP; elsewhere inspect project/plugin config) |
| Repo Q&A | — | DeepWiki · GitMCP · Octocode | deepwiki (dotfiles, de-dashboard) |
| Local workspace context | — | [`workspace-context`](lib/workspace-context-mcp/README.md) (this repo, read-only stdio) | Pi global (`pi/mcp.json`); also OMP global |
| Public code search | `grep` (local only) | grep.app · Octocode · `gh search` via the `github` tool | grep (dotfiles, de-dashboard) |
| Browser drive + inspect | `browser` (Puppeteer, CDP, relay) | Playwright MCP · Chrome DevTools MCP | built-in |
| Semantic code intel | `lsp` (50+ servers) | Serena | built-in |
| Structural search/rewrite | `ast_grep` · `ast_edit` | ast-grep CLI · Comby | built-in |
| Static security | `security_scan` (model-driven, OAuth) | Semgrep · Snyk · Socket.dev | built-in + semgrep CLI |
| Repo/issue/PR | `github` tool · `issue://` · `pr://` | GitHub MCP hosted · GitHub MCP Docker | built-in |
| Web research | `web_search` (DuckDuckGo/Startpage keyless; Brave/Exa/Jina/Kagi/Perplexity/Tavily/SearXNG with keys) | Exa · Tavily · Firecrawl · Jina · Perplexity · Kagi | built-in |
| Memory | `mnemopi` (local SQLite) · `hindsight` (HTTP service) | Basic Memory · mem0 · Chroma · Qdrant · Obsidian | mnemopi |
| Second opinion | `task` subagents + `modelRoles` + `advisor` | PAL (ex-Zen) MCP | built-in |
| Context packing | `read` summaries · `task` scouts | Repomix | built-in |
| Debugging | `debug` (DAP: codelldb, debugpy, dlv, lldb-dap, rdbg, js-debug, …) | — | built-in |
| Databases | `read` handles SQLite directly | Postgres MCP Pro · Supabase | — |
| Notebooks | `eval` (persistent py/js kernels) | Jupyter MCP (Datalayer) | built-in |
| Observability | — | Sentry · Grafana · Datadog | — |
| Issue tracker / docs | — | Linear · Atlassian Rovo · Notion | linear (habithealth-de01) |
| Cloud investigation / infra | — | gcloud · GCP Observability · Vercel · Netlify · Railway · Fly · Cloudflare · Terraform · Kubernetes | gcloud + gcp-observability (global, read-only) |
| Design / payments | — | Figma Dev Mode · Stripe | — |
| LLM-app evals & tracing | — | Promptfoo (CLI) · Langfuse · Braintrust · LangSmith · Arize Phoenix · Opik | — |

This table describes OMP capabilities, not tools guaranteed in Pi or any model
session. Other repositories' activation state is host-local; inspect it before
relying on it. For prerequisites and alternatives, use the owning
[OMP tooling catalogue](omp/TOOLING.md).

For evals and tracing, use Promptfoo as a CLI by default:
`npx promptfoo@latest eval` takes YAML, runs locally, and gates CI without an MCP
server. Choose Langfuse when self-hosted tracing is needed; its MIT core has
cloud/self-host parity. The disabled `langfuse` entry is only for conversational trace
lookup.

### MCP authentication and prerequisites

- Hosted OAuth: use `/mcp reauth <name>` rather than pasting a key for `github-mcp`,
  `sentry`, `linear`, `atlassian`, `notion`, `supabase`, `vercel`, `stripe`, `datadog`,
  `cloudflare-bindings`, and `socket`.
- Slack is deliberately absent. Its hosted server requires registering a Slack app and
  OAuth client; add it only with the `oauth`/`auth` blocks from omp's MCP config guide.
- CLI-authenticated: `railway` requires `railway login`; `flyio` requires `fly auth
  login`; `snyk` requires Snyk CLI 1.1296.2 or newer.
- Local prerequisites: Figma needs its desktop app with Dev Mode MCP enabled; Obsidian
  needs the Local REST API community plugin and generated key; Qdrant needs a running
  Qdrant; Kubernetes needs Docker.
- Archived and deliberately omitted: `@modelcontextprotocol/server-postgres`,
  `@modelcontextprotocol/server-brave-search`, `@modelcontextprotocol/server-memory`,
  `@modelcontextprotocol/server-github`, and the reference `puppeteer`/`sqlite`
  servers. `@railway/mcp-server` is superseded by `railway mcp`.

### Native extension surfaces

- **Skills:** `~/.omp/agent/skills/<name>/SKILL.md` (native, highest precedence),
  `~/.claude/skills/`, `~/.agents/skills/`, project `<cwd>/.omp/skills/`, and project
  `<cwd>/.github/skills/`. Roots are non-recursive, one level below `skills/`; the
  native provider requires `name` and `description` frontmatter. Add roots with
  `skills.customDirectories`.
- **Skill scope:** keep only cross-repository skills in `~/.omp/agent/skills/`.
  Repository-specific sources live in `~/.omp/agent/scoped-skills/`, which is not
  auto-discovered, and are linked into each applicable repository at
  `.omp/skills/<name>`. The global set is `agent-handoff`, `llm-eval`,
  `omp-repo-setup`, `repo-recon`, `secret-sast-sweep`, and `visual-verify`. Scoped
  rules:
  - `lintmax`: repositories with `pnpm-lock.yaml`
  - `agent-test-author`: prompt-behemoth consumers
  - `everyday-ai-frontend-styleguide`: `de-dashboard`
  - `perform-dangerous-action`: DE service repositories
  - `kpi-tracking`: Hono-based DE service repositories
  - `policy-guide-setup` and `system-design-template`: established DE service repositories
  - `gcp-investigate`: DE service repositories and `de-dashboard`
- **Custom subagents:** `~/.omp/agent/agents/*.md` and `<cwd>/.omp/agents/*.md`.
  Required frontmatter: `name`, `description`; optional: `tools`, `spawns`, `model`,
  `thinking-level`, `autoloadSkills`, `prewalk`, `advisor`. Bundled agents are `scout`,
  `designer`, `reviewer`, `security-reviewer`, `librarian`, `task`, and `sonic`.
  `.claude/agents` is deliberately not scanned.
- **Extensions and hooks:** `~/.omp/agent/extensions/` (including `pi-rewind`) and
  `<cwd>/.omp/hooks/{pre,post}/`; both use TypeScript/JavaScript default-export
  factories. Pi's own extensions are listed under [Pi tooling](#pi-agent-tooling).
- **Plugins:** `omp plugin install <spec>` or `omp plugin link <path>`; state lives
  under `~/.omp/plugins/`.
- **Marketplaces:** `/marketplace add <owner/repo>`, then `/marketplace discover`.
  Catalogues live at `.omp-plugin/marketplace.json` or `.claude-plugin/marketplace.json`;
  the Claude Code plugin format is compatible.

## Updating an existing machine

When updating the workstation is intended, an existing clone updates to the
latest pushed state with one command. First inspect `git status --short` and
finish or deliberately preserve local work; this is not a verification command:

```sh
dotfiles-update
```

It fast-forwards from origin, runs `dotfiles-link apply`, then runs `brew bundle` and
`theme apply` when their inputs changed and reloads tmux when its config changed.
Slow or disruptive follow-ups are printed instead of run: rebuilding the patched
Herdr binary (`install-herdr-focus`) and restarting the shell. It never rewrites
local commits or uncommitted changes; when the pull cannot fast-forward it stops
and says so. It warns about a dirty worktree but does **not** refuse to relink it:
uncommitted new files can therefore become deployed. Do not run it during
another task's unfinished work.

Machines set up before the Pi status integration was added also need
`herdr integration install pi` once, then `/reload` in each existing idle Pi conversation.
`dotfiles-link` does not install Herdr-owned integrations; confirm them with `herdr integration status`.

`dotfiles-update` does not install new npm globals, tpm, or Herdr plugins. Run
`dotfiles-bootstrap --check` after an update to see whether anything the new state
expects is missing, then `dotfiles-bootstrap` to install it.

On a clone too old to have the script yet, pull once by hand and run it from the
repo — after that it is on `PATH` as usual:

```sh
cd ~/dotfiles && git pull --ff-only && ./bin/dotfiles-update
```

**One-time move from the old Stow layout.** A machine whose links still point into
`<tool>/.config/<tool>/` paths must not use its old `dotfiles-update` for this
update: that copy keeps running after the pull and calls Stow on the flat tree,
which fails on conflicts, while every existing link now points at a moved file.
Move it over by hand instead; `dotfiles-link` repairs each old link in place:

```sh
cd ~/dotfiles && git pull --ff-only
./bin/dotfiles-link check     # expect only `repair` and `create` lines
./bin/dotfiles-link apply
```

If the old updater already ran, run the same two `dotfiles-link` commands. After
that, `dotfiles-update` works as usual. `brew uninstall stow` is optional.

Two things keep updates trustworthy:

- **Only pushed commits reach other machines.** To publish finished work, review,
  commit, and push it; `dotfiles-update` elsewhere cannot see local-only edits.
  This describes the release path, not standing permission for an agent to commit
  or push without a request.
- **Documentation lands in the same change as the behaviour it describes**
  (see [`AGENTS.md`](AGENTS.md)), so the setup steps above always match the
  current state of the repository.

## Common tasks

```sh
dotfiles-link check    # preview: links to create/repair, conflicts, unlisted files
dotfiles-link apply    # link everything in `links`; refuses while a conflict remains
```

- **Add a file** to a mirrored folder (`nvim/`, `pi/`, `bin/` and so on): create it,
  then run `dotfiles-link apply`. A file anywhere else also needs a line in
  [`links`](links); `check` reports it as `unlisted` until it has one.
- **Add a tool:** create `<tool>/` at the top level, add a `links` line (with a
  trailing slash on both sides to mirror it), then run `dotfiles-link apply`.
- **Remove or rename a file:** `git mv` or `git rm` it, then `dotfiles-link apply`
  removes the dangling link it left in a mirrored folder.
- **Stop managing a tool:** first list its links, because `dotfiles-link` only
  scans folders that `links` still names:
  `find ~/.config/<tool> -type l -lname "$HOME/dotfiles/*"`. Delete its `links`
  line, then remove those links by hand.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `. "$HOME/.cargo/env": no such file or directory` on every prompt | rustup missing — step 3 |
| `no such file or directory: /opt/homebrew/share/powerlevel10k/…` | `brew bundle` didn't run; or Intel Mac — review the hardcoded Homebrew `source` paths in `.zshrc` for `/usr/local/share/...` |
| `gls: command not found` from the `ls` alias | `brew install coreutils` |
| Boxes / tofu instead of icons | Nerd Font not installed, or not selected in the terminal |
| `dotfiles-link: changed nothing` with `conflict` lines | a real file/dir, or a link outside the repo, occupies the target — inspect it, `mv` it aside and re-run |
| Telescope `live_grep` returns nothing, silently | `ripgrep` missing |
| Tree-sitter errors on every startup | `tree-sitter-cli` missing — run `brew bundle` and restart Neovim |
| Web LSPs or TypeScript fail to start | Node/npm missing — source `~/.nvm/nvm.sh`, run `nvm install --lts`, and restart Neovim |
| Herdr ignores a config edit | Run `herdr server reload-config`, or press `C-a R` |
| `C-a '` says `home is not ready` or `no other machine is saved` | Save the machine with `herdr machine add <ssh-target> --label home` and check `herdr machine list --json`. A stock client (`herdr --version` without the patch) has no `next_machine` key: rerun `install-herdr-focus` |
| A worktree shows its branch, not its pull request | Run `herdr plugin action invoke martinro.pr-status.refresh`, then `herdr plugin log list --plugin martinro.pr-status` for the `gh` result, and `gh pr view` in that checkout. If the plugin reports tokens but the row is unchanged, the client predates the feature: rerun `install-herdr-focus` and reattach |
| `C-a K` / `C-a J` does nothing | Only a linked worktree moves, within its repository and not past either end; the main checkout stays first. If `herdr config check` reports unknown `keys.move_worktree_*` keys, the installed binary predates the feature: rerun `install-herdr-focus` |
| Herdr conversation symbol stays idle while Pi works | Check `herdr integration status`; install/update with `herdr integration install pi`, then `/reload` in that Pi session once idle. `herdr agent explain <pane-id> --json` should show screen detection skipped once lifecycle reports are active; `default_known_agent_idle_fallback` means Herdr is still guessing from the screen |
| tmux statusline unstyled, plugins absent | tpm not cloned, or `C-a I` never pressed |
| `prefix + Space` does nothing | `cycle-2x2.sh` needs `python3`, and only acts on exactly 5 or 7 panes |

## Backups

StardewValley saves live at `~/.config/StardewValley/Saves` (a game, not a dotfile).
Back them up separately, e.g.:

```sh
cp -R ~/.config/StardewValley/Saves ~/Dropbox/backups/StardewValley/Saves-$(date +%F)
```
