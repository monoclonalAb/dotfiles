import { unlink } from "node:fs/promises";
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export default function sessionControls(pi: ExtensionAPI) {
  pi.registerCommand("clear", {
    description: "Start an empty session with freshly loaded configuration",
    handler: async (args, ctx) => {
      if (args.trim()) {
        ctx.ui.notify("Usage: /clear", "error");
        return;
      }

      const result = await ctx.newSession({
        withSession: async (replacementCtx) => {
          // Session replacement creates a new runtime and re-discovers extensions,
          // skills, prompts, themes, and context files.
          replacementCtx.ui.notify("Conversation cleared; configuration reloaded", "info");
        },
      });

      if (result.cancelled) {
        ctx.ui.notify("Clear cancelled", "info");
      }
    },
  });

  pi.registerCommand("drop", {
    description: "Erase the current session and start fresh",
    handler: async (args, ctx) => {
      const argument = args.trim();
      const force = argument === "--force";
      if (argument && !force) {
        ctx.ui.notify("Usage: /drop [--force]", "error");
        return;
      }

      const oldSessionFile = ctx.sessionManager.getSessionFile();

      if (!force) {
        if (!ctx.hasUI) {
          ctx.ui.notify("Use /drop --force when no confirmation UI is available", "error");
          return;
        }

        const label = oldSessionFile ? basename(oldSessionFile) : "this ephemeral session";
        const confirmed = await ctx.ui.confirm(
          "Drop conversation?",
          `Permanently erase ${label} and start a fresh session? This cannot be undone.`,
        );
        if (!confirmed) {
          ctx.ui.notify("Drop cancelled", "info");
          return;
        }
      }

      const result = await ctx.newSession({
        withSession: async (replacementCtx) => {
          let deletionError: unknown;

          if (oldSessionFile) {
            const replacementFile = replacementCtx.sessionManager.getSessionFile();
            if (replacementFile === oldSessionFile) {
              deletionError = new Error("replacement session reused the old session file");
            } else {
              try {
                await unlink(oldSessionFile);
              } catch (error) {
                // Sessions without an assistant response may never be flushed.
                if (!isMissingFile(error)) deletionError = error;
              }
            }
          }

          if (deletionError) {
            const message = deletionError instanceof Error ? deletionError.message : String(deletionError);
            replacementCtx.ui.notify(
              `Started a fresh session, but could not erase the old one: ${message}`,
              "error",
            );
            return;
          }

          replacementCtx.ui.notify(
            oldSessionFile
              ? "Conversation dropped; configuration reloaded"
              : "Ephemeral conversation cleared; configuration reloaded",
            "info",
          );
        },
      });

      if (result.cancelled) {
        ctx.ui.notify("Drop cancelled", "info");
      }
    },
  });
}
