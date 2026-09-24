# Unified Herdr Spaces and agents tree

**Status:** Complete
**Scope:** Herdr pinned UI patch, build helper, base configuration and owning documentation; isolated build outside the repository.

## Objective

Replace the duplicate Spaces/Agents panels with one Spaces tree: collapsible compact agent children, clickable pane targets, and status counts on each Space. Preserve Personal/Work filtering and attention jumps.

## Non-goals

- No live server restart/handoff or input to running agent panes.
- No lifecycle, task-launcher, Pi extension, or assignment-state changes.

## Context and constraints

- Canonical patch: `herdr/.config/herdr/patches/herdr-0.8.2-focused-pane.patch`, pinned to `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c` by `bin/.local/bin/install-herdr-focus`.
- Worktree contained unrelated task-launcher, Pi editor and documentation work; preserved. Earlier in this conversation only the base agent sort and owning README paragraph were changed and reloaded.
- Native `agent_panel_sort = "spaces"` only reorders a separate panel. The approved tree needed binary changes, including matching hit-testing and scrolling.
- Isolated workspace: `/tmp/herdr-space-tree.Jz7ADH/`; generated config and build products remain outside Git.

## Acceptance criteria

- [x] Expanded sidebar has one full-height Spaces tree; no separate Agents panel. Compact sidebar also omits the duplicate agent list.
- [x] Space disclosure controls show/hide its compact agent rows; collapsed rows retain status counts.
- [x] Agent clicks focus the correct pane; workspace selection, scrolling, filtering and attention jumps remain coherent in native tests.
- [x] Focused tests cover rendering, collapse, filtered membership, hit-testing, scrolling, worktree counts, drag boundaries and config reload.
- [x] Patch applies cleanly to the pin; isolated release build and tests pass.
- [x] Installer and owning docs match; live activation remains a separate safe step.

## Approach

1. Trace existing rendering, geometry, input and workspace grouping.
2. Add opt-in `ui.sidebar.spaces.inline_agents`, default false in the patched binary and enabled in the tracked base.
3. Share one row document between rendering, workspace cards, pane targets, scroll metrics and drop slots. Keep worktree grouping and environment filtering upstream of the document.
4. Verify the pinned source/build outside the repository; update installer and operator guidance.

## Progress

- [x] Implemented tree and runtime disclosure map keyed by stable Space ID. Active Space opens by default; explicit choices persist in memory, and pane jumps reveal their target.
- [x] Kept label-token selection in the existing theme-generated agent config. Inline rows omit repeated Space context; colours derive from the active palette and ledger metadata.
- [x] Expanded the installer's test selection to include all sidebar and sidebar-input tests plus the new config-reload case.
- [x] Updated base config, root README, architecture and verification guidance.
- [x] Built and ad-hoc signed `/tmp/herdr-space-tree.Jz7ADH/herdr-space-tree`; not installed over the live executable.

## Decisions

- **One sidebar:** user explicitly approved nesting under Spaces and removing the duplicate panel, not merely sorting agents.
- **Disclosure:** left chevron controls agent children; the existing right chevron on a worktree parent still controls worktree children. No durable session-format migration.
- **Deployment safety:** no live config regeneration for the new key, binary replacement, restart or handoff. The running old server cannot acquire rendering code through config reload.

## Verification

All Rust commands ran in `/tmp/herdr-space-tree.Jz7ADH/source`, with `ZIG=/opt/homebrew/opt/zig@0.15/bin/zig` and Rust 1.96.1.

- `rustup run 1.96.1 cargo test --offline --locked --release --bin herdr -- ui::sidebar app::input::sidebar app::input::mouse app::actions::tests app::tests::reload_config --test-threads=1` — **passed**, 304 tests, including 16 new tree/input/reload tests. Native TestBackend and fixture input checks, not a production-screen check.
- Current `install-herdr-focus` test filters extracted and run with `cargo test --offline --locked --release --bin herdr -- <installer filters> --test-threads=1` — **passed**, 167 tests. Exact expanded command and output: `installer-tests.log` in the isolated workspace. The installer itself was **not run** (avoided network fetch/toolchain installation and live-binary replacement).
- `rustup run 1.96.1 cargo build --offline --locked --release` — **passed**; existing local toolchain and dependency cache used.
- `git -C /tmp/herdr-upstream-0.8.2 apply --check <canonical patch>` and reverse preflight against a fresh patched checkout — **passed**. Compared every patched file against the build source: all 24 files identical. Normalized blank context lines to match existing patch formatting; source content unchanged.
- `HERDR_CONFIG_PATH=/tmp/herdr-space-tree.Jz7ADH/config.toml /tmp/herdr-space-tree.Jz7ADH/source/target/release/herdr config check` — **passed**, `config: ok`. Candidate generated from the tracked base plus canonical `herdr_theme`; TOML comparison confirms the sole pending effective change is `inline_agents = true`.
- `/usr/bin/codesign --force --sign - /tmp/herdr-space-tree.Jz7ADH/herdr-space-tree` and `codesign --verify` — **passed**; isolated artefact only.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s herdr/.config/herdr/plugins/spaces-env -p 'test_*.py'` — **passed**, 36 tests.
- `sh -n bin/.local/bin/install-herdr-focus` and `git diff --check` — **passed** after patch-format normalization.
- Production visual check / installation / restart — **not run**; do not interrupt active agents. No package paths were added/removed, so no Stow deployment was needed.

## Risks and recovery

- New base key requires the rebuilt binary/server. Follow root README setup: install the new build, wait for a natural server stop, regenerate config via `theme apply` while stopped, then start normally. Do not use a reload alone as activation evidence.
- Set `inline_agents = false` in the base and regenerate with the new server to restore the two-panel layout. No session data or assignment state was migrated.
- Original patch copy remains at `/tmp/herdr-space-tree.Jz7ADH/original.patch` for local review; Git is the durable recovery source.

## Outcome

Implementation/build complete; live activation not performed. Implemented and tested the approved layout; the repository now reproduces the new build. Installation and a safe subsequent server start are the remaining operator steps. Existing running agents and the deployed generated config were left untouched during the tree implementation.
