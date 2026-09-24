// A "layer" is a non-repository directory that carries agent context for the
// repositories beneath it: an AGENTS.md plus an optional agents/ directory with
// topic guides, a repository catalogue (markdown tables) and per-repository
// cards. The DE workspace root is the motivating example; the parser is
// generic so other roots can grow the same shape.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";

const MAX_LAYER_FILE_BYTES = 512 * 1024;

function readBounded(path) {
  try {
    if (statSync(path).size > MAX_LAYER_FILE_BYTES) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function firstHeading(text) {
  const match = /^#\s+(.+)$/m.exec(text || "");
  return match ? match[1].trim() : null;
}

export function headings(text, level = 2) {
  const prefix = "#".repeat(level);
  const re = new RegExp(`^${prefix}\\s+(.+)$`, "gm");
  const out = [];
  let match;
  while ((match = re.exec(text || ""))) out.push(match[1].trim());
  return out;
}

/** First prose paragraph after the title: skips headings, badges, tables, html. */
export function firstParagraph(text, maxLength = 240) {
  if (!text) return null;
  const lines = text.split("\n");
  let started = false;
  const buffer = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (started) break;
      continue;
    }
    if (/^(#|!\[|\[!\[|<|---|\||```|>|- |\* |\d+\. )/.test(line)) {
      if (started) break;
      continue;
    }
    started = true;
    buffer.push(line);
  }
  if (!buffer.length) return null;
  const joined = buffer.join(" ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "");
  return joined.length > maxLength ? `${joined.slice(0, maxLength - 1).trimEnd()}…` : joined;
}

function splitRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

/**
 * Parses every markdown pipe table in `text`. Each table records the nearest
 * preceding heading, its header cells, and rows as objects keyed by the
 * lower-cased header. The first cell's link text, or its backticked names, is
 * exposed as `names` for lookup.
 */
export function parseMarkdownTables(text) {
  const tables = [];
  const lines = (text || "").split("\n");
  let section = null;
  for (let i = 0; i < lines.length; i += 1) {
    const heading = /^#{1,6}\s+(.+)$/.exec(lines[i]);
    if (heading) {
      section = heading[1].trim();
      continue;
    }
    if (!lines[i].trim().startsWith("|")) continue;
    if (!/^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || "")) continue;
    const header = splitRow(lines[i]).map((cell) => cell.toLowerCase());
    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith("|")) {
      const cells = splitRow(lines[j]);
      const row = {};
      header.forEach((key, idx) => {
        row[key] = cells[idx] ?? "";
      });
      rows.push({ names: extractNames(cells[0] ?? ""), row });
      j += 1;
    }
    tables.push({ section, header, rows });
    i = j - 1;
  }
  return tables;
}

function extractNames(cell) {
  const names = [];
  const link = /\[([^\]]+)\]\(([^)]*)\)/g;
  let match;
  while ((match = link.exec(cell))) names.push(match[1].trim());
  const code = /`([^`]+)`/g;
  while ((match = code.exec(cell))) names.push(match[1].trim());
  if (!names.length && cell.trim()) names.push(cell.trim());
  return names;
}

/** Parses "# name — purpose" and the leading "- Key: value" bullets of a card. */
export function parseCard(text) {
  const title = firstHeading(text) || "";
  const dash = title.split(/\s+[—–-]\s+/);
  const purpose = dash.length > 1 ? dash.slice(1).join(" — ").trim() : null;
  const fields = {};
  const preamble = (text || "").split(/^##\s/m)[0];
  for (const raw of preamble.split("\n")) {
    const bullet = /^-\s+([^:]{2,40}):\s*(.+)$/.exec(raw.trim());
    if (!bullet) continue;
    const key = bullet[1].trim().toLowerCase();
    const value = bullet[2].trim();
    fields[key] = value;
    if (key.startsWith("created")) {
      const created = /Created:\s*(\d{4}-\d{2}-\d{2})/i.exec(raw);
      const lastPush = /Last push:\s*(\d{4}-\d{2}-\d{2})/i.exec(raw);
      const tier = /Tier:\s*([^(\n]+)/i.exec(raw);
      if (created) fields.created = created[1];
      if (lastPush) fields["last push"] = lastPush[1];
      if (tier) fields.tier = tier[1].trim();
    }
  }
  return { title, purpose, fields, sections: headings(text, 2) };
}

function catalogueFor(agentsDir) {
  const candidates = ["repo-catalog.md", "repo-catalogue.md", "catalog.md", "catalogue.md"];
  for (const name of candidates) {
    const path = join(agentsDir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

/**
 * Detects and parses a layer rooted at `dir`. Returns null when the directory
 * has neither AGENTS.md nor an agents/ directory.
 */
export function readLayer(dir) {
  const agentsFile = join(dir, "AGENTS.md");
  const agentsDir = join(dir, "agents");
  const hasFile = existsSync(agentsFile);
  const hasDir = existsSync(agentsDir) && statSync(agentsDir).isDirectory();
  if (!hasFile && !hasDir) return null;

  const layer = {
    name: basename(dir),
    path: dir,
    agentsFile: null,
    guides: [],
    catalogue: null,
    cards: new Map(),
    exclusions: [],
  };

  if (hasFile) {
    const text = readBounded(agentsFile);
    layer.agentsFile = {
      path: agentsFile,
      title: firstHeading(text),
      summary: firstParagraph(text),
      sections: headings(text, 2),
    };
  }

  if (hasDir) {
    const cataloguePath = catalogueFor(agentsDir);
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const path = join(agentsDir, entry.name);
      if (path === cataloguePath) continue;
      const text = readBounded(path);
      layer.guides.push({
        path,
        name: entry.name.replace(/\.md$/i, ""),
        title: firstHeading(text),
        summary: firstParagraph(text),
        sections: headings(text, 2),
      });
    }
    layer.guides.sort((a, b) => a.name.localeCompare(b.name));

    if (cataloguePath) {
      const text = readBounded(cataloguePath);
      const tables = parseMarkdownTables(text);
      const rows = new Map();
      for (const table of tables) {
        const isRepoTable = table.header.includes("repo") || table.header.includes("repository");
        for (const { names, row } of table.rows) {
          if (isRepoTable) {
            for (const name of names) {
              if (!rows.has(name)) rows.set(name, { section: table.section, ...row });
            }
          } else if (table.header.some((h) => /exclusion|excluded|not cloned/.test(h))) {
            layer.exclusions.push({ names, reason: Object.values(row)[1] ?? "" });
          }
        }
      }
      layer.catalogue = { path: cataloguePath, title: firstHeading(text), rows };
    }

    const cardsDir = join(agentsDir, "repos");
    if (existsSync(cardsDir) && statSync(cardsDir).isDirectory()) {
      for (const entry of readdirSync(cardsDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
        const path = join(cardsDir, entry.name);
        const text = readBounded(path);
        if (text === null) continue;
        const parsed = parseCard(text);
        layer.cards.set(entry.name.replace(/\.md$/i, ""), {
          path,
          relPath: relative(dir, path),
          bytes: Buffer.byteLength(text),
          ...parsed,
        });
      }
    }
  }
  return layer;
}

function lookupCaseInsensitive(map, key) {
  if (map.has(key)) return map.get(key);
  const lower = key.toLowerCase();
  for (const [name, value] of map) if (name.toLowerCase() === lower) return value;
  return undefined;
}

/** Joins catalogue row and card for one repository name into a compact DE record. */
export function layerContextFor(layer, repoName) {
  if (!layer) return null;
  const row = layer.catalogue ? lookupCaseInsensitive(layer.catalogue.rows, repoName) : undefined;
  const card = lookupCaseInsensitive(layer.cards, repoName);
  const excluded = layer.exclusions.find((entry) =>
    entry.names.some((name) => name.toLowerCase() === repoName.toLowerCase()),
  );
  if (!row && !card && !excluded) return { layer: layer.name, listed: false };
  const tier = (row && row.tier) || (card && card.fields.tier) || null;
  return {
    layer: layer.name,
    listed: Boolean(row || card),
    tier,
    customer: (row && row.customer) || (card && card.fields["customer / domain"]) || null,
    purpose: (row && row.purpose) || (card && card.purpose) || null,
    created: (row && row.created) || (card && card.fields.created) || null,
    lastPush: (row && row["last push"]) || (card && card.fields["last push"]) || null,
    templateDerived: (row && row["template-derived"]) || (card && card.fields["template-derived"]) || null,
    stealThis: (row && row["steal this"]) || null,
    catalogueSection: row ? row.section : null,
    cataloguePath: layer.catalogue ? layer.catalogue.path : null,
    cardPath: card ? card.path : null,
    excluded: excluded ? excluded.reason : null,
  };
}
