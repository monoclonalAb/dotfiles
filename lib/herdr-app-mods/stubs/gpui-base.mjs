// Stand-in for the app's gpui-base.
import { div } from "./gpui-kit.mjs";

export { div as h_flex, div as v_flex };

// Text input state and its frame: inert.
const state = { on: () => true, value: () => "", set_value: () => {}, focus: () => {}, release: () => true };
export const InputState = { new: () => state };
export const Input = { new: () => div() };

// Markdown text and a scroll position: inert.
export const TextView = { markdown: () => div(), html: () => div() };
export const ScrollHandle = { new: () => ({ scroll_to_item: () => {}, offset: () => ({ x: 0, y: 0 }) }) };
