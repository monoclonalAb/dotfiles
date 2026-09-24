# Clear conversation review state on manual focus

**Status:** Complete; activated through the [0.9.1 upgrade](2026-09-24-herdr-0.9.1-port.md)

2026-09-24 revalidation: upstream 0.9.1 includes the native focus-event fix.
The installed/running stock baseline had already advanced to 0.9.1; the newly
installed custom 0.9.1 build retains these regression tests, and its isolated
actual-click suite passes. Do not install the older candidate below over 0.9.1.
The approved 0.9.1 handoff subsequently activated the custom server while preserving
all 64 shell processes. The linked upgrade records current deployment evidence and
its separate handoff-attention caveat; the evidence below describes the original
0.9.0 work. Live human click/appearance confirmation was not claimed.
**Scope:** Herdr pinned patch, next-agent regression fixture, build test selection and operator docs.

## Objective

Clicking a completed conversation clears its peach/orange review indicator just
like the attention hotkey, without acknowledging a sibling conversation.

## Non-goals

- Change agent lifecycle semantics or the attention ledger's ownership.
- Restart, install over, or hand off the live server without explicit approval.
- Alter unrelated in-progress work (the worktree was already extensively dirty).

## Context and constraints

- `next-agent` listens to `pane.focused`; public `pane.focus` emits it, but Herdr
  0.9 client-shell requests call `accept_current_focus_without_events`.
- Source pin: `b99002ac99b09e00b4ca692436cb15a6b0d676f1`.
- PTY focus transitions are client-local and must stay so; expose plugin/API
  navigation events separately, only when that client's actual pane changes.
- Canonical binary owner: `herdr/.config/herdr/patches/herdr-0.9.0-focused-pane.patch`.

## Acceptance criteria

- [x] Actual sidebar clicks clear the target's review metadata across tabs/Spaces.
- [x] Unvisited siblings retain review metadata; subsequent work can raise it again.
- [x] Native tests retain client isolation and avoid spurious/duplicate focus events.
- [x] Build-only candidate and focused checks pass; deployment gap is explicit.

## Approach / progress

1. [x] Trace attention producer/consumer and identify suppressed native focus events.
2. [x] Add failing native/PTY regressions and fix the pinned patch.
3. [x] Build/test the candidate outside the repository and update owning docs.
4. [x] Activated via the separately approved/rehearsed 0.9.1 handoff; see the linked
   upgrade for process-preservation and server-identity evidence.

## Decisions

- Fix native event delivery, not a polling workaround or a second attention writer.
- Preserve existing PTY focus handling; plugin events must not steal another client's focus.

## Verification

- Baseline native regression — **failed as expected**: navigation emitted no
  `pane.focused` event. Baseline isolated PTY regression with installed Herdr —
  **failed as expected**: click focused/rendered the target but left review orange.
- Patched preflight (`git apply --check`, then apply to a fresh local clone of the
  pin) — **passed**; all 36 patched files byte-match the tested source.
- In `/tmp/herdr-click-source.8f40Mr`:
  `ZIG=/opt/homebrew/opt/zig@0.15/bin/zig rustup run 1.96.1 cargo build --locked --release`
  — **passed**, build only; no installed binary replacement.
- In that checkout, `cargo test --locked --release --bin herdr -- <the exact filters
  in bin/.local/bin/install-herdr-focus> --test-threads=1`, with the same pinned
  Rust/Zig — **passed**, 250 tests. Output: `/tmp/herdr-click-suite.log`.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s herdr/.config/herdr/plugins/next-agent -p 'test_*.py'`
  — **passed**, 19 tests.
- Equivalent command for `plugins/spaces-env` (also consumes workspace focus) —
  **passed**, 39 tests.
- `HERDR_TEST_BIN=/tmp/herdr-click-source.8f40Mr/target/release/herdr PYTHONDONTWRITEBYTECODE=1 python3 herdr/.config/herdr/plugins/next-agent/pty-smoke.py`
  — **passed twice**: jump/return, reviewed exclusion, actual sidebar clicks across
  tabs/Spaces, actual split-body clicks, sibling preservation, subsequent completion.
  Only isolated servers and owned PTYs received input.
- `sh -n bin/.local/bin/install-herdr-focus`, `git diff --check`, and native
  checkout `git diff --check` — **passed**.
- Production install/handoff — **not run**; requires explicit approval.

## Candidate for follow-up

Revalidate against current sources before use (temporary files may disappear):

- Binary: `/tmp/herdr-click-source.8f40Mr/target/release/herdr`
- Binary SHA-256: `cc8c48ffa80db433a757a3fe8ff5e14d308454f5dcbf2167cde4628c9c71035a`
- Patch SHA-256: `662f97b9c6655ecc81b3a9b3b1b05efa720115c88bc4589e5b29ca66096547d3`
- Native changes: expose the existing API/plugin event emitter; call it only when
  this client's before/after pane differs. Keep PTY transitions and other client
  locations unchanged. The existing next-agent implementation required no edits.

## Risks and recovery

The existing server continues using its loaded executable. A verified new binary
requires a natural server restart or explicitly approved live handoff; the latter
disconnects clients and must follow `docs/VERIFICATION.md`.
