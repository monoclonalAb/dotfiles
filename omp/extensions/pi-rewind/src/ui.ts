/**
 * pi-rewind — UI helpers
 *
 * Footer status and notifications.
 */

import type { ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { RewindState } from "./state.js";

const STATUS_KEY = "rewind";

/** Update footer status with checkpoint count */
export function updateStatus(state: RewindState, ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;

  if (!state.gitAvailable) {
    ctx.ui.setStatus(STATUS_KEY, undefined);
    return;
  }

  const theme = ctx.ui.theme;
  const count = state.checkpoints.size;
  const label = `${count} checkpoint${count === 1 ? "" : "s"}`;
  const text =
    theme && typeof theme.fg === "function"
      ? theme.fg("dim", "◆ ") + theme.fg("muted", label)
      : `◆ ${label}`;
  ctx.ui.setStatus(STATUS_KEY, text);
}

/** Clear status */
export function clearStatus(ctx: ExtensionContext): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(STATUS_KEY, undefined);
}
