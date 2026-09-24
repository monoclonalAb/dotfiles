# Expand the unified sidebar by default

**Status:** Complete
**Scope:** Herdr pinned patch and focused tests/docs; follow-up to the just-approved live sidebar installation. Isolated source/build: `/tmp/herdr-expanded-tree.omnpgw/`.

## Objective

All repository and Space/conversation branches start expanded, including inactive/new Spaces. Manual folding remains available for the current server lifetime. Ignore older saved repository folds when starting or handing off an inline-tree server, without changing legacy-mode restoration or Personal/Work filtering.

## Non-goals

- No always-open tree that prevents manual collapse; no resetting choices on ordinary config/theme reloads.
- No new worker/summary/cost features, source cleanup, agent input or pane-terminating restart.
- No session-store editing or unrelated deployment.

## Acceptance criteria

- [x] All visible Spaces default open regardless of focus; newly added Spaces also open.
- [x] Manual collapse still works and follows stable ids while the server runs.
- [x] Startup/handoff and switching into inline mode discard old folds; ordinary reload and legacy mode retain their behavior.
- [x] Native rendering/input/reload/default tests and pinned patch preflight pass; docs match.
- [x] Applied the follow-up via the same process-preserving handoff as the user-approved installation, warning of client disconnection and verifying live identities.

## Approach

1. Change the agent-disclosure fallback to expanded and share a guarded reset at inline-tree initialization boundaries.
2. Update tests that relied on implicit inactive-Space collapse; explicitly arrange manual folding where that is the behavior under test.
3. Build/sign outside the repository and reconstruct the canonical patch without overwriting unrelated hunks.
4. Rehearse installed-old → new handoff, then back up/install and verify pane processes and display metadata; no ordinary server stop or Pi/OMP reload.

## Progress

- [x] Read source, renderer/input consumers, startup/handoff restoration, reload logic and tests. Root cause: `space_agents_expanded` falls back to active-Space-only; repository folding reuses restored keys.
- [x] Created a fresh pinned checkout and applied the current patch; existing build cache cloned outside the repository.
- [x] Changed the disclosure fallback to true and added a guarded reset shared by startup, handoff and enabling inline mode. No session-store editing.
- [x] Added default/new-Space, reset/legacy, actual empty-snapshot handoff and mode-transition/reload checks; manually folded fixtures now state their intent explicitly.
- [x] Rebuilt/signed `/tmp/herdr-expanded-tree.omnpgw/herdr-expanded-tree`; reconstructed the canonical patch with 18 unrelated sections retained unchanged and all 24 patched files compared against a fresh application.
- [x] Rehearsed current installed build → new build plus rejected-protocol rollback using a private shell fixture; no HUP and process/I/O continuity passed.
- [x] Applied using the reviewed, freshly parameterized `activate.py` under `~/.local/state/herdr/deployments/2026-09-09-expanded.pXenpf/`. **Do not repeat it**: `activation.log` and `result.json` record successful handoff from PID 28609 to 43893. All 37 panes / 10 Spaces kept shell PIDs, foreground groups, session fingerprints and focus; filtering and 23 attention-token-bearing panes recovered, and 20 Pi labels were restored.

## Decisions

- **Expanded by default, not forced open:** explicit collapse lasts until a new server or a new inline-mode activation, not until the next render or theme reload.
- **Narrow feedback fix:** encode the preference in implementation and regression tests, not a global agent instruction.
- **Deployment:** preserve active pane processes using the reviewed live-handoff path; revalidate current artifacts/capabilities/PIDs and preserve backups. Past plans are evidence, not a script to repeat blindly.

## Verification

- Pinned clone and baseline patch preflight — **passed**.
- With `ZIG=/opt/homebrew/opt/zig@0.15/bin/zig`, `rustup run 1.96.1 cargo test --offline --locked --release --bin herdr -- ui::sidebar app::input::sidebar app::input::mouse app::actions::tests app::tests::reload_config app::tests::handoff_inline_tree_discards_saved_folds --test-threads=1` in the isolated source — **passed**, 316 tests; log `tests.log` in the build directory.
- Current installer filters with `cargo test --offline --locked --release --bin herdr -- <filters> --test-threads=1` — **passed**, 252 overlapping tests; exact command/log saved in the build directory. Installer itself was not run; no network/toolchain installation.
- `rustup run 1.96.1 cargo build --offline --locked --release`, signing and strict signature verification — **passed**. Candidate SHA-256: `2e13e44dd19d26a1d4ccfce8f0b1691435047e459ebb49aa60986e56ed609806`.
- Fresh forward/reverse patch preflight and source byte comparisons — **passed**; all 24 reconstructed files match tested source.
- `rehearse.py` in the private deployment directory — **passed**, fixture `/tmp/hsa.m0e3_mhr`; exact old/new executables, rollback and handoff preserve fixture shell PID/foreground group and I/O.
- Pure canonical theme generation + TOML equality with deployed config + candidate `config check` — **passed**. Only comments change; current Latte / 1.0 theme and effective configuration remain identical.
- `sh -n bin/.local/bin/install-herdr-focus`, source/repository `git diff --check` — **passed**.
- Guarded live activation — **passed**. Installed SHA-256 matches the freshly built candidate; PID 43893 owns the socket and maps the installed executable. 37/37 panes and 10/10 Spaces retained process identities/focus; environment filter and display metadata verified. Private binary/config backups retained; no production pane stop or input.
- Final `herdr status --json`, `herdr config check`, strict signature verification, installed binary/config equality and original shell PID liveness checks — **passed**. Socket owner is PID 43893, protocol 20; deployed config enables inline mode.
- Human visual check after reconnection — **not run**; user instructed to reconnect with `herdr` if detached. Native render/input/restore tests passed in this session.

## Risks and recovery

- More rows will require scrolling in busy environments; this is the requested default, and manual collapse remains available.
- Handoff disconnects terminal clients; reconnect with `herdr`. Never fall back to stopping production pane processes.
- Private artifact backups and process/display evidence stay outside the repository; no mutable session files are edited.

## Outcome

Implemented, tested and activated. Repositories and all visible Spaces/conversations now start expanded; inactive/new Spaces no longer default closed. Explicit folding remains available until the next tree/server lifetime, with ordinary reloads preserving it. The live follow-up retained all 37 panes across 10 Spaces and their process identities/focus. Backups and operational evidence remain in the private deployment directory. Unrelated source changes were preserved; no package source paths were added/removed, so no Stow operation was needed.
