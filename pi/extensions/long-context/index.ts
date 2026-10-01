import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export const SHORT_CONTEXT_WINDOW = 272_000;
export const LONG_CONTEXT_WINDOW = 1_050_000;

const SUPPORTED_PROVIDERS = new Set(["openai", "openai-codex"]);
const SUPPORTED_MODELS = new Set([
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
]);

type ActiveModel = NonNullable<ExtensionContext["model"]>;
type ContextModel = Pick<ActiveModel, "contextWindow" | "id" | "provider">;
type LongContextAction = "off" | "on" | "status";

export function supportsLongContext(model: ContextModel): boolean {
  return SUPPORTED_PROVIDERS.has(model.provider) && SUPPORTED_MODELS.has(model.id);
}

export function isLongContextEnabled(model: ContextModel): boolean {
  return model.contextWindow >= LONG_CONTEXT_WINDOW;
}

export function withContextWindow<T extends { contextWindow: number }>(
  model: T,
  contextWindow: number,
): T {
  return { ...model, contextWindow };
}

function describeModel(model: ActiveModel): string {
  return `${model.provider}/${model.id}`;
}

function describeWindow(contextWindow: number): string {
  if (contextWindow === LONG_CONTEXT_WINDOW) return "1.05M";
  if (contextWindow === SHORT_CONTEXT_WINDOW) return "272K";
  return contextWindow.toLocaleString("en-US");
}

function updateStatus(ctx: ExtensionContext, model: ActiveModel | undefined = ctx.model): void {
  ctx.ui.setStatus(
    "long-context",
    model && supportsLongContext(model) && isLongContextEnabled(model) ? "ctx:1.05M" : undefined,
  );
}

function parseAction(argument: string, model: ActiveModel): LongContextAction | undefined {
  switch (argument.trim().toLowerCase()) {
    case "":
    case "toggle":
      return isLongContextEnabled(model) ? "off" : "on";
    case "on":
    case "long":
      return "on";
    case "off":
    case "short":
      return "off";
    case "status":
      return "status";
    default:
      return undefined;
  }
}

async function handleLongContext(
  pi: ExtensionAPI,
  argument: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const model = ctx.model;
  if (!model) {
    ctx.ui.notify("No model is selected", "error");
    return;
  }

  const action = parseAction(argument, model);
  if (!action) {
    ctx.ui.notify("Usage: /long-context [on|off|status]", "error");
    return;
  }

  if (!supportsLongContext(model)) {
    ctx.ui.notify(
      `Long context is not supported by this toggle for ${describeModel(model)}`,
      "warning",
    );
    updateStatus(ctx, model);
    return;
  }

  if (action === "status") {
    ctx.ui.notify(
      `Context window for ${describeModel(model)}: ${describeWindow(model.contextWindow)} (${isLongContextEnabled(model) ? "long" : "short"})`,
      "info",
    );
    updateStatus(ctx, model);
    return;
  }

  if (!ctx.isIdle()) {
    ctx.ui.notify("Wait for the current response to finish before changing context mode", "warning");
    return;
  }

  const targetWindow = action === "on" ? LONG_CONTEXT_WINDOW : SHORT_CONTEXT_WINDOW;
  if (model.contextWindow === targetWindow) {
    ctx.ui.notify(
      `${action === "on" ? "Long" : "Short"} context is already active (${describeWindow(targetWindow)})`,
      "info",
    );
    updateStatus(ctx, model);
    return;
  }

  try {
    const changed = await pi.setModel(withContextWindow(model, targetWindow));
    if (!changed) {
      ctx.ui.notify(`Authentication is unavailable for ${describeModel(model)}`, "error");
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`Could not change the context window: ${message}`, "error");
    return;
  }

  updateStatus(ctx, withContextWindow(model, targetWindow));
  ctx.ui.notify(
    action === "on"
      ? `Long context enabled for ${describeModel(model)} (1.05M); requests above 272K may use long-context pricing`
      : `Long context disabled for ${describeModel(model)} (272K)`,
    action === "on" ? "warning" : "info",
  );
}

export default function longContextExtension(pi: ExtensionAPI): void {
  pi.registerCommand("long-context", {
    description: "Toggle GPT-5.6 / GPT-6 Astra between the 272K and 1.05M context windows",
    handler: async (argument, ctx) => {
      await handleLongContext(pi, argument, ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("model_select", (event, ctx) => {
    updateStatus(ctx, event.model);
  });
}
