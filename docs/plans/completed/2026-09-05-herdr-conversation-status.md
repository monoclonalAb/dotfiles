# Restore reliable Herdr conversation status

**Status:** Complete
**Scope:** Herdr's installed Pi integration and repository setup documentation

## Objective

Use Pi lifecycle reports rather than terminal-screen guesses for Herdr's conversation symbols.

## Non-goals

- Restarting Herdr or interrupting existing conversations.
- Replacing the per-pane next-agent ledger or changing task summaries.

## Context and constraints

- Initially `herdr integration status` reported Pi missing and OMP current (v8).
- The current Pi pane was reported idle while executing this task; next-agent's dot agreed with that incorrect upstream state.
- `herdr agent explain` identified `default_known_agent_idle_fallback`: the screen rule searched for `Working...`, which was absent from this Pi display.
- `README.md` installed only the OMP integration.
- Preserved the pre-existing AeroSpace config change. Herdr-generated extensions stay outside Git; no second lifecycle reporter was created.

## Acceptance criteria

- [x] Audit the bundled Pi integration for compatibility and context neutrality.
- [x] Install it without restarting or sending input to any existing conversation.
- [x] Verify lifecycle reporting and the consuming dot path with isolated checks.
- [x] Document installation, reload, glyph meanings, and diagnosis.

## Approach

1. Inspect the bundled integration in a temporary agent directory.
2. Exercise its lifecycle callbacks, fresh Pi discovery/reload, and next-agent's existing focused tests without touching existing panes.
3. Install the official integration and update owning documentation.

## Progress

- [x] Trace sidebar token ownership and compare live state with next-agent's ledger.
- [x] Identify the missing Pi integration.
- [x] Audit, verify, and deploy the official integration.
- [x] Update setup, existing-machine recovery, troubleshooting, and extension-ownership documentation.

## Decisions

- **Single lifecycle owner:** Use Herdr's bundled integration rather than custom Pi state hooks. The task-summary extension remains presentation-only.
- **Generated deployment:** `herdr integration install pi` creates the untracked home extension. Stow neither installs nor overwrites it; the README includes the explicit existing-machine step.
- **Compatibility:** Bundled v8 uses `ctx.mode`, `agent_start`, `agent_settled`, and `ctx.isIdle()`; it does not prematurely report idle at low-level `agent_end`. It registers no model tools and alters no messages or prompts.

## Verification

- `herdr integration install pi` — installed; `herdr integration status` now reports Pi and OMP current (v8).
- `cmp` of deployed extension against the audited temporary install — identical.
- Temporary Bun callback/socket smoke — passed idle → working → blocked → working → idle; headless sessions ignored; unsettled retries do not produce idle; reload while active reports working; state sequences increase. Blocked exercised the bundled `herdr:blocked` event, not an actual UI prompt.
- Temporary Python PTY smoke using a fresh Pi TUI and mock Herdr socket — passed auto-discovery, startup idle report, and `/reload` idle report, with no model requests. Only the isolated test process received input and was terminated afterward.
- `PYTHONDONTWRITEBYTECODE=1 python3.14 -m unittest discover -s herdr/.config/herdr/plugins/next-agent -v` — all 13 ledger/glyph tests passed.
- `herdr config check` — passed.
- `stow -n -v -t "$HOME" pi` and `stow -n -v -t "$HOME" docs` — no link actions or conflicts.
- Local Markdown links in changed docs resolve; `git diff --check` passed. Final status also showed concurrent AGENTS/catalogue/Astra-plan edits, which were left intact; the plan index retains that other active plan.
- End-to-end rendering in the user's existing Pi conversations remains a manual check after `/reload`; their sessions were deliberately not interrupted. The existing live-event-flow verification gap in `docs/QUALITY.md` remains unchanged.

## Risks and recovery

- Already-running Pi sessions cannot discover a new extension until `/reload` or restart. The user must reload each conversation once idle; no Herdr restart is required.
- `herdr integration uninstall pi` removes only Herdr's generated extension if rollback is necessary.

## Outcome

The missing lifecycle integration is installed and its setup/recovery path is documented. Fresh Pi startup and reload load the audited reporter successfully. Existing conversations require the user to run `/reload` before their symbols can benefit.
