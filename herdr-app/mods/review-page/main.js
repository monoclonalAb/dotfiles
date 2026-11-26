// Review mode's middle column: the open pull request (steps 2 and 3). With
// props { part: "bar" } it is the layout's top bar instead: the strip that
// drags the window, with room for the window buttons on the left.
// Review mode is the `review` layout (C-a p from `eric`, C-a p again goes
// back); docs/plans/active/2026-11-25-review-mode.md builds it step by step.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";

export default class ReviewPage extends View {
  init(props) {
    this.bar = props?.part === "bar";
  }

  render() {
    const t = theme();
    if (this.bar) {
      return h_flex().id("review-bar").size_full().pl(84).pr(14).gap(10).items_center()
        .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Review"))
        .child(div().flex_1())
        .child(div().text_size(12).text_color(t.muted).child("C-a p ⇄ agents"));
    }
    return v_flex().id("review-page").size_full().items_center().justify_center()
      .child(div().text_size(13).text_color(t.muted).child("No pull request open."));
  }
}
