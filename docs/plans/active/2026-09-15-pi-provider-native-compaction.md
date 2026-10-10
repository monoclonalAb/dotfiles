# Provider-native context compaction for Pi

**Status:** Planned — research complete; implementation and live trials not authorized
**Scope:** Pi provider adapters, session/context lifecycle, and later dotfiles setup/controls. Direct OpenAI and Anthropic APIs first; Codex subscription support separately gated.

## Objective

Opted-in Pi conversations use the selected provider's native compaction, retain
its returned state across turns and restarts, and continue using tools correctly.
Users can distinguish native compaction from Pi's existing model-generated text
summary. Unsupported routes keep existing behavior, without switching billing
products or silently losing history.

## Non-goals

- No installation, credential changes, paid requests, deployment, or reload in
  this planning task. No existing session/credential-store inventory.
- No web-app transcript endpoint, memory database, automatic cross-provider
  summarizer, replacement agent, or increase to model context limits.
- No claim that native compaction is lossless, cheaper, or higher quality before
  measurement. It still consumes inference/quota and can lose task details.
- No extension of the OMP/Claude Code identity emulation to obtain beta access.

## Context and constraints

### Verified baseline (2026-09-15)

- Installed `@earendil-works/pi-coding-agent` is **0.85.1**, under
  `/Users/eric/.nvm/versions/node/v24.19.0/lib/node_modules/`.
- Pi's manual/threshold/overflow compaction generates readable summaries.
  `CompactionEntry.details` can persist arbitrary JSON, but context rebuilding
  does not send those details to the provider. `after_provider_response` exposes
  status/headers, not the raw response body.
- The installed OpenAI stream parser drops `compaction` output items. It already
  preserves encrypted **reasoning** signatures; that is not compaction support.
- The installed Anthropic stream parser drops `compaction` blocks and ignores
  their `usage.iterations` accounting. A request-only flag is therefore unsafe.
- **Documentation skew:** installed `docs/session-format.md` describes
  `retainedTail`, but the installed JS implementation does not consume it.
  Base implementation on a pinned source revision and executable tests, not this
  field's appearance in the documentation.
- The [Pi wrapper](../../../bin/pi) selects the next executable on
  `PATH`; it does not own an audited patched Pi installation today.
- The [extension policy](../../../pi/extensions/README.md) requires
  explicit review for context/provider changes. New native behavior must default
  off; this plan is not approval to enable a global hook.
- The [OMP Anthropic route](../../../pi/extensions/omp-anthropic-route/README.md)
  keeps Pi's stream parser. Its `transport.ts` overwrites `context_management`
  with `clear_thinking_20251015` / `keep: "all"`, or deletes it. This is not
  compaction and would clobber an independently added native-compaction flag.
- Existing [quota routing](../../../pi/extensions/quota-router/README.md)
  can change the active account for every Pi session. Native state cannot be
  assumed portable between accounts just because the provider name is unchanged.
- The worktree has substantial unrelated modifications/untracked work. This
  planning task owns only this file and its entry in the active plan index.

### Provider contracts and rollout order

| Route | Mechanism | Initial disposition |
| --- | --- | --- |
| OpenAI API, Responses | Explicit `POST /v1/responses/compact`; later inline `context_management: [{ type: "compaction", compact_threshold: N }]` | First reference implementation using API-key billing |
| Anthropic API, Messages | `anthropic-beta: compact-2026-01-12` and `context_management.edits` with `compact_20260112` | Second public-API implementation, supported-model allowlist |
| `openai-codex`, ChatGPT OAuth | Official Codex's versioned Responses compaction protocol | Separate experimental adapter and explicitly approved subscription trial |
| Anthropic subscription / OMP route | Public API beta documentation does not establish support for this route | Keep Pi compaction; no beta/identity guesswork |
| Proxies, Azure, Bedrock, Vertex, other providers | Transport/model support varies | Out of initial scope; Pi compaction unless separately validated |

OpenAI's standalone endpoint returns a **complete replacement input window**,
possibly including retained messages as well as the encrypted item. Keep the
entire returned window, in order, as the next input; do not retain only the blob
or append Pi's `keepRecentTokens` tail again. The window submitted for compaction
must still fit the model limit. Compaction-call instructions do not replace the
need to send the current system instructions/tools on continuation.

For OpenAI inline compaction, preserve the output item in sequence. The guide
allows dropping items before the latest inline checkpoint for stateless chaining;
this is different from pruning the standalone endpoint's canonical output.
Use stateless replay with `store: false` initially, not `previous_response_id`.

Anthropic returns a typed assistant `compaction` block containing readable text.
Replay it as that block, not as an ordinary user summary. The API ignores content
before the latest block. Streaming includes `compaction_delta`; optional
`pause_after_compaction` introduces a `compaction` stop reason. Default trigger
is 150,000 input tokens, minimum 50,000 in the inspected docs. A null block is a
known failure case, not a valid checkpoint. Multiple compactions can occur within
one request with server tools.

Official Codex source at commit
[`12b0164a484f127abc40285a926bfca7cc72c693`](https://github.com/openai/codex/tree/12b0164a484f127abc40285a926bfca7cc72c693)
appends a request-only `compaction_trigger`, streams through its existing client,
requires a completed response and exactly one `Compaction` item, then builds and
persists replacement history. It is not simply the public compact endpoint with
a different token. Source availability is not proof of Pi-account acceptance.

## Acceptance criteria

- [ ] Opt-out preserves existing requests, summaries, auth, and tool behavior.
- [ ] An enabled/supported route demonstrably calls its native mechanism and
  replays its returned state on subsequent requests, including after restart.
- [ ] Two consecutive compactions, tool turns, images, and deferred tool loading
  preserve valid order and call/result pairing without duplication.
- [ ] Abort, invalid/null output, unsupported capability, or request failure cannot
  install a partial checkpoint or erase the previous working context.
- [ ] Branch, fork, clone, reload, model/provider/account switch, and old-session
  loading have tested compatibility/recovery semantics.
- [ ] Usage includes compaction charges exactly once; effective context occupancy
  is tracked separately and does not cause an immediate re-compaction loop.
- [ ] Native state remains private in Pi-owned session storage outside Git;
  human-readable exports/logs do not expose opaque payloads by default.
- [ ] Setup identifies supported routes, costs, opt-in, status, and rollback.
  Real-provider acceptance is labeled separately from synthetic transport tests.

## Approach

### 1. Pin the implementation and prove the protocol seams

Work in a separate Pi source checkout outside dotfiles. Resolve a source commit
matching the selected release, read its AGENTS/contribution/build guides, and
check whether upstream has added native support since this baseline. Prefer an
upstream implementation when its behavior passes the tests below.

Prototype serialization/parser/session round trips with synthetic data before
provider calls. Keep the first milestone to OpenAI's explicit compact endpoint.
A `session_before_compact` + `details` + payload-hook experiment is technically
possible, but only useful as a bounded feasibility spike: it must reconstruct
checkpoint state itself and cannot use Pi's existing response parser for inline
compaction. Do not ship a collection of hooks pretending this is only a setting.

**Recommended ownership:** first-class adapter/checkpoint support in Pi, ideally
upstreamed; a small reproducible pinned patch while waiting if approved. A local
extension should only provide opt-in/status UI if core controls are insufficient.
Never hand-edit globally installed `node_modules` as the setup procedure.

Likely owners in the pinned Pi source (verify before editing):

| Concern | Source area |
| --- | --- |
| Capabilities, typed native state, usage/effective-context separation | `packages/ai/src/types.ts` and provider/API interfaces |
| OpenAI and Codex serialization/stream parsing | `packages/ai/src/api/openai-responses*.ts`, `openai-codex-responses.ts` |
| Anthropic block/stop/usage handling | `packages/ai/src/api/anthropic-messages.ts` |
| Checkpoint selection, persistence, replay | `packages/coding-agent/src/core/session-manager.ts`, `messages.ts` |
| Manual/threshold/overflow dispatch and cancellation | `packages/coding-agent/src/core/agent-session.ts`, `compaction/` |
| Safe iteration boundaries / compaction-only continuation, if needed | `packages/agent/src/` |
| Controls, notices, RPC/export compatibility | coding-agent settings, interactive/RPC modes, export code and docs |

### 2. Implement one durable checkpoint contract

Add a versioned native checkpoint representation distinct from a readable Pi
summary. Its exact TypeScript/JSON shape is a design deliverable, **not an existing
Pi API**. It needs:

- Provider, API/endpoint identity, protocol version, model compatibility key, and
  non-secret resolved-account/project scope. Never use/store bearer tokens as IDs.
- Active-branch boundary, covered entry IDs, checkpoint identity, and response
  item/block ordering sufficient to append only new conversation content.
- Provider-native payload, including the entire standalone OpenAI replacement
  window; retain required IDs and encrypted bytes unchanged. Do not disguise
  these as text, tools, or thinking signatures.
- Usage for the compaction work, separate effective-context measurements, and
  display metadata that does not masquerade as a semantic text summary.

Persist with the native session owner; no parallel transcript database/sidecar.
Validate complete output and commit the checkpoint before replacing active
context. Retain original history. Interrupted persistence must leave either the
old valid context or the fully valid new checkpoint, never a half-pruned window.
Deduplicate streamed/completed events and reject late results after abort or a
session/branch change.

Select checkpoints from the **active branch**, not the most recent global entry.
Fork/clone must remap ownership/boundaries appropriately. A checkpoint shared with
a valid ancestor can be reused only where protocol compatibility permits it.

Treat provider, endpoint, model, and account changes conservatively: validate at
the final resolved-auth request boundary, not only a model-selection event.
For incompatible state, reconstruct portable context from the active branch's
original messages/prior portable summaries and compact conventionally if needed.
Never decode or send another provider's opaque state. If safe reconstruction is
not possible within the budget, stop with an actionable recovery choice.

Loading a native session in an older build is a migration boundary: provide a
version gate and an explicit portable conversion/recovery path before rollout.
Disabling *new* native compactions must not simply discard a checkpoint already
needed by the current conversation. Resume its compatible state or convert first.

### 3. Ship public API vertical slices

**OpenAI explicit first:** dispatch native compaction at a safe conversation
boundary, serialize actual provider input (not Pi's transcript-to-text summary
prompt), call the compact endpoint with its supported parameters, validate and
persist the returned window, then continue with ordinary Responses. Use the same
resolved provider auth/endpoint plumbing; do not assume all create-request options
are accepted by the compact endpoint. Reuse serializers for tools, images,
reasoning signatures, namespaces and deferred tool definitions.

**Anthropic next:** add beta/capability gating, compaction block and delta parsing,
serialization, stop-reason handling, and full usage aggregation. Use ordinary
Messages requests with automatic compaction initially. If implementing a manual
native compact action, use the documented pause flow only when the trigger is
reachable; below its minimum threshold report that native compaction did not run,
or offer Pi compaction. Do not fake a force-compaction endpoint or user turn.

Handle null/empty/unfinished blocks without pruning. Aggregate `usage.iterations`
for billed work when present, rather than summing iterations *plus* top-level
usage; use final effective context separately. Preserve cache accounting and
avoid rerunning completed tools after a compaction-only stop.

**OpenAI inline later:** after durable stream checkpoints are proven, support
`context_management` on normal Responses. Do not enable explicit and inline
triggers as competing owners for the same request.

### 4. Integrate one compaction policy and transparent controls

Proposed controls (to implement; **not commands/settings available today**):

- Strategy: `pi` (default), `provider-preferred`, `provider-required`.
- Explicit route/model/auth-kind allowlist; native status reports unsupported
  reasons without making capability-probe calls at startup.
- A status view showing selected strategy, actual last mechanism, threshold,
  checkpoint compatibility, and fallback/error reason. Native display labels are
  not injected conversation instructions.
- Existing `/compact` dispatches through the selected strategy when supported;
  explicit Pi compaction remains available for custom summaries/recovery.

Use a single dispatcher for manual, threshold, overflow, and between-tool-turn
checks. Native thresholds must leave room for output, tool-result bursts, images,
MCP schemas and estimation error. Derive them from current model metadata and
provider limits; do not hard-code one threshold for every model or `/long-context`
setting. Start conservatively (roughly 70–80% only where the resulting budget is
valid) and tune from measurements.

Do not turn off Pi auto-compaction globally to make inline compaction win. Instead,
the dispatcher delegates on eligible routes and preserves conventional safety on
others. If the input already exceeds a native endpoint's accepted size, use bounded
portable recovery or stop; never send an endless sequence of failing compact calls.

`provider-preferred` may visibly fall back to Pi compaction for an unsupported
mechanism/validated recoverable failure using safe context. `provider-required`
fails closed. Neither mode treats auth/429 errors as permission to change provider,
credentials, or billing product. Bound retries; honor abort without fallback work.

Keep branch summarization portable initially, and exclude naming/BTW/read-only
worker side requests from inheriting native mode automatically. Exercise `/fast`,
`/long-context`, account routing, goal/review hooks, compact UI, and observer/usage
consumers together before any global activation.

### 5. Validate Codex subscription support separately

Port the pinned official protocol's request controls, accepted outputs, retained
history rules, and abort/completion checks into the Codex adapter. Do not infer
its endpoint/headers from public API examples or persist `compaction_trigger` as
conversation history. Verify both SSE and WebSocket/cached-WebSocket flows; start
with SSE if necessary and reject unsupported transports explicitly. Invalidate
incremental transport caches when a checkpoint replaces the prefix.

Use an explicitly approved disposable ChatGPT OAuth session to test compaction,
continuation, restart, second compaction, and supported account/model boundaries.
Keep experimental support off if the backend rejects the protocol. Claude
subscription sessions remain on Pi compaction unless a separately verified,
permitted integration becomes available. Do not make the OMP route appear to
support the public beta by appending a header it will overwrite or cannot parse.

### 6. Set up this Mac only after acceptance

1. Choose **API-first** (recommended supported integration path) or
   **subscription-first** (Codex spike first, Claude unchanged). API keys incur
   separate API billing; ChatGPT/Claude subscriptions are not API credits.
2. Approve an external Pi checkout/build location and pinned revision. Build and
   test there; retain a reviewed patch/build recipe in the existing `pi/` and
   `bin/` packages only if an upstream release is insufficient. Keep generated
   artifacts/dependencies outside dotfiles. Establish minimal PATH for launchers.
3. Run the candidate explicitly with isolated HOME/config/session storage,
   `PI_OFFLINE=1`, `PI_TELEMETRY=0`, no auto-discovered extensions, and synthetic
   auth/providers. Offline flags suppress startup traffic, not authorized model
   calls or arbitrary extension traffic. Do not share production session files
   between old/new processes.
4. For approved real trials, authenticate through Pi's supported login/key
   resolver into that private profile. No keys in argv, tracked settings, or logs.
   Select a documented eligible model; enable native mode for this profile only.
5. Complete the live continuation/restart tests and compare latency, cost, active
   context size, and task-detail retention to ordinary Pi compaction. Only then
   consider preferred mode for everyday sessions, still gated by route.
6. Update the owning Pi section in `docs/AGENT-TOOLS.md`, architecture,
   verification runbook, and extension policy if adding controls. Preview with the read-only
   `bin/dotfiles-link check`; review unrelated pending actions. Deployment
   requires separate approval. A changed Pi binary needs a fresh session/process;
   `/reload` alone does not load new core code. Leave existing agent panes alone.

No native-compaction JSON should be added to today's Pi settings. Until the
implementation ships, existing `compaction.enabled`, `reserveTokens`, and
`keepRecentTokens` only configure Pi's summarization, not these provider APIs.

## Progress

- [x] Inspect repo ownership, installed Pi docs/source, relevant extension consumers
  and native fixture patterns without reading real session/credential stores.
- [x] Revalidate public API docs and pin official Codex protocol evidence.
- [x] Exercise installed parser/session baseline with isolated synthetic data.
- [x] Record implementation order, acceptance tests, rollout and recovery gates.
- [ ] User chooses API-first vs subscription-first and approves implementation scope.
- [ ] Implement/checkpoint-test the pinned Pi candidate.
- [ ] Complete separately approved provider trials, documentation and deployment.

## Decisions

- **Core integration over request-only hooks:** opaque state, effective context,
  stop reasons, branching and accounting need an end-to-end contract. Extensions
  can prototype or control it, but adding a payload flag is insufficient.
- **Stateless replay first:** fits Pi's local history, avoids requiring remote
  response retention, and makes restart/branch tests explicit.
- **No default dual summary:** native checkpoints plus preserved raw history avoid
  paying for both native compaction and a Pi summary every time. Generate a portable
  summary explicitly when switching incompatible routes or preparing rollback.
- **No implicit API spend:** lack of native support on a subscription never causes
  migration to a paid API route without a user choice.

## Verification

### Actually run during planning

- `pwd`, `git status --short`, `date '+%Y-%m-%d'` — **passed**: repository identified;
  observed date 2026-09-15; unrelated dirty state preserved.
- Package metadata plus installed source inspection — **passed**: Pi 0.85.1;
  parser, session reconstruction and OMP route limitations confirmed.
- Public documentation/source GETs — **passed** for the Markdown provider guides,
  OpenAI compact reference, and pinned Codex files linked below. Initial HTML/API
  requests encountered HTTP 403 and old Codex `compact_remote.rs`/endpoint paths
  returned 404; Markdown URLs and pinned `compact_remote_v2*` sources succeeded.
- `env -i HOME=/tmp/pi-native-compaction-plan.asSH6T/home PATH=/usr/bin:/bin PI_OFFLINE=1 PI_TELEMETRY=0 /Users/eric/.nvm/versions/node/v24.19.0/bin/node /tmp/pi-native-compaction-plan.asSH6T/baseline.mjs`
  — **passed**, four baseline assertions: details not replayed; documented
  retainedTail not consumed; OpenAI native item dropped; Anthropic native block
  and compaction-iteration usage dropped. Pure/fake-fetch fixtures only; these
  passes establish missing support, not a working native implementation. Temporary
  research artifacts are outside Git and may not survive this session.
- `git diff --check`, ad-hoc Python link/index/whitespace validation, and
  `stow -n -v -t "$HOME" docs` — **passed**: five local plan links resolve, the
  active index includes the plan once, no trailing whitespace, and the docs
  preview proposes no deployment actions. Final diff/status review preserves the
  pre-existing task-launcher plan removal and unrelated work.
- Production tests, provider calls, installs, Stow application and reloads —
  **not run**; planning only.

### Required implementation evidence (not run)

1. Adapter fixtures: exact request schemas; preserved native items/order; ordinary
   text/thinking/tool/image output; unsupported-model/auth/URL rejection; partial,
   duplicate, null and malformed output; compaction-only stops; usage iteration
   accounting; no sensitive payloads in diagnostics.
2. Native session fixtures: first/second compaction, ordinary tool continuation,
   restart/reload, fork/clone/tree on both sides of the checkpoint, old sessions,
   portable conversion, model/account/provider changes and corrupted state.
3. Lifecycle fixtures: abort at each persistence/network stage; safe fallback;
   401/429/5xx; overfull input; simultaneous compaction prevention; tool execution
   exactly once; steering/follow-up/goal behavior; SSE and WebSocket cache resets.
4. Real Pi integration in isolated profiles, then relevant existing repo suites
   from [VERIFICATION.md](../../VERIFICATION.md): Codex fast, account routing,
   long-context, workers, agent-stuff, observer, compact UI and quota usage.
   Use synthetic providers; extend test cases rather than treating old passes as
   evidence for new checkpoint behavior.
5. Separately authorized real-provider trials: verify endpoint/compaction event,
   continuation using planted non-sensitive task facts and a tool call, second
   compaction, restart, measured effective tokens/cost/latency. Never log encrypted
   payloads or use real project transcripts merely to make a large test prompt.

## Risks and recovery

- **Silent data loss:** preserve original history; validate output and boundaries;
  do not prune before commit. Failure reports must name the actual mechanism.
- **Protocol/model/account incompatibility:** explicit capability matrix, pinned
  Codex contract, resolved-auth checks and portable recovery, not blind replay.
- **Old runtime ignores new state:** gate migration and test a portable converted
  copy before rollback. Keep the candidate and original session intact until
  recovery is verified; changing PATH back is not enough for a native-only session.
- **Token accounting loops/underbilling:** billed usage and effective context are
  different quantities, especially Anthropic iterations and opaque OpenAI items.
  Never estimate native token size from encrypted string length.
- **Private data in exports:** treat opaque payloads as sensitive session content,
  not harmless because encrypted. Redact human exports/share/observer views;
  explicit private machine-readable exports must declare state requirements.
- **Maintenance/deployment drift:** pin artifacts and provide build-only checks;
  do not introduce a second untracked patched-global installation.

## Sources

- [OpenAI compaction guide](https://developers.openai.com/api/docs/guides/compaction.md)
- [OpenAI compact endpoint](https://developers.openai.com/api/reference/resources/responses/methods/compact.md)
- [Anthropic compaction guide](https://platform.claude.com/docs/en/build-with-claude/compaction.md)
- [Pinned Codex request construction](https://github.com/openai/codex/blob/12b0164a484f127abc40285a926bfca7cc72c693/codex-rs/core/src/compact_remote_v2_attempt.rs)
- [Pinned Codex response/retained-history handling](https://github.com/openai/codex/blob/12b0164a484f127abc40285a926bfca7cc72c693/codex-rs/core/src/compact_remote_v2.rs)
- [Pinned Codex response types](https://github.com/openai/codex/blob/12b0164a484f127abc40285a926bfca7cc72c693/codex-rs/protocol/src/models.rs)
- Installed Pi `README.md`, `docs/{compaction,extensions,custom-provider,session-format,settings,development}.md`,
  `examples/extensions/custom-compaction.ts`, and corresponding installed JS/types
  were inspected. The executable baseline takes precedence over documentation skew.

## Outcome

Planning deliverable is ready for a scope decision. No native compaction has been
implemented or enabled. Recommended next step: approve the shared checkpoint
contract plus an isolated OpenAI API vertical slice, or choose the Codex-first
subscription spike if separate API billing is unwanted.
