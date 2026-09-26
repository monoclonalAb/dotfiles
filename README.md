# dotfiles

My macOS dotfiles, managed with [GNU Stow](https://www.gnu.org/software/stow/).

Each active top-level folder is a **Stow package** that mirrors its real path under
`$HOME`, except `docs/`, which is deliberately excluded from deployment. The
[`.stowrc`](.stowrc) uses `--no-folding`: parent directories remain real and managed
files become symlinks. Content edits here can therefore change live configuration
immediately — no copy or restow is needed for an already-linked file.

```text
nvim/.config/nvim/init.lua  --stow--> ~/.config/nvim/init.lua  (file symlink)
zsh/.config/zsh/.zshrc      --stow--> ~/.config/zsh/.zshrc      (file symlink)
zsh/.zshenv                --stow--> ~/.zshenv               (sets ZDOTDIR)
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

**Order matters.** Homebrew and rustup have to be in place *before* the first new zsh
starts, and `stow` has to run *before* p10k / tpm / nvim, because those write into
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
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

`~/.zshenv` sources `~/.cargo/env` **unconditionally**. Skip this step and every single
zsh startup — including the ones the steps below trigger — prints
`no such file or directory: /Users/you/.cargo/env`.

### 4. Clone the repo

```sh
git clone https://github.com/monoclonalAb/dotfiles ~/dotfiles
```

A plain clone is correct — **no `--recurse-submodules`**. The tmux plugin submodules were
removed when this repo moved to Stow; tpm installs them now (step 8). The Catppuccin
theme for Alacritty is vendored into the repo, so it needs nothing at install time.

### 5. Install the packages

```sh
brew bundle --file=~/dotfiles/Brewfile
```

See [`Brewfile`](Brewfile) — it's commented, and the tail has an optional block (fish,
nushell, yabai, MacTeX) that's off by default.

### 6. Node, via nvm

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source "$HOME/.nvm/nvm.sh"
nvm install --lts
```

Most of the Mason LSPs (`html`, `cssls`, `tailwindcss`, `jsonls`, `yamlls`) are npm
packages, and the `pwa-node` debug adapter shells out to `node`. `.zshrc` already has the
`NVM_DIR` block, guarded — it's a no-op if nvm isn't there.

### 7. Link everything

Dry-run first. On a Mac that has already been used, this *will* report conflicts:

The repository `.stowrc` disables directory folding. Stow creates real parent
directories and links only managed files, so app-written runtime state such as Pi
credentials and generated extensions stays outside this repository.

```sh
cd ~/dotfiles
stow -n -v -t "$HOME" */
```

A conflict means a target is occupied by an unmanaged file/directory or a
conflicting link. Inspect it and preserve anything valuable before moving it
aside and re-running. The following are examples, not unconditional commands;
use an unused backup name and never replace a previous backup:

```sh
mv ~/.zshenv ~/.zshenv.bak          # macOS ships one
mv ~/.config/nvim ~/.config/nvim.bak
```

Then link for real:

```sh
stow -t "$HOME" */
```

`*/` only matches non-hidden directories, so `README.md`, `Brewfile`, `.stowrc`, and
the archived `.archive/` packages are skipped automatically. The `.stowrc` ignore rules
also keep runtime state local: Zsh history and sessions, Neovim's lockfile, tmux
plugins, OMP's lockfile, and Pi credentials and model cache.
Tracked configuration remains as individual symlinks inside real directories.

Check it landed:

```sh
ls -la ~/.config    # managed files inside these real directories are symlinks
```

### 8. Set up each tool

**zsh + prompt**

```sh
exec zsh
p10k configure
```

Writes `~/.p10k.zsh`, which is deliberately **not** in this repo (it's 89 KB of generated
config). `.zshrc` sources it only if present, so the shell works — plainly — before you
run this.

**Terminal** — Alacritty is configured and asks for `JetBrainsMono Nerd Font`, installed
by the Brewfile. **Cmd-click** a `file://` URL to open it in a new Neovim window
(**Cmd+Shift-click** inside Herdr); web links still open in the browser and
**Ctrl+Shift+O** picks hints by keyboard. Pi's
[local-file-links](pi/.pi/agent/extensions/local-file-links/README.md) extension makes
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
the tailnet's DNS settings. The cask ships no `tailscale` command on `PATH`; use this wrapper
instead of a symlink so the executable keeps its application-bundle identity:

```sh
printf '%s\n' '#!/bin/sh' 'exec /Applications/Tailscale.app/Contents/MacOS/Tailscale "$@"' \
  > ~/.local/bin/tailscale
chmod +x ~/.local/bin/tailscale
```

**Herdr**

Herdr's runtime `config.toml` is generated from `config.base.toml` by `theme`, so
run the Theme step above first. This repo builds Herdr from upstream v0.9.1
(`065ef9d6a531c49fb8bee7e818ef837065b21ee9`) plus
[`herdr-0.9.1-focused-pane.patch`](herdr/.config/herdr/patches/herdr-0.9.1-focused-pane.patch),
which adds:

- heavy focused-pane borders and attention chrome: blocked panes use the palette's
  red, finished-but-unreviewed panes peach, both at midpoint opacity; other inactive
  panes blend toward the terminal background (`ui.unfocused_pane_opacity`);
- a single **Spaces tree** sidebar (`ui.sidebar.spaces.inline_agents = true`):
  repository → worktree Space → conversations. Click a repository to fold it, or a
  Space's status counts to show/hide its conversations;
- the reserved `sidebar_hidden` Space token that spaces-env uses to hide the other
  environment (the focused Space always stays visible);
- `keys.next_machine` / `keys.previous_machine` for switching between saved machines.

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
| `C-a t` | Start a [Pi task](herdr/.config/herdr/plugins/task-launcher/README.md) in a new worktree Space |
| `C-a v` | Review the focused agent's uncommitted changes in tuicr and send the comments back |
| `C-a ;` / `C-a :` | Toggle Personal/Work / send the current Space to the other environment |
| `C-a '` | Switch this client to the next online machine (e.g. the saved `home`) |

**Agent state.** The official Pi and OMP integrations report lifecycle state; without
them Herdr guesses from screen text. After `herdr integration install …`, `/reload`
idle sessions. The next-agent plugin keeps a per-pane ledger shown as `◐` working,
`◆` blocked/needs input, `●` finished but unreviewed and `○` idle/reviewed. Focusing
a pane (hotkey, click, or pane body) marks it reviewed; split siblings keep their own
state. It also sounds the active-tab OMP prompts Herdr's own toasts skip. Its settings
live in `~/.config/herdr/plugins/config/<plugin-id>/config.toml`.
Conversation rows use OMP's terminal title, or for Pi the
[`herdr-task-summary`](pi/.pi/agent/extensions/herdr-task-summary/summary.ts) token: a
2–6-word title generated in the background by a small, tool-free request to the
selected model (this uses provider quota). A letter-scramble animation shows while it
is pending; failures keep the previous title.

**Reviewing changes.** `C-a v` runs [`herdr-review`](bin/.local/bin/herdr-review), which
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

**git identity** — not managed by this repo, so create `~/.gitconfig` by hand:

```ini
[user]
	name = Your Name
	email = you@example.com
[credential]
	helper = store
[filter "lfs"]
	smudge = git-lfs smudge -- %f
	process = git-lfs filter-process
	required = true
	clean = git-lfs clean -- %f
```

`helper = store` writes credentials to `~/.git-credentials` **in plaintext**. Swap it for
`osxkeychain` if that bothers you.

(The `git/` stow package only carries a global ignore file, at `~/.config/git/ignore`.
Git picks that up via XDG automatically — no `core.excludesfile` needed.)


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
inspect its runtime files before migrating it. Do not use `stow --adopt` or copy
app state into Git to resolve a conflict.

## Personal bits — edit or skip

These are hardcoded to one machine and one user. Nothing here breaks the shell if the
target is missing (aliases and PATH entries fail lazily), but they're dead weight on a new
machine. Fix or delete as you go.

| Where | What | Do what |
|---|---|---|
| `zsh/.zshenv` — Cargo environment | `. "$HOME/.cargo/env"` | install rustup (step 3) — this one **does** error at startup |
| `zsh/.config/zsh/.zshrc` — `pmd` alias | `$HOME/pmd-bin-7.16.0` | unzip PMD 7.16.0 there, or drop the alias |
| `zsh/.config/zsh/.zshrc` — `life`, `todo`, `resumes` aliases | `~/Desktop/life`, `~/Desktop/resumes` | create the dirs, or drop the aliases |
| `zsh/.config/zsh/.zshrc` — `prosperity` alias | `/Users/ericzheng/Desktop/prosperity/…` | drop it — absolute path, old project |
| `zsh/.config/zsh/.zshrc` — PATH block | `/Library/TeX/texbin`, `/usr/local/share/dotnet` | harmless if absent; they're just PATH entries |
| `zsh/.config/zsh/.zshrc` — conda initialisation | conda block at `/opt/anaconda3` | install Anaconda there, or delete the block |
| `.archive/fish/.config/fish/config.fish` | the same conda block | ditto |
| `nvim/.config/nvim/lua/plugins/obsidian.lua` | Obsidian integration loads only when `~/Documents/obsidian` exists | create your vault there; ordinary Markdown works without one |

## Optional extras

Not installed by the Brewfile; add them only if you want the feature.

- **MacTeX + Skim** — `brew install --cask mactex-no-gui` (Skim is already in the Brewfile).
  Needed for `vimtex`; the viewer config is macOS-only.
- **Anaconda** at `/opt/anaconda3` — for the conda blocks in `.zshrc` and archived
  `.archive/fish/.config/fish/config.fish`.
- **PMD 7.16.0** — unzip into `~/pmd-bin-7.16.0` for the `pmd` alias.
- **.NET SDK** — `.zshrc` puts `/usr/local/share/dotnet` on PATH.
- **Claude Code CLI** — `.zshrc` aliases `claude` with `--dangerously-skip-permissions`.
  Drop the alias if you'd rather be asked.
- **conducterm** — `tmux.conf` sources `~/.conducterm/conducterm.tmux` with `-q`, so its
  absence is completely silent. Alacritty's `option_as_alt = "Both"` exists for its
  keybindings.

### Window managers

This repo actively uses one tiling WM:

- **AeroSpace** — the current one. Installed by the Brewfile, config at
  `~/.config/aerospace/aerospace.toml`, starts at login.

## Archived configurations

The complete `fish`, `neofetch`, `yabai`, `skhd`, `wezterm`, and `yazi` Stow packages
are kept under `.archive/`; they are not active configurations. Because `.archive/` is
hidden, the default `*/` workflow omits it.

Restore or remove exactly one archived package without moving it:

```sh
stow -d .archive -t "$HOME" <package>
stow -D -d .archive -t "$HOME" <package>
```

`fish` contains only a conda init block, and fastfetch replaces `neofetch`. The archived
`yabai` and `skhd` configs are legacy; before restoring `yabai`, its scripting addition
(`yabai --load-sa`, called by `yabairc`) requires partially disabling SIP and a
passwordless sudoers entry.

## What's managed vs. left alone

| Managed (stow packages) | Left in `~/.config` (real dirs, untracked) |
|---|---|
| nvim, herdr, tmux, zsh (+`~/.zshenv`), alacritty, ghostty, aerospace, git, gh (`config.yml` only), tuicr, bin, omp, pi | **Games:** StardewValley, Battle.net · **Secrets/app-state:** gh credentials (`hosts.yml`), github-copilot, gsheets, mcp-google-sheets, assistant, cagent, launchpad · **Skipped:** uv (receipt), mpv (empty), raycast |


Secrets and runtime state must remain outside this repo. With leaf linking,
new app-written files normally stay in real `$HOME` directories rather than
landing in the checkout. [`.gitignore`](.gitignore) and [`.stowrc`](.stowrc) cover
specific known outputs, not every possible secret filename. Older folded links
or a misconfigured writer can still leak state: inspect unexpected files and
`git status` before committing, without dumping credential contents.

## Theme toggle

Alacritty, Herdr, tmux, Neovim and Pi share Catppuccin, with terminal opacity driven by
`bin/.local/bin/theme` (on `PATH` via `~/.local/bin`).

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

Pi's [theme-sync extension](pi/.pi/agent/extensions/theme-sync/README.md) polls the
same state and follows it within about half a second, overriding Pi's own `/settings`
theme without rewriting it.

**Alacritty's theme-driven keys must stay out of `alacritty.toml`.** Its `import` list is
merged with the *importing* file last, so a key set in `alacritty.toml` itself overrides
the generated overlay rather than being overridden by it. `window.opacity` and
`window.decorations_theme_variant` therefore live in
`alacritty/.config/alacritty/window-theme-defaults.toml` (imported before the state file),
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

### Extensions and prompts

Global extensions live in [`pi/.pi/agent/extensions/`](pi/.pi/agent/extensions/);
read its [policy](pi/.pi/agent/extensions/README.md) before adding anything that
touches model context.

| Extension | Adds |
| --- | --- |
| `selective-skills.ts` | `/skill` enables skills per session (the [`pi`](bin/.local/bin/pi) wrapper passes `--no-skills`) |
| `session-controls.ts` | `/clear` and `/drop` |
| `copy-prompt.ts` | `alt+shift+c` copies the draft |
| [`modal-vim-navigation`](pi/.pi/agent/extensions/modal-vim-navigation/README.md) | Vim navigation of the fullscreen transcript; clipboard images as `[img #N]` (Ctrl+V / Cmd+V); Ctrl+C copies the draft it clears |
| [`agent-stuff`](pi/.pi/agent/extensions/agent-stuff/README.md) | `/review`, `/end-review`, `/answer` (Ctrl+.), `/btw`, `/goal`, `/session-breakdown` from mitsuhiko/agent-stuff |
| `long-context` | `/long-context` switches GPT-5.6 / GPT-6 Astra to the 1.05M window (long-context pricing above 272K) |
| [`codex-fast`](pi/.pi/agent/extensions/codex-fast/README.md) | `/fast` requests the priority tier for Codex models (uses more credits) |
| [`quota-footer`](pi/.pi/agent/extensions/quota-footer/README.md) | Codex (blue) and Claude (yellow) usage in the footer; `/usage` for every saved account |
| [`quota-router`](pi/.pi/agent/extensions/quota-router/README.md) | `/accounts` and `/route`: park a second login and continue on it when one hits a usage limit |
| [`compact-ui`](pi/.pi/agent/extensions/compact-ui/README.md) | One-line startup header (enable **Quiet startup** in `/settings`) and an `MCP: N/M` footer |
| [`theme-sync`](pi/.pi/agent/extensions/theme-sync/README.md) | Follows the shared Catppuccin flavour |
| [`local-file-links`](pi/.pi/agent/extensions/local-file-links/README.md) | Clickable file links that open in Neovim |
| `herdr-task-summary` | Conversation titles in the Herdr sidebar (small model request per task) |
| [`omp-anthropic-route`](pi/.pi/agent/extensions/omp-anthropic-route/README.md) | Claude OAuth requests in OMP's reviewed shape (below) |

Prompt templates in [`pi/.pi/agent/prompts/`](pi/.pi/agent/prompts/) run only when
invoked: `/discuss` (interview, then an implementation-ready summary), `/eli5 <topic>`
(a throwaway visual HTML explainer), `/domain-first [scope]`, `/test-sweep [scope]`
and `/feedback [correction]`.

**Claude via OMP.** The first direct Claude OAuth request after starting Pi or
`/reload` automatically checks/updates Homebrew `omp` to the latest stable release,
then sends one small synthetic request to verify the requested model (uses quota).
Later requests reuse the check. CLI updates trust upstream binaries but permit only
version/hash changes in a reviewed formula recipe; bridge code stays pinned.
Formula changes or failed checks block instead of falling back. Startup, model
selection and reload are passive; API keys, proxies and other providers are
untouched. `/omp-anthropic-route` shows the cached status. See the
[request preflight](pi/.pi/agent/extensions/omp-anthropic-route/README.md#request-preflight)
for guards and recovery.

### MCP servers

Pi loads MCP servers through `pi-mcp-adapter` (listed in `~/.pi/agent/settings.json`),
merging in rising precedence:

| File | Owner | Use |
| --- | --- | --- |
| `~/.config/mcp/mcp.json` | Host-local, **not** in this repository | Hosted OAuth/token servers (Linear, Notion, Penpot); may hold secrets |
| [`pi/.pi/agent/mcp.json`](pi/.pi/agent/mcp.json) → `~/.pi/agent/mcp.json` | This repository | Managed global servers below |
| `<repo>/.pi/mcp.json` | Each project | Overrides; `/mcp enable` / `/mcp disable` write here |

Confirm changes with `/reload` then `/mcp`.

- **gcloud** and **gcp-observability** use the same pinned packages as OMP and start
  on demand (needs `npx` and the gcloud CLI). gcloud is read-only only because of
  the `-c` [allowlist](omp/.omp/agent/gcloud-mcp-allowlist.json); keep it. Neither
  restricts projects: they use your Google IAM, so pass explicit project IDs. The
  host-local `~/Desktop/projects/DE/.pi/mcp.json` connects both eagerly there. If
  auth has expired, run `gcloud auth login` and `gcloud auth application-default
  login`, then `/mcp reconnect <server>`. Calling `run_gcloud_command` with
  `{"args":["version"]}` must be rejected by the allowlist.
- **paper** connects to Paper Desktop at `http://127.0.0.1:29979/mcp` when a file
  is open. It can edit the open design.
- **workspace-context** is this repository's own read-only index of every repository
  under `~/Desktop/projects` and `~/dotfiles`
  ([README](bin/.local/lib/workspace-context-mcp/README.md)). It runs
  `~/.local/bin/workspace-context-mcp serve`, so the `bin` package must be stowed;
  `workspace-context-mcp doctor` inspects it without an agent. OMP enables it too.
  It is disabled for this repository in [`.pi/mcp.json`](.pi/mcp.json).

## omp agent tooling

[`omp/.omp/agent/mcp.json`](omp/.omp/agent/mcp.json) is an opt-in catalogue except
for the globally enabled read-only `gcloud`, `gcp-observability`, and local
[`workspace-context`](bin/.local/lib/workspace-context-mcp/README.md) servers.
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
| Local workspace context | — | [`workspace-context`](bin/.local/lib/workspace-context-mcp/README.md) (this repo, read-only stdio) | Pi global (`pi/.pi/agent/mcp.json`); also OMP global |
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
[OMP tooling catalogue](omp/.omp/agent/TOOLING.md).

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

It fast-forwards from origin, restows every package, then runs `brew bundle` and
`theme apply` when their inputs changed and reloads tmux when its config changed.
Slow or disruptive follow-ups are printed instead of run: rebuilding the patched
Herdr binary (`install-herdr-focus`) and restarting the shell. It never rewrites
local commits or uncommitted changes; when the pull cannot fast-forward it stops
and says so. It warns about a dirty worktree but does **not** refuse to restow it:
uncommitted package changes can therefore become deployed. Do not run it during
another task's unfinished work.

Machines set up before the Pi status integration was added also need
`herdr integration install pi` once, then `/reload` in each existing idle Pi conversation.
Stow does not install Herdr-owned integrations; confirm them with `herdr integration status`.

On a clone too old to have the script yet, pull once by hand and run it from the
repo — after that it is on `PATH` as usual:

```sh
cd ~/dotfiles && git pull --ff-only && ./bin/.local/bin/dotfiles-update
```

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
cd ~/dotfiles
stow -t "$HOME" nvim        # (re)link one package
stow -D -t "$HOME" nvim     # unlink a package (then it can be moved back to a real dir)
stow -n -v -t "$HOME" nvim  # dry-run: preview link actions / conflicts
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| `. "$HOME/.cargo/env": no such file or directory` on every prompt | rustup missing — step 3 |
| `no such file or directory: /opt/homebrew/share/powerlevel10k/…` | `brew bundle` didn't run; or Intel Mac — review the hardcoded Homebrew `source` paths in `.zshrc` for `/usr/local/share/...` |
| `gls: command not found` from the `ls` alias | `brew install coreutils` |
| Boxes / tofu instead of icons | Nerd Font not installed, or not selected in the terminal |
| `stow: WARNING! stowing X would cause conflicts` | a real file/dir occupies the target — `mv` it aside and re-run |
| Telescope `live_grep` returns nothing, silently | `ripgrep` missing |
| Tree-sitter errors on every startup | `tree-sitter-cli` missing — run `brew bundle` and restart Neovim |
| Web LSPs or TypeScript fail to start | Node/npm missing — source `~/.nvm/nvm.sh`, run `nvm install --lts`, and restart Neovim |
| Herdr ignores a config edit | Run `herdr server reload-config`, or press `C-a R` |
| `C-a '` says `home is not ready` or `no other machine is saved` | Save the machine with `herdr machine add <ssh-target> --label home` and check `herdr machine list --json`. A stock client (`herdr --version` without the patch) has no `next_machine` key: rerun `install-herdr-focus` |
| Herdr conversation symbol stays idle while Pi works | Check `herdr integration status`; install/update with `herdr integration install pi`, then `/reload` in that Pi session once idle. `herdr agent explain <pane-id> --json` should show screen detection skipped once lifecycle reports are active; `default_known_agent_idle_fallback` means Herdr is still guessing from the screen |
| tmux statusline unstyled, plugins absent | tpm not cloned, or `C-a I` never pressed |
| `prefix + Space` does nothing | `cycle-2x2.sh` needs `python3`, and only acts on exactly 5 or 7 panes |

## Backups

StardewValley saves live at `~/.config/StardewValley/Saves` (a game, not a dotfile).
Back them up separately, e.g.:

```sh
cp -R ~/.config/StardewValley/Saves ~/Dropbox/backups/StardewValley/Saves-$(date +%F)
```
