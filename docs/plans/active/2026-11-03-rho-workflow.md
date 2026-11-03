# rho: many small, verified PRs a day

**Status:** Active
**Scope:** `pi/prompts/rho.md`, `pi/prompts/rho/`, `pi/prompts/rho-verify.md`, `bin/pi-agent`, `bin/rho-may-merge`,
`lib/pi-agent/`, `lib/rho/`,
`docs/AGENT-TOOLS.md`, `docs/VERIFICATION.md`; temporarily `pi/prompts/poteto.md`,
the pstack entry in `pi/settings.json` and a pstack clone outside the repository.
Later, a verify script in a first customer repository (its own branch and PR),
and a spare Mac set up as an agent runner (outside this repository).

## Objective

A personal workflow, `/rho`, that takes the habits behind Lauren Tan's
[pstack](https://github.com/cursor/plugins/tree/main/pstack) results and fits them
to this owner's work. Target: about 2,000 merged PRs a month without lowering
quality. That is roughly 65 a day, too many to review by hand, so trust has to
come from checks the agent runs: a done check, proof on real data, a second
model's review, CI, and a per-repository merge rule.

## Non-goals

- Copying pstack's 67 skills, 23 playbooks or its Pi extension.
- Auto-merging or deploying anywhere without an explicit per-repository rule.

## Context and constraints

- Design evidence: a review of the owner's last two weeks of Pi sessions and
  their GitHub PRs, kept privately at `~/.local/share/rho/findings-2026-11-03.md`
  (not in this public repository). Main findings: most sessions are questions,
  PR chores, features and AI-decision work; the most common correction is having
  to ask for commit, push or PR; the next are unclear explanations and wrong
  scope.
- This repository is public. Keep customer names, systems and data out of it,
  including from this plan.
- [`pi/extensions/README.md`](../../../pi/extensions/README.md) forbids
  extensions that add tools or instructions to every turn, so helper agents run
  through `bin/pi-agent` instead.
- `/rho` ships through [`pi/prompts/pr.md`](../../../pi/prompts/pr.md) rather
  than its own PR rules.

## Acceptance criteria

- [x] `/rho <task>` expands in Pi and a model follows it (restate, done check,
      checklist, second opinion, ship, report).
- [x] `pi-agent -m other` reviews with the other model family.
- [ ] One week of real use; corrections and merged-PR count compared with the
      private baseline.
- [x] `/rho-verify` exists to build a project's verify skill.
- [ ] The first customer repository has a verify skill (built with
      `/rho-verify`) that runs a workflow on a case with every external write
      blocked and saves the evidence.
- [x] A merge rule names where the agent may merge its own green, reviewed
      PR: `bin/rho-may-merge` (owner, 2026-11-03: the personal folder).
- [ ] Several `/rho` tasks run in parallel Herdr worktrees and overnight under
      `/goal`, with merged PRs as output.
- [ ] One overnight `/rho` task on the spare Mac ends as a merged PR, with
      every change in "Step 4 on a spare Mac" in place.

## Approach

1. `/rho` v1 from the session evidence. Done.
2. A week of real use. Each repeated correction becomes a line in `rho.md` or,
   better, a check (`/feedback`).
3. Verify script in the first customer repository.
4. Parallel and overnight runs, on a spare Mac (below). Widen the merge rule
   (for example to DE repositories) only after a clean week.
5. Remove `/poteto`, the pstack `skills` entry and the clone once `/rho` has
   replaced them.

### Step 4 on a spare Mac

Proposed (owner, 2026-11-03). A spare M4 MacBook Pro (24 GB, 1 TB) runs `/rho`
tasks overnight and in parallel, so this Mac stays free. The models run at the
providers, so the spare Mac only runs Pi, worktrees and tests. Estimate, not
measured: 5 to 8 tasks at once. The expected limit is model usage, not memory,
because each task uses a worker and a reviewer from the other model family.

Start after step 2's clean week, in this order:

1. Set up the spare Mac with the checklist below.
2. Start tasks by hand from this Mac: `C-a '` switches Herdr to the spare
   Mac's screen, `C-a t` starts a task there, and `/rho` runs interactively in
   "I'm away" mode. This avoids the untested headless questions below.
3. Automatic triggers only after hand-started runs have merged cleanly: a
   launchd job on the spare Mac that checks every few minutes for issues the
   owner labelled `rho` and starts a task for each. Not a GitHub self-hosted
   runner on public repositories: GitHub warns that pull requests from forks
   can run code on it.

Setup checklist (nothing run yet).

Machine, from the admin account:

- [ ] FileVault and the firewall on.
- [ ] No sleep on the charger: `sudo pmset -c sleep 0 disksleep 0`, lid open
      (a closed MacBook sleeps without an external display). After an
      unplanned restart, FileVault waits for the password and nothing runs,
      SSH included; for planned restarts use `sudo fdesetup authrestart`.
- [ ] Tailscale (in the Brewfile) and Remote Login for the agent user only,
      SSH key only.
- [ ] Homebrew and the Brewfile, installed from this account because Homebrew
      is shared and the agent user is not an admin.

Agent user (standard, not admin):

- [ ] Create the user.
- [ ] Clone the dotfiles and run `dotfiles-bootstrap` as that user for Node,
      Pi, the links and the patched Herdr. Untested as a non-admin user; its
      Homebrew step should find the packages already installed.
- [ ] **Trimmed agent configuration (needs a design).** `pi/mcp.json` and
      `omp/*.json` hold absolute `/Users/eric/...` paths and the owner's
      personal MCP servers, and every user gets the same linked files. The
      agent user needs its own trimmed copies without editing the shared ones.
- [ ] Sign-ins in this user only: Pi's Claude and GPT logins, and
      `gh auth login` as the GitHub machine account.
- [ ] A `~/.gitconfig` with the machine account's name and email. Git reads it
      after the linked `git/config`, which sets the owner's name, so the
      agent's commits are not attributed to the owner.
- [ ] Chosen repositories cloned into `~/Desktop/projects/personal/` (see
      "Merge folder" below).
- [ ] Project tools only when a project needs them, such as a local Postgres.

Running and watching:

- [ ] `herdr machine add agent@<spare-mac> --label spare` on this Mac; check
      that `C-a '` reaches it and that its Herdr server keeps running after
      the SSH connection closes.
- [ ] A weekly launchd cleanup that removes merged worktrees and branches and
      warns when the disk is low. Like every launchd job here, it sets its own
      minimal `PATH`.
- [ ] Update with `dotfiles-update` as the agent user after `/rho` changes,
      never while tasks are running.

Changes needed before the first unattended run:

- [ ] **Merge folder.** `rho-may-merge` allows only main checkouts under
      `$HOME/Desktop/projects/personal`. Clone into the same layout on the
      spare Mac, or make the folder a setting. A runner's work folder would
      always get `no`: safe, but nothing would merge.
- [ ] **Merge limits that the agent cannot skip.** The merge rule is a script
      the agent chooses to run, so GitHub has to enforce it. Proposed: the
      spare Mac signs in as a separate GitHub machine account, added as a
      collaborator only on chosen repositories, so it cannot reach the
      organisation's. Each chosen repository gets a ruleset on its default
      branch: pull request required, CI required, bypass for the repository
      admin (the owner) only. On GitHub Free, rulesets work only on public
      repositories, and most of the owner's public ones have no CI workflow
      yet, so "CI required" needs one added first.
- [ ] **Secret scan before going public.** Before making a private repository
      public so a ruleset can protect it, scan its full Git history for
      secrets (for example with gitleaks); anything ever committed becomes
      public too.
- [ ] **Reports reach the owner.** Remote runs put their report and any stop
      reason in the PR, or on the issue that started them, not only in the
      terminal.
- [ ] **Always push.** Remote runs push their branch, `wip:` commits included,
      so paused work is not stranded on the spare Mac. `rho.md` currently
      pushes only branches that were already pushed.
- [ ] **One claim both Macs see.** "Find the place" checks local branches and
      worktrees, which each Mac sees only for itself. Mark taken tasks where
      both can see them, such as an issue assignee or label, besides
      `gh pr list`.
- [ ] **Only provable tasks.** Send the spare Mac only tasks whose done check
      can run there. It holds dev and test credentials only (for example SOPS
      with one age key per environment, where a project needs shared test
      keys). Tasks that need production data or personal credentials stay on
      this Mac.

Not tested: whether `pi -p "/rho ..."` expands the template (Pi's docs say every
mode loads the same templates), and whether `/goal`, an extension command, works
without the interactive interface.

## Progress

- [x] pstack research and a pinned clone for reference
      (`~/.local/share/pstack`, `513c0886b79a`).
- [x] `bin/pi-agent` with tests; `/poteto` as a first experiment.
- [x] Session review (private findings file above).
- [x] `pi/prompts/rho.md` written and linked.
- [x] Second round of pstack ideas (owner chose 11 of 13 plus `/rho-verify`):
      a blocked review is not a pass, rerun reviewer findings, read real state
      before reporting, tests that fail when behaviour breaks, failing test
      committed before the fix, run instead of asking, split into small PRs,
      "I'm away" mode, pause and pick up through `agent-handoff`, throwaway
      prototypes for design choices, no narrating comments. `rho.md` is 8.5 KB
      against roughly 40 KB that `/poteto` reads before starting.
- [x] Merge rule: `bin/rho-may-merge` with tests; `rho.md` merges only on its
      `yes`, green CI and no unfixed proven review finding.
- [x] Three more pstack playbooks ported as checklists `/rho` reads by path
      (owner, 2026-11-03): refactor, speed or a measured number (Perf issue
      and Hillclimb together), and multi-PR plan, in `pi/prompts/rho/`.
- [ ] Step 2 onward.

**Open questions for the owner.**

1. The first customer repository's verify script: may it read live customer
   data with every write blocked, or only saved cases?
2. Private personal repositories cannot be protected on GitHub Free. Pay for
   GitHub Pro to protect them, or keep them off the spare Mac?

## Decisions

- **Own workflow, not pstack** (owner, 2026-11-03). pstack stays as reference
  reading.
- **Name `/rho`** (owner).
- **One prompt file, not a skill or many files:** three checklists fit on one
  page. Split only if it grows.
- **Extra checklists as files `/rho` reads on match** (owner, 2026-11-03,
  after the playbook list): `rho.md` lists each in one line and the agent
  reads only the matching file in `pi/prompts/rho/`, as pstack does. Pi and
  OMP load only direct children of a prompts folder, so these are not
  commands. The three inline checklists stay, because most sessions use one
  of them. Chosen from the session review: refactor (10 sessions), speed or
  a measured number, and multi-PR plan ("wanted design on paper first").
  Not ported yet: Eval, Visual parity, Trace and Runtime forensics, Authoring
  a skill, Worktree cleanup, and the PR-stack, autopilot and orchestration
  playbooks.
- **Ship by default** at the end of every code task, because asking for
  commit, push or PR was the most frequent correction in the session review.
- **A separate checklist for AI decision changes**, because those sessions were
  the most expensive and most often redone (labels and data in doubt, versions
  confused).
- **Second opinion from the other model family** (`pi-agent -m other`), so
  review never comes from the model that wrote the change.
- **Left out from pstack** (owner): "explain the number" and "attack the
  premise", as well as model panels, the 23 playbooks (three later ported, see
  above), orchestration, PR-stack babysitting, formal verification and
  pstack's writing rules.
- **Verify skills live at `.agents/skills/verify/`** in each project: a
  harness-neutral folder Pi's `/skill` and other agents already search, and the
  path `/rho` reads.
- **Merge rule = own GitHub repositories under `~/Desktop/projects/personal/`**
  (owner chose the personal folder). The script also requires the GitHub owner
  to be the owner's account, because that folder also holds an organisation's
  repository, another person's repositories and a vendored upstream checkout;
  merging there would affect other people. Checked by main-checkout path, so
  Herdr worktrees elsewhere count as their repository.
- **`/rho` overrides repository rules against committing, pushing, merging or
  deploying by merge.** Several personal repositories say "commit only when
  asked" or "never push or deploy"; a dry run showed the agent obeying those
  over the merge rule. Typing `/rho` is the request; other repository rules
  still apply.
- **Helper agents are a script, not an extension:** `pi-agent` runs
  `pi -p --no-session --no-extensions` with only `omp-anthropic-route` loaded.
- **The spare Mac runs agents as a separate macOS user** (owner, 2026-11-03),
  so they cannot reach the owner's files, keychain or logins.
- **GitHub stays on the Free plan** where it is enough (owner, 2026-11-03).
  GitHub's docs (checked 2026-11-03) say Free protects branches only in public
  repositories; private ones wait on open question 2.

## Verification

All on 2026-11-03, from `~/dotfiles` unless noted.

- `shellcheck bin/pi-agent` passed.
- `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover -s lib/pi-agent -p 'test_*.py'`
  passed, 12 tests (fake `pi`; no model calls).
- Live `pi-agent`: Claude, GPT-6.1 Sol and a read-only GPT-6 Luna child ran in
  parallel; the read-only child had no write tool. Four read-only GPT-6.1 Sol
  helpers then classified the session review in parallel (116 s).
- `/rho` dry run in the first customer repository with GPT-6.1 Sol through the
  linked template: it restated the task, wrote a failing-capable done check,
  chose the right checklist, produced a valid `pi-agent -m other -r` command,
  and declined to merge because the merge list is empty. No tools ran.
- `shellcheck bin/rho-may-merge` passed;
  `PYTHONDONTWRITEBYTECODE=1 /usr/bin/python3 -m unittest discover -s lib/rho -p 'test_*.py'`
  passed, 7 tests. On the real folders it said yes for own repositories and a
  Herdr worktree of one, and no for the organisation's, another person's and the
  upstream repository, and for a customer repository.
- `/rho` merge dry runs with GPT-6.1 Sol: personal website, merge with
  `gh pr merge --squash --delete-branch` (before the override line it refused,
  citing the website's "never push or deploy"); customer repository, push and
  PR but no merge.
- Second-round dry runs in the personal website with GPT-6.1 Sol and Opus 5.5,
  seven scenarios each: both refused to merge after two failed reviews, rerun a
  reviewer's finding before fixing, committed the failing test before the fix,
  built throwaway variants instead of asking, logged rounds under `.git/rho/`
  without loosening the done check, paused with a `wip:` commit and an
  `agent-handoff` note, and confirmed `MERGED` with `gh pr view`.
- `/rho-verify` dry run in the first customer repository (GPT-6.1 Sol, read
  only): identified the backend surface and every external system it writes
  to, judged the existing log-only guard insufficient on its own, proposed local
  fakes with a proved block, and would ask before reading live customer data.
- Earlier `/poteto` end-to-end run found a real `pi-agent` bug (provider
  without model gave `--model anthropic/`); fixed and covered by a test.
- Extra checklists (`pi/prompts/rho/`): `bin/dotfiles-link check` listed only
  their six links, then `apply` created them under `~/.pi/agent/prompts/rho/`
  and `~/.omp/agent/prompts/rho/`. Pi's RPC `get_commands` (no extensions,
  no model request) listed the same 10 prompt commands as before, none from
  `rho/`. OMP was checked only by reading its loader (non-recursive), not run.
- Routing dry runs, read-only, with the expanded `rho.md` and no checklist
  named: GPT-6.1 Sol on a refactor task, Opus 5.5 on a speed task and GPT-6.1
  Sol on a plan task each read the matching file and quoted its first line.
  The refactor run found nothing to merge and stopped (checklist step 2); the
  speed run measured first, found the script already takes about 20 ms, and
  proposed asking rather than changing code. No files changed.
- Not run: an interactive `/rho` task with real changes (needs the owner).

## Risks and recovery

- Each Claude helper runs `omp-anthropic-route`'s preflight: a release check and
  one small probe request per process.
- `-r` removes `edit` and `write` but keeps `bash`; reviewers are told not to
  change files.
- Throughput before verification produces bad PRs faster. Keep the order in
  Approach.
- Unattended runs on the spare Mac draw on the same model usage limits as
  daytime work and can use up a day's limits overnight.
- GitHub Free includes 2,000 Actions minutes a month for private repositories;
  CI there could run out at the target volume. Public repositories and
  self-hosted runners do not use those minutes.
- Rollback: delete `pi/prompts/rho.md` and `pi/prompts/rho/`, then remove their
  links under `~/.pi/agent/prompts/` and `~/.omp/agent/prompts/`; `pi-agent`
  is independent.

## Outcome

Pending.
