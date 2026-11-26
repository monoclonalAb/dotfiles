// Started detached by /restart (index.ts), just before that Pi quits:
//
//   node relaunch.mjs <pi pid> <hc> <terminal> <command>
//
// 1. Waits for the Pi process to exit (up to a minute).
// 2. Waits for a shell to be in front of the Herdr app terminal (up to 15 s):
//    Pi may run under a wrapper, such as Pi Tasks' runner or a review tab's
//    `zsh -lic 'pi …; exec zsh -l'`, that ends or execs a shell after it.
// 3. Types the command (`pi --session '<file>'`) into it with `hc send`.
// It never types into anything but a shell. If it gives up, the terminal still
// shows Pi's own "To resume this session" line.
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SHELLS = new Set(["zsh", "bash", "sh", "dash", "fish", "ksh", "tcsh", "nu"]);

// `hc get <t> --json` of a live terminal whose foreground program is a shell.
export function shellInFront(info) {
  if (info?.state !== "live") return false;
  const name = String(info.foreground?.name ?? "").replace(/^-/, "").split("/").pop();
  return SHELLS.has(name);
}

export function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

export function run(command, args) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: 10_000 }, (error, stdout) =>
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout: String(stdout ?? "") }));
  });
}

export async function relaunch({ pid, hc, terminal, command, isAlive = alive, exec = run,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)), now = Date.now,
  exitWaitMs = 60_000, shellWaitMs = 15_000, settleMs = 300 }) {
  const quitting = now();
  while (isAlive(pid)) {
    if (now() - quitting > exitWaitMs) return "pi-still-running";
    await sleep(200);
  }
  const exited = now();
  for (;;) {
    let info;
    try { info = JSON.parse((await exec(hc, ["get", terminal, "--json"])).stdout); } catch { info = undefined; }
    if (shellInFront(info)) {
      // Let a shell that execs another (`exec zsh -l`) get going; typed text waits in the terminal anyway.
      await sleep(settleMs);
      return (await exec(hc, ["send", terminal, command])).code === 0 ? "sent" : "send-failed";
    }
    if (info?.state && info.state !== "live") return "terminal-gone";
    if (now() - exited > shellWaitMs) return "no-shell";
    await sleep(250);
  }
}

const self = fileURLToPath(import.meta.url);
let entry;
try { entry = process.argv[1] && realpathSync(process.argv[1]); } catch { entry = undefined; }
if (entry === realpathSync(self)) {
  const [pid, hc, terminal, command] = process.argv.slice(2);
  if (pid && hc && terminal && command) await relaunch({ pid: Number(pid), hc, terminal, command });
}
