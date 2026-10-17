/**
 * Pure extractors for cited teams and rating rows.
 * They copy labels that are already on the page. They do not invent grades,
 * and they do not turn a slot that lists several characters into one roster
 * unless the page marks a single large icon as the primary of that slot.
 */

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const TIER = /^T\d+(?:\.\d+)?$/;

export function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " "));
}

export function parseUpdated(html) {
  const src = String(html || "").replace(/<!--[\s\S]*?-->/g, " ");
  const match = src.match(/Last updated:\s*(?:<[^>]+>\s*)*(\d{1,2})\/([A-Za-z]+)\/(\d{4})/i);
  if (!match) return "";
  const month = MONTHS[match[2].toLowerCase()];
  const day = Number(match[1]);
  const year = Number(match[3]);
  if (!month || day < 1 || day > 31 || year < 2020) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function sliceDiv(html, start) {
  const src = String(html || "");
  if (!src.startsWith("<div", start) && src.slice(start, start + 4) !== "<div") return "";
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = re.exec(src))) {
    if (match.index < start) continue;
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return src.slice(start, match.index + match[0].length);
  }
  return "";
}

function firstDiv(html, className) {
  const marker = `<div class="${className}">`;
  const index = String(html || "").indexOf(marker);
  if (index < 0) return "";
  return sliceDiv(html, index);
}

export function characterSlugs(html, section) {
  const re = new RegExp(`href="/${section}/characters/([a-z0-9-]+)"`, "g");
  const out = [];
  let match;
  const src = String(html || "");
  while ((match = re.exec(src))) {
    if (!out.includes(match[1])) out.push(match[1]);
  }
  return out;
}

function ratingBlocks(html) {
  const src = String(html || "");
  const heads = [];
  const re = /<h5>([\s\S]*?)<\/h5>/g;
  let match;
  while ((match = re.exec(src))) {
    heads.push({ role: stripTags(match[1]), from: match.index + match[0].length });
  }
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const end = i + 1 < heads.length ? heads[i + 1].from : src.length;
    const slice = src.slice(heads[i].from, end);
    if (!slice.includes("detailed-ratings")) continue;
    const row = { role: heads[i].role };
    const boxes = slice.matchAll(/<div class="rating-box[^"]*">([^<]*)<\/div>[\s\S]*?<p>([^<]+)<\/p>/g);
    for (const box of boxes) {
      const grade = decodeHtml(box[1]);
      const label = decodeHtml(box[2]);
      if (!TIER.test(grade) || !label) continue;
      if (!row.modes) row.modes = [];
      row.modes.push({ label, grade });
    }
    if (row.role && row.modes && row.modes.length) out.push(row);
  }
  return out;
}

function splitValue(html) {
  const src = String(html || "");
  const marker = '<h6 class="text-lg value-tier-heading">';
  const at = src.indexOf(marker);
  if (at < 0) return { main: src, value: "" };
  return { main: src.slice(0, at), value: src.slice(at) };
}

/**
 * WuWa ratings. Main Tower of Adversity / Whimpering Wastes rows win.
 * Value rows are used only when the main block has neither mode.
 */
export function parseWuwaRatings(html) {
  const { main, value } = splitValue(html);
  const keep = (rows, valueFlag) =>
    rows
      .map((row) => {
        const next = { role: row.role, value: valueFlag };
        for (const mode of row.modes) {
          if (mode.label === "Tower of Adversity" || mode.label === "Tower of Adversity (Value)") next.tower = mode.grade;
          else if (mode.label === "Whimpering Wastes" || mode.label === "Whimpering Wastes (Value)") next.whimpering = mode.grade;
        }
        if (!next.tower && !next.whimpering) return null;
        return next;
      })
      .filter(Boolean);
  const mainRows = keep(ratingBlocks(main), false);
  const valueRows = keep(ratingBlocks(value), true);
  if (mainRows.length) return { rows: mainRows, value: false };
  if (valueRows.length) return { rows: valueRows, value: true };
  return { rows: [], value: false };
}

export function wuwaTierLine(parsed) {
  const rows = parsed?.rows || [];
  if (!rows.length) return "";
  const parts = rows.map((row) => {
    const bits = [];
    if (row.tower) bits.push(`Tower of Adversity ${row.tower}`);
    if (row.whimpering) bits.push(`Whimpering Wastes ${row.whimpering}`);
    const role = parsed.value && !/value/i.test(row.role) ? `${row.role} Value` : row.role;
    return `${role}：${bits.join(" / ")}`;
  });
  return `Prydwen ${parts.join("；")}`;
}

export function parseWuwaTeams(html) {
  const src = String(html || "");
  const marker = '<div class="team-row">';
  const teams = [];
  let from = 0;
  while (from < src.length) {
    const index = src.indexOf(marker, from);
    if (index < 0) break;
    const row = sliceDiv(src, index);
    from = index + marker.length;
    if (!row) continue;
    const before = src.slice(Math.max(0, index - 900), index);
    const headers = [...before.matchAll(/<div class="team-header"><p>([^<]+)<\/p><\/div>/g)];
    const header = headers.length ? decodeHtml(headers[headers.length - 1][1]) : "";
    if (!header) continue;
    const columns = [];
    const colRe = /<div class="column(?: middle)?">/g;
    let col;
    while ((col = colRe.exec(row))) {
      const chunk = sliceDiv(row, col.index);
      if (chunk) columns.push(chunk);
    }
    if (columns.length !== 3) continue;
    const strict = [];
    const primary = [];
    let strictOk = true;
    let primaryOk = true;
    for (const column of columns) {
      const all = characterSlugs(column, "wuthering-waves");
      const big = characterSlugs(firstDiv(column, "big"), "wuthering-waves");
      if (all.length !== 1) strictOk = false;
      else strict.push(all[0]);
      if (big.length !== 1) primaryOk = false;
      else primary.push(big[0]);
    }
    if (strictOk) teams.push({ header, slugs: strict, primaryOnly: false });
    else if (primaryOk) teams.push({ header, slugs: primary, primaryOnly: true });
  }
  return teams;
}

/** ZZZ character-page ratings. Keeps the mode label the page prints. */
export function parseZzzRatings(html) {
  const cut = String(html || "").split("Pros &amp; Cons")[0].split("Pros & Cons")[0];
  return ratingBlocks(cut).map((row) => ({
    role: row.role,
    modes: row.modes.filter((mode) => TIER.test(mode.grade)),
  }));
}

export function zzzTierLine(rows) {
  const usable = (rows || []).filter((row) => row.role && row.modes && row.modes.length);
  if (!usable.length) return "";
  const parts = usable.map((row) => {
    const bits = row.modes.map((mode) => `${mode.label} ${mode.grade}`);
    return `${row.role}：${bits.join(" / ")}`;
  });
  return `Prydwen ${parts.join("；")}`;
}

/** Nikke character-page teams. A box with a placeholder slot is not a roster. */
export function parseNikkeTeams(html) {
  const src = String(html || "");
  const marker = '<div class="box nikke-team">';
  const teams = [];
  let from = 0;
  while (from < src.length) {
    const index = src.indexOf(marker, from);
    if (index < 0) break;
    const box = sliceDiv(src, index);
    from = index + marker.length;
    if (!box || box.includes("placeholder-role")) continue;
    const title = decodeHtml((box.match(/<p class="skill-name">([^<]*)<\/p>/) || [])[1] || "");
    const mode = decodeHtml((box.match(/Mode:\s*<strong>([^<]*)<\/strong>/) || [])[1] || "");
    const element = decodeHtml((box.match(/Element:[\s\S]{0,120}<strong[^>]*>([^<]*)<\/strong>/) || [])[1] || "");
    const slugs = characterSlugs(box, "nikke");
    if (!title || !mode || slugs.length !== 5) continue;
    teams.push({ title, mode, element, slugs });
  }
  return teams;
}

/**
 * Limbus team-database cards. Each box is one published roster.
 * Identity links only; a box is kept when it names 5 to 12 distinct identities.
 */
export function parseLimbusTeamBoxes(html) {
  const src = String(html || "");
  const marker = '<div class="box limbus-team">';
  const teams = [];
  let from = 0;
  while (from < src.length) {
    const index = src.indexOf(marker, from);
    if (index < 0) break;
    const box = sliceDiv(src, index);
    from = index + marker.length;
    if (!box) continue;
    const title = decodeHtml((box.match(/<p class="skill-name">([^<]*)<\/p>/) || [])[1] || "");
    const slugs = [];
    const re = /href="\/limbus-company\/identities\/([a-z0-9-]+)"/g;
    let match;
    while ((match = re.exec(box))) {
      if (!slugs.includes(match[1])) slugs.push(match[1]);
    }
    if (!title || slugs.length < 5 || slugs.length > 12) continue;
    teams.push({ title, slugs });
  }
  return teams;
}
