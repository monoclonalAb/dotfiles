// Popups: the terminal Herdr's popup keys, as terminals in app dialogs. Lives in
// the status bar (0 px), where its key commands always arrive.
//
//   popups.task           Pi Tasks (herdr/plugins/task-launcher), from the focused pane's folder
//   popups.review         tuicr on the focused agent's changes (bin/herdr-review)
//   popups.review-branch  the same for its whole branch (herdr-review --branch)
//   popups.scrollback     the focused terminal's history in $EDITOR
//
// Each popup is an hc terminal without Herdr's space/tab labels (so it shows in
// no tab), drawn in a dialog under a small bar of this mod (props { bar }).
// The dialog closes when its program exits; the bar ends the program when the
// dialog is closed first (Esc goes to the program, so click outside or x).

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { focused, agents, terminals, hc, home, notify, openOverlay, closeOverlay, nextCommand, props, theme } from "herdr";

const BAR = 28;
// Herdr's dialog frame: radius 8 with a 1 px border, so the bar's fill rounds to 7
// (square corners poke past the frame's). The terminal below needs the layout's
// "terminal_opacity": 0, so the frame's own rounded fill shows at its corners.
const FRAME_INNER_RADIUS = 7;
// Hotkey and GUI programs inherit no login shell: the same PATH the TUI's popups had.
const PATH = () => `${home()}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`;

export default class Popups extends View {
  init(_props, cx) {
    if (props()?.bar) return;
    cx.spawn(async (cx) => {
      for (;;) {
        const command = await nextCommand();
        try { await this.command(command); }
        catch (e) { notify({ title: "Popup failed", body: String(e?.message ?? e), level: "error" }); }
        cx.notify();
      }
    });
  }

  // The agent a review is for: the focused terminal when it is an agent, else the
  // only agent in the focused tab.
  reviewTarget() {
    const f = focused();
    const list = agents();
    const mine = list.find((a) => a.address === f?.terminal);
    if (mine) return mine;
    const inTab = list.filter((a) => a.tab === f?.tab);
    if (inTab.length === 1) return inTab[0];
    throw new Error(inTab.length ? `${inTab.length} agents in this tab; focus the one that should get the review` : "No agent in this tab; focus the agent pane and try again");
  }

  async command(command) {
    const f = focused();
    if (command === "task") {
      if (!f?.cwd) throw new Error("The focused pane needs a local folder for Pi Tasks.");
      const source = JSON.stringify({ cwd: f.cwd, workspaceId: f.space });
      return this.open({
        title: "Pi task", cwd: f.cwd, width: 0.8, height: 560,
        env: { HERDR_TASK_BACKEND: "app", HERDR_TASK_SOURCE: source },
        argv: ["/bin/sh", `${home()}/.config/herdr/plugins/task-launcher/launch.sh`, "form"],
      });
    }
    if (command === "review" || command === "review-branch") {
      const agent = this.reviewTarget();
      if (agent.address.includes("/")) throw new Error("Reviewing an agent on another machine is not supported.");
      const t = terminals().find((x) => x.address === agent.address);
      const cwd = t?.foreground?.cwd || t?.cwd;
      if (!cwd) throw new Error(`${agent.address} has no working directory.`);
      return this.open({
        title: command === "review" ? "Review changes" : "Review branch", cwd, width: 0.95, height: 0.9,
        env: { HERDR_REVIEW_TERMINAL: agent.address },
        argv: [`${home()}/.local/bin/herdr-review`, ...(command === "review-branch" ? ["--branch"] : [])],
      });
    }
    if (command === "scrollback") {
      const address = f?.terminal;
      if (!address) throw new Error("Focus a terminal first.");
      const script = 'f=$(mktemp -t herdr-scrollback) && hc read --lines 100000 "$1" > "$f" && "${EDITOR:-nvim}" "$f"; rm -f "$f"';
      return this.open({
        title: `Scrollback of ${address}`, cwd: f.cwd || home(), width: 0.95, height: 0.9,
        env: {}, argv: ["/bin/sh", "-c", script, "sh", address],
      });
    }
    throw new Error(`unknown command ${command}`);
  }

  async open({ title, cwd, width, height, env, argv }) {
    const pairs = Object.entries({ PATH: PATH(), ...env }).map(([k, v]) => `${k}=${v}`);
    const r = await hc(["run", "--bg", "--json", "--no-parent", "--no-notify", "--rm", "--cwd", cwd,
      "--label", "herdr-app.popup=1", "--", "/usr/bin/env", ...pairs, ...argv]);
    if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim() || `hc run exited ${r.code}`);
    const address = JSON.parse(r.stdout).address;
    openOverlay({
      kind: "dialog", width, height: typeof height === "number" && height > 1 ? height + BAR : height,
      layout: { type: "column", children: [
        { type: "block", size: { px: BAR }, content: { mod: "popups", props: { bar: true, title, address } } },
        { type: "block", content: { terminal: address } },
      ] },
    });
  }

  // The bar's copy: when its dialog goes, end the program if it still runs.
  async close() {
    const p = props();
    if (p?.bar && p.address) await hc(["kill", p.address]);
  }

  render() {
    const p = props();
    if (!p?.bar) return div();
    const t = theme();
    return h_flex()
      .size_full()
      .px(12)
      .gap(8)
      .items_center()
      .rounded_tl(FRAME_INNER_RADIUS)
      .rounded_tr(FRAME_INNER_RADIUS)
      .bg(t.chrome)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .text_color(t.muted)
      .child(div().flex_1().truncate().font_medium().child(p.title ?? ""))
      .child(div().text_size(11).text_color(t.dim).child("Esc goes to the program"))
      .child(div()
        .id("popup-close")
        .p(3)
        .rounded(4)
        .text_color(t.dim)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => closeOverlay(p.overlay))
        .child(svg("mods/workspace-chrome/x.svg").size(13)));
  }
}
