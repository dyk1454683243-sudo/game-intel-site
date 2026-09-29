/**
 * Curated digest lines in data/digest-briefs.json.
 * Overlay a Chinese summary when the live item URL matches.
 * Pin a missing brief to the front of a full digest (not morning only_new).
 * Never invent a headline: every row needs an https URL and a written summary.
 */
import fs from "node:fs";
import path from "node:path";

const HTTP = /^https:\/\/\S+$/i;

export function loadDigestBriefs(dataDir) {
  const file = path.join(String(dataDir || ""), "digest-briefs.json");
  if (!file || !fs.existsSync(file)) return [];
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const items = Array.isArray(doc?.items) ? doc.items : [];
  const out = [];
  for (const row of items) {
    if (!row || typeof row !== "object") continue;
    const game = String(row.game || "").trim();
    const url = String(row.url || "").trim();
    const title = String(row.title || "").trim();
    const summary = String(row.summary || "").replace(/\s+/g, " ").trim();
    if (!game || !title || !HTTP.test(url) || !summary) continue;
    out.push({
      game,
      title,
      url,
      source: String(row.source || "official").trim() || "official",
      ...(row.date ? { date: String(row.date) } : {}),
      summary,
    });
  }
  return out;
}

/**
 * @param {object[]} items
 * @param {object[]} briefs briefs for one game, file order
 * @param {{limit?:number, pin?:boolean}} [opts]
 */
export function applyDigestBriefs(items, briefs, opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 5;
  const pin = opts.pin !== false;
  const list = Array.isArray(items) ? items.map((row) => ({ ...row })) : [];
  const pending = [];
  for (const brief of briefs || []) {
    const url = String(brief.url || "");
    const hit = list.find((row) => String(row?.url || "") === url);
    if (hit) {
      hit.summary = brief.summary;
      if (!hit.title) hit.title = brief.title;
      if (!hit.source && brief.source) hit.source = brief.source;
      continue;
    }
    if (!pin) continue;
    pending.push({
      title: brief.title,
      url,
      source: brief.source,
      ...(brief.date ? { date: brief.date } : {}),
      summary: brief.summary,
    });
  }
  const merged = [...list];
  for (const row of [...pending].reverse()) merged.unshift(row);
  return merged.slice(0, Math.max(0, limit));
}
