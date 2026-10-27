---
description: Open or update a draft GitHub PR with a short, plain description
argument-hint: "[notes, e.g. \"with screenshots\"]"
---
# Open a pull request

Open a draft pull request for the current work, or update the description if
this branch already has one. Extra instructions (blank means none): $ARGUMENTS

## Branch and commits

1. Check `git status --short` and the current branch. If I'm on the default
   branch, move this work onto a new, descriptively named branch first.
2. Commit only the changes that belong to this task, in reviewable commits.
   Leave unrelated changes uncommitted. If it's unclear which changes belong,
   ask before committing.
3. Push the branch. Open the PR as a draft unless I say otherwise. Write the
   body to a temporary file and pass it with `--body-file`.

## Description

Follow the repository's PR template if it has one. Otherwise read the last few
PRs I wrote myself (skip ones with a "Generated with" footer) and match their
title style and their description, length included: if they're one sentence,
write one sentence. Check the repo's AGENTS.md for a PR rule too. With no PRs to
match:

- Start with one or two plain sentences: what changed and why.
- Add only what a reviewer needs to understand the change. Mention how it was
  checked only when that isn't obvious.
- Leave out "Not in this PR" sections, change lists, test lists, and links to
  docs, plans or branches.
- Write it like a short note from a teammate, not a generated report.

## Screenshots

Only when I ask for images:

1. Commit the images on their own.
2. Embed them in the description through that commit, so they keep working after
   the files are removed:
   `![what it shows](https://github.com/<owner>/<repo>/blob/<sha>/<path>?raw=true)`.
3. Remove the images in a follow-up commit, so they are not in the final tree,
   and push.

Finish with the PR URL.
