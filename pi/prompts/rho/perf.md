# Speed or a measured number checklist (rho)

For making something faster or smaller, or pushing one measured number toward a
target: run time, memory, cost, size, or another number a script prints. For
the accuracy of a prompt, rule, classifier or model, use rho's AI decision
checklist instead. Adapted from pstack's Perf issue and Hillclimb playbooks and
its benchmark checklist.

1. Write the claim you expect to make, with numbers: "the import takes under
   10 s on the 60k-row file". If I gave no target, propose one.
2. Build one command that measures it on a realistic case (real data size,
   production settings, release build). It prints the number, an error count and
   how much work was done (rows written, requests answered). Show that it tells a
   slow case from a fast one. After that, don't change it.
3. Baseline: run it at least 5 times and record the median and range. Check
   `uptime` first; on a busy machine, alternate old and new runs so both see the
   same noise.
4. Find what limits it before changing anything. Profile in a run you don't
   report (for example `node --cpu-prof`, `py-spy` or `sample`) and map the hot
   spot to a file and line. Removing a part that takes 10% of the time makes the
   whole at most about 11% faster.
5. Try fixes cheapest first, and stop when one meets the target: skip work whose
   result nothing uses; don't do the same work twice; do less of it; do it later;
   do it in the background; do it in parallel; make it faster.
6. One change per round. Measure with the same command (5 runs, alternating),
   run the repo's tests, and keep the change only if the number moved by more
   than the run-to-run range and the tests pass. Otherwise revert it fully. Log
   every round, kept or reverted, in
   `$(git rev-parse --git-path rho)/<task-slug>.tsv`: idea, change, before,
   after, kept.
7. Before believing a win, check that the work still happened (same error and
   work counts, correct output) and that the result is within what the disk,
   network or CPU can do. A result past those limits measured something else.
8. State the verdict as faster, slower, no measurable difference, or
   inconclusive. The PR leads with one number: before, after, run count, range
   and the limit you found. One commit per kept change.
