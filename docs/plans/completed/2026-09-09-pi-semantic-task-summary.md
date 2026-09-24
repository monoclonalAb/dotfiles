# Semantic Pi conversation labels in Herdr

**Status:** Complete
**Scope:** Pi's `herdr-task-summary` extension and owning documentation.

## Objective

Replace prompt-prefix labels with model-generated descriptions of the task's meaning,
without changing the Pi conversation or Herdr's tree renderer.

## Non-goals

- Rename Pi sessions, worktrees or Spaces; modify lifecycle status; restart apps.
- Read credential/session stores, install dependencies, or call a paid provider as a test.

## Context and constraints

- Existing unrelated work in README, extension policy, Herdr and plans must survive.
- Installed Pi exposes `ctx.modelRegistry.complete(model, context, options)`;
  its `examples/extensions/summarize.ts` uses this authenticated side-call API.
- Auto-discovered extensions must not inject or replace main-agent context.
- Existing metadata reporter and `$task_summary` consumer remain the boundary.

## Acceptance criteria

- [x] A tool-free background request asks the selected model for a semantic 2–6-word title.
- [x] Bounded recent user context helps resolve references; no tool results/images sent.
- [x] Input/response validation, deduplication, timeout, stale-result suppression and lifecycle cancellation are tested.
- [x] Failures keep the previous semantic title (or `New conversation`), never a clipped prompt.
- [x] Documentation describes model usage, reload and verification limitations.

## Approach

1. Replace heuristic naming with bounded context preparation and output validation.
2. Add nonblocking model generation and lifecycle-safe metadata publication.
3. Exercise mocked model/reporter tests and installed API compatibility; update docs.

## Progress

- [x] Read owner, consumer, tests, installed extension documentation and summary example.
- [x] Replaced prompt clipping with semantic generation, bounded to four recent user requests, 2,048 output tokens and 30 seconds.
- [x] Added background debounce, memory-only cache, model/branch/shutdown cancellation and serialized metadata IPC.
- [x] Updated root README, extension policy, architecture and verification guide; retained unrelated work.

## Decisions

- **Model:** Use the active model/provider through Pi's existing registry, not a hardcoded cheaper model or a second agent session.
- **State:** Keep titles/cache in memory only; regenerate on reload. No session writes or runtime files.
- **Failure:** Retain a valid title instead of silently reverting to the rejected prefix heuristic.

## Verification

All commands ran from `/Users/eric/dotfiles`:

- `bun test ./pi/.pi/agent/extensions/herdr-task-summary/summary.test.ts` — passed, 19 tests. Includes installed Pi `ModelRegistry.complete` with a faux provider and in-memory credentials; no real provider request. An intermediate run before rewriting the old tests failed on removed heuristic exports; replaced tests now pass.
- `node --test pi/.pi/agent/extensions/herdr-task-summary/summary.test.ts` — passed, 19 tests on Node 24.19.0.
- `tsc -p "$config"` with a temporary `/tmp/pi-summary-tsc.*.json` — passed for all three extension files, strict/noEmit/NodeNext, resolving installed Pi declarations and Node types. An initial test-only narrowing error was corrected before the final pass. Temporary config removed.
- `git diff --check` and scoped diff inspection — passed; unrelated pre-existing changes retained.
- Real provider quality/billing, live pane rendering and `/reload` — not run. User should reload idle Pi conversations to activate the change; no Herdr changes needed.

## Risks and recovery

- Each distinct substantive request may add a small billable model call; input/output and deadline are bounded.
- Generated labels can still be imperfect. Revert this extension's changes and reload when idle to recover.

## Outcome

Implemented in `pi/.pi/agent/extensions/herdr-task-summary/{index,summary}.ts` with
19 focused checks in `summary.test.ts`. Existing `$task_summary` consumers need no
change. Real-provider title quality and live display remain manual checks after
an idle-session reload; mocked/faux responses are not evidence of semantic quality.
