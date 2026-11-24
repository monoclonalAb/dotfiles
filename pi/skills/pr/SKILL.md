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

Follow the repository's PR template and any PR rule in its `AGENTS.md`.
Otherwise write a short, scannable note sized to the change — roughly
**800–1,500 characters** for a normal PR, and shorter for small fixes. Do not
copy the length of long past PRs.

- **Small PR (under ~100 changed lines):** one or two short paragraphs, no
  headings — what changed and why, what stays unchanged if that matters, and
  how it was checked (plus anything left unchecked).
- **Medium or large PR:** use only the sections that earn their space:
  1. **Opener (2–3 sentences, no heading):** what was broken or missing, what
     changes, and what stays untouched. If I passed rough wording or a note,
     lead with my phrasing.
  2. **One concrete example or before/after** (only when behaviour isn't
     obvious): 3–5 lines, a small table for prompt/AI/perf changes, or a
     Before/After image table for UI changes.
  3. **`## Key files`** (or **`**Review order**`** by commit SHA for large
     multi-commit PRs, 500+ lines): 3–5 bullets naming which file owns what,
     instead of narrating function internals the diff already shows.
  4. **`## Checked`:** 2–4 tight bullets with real commands or production
     counts, ending with one honest sentence on what was *not* run or stays
     unverified.
  5. **`## For the reviewer` / `## After merge`** (omit if empty): trade-offs
     or design choices for the reviewer to weigh, subtle edge cases, or
     rollout steps (migrations, crons, env vars, flags).

Put long backtest tables or logs in a collapsed `<details>` block rather than
the main body. Leave out boilerplate "Not in this PR" lists, file-by-file
change recaps, and links to plans or branches. Write it like a short note from
a teammate, not a generated report.

Accurate doesn't mean complete. Leave out what a reviewer sees at a glance in
the diff. Never leave out a change in behaviour, a step needed after merge, a
verification gap, or something a reviewer could easily miss.

The title says what the PR does. Match the repository's recent PRs for title
style (plain imperative vs `feat:`/`fix:`/`docs:` prefixes, and ticket
references such as `(EAI-1234)`). If prefixes are used, pick the one that fits
most of the diff, not the first commit. For a stacked PR, say which PR it
builds on.

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
