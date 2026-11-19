# Review GitHub pull requests inside Herdr

**Status:** Active (planned; no code yet)
**Scope:** a new Herdr app mod `herdr-app/mods/pr-review/`, Mission control's pull-request rows, the `/rho audit` prompt's output, GitHub (reads; review posts only on the person's Submit), a clone cache under `~/.cache/herdr-pr-review/`.

## Objective

Review a pull request without leaving Herdr, the way Devin Review does in the
browser. Clicking a pull request (Mission control's **Needs your review**, or a
review Space from `C-a R`) opens a **Review** tab for it: the description, the
files, the whole diff (built locally, any size), GitHub's existing comment
threads at their lines, an agent's findings beside the diff, and a composer for
inline comments that submits Comment, Approve or Request changes to GitHub.
For Eric, who reviews colleagues' work pull requests (about 1,500 diff lines
each) and his own.

## Non-goals

- Merging, CI logs, editing the pull request's title or description.
- Devin's "Guide" view (related edits grouped across files) and moved-code
  detection; possible after PR 4, once findings exist.
- Syntax highlighting and side-by-side diffs in the first PRs.
- GitLab and other forges.
- Agents posting anything to GitHub. Only the person's Submit posts.

## Context and constraints

- Depends on two open drafts: [#14](https://github.com/monoclonalAb/dotfiles/pull/14)
  (Mission control's pull-request column, the click target) and
  [#13](https://github.com/monoclonalAb/dotfiles/pull/13) (review Spaces started
  with `C-a R`, which run `/rho audit <link>`).
- Existing review tools: `C-a v` / `C-a V` open tuicr on an agent's changes
  ([HERDR-APP.md](../../HERDR-APP.md)); Herdr's shipped `changes` mod draws a
  working-tree diff in a virtual list and has a text input.
- Mods cannot use HTML or a web view; they run `gh`/`git` with `exec` and draw
  native elements ([`~/.config/herdr-app/AGENTS.md`]). A new mod folder is
  inside the existing `herdr-app/` links line, but its files need
  `dotfiles-link apply`.
- Posting to someone else's pull request is an external effect: nothing posts
  without the Submit dialog, which names the pull request and the comment count.
- Clones are mutable state: keep them in `~/.cache/herdr-pr-review/`, never in
  the repository or the person's own checkouts.

## What the prototypes showed (2026-11-19)

- **tuicr already does a lot.** `tuicr pr https://github.com/monoclonalAb/dotfiles/pull/14`
  loaded the title, commits, five files and the side-by-side diff (read through
  `hc read`). Its `:submit` posts a real review with inline comments (README).
- **tuicr's gaps.** On ckc-de04#293 (+23,731 −33, 119 files) it exits with
  `HTTP 406: the diff exceeded the maximum number of lines (20000)`, because it
  asks GitHub's API for the diff. It does not show GitHub's existing threads:
  not in its README, and raywhite-ai#400's open bot thread at
  `emailVerifier.js:176` did not appear. Nothing sits beside the diff for agent
  findings.
- **A local diff has no size limit.** A blobless clone plus
  `git fetch origin pull/293/head` gave the full 24,810-line diff of #293 in
  6 s, including a private organisation repository over HTTPS.
- **Threads are readable.** GraphQL `reviewThreads` gives path, line or
  originalLine, isOutdated, isResolved and comments (#293: 15 threads; #400: 2).
- **Posting works with this login.** Token scopes include `repo`. A pending
  review with one inline comment on #14 (`docs/HERDR-APP.md`, line 252, RIGHT)
  was created, read back and deleted; #14 then had 0 reviews and 0 comments.
- **Sizes now.** The two review requests are 1,521 and 1,528 diff lines; 1 of
  21 own open pull requests is over GitHub's 20,000-line diff limit.

## Pull requests, in order

Each changes something Eric sees, so each gets a screenshot review before merge.

### PR 1: open a pull request's diff in a Review tab

- **Waits for:** #14 merged.
- **Files:** `herdr-app/mods/pr-review/{main.js,mod.json}`,
  `herdr-app/mods/mission-control/main.js` (row click), `lib/herdr-app-mods/test_pr_review.test.mjs`,
  `docs/HERDR-APP.md`, `docs/VERIFICATION.md`.
- **Change:** a mod tab (`tab.new {mod: "pr-review", props: {url}}`) with a
  header (title, repo#number, state, base ← head), a file list with +/−, and the
  unified diff in a virtual list. The diff comes from a cached blobless clone
  (`~/.cache/herdr-pr-review/<owner>/<repo>`) after fetching `pull/<n>/head` and
  the base. Mission control's row opens this tab; a small "↗" keeps the browser.
- **Eric sees:** clicking a review request opens a Herdr tab with its diff.
- **Done check:** on raywhite-ai#486 the tab's files and per-file +/− equal
  `gh pr view 486 -R everyday-artificial-intelligence/raywhite-ai --json files`;
  on ckc-de04#293 it lists all 119 files, where tuicr failed.

### PR 2: GitHub's conversation in place

- **Waits for:** PR 1.
- **Files:** `herdr-app/mods/pr-review/main.js`, its test, docs.
- **Change:** review threads drawn under their lines (resolved ones folded,
  outdated ones in an "Outdated" list with their original line), and an
  Overview above the files: the description as markdown and top-level comments.
- **Done check:** on raywhite-ai#400 the open thread shows under
  `src/utils/verifyContactInfo/emailVerifier.js:176` and the outdated one under
  Outdated (`src/services/openai/singleCompletion.js:30`), as GraphQL lists them.

### PR 3: write and submit a review

- **Waits for:** PR 2.
- **Files:** `herdr-app/mods/pr-review/main.js`, its test, docs.
- **Change:** click a diff line (shift-click for a range) to write a comment;
  reply to a thread; pending comments kept per pull request in the mod's
  localStorage until submitted. Submit dialog: Comment, Approve or Request
  changes, a summary, the target pull request and the comment count. Posts one
  review with `commit_id` set to the head the tab loaded, and warns when the
  head has moved since.
- **Done check:** on a test pull request of Eric's own, a submitted review's
  comments read back from the API at the same path, line and side as written;
  a closed tab with unsent comments still has them on reopening.

### PR 4a: `/rho audit` writes its findings as data

- **Waits for:** #13 merged. Can run beside PR 2 or 3 (different files).
- **Files:** `pi/prompts/rho.md` (its review-or-audit checklist), `docs/`.
- **Change:** the audit also writes `findings.json` (path, line, side, label
  must-fix/nit/already-there, text, draft comment) to
  `~/.cache/herdr-pr-review/<owner>/<repo>/<n>/`. Its chat report is unchanged.
- **Done check:** on one real review request, every finding in the chat report
  appears in `findings.json` with a path and line that exist in the diff.

### PR 4b: findings beside the diff

- **Waits for:** PR 3 and 4a.
- **Files:** `herdr-app/mods/pr-review/main.js`, its test, docs.
- **Change:** a findings sidebar (must-fix first), each jumping to its line;
  "Use as comment" copies the draft into the pending comments; "Ask" sends the
  quoted finding to the review Space's agent (`hc send`, only on click).
- **Done check:** the same review request's findings all show in the sidebar
  and each jump lands on its line; using one adds exactly one pending comment.

### PR 5 (optional): keys and reviewed files

- j/k, `{`/`}` between files, `c` to comment, `r` to mark a file reviewed, and
  "new since your last review" (commits after your last submitted review).

## Parallel work

PR 4a can run beside PR 2 or PR 3. Everything else edits `pr-review/main.js`
and goes in order.

## Decisions

- **Build natively, keep tuicr:** tuicr covers diff, inline comments and
  submit today, but cannot show GitHub's threads or agent findings, and fails
  over 20,000 diff lines. Until PR 3 lands, `tuicr pr <link>` in a Herdr tab is
  the stopgap. Rejected: extending tuicr upstream (not ours, slower); a web
  view (Herdr has none).
- **Tab, not dialog:** a review takes a while and should stay open beside the
  agent; dialogs cover the window and close on a layout switch.
- **Local diffs:** no 20,000-line limit, and line numbers come from the same
  commits the review is posted against.

## Verification

- Prototype runs above — passed on 2026-11-19 (by hand, throwaway, not committed).
- Per PR: `node --test lib/herdr-app-mods/*.test.mjs`, `herdr-app check`, the
  PR's done check on its real pull request, and a screenshot.

## Risks and recovery

- **Large diffs in a mod:** 24,810 rows is unmeasured in a Herdr virtual list;
  PR 1's #293 check measures it. Fallback: load one file at a time.
- **Comments on moved lines:** a push between loading and submitting can make
  GitHub reject or misplace comments; PR 3 pins `commit_id` and warns.
- **Keyboard focus:** a text field in a mod competes with Herdr's keys; PR 3
  checks typing in the composer never reaches the terminal behind.
- **Herdr updates:** the app rewrites its API files on start; `herdr-app check`
  after updates catches breakage.
- **External effects:** only Submit posts; agents never post. Recovery for a
  wrong post is deleting the review comment on GitHub.
- **Disk:** blobless clones stay small; the cache can be deleted at any time.

## Outcome

Pending.
