# Multi-PR plan checklist (rho)

For work that needs more than about three PRs, or when I ask for a plan or a
design before code. The plan is the deliverable: don't build until I say go.
One or two files with an obvious approach need no plan; say so and use the bug
or feature checklist. Adapted from pstack's Multi-phase plan playbook.

1. Settle open questions by running something: a quick throwaway prototype
   outside the source tree, or a look at the real data. Keep what each run
   showed. Ask me only about preferences no run can settle, and give options with
   your pick.
2. For a wide codebase, split the reading across read-only
   `pi-agent -m fast -r` readers that return file paths, conventions, test
   commands and entry points, not dumps.
3. Write the plan where the repo keeps plans (for example `docs/plans/`, using
   its template). Where it has none, use
   `$(git rev-parse --git-path rho)/<task-slug>-plan.md` and say it is not
   committed. The plan has:
   - what changes and for whom, in under ten lines;
   - one section per PR, in order: what it waits for, the files it touches, the
     one change, what I will see afterwards, and its done check (one check that
     can fail, run on a real case);
   - which PRs can run in parallel (different files) and which wait for another
     to merge;
   - which PRs change something I see or click, so I review a screenshot before
     merge;
   - what the prototypes proved, the options rejected and why, and the risks.
4. Each PR must be small enough to prove on its own and leave the main branch
   working.
5. Get the second opinion on the plan (rho step 6). Ask for missing steps, wrong
   order, PRs too big to prove, and done checks that cannot fail.
6. Stop and hand over: the plan path, the PR list with its order, and what is
   still unproven. On my go, run each PR through `/rho`, in parallel worktrees
   where the plan allows.
