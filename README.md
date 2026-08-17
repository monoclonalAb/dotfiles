# dotfiles

My macOS dotfiles, managed with [GNU Stow](https://www.gnu.org/software/stow/).

Each top-level folder is a **stow package** that mirrors its real path under `$HOME`.
Stowing a package symlinks it into place, so the files here *are* the live config —
no more copy-drift.

```
dotfiles/nvim/.config/nvim/…   --stow-->   ~/.config/nvim   (symlink)
dotfiles/zsh/.config/zsh/…     --stow-->   ~/.config/zsh    (symlink)
dotfiles/zsh/.zshenv           --stow-->   ~/.zshenv        (symlink, sets ZDOTDIR)
```

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

> **Apple Silicon assumed.** `.zshrc` hardcodes `/opt/homebrew/share/...` in four
> `source` lines. On an Intel Mac (prefix `/usr/local`) you have to edit those by hand —
> see [Troubleshooting](#troubleshooting).

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
nvm install --lts
```

Most of the Mason LSPs (`html`, `cssls`, `tailwindcss`, `jsonls`, `yamlls`) are npm
packages, and the `pwa-node` debug adapter shells out to `node`. `.zshrc` already has the
`NVM_DIR` block, guarded — it's a no-op if nvm isn't there.

### 7. Link everything

Dry-run first. On a Mac that has already been used, this *will* report conflicts:

```sh
cd ~/dotfiles
stow -n -v -t "$HOME" */
```

Anything it complains about is a real file or directory sitting where a symlink needs to
go. Move each one aside and re-run:

```sh
mv ~/.zshenv ~/.zshenv.bak          # macOS ships one
mv ~/.config/nvim ~/.config/nvim.bak
```

Then link for real:

```sh
stow -t "$HOME" */
```

`*/` only matches directories, so `README.md` and `Brewfile` are skipped automatically.
Because the targets don't exist yet, stow *folds* each package into a single symlink —
you get `~/.config/nvim -> ../dotfiles/nvim/.config/nvim`, not one link per file.

Check it landed:

```sh
ls -la ~/.config    # the managed ones are symlinks -> ../dotfiles/...
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

**tmux**

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

First launch bootstraps lazy.nvim, then Mason pulls the LSPs and linters. Two things
Mason will *not* do on its own:

- **Formatters.** `conform.lua` calls `stylua`, `black`, `isort` and `prettierd`, but none
  are in an `ensure_installed` list. Until you `:Mason` them, format-on-save quietly falls
  back to the LSP formatter instead of erroring.
- **Java.** `:Mason` install `jdtls`, `java-debug-adapter` and `java-test`.

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

**Terminal** — Alacritty and WezTerm are both configured; pick one and make it your
default. Both ask for `JetBrainsMono Nerd Font`, installed by the Brewfile.

**Theme** — seed the shared Catppuccin state, which Alacritty, tmux and Neovim all read
(see [Theme toggle](#theme-toggle)):

```sh
theme set latte 0.6
```

Until this runs, each app falls back to its own default and Alacritty logs a missing-import
error to `$TMPDIR/Alacritty-*.log` — harmless, and this clears it.

**AeroSpace** — launch it once and grant Accessibility in System Settings → Privacy &
Security. `start-at-login = true` is already in the config.

### 9. Verify

```sh
exec zsh                 # no errors printed
ls                       # colourised, dirs first  => gls/coreutils works
echo $ZDOTDIR            # /Users/you/.config/zsh   => .zshenv is linked
nvim +checkhealth        # lazy/mason/treesitter all green
tmux                     # statusline renders with icons, not tofu
```

## The rule (how to tell what's managed)

In `~/.config`, **a symlink = managed by this repo**; **a real directory = not managed**
(games, app state, and secret-bearing tool configs, which are deliberately left in place).

```sh
ls -la ~/.config    # symlinks -> ../dotfiles/... are the managed dotfiles
```

## Personal bits — edit or skip

These are hardcoded to one machine and one user. Nothing here breaks the shell if the
target is missing (aliases and PATH entries fail lazily), but they're dead weight on a new
machine. Fix or delete as you go.

| Where | What | Do what |
|---|---|---|
| `zsh/.zshenv:2` | `. "$HOME/.cargo/env"` | install rustup (step 3) — this one **does** error at startup |
| `zsh/.config/zsh/.zshrc:12` | `$HOME/pmd-bin-7.16.0` | unzip PMD 7.16.0 there, or drop the alias |
| `zsh/.config/zsh/.zshrc:16-18` | `~/Desktop/life`, `~/Desktop/resumes` | create the dirs, or drop the aliases |
| `zsh/.config/zsh/.zshrc:24` | `/Users/ericzheng/Desktop/prosperity/…` | drop it — absolute path, old project |
| `zsh/.config/zsh/.zshrc:30` | `/Library/TeX/texbin`, `/usr/local/share/dotnet` | harmless if absent; they're just PATH entries |
| `zsh/.config/zsh/.zshrc:36-49` | conda block at `/opt/anaconda3` | install Anaconda there, or delete the block |
| `fish/.config/fish/config.fish` | the same conda block | ditto |
| `nvim/.config/nvim/lua/plugins/obsidian.lua:23` | `/Users/ericzheng/Documents/obsidian` | point it at your vault |

## Optional extras

Not installed by the Brewfile; add them only if you want the feature.

- **MacTeX + Skim** — `brew install --cask mactex-no-gui` (Skim is already in the Brewfile).
  Needed for `vimtex`; the viewer config is macOS-only.
- **Anaconda** at `/opt/anaconda3` — for the conda blocks in `.zshrc` / `config.fish`.
- **PMD 7.16.0** — unzip into `~/pmd-bin-7.16.0` for the `pmd` alias.
- **.NET SDK** — `.zshrc` puts `/usr/local/share/dotnet` on PATH.
- **Claude Code CLI** — `.zshrc` aliases `claude` with `--dangerously-skip-permissions`.
  Drop the alias if you'd rather be asked.
- **conducterm** — `tmux.conf` sources `~/.conducterm/conducterm.tmux` with `-q`, so its
  absence is completely silent. Alacritty's `option_as_alt = "Both"` exists for its
  keybindings.

### Window managers

This repo carries configs for **two** tiling WMs whose alt-bindings collide. Run one:

- **AeroSpace** — the current one. Installed by the Brewfile, config at
  `~/.config/aerospace/aerospace.toml`, starts at login.
- **yabai + skhd** — legacy, kept for reference; neither binary is installed. Before going
  back: yabai's scripting addition (`yabai --load-sa`, which `yabairc` calls) requires
  **partially disabling SIP** plus a passwordless sudoers entry. That's the cost of entry.

## What's managed vs. left alone

| Managed (stow packages) | Left in `~/.config` (real dirs, untracked) |
|---|---|
| nvim, tmux, zsh (+`~/.zshenv`), fish, alacritty, wezterm, aerospace, yabai, skhd, yazi, neofetch, git, bin | **Games:** StardewValley, Battle.net · **Secrets/app-state:** gh, github-copilot, gsheets, mcp-google-sheets, assistant, cagent, launchpad · **Skipped:** uv (receipt), mpv (empty), raycast |

Two packages are kept but no longer load-bearing: **`neofetch/`** (fastfetch is what's
actually installed now) and **`fish/`** (contains only a conda init block).

Secrets never enter this repo: token/history files (`access_tokens.md`, `.zsh_history`,
`hosts.yml`, `token.json`, `auth.db`, …) are gitignored or live in untracked dirs. Note the
mechanism — because `~/.config/zsh` is a symlink *into* the repo, files zsh writes at
runtime land physically inside the working tree. They're kept out of git by the `**` globs
in `.gitignore`, not by living elsewhere. Check `git status` before committing.

## Theme toggle

Alacritty, tmux and Neovim share one Catppuccin flavour and one opacity, driven by
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
hotkey never dirties `git status`. The repo keeps latte/0.6 as its committed default; each
app falls back to that when the state dir is missing. Changes reach Alacritty via
`live_config_reload`, tmux via `source-file`, and every running Neovim over RPC (plus a
`FocusGained` fallback). New windows read the state on startup.

Below 1.0 opacity, Neovim also turns on `transparent_background` so the terminal shows
through; at 1.0 it paints its own background.

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
| `no such file or directory: /opt/homebrew/share/powerlevel10k/…` | `brew bundle` didn't run; or Intel Mac — edit the four `source` lines in `.zshrc` to `/usr/local/share/...` |
| `gls: command not found` from the `ls` alias | `brew install coreutils` |
| Boxes / tofu instead of icons | Nerd Font not installed, or not selected in the terminal |
| `stow: WARNING! stowing X would cause conflicts` | a real file/dir occupies the target — `mv` it aside and re-run |
| Telescope `live_grep` returns nothing, silently | `ripgrep` missing |
| tmux statusline unstyled, plugins absent | tpm not cloned, or `C-a I` never pressed |
| `prefix + Space` does nothing | `cycle-2x2.sh` needs `python3`, and only acts on exactly 5 or 7 panes |

## Backups

StardewValley saves live at `~/.config/StardewValley/Saves` (a game, not a dotfile).
Back them up separately, e.g.:

```sh
cp -R ~/.config/StardewValley/Saves ~/Dropbox/backups/StardewValley/Saves-$(date +%F)
```
