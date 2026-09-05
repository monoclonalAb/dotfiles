# Engineering principles

**Status:** Normative. These are decision rules, not a description of every
existing file. When the repository violates one, either fix the implementation
or record the exception and its reason in an execution plan.

## 1. Keep the repository agent-legible

A future maintainer or agent must be able to discover the system from versioned
local artefacts. `AGENTS.md` is a map, not an encyclopaedia. Detailed knowledge
belongs in the linked document or beside the code that owns it.

**Consequence:** new durable concepts need one canonical owner and an entry in
the knowledge catalogue when they affect repository-wide navigation. Write
instructions as scope, observable outcome, constraints, and evidence; do not rely
on a particular model remembering a workflow or having another harness's tools.

## 2. Separate desired state from runtime state

Tracked package files express desired configuration. Credentials, histories,
caches, generated overlays, databases, and app-owned state are runtime data.
GNU Stow links the former into real parent directories so the latter can remain
local and untracked.

**Consequence:** do not solve state leakage by casually widening `.gitignore`.
First move the writer's output across the correct ownership boundary.

## 3. Make important flows observable

A command should expose enough state to diagnose whether its consumers were
reached. Silent best-effort behaviour is acceptable only when there is a status
or diagnostic path that makes failure legible.

**Consequence:** cross-application scripts need status output, actionable errors,
and a non-destructive verification path where practical.

## 4. Encode invariants at the narrowest durable owner

Documentation is useful for navigation and rationale; repeated structural rules
belong in types, parsers, scripts, tests, or linters. Enforce boundaries without
prescribing irrelevant implementation style.

**Consequence:** when the same review comment recurs, improve the owning check or
diagnostic rather than adding another broad instruction.

## 5. Verify effects, not edits

Reading a changed file proves only that text changed. Verification should cross
the same boundary as the user-visible behaviour: source to Stow target, generated
state to consumer, configuration to application, or event to plugin response.

**Consequence:** every completion report names the checks actually run and any
part of the real path that remained unobserved. Use the
[verification runbook](VERIFICATION.md) to separate source-only checks from live
reloads, installs, network calls, and other side effects. Historical test results
and successful parsers do not establish current integration health.

## 6. Prefer inspectable and recoverable mechanisms

Pinned source, small scripts, standard formats, atomic writes, dry runs, and
strict fast-forwards are easier to reason about and recover than opaque mutable
steps. Personal convenience never justifies destructive ambiguity.

**Consequence:** preserve local and concurrent work, validate identities before
side effects, and make high-impact operations previewable or reversible. A tool's
availability, a sample command, or an auto-approval wrapper is not user consent.
Ask only when an unresolved choice materially changes correctness, scope, risk,
or recovery; proceed on evidence-backed, reversible implementation choices.

## 7. Turn feedback into compounding improvement

A correction is evidence about one failed trajectory, not automatic proof of a
universal rule. Fix the immediate issue, identify the earliest failed handoff,
and add the smallest durable intervention only when recurrence is plausible.

**Consequence:** prefer improving an existing source, test, skill, or runbook to
creating near-duplicate guidance.

## 8. Garden continuously

Agents and humans both reproduce patterns already present. Small inconsistencies
therefore compound unless obsolete paths, duplicated rules, and low-value seams
are removed regularly.

**Consequence:** leave touched areas simpler, retire completed debt entries, and
update quality evidence when a check or boundary materially changes.

## Deliberate differences from the source experiment

The OpenAI article describes a specific high-throughput product experiment. This
repository adopts its knowledge, legibility, feedback, and guardrail patterns; it
does **not** adopt a prohibition on manually written code or minimal merge gates.
For machine configuration, recoverability, secret safety, and observable local
verification take precedence over raw change throughput.

Source: [Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/).
