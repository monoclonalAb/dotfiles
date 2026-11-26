import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Reviewed against https://developers.openai.com/codex/speed/ (2026-11-26).
// Spark is a separate model, not a supported fast-mode target.
const SUPPORTED_MODELS = new Set([
  "gpt-5.6",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6.2-astra",
  "gpt-6.2-sol",
]);

export function supportsCodexFast(model: ExtensionContext["model"]): boolean {
  return model?.provider === "openai-codex"
    && model.api === "openai-codex-responses"
    && SUPPORTED_MODELS.has(model.id);
}

export default function codexFastExtension(pi: ExtensionAPI): void {
  // On by default; it only ever applies while a supported Codex model is selected.
  let enabled = true;

  // compact-ui shows this status beside the model; without it, Pi lists it with the others.
  const updateStatus = (ctx: ExtensionContext) => {
    if (ctx.hasUI) {
      ctx.ui.setStatus("codex-fast", enabled && supportsCodexFast(ctx.model) ? "fast" : undefined);
    }
  };

  pi.registerCommand("fast", {
    description: "Toggle Codex fast mode (priority tier; more ChatGPT credits)",
    getArgumentCompletions: (prefix) => {
      const items = ["on", "off", "status"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    handler: async (argument, ctx) => {
      const action = argument.trim().toLowerCase() || "toggle";
      if (!["toggle", "on", "off", "status"].includes(action)) {
        ctx.ui.notify("Usage: /fast [on|off|status]", "error");
        return;
      }
      if (!supportsCodexFast(ctx.model)) {
        ctx.ui.notify("/fast only supports Codex GPT-5.6, GPT-6, GPT-6.1 and GPT-6.2 models; current model is unchanged", "warning");
        return;
      }
      if (action !== "status") {
        if (!ctx.isIdle()) {
          ctx.ui.notify("Wait for the current response to finish before changing fast mode", "warning");
          return;
        }
        enabled = action === "toggle" ? !enabled : action === "on";
      }
      updateStatus(ctx);
      ctx.ui.notify(
        enabled
          ? "Codex fast ON: requesting priority tier; uses more ChatGPT credits. Server availability and billing still apply."
          : "Codex fast OFF: using Pi's normal request tier",
        enabled ? "warning" : "info",
      );
    },
  });

  pi.on("before_provider_request", (event, ctx) => {
    if (!enabled || !supportsCodexFast(ctx.model)) return;
    const payload = event.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    if (!("model" in payload) || payload.model !== ctx.model?.id) return;

    // Codex ServiceTier::Fast maps to "priority", not "fast", on the wire.
    // Copy only the outer object: instructions, input, tools and reasoning stay intact.
    return { ...payload, service_tier: "priority" };
  });

  pi.on("session_start", (_event, ctx) => {
    enabled = true;
    updateStatus(ctx);
  });

  // `/fast off` survives a detour through Claude; the status follows whether the model supports it.
  pi.on("model_select", (_event, ctx) => {
    updateStatus(ctx);
  });
}
