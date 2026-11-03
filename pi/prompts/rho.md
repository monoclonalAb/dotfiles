---
description: Work on a task the rho way (restate, define done, prove it, second opinion, ship a small PR)
argument-hint: "<task>"
---
# rho

Task: $ARGUMENTS

The goal is many small merged PRs, each of which proves itself. Speed comes from
not redoing work. Quality comes from evidence, not confidence.

## Every task

1. **Restate.** Say the goal in one or two plain sentences, and, if code will
   change, the smallest change you expect. Then start; don't wait for me. When
   the request could mean two things (which repo, dashboard, branch or data),
   check the evidence first, such as recent changes and open branches. Never ask
   me what a quick run or throwaway prototype could answer; run it. Ask only
   about preferences no experiment can settle.
2. **Define done** as one check that can fail, for example "the eval passes and
   the case that was wrong now gets the right answer". If I gave none, write
   your own and show it.
3. **Find the place.** Name the repo and branch. If this checkout has a handoff
   note (see Pause and pick up), read it first. Before starting new work, look
   for branches, worktrees and PRs that already touch it (`git branch -a`,
   `git worktree list`, `gh pr list`). Continue existing work instead of making
   a parallel copy.
4. **Follow the matching checklist below.** Keep a short todo list (the session's
   todo tool, or `$(git rev-parse --git-path rho)/<task-slug>.md`; create the
   directory). Work too big for one small PR becomes a series of small PRs,
   each proved before the next starts.
5. **Prove it** against the real thing: the project's verify skill
   (`.agents/skills/verify/SKILL.md`) if it has one, otherwise run the changed
   code path on a real case. Passing tests show the code agrees with the tests,
   not that the behaviour is right. Quote the decisive output. If the project has
   no verify skill and you had to improvise the proof, say so and suggest
   `/rho-verify`.
6. **Second opinion** for any code change beyond a one-line edit. Run a
   read-only reviewer from the other model family:
   `pi-agent -m other -r -o <file> -p "<brief>"`. The brief gives the goal, the
   done check and how to see the diff, and asks for bugs, each proved with a
   command or a failing case. Rerun every finding yourself and act on it only if
   your rerun shows the failure. Say which findings you rejected and why. If the
   reviewer errors, times out or returns nothing, retry once; if it fails again,
   the review is blocked, not passed: say so and don't merge.
7. **Ship**, unless the task was a question: follow
   `~/.pi/agent/prompts/pr.md` (small commits, push, PR with a short
   description). Then wait for CI and fix failures your change caused. Merge
   only when I say so or the merge rule below allows it.
8. **Report** in plain words: the goal, what changed, the evidence, the PR link,
   and anything waiting on me. Before calling anything done (merged, pushed,
   passing, sent), read its real state, such as `gh pr view --json state` or
   the command's exit code, not your memory or the tail of the output.

Before any step that takes more than a few minutes, say in one line what is
running and roughly how long it takes.

## Checklists

**Question or investigation**

1. Turn the question into one sentence that has an answer.
2. Get evidence from code, git history, logs or real data. Cite the file and
   line or the command output. For a wide search, split it across read-only
   `pi-agent -m fast` readers and keep only their summaries.
3. Answer first, then the evidence. Mark each claim as measured, inferred or a
   guess.
4. If the answer points to a fix, describe it as one PR with a done check.

**Bug or feature**

1. Bug: reproduce it first and show the failing output. Feature: name the data
   it works on and where that data lives.
2. Bug: find the cause by ruling out explanations with evidence. Ship nothing
   that only "might help".
3. When there is a real design choice (a layout, an interaction, a data shape),
   build two or three quick throwaway versions outside the source tree, compare
   what each does, and choose from that. Throw them away afterwards.
4. Make the smallest change that passes the done check. When a cheap test can
   show the bug, write it first, watch it fail, and commit it before the fix, so
   the PR shows red, then green.
5. Every test you write must fail if the behaviour breaks. Drive the code the
   way its users do, take expected values from the requirement rather than from
   running the code, and never assert on data the test built itself.
6. Run the repo's checks (types, lint, tests) and the done check.
7. UI change: look at the result in a browser and capture it. What I see is the
   check.

**AI decision change** (a prompt, rule, classifier or model)

1. Fix the dataset first. List the cases, where each expected answer comes
   from, and whether each case has its evidence (attachments, notes, emails).
   Report gaps; don't tune against broken labels.
2. Run the current version for a baseline and keep per-case results.
3. Change one thing, rerun, and compare case by case: fixed, broken, unchanged.
   Keep the change only if it fixes more than it breaks; otherwise revert it.
4. Sort every miss into missing data, a policy question for a person, or a
   model error.
5. Before running more than one full pass, state the plan: cases, models,
   repeats and rough cost. Stop after two rounds without improvement and report.
6. Keep one results file or page, updated in place, naming the dataset, prompt
   version, model, branch and scores. Never leave a second version beside it.
7. Put the before and after table in the PR.

**More checklists.** For these tasks, read the file and follow it in place of
the checklists above. The other steps of Every task still apply.

- Refactor or cleanup with behaviour unchanged: `~/.pi/agent/prompts/rho/refactor.md`
- Speed, memory, cost or another measured number: `~/.pi/agent/prompts/rho/perf.md`
- Work needing several PRs, or a plan before code: `~/.pi/agent/prompts/rho/plan.md`

## I'm away

When I say I'm away, going to bed, or "until done":

1. Don't ask me anything. The always-ask list in Rules still stops you.
2. Each round, make the smallest change the evidence supports, then run the done
   check. Commit what moved it forward; undo what didn't.
3. Keep a decision log at `$(git rev-parse --git-path rho)/<task-slug>.log`, one
   line per round: what changed and whether the done check moved.
4. Never loosen the done check to finish. At a real dead end, stop and write up
   what you tried and why it failed.

## Pause and pick up

- When I pause, or the session must end before the task is done, commit work in
  progress as a `wip:` commit on the task branch, then write a handoff note with
  the agent-handoff skill (`~/.pi/agent/skills/agent-handoff/SKILL.md`). Push
  only if the branch was already pushed.
- When a checkout has a handoff note, follow that skill's "Resuming" steps.
  Check its claims against git, start from its first remaining item, and don't
  redo work it shows as checked.

## Rules

- The smallest change that meets the done check. Delete before adding.
- Fix the first place things went wrong, not the symptom.
- Real cases beat made-up ones whenever real cases exist.
- No comments that narrate the change or repeat the code. Keep a comment only
  for a "why" the code can't show. The same goes for commit messages and PRs.
- Reversible work needs no permission. Always stop and ask before running a
  deploy yourself, pushing a release tag, sending email or messages to anyone,
  writing to a customer's system (their job system, mailbox or CRM), deleting
  data, or force-pushing.
- When I correct something you would likely repeat, end your reply with one
  line proposing the test, lint or script that would prevent it.

## Merge rule

You may merge your own PR without asking when all of these hold:

1. `rho-may-merge`, run in the repo, prints `yes`. It allows my own GitHub
   repos under `~/Desktop/projects/personal/`, worktrees included, and refuses
   other people's and organisations' repos there.
2. CI passed (`gh pr checks --watch`). Where the repo has no CI, its own checks
   and the done check passed locally after your last commit.
3. The second opinion ran, and nothing it proved is still unfixed. A blocked
   review means no merge.

Merge the way the repo's recent PRs were merged (usually
`gh pr merge --squash --delete-branch`), then confirm `gh pr view --json state`
says `MERGED`. A merge may deploy automatically, as the website's does; that is
allowed here. Everywhere else, open the PR and stop.

Typing `/rho` counts as asking you to commit, push and open a PR, and to merge
where this rule allows. It overrides repository instructions that say not to
commit, push, merge or deploy; follow all their other rules.
