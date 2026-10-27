# Agent tools: Pi and OMP

**Status:** Operator guide. **Pi is the primary coding agent on this Mac; OMP is
secondary.** Register and verify agent capabilities for Pi first; OMP entries are
optional extras. Ownership: [`ARCHITECTURE.md`](ARCHITECTURE.md#4-agent-configuration).

| Folder | Linked to | Holds |
| --- | --- | --- |
| [`pi/`](../pi/) | `~/.pi/agent/` | Pi settings, models, extensions, prompts (also linked to `~/.omp/agent/prompts/`), global MCP servers, global and scoped skills (shared with OMP) |
| [`omp/`](../omp/) | `~/.omp/agent/` | OMP config, models and hotkeys (ported from Pi), MCP catalogue, subagents, [tooling catalogue](../omp/TOOLING.md) |
| [`.pi/`](../.pi/), [`.omp/`](../.omp/) | not linked | This repository's own project settings |

## Pi

After changing an extension, prompt or MCP file, run `/reload` in idle Pi
sessions. Pi writes `/settings`, `/model` and changelog updates through the
tracked [`settings.json`](../pi/settings.json) link, so they show up as repository
diffs; review and commit them like any other change.

### Models

[`pi/models.json`](../pi/models.json) adds DeepSeek V4.1 Flash (Base tier) through
LithosAI's OpenAI-compatible API. [`pi/settings.json`](../pi/settings.json) lists
it first at max reasoning (a `:max` thinking suffix), so a new session starts on
it and `Ctrl+P` switches to Opus 5.5 next. The API key comes from the macOS
keychain item `lithosai`; keep its value out of this repository. To pick another
model for one session:

```sh
pi --model anthropic/claude-opus-5-5
```

Opening `/model` reloads the model configuration. The entry allows low, high or
max reasoning, the advertised 1M-token context, and a conservative 32,768-token
output ceiling (not a verified LithosAI maximum; confirm in the provider's console
before raising it). Cost estimates use the published Base-tier rates. When
updating the entry, see the
[LithosAI Pi guide](https://docs.lithosai.com/agent-integrations/pi) and
[pricing](https://www.lithosai.com/pricing).

### Extensions

Global extensions live in [`pi/extensions/`](../pi/extensions/). Read its
[policy](../pi/extensions/README.md) before adding anything that touches model
context.

| Extension | Adds |
| --- | --- |
| `selective-skills.ts` | `/skill` enables skills per session (the [`pi`](../bin/pi) wrapper passes `--no-skills`), from the standard skill folders and the folders in the `skills` setting of [`pi/settings.json`](../pi/settings.json) |
| `session-controls.ts` | `/clear` and `/drop` |
| `copy-prompt.ts` | `alt+shift+c` copies the draft |
| [`modal-vim-navigation`](../pi/extensions/modal-vim-navigation/README.md) | Vim navigation of the fullscreen transcript; clipboard images as `[img #N]` (Ctrl+V / Cmd+V); Ctrl+C copies the draft it clears |
| [`agent-stuff`](../pi/extensions/agent-stuff/README.md) | `/review`, `/end-review`, `/answer` (Ctrl+.), `/btw`, `/goal`, `/session-breakdown` from mitsuhiko/agent-stuff |
| `long-context` | `/long-context` switches GPT-5.6 / GPT-6 Astra to the 1.05M window (long-context pricing above 272K) |
| [`codex-fast`](../pi/extensions/codex-fast/README.md) | `/fast` requests the priority tier for Codex models (uses more credits) |
| [`quota-footer`](../pi/extensions/quota-footer/README.md) | Codex (blue) and Claude (yellow) usage in the footer; `/usage` for every saved account |
| [`quota-router`](../pi/extensions/quota-router/README.md) | `/accounts` and `/route`: park a second login and continue on it when one hits a usage limit |
| [`compact-ui`](../pi/extensions/compact-ui/README.md) | One-line startup header (enable **Quiet startup** in `/settings`) and an `MCP: N/M` footer |
| `token-speed` | Output tokens per second in the footer: a live `~` estimate while a reply streams, then the exact rate; `/tps` adds session and per-model averages |
| [`theme-sync`](../pi/extensions/theme-sync/README.md) | Follows the shared Catppuccin flavour ([`THEME.md`](THEME.md)) |
| [`local-file-links`](../pi/extensions/local-file-links/README.md) | Clickable file links that open in Neovim |
| `herdr-task-summary` | Conversation titles in the Herdr sidebar (small model request per task; see [`HERDR.md`](HERDR.md#agent-state)) |
| [`omp-anthropic-route`](../pi/extensions/omp-anthropic-route/README.md) | Sends Claude OAuth requests in OMP's reviewed shape (below) |

**Claude via OMP.** The first direct Claude OAuth request after starting Pi or
`/reload` does two things:

1. It tries to update Homebrew `omp` to the latest stable release. CLI updates
   trust upstream binaries but allow only version and hash changes in a reviewed
   formula recipe; the bridge code stays pinned. A failed or refused update only
   warns and keeps the installed CLI (retried next session).
2. It sends one small synthetic request to check the requested model (uses
   quota). A missing CLI or failed check blocks instead of falling back.

Later requests reuse the check. Startup, model selection and reload do nothing on
their own; API keys, proxies and other providers are untouched.
`/omp-anthropic-route` shows the cached status. Guards and recovery:
[request preflight](../pi/extensions/omp-anthropic-route/README.md#request-preflight).

### Prompts

Prompt templates in [`pi/prompts/`](../pi/prompts/) run only when invoked. The
[`links`](../links) file also mirrors them into `~/.omp/agent/prompts/`, so OMP
has the same commands. Use only placeholders both harnesses expand (`$ARGUMENTS`,
`$@`, `$1`); OMP leaves Pi's `${ARGUMENTS:-default}` form as literal text.

- `/discuss`: interview, then an implementation-ready summary.
- `/eli5 <topic>`: a throwaway visual HTML explainer.
- `/domain-first [scope]`, `/test-sweep [scope]`, `/feedback [correction]`.
- `/pr [notes]`: commit, push, and open or update a draft PR with a short
  description (screenshots only when asked).
- `/ship [notes]`: commit this task's changes and push straight to the current
  branch, even the default branch, with no PR. For changes small enough to skip
  review.

### MCP servers

Pi's built-in MCP support reads two files; there is no MCP package to install.

| File | Owner | Use |
| --- | --- | --- |
| [`pi/mcp.json`](../pi/mcp.json), linked to `~/.pi/agent/mcp.json` | This repository | Global servers below |
| `<repo>/.pi/mcp.json` | Each project; read only once the project is trusted | Per-project enable or disable |

How it behaves:

- A project entry **replaces** the global entry of the same name. It must repeat
  the full `command` or `url`, plus `"enabled": false` to disable it.
- `/mcp` toggles are written to the file that defines the server. For global
  servers that is the tracked file, so review them like `settings.json` changes.
- Every enabled server connects when a session starts (no lazy mode).
  `pi mcp list` connects each one and reports errors; `/reload` applies changes to
  a running session.
- OAuth sign-ins (`pi mcp login <server>`) are stored in `~/.pi/agent/mcp-auth.json`.
- Tools default to `codemode` exposure: the model calls them from `codemode`
  scripts.
- Penpot stays only in the host-local `~/.config/mcp/mcp.json`, which Pi does not
  read: its token is part of the URL, and Pi does not expand variables in URLs.

The global servers:

- **gcloud** and **gcp-observability** use the same pinned packages as OMP and
  start with every session (needs `npx` and the gcloud CLI). gcloud is read-only
  only because of the `-c` [allowlist](../omp/gcloud-mcp-allowlist.json); keep it.
  Neither restricts projects: they use your Google IAM, so pass explicit project
  IDs. If auth has expired, run `gcloud auth login` and
  `gcloud auth application-default login`, then `/mcp reconnect <server>`.
  Calling `run_gcloud_command` with `{"args":["version"]}` must be rejected by the
  allowlist.
- **paper** connects to Paper Desktop at `http://127.0.0.1:29979/mcp` when a file
  is open, and can edit the open design. While Paper is closed, each session start
  reports it as failed; run `/mcp reconnect paper` after opening Paper.
- **workspace-context** is this repository's own read-only index of every
  repository under `~/Desktop/projects` and `~/dotfiles`
  ([README](../lib/workspace-context-mcp/README.md)). It runs
  `~/.local/bin/workspace-context-mcp serve`, so `bin/` and `lib/` must be linked;
  `workspace-context-mcp doctor` inspects it without an agent. This repository's
  [`.pi/mcp.json`](../.pi/mcp.json) repeats the definition with the server
  enabled, so sessions started here connect it. OMP enables it too.
- **linear** and **notion** are hosted OAuth servers; sign in once with
  `pi mcp login linear` / `pi mcp login notion`.
- **exa** is Exa's hosted web search, giving Pi `web_search_exa`,
  `web_fetch_exa` and the metered `agent_run`. It signs in through OAuth at
  `https://mcp.exa.ai/mcp?login`; sign in once with `pi mcp login exa`. Without
  `?login` the server answers keyless on a small free plan, so Pi never offers
  a sign-in. Clients without OAuth can send an `x-api-key` header instead
  ([Exa MCP docs](https://exa.ai/docs/get-started/exa-mcp)).
- **firecrawl** is Firecrawl's hosted scraper, signed in through OAuth at
  `https://mcp.firecrawl.dev/v2/mcp-oauth`; sign in once with
  `pi mcp login firecrawl`. Only that URL supports sign-in: the keyless
  `https://mcp.firecrawl.dev/v2/mcp` (scrape, search and parse within daily
  limits) has no OAuth metadata, and logging in against it fails with
  `Unexpected token '<'`
  ([Firecrawl MCP docs](https://docs.firecrawl.dev/mcp-server)).
- **beacon** is a local HTTP server (`http://127.0.0.1:47321/mcp`) for the
  Beacon productivity app. Its `Authorization` header is a `!` command that
  reads the bearer secret from `~/.config/launchpad/secrets/mcp.secret` at
  connect time; keep that value outside this repository.
- **hark** starts through [`bin/hark-mcp`](../bin/hark-mcp), which resolves
  Node and runs the personal assistant server at
  `~/Desktop/projects/personal/hark-mcp/server.mjs` (override with
  `HARK_MCP_HOME`). That project lives outside this repository; moving it is a
  one-line change in the launcher.

## OMP

### Settings, models and hotkeys

Ported from Pi on 2026-10-20; the two files are maintained separately.

- [`omp/config.yml`](../omp/config.yml): `xhigh` default thinking, hidden thinking
  blocks, quiet startup and `tui.vimMode` (Esc enters normal mode, as with Pi's
  Vim extension; OMP's mode edits the prompt rather than scrolling the
  transcript). `modelRoles` stay OMP's own; Pi's `enabledModels` is not ported
  because in OMP that key hides every other model.
- [`omp/models.yml`](../omp/models.yml): the same LithosAI DeepSeek V4.1 Flash
  entry as `pi/models.json` (`--model lithosai/deepseek-ai/DeepSeek-V4.1-Flash`).
- [`omp/keybindings.yml`](../omp/keybindings.yml): Pi's `Ctrl+L` model selector and
  `Alt+Enter` follow-up. `Ctrl+L` no longer starts live voice; use `/live`.

### MCP servers

[`omp/mcp.json`](../omp/mcp.json) is an opt-in catalogue. Globally enabled: the
read-only `gcloud` and `gcp-observability`, local
[`workspace-context`](../lib/workspace-context-mcp/README.md), and the servers
ported from `pi/mcp.json` (`linear`, `notion`, `exa`, `firecrawl`, `paper`,
`beacon`, `hark`). OMP keeps its own OAuth sign-ins: run `/mcp reauth <name>`
once for linear, notion and firecrawl. Everything else is disabled. This
repository enables Context7, DeepWiki and grep.app in
[`.omp/mcp.json`](../.omp/mcp.json).

To enable a reviewed server for one repository, add it to `<repo>/.omp/mcp.json`:

- Include the complete server definition; project files cannot use
  `enabledServers`.
- Put the file in the directory OMP is launched from; MCP project config is not
  searched up the tree.
- Keep `disabledServers: ["node_repl"]` to suppress the Codex-provided server.
  Never add a name a project needs there: the denylist outranks project files.
- Hosted OAuth credentials are keyed by profile and URL, so they work in a project
  file without signing in again.

Semgrep is CLI-only: `uv tool install semgrep`, then `semgrep scan --config auto`
per the `secret-sast-sweep` skill. Its MCP catalogue entry stays disabled.

**Authentication and prerequisites:**

- Hosted OAuth: use `/mcp reauth <name>` rather than pasting a key for
  `github-mcp`, `sentry`, `linear`, `atlassian`, `notion`, `supabase`, `vercel`,
  `stripe`, `datadog`, `cloudflare-bindings` and `socket`.
- Slack is deliberately absent: its hosted server needs a registered Slack app
  and OAuth client. Add it only with the `oauth`/`auth` blocks from OMP's MCP
  config guide.
- CLI sign-in: `railway login`, `fly auth login`; `snyk` needs Snyk CLI 1.1296.2
  or newer.
- Local apps: Figma needs its desktop app with Dev Mode MCP enabled; Obsidian
  needs the Local REST API community plugin and its key; Qdrant needs a running
  Qdrant; Kubernetes needs Docker.
- Deliberately omitted (archived or superseded):
  `@modelcontextprotocol/server-postgres`,
  `@modelcontextprotocol/server-brave-search`,
  `@modelcontextprotocol/server-memory`,
  `@modelcontextprotocol/server-github`, the reference `puppeteer`/`sqlite` servers, and
  `@railway/mcp-server` (use `railway mcp`).

### Capabilities

This table describes OMP, not tools guaranteed in Pi or any model session. Other
repositories' activation state is host-local; inspect it before relying on it.
Prerequisites and alternatives: the [OMP tooling catalogue](../omp/TOOLING.md).

| Capability | OMP built-in | Alternatives | Enabled where |
| --- | --- | --- | --- |
| Library/API docs | `web_search` | Context7 · Ref.tools · GitMCP · AWS Knowledge/Docs · MS Learn · Cloudflare docs · Terraform registry | context7 (dotfiles MCP; elsewhere inspect project/plugin config) |
| Repo Q&A | — | DeepWiki · GitMCP · Octocode | deepwiki (dotfiles, de-dashboard) |
| Local workspace context | — | [`workspace-context`](../lib/workspace-context-mcp/README.md) (this repo, read-only stdio) | Pi global (`pi/mcp.json`); also OMP global |
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

For evals and tracing, use Promptfoo as a CLI by default:
`npx promptfoo@latest eval` takes YAML, runs locally, and gates CI without an MCP
server. Choose Langfuse when self-hosted tracing is needed; its MIT core has
cloud/self-host parity. The disabled `langfuse` entry is only for conversational
trace lookup.

### Skills, subagents, extensions and plugins

- **Skills:** the managed skills live in [`pi/skills/`](../pi/skills/)
  (`~/.pi/agent/skills/`), shared by both harnesses: Pi's `/skill` scans it
  natively, and [`omp/config.yml`](../omp/config.yml) adds it to OMP through
  `skills.customDirectories`. OMP also discovers `~/.omp/agent/skills/` (native,
  highest precedence, now unmanaged), `~/.claude/skills/`, `~/.agents/skills/`,
  project `<cwd>/.omp/skills/`, and project `<cwd>/.github/skills/`. Roots are
  non-recursive, one level below `skills/`, and need `name` and `description`
  frontmatter.
- **Skill scope:** keep only cross-repository skills in `pi/skills/`:
  `agent-handoff`, `llm-eval`, `omp-repo-setup`, `repo-recon`,
  `secret-sast-sweep` and `visual-verify`. Repository-specific skills live in
  [`pi/scoped-skills/`](../pi/scoped-skills/) (`~/.pi/agent/scoped-skills/`),
  which neither harness auto-discovers; link each into the repositories it
  applies to at `.omp/skills/<name>` (both OMP and `/skill` scan that folder):
  - `lintmax`: repositories with `pnpm-lock.yaml`
  - `agent-test-author`: prompt-behemoth consumers
  - `everyday-ai-frontend-styleguide`: `de-dashboard`
  - `perform-dangerous-action`: DE service repositories
  - `kpi-tracking`: Hono-based DE service repositories
  - `policy-guide-setup` and `system-design-template`: established DE service
    repositories
  - `gcp-investigate`: DE service repositories and `de-dashboard`
- **Custom subagents:** `~/.omp/agent/agents/*.md` and `<cwd>/.omp/agents/*.md`.
  Required frontmatter: `name`, `description`; optional: `tools`, `spawns`,
  `model`, `thinking-level`, `autoloadSkills`, `prewalk`, `advisor`. Bundled
  agents are `scout`, `designer`, `reviewer`, `security-reviewer`, `librarian`,
  `task` and `sonic`. `.claude/agents` is deliberately not scanned.
- **Extensions and hooks:** `~/.omp/agent/extensions/` (including `pi-rewind`) and
  `<cwd>/.omp/hooks/{pre,post}/`; both use TypeScript/JavaScript default-export
  factories. Pi's own extensions are listed [above](#extensions).
- **Plugins:** `omp plugin install <spec>` or `omp plugin link <path>`; state
  lives under `~/.omp/plugins/`.
- **Marketplaces:** `/marketplace add <owner/repo>`, then `/marketplace discover`.
  Catalogues live at `.omp-plugin/marketplace.json` or
  `.claude-plugin/marketplace.json`; the Claude Code plugin format is compatible.
