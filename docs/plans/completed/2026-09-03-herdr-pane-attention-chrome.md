# Give split-pane agent attention its own chrome

**Status:** Complete
**Scope:** Herdr pinned-source patch, installer, next-agent metadata contract, and Herdr operator documentation

## Objective

Make an unfocused split pane whose agent needs input or review more visible than an ordinary background pane, with a theme-derived border colour that distinguishes blocked work from completed work.

## Non-goals

- Change agent lifecycle, jump priority, or notification delivery.
- Alter focused panes, single-pane tabs, working agents, or plain shells.
- Add another user-tuned opacity setting.
- Install the binary or restart a running Herdr server before build verification.

## Context and constraints

- `herdr/.config/herdr/plugins/next-agent/next_agent.py` owns the reliable per-pane unread ledger and already reports mutually exclusive `dot_blocked` and `dot_review` metadata tokens.
- `herdr/.config/herdr/patches/herdr-0.8.2-focused-pane.patch` targets pinned upstream commit `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`; preserve its focused-border, opacity, retained-render, and compact-prefix behaviour.
- `bin/.local/bin/theme` owns the Catppuccin palette and already maps blocked/review indicators to red/peach.
- Runtime `~/.config/herdr/config.toml`, plugin ledgers, and the installed server binary are outputs, not source.
- Preserve unrelated README, architecture, spaces-env, plans, and agent-tooling worktree changes.

## Acceptance criteria

- [x] An unfocused blocked agent pane uses the active palette's red border.
- [x] An unfocused completed/unreviewed agent pane uses the active palette's peach border.
- [x] Either attention state fades content at the midpoint between configured unfocused opacity and full opacity.
- [x] A focused pane remains full-opacity with focused accent chrome.
- [x] Full and retained PTY rendering apply identical attention opacity.
- [x] Focused plugin and pinned-source tests pass; config and Stow checks remain clean.

## Approach

1. Resolve existing next-agent attention tokens in the pinned Herdr render path.
2. Apply palette-native border roles and derived midpoint opacity in full and retained rendering.
3. Add focused upstream tests, regenerate the patch, route them through the installer, document the durable behaviour, and run live-safe verification.

## Progress

- [x] Re-read repository ownership, current worktree state, Herdr plugin/config/operator paths, installer, and pinned patch.
- [x] Implemented and regenerated the pinned-source patch without changing its upstream pin.
- [x] Updated installer routing, theme/config comments, architecture, and operator documentation.
- [x] Verified source, generated config, Stow layout, signed installation, and live-safe consumers; the running 0.8.0 server was deliberately not restarted.

## Decisions

- **Reuse existing metadata:** `dot_blocked` and `dot_review` already encode the plugin's per-pane ledger and are reconciled at startup, so a second metadata contract would duplicate state.
- **Derive intermediate opacity:** `(unfocused_pane_opacity + 1.0) / 2.0` remains between the two existing visual levels and follows future opacity changes.
- **Use palette roles:** blocked maps to `palette.red` and review maps to `palette.peach`, matching the generated sidebar indicators for every theme flavour.

## Verification

- `python3.14 -m unittest discover -s herdr/.config/herdr/plugins/next-agent -p 'test_next_agent.py'` — passed: 13 tests. The first path-style unittest invocation failed to import the hyphenated directory; discovery is the valid route.
- Fresh pinned checkout plus `git apply --check herdr-0.8.2-focused-pane.patch` — passed.
- Focused debug tests for attention border/opacity and retained rendering — passed.
- `install-herdr-focus --build-only /tmp/herdr-focus-attention` — passed after serialising the two headless tests: release build plus 26 focused tests, with no installed-binary change.
- `install-herdr-focus` — passed: the same 26 tests ran and the ad-hoc-signed Herdr 0.8.2 binary was atomically installed.
- `theme apply && herdr config check && theme status` — config generation and validation passed; reload was not applied because the running server is still protocol-19 Herdr 0.8.0.
- `stow -n -v -t "$HOME" herdr bin` and `stow -n -v -t "$HOME" docs` — passed with no planned filesystem changes.
- `codesign --verify ~/.local/bin/herdr && ~/.local/bin/herdr --version` — passed; installed client is Herdr 0.8.2.
- `git diff --check && git status --short` — passed; unrelated worktree changes remain present.

## Risks and recovery

- Stale metadata could preserve highlight; next-agent's existing startup reconciliation explicitly corrects all dot tokens.
- Retained row updates could differ from full rendering; a headless test compares both paths.
- Restore the prior patch and rebuild to recover; installation is atomic and never restarts the server.

## Outcome

The audited Herdr 0.8.2 patch now reads next-agent's existing per-pane `dot_blocked` and `dot_review` metadata. Unfocused blocked panes render red borders, review panes render peach borders, and both use opacity halfway between the configured inactive level and full focus; full and retained PTY renders share the calculation. The tested binary is installed, but the current Herdr 0.8.0 server remains active to avoid interrupting open panes, so live visual confirmation waits for its next natural restart.
