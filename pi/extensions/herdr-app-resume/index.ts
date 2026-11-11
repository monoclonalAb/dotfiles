// Herdr app: let the app reopen this conversation after a reboot.
//
// Terminal Herdr resumed Pi conversations when its server restored a session
// (`session.resume_agents_on_restore`). In the Herdr desktop app a reboot or
// logout loses every program; herdr-core gives each kept terminal a new shell
// in its last folder, with the same address and labels. This extension labels
// its herdr-core terminal with the session file and that shell's pid:
//
//   pi.session=/Users/me/.pi/agent/sessions/.../2026-11-04T...jsonl
//   pi.shell=45726
//
// The app's pi-resume mod (herdr-app/mods/pi-resume) types
// `pi --session <file>` into a terminal whose labels are still there but whose
// shell pid changed, i.e. one that was recovered. Quitting Pi clears both labels,
// so a conversation you ended is never reopened. Metadata only: nothing reaches
// the model, and outside the Herdr app (no HC_TERMINAL_ID) it does nothing.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const SESSION_LABEL = "pi.session";
export const SHELL_LABEL = "pi.shell";

export interface AppEnvironment {
  HC_TERMINAL_ID?: string;
  HC_BIN_PATH?: string;
}

export function registerHerdrAppResume(pi: ExtensionAPI, environment: AppEnvironment = process.env as AppEnvironment) {
  const terminal = environment.HC_TERMINAL_ID?.trim();
  if (!terminal) return;
  const hc = environment.HC_BIN_PATH?.trim() || "hc";
  let shell: string | undefined;
  let queue = Promise.resolve();

  // Serialized, best effort: a failed label never affects the conversation.
  const label = (pairs: string[]) => {
    queue = queue.then(async () => {
      try { await pi.exec(hc, ["label", terminal, ...pairs], { timeout: 2000 }); } catch { /* best effort */ }
    });
    return queue;
  };

  // The terminal's shell: a recovered terminal has a new one.
  async function shellPid() {
    if (shell) return shell;
    try {
      const result = await pi.exec(hc, ["get", terminal, "--json"], { timeout: 2000 });
      const pid = JSON.parse(result.stdout ?? "").pid;
      if (Number.isInteger(pid)) shell = String(pid);
    } catch { /* unknown: label nothing */ }
    return shell;
  }

  pi.on("session_start", async (_event, ctx) => {
    const file = ctx.sessionManager.getSessionFile();
    const pid = file ? await shellPid() : undefined;
    // An ephemeral session (--no-session) has no file to reopen.
    await label(file && pid ? [`${SESSION_LABEL}=${file}`, `${SHELL_LABEL}=${pid}`] : [`${SESSION_LABEL}=`, `${SHELL_LABEL}=`]);
  });

  // Reload, /new, /resume and fork start another session right after; only a
  // quit ends the conversation in this terminal.
  pi.on("session_shutdown", async (event) => {
    if (event.reason === "quit") await label([`${SESSION_LABEL}=`, `${SHELL_LABEL}=`]);
  });
}

export default registerHerdrAppResume;
