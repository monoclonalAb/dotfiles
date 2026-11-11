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

Display-only extensions (no approval needed, but keep them that way):

- [`local-file-links/`](local-file-links/README.md) rewrites the link targets of
  rendered assistant Markdown so the terminal can open them. Messages are unchanged.
- [`gemini-thinking-tidy/`](gemini-thinking-tidy/README.md) shows only the
  summaries in Gemini 4 Carbon thinking blocks, hiding the summariser's leaked
  working notes. Rendering only: the session and model input keep the full text.
- [`readable-transcript/`](readable-transcript/README.md) frames thinking blocks
  behind one continuous `│` blockquote rail with a `Thinking` heading and tidies
  `codemode` and multi-line `bash` tool rows (human-readable nested call args,
  one-line JSON return summaries when collapsed, unescaped `[key]` sections when
  expanded). Rendering only: sessions, tool execution and model input are unchanged.
- `modal-vim-navigation/` owns the editor. Its `[img #N]` markers expand to Pi's
  native image file references when the draft is submitted, and it reads the
  clipboard only on an explicit paste. Ctrl+C copies a nonempty draft it clears.
- `herdr-app-resume/` labels its Herdr app terminal with the session file and
  shell pid (`pi.session`, `pi.shell`; cleared on quit) so the app's `pi-resume`
  mod can reopen the conversation after a reboot. Labels only; nothing reaches
  the model.
- `herdr-task-summary/` publishes a Herdr pane title (in the Herdr app, `hc`
  labels on its terminal: `task_summary`, `task_summary_pending`,
  `task_summary_error`). It observes user messages
  without changing them and names the task with a separate, tool-free
  `ctx.modelRegistry.complete` request containing only recent user text (never the
  system prompt, tool output or images). That request goes to `SUMMARY_MODEL`
  (`openai-codex/gpt-6-luna`) when Pi has a login for it, and to the conversation's
  model when that is missing or fails; it costs provider usage. Titles
  stay in memory and nothing is written to the session. When naming fails, the
  timestamped reason goes to the pane's display-only `task_summary_error` token
  (no files); a successful title or a new empty session clears it. In the Herdr
  app only, [`brief.ts`](herdr-task-summary/brief.ts) also writes a one- or
  two-sentence summary of the whole conversation for the Brief panel (`hc`
  labels `task_brief`, `task_brief_pending`, `task_brief_error`). It is a
  second request of the same kind, after each new user request and when a
  conversation opens or reloads. It holds the conversation's user text only (its
  first request and up to 11 latest ones), never replies or tool output.
- `token-speed/` shows output tokens per second in the footer and reports
  session and per-model averages through `/tps`. While a reply streams it shows
  a `~` estimate (streamed characters ÷ 4, Pi's own heuristic, over time since
  the request started); once the reply ends, and while its tools run, it shows
  the exact rate from the usage and monotonic duration Pi records on the
  message. It observes only read-only notifications (`message_start`,
  `message_update`, `tool_execution_start`, lifecycle), writes nothing to the
  session and adds nothing to model context. The number uses the theme's code
  colour, so it stays distinct from the quota percentages, and repaints when
  `theme-sync/` applies a flavour.

Herdr's official `herdr-agent-state.ts` is generated outside this repository by
`herdr integration install pi` (see the [Herdr setup](../../docs/HERDR.md#install)).
It is the lifecycle-status owner; `herdr-task-summary/` is not a replacement for it.
The audited v8 integration reports state and session identity over local IPC without
registering tools, injecting messages, or changing model context. Keep it Herdr-owned
rather than vendoring or adding a competing lifecycle reporter here.

Approved exceptions:

- `selective-skills.ts` only contributes skills explicitly enabled by the user through `/skill`, keeps that selection session-local, and starts every new session with no skills enabled, except the folder skills in its `FOLDER_SKILLS` list: a new session inside `~/Desktop/projects/DE`, or in a Git worktree (such as a Herdr task under `~/.herdr/worktrees/`) whose main checkout is there, starts with `everyday-ai-frontend-styleguide` on (the footer shows `skills: 1`; `/skill off` sticks for that session), and `/skill` does not offer that skill outside the folder. `/skill` offers skills from Pi's standard and compatible skill folders, plus any file or folder listed in Pi's `skills` setting (user `settings.json` or a trusted project's `.pi/settings.json`). The `pi` wrapper's `--no-skills` stops Pi loading that list itself; include/exclude pattern entries are skipped, and a listed folder never replaces a same-named skill from the standard folders.
- [`agent-stuff/`](agent-stuff/README.md) (vendored subset) submits prompts only when `/review`, `/answer`, `/btw` or `/goal` is invoked. `/btw` runs a separate side session with read/search tools (plus `bash` when the main chat has it, limited by instruction rather than enforcement) and adds to the main context only when you choose to inject its summary. `/goal` registers its tools and appends the objective in `before_agent_start` only after opt-in, and its `context` hook filters only its own messages; Escape, errors, pause or clear stop automatic continuation.
- [`codex-fast/`](codex-fast/README.md) uses `before_provider_request` only after `/fast on` to set `service_tier: "priority"` on reviewed `openai-codex` models. It resets on reload and unsupported models, and changes nothing else.
- [`quota-router/`](quota-router/README.md) moves a parked login under the provider id through Pi's locked credential store when the active account hits a usage limit, so Pi's own retry continues on the same model. Its `message_end` handler only appends a `[quota-router: …]` note to the `errorMessage` of a failed assistant message (so the retry policy recognises Codex's limit text), and only when a parked account exists.
- [`omp-anthropic-route/`](omp-anthropic-route/README.md) rewrites only direct Anthropic OAuth HTTP traffic into the reviewed OMP request shape and removes Pi's built-in documentation-locator block (project/user context stays). The first direct Claude OAuth request per runtime may upgrade Homebrew `omp` to the latest stable upstream release, permitting only version/binary-hash substitutions in a reviewed formula recipe; a failed or refused update warns and keeps the installed CLI. The wire adapter stays pinned; CLI binaries are trusted upstream, not individually reviewed. Pi remains the credential owner: the bridge preserves each request's selected Pi login and never resolves OMP's saved login. One synthetic request verifies each model/credential pair before real traffic; failed probes stay blocked for that pair instead of falling back, and account changes or token refreshes get a separate check. Startup, model selection and reload are passive. API-key and proxy traffic are untouched, and Pi's billing warning stays.

This README is a development policy only. Pi does not load it into model context, and Pi has no capability sandbox that automatically enforces the policy; extension source must still be reviewed.

## Runtime controls

- [`theme-sync/`](theme-sync/README.md) applies the shared Catppuccin flavour through the public theme API. No settings are written.
- [`compact-ui/`](compact-ui/README.md) replaces the quiet-startup header with one expandable line and shows a right-aligned `MCP: N/M` (enabled/total servers in Pi's `mcp.json` files) in the footer.
- [`quota-footer/`](quota-footer/README.md) polls quota endpoints with Pi's own logins in interactive sessions and shows usage in the footer; `/usage` covers every saved account. Claude readings are cached privately per login outside Git.
- `long-context/` adds `/long-context [on|off|status]` for direct OpenAI and OpenAI Codex GPT-5.6 Sol, Terra, Luna, and GPT-6 Astra. With no argument it toggles the active model between Pi's 272K default and the model's 1.05M window for the current session. It changes only the active model metadata, shows `ctx:1.05M` while enabled, and warns that requests above 272K may use long-context pricing; it does not alter conversation content or provider payloads.

Workflows that only need a prompt belong in [`../prompts/`](../prompts/) as templates,
not extensions: they enter context only when the user invokes them.
