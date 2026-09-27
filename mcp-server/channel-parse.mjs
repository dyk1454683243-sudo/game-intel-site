/**
 * Pure parsers for the two light channels (Steam Coming Soon JSON, 4Gamer RSS 1.0).
 * No network. Facts keep the store/article URL and an as_of date.
 */

const FOUR_KEEP =
  /新作|発売|配信開始|サービス開始|CBT|βテスト|ベータ|事前登録|ローンチ|オープンβ|クローズド|早期アクセス|アーリーアクセス/i;
const FOUR_DROP =
  /Webカメラ|Blu-ray|ブルーレイ|映画「|懐中時計|ヘッドホン|キーボード|マウスパッド|ゲーミングPC|モニター/i;

function tagText(block, tag) {
  const re = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i");
  const m = re.exec(String(block || ""));
  if (!m) return "";
  return String(m[1] || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseSteamComingSoonPayload(body, { asOf = null, limit = 8 } = {}) {
  const items = body?.coming_soon?.items;
  if (!Array.isArray(items)) return [];
  const out = [];
  const cap = Math.max(1, Math.min(Number(limit) || 8, 20));
  for (const it of items) {
    const name = String(it?.name || "").trim();
    const id = it?.id;
    if (!name || name.length <= 1 || id == null || String(id).trim() === "") continue;
    const appid = String(id).trim();
    out.push({
      title: name.length > 120 ? `${name.slice(0, 119)}…` : name,
      url: `https://store.steampowered.com/app/${appid}/`,
      source: "steam_coming_soon",
      appid,
      as_of: asOf,
    });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * RSS 1.0 items. mode "radar" keeps launch-ish headlines.
 * mode "digest" keeps recent non-hardware items so a watchlist name can match.
 */
export function parseFourGamerRss(xml, { limit = 5, mode = "radar" } = {}) {
  const text = String(xml || "");
  const cap = Math.max(1, Math.min(Number(limit) || 5, 40));
  const out = [];
  const re = /<item\s[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(text))) {
    const block = m[1];
    const title = tagText(block, "title");
    const link = tagText(block, "link");
    const dateRaw = tagText(block, "dc:date");
    if (!title || !link || !/^https?:\/\//i.test(link)) continue;
    if (FOUR_DROP.test(title)) continue;
    if (mode !== "digest" && !FOUR_KEEP.test(title)) continue;
    let date = null;
    if (dateRaw) {
      const d = new Date(dateRaw);
      if (!Number.isNaN(d.getTime())) date = d.toISOString();
    }
    out.push({
      title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
      url: link,
      source: "four_gamer",
      date,
      as_of: date ? date.slice(0, 10) : null,
    });
    if (out.length >= cap) break;
  }
  return out;
}
