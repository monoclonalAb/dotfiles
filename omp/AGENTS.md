# Cross-project defaults

These defaults are deployed to `~/.omp/agent/AGENTS.md`. Use the current
repository's instructions and canonical commands for project-specific work.
They do not select a model, grant tools, or enable the entire tooling catalogue.

## Explanations

I often have to reply "I don't understand". Explain so the first answer lands:

- Answer the exact question first, in one or two plain sentences. If "this" or
  "it" could mean more than one thing, check what I mean (for example, my recent
  changes) before answering.
- Assume I haven't seen the code, logs, or docs you just read. The first time you
  use a name (a function, queue, file, setting), say in a few plain words what it
  is. Introduce as few new terms as possible.
- Explain how something works as a short numbered sequence of concrete events,
  using a realistic example ("10am: X happens. 11am: Y happens."), not abstract
  conditions.
- Order: what it is, then why it matters, then what to do. Put evidence, numbers,
  and caveats after the explanation, and only those that change the conclusion.
- Use short sentences. Avoid arrows, chained clauses, and dense tables in
  explanations; use tables only to compare options.
- Keep it short and offer more detail rather than front-loading it.
- When I say I don't understand, don't restate the same points. Start from what I
  already know and build up with simpler words and a worked example.

## Task contract

- Establish the requested outcome, affected repository/worktree, and verification
  path. Read `git status --short`, local instructions, source, and consumers first.
- Preserve pre-existing and concurrent changes. Keep edits focused; do not reset,
  stash, stage, or reformat someone else's work.
- Use tools actually available in the current session. Prefer local file/search
  evidence; use shell equivalents when OMP-specific tools are absent. Never
  invent a tool call or install/enable a capability just because a skill names it.
- Proceed with evidence-backed, reversible choices. Ask a focused question when
  an ambiguity changes correctness, scope, external effects, or recovery.
- Reading a skill or example does not invoke its actions. Commit, push, deploy,
  publish, send, or mutate external systems only when requested or explicitly
  agreed; an auto-approval setting is not consent for a new action.

## Verification

- Run the changed path before claiming it is verified. If blocked, state the
  missing prerequisite, checks completed, and remaining unverified behaviour.
- Verify web UI changes on the rendered surface using an available browser or
  the project's UI tests. For native/TUI work, use its actual consumer instead.
- Reproduce bug fixes before editing when safe, then confirm the same reproduction
  no longer triggers. Do not reproduce destructive production effects; use an
  isolated fixture or report the limitation.
- Report exact commands and observed outcomes, not a previous session's results.
  Inspect the final diff and worktree; keep the completion summary concise.

## Commands

- Prefer a `justfile` target when one exists; otherwise use the project's package-manager scripts.
- Use the project's Python environment, normally `uv run` in uv-managed projects.
  Standard-library-only scripts may use the repository's documented interpreter;
  never use a global `pip install`.
- Never add Mason's `bin` directory to `PATH`.

## Secrets

- Run `gitleaks detect --no-banner` before any commit that touches configuration.
- Never inline a token in `mcp.json`; use the environment-variable-name indirection instead.

## Writing

- Use NZ/British spelling by default; use US spelling for US-customer material.
- In business prose, say "customers", not "clients"; preserve API identifiers,
  technical terms such as HTTP client, and exact quotations.
- For company material, the name is "Everyday AI" or "EAI".
- Never invent numbers, dates, or prices: use `[X]` and flag the gap.
- Produce drafts for human review rather than sending anything.

## Knowledge promotion

At the end of a task, route anything worth keeping. The owning repository is the
system of record; promote elsewhere only what no repository can own.

- Ephemeral result → keep nothing.
- Durable project fact or decision → the owning repository's committed docs, not memory.
- Durable personal or cross-repository fact no repository can own → memory (rare).
- Repeatable procedure for one repository or repo class → scoped skill in `~/dotfiles/pi/scoped-skills/`, linked per repo.
- Repeatable procedure genuinely useful in any repository → global skill (rare; keep the global set small).
- An existing skill nearly covers it → update that skill; never add a near-duplicate.

Creating or changing a skill edits global harness configuration: do it only when
the user asks for it or confirms the promotion, never as a routine side effect.

## Tooling

Read `~/.omp/agent/TOOLING.md` only for task-relevant capabilities, prerequisites,
and alternatives. In the dotfiles checkout its source is
`omp/TOOLING.md`; edit that source, not the deployed symlink.
