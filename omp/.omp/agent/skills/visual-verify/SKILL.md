---
name: visual-verify
description: Verify web UI changes against the actual rendered surface.
---

# Visual verification

Drive the built-in `browser` tool first. Call `tab.observe()` before acting; take a screenshot after the relevant state is visible.

For durable regressions, add Playwright `expect(page).toHaveScreenshot()` baselines. Add `@axe-core/playwright` assertions for WCAG expectations and run `npx @lhci/cli autorun` when the project has performance budgets.

Enable the `chrome-devtools` MCP only when network, console, or performance traces are necessary. It is not the first-line browser tool.
