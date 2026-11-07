#!/usr/bin/env node
/**
 * Data freshness and public contract gate.
 * Verifies that all published /v1 feeds, catalog, 8 deep-game guides/banners/codes,
 * llms.txt, and OpenAPI documents are present, consistent, and schema-aligned.
 */
import "./require-node22.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEEP_GAMES } from "../src/deep-games.js";
import { openApiDocument } from "../src/openapi.js";
import { assembleStatus } from "../src/status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(SITE, "public");

function readPublicJson(pathname) {
  const rel = pathname.replace(/^\/+/, "");
  const file = path.join(PUBLIC_DIR, rel);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function main() {
  const errors = [];
  const status = await assembleStatus(async (p) => readPublicJson(p));
  if (!status.ok) {
    errors.push(`assembleStatus failed: ${status.error || "unknown"}`);
  }

  for (const [feedName, meta] of Object.entries(status.feeds || {})) {
    const stamp = meta?.generated_at || meta?.as_of;
    if (!stamp) {
      errors.push(`feed ${feedName} is missing generated_at/as_of`);
    }
  }

  if ((status.catalog?.count || 0) < 12) {
    errors.push(`catalog.count too small: ${status.catalog?.count}`);
  }
  if (status.catalog?.watchlist_count !== 12) {
    errors.push(`expected 12 watchlist games, got ${status.catalog?.watchlist_count}`);
  }
  if (status.guides?.deep_count !== DEEP_GAMES.length) {
    errors.push(`expected ${DEEP_GAMES.length} deep games, got ${status.guides?.deep_count}`);
  }

  for (const row of status.deep_games || []) {
    if (row.character_count <= 0 || row.rich_count <= 0) {
      errors.push(`${row.game}: expected positive character_count and rich_count`);
    }
    if (!row.banners?.as_of || row.banners.count <= 0) {
      errors.push(`${row.game}: missing banners as_of or empty banners`);
    }
    if (!row.codes?.as_of) {
      errors.push(`${row.game}: missing codes as_of`);
    }
    const aliasesFile = path.join(PUBLIC_DIR, "v1", "guides", row.game, "aliases.json");
    if (!fs.existsSync(aliasesFile)) {
      errors.push(`${row.game}: missing published aliases.json`);
    }
  }

  const llmsSrc = fs.readFileSync(path.join(SITE, "llms.txt"), "utf8");
  const llmsPub = fs.readFileSync(path.join(PUBLIC_DIR, "llms.txt"), "utf8");
  if (llmsSrc !== llmsPub) {
    errors.push("ai-site/llms.txt and ai-site/public/llms.txt are out of sync");
  }

  const expectedOpenApi = `${JSON.stringify(openApiDocument(), null, 2)}\n`;
  const pubOpenApi = fs.readFileSync(path.join(PUBLIC_DIR, "openapi.json"), "utf8");
  const v1OpenApi = fs.readFileSync(path.join(PUBLIC_DIR, "v1", "openapi.json"), "utf8");
  if (pubOpenApi !== expectedOpenApi || v1OpenApi !== expectedOpenApi) {
    errors.push("published openapi.json / v1/openapi.json does not match openApiDocument()");
  }

  const out = {
    ok: errors.length === 0,
    today: status.today,
    feeds: status.feeds,
    catalog: status.catalog,
    guides: status.guides,
    deep_games: (status.deep_games || []).map((g) => ({
      game: g.game,
      chars: `${g.rich_count}/${g.character_count} (stub:${g.stub_count})`,
      banners: `${g.banners.count} (current:${g.banners.current_count}, upcoming:${g.banners.upcoming_count}, as_of:${g.banners.as_of})`,
      codes: `${g.codes.count} (live:${g.codes.live_count}, as_of:${g.codes.as_of})`,
    })),
    errors,
  };

  console.log(JSON.stringify(out, null, 2));
  if (errors.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
