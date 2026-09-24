# Workspace Context MCP: index every local repository for agents

**Status:** Complete
**Scope:** `bin` (server source and launcher), `omp` (global MCP catalogue), `pi` (global MCP override); reads `~/Desktop/projects/**` and `~/dotfiles` at runtime; no external systems.

## Objective

Agents in Pi and OMP can ask one local, read-only MCP server for workspace
context: which repositories exist, what each one is (docs, manifests, service
directories, integrations, git branch and worktrees), which ones use a given
stack such as VaultRE, the Digital Employee catalogue tier and card for a repo,
and full-text search across workspace documentation and code. The existing
`~/Desktop/projects/DE/projects-mcp` is a remote GitHub-backed status store and
does not do any of this.

## Non-goals

- Writing to any repository, catalogue card, or GitHub.
- Replacing `projects-mcp` (shared status store) or the DE `agents/**` system;
  this server indexes and serves them.
- Semantic/vector search, background daemons, or a persistent on-disk index.
- Reading `.env`, credential stores, or app-owned runtime data.

## Context and constraints

- Workspace root `~/Desktop/projects/DE` is not a git repo; it owns `AGENTS.md`
  and `agents/{repo-catalog.md,repos/*.md,*.md}` (the DE context layer).
- Repos follow `base-DE-template`: `src/services/*` = integrations,
  `src/workflows/*`, `.everyday.json`, `.github/workflows`, `.agents/skills`.
- Git worktrees exist both beside main checkouts and under `~/.herdr/worktrees/`.
- Stow uses `--no-folding`; new files go live only when `bin`/`pi` are stowed.
- Launcher is reachable from GUI/MCP hosts, so it must resolve `node` without a
  shell profile (nvm at `~/.nvm/versions/node/*`).
- Zero npm dependencies: the MCP stdio protocol is implemented directly so no
  `node_modules` or install step lands in the repository.
- `~/.config/mcp/mcp.json` is host-local and holds a token; not touched.

## Acceptance criteria

- [x] `workspace-context-mcp call list_repositories` enumerates every git repo
      and worktree under the default roots, including the two DE worktrees
      (82 records: 79 repos, 2 worktrees, 1 manifest project).
- [x] `get_repository_context RayWhite-DE04` reports services, workflows,
      manifests, docs, tier, catalogue row and card path.
- [x] `find_repositories_by_stack VaultRE` returns the Ray White repos with evidence
      (service directory, env key, skill, doc and card mentions).
- [x] `get_related_de_context` returns catalogue row, card, topic guides and
      same-customer siblings for a DE repo, and a clear "no layer" answer otherwise
      (`beacon`), plus the exclusion reason for `PRBT`.
- [x] `search_workspace` returns ranked doc hits with line numbers; code scope
      uses ripgrep when present.
- [x] Stdio MCP handshake (`initialize`, `tools/list`, `tools/call`) works from a
      spawned process; `node --test` suite passes (35/35).
- [x] Server registered in `omp/.omp/agent/mcp.json` and `pi/.pi/agent/mcp.json`;
      README, ARCHITECTURE, VERIFICATION and TOOLING updated.

## Approach

1. Server under `bin/.local/lib/workspace-context-mcp/` (`git.mjs`, `layers.mjs`,
   `indexer.mjs`, `search.mjs`, `tools.mjs`, `protocol.mjs`, `server.mjs`) plus
   launcher `bin/.local/bin/workspace-context-mcp`.
2. Tests with temporary fixture workspaces; CLI `call`/`index`/`doctor` modes.
3. Register in OMP and Pi global configs; document; stow preview.

## Progress

- [x] Repo orientation, existing `projects-mcp` reviewed, workspace surveyed.
- [x] Implementation and tests (seven modules, three suites, fixture workspace).
- [x] Registration, docs, verification; `bin` stowed (plan contained only these
      files). `pi` **not** stowed: its plan also includes unrelated in-flight
      extensions (`subagents/`, `task-observer/`), so `~/.pi/agent/mcp.json` is
      pending the owner's `stow pi` plus `/reload`.

## Decisions

- **Location:** `bin` package (`~/.local/lib/<tool>` + `~/.local/bin/<tool>`), the
  documented owner for cross-application commands; avoids a new top-level package.
- **No SDK dependency:** hand-written JSON-RPC over stdio keeps the repo free of
  generated `node_modules`; protocol surface is small (initialize, ping,
  tools/list, tools/call, empty resources/prompts lists).
- **Git metadata from files, not spawns:** `.git/HEAD`, `refs`, `packed-refs`,
  `config`, `worktrees/*` are read directly so indexing ~85 repos stays fast;
  `git` is spawned only for per-repo detail (status, last commit).
- **Pi registration:** new managed `pi/.pi/agent/mcp.json` (Pi global override)
  rather than the unmanaged, token-bearing `~/.config/mcp/mcp.json`.

- **Real paths everywhere:** roots are `realpath`-ed and the entry guard compares
  real paths, because git records resolved paths (`/private/var` on macOS) and
  the stowed launcher passes a symlinked `argv[1]`. Both surfaced as bugs.
- **Layer detection:** a directory with a code manifest is a project, never a
  layer (`hack6` has both `AGENTS.md` and `package.json`).

## Verification

- `node --test bin/.local/lib/workspace-context-mcp/*.test.mjs` — passed, 35/35.
- `sh -n bin/.local/bin/workspace-context-mcp`; `node --check` on each module — passed.
- `workspace-context-mcp doctor` — 82 repositories, 626 documents, DE layer with
  34 cards/34 catalogue rows/6 guides, index build ~0.3 s.
- Tool calls against the live workspace: overview, list (tier/stack filters),
  `get_repository_context RayWhite-DE04` and `/abs/path` lookup, `find_repositories_by_stack
  VaultRE|hubspot`, `get_related_de_context genius-de02|beacon|PRBT`, docs and
  ripgrep search, `list_worktrees` (12 linked, several outside roots),
  `read_workspace_file` containment/denials (`.env`, `.git/config`, traversal,
  outside roots) — passed.
- Stdio handshake through the deployed launcher under `env -i PATH=/usr/bin:/bin`
  (initialize → tools/list → tools/call, isError on denied read) — passed.
- `stow -n -v -t "$HOME" bin` (only new files) then applied; `stow -n -v -t "$HOME" pi`
  previewed only — see Progress.
- Not run: OMP `/mcp list` and Pi `/reload` + `/mcp` (need a fresh host session).

## Outcome

Implemented and deployed for OMP; Pi registration file is in the repository and
awaits `stow pi`. Follow-ups, if wanted: vector/semantic search, persisted cache,
exposing repositories as MCP resources, and richer customer aliasing.
