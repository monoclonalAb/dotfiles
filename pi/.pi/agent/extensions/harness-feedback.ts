import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "harness-feedback";
const SOURCE_URL = "https://github.com/lopopolo/harness-engineering";

const HARNESS_GUIDANCE = `
# Correction-driven harness mode

This mode is active. Work normally until the user indicates that your prior response or implementation was wrong, incomplete, overcomplicated, misunderstood, or even slightly missed the mark.

On corrective feedback:

1. Fix and verify the immediate task first unless the user asks only for a retrospective. Do not make the user restate the request.
2. Treat the correction as evidence from one observed trajectory, not as a reason to add a blanket rule.
3. Consult ${SOURCE_URL} as read-only supplemental context. Begin with its AGENTS.md and follow its routing to playbooks/improve-harness.md or one relevant thesis only when target-local evidence leaves a decision unresolved. If network access is unavailable, say so rather than pretending to have consulted it.
4. Identify the earliest failed handoff and its narrowest durable owner: context, capability or tool legibility, domain ownership, authority, proof, feedback or delivery, or a still-unproven worker limitation.
5. Make the smallest authorised intervention at that owner when justified. Prefer an existing implementation, type, test, diagnostic, example, project instruction, tool, or runbook. Do not create a durable rule for a one-off preference, create near-duplicate guidance, weaken acceptance criteria, or edit harness files without authority.
6. Verify through the target's native checks and observable user journey. One corrected attempt is not proof of a general improvement.
7. Report briefly: corrected outcome, earliest gap, durable intervention or why none was warranted, and verification evidence.

Target-local instructions, contracts, current state, and user-granted authority always govern. Do not fetch the source or perform a harness retrospective on turns without corrective feedback.
`;

export default function harnessFeedback(pi: ExtensionAPI) {
  let enabled = false;

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus(STATUS_KEY, enabled ? "harness: on" : undefined);
  }

  function setEnabled(value: boolean, ctx: ExtensionContext): void {
    enabled = value;
    updateStatus(ctx);
    ctx.ui.notify(`Harness feedback mode ${enabled ? "enabled" : "disabled"}`, "info");
  }

  pi.on("session_start", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.registerCommand("harness", {
    description: "Toggle correction-driven harness-engineering guidance",
    getArgumentCompletions: (prefix: string) => {
      const matches = ["on", "off", "status"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return matches.length > 0 ? matches : null;
    },
    handler: async (args, ctx) => {
      const argument = args.trim().toLowerCase();

      if (!argument) {
        setEnabled(!enabled, ctx);
        return;
      }

      if (argument === "on") {
        setEnabled(true, ctx);
        return;
      }

      if (argument === "off") {
        setEnabled(false, ctx);
        return;
      }

      if (argument === "status") {
        ctx.ui.notify(`Harness feedback mode is ${enabled ? "enabled" : "disabled"}`, "info");
        return;
      }

      ctx.ui.notify("Usage: /harness [on|off|status]", "error");
    },
  });

  pi.on("before_agent_start", (event) => {
    if (!enabled) return undefined;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${HARNESS_GUIDANCE}`,
    };
  });
}
