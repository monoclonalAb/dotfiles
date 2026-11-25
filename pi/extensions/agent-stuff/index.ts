// Selected, pinned agent-stuff commands. See README.md for provenance and local changes.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import btw from "./btw.ts";
import goal from "./goal.ts";
import sessionBreakdown from "./session-breakdown.ts";

export default function agentStuff(pi: ExtensionAPI) {
  btw(pi);
  goal(pi);
  sessionBreakdown(pi);
}
