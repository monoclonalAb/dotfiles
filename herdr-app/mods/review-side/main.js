// Review mode's right column: the open pull request's Info (checks,
// reviewers and labels in step 2, findings in step 5) and its Chat with a Pi
// agent (steps 6 and 7).
// Review mode is the `review` layout (C-a p from `eric`, C-a p again goes
// back); docs/plans/active/2026-11-25-review-mode.md builds it step by step.
// review-nav puts the open pull request in the shared "review-mode.open".

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { shared, theme } from "herdr";

const OPEN = "review-mode.open";

const REVIEW = { REQUESTED: "requested", APPROVED: "approved", CHANGES_REQUESTED: "changes requested", COMMENTED: "commented", DISMISSED: "dismissed", PENDING: "pending" };

// One line per reviewer: "teammate · approved".
export const reviewerLines = (pr) => (pr?.reviewers ?? []).map((r) => `${r.name} · ${REVIEW[r.state] ?? r.state.toLowerCase()}`);

export default class ReviewSide extends View {
  render() {
    const t = theme();
    const pr = shared(OPEN);
    const heading = (text) => div().pt(10).text_size(11).font_semibold().text_color(t.muted).child(text);
    const line = (text, color = t.foreground) => div().truncate().text_size(12).text_color(color).child(text);
    const checks = pr?.checks;
    const tone = { SUCCESS: t.done, FAILURE: t.blocked, ERROR: t.blocked, PENDING: t.working, EXPECTED: t.working }[checks?.state] ?? t.muted;
    return v_flex().id("review-side").size_full()
      .child(h_flex().h(36).px(12).gap(14).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Info"))
        .child(div().text_size(12).text_color(t.dim).child("Chat")))
      .child(!pr
        ? div().flex_1()
        : v_flex().id("review-side-info").flex_1().overflow_y_scrollbar().px(12).pb(12).gap(2)
          .child(heading("Checks"))
          .child(line(checks?.total ? `${checks.passed}/${checks.total} passed` : "none", checks?.total ? tone : t.muted))
          .child(heading("Reviewers"))
          .children(reviewerLines(pr).length ? reviewerLines(pr).map((text) => line(text)) : [line("none", t.muted)])
          .child(heading("Labels"))
          .child(line(pr.labels.length ? pr.labels.join(", ") : "none", pr.labels.length ? t.foreground : t.muted)));
  }
}
