# Review mode: Devin-style pull request review inside the Herdr app

**Status:** Active (planned; no code yet)
**Scope:** a new Herdr app layout `review` and three mods (`review-nav`, `review-page`, `review-side`) under `herdr-app/`; `herdr-app/keys.json`; a new command `bin/review-analyse` with tests under `lib/`; GitHub (reads everywhere, writes only to `monoclonalAb/review-mode-sandbox` during development); Pi agents started by `bin/review-analyse`; a cache under `~/.cache/herdr-review/`.

The step-by-step mock-ups of the window are in the HTML plan
`~/Desktop/artifacts/2026-11-25-review-mode-plan/index.html` (artifact
`2026-11-25-review-mode-plan`); this file is the source of truth for steps,
checks and rules.

## Objective

`C-a p` turns the Herdr window into a review screen for GitHub pull requests,
and `C-a p` again returns to the agents exactly as they were. Review mode does
items 1-9 of Devin Review (artifact `2026-11-21-devin-review-flow`):

1. a list of your PRs and review requests with their state;
2. an AI overview of each PR;
3. a guided tour: ordered groups of related hunks, each with an explanation and
   a reviewer concern;
4. findings ranked red/orange/grey on their lines, marked fixed or invalid;
5. a chat with a Pi agent that can read the whole repository;
6. agent fixes, committed and pushed only on the person's click;
7. draft comments, posting, and Comment / Approve / Request changes;
8. merge;
9. re-review of new commits.

## Non-goals

- Reviewing an agent's uncommitted work before it is a PR (`C-a v` and tuicr do that).
- Devin's grouping across stacked PRs, custom reviewers, security scanning.
- GitLab and other forges.
- Agents writing to GitHub. Only the person's click in a dialog does.

## Context and constraints (measured 2026-11-19 to 11-25)

- **Tour prototype:** `pi-agent -m sonnet -r`, which `bin/pi-agent` maps to
  `openai-codex/gpt-6.1-sol` (GPT-6.1 Sol, not Claude Sonnet), on amagomori/trident #231 (head
  `d7db56d`) produced an overview, 7 ordered groups with reviewer concerns and 0
  findings in 61 s; all 35 hunks in exactly one group. Devin on the same commit:
  5 groups, 0 findings. Prompt shape: hunks labelled `### H1..Hn`, JSON reply
  with `overview`, `groups[{title,hunks,explanation,reviewer_concern}]`,
  `findings[{severity,file,line,title,explanation,suggested_fix}]`.
- **Herdr mods** (`docs/HERDR-APP.md`, `~/.config/herdr-app/AGENTS.md`,
  `herdr.d.ts`): a deployed mod is one `main.js` (linked files cannot import
  helpers); copies with the same mod and props share `localStorage`; switching
  layouts restarts that layout's mods; `exec` output is capped at 8 MiB and
  defaults to a 30 s timeout; `readTextFile` reads at most 1 MiB;
  `writeTextFile` rejects stale snapshots; `herdr-app check` runs a mod's real
  `init()`, so guard side effects with `checking()`.
- **Keys:** bind per layout (`layout:eric` and `layout:review` sections of
  `keys.json`) so `C-a p` never cycles layouts. `C-a p` is unused today.
- **Chat block:** a layout block can show `{ "terminal": "<address>" }` or
  `{ "agent": "focused" }`; `layout.set` edits a personal layout. Which one can
  show a per-PR terminal is unproven (step 6).
- **Existing review Spaces (#13):** `bin/review` labels its terminal
  `review.pr=<link>`. Review mode must not use that label.
- **Credentials:** Herdr runs programs with the person's real login, and the
  person's git config lends GitHub credentials through `gh auth git-credential`.
  Agents started by Review mode get their own empty git and `gh` setup.
- **GitHub:** diffs over 20,000 lines are refused by the API (ckc-de04 #293);
  a blobless local clone built that diff (24,810 lines) in 6 s. One pending
  review per person per PR (second create refused, HTTP 422). Authors cannot
  approve their own PRs. Fine-grained tokens cannot write to repos where the
  account is only a collaborator.
- **Test fixtures:** private `monoclonalAb/review-mode-sandbox`; machine account
  `monoclonal-bot` (write access to the sandbox only; classic `repo` token in the
  macOS Keychain, service `review-mode-sandbox-bot`). Sandbox PR #1 is a smoke
  test opened by the bot with `monoclonalAb` asked to review. Read the token with
  `security find-generic-password -s review-mode-sandbox-bot -w` into a single
  command's `GH_TOKEN`; never print it, never `gh auth login` with it.

## Acceptance criteria

- [ ] Every step below merged with its done check passed on its named real case.
- [ ] A review of a real review request done end to end in Review mode: read the
      tour, check a finding, draft and post comments, submit, without opening a
      browser.
- [ ] `docs/HERDR-APP.md` documents Review mode; `docs/VERIFICATION.md` lists its checks.

## Steps, in order

One step is one PR. Milestone 1 (steps 1, 2, 3, 4, 9, 10) lets a review be read,
commented and submitted inside Herdr; milestone 2 adds the rest.

### Milestone 1

**Step 1 — Review mode on one key.** Waits for nothing.
Files: `herdr-app/layouts/review.json`, mods `review-nav`, `review-page`,
`review-side` (empty columns), `herdr-app/keys.json`, tests, docs. Also fixes
the per-PR state-file contract (path, keys: PR link + snapshot id) in docs.
Done: after each `C-a p`, `herdr-app status` names the expected layout, also
when a Review mode block has focus; back in `eric` the focused pane, sidebar
folds and right panel are as before, each checked separately;
`bin/dotfiles-link check` lists exactly the new files; the empty-home check
links them; each mod passes `herdr-app check`.

**Step 2 — Your pull requests (item 1).** Waits for step 1.
List of review requests and authored PRs, all pages (or the cap shown, and
"may be incomplete" when GitHub says so); chips: Ready to merge only on
GitHub's clean merge verdict, else CI failing, Checks running, Conflicts,
Changes requested, Review required, Draft, Unknown. j/k/Enter; header,
description, checks, reviewers, labels.
Done: matches `gh search prs --limit 1000` (review-requested and authored);
tests with recorded replies for two pages, a cap, incomplete results and every
state; "approved" alone never shows as Ready to merge.

**Step 3 — Snapshot and diff.** Waits for step 2.
`bin/review-analyse snapshot`: cached blobless clone under
`~/.cache/herdr-review/<owner>/<repo>`, fetch `pull/<n>/head`; pin head, merge
base and base branch (the snapshot id); per-file diffs read in bounded pieces;
too-large placeholder. Files view with Viewed ticks.
Done: files and per-file +/- equal `gh pr view --json files` on
raywhite-ai #486 and ckc-de04 #293 (119 files); tests on a made-up repo for a PR
over 8 MiB, one oversized file, and a push while the snapshot loads.

**Step 4 — Overview and guided tour (items 2, 3).** Waits for step 3.
`bin/review-analyse tour`: Pi agent (GPT-6.1 Sol, as in the prototype) with no tools at all (PR text can try to steer it): `bin/review-analyse` puts the labelled diff and the changed files, bounded, into its prompt; 5-minute limit, empty git
and `gh` setup, cached per snapshot; coverage validator (every hunk exactly
once) with fallback to Files; outline, Part N of M, explanation, reviewer
concern, Guide | Files.
Done: trident #231 tour covers all 35 hunks; malformed output falls back
(test); the agent is started with no tools (test on the command line it builds); a pass/fail check (output discarded) shows its environment has
no `gh` login and no git credential for github.com; tour quality without tools compared with the prototype (if it needs more context, a read tool confined to the snapshot, with a test that outside reads are refused, is a separate later change); time and cost recorded.
**Gate:** Eric reads one real tour and says whether it is right.

**Step 9 — Draft comments (item 7, part 1).** Waits for step 4.
Existing threads shown read-only; line/range comments and replies as drafts in
the PR's state file with their snapshot; nothing posts.
Done: two drafts (one a reply) survive `C-a p` twice and reopen on the right
line/thread; GitHub shows nothing new; two views editing at once keep both
edits (stale save re-applies only the pending edit).

**Step 10 — Post comments and submit (item 7, part 2).** Waits for step 9.
`bin/review-analyse submit`: operation record and hidden marker written before
creating a pending review on the confirmed commit, then submit; recovery finds
the marker, across restarts; a pending review without it stops. Head and base
re-checked just before each post. Comment now and replies post once; a lost
answer is never retried automatically. `a`/`r` only open the form.
Done (sandbox, PRs opened by `monoclonal-bot`): a range comment, a reply, and
one review of each kind read back on the right lines and thread; tests for lost
answers after create, after submit and across restart (exactly one review), an
unmarked pending review (stops), a push before posting (re-confirm).

### Milestone 2

**Step 5 — Findings (item 4).** Waits for step 4.
Findings anchored to snapshot, file, side, line and line text; marks in the
state file; stale is never "fixed".
Done: a planted bug in a sandbox PR shows at its line; Mark invalid survives
toggles and shows in a second view; after a push, an untouched finding stays
open and a changed one goes stale (tests). Overlap with Devin's posted bugs on
adm01-debug/Promo_Design_V2 #60, Oamprakash/ReferralApp #31 and
adm01-debug/Hello_V3 #61 reported as a metric.

**Step 6 — Chat display spike.** Waits for step 2.
Done: PR A, PR B, PR A: the chat block shows each PR's terminal (by address)
and the rest of Review mode keeps its place; `C-a p` works with the chat
focused. **Gate:** if neither mechanism works, Eric chooses the fallback.

**Step 7 — Chat (item 5).** Waits for steps 5 and 6.
One Pi agent per PR in the snapshot checkout, labelled `review-mode.pr=<link>`
and `review-mode.snapshot=<id>`, empty git/`gh` setup; Ask by address, label and
snapshot, never focus, fails closed; agents of merged/closed PRs ended on the
next open.
Done: Ask reaches only the matching agent across a fast switch; dead,
duplicate, old-snapshot and same-head-retarget targets send nothing (tests);
a `C-a R` review of the same PR still starts.

**Step 8 — Agent fixes (item 6).** Waits for step 7.
`bin/review-analyse publish`: commits the previewed patch and pushes it only if
the branch is still at the snapshot head; hidden without push permission.
Done (sandbox): pushed diff equals the preview byte for byte; push during the
dialog and edit after preview both make it refuse; Cancel/Discard keep
unrelated work.

**Step 11 — Merge (item 8).** Waits for step 10.
Real base shown; merge sends the confirmed head; base re-read before merging;
unsupported policies shown as such; `m` only opens the confirm.
Done (sandbox): squash merge lands with the confirmed head; push during the
dialog makes GitHub refuse; retarget during the dialog stops it (test).

**Step 12 — Re-review (item 9).** Waits for step 5.
Incremental analysis only when new commits simply add and the base is unchanged;
otherwise full. Tour rebuilt from the full diff plus the previous tour.
Done (sandbox): a fixed finding resolves, an untouched one stays; force-push
and retarget each run a full analysis; tour covers the full current diff;
**gate:** Eric confirms it still explains the main earlier change.

## Running this as a Pi goal

A goal runs a few steps at a time; merges, gates and live key checks are
Eric's. All runs work in one worktree,
`~/.herdr/worktrees/dotfiles/feat-reviewer-mode` (its own Herdr space).
Preconditions: this plan is merged to `main` (steps start from `origin/main`);
that worktree's `git status --short` is empty; the previous run's gate, if any,
is approved by Eric (step 4's tour check before run 3; step 6's fallback choice
before run 5).

**Runs:** 1: steps 1-3. 2: step 4 (ends at its gate). 3: steps 9-10. 4: steps 5,
6. 5: steps 7-8. 6: steps 11-12. Launch each in a fresh Pi session on a Claude
model, started in that worktree, naming the run, its permissions and a
deadline, e.g.:

```text
/goal --budget 2000000 Run 1 of docs/plans/active/2026-11-25-review-mode.md (steps 1-3), deadline 4 hours. You may commit, push branches named review-mode/step-N and open or update their draft PRs in monoclonalAb/dotfiles. No other external writes.
```

Rules:

1. **Finish line:** each step named by the run has a draft PR whose step checks
   passed on the PR's pushed head SHA. Record branch, base SHA, PR and tested SHA
   in that PR's description (editing it doesn't change the head) and in the
   local note `$(git rev-parse --git-common-dir)/rho/review-mode.md`. Then mark
   the goal complete, even if the step ends at a gate; the gate's approval is the
   next run's precondition. The plan's Progress boxes are ticked in a later
   step's branch once PRs merge. The project's acceptance criteria are not a
   run's finish line.
2. **Permissions:** only what the launch line grants. These rules override
   `/rho`'s merge rule, review-bot replies and handoff pushes. Allowed GitHub
   writes: draft PRs and pushes to goal branches in `monoclonalAb/dotfiles`;
   and, only when the launch line says "sandbox writes", PRs, branches, reviews
   and merges in `monoclonalAb/review-mode-sandbox` (approvals by Eric's login on
   PRs opened by `monoclonal-bot`). Never: any other GitHub write, any merge
   outside the sandbox, any force-push to GitHub (force-push and retarget tests
   use a local bare-repository fixture), messages, deploys, `dotfiles-link
   apply` on the real home, edits or relinks of existing files under `$HOME`.
3. **Branches:** steps run one at a time in that worktree, each on its own
   goal-owned branch `review-mode/step-N`; create no other worktrees. Base:
   `origin/main` (after `git fetch origin`) if the step it waits for is merged,
   else that step's open `review-mode/step-M` branch (stacked, also across runs).
   Before every branch switch, `git status --short` must be empty: commit the
   current step's own work to its branch, and stop if anything else is left,
   because a switch silently carries uncommitted files into the next branch.
   A stacked draft PR targets that dependency branch; once the dependency merges,
   the next run retargets it to `main` (`gh pr edit --base main`) before working on it.
   Never reuse, rewrite or publish another branch; preserve unrelated changes.
4. **Checks:** run the checks a step names plus the existing suites for files it
   touches (the `lib/review-analyse` suite only once it exists). Advance only on
   passing checks at the pushed SHA. Follow `/rho`: three failed fix attempts, a
   reviewer that fails twice, or review rounds capped with open findings mean
   stop.
5. **Stop (mark blocked, with a note in the local file from rule 1)** when a
   needed permission isn't granted, when starting a step would make four
   unmerged `review-mode/step-*` PRs, after two turns without progress, or at
   the deadline. Never loop on retries.
6. **Live app:** no layout switches, terminals or screenshots in the real window
   unless the launch line says "live checks allowed". Before merge, render with
   `herdr-app check` on worktree mods (side effects guarded by `checking()`) and
   test keys through `keys.json` tests; Eric checks `C-a p` live after step 1
   merges. Only start, send to or end terminals the run created (label
   `review-mode.test=1`); end them before stopping.
7. **Screenshots** stay local (`/tmp`), are never committed or uploaded, and
   show only Review mode with sandbox or public PRs.
8. **Credentials and data:** bot writes go through one helper in
   `bin/review-analyse` that reads the token from Keychain, refuses if the
   lookup fails or is empty, checks `gh api user` reports `monoclonal-bot`, and
   only then runs the write with that token; never fall back to Eric's login,
   echo the token, put it in a prompt or pass it to an agent. Eric's sandbox
   approvals use his normal login explicitly, never through that helper. Credential checks report pass/fail only. Model runs read
   only public PRs and sandbox PRs; work-repo PRs (raywhite-ai #486, ckc-de04
   #293) are used for file counts, not sent to a model, unless Eric approves.
9. **Cost and time:** the goal budget excludes cache reads and `pi-agent`
   subprocesses, so also: at most 3 review rounds per PR, tour runs of at most 5
   minutes and 5 per step, CI waits of at most 20 minutes and never past the deadline, and every reviewer or
   agent call run with a shell timeout no longer than the time left before the
   deadline (at most 30 minutes); on timeout, stop rather than retry.
10. **Reviewer route:** `pi-agent -m other` from a Claude session resolves to GPT,
    which skips the OMP update preflight that a session's first direct Claude
    request can run (`pi/extensions/omp-anthropic-route/README.md`).

## Progress

- [x] Plan, prototypes, sandbox and bot account (2026-11-19 to 11-25).
- [ ] Step 1
- [ ] Step 2
- [ ] Step 3
- [ ] Step 4 (gate: Eric reads a tour)
- [ ] Step 9
- [ ] Step 10
- [ ] Step 5
- [ ] Step 6 (gate if the spike fails)
- [ ] Step 7
- [ ] Step 8
- [ ] Step 11
- [ ] Step 12 (gate: Eric reads a refreshed tour)

## Decisions

- **Review mode on `C-a p`**, a layout of its own (not a tab or pop-up): Eric, 2026-11-25.
- **Scope = Devin Review items 1-9:** Eric, 2026-11-25.
- **Order:** milestone 1 = steps 1, 2, 3, 4, 9, 10, so a review can be read and
  submitted in Herdr first. Proposed; Eric can reorder.
- **Analysis model:** GPT-6.1 Sol (`pi-agent -m sonnet`), the prototype's model; cost measured in step 4. Proposed.
- **Analysis runs when a PR is opened**, not in the background. Proposed.
- **Sandbox and machine account** created 2026-11-25.

## Verification

- Each step: `node --test lib/herdr-app-mods/*.test.mjs`; the
  `bin/review-analyse` tests (`PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m
  unittest discover -s lib/review-analyse -p 'test_*.py'`, with fake `gh` and
  `git`); `herdr-app check` per mod; `herdr-app status` with `"errors": []`;
  the step's done check; a screenshot.
- New files: `bin/dotfiles-link check`, then the empty-home check in
  `docs/VERIFICATION.md`.

## Risks and recovery

- **Layout switch restarts mods:** step 1 checks focus, folds and panel.
- **Agents and credentials:** empty git/`gh` setup is not a sandbox; agents are
  also told never to write to GitHub; only `bin/review-analyse publish` pushes.
- **GitHub writes:** push and merge are refused server-side when stale; comments
  and reviews are re-checked just before sending (small window). A wrong
  Approve is undone by a new review or a dismissal, not by deleting comments.
- **Recovery:** each step is one PR; revert it. Delete `~/.cache/herdr-review/`
  freely. The sandbox and bot can be deleted when done.

## Outcome

Pending.
