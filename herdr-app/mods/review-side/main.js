// Review mode's right column: the open pull request's Info (checks, reviewers
// and labels in step 2, findings in step 5) and its Chat with a Pi agent
// (steps 6 and 7).
// Review mode is the `review` layout (C-a p from `eric`, C-a p again goes
// back); docs/plans/active/2026-11-25-review-mode.md builds it step by step.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";

export default class ReviewSide extends View {
  render() {
    const t = theme();
    return v_flex().id("review-side").size_full()
      .child(h_flex().h(36).px(12).gap(14).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(12).font_semibold().text_color(t.foreground).child("Info"))
        .child(div().text_size(12).text_color(t.dim).child("Chat")))
      .child(div().flex_1());
  }
}
