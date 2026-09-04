# Show task summaries in Herdr agent rows

**Status:** Complete
**Scope:** Pi extension metadata, generated Herdr theme configuration, live Pi/Herdr sessions

## Objective

Make every Herdr Agents row task-oriented: a state glyph and concise conversation summary above dim Space/tab context, with no agent kind or Herdr nickname fallback.

## Non-goals

- Do not use an LLM to name sessions.
- Do not alter, inject, or persist model-visible Pi input.
- Do not redesign the existing environment filtering, attention ledger, or custom Herdr pane chrome.

## Context and constraints

- The worktree already contains uncommitted Herdr sidebar/environment work that must be preserved.
- [`../../../bin/.local/bin/theme`](../../../bin/.local/bin/theme) generates the live Herdr config; the generated file is not repository source.
- Pi extensions must follow [`../../../pi/.pi/agent/extensions/README.md`](../../../pi/.pi/agent/extensions/README.md).
- OMP already supplies useful terminal titles. Pi supplies only a repository title, so a display-only pane metadata token must bridge its user request into Herdr.
- Full-tree `git diff --check` has known whitespace errors in the pre-existing Herdr patch; verification must scope around that file rather than normalizing unrelated patch content.

## Acceptance criteria

- [x] No configured agent row contains the `agent` token or another kind/name fallback.
- [x] Pi reports a deterministic, bounded task summary from the current or most recent substantive user request, including on session reload when recoverable.
- [x] Clipboard/image-only paths and safe conversational boilerplate do not become summaries.
- [x] Reporting is display-only, best-effort, and inert outside a Herdr pane.
- [x] Focused tests and live Herdr metadata demonstrate the user-visible path.

## Approach

1. Add a context-neutral Pi extension with pure summary extraction and an injected, testable metadata reporter.
2. Change the generated Herdr Agents rows to use Pi's custom summary token and stripped terminal titles everywhere else, retaining workspace/tab context.
3. Update the owning operator/policy documentation, deploy the new Stow leaf, regenerate and reload Herdr configuration, then safely reload idle existing Pi sessions.
4. Run focused tests, native checks, Stow dry runs, scoped whitespace checks, and inspect live metadata/rows.

## Progress

- [x] Read repository guidance, Pi extension policy, full Pi extension docs, session format docs, relevant examples, current Herdr source consumer, and all pre-existing diffs.
- [x] Implemented and tested the metadata bridge and row configuration.
- [x] Stowed the extension, regenerated/reloaded the live config, reloaded safe idle Pi sessions, stamped working sessions for live inspection, and installed the tested Herdr binary for the next natural server start.

## Decisions

- **Display-only pane token:** Use `pane.report-metadata` from Pi without session entries, input transforms, messages, tools, or model calls.
- **Fallback ownership:** Pi's row uses its metadata token and naturally retains Space/tab context if no substantive request exists. OMP uses `terminal_title_stripped`; unknown integrations show only Space/tab context. No path uses Herdr's `agent` token.
- **OMP marker stripping:** The pinned Herdr patch removes OMP's stable `π > ` product marker from `terminal_title_stripped`; the new binary is installed but takes effect only after the current server's next natural restart.

## Verification

- `bun test ./pi/.pi/agent/extensions/herdr-task-summary/summary.test.ts` — passed: 7 tests.
- `bun test ./pi/.pi/agent/extensions/omp-anthropic-route/*.test.ts` — passed: 11 adjacent Pi extension tests.
- `install-herdr-focus` — passed: pinned build and 32 focused Rust tests; installed without restarting the server.
- focused spaces-env / next-agent Python suites — passed: 36 and 13 tests.
- `sh -n ...`; `zsh -ic 'exit'` — shell syntax passed; zsh returned 0 with the existing non-interactive monitor/gitstatus warnings.
- `herdr config check`; `theme status` — passed after live generation/reload.
- package-only `stow -n -v -t "$HOME"` for `pi`, `herdr`, `bin`, and `docs` — passed after deployment with no pending actions.
- scoped `git diff --check` plus trailing-whitespace scan of new files — passed; the known unrelated whitespace in the pre-existing Herdr patch was not normalized.
- live agent metadata — Pi panes exposed task summaries with state and workspace/tab fields; generated rows contained no `agent` token. The old running Herdr server still reports OMP's `π > ` prefix until its natural restart activates the installed build.

## Risks and recovery

- Reloading a blocked Pi prompt could answer it accidentally; inspect agent status and reload only idle sessions through `herdr agent prompt`.
- Pane metadata is in-memory; Pi re-reports it on startup/reload and after each substantive user message.
- Removing the extension and regenerating the prior theme config restores the old display behavior without touching Pi session files.

## Outcome

Herdr's generated row configuration is task-first and has no agent-kind/name fallback. Pi now reports deterministic display-only summaries and restores them from existing active branches on reload. The live config and safe existing Pi sessions were reloaded; working sessions were not prompted. The installed custom Herdr binary will remove OMP's product marker after the current server naturally restarts.
