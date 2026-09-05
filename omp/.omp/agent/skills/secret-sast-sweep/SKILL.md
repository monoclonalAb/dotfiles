---
name: secret-sast-sweep
description: Sweep a repository for secrets, static-analysis findings, and known dependency vulnerabilities.
---

# Secret and SAST sweep

Read repository instructions and installed tool help first; prefer existing
security targets/configuration. When applicable and installed, run from the root:

1. `gitleaks detect --no-banner --redact` (history scan; does not establish that
   uncommitted/untracked files are clean — use the installed version's working-tree
   scan as well when those files are in scope).
2. `semgrep scan --config auto` (may fetch rules and contact registry/metrics services).
3. `osv-scanner scan source -r .` (may query a remote vulnerability database).

Check repository data/network restrictions before remote scans. Do not install
tools, upload source, or change exclusions without scope and review. Report a
missing tool as blocked, not as a clean result.

Triage findings: fix in-scope issues or report them with redacted evidence and a
justified proposed exception. Do not silently suppress a finding or paste secret
values into output. Report exact commands, scan scope, outcomes, and gaps; keep
any generated reports outside the repository unless deliberately approved.
