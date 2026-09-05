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
- **Subsystem operation:** [Theme](#theme-toggle), [OMP tooling](#omp-agent-tooling),
  and [per-tool setup](#8-set-up-each-tool).

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
box drawing and theme-native agent-attention chrome, and teaches the sidebar to
hide any Space whose metadata carries a non-empty reserved `sidebar_hidden` token
(the focused Space is always exempt, and hidden Spaces drop out of rendering,
mouse hit-testing, and visible-order navigation together). Blocked panes use the
active palette's red, completed conversations awaiting review use peach, and either keeps
content at the midpoint between background and focused opacity (`0.75` with the
tracked `ui.unfocused_pane_opacity = 0.5`). Ordinary inactive panes still blend every
foreground/background colour toward the queried host-terminal background, which is
substantially stronger than SGR DIM. Retained PTY row updates receive the same blend,
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
herdr plugin link ~/.config/herdr/plugins/spaces-env --enabled
herdr integration install pi
herdr integration install omp
herdr integration status      # Pi and OMP should both be current
herdr config check
herdr
```

Herdr is the primary terminal workspace manager. Its config keeps the tmux `C-a`
muscle memory: `h/j/k/l` moves between panes, `\` / `-` splits right / down, `c`
closes a pane, `C-c` creates a tab, `r` renames it, `w` opens the workspace picker,
and `z` zooms. `H` / `L` changes tabs, `x` swaps down, and `Space` enters resize mode.
Splits stop when either resulting pane would have less than 10 readable columns or 4
readable rows (with room reserved for pane chrome), and report why the split was refused.
Press `C-a u` to jump to the next agent conversation needing attention, or `C-a ?`
for the complete live keymap. Workspaces replace tmux sessions, tabs replace tmux
windows, and Herdr persists them. The official Pi and OMP integrations supply lifecycle
state; task-summary metadata alone does not report whether Pi is running. Without the Pi
integration, Herdr guesses from screen text and can show an active conversation as idle.
New sessions load their integration automatically; once an existing conversation is idle,
use `/reload` in that Pi or OMP session (or restart it). No Herdr restart is needed.
Herdr owns these generated extension files outside Stow; reinstall with
`herdr integration install pi` / `herdr integration install omp`, rather than editing them.
Native Herdr toasts cover background tabs and workspaces; the local next-agent hook fills
the otherwise-suppressed active-tab, different-pane OMP case. A prompt already visible in
the focused OMP pane makes the request sound without a redundant popup.
The same per-pane next-agent ledger drives split-pane attention borders and midpoint
opacity, so focusing one conversation cannot accidentally clear a sibling. Its glyphs are
`◐` working, `◆` blocked/needs input (not necessarily broken), `●` finished but unreviewed,
and `○` idle/reviewed. The
next-agent priority/scope settings are tracked under
`~/.config/herdr/plugins/config/<plugin-id>/config.toml`.

The local spaces-env plugin organises Spaces into two fixed environments,
Personal and Work, inside the one persistent server — a focus boundary, not a
process boundary, so moving a Space never touches its panes. `C-a ;` toggles
environments and focuses the destination's most recently used Space (an empty
destination just flips where new Spaces start); `C-a :` (shift+;) sends the
current Space to the other environment and stays on the source's most recent
remaining Space, following the moved Space only when it was the source's last.
New Spaces inherit the active environment, restored Spaces keep their
assignment (identity is Herdr's stable workspace id, so renames don't matter),
and unknown or stale ids reconcile to Personal. The whole sidebar follows the
active environment. The Agents panel is filtered through an `agent.view.set`
override on the member Spaces, so it lists only that environment's agents, names
the environment in its header, and shows "no matching agents" when it is empty.
Within that view, attention sorts first. Every row leads with the next-agent
state glyph and, when available, a task summary, with dim Space/tab context
beneath it. OMP uses
its stripped terminal task title. Pi's context-neutral `herdr-task-summary`
extension reports a display-only `$task_summary` pane token derived
without an LLM as an up-to-six-word task phrase from the latest substantive user
request; it observes finalized
input without changing or injecting model-visible content and restores existing
sessions on Pi reload when their active branch contains a usable request. Fresh
sessions show `New conversation` until one is available. Standalone
clipboard/image paths and conversational acknowledgements are skipped. Unknown integrations show only Space/tab context rather than falling
back to a CLI kind or Herdr nickname. The sidebar defaults to 40 columns, with a
36–42 column resize range. The Spaces
list is filtered by stamping the custom build's reserved
`sidebar_hidden` metadata token on inactive-environment Spaces (the focused
Space stays visible server-side, so toggling into an empty environment leaves
exactly the Space you are on); each Space keeps its dim P/W badge in the
expanded view, while the collapsed view shows one active P/W marker on its
section divider. The Personal block stays ordered above the Work block for the
picker and moments when both are visible. On a stock binary the token is ignored and only the
Agents panel filters. Both are in-memory server state, reapplied at startup.
next-agent jumps stay global and the active environment simply follows wherever
focus lands. To
reset every assignment, delete
`~/.local/state/herdr/plugins/martinro.spaces-env/state.json` (all Spaces
become Personal), or run
`herdr plugin action invoke martinro.spaces-env.status` to see the current
split.

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
| nvim, herdr, tmux, zsh (+`~/.zshenv`), alacritty, ghostty, aerospace, git, gh (`config.yml` only), bin, omp, pi | **Games:** StardewValley, Battle.net · **Secrets/app-state:** gh credentials (`hosts.yml`), github-copilot, gsheets, mcp-google-sheets, assistant, cagent, launchpad · **Skipped:** uv (receipt), mpv (empty), raycast |


Secrets and runtime state must remain outside this repo. With leaf linking,
new app-written files normally stay in real `$HOME` directories rather than
landing in the checkout. [`.gitignore`](.gitignore) and [`.stowrc`](.stowrc) cover
specific known outputs, not every possible secret filename. Older folded links
or a misconfigured writer can still leak state: inspect unexpected files and
`git status` before committing, without dumping credential contents.

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

[`omp/.omp/agent/mcp.json`](omp/.omp/agent/mcp.json) is an opt-in catalogue except
for the globally enabled read-only `gcloud` and `gcp-observability` servers.
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
  factories. Pi's global `/skill` command (with the `~/.local/bin/pi` wrapper's
  `--no-skills` default) makes skill loading opt-in and session-scoped.
  Pi's `/test-sweep [scope]` command stages a reviewable test-value and
  production-simplification prompt without submitting it automatically.
  Pi's `/domain-first [scope]` command similarly stages a domain-constraint
  sweep that creates or evolves `domain-first-operating-model.md`.
  Pi's `alt+shift+c` shortcut (`copy-prompt.ts`) copies the current prompt
  draft to the clipboard.
  Pi's global `harness-feedback.ts` extension starts disabled; use
  `/feedback on` to learn from corrective feedback and `/feedback off` to
  remove that guidance.
  Pi's context-neutral `herdr-task-summary` extension reports deterministic,
  display-only task metadata to its current Herdr pane; it does not alter the
  conversation or model context.
  Pi's `omp-anthropic-route` extension aligns direct Anthropic OAuth traffic
  with OMP's reviewed wire shape when the installed OMP version matches its
  pinned target, falling back to Pi's native transport otherwise;
  `/omp-anthropic-route` reports route, version, and credential state.
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
| Herdr conversation symbol stays idle while Pi works | Check `herdr integration status`; install/update with `herdr integration install pi`, then `/reload` in that Pi session once idle. `herdr agent explain <pane-id> --json` should show screen detection skipped once lifecycle reports are active; `default_known_agent_idle_fallback` means Herdr is still guessing from the screen |
| tmux statusline unstyled, plugins absent | tpm not cloned, or `C-a I` never pressed |
| `prefix + Space` does nothing | `cycle-2x2.sh` needs `python3`, and only acts on exactly 5 or 7 panes |

## Backups

StardewValley saves live at `~/.config/StardewValley/Saves` (a game, not a dotfile).
Back them up separately, e.g.:

```sh
cp -R ~/.config/StardewValley/Saves ~/Dropbox/backups/StardewValley/Saves-$(date +%F)
```
