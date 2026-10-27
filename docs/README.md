# Repository knowledge base

This directory is the versioned map of how the dotfiles system is shaped, why
its boundaries exist, and where confidence is weak. The root
[`README.md`](../README.md) is the short entry point; the operator guides below
hold setup and day-to-day operation.
Executable configuration and tests are the final authority; when they disagree
with a document, reconcile the two in the same change.

The structure is adapted from OpenAI's
[Harness engineering](https://openai.com/index/harness-engineering/) guidance:
keep the always-loaded agent guide short, disclose detail progressively, make
plans and quality gaps visible, and promote recurring feedback into durable
repository evidence or checks.

## Catalogue

| Document | Role | Status | Verification evidence |
| --- | --- | --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | Short task router and hard boundaries | Normative | Links to this catalogue and canonical operational sources |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System boundaries, folder map, and important flows | Current | Derived from `links`, `bin/dotfiles-link`, folder paths, and the named scripts/configuration |
| [`ENGINEERING_PRINCIPLES.md`](ENGINEERING_PRINCIPLES.md) | Stable design and maintenance principles | Normative | Each principle names an enforceable repository consequence |
| [`QUALITY.md`](QUALITY.md) | Evidence-based subsystem grades and technical debt | Snapshot | Each grade links to evidence and a concrete gap |
| [`VERIFICATION.md`](VERIFICATION.md) | Focused commands, prerequisites, side effects, and reporting | Runbook | Commands point to existing tests and distinguish source-only checks from live operation |
| [`plans/README.md`](plans/README.md) | Versioned execution-plan lifecycle and template | Normative | New substantial plans must follow the documented lifecycle |
| [`SETUP.md`](SETUP.md) | Manual new-Mac steps, personal paths, optional extras, update special cases, troubleshooting | Operator guide | Steps mirror `bin/dotfiles-bootstrap`; commands change the Mac |
| [`HERDR.md`](HERDR.md) | Patched Herdr install, keys, plugins, attention states, troubleshooting | Operator guide | `herdr/config.base.toml`, `herdr/patches/`, `herdr/plugins/`, `bin/install-herdr-focus` |
| [`THEME.md`](THEME.md) | Theme hotkeys, commands, propagation and pitfalls | Operator guide | `bin/theme` and its `status` output |
| [`AGENT-TOOLS.md`](AGENT-TOOLS.md) | Pi models, extensions, prompts and MCP; OMP MCP, capabilities, skills | Operator guide | `pi/settings.json`, `pi/models.json`, `pi/mcp.json`, `omp/mcp.json`, extension READMEs |

No line in [`../links`](../links) deploys this directory, and `dotfiles-link` never
reports it as unlisted: repository documentation must not appear as files in `$HOME`.

## Scope and loading

These guides work with GPT-6 Astra or another coding model; they do not select a
model or assume model-specific APIs. The active harness determines which tools
and context files are available. Read task-relevant documents explicitly rather
than assuming a linked README was automatically loaded.

| Material | Scope and use |
| --- | --- |
| Root `AGENTS.md` and this knowledge base | Maintaining this dotfiles repository |
| [OMP `AGENTS.md`](../omp/AGENTS.md) | Deployed to `~/.omp/agent/AGENTS.md`; cross-project defaults for OMP |
| [OMP `TOOLING.md`](../omp/TOOLING.md) | Optional capabilities, prerequisites, and alternatives; not a live tool inventory |
| [Global skills](../omp/skills/) and [scoped skills](../omp/scoped-skills/) | Read the matching `SKILL.md` only for its declared task; references/templates belong to that skill, not the dotfiles setup path |
| [OMP agents](../omp/agents/) | Task-specific subagent prompts; model roles resolve from [OMP config](../omp/config.yml) |
| [Pi extension policy](../pi/extensions/README.md) | Maintainer policy, not automatically loaded model context; includes approved exceptions |
| [Review rules](../REVIEW_GUIDELINES.md) | Appended by Pi's `/review` to reviews started in this repository; what counts as a real bug here and what to skip |
| [Vim navigation](../pi/extensions/modal-vim-navigation/README.md) and [Anthropic route](../pi/extensions/omp-anthropic-route/README.md) | Extension-specific operation and constraints; follow the policy before changing source |
| [Active plans](plans/README.md#active-plan-index) | In-progress task state; revalidate against the worktree before resuming |
| [Completed plans](plans/completed/) | Historical decisions and checks, not current system health or standing permission to deploy |
| [Vendored Catppuccin README](../alacritty/themes/catppuccin/README.md) | Upstream reference; use this repository's [theme workflow](THEME.md), not its standalone install recipe |

A documentation review may inspect skills without invoking their procedures.
Private-repository references inside scoped skills resolve in the consuming
project; do not fetch customer data or run cloud actions for a docs-only audit.

## Reading paths

- Changing folder layout, links, or generated state: start with
  [`ARCHITECTURE.md`](ARCHITECTURE.md).
- Deciding whether a local preference deserves a rule or check: read
  [`ENGINEERING_PRINCIPLES.md`](ENGINEERING_PRINCIPLES.md).
- Choosing checks: use [`VERIFICATION.md`](VERIFICATION.md). Choosing verification
  improvements or cleanup: use [`QUALITY.md`](QUALITY.md).
- Making a change whose context must survive one session: create an execution
  plan using [`plans/README.md`](plans/README.md).
- Installing or operating the workstation: start at
  [`../README.md`](../README.md), then the matching operator guide above.

## Maintenance rules

- Update the document that owns a fact; do not add a second explanation nearby.
- Link to source files instead of copying volatile values or implementation.
- Record observed evidence and unknowns; do not infer that a check passes.
- Delete stale current guidance when behaviour changes. Git history is the
  changelog; leave completed-plan outcomes and vendored documentation intact.
- During a docs audit, inventory tracked Markdown with `git ls-files '*.md'`,
  inspect new docs with `git status --short`, and classify current guidance,
  templates, history, and upstream references before deciding what to edit.
- Do not add model-name-specific rules without a verified behavioural requirement.
  Prefer explicit task scope, observable acceptance criteria, and tool fallbacks.
- Promote a repeated failure into the narrowest useful owner: implementation,
  test, diagnostic, documentation, skill, or mechanical guardrail.
