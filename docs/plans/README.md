# Execution plans

Use a checked-in execution plan when a task spans multiple packages, changes a
generated/runtime boundary, has external side effects, introduces a migration,
or is likely to outlive one working session. Small, reversible edits should not
create permanent planning paperwork.

This convention adapts the plan-as-artefact practice described in OpenAI's
[Harness engineering](https://openai.com/index/harness-engineering/) article.

## Lifecycle

1. Create `docs/plans/active/YYYY-MM-DD-<slug>.md` from the template below.
2. Keep `Progress`, `Decisions`, and `Verification` current while working. Record
   facts another agent would otherwise have to rediscover.
3. If blocked, state the exact missing decision or capability; do not make a plan
   look complete.
4. On completion, record the outcome and move the file unchanged apart from its
   final status to `docs/plans/completed/`.
5. Put durable system facts and unresolved cross-cutting gaps in their owning
   architecture or operating document, not in an indefinitely active plan.

Create `active/` or `completed/` with the first plan that needs it; empty
placeholder directories are unnecessary.

## Active plan index

No active execution plans are currently recorded.

Replace that sentence with links while plans are active, and restore it only
when the last active plan is completed.

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

- `<command>` — not run / passed / failed / blocked: <evidence>.

## Risks and recovery

- <Failure mode, guardrail, rollback or recovery path.>

## Outcome

<Complete when moved to completed/: result, remaining gaps, and follow-up links.>
```

Plans are working control documents, not speculative essays. Prefer links to
canonical files, update them as evidence changes, and rely on Git history rather
than appending a chronological diary.
