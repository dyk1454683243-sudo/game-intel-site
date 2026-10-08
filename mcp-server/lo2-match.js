/**
 * Last Origin 2 vs the live Last Origin (LO1 / R+) title gate.
 *
 * GameKee searchArticle tokenizes "Last Origin 2" like "Last Origin" and
 * returns the LO1 wiki (game-alias `lo`): 台服维护, 第2部 events, bioroids.
 * VALOFE publishes that live game too, so a publisher keyword is not a sequel.
 * Keep a row only when the text names the unreleased sequel.
 */

const NAME_GAP = "[\\s\\-_]*";
const MARK_GAP =
  "[\\s「」『』“”\"'《》〈〉（）()\\[\\]【】：:·\\.．,，、/／\\-—~～]*";

const EXPLICIT_LO2_RE = new RegExp(
  [
    `last${NAME_GAP}origin${MARK_GAP}(?:2|ii)(?!\\d|[a-z])`,
    `라스트${NAME_GAP}오리진${MARK_GAP}2(?!\\d)`,
    `ラスト${NAME_GAP}オリジン${MARK_GAP}2(?!\\d)`,
    `最[后後]的起源${MARK_GAP}2(?!\\d)`,
    "\\blo2\\b",
  ].join("|"),
  "i"
);

const FRANCHISE_RE =
  /last\s*origin|라스트\s*오리진|ラスト\s*オリジン|最[后後]的起源/i;
const SEQUEL_WORD_RE = /续作|續作|후속작/;

/**
 * GameKee queries for lo2. Precise phrases first. "Last Origin 2" is still
 * searched because a fresh sequel headline can rank there, but every hit
 * must pass mentionsLo2Sequel — the engine also returns LO1 posts.
 */
export const LO2_GAMEKEE_QUERIES = [
  "最后的起源2",
  "最後的起源2",
  "라스트오리진2",
  "ラストオリジン2",
  "Last Origin 2",
  "Last Origin II",
];

export function mentionsLo2Sequel(text) {
  const hay = String(text || "")
    .replace(/\u2161|\u2171/g, "II")
    .replace(/２/g, "2");
  if (!hay.trim()) return false;
  if (EXPLICIT_LO2_RE.test(hay)) return true;
  return FRANCHISE_RE.test(hay) && SEQUEL_WORD_RE.test(hay);
}

/** Digest/calendar row: title or URL must name the sequel on its own. */
export function acceptsLo2DigestItem(item) {
  return (
    mentionsLo2Sequel(item?.title) || mentionsLo2Sequel(item?.url)
  );
}
