---
name: lintmax
description: Runs pnpm check and pnpm build, plus optional cumulative checks selected by depth level (shallow, medium, deep), then automatically fixes any type errors, lint violations, build failures, or test failures that arise. Use when the user invokes /lintmax or asks to lint and build the project, with optional depth=shallow|medium|deep.
---

# lintmax

Run a cumulative set of project checks selected by the `depth` argument. For every error or warning that appears, fix it directly in the source files. Repeat until the required commands pass cleanly.

## Depth levels (cumulative)

- `depth=shallow` (default if no depth given): `pnpm check`, `pnpm build`
- `depth=medium`: everything in `shallow` plus `pnpm tsc --noEmit`, `pnpm test`
- `depth=deep`: everything in `medium` plus `pnpm agent-test` — but ONLY if `agent-test` is defined as a script in the repo's `package.json`. If it is not defined, skip that step silently and proceed.

Resolve the depth from the user's argument. Accept either `depth=<level>` or a bare `<level>` (e.g. `/lintmax medium`). If neither is provided, treat as `shallow`.

## Procedure

1. Snapshot uncommitted state with `git status` before making any changes.
2. Determine the depth level and build the ordered list of commands to run.
3. For `deep`, check `package.json` scripts for `agent-test`; drop it from the list if missing.
4. Run each command in order. After each one, fix all reported issues (type errors, lint violations, unused imports, missing types, bad imports, compile errors, test failures, etc.) directly in the source files before moving to the next.
5. Re-run all selected commands to confirm a clean pass.
6. If issues persist after two rounds, report what remains and why it cannot be auto-fixed.
7. After a clean pass, check whether the only uncommitted changes are the fixes just applied (i.e. `git status` was clean before step 1, or every changed file was already dirty only due to lintmax edits). If so, stage all changes, commit with message `lintmaxxed`, and push.

## Rules

- Fix the root cause — never suppress errors with `// @ts-ignore`, `any` casts, eslint-disable comments, or `.skip` on tests unless the error is genuinely unfixable and you explain why.
- Do not reformat unrelated code or make changes beyond what is needed to fix reported errors.
- Only commit and push if the working tree was clean before lintmax ran — do not bundle pre-existing uncommitted changes into the commit.
- After a clean pass, print a one-line summary listing exactly the commands that ran, each followed by `✓`, joined by two spaces. Example for medium: `pnpm check ✓  pnpm build ✓  pnpm tsc --noEmit ✓  pnpm test ✓`. For deep when `agent-test` was missing, omit it from the summary.
