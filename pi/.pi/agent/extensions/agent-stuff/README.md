# Selected agent-stuff commands

Five extensions vendored from [mitsuhiko/agent-stuff](https://github.com/mitsuhiko/agent-stuff)
at [`122e299`](https://github.com/mitsuhiko/agent-stuff/tree/122e2994adddb113c04764c5697217dae120fcc6)
under [Apache-2.0](LICENSE): `answer`, `btw`, `goal`, `review` and
`session-breakdown`. Each carries a modification notice; `index.ts` registers them.
Nothing else from the mitsupi package is installed (installing it too would
duplicate the commands). Tested with Pi 0.87.1.

| Command | Behaviour |
| --- | --- |
| `/review [target]` | Code review in an **Empty branch** (isolated) or the current session. Targets: `uncommitted`, `branch main`, `commit abc123`, `pr 123` or a PR URL, `folder src docs`, plus `--extra "focus"` |
| `/end-review` | Leave an Empty-branch review: return only, return and summarize, or return and fix findings |
| `/answer` / `Ctrl+.` | Extract the questions in the last reply and answer them in a form; only the final confirmation submits |
| `/btw [question]` | Side chat in an overlay, with a snapshot of the main context and read-only tools |
| `/goal <objective>` | Keep working automatically until the goal is complete, blocked, paused or over budget |
| `/session-breakdown` | 7/30/90-day local usage dashboard from session files |

## Review

Needs an idle session in a Git repository. `REVIEW_GUIDELINES.md` next to the
nearest `.pi` directory is used for trusted projects. **Loop fixing** (off by
default, max ten passes) and "return and fix findings" start coding turns, but
never commit, push or comment. A plain review is a prompt, not a sandbox.

`/review pr` uses `gh` and checks the PR out in the current working tree only
after confirmation and a check for tracked changes; it never stashes or resets.
`/end-review` returns the conversation, not the Git branch.

## BTW

The side chat uses the selected model and thinking level, and only the active
built-in `read`/`grep`/`find`/`ls` tools (no bash, edits, MCP or extensions). Its
thread is saved in the session but stays out of the main context unless you choose
**Inject summary into main chat**. The prompt is Pi's editor with the main editor's
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

`/answer` extraction, `/btw` and its summaries are extra provider requests outside
the session totals (60–90 s deadlines), using the parent's provider and auth.

## State

Loading the extension adds no model calls, tools or background work. Review, goal
and BTW state are custom entries in the existing session log. `/session-breakdown`
reads session JSONL only when opened (`PI_CODING_AGENT_SESSION_DIR`, else the
agent's `sessions/`), groups whole files by start date, and keeps everything in
memory. It is an estimate, not billing.

## Tests and updates

```sh
node --test pi/.pi/agent/extensions/agent-stuff/native.test.mjs
node pi/.pi/agent/extensions/agent-stuff/typecheck.mjs
```

The native suite runs real Pi SDK sessions and TUI components with an isolated
HOME, Stow-style links, synthetic providers, temporary Git repositories and mocked
`gh`. It does not cover real providers, the real clipboard or terminal key
forwarding. `btw.ts` imports the editor from `../modal-vim-navigation/`, so keep
both deployed together.

To update, review a new upstream commit file by file, keep the local changes and
licence notices, and rerun the suite. Nothing updates automatically.
