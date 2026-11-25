import { existsSync } from "node:fs";
import { copyToClipboard, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

// /copy-session puts this session's file path on the clipboard, for pasting
// into another session ("read the messages in <path>"). Unlike /session it
// computes no statistics, so it is instant on long sessions. The
// modal-vim-navigation editor also sends a plain /copy here.
export default function copySession(pi: ExtensionAPI) {
  pi.registerCommand("copy-session", {
    description: "Copy this session's file path to the clipboard",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("Usage: /copy-session", "error");
        return;
      }

      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("This session is not saved to a file (ephemeral)", "warning");
        return;
      }

      try {
        await copyToClipboard(sessionFile);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Could not copy session path: ${message}`, "error");
        return;
      }

      // Pi creates the file at the first conversation message, so a
      // brand-new session's path does not exist on disk yet.
      if (existsSync(sessionFile)) {
        ctx.ui.notify(`Copied ${sessionFile}`, "info");
      } else {
        ctx.ui.notify(`Copied ${sessionFile} (not written yet; it appears after your first message)`, "warning");
      }
    },
  });
}
