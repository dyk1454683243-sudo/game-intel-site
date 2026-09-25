#!/usr/bin/env node
/**
 * Write summary conclusion rows onto HW / NIKKE / BD2 character cards.
 * Idempotent. Does not invent tiers, pull advice, rates, or prices.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyConclusion } from "./guide-conclusion.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const GAMES = ["hw", "nikke", "bd2"];

let written = 0;
let kept = 0;
const byGame = {};

for (const game of GAMES) {
  const dir = path.join(DATA, "guides", game, "characters");
  byGame[game] = { files: 0, stub_conclusion: 0, full_conclusion: 0 };
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const p = path.join(dir, f);
    const card = JSON.parse(fs.readFileSync(p, "utf8"));
    const next = applyConclusion(card);
    byGame[game].files++;
    if (next.summary?.stub === true) byGame[game].stub_conclusion++;
    else byGame[game].full_conclusion++;
    const before = JSON.stringify(card);
    const after = JSON.stringify(next);
    if (before === after) {
      kept++;
      continue;
    }
    fs.writeFileSync(p, JSON.stringify(next, null, 2) + "\n");
    written++;
  }
}

console.log(JSON.stringify({ ok: true, written, kept, byGame }, null, 2));
