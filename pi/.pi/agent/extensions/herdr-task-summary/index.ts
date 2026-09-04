import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  EMPTY_SESSION_SUMMARY,
  latestTaskSummary,
  reportTaskSummary,
  summarizeUserRequest,
  type HerdrEnvironment,
  type UserContent,
} from "./summary.ts";

export function registerHerdrTaskSummary(
  pi: ExtensionAPI,
  environment: HerdrEnvironment = process.env as HerdrEnvironment,
) {
  const report = (summary: string | undefined) =>
    reportTaskSummary(
      summary,
      environment,
      (command, args) => pi.exec(command, args),
    );

  pi.on("session_start", async (_event, ctx) => {
    await report(
      latestTaskSummary(ctx.sessionManager.getBranch()) ?? EMPTY_SESSION_SUMMARY,
    );
  });

  pi.on("message_end", async (event) => {
    if (event.message.role !== "user") return;
    const content = event.message.content;
    if (typeof content !== "string" && !Array.isArray(content)) return;

    // Observe the finalized user message only. Returning nothing leaves both
    // the stored conversation and model-visible input exactly as Pi produced it.
    const summary = summarizeUserRequest(content as UserContent);
    if (summary) await report(summary);
  });
}

export default registerHerdrTaskSummary;
