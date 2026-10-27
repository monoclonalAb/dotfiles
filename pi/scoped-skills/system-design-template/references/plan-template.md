# Plan Template

For new/bare projects, generate a `plan.md` that turns the system design into
actionable implementation steps. Use the repository's existing plan owner/path
when it has one. The structure below is a planning template, not permission to
deploy or remove human review gates; replace examples with confirmed requirements.

---

```markdown
# Implementation Plan — [Project Name]

> Generated from system-design.md. This plan breaks the design into phased,
> dependency-ordered work.

## Open Questions

Before starting implementation, these decisions need to be made:

- [ ] [Question 1 — e.g., "Which email provider are we using?"]
- [ ] [Question 2]

---

## Phase 1: Foundation (Target: Passive deployment)

Goal: Get the DE running end-to-end with all external writes blocked by PDA.

### Setup & Infrastructure
- [ ] [Task — e.g., Initialize project scaffolding, set up repo structure]
- [ ] [Task — e.g., Configure environment variables and secrets management]

### Service Integration (Read-Only)
- [ ] [Task — e.g., Set up CRM API client with read access]
- [ ] [Task — e.g., Implement authentication for Service X]

### Core Workflow Implementation
- [ ] [Task — e.g., Implement Step 1: Fetch pending items from queue]
- [ ] [Task — e.g., Implement Step 2: Process and transform data]
- [ ] [Task — e.g., Implement Step 3: Write results (PDA-wrapped)]

### PDA Wrapping
- [ ] [Task — e.g., Wrap all CRM update calls in performDangerousAction]
- [ ] [Task — e.g., Wrap email send calls in performDangerousAction]

### Testing (Phase 1)
- [ ] [Task — e.g., Set up local dev environment with service mocks]
- [ ] [Task — e.g., Write unit tests for data transformation logic]
- [ ] [Task — e.g., Write integration tests for full workflow with mocked services]

**Phase 1 Done When:** Workflow runs end-to-end in passive mode. All external
writes are blocked by PDA. Tests pass. Logs show correct decision-making.

---

## Phase 2: Validation (Target: Active Beta)

Goal: Enable real external writes under close monitoring.

### Promotion Prep
- [ ] [Task — e.g., Meet passive-phase metrics thresholds for N days]
- [ ] [Task — e.g., Set up monitoring dashboards for key metrics]

### Monitored Writes
- [ ] [Task — e.g., Enable PDA approval for CRM updates with human review]
- [ ] [Task — e.g., Enable email sends to internal-only recipients first]

### Observability
- [ ] [Task — e.g., Implement alerting for error rate spikes]
- [ ] [Task — e.g., Set up daily summary reports of DE actions]

**Phase 2 Done When:** External writes verified correct over observation
window. Error rate below threshold. No critical issues.

---

## Phase 3: Production

Goal: Full autonomous operation.

### Promotion
- [ ] [Task — e.g., Switch PDA to auto-approve mode]
- [ ] [Task — e.g., Remove human-in-the-loop review gates]

### Hardening
- [ ] [Task — e.g., Implement retry logic for transient failures]
- [ ] [Task — e.g., Add circuit breakers for unreliable services]
- [ ] [Task — e.g., Load test at expected throughput]

**Phase 3 Done When:** DE operates autonomously. Metrics stable. On-call
process documented.

---

## Suggested Order of Work

A dependency-ordered sequence for the first week or two:

1. [First thing to build — usually project setup + auth for primary service]
2. [Second — usually read-path of the core workflow]
3. [Third — usually write-path with PDA wrapping]
4. [Fourth — usually testing and local dev setup]
5. [Fifth — usually monitoring and observability]
```

---

## Tips for Generating the Plan

1. **Map phases to deployment stages.** Phase 1 = passive, Phase 2 = beta,
   Phase 3 = production. This keeps the plan aligned with the design doc.
2. **Order by dependency.** Auth before API calls. Read before write. Core
   workflow before edge cases.
3. **Be specific.** "Set up OAuth for Salesforce" is better than "Handle auth."
4. **Surface open questions early.** If the design doc has TBDs that block
   implementation, call them out in the Open Questions section.
5. **Include the "done when" criteria.** Each phase needs a clear exit
   condition so the team knows when to promote.
