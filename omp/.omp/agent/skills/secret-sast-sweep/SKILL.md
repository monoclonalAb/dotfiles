---
name: secret-sast-sweep
description: Sweep a repository for secrets, static-analysis findings, and known dependency vulnerabilities.
---

# Secret and SAST sweep

Run these checks from the repository root:

1. `gitleaks detect`
2. `semgrep scan --config auto`
3. `osv-scanner scan source -r .`

Triage every finding: fix it, or record a justified exception. Never paste findings verbatim into a customer-facing document.
