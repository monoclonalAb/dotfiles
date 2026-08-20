---
name: perform-dangerous-action
description: Use this skill when implementing any operation that mutates external client systems (Affinity, Gmail, etc). Wrap every external write in performDangerousAction with clear action/description, handle skipped outcomes, and enforce safe sequencing.
metadata:
  domain: safety
  package: "@everyday-artificial-intelligence/perform-dangerous-action"
  packageVersion: "2.1.0"
---

## What I do

- Enforce safe guardrails for external side effects.
- Prevent unguarded writes to client systems.
- Standardize action naming, metadata, and skipped-result handling.

## Hard rule when reviewing code

- Any mutation to an external client system is a required `performDangerousAction` call.
- This wrapper exists to require explicit user consent before executing external side effects.
- Missing this wrapper for external writes is a P0.

## Examples

- Updating client CRM records (Creating/updating/deleting Affinity records), such as notes, fields, list entries, etc
- Creating/sending/modifying Gmail artifacts
- Any outbound operation that changes client-visible state
- Any external communication on behalf of clients

## Do not require this for

- Read-only operations (`GET` / fetch / query)

## Runtime behavior

- Development/TTY: prompts for confirmation in terminal.
- Production/non-TTY: auto-approves.
- Session state: remembers decisions for the current run/session.

## Implementation checklist

1. Wrap each external mutation in `performDangerousAction`.
2. Use a clear action string (verb + target), for example:
   - `create affinity generated email note`
   - `delete affinity email generating note`
3. Provide `description` with key identifiers (`companyId`, `noteId`, `listId`, etc.).
4. Handle `status === 'skipped'` explicitly (log and continue/return safely).
5. For progress-note workflows, clean up transient notes in `finally` so UX state is never left stale.

## Pattern

```ts
/*
const result: {
    status: "skipped";
    reason: "banned" | "user-denied" | "passive-mode";
} | {
    status: "executed";
    value: number & $brand<"noteId">;
}
*/
const result = await performDangerousAction(
  "create affinity generated email note",
  async () =>
    createAffinityNote({
      companyId,
      type: NoteType.InitialOutreachCompleted,
      body,
    }),
  {
    description: `companyId=${companyId}, noteType=${NoteType.InitialOutreachCompleted}`,
  },
);

if (result.status === "skipped") {
  logger.warn("Skipped creating generated email note", {
    companyId,
    reason: result.reason,
  });
} else {
  // use `result.value`, the returned value by the inner callback (createAffinityNote in this case)
}
```
