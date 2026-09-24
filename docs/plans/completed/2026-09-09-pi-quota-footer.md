# Always-visible Pi subscription quotas

**Status:** Complete
**Scope:** Pi quota-footer extension, focused tests, docs and deployment of only its new files.

## Objective

Keep Codex and Claude weekly and five-hour usage visible in Pi's native terminal footer. Omit Spark. No desktop application.

## Non-goals

- No custom tools, model requests, context changes, browser/Keychain scraping, other-harness credential copies or session-log scanning.
- No replacement of Pi's normal footer/token counters, new daemon, or quota estimates derived from tokens.

## Context and constraints

- User explicitly selected an always-visible Pi footer after the desktop-app setup was removed.
- Canonical owner: `pi/.pi/agent/extensions/quota-footer/`; policy in the parent README.
- Installed Pi exposes `ui.setStatus` and `modelRegistry.getProviderAuth`, not a quota-fetch API. Provider endpoints and response windows were verified during prior source investigation; live access must be rechecked.
- Numerous unrelated Herdr/Pi/docs changes exist. Preserve them and do not deploy pending unrelated package files.
- Background polling starts only in TUI `session_start`, not import/factory, RPC, print or JSON. Stop on shutdown/reload.

## Acceptance criteria

- [x] Native footer shows both providers automatically, independently of the selected model, with used percentages and unavailable/error states.
- [x] Only account-wide weekly/5h windows are accepted; Spark and other model-specific quota groups never enter state or output.
- [x] Existing Pi authentication owns token resolution/refresh; extension only makes bounded quota GETs to fixed provider endpoints, without credential persistence or error-body logging.
- [x] Focused parser, transport, lifecycle and native footer tests pass; live provider access and isolated TUI journey checked.
- [x] Docs updated and only the new extension files deployed; current session needs user `/reload`.

## Approach

1. Read installed Pi extension/TUI docs and native auth/footer consumers.
2. Implement small typed quota adapters, background polling and one native status entry; add `/usage` for refresh/reset details.
3. Exercise synthetic and live paths; preview Pi Stow and isolate new-file deployment from unrelated pending work.

## Progress

- [x] Read source ownership/policy, installed extension/TUI docs and relevant examples; inspected existing status extensions and tests.
- [x] Implemented quota adapters, single-flight/background monitor and native status entry; added `/usage` for reset details.
- [x] Added parser/auth/HTTP/deadline/backoff/lifecycle/native-footer tests and an isolated fullscreen Pi own-PTY journey.
- [x] Verified live access through Pi's existing logins: Codex weekly 31%, no five-hour window; Claude weekly 14%, five-hour 0% at check time. No CLI-login repair or credential copying required.
- [x] Updated owning docs and deployed only the seven new quota-footer leaves. A post-deploy Pi dry run has no pending link actions.

## Decisions

- **Native footer:** `setStatus` preserves existing footer and other extensions; compact usage text sorts first in its status row.
- **Small runtime:** Five-minute per-session polling with single-flight requests, fixed deadlines and rate-limit backoff. Numeric snapshots stay memory-only; no new credential/cache store.
- **Failure semantics:** Missing windows are unavailable, never zero; failed refreshes show a bounded status rather than unlabelled old/account-ambiguous data.

## Verification

- `bun test ./pi/.pi/agent/extensions/quota-footer/*.test.ts` — passed: 46 tests, 133 assertions. The initial run exposed a Bun table-test empty-array/done-callback ambiguity; wrapping table cases fixed that fixture, and the final suite passes.
- Strict `tsc -p <temporary-tsconfig>` with `noEmit`, `strict`, installed Pi type mapping and the three runtime source files — passed; temporary config kept outside the repository and removed afterward.
- `PYTHONDONTWRITEBYTECODE=1 python3 pi/.pi/agent/extensions/quota-footer/pty-smoke.py` — passed twice: real isolated fullscreen Pi, 80/100-column status display, editable draft, `/usage`, `/reload`, no model requests or session persistence.
- Live `createQuotaReader(new ModelRegistry(await ModelRuntime.create(...)))` in a bounded Bun probe — passed for both providers, with numeric windows only printed; no agent session or model call. Catalog network refresh disabled and temporary catalog store removed.
- `stow -n -v -t "$HOME" pi` — passed: preview showed only the new quota-footer directory/seven links. `stow -v -t "$HOME" pi` applied that plan; Python assertions verified every leaf resolves to its canonical source; repeated dry run showed no actions.
- `git diff --check` — passed. CodexBar app and CLI remain absent. No unrelated files deployed or existing conversations reloaded.
- Current-session visual activation — not run: user must invoke `/reload` in this idle conversation; the equivalent isolated TUI reload path passed.

## Risks and recovery

- Provider quota APIs are not stable public SDKs. Parse defensively, hide unknown/model-specific fields and show failures without throwing into Pi.
- Auth resolution is owned by Pi; its extension facade has no cancellation parameter. Bound waiting and do not publish or start an HTTP request after cancellation.
- Disable by removing only this extension's deployed links and running `/reload` in an idle session. Do not alter other extensions or native provider credentials.

## Outcome

Implemented and deployed [quota-footer](../../../pi/.pi/agent/extensions/quota-footer/README.md). Both native account endpoints work with Pi's own authentication. Spark is omitted and all state is memory-only. Run `/reload` in existing idle Pi conversations; new interactive sessions load automatically. No desktop app, daemon, new dependency, commit, push, or input to another agent pane.
