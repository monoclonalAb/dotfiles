# dotfiles

Eric's macOS configuration. Each top-level folder holds one tool's settings, for
example `nvim/`, `zsh/` or `herdr/`. A script symlinks those files into `$HOME`.

## How it works

1. [`links`](links) says where each folder or file goes. Example:
   `nvim/  ~/.config/nvim/`.
2. [`bin/dotfiles-link`](bin/dotfiles-link) reads `links` and creates the
   symlinks. A trailing slash means *mirrored*: the folders under `$HOME` stay
   real, and each file inside is its own symlink. Apps can then keep caches and
   credentials beside the managed files without writing into this repository.
3. **Editing a tracked file changes this Mac's live config at once**, because the
   file under `$HOME` is a symlink to it. Only a new, moved or deleted file needs
   `dotfiles-link apply`.
4. Never linked: `docs/`, files at the repository root, and hidden folders.
   `.archive/` holds retired configs; `.omp/` and `.pi/` are this repository's own
   agent settings.
5. Secrets, sessions, caches and generated files stay outside this repository.

A file under `$HOME` is managed if it is a symlink into this checkout. Check with
`readlink ~/.config/zsh/.zshrc`.

## Where to read next

| To… | Read |
| --- | --- |
| Change this repository (agents) | [`AGENTS.md`](AGENTS.md), then [`docs/README.md`](docs/README.md) |
| Find the file that owns a behaviour | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Check a change safely | [`docs/VERIFICATION.md`](docs/VERIFICATION.md) |
| Set up a Mac by hand, fix setup errors, see machine-specific paths | [`docs/SETUP.md`](docs/SETUP.md) |
| Use or change Herdr, the terminal workspace manager | [`docs/HERDR.md`](docs/HERDR.md) |
| Use or change the shared colour theme | [`docs/THEME.md`](docs/THEME.md) |
| Pi and OMP models, extensions, prompts and MCP servers | [`docs/AGENT-TOOLS.md`](docs/AGENT-TOOLS.md) |

## Commands that change this Mac

Everything below installs software or changes live configuration. Agents: run
these only when asked, never as a check.

### Set up a new Mac

The repository is private, so sign in to GitHub first. In a new Terminal:

```sh
xcode-select --install      # wait for the installer to finish
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
/opt/homebrew/bin/brew install gh
/opt/homebrew/bin/gh auth login                  # choose HTTPS and "authenticate Git"
/opt/homebrew/bin/gh repo clone monoclonalAb/dotfiles ~/dotfiles
~/dotfiles/bin/dotfiles-bootstrap
```

[`dotfiles-bootstrap`](bin/dotfiles-bootstrap) installs whatever is missing:
Homebrew packages, Rust, Node, Pi, the links, the theme, tmux's plugin manager,
and the patched Herdr with its plugins. It never upgrades packages and stops at a
link conflict. Rerun it after fixing a failure. `dotfiles-bootstrap --check` only
reports.

It ends by printing the manual steps: sign-ins (`gh`, Pi `/login`, gcloud,
Tailscale), AeroSpace's Accessibility permission, `C-a I` in tmux, and the first
`nvim` launch.

Keep the clone at `~/dotfiles`; Pi and OMP configs use that path. Credentials,
SSH keys, app data and a few [machine-specific paths](docs/SETUP.md#personal-bits)
do not carry over. The step-by-step manual version is [`docs/SETUP.md`](docs/SETUP.md).

### Update this Mac

```sh
git -C ~/dotfiles status --short   # finish or keep local work first
dotfiles-update
```

[`dotfiles-update`](bin/dotfiles-update) does this:

1. Pulls from GitHub, fast-forward only. If it cannot fast-forward, it stops.
2. Runs `dotfiles-link apply`. Uncommitted new files get linked too, so do not
   run it in the middle of unfinished work.
3. Runs `brew bundle`, `theme apply` or a tmux reload, only when their inputs
   changed.
4. Prints slower follow-ups instead of running them: rebuilding Herdr
   (`install-herdr-focus`) and restarting the shell.

It does not install new npm globals, tmux plugins or Herdr plugins. Run
`dotfiles-bootstrap --check` afterwards to see what is missing. Only pushed
commits reach other machines. Old or unusual machines:
[updating special cases](docs/SETUP.md#updating-special-cases).

### Add, move or remove files

```sh
dotfiles-link check    # preview only: links to create or repair, conflicts, unlisted files
dotfiles-link apply    # make the links; changes nothing while any conflict remains
```

- **New file in a mirrored folder** (`nvim/`, `pi/`, `bin/`…): create it, then
  run `apply`. A file anywhere else also needs a line in [`links`](links); until
  then `check` reports it as `unlisted`.
- **New tool:** create `<tool>/`, add a `links` line (trailing slash on both
  sides to mirror it), then run `apply`.
- **Rename or delete a file in a mirrored folder:** `git mv` or `git rm` it, then
  `apply` removes the old link.
- **Stop managing a tool:** first list its links, because `dotfiles-link` only
  looks in folders that `links` still names:
  `find ~/.config/<tool> -type l -lname "$HOME/dotfiles/*"`. Then delete its
  `links` line and remove those links by hand.
- **Conflict:** a real file, or a link pointing elsewhere, is in the way.
  Inspect it, move it aside under an unused name, and rerun. Never delete app
  state to clear one. Details: [Link everything](docs/SETUP.md#7-link-everything).

## Quick reference

- **Herdr** (terminal workspaces) uses the `C-a` prefix. `C-a ?` shows every
  key; the custom ones are in [`docs/HERDR.md`](docs/HERDR.md#keys).
- **Theme:** in Alacritty, `Ctrl+Shift+T` changes the colour flavour and
  `Ctrl+Shift+B` the opacity. `theme status` shows the current state.
- **Pi** is the main coding agent. After changing a Pi extension, prompt or MCP
  file, run `/reload` in idle Pi sessions.
