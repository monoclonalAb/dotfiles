---
name: agent-test-author
description: Authors, audits, and bulk-generates `*.agent-test.ts` files for the prompt-behemoth framework (`withTrace`, `mockTool`, `httpRun`, `toSatisfyRubric`, `harness`, `tool`, `playwrightTools`). Covers two patterns — agentic-system-under-test AND non-agentic SUT (website, service, GraphQL endpoint) exercised by an LLM-driven tester. Three modes plus free-text suggestions. Use when the user says "scaffold an agent test", "write an agent test for X", "audit the agent tests", "build agent tests for the repo", "find files missing agent tests", "test this website with an agent", "use an agent to test this service", or invokes `/agent-test-author`. Also handles test-driver helpers and in-scope harness/tool implementation, and writes `it.fails()` negative cases when appropriate.
---

# agent-test-author

Authors `*.agent-test.ts` files for the prompt-behemoth framework. Two distinct patterns are supported:

- **Agentic SUT** — the *system under test* is itself an LLM workflow / Hono agent. The test calls it and judges its output.
- **Agent-as-tester** — the SUT is *not* agentic (a website, a REST/GraphQL service, a CLI). The framework spins up an LLM driver via `harness` with tools (Playwright, HTTP, custom) so the agent exercises the SUT like a QA tester would. The rubric judges **the SUT's behavior**, not the agent's.

Both patterns share the same primitives. The author's first job is to decide which pattern fits and frame the test accordingly.

Operates in **three modes** plus a **free-text** escape hatch.

## Execution boundary

Read repository instructions, installed package exports/examples, and canonical
scripts first. The API examples below describe this skill's expected framework;
if the installed version differs, ground changes in its source instead of
inventing compatibility.

These are **live-model integration tests**, not offline unit tests. Before running,
confirm the test dataset is allowed to reach the provider, non-model external
writes are isolated, credentials are available without displaying their values,
and the run has an authorised model-call/cost budget. If not, write or validate
what can be checked locally and report the live run as blocked/not run. The
real-model requirement is not permission to spend without scope or export data.

## Framework primer (read this once per session)

The framework is published as `@everyday-artificial-intelligence/prompt-behemoth` and exports:

- `describe`, `it`, `expect` — vitest-style test API (`it.fails(...)` is supported for negative cases).
- `withTrace(opts, fn)` — wraps a workflow call, returns `{ output, trace }`. `opts.mocks` accepts `mockTool({...})` entries.
- `mockTool({ name, url, method, respond })` — intercepts an outbound HTTP call. Recorded on `trace.toolCalls`.
- `httpRun(app, { method, path, body })` — drives a Hono `app` over a synthetic request; returns `{ status, body }`.
- `toSatisfyRubric([{ id, rule }, ...])` — async rubric-based assertion judged by an LLM.
- `harness({ persona, tools, mocks?, maxSteps? }, body)` — runs an LLM as a driver with the given tools, streams `SessionEvent`s, returns `{ result, trace }`. Use this for both agentic-SUT and agent-as-tester patterns.
- `tool({ name, description, parameters, run })` — author-defined tool. `run(args, ctx)` returns any JSON-serialisable value.
- `httpTool(...)`, `click(...)`, `navigate(...)` — shortcuts bound to a Hono `app.request()` (in-process). Not for live URLs.
- `playwrightTools({ page })` — returns nine tools (`browser_navigate`, `browser_click`, `browser_click_by_role`, `browser_click_by_text`, `browser_fill`, `browser_fill_by_role`, `browser_get_text`, `browser_get_text_by_role`, `browser_snapshot`) bound to a real Playwright `Page`. Use for browser-based SUTs.
- `complete(...)` — direct OpenRouter call (used by simple workflows).

Tests live **next to source** as `<name>.agent-test.ts`. Import from the package: `import { ... } from '@everyday-artificial-intelligence/prompt-behemoth'`. **Exception:** when authoring tests *inside the prompt-behemoth repo itself* (e.g. under `examples/`), import via the relative path `../../src/index.js` (with the `.js` extension) — the package isn't installed in its own node_modules. Detect which context you're in by checking whether the current `package.json` is the framework's own (`"name": "@everyday-artificial-intelligence/prompt-behemoth"`) or a consumer's.

Canonical patterns to study before writing anything. **Path resolution:** inside the prompt-behemoth repo itself, paths below are relative to repo root (`examples/...`). In a consumer repo, prefix with `node_modules/@everyday-artificial-intelligence/prompt-behemoth/` — the `examples/` directory ships with the package.
- `examples/email-de/` — agentic SUT (LLM workflow), judged by rubric.
- `examples/sales-chat/` — agentic SUT (chat agent), harness drives a persona that interacts via a single `send_message` tool.
- `examples/record-merge/` — agentic SUT making tool-driven decisions; rubric judges the agent.
- `examples/browser-signup/` — **non-agentic SUT** (static signup page). The harness uses `playwrightTools` to let the LLM exercise the website. Rubric and hard assertions judge **the website**.

## Choosing the pattern

Before writing the test, decide which pattern applies:

| What is being tested | Pattern | What the rubric judges |
|---|---|---|
| An LLM workflow / agentic Hono app / `harness(...)` you import, **single-turn** (one input → one output, no state across calls) | Agentic SUT — one-shot | The SUT's output and decisions |
| A chatbot or conversational workflow whose correctness depends on state / context built up across multiple turns (even if the entry point is a single-message function) | Agentic SUT — multi-turn | The SUT's behaviour across the full conversation |
| A static page, REST/GraphQL endpoint, multi-page UI flow, CLI | Agent-as-tester | The SUT's observable behavior, as reported by the driver agent |

**The defining question**: is the LLM the *thing being judged* or the *instrument doing the observing*?

**Within agentic SUT, the second defining question**: does correctness depend on state built up across turns? If yes — multi-turn, drive it with `harness` + a persona, even if the underlying function takes a single message. The entry point is a single turn; the policy lives across turns. A scripted single-call test only snapshots one frame of the behaviour. Chatbots, "process one message of a thread" workflows, and any SUT whose feature description uses words like *conversation*, *flow*, *back-and-forth*, *follow-up*, or *stages* fall here — match on the **feature**, not on the entry-point shape.

### Pattern-specific rules

**Agentic SUT — one-shot**
- Call the SUT inside `withTrace` and assert on the returned output + trace. This is the right shape ONLY when one input fully determines one output.

**Agentic SUT — multi-turn**
- Drive the SUT via `harness({ persona, tools })`. The persona is the *tester*, role-playing the user (or, for multi-party SUTs like a concierge with both a tenant and a landlord, a dual-role tester with one tool per party).
- Each tool wraps one call into the SUT and threads conversation state through whatever the SUT expects — an outer `history` ref, an in-memory store the SUT reads/writes, or seeded persistence the SUT looks up.
- Capture each call's return in an outer log array (e.g. `sendLog.push(reply)`) so hard `expect()` assertions can interrogate per-turn shape. Author tools are NOT recorded on `trace.toolCalls` — that field is for `mockTool` HTTP records. Don't try to read tool results off the trace; capture them yourself.
- Rubric judges the **full session trace** for policy compliance across the whole conversation. Hard `expect()` covers per-turn deterministic facts (e.g. "first reply has zero landlord routes", "by the end at least one landlord message exists").
- Mock every external **write** the SUT makes (POST/PUT/PATCH/DELETE, mutations). Leave **reads** (GET, lookups, search) unmocked unless the test needs deterministic data — then mock the specific read.
- Rubric criteria phrased as "**The agent** did X" / "**The response** had Y."

**Agent-as-tester**
- Pre-create whatever resource the SUT needs (Playwright `Browser`/`Page`, Hono app, GraphQL endpoint).
- Build a `tools` array via `playwrightTools({ page })` and/or custom `tool({...})` wrappers.
- Frame the persona as a tester: "You are a QA agent driving …" plus a concrete task.
- **Prefer hard `expect()` assertions on observable SUT state** (DOM, response body, DB row). Use rubrics for things only the trace can witness — error messages the user saw, ordering of events, whether the SUT echoed the right value back.
- Rubric criteria phrased as "**The website/service** did X" — never about how the agent chose to drive it.
- For tests that exercise *one* SUT branch, pre-seed unrelated inputs via direct Playwright/HTTP so the agent only varies the field under test. Otherwise the agent's exploratory behavior makes the test flaky.
- Avoid rubrics that scan the whole trace for "no error ever appeared" — agents often submit-then-correct. Phrase end-state criteria as "by the final snapshot …".

## Mode dispatch

Pick the mode from what the user said. If genuinely ambiguous, ask once.

| User intent | Mode |
|---|---|
| "write/scaffold an agent test for `path/to/file.ts`" | `scaffold` |
| "test this website / service with an agent" | `scaffold` (agent-as-tester) |
| "audit the agent tests" / "are the tests stale" | `audit` |
| "build agent tests for the whole repo" / "fill in missing tests everywhere" | `build` |
| anything else (tweaks, additions, "add a negative case for X") | `free-text` |

## Mode: `scaffold <target>`

Goal: produce a working `<name>.agent-test.ts`.

1. **Identify the SUT and pattern.** Is the target an LLM workflow (agentic SUT) or a non-agentic system the user wants an agent to test? Read the target file or, for a website/service, ask what the entry point is (URL, app, endpoint). Pick the pattern from the table above.
2. **Read 1–2 existing `*.agent-test.ts` files in the same pattern** for style/import. Match them. For agent-as-tester, `examples/browser-signup/` is the reference. **For agentic SUT — multi-turn, you MUST read `examples/sales-chat/sales-chat.agent-test.ts` before writing**, even if the nearest in-repo agent test is one-shot. Picking the wrong sub-pattern by copying the closest sibling is the #1 failure mode here.
3. **Decide the test surface**:
   - Plain async export → call it directly inside `withTrace`.
   - Exported Hono `app` → use `httpRun` against the right route, or wrap in an `httpTool` if an agent drives it.
   - Exported `harness` → drive it with a persona and assert on the trace + final output.
   - Browser SUT → launch Chromium in the test, hand `page` to `playwrightTools`.
   - HTTP/GraphQL SUT with no Hono app → write a custom `tool({...})` whose `run` does `fetch(...)`.
4. **Mock writes, allow reads.** Policy: every *write* (mutating) call the SUT makes to an external service must be mocked via `mockTool` so the test never produces real-world side effects (emails sent, rows inserted, payments charged, webhooks fired). *Reads* (GET / idempotent lookups, search APIs, public data fetches) may hit the real service and should not be mocked unless determinism requires it. Classify by HTTP method and intent — `POST`/`PUT`/`PATCH`/`DELETE` and any RPC/GraphQL mutation are writes; `GET`/`HEAD` and read-only queries are reads. When in doubt, treat it as a write. Use real URLs/methods extracted from source — don't invent endpoints. For agent-as-tester over a real network resource, the same rule applies: intercept writes, let reads through. **Never mock AI/LLM services** (Anthropic, OpenAI, Bedrock, Gemini, Vertex, any model inference endpoint) — the LLM call is the thing under test (or the thing doing the testing); a mocked model invalidates the rubric and the trace. Do not offer to mock it, do not ask the user whether to mock it, do not add a `mockTool` for `api.anthropic.com` / `api.openai.com` / equivalents. Real model calls only, even for writes.
5. **Pre-seed state when isolating a branch.** If only one SUT input varies in the test, set the others directly (e.g. `page.fill('#name', '...')` before `harness` runs). Reserve agent tool calls for the variable under test.
6. **Write hard assertions on the SUT first.** `expect(await page.textContent('#x')).toBe('y')`, `expect(res.status).toBe(200)`, `expect(trace.toolCalls.find(c => c.name === 'sendEmail')).toBeTruthy()`. These should cover every deterministic fact.
7. **Write the rubric** (`toSatisfyRubric`) for what *isn't* deterministically assertable — qualitative reading of the trace, "the error called out the bad value", "the agent stayed professional", etc. 2–5 criteria. Phrase the subject correctly for the pattern (SUT for agent-as-tester, agent for agentic SUT).
8. **Decide negative cases per file.** 0–2 `it.fails(...)` cases when:
   - The prompt/SUT makes a strong claim → input crafted to violate it.
   - You want to demonstrate what a failing rubric looks like.
9. **Keep test drivers separate from production features.** Put test-only
   `tool({...})` wrappers in the test or existing test helpers. Add a production
   harness/tool only when the requested implementation needs it; do not ship a
   TODO stub merely to satisfy a test scaffold. Report missing behaviour as a gap.
10. **Write the test file, then run it.** Confirm the command from `package.json`. For browser tests, ensure `pnpm exec playwright install chromium` has been mentioned in case the user hasn't run it. Fix mechanical failures (import paths, mock URLs, type errors) in up to 3 attempts. Don't loosen rubrics to make tests pass — surface the real failure.

## Mode: `audit`

Goal: bring existing `*.agent-test.ts` files back in sync with source. **Fix issues directly**, then print a summary.

1. Find every `*.agent-test.ts` under the repo (skip `node_modules`, `dist`).
2. For each test, cross-check against current source:
   - **Drifted imports** — file moved/renamed, symbol renamed. Fix the import path/name.
   - **Stale mocks** — `mockTool` URL/method no longer matches what the source actually calls. Fix or remove.
   - **Missing write mocks** — source added a new external **write** (POST/PUT/PATCH/DELETE, mutation) with no mock. Add one — writes must never hit the real world from a test.
   - **Over-mocked reads** — `mockTool` intercepting a GET/read-only call without a determinism reason. Remove the mock and let the real read through, per policy.
   - **Mocked AI/LLM service** — any `mockTool` targeting an inference endpoint (Anthropic, OpenAI, Bedrock, Gemini, Vertex, etc.). Remove it. Real model calls only.
   - **Type drift** — asserted output shape no longer matches the return type. Fix.
   - **Rubric rot** — the prompt or SUT changed materially but the rubric still talks about the old behavior. Update.
   - **Wrong pattern framing** — if the rubric judges the agent but the agent is the *tester*, rewrite criteria to judge the SUT. (Or vice versa.)
   - **Pre-seed gaps** — agent-as-tester tests that flake because the agent explores → add Playwright/HTTP pre-seeding for fields not under test.
3. Apply fixes in place. Run the affected tests to confirm.
4. Print a summary at the end: per-file list of what changed, plus any judgment calls flagged for the user.

## Mode: `build`

Goal: agent tests for the whole repo, end-to-end, no per-file confirmation.

1. **Walk the repo** (skip `node_modules`, `dist`, `bin`). For each file decide whether it warrants an agent test:
   - Anything constructing a `harness(...)` or exporting agentic behavior → agentic SUT.
   - Hono apps / route handlers that wrap an LLM → agentic SUT.
   - User-facing HTTP/GraphQL endpoints with non-trivial behavior → consider agent-as-tester.
   - Static HTML pages / multi-step UI flows colocated in the repo → agent-as-tester via Playwright.
   - Code that calls an external provider with decision points the prompt drives → agentic SUT.
2. **Skip** files that already have a sibling `*.agent-test.ts`, pure utility/data-shape modules, type-only files, dead code.
3. For each chosen file/system, run the `scaffold` procedure (picking the right pattern). Don't ask between files.
4. After all files are written, run the **full** test suite and fix mechanical failures iteratively.
5. End with a summary: files created, files skipped (with one-line reason), tests passing/failing.

## Mode: `free-text`

Anything else — "add a case where the email is in Spanish", "tighten the rubric on `email.agent-test.ts`", "use an agent to test the checkout flow", "what's a good negative case for `record-merge`?". Apply the same framework knowledge but follow the user's specific ask.

## Hard rules

- **Chatbots and multi-turn workflows MUST be driven by `harness` + persona, never scripted.** If the SUT's feature is "have a conversation", "process a thread", "manage a flow across stages", or "respond to a user over time", drive it with a persona even when the underlying function takes a single message. Match on the feature shape, not on the entry-point signature. A scripted single-call test only snapshots one frame of the policy.
- **Author tools (`tool({...})`) are NOT recorded on `trace.toolCalls`.** That field is only for `mockTool` HTTP records. To inspect per-turn return values, push into an outer log array inside `run` and assert against the log.
- **Identify the SUT explicitly.** Comment at the top of every agent-test should state what's under test and who's driving. Example: `// SUT: signup-page.html. Harness runs an LLM as a QA tester.`
- **Never invent URLs, method names, or types.** Read the source or ask. If the SUT is external, ask for the endpoint.
- **Imports use the package name** `@everyday-artificial-intelligence/prompt-behemoth` in consumer repos. Only when authoring tests *inside the prompt-behemoth repo itself* use the relative path `../../src/index.js` (with the `.js` extension). Never invent a `src/...` import in a consumer repo — only `dist/` is published.
- **Before importing a subpath from any third-party package, check its `package.json` `exports` field.** If `exports` only declares `"."`, only the package root is importable; subpath imports like `pkg/dist/foo.js` will fail under bundlers that honour `exports` (vite/esbuild/modern Node) — typically surfacing as `externalize-deps`-triggered errors or `Package subpath '...' is not defined by 'exports'`. Don't copy a library's *internal* relative import (e.g. `./dist/reporter.js`) and prepend the package name; that doesn't translate. Prefer the package root: grep the package's `dist/index.{js,d.ts}` for the symbol — if it's re-exported there, import from the root.
- **When authoring a project-local `agent-test.config.ts` in a consumer repo (to add aliases or plugins the bundled CLI can't), import `RubricReporter` from the package root** (`@everyday-artificial-intelligence/prompt-behemoth`) or the dedicated `/reporter` subpath — never from `/dist/reporter.js`. Pair that config with a script: `AGENT_TEST_RUNNER=1 vitest run --config agent-test.config.ts` — the env var replaces what the bundled CLI sets to unblock `describe`/`it` and register the rubric matcher.
- **One `describe` per file, `it` blocks for cases.** Match existing voice in test names.
- **Rubric criteria must be falsifiable** — "the confirmation page displayed the exact email submitted" not "the website worked well."
- **Pattern-correct subject in rubrics.** Agent-as-tester → "The website/service did X." Agentic SUT → "The agent did X."
- **Prefer hard `expect()` for deterministic SUT facts.** Rubrics are for qualitative observations that depend on reading the trace.
- **End-state rubrics, not whole-trace rubrics**, for "did the SUT end up in state X" questions. Agents may submit-then-correct; that's fine if the end state is right.
- **Mocks recorded on `trace.toolCalls`** — assert via `trace.toolCalls[i]` (`name`, `method`, `requestBody`).
- **Mocking policy: mock writes, allow reads.** All mutating external calls (POST/PUT/PATCH/DELETE, GraphQL mutations, any RPC with side effects) MUST be mocked so tests cause zero real-world side effects. Read-only calls (GET/HEAD, queries, lookups) should hit the real service and only be mocked when determinism (fixed payload, offline run) requires it. When unsure whether a call mutates, treat it as a write and mock it.
- **Never mock AI/LLM services.** Model inference endpoints (Anthropic, OpenAI, Bedrock, Gemini, Vertex, any LLM provider) are exempt from the write-mock rule — they must hit the real service. The LLM call is either the SUT or the test driver; a mocked model defeats the test. Do not propose, ask about, or implement a mock for these.
- **`it.fails()` is not for skipping** — it asserts the test body throws. Only use when you genuinely expect failure.
- **Don't add comments narrating what the test does** beyond the SUT/driver header. Test names already do that.
- **Don't downgrade a rubric to make a test pass.** If the rubric is right and the output is wrong, surface it.

## Quick scaffold checklists

### Agentic SUT — one-shot
```ts
// SUT: <module>. Harness exercises it directly; rubric judges the agent.
import { describe, it, expect, withTrace, mockTool /*, harness, tool, httpRun */ } from '@everyday-artificial-intelligence/prompt-behemoth';
import { workflowUnderTest } from './workflow.js';

describe('workflow', () => {
  it('does X when Y', async () => {
    const { output, trace } = await withTrace(
      { mocks: [mockTool({ name: '...', url: '...', method: 'POST', respond: () => ({ status: 200, body: {} }) })] },
      () => workflowUnderTest({ /* ... */ }),
    );
    expect(output.something).toBe('...');
    await expect(trace).toSatisfyRubric([
      { id: 'criterion', rule: 'The agent did X.' },
    ]);
  });
});
```

### Agentic SUT — multi-turn (chat / conversational)
```ts
// SUT: <module>. Persona drives the SUT turn-by-turn via a `send_message` tool;
// rubric judges the full session trace.
import { describe, it, expect, harness, tool /*, mockTool */ } from '@everyday-artificial-intelligence/prompt-behemoth';
import { stepOfSUT } from './workflow.js';

describe('<feature>', () => {
  it('exhibits multi-turn policy X', async () => {
    // Outer state: capture per-turn results so `expect()` can interrogate them.
    // Author tools are NOT recorded on trace.toolCalls — log here yourself.
    const sendLog: Array<{ reply: string; /* per-turn shape */ }> = [];

    // If the SUT reads/writes state (DB, firestore), pre-seed via a hermetic
    // in-memory mock or a sandbox keyed off a per-test id. WRITES are mocked;
    // READS in the same collection are served by the same in-memory store.

    const sendMessage = tool({
      name: 'send_message',
      description: 'Send a message to the SUT as the user and read the reply.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['message'],
        properties: { message: { type: 'string' } },
      },
      run: async (args) => {
        const reply = await stepOfSUT({ /* threadId, message, ... */ });
        sendLog.push(reply);
        return reply;
      },
    });

    const { trace } = await harness(
      {
        persona: {
          system: 'You are role-playing <user>. <personality + behaviour rules>.',
          task: 'Drive the conversation. Start <vague>. Respond to follow-ups with <facts>. End once <condition>.',
        },
        tools: [sendMessage],
        maxSteps: 8,
      },
      async (session) => {
        for await (const event of session.events()) if (event.kind === 'final') break;
      },
    );

    // Hard assertions on per-turn shape (don't read these off trace.toolCalls).
    expect(sendLog.length).toBeGreaterThanOrEqual(2);
    expect(sendLog[0] /* first-turn invariant */).toMatchObject({ /* ... */ });

    // Rubric judges the WHOLE conversation against the policy.
    await expect(trace).toSatisfyRubric([
      { id: 'policy_step_a', rule: 'The agent did A before doing B.' },
      { id: 'policy_step_b', rule: 'By the end the agent had done B.' },
    ]);
  }, 600_000);
});
```

For multi-party SUTs (e.g. a concierge between a tenant and a landlord), use one tool per party (`send_tenant_message`, `send_landlord_message`) and a dual-role persona that knows which tool corresponds to which speaker. Both tools push to the same `sendLog`. Seed any pre-conversation state (prior thread messages, milestones) before calling `harness` so the SUT picks up mid-flow.

### Agent-as-tester (browser)
```ts
// SUT: <page>.html. Harness runs an LLM as a QA tester; rubric judges the WEBSITE.
import { chromium } from 'playwright';
import { describe, it, expect, harness, playwrightTools } from '@everyday-artificial-intelligence/prompt-behemoth';

describe('<page>', () => {
  it('exhibits behavior X when the user does Y', async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    try {
      // Pre-seed any fields NOT under test.
      await page.goto(FIXTURE_URL);
      await page.fill('#unrelated', 'value');

      const { trace } = await harness(
        {
          persona: {
            system: 'You are a QA agent driving a real web browser. Use snapshot/role/text tools and report what the website did.',
            task: 'Concrete instructions for the variable under test.',
          },
          tools: playwrightTools({ page }),
          maxSteps: 12,
        },
        async (session) => {
          for await (const event of session.events()) if (event.kind === 'final') break;
        },
      );

      // Hard assertions on observable SUT state.
      expect(await page.textContent('#result')).toBe('expected');

      // Rubric for trace-only observations.
      await expect(trace).toSatisfyRubric([
        { id: 'website_did_x', rule: 'The website displayed X after Y.' },
      ]);
    } finally {
      await page.close();
      await browser.close();
    }
  }, 180_000);
});
```

### Agent-as-tester (HTTP / GraphQL)
Replace `playwrightTools` with custom `tool({...})` wrappers that `fetch()` the SUT. Same framing: pre-seed via direct calls, hard-assert observable response/DB state, rubric for trace observations.
