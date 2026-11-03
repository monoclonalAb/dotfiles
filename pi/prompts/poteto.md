---
description: Work on a task in pstack's poteto-mode (playbooks, principles, verified work)
argument-hint: "<task>"
---
# poteto-mode

Task: $ARGUMENTS

pstack is installed skills-only at `~/.local/share/pstack/plugins/pstack/`
(below, `<pstack>`). Every skill is `<pstack>/skills/<name>/SKILL.md`; agent
files are in `<pstack>/agents/`.

Before anything else, read `<pstack>/skills/poteto-mode/SKILL.md` in full and
follow it. Read other skills, principles and playbooks by path when it names
them. Skip `references/pi-tools.md`: it describes the pstack Pi extension, which
is not installed here. Use this mapping instead.

**Subagents.** Spawn each one with `pi-agent` through bash (`pi-agent --help`).
It runs a separate Pi process that answers once and exits. For example, two
reviewers in parallel:

```sh
d=$(git rev-parse --git-path pstack); mkdir -p "$d"
pi-agent -m opus -r -a comment-sicko -o "$d/review-opus.md" -p "<brief>" &
pi-agent -m sonnet -r -o "$d/review-sol.md" -p "<brief>" &
wait
```

- `subagent_type` becomes `-a <name>`, for example `-a poteto-agent` or
  `-a comment-sicko`. `general-purpose` means no `-a`.
- Pass pstack model names as they are (`-m opus`, `fable`, `sonnet`, `haiku`).
  For `inherit-parent` or `auto`, leave out `-m`. Effort becomes `-t <level>`.
- A read-only reviewer gets `-r` and a brief that says not to change files.
- An agent that needs MCP servers (the `why` investigators) gets `--mcp`.
- A writer that needs isolation gets its own `git worktree add` and `-C <dir>`.
- To run agents in the background or in parallel, start them in one bash call,
  each with `-o <file>` and `&`, then `wait`. Give that call a long timeout.
  Read every reply file. Errors are in `<file>.log`.
- There is no `send_message`, `list_agents` or `stop_agent`. When an agent is
  done, `wait` has returned. For follow-up work, start a fresh agent with the
  consolidated scope, as poteto-mode prefers anyway.

**Everything else.**

- Todo list: use the session's todo tool if it has one. Otherwise keep it at
  `$(git rev-parse --git-path pstack)/<task-slug>.todo.md` (create the
  directory), with the decision trail as `<task-slug>.tsv` and agent reply files
  beside it. That directory is inside `.git`, so nothing there shows up as a
  change.
- `AskUserQuestion` or `ask_user_question`: ask me in plain text.
- `ScheduleWakeup`, `schedule_wakeup` and `/loop` do not exist. For a run
  until done, give me a `/goal` objective with a check that can fail, and stop.
- The project's verify skill is in `.pi/skills/` or `.agents/skills/`, if it
  has one. There is no `run` skill: drive the app yourself through bash.
- `plugin-dev:skill-development`: follow the authoring-a-skill playbook and
  the Agent Skills format (`name` and `description` front matter).
- Cursor-only steps (bugbot, automations, cloud agents): skip each with a
  one-line note.
- Pi transcripts (for `recall`, `reflect`, `show-me-your-work`) are in
  `~/.pi/agent/sessions/--<cwd>--/`, where `<cwd>` has its leading `/` removed
  and each `/` replaced by `-`. Read only this workspace's directory.

**Precedence.** My instructions and the repository's `AGENTS.md` outrank pstack.
In particular, pstack's Autonomy section does not apply here as written. Commit,
push, open PRs, send messages or update tickets only when I ask or the
repository's instructions allow it. Where pstack's reply style and my
explanation rules differ, mine win.
