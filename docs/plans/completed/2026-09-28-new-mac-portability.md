# Make a new Mac reproducible from this repository

**Status:** Complete
**Scope:** `Brewfile`, `bin`, `git`, `pi`, `zsh` packages, root README and
knowledge base. Live migration of four existing real files on this Mac into
Stow links (backups kept).

## Objective

A fresh Mac reaches this workstation's configuration from one clone and one
idempotent command, and preferences changed on this Mac keep flowing into the
repository instead of staying in untracked real files.

## Non-goals

- Machine-local scheduled jobs (`~/Library/LaunchAgents`, `everyday-ai-github-sync`)
  stay out, per [ARCHITECTURE](../../ARCHITECTURE.md#repository-map).
- Credentials and sign-ins (Pi `auth.json`, `gh` hosts, gcloud, SSH keys,
  `~/.config/mcp/mcp.json`) stay local; the bootstrap only lists them.
- Other agent harnesses tried on this Mac (Claude Code, Codex, Gemini/Antigravity,
  opencode, cmux, Cursor) and macOS system defaults: not captured without a
  user decision.
- Rewriting hard-coded `/Users/eric` paths in OMP/Pi JSON: OMP expansion support
  is unverified, Pi does not interpolate `command`, and the gcloud allowlist path is
  a security guard. The bootstrap lists the files instead when `$HOME` differs.

## Context and constraints

- Concurrent uncommitted work exists in `README.md` and
  `pi/.pi/agent/extensions/omp-anthropic-route/`; preserve it.
- `stow -n -v -t "$HOME" pi` already lists two unrelated pending test-file links;
  create only this task's links.
- Pi writes `settings.json` with `writeFileSync` (follows the link) and locks with
  `realpath: false`, so the lock stays in `~/.pi/agent/`. Pi auto-installs missing
  configured npm packages at startup (`installMissing` in the Pi bundle).
- Pi `mcp.json` interpolates `${VAR}` in `args`/`env` but not `command`.

## Acceptance criteria

- [x] Brewfile lists every formula/cask the managed configuration invokes (OMP,
      pyenv, gcloud CLI) plus the extra tools installed on this Mac.
- [x] Pi `settings.json`/`models.json`, the p10k prompt, the git identity, and the
      Tailscale wrapper are tracked and deployed as links on this Mac.
- [x] `dotfiles-bootstrap` installs prerequisites, links packages (stopping on
      conflicts), seeds theme state, provisions Herdr/Pi/tpm, and prints sign-ins.
      `--check` reports the same steps read-only.
- [x] README's new-Mac path starts with the bootstrap, handles the private clone,
      and documents what remains manual.

## Progress

- [x] Audit: `brew bundle dump` vs Brewfile, unmanaged `~/.config`, `~/.pi`,
      `~/.omp`, `~/.local/bin`, home dotfiles, LaunchAgents.
- [x] Implement: Brewfile entries; tracked Pi settings/models, p10k, git config,
      Tailscale wrapper; `.zprofile` Homebrew guard; portable gcloud SDK block in
      `.zshrc`; `dotfiles-bootstrap`; README, ARCHITECTURE, VERIFICATION.
- [x] Deploy on this Mac: the four real files were swapped for links with an atomic
      rename after copying them to `~/.local/state/dotfiles/pre-link-backups/2026-09-28/`
      (also holds `~/.gitconfig` and the stale ignored repo copy of `.p10k.zsh`);
      `stow git` created `~/.config/git/config`; the bootstrap link was created alone.

## Decisions

- **Pi settings are linked, not seeded:** changes from `/settings` or `/model`
  become repository diffs to commit. Cost: `lastChangelogVersion` churns on Pi
  upgrades. Rejected: a one-shot template (drifts silently).
- **npm globals are installed by the bootstrap with nvm's npm**, not as Brewfile
  `npm` entries: `brew bundle` runs before nvm exists and would install into
  Homebrew's Node instead of the nvm prefix `lsp.json` points at.
- **p10k is tracked:** it is the wizard output the user chose; no secrets or paths.
  The wizard `rm`s the file before writing (`internal/wizard.zsh`), so README
  documents moving a regenerated file back into the package.
- **Homebrew on PATH via a guarded `brew shellenv` in `.zprofile`:** this Mac gets
  `/opt/homebrew/bin` from `/etc/paths.d/homebrew`, which the script installer does
  not create; the guard is a no-op here.
- **Git identity at XDG `~/.config/git/config`:** the repository is private and the
  address is already in commit metadata. `init.defaultBranch = main` is explicit
  because only Apple's system gitconfig sets it.

## Verification

All from `/Users/eric/dotfiles` on 2026-09-28 unless stated.

- `git diff --check` — passed.
- Runbook shell-syntax block (with `tailscale` and `dotfiles-bootstrap` added),
  `jq empty` on the Pi JSON, `git config -f git/.config/git/config --list` — passed.
- `shellcheck -s bash bin/.local/bin/dotfiles-bootstrap` — only SC2035 info on `*/`,
  the same pattern `dotfiles-update` uses.
- `brew bundle list --file=Brewfile --all` — parses (88 entries).
  `HOMEBREW_BUNDLE_NO_UPGRADE=1 brew bundle check` — unsatisfied on this Mac only
  for `gcloud-cli` (new) and `zig` (pre-existing: `zig@0.15` is installed instead).
- `stow -n -v -t "$HOME"` for `docs`, `pi`, `zsh`, `git`, `bin` — no pending actions
  except two unrelated `omp-anthropic-route` test links already pending before.
- Pi `SettingsManager.create` + `setLastChangelogVersion` + `flush` against a temp
  agent dir whose `settings.json` is a symlink — passed: link kept, target updated,
  other keys unchanged, lock removed.
- `git config --list --show-origin --global` — identity now from `~/.config/git/config`.
- `script -q /dev/null zsh -lic 'print STARTUP-OK'` — passed, no errors.
  `zsh -ic` without a TTY prints a gitstatus/`monitor` error identical with the
  committed config (environmental). Startup 0.51 s. gcloud completion now loads.
- `dotfiles-bootstrap --check` on this Mac — reports 2 Brewfile entries, 3
  unrelated pending links, tpm absent, Pi/OMP Herdr integrations outdated.
- Same `--check` with `env -i` and an empty temporary `HOME` — all 15 fresh-machine
  steps reported missing; only Homebrew/Herdr caches and locks were written.
- Local Markdown links and anchors in the five touched documents — passed.
- `gitleaks dir` on each new or changed configuration file — no leaks.
- **Not run:** the installing mode of `dotfiles-bootstrap` (needs a fresh Mac or VM);
  `herdr plugin link` / `plugin list` without a running server (unverified; the script
  only warns on failure).

## Risks and recovery

- Replacing a live real file with a link: originals are in
  `~/.local/state/dotfiles/pre-link-backups/2026-09-28/`. To revert one, remove the
  link and copy its backup back to the original path.
- Pi upgrades rewrite `lastChangelogVersion` in the tracked settings; commit or
  discard the diff.

## Outcome

The repository now carries everything configuration-shaped from this Mac that
does not hold a secret, and `dotfiles-bootstrap` turns a fresh clone into this setup.
Remaining user decisions: whether to capture other agent CLIs' settings, LaunchAgents
or macOS defaults, and when to commit and push (other machines see only pushed work).
Unrelated observations: this Mac lacks Brewfile `zig` 0.16.0 (so `install-herdr-focus`
would fail here), tpm, and current Pi/OMP Herdr integrations.
