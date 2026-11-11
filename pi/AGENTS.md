# Personal defaults for every Pi session

## Explanations

I often have to reply "I don't understand". Explain so the first answer lands:

- Answer the exact question first, in one or two plain sentences. If "this" or
  "it" could mean more than one thing, check what I mean (for example, my recent
  changes) before answering.
- Assume I haven't seen the code, logs, or docs you just read. The first time you
  use a name (a function, queue, file, setting), say in a few plain words what it
  is. Introduce as few new terms as possible.
- Explain how something works as a short numbered sequence of concrete events,
  using a realistic example ("10am: X happens. 11am: Y happens."), not abstract
  conditions.
- Order: what it is, then why it matters, then what to do. Put evidence, numbers,
  and caveats after the explanation, and only those that change the conclusion.
- Use short sentences. Avoid arrows, chained clauses, and dense tables in
  explanations; use tables only to compare options.
- Keep it short and offer more detail rather than front-loading it.
- When I say I don't understand, don't restate the same points. Start from what I
  already know and build up with simpler words and a worked example.

## Herdr

When I ask to open something "in Herdr" (a worktree, a space, a tab, an agent), open
it in the Herdr desktop app with `herdr-app` (read `herdr-app --skill` first), not
with the `herdr` CLI. The `herdr` CLI drives the separate terminal Herdr, which I
don't want things opened in.

- Worktree: `git worktree add ~/.herdr/worktrees/<repo>/<branch, slashes as
  dashes> <branch>`, then `herdr-app do space.new --name "<short name>" --folder
  <that path>`. That folder is where the app's own worktree dialog puts them, so the
  sidebar nests the space under its repository.
- Check the result with `herdr-app ls`.

## HTML artifacts

Keep every HTML page you make for me (reports, audits, explainers, mocks) in the
artifact store with the `artifact` command, not on the Desktop or in a project.
Pages from `/eli5`, and pages I call throwaway, are the exception. `artifact --help`
has the details.

1. Before making a page, run `artifact list <a few keywords>`. If an earlier page
   covers it, update that one; if one has a layout worth reusing, start from a copy
   with `--from <id>`.
2. New page: `artifact new <slug> --title "..." --summary "..." --tags a,b`. It
   prints a folder; write `index.html` (and any assets) there. Make the summary
   say what the page shows and what it is for, so a later search finds it.
3. After changing a page, run `artifact update <id>`, with a new `--summary` if
   what it shows changed.
4. Open it with `artifact open <id>` and tell me the path.
