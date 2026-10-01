# Interview Questions for New DE Projects

Use these questions to gather requirements when the codebase is bare/new.
Do NOT ask every question — select the relevant ones based on what the user
has already told you, and group them into 2–3 rounds.

---

## Round 1 — Big Picture

These questions map to **Section 1 (Services)** and **Section 2 (Workflows)**.

### Purpose & Scope
- What is this Digital Employee supposed to do? (1–2 sentence elevator pitch)
- Who or what triggers the DE's work? (scheduled, event-driven, user-initiated)
- What does a successful run look like? What's the end output or side effect?

### Services & Integrations
- What external systems will the DE interact with? (CRMs, email providers,
  databases, APIs, SaaS tools)
- For each service: is it read-only, write-only, or both?
- Are there any internal services or shared infrastructure it depends on?

### Core Workflows
- Describe the main workflow(s) step by step, even roughly.
- Are there multiple workflows or just one?
- What data flows between steps?

---

## Round 2 — Details & Constraints

These questions map to **Section 2 (details)** and **Section 3 (Dependencies & Risks)**.

### Authentication & Access
- For each service identified: how will we authenticate?
  (OAuth, API key, service account, other)
- Are there any rate limits, quotas, or access restrictions to be aware of?

### Error Handling & Edge Cases
- What happens if a service is unavailable?
- Are there operations that should be retried vs. failed immediately?
- What's the fallback behavior if the DE can't complete its workflow?

### Queues & Async
- Will any part of the workflow use queues? Which parts?
- Are there long-running operations that need async handling?

### Dependencies & Risks
- What are the biggest unknowns or risks right now?
- Are there any third-party dependencies that could change or be unreliable?
- Are there compliance, security, or data privacy considerations?

### KPIs & Metrics
- How will you measure whether this DE is working well?
- What metrics matter? (throughput, accuracy, latency, error rate, etc.)
- Are there specific thresholds that define success?

---

## Round 3 — Testing & Rollout

These questions map to **Section 4 (Testing)**.

### Testing Strategy
- How do you want to test locally? (mock services, local env, etc.)
- Are there specific happy-path and unhappy-path scenarios to cover?
- What would a unit test vs. integration test look like here?

### PDA Operations
- Which operations write to or modify external systems?
  (These all need PDA wrapping.)
- Are there any borderline cases — operations that feel like reads but have
  side effects?

### Promotion Criteria
- What needs to be true before moving from passive → active beta?
- What needs to be true before moving from active beta → production?
- How long should each observation window be?

---

## Tips for the interviewer

1. **Don't overwhelm.** If Round 1 gives you enough to fill most of the
   template, compress Rounds 2 and 3 into one short follow-up.
2. **Reflect back.** After each round, summarize what you heard. Users often
   correct themselves when they see their answers written down.
3. **Suggest when you can.** If the user says "I'm not sure about auth," you
   can offer options supported by that service's docs, clearly labelled as
   proposals rather than facts about the user's setup.
4. **Mark TBD honestly.** It's fine to leave things TBD. The design doc is a
   living document. Don't invent answers to fill gaps.
5. **Use what they give you.** If the user provides a product spec, PRD, or
   Slack thread as context, extract answers from that before asking.
