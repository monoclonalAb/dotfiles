# Make repository guidance easier for Astra to use

**Status:** Complete
**Scope:** Root guides, `docs/`, and maintained agent documentation in `omp/` and `pi/`; review all tracked Markdown outside `.archive/`.

## Objective

Make task ownership, instruction scope, safe execution, and completion evidence
unambiguous for GPT-6 Astra and other coding agents, without inventing model APIs
or changing model selection or runtime configuration.

## Non-goals

- Change application code, deploy packages, install tools, or restart applications.
- Rewrite completed plans, vendored documentation, or unrelated work.
- Enable skills, MCP servers, or extensions merely because they are documented.

## Context and constraints

- Entry points: [`AGENTS.md`](../../../AGENTS.md) and [`docs/README.md`](../../README.md).
- Existing unrelated change: `aerospace/.config/aerospace/aerospace.toml`.
- Concurrent work appeared in the Herdr conversation-status plan and the active
  plan index after initial reconnaissance; preserve it and edit shared docs only
  with targeted replacements.
- Package sources may already be live through Stow symlinks. Documentation inside
  OMP includes loaded instructions, not just passive prose.

## Acceptance criteria

- [x] Reviewed all 37 initially tracked Markdown files outside archives, plus
  concurrent new documentation; retained historical/vendored content and templates
  with no identified gap.
- [x] Root and global agent guidance distinguish scope, tool availability,
  authority to act, and actual verification from historical claims.
- [x] Documentation routes tasks to source owners and runnable checks; observed
  contradictions are corrected without changing application code/configuration.
- [x] Local links resolve, `git diff --check` passes, and documentation-only Stow
  dry runs do not deploy the knowledge base.

## Approach

1. Review the complete documentation inventory and relevant source consumers.
2. Improve the short entry points, owning guides, and contradictory skills.
3. Resolve local links and run reviewed documentation/Stow checks.
4. Record evidence, retain verification gaps, and complete this plan.

## Progress

- [x] Read root guides, knowledge base, global OMP guidance, and Pi extension READMEs.
- [x] Finished skills, reference documents, completed plans, and source cross-checks.
- [x] Updated maintained guidance, checked frontmatter and local links, and exercised
  the documented source-only commands.
- [x] Preserved concurrent Herdr changes in the root/Pi READMEs and its completed
  plan, alongside the pre-existing AeroSpace edit.

## Decisions

- **Model-neutral contracts:** optimise for explicit evidence and scope rather
  than unsupported claims about GPT-6 Astra's features or prompting requirements.
- **Preserve history:** completed plans report past evidence, not present health;
  catalogue them as such rather than rewriting their outcomes.
- **One verification owner:** added [`VERIFICATION.md`](../../VERIFICATION.md),
  separating source-only checks from live side effects. Retired Q-004 because its
  routing/reporting completion condition is met; subsystem grades stay unchanged
  and host-dependent integration gaps remain.
- **Explicit publication:** removed lintmax's automatic commit/push default;
  publication now needs a request and stages only reviewed task files.
- **No new capability activation:** skills describe fallbacks and prerequisites;
  no models, MCP servers, extensions, or runtime configuration were changed.

## Verification

All commands ran from the dotfiles root unless noted.

- Initial `git status --short` — only the unrelated AeroSpace edit was present.
- `python3 /tmp/dotfiles-astra-doc-check.IC513E/check_links.py` — passed: ad-hoc
  validation of current Markdown relative links, heading fragments, and local HTML
  assets, excluding illustrative code fences and remote URLs. Checker/output stay
  outside Git; this does not close Q-002's automated enforcement gap.
- `ruby -ryaml` frontmatter check — passed: all 16 skill/agent documents have
  parseable YAML and non-empty name/description; skill directory names match.
- Shell/Zsh syntax commands in the verification runbook — passed for all named files.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s herdr/.config/herdr/plugins/next-agent -p 'test_*.py'` — passed: 13 tests.
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s herdr/.config/herdr/plugins/spaces-env -p 'test_*.py'` — passed: 36 tests.
- `bun test ./pi/.pi/agent/extensions/herdr-task-summary/summary.test.ts` — passed: 9 tests.
- `bun test ./pi/.pi/agent/extensions/omp-anthropic-route/*.test.ts` — passed: 11 tests; update/token calls mocked, bridge uses loopback HTTP.
- `bun test ./pi/.pi/agent/extensions/modal-vim-navigation/index.test.ts` — passed: 5 tests using this host's installed Pi editor API.
- `stow -n -v -t "$HOME" docs` and the runbook's temporary-target equivalent —
  passed: no link/unlink actions; temporary target remained empty.
- `stow -n -v -t "$HOME" omp` — passed: no pending link actions or conflicts.
- `ls -ld` on deployed Zsh parents/leaves and OMP AGENTS — confirmed real parent
  directory and managed file symlinks, supporting the corrected README boundary.
- `git diff --check` and final diff/status review — passed; unrelated changes retained.
- Live reloads, model-level behaviour evaluation, paid model calls, private
  reference/API revalidation, and tool installs — not run: outside this docs-only
  task. No claim of measured GPT-6 Astra performance or runtime discovery coverage.

## Risks and recovery

- Broad prose changes can obscure accurate specialised instructions; edit only
  identified gaps and inspect the diff by owner.
- Concurrent edits may touch shared documentation; re-read before replacing text
  and never reset, stash, or overwrite another task's work.

## Outcome

Root and cross-project guidance now give agents a scoped task contract, canonical
source routing, actual-tool fallbacks, and explicit verification/reporting. Stale
Stow/MCP descriptions, memory routing, unconditional tool assumptions, unsafe
copy/publish defaults, and template/model-specific wording were corrected. All 74
documented focused tests passed; no application code, model setting, or deployment
was changed by this task. Historical and concurrent work remain intact.
