#!/usr/bin/env node
/**
 * Audits remaining skill stubs (`stub: true`) and conclusion stubs (`summary.stub: true`)
 * across the 8 deep games in `data/guides/{game}/characters/*.json`.
 * Never invents facts; outputs a structured backlog with the stored reason (`note` / `caveat`)
 * and `sources[]` so maintainers or agents know what is waiting for an upstream source.
 */
import "./require-node22.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEEP_GAMES } from "../src/deep-games.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, "..");
const ROOT = path.resolve(SITE, "..");
const GUIDES_DIR = path.join(ROOT, "data", "guides");

function parseArgs(argv) {
  let game = "";
  let summaryOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--game" && argv[i + 1]) {
      game = String(argv[i + 1]).trim();
      i += 1;
    } else if (a.startsWith("--game=")) {
      game = a.slice("--game=".length).trim();
    } else if (a === "--summary") {
      summaryOnly = true;
    }
  }
  return { game, summaryOnly };
}

export function auditStubs({ guidesDir = GUIDES_DIR, game = "", summaryOnly = false } = {}) {
  if (game && !DEEP_GAMES.includes(game)) {
    return {
      ok: false,
      error: "bad_game",
      message: `Unknown deep game: ${game}. Expected one of: ${DEEP_GAMES.join(", ")}.`,
    };
  }
  const targets = game ? [game] : [...DEEP_GAMES];
  let character_total = 0;
  let rich_total = 0;
  let skill_stub_total = 0;
  let conclusion_stub_total = 0;

  const games = targets.map((gid) => {
    const charDir = path.join(guidesDir, gid, "characters");
    const files = fs.existsSync(charDir)
      ? fs
          .readdirSync(charDir)
          .filter((f) => f.endsWith(".json"))
          .sort()
      : [];
    const skill_stubs = [];
    const conclusion_stubs = [];
    let rich_count = 0;

    for (const file of files) {
      const card = JSON.parse(fs.readFileSync(path.join(charDir, file), "utf8"));
      const id = card.id || file.replace(/\.json$/, "");
      const isSkillStub =
        card.stub === true ||
        (card.stub !== false && !(Array.isArray(card.skills) && card.skills.length > 0));
      const isConclusionStub = !isSkillStub && card.summary?.stub === true;

      if (isSkillStub) {
        skill_stubs.push({
          id,
          name: card.name || id,
          name_zh: card.name_zh || card.name || id,
          skills_count: Array.isArray(card.skills) ? card.skills.length : 0,
          has_tier: Boolean(card.summary?.tier),
          reason: card.note || card.summary?.caveat || null,
          sources: Array.isArray(card.sources) ? card.sources : [],
        });
      } else {
        rich_count += 1;
        if (isConclusionStub) {
          conclusion_stubs.push({
            id,
            name: card.name || id,
            name_zh: card.name_zh || card.name || id,
            reason: card.summary?.caveat || card.note || null,
            sources: Array.isArray(card.summary?.sources)
              ? card.summary.sources
              : Array.isArray(card.sources)
                ? card.sources
                : [],
          });
        }
      }
    }

    character_total += files.length;
    rich_total += rich_count;
    skill_stub_total += skill_stubs.length;
    conclusion_stub_total += conclusion_stubs.length;

    const row = {
      game: gid,
      character_count: files.length,
      rich_count,
      skill_stub_count: skill_stubs.length,
      conclusion_stub_count: conclusion_stubs.length,
    };
    if (!summaryOnly) {
      row.skill_stubs = skill_stubs;
      row.conclusion_stubs = conclusion_stubs;
    }
    return row;
  });

  return {
    ok: true,
    totals: {
      deep_games: targets.length,
      character_total,
      rich_total,
      skill_stub_total,
      conclusion_stub_total,
    },
    games,
  };
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const opts = parseArgs(process.argv.slice(2));
  const report = auditStubs(opts);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}
