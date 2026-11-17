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
5. **Prove it** by running the real thing the way the project itself says to:
   its guide (`AGENTS.md`, README), its commands (`make`, package scripts,
   `scripts/`) and its saved cases. If the project has no way to run what you
   changed, give it one by following `~/.pi/agent/prompts/rho-verify.md`: a
   command beside its existing ones, a safe mode in the code and a line in its
   guide, no bigger than this task needs and with no separate skill folder.
   Don't add any for a question, a docs-only change or someone else's PR: run
   the changed path on a real case by hand and say the proof was improvised. Passing tests show the code agrees with the
   tests, not that the behaviour is right. Quote the decisive output.
6. **Second opinion** for any code change beyond a one-line edit. Run a
   read-only reviewer from the other model family:
   `pi-agent -m other -r -o <file> -p "<brief>"`. The brief gives the goal, the
   done check, how to see the diff and the repo's review rules if it has any
   (`git show <base>:REVIEW_GUIDELINES.md`, from the base branch so the change
   can't rewrite the rules that judge it), and asks for bugs, each with the real
   input that would trigger it and proved with a command or a failing case.
   Rerun every finding yourself and drop it if your rerun doesn't show the
   failure. A failing case shows the code breaks on that input, not that real
   input ever gets there, so answer three questions for each finding left:
   - **Can it happen?** Trace the real path from where input enters (a request,
     an email, a scheduled job) to the bug. An earlier check may stop it first.
   - **Has it happened?** Count matching cases in production logs or data over
     a stated period, such as "0 of 6,353 in 6 months". If you can't get the
     count (no logs, an expired sign-in, brand-new code), say "unchecked" and
     decide on the other two answers.
   - **What happens if it does?** Mild: a retry or a person's review catches
     it. Serious: a wrong write to another system, lost data or a security
     hole.

   Fix it if it has happened. If it can happen and would be serious but hasn't
   happened yet, make the cheapest safe fix, such as stopping for a person to
   review, not full handling. Drop the rest: it can't happen, or it hasn't
   happened and would be mild. List every dropped finding, one line each with
   its evidence, so I can overrule you. A bug that was there before this change
   is not this PR's job: note it and offer it as its own PR.

   A fix beyond a one-line edit gets another round; a round is one review of
   one commit. Give the reviewer the earlier findings and what you did about
   each, and have it read only the diff since the commit it last saw. Stop when
   a round leaves nothing to fix. After three rounds stop anyway: report what
   is still open and which fixes no round has read, and leave the merge to me.
   Use one reviewer a round. Don't add a second on the same commit unless I ask;
   when a reviewer misses something, improve its brief or the repo's review
   rules instead. If the reviewer errors, times out or returns nothing, retry
   once; if it fails again, the review is blocked, not passed: say so and
   don't merge.
7. **Ship**, unless the task was a question: follow
   `~/.pi/agent/prompts/pr.md` (small commits, push, PR with a short
   description). Then wait for CI and fix failures your change caused. Merge
   only when I say so or the merge rule below allows it.
8. **Report** in plain words: the goal, what changed, the evidence, the PR link,
   and anything waiting on me, each as one question with the options and your
   pick. Before calling anything done (merged, pushed, passing, sent), read its
   real state, such as `gh pr view --json state` or the command's exit code, not
   your memory or the tail of the output. If code changed, add one
   tab-separated line to `~/.local/share/rho/ledger.tsv` (create it): date,
   repo, PR or branch, how it was proved (`project` for the project's own
   command, `by-hand`, `tests-only` or `none`), the reviewer and the commit it read (or `blocked`
   or `none`), and the number of review rounds. `none` is an honest entry;
   leaving the line out is not.

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
   it works on and where that data lives. Port or rewrite of something that
   already runs: the old system is the answer key. Run old and new on the same
   real inputs and list the differences you intend before building them; any
   other difference is a bug.
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
   running the code, and never assert on data the test built itself. For a rule
   that must hold for every input (encode then decode returns the original,
   twice equals once, a total never goes negative), check it on every real case
   you can reach, or on generated inputs where the repo has a generator such as
   fast-check or Hypothesis, not on three hand-picked ones.
6. Run the repo's checks (types, lint, tests) and the done check.
7. UI change: look at the result in a browser and capture it. What I see is the
   check.

**Review or audit of a PR** (mine or someone else's)

1. Pin it: the PR's goal from its description and ticket, its base, and its
   head commit. Read it in a throwaway worktree under `/tmp`.
2. Start from the earlier rounds. Read the review threads and any earlier audit
   notes, list what was raised and what was decided, and don't raise it again.
   From the second round on, read only the diff since the commit the last round
   saw.
3. Run the change on a real case (step 5) before judging it.
4. Get findings from one reviewer, with step 6's brief; a one-line PR needs
   none, so read it yourself. Threads a bot such as
   Codex already left on this commit are that round's findings; add another
   reviewer only if I ask.
5. Put each finding through step 6: rerun it, then the three questions, with
   the count on real data done before you call anything a problem. Label what
   is left **must fix** (has happened, or can happen and would be serious),
   **nit** (true but small) or **already there** (this PR didn't cause it).
6. Report the verdict first: approve, or fix these first. Then each must-fix
   finding in plain words with its real input and evidence, the nits in one
   line each, and what you dropped. Draft the comments short, the way I write them, each
   starting with its label. On someone else's PR, or in reply to a person,
   post only when I say.
7. On my own PR, fix each must-fix finding with a failing test first, as in
   the bug checklist. Reply on each of the review bot's threads, the way I
   write, with what changed or why not; that needs no permission. Ask for
   another round only if a fix changed behaviour. After three rounds, stop and
   list what is still open instead of asking for a fourth.

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
- Check before you claim. If logs, records or data you can reach could settle a
  claim, check them before stating it; until then it is a guess, not
  "inferred". Calling an answer wrong (an AI decision, a match, a label) needs
  the right answer from evidence that answer didn't see, such as the record,
  what happened later or a person's decision. Rereading the same inputs is a
  guess. If you can't check, say "unchecked".
- A repo check (test, build, lint, CI) that still fails after three attempts to
  fix it needs me: stop and show what each attempt changed. A test that fails
  only some of the time counts as failing: find the cause, and never skip it,
  add a wait or rerun it until it passes.
- Never weaken a check to get past it: no deleted or skipped tests, loosened
  expected values, or relaxed lint, CI or review rules. When the requirement
  changed and a test must change with it, name the test and the reason in the
  report.
- No comments that narrate the change or repeat the code. Keep a comment only
  for a "why" the code can't show. The same goes for commit messages and PRs.
- Reversible work needs no permission. Always stop and ask before running a
  deploy yourself, pushing a release tag, sending email or messages to anyone
  (replies on a review bot's threads on my own PR are fine),
  writing to a customer's system (their job system, mailbox or CRM), deleting
  data, or force-pushing.
- When I correct something you would likely repeat, or a bug turns up that the
  proof and the second opinion both missed, end your reply with one line
  proposing the test, lint, script or review rule that would have caught it.

## Merge rule

You may merge your own PR without asking when all of these hold:

1. `rho-may-merge`, run in the repo, prints `yes`. It allows my own GitHub
   repos under `~/Desktop/projects/personal/`, worktrees included, and refuses
   other people's and organisations' repos there.
2. CI passed (`gh pr checks --watch`). Where the repo has no CI, its own checks
   and the done check passed locally after your last commit.
3. The last review round read the code being merged, apart from one-line fixes
   for its findings, and every finding you kept is fixed. A blocked review
   means no merge.
4. The PR does not delete or skip a test, or change CI, lint or review rules.
   One that does is mine to merge.

Merge the way the repo's recent PRs were merged (usually
`gh pr merge --squash --delete-branch`), then confirm `gh pr view --json state`
says `MERGED`. A merge may deploy automatically, as the website's does; that is
allowed here. Everywhere else, open the PR and stop.

Typing `/rho` counts as asking you to commit, push and open a PR, and to merge
where this rule allows. It overrides repository instructions that say not to
commit, push, merge or deploy; follow all their other rules.
