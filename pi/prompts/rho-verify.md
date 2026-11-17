---
description: Give this project its own way to prove a change works (a command, a safe mode and a line in its guide)
argument-hint: "[what to prove first, or notes]"
---
# rho-verify

Notes (blank means none; when `/rho` reads this file, its task is the note):
$ARGUMENTS

A project should show anyone who opens it how to prove a change: one command
that runs the real thing safely, and a line in its own guide saying what done
means. Build that into the project itself, in the places it already keeps its
commands, tests and docs. Don't add a separate skill or agent folder for it.

This file is used two ways:

- **`/rho` reads it during a task** when the project has no way to run what the
  task changed. Add only what that task needs, then go back to the task.
- **I run `/rho-verify` myself** to fill a project's gaps on purpose.

## 1. Read what the project already says

Answer these from the code, docs and scripts. Ask me only what you cannot
observe.

- **Its guide:** what `AGENTS.md`, the README or a testing doc say done means.
- **Its commands:** the Makefile, package scripts and `scripts/`, and what each
  one really runs.
- **Its real runs:** live tests, evals, run scripts, saved cases, and any
  dry-run or log-only mode.
- **Its edges:** what a user or trigger touches (a page, a CLI, a route, a
  scheduled job), and every outside system it writes to: email, customer job
  systems, CRMs, shared databases, queues, paid APIs.

If what is there already proves this change, use it and stop. Before adding
anything, check that another branch or open PR hasn't added it already.

## 2. Fit the proof to the project

Pick the lightest thing that shows the real behaviour for this kind of project.

- **Web page or UI:** build it, serve it locally, open the page in a browser,
  do what the user does and capture what they see.
- **HTTP API, webhook or scheduled job:** start a local server, call the real
  route with a real or saved case, and read the response, logs and stored
  state.
- **CLI, script or configuration:** run the real command on a real input in a
  temporary folder or home directory, and keep the output and exit code.
- **Library:** call the public function on real cases. A test file may be the
  whole proof.

## 3. Add what is missing, where the project keeps such things

- **A command.** Extend the project's one check command (`make check`,
  `pnpm verify`) or add a run script beside the existing ones, named the way
  they are. It prints what it did and what resulted (rows written, emails that
  would have gone out, writes blocked), so its output is the evidence.
- **A saved case.** Beside the existing fixtures or test data, following the
  project's rules for customer data.
- **A safe mode.** In the code where the write leaves (the client that sends
  the email or calls the other system), using the setting the project already
  has if there is one.
- **A line in the guide.** Where the project says what done means: the command,
  when to run it, and what in its output proves the change. If the guide has no
  such place, add a short "Done means" section to it. Say it once; don't write
  a second doc.

If two runs can't happen at once (a fixed port, one data folder), the command
refuses to drive an instance it didn't start.

## 4. Make external writes safe

A proof run must not change anything outside this machine. Block every external
write at the service boundary, then prove the block: attempt one write in a run
and show it was refused or captured. Don't trust a mode's name; observe what it
skips. Do this before driving anything that can write. A project that writes to
nothing outside this machine skips this step.

If you can't block a write and prove it, don't drive that path. Prove the change
below the write instead (the function that builds the email, a saved case) and
say what stayed unproved.

Ask me before a proof run reads live customer data, unless the project's guide
already allows it. When I'm away, don't ask: use saved cases. Saved cases need
no permission.

## 5. Prove it

Run the command end to end on a real or saved case, then again straight away:
the second run must pass with no cleanup by hand. Say how long it takes; if it
is more than a few minutes, find what is slow, because a slow check gets
skipped. Then follow the guide line as a newcomer would. If you needed anything
it doesn't say, fix the line.

## 6. Ship it

From a `/rho` task: commit this on its own, before the change it proves, in the
same PR, then carry on with the task.

Run on its own: finish with `/rho` steps 6 to 8 and its merge rule
(`~/.pi/agent/prompts/rho.md`): second opinion, PR, report.

Afterwards, whenever a task finds the command or the guide line wrong or out of
date, fix it in the same PR as the task.
