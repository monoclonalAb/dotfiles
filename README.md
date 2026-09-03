# dotfiles

My macOS dotfiles, managed with [GNU Stow](https://www.gnu.org/software/stow/).

Each active top-level folder is a **Stow package** that mirrors its real path under
`$HOME`. Stowing a package symlinks it into place, so the files here *are* the live
config — no more copy-drift.

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
by the Brewfile.

**Theme** — seed the shared Catppuccin state, which Alacritty, Herdr, tmux and Neovim share
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
run the Theme step above before starting it. This repo builds an audited patch on
upstream v0.8.2 commit `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c` rather than
binary-editing the `wkentaro/herdr` prerelease. The patch adds heavy focused-pane
box drawing, and implements configurable
inactive-pane fading by blending every foreground/background colour toward the
queried host-terminal background (substantially stronger than SGR DIM at the tracked
`ui.unfocused_pane_opacity = 0.5`). Retained PTY row updates receive the same blend,
so animated output in a background pane cannot flash at full opacity. Install it after
`brew bundle`:

```sh
install-herdr-focus
```

The script fetches the pinned source, applies
`herdr/.config/herdr/patches/herdr-0.8.2-focused-pane.patch`, builds with pinned Rust 1.96.1 and
Zig 0.15, runs the focused tests the patch adds, ad-hoc signs on macOS, and atomically
installs `~/.local/bin/herdr`.
It does not stop, restart, or hand off a server; the binary takes effect on the next
natural server start. To audit/test without touching the installed executable, use
`install-herdr-focus --build-only /tmp/herdr-focus`. When upgrading an already-running
older server, wait for a natural stop, run `theme apply` while it is stopped to regenerate
`config.toml` with the new keys, and then start Herdr normally.

Then finish the normal setup:

```sh
herdr plugin link ~/.config/herdr/plugins/next-agent --enabled
herdr integration install omp
herdr config check
herdr
```

Herdr is the primary terminal workspace manager. Its config keeps the tmux `C-a`
muscle memory: `h/j/k/l` moves between panes, `\` / `-` splits right / down, `c`
closes a pane, `C-c` creates a tab, `r` renames it, `w` opens the workspace picker,
and `z` zooms. `H` / `L` changes tabs, `x` swaps down, and `Space` enters resize mode.
Press `C-a u` to jump to the next agent conversation needing attention, or `C-a ?`
for the complete live keymap. Workspaces replace tmux sessions, tabs replace tmux
windows, and Herdr persists them. The official OMP integration supplies lifecycle state;
native Herdr toasts cover background tabs and workspaces; the local next-agent hook fills
the otherwise-suppressed active-tab, different-pane case. A prompt already visible in the
focused OMP pane makes the request sound without a redundant popup. New OMP sessions load
the integration automatically; use OMP's `/reload` (or restart) for an already-running
session.
The next-agent priority/scope settings are tracked under
`~/.config/herdr/plugins/config/<plugin-id>/config.toml`.

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

In `~/.config`, **a symlink = managed by this repo**; **a real directory is usually
unmanaged**. Partially managed directories are the exception: `~/.config/gh` remains real,
with `config.yml` linked from this repo and secret-bearing `hosts.yml` left local.

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
| nvim, herdr, tmux, zsh (+`~/.zshenv`), alacritty, aerospace, git, gh (`config.yml` only), bin | **Games:** StardewValley, Battle.net · **Secrets/app-state:** gh credentials (`hosts.yml`), github-copilot, gsheets, mcp-google-sheets, assistant, cagent, launchpad · **Skipped:** uv (receipt), mpv (empty), raycast |


Secrets never enter this repo: token/history files (`access_tokens.md`, `.zsh_history`,
`hosts.yml`, `token.json`, `auth.db`, …) are gitignored or live in untracked dirs. Note the
mechanism — because `~/.config/zsh` is a symlink *into* the repo, files zsh writes at
runtime land physically inside the working tree. They're kept out of git by the `**` globs
in `.gitignore`, not by living elsewhere. Check `git status` before committing.

## Theme toggle

Alacritty, Herdr, tmux and Neovim share Catppuccin and one terminal opacity, driven by
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
`live_config_reload`; Herdr follows Alacritty's light/dark appearance (Latte for light,
its dark Catppuccin variant for frappe/macchiato/mocha); tmux uses `source-file`; and
every running Neovim updates over RPC (plus a `FocusGained` fallback). New windows read
the state on startup.

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
visible when run by hand), and via `theme status`, which probes all three without changing
anything:

```
$ theme status
flavour  frappe
opacity  0.6
state    /Users/you/.local/state/theme

alacritty  overlay present
tmux       server up
neovim     found 3 instance(s)
```

## omp agent tooling

`omp/.omp/agent/mcp.json` is a catalogue: every entry has `enabled: false`, so no MCP server is
activated globally. Enable reviewed servers per repository in `<repo>/.omp/mcp.json`; each file
must include the complete server definition because project files cannot use `enabledServers`, and
it must sit in the directory omp is launched from because MCP project config is not searched up
the tree. Keep `disabledServers: ["node_repl"]` to suppress the Codex-provided server; never add
there a name a project needs, because the denylist outranks project files. Hosted OAuth credentials
are keyed by profile and URL, so they work in a project file without re-authentication. Semgrep is
CLI-only: install it with `uv tool install semgrep`, then run `semgrep scan --config auto` per the
`secret-sast-sweep` skill; its MCP catalogue entry stays disabled everywhere.

| Capability | omp built-in | Alternatives | Enabled where |
| --- | --- | --- | --- |
| Library/API docs | `web_search` | Context7 · Ref.tools · GitMCP · AWS Knowledge/Docs · MS Learn · Cloudflare docs · Terraform registry | context7 (all repos) · ms-learn (habithealth-de01/02, rock-rubble-ai) |
| Repo Q&A | — | DeepWiki · GitMCP · Octocode | deepwiki (dotfiles, de-dashboard) |
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
| Deploy / infra | — | Vercel · Netlify · Railway · Fly · Cloudflare · Terraform · Kubernetes | — |
| Design / payments | — | Figma Dev Mode · Stripe | — |
| LLM-app evals & tracing | — | Promptfoo (CLI) · Langfuse · Braintrust · LangSmith · Arize Phoenix · Opik | — |

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
  factories. Pi's global `/skill` command (with the `~/.local/bin/pi` wrapper's
  `--no-skills` default) makes skill loading opt-in and session-scoped.
  Pi's `/test-sweep [scope]` command stages a reviewable test-value and
  production-simplification prompt without submitting it automatically.
  Pi's `/domain-first [scope]` command similarly stages a domain-constraint
  sweep that creates or evolves `domain-first-operating-model.md`.
- **Plugins:** `omp plugin install <spec>` or `omp plugin link <path>`; state lives
  under `~/.omp/plugins/`.
- **Marketplaces:** `/marketplace add <owner/repo>`, then `/marketplace discover`.
  Catalogues live at `.omp-plugin/marketplace.json` or `.claude-plugin/marketplace.json`;
  the Claude Code plugin format is compatible.

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
| Tree-sitter errors on every startup | `tree-sitter-cli` missing — run `brew bundle` and restart Neovim |
| Web LSPs or TypeScript fail to start | Node/npm missing — source `~/.nvm/nvm.sh`, run `nvm install --lts`, and restart Neovim |
| Herdr ignores a config edit | Run `herdr server reload-config`, or press `C-a R` |
| tmux statusline unstyled, plugins absent | tpm not cloned, or `C-a I` never pressed |
| `prefix + Space` does nothing | `cycle-2x2.sh` needs `python3`, and only acts on exactly 5 or 7 panes |

## Backups

StardewValley saves live at `~/.config/StardewValley/Saves` (a game, not a dotfile).
Back them up separately, e.g.:

```sh
cp -R ~/.config/StardewValley/Saves ~/Dropbox/backups/StardewValley/Saves-$(date +%F)
```
