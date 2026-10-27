---
name: system-design-template
description: >-
  Generate a system design document for a Digital Employee (DE) project.
  Use when the user asks to create, fill out, or scaffold a system design,
  architecture doc, or DE planning document. Works on both existing codebases
  (extracts details from code) and bare/new repos (interviews the user to
  gather requirements). For new projects, also emits a plan.md with
  implementation steps. Output is saved as system-design.md (and optionally
  plan.md) in the project root.
---

# System Design Template

## Asking Questions

Use a question tool only if exposed in the current session, with its actual
schema; otherwise ask in plain text. Do not assume `AskUserQuestion` or a
particular parameter shape exists. Ask only for facts not established by source
or supplied context.

---

## Step 1: Detect Project State

Read repository instructions, current worktree state, and existing design/plan
owners first. Update the canonical document rather than creating a duplicate;
the output paths below are defaults only when the repository has no convention.
Then determine whether this is an **existing project** or a **new/bare project**.

Run a quick scan:

```
- Count source files (exclude README, LICENSE, .gitignore, package.json with no deps)
- Check for service definitions, API routes, workflow files, config
- Look for existing docs/ folder or any design docs
```

**Classification rules:**

| Signal | Classification |
|---|---|
| ≥3 meaningful source files, service configs, or API routes | **Existing project** → go to Step 2A |
| Only boilerplate (README, empty src/, skeleton package.json) | **New/bare project** → go to Step 2B |
| Ambiguous | Ask the user: "This looks partially set up — should I treat this as an existing project or start fresh?" |

---

## Step 2A: Existing Project Flow

1. Read the codebase to understand services, workflows, and integrations.
2. Fill in every section of the template (see `references/template.md`).
3. Use "TBD" for unknowns rather than omitting sections.
4. Present your draft and ask the user to confirm or correct any details you're
   unsure about.
5. Save the result as `system-design.md`. If a `docs/` folder exists in the
   project root, save it there (`docs/system-design.md`); otherwise save to
   the project root.

---

## Step 2B: New/Bare Project Flow (Interview Mode)

For new projects you have nothing to extract from, so you need to **interview
the user**. The goal is to gather enough information to fill the design
template meaningfully on the first pass.

### Interview Strategy

**Do NOT ask one question at a time.** Group questions into 2–3 focused
rounds so the user isn't stuck in a 15-turn back-and-forth.

Read `references/interview-questions.md` for the full question bank organized
by template section.

For each round, present a short numbered batch through the available question
tool or in plain text. Follow the tool's exposed schema, not a remembered API.

**Round 1 — Big Picture (always ask first):**
Ask about the DE's purpose, the services/systems it will interact with, and
the core workflows. This covers template sections 1 and 2.

**Round 2 — Details & Constraints:**
Based on Round 1 answers, ask about authentication methods, error handling,
queue usage, dependencies, and risks. This covers sections 2 (details) and 3.

**Round 3 (if needed) — Testing & Rollout:**
Ask about testing strategy, PDA-wrapped operations, and promotion criteria.
Covers sections 4. Skip this round if the user has already volunteered enough
detail, or if they want to defer testing decisions.

### Between Rounds

After each round of answers:
1. Fill in what you can in the template.
2. Show the user a brief summary of what you've captured so far.
3. Call out any sections still marked TBD and whether the next round will
   cover them.

### After the Interview

1. Generate the full `system-design.md` from gathered answers.
2. Generate `plan.md` — an implementation plan (see below).
3. Save `plan.md` to the project root. Save `system-design.md` to `docs/` if
   that folder exists, otherwise to the project root.

---

## Step 3: Generate plan.md (New Projects Only)

For new/bare projects, emit a `plan.md` alongside the system design doc.
This file translates the design into actionable implementation steps.

Read `references/plan-template.md` for the plan structure.

The plan should:
- Break work into **phases** that map to deployment stages (passive → beta → production).
- Order tasks by dependency (e.g., auth setup before service integration).
- Include concrete deliverables per phase so the user knows what "done" looks like.
- Flag any open questions or decisions that need to be made before implementation.

---

## Key Concepts

### Perform Dangerous Action (PDA)

PDA is a safety wrapper (`performDangerousAction`) that gates any operation
affecting external client systems — writes, sends, updates, deletes. During
passive deployment, PDA is configured to block these operations so the DE can
run end-to-end without external writes. Active Beta may enable monitored writes;
production/non-TTY may auto-approve. Verify the installed wrapper and deployment
configuration: a phase label or wrapper call alone does not prove writes are blocked.

When filling the PDA section, list every external write or send the DE
performs. If an operation reads/fetches only (GET requests), it does **not**
need PDA. Read the consuming repository's `docs/dangerous-actions.md` if present,
its installed package, and the scoped `perform-dangerous-action` skill for details.
Generating a design or rollout plan does not authorise deployment or real writes.

### Deployment Phases

| Phase | PDA Behavior | Purpose |
|---|---|---|
| Passive | All external writes blocked | Validate workflow logic and prompt quality |
| Active Beta | External writes enabled, monitored | Validate real outputs with close oversight |
| Production | PDA auto-approves | Full autonomous operation |

---

## Output Checklist

Before finishing, verify:

- [ ] `system-design.md` saved to `docs/` (or project root if no `docs/` folder)
- [ ] Every section present (use TBD for unknowns, never omit)
- [ ] All external writes listed in PDA section
- [ ] `plan.md` saved to project root (new projects only)
- [ ] User has confirmed or been asked to confirm key assumptions
