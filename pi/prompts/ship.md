---
description: Commit this task's changes and push them straight to the current branch, without a PR
argument-hint: "[notes, e.g. a commit message hint]"
---
# Commit and push directly

I've decided this change is small enough to skip review. Commit it and push it
to the current branch, even if that's the default branch. Don't create a branch
or open a pull request. Extra instructions: ${@:-none}

1. Check `git status --short`, the current branch and its upstream. If HEAD is
   detached, or a merge, rebase or cherry-pick is in progress, stop and tell me.
2. Stage only the changes that belong to this task, by path. Leave unrelated
   changes uncommitted and untouched; don't stash them. If it's unclear which
   changes belong, ask before committing.
3. Read the staged diff. Stop and ask if it contains anything that looks like a
   secret, or if it is clearly more than a small change (suggest `/pr` instead).
4. If the change has a quick focused check that hasn't passed since the last
   edit, run it. Don't push if it fails; tell me what failed.
5. Commit with a message that matches the style of the repository's recent
   commits, including whether they have a body. Use one commit unless the
   changes are clearly separate.
6. Push to the branch's upstream, or `git push -u origin HEAD` if it has none.
   Never force-push and never skip hooks with `--no-verify`.
7. If the push is rejected because the remote has new commits, run
   `git pull --rebase` and push again. If that fails or conflicts, abort any
   rebase in progress and tell me. If the push is rejected for another reason,
   such as branch protection, stop and tell me; don't work around it.

Finish with the commit hash and title, and the branch you pushed to.
