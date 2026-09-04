import assert from "node:assert/strict";
import test from "node:test";
import { registerHerdrTaskSummary } from "./index.ts";
import {
  EMPTY_SESSION_SUMMARY,
  HERDR_SUMMARY_SOURCE,
  HERDR_SUMMARY_TOKEN,
  latestTaskSummary,
  reportTaskSummary,
  summarizeUserRequest,
  type CommandRunner,
} from "./summary.ts";

test("summary removes a standalone clipboard image and safe request boilerplate", () => {
  assert.equal(
    summarizeUserRequest(
      "/var/folders/x/T/pi-clipboard-123.png\n\nCould you please fix the sidebar labels?",
    ),
    "Fix the sidebar labels",
  );
  assert.equal(
    summarizeUserRequest([
      { type: "image", data: "ignored" },
      { type: "text", text: "I'd like you to review the auth flow, please." },
    ]),
    "Review the auth flow",
  );
  assert.equal(
    summarizeUserRequest(
      "Can you remove the /var/folders/x/T/pi-clipboard-123.png redundant storage?",
    ),
    "Remove the redundant storage",
  );
  assert.equal(
    summarizeUserRequest("Wait I mean I want you to use Vim-style navigation"),
    "Use Vim-style navigation",
  );
});

test("summary skips image-only and non-descriptive follow-ups", () => {
  assert.equal(summarizeUserRequest("/tmp/pi-clipboard-123.webp"), undefined);
  assert.equal(summarizeUserRequest([{ type: "image", data: "ignored" }]), undefined);
  assert.equal(summarizeUserRequest("Okay, sounds good!"), undefined);
  assert.equal(summarizeUserRequest("Can you do that for me?"), undefined);
  assert.equal(summarizeUserRequest("Okay can you do that for me"), undefined);
  assert.equal(summarizeUserRequest("/reload"), undefined);
  assert.equal(summarizeUserRequest("j /reload"), undefined);
  assert.equal(
    summarizeUserRequest("spin up a new pi instance and do that for me"),
    undefined,
  );
});

test("summary turns conversational requests into a concise task phrase", () => {
  assert.equal(
    summarizeUserRequest(
      "Currently, if I just have a Pi conversation open, it shows me an empty title /tmp/pi-clipboard.png. Can you make it non-empty with placeholder text?",
    ),
    "Fix empty Pi conversation title",
  );

  const summary = summarizeUserRequest(
    "/tmp/pi-clipboard.png\n\nAlso this doesnt really tell me much, is it possible to come up with like a few word distinct summary about what this agent is doing?",
  );
  assert.equal(summary, "Create a concise agent task summary");
  assert.ok((summary?.split(/\s+/u).length ?? 0) <= 6);
});

test("summary truncates deterministically at word and character boundaries", () => {
  const request = "Please investigate the unexpectedly complicated authentication callback behavior in production";
  assert.equal(
    summarizeUserRequest(request),
    "Investigate the unexpectedly complicated authentication callback",
  );

  const summary = summarizeUserRequest(request, 48);
  assert.equal(summary, "Investigate the unexpectedly complicated…");
  assert.ok(Array.from(summary ?? "").length <= 48);
});

test("latest summary walks backward past boilerplate and image paths", () => {
  const entries = [
    { type: "message", message: { role: "user", content: "Fix stale cache invalidation" } },
    { type: "message", message: { role: "assistant", content: [] } },
    { type: "message", message: { role: "user", content: "continue" } },
    { type: "message", message: { role: "user", content: "/tmp/pi-clipboard-x.png" } },
  ];
  assert.equal(latestTaskSummary(entries), "Fix stale cache invalidation");
});

test("metadata reporting is inert outside Herdr and reports or clears one Pi token", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const run: CommandRunner = async (command, args) => {
    calls.push({ command, args });
    return { code: 0 };
  };

  assert.equal(await reportTaskSummary("Fix labels", {}, run), false);
  assert.deepEqual(calls, []);

  const environment = {
    HERDR_ENV: "1",
    HERDR_PANE_ID: "w1:p2",
    HERDR_BIN_PATH: "/opt/herdr",
  };
  assert.equal(await reportTaskSummary("Fix labels", environment, run), true);
  assert.deepEqual(calls[0], {
    command: "/opt/herdr",
    args: [
      "pane",
      "report-metadata",
      "w1:p2",
      "--source",
      HERDR_SUMMARY_SOURCE,
      "--agent",
      "pi",
      "--token",
      `${HERDR_SUMMARY_TOKEN}=Fix labels`,
    ],
  });

  assert.equal(await reportTaskSummary(undefined, environment, run), true);
  assert.deepEqual(calls[1]?.args.slice(-2), ["--clear-token", HERDR_SUMMARY_TOKEN]);
});

test("metadata failures stay best-effort", async () => {
  const environment = { HERDR_ENV: "1", HERDR_PANE_ID: "w1:p2" };
  assert.equal(
    await reportTaskSummary("Task", environment, async () => ({ code: 1 })),
    false,
  );
  assert.equal(
    await reportTaskSummary("Task", environment, async () => {
      throw new Error("socket unavailable");
    }),
    false,
  );
});

test("extension gives an empty session a placeholder summary", async () => {
  let reportedSummary: string | undefined;
  const handlers = new Map<string, (...args: any[]) => Promise<void>>();
  const pi = {
    on(name: string, handler: (...args: any[]) => Promise<void>) {
      handlers.set(name, handler);
    },
    async exec(_command: string, args: string[]) {
      reportedSummary = args.at(-1)?.split("=").slice(1).join("=");
      return { code: 0, stdout: "", stderr: "", killed: false };
    },
  };
  registerHerdrTaskSummary(pi as never, {
    HERDR_ENV: "1",
    HERDR_PANE_ID: "w1:p2",
  });

  await handlers.get("session_start")?.({}, {
    sessionManager: { getBranch: () => [] },
  });

  assert.equal(reportedSummary, EMPTY_SESSION_SUMMARY);
});

test("extension restores existing-session metadata and observes finalized user messages", async () => {
  const handlers = new Map<string, (...args: any[]) => Promise<void>>();
  const calls: string[][] = [];
  const pi = {
    on(name: string, handler: (...args: any[]) => Promise<void>) {
      handlers.set(name, handler);
    },
    async exec(_command: string, args: string[]) {
      calls.push(args);
      return { code: 0, stdout: "", stderr: "", killed: false };
    },
  };
  registerHerdrTaskSummary(pi as never, {
    HERDR_ENV: "1",
    HERDR_PANE_ID: "w1:p2",
  });

  await handlers.get("session_start")?.({}, {
    sessionManager: {
      getBranch: () => [
        { type: "message", message: { role: "user", content: "Please repair session restore" } },
      ],
    },
  });
  await handlers.get("message_end")?.({
    message: { role: "user", content: "Could you verify the live sidebar?" },
  });
  await handlers.get("message_end")?.({ message: { role: "user", content: "continue" } });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.at(-1), `${HERDR_SUMMARY_TOKEN}=Repair session restore`);
  assert.equal(calls[1]?.at(-1), `${HERDR_SUMMARY_TOKEN}=Verify the live sidebar`);
});
