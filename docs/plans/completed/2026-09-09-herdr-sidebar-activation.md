# Activate the unified sidebar without terminating pane processes

**Status:** Complete
**Scope:** User-authorized local binary installation, generated Herdr config and live server handoff. No unrelated deployment or agent-pane input.

## Objective

Activate the previously built repository / Space / conversation tree, remove the Agents panel and New button, and put Personal/Work and Menu at the sidebar bottom while preserving live pane processes.

## Context and constraints

- User explicitly requested safe installation and server restart in this session.
- Canonical owner: `herdr/.config/herdr/patches/herdr-0.8.2-focused-pane.patch`, pinned by `bin/.local/bin/install-herdr-focus`; candidate `/tmp/herdr-unified-sidebar.tkibGO/herdr-unified-sidebar` must be revalidated against current source.
- Observed server: v0.8.2 / protocol 20, live-handoff capability true, 37 panes / 10 Spaces (below native 64-descriptor limit). Do not rely on version equality alone to establish activation.
- Native `server.live_handoff` passes PTY descriptors to the replacement, with rollback before commit. It disconnects clients; the user may need to run `herdr` again. It does not preserve in-flight API calls or all transient display metadata.
- Preserve all pre-existing and concurrent source changes. Generated output, private backups and operational evidence stay outside the repository.

## Non-goals

- No stop/start that terminates panes; no fallback to `server stop`, process-group kills or Pi/OMP reloads.
- No application-wide `theme apply` fan-out, wildcard Stow, package fetch, model request or agent conversation input.
- No session-history/credential-store inspection. Process preservation evidence comes from live IDs/PIDs, not transcript contents.

## Acceptance criteria

- [x] Candidate provenance/signature and staged config validated; only intended effective config changes selected for deployment.
- [x] Isolated handoff rehearsal preserves fixture process identity and I/O.
- [x] Old installed binary/config backed up privately; atomic replacement performed.
- [x] New server owns the existing socket and runs the verified installed executable.
- [x] All original panes/Spaces and shell PIDs/foreground groups survive; attention/environment plugins and existing task summaries recover without overwriting newer metadata.
- [x] Generated config enables the tree; remaining client reconnection/visual-check boundary reported.

## Approach

1. Inspect native handoff implementation, rollback and tests; record capability/limits.
2. Revalidate source and rehearse installed-old → candidate-new handoff with isolated shell fixtures, not active agents.
3. Snapshot minimal live topology/process/display metadata; stage current-theme config and review its semantic delta.
4. Back up and atomically install candidate/config; request explicit handoff to the installed executable with expected version/protocol guards.
5. Verify socket owner, binary identity, pane processes and display metadata. On failure, inspect ownership before restoring files; never kill live pane processes as recovery.

## Progress

- [x] Read native handoff/CLI/import implementation and process-I/O/rollback test paths; confirmed old server advertises handoff.
- [x] Rehearsed the exact installed-old → candidate-new handoff and a rejected-protocol rollback against an isolated shell fixture. PID/foreground group, no-HUP and I/O checks passed.
- [x] Revalidated 313 native tests and current patch/source correspondence. Candidate/build executable bytes match; differing code-signature bytes are independently verified.
- [x] Staged current-theme config (Latte / 1.0); semantic changes are only `ui.sidebar.spaces.inline_agents` and `ui.sidebar.spaces.rows`.
- [x] Installed and handed off using the guarded `activate.py` in `~/.local/state/herdr/deployments/2026-09-09-sidebar.cDkkUR/`. Old server PID 53139 was replaced by PID 28609. **Do not repeat the activation script**: inspect `activation.log` and `result.json` for the successful operation.
- [x] Verified 37/37 panes and 10/10 Spaces, stable shell PIDs/foreground groups/session fingerprints/focus, matching environment filtering and 23 attention-token-bearing panes. Restored 20 captured Pi task summaries; no lifecycle-state replay or conversation input.
- [x] Final health check passed: new server PID 28609 owns the socket, original server exited, installed signature/config/hash are valid, all original shell PIDs remain alive and all 20 captured Pi summary labels are present.
- [x] Root README and verification runbook now distinguish the default natural restart from an explicitly approved live handoff. No reusable auto-restart command or routine-verification permission was added.

## Verification

- `herdr status --json`, read-only pane list/process-info and socket-owner lookup — **passed**; live server compatible and within handoff limit.
- `PYTHONDONTWRITEBYTECODE=1 python3 <private deployment dir>/rehearse.py` — **passed**; fixture `/tmp/hsa.47jcbi0c`, old installed executable → candidate, same shell PID/foreground group, no HUP, post-rollback and post-handoff I/O. Only the private fixture socket received input/stop commands.
- `ZIG=/opt/homebrew/opt/zig@0.15/bin/zig rustup run 1.96.1 cargo test --offline --locked --release --bin herdr -- ui::sidebar app::input::sidebar app::input::mouse app::actions::tests app::tests::reload_config --test-threads=1` in the isolated source — **passed**, 313 tests in this activation session.
- Patch reverse preflight and exact candidate/patch comparison — **passed**. Initial full signed-file equality assertion failed because 31 bytes differed inside the code-signature blob even after re-signing; Mach-O executable bytes and load commands outside that blob match exactly, and strict signature verification passes. This was a signing-comparison limitation, not a code/test failure; proof recorded privately.
- Staged config generated with the canonical pure `herdr_theme` function and current theme state, semantic-diff allowlist, and candidate `config check` — **passed**; no application-wide theme reload performed.
- `PYTHONDONTWRITEBYTECODE=1 python3 <private deployment dir>/activate.py` — **passed**. Atomically installed signed candidate and generated config, then sent `server.live_handoff` with installed import path and expected v0.8.2 / protocol 20. New socket owner runs `~/.local/bin/herdr`; installed SHA-256 is `e7eafb4e49eedb9f48bc98c70daaf46df6329c6fb73adf3bd71641df378f5f98`. All process/topology/focus checks passed, filter restored, 23 attention-token-bearing panes and 20 restored Pi task summaries. Backup binary/config and filtered before/after evidence remain in the private deployment directory.

- Final `herdr status --json`, `herdr config check`, strict `codesign --verify`, socket-owner lookup, installed binary/config hash comparisons and live PID/summary checks — **passed**. Protocol remains 20; config enables `inline_agents`; old PID 53139 has exited.
- Production screenshot / manual post-reconnection interaction — **not run**. User was told to reconnect with `herdr`; no keyboard input was sent to any production pane. Native UI/input tests were run in this session.
- `git diff --check` — **passed**; unrelated worktree changes preserved. No package source paths were added/removed, so no Stow operation was needed.

## Risks and recovery

- Client disconnection is expected; reopening `herdr` reconnects to surviving panes. Do not confuse disconnected UI with killed agents.
- A failed handoff may already have committed: check new socket owner and pane liveness before rollback. Restore only backed-up binary/config files if the old server still owns the socket.
- Runtime-only Pi task-summary tokens are not included in native handoff. If needed, restore only captured summaries for unchanged pane/session identities, and only while the new token is absent. Plugin startup hooks own environment and attention metadata.

## Outcome

Installed and activated the verified unified-sidebar build via live PTY handoff. All 37 panes across 10 Spaces retained process identities and focus; environment/attention metadata recovered and 20 Pi task summaries were restored as display-only metadata. No production pane/server stop, Pi/OMP restart, model request or application-wide theme apply occurred. Private backups are `herdr.previous` and `config.previous.toml` under `~/.local/state/herdr/deployments/2026-09-09-sidebar.cDkkUR/`. Client reconnection and human visual confirmation remain the UI boundary, not an installation blocker.
