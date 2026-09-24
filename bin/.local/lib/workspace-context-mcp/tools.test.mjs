import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { join } from "node:path";

import { createFixtureWorkspace } from "./fixture.mjs";
import { searchDocuments, tokenise } from "./search.mjs";
import { TOOL_DEFINITIONS, createIndexProvider, createToolHandlers } from "./tools.mjs";

describe("tools over a fixture workspace", () => {
  let fixture;
  let handlers;
  let provider;
  before(() => {
    fixture = createFixtureWorkspace();
    provider = createIndexProvider({ roots: [fixture.root], ttlSeconds: 0 });
    handlers = createToolHandlers(provider);
  });
  after(() => fixture.cleanup());

  it("declares a handler and JSON schema for every tool", () => {
    for (const tool of TOOL_DEFINITIONS) {
      assert.equal(typeof handlers[tool.name], "function", tool.name);
      assert.equal(tool.inputSchema.type, "object");
      assert.ok(tool.description.length > 40);
    }
    assert.deepEqual(Object.keys(handlers).sort(), TOOL_DEFINITIONS.map((t) => t.name).sort());
  });

  it("get_workspace_overview summarises groups, kinds, tiers and layers", async () => {
    const overview = await handlers.get_workspace_overview();
    assert.deepEqual(overview.groups, { DE: 6, personal: 1 });
    assert.deepEqual(overview.kinds, { repo: 5, worktree: 1, project: 1 });
    assert.deepEqual(overview.tiers, { "Tier 1": 1, "Tier 3": 1, "Canon/platform": 1 });
    assert.equal(overview.layers[0].name, "DE");
    assert.equal(overview.layers[0].agentsFile.title, "Fixture DE workspace");
    assert.deepEqual(overview.layers[0].guides.map((g) => g.name), ["build-a-de"]);
  });

  it("list_repositories filters by group, tier, kind, stack and query", async () => {
    assert.equal((await handlers.list_repositories({})).count, 7);
    assert.deepEqual((await handlers.list_repositories({ group: "personal" })).repositories.map((r) => r.name), ["pyapp"]);
    assert.deepEqual((await handlers.list_repositories({ tier: "tier 1" })).repositories.map((r) => r.name), ["acme-de01"]);
    assert.deepEqual((await handlers.list_repositories({ kind: "worktree" })).repositories.map((r) => r.name), ["acme-de01-feature"]);
    assert.deepEqual((await handlers.list_repositories({ stack: "hubspot" })).repositories.map((r) => r.name), ["acme-de02"]);
    assert.deepEqual((await handlers.list_repositories({ query: "legacy" })).repositories.map((r) => r.name), ["acme-de02"]);
  });

  it("get_repository_context returns the record, related repos and optional inline docs", async () => {
    const context = await handlers.get_repository_context({ repo: "acme-de01", include: ["agents", "readme", "git"] });
    assert.equal(context.name, "acme-de01");
    assert.equal(context.workspaceLayer.context.tier, "Tier 1");
    assert.deepEqual(context.related.sameCustomer.map((r) => r.name), ["acme-de02"]);
    assert.equal(context.related.worktrees.length, 2);
    assert.match(context.agentsText.text, /Result<T>/);
    assert.match(context.readmeText.text, /replay harness/);
    assert.equal(context.gitDetail.available, true);
    assert.equal(context.gitDetail.dirtyFiles, 0);
    assert.equal(context.gitDetail.lastCommit.subject, "initial");
    assert.equal(context.gitDetail.upstream, null);
    const missing = await handlers.get_repository_context({ repo: "acme" });
    assert.match(missing.error, /not found/);
    assert.deepEqual(missing.suggestions, ["acme-de01", "acme-de01-feature", "acme-de02"]);
  });

  it("linked worktrees resolve their main repository", async () => {
    const context = await handlers.get_repository_context({ repo: "acme-de01-feature" });
    assert.equal(context.kind, "worktree");
    assert.equal(context.related.mainRepo.name, "acme-de01");
  });

  it("find_repositories_by_stack ranks strong evidence above doc mentions", async () => {
    const result = await handlers.find_repositories_by_stack({ query: "VaultRE" });
    assert.deepEqual(result.tokens, ["VaultRE"]);
    assert.equal(result.repositories[0].name, "acme-de01");
    const evidence = result.repositories[0].evidence.join("\n");
    assert.match(evidence, /src\/services\/vaultre/);
    assert.match(evidence, /\.env\.example key VAULTRE_API_KEY/);
    assert.match(evidence, /mentioned \d+× in docs\/replay\.md/);
    assert.ok(!result.repositories.some((r) => r.name === "acme-de01-feature"), "worktrees are not listed twice");
    const all = await handlers.find_repositories_by_stack({ query: "hono hubspot", match: "all" });
    assert.equal(all.count, 0);
    const any = await handlers.find_repositories_by_stack({ query: "hono hubspot", match: "any" });
    assert.deepEqual(any.repositories.map((r) => r.name).sort(), ["acme-de01", "acme-de02"]);
    const python = await handlers.find_repositories_by_stack({ query: "fastapi" });
    assert.deepEqual(python.repositories.map((r) => r.name), ["pyapp"]);
    assert.ok((await handlers.find_repositories_by_stack({ query: "x" })).error);
  });

  it("get_related_de_context joins catalogue, card, guides, siblings and platform dependencies", async () => {
    const related = await handlers.get_related_de_context({ repo: "acme-de01" });
    assert.equal(related.tier, "Tier 1");
    assert.equal(related.created, "2026-03-01");
    assert.equal(related.card.path, join(fixture.de, "agents", "repos", "acme-de01.md"));
    assert.match(related.cardText, /^# acme-de01 — Acme invoice ingestion DE/);
    assert.deepEqual(related.topicGuides.map((g) => g.name), ["build-a-de"]);
    assert.deepEqual(related.related.sameCustomer.map((r) => r.name), ["acme-de02"]);
    assert.deepEqual(related.platformDependencies.map((p) => p.name), ["perform-dangerous-action"]);
    assert.equal(related.platformDependencies[0].evidence.length, 2);
    assert.equal(related.readNext[0], join(fixture.de, "AGENTS.md"));
    const withoutCard = await handlers.get_related_de_context({ repo: "acme-de01", includeCard: false });
    assert.equal(withoutCard.cardText, undefined);
    const excluded = await handlers.get_related_de_context({ repo: "internal-bot" });
    assert.equal(excluded.listed, false);
    assert.match(excluded.message, /exclusions/);
    const none = await handlers.get_related_de_context({ repo: "pyapp" });
    assert.equal(none.layer, null);
    assert.match(none.message, /not beneath a workspace layer/);
  });

  it("search_workspace ranks docs requiring all terms and can restrict to a repo", async () => {
    const result = await handlers.search_workspace({ query: "replay harness" });
    assert.deepEqual(result.docs.tokens, ["replay", "harness"]);
    assert.ok(result.docs.hits.length >= 2);
    assert.ok(result.docs.hits.every((hit) => hit.lines.length > 0 && hit.lines[0].line > 0));
    const scoped = await handlers.search_workspace({ query: "replay", repo: "acme-de02" });
    assert.equal(scoped.docs.hits.length, 0);
    assert.ok((await handlers.search_workspace({ query: " " })).error);
  });

  it("search_workspace code scope uses ripgrep when available and reports absence otherwise", async () => {
    const result = await handlers.search_workspace({ query: "export const vaultre", scope: "code", repo: "acme-de01" });
    if (result.code.unavailable) {
      assert.match(result.code.unavailable, /ripgrep/);
      return;
    }
    assert.equal(result.code.hits.length, 1);
    assert.equal(result.code.hits[0].repo, "acme-de01");
    assert.match(result.code.hits[0].path, /src\/services\/vaultre\/index\.ts$/);
    assert.equal(result.code.hits[0].line, 1);
  });

  it("list_worktrees reports linked worktrees inside and outside roots", async () => {
    const result = await handlers.list_worktrees({});
    assert.deepEqual(result.repositoriesWithWorktrees, ["acme-de01"]);
    assert.equal(result.linkedWorktrees, 2);
    const linked = result.worktrees.filter((wt) => !wt.isMain);
    assert.deepEqual(linked.map((wt) => wt.insideRoots).sort(), [false, true]);
    const scoped = await handlers.list_worktrees({ repo: "acme-de02" });
    assert.equal(scoped.worktrees.length, 1);
    assert.equal(scoped.worktrees[0].isMain, true);
  });

  it("read_workspace_file enforces containment and refuses credential-like files", async () => {
    const ok = await handlers.read_workspace_file({ path: "acme-de01/README.md", offset: 1, limit: 1 });
    assert.equal(ok.repo, "acme-de01");
    assert.equal(ok.text, "# acme-de01");
    assert.equal(ok.truncated, true);
    const outsideWorktree = await handlers.read_workspace_file({ path: join(fixture.outside, "acme-task-y", "README.md"), limit: 1 });
    assert.equal(outsideWorktree.text, "# acme-de01");
    await assert.rejects(handlers.read_workspace_file({ path: "acme-de01/.env" }), /credential-like/);
    await assert.rejects(handlers.read_workspace_file({ path: "acme-de01/.git/config" }), /credential-like|git-internal/);
    await assert.rejects(handlers.read_workspace_file({ path: join(fixture.outside, "..") }), /outside/);
    await assert.rejects(handlers.read_workspace_file({ path: "unknown/README.md" }), /not indexed/);
    await assert.rejects(handlers.read_workspace_file({ path: "" }), /required/);
  });

  it("refresh_index rebuilds and reports statistics", async () => {
    const before = provider.get().builtAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const stats = await handlers.refresh_index();
    assert.equal(stats.repositories, 7);
    assert.deepEqual(stats.layers, ["DE"]);
    assert.notEqual(stats.builtAt, before);
  });
});

describe("document search primitives", () => {
  it("tokenises queries and drops one-character noise", () => {
    assert.deepEqual(tokenise("VaultRE, replay-harness a b."), ["vaultre", "replay-harness", "b"].filter((t) => t.length >= 2));
    assert.deepEqual(tokenise(""), []);
  });

  it("requires every token and boosts title matches", () => {
    const documents = [
      { repo: "a", relPath: "README.md", title: "Replay harness", text: "replay harness details", lower: "replay harness details", bytes: 20 },
      { repo: "b", relPath: "docs/x.md", title: "Other", text: "replay only", lower: "replay only", bytes: 10 },
    ];
    const result = searchDocuments(documents, "replay harness");
    assert.equal(result.hits.length, 1);
    assert.equal(result.hits[0].repo, "a");
    assert.equal(searchDocuments(documents, "replay").hits.length, 2);
    assert.equal(searchDocuments(documents, "replay", { repo: "B" }).hits.length, 1);
  });
});
