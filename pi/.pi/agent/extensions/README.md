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

Approved exceptions:

- `selective-skills.ts` only contributes skills explicitly enabled by the user through `/skill`, keeps that selection session-local, and starts every new session with no skills enabled.

This README is a development policy only. Pi does not load it into model context, and Pi has no capability sandbox that automatically enforces the policy; extension source must still be reviewed.

## Draft commands

- `domain-first.ts` adds `/domain-first [scope]`, which stages a reviewable domain-constraint and simplification prompt in the editor. It guides the agent to create or evolve `domain-first-operating-model.md` without submitting or injecting anything automatically.
- `test-sweep.ts` adds `/test-sweep [scope]`, which stages a reviewable test-value and production-simplification prompt in the editor. It never submits or injects the prompt; the user must review and send it explicitly.
