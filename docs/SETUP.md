# Setting up and maintaining a Mac

**Status:** Operator guide. Every command here installs software or changes this
Mac's live configuration. Agents: do not run them as checks; use
[`VERIFICATION.md`](VERIFICATION.md) instead.

The short path is in the [root README](../README.md#set-up-a-new-mac):
[`dotfiles-bootstrap`](../bin/dotfiles-bootstrap) automates the numbered steps
below. This page is the manual equivalent and explains each prerequisite.

**Order matters.** Homebrew and rustup must exist *before* the first new zsh
starts. Linking must happen *before* p10k, tpm and nvim run, because they write
into directories this repository owns. Following the steps top to bottom handles
both.

## 1. Xcode Command Line Tools

```sh
xcode-select --install
```

Gives you `git`, `make`, `clang` and `python3`. Neovim needs a C compiler to build
`telescope-fzf-native` and the treesitter parsers; the tmux `prefix + Space`
binding needs `python3`.

## 2. Homebrew

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

> **Apple Silicon assumed.** `.zshrc` sources several shell plugins from
> `/opt/homebrew/share/...`. On an Intel Mac (prefix `/usr/local`), review those
> source paths; see [Troubleshooting](#troubleshooting).

## 3. Rust (before opening a new shell)

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- --no-modify-path
```

`--no-modify-path` stops rustup creating `~/.zshenv` (which would then block
linking) and editing other shell files; the linked `.zshenv` already loads Cargo.

`~/.zshenv` sources `~/.cargo/env` **unconditionally**. Skip this step and every
zsh startup prints `no such file or directory: /Users/you/.cargo/env`.

## 4. Clone the repository

```sh
brew install gh && gh auth login     # the repository is private
gh repo clone monoclonalAb/dotfiles ~/dotfiles
```

Keep the clone at `~/dotfiles`: Pi and OMP MCP configuration refers to that path.
A plain clone is correct; do **not** use `--recurse-submodules`. tpm installs the
tmux plugins (step 8), and the Alacritty Catppuccin theme is vendored.

## 5. Install the packages

```sh
brew bundle --file=~/dotfiles/Brewfile
```

See the commented [`Brewfile`](../Brewfile). Its tail has an optional block (fish,
nushell, yabai, MacTeX) that is off by default.

## 6. Node, via nvm

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | PROFILE=/dev/null bash
source "$HOME/.nvm/nvm.sh"
nvm install --lts
npm install -g @earendil-works/pi-coding-agent typescript@5
```

`PROFILE=/dev/null` keeps nvm's installer from appending to a shell file. The
global packages are Pi itself (the [`pi`](../bin/pi) wrapper execs it) and the
TypeScript fallback that [`lsp.json`](../omp/lsp.json) points at. Install them with
nvm's npm, not Homebrew's.

Most of Neovim's Mason LSPs are npm packages, and the `pwa-node` debug adapter
runs `node`. `.zshrc` already has a guarded `NVM_DIR` block.

## 7. Link everything

Preview first. On a Mac that has been used before, this *will* report conflicts:

```sh
~/dotfiles/bin/dotfiles-link check
```

It lists every link it would create or repair, then problems:

- `conflict`: the target is a real file or directory, a link pointing outside
  this repository, or sits under a directory symlink. Every folder below `$HOME`
  that holds a link must be a real directory.
- `unlisted`: a tracked file that no line in [`links`](../links) deploys.
- `stale`: a link into the repository that `links` no longer lists.

Inspect each conflict and keep anything valuable before moving it aside. These
are examples, not commands to run blindly; use an unused backup name and never
replace a previous backup:

```sh
mv ~/.zshenv ~/.zshenv.bak          # macOS ships one
mv ~/.config/nvim ~/.config/nvim.bak
```

Then link for real, and confirm:

```sh
~/dotfiles/bin/dotfiles-link apply
dotfiles-link check   # exit 0: every link in place, nothing to review
```

`apply` changes nothing while any conflict remains. It creates absolute symlinks,
repairs links that point at an old location inside this repository, and removes
links in mirrored folders whose source file is gone. Its ignore list (in the
script) keeps runtime files that may land in the checkout from being linked:
caches, Neovim's lockfile, tmux plugins, OMP's lockfile, and Pi credentials and
model cache.

## 8. Set up each tool

**zsh and prompt**

```sh
exec zsh
```

The Powerlevel10k prompt is tracked at `zsh/p10k.zsh`. `p10k configure` replaces
the link with a real file; to keep a new style, run
`mv ~/.config/zsh/.p10k.zsh ~/dotfiles/zsh/p10k.zsh && dotfiles-link apply` and
commit. `.zprofile` adds Homebrew to `PATH` (the installer's suggested
`~/.zprofile` line is never read because `ZDOTDIR` is set).

**Terminal.** Alacritty uses `JetBrainsMono Nerd Font` from the Brewfile.
**Cmd-click** a `file://` URL to open it in a new Neovim window
(**Cmd+Shift-click** inside Herdr); web links open in the browser and
**Ctrl+Shift+O** picks hints by keyboard. Pi's
[local-file-links](../pi/extensions/local-file-links/README.md) extension makes
its file links clickable.

**Theme.** Seed the shared state; see [`THEME.md`](THEME.md):

```sh
theme set latte 0.6
```

**Tailscale.** Install the `tailscale-app` cask, sign in to the existing tailnet,
and enable MagicDNS in the tailnet's DNS settings. The [`tailscale`](../bin/tailscale)
wrapper execs the app's bundled binary, so the executable keeps its
application-bundle identity.

**Herdr.** Run the Theme step first, then follow
[Herdr: install](HERDR.md#install).

**tmux (legacy fallback)**

```sh
git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
tmux
# then press C-a followed by I (capital i) to install the plugins
```

The prefix is `C-a`. `~/.config/tmux/plugins/` is gitignored; tpm owns it.

**Neovim**

```sh
nvim
```

The first launch bootstraps lazy.nvim, then Mason installs the configured LSPs,
linters, formatters, Java tooling and debug adapters. Node/npm must exist first
(step 6). Mason also supplies TypeScript Tools' `tsserver`. The Tree-sitter
installer needs `tree-sitter-cli` from the Brewfile.
`lazy-lock.json` is gitignored, so a fresh install pulls the latest stable version
of every plugin.

**git.** The `git` folder links [`~/.config/git/config`](../git/config) (name,
email, `init.defaultBranch`) and the global `ignore` file. Keep `~/.gitconfig`
absent: when it exists, `git config --global` writes there instead of the tracked
file. Credentials use the system `osxkeychain` helper; `gh auth login` can add
itself as GitHub's helper. Run `git lfs install` only if you need LFS; it records
its filter in the tracked config.

**AeroSpace.** Launch it once and grant Accessibility in System Settings → Privacy
& Security. It already starts at login.

## 9. Verify

```sh
exec zsh                 # no errors printed
ls                       # colourised, dirs first: gls/coreutils works
echo $ZDOTDIR            # /Users/you/.config/zsh: .zshenv is linked
nvim +checkhealth        # lazy/mason/treesitter all green
herdr config check       # config parses and every custom key is valid
```

## What carries over, and what does not

Carried over: every linked file, including Pi's settings, models and MCP servers,
the p10k prompt and the git identity.

Not carried over, and never stored here:

- Credentials and sign-ins: `~/.pi/agent/auth.json`, gcloud, `~/.ssh`, gh's
  `hosts.yml`, github-copilot.
- `~/.config/mcp/mcp.json`, machine-local LaunchAgents, and other agent CLIs'
  settings (Claude Code, Codex, Gemini, opencode, cmux).
- App state: Herdr sessions, logs, plugin state and generated `config.toml`;
  raycast, launchpad, StardewValley, the Obsidian vault.
- The [personal bits](#personal-bits) below.

[`.gitignore`](../.gitignore) and the ignore list in
[`dotfiles-link`](../bin/dotfiles-link) cover known outputs, not every possible
secret filename. Inspect unexpected files and `git status` before committing,
without printing credential contents.

## Personal bits

These are hardcoded to one machine and user. Missing targets fail quietly except
Cargo. Fix or delete them on a new machine.

| Where | What | Do what |
|---|---|---|
| `zsh/zshenv` | `. "$HOME/.cargo/env"` | install rustup (step 3); this one **does** error at startup |
| `zsh/zshrc`, `pmd` alias | `$HOME/pmd-bin-7.16.0` | unzip PMD 7.16.0 there, or drop the alias |
| `zsh/zshrc`, `life`/`todo`/`resumes` aliases | `~/Desktop/life`, `~/Desktop/resumes` | create the dirs, or drop the aliases |
| `zsh/zshrc`, `prosperity` alias | `/Users/ericzheng/Desktop/prosperity/…` | drop it; old project |
| `zsh/zshrc`, PATH block | `/Library/TeX/texbin`, `/usr/local/share/dotnet` | harmless if absent |
| `zsh/zshrc`, conda block | `/opt/anaconda3` | install Anaconda there, or delete the block |
| `.archive/fish/config.fish` | the same conda block | ditto |
| `nvim/lua/plugins/obsidian.lua` | loads only when `~/Documents/obsidian` exists | create the vault there; plain Markdown works without it |
| `pi/mcp.json`, `omp/{mcp,lsp,dap}.json` | absolute `/Users/eric/...` paths (JSON cannot expand `~`) | same username and clone path: nothing; otherwise `dotfiles-bootstrap` lists the files to edit |

## Optional extras

Not installed by the Brewfile; add them only if you want the feature.

- **MacTeX + Skim:** `brew install --cask mactex-no-gui` (Skim is in the
  Brewfile). Needed for `vimtex`.
- **Anaconda** at `/opt/anaconda3`, for the conda blocks.
- **PMD 7.16.0** in `~/pmd-bin-7.16.0`, for the `pmd` alias.
- **.NET SDK:** `.zshrc` puts `/usr/local/share/dotnet` on `PATH`.
- **Claude Code CLI:** `.zshrc` aliases `claude` with
  `--dangerously-skip-permissions`. Drop the alias if you would rather be asked.
- **direnv:** `brew install direnv`. `.zshrc` hooks it only when installed, so
  `.envrc` files load on `cd` after `direnv allow`. A new shell loads its starting
  directory's `.envrc` silently (to avoid p10k's instant-prompt warning), so
  errors there are not shown.
- **conducterm:** `tmux.conf` sources `~/.conducterm/conducterm.tmux` quietly.
  Alacritty's `option_as_alt = "Both"` exists for its keybindings.

## Archived configurations

`.archive/` holds inactive `fish`, `neofetch`, `yabai`, `skhd`, `wezterm` and
`yazi` configs in the same flat layout. Each belongs in `~/.config/<tool>/`. Only
touch `.archive/` when explicitly restoring or retiring a tool.

To restore one, move it to the top level, give it a `links` line, then preview
and apply:

```sh
git mv .archive/yazi yazi
printf '%s\n' 'yazi/           ~/.config/yazi/' >> links
dotfiles-link check && dotfiles-link apply
```

To retire an active tool, do the reverse: list and remove its links (see the
[root README](../README.md#add-move-or-remove-files)), delete its `links` line,
then `git mv <tool> .archive/<tool>`.

`fish` contains only a conda block, and fastfetch replaces `neofetch`. Restoring
`yabai` needs its scripting addition (`yabai --load-sa`), which requires partially
disabling SIP and a passwordless sudoers entry.

## Updating: special cases

The normal path is `dotfiles-update`; see the
[root README](../README.md#update-this-mac).

**Clone too old to have `dotfiles-update`.** Pull once by hand; after that it is
on `PATH`:

```sh
cd ~/dotfiles && git pull --ff-only && ./bin/dotfiles-update
```

**Machine still on the old Stow layout** (links point into
`<tool>/.config/<tool>/`). Do not use its old `dotfiles-update`: that copy keeps
running after the pull and calls Stow on the new flat tree. Instead:

```sh
cd ~/dotfiles && git pull --ff-only
./bin/dotfiles-link check     # expect only `repair` and `create` lines
./bin/dotfiles-link apply
```

If the old updater already ran, run the same two `dotfiles-link` commands.
`brew uninstall stow` is optional.

**Machine set up before Herdr's Pi integration existed.** Run
`herdr integration install pi` once, then `/reload` in each idle Pi conversation.
`dotfiles-link` does not install Herdr integrations; confirm with
`herdr integration status`.

## Troubleshooting

Herdr problems are in [`HERDR.md`](HERDR.md#troubleshooting); theme problems in
[`THEME.md`](THEME.md).

| Symptom | Cause and fix |
|---|---|
| `. "$HOME/.cargo/env": no such file or directory` on every prompt | rustup missing (step 3) |
| `no such file or directory: /opt/homebrew/share/powerlevel10k/…` | `brew bundle` did not run; or an Intel Mac, where `.zshrc`'s Homebrew `source` paths need `/usr/local/share/...` |
| `gls: command not found` from the `ls` alias | `brew install coreutils` |
| Boxes instead of icons | Nerd Font not installed, or not selected in the terminal |
| `dotfiles-link: changed nothing` with `conflict` lines | something occupies the target; inspect it, move it aside and rerun ([step 7](#7-link-everything)) |
| Telescope `live_grep` returns nothing | `ripgrep` missing |
| Tree-sitter errors on every Neovim start | `tree-sitter-cli` missing; run `brew bundle` and restart Neovim |
| Web LSPs or TypeScript fail to start | Node/npm missing; source `~/.nvm/nvm.sh`, `nvm install --lts`, restart Neovim |
| tmux status line unstyled, plugins absent | tpm not cloned, or `C-a I` never pressed |
| tmux `prefix + Space` does nothing | `cycle-2x2.sh` needs `python3`, and acts only on exactly 5 or 7 panes |

## Backups

StardewValley saves live in `~/.config/StardewValley/Saves` (game data, not a
dotfile). Back them up separately, for example:

```sh
cp -R ~/.config/StardewValley/Saves ~/Dropbox/backups/StardewValley/Saves-$(date +%F)
```
