// Selected, pinned agent-stuff commands. See README.md for provenance and local changes.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import answer from "./answer.ts";
import btw from "./btw.ts";
import goal from "./goal.ts";
import review from "./review.ts";
import sessionBreakdown from "./session-breakdown.ts";

export default function agentStuff(pi: ExtensionAPI) {
  answer(pi);
  btw(pi);
  goal(pi);
  review(pi);
  sessionBreakdown(pi);
}
