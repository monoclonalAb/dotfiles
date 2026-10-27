# Review rules for this repository

Pi's `/review` appends this file to reviews started here. Most changes are
configuration, scripts and docs, so a real bug usually looks like one of these.
Report them as [P0] or [P1]:

- **It misroutes.** A `links` line, path or symlink deploys to the wrong place,
  or a change would delete or adopt app-owned state under `$HOME`.
- **It breaks outside a terminal.** A GUI, hotkey or launchd command relies on a
  `PATH` or environment it doesn't set itself.
- **It leaks.** Credentials, tokens, histories, caches or generated state are
  committed, or mutable state is written inside the repository.
- **It changes model context without approval.** A Pi extension adds tools or
  rewrites prompts, messages or requests without an approved exception in
  `pi/extensions/README.md`.
- **It lies.** A doc or README states behaviour the code no longer has, or gives
  a command that would fail.

Everything else is [P2] at most. Report at most three [P3] findings.

- Skip `.archive/` and the vendored themes in `alacritty/themes/catppuccin/`.
- Don't report what tests or `git diff --check` already catch.
- Back every behaviour claim with a file and line, not a guess from a name.
- Start the review with the number of findings. If there is nothing to fix, say
  so in one line.
