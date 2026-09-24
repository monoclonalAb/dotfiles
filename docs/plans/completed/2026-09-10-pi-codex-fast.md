# Codex-only fast toggle in Pi

**Status:** Complete
**Scope:** Pi extension source, owning docs, affected-package Stow preview.

## Objective

Add `/fast [on|off|status]` (bare command toggles) for supported OpenAI Codex
models only, without changing Claude, other providers, reasoning or context.

## Non-goals

- Claude fast mode, global preferences, provider replacement or credential access.
- Real paid model requests, other-pane input or automatic reloads.

## Constraints and decisions

- Preserve the extensive pre-existing worktree changes.
- Explicitly approve only the requested service-tier field in the extension policy.
- OpenAI's current speed docs list GPT-5.4, GPT-5.5, GPT-5.6 and GPT-6 Astra;
  Codex `protocol/src/config_types.rs` maps Fast to wire value `priority`.
- Installed Pi's `before_provider_request` reaches the native Codex payload before
  both SSE and WebSocket serialization. No transport/provider fork is needed.
- Start off on every session/reload; switching to an unsupported model clears
  opt-in. No persisted mutable state. Warn about increased ChatGPT credit usage.

## Acceptance criteria / progress

- [x] Read owner, nearest tests, installed Pi docs/examples and provider consumer.
- [x] Implement command, status and strict provider/API/model gating.
- [x] Test default/off/on, unsupported providers/models, lifecycle, busy/invalid
  input, exact payload preservation and native request serialization.
- [x] Update policy/operator/check docs and review affected-package Stow preview.
- [x] Inspect final diff and report deployment and live-provider gaps.

## Verification

From the repository root:

- `bun test ./pi/.pi/agent/extensions/codex-fast/index.test.ts` — passed:
  8 tests, 128 assertions.
- `node --test pi/.pi/agent/extensions/codex-fast/native.test.mjs` — passed:
  3 transport cases (SSE, WebSocket, cached WebSocket), native commands, reload,
  wire-tier toggles and unchanged native Anthropic/direct OpenAI payloads.
  Initial fixture failures (Anthropic URL/header serialization and same-tier
  WebSocket reuse assumptions) were corrected before the passing rerun.
- `tsc -p <temporary-tsconfig>` — passed: strict no-emit check of `index.ts`
  against installed Pi public declarations, no dependencies installed.
- `stow -n -v -t "$HOME" pi` — passed preview, but also proposed unrelated
  pending subagents/task-observer links; not applied unfiltered.
- `stow -n -v -t "$HOME" --ignore='(^|/)(subagents|task-observer)(/|$)' pi`
  — reviewed: only four new codex-fast files. Applied the same command without
  `-n`; all four targets verified as source symlinks. Repeat dry run: no actions.
- `git diff --check` — passed; existing/concurrent changes preserved.
- Real provider availability, speed, billing and combined live TUI — not run.
  No paid request, other-pane input or live session reload.

## Risks and recovery

Priority requests consume more credits; enabled status describes the request,
not a guarantee of server availability or billing. `/fast off` or `/reload`
removes this extension's override. No live paid request is needed for verification.

## Outcome

Implemented and linked `pi/.pi/agent/extensions/codex-fast/`; owning operator,
extension-policy and verification docs updated. Run `/reload` in an idle Pi
session, then `/fast` to opt in. Default remains off. Other pending extensions
were not deployed. No credential/state files were read or changed.
