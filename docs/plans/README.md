# Execution plans

Use a checked-in execution plan when a task spans multiple packages, changes a
generated/runtime boundary, has external side effects, introduces a migration,
or is likely to outlive one working session. Small, reversible edits should not
create permanent planning paperwork.

This convention adapts the plan-as-artefact practice described in OpenAI's
[Harness engineering](https://openai.com/index/harness-engineering/) article.

## Lifecycle

1. Create `docs/plans/active/YYYY-MM-DD-<slug>.md` from the template below, using
   the observed date, and add it to the active index. First read any overlapping
   active plan; coordinate shared files without absorbing another task's scope.
2. Keep `Progress`, `Decisions`, and `Verification` current while working. Record
   facts another agent would otherwise have to rediscover.
3. If blocked, state the exact missing decision or capability; do not make a plan
   look complete.
4. On completion, record the outcome, set status to Complete, and move the file
   to `docs/plans/completed/`. Remove only its active-index entry and repair any
   incoming links. Do not rewrite an already-completed plan to describe later state.
5. Put durable system facts in the owning architecture or operating document.
   Keep unresolved cross-cutting gaps in [`../QUALITY.md`](../QUALITY.md), not in
   an indefinitely active plan.

Create `active/` or `completed/` with the first plan that needs it; empty
placeholder directories are unnecessary.

## Active plan index

- [Pi provider-native compaction](active/2026-09-15-pi-provider-native-compaction.md) — planned; baseline verified, API-first vs subscription-first scope decision pending.

When there are no active plans, use `No active plans.` instead of the list.
Keep other tasks' entries intact when adding or completing your own plan.

## Resuming work

Re-read the user's goal, current branch, `git status --short`, affected source,
and the plan's remaining steps. Treat recorded command outcomes as historical;
rerun checks whose inputs changed. A checked box or past deployment command is
not permission to repeat an external action. If the worktree diverged, reconcile
the plan with observed state before editing.

## Template

```markdown
# <Outcome-oriented title>

**Status:** Active
**Scope:** <packages and external systems included>

## Objective

<Observable end state and why it matters.>

## Non-goals

- <Explicitly excluded work.>

## Context and constraints

- <Canonical files, existing worktree state, safety boundaries, dependencies.>

## Acceptance criteria

- [ ] <User-observable or mechanically verifiable outcome.>

## Approach

1. <Coherent vertical step.>

## Progress

- [ ] <Current step and evidence gathered so far.>

## Decisions

- **<Decision>:** <choice, evidence, and rejected alternative when useful>.

## Verification

- `<exact command and working directory>` — not run / passed / failed / blocked:
  <observed result, input/version when relevant, and remaining unobserved boundary>.

## Risks and recovery

- <Failure mode, guardrail, rollback or recovery path.>

## Outcome

<Complete when moved to completed/: result, remaining gaps, and follow-up links.>
```

Plans are working control documents, not speculative essays. Prefer links to
canonical files, update them as evidence changes, and rely on Git history rather
than appending a chronological diary.
