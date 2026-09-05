---
name: lintmax
description: Runs pnpm check and pnpm build, plus optional cumulative checks selected by depth level (shallow, medium, deep), then automatically fixes any type errors, lint violations, build failures, or test failures that arise. Use when the user invokes /lintmax or asks to lint and build the project, with optional depth=shallow|medium|deep.
---

# lintmax

Run a cumulative set of project checks selected by `depth`. Read repository
instructions and scripts first; fix reported issues within the requested scope,
preserving existing work. Report unrelated or environment-blocked failures rather
than broadening the task or changing configuration to manufacture a pass.

## Depth levels (cumulative)

- `depth=shallow` (default if no depth given): `pnpm check`, `pnpm build`
- `depth=medium`: everything in `shallow` plus `pnpm tsc --noEmit`, `pnpm test`
- `depth=deep`: everything in `medium` plus `pnpm agent-test`, only if that script
  exists in `package.json`. Otherwise report it as not applicable. Review live
  model calls, external effects, and authorised budget before running agent tests.

Resolve the depth from the user's argument. Accept either `depth=<level>` or a bare `<level>` (e.g. `/lintmax medium`). If neither is provided, treat as `shallow`.

## Procedure

1. Snapshot uncommitted state with `git status` before making any changes.
2. Determine the depth level and build the ordered list of commands to run.
3. For `deep`, check `package.json` scripts for `agent-test`; drop it from the list if missing.
4. Run each available command in order. Fix task-related source failures before
   moving to the next. A missing script or dependency is a reported gap; do not
   invent a script or install packages merely to satisfy this list.
5. Re-run all selected commands to confirm a clean pass.
6. If issues persist after two rounds, report what remains and why it cannot be auto-fixed.
7. Inspect the final diff and status. A lint/build request does not itself request
   publication. Commit with message `lintmaxxed` and push only when explicitly
   requested, all checks passed, and the worktree was clean before this task.
   Stage only the reviewed task files; never use blanket staging.

## Rules

- Fix the root cause — never suppress errors with `// @ts-ignore`, `any` casts, eslint-disable comments, or `.skip` on tests unless the error is genuinely unfixable and you explain why.
- Do not reformat unrelated code or make changes beyond what is needed to fix reported errors.
- A clean starting worktree is necessary but not sufficient for commit/push:
  publication must also be requested. Never bundle pre-existing or concurrent work.
- Summarise commands actually passed, each followed by `✓`. Example for medium:
  `pnpm check ✓  pnpm build ✓  pnpm tsc --noEmit ✓  pnpm test ✓`.
  List omitted, blocked, or failing commands separately with their reason; never
  silently omit a requested check.
