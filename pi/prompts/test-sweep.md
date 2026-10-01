---
description: Run a test-value and production-simplification sweep
argument-hint: "[scope]"
---
# Test-value and production-simplification sweep

Perform the sweep below in the current repository.

Scope: ${ARGUMENTS:-the repository; if a repository-wide sweep is too large, complete one coherent, high-confidence area and identify what remains}

## Goal

Improve behavioral confidence per unit of maintenance cost. This is not a
test-deletion quota. Every retained test should protect meaningful behavior, a
regression, a contract, or a boundary. Tests that merely restate implementation
can make refactoring harder and force production-only seams to remain.

## Method

1. Read the repository instructions and relevant architecture or operating-model
   documents before changing anything. If `go-operating-model.md` or
   `domain-first-operating-model.md` exists, read it in context.
2. Inspect the scoped production code and tests together. Establish the relevant
   native test/check baseline where practical, and distinguish pre-existing
   failures from your changes.
3. For each deletion or consolidation candidate, identify the behavior it claims
   to protect and the other evidence, if any, that protects that behavior.
   High-confidence candidates include:
   - assertions that transcribe source structure, constants, call order, or
     private implementation rather than observable behavior;
   - duplicate cases already covered by a stronger test at the same or a more
     useful boundary;
   - trivial tests with no plausible regression-catching value;
   - brittle mock-heavy tests that churn during behavior-preserving refactors;
   - tests whose only purpose is to exercise a test-only export, wrapper,
     interface, factory, injection point, or adapter.
4. Do not classify a test as low-value merely because it is small, isolated, or
   uses mocks. Preserve tests that carry distinct evidence for public contracts,
   regressions, security, data integrity, compatibility, concurrency, error
   handling, or important boundary behavior. When uncertain, keep the test and
   explain the uncertainty.
5. Remove or consolidate only evidence-backed candidates. Work in coherent
   batches and run the focused checks after each batch.
6. After each batch, trace production seams that may now be unnecessary.
   Simplify them only when tests were their sole reason to exist. Do not collapse
   a seam that expresses a real domain, ownership, side-effect, portability, or
   compatibility boundary. Remove dead code and needless indirection exposed by
   the simplification.
7. Verify retained behavior at the nearest useful public boundary, then run the
   repository’s native tests, static checks, and formatting relevant to the
   changed area. A smaller passing suite alone is not proof that behavior remains
   protected.
8. If the work reveals durable, project-specific guidance, update the existing
   operating-model document that owns it—especially `go-operating-model.md`,
   informed by `domain-first-operating-model.md`. Do not create absent documents
   merely because this prompt names them, duplicate existing guidance, or record
   a transient changelog.

Respect the current worktree. Do not overwrite, revert, or reformat unrelated
user changes. Actually complete a high-confidence batch rather than stopping at
an inventory, unless the evidence is insufficient or the scope requires a user
decision.

## Final report

Briefly report:
- tests removed or consolidated and the evidence that made each low-value;
- production seams simplified as a consequence;
- important behavioral coverage retained;
- documentation updated, if warranted;
- checks run and their results;
- remaining candidates, uncertainties, or risks.
