// Review mode's middle column: the open pull request's header and
// description (step 2), and the diff of the file picked in the Files view
// (step 3). With props { part: "bar" } it is the layout's top bar instead:
// the strip that drags the window, with room for the window buttons on the
// left and the open pull request's name.
// Review mode is the `review` layout (C-a p from `eric`, C-a p again goes
// back); docs/plans/active/2026-11-25-review-mode.md builds it step by step.
// review-nav puts the open pull request in the shared "review-mode.open", its
// snapshot in "review-mode.snapshot" and the picked file in "review-mode.file".
// The diff comes from the snapshot, never from the branch as it is now, in
// pieces of at most 2000 lines (bin/review-analyse diff).

import { View, div, uniform_list } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { exec, home, settings, shared, theme } from "herdr";

const OPEN = "review-mode.open", SNAPSHOT = "review-mode.snapshot", FILE = "review-mode.file", VIEWED = "review-mode.viewed";
const ROW = 18;

// A theme colour with alpha ("22" of "ff"), or null if it isn't #rrggbb[aa].
const faint = (color, alpha) => (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color ?? "") ? `${color.slice(0, 7)}${alpha}` : null);

// "✓ 3/3 checks", "✗ 2/3 checks", "… 1/3 checks", or "no checks".
export function checksText(checks) {
  if (!checks?.total) return "no checks";
  const sign = { SUCCESS: "✓", FAILURE: "✗", ERROR: "✗", PENDING: "…", EXPECTED: "…" }[checks.state] ?? "";
  return `${sign ? `${sign} ` : ""}${checks.passed}/${checks.total} checks`;
}

export const meta = (pr) =>
  `${pr.repo} #${pr.number} · ${pr.author} · ${pr.base} ← ${pr.head} · ${pr.files} ${pr.files === 1 ? "file" : "files"} +${pr.additions} −${pr.deletions} · ${checksText(pr.checks)}`;

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

export default class ReviewPage extends View {
  init(props) {
    this.bar = props?.part === "bar";
    this.diff = null; // { key, lines, more, loading, error, tooLarge }
    this.height = 0; // of the diff's lines area, which a uniform_list needs
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
        const r = await exec(`${home()}/.local/bin/review-analyse`, ["diff", file.pr, file.snapshot, file.path, "--from", String(diff.lines.length)], { timeout: 60000 });
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
    if (this.bar) {
      return h_flex().id("review-bar").size_full().pl(84).pr(14).gap(10).items_center()
        .child(div().flex_none().text_size(13).font_semibold().text_color(t.foreground).child("Review"))
        .child(div().flex_1().truncate().text_size(12).text_color(t.muted).child(pr ? `${pr.repo} #${pr.number} · ${pr.title}` : ""))
        .child(div().flex_none().text_size(12).text_color(t.muted).child("C-a p ⇄ agents"));
    }
    if (!pr) {
      return v_flex().id("review-page").size_full().items_center().justify_center()
        .child(div().text_size(13).text_color(t.muted).child("No pull request open. Pick one on the left."));
    }
    const snap = shared(SNAPSHOT);
    const file = shared(FILE);
    const entry = file && snap?.status === "ready" && snap.snapshot === file.snapshot && file.pr === pr.url
      ? snap.files.find((f) => f.path === file.path) : null;
    return v_flex().id("review-page").size_full()
      .child(v_flex().px(18).pt(14).pb(10).gap(4).border_b(1).border_color(t.border)
        .child(h_flex().gap(10).items_center()
          .child(div().flex_1().truncate().text_size(16).font_semibold().text_color(t.foreground).child(pr.title))
          .child(div().flex_none().text_size(11).text_color(pr.gone || pr.draft ? t.dim : t.done).child(pr.gone ? "No longer listed" : pr.draft ? "Draft" : "Open")))
        .child(div().truncate().text_size(12).text_color(t.muted).child(meta(pr))))
      .child(entry ? this.renderDiff(t, pr, file, entry, cx) : this.renderDescription(t, pr));
  }

  renderDescription(t, pr) {
    return v_flex().id(`review-page-body-${pr.id}`).flex_1().overflow_y_scrollbar().px(18).py(12).gap(14)
      .child(div().text_size(11).font_semibold().text_color(t.muted).child("Description"))
      .child(pr.body.trim()
        ? TextView.markdown(`review-description-${pr.id}`, pr.body).raw_html(false).selectable(true)
        : div().text_size(13).text_color(t.dim).child("No description."));
  }

  renderDiff(t, pr, file, entry, cx) {
    if (this.diff?.key !== `${file.snapshot}\n${file.path}`) this.more(file, cx);
    const diff = this.diff;
    const viewed = shared(VIEWED)?.snapshot === file.snapshot && shared(VIEWED).paths.includes(file.path);
    const header = h_flex().px(18).py(8).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().truncate().text_size(12).font_semibold().text_color(t.foreground).child(entry.path))
      .when(!!entry.old_path, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`from ${entry.old_path}`)))
      .child(div().flex_none().text_size(11).text_color(t.done).child(entry.binary ? "binary" : `+${entry.additions}`))
      .child(div().flex_none().text_size(11).text_color(t.blocked).child(entry.binary ? "" : `−${entry.deletions}`))
      .child(div().flex_none().text_size(11).text_color(viewed ? t.done : t.dim).child(viewed ? "☑ Viewed" : "☐ Viewed"));
    if (entry.too_large || diff.tooLarge) {
      return v_flex().id("review-diff").flex_1().child(header)
        .child(v_flex().p(18).gap(8)
          .child(div().text_size(13).text_color(t.muted).child(`Too large to show here · ${entry.binary ? "binary" : `+${entry.additions} −${entry.deletions}`}`))
          .child(div().id("review-diff-github").text_size(12).text_color(t.accent).cursor_pointer()
            .on_click(() => exec("open", [`${pr.url}/files`]))
            .child("Open on GitHub ↗")));
    }
    const rows = numbered(diff.lines);
    const font = settings().font_family ?? "Maple Mono NF";
    const tint = { add: faint(t.done, "22"), del: faint(t.blocked, "22") };
    const ink = { hunk: t.accent, note: t.dim, add: t.foreground, del: t.foreground, same: t.foreground };
    const count = rows.length + (diff.more || diff.loading || diff.error ? 1 : 0);
    const list = this.height > 0 && uniform_list("review-diff-lines", count, (i) => `${diff.key}\n${i}`, (range, cx) => {
        const out = [];
        for (let i = range.start; i < range.end; i++) {
          const row = rows[i];
          if (!row) {
            out.push(div().id(`diff-more-${i}`).h(ROW).px(18).text_size(12).text_color(diff.error ? t.blocked : t.accent).cursor_pointer()
              .on_click((_e, cx) => { this.more(file, cx); cx.notify(); })
              .child(diff.error ?? (diff.loading ? "Loading…" : "Load 2000 more lines")));
            continue;
          }
          out.push(h_flex().id(`diff-${i}`).h(ROW).px(8).text_size(12).font_family(font).when(!!tint[row.kind], (el) => el.bg(tint[row.kind]))
            .child(div().w(44).flex_none().text_color(t.dim).child(row.old === null ? "" : String(row.old)))
            .child(div().w(44).flex_none().text_color(t.dim).child(row.new === null ? "" : String(row.new)))
            .child(div().flex_1().whitespace_nowrap().text_color(ink[row.kind]).child(row.text || " ")));
        }
        return out;
      }).h(this.height);
    return v_flex().id("review-diff").flex_1().child(header)
      .child(div().id("review-diff-body").flex_1()
        .on_size_change((size, cx) => {
          const height = size.height / (settings().zoom ?? 1);
          if (Math.abs(height - this.height) > 0.5) { this.height = height; cx.notify(); }
        })
        .when(!!list, (el) => el.child(list)));
  }
}
