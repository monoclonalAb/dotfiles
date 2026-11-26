// Review mode's middle column: the open pull request's header and
// description (step 2), then its diff (step 3). With props { part: "bar" } it
// is the layout's top bar instead: the strip that drags the window, with room
// for the window buttons on the left and the open pull request's name.
// Review mode is the `review` layout (C-a p from `eric`, C-a p again goes
// back); docs/plans/active/2026-11-25-review-mode.md builds it step by step.
// review-nav puts the open pull request in the shared "review-mode.open".

import { View, div } from "gpui-kit";
import { h_flex, v_flex, TextView } from "gpui-base";
import { shared, theme } from "herdr";

const OPEN = "review-mode.open";

// "✓ 3/3 checks", "✗ 2/3 checks", "… 1/3 checks", or "no checks".
export function checksText(checks) {
  if (!checks?.total) return "no checks";
  const sign = { SUCCESS: "✓", FAILURE: "✗", ERROR: "✗", PENDING: "…", EXPECTED: "…" }[checks.state] ?? "";
  return `${sign ? `${sign} ` : ""}${checks.passed}/${checks.total} checks`;
}

export const meta = (pr) =>
  `${pr.repo} #${pr.number} · ${pr.author} · ${pr.base} ← ${pr.head} · ${pr.files} ${pr.files === 1 ? "file" : "files"} +${pr.additions} −${pr.deletions} · ${checksText(pr.checks)}`;

export default class ReviewPage extends View {
  init(props) {
    this.bar = props?.part === "bar";
  }

  render() {
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
    return v_flex().id("review-page").size_full()
      .child(v_flex().px(18).pt(14).pb(10).gap(4).border_b(1).border_color(t.border)
        .child(h_flex().gap(10).items_center()
          .child(div().flex_1().truncate().text_size(16).font_semibold().text_color(t.foreground).child(pr.title))
          .child(div().flex_none().text_size(11).text_color(pr.gone || pr.draft ? t.dim : t.done).child(pr.gone ? "No longer listed" : pr.draft ? "Draft" : "Open")))
        .child(div().truncate().text_size(12).text_color(t.muted).child(meta(pr))))
      .child(v_flex().id(`review-page-body-${pr.id}`).flex_1().overflow_y_scrollbar().px(18).py(12).gap(14)
        .child(div().text_size(11).font_semibold().text_color(t.muted).child("Description"))
        .child(pr.body.trim()
          ? TextView.markdown(`review-description-${pr.id}`, pr.body).raw_html(false).selectable(true)
          : div().text_size(13).text_color(t.dim).child("No description."))
        .child(div().pt(8).text_size(12).text_color(t.dim).child("The diff arrives in step 3.")));
  }
}
