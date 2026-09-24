# Run Anthropic models successfully in Pi

**Status:** Complete — repaired and verified with approved live synthetic requests
**Scope:** Pi's OMP Anthropic extension, installed Pi runtime, focused tests and operator docs. Existing unrelated changes remain intact.

## Objective

Make sure Anthropic models are able to be run on Pi. Completion requires successful
real-provider runs through the configured Pi path, not just green serialization tests.

## Acceptance criteria

- [x] Anthropic authentication resolves through the intended account source without exposing tokens or silently switching accounts. OMP token lookup and Pi OAuth resolution passed, followed by accepted live requests.
- [x] Installed Pi loads the route and completes requests, streaming responses, tool turns and follow-ups with supported thinking settings. Live Fable tests cover tool continuation, tool/low→high thinking changes and reload.
- [x] Supported native message features retain their required protocol headers and matching tool references. Unsupported per-turn effort is disabled on a per-request model copy before native serialization; selected request-level effort and stored history remain intact. API-key/proxy credentials are not diverted to OMP.
- [x] Representative available Anthropic models complete tiny synthetic live tests through Pi: Fable 5, Sonnet 4.6 and Haiku 4.5. No real project prompts or credentials were saved.
- [x] Owning docs and regressions match, existing linked sources are verified, and existing sessions require `/reload`. New test files need not be stowed to execute from the repository.

## Approach

1. Revalidate source, installed versions and deployed links; reproduce gaps with installed Pi and synthetic data.
2. Fix verified compatibility/auth-boundary defects and exercise the full extension/runtime path offline.
3. With explicit permission, run a bounded synthetic live smoke using existing authentication (no project context, other extensions or real tools).
4. Audit each acceptance criterion against current evidence; keep the goal unfinished if live verification is missing.

## Progress

- [x] Current runtime: Pi 0.87.1, Node 24.19.0, Bun 1.3.14, OMP 18.1.5. Existing source files are linked; the newly added native test is not deployed and need not be to run from the repository.
- [x] Re-ran the prior effort-header regression: 12 Bun tests and 2 native serialization tests passed.
- [x] Reproduced/fixed missing normalized tool declarations, unrewritten nested tool-transition references, and the stripped native tool-transition beta.
- [x] Reproduced/fixed OMP credential substitution on proxy/non-HTTPS endpoints in both stream entrypoints.
- [x] The new native SDK fixture exposed double route wrapping on `/reload` with `models.json` overrides: composition drops the provider marker. Registration now checks the raw registered native provider before rewrapping its original upstream.
- [x] Actual SDK session with leaf-linked extension passes tool execution/results, dynamic tool and thinking changes, command neutrality, follow-up and repeated reload. All 15 bundled Anthropic models also pass low/high-reasoning serialization with synthetic responses.
- [x] User approved a few tiny live synthetic requests using the existing Claude login. No project content, real tools or existing-pane input is authorized.
- [x] Initial live check: Sonnet/Haiku passed. Fable with the deliberate per-turn-effort regression override failed with `output_config.effort requires a model that supports per-turn effort; this model does not`. Correct headers alone did not establish feature support.
- [x] Added the request-level effort guard in both stream entrypoints. The guard changes only a request-scoped model copy and lets Pi serialize the selected level normally, avoiding message deletion or silently defaulting to high.
- [x] Final live sweep: all six phases passed in eight bounded model requests. Fable includes both synthetic tool calls, the low→high change, and a follow-up after actual SDK reload; Sonnet and Haiku each returned the exact requested sentinel.
- [x] Completion audit: local tests, credential checks, live provider results, linked-source verification and documentation all recorded. Existing interactive sessions still need `/reload` to load the final code.

## Decisions and boundaries

- The initial header-only `output_config` fix was insufficient. Live model capability rejection justified disabling per-turn effort for the pinned OMP route, while retaining request-level thinking. Per-turn effort remains native on API-key/proxy paths; they are outside the OMP credential rewrite.
- Preserve OMP credential selection, version guard and the reviewed route. Do not silently fall back to a different login or billing product.
- No native compaction changes; the separate provider-native compaction plan remains untouched.
- Do not send input to existing agent panes, install/upgrade software, reset conversations, commit or push.
- Use synthetic prompts, credentials and intercepted/loopback responses for offline checks. Runtime fixtures and logs belong in temporary directories, not Git.

## Verification

From `/Users/eric/dotfiles` this goal turn:

- `omp --version`, `bun --version`, `node --version`, installed Pi package version — passed; versions above.
- `ls -l ~/.pi/agent/extensions/omp-anthropic-route` — existing source links point into this repository.
- `bun test ./pi/.pi/agent/extensions/omp-anthropic-route/*.test.ts` — passed, 12 tests.
- `node --test pi/.pi/agent/extensions/omp-anthropic-route/native.test.mjs` — passed, 2 tests, synthetic serializer/parser only.
- `node --test pi/.pi/agent/extensions/omp-anthropic-route/runtime.test.mjs` — initially failed on normalized names, token substitution, tool references and repeated wrapping; passed after repairs. Final suite has 6 tests, including the request-level effort regression and 30 catalog requests against fake Bun. Real SDK session, no real provider calls.
- Final focused run: `bun test ./pi/.pi/agent/extensions/omp-anthropic-route/*.test.ts` (12 passed) and `node --test pi/.pi/agent/extensions/omp-anthropic-route/{native,runtime}.test.mjs` (8 passed). Total 20.
- Scoped credential checks: `omp token anthropic` captured in a Python subprocess, printing only exit/success booleans — passed; `ModelRuntime.checkAuth('anthropic')` and `getAuth('anthropic', {minOAuthValidityMs:0})` with `globalThis.fetch` disabled — OAuth configured and resolved. No token printed or copied into the repository.
- `stow -n -v -t "$HOME" pi` — only the two new test links proposed; no deployment performed or needed for existing linked production sources.
- `git diff --check` — passed. Diff/status reviewed; unrelated changes preserved.
- Approved live command: `node /tmp/pi-anthropic-live.Lxe6dl/live.mjs` — initial run exposed the model capability failure above; final run passed all six phases. Script/report are temporary, outside the repository, and contain only synthetic setup and sanitized outcomes. They are evidence, not standing permission to rerun model requests.
- Live safeguards: real installed Pi 0.87.1 SDK and deployed leaf-linked route; isolated temporary workspace/resource directory, no context files/skills/prompts/other discovered extensions, in-memory sessions, two echo-only synthetic tools, selected models limited to 512 output tokens per request, retries disabled, 45-second provider timeout, eight-request cap and no Homebrew upgrades. Existing panes were untouched.

### Final live results (2026-09-24)

| Requested model | Phase | Requests | Result |
| --- | --- | --- | --- |
| `claude-fable-5` | Original per-turn-effort metadata, now safely serialized at request level | 1 | Passed: streamed exact sentinel |
| `claude-fable-5` | Synthetic echo tool plus continuation | 2 | Passed: tool executed and exact sentinel returned |
| `claude-fable-5` | Remove old tool, add second echo tool, low→high thinking | 2 | Passed: new tool executed and exact sentinel returned |
| `claude-fable-5` | Follow-up after SDK `/reload` equivalent | 1 | Passed: streamed exact sentinel |
| `claude-sonnet-4-6` | Low-thinking basic response | 1 | Passed: streamed exact sentinel |
| `claude-haiku-4-5` | Thinking-off basic response | 1 | Passed: streamed exact sentinel |

The successful sweep reported 190 output tokens across eight requests. The earlier
diagnostic made three requests: the Fable rejection plus two successful basic
requests (18 output tokens total). No claim about subscription-versus-extra-usage
quota attribution is made.

## Risks and recovery

Private provider contracts and model capabilities can change independently of OMP's
version. A successful mocked response is not evidence of server acceptance. Changes
to linked source are picked up by new sessions or `/reload`; do not alter existing
session history. Roll back only this task's exact edits if needed, preserving earlier
and concurrent work.

## Outcome

The requested end-to-end outcome is verified: Anthropic models run through the
installed Pi/OMP route, including real streaming, tools, thinking changes and
reload continuation. Changes are in `index.ts` and `transport.ts`, with focused
regressions and matching route/verification docs. Twenty offline tests pass and
three representative models passed live.

Existing interactive conversations must `/reload` before retrying; no history reset,
new login or install is required for these compatibility fixes. Tests do not prove
every catalog model is entitled on this account, every third-party extension
combination, or quota/billing attribution. No commits, pushes, package upgrades or
existing-pane input were performed.
