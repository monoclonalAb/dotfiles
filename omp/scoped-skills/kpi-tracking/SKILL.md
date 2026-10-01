---
name: kpi-tracking
description: >-
  This skill should be used when implementing KPI tracking in Hono/workflow-based
  services, adding or aligning KPIs with base-DE-template patterns, wiring
  logger.kpi and Pub/Sub, or producing KPI tables for a digital employee (DE).
  Invoke when the user mentions KPIs, kpi.ts, workflow metrics, or scheduler-driven
  KPI emits.
---

# KPI Tracking Skill Template

Use this skill when a task asks to add KPI tracking or align KPI behavior with an existing implementation in another repo.

## Before coding (required)

1. Read repository instructions, preserve existing work, and read the required
   PRs/source files in [`references/reference-prs.md`](references/reference-prs.md).
   Record the resolved source commit so all copied files come from one revision.
2. Extract exact implementation patterns from those references.
3. Record the required file touchpoints in this repo before changing code.

### Dependencies

If `perform-dangerous-action` is not installed in this project (required in the `kpi.ts` changes), you must first instruct the user to install it before you can proceed with implementing KPIs from the table.

## Implementation workflow

- [ ] Confirm scheduler/task entrypoints and the API endpoints they call.
- [ ] Map each endpoint to a `workflow` value and ensure `workflow` is set at route boundary.
- [ ] Copy `kpi.ts` and `logger.ts` changes from references as verbatim as possible.
  - Fetch `kpi.ts` verbatim with `gh` from the reviewed GitHub commit into a
    temporary file outside the repository. Check the fetch succeeded and compare
    with any existing target before copying; never redirect a network response
    straight over a working source file. Preserve unrelated customisation or
    report a conflict with the verbatim requirement.
  - `logger.ts` may differ in other places, so it's OK to wire in the logger manually. Review how `logger.ts` changed in https://github.com/everyday-artificial-intelligence/base-DE-template/pull/23 to get an idea of what needs to change to support `logger.kpi`.
- [ ] Update type definitions (`env.d.ts`, `hono.d.ts`, workflow-related types) required for KPI plumbing. See PR #23 in base-DE-template to see the env vars that need to be added.
- [ ] Add missing dependencies (for example `@google-cloud/pubsub`) only if absent, using `pnpm` to install it.
- [ ] Add KPI emits at key lifecycle points: start, success/failure, duration, policy or branch outcomes, delivery results.
- [ ] Produce a KPI table using `assets/kpi-table-template.md`.
  - [ ] Included in the table is what Hono context `workflow` each KPI would be associated with.

## Required outputs

1. Code changes across all required touchpoints.
2. A markdown KPI table with:
   - KPI name
   - Human-readable trigger timing
   - Unit and value sent
3. What workflows will be recorded for KPIs (i.e., what Hono `workflow` variables you will be setting and where you'll be setting them)

## Implementing KPIs

Once you've iterated with the user on the KPIs to add to the project, it's up to you to implement them:

- [ ] Add each KPI from the table in the relevant place in the project
- [ ] Ensure that Hono `workflow` env variables have been set

## Gotchas

- Do not invent KPI naming unless required; prefer names from the reference PR set.
- Route-level `workflow` assignment is mandatory for scheduler-driven tasks.
  - If needed, investigate Cloud Scheduler read-only with an explicit project,
    following the `gcp-investigate` skill; implementation does not authorise cloud
    mutation or publishing real KPI events during tests.
- Include both success and failure KPI paths where applicable.
- Include duration KPIs for long-running scans/workflows.
- Keep emitted values explicit (`value_int = 1`, counters, elapsed ms, etc.).

## Validation loop

1. Run typecheck/lint/tests used by the target repo.
2. Fix task-related failures; report unrelated failures and missing prerequisites.
3. Re-run affected checks without weakening assertions or enabling production writes.
4. Re-check KPI table against final code.
