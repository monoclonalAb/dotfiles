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
```

Restore tmux plugins (not tracked — installed by tpm):

```sh
git clone https://github.com/tmux-plugins/tpm ~/.config/tmux/plugins/tpm
# start tmux, then press <prefix> + I
```

## What's managed vs. left alone

| Managed (stow packages) | Left in `~/.config` (real dirs, untracked) |
|---|---|
| nvim, tmux, zsh (+`~/.zshenv`), fish, alacritty, wezterm, aerospace, yabai, skhd, yazi, neofetch, git | **Games:** StardewValley, Battle.net · **Secrets/app-state:** gh, github-copilot, gsheets, mcp-google-sheets, assistant, cagent, launchpad · **Skipped:** uv (receipt), mpv (empty), raycast |

Secrets never enter this repo: token/history files (`access_tokens.md`, `.zsh_history`,
`hosts.yml`, `token.json`, `auth.db`, …) are gitignored or live in untracked dirs.

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
