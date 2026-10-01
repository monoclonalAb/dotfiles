# Workspace Context MCP

A local, read-only [MCP](https://modelcontextprotocol.io) server that indexes
every repository on this machine's workspace and answers agent questions about
it: which repositories exist, what each one is, which use a given stack or
integration, how a Digital Employee (DE) repository sits in the workspace
catalogue, and where a phrase appears in documentation or code.

It replaces the gap left by `~/Desktop/projects/DE/projects-mcp`, which is a
remote GitHub-backed project-status store rather than a workspace index.

## Layout

| Path | Role |
| --- | --- |
| [`../../bin/workspace-context-mcp`](../../bin/workspace-context-mcp) | POSIX `sh` launcher; resolves Node without a login shell and execs `server.mjs` |
| [`server.mjs`](server.mjs) | Entry point: `serve` (stdio MCP) plus `tools`, `call`, `index`, `doctor` CLI modes |
| [`protocol.mjs`](protocol.mjs) | Newline-delimited JSON-RPC 2.0 dispatcher: `initialize`, `ping`, `tools/list`, `tools/call`, empty `resources`/`prompts` lists |
| [`indexer.mjs`](indexer.mjs) | Root scan, repository records, manifests, structure, stack/integration tags, summaries, document corpus |
| [`git.mjs`](git.mjs) | Branch, head, remote and worktrees read from `.git` files; `gitDetail` spawns git for status/last commit on demand |
| [`layers.mjs`](layers.mjs) | Workspace layer parser: `AGENTS.md`, `agents/*.md` guides, `agents/repo-catalog.md` tables, `agents/repos/*.md` cards |
| [`search.mjs`](search.mjs) | In-process ranked document search; bounded ripgrep bridge for code |
| [`tools.mjs`](tools.mjs) | Tool schemas and handlers; index cache with TTL; path containment and credential deny-list |
| [`fixture.mjs`](fixture.mjs), `*.test.mjs` | Temporary fixture workspace (real git repos and worktrees) and `node --test` suites |

No npm dependencies. Node 20+ is required; the launcher tries
`WORKSPACE_CONTEXT_NODE`, `PATH`, the newest `~/.nvm/versions/node/*`, then
Homebrew.

## What gets indexed

Roots default to `~/Desktop/projects` and `~/dotfiles`; override with
`WORKSPACE_CONTEXT_ROOTS=/a:/b` or repeated `--root`. Each root is walked two
levels deep (`--depth`, `WORKSPACE_CONTEXT_DEPTH`) and yields:

- **repo** — a directory with a `.git` directory; **worktree** — a `.git` file
  pointing at a main repository; **project** — no git but a `package.json`,
  `pyproject.toml`, `go.mod` or `Cargo.toml`.
- **Layer** — a non-repository directory carrying `AGENTS.md` and/or `agents/`
  (the DE workspace root). Its catalogue rows, cards, exclusions and topic
  guides are attached to the repositories beneath it.
- Per repository: `AGENTS.md`/`CLAUDE.md`, README, `docs/**`, `agents/**`,
  `.agents/skills`, `.omp/skills` and similar `SKILL.md` files; `package.json`
  (names only, no versions), `pyproject.toml`, `.everyday.json`, `mise.toml`,
  `Dockerfile` base image, `.env.example` **key names only**, GitHub workflow
  names and markers (deploy-guardian, Cloud Run, WIF vs key auth, tests);
  `src/services/*`, `src/workflows/*` and route directories; linked worktrees
  wherever they live (for example `~/.herdr/worktrees`).
- Stack tags are derived from dependency names and file markers; integrations
  are service directory names plus integration-shaped tags, de-duplicated.

Never read: `.env` (only `.env.example`), lockfile contents, `node_modules`,
`dist`, `.git` internals beyond refs/config, or credential-shaped files.

The index is built lazily in memory (about 0.3 s for ~80 repositories) and
rebuilt after `WORKSPACE_CONTEXT_TTL_SECONDS` (default 300) or on
`refresh_index`. Nothing is written to disk.

## Tools

| Tool | Use |
| --- | --- |
| `get_workspace_overview` | Roots, groups, kinds, tier counts, layers and guides; call first |
| `list_repositories` | Compact rows; filter by `group`, `tier`, `kind`, `stack`, `query` |
| `get_repository_context` | Full record for one repo; `include: ["agents","readme","git"]` inlines docs or spawns git for status/last commit/upstream |
| `find_repositories_by_stack` | Term search over tags, integrations, services, workflows, dependencies, env keys, skills, manifests (strong) and doc mentions (weak), with evidence |
| `get_related_de_context` | Catalogue row, tier, card text, topic guides, same-customer siblings, worktrees, platform dependencies; explicit "no layer" answer otherwise |
| `search_workspace` | `scope: docs` ranked markdown search requiring every term; `scope: code` ripgrep (bounded, regex); `scope: all` |
| `list_worktrees` | Every linked worktree with branch, head, presence and whether it is inside the roots |
| `read_workspace_file` | Line-ranged read by absolute path or `<repo>/<relative>`; contained to roots and worktrees; credential deny-list |
| `refresh_index` | Rebuild now |

Repository arguments accept the directory name (case-insensitive), the
`owner/repo` remote slug, the package name or an absolute path.

## Registration

Pi registers it in [`pi/mcp.json`](../../pi/mcp.json) and OMP
in [`omp/mcp.json`](../../omp/mcp.json). Both run
`~/.local/bin/workspace-context-mcp serve`, so `bin/` and `lib/` must be linked (`dotfiles-link apply`).
After changes, `/reload` then `/mcp` in Pi.

## Diagnostics

```sh
workspace-context-mcp doctor                      # roots, Node, ripgrep, timing, counts
workspace-context-mcp index                       # one line per repository with tier and branch
workspace-context-mcp tools                       # tool names and descriptions
workspace-context-mcp call list_repositories '{"tier":"Tier 1"}'
workspace-context-mcp call find_repositories_by_stack VaultRE
workspace-context-mcp call get_related_de_context RayWhite-DE04
workspace-context-mcp call search_workspace '{"query":"replay harness","scope":"all"}'
```

`call` prints the same JSON a client receives; a bare second argument is used
as the tool's first required parameter. Set `WORKSPACE_CONTEXT_DEBUG=1` or
`--debug` for stderr logging (stdout is reserved for the protocol).

## Tests

```sh
node --test lib/workspace-context-mcp/*.test.mjs
```

The suites build a temporary workspace with real `git init` repositories, two
linked worktrees (one outside the roots), a manifest-only project, a python
repository and a DE-style layer, then exercise the indexer, every tool, the
JSON-RPC dispatcher and a spawned stdio server. They never touch the real
workspace and need only Node and git; the ripgrep test skips when `rg` is
absent.

## Limits and non-goals

- Heuristic, not semantic: stack tags come from a fixed dependency map plus
  file markers; unknown dependencies remain searchable by name.
- Customer grouping uses the name prefix before the first `-`/`_`
  (`RayWhite-DE04` → `raywhite`); the key is returned so callers can judge.
- Catalogue tiers and cards are read from the workspace layer as written;
  the server does not update them (see the DE root `AGENTS.md` maintenance rules).
- No writes, no network, no persistent cache, no background daemon.
