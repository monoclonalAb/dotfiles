// Conversation picker: Spotlight for conversations. `C-a w` and `Cmd-P` run
// mod.open:conversation-picker, which drops this from the top of the window
// (again: closes it). It replaces the app's own picker (tabs and Spaces) on
// those keys.
//
// Type a few letters of a conversation's title, Space, branch, named tab,
// program, machine or environment. Every agent in every Space is searched,
// Personal and Work alike; plain shells are left out. Each typed word must match
// somewhere; title matches rank first, and among equals the one visited last.
// The best match is the "Top hit" and is selected, so Enter goes straight to it.
//
// With nothing typed the list is "Recent": conversations by last visit (shared
// "pane-keys.recent", kept by pane-keys), the one you are in last, so `C-a w`
// then Enter goes back to the previous conversation.
//
// The right half previews the selection: its title, where it lives, and the last
// lines of its screen (`hc read`, every 2 s while open; nothing is typed into or
// resized). ↑/↓ or Ctrl-n/p move, Enter or a click goes, Esc closes.
//
// Motion is the app's native kind (no timers): results slide to their new places
// as you type, the selection glides, and the list grows and shrinks.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, agents, terminals, focused, run, hc, theme, settings, shared, props, closeOverlay } from "herdr";

// Sizes in px at zoom 1.
export const ROW = 46; // a result
export const HEAD = 26; // a heading over results
export const VISIBLE = 8; // results shown before the list scrolls
const SEARCH = 58; // the search field's row
const LIST = 400; // the results column's width
const MIN_BODY = HEAD + 5 * ROW; // tall enough for the preview
const MAX_BODY = 2 * HEAD + VISIBLE * ROW;
const EMPTY = 64; // the "nothing matches" row
const FOOTER = 30;
const LINE = 12; // one screen line in the preview
const FONT = 9.5;
const REFRESH = 2000;
const SPRING = { response: 200, damping: 1 };
const RESIZE = { duration: 160, easing: "ease-out" };

export const RECENT = "pane-keys.recent";

// --- Rules (pure; tested by lib/herdr-app-mods) ------------------------------

// A conversation's title: spaces-tree's conversationTitle, copied because a mod
// is one file (lib/herdr-app-mods checks the copies agree). Pi's task summary,
// else the program's own title when it tells more than its folder, else a named
// tab, else the program.
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

// Every agent with a pane, as the search sees it, in the sidebar's Space order
// (`order`: shared "spaces-tree.order"), then the app's. `env`: shared
// "spaces-env" (null: no environments).
export function conversations({ agentList, paneList, spaceList, terminalList, order, env, here }) {
  const paneOf = new Map(paneList.map((p) => [p.pane, p]));
  const spaceOf = new Map(spaceList.map((s) => [s.id, s]));
  const termOf = new Map(terminalList.map((x) => [x.address, x]));
  const rank = new Map((Array.isArray(order) ? order : []).map((id, i) => [id, i]));
  const at = (a) => rank.get(a.space) ?? Infinity;
  return agentList
    .filter((a) => paneOf.has(a.pane))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => at(x.a) - at(y.a) || x.i - y.i)
    .map(({ a }) => {
      const pane = paneOf.get(a.pane);
      const space = spaceOf.get(a.space);
      const tab = (space?.tabs ?? []).find((x) => x.id === a.tab);
      const term = termOf.get(a.address);
      const spaceName = space?.name ?? a.space_name ?? "";
      const { text, strong } = conversationTitle({
        summary: term?.labels?.task_summary, pending: term?.labels?.task_summary_pending === "1",
        title: a.title, address: a.address, cwd: pane.cwd, spaceName, tabName: tab?.name, tabNamed: tab?.named, program: a.program?.name,
      });
      return {
        address: a.address,
        pane: a.pane,
        title: text,
        strong,
        space: spaceName,
        spaceId: a.space,
        branch: pane.branch ?? space?.branch ?? "",
        tab: tab?.named ? tab.name : "",
        folder: pane.cwd ? base(pane.cwd) : "",
        machine: space?.machine ?? "",
        env: env?.assign ? (env.assign[a.space] ?? "personal") : "",
        program: a.program?.name ?? "",
        icon: a.program ?? null,
        status: a.status,
        here: a.address === here,
      };
    });
}

const wordsOf = (text) => text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

// The shortest stretch of `text` holding `word`'s letters in order, or Infinity.
function spread(word, text) {
  let best = Infinity;
  for (let start = text.indexOf(word[0]); start >= 0; start = text.indexOf(word[0], start + 1)) {
    let i = start;
    for (const ch of word.slice(1)) {
      i = text.indexOf(ch, i + 1);
      if (i < 0) return best;
    }
    best = Math.min(best, i - start + 1);
  }
  return best;
}

// How well one typed word (lower case) matches one text: 0 for not at all.
// Whole text, its start, a word's start, anywhere, the words' initials ("fl":
// "fix login"), then its letters close together ("lgn": "login").
export function wordScore(word, text) {
  const s = (text ?? "").toLowerCase();
  if (!word || !s) return 0;
  if (s === word) return 100;
  if (s.startsWith(word)) return 80;
  const words = wordsOf(s);
  if (words.some((w) => w.startsWith(word))) return 60;
  if (s.includes(word)) return 40;
  if (word.length > 1 && words.map((w) => w[0]).join("").includes(word)) return 30;
  if (word.length > 1 && spread(word, s) <= Math.max(2 * word.length, word.length + 3)) return 10;
  return 0;
}

// What each field of a conversation is worth when a word matches it.
export const FIELDS = [["title", 1], ["space", 0.7], ["branch", 0.6], ["tab", 0.6], ["program", 0.5], ["folder", 0.5], ["machine", 0.5], ["env", 0.4]];

// A conversation's score for `query`: each word's best field, added up, plus a
// bonus when the whole query starts or is in the title. Null when a word matches
// nothing.
export function matchScore(query, c) {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let total = 0;
  for (const word of q.split(/\s+/)) {
    let best = 0;
    for (const [field, weight] of FIELDS) best = Math.max(best, wordScore(word, c[field]) * weight);
    if (!best) return null;
    total += best;
  }
  const title = (c.title ?? "").toLowerCase();
  if (title.startsWith(q)) total += 50;
  else if (title.includes(q)) total += 20;
  return total;
}

// The results in order. Nothing typed: by last visit (`recent`: addresses, most
// recent first), never-visited ones in sidebar order, the one you are in last.
// Typed: the matches by score, then the one you are in last, then by last visit.
export function rank(list, query, recent) {
  const visit = new Map((Array.isArray(recent) ? recent : []).map((address, i) => [address, i]));
  const last = (c) => visit.get(c.address) ?? Infinity;
  const rows = list.map((c, i) => ({ c, i, s: matchScore(query, c) }));
  const byVisit = (a, b) => a.c.here - b.c.here || last(a.c) - last(b.c) || a.i - b.i;
  if (!query.trim()) return rows.sort(byVisit).map((r) => r.c);
  return rows.filter((r) => r.s).sort((a, b) => b.s - a.s || byVisit(a, b)).map((r) => r.c);
}

// Where the list's headings and results go: "Recent" over everything with
// nothing typed; else "Top hit" over the first and "Conversations" over the rest.
export function listLayout(count, query) {
  const items = [];
  const typed = Boolean(query.trim());
  let y = 0;
  const head = (text) => {
    items.push({ kind: "head", text, top: y });
    y += HEAD;
  };
  for (let i = 0; i < count; i++) {
    if (i === 0) head(typed ? "Top hit" : "Recent");
    if (typed && i === 1) head("Conversations");
    items.push({ kind: "row", index: i, top: y });
    y += ROW;
  }
  return { items, height: y };
}

// The scroll that shows result `at` whole, with the heading right above it,
// moving as little as it can.
export function reveal(lay, at, scroll, height) {
  const max = Math.max(0, lay.height - height);
  const k = lay.items.findIndex((it) => it.kind === "row" && it.index === at);
  if (k < 0) return Math.min(Math.max(0, scroll), max);
  const row = lay.items[k];
  const top = lay.items[k - 1]?.kind === "head" ? lay.items[k - 1].top : row.top;
  if (top < scroll) return Math.max(0, top);
  if (row.top + ROW > scroll + height) return Math.min(max, row.top + ROW - height);
  return Math.min(Math.max(0, scroll), max);
}

// The last `count` lines of a screen, without trailing spaces and with runs of
// blank lines folded to one (mission-control's tail).
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

// --- The mod ------------------------------------------------------------------

// The sidebar's dots, so a result looks like its sidebar row.
const GLYPH = { blocked: "\u25c6", review: "\u25cf", working: "\u25d0", idle: "\u25cb" };
const SPIN = ["\u25d0", "\u25d3", "\u25d1", "\u25d2"];
const TONE = { blocked: "blocked", review: "done", working: "working", idle: "idle" };
const SAYS = { blocked: "Needs you", review: "To review", working: "Working", idle: "Idle" };
const fallbackDot = (status) => (status === "blocked" ? "blocked" : status === "done" ? "review" : status === "working" ? "working" : "idle");
const dotOf = (c) => (shared("next-agent.dots") ?? {})[c.address] ?? fallbackDot(c.status);
const capital = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const where = (c) => [c.space, c.branch && c.branch !== c.space ? c.branch : "", c.tab, c.machine].filter(Boolean).join(" \u00b7 ");

function icon(p, size, color) {
  if (!p?.icon) return null;
  return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}

function mark(d, t) {
  return d === "working"
    ? div().w(12).flex_none().text_size(11).text_color(t.working).frames(SPIN, 180)
    : div().w(12).flex_none().text_size(11).text_color(t[TONE[d]] ?? t.dim).child(GLYPH[d] ?? GLYPH.idle);
}

export default class ConversationPicker extends View {
  init(_props, cx) {
    this.query = "";
    this.pick = null; // the selected result's address; null: the first
    this.scroll = 0;
    this.screens = {}; // address: screen text, or null when it could not be read
    this.reading = new Set();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Go to a conversation" });
    this.input.on("change", (_e, cx) => {
      this.query = this.input.value();
      this.pick = null;
      this.scroll = 0;
      this.read(cx);
      cx.notify();
    });
    this.input.on("submit", () => this.go(this.model().selected));
    this.input.focus();
    // The app's picker focuses again once the popup has settled; so does this.
    cx.timer.after(600, () => this.input.focus());
    this.read(cx);
    cx.timer.every(REFRESH, (cx) => this.read(cx));
  }

  model() {
    const here = focused()?.terminal ?? null;
    const list = conversations({
      agentList: agents(), paneList: panes(), spaceList: spaces(), terminalList: terminals(),
      order: shared("spaces-tree.order"), env: shared("spaces-env"), here,
    });
    const results = rank(list, this.query, shared(RECENT));
    let at = this.pick ? results.findIndex((c) => c.address === this.pick) : 0;
    if (at < 0) at = 0;
    return { total: list.length, results, at, selected: results[at] ?? null };
  }

  // The selected conversation's screen; a read already running for it skips.
  read(cx) {
    const address = this.model().selected?.address;
    if (!address || this.reading.has(address)) return;
    this.reading.add(address);
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["read", address]);
        this.screens[address] = r.code === 0 ? r.stdout : null;
      } catch {
        this.screens[address] = null;
      } finally {
        this.reading.delete(address);
      }
      cx.notify();
    });
  }

  dismiss() {
    closeOverlay(props()?.overlay);
  }

  go(c) {
    if (!c) return;
    this.dismiss();
    run("pane.focus", { pane: c.pane });
  }

  row(c, selected, activeEnv, t) {
    const d = dotOf(c);
    const away = activeEnv && c.env && c.env !== activeEnv;
    return h_flex()
      .size_full()
      .px(12)
      .gap(10)
      .items_center()
      .rounded(8)
      .cursor_pointer()
      .when(!selected, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => this.go(c))
      .child(mark(d, t))
      .child(v_flex()
        .flex_1()
        .min_w(0)
        .gap(1)
        .child(div().truncate().text_size(13).text_color(selected || c.strong ? t.foreground : t.muted).when(selected, (el) => el.font_semibold()).child(c.title))
        .child(div().truncate().text_size(11).text_color(t.dim).child(where(c) || c.program)))
      .when(d === "blocked" || d === "review", (el) => el.child(div().flex_none().text_size(11).text_color(d === "blocked" ? t.blocked : t.done).child(SAYS[d])))
      .when(c.here, (el) => el.child(div().flex_none().text_size(11).text_color(t.accent).child("here")))
      .when(Boolean(away), (el) => el.child(div().flex_none().px(6).py(1).rounded(5).border(1).border_color(t.border).text_size(10.5).text_color(t.dim).child(capital(c.env))));
  }

  preview(c, t) {
    const d = dotOf(c);
    const screen = this.screens[c.address];
    const lines = screen === undefined ? [] : screen === null ? null : tail(screen, 60);
    const pic = icon(c.icon, 13, t.muted);
    const about = [c.program, SAYS[d], c.env ? capital(c.env) : ""].filter(Boolean).join(" \u00b7 ");
    return v_flex()
      .flex_1()
      .min_w(0)
      .h_full()
      .p(14)
      .gap(6)
      .border_l(1)
      .border_color(t.border)
      .child(h_flex().gap(8).items_start()
        .child(div().pt(2).child(mark(d, t)))
        .child(div().flex_1().min_w(0).text_size(14.5).font_semibold().text_color(t.foreground).child(c.title)))
      .child(div().truncate().text_size(12).text_color(t.muted).child(where(c) || c.folder || "\u2014"))
      .child(h_flex().gap(6).items_center().text_size(11.5).text_color(d === "blocked" ? t.blocked : d === "review" ? t.done : t.dim)
        .when(Boolean(pic), (el) => el.child(pic))
        .child(div().truncate().child(about)))
      .child(v_flex()
        .flex_1()
        .min_h(0)
        .mt(6)
        .px(10)
        .py(8)
        .rounded(8)
        .border(1)
        .border_color(t.border)
        .bg(t.background)
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
    const m = this.model();
    const q = this.query.trim();
    const lay = listLayout(m.results.length, q);
    const body = m.results.length ? Math.min(Math.max(lay.height, MIN_BODY), MAX_BODY) : EMPTY;
    this.scroll = Math.min(Math.max(0, this.scroll), Math.max(0, lay.height - body));
    const sel = lay.items.find((it) => it.kind === "row" && it.index === m.at);
    const shown = lay.items.filter((it) => it.top + ROW > this.scroll - body && it.top < this.scroll + 2 * body);
    const activeEnv = shared("spaces-env")?.active ?? null;
    const empty = !m.total ? "No conversations are running." : `No conversation matches \u201c${q}\u201d.`;
    const count = q ? `${m.results.length} of ${m.total} conversations` : `${m.total} conversation${m.total === 1 ? "" : "s"}`;

    return v_flex()
      .id("conversation-picker")
      .track_focus(this.handle)
      .w_full()
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const mods = e.modifiers ?? {};
        const k = e.key;
        if (k === "escape") return this.dismiss();
        const step = k === "down" || (mods.control && k === "n") ? 1 : k === "up" || (mods.control && k === "p") ? -1 : 0;
        if (!step || !m.results.length) return;
        const next = Math.min(Math.max(m.at + step, 0), m.results.length - 1);
        this.pick = m.results[next].address;
        this.scroll = reveal(lay, next, this.scroll, body);
        this.read(cx);
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex()
        .h(SEARCH)
        .flex_none()
        .px(18)
        .gap(12)
        .items_center()
        .child(svg("mods/workspace-chrome/search.svg").size(18).flex_none().text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(18).text_color(t.foreground)))
      .child(h_flex()
        .id("cp-body")
        .h(body)
        .transition("height", RESIZE)
        .flex_none()
        .border_t(1)
        .border_color(t.border)
        .overflow_hidden()
        .when(!m.results.length, (el) => el.px(18).items_center().text_color(t.dim).child(empty))
        .when(m.results.length > 0, (el) => el
          .child(div()
            .id("cp-list")
            .w(LIST)
            .h_full()
            .flex_none()
            .relative()
            .overflow_hidden()
            .on_scroll_wheel((e, cx) => {
              this.scroll = Math.min(Math.max(0, this.scroll - e.delta.y), Math.max(0, lay.height - body));
              cx.notify();
            })
            .when(Boolean(sel), (el) => el.child(div()
              .id("cp-selection")
              .absolute()
              .left(6)
              .right(6)
              .top(sel.top - this.scroll)
              .h(ROW)
              .rounded(8)
              .bg(t.selected)
              .spring("top", SPRING)))
            // Keyed by what they hold, so a result the typing moves slides there.
            .children(shown.map((it) => {
              if (it.kind === "head") {
                return div().id(`cp-head-${it.text}`).absolute().left(0).right(0).top(it.top - this.scroll).h(HEAD).spring("top", SPRING)
                  .px(18).pt(9).text_size(11).font_semibold().text_color(t.dim).child(it.text);
              }
              const c = m.results[it.index];
              return div().id(`cp-row-${c.address}`).absolute().left(0).right(0).top(it.top - this.scroll).h(ROW).spring("top", SPRING)
                .px(6).child(this.row(c, it.index === m.at, activeEnv, t));
            })))
          .child(this.preview(m.selected, t))))
      .child(h_flex()
        .h(FOOTER)
        .flex_none()
        .px(18)
        .gap(12)
        .items_center()
        .border_t(1)
        .border_color(t.border)
        .text_size(11)
        .text_color(t.dim)
        .child(div().flex_1().child(count))
        .child("\u2191\u2193 select \u00b7 \u21b5 go \u00b7 Esc close"));
  }
}
