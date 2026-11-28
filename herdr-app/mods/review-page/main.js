// Review mode's middle column: the open pull request, under tabs.
// Description (its text), Files (the file picked in review-nav's Files view,
// as a diff of the snapshot) and Checks. With props { part: "bar" } it is
// the layout's top bar instead: the strip that drags the window, with room
// for the window buttons on the left.
// Review mode is the `review` layout (C-a p from `eric`, C-a p again goes
// back); docs/plans/active/2026-11-25-review-mode.md builds it step by step,
// and the Paper file "Review" (frames "D · Mix") is its design.
// review-nav shares the open pull request ("review-mode.open"), its snapshot
// ("review-mode.snapshot"), the picked file ("review-mode.file") and the tab
// ("review-mode.tab"). The diff comes from the snapshot, never from the
// branch as it is now, in pieces of at most 2000 lines (bin/review-analyse).

import { View, div, uniform_list } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { exec, home, props, settings, setShared, shared, theme } from "herdr";

const OPEN = "review-mode.open", SNAPSHOT = "review-mode.snapshot", FILE = "review-mode.file", VIEWED = "review-mode.viewed";
const TAB = "review-mode.tab", TOGGLE = "review-mode.toggle";
const ROW = 24;
const PAD = 48; // the page's side margin

const mono = () => settings().font_family ?? "Maple Mono NF";
// A theme colour with alpha ("17" of "ff"), or null if it isn't #rrggbb[aa].
const faint = (color, alpha) => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color ?? "") ? `${color.slice(0, 7)}${alpha}` : null);
const green = (t) => t.ansi2 ?? t.done;

const STATE = {
  ready: ["Ready to merge", "green"], failing: ["CI failing", "blocked"], running: ["Checks running", "working"],
  conflicts: ["Conflicts", "blocked"], changes: ["Changes requested", "blocked"], review: ["Review required", "working"],
  draft: ["Draft", "dim"], blocked: ["Blocked", "working"], unknown: ["Unknown", "dim"],
};
const stateOf = (t, pr) => {
  if (pr.gone) return ["No longer listed", t.dim];
  const [label, tone] = STATE[pr.chip] ?? STATE.unknown;
  return [label, tone === "green" ? green(t) : t[tone]];
};

// The tabs and their counts: files from the snapshot once it is in.
export function tabsFor(pr, snap) {
  const files = snap?.status === "ready" ? (snap.changed_files ?? snap.files?.length ?? null) : (pr.files ?? null);
  return [
    { key: "description", label: "Description", count: null },
    { key: "files", label: "Files", count: files },
    { key: "checks", label: "Checks", count: pr.checks?.total || null },
  ];
}

// "3 hours ago", as GitHub says it.
export function ago(iso, now = Date.now()) {
  const at = Date.parse(iso ?? "");
  if (Number.isNaN(at)) return null;
  const s = Math.max(0, (now - at) / 1000);
  const say = (n, unit) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (s < 60) return "just now";
  if (s < 3600) return say(Math.floor(s / 60), "minute");
  if (s < 86400) return say(Math.floor(s / 3600), "hour");
  return say(Math.floor(s / 86400), "day");
}

// Asks review-nav, which keeps the state file, to tick or untick the file.
export function toggleViewed(file) {
  setShared(TOGGLE, { pr: file.pr, snapshot: file.snapshot, path: file.path, nonce: `${Date.now()}-${Math.random()}` });
}

// Unified diff lines (from the first hunk header on) with their kind and old
// and new line numbers.
export function numbered(lines) {
  let old = 0, now = 0;
  return lines.map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      old = Number(hunk[1]);
      now = Number(hunk[2]);
      return { kind: "hunk", old: null, new: null, text };
    }
    if (text.startsWith("+")) return { kind: "add", old: null, new: now++, text };
    if (text.startsWith("-")) return { kind: "del", old: old++, new: null, text };
    if (text.startsWith("\\")) return { kind: "note", old: null, new: null, text };
    return { kind: "same", old: old++, new: now++, text };
  });
}

const chip = (t, text) => div().px(8).py(3).rounded(6).bg(t.chrome).text_size(14).font_family(mono()).text_color(t.foreground).child(text);
const keyChip = (t, k) => div().px(6).py(1).rounded(5).bg(t.chrome).text_size(12).font_family(mono()).text_color(t.muted).child(k);

export default class ReviewPage extends View {
  init() {
    this.bar = props()?.part === "bar";
    this.diff = null; // { key, lines, more, loading, error, tooLarge }
    this.height = 0; // of the diff's box, which a uniform_list needs
  }

  // Loads the next piece of the shown file's diff.
  more(file, cx) {
    const key = `${file.snapshot}\n${file.path}`;
    if (this.diff?.key !== key) this.diff = { key, lines: [], more: true };
    if (this.diff.loading || !this.diff.more) return;
    const diff = this.diff;
    diff.loading = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec(`${home()}/.local/bin/review-analyse`, ["diff", file.pr, file.snapshot, "--from", String(diff.lines.length), "--", file.path], { timeout: 60000 });
        if (r.code !== 0) throw new Error((r.stderr || `review-analyse exited ${r.code}`).trim().replace(/^review-analyse: /, ""));
        const piece = JSON.parse(r.stdout);
        diff.lines = diff.lines.concat(piece.lines);
        diff.more = piece.more;
        diff.tooLarge = piece.too_large;
        diff.error = null;
      } catch (e) {
        diff.error = String(e?.message ?? e).split("\n")[0];
        diff.more = false;
      }
      diff.loading = false;
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    const pr = shared(OPEN);
    if (this.bar) return this.renderBar(t, pr);
    if (!pr) {
      return v_flex().id("review-page").size_full().items_center().justify_center().gap(8)
        .child(div().text_size(20).font_extrabold().text_color(t.foreground).child("No pull request open"))
        .child(div().text_size(15).text_color(t.muted).child("Pick one on the left with j, k and ↵."));
    }
    const snap = shared(SNAPSHOT);
    const pinned = snap?.status === "ready" && snap.pr === pr.url;
    const tab = shared(TAB) ?? "description";
    const body = tab === "files" ? this.renderFiles(t, pr, snap, cx) : tab === "checks" ? this.renderChecks(t, pr) : this.renderDescription(t, pr);
    return v_flex().id("review-page").size_full()
      .child(tab === "files" ? this.renderTitleLine(t, pr) : this.renderTitle(t, pr, pinned ? snap : null))
      .child(this.renderTabs(t, pr, pinned ? snap : null, tab))
      .child(body);
  }

  renderBar(t, pr) {
    const slash = (text) => div().text_size(14).text_color(t.dim).child(text);
    return h_flex().id("review-bar").size_full().pl(92).pr(24).gap(10).items_center()
      .child(div().flex_none().text_size(15).font_extrabold().text_color(t.foreground).child("Review"))
      .when(!!pr, (el) => el
        .child(slash("/"))
        .child(div().flex_none().text_size(14).font_bold().text_color(t.muted).child(pr.repo.split("/").pop()))
        .child(slash("/"))
        .child(div().flex_none().text_size(14).font_bold().text_color(t.foreground).child(`#${pr.number}`)))
      .child(div().flex_1())
      .child(keyChip(t, "⌃A P"))
      .child(div().flex_none().text_size(13).text_color(t.muted).child("back to agents"));
  }

  // The large title, who wants to merge what, and its size.
  renderTitle(t, pr, snap) {
    const [label, tone] = stateOf(t, pr);
    const when = ago(pr.created);
    const files = snap ? (snap.changed_files ?? snap.files.length) : pr.files;
    const add = snap ? snap.additions : pr.additions, del = snap ? snap.deletions : pr.deletions;
    const author = pr.author || "someone";
    return v_flex().flex_none().gap(22).pt(40).px(PAD).pb(26)
      .child(v_flex().gap(14)
        .child(h_flex().gap(10).items_center()
          .child(div().flex_none().text_size(13).font_extrabold().text_color(tone).child(label.toUpperCase()))
          .child(div().truncate().text_size(13).text_color(t.dim).child(`${pr.repo} #${pr.number}${when ? ` · opened ${when}` : ""}`)))
        .child(div().text_size(40).line_height(46).font_extrabold().text_color(t.foreground).child(pr.title)))
      .child(h_flex().gap(14).items_center()
        .child(div().size(28).flex_none().rounded_full().bg(t.accent).flex().items_center().justify_center()
          .child(div().text_size(13).font_extrabold().text_color(t.accent_foreground ?? t.background).child(author[0].toUpperCase())))
        .child(h_flex().flex_none().gap(5)
          .child(div().text_size(16).font_bold().text_color(t.foreground).child(author))
          .child(div().text_size(16).text_color(t.muted).child("wants to merge")))
        .child(chip(t, pr.head))
        .child(div().flex_none().text_size(16).text_color(t.muted).child("into"))
        .child(chip(t, (snap?.base ?? pr.base)))
        .child(div().flex_1())
        .child(div().flex_none().text_size(15).text_color(t.muted).child(`${files} ${files === 1 ? "file" : "files"}`))
        .child(div().flex_none().text_size(14).font_family(mono()).text_color(green(t)).child(`+${add}`))
        .child(div().flex_none().text_size(14).font_family(mono()).text_color(t.blocked).child(`−${del}`)));
  }

  // In the Files tab the title takes one line, leaving the room to the code.
  renderTitleLine(t, pr) {
    const [label, tone] = stateOf(t, pr);
    return h_flex().flex_none().gap(14).items_baseline().pt(26).px(PAD).pb(6)
      .child(div().flex_none().text_size(13).font_extrabold().text_color(tone).child(label.toUpperCase()))
      .child(div().truncate().text_size(26).font_extrabold().text_color(t.foreground).child(pr.title));
  }

  renderTabs(t, pr, snap, tab) {
    return h_flex().flex_none().gap(26).px(PAD).border_b(1).border_color(t.border)
      .children(tabsFor(pr, snap).map((x) => {
        const on = x.key === tab;
        return v_flex().id(`tab-${x.key}`).cursor_pointer()
          .on_click((_e, cx) => { setShared(TAB, x.key); cx.notify(); })
          .child(h_flex().gap(7).items_center().pt(16).px(4).pb(13)
            .child(div().text_size(15).when(on, (el) => el.font_extrabold().text_color(t.foreground)).when(!on, (el) => el.font_bold().text_color(t.muted)).child(x.label))
            .when(x.count !== null, (el) => el.child(div().px(7).rounded(8).text_size(12).font_extrabold()
              .text_color(on ? t.accent : t.muted).bg(on ? (faint(t.accent, "24") ?? t.chrome) : t.chrome).child(String(x.count)))))
          .child(div().h(3).rounded(2).when(on, (el) => el.bg(t.accent)));
      }));
  }

  renderDescription(t, pr) {
    return v_flex().id(`review-description-${pr.id}`).flex_1().overflow_y_scrollbar().px(PAD).py(30)
      .child(pr.body.trim()
        ? v_flex().max_w(900).child(TextView.markdown(`review-description-text-${pr.id}`, pr.body).raw_html(false).selectable(true).text_size(16).text_color(t.foreground))
        : div().text_size(16).text_color(t.dim).child("No description."));
  }

  renderChecks(t, pr) {
    const c = pr.checks ?? {};
    const [headline, tone] = !c.total ? ["No checks", t.dim]
      : c.state === "SUCCESS" ? [`All ${c.total} passed`, green(t)]
        : c.state === "FAILURE" || c.state === "ERROR" ? [`${c.total - c.passed} of ${c.total} not passing`, t.blocked]
          : c.state === "PENDING" || c.state === "EXPECTED" ? ["Still running", t.working]
            : [`${c.passed} of ${c.total} passed`, t.muted];
    return v_flex().flex_1().px(PAD).py(30).gap(12)
      .child(div().text_size(28).font_extrabold().text_color(tone).child(headline))
      .when(!!c.total, (el) => el.child(div().text_size(16).text_color(t.muted).child(`${c.passed} of ${c.total} passed or skipped`)))
      .child(div().id("review-checks-github").pt(6).text_size(15).font_bold().text_color(t.accent).cursor_pointer()
        .on_click(() => exec("open", [`${pr.url}/checks`]))
        .child("Open the checks on GitHub ↗"));
  }

  renderFiles(t, pr, snap, cx) {
    const file = shared(FILE);
    const entry = file && snap?.status === "ready" && snap.pr === pr.url && snap.snapshot === file.snapshot
      ? snap.files.find((f) => f.path === file.path) : null;
    if (!entry) {
      const text = snap?.status === "error" ? snap.error : snap?.status === "loading" ? "Taking a snapshot…" : "No file picked.";
      return div().px(PAD).py(30).text_size(16).text_color(snap?.status === "error" ? t.blocked : t.muted).child(text);
    }
    const v = shared(VIEWED);
    const viewed = !!v && v.snapshot === file.snapshot && v.pr === file.pr && v.paths.includes(file.path);
    const slash = entry.path.lastIndexOf("/");
    const header = h_flex().flex_none().gap(14).items_center().pt(18).px(PAD).pb(14)
      .child(h_flex().min_w(0)
        .when(slash > 0, (el) => el.child(div().flex_none().text_size(15).font_family(mono()).text_color(t.dim).child(entry.path.slice(0, slash + 1))))
        .child(div().truncate().text_size(15).font_family(mono()).font_bold().text_color(t.foreground).child(entry.path.slice(slash + 1))))
      .when(!!entry.old_path, (el) => el.child(div().flex_none().text_size(13).text_color(t.dim).child(`from ${entry.old_path}`)))
      .when(!entry.binary, (el) => el
        .child(div().flex_none().text_size(13).font_family(mono()).text_color(green(t)).child(`+${entry.additions}`))
        .child(div().flex_none().text_size(13).font_family(mono()).text_color(t.blocked).child(`−${entry.deletions}`)))
      .child(div().flex_1())
      .child(h_flex().id("review-viewed").flex_none().gap(8).items_center().px(12).py(6).rounded(8).border(1).border_color(t.border).cursor_pointer()
        .hover((st) => st.bg(t.hover))
        .on_click((_e, cx) => { toggleViewed(file); cx.notify(); })
        .child(viewed
          ? div().size(16).rounded(4).bg(green(t)).flex().items_center().justify_center().child(div().text_size(11).font_black().text_color(t.accent_foreground ?? t.background).child("✓"))
          : div().size(16).rounded(4).border(1).border_color(t.input ?? t.border))
        .child(div().text_size(14).font_bold().text_color(t.foreground).child("Viewed"))
        .child(keyChip(t, "v")));
    if (entry.too_large || this.diff?.tooLarge) {
      return v_flex().flex_1().min_h(0).child(header)
        .child(v_flex().px(PAD).py(24).gap(10)
          .child(div().text_size(20).font_extrabold().text_color(t.foreground).child("Too large to show here"))
          .child(div().text_size(15).text_color(t.muted).child(entry.binary ? "A binary file." : `+${entry.additions} −${entry.deletions} lines`))
          .child(div().id("review-diff-github").text_size(15).font_bold().text_color(t.accent).cursor_pointer()
            .on_click(() => exec("open", [`${pr.url}/files`]))
            .child("Open on GitHub ↗")));
    }
    if (this.diff?.key !== `${file.snapshot}\n${file.path}`) this.more(file, cx);
    const diff = this.diff;
    const rows = numbered(diff.lines);
    const count = rows.length + (diff.more || diff.loading || diff.error ? 1 : 0);
    const tint = { add: faint(green(t), "17"), del: faint(t.blocked, "17") };
    const gutter = { add: faint(green(t), "29"), del: faint(t.blocked, "29") };
    const sign = { add: ["+", green(t)], del: ["−", t.blocked] };
    const number = (n, kind) => h_flex().w(56).h(ROW).flex_none().justify_end().items_center().pr(10)
      .when(!!gutter[kind], (el) => el.bg(gutter[kind]))
      .child(div().text_size(13).font_family(mono()).text_color(t.dim).child(n === null ? "" : String(n)));
    const list = this.height > 0 && uniform_list("review-diff-lines", count, (i) => `${diff.key}\n${i}`, (range) => {
      const out = [];
      for (let i = range.start; i < range.end; i++) {
        const row = rows[i];
        if (!row) {
          out.push(h_flex().id(`diff-more-${i}`).h(ROW).px(16).items_center().cursor_pointer()
            .on_click((_e, cx) => { this.more(file, cx); cx.notify(); })
            .child(div().text_size(13).text_color(diff.error ? t.blocked : t.accent).child(diff.error ?? (diff.loading ? "Loading…" : "Load 2000 more lines"))));
        } else if (row.kind === "hunk") {
          const [, at, rest] = /^(@@[^@]*@@)(.*)$/.exec(row.text) ?? [null, row.text, ""];
          out.push(h_flex().id(`diff-${i}`).h(ROW).px(16).items_center().bg(t.chrome)
            .child(div().flex_none().text_size(13).font_family(mono()).text_color(t.accent).child(at))
            .child(div().whitespace_nowrap().text_size(13).font_family(mono()).text_color(t.muted).child(rest || " ")));
        } else if (row.kind === "note") {
          out.push(h_flex().id(`diff-${i}`).h(ROW).px(16).items_center()
            .child(div().whitespace_nowrap().text_size(13).font_family(mono()).text_color(t.dim).child(row.text.slice(2))));
        } else {
          out.push(h_flex().id(`diff-${i}`).h(ROW).items_center().when(!!tint[row.kind], (el) => el.bg(tint[row.kind]))
            .child(number(row.old, row.kind))
            .child(number(row.new, row.kind))
            .child(div().w(24).flex_none().text_center().text_size(14).font_family(mono()).text_color(sign[row.kind]?.[1] ?? t.dim).child(sign[row.kind]?.[0] ?? ""))
            .child(div().whitespace_nowrap().text_size(14).font_family(mono()).text_color(t.foreground).child(row.text.slice(1) || " ")));
        }
      }
      return out;
    }).h(Math.max(0, this.height - 2));
    return v_flex().flex_1().min_h(0).child(header)
      .child(v_flex().flex_1().min_h(0).px(PAD).pb(24)
        .child(div().id("review-diff-box").flex_1().min_h(0).rounded(10).border(1).border_color(t.border).overflow_hidden()
          .on_size_change((size, cx) => {
            const height = size.height / (settings().zoom ?? 1);
            if (Math.abs(height - this.height) > 0.5) { this.height = height; cx.notify(); }
          })
          .when(!!list, (el) => el.child(list))));
  }
}
