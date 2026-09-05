# OMP tooling catalogue

The `omp/` Stow package contains `omp/.omp/agent/`, whose managed leaves link into
`~/.omp/agent/`. This catalogue is available at `~/.omp/agent/TOOLING.md`; plugin
state remains in `~/.omp/plugins/` and is not Stow-managed.

## Selection and evidence

- Check the current session's exposed tools before choosing a capability. Built-in
  names below refer to OMP, not features guaranteed by GPT-6 Astra, Pi, or another
  model/harness combination. File reads and shell commands are valid fallbacks.
- Prefer an existing native tool or project command. Install or enable an
  alternative only for an observed gap and within the user's requested scope.
- [`mcp.json`](mcp.json) owns global activation: `gcloud` and `gcp-observability`
  are enabled read-only; other catalogue entries are disabled. Project files and
  plugins can add capabilities. Confirm effective state with `/mcp list` in OMP.
- Versions, HTTP statuses, tool counts, and marketplace figures below are prior
  research observations, **not current verification or recommended version pins**.
  Recheck the installed version and upstream instructions before operational use.
- Commands beginning with `/` are OMP interactive commands, not shell commands.
  Do not execute install, authentication, enable, or reload examples during a
  documentation review.

## Operate this configuration

- List, test, enable, disable, or reload MCP servers: `/mcp list`, `/mcp test <name>`, `/mcp enable <name>`, `/mcp disable <name>`, `/mcp reload`.
- Complete OAuth setup after enabling a vendor server with `/mcp reauth <name>`.
- Install the approved OMP-native plugins: `omp plugin install pi-lens @plannotator/pi-extension @upstash/context7-pi`.
- Reload plugin skills and commands with `/reload-plugins`; restart OMP for new tools/extensions.
- TypeScript LSP uses Homebrew's `typescript-language-server` plus `npm install -g typescript@5` as its fallback runtime because the current Homebrew TypeScript 7 package is incompatible. After changing the nvm Node version, update the `typescript-language-server.initOptions.tsserver.fallbackPath` in `lsp.json`.

`serena` requires `uv tool install -p 3.13 serena-agent`, then `serena init`, before enabling. `postgres` and `grafana` read credentials from the shell through the env-var-name indirection in `mcp.json`. Supabase's `read_only=true` is the vendor-documented read-only mode. Atlassian remains SSE: its `/v1/mcp` endpoint returned Cloudflare 403 unauthenticated, while `/v1/sse` returned clean 401.

`@upstash/context7-pi` duplicates the Context7 MCP tools but adds a skill and `/c7-docs`; keep only one enabled if tool names collide. `pi-lens` pushes LSP, linter, formatter, and type-check feedback after edits. `@plannotator/pi-extension` adds annotated plan and PR review.

Do not install these duplicate plugins: `pi-mcp-adapter` and `pi-mcp-extension` (native MCP); `pi-subagents`, `@tintinweb/pi-subagents`, `@narumitw/pi-subagents`, and `@quintinshaw/pi-dynamic-workflows` (native `task`/`hub`/`/vibe`); `@juicesharp/rpiv-todo`, `pi-ask-user`, and `@juicesharp/rpiv-ask-user-question` (native `todo`/`ask`); `@narumitw/pi-plan-mode` (native plan mode); `@narumitw/pi-lsp`, `pi-readseek`, and `pi-hashline-edit-pro` (native `lsp`/hashline `edit`); `pi-memory`, `pi-hermes-memory`, and `@remnic/plugin-pi` (native mnemopi); `omp-bark-notify` and `@llblab/pi-telegram` (herdr notifies); and `@narumitw/pi-sync` (this dotfiles repository syncs config).

## Google Cloud

- Read-only MCP servers: `gcloud` (`@google-cloud/gcloud-mcp@0.5.3`) and `gcp-observability` (`@google-cloud/observability-mcp@0.2.3`). The gcloud server is constrained by `~/dotfiles/omp/.omp/agent/gcloud-mcp-allowlist.json`.
- To widen the gcloud scope, obtain the canonical command path with `gcloud meta lint-gcloud-commands --command-string "gcloud …"`, add that exact path to `allow`, then run `/mcp reload`. Prefix matching is release-track-specific: `beta run services describe` needs its own allowlist entry.
- Project map: `habithealth-de01`, `habithealth-de02`, and `habithealth-de03` use `habithealth`; `de-dashboard` uses `eai-internal`; `raywhite-ai` uses `raywhite-417614`; `rock-rubble-ai` uses `rockandrubble`; `base-DE-template` uses the placeholder in `.everyday.json`. All Cloud Run services use `us-central1`.
- KPI telemetry—Pub/Sub `kpi-events` and BigQuery `eai-internal.kpi.kpi_events`—always lives in `eai-internal`, regardless of the DE's own project. Pass `--project` explicitly on every gcloud call: the default is `eai-internal` and otherwise can silently return another project's resources.
- BigQuery is intentionally outside the MCP; use `bq --project_id=<project> …` from bash.
- Reauthenticate with `gcloud auth login` for gcloud CLI credentials and `gcloud auth application-default login` for observability ADC. The organisation's reauthentication policy expires both sets together.
- The SDK lives at `~/google-cloud-sdk`, exposed through symlinks in `~/.local/bin`.

## Alternatives

**Docs / code grounding** — `context7` (HTTP 200 anon, 2 tools) · `deepwiki` (HTTP 200 anon, 3 tools) · `gitmcp` per-repo `https://gitmcp.io/{owner}/{repo}` (HTTP 200 anon, 4 tools, free, no signup — project-scoped so add per project, not user-level) · `ref-tools-mcp` npm 3.0.3 (2025-11-04), `https://api.ref.tools/mcp` 401, needs `REF_API_KEY` · `cloudflare-docs` `https://docs.mcp.cloudflare.com/mcp` (200 anon, 2 tools). Pick: context7 + deepwiki. Runner-up: gitmcp when you want retrieval pinned to one repo.

**Web search / crawl** — OMP has `web_search` + reader-mode `read`, so these are for crawl/agentic research only: `exa` `https://mcp.exa.ai/mcp` (200 anon, 2 tools; npm `exa-mcp-server` 3.4.1, 2026-08-18) · `firecrawl` hosted `https://mcp.firecrawl.dev/v2/mcp-search` (401; npm `firecrawl-mcp` 3.24.0, `FIRECRAWL_API_KEY`) — the only one with crawl/map/interact · `tavily` `https://mcp.tavily.com/mcp` (401; npm `tavily-mcp` 0.2.22, `TAVILY_API_KEY`). Pick: firecrawl for crawling. Runner-up: exa for clean search when the built-in provider disappoints.

**Browser / UI verification** — built-in `browser` covers navigation, ARIA snapshots, screenshots, CDP attach and relay to the user's own Chrome. Additions: `chrome-devtools-mcp` npm 1.7.0 (2026-08-10) for network/performance/console traces · `@playwright/mcp` 0.0.79 (2026-08-06) for Firefox/WebKit and device emulation · Playwright's own `toHaveScreenshot()` for local visual baselines · `@axe-core/playwright` 4.13.0 for WCAG · `@lhci/cli` 0.15.1 for performance budgets · `backstopjs` 6.3.25 (2024-09-07, stale) and `lost-pixel` 3.22.0 (2024-11-14, stale) as standalone visual-regression alternatives · paid SaaS: `chromatic` 18.5.0, Percy (`PERCY_TOKEN`), Applitools (`APPLITOOLS_API_KEY`), Browserbase (`@browserbasehq/mcp-server-browserbase` 2.4.3 + Stagehand 4.0.1, `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID`). Avoid: archived `@modelcontextprotocol/server-puppeteer`, `@executeautomation/playwright-mcp-server` 1.0.12 (duplicate tool names). Pick: chrome-devtools-mcp. Runner-up: @playwright/mcp for cross-browser.

**Design → code** — Figma remote `https://mcp.figma.com/mcp` (401, OAuth, all seats per Figma's guide) · Figma desktop Dev Mode local `http://127.0.0.1:3845/mcp` (paid plan + Dev/Full seat) · community `figma-developer-mcp` npm 0.13.2 with `FIGMA_ACCESS_TOKEN`. Pick: remote official.

**Code intelligence** — built-ins are `lsp` + `grep` + `ast_edit` + scout subagents. Additions: `serena` (PyPI `serena-agent` 1.7.0, 2026-08-09; `uv tool install -p 3.13 serena-agent` → `serena init` → `serena start-mcp-server --context codex --project-from-cwd`) for symbol navigation with project memory · `opencode-codebase-index` npm 0.24.0 for embedding-based semantic search · `pi-fovea` npm 0.18.0 for token-budgeted repo maps · `repomix` npm 1.18.0 (`--mcp`, `--compress`, `--stdout`) for bounded whole-repo packs · `files-to-prompt` PyPI 0.6 + `ttok` PyPI 0.3 for transparent pipelines. Skip: `mcp-language-server` (duplicates native `lsp`), JetBrains MCP (needs a running IDE), Sourcegraph (enterprise). Pick: serena when a repo is genuinely unfamiliar, otherwise native tools.

**Observability / errors** — `sentry` `https://mcp.sentry.dev/mcp` (401 OAuth; stdio `npx @sentry/mcp-server@latest --access-token=…`, npm 0.37.0) · `grafana` stdio `uvx mcp-grafana` with `GRAFANA_URL` + `GRAFANA_API_KEY`, hosted `https://mcp.grafana.com/mcp` (401) · Honeycomb, Datadog, Better Stack, Elastic (`@elastic/mcp-server-elasticsearch` 0.3.1, 2025-07-01) `[unverified launch details]` · Axiom hosted `https://mcp.axiom.co` `[unverified]`; the `logfire-mcp` stdio repo is archived. Pick: sentry. Runner-up: grafana if the stack is Prometheus/Loki/Tempo.

**Databases** — `postgres-mcp` PyPI 0.3.0 with `--access-mode=restricted` (the only verified read-only switch in this category) · `supabase` `https://mcp.supabase.com/mcp?read_only=true` (401) or npm `@supabase/mcp-server-supabase` 0.10.0 · `mongodb-mcp-server` npm 2.1.0 · `mcp-clickhouse` PyPI 0.4.1 · Neon hosted (npm `mcp-server-neon` is a stale 0.0.1 stub — use the hosted URL) · avoid the archived `@modelcontextprotocol/server-postgres`. Rule for all of them: grant a read-only DB role; most have no read-only flag.

**Cloud / infra** — AWS Labs PyPI servers (`awslabs.core-mcp-server` 1.0.27, `awslabs.aws-documentation-mcp-server` 1.1.30, `awslabs.cost-explorer-mcp-server` 0.0.21) via `uvx`, AWS default credential chain · Cloudflare remotes (`docs.` 200 anon, `observability.`/`bindings.`/`workers.`/`browser.` 401) · `vercel` `https://mcp.vercel.com` (401) · `mcp-server-kubernetes` npm 4.1.4 · Terraform and SonarQube are Docker/JAR-only and Docker is not installed here. Note: `hashicorp/terraform-mcp-server`, `docker/mcp-gateway`, `containers/kubernetes-mcp-server` all need a container runtime — install `orbstack` first.

**Issue tracking / knowledge** — `github` `https://api.githubcopilot.com/mcp/` (401; built-in `github` tool already covers issues/PRs) · `linear` `https://mcp.linear.app/mcp` (401 — note `/sse` is 404, use `/mcp`) · `notion` `https://mcp.notion.com/mcp` (401; npm `@notionhq/notion-mcp-server` 2.5.1) · `atlassian` `https://mcp.atlassian.com/v1/sse` (401) or PyPI `mcp-atlassian` 0.23.1 · `slack` `https://mcp.slack.com/mcp` (401) · `stripe` `https://mcp.stripe.com` (401) · Obsidian: npm `mcp-obsidian` 1.0.0 is from 2024-11-29 and requires the Local REST API community plugin — prefer reading the vault directly with `read`/`grep` since it is plain markdown on disk.

**Memory** — native mnemopi exposes `recall`/`retain`/`reflect`/`memory_edit` with local SQLite + embeddings, plus the standalone `mnemopi` CLI (`bun add --global @oh-my-pi/pi-mnemopi`). External alternatives, all duplicating it: `mem0ai` PyPI 2.0.18, `graphiti-core` PyPI 0.29.3, `basic-memory` PyPI 0.22.1, `@modelcontextprotocol/server-memory` npm 2026.7.4. Recommendation: none — use the native backend.

**Security / quality** — `semgrep` CLI 1.173.0 + `uvx semgrep-mcp` (PyPI 0.9.0, 2025-09-29) or hosted `https://mcp.semgrep.ai/mcp` (401, explicitly experimental) · `gitleaks` 8.30.1 · `trivy` 0.74.0 · `osv-scanner` 2.5.1 · `trufflehog` 3.97.0 · `pip-audit` PyPI 2.10.1 · Snyk (`SNYK_TOKEN`, cloud) · SonarQube MCP (Docker/JAR; `@sonarsource/sonarqube-mcp-server` is **not** on npm — 404) · CodeQL has **no Homebrew formula** (verified), install from `github/codeql-cli-binaries` if needed. Built-in `security_scan` + `security-reviewer` subagent remain the first pass.

**Eval / tracing for AI features** — `promptfoo` npm 0.122.0 · `deepeval` PyPI 4.1.8 · `arize-phoenix` PyPI 20.3.0 (self-host, OTLP, no vendor lock) · `langfuse` PyPI 4.14.4 · `inspect-ai` PyPI 0.3.259 · `ragas` PyPI 0.4.3 · `logfire` PyPI 4.40.0 · OMP-native session tracing: `@braintrust/pi-extension` npm 1.0.0 and `@raindrop-ai/pi-agent` npm 0.1.3 both auto-trace OMP sessions/turns/tool calls. Pick: phoenix for offline tracing, promptfoo for prompt matrices.

**Testing / coverage** — language-native coverage first (`@vitest/coverage-v8`, `pytest-cov` PyPI 7.1.0, `cargo-llvm-cov`) · mutation: `@stryker-mutator/core` npm 10.0.0, `mutmut` PyPI 3.7.0 · property-based: `hypothesis` PyPI 6.165.10, `fast-check` npm 4.9.0.

**Sandboxing / parallel agents** — built-in `omp worktree` manages agent worktrees under `~/.omp/wt`; `git worktree` directly for filesystem isolation · `pi-sandbox` npm 0.6.5 and `pi-landstrip` npm 0.18.33 add OS-level sandboxing to OMP itself · `container-use` (`brew install dagger/tap/container-use`, MCP command `container-use stdio`) needs Docker · `@devcontainers/cli` npm 0.88.0 · Apple `sandbox-exec` is deprecated. Pick: `omp worktree` + git worktrees; add `pi-sandbox` if untrusted code is being run.

**OMP-native plugin ecosystem (historical npm download snapshot)** — installed picks: `@upstash/context7-pi`, `pi-lens` 37 987, `@plannotator/pi-extension` 43 063. Notable alternatives worth knowing: `pi-web-access` 257 972 (search/fetch/PDF/YouTube analysis), `@vigolium/piolium` 231 817 (multi-phase security audits), `context-mode` 77 776 and `@hypabolic/pi-hypa` 11 271 and `pi-mega-compact` (download count `[unverified]`) for context compression, `pi-background-tasks` 45 745, `@dietrichgebert/ponytail` 43 334, `@ff-labs/pi-fff` 32 966 (fuzzy search), `pi-simplify` 29 329 (clarity review), `@gotgenes/pi-permission-system` 26 413 and `smart-approve` (approval policy), `@juicesharp/rpiv-voice` 21 118 (on-device Whisper dictation), `bigpowers` 15 289 (73 skills), `@danypops/pi-tickets` 9 779, `pi-zentui`/`@narumitw/pi-statusline`/`pi-powerline-footer` (statusline). Before installing, check the duplicate-plugin exclusions under "Operate this configuration" above.

**Skill/plugin marketplaces** — `omp plugin marketplace add anthropics/skills` (official Anthropic skills, `.claude-plugin/marketplace.json` verified present) · `omp plugin marketplace add obra/superpowers` (TDD/planning/debugging methodology; `.claude-plugin/` present) · treat every other community "100+ agents" collection as unvetted: audit scripts, licence and tool overlap before enabling anything.
