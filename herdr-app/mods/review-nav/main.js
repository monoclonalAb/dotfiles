// Review mode's left column: your pull requests and review requests (step 2),
// then the open pull request's files (step 3) and tour (step 4).
// Review mode is the `review` layout (C-a p from `eric`, C-a p again goes
// back); docs/plans/active/2026-11-25-review-mode.md builds it step by step.

import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { theme } from "herdr";

export default class ReviewNav extends View {
  render() {
    const t = theme();
    return v_flex().id("review-nav").size_full().p(12).gap(6)
      .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Pull requests"))
      .child(div().text_size(12).text_color(t.muted).child("The list arrives in step 2."));
  }
}
