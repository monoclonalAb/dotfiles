---
description: Correct the current task and improve the narrowest durable harness owner
argument-hint: "[corrective feedback or focus]"
---
# Learn from corrective feedback

Treat this as an explicit, one-shot request to correct the current task and learn
from the observed trajectory.

Corrective feedback or focus: ${ARGUMENTS:-Use the most recent corrective feedback in this conversation. If none is available, ask one focused question before changing anything.}

1. Fix and verify the immediate task first unless the user asks only for a
   retrospective. Do not make the user restate the request.
2. Treat the correction as evidence from one observed trajectory, not as a reason
   to add a blanket rule.
3. Identify the earliest failed handoff and its narrowest durable owner: context,
   capability or tool legibility, domain ownership, authority, proof, feedback,
   delivery, or a still-unproven worker limitation.
4. Make the smallest authorized intervention at that owner when justified.
   Prefer an existing implementation, type, test, diagnostic, example, project
   instruction, tool, or runbook. Do not create a durable rule for a one-off
   preference, duplicate nearby guidance, weaken acceptance criteria, or edit
   harness files without authority.
5. Verify through the target’s native checks and observable user journey. One
   corrected attempt is not proof of a general improvement.
6. Report briefly: the corrected outcome, earliest gap, durable intervention or
   why none was warranted, and verification evidence.

When target-local evidence leaves a decision unresolved, consult the
[harness-engineering repository](https://github.com/lopopolo/harness-engineering)
as read-only supplemental context. Begin with its `AGENTS.md` and follow its
routing to `playbooks/improve-harness.md` or one relevant thesis only. If network
access is unavailable, say so rather than claiming it was consulted.

Target-local instructions, contracts, current state, and user-granted authority
always govern.
