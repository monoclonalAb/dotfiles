# Repository knowledge base

This directory is the versioned map of how the dotfiles system is shaped, why
its boundaries exist, and where confidence is weak. It complements the root
[`README.md`](../README.md), which remains the human setup and operations guide.
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
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | System boundaries, package map, and important flows | Current | Derived from `.stowrc`, package paths, and the named scripts/configuration |
| [`ENGINEERING_PRINCIPLES.md`](ENGINEERING_PRINCIPLES.md) | Stable design and maintenance principles | Normative | Each principle names an enforceable repository consequence |
| [`QUALITY.md`](QUALITY.md) | Evidence-based subsystem grades and technical debt | Snapshot | Each grade links to evidence and a concrete gap |
| [`plans/README.md`](plans/README.md) | Versioned execution-plan lifecycle and template | Normative | New substantial plans must follow the documented lifecycle |

`docs/.stow-local-ignore` matches every path in this directory. This is
intentional: the root workflow invokes `stow */`, but repository documentation
must not appear as files in `$HOME`.

## Reading paths

- Changing package layout or generated state: start with
  [`ARCHITECTURE.md`](ARCHITECTURE.md).
- Deciding whether a local preference deserves a rule or check: read
  [`ENGINEERING_PRINCIPLES.md`](ENGINEERING_PRINCIPLES.md).
- Choosing verification work or cleanup: read [`QUALITY.md`](QUALITY.md).
- Making a change whose context must survive one session: create an execution
  plan using [`plans/README.md`](plans/README.md).
- Installing or operating the workstation: go directly to
  [`../README.md`](../README.md).

## Maintenance rules

- Update the document that owns a fact; do not add a second explanation nearby.
- Link to source files instead of copying volatile values or implementation.
- Record observed evidence and unknowns; do not infer that a check passes.
- Delete stale guidance when behaviour changes. Git history is the changelog.
- Promote a repeated failure into the narrowest useful owner: implementation,
  test, diagnostic, documentation, skill, or mechanical guardrail.
