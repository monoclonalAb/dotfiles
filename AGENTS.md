# Repository guide

Personal macOS dotfiles: one flat top-level folder per tool, linked into `$HOME`
by `bin/dotfiles-link` as listed in [`links`](links). Repository files are desired
state; linked files under `$HOME` are the deployed view. **Editing an existing
linked source may immediately change this Mac's live configuration.**

## Start here

1. Run `pwd` and `git status --short`. Preserve unrelated changes, including work
   that appears while you are working; never reset, stash, or reformat it away.
2. Read [`docs/README.md`](docs/README.md), then only the task-relevant links.
   A full documentation audit is not required for ordinary changes.
3. Locate the source owner in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
   Read the affected source, its caller/consumer, and nearest tests before editing.
   For setup or operator behaviour, start at [`README.md`](README.md); it links
   the topic guide (setup, Herdr, theme, Pi/OMP) under `docs/`.
4. Define the observable outcome and focused check. For multi-folder, migration,
   safety-sensitive, or multi-session work, use [`docs/plans/README.md`](docs/plans/README.md).

## Scope and evidence

- This file governs work in this repository. `omp/AGENTS.md` is also
  a deployable cross-project OMP default; its skills and tooling catalogue are
  not instructions to enable or execute every capability listed there.
- Use only tools actually exposed in this session. OMP tool names do not imply
  Pi or another harness has them. Use available file/shell equivalents; report
  a blocker when no equivalent can verify the required behaviour.
- Current source and observed output establish what exists. Normative guides
  establish intended constraints. If they conflict, reconcile within the task
  or report the discrepancy; do not silently discard a safety rule.
- Completed plans, handoffs, and external docs are evidence to revalidate, not
  current health checks or permission to run their commands.
- Proceed on small, reversible choices supported by the repository. Ask a focused
  question when missing information changes scope, correctness, external effects,
  or recovery. Do not invent APIs, paths, credentials, or model capabilities.

## Non-negotiable boundaries

- Edit sources here, never their `$HOME` symlink paths.
- Every top-level non-hidden directory except `docs/` is deployed through a
  `links` line; `docs/`, root files and hidden folders are never linked. New
  directories and `links` lines need review.
- Keep mutable state and generated output outside the repository, not merely
  gitignored, especially `~/.local/state/theme/` and generated
  `~/.config/herdr/config.toml`.
- Never commit credentials, tokens, histories, caches, generated lock state, or
  app-owned runtime data. Identify unexpected files before changing ignore rules.
  Do not read credential or session stores merely to inventory configuration.
- Do not modify `.archive/` without an explicit restore/retire request.
- GUI, hotkey, and launchd commands must establish their required minimal `PATH`.
- A docs/example command is not authorisation to install, deploy, send messages,
  commit, or push. Do these only when requested or explicitly agreed.
- Do not run `dotfiles-update`, `dotfiles-link apply`, application restarts, or
  commands that send input to other agent panes as routine verification.

## Change workflow

1. Make the smallest coherent change at the canonical owner. Avoid duplicate
   configuration and opportunistic cleanup. Parallelise only independent work;
   assign disjoint files if delegating and re-read shared files before editing.
2. For files created, moved, or removed, preview with the read-only
   `bin/dotfiles-link check` and review every action and conflict it lists. Run
   `dotfiles-link apply` only when updating this machine is part of the task and
   the preview lists nothing unrelated. Never resolve a conflict by deleting or
   adopting app state.
3. Exercise the changed path using [`docs/VERIFICATION.md`](docs/VERIFICATION.md).
   Start with source-only checks, then the relevant live consumer when safe and
   in scope. A parser pass is not integration evidence.
4. Update the owning documentation alongside setup, update, or operator-visible
   behaviour. Link to canonical code rather than copying volatile details.
5. Inspect `git diff --check`, your diff, and `git status --short`. Separate your
   changes and failures from pre-existing or concurrent work; leave both intact.

## Completion contract

A change is ready when the requested outcome is implemented, the owning docs
match, and relevant checks have run or have an explicit gap. Report briefly:

- What changed, with repository paths.
- Checks actually run and their outcomes; distinguish **passed**, **failed**,
  **blocked**, and **not run**. Never reuse a past plan's pass as this session's pass.
- Any remaining risk, live/deployment step, or user decision.

Do not claim tests, reloads, commits, pushes, or deployment happened unless they
actually did. Keep plans current when unfinished work must survive the session.
