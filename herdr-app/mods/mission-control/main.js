// Mission control: every agent of the shown Personal/Work environment at once,
// as Tern's Mission Control shows every tab of every session. `C-a C-w` runs
// mod.open:mission-control, which opens this as a dialog (again: closes it).
//
// One heading per Space with an agent, in the sidebar's order (shared
// "spaces-tree.order"), then a card per agent pane, tab by tab; plain shells are
// left out. A card has the agent's next-agent dot (shared "next-agent.dots"), its
// title as the sidebar names it, and the last lines of its screen. Arrows or
// h/j/k/l move, Enter or a click goes to that pane, Esc closes.
//
// Cards are text read with `hc read` every 2 s while the dialog is open, not live
// terminal blocks, so opening it never resizes or types into a terminal.
//
// Motion is the app's native kind (no timers): on opening, the rows fade and
// rise in one after another; scrolling springs; the selection is a ring that
// glides from card to card while the old card's title tint fades to the new one.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, agents, terminals, focused, run, hc, theme, settings, shared, props, closeOverlay } from "herdr";

// Sizes in px at zoom 1.
export const HEAD = 34; // a Space's heading
export const CARD = 214; // a card
export const GAP = 12; // between cards, and below each row of them
export const MIN_CARD = 340; // the narrowest card before a column goes
const TITLE = 30; // a card's title bar
const LINE = 11; // one screen line
const FONT = 9;
const LINES = Math.floor((CARD - TITLE - 12) / LINE);
const REFRESH = 2000;
// Motion. Rows and the ring share one spring, so the ring stays on its card
// while both move.
const SPRING = { response: 220, damping: 1 };
const RISE = 10; // px a row rises on opening
const ENTER = 220; // ms its fade takes
const STAGGER = 30; // ms between rows on opening
const STAGGER_ROWS = 6; // rows after this many come in together
const TINT = 160; // ms a title's selection tint fades

// --- Rules (pure; tested by lib/herdr-app-mods) ------------------------------

// The Spaces to show, in the sidebar's order: the active environment's and the
// focused one, as spaces-tree shows them. No environment state: every Space.
export function shownSpaces(list, order, env) {
  const rank = new Map((Array.isArray(order) ? order : []).map((id, i) => [id, i]));
  const at = (w) => rank.get(w.id) ?? Infinity;
  const sorted = list.map((w, i) => ({ w, i })).sort((a, b) => at(a.w) - at(b.w) || a.i - b.i).map((r) => r.w);
  const inEnv = (w) => !env?.assign || (env.assign[w.id] ?? "personal") === (env.active ?? "personal") || w.active;
  return sorted.filter(inEnv);
}

// Each Space with its agents' panes (`agentList`: the app's agents()), tab by tab;
// Spaces without one are left out.
export function sections(shown, paneList, agentList) {
  const mine = new Set(agentList.map((a) => a.pane));
  return shown
    .map((space) => ({
      space,
      cards: (space.tabs ?? []).flatMap((tab) =>
        paneList.filter((p) => p.tab === tab.id && p.terminal && mine.has(p.pane)).map((pane) => ({ space, tab, pane }))),
    }))
    .filter((s) => s.cards.length);
}

// How many cards fit across `width`.
export function columns(width) {
  return Math.max(1, Math.floor((width + GAP) / (MIN_CARD + GAP)));
}

// Where everything goes with `cols` columns: rows from the top (a heading, then
// rows of cards) and each card with its row and column.
export function grid(secs, cols) {
  const rows = [];
  const cards = [];
  let y = 0;
  for (const section of secs) {
    rows.push({ kind: "head", section, top: y, height: HEAD });
    y += HEAD;
    for (let i = 0; i < section.cards.length; i += cols) {
      const row = { kind: "cards", top: y, height: CARD, first: i === 0, items: [] };
      for (const card of section.cards.slice(i, i + cols)) {
        row.items.push(cards.length);
        cards.push({ ...card, row: rows.length, col: row.items.length - 1 });
      }
      rows.push(row);
      y += CARD + GAP;
    }
  }
  return { rows, cards, height: y };
}

// The card a key moves to: left and right through the order, up and down to the
// same column of the previous or next row of cards, across Spaces.
export function step(g, at, dir) {
  const n = g.cards.length;
  if (!n) return 0;
  at = Math.min(Math.max(at, 0), n - 1);
  if (dir === "left") return Math.max(0, at - 1);
  if (dir === "right") return Math.min(n - 1, at + 1);
  const rows = g.rows.filter((r) => r.kind === "cards");
  const mine = rows.indexOf(g.rows[g.cards[at].row]);
  const next = rows[mine + (dir === "down" ? 1 : -1)];
  return next ? next.items[Math.min(g.cards[at].col, next.items.length - 1)] : at;
}

// The scroll that shows card `at` whole, moving as little as it can. A Space's
// first row brings its heading into view too.
export function reveal(g, at, scroll, height) {
  const card = g.cards[at];
  if (!card) return scroll;
  const row = g.rows[card.row];
  const max = Math.max(0, g.height - height);
  const top = row.first ? row.top - HEAD : row.top;
  if (top < scroll) return Math.min(Math.max(0, top), max);
  if (row.top + row.height > scroll + height) return Math.min(Math.max(0, row.top + row.height - height), max);
  return scroll;
}

// The rows to draw (indices into g.rows): those on screen and a screen's worth
// either side, so a row a scroll brings in is already there to slide in.
export function drawn(rows, scroll, height) {
  return rows.flatMap((r, i) => (r.top + r.height > scroll - height && r.top < scroll + 2 * height ? [i] : []));
}

// Where the selection ring sits for card `at`, in grid px (before scrolling).
export function ringAt(g, at, cardWidth) {
  const card = g.cards[at];
  return card ? { left: card.col * (cardWidth + GAP), top: g.rows[card.row].top } : null;
}

// The last `count` lines of a screen, without trailing spaces and with runs of
// blank lines folded to one, so a card shows text rather than empty rows.
export function tail(text, count) {
  const out = [];
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.replace(/\s+$/, "").slice(0, 240);
    if (!line && !out[out.length - 1]) continue;
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.slice(-count);
}

// A card's title: spaces-tree's conversationTitle, copied because a mod is one
// file (lib/herdr-app-mods checks the two agree). Pi's task summary, else the
// program's own title when it tells more than its folder, else a named tab, else
// the program.
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
export function stripTitle(title) {
  return (title ?? "").trim()
    .replace(/^(?:[πω]|[^\p{L}\p{N}\s.~/])+\s*/u, "")
    .replace(/^[-–—>:|·]+\s*/u, "")
    .trim();
}
export function conversationTitle({ summary, pending, title, address, cwd, spaceName, tabName, tabNamed, program }) {
  if (summary) return { text: summary, strong: true };
  const stripped = stripTitle(title);
  const folder = base(cwd ?? "");
  const telling = stripped && stripped !== folder && stripped !== spaceName && stripped !== address && !/^[~/]/.test(stripped)
    && stripped.toLowerCase() !== (program ?? "").toLowerCase();
  if (telling) return { text: stripped, strong: true };
  if (pending) return { text: "Naming…", strong: false };
  if (tabNamed && tabName) return { text: tabName, strong: false };
  return { text: program || "agent", strong: false };
}

// --- The mod ------------------------------------------------------------------

// The sidebar's dots and avatar colours, so a card looks like its sidebar row.
const GLYPH = { blocked: "\u25c6", review: "\u25cf", working: "\u25d0", idle: "\u25cb" };
const SPIN = ["\u25d0", "\u25d3", "\u25d1", "\u25d2"];
const TONE = { blocked: "blocked", review: "done", working: "working", idle: "idle" };
const fallbackDot = (status) => (status === "blocked" ? "blocked" : status === "done" ? "review" : status === "working" ? "working" : "idle");
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const DIRS = { left: "left", h: "left", right: "right", l: "right", up: "up", k: "up", down: "down", j: "down" };

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

export default class MissionControl extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.screens = {}; // address: screen text, or null when it could not be read
    this.pick = focused()?.pane ?? null; // the selected card's pane
    this.scroll = 0;
    this.size = null; // the grid's width and height, px at zoom 1
    this.placed = false; // scrolled to the first selection once the size is known
    this.entered = false; // the opening fade has started
    this.read(cx);
    cx.timer.every(REFRESH, (cx) => this.read(cx));
  }

  model() {
    const secs = sections(shownSpaces(spaces(), shared("spaces-tree.order"), shared("spaces-env")), panes(), agents());
    const width = this.size?.width ?? 1200;
    const g = grid(secs, columns(width));
    g.cardWidth = (width - GAP * (columns(width) - 1)) / columns(width);
    return g;
  }

  // One pass over the shown terminals' screens; a pass still running skips the tick.
  read(cx) {
    if (this.reading) return;
    this.reading = true;
    const addresses = this.model().cards.map((c) => c.pane.terminal);
    cx.spawn(async (cx) => {
      try {
        for (const address of addresses) {
          try {
            const r = await hc(["read", address]);
            this.screens[address] = r.code === 0 ? r.stdout : null;
          } catch {
            this.screens[address] = null;
          }
        }
      } finally {
        this.reading = false;
      }
      cx.notify();
    });
  }

  // `el` fading and rising in on opening, `delay` ms late. Afterwards its targets
  // stay put, so the motion never runs again.
  enter(el, delay) {
    return el
      .relative()
      .top(this.entered ? 0 : RISE)
      .opacity(this.entered ? 1 : 0)
      .transition("top", { duration: ENTER + 60, delay })
      .transition("opacity", { duration: ENTER, delay });
  }

  dismiss() {
    closeOverlay(props()?.overlay);
  }

  go(card) {
    this.dismiss();
    run("pane.focus", { pane: card.pane.pane });
  }

  head(section, t) {
    const w = section.space;
    const color = (shared("space.colors") ?? {})[w.id] ?? "ansi6";
    const fill = w.name === "~" ? t.dim : color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    return h_flex()
      .h_full()
      .pb(6)
      .gap(9)
      .items_end()
      .text_size(12.5)
      .child(h_flex().size(18).flex_none().rounded(5).bg(fill).items_center().justify_center().text_size(10.5).font_bold()
        .text_color("#ffffff").child([...w.name][0]?.toUpperCase() ?? "?"))
      .child(div().flex_none().font_semibold().text_color(t.foreground).child(w.name))
      .when(Boolean(w.branch) && w.branch !== w.name, (el) => el.child(div().truncate().text_size(11.5).text_color(t.dim).child(w.branch)));
  }

  card(card, index, width, at, t) {
    const { space, tab, pane } = card;
    const term = this.terms.get(pane.terminal);
    const d = pane.status ? ((shared("next-agent.dots") ?? {})[pane.terminal] ?? fallbackDot(pane.status)) : null;
    const { text, strong } = conversationTitle({
      summary: term?.labels?.task_summary, pending: term?.labels?.task_summary_pending === "1",
      title: pane.title, address: pane.terminal, cwd: pane.cwd, spaceName: space.name,
      tabName: tab.name, tabNamed: tab.named, program: pane.program?.name,
    });
    const selected = index === at;
    // The selection's accent border is the ring drawn over the card (render).
    const border = d === "blocked" ? t.blocked : d === "review" ? t.done : t.border;
    const screen = this.screens[pane.terminal];
    const lines = screen === undefined ? [] : screen === null ? null : tail(screen, LINES);
    const mark = d && (d === "working"
      ? div().w(12).flex_none().text_size(11).text_color(t.working).frames(SPIN, 180)
      : div().w(12).flex_none().text_size(11).text_color(t[TONE[d]] ?? t.dim).child(GLYPH[d]));
    const pic = icon(pane.program, 13, t.muted);
    return v_flex()
      .id(`mc-${pane.pane}`)
      .w(width)
      .h(CARD)
      .flex_none()
      .rounded(8)
      .border(1)
      .border_color(border)
      .bg(t.background)
      .overflow_hidden()
      .cursor_pointer()
      .when(!selected, (el) => el.hover((s) => s.border_color(t.input)))
      .on_click(() => this.go(card))
      .child(h_flex()
        .h(TITLE)
        .flex_none()
        .relative()
        .px(10)
        .gap(7)
        .items_center()
        .bg(t.chrome)
        .border_b(1)
        .border_color(t.border)
        .text_size(12)
        .child(div().id(`mc-tint-${pane.pane}`).absolute().top(0).left(0).size_full().bg(t.selected)
          .opacity(selected ? 1 : 0).transition("opacity", TINT))
        .when(Boolean(mark), (el) => el.child(mark))
        .when(Boolean(pic), (el) => el.child(pic))
        .child(div().flex_1().min_w(0).truncate().text_color(strong || d === "blocked" || d === "review" ? t.foreground : t.muted).child(text))
        .when(focused()?.pane === pane.pane, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.accent).child("here")))
        .when((space.tabs ?? []).length > 1, (el) => el.child(div().flex_none().max_w(90).truncate().text_size(11).text_color(t.dim).child(tab.name))))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .px(10)
        .py(6)
        .justify_end()
        .overflow_hidden()
        .font_family(settings().font_family ?? "JetBrains Mono")
        .text_size(FONT)
        .text_color(t.muted)
        .when(lines === null, (el) => el.child(div().text_color(t.dim).child("Screen unavailable")))
        .when(Boolean(lines), (el) => el.children(lines.map((line) => div().h(LINE).flex_none().whitespace_nowrap().overflow_hidden().child(line || " ")))));
  }

  render() {
    const t = theme();
    const g = this.model();
    this.terms = new Map(terminals().map((x) => [x.address, x]));
    const height = this.size?.height ?? 600;
    let at = g.cards.findIndex((c) => c.pane.pane === this.pick);
    if (at < 0) at = 0;
    const dots = g.cards.map((c) => (c.pane.status ? ((shared("next-agent.dots") ?? {})[c.pane.terminal] ?? fallbackDot(c.pane.status)) : null));
    const blocked = dots.filter((d) => d === "blocked").length;
    const review = dots.filter((d) => d === "review").length;
    const env = shared("spaces-env")?.active;
    const where = env ? env[0].toUpperCase() + env.slice(1) : "All Spaces";
    // Nothing is drawn until the grid's size is known, so no row slides from a
    // guessed place to its real one.
    const rows = this.size ? drawn(g.rows, this.scroll, height) : [];
    const first = g.rows.findIndex((r) => r.top + r.height > this.scroll);
    const delay = (i) => Math.min(Math.max(0, i - first), STAGGER_ROWS) * STAGGER;
    const ring = this.size ? ringAt(g, at, g.cardWidth) : null;
    const max = Math.max(0, g.height - height);

    return v_flex()
      .id("mission-control")
      .track_focus(this.handle)
      .size_full()
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const m = e.modifiers ?? {};
        const dir = !m.control && !m.alt && !m.platform ? DIRS[e.key] : null;
        if (e.key === "escape") return this.dismiss();
        if (e.key === "enter" && g.cards[at]) return this.go(g.cards[at]);
        if (!dir || !g.cards.length) return;
        const next = step(g, at, dir);
        this.pick = g.cards[next].pane.pane;
        this.scroll = reveal(g, next, this.scroll, height);
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex()
        .h(46)
        .flex_none()
        .px(18)
        .gap(10)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Mission control"))
        .child(div().text_size(12).text_color(t.dim).child(`${where} \u00b7 ${g.cards.length} agent${g.cards.length === 1 ? "" : "s"}`))
        .when(blocked > 0, (el) => el.child(div().text_size(12).text_color(t.blocked).child(`${GLYPH.blocked}${blocked}`)))
        .when(review > 0, (el) => el.child(div().text_size(12).text_color(t.done).child(`${GLYPH.review}${review}`)))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("\u2190\u2191\u2193\u2192 or hjkl move \u00b7 Enter go \u00b7 Esc close")))
      .child(div()
        .id("mc-grid")
        .flex_1()
        .min_h(0)
        .mx(18)
        .mt(4)
        .mb(14)
        .relative()
        .overflow_hidden()
        .on_size_change((size, cx) => {
          const zoom = settings().zoom ?? 1;
          this.size = { width: size.width / zoom, height: size.height / zoom };
          if (!this.placed) {
            this.placed = true;
            const first = this.model();
            const index = first.cards.findIndex((c) => c.pane.pane === this.pick);
            if (index >= 0) this.scroll = reveal(first, index, 0, this.size.height);
            // Draw the rows hidden first, then start their fade a frame or so later.
            cx.timer.after(50, (cx) => {
              this.entered = true;
              cx.notify();
            });
          }
          cx.notify();
        })
        .on_scroll_wheel((e, cx) => {
          this.scroll = Math.min(Math.max(0, this.scroll - e.delta.y), max);
          cx.notify();
        })
        .when(!g.cards.length, (el) => el.child(div().pt(20).text_color(t.dim).child("No agents here.")))
        .children(rows.map((i) => {
          const r = g.rows[i];
          // Keyed by what the row holds, so a row that moves (a scroll, an agent
          // added above) slides rather than being redrawn in place.
          const key = r.kind === "head" ? `mc-head-${r.section.space.id}` : `mc-row-${g.cards[r.items[0]].pane.pane}`;
          const body = r.kind === "head"
            ? this.head(r.section, t)
            : h_flex().gap(GAP).children(r.items.map((c) => this.card(g.cards[c], c, g.cardWidth, at, t)));
          return div().id(key).absolute().left(0).right(0).top(r.top - this.scroll).h(r.height).spring("top", SPRING)
            .child(this.enter(div().id(`${key}-in`).size_full(), delay(i)).child(body));
        }))
        .when(Boolean(ring), (el) => el.child(div()
          .id("mc-ring")
          .absolute()
          .left(ring.left)
          .top(ring.top - this.scroll)
          .w(g.cardWidth)
          .h(CARD)
          .spring("left", SPRING)
          .spring("top", SPRING)
          .child(this.enter(div().id("mc-ring-in").size_full(), delay(g.cards[at].row)).rounded(8).border(2).border_color(t.accent)))));
  }
}
