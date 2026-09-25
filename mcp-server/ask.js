/**
 * Jev-gated ask flow for game-intel.
 * 1) Run jev --gate game-intel --state …
 * 2) Parse recommendation
 * 3) answer/deep → local guide resolve
 * 4) brief → note digest (heavy digest only with with_digest)
 * 5) ask_dai / skip / escalate → return clearly for parent
 *
 * Requires jev on PATH (or JEV_BIN / JEV_PATH_PREFIX).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { cachedGuide } from "./guide-cache.js";

const JEV_BIN = process.env.JEV_BIN || "jev";
const JEV_PATH_PREFIX = process.env.JEV_PATH_PREFIX || "";

const GAME_HINTS = [
  { id: "hw", re: /\b(hw|horizon\s*walker|地平线|地平线行者)\b/i },
  { id: "nikke", re: /\b(nikke|胜利女神|妮姬)\b/i },
  { id: "bd2", re: /\b(bd2|brown\s*dust\s*2|棕色尘埃|尘白)/i },
  { id: "star", re: /\b(star|蓝色星原|azur\s*promilia)\b/i },
  { id: "asora", re: /\b(asora|阿索拉|astrae)\b/i },
  { id: "miraesi", re: /\b(miraesi|miresi|미래시|invisible\s*future)\b/i },
  { id: "lo2", re: /\b(lo2|last\s*origin\s*2)\b/i },
];

function ensureJevPath() {
  const p = process.env.PATH || "";
  if (JEV_PATH_PREFIX && !p.split(path.delimiter).includes(JEV_PATH_PREFIX)) {
    process.env.PATH = `${JEV_PATH_PREFIX}${path.delimiter}${p}`;
  }
}

function runJev(state, { timeoutMs = 45000 } = {}) {
  ensureJevPath();
  return new Promise((resolve, reject) => {
    const args = ["--gate", "game-intel", "--state", String(state)];
    const child = spawn(JEV_BIN, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("jev_timeout"));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(
          new Error(
            `jev_exit_${code}: ${stderr.slice(0, 200) || stdout.slice(0, 200)}`
          )
        );
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`jev_bad_json: ${String(e.message || e)}`));
      }
    });
  });
}

export function inferGameFromState(state, gameHint) {
  if (gameHint) {
    const g = String(gameHint).toLowerCase().trim();
    if (g) return g;
  }
  const s = String(state || "");
  for (const h of GAME_HINTS) {
    if (h.re.test(s)) return h.id;
  }
  return "hw"; // default watchlist home
}

export function inferTopicFromState(state) {
  const s = String(state || "");
  if (/圣痕|stigmata|木星|优菲|套装/i.test(s)) return "stigmata";
  if (/技能|skills|加点|skill_prio/i.test(s)) return "skills";
  if (/多巴胺|dopamine|自动队|配队|team/i.test(s)) return "dopamine";
  if (/overview|总览|简介/i.test(s)) return "overview";
  return "all";
}

/** Strip game labels / source tags / topic words so guide alias resolve sees the character. */
export function extractGuideQuery(state, game) {
  let s = String(state || "").trim();
  s = s
    .replace(/来源\s*[:：]?\s*\w+/gi, " ")
    .replace(/\b(GameKee|Bahamut|Prydwen|TapTap|Inven|官方)\b/gi, " ")
    .replace(
      /\b(Horizon\s*Walker|地平线行者|地平线|NIKKE|胜利女神|妮姬|Brown\s*Dust\s*2|BD2|棕色尘埃|蓝色星原|阿索拉|미래시|Last\s*Origin\s*2|LO2|Astrae\s*Oratio|Azur\s*Promilia)\b/gi,
      " "
    )
    .replace(/\b(hw|nikke|bd2|star|asora|miraesi|lo2)\b/gi, " ")
    .replace(
      /(圣痕|技能|配队|构筑|攻略|怎么样|如何|用什么|推荐|overview|skills|stigmata|dopamine|build|team|套装|武器|专武)/gi,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
  return s || String(state || "").trim();
}

/** Candidate queries for alias resolve (full → stripped → compact). */
export function guideQueryCandidates(state, game) {
  const raw = extractGuideQuery(state, game);
  const compact = raw.replace(/\s+/g, "");
  const out = [];
  for (const c of [raw, compact]) {
    if (c && !out.includes(c)) out.push(c);
  }
  return out.length ? out : [String(state || "").trim()];
}

/**
 * Parse jev recommendation into a stable action bucket.
 * game-intel returns e.g. "answer:other", "deep:team", "ask_dai", "skip:weak_source", "escalate".
 */
export function parseRecommendation(jevOut) {
  const rec = String(jevOut?.recommendation || "");
  const actionAns = jevOut?.answers?.action || {};
  const choice = actionAns.choice || null;
  const confidence = actionAns.confidence ?? null;
  const topic = jevOut?.answers?.topic?.choice || null;
  const source_ok = jevOut?.answers?.source_ok?.noul ?? null;

  let action = null;
  let topicFromRec = null;
  if (rec === "ask_dai") action = "ask_dai";
  else if (rec === "escalate") action = "escalate";
  else if (rec.startsWith("skip")) action = "skip";
  else {
    const m = rec.match(/^(brief|answer|deep)(?::(.+))?$/);
    if (m) {
      action = m[1];
      topicFromRec = m[2] || null;
    } else if (choice) {
      action = choice;
    }
  }

  return {
    recommendation: rec || null,
    action,
    topic: topicFromRec || topic,
    choice,
    confidence,
    source_ok,
  };
}

function summarizeCard(card) {
  if (!card || typeof card !== "object") return null;
  const out = {
    ok: !!card.ok,
    game: card.game || null,
    id: card.id || null,
    name: card.name || card.name_zh || null,
    name_zh: card.name_zh || null,
    topic: card.topic || null,
    stub: card.stub ?? null,
    cache: card.cache || null,
  };
  if (card.error) out.error = card.error;
  if (card.stigmata) out.stigmata = card.stigmata;
  if (card.skills) out.skills = Array.isArray(card.skills) ? card.skills.slice(0, 6) : card.skills;
  if (card.skill_prio) out.skill_prio = card.skill_prio;
  if (card.role) out.role = card.role;
  if (card.rarity) out.rarity = card.rarity;
  if (card.teams) out.teams = card.teams;
  if (card.sources) out.sources = card.sources;
  if (card.hint) out.hint = card.hint;
  if (card.note) out.note = card.note;
  return out;
}

/**
 * @param {string} dataDir
 * @param {{ state: string, game?: string, with_digest?: boolean }} opts
 */
export async function askIntel(dataDir, opts = {}) {
  const state = String(opts.state || "").trim();
  if (!state) {
    return { ok: false, error: "need_state" };
  }

  let jev;
  try {
    jev = await runJev(state);
  } catch (e) {
    return {
      ok: false,
      error: "jev_failed",
      detail: String(e.message || e).slice(0, 200),
      hint: "Ensure jev is on PATH (or set JEV_BIN / JEV_PATH_PREFIX)",
    };
  }

  const parsed = parseRecommendation(jev);
  const game = inferGameFromState(state, opts.game);
  const topic =
    inferTopicFromState(state) !== "all"
      ? inferTopicFromState(state)
      : parsed.topic && parsed.topic !== "other"
        ? parsed.topic === "team"
          ? "dopamine"
          : parsed.topic
        : inferTopicFromState(state);
  const qCandidates = guideQueryCandidates(state, game);
  const q = qCandidates[0];

  const base = {
    ok: true,
    state,
    game,
    jev: {
      recommendation: parsed.recommendation,
      action: parsed.action,
      choice: parsed.choice,
      confidence: parsed.confidence,
      topic: parsed.topic,
      source_ok: parsed.source_ok,
      model: jev.model || null,
    },
  };

  if (parsed.action === "ask_dai" || parsed.action === "escalate") {
    return {
      ...base,
      route: parsed.action,
      for_parent: parsed.action === "ask_dai" ? "ask_dai" : "escalate",
      message:
        parsed.action === "ask_dai"
          ? "Escalate to Dai (spend/gacha or permanent watchlist add / unclear scope)."
          : "Jev mid-band escalate — parent should decide or rephrase.",
    };
  }

  if (parsed.action === "skip") {
    return {
      ...base,
      route: "skip",
      for_parent: "skip",
      message: parsed.recommendation || "skip",
    };
  }

  if (parsed.action === "brief") {
    const out = {
      ...base,
      route: "brief",
      for_parent: "brief",
      message:
        "Digest-worthy item — use digest tool (not run here unless --with-digest).",
      q,
    };
    if (opts.with_digest) {
      try {
        const { digestGame } = await import("./index.js");
        // light: single-game if known
        const wlPath = path.join(dataDir, "watchlist.json");
        let entry = null;
        try {
          const wl = JSON.parse(fs.readFileSync(wlPath, "utf8"));
          entry = wl[game] || null;
        } catch {
          entry = null;
        }
        if (entry) {
          out.digest = await digestGame(game, entry, {
            summarize: true,
            diff: true,
            only_new: true,
          });
        } else {
          out.digest = { ok: false, error: "no_watchlist_entry", game };
        }
      } catch (e) {
        out.digest = { ok: false, error: String(e.message || e).slice(0, 120) };
      }
    }
    return out;
  }

  // answer or deep (or unknown → try guide)
  const route = parsed.action === "deep" ? "deep" : "answer";
  let card = null;
  let usedQ = q;
  for (const cand of qCandidates) {
    const tryCard = cachedGuide(dataDir, { game, q: cand, topic });
    if (tryCard?.ok) {
      card = tryCard;
      usedQ = cand;
      break;
    }
    if (!card) card = tryCard;
  }
  const summary = summarizeCard({ ...card, game: card?.game || game });
  // expose the query that hit

  return {
    ...base,
    route,
    for_parent: route,
    q: usedQ,
    topic,
    guide: summary,
    guide_ok: !!card?.ok,
    hint:
      route === "deep" && !card?.ok
        ? "Local card miss — parent should get_article / multi-source before answering."
        : route === "deep" && card?.ok
          ? "Local card hit; still consider get_article if sources conflict or patch notes needed."
          : card?.ok
            ? "Answer from local guide card."
            : "No local card — parent may deep-fetch or ask_dai if scope unclear.",
  };
}

export { runJev, ensureJevPath };
