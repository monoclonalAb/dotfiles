# Pi extension policy

Extensions in this directory must be context-neutral by default. They may add commands, UI, rendering, metadata, or local runtime behavior, but must not add to or rewrite model-visible input.

Do not use extensions here to:

- register active custom tools or add tool prompt metadata
- transform user input
- inject or rewrite the system prompt
- inject, replace, filter, or rewrite conversation messages or tool results
- rewrite provider request payloads
- discover additional skills or prompts that change model context

Relevant APIs and hooks requiring explicit review include `registerTool`, `input`, `before_agent_start`, `context`, `message_end`, `tool_result`, `before_provider_request`, `sendMessage`, `sendUserMessage`, and `resources_discover`.

Prefer command-only, UI-only, or metadata-only extensions. Keep any model-context-changing behavior outside the auto-discovered extension set unless it is deliberately approved.

`herdr-task-summary/` is metadata-only. It observes finalized user messages without returning a replacement, deterministically normalizes the latest substantive request into an up-to-six-word task phrase, and reports only an in-memory Herdr pane token, using `New conversation` until a substantive request exists. It does not append Pi session entries, rename the Pi session, or alter model-visible content.

Herdr's official `herdr-agent-state.ts` is generated outside this repository by
`herdr integration install pi` (see the [Herdr setup](../../../../README.md)).
It is the lifecycle-status owner; `herdr-task-summary/` is not a replacement for it.
The audited v8 integration reports state and session identity over local IPC without
registering tools, injecting messages, or changing model context. Keep it Herdr-owned
rather than vendoring or adding a competing lifecycle reporter here.

Approved exceptions:

- `selective-skills.ts` only contributes skills explicitly enabled by the user through `/skill`, keeps that selection session-local, and starts every new session with no skills enabled.
- `harness-feedback.ts` appends correction-handling guidance only after the user explicitly enables `/feedback`; it starts disabled whenever the extension runtime is loaded.
- `omp-anthropic-route/` rewrites only direct Anthropic OAuth HTTP traffic to the explicitly requested, pinned OMP-compatible wire shape. It is enabled by default but applies the rewrite only when the installed OMP version matches that reviewed target; a mismatch gets one package-only Homebrew update attempt before the stale route is disabled in favour of Pi's native transport. It adds OMP's provider identity/metadata and removes only Pi's built-in documentation-locator block during serialization (project/user context remains), never applies to API-key or proxy traffic, and retains Pi's billing warning.

This README is a development policy only. Pi does not load it into model context, and Pi has no capability sandbox that automatically enforces the policy; extension source must still be reviewed.

## Runtime controls

- `long-context/` adds `/long-context [on|off|status]` for direct OpenAI and OpenAI Codex GPT-5.6 Sol, Terra, Luna, and GPT-6 Astra. With no argument it toggles the active model between Pi's 272K default and the model's 1.05M window for the current session. It changes only the active model metadata, shows `ctx:1.05M` while enabled, and warns that requests above 272K may use long-context pricing; it does not alter conversation content or provider payloads.

## Draft commands

- `domain-first.ts` adds `/domain-first [scope]`, which stages a reviewable domain-constraint and simplification prompt in the editor. It guides the agent to create or evolve `domain-first-operating-model.md` without submitting or injecting anything automatically.
- `test-sweep.ts` adds `/test-sweep [scope]`, which stages a reviewable test-value and production-simplification prompt in the editor. It never submits or injects the prompt; the user must review and send it explicitly.
