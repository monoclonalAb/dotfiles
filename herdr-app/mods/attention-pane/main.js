// A pane header that shows attention: a copy of Herdr's shipped `pane` header
// (0.1.12). The patched terminal Herdr drew blocked panes with a red border and
// finished-but-unreviewed ones peach; the app draws pane borders itself, so
// this header carries the colour instead: a tinted bar with the next-agent dot
// (shared "next-agent.dots"). It names the conversation as the Spaces tree does.
// Props from the app: { pane, terminal }. Click: focus the pane.
//
// Motion, native: the tint fades in and out, a changed dot fades in, and the
// hover buttons fade in. The app animates only a change of target, so what is
// drawn for the first time is drawn hidden and shown by a render FRAME ms later.

import { View, div, svg, image } from "gpui-kit";
import { h_flex } from "gpui-base";
import { panes, terminals, props, run, theme, home, shared, layout } from "herdr";

const GLYPH = { blocked: "\u25c6", review: "\u25cf", working: "\u25d0", idle: "\u25cb" };
const SPIN = ["\u25d0", "\u25d3", "\u25d1", "\u25d2"];
const TONE = { blocked: "blocked", review: "done", working: "working", idle: "idle" };
const FADE = 200; // the tint and the dot, ms
const BUTTONS = 120; // the hover buttons, ms
const FRAME = 32; // long enough for one frame to be drawn in between
const fallbackDot = (status) => (status === "blocked" ? "blocked" : status === "done" ? "review" : status === "working" ? "working" : "idle");

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function folder(cwd) {
  if (!cwd) return "";
  const h = home();
  return cwd === h ? "~" : cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

// The pane card this header sits in: the shown layout's tab block `pane` look.
function paneFrame(node = layout()) {
  if (!node || typeof node !== "object") return null;
  if (node.content?.tab) return node.content.pane ?? {};
  for (const c of node.children ?? []) {
    const f = paneFrame(c);
    if (f) return f;
  }
  return null;
}

export default class AttentionPane extends View {
  init() { this.hovered = false; }

  me() {
    return panes().find((p) => p.pane === props()?.pane);
  }

  button(t, id, icon, command, args) {
    return div()
      .id(id)
      .p(3)
      .rounded(4)
      .text_color(t.dim)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .opacity(this.buttonsIn ? 1 : 0)
      .transition("opacity", BUTTONS)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        run(command, args);
      })
      .child(svg(`mods/pane/${icon}.svg`).size(14));
  }

  render(cx) {
    const t = theme();
    const p = this.me();
    if (!p) return div();
    const labels = p.terminal ? terminals().find((x) => x.address === p.terminal)?.labels ?? {} : {};
    const program = ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
    const name = labels.task_summary || program;
    const pic = icon(p.program, 14, t.dim);
    const d = p.status ? (shared("next-agent.dots") ?? {})[p.terminal] ?? fallbackDot(p.status) : null;
    const loud = d === "blocked" || d === "review";
    const color = d ? t[TONE[d]] : t.dim;
    const pane = p.pane;
    // The tint keeps its colour while it fades out.
    if (loud) this.loudColor = color;
    const tint = this.loudColor ?? color;
    // A dot that changed since the last render starts hidden.
    const freshDot = this.dot !== undefined && d !== this.dot;
    this.dot = d;
    if (freshDot) cx.timer.after(FRAME, (cx) => cx.notify());
    // The header sits inside the card's border, so its fill must round with the
    // card (radius minus the border it sits inside) or its square corners poke
    // past the card's rounded ones.
    const f = paneFrame() ?? {};
    const inset = (p.focused ? f.focus?.width : null) ?? f.border?.width ?? 0;
    const r = Math.max(0, (f.radius ?? 0) - inset);
    const top = (f.header?.position ?? "top") !== "bottom";
    const corners = (el) => (top ? el.rounded_tl(r).rounded_tr(r) : el.rounded_bl(r).rounded_br(r));
    return corners(h_flex()
      .id(`pane-head-${pane}`)
      .relative()
      .size_full()
      .px(10)
      .gap(8)
      .items_center())
      .bg(t.background)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .on_hover((hovered, cx) => {
        // The buttons are drawn hidden, then fade in.
        this.hovered = hovered;
        this.buttonsIn = false;
        cx.notify();
        if (hovered) cx.timer.after(FRAME, (cx) => {
          this.buttonsIn = this.hovered;
          cx.notify();
        });
      })
      .on_click(() => run("pane.focus", { pane }))
      // The tint, and a 2 px line over the bottom border.
      .child(corners(div().id(`ph-tint-${pane}`).absolute().top(0).left(0).size_full())
        .bg(tint + "26").opacity(loud ? 1 : 0).transition("opacity", FADE))
      .child(div().id(`ph-line-${pane}`).absolute().left(0).right(0).bottom(-1).h(2)
        .bg(tint).opacity(loud ? 1 : 0).transition("opacity", FADE))
      .when(Boolean(pic), (el) => el.child(pic))
      .child(div().flex_none().truncate().max_w(360).font_medium().text_color(p.focused || loud ? t.foreground : t.muted).child(name))
      .child(div().flex_1().truncate().text_color(t.dim).child(folder(p.cwd)))
      .when(Boolean(d), (el) => el.child(d === "working"
        ? div().id(`ph-dot-${pane}-${d}`).flex_none().text_color(color).opacity(freshDot ? 0 : 1).transition("opacity", FADE).frames(SPIN, 180)
        : div().id(`ph-dot-${pane}-${d}`).flex_none().text_color(color).opacity(freshDot ? 0 : 1).transition("opacity", FADE).child(d === "blocked" ? `${GLYPH.blocked} Needs you` : d === "review" ? `${GLYPH.review} To review` : GLYPH.idle)))
      .when(this.hovered, el => el
        .child(this.button(t, `ph-r-${pane}`, "split-right", "pane.split", { direction: "right", pane }))
        .child(this.button(t, `ph-d-${pane}`, "split-down", "pane.split", { direction: "down", pane }))
        .child(this.button(t, `ph-z-${pane}`, p.zoomed ? "unzoom" : "zoom", "pane.zoom", { pane }))
        .child(this.button(t, `ph-x-${pane}`, "close", "pane.close", { pane })));
  }
}
