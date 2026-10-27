# Move shared skills from omp/ into pi/

**Status:** Complete
**Scope:** `omp/skills/`, `omp/scoped-skills/`, `pi/`, `omp/config.yml`, docs,
Workspace Context MCP skill index, and 48 untracked scoped-skill links in 12
project repositories under `~/Desktop/projects`.

## Objective

Everything Pi uses lives in `pi/`. Global skills move to `pi/skills/`
(deployed to `~/.pi/agent/skills/`, which `/skill` already scans) and scoped
skills to `pi/scoped-skills/` (`~/.pi/agent/scoped-skills/`, not
auto-discovered). OMP keeps working by reading `~/.pi/agent/skills` through
`skills.customDirectories`. `omp/` keeps only OMP-only settings.

## Non-goals

- Retiring OMP or moving OMP-only config (`config.yml`, `mcp.json`, agents,
  extensions, `AGENTS.md`, `TOOLING.md`).
- Renaming skills (including `omp-repo-setup`).
- Changing `selective-skills.ts` (it still scans `~/.omp/agent/skills` as a
  compatible location; concurrent uncommitted work touches that file).
- Committing project-repo changes (the links are untracked there).

## Context and constraints

- Baseline `bin/dotfiles-link check`: 251 links in place, nothing pending.
- Pre-existing uncommitted work in `docs/AGENT-TOOLS.md`, `pi/extensions/README.md`,
  `pi/extensions/selective-skills.ts`, `pi/settings.json` and `quota-router`;
  leave it intact.
- OMP 18.10.3 verified in a temporary HOME: `skills.customDirectories:
  [~/.pi/agent/skills]` makes `omp read skill://<name>` resolve a skill there;
  with an empty list it does not.
- Pi (npm) auto-loads `~/.pi/agent/skills` unless started with `--no-skills`.
  The `bin/pi` wrapper and the Herdr task launcher pass it; a bare npm `pi`
  would now preload the six global skills. `/btw` uses an empty skill loader.
- Between the source move and `dotfiles-link apply`, deployed skill links under
  `~/.omp/agent/` dangle and the skills are unavailable in both harnesses.

## Acceptance criteria

- [x] `omp/skills/*` and `omp/scoped-skills/*` moved with `git mv` into `pi/`.
- [x] `omp/config.yml` adds `~/.pi/agent/skills` to `skills.customDirectories`.
- [x] Docs, `omp/AGENTS.md`, `omp-repo-setup` and the Workspace Context MCP
      index point at the new paths.
- [x] `bin/dotfiles-link check` lists only the expected creates/removes.
- [x] User approves; `bin/dotfiles-link apply` run; check reports nothing pending.
- [x] Empty leftover directories under `~/.omp/agent/{skills,scoped-skills}` removed
      with `rmdir` (only if empty).
- [x] 48 project links re-pointed from `~/.omp/agent/scoped-skills/<name>` to
      `~/.pi/agent/scoped-skills/<name>`; none dangle.
- [x] `omp read skill://visual-verify` resolves from `~/.pi/agent/skills`.

## Progress

- [x] Plan written; source moves and doc updates done; preview reviewed.
- [x] User approved; deployed, cleaned up and re-linked (see Verification).

## Decisions

- **Option A (keep OMP):** chosen by the user over retiring OMP.
- **Keep project links at `.omp/skills/<name>`:** both OMP and Pi's `/skill`
  scan that folder, so only the link target changes.

## Verification

- 2026-10-20: baseline `bin/dotfiles-link check` clean (251 in place).
- 2026-10-20: OMP `customDirectories` probe in temporary HOME passed (positive
  and negative control).
- 2026-10-20 after the move: `bin/dotfiles-link check` lists 20 creates under
  `~/.pi/agent/{skills,scoped-skills}` and 20 removes of dangling links under
  `~/.omp/agent/{skills,scoped-skills}`; nothing unrelated, 0 blocking.
- dotfiles-link unittest (29) passed; Workspace Context MCP node suite (35)
  passed; empty-home apply/check passed and deploys both new folders.
- Real `links` applied to a temporary HOME: `omp read skill://visual-verify`
  and `skill://omp-repo-setup` resolve from `.pi/agent/skills`; `lintmax`
  (scoped) is correctly not discovered. Pi `loadSkills` on the same tree finds
  all six global skills with 0 diagnostics.
- `git diff --check` and `git diff --cached --check` passed.
- **Deployed 2026-10-20:** `bin/dotfiles-link apply` (20 created, 20 removed);
  follow-up check reports 251 in place, nothing pending. `~/.omp/agent/skills`
  and `scoped-skills` held only empty folders and were removed with `rmdir`.
- 48 project links re-pointed with `ln -sfn`; 0 old-target links remain, 0
  broken, and no git changes in any of the 12 repositories.
- Live `omp read skill://visual-verify` and `agent-handoff` resolve from
  `~/.pi/agent/skills`; `skill://lintmax` resolves in `habithealth-de01`.
  Pi `loadSkills` over `~/.pi/agent/skills` plus that project's `.omp/skills`
  finds 6 global and 5 scoped skills with 0 diagnostics. Not run: an
  interactive `/skill` in a live Pi session.

## Outcome

Shared skills live in `pi/skills/` and `pi/scoped-skills/`; OMP reads the global
ones through `skills.customDirectories`. `omp/` holds only OMP-specific files.
