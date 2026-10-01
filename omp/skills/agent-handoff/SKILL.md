---
name: agent-handoff
description: Write or resume a structured handoff note when work moves between OMP conversations or Herdr panes — "hand off this session", "write a handoff note", "resume from handoff", or ending a session whose remaining work another conversation will pick up. Not for durable project facts (use the owning repository's docs).
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
3. Treat recorded command outcomes as historical claims: re-run verification
   that gates further work or whose inputs changed; label any retained result as
   historical rather than a new pass. Do not repeat recorded external effects
   automatically; a necessary retry requires current intent and idempotency checks.
4. Reconcile Remaining work with the current user's request, repository
   instructions, and active plan, then start at the first still-applicable item.
5. Delete the note only after its remaining work has been absorbed into the
   current task or owning plan, so a stale handoff is never resumed twice.

## Do not use when

- Recording durable project knowledge — put it in the owning repository's docs.
  Memory is only for rare personal/cross-repository facts no repository can own.
- Producing something for humans — write a PR description or commit message instead.
