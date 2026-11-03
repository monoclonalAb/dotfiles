---
description: Build this project's verify skill, so agents can prove their own changes work
argument-hint: "[what to prove first, or notes]"
---
# rho-verify

Notes (blank means none): $ARGUMENTS

Build this project's verify skill: a script plus instructions that let any agent
start the app, use it the way a user or trigger would, and save evidence that a
change works. `/rho` reads it at `.agents/skills/verify/SKILL.md`. Write it for
an agent that has never seen the project. If the skill already exists, check it
against the code and fix what has drifted instead of starting over.

## 1. Study the repo, not me

Answer these from the code, docs and scripts. Ask me only what you cannot
observe.

- **Surface.** What does a user or trigger touch: a web page, a CLI, an HTTP
  API, a webhook, a scheduled job, a library? Pick the main one and note the
  rest.
- **Start.** The repo's own dev command, ports, environment variables, seed
  data and sign-in.
- **Drive.** Existing harnesses first (Playwright specs, run scripts, curl-able
  routes, fixtures). For a backend with no screen, drive it by calling its real
  routes (webhook, cron, task endpoints) on a local server with a real or saved
  case.
- **Observe.** Screenshots, response bodies, logs, workflow summaries, exit
  codes, stored state.
- **External writes.** Every system it changes that it doesn't own: email,
  customer job systems, CRMs, shared databases, queues, paid APIs.
- **Isolation.** Can two runs happen at once (ports, data directories)? If not,
  the skill must refuse to drive an instance it didn't start.

If the app doesn't start as it is, fix that first or report exactly why.

## 2. Make external writes safe

The verify run must not change anything outside this machine. Block every
external write at the service boundary (a log-only or dry-run mode, a guard in
the client, a local fake), then prove the block: attempt one write in a run and
show it was refused or captured. Don't trust a mode's name; observe what it
skips. Ask me before the verify run reads live customer data, unless the
repo's instructions already allow it. Saved cases need no permission.

## 3. Build the lever

Put the repeated steps into one executable script with subcommands, for example
`.agents/skills/verify/verify start | health | drive <feature> | stop`, or a
package script if the repo prefers. One command beats a throwaway script per
run. Keep it small.

## 4. Write the skill

`.agents/skills/verify/SKILL.md`, with front matter (`name: verify` and a
`description` naming the app, its surface and when to use it) and these
sections, using real commands, routes and selectors from this repo:

- **Start:** the command, and how to tell the app is ready to use (not just
  that a process answers).
- **Health:** one read-only check that this instance is worth driving.
- **Drive:** how to exercise each feature, with stable handles (routes, labels,
  prompt strings), never screen coordinates.
- **Evidence:** what to save and where. Capture the action and the resulting
  state, including side effects (rows written, emails that would have gone out,
  blocked writes). Keep evidence somewhere cleanup doesn't touch.
- **Safety:** how external writes are blocked and how that was proved.
- **Stop:** stop only what this run started; keep the evidence.

## 5. Feature list

`.agents/skills/verify/features/README.md` as an index, plus one file for each
of the top three to five features or workflows. Each says what it is, how a
user or trigger reaches it, how to drive it with the script, what end state
proves it works, and its gotchas. If a check needs data the seed doesn't have,
say so in its gotchas. Never weaken a check to make it pass.

## 6. Prove the skill

Run it end to end once: start, health, drive one feature, save evidence, stop.
Then confirm the evidence still exists. Fix whatever failed and stop leftovers
after each failed attempt. A skill that was never run is a draft.

## 7. Ship it

Finish with `/rho` steps 6 to 8 and its merge rule
(`~/.pi/agent/prompts/rho.md`): second opinion, PR, report. In the report, list
which features are covered and which are still missing.

Afterwards, whenever a task finds the verify skill wrong or out of date, fix it
in the same PR as the task.
