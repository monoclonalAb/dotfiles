# Compact repository / Space / conversation sidebar

**Status:** Complete
**Scope:** Herdr pinned patch, base config, installer checks and owning docs. Isolated source/build: `/tmp/herdr-unified-sidebar.tkibGO/`.

## Objective

Replace the two-panel sidebar with one compact tree. Group worktree-backed Spaces under their repository; conversations branch underneath using `├─` / `└─`, not disclosure arrows. Remove New and anchor Personal/Work and Menu to the bottom row.

## Non-goals

- No live server restart, handoff, agent-pane input, or session migration.
- No new summarizer requests, worker spawning, transcripts, cost estimates or budget enforcement. Existing Pi/OMP task labels remain the display source. Worker history/telemetry discussed in the conversation requires a separate harness integration; do not fabricate relationships or costs.
- No changes to unrelated task-launcher, terminal or Pi extension work.

## Context and constraints

- The worktree already contains a first-pass inline Spaces tree, base key and installer changes; preserve and extend these, not replace them with HEAD.
- Canonical patch is pinned by `bin/.local/bin/install-herdr-focus` to `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`.
- Current source baseline copied into the isolated workspace and successfully applied to a fresh local clone of that commit; no network or toolchain installation.
- Herdr stores worktree membership and branch identity. Sidebar filtering and task-label ownership must remain intact.

## Acceptance criteria

- [x] One full-height tree, no separate Agents panel or New button/hit target.
- [x] Repository → worktree/Space → compact conversation rows; branch connectors rather than chevrons.
- [x] Independent group/conversation disclosure, exact pane focus and attention-jump reveal; collapsed rows retain truthful counts.
- [x] Personal/Work on bottom-left and Menu on bottom-right, outside scrolling content and without overlapping the sidebar toggle. Environment label remains informational; existing toggle hotkey is unchanged, and Space rows have no redundant P/W initials.
- [x] Native render/input/scroll/filter/reload tests and pinned patch preflight pass.
- [x] Owning docs match and live activation status is explicit.

## Approach

1. Extend the shared tree document to represent repository headers and one-line Space rows.
2. Share count/disclosure geometry between rendering and mouse input; remove stale New and chevron targets.
3. Verify in an isolated pinned checkout with existing toolchain/dependency cache, then publish the incremental patch changes to the canonical owner.
4. Update docs and report safe activation separately from source/build verification.

## Progress

- [x] Read source, consumers and nearest render/input tests; located footer geometry and existing worktree membership.
- [x] Preserved the concurrent removal of redundant per-Space P/W tokens and its compatibility-reporting comment; the plugin logic is unchanged.
- [x] Implemented explicit repository headers, one-line Space rows, continuous branch connectors, count disclosure and matching navigation/scroll/hit geometry.
- [x] Removed New's rendering and hit target. Moved environment text to the fixed footer, including non-mouse mode; Menu and sidebar-toggle targets do not overlap, even at tiny widths.
- [x] Verified and rebuilt the canonical patch, preserving 14 unrelated patch sections byte-for-byte. All 24 patched source files match a fresh reconstruction of the tested build.
- [x] Built and signed `/tmp/herdr-unified-sidebar.tkibGO/herdr-unified-sidebar`; not installed or activated.

## Decisions

- **Observability vs supervision:** worker records are useful, but are not extra terminal panes or evidence of verified output. This sidebar change does not invent telemetry.
- **No arrows:** repository header clicks toggle the group; Space attention/count labels toggle conversation children; Space names and conversation titles retain focus semantics.
- **State:** reuse stable repository keys and Space ids; no new durable state writer.
- **Environment labels:** one full Personal/Work label is sufficient; omit the per-Space P/W badge tokens from the configured rows. The plugin may keep reporting them temporarily so an already-generated config remains coherent until `theme apply`.

## Verification

- Fresh pinned clone + `git apply --check` / apply of baseline patch — **passed**.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s herdr/.config/herdr/plugins/spaces-env -p 'test_*.py'` — **passed** (36 tests) after removing the configured row badges; plugin logic remains compatible with an older generated config.
- Python `tomllib` parse plus assertion that the first configured Space row is exactly `state_icon, workspace` and contains no `$env_personal` / `$env_work` tokens — **passed**.

Rust commands below ran in `/tmp/herdr-unified-sidebar.tkibGO/source` with `ZIG=/opt/homebrew/opt/zig@0.15/bin/zig` and Rust 1.96.1.

- `rustup run 1.96.1 cargo test --offline --locked --release --bin herdr -- ui::sidebar app::input::sidebar app::input::mouse app::actions::tests app::tests::reload_config --test-threads=1` — **passed**, 313 tests (including nine additional tree/footer tests). Native TestBackend and input/action checks, not a production-screen test. Log: `tests.log` in the isolated workspace.
- Current installer filters extracted and run with `cargo test --offline --locked --release --bin herdr -- <installer filters> --test-threads=1` — **passed**, 249 tests, overlapping the suite above. Exact command and log: `installer-test-command.txt`, `installer-tests.log`. Installer itself **not run**: no fetch, toolchain install or live-binary replacement.
- `rustup run 1.96.1 cargo build --offline --locked --release` — **passed**. Existing local dependency cache/toolchain; artefacts outside the repository.
- Native tree preview test `ui::sidebar::tree::tests::repository_spaces_and_agents_have_continuous_branches_without_duplicates` with `--nocapture --test-threads=1` — **passed**; inspected `render-preview.log`, including branch connectors and bottom Personal/Menu row.
- `git apply --check` and reverse preflight of the final patch in fresh pinned `verify-final/` — **passed**; every patched file byte-compared to build source. Canonical patch equals the verified candidate.
- `HERDR_CONFIG_PATH=<isolated config> <built binary> config check` for all four Catppuccin flavours — **passed** (`config: ok`). Candidates generated from the current base and only the inspected pure `herdr_theme` function; no deployed config writes/reloads.
- `codesign --force --sign - <isolated binary>` and `codesign --verify <isolated binary>` — **passed**.
- `sh -n bin/.local/bin/install-herdr-focus`, source/repository `git diff --check` — **passed**.
- Live installation, generated-config update and server restart — **not run**, preserving active conversations. No package files were added/moved/removed, so no Stow deployment is needed.

## Risks and recovery

- The running server cannot gain rendering code via config reload. Build/install and a safe subsequent server start are separate boundaries.
- Keep legacy mode behind `inline_agents = false`; changing repository base does not regenerate deployed config.
- Original in-progress patch is backed up as `baseline.patch` in the isolated workspace; unrelated work remains untouched.

## Outcome

Source/build implementation complete. The canonical patch, base guidance, installer selection and operator docs reproduce the merged sidebar and fixed footer. Installation and activation at a safe subsequent Herdr server start remain operator steps; follow the root README's Herdr upgrade guidance. Existing task labels are unchanged, and no background-worker history/cost data was fabricated or model request added.
