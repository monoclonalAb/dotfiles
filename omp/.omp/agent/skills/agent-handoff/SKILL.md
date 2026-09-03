---
name: agent-handoff
description: Write or resume a structured handoff note when work moves between OMP conversations or Herdr panes — "hand off this session", "write a handoff note", "resume from handoff", or ending a session whose remaining work another conversation will pick up. Not for durable facts (use memory).
---

# Agent handoff

One note per repository/worktree, kept outside every repository so Git never sees it:

`~/.local/state/agent-handoff/<slug>.md`, where `<slug>` combines the directory basename with a short hash of its absolute path, so unrelated checkouts that share a basename cannot collide and worktrees get distinct slugs automatically:

```sh
top=$(git rev-parse --show-toplevel 2>/dev/null || pwd -P)
printf '%s-%s\n' "$(basename "$top")" "$(printf '%s' "$top" | shasum -a 256 | cut -c1-8)"
```

## Writing a handoff

1. Ground every claim first: run `git status --porcelain` and `git log --oneline -5`; re-check anything not observed this session. Never write an unverified claim into the note.
2. If a note for this slug already exists, read it and fold any still-relevant remaining work into the new note rather than losing it; then overwrite.
3. Write the note with exactly these sections, in this order:

   ```markdown
   # Handoff: <one-line goal>
   - written: <UTC ISO 8601>
   - repo: <absolute path>
   - branch: <branch or worktree>
   - acceptance: <the criteria that define done>

   ## Changes
   Committed: <files/symbols + commit hashes, or "none">
   Uncommitted: <files/symbols, or "none">

   ## Commands run
   <exact command> → <observed outcome, one line each>

   ## Decisions and invariants
   <choices made and constraints the next agent must not break>

   ## External side effects
   <irreversible actions already performed — messages sent, deploys, tickets — or "none">

   ## Remaining work
   1. <next concrete action — specific enough to start immediately>
   2. <rest, ordered>

   ## Blockers
   <what is missing and what was already tried, or "none">
   ```

4. Keep it compact: durable, actionable state only. No transcript excerpts, no tool-output dumps, no secrets or tokens. Distinguish state persisted in the repository (survives the session) from session-only state (must be re-established).
5. Tell the user the absolute note path so the next pane can be prompted with "resume from handoff".

## Resuming from a handoff

1. Read the note for the current directory's slug. If absent, say so and stop — never invent prior context.
2. Verify the note against reality: current branch and `git status` must match the Changes section. On divergence, report it and trust the repository, not the note.
3. Treat recorded command outcomes as claims from a previous session: re-run any verification that gates further work or whose inputs may have changed; skip only expensive commands whose recorded inputs demonstrably still hold. Never repeat actions listed under External side effects.
4. Start from item 1 of Remaining work.
5. Delete the note once absorbed, so a stale handoff is never resumed twice.

## Do not use when

- Recording durable project knowledge — retain it in memory instead.
- Producing something for humans — write a PR description or commit message instead.
