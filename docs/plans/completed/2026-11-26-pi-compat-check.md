# Check extensions automatically after each Pi update

**Status:** Complete
**Scope:** `bin/pi-compat-check`, `lib/pi-compat/`, new `pi/extensions/pi-compat/`,
two contract tests in `pi/extensions/omp-anthropic-route/` and `pi/extensions/agent-stuff/`,
docs (`pi/extensions/README.md`, `docs/AGENT-TOOLS.md`, `docs/VERIFICATION.md`,
`docs/ARCHITECTURE.md`).

## Objective

Several workflows rely on Pi internals or on Pi's exact text and file formats
(see Context). When a new Pi version is installed, by any method, their suites run
once against it in the background and any failure shows in every Pi session's
footer, with logs to read.

## Non-goals

- Fixing extensions for a future Pi; this only detects breakage.
- Running the suites of extensions that use public API only.
- A LaunchAgent or other scheduled job (machine-local by `docs/ARCHITECTURE.md`).
- Updating Pi automatically.

## Context and constraints

- At-risk workflows (Pi 1.6.1): modal-vim-navigation (private editor/renderer
  members, `dist/utils/clipboard*.js`), Pi Tasks (`herdr/plugins/task-launcher`,
  private `dist/` modules), quota-router and quota-footer (private
  `ModelRuntime.credentials`), compact-ui (patches `FooterComponent.prototype.render`,
  hidden theme global, parses `<project_instructions path=…>`), mcp-idle-stop
  (wraps `child_process.spawn`), agent-stuff (`BorderedLoader` private `loader`,
  `/btw` reuses the Vim editor, `/session-breakdown` parses session `.jsonl`),
  omp-anthropic-route (strips the `Pi documentation (read only` prompt block),
  restart (hard-coded Pi-written settings keys).
- The suites resolve Pi through `npm root -g`; the runner uses the same.
- Extensions must not change model context (`pi/extensions/README.md`).

## Acceptance criteria

- [x] `pi-compat-check` runs the 19 suites against the installed Pi, saves a
      result and per-suite logs under `~/.local/state/pi/compat/<version>/`, and
      exits non-zero on any failure; `--status` reports the latest result.
- [x] With no result for the installed version, a TUI Pi session starts one run
      in the background (one run across all sessions); failures show as a footer
      status and a one-time notice; nothing reaches the model.
- [x] A Pi rewording of the documentation block, or a session-file format change,
      fails a suite instead of passing silently.

## Approach

1. Runner script and its unittest suite.
2. `pi-compat` extension and its Bun suite.
3. Contract tests against Pi's real system prompt and session files.
4. Docs; link preview and apply; seed the 1.6.1 result.

## Progress

- [x] Baseline on Pi 1.6.1: all 19 suites pass, about 70 s in total.
- [x] Runner and its unittest suite; extension, Bun suite and PTY smoke; two contract
      tests; docs; links applied (6 created, nothing else listed); 1.6.1 result saved.

## Outcome

Live on this Mac from 2026-11-26. Open Pi sessions load the extension at their next
`/reload` or restart (the `restart` line names it). The first check will run when a
Pi newer than 1.6.1 is installed. The canonical description is
[`pi/extensions/pi-compat/README.md`](../../../pi/extensions/pi-compat/README.md).

## Decisions

- Triggered from Pi (every minute, like `restart`) rather than a LaunchAgent or
  the `pi` wrapper: catches `pi update` and `npm install -g` alike, needs no
  machine-local job, and shows results where Pi is used.
- Item "restart's Pi-written settings keys" has no contract test: a new key only
  causes a false "changed" notice.
- A session that started the check re-reads the result when the check process
  exits, not at the next minute's poll. A started check that never saves a result
  shows `Pi <v> not checked: run pi-compat-check` after three minutes and is not
  retried by that process.
- During this work another session changed `compact-ui`, `codex-fast`, `bin/pi-agent`,
  `pi/settings.json` and others (uncommitted). Those changes are theirs and were
  left alone. A check's result records `dirty` so a failure caused by local edits
  can be told apart.

## Verification

All on Pi 1.6.1, 2026-11-26:

- `lib/pi-compat` unittest (8 tests): passed.
- `bun test ./pi/extensions/pi-compat/*.test.ts` (12 tests): passed.
- `python3 pi/extensions/pi-compat/pty-smoke.py`: passed.
- New omp-anthropic-route real-prompt test: passed; it failed as intended with
  `stripPiDocumentationBlock` temporarily mismatched (restored with `git checkout`).
- New agent-stuff Pi-written session-file test: passed.
- `bin/pi-compat-check` real run: 19 of 19 passed (88 s of suite time); `--status`
  through `~/.local/bin` from `/tmp`: passed.
- `DefaultResourceLoader` over the real `~/.pi/agent`: 21 extensions, no errors,
  `pi-compat` among them.
- Not run: a check triggered by an actual Pi update (none is available yet).
