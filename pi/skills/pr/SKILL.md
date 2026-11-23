---
name: pr
description: Open or update a draft GitHub pull request whose description matches the real diff. Use whenever I ask to open, make, raise or update a PR (including "commit and open a PR", stacked PRs and "update the PR"), or to write, fix or simplify a PR description.
---

# Pull requests

Open a draft pull request for the current work, or update the one this branch
already has. The description must match the code: nothing the diff doesn't do,
and nothing a reviewer needs left out. Write it from the diff, not from memory
of the conversation. A branch often holds commits from earlier sessions,
merges, reverts and later fixes.

If I give the wording for the title or description, use it as given.

## 1. Branch and commits

1. Check `git status --short`, the branch and its upstream. If HEAD is
   detached, or a merge, rebase or cherry-pick is in progress, stop and tell me.
2. If I'm on the default branch, move this work onto a new, descriptively named
   branch first.
3. Pick the base: an existing PR keeps its own (`baseRefName`). Otherwise use
   the branch I name, else the branch of the open PR this work builds on (a
   stacked PR), else the default branch.
4. Commit only the changes that belong to this task, by path, in reviewable
   commits whose messages match the repository's recent ones. Leave unrelated
   changes uncommitted; don't stash them. If it's unclear which changes belong,
   ask before committing.

## 2. Audit the change

Read everything the PR will contain, against the base on the remote:

1. `git fetch origin <base>`, then `git log --oneline origin/<base>..HEAD` and
   `git diff --stat origin/<base>...HEAD`. For an existing PR, also read its
   current title and body: `gh pr view --json number,title,body,baseRefName,isDraft`.
2. Read the whole diff, `git diff origin/<base>...HEAD`, file by file when it is
   large. Skim lockfiles and generated files; read everything else.
3. Stop and ask before pushing anything that doesn't belong: caches and build
   output (`__pycache__/`, `*.pyc`, `dist/`, `.DS_Store`), credentials or `.env`
   files, large binaries, leftover debug code, or files from another task.
4. Note for yourself what the diff does: each change in behaviour, files added
   or removed, new settings or environment variables, schema or data changes,
   and steps needed after merge (a migration, a scheduled job, a setting to turn
   on). Note anything an earlier commit added and a later one reverted, so it
   isn't described.

## 3. Write the description

Follow the repository's PR template if it has one. Otherwise read the last few
PRs I wrote myself in this repository (skip ones with a "Generated with" footer)
and match their title style and their description, length included: if they're
one sentence, write one sentence. Check the repo's AGENTS.md for a PR rule too.
With no PRs to match:

- Start with one or two plain sentences: what changed and why.
- Add only what a reviewer needs to understand the change. Mention how it was
  checked only when that isn't obvious.
- Leave out "Not in this PR" sections, change lists, test lists, and links to
  docs, plans or branches.
- Write it like a short note from a teammate, not a generated report.

Accurate doesn't mean complete. Leave out what a reviewer sees at a glance in
the diff. Never leave out a change in behaviour, a step needed after merge, or
something a reviewer could easily miss.

The title says what the PR does. If the repository uses prefixes such as
`feat:`, `fix:` or `docs:`, pick the one that fits most of the diff, not the
first commit. Write ticket references, such as `(EAI-1234)`, the way recent PRs
do. For a stacked PR, say which PR it builds on.

## 4. Check the draft against the diff

Before posting, go through the draft one sentence at a time:

1. Each statement about what the code does matches a change in the diff. Fix or
   delete any that don't, including things that were planned, discussed, or
   added and later reverted.
2. Each item in your audit notes is covered, or is too small to matter.
3. Names of functions, files, settings, commands and environment variables are
   spelled as in the code.
4. Numbers and check results come from commands that ran on the current commit,
   in this session or in CI. If a check didn't run, don't say it passed: leave
   it out or say it wasn't run.
5. It describes the change, not the conversation: no "as discussed", no "now
   also", nothing about what was tried first.

When the diff has more than about 300 changed lines (not counting lockfiles and
generated files), also ask a fresh reader that hasn't seen the conversation.
Save the draft to a file and run
`pi-agent -m other -r -o <reply file> -p "<brief>"` (outside Pi, `-m claude` or
`-m gpt`, whichever you are not). The brief asks it to compare the draft with
`git diff origin/<base>...HEAD` and list each claim the diff doesn't support and
each important change the draft leaves out. Check each point yourself before
changing the draft. If `pi-agent` is missing or fails, say the fresh check
didn't run.

## 5. Open or update

- Push the branch: `git push -u origin HEAD`. Never force-push unless I ask, and
  never skip hooks with `--no-verify`.
- Write the body to a temporary file outside the repository and pass it with
  `--body-file`.
- New PR: `gh pr create --draft --base <base> --title "<title>" --body-file <file>`.
  Open it ready for review only if I say so.
- Existing PR: rewrite the body so it describes the PR as it is now, instead of
  adding an "Update" section, and change the title if it no longer fits. Keep
  ticket links and anything else that is still true. Use
  `gh pr edit <number> --title "<title>" --body-file <file>`. Leave its draft
  status alone unless I ask.
- If I ask for a review comment, such as `@codex review`, post it with
  `gh pr comment` once the PR exists.
- Read back what GitHub has, `gh pr view --json url,title,body,baseRefName,isDraft,files`,
  and check the body and file list are what you meant to publish.

## Screenshots

Only when I ask for images:

1. Commit the images on their own.
2. Embed them in the description through that commit, so they keep working after
   the files are removed:
   `![what it shows](https://github.com/<owner>/<repo>/blob/<sha>/<path>?raw=true)`.
3. Remove the images in a follow-up commit, so they are not in the final tree,
   and push.

Finish with the PR URL and, in a line or two, anything left out of the PR or
waiting on me.
