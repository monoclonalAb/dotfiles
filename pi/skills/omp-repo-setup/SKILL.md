---
name: omp-repo-setup
description: Select and link the minimum OMP capability set for the current repository — scoped skills, per-repository MCP servers, canonical commands, and verification paths. Use when a repo has no .omp/ configuration or when asked to "set up omp here", "link skills", or "enable MCP for this repo". Not for understanding the code (repo-recon) and not for authoring new skills.
---

# OMP repository setup

Configure the minimum, not the maximum. Every link and server needs a concrete, observed repository or task signal; leave off anything a native tool or installed plugin already covers.

## 1. Inventory (read-only)

Read repository instructions and `git status --short` first. This skill applies
only when OMP setup is requested; do not create `.omp/` for a Pi-only task.
Check: `justfile`; `package.json` scripts and dependencies (`hono`, `@everyday-artificial-intelligence/*`); `pnpm-lock.yaml`; `.everyday.json`; a `client/` frontend; existing `.omp/skills/` and `.omp/mcp.json`; and `.github/skills/`. Establish the repository name from its Git top-level directory before applying repository-name rules.

## 2. Link scoped skills

Sources live in `~/.pi/agent/scoped-skills/` (not auto-discovered). Link each skill whose signal holds; skip links that already exist; never copy skill content into the repository.

| Observed signal | Link |
|---|---|
| `pnpm-lock.yaml` exists | `lintmax` |
| `package.json` declares `@everyday-artificial-intelligence/prompt-behemoth` | `agent-test-author` |
| the Git top-level directory is `de-dashboard` | `everyday-ai-frontend-styleguide`, `gcp-investigate` |
| a DE service repository has `.everyday.json` | `perform-dangerous-action`, `gcp-investigate` |
| that DE service's `package.json` declares `hono` | `kpi-tracking` |
| an established DE has evidence of deployment and working workflows | `policy-guide-setup`, `system-design-template` |

```sh
mkdir -p .omp/skills
ln -s ~/.pi/agent/scoped-skills/<name> .omp/skills/<name>
```

For the established-DE row, require evidence rather than inferring it from `.everyday.json`: for example, deployed-environment configuration plus a maintained workflow with a recent successful run. If that classification is genuinely ambiguous (bare scaffold versus established DE), ask the user once; do not guess.

## 3. Keep the repository clean

If `.omp/` is neither tracked nor ignored here, add a single `.omp/` entry to the
local exclude file resolved by `git rev-parse --git-path info/exclude` (works when
`.git` is a worktree pointer file). Preserve existing entries. Do not edit the
repository's `.gitignore`, and do not commit the links unless the user asks.

## 4. MCP servers — only with a concrete need

- Before enabling a server, record its observable justification from the repository or task. Typical examples: `deepwiki` for a large, unfamiliar GitHub repository where repo-level Q&A is needed; `linear` where an issue, links, or the user's task establishes Linear as the repository's tracker; `microsoft-learn` where dependencies, imports, or task requirements establish Microsoft APIs as the target.
- Copy the complete matching server entry from the catalogue `~/.omp/agent/mcp.json` into `<repo>/.omp/mcp.json` with `"enabled": true`. Project files cannot use `enabledServers`, and the file must sit in the directory OMP is launched from.
- Never enable a server that duplicates a native tool (`github`, `browser`, `lsp`, mnemopi memory) or an installed plugin (`@upstash/context7-pi` already provides Context7 docs).
- The tracked defaults enable read-only `gcloud` and `gcp-observability` globally;
  confirm their effective availability before relying on them and do not re-declare
  them. Never touch the global catalogue or `disabledServers` during project setup.

## 5. Record canonical commands and verification paths

- Commands: prefer `justfile` targets; otherwise use the package-manager scripts (`check`, `build`, `test`). State which commands are canonical.
- Verification: UI work → `browser` and the `visual-verify` skill; service work → the repository's smoke command; agent behaviour → the `agent-test` script when present.

## 6. Report

End with: skills linked (each with its observed signal), MCP servers enabled (each with its observed justification), canonical commands, and anything deliberately left off together with the native capability that covers it. Changes surface in the next OMP session started in the repository.

## Do not use when

- Working in `~/dotfiles` itself — its committed `.omp/` is curated by hand.
- The task is to understand or map code — use `repo-recon`.
