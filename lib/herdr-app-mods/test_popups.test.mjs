// node --test lib/herdr-app-mods/*.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { loadMod } from "./load.mjs";

const { clipboardLink } = await loadMod("popups");

test("C-a R takes the clipboard only when it holds a pull request link alone", () => {
  assert.equal(clipboardLink("https://github.com/monoclonalAb/dotfiles/pull/8"), "https://github.com/monoclonalAb/dotfiles/pull/8");
  assert.equal(clipboardLink("  https://github.com/o/r/pull/12/files#diff-1\n"), "https://github.com/o/r/pull/12/files#diff-1");
  assert.equal(clipboardLink("https://github.com/o/r/issues/12"), null);
  assert.equal(clipboardLink("see https://github.com/o/r/pull/12 for why"), null);
  assert.equal(clipboardLink(undefined), null);
});
