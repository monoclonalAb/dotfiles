// The Herdr desktop app's side of Pi Tasks: the five terminal Herdr socket
// methods TaskLaunch and the runner call, done with git and `herdr-app do`.
// Chosen by HERDR_TASK_BACKEND=app, which the app's popups mod sets when C-a t
// opens the form (herdr-app/mods/popups).
//
//   worktree.create    git worktree add in ~/.herdr/worktrees/<repo>/<branch>, the
//                      folder the app's own worktree dialog uses, then a Space there
//   plugin.pane.open   a tab in that Space running `launch.sh run`
//   tab.list/tab.close from `herdr-app ls`, so TaskLaunch closes the first shell tab
//   notification.show  printed in the Pi tab (the app has no command for toasts)
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcError } from "./rpc.mjs";
import { git } from "./task.mjs";

export const LAUNCHER = fileURLToPath(new URL("./launch.sh", import.meta.url));

// The app's worktree dialog: <repo>/<branch, anything but A-Za-z0-9._- as dashes>.
export const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

// `herdr-app <args>`: its JSON reply ({ error } when it refused), or an RpcError
// when there is none.
export function herdrApp(args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("herdr-app", args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      let reply;
      try { reply = JSON.parse(stdout); } catch { /* below */ }
      if (reply?.error) return resolve(reply);
      if (error || !reply) {
        // A timeout or a lost reply leaves a mutation's outcome unknown.
        return reject(new RpcError(`herdr-app ${args[1] ?? args[0]}: ${(stderr || error?.message || "no reply").trim()}`, Boolean(error?.killed)));
      }
      resolve(reply);
    });
  });
}

export function createAppRpc({ app = herdrApp, gitRun = git, home = homedir(), log = (line) => console.error(line) } = {}) {
  const call = async (args) => {
    const reply = await app(args);
    if (reply?.error) throw new RpcError(`herdr-app ${args[1] ?? args[0]}: ${reply.error}`);
    return reply;
  };
  const run = (command, args) => call(["do", command, JSON.stringify(args)]);
  const spaceOf = async (id) => (await call(["ls"])).spaces?.find((space) => space.id === id);

  return async function rpc(method, params) {
    if (method === "worktree.create") {
      const path = params.path ?? join(home, ".herdr", "worktrees", basename(params.cwd), slug(params.branch));
      await gitRun(params.cwd, "worktree", "add", "-b", params.branch, path, params.base);
      const made = await run("space.new", { name: params.label, folder: path });
      if (!made.space || !made.tab) throw new RpcError("herdr-app space.new returned no Space", true);
      return { workspace: { workspace_id: made.space, active_tab_id: made.tab, tab_count: 1 }, worktree: { path } };
    }
    if (method === "plugin.pane.open") {
      if (params.entrypoint !== "pi" || params.placement !== "tab") throw new RpcError(`${params.entrypoint} ${params.placement} is not available in the Herdr app.`);
      const env = Object.entries(params.env ?? {}).map(([key, value]) => `${key}=${value}`);
      const argv = ["/usr/bin/env", ...env, "HERDR_TASK_BACKEND=app", "/bin/sh", LAUNCHER, "run"];
      const made = await run("tab.new", { space: params.workspace_id, folder: params.cwd, argv });
      if (!made.tab) throw new RpcError("herdr-app tab.new returned no tab", true);
      if (params.focus) {
        await run("space.select", { id: params.workspace_id });
        await run("tab.select", { id: made.tab });
      }
      const pane = (await spaceOf(params.workspace_id))?.tabs?.find((tab) => tab.id === made.tab)?.terminals?.[0]?.pane;
      return { plugin_pane: { pane: { pane_id: pane ?? made.terminal, tab_id: made.tab } } };
    }
    if (method === "tab.list") {
      const space = await spaceOf(params.workspace_id);
      return { tabs: (space?.tabs ?? []).map((tab) => ({ tab_id: tab.id, pane_count: tab.terminals?.length ?? 0 })) };
    }
    if (method === "tab.close") {
      await run("tab.close", { id: params.tab_id, confirmed: true });
      return {};
    }
    if (method === "notification.show") {
      log([params.title, params.body].filter(Boolean).join(": "));
      return {};
    }
    throw new RpcError(`${method} is not available in the Herdr app.`);
  };
}

// The form's colours from the app's Catppuccin theme (herdr-app/themes), in the
// [theme.custom] names readPalette() reads from the terminal Herdr config.
export async function readAppPalette(home = homedir()) {
  let flavour;
  try { flavour = (await readFile(join(home, ".local/state/theme/flavour"), "utf8")).trim(); } catch { return undefined; }
  let theme;
  try { theme = JSON.parse(await readFile(join(home, ".config/herdr-app/themes", `catppuccin-${flavour}.json`), "utf8")); }
  catch { return undefined; }
  const c = theme.colors ?? {};
  const a = theme.ansi ?? [];
  const palette = {
    accent: c.accent, mauve: c.accent, active_row_bg: c.selected, surface0: c.border, surface1: c.input,
    overlay1: c.dim, subtext0: c.muted, text: theme.foreground, peach: c.done,
    red: a[1], green: a[2], yellow: a[3], blue: a[4], teal: a[6],
  };
  for (const [key, value] of Object.entries(palette)) if (!/^#[0-9a-fA-F]{6}$/.test(value ?? "")) delete palette[key];
  return Object.keys(palette).length ? palette : undefined;
}
