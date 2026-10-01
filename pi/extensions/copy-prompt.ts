import { copyToClipboard, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function copyPrompt(pi: ExtensionAPI) {
  pi.registerShortcut("alt+shift+c", {
    description: "Copy the current prompt to the clipboard",
    handler: async (ctx) => {
      const prompt = ctx.ui.getEditorText();

      if (!prompt) {
        ctx.ui.notify("Prompt is empty", "warning");
        return;
      }

      try {
        await copyToClipboard(prompt);
        ctx.ui.notify("Prompt copied to clipboard", "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not copy prompt: ${message}`, "error");
      }
    },
  });
}
