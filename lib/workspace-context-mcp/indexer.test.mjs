import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { join } from "node:path";

import { createFixtureWorkspace } from "./fixture.mjs";
import { parseRemoteUrl, readGitMeta, remoteSlug } from "./git.mjs";
import { buildIndex, customerKey, discoverProjects, expandHome, findRepo } from "./indexer.mjs";
import { firstParagraph, parseCard, parseMarkdownTables } from "./layers.mjs";

describe("git metadata from files", () => {
  it("parses remote URLs into slugs", () => {
    assert.equal(remoteSlug("git@github.com:owner/repo.git"), "owner/repo");
    assert.equal(remoteSlug("https://github.com/owner/repo.git"), "owner/repo");
    assert.equal(remoteSlug("https://github.com/owner/repo"), "owner/repo");
    assert.equal(remoteSlug(null), null);
  });

  it("prefers origin but falls back to the first remote", () => {
    const config = '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://x/up.git\n[remote "origin"]\n\turl = https://x/origin.git\n';
    assert.equal(parseRemoteUrl(config), "https://x/origin.git");
    assert.equal(parseRemoteUrl('[remote "fork"]\n\turl = https://x/fork.git\n'), "https://x/fork.git");
    assert.equal(parseRemoteUrl("[core]\n\tbare = false\n"), null);
  });
});

describe("layer parsing", () => {
  it("parses markdown tables with section headings and link names", () => {
    const tables = parseMarkdownTables("## Repos\n\n| Repo | Tier |\n|---|---|\n| [a](repos/a.md) | Tier 1 |\n| `b`, `c` | Tier 3 |\n");
    assert.equal(tables.length, 1);
    assert.equal(tables[0].section, "Repos");
    assert.deepEqual(tables[0].rows[0].names, ["a"]);
    assert.equal(tables[0].rows[0].row.tier, "Tier 1");
    assert.deepEqual(tables[0].rows[1].names, ["b", "c"]);
  });

  it("parses card title, purpose and header fields", () => {
    const card = parseCard("# x — Does things\n\n- Customer / domain: Acme\n- Created: 2026-01-02  Last push: 2026-02-03  Tier: Tier 2 (meta)\n\n## What it does\n");
    assert.equal(card.purpose, "Does things");
    assert.equal(card.fields.created, "2026-01-02");
    assert.equal(card.fields["last push"], "2026-02-03");
    assert.equal(card.fields.tier, "Tier 2");
    assert.deepEqual(card.sections, ["What it does"]);
  });

  it("extracts the first prose paragraph and strips markdown links", () => {
    assert.equal(firstParagraph("# Title\n\n![badge](x)\n\nSee [docs](y) for **more**.\n\nSecond."), "See docs for more.");
    assert.equal(firstParagraph("# Only heading\n"), null);
  });
});

describe("workspace index", () => {
  let fixture;
  let index;
  before(() => {
    fixture = createFixtureWorkspace();
    index = buildIndex({ roots: [fixture.root] });
  });
  after(() => fixture.cleanup());

  it("discovers repos, worktrees and manifest projects but not notes directories", () => {
    const found = discoverProjects(fixture.root);
    const byName = Object.fromEntries(found.map((p) => [p.path.split("/").pop(), p]));
    assert.equal(byName["acme-de01"].kind, "repo");
    assert.equal(byName["acme-de01"].group, "DE");
    assert.equal(byName["acme-de01-feature"].kind, "worktree");
    assert.equal(byName["scratch-tool"].kind, "project");
    assert.equal(byName.pyapp.group, "personal");
    assert.equal(byName.notes, undefined);
  });

  it("treats the DE root as a layer and not the manifest project", () => {
    assert.deepEqual(index.layers.map((layer) => layer.name), ["DE"]);
    const layer = index.layers[0];
    assert.equal(layer.catalogue.rows.size, 3);
    assert.equal(layer.cards.size, 2);
    assert.equal(layer.guides.length, 1);
    assert.equal(layer.exclusions.length, 1);
    assert.deepEqual(layer.exclusions[0].names, ["internal-bot"]);
  });

  it("reads git metadata including linked worktrees inside and outside the roots", () => {
    const repo = findRepo(index, "acme-de01");
    assert.equal(repo.git.branch, "main");
    assert.match(repo.git.head, /^[0-9a-f]{12}$/);
    assert.equal(repo.git.remoteSlug, "example-org/acme-de01");
    const branches = repo.git.worktrees.map((wt) => wt.branch).sort();
    assert.deepEqual(branches, ["feature/x", "task/y"]);
    assert.ok(repo.git.worktrees.every((wt) => wt.present));
    const linked = findRepo(index, "acme-de01-feature");
    assert.equal(linked.kind, "worktree");
    assert.equal(linked.git.isWorktree, true);
    assert.equal(linked.git.branch, "feature/x");
    assert.equal(linked.git.mainRepoPath, repo.path);
    const meta = readGitMeta(join(fixture.outside, "acme-task-y"));
    assert.equal(meta.branch, "task/y");
    assert.equal(meta.mainRepoPath, repo.path);
  });

  it("derives manifests, structure, stack, integrations and summary", () => {
    const repo = findRepo(index, "acme-de01");
    assert.deepEqual(repo.manifests.everyday, { projectName: "acme-de01", projectID: "acme-123", region: "us-central1", isTemplate: false });
    assert.equal(repo.manifests.mise.tools.node, "24");
    assert.equal(repo.manifests.dockerfile.baseImage, "node:24-slim");
    assert.deepEqual(repo.manifests.envExampleKeys, ["VAULTRE_API_KEY", "SLACK_TOKEN", "PORT"]);
    assert.deepEqual(repo.structure.services.map((s) => s.name), ["gmail", "slack", "vaultre"]);
    assert.deepEqual(repo.structure.workflows.map((s) => s.name), ["ingest"]);
    assert.deepEqual(repo.structure.routes.map((s) => s.name), ["health"]);
    for (const tag of ["hono", "zod", "vitest", "nock", "biome", "firestore", "pnpm", "mise", "docker", "everyday-de", "wif", "cloud-run", "deploy-guardian", "perform-dangerous-action"]) {
      assert.ok(repo.stack.includes(tag), `expected stack tag ${tag} in ${repo.stack}`);
    }
    assert.ok(repo.integrations.includes("vaultre"));
    assert.ok(repo.integrations.includes("firestore"));
    assert.equal(repo.integrations.filter((n) => n.toLowerCase() === "slack").length, 1, "slack dedupes across service dir and dependency tag");
    assert.equal(repo.summary, "Acme invoice ingestion DE", "catalogue purpose beats the template package.json description");
    assert.deepEqual(repo.docs.agents, ["AGENTS.md"]);
    assert.equal(repo.docs.readme, "README.md");
    assert.deepEqual(repo.docs.skills.map((s) => s.name), ["perform-dangerous-action"]);
    assert.equal(repo.docs.skills[0].description, "Guard external mutations.");
    const workflowMarkers = Object.fromEntries(repo.manifests.githubWorkflows.map((wf) => [wf.file, wf.markers]));
    assert.ok(workflowMarkers["deploy.yml"].includes("wif"));
    assert.ok(workflowMarkers["deploy-guardian.yml"].includes("deploy-guardian"));
  });

  it("falls back to package.json, pyproject or README for summaries", () => {
    assert.equal(findRepo(index, "acme-de02").summary, "Acme legacy sync");
    assert.equal(findRepo(index, "scratch-tool").summary, "Scratch CLI");
    const py = findRepo(index, "pyapp");
    assert.equal(py.summary, "Python app");
    assert.deepEqual(py.manifests.pyproject.dependencies, ["fastapi", "httpx"]);
    assert.ok(py.stack.includes("python"));
    assert.ok(py.stack.includes("fastapi"));
    assert.equal(findRepo(index, "internal-bot").summary, "Not a DE.");
  });

  it("attaches layer context by catalogue row, card and exclusion", () => {
    assert.equal(findRepo(index, "acme-de01").layerContext.tier, "Tier 1");
    assert.equal(findRepo(index, "acme-de01").layerContext.stealThis, "replay harness");
    assert.equal(findRepo(index, "perform-dangerous-action").layerContext.tier, "Canon/platform");
    const excluded = findRepo(index, "internal-bot").layerContext;
    assert.equal(excluded.listed, false);
    assert.match(excluded.excluded, /not a DE/);
    assert.equal(findRepo(index, "pyapp").layerContext, null);
  });

  it("indexes repository docs and layer docs as a searchable corpus", () => {
    const paths = index.documents.map((doc) => doc.relPath);
    assert.ok(paths.includes("docs/replay.md"));
    assert.ok(paths.includes(".agents/skills/perform-dangerous-action/SKILL.md"));
    const card = index.documents.find((doc) => doc.cardFor === "acme-de01");
    assert.equal(card.layer, "DE");
    assert.ok(index.documents.some((doc) => doc.layer === "DE" && doc.relPath === "AGENTS.md"));
    assert.ok(!paths.some((p) => p.endsWith(".env")));
  });

  it("finds repos by name, slug, package name or path", () => {
    assert.equal(findRepo(index, "ACME-DE01").name, "acme-de01");
    assert.equal(findRepo(index, "example-org/acme-de02").name, "acme-de02");
    assert.equal(findRepo(index, "@everyday-artificial-intelligence/perform-dangerous-action").name, "perform-dangerous-action");
    assert.equal(findRepo(index, join(fixture.de, "acme-de01")).name, "acme-de01");
    assert.equal(findRepo(index, "nope"), null);
  });

  it("derives a customer key from the name prefix and expands ~", () => {
    assert.equal(customerKey("RayWhite-DE04"), "raywhite");
    assert.equal(customerKey("genius_de01"), "genius");
    assert.equal(expandHome("~/x", "/home/u"), "/home/u/x");
    assert.equal(expandHome("~", "/home/u"), "/home/u");
  });
});
