/**
 * Horizon Walker local guide cards (aliases + character builds + dopamine teams).
 * Disk-only; prefer GameKee 图鉴/测评 facts — never invent skill names/numbers.
 */
import fs from "node:fs";
import path from "node:path";

const TOPIC_ENUM = new Set(["overview", "skills", "stigmata", "dopamine", "all"]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeQuery(q) {
  return String(q ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** Strip topic-ish suffixes so "修女圣痕" still resolves to lysandria. */
function stripTopicTokens(raw) {
  return String(raw ?? "")
    .replace(
      /(圣痕|技能|配队|构筑|攻略|overview|skills|stigmata|dopamine|build|team|套装|武器|专武)/gi,
      ""
    )
    .trim();
}

function inferTopic(q, topic) {
  if (topic && TOPIC_ENUM.has(topic)) return topic;
  const s = String(q ?? "");
  if (/圣痕|stigmata|木星|优菲|套装/i.test(s)) return "stigmata";
  if (/技能|skills|skill_prio|加点/i.test(s)) return "skills";
  if (/多巴胺|dopamine|自动队|自动三队/i.test(s)) return "dopamine";
  if (/overview|总览|简介/i.test(s)) return "overview";
  return "all";
}

export function hwGuidesDir(dataDir) {
  // Canonical: data/guides/hw ; legacy symlink/folder data/hw-guides
  const canonical = path.join(dataDir, "guides", "hw");
  if (fs.existsSync(canonical)) return canonical;
  return path.join(dataDir, "hw-guides");
}

export function loadAliases(dataDir) {
  const p = path.join(hwGuidesDir(dataDir), "aliases.json");
  if (!fs.existsSync(p)) return { aliases: {} };
  return readJson(p);
}

export function loadDopamine(dataDir) {
  const p = path.join(hwGuidesDir(dataDir), "dopamine-auto.json");
  if (!fs.existsSync(p)) return null;
  return readJson(p);
}

export function listCharacterIds(dataDir) {
  const dir = path.join(hwGuidesDir(dataDir), "characters");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
}

export function loadCharacter(dataDir, id) {
  if (!id) return null;
  const key = String(id).toLowerCase().trim();
  const p = path.join(hwGuidesDir(dataDir), "characters", `${key}.json`);
  if (!fs.existsSync(p)) return null;
  return readJson(p);
}

/**
 * Resolve nickname / id / name → canonical { id, name, kind, ... }.
 */
export function resolveAlias(dataDir, q) {
  const raw = String(q ?? "").trim();
  if (!raw) return { ok: false, error: "need_q" };

  const data = loadAliases(dataDir);
  const map = data.aliases || {};

  const candidates = [
    raw,
    normalizeQuery(raw),
    stripTopicTokens(raw),
    normalizeQuery(stripTopicTokens(raw)),
  ].filter(Boolean);

  for (const c of candidates) {
    if (map[c]) {
      return {
        ok: true,
        q: raw,
        matched: c,
        ...map[c],
      };
    }
    // case-insensitive scan for latin keys
    const lower = c.toLowerCase();
    for (const [k, v] of Object.entries(map)) {
      if (k.toLowerCase() === lower) {
        return { ok: true, q: raw, matched: k, ...v };
      }
    }
  }

  // Fuzzy: if query contains a known alias key (longest first)
  const keys = Object.keys(map).sort((a, b) => b.length - a.length);
  const hay = raw.toLowerCase();
  for (const k of keys) {
    if (k.length < 2) continue;
    if (hay.includes(k.toLowerCase())) {
      return { ok: true, q: raw, matched: k, fuzzy: true, ...map[k] };
    }
  }

  // Direct character id file
  const idTry = normalizeQuery(stripTopicTokens(raw)).replace(/[^a-z0-9_-]/gi, "");
  const card = idTry ? loadCharacter(dataDir, idTry) : null;
  if (card) {
    return {
      ok: true,
      q: raw,
      matched: idTry,
      id: card.id,
      name: card.name,
      kind: "character",
    };
  }

  return { ok: false, error: "not_found", q: raw };
}

function pickOverview(card) {
  return {
    id: card.id,
    name: card.name,
    name_en: card.name_en || null,
    nicknames: card.nicknames || [],
    role: card.role || null,
    weapon: card.weapon ?? null,
    stub: !!card.stub,
    note: card.note || null,
    as_of: card.as_of || null,
  };
}

function pickSkills(card) {
  return {
    skills: card.skills || [],
    skill_prio: card.skill_prio || [],
  };
}

function pickStigmata(card) {
  return { stigmata: card.stigmata ?? null };
}

function teamsForChar(dataDir, card) {
  const dopa = loadDopamine(dataDir);
  if (!dopa?.teams) return null;
  const teamId = card.teams?.dopamine_auto;
  if (!teamId) return { dopamine_auto: null };
  const team = dopa.teams.find((t) => t.id === teamId) || null;
  return {
    dopamine_auto: team
      ? {
          team_id: team.id,
          label: team.label,
          stages: team.stages,
          members: team.members,
        }
      : { team_id: teamId },
  };
}

function sliceCard(dataDir, card, topic) {
  const sources = card.sources || [];
  const base = {
    ok: true,
    topic,
    id: card.id,
    name: card.name,
    sources,
  };

  if (topic === "overview") {
    return { ...base, ...pickOverview(card) };
  }
  if (topic === "skills") {
    return { ...base, ...pickSkills(card) };
  }
  if (topic === "stigmata") {
    return { ...base, ...pickStigmata(card) };
  }
  if (topic === "dopamine") {
    return { ...base, teams: teamsForChar(dataDir, card) };
  }
  // all
  return {
    ...base,
    ...pickOverview(card),
    ...pickSkills(card),
    ...pickStigmata(card),
    teams: teamsForChar(dataDir, card),
  };
}

/**
 * Short JSON guide card. Args: q | id, topic?
 * topic: overview|skills|stigmata|dopamine|all
 */
export function guideHw(dataDir, { q, id, topic } = {}) {
  const rawQ = q != null ? String(q).trim() : "";
  const rawId = id != null ? String(id).trim() : "";
  const resolvedTopic = inferTopic(rawQ || rawId, topic);

  // Pure dopamine query (no character)
  if (
    resolvedTopic === "dopamine" &&
    !rawId &&
    (!rawQ ||
      /^(多巴胺|dopamine|自动队|自动三队|多巴胺自动)/i.test(rawQ) ||
      !resolveAlias(dataDir, rawQ).ok)
  ) {
    const dopa = loadDopamine(dataDir);
    if (!dopa) return { ok: false, error: "no_dopamine_data" };
    return {
      ok: true,
      topic: "dopamine",
      id: dopa.id,
      name: dopa.name,
      constraint: dopa.constraint,
      as_of: dopa.as_of,
      teams: dopa.teams,
      sources: dopa.sources || [],
    };
  }

  // Stigmata-set only (木星) without a character context → point to set + known users
  if (!rawId && rawQ) {
    const aliasHit = resolveAlias(dataDir, rawQ);
    if (aliasHit.ok && aliasHit.kind === "stigmata_set") {
      // If query also mentions a character (e.g. 修女圣痕), prefer character card
      const stripped = stripTopicTokens(rawQ);
      const charHit =
        stripped && stripped !== rawQ
          ? resolveAlias(dataDir, stripped)
          : { ok: false };
      if (charHit.ok && charHit.kind === "character") {
        const card = loadCharacter(dataDir, charHit.id);
        if (card) return sliceCard(dataDir, card, resolvedTopic === "all" ? "stigmata" : resolvedTopic);
      }
      // Prefer lysandria when asking 木星/优菲特尔 alone if she uses it
      const lys = loadCharacter(dataDir, "lysandria");
      if (lys?.stigmata?.set_id === aliasHit.id) {
        return {
          ...sliceCard(dataDir, lys, "stigmata"),
          set: { id: aliasHit.id, name: aliasHit.name },
          note: "set_iuppiter (木星/优菲特尔) encoded via lysandria card; expand set page later",
        };
      }
      return {
        ok: true,
        topic: "stigmata",
        kind: "stigmata_set",
        id: aliasHit.id,
        name: aliasHit.name,
        sources: lys?.sources || [],
        note: "Set alias only; pair with a character guide for full substat notes.",
      };
    }
  }

  let charId = rawId ? rawId.toLowerCase() : null;
  if (!charId && rawQ) {
    const hit = resolveAlias(dataDir, rawQ);
    if (!hit.ok) return { ok: false, error: "not_found", q: rawQ };
    if (hit.kind === "stigmata_set") {
      return guideHw(dataDir, { q: rawQ, topic: "stigmata" });
    }
    charId = hit.id;
  }
  if (!charId) return { ok: false, error: "need_q_or_id" };

  const card = loadCharacter(dataDir, charId);
  if (!card) {
    return {
      ok: false,
      error: "no_character_card",
      id: charId,
      hint: "alias may resolve but card stub missing",
    };
  }

  // 修女圣痕 → stigmata even if topic defaulted oddly
  const topicFinal =
    topic && TOPIC_ENUM.has(topic)
      ? topic
      : inferTopic(rawQ, resolvedTopic);

  return sliceCard(dataDir, card, topicFinal);
}

export { TOPIC_ENUM };
