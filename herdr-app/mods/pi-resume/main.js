// Pi resume: reopen Pi conversations that a reboot or logout ended, as terminal
// Herdr's `session.resume_agents_on_restore` did. Lives in the status bar (0 px).
//
// The herdr-app-resume Pi extension labels each Pi terminal pi.session=<file>
// and pi.shell=<its shell's pid>, and clears them when Pi quits. A lost terminal
// comes back with the same address and labels but a new shell. Example:
//
//   1. 09:00: t7 runs Pi; labels pi.session=/…/fix-login.jsonl, pi.shell=45726.
//   2. 18:00: the Mac restarts. t7 returns as a fresh zsh, pid 51003.
//   3. 18:01: this mod sees the labels, a different pid and a shell in front, and
//      types `pi --session '/…/fix-login.jsonl'` into t7 (pi.resumed=51003).
//
// Each recovered shell is decided once: if something else is in front, or the
// file is gone, it is marked and a toast says how to resume by hand.

import { View, div } from "gpui-kit";
import { terminals, exec, hc, notify } from "herdr";

// --- Rules (pure; tested by lib/herdr-app-mods) ------------------------------

// Single-quoted for the shell.
export const quote = (text) => `'${text.replace(/'/g, "'\\''")}'`;

// What to do with each terminal: [{ address, pid, file, act: "resume" | "skip" }].
// `decided`: "address:pid" keys already acted on this run.
export function plan(list, decided = new Set()) {
  const out = [];
  for (const t of list) {
    const labels = t.labels ?? {};
    const file = labels["pi.session"];
    const pid = Number.isInteger(t.pid) ? String(t.pid) : null;
    if (!file || !pid || t.state !== "live") continue;
    // Same shell: Pi is running there, or was killed without losing the shell.
    if (!labels["pi.shell"] || labels["pi.shell"] === pid) continue;
    if (labels["pi.resumed"] === pid || decided.has(`${t.address}:${pid}`)) continue;
    const idle = t.program?.shell === true && !t.status;
    out.push({ address: t.address, pid, file, act: idle ? "resume" : "skip" });
  }
  return out;
}

// --- The mod ---------------------------------------------------------------

const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);
const name = (file) => file.split("/").pop();

export default class PiResume extends View {
  init() {
    this.decided = new Set();
    this.busy = false;
  }

  check(cx) {
    if (this.busy) return;
    const todo = plan(terminals(), this.decided);
    if (!todo.length) return;
    this.busy = true;
    for (const t of todo) this.decided.add(`${t.address}:${t.pid}`);
    cx.spawn(async () => {
      for (const t of todo) {
        let act = t.act;
        if (act === "resume") {
          try {
            const found = await exec("test", ["-f", t.file], { on: machineOf(t.address) });
            if (found.code !== 0) act = "gone";
          } catch { act = "gone"; }
        }
        if (act === "resume") {
          const sent = await hc(["send", t.address, `pi --session ${quote(t.file)}`]);
          if (sent.code !== 0) act = "skip";
          else notify({ title: "Resumed Pi", body: `${t.address}: ${name(t.file)}`, level: "info", timeout: 4000 });
        }
        if (act !== "resume") {
          notify({
            title: act === "gone" ? "Pi conversation not found" : "Pi conversation not resumed",
            body: act === "gone" ? `${t.address}: ${t.file}` : `${t.address} was busy. To resume: pi --session ${quote(t.file)}`,
            level: "warning",
          });
        }
        await hc(["label", t.address, `pi.resumed=${t.pid}`]);
      }
      this.busy = false;
    });
  }

  render(cx) {
    // Runs whenever terminals change, including when a recovered one appears.
    this.check(cx);
    return div();
  }
}
