---
name: visual-verify
description: Verify web UI changes against the actual rendered surface.
---

# Visual verification

Use an exposed browser tool or the project's existing browser-test harness.
For OMP's browser API, call `tab.observe()` before acting; do not assume that API
exists in another harness. Verify the changed flow in its relevant viewport and
state, and capture a screenshot after that state is visible. If no rendered-surface
check is available, report the gap rather than claiming visual verification.
Avoid production writes while driving forms; use fixtures or an approved sandbox.

For durable regressions, add Playwright `expect(page).toHaveScreenshot()` baselines. Add `@axe-core/playwright` assertions for WCAG expectations and run `npx @lhci/cli autorun` when the project has performance budgets.

Propose the `chrome-devtools` MCP only when necessary network, console, or
performance evidence is unavailable through existing tools. Enabling it or adding
a test dependency needs to be within scope; neither is a routine verification step.
Report the exercised flow, viewport/state, observed result, and evidence location.
