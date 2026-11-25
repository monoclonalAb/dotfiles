# Selected agent-stuff commands

Three extensions vendored from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)
at [`122e299`](https://github.com/mitsuhiko/agent-stuff/tree/122e2994adddb113c04764c5697217dae120fcc6)
under [Apache-2.0](LICENSE): `btw`, `goal` and `session-breakdown`. Each carries a
modification notice; `index.ts` registers them. `answer` and `review` were removed
on 2026-11-25 after going unused; `/rho` reviews through `pi-agent` instead.
Nothing else from the mitsupi package is installed (installing it too would
duplicate the commands). Tested with Pi 0.87.1.

| Command | Behaviour |
| --- | --- |
| `/btw [question]` | Side chat in an overlay, with a snapshot of the main context, read/search tools and `bash` |
| `/goal <objective>` | Keep working automatically until the goal is complete, blocked, paused or over budget |
| `/session-breakdown` | 7/30/90-day local usage dashboard from session files |

## BTW

The side chat uses the selected model and thinking level. It always gets the
built-in `read`/`grep`/`find`/`ls` tools, so it can search the repository even
when the main chat only has `read` (local change). It also gets built-in `bash`
when the main chat has it active, so it can inspect Git history and run `rg`.
**Bash is not sandboxed**: the side chat is only told to inspect and never change
files, commit or contact services. It never gets `edit`, `write`, `codemode`, MCP
or extension tools. Its thread is saved in the session but stays out of the main
context unless you choose **Inject summary into main chat**. The prompt is Pi's editor with the main editor's
[clipboard images](../modal-vim-navigation/README.md): Up/Down recall earlier BTW
prompts, `Ctrl+J` adds a newline, `Option+Shift+C` copies, `Ctrl+C` copies and
clears, `PageUp`/`PageDown` or the wheel scroll, `Escape` cancels and closes.

## Goals and costs

```text
/goal --budget 100000 <objective>
/goal pause | resume | edit | clear
/goal                              # status only
```

**There is no token budget by default**, so a goal can make unlimited paid
requests. Escape aborts the turn and pauses the goal; provider errors stop it; a
reload or session switch never resumes it automatically. The budget is a soft
limit checked after each run (fresh input + output + cache writes). While active,
the goal exposes `get_goal`, `create_goal` and `update_goal`, which the session's
tool allowlist must permit.

`/btw` and its summaries are extra provider requests outside the session totals
(60–90 s deadlines), using the parent's provider and auth.

## State

Loading the extension adds no model calls, tools or background work. Goal and BTW
state are custom entries in the existing session log. `/session-breakdown`
reads session JSONL only when opened (`PI_CODING_AGENT_SESSION_DIR`, else the
agent's `sessions/`), groups whole files by start date, and keeps everything in
memory. It is an estimate, not billing.

## Tests and updates

```sh
node --test pi/extensions/agent-stuff/native.test.mjs
node pi/extensions/agent-stuff/typecheck.mjs
```

The native suite runs real Pi SDK sessions and TUI components with an isolated
HOME, per-file links like dotfiles-link's, synthetic providers and temporary Git
repositories. It does not cover real providers, the real clipboard or terminal key
forwarding. `btw.ts` imports the editor from `../modal-vim-navigation/`, so keep
both deployed together.

To update, review a new upstream commit file by file, keep the local changes and
licence notices, and rerun the suite. Nothing updates automatically.
