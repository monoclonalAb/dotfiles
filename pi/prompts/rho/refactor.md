# Refactor checklist (rho)

For cleanup, restructuring, renaming or moving code. The structure changes; the
behaviour does not. Adapted from pstack's Refactoring playbook. If you find a
bug or a missing feature on the way, note it and ship it as its own PR after
this one.

1. Pin the current behaviour before moving anything: a test, snapshot or script
   that compares outputs on real cases, and passes now. Type checks and lint are
   not a pin. Where the area has no tests, write the pin first and commit it on
   its own.
2. Name the target shape in two or three sentences: the modules, types and calls
   that exist afterwards, and what gets deleted. The change must remove branches,
   duplication or impossible states, not add layers. If it removes nothing,
   stop and say so.
3. Delete first: dead code, wrappers with one caller, unused options and
   leftover references. Then reshape.
4. Move in small steps, keeping the pin green after each. When an API changes,
   update every caller and delete the old API in the same PR. No compatibility
   shims and no old and new paths side by side.
5. After a rename, search for the old name everywhere, including strings, docs,
   config and tests (`rg -n '<old name>'`), not only code.
6. Prove nothing changed: run the pin, and for bigger moves run the old and new
   code on the same real cases and diff the output.
7. Keep the change only if the code is easier to read afterwards. Say where it
   got easier (fewer files, branches or lines to read); otherwise revert.
8. Commit in order: the pin, the deletions, the reshape. The PR says "no
   behaviour change" and shows the pin passing before and after.
