---
description: Run a domain-first constraint and simplification sweep
argument-hint: "[scope]"
---
# Domain-first constraint sweep

Perform a domain-first simplification sweep in the current repository.

Scope: ${ARGUMENTS:-the repository; if a repository-wide sweep is too large, complete one coherent, high-confidence domain area and identify what remains}

## Goal

Make invalid domain states difficult or impossible to construct, then remove the
checks, branches, seams, and tests that existed only because those states were
representable. Follow “parse, don’t validate”: turn less-structured boundary
input into a more precise domain representation that preserves what was learned,
rather than checking a broad value and then passing that same broad value onward.

This is not a type-complexity quota. Prefer the simplest representation that
captures a valuable, evidenced invariant.

## Operating model

1. Read the repository instructions, architecture documents, and relevant code
   and tests before changing anything. Find and read an existing
   `domain-first-operating-model.md`, especially
   `docs/agents/domain-first-operating-model.md`, if present.
2. If no domain-first operating model exists and the repository has an
   appropriate documentation location, create
   `docs/agents/domain-first-operating-model.md` or the repository-conventional
   equivalent. Seed it with durable principles from
   [“Parse, don’t validate”](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/),
   adapted to this project rather than copied verbatim:
   - parse untrusted or weakly structured values once at the boundary;
   - return a refined domain value that preserves the established facts;
   - make internal functions accept the representation they actually require;
   - keep constructors constrained when unrestricted construction would bypass
     an invariant;
   - use one canonical owner or source of truth for each invariant.
   Do not create the document when project instructions prohibit it or an
   existing document already owns this guidance.
3. Map the scoped flow from external or weakly structured input to domain
   behavior and side effects. Locate the code that owns each relevant invariant.
   Treat APIs, CLI arguments, configuration, serialized data, database rows,
   messages, and user input as boundaries; do not treat every internal function
   as a new boundary.
4. Look for evidenced representational debt, including:
   - primitive values carrying domain meaning without a canonical parser or
     constructor;
   - nullable fields or boolean combinations with invalid combinations;
   - records where fields are valid only for one mode or lifecycle state;
   - repeated validation, defensive checks, “should never happen” branches,
     partial operations, unchecked casts, or non-null assertions;
   - lists used where uniqueness, non-emptiness, ordering, or key identity is
     required;
   - duplicated or denormalized mutable state that can drift out of sync;
   - callers that validate a value but pass the original broad representation
     onward;
   - tests and production seams devoted only to manufacturing impossible states.
5. Select one coherent, high-confidence constraint at a time. State the currently
   representable invalid state, the real domain rule, the canonical owner, the
   boundary where proof can be established, and the representation that will
   carry that proof. If the rule is speculative, volatile, or not worth its
   complexity, do not encode it.
6. Refactor from the desired internal signature outward:
   - use the language’s simplest fitting mechanism—sum or product types, enums
     with associated data, newtypes/value objects, non-empty collections,
     maps/sets, smart constructors, constrained factories, schema-derived types,
     or explicit lifecycle states;
   - parse at the earliest trustworthy boundary, returning either a valid domain
     value or a useful boundary error;
   - make the valid representation the required input downstream and propagate
     it through the call graph;
   - keep raw input and escape hatches at the edges; avoid public unrestricted
     constructors that recreate the invalid state;
   - use exhaustive handling where the language supports it.
7. Follow the simplification through to its fullest justified conclusion. Once
   the representation carries the invariant, remove redundant validators,
   impossible branches, fallback values, defensive assertions, stale adapters,
   test-only seams, and duplicate state. Do not retain both old and new models
   indefinitely unless a real compatibility boundary requires a named migration
   adapter.
8. Preserve behavior and boundary error quality. Static types do not replace
   authorization, database constraints, concurrency control, protocol validation,
   or checks against changing external state. Keep runtime enforcement where the
   invariant cannot be guaranteed by in-process representation alone.
9. Test the parser or constructor at the invalid/valid boundary and meaningful
   behavior through the refined domain API. Do not add tests that merely
   transcribe type structure or prove what the compiler or schema already makes
   impossible. Run the repository’s focused and native compile, test,
   static-analysis, formatting, and generation checks relevant to the change.
10. Update the domain-first operating model with only durable, project-specific
    knowledge learned by the sweep. Record each accepted constraint concisely:
    the domain invariant, canonical representation, construction/parsing
    boundary, owning module, and enforcement or proof boundary. Link to canonical
    code instead of duplicating it. Remove obsolete guidance when the model
    changes; do not turn the document into a changelog, candidate backlog, or
    catalogue of generic type-design advice.

Respect the current worktree. Do not overwrite, revert, or reformat unrelated
user changes. Actually complete and verify a high-confidence vertical slice
rather than stopping at an inventory, unless the evidence is insufficient or the
scope requires a user decision.

## Final report

Briefly report:
- the invalid states that were previously representable;
- the refined representation and where parsing or construction now occurs;
- redundant code, branches, seams, or tests removed as a consequence;
- operating-model constraints added, changed, or deliberately not recorded;
- checks run and their results;
- remaining candidates, compatibility boundaries, uncertainties, or risks.
