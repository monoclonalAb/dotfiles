// The tab bar: the shipped `tabs` mod (Herdr 0.1.13) with only the tabs. No
// `+` (new-tab menu) and no Files/Changes panel buttons; keys do those jobs
// (Cmd+T / C-a C-c, and C-a b / C-a f / C-a i for the right-hand panel). Tabs
// keep their clicks, double-click rename, drag to reorder, right-click menu and
// wheel switching.
//
// Also unlike the shipped bar:
// - It leaves the macOS window buttons room whenever no sidebar sits left of
//   it (lightsPadding); in the eric layout the sidebar is in the right-hand panel.
// - It does not remember the panel per Space. The panel holds the sidebar too,
//   and clicking a Space there must not swap the sidebar for that Space's view.
// Windows and Linux window buttons are left out: this layout is macOS-only.
import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, theme, window, layout, settings } from "herdr";

// Left padding, px, that keeps the tabs clear of the macOS window buttons
// (`root.traffic_lights`, at the window's left edge). A shown sidebar left of
// the bar (`work`) already leaves them room; one elsewhere does not.
// `root`: layout(), `win`: window(), `zoom`: settings().zoom.
export function lightsPadding(root, win, zoom = 1) {
  if (win?.platform !== "macos" || win.titlebar !== "none" || win.fullscreen || !root?.traffic_lights) return 10;
  const kids = root.children ?? [];
  const at = (id) => kids.findIndex((c) => c.id === id);
  const sidebar = kids[at("sidebar")];
  const left = sidebar && !sidebar.hidden && at("sidebar") < at("work") ? (sidebar.size?.px ?? 0) : 0;
  return Math.max(10, (root.traffic_lights[0] + 64) / (zoom || 1) - left);
}

export default class TabBar extends View {
  init() {
    this.pressed = null;
  }

  render() {
    const t = theme();
    const space = spaces().find(p => p.active);
    const shown = space?.tabs ?? [];
    const stop = (_e, cx) => cx.stop_propagation();
    const item = (c, i) => {
      const program = panes().find(p => p.tab === c.id && p.program?.agent)?.program ?? panes().find(p => p.tab === c.id)?.program;
      const name = /^tb\d+$/.test(c.name) ? program?.name ?? "Terminal" : c.name;
      return h_flex().id(`tab-${c.id}`).h(29).px(10).gap(7).rounded(7).items_center().flex_none().text_size(12.8)
        .border(1).border_color(c.active ? t.border : t.chrome).bg(c.active ? t.raised : t.chrome).text_color(c.active ? t.foreground : t.muted)
        .hover(s => s.bg(t.hover))
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; if (e.click_count === 2) run("tab.rename", { id: c.id }); })
        .on_mouse_up("left", () => {
          const from = this.pressed; this.pressed = null;
          if (from !== null && from !== i) run("tab.move", { id: shown[from].id, index: space.tabs.findIndex(x => x.id === c.id) + 1 });
          else run("tab.select", { id: c.id });
        })
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: space.id } } }); })
        .when(Boolean(program?.icon), el => el.child(program.tint ? svg(program.icon).size(14).text_color(t.muted) : image(program.icon).size(14)))
        .child(div().max_w(170).truncate().child(c.zoomed ? `${name} Z` : name))
        .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900)))
        .when(c.status === "blocked" || c.status === "done", el => el.child(div().size(6).rounded(3).bg(t[c.status])))
        .when(c.active, el => el.child(div().id(`close-${c.id}`).text_color(t.dim).on_mouse_down("left", stop).on_click((_e, cx) => { cx.stop_propagation(); run("tab.close", { id: c.id }); }).child(svg("mods/pane/close.svg").size(12))));
    };
    return h_flex().size_full().min_w(0).px(10).pl(lightsPadding(layout(), window(), settings().zoom)).gap(3).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .on_mouse_up("left", () => { this.pressed = null; })
      .on_scroll_wheel(e => { if (Math.abs(e.delta.y) >= 1) run(e.delta.y > 0 ? "tab.prev" : "tab.next"); })
      .child(h_flex().id("tab-scroll").flex_1().min_w(0).h_full().items_center().gap(3).overflow_x_scrollbar().children(shown.map(item)));
  }
}
