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

## The rule (how to tell what's managed)

In `~/.config`, **a symlink = managed by this repo**; **a real directory = not managed**
(games, app state, and secret-bearing tool configs, which are deliberately left in place).

```sh
ls -la ~/.config    # symlinks -> ../dotfiles/... are the managed dotfiles
```

## Bootstrap on a new machine

```sh
brew install stow
git clone <this-repo> ~/dotfiles
cd ~/dotfiles
stow -t "$HOME" */          # symlink every package into place
theme set latte 0.6         # seed the shared theme state (see "Theme toggle")
```

Restore tmux plugins (not tracked — installed by tpm):

```sh
git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
# start tmux, then press <prefix> + I
```

## What's managed vs. left alone

| Managed (stow packages) | Left in `~/.config` (real dirs, untracked) |
|---|---|
| nvim, tmux, zsh (+`~/.zshenv`), fish, alacritty, wezterm, aerospace, yabai, skhd, yazi, neofetch, git, bin | **Games:** StardewValley, Battle.net · **Secrets/app-state:** gh, github-copilot, gsheets, mcp-google-sheets, assistant, cagent, launchpad · **Skipped:** uv (receipt), mpv (empty), raycast |

Secrets never enter this repo: token/history files (`access_tokens.md`, `.zsh_history`,
`hosts.yml`, `token.json`, `auth.db`, …) are gitignored or live in untracked dirs.

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

## Backups

StardewValley saves live at `~/.config/StardewValley/Saves` (a game, not a dotfile).
Back them up separately, e.g.:

```sh
cp -R ~/.config/StardewValley/Saves ~/Dropbox/backups/StardewValley/Saves-$(date +%F)
```
