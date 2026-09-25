/**
 * Hot cache for guide card lookups (in-memory + optional disk under data/cache/guides/).
 * TTL 15–30 min (default 20). Used by guide / guide_hw / ask paths.
 */
import fs from "node:fs";
import path from "node:path";
import { guide as guideAny, listCharacterIdsForGame } from "./guides.js";
import { loadDopamine } from "./hw-guides.js";

const DEFAULT_TTL_MS = (() => {
  const n = Number(process.env.GAME_INTEL_GUIDE_CACHE_TTL_MS);
  if (Number.isFinite(n) && n > 0) return Math.trunc(n);
  return 20 * 60 * 1000; // 20 min
})();

const DISK_DISABLED = process.env.GAME_INTEL_GUIDE_CACHE_DISK === "0";

/** @type {Map<string, { expires: number, value: object }>} */
const mem = new Map();

let stats = { hits: 0, misses: 0, warm: 0 };

export function guideCacheStats() {
  return { ...stats, size: mem.size, ttl_ms: DEFAULT_TTL_MS };
}

export function guideCacheClear() {
  mem.clear();
  stats = { hits: 0, misses: 0, warm: 0 };
}

function diskDir(dataDir) {
  return path.join(dataDir, "cache", "guides");
}

function safeKeyPart(s) {
  return String(s ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff._-]+/gi, "_")
    .slice(0, 80);
}

export function guideCacheKey({ game, q, id, topic } = {}) {
  const g = safeKeyPart(game || "hw") || "hw";
  const who = id ? `id:${safeKeyPart(id)}` : `q:${safeKeyPart(q)}`;
  const t = safeKeyPart(topic || "all") || "all";
  return `${g}|${who}|${t}`;
}

function diskPath(dataDir, key) {
  const file = key.replace(/\|/g, "__") + ".json";
  return path.join(diskDir(dataDir), file);
}

function readDisk(dataDir, key) {
  if (DISK_DISABLED) return undefined;
  try {
    const p = diskPath(dataDir, key);
    if (!fs.existsSync(p)) return undefined;
    const obj = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!obj || typeof obj !== "object" || !("expires" in obj) || !("value" in obj)) {
      return undefined;
    }
    if (Date.now() > Number(obj.expires)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
      return undefined;
    }
    return obj.value;
  } catch {
    return undefined;
  }
}

function writeDisk(dataDir, key, value, expires) {
  if (DISK_DISABLED) return;
  try {
    const dir = diskDir(dataDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      diskPath(dataDir, key),
      JSON.stringify({ expires, value, saved_at: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

export function guideCacheGet(dataDir, key) {
  const now = Date.now();
  const hit = mem.get(key);
  if (hit) {
    if (hit.expires > now) {
      stats.hits++;
      return hit.value;
    }
    mem.delete(key);
  }
  const disk = readDisk(dataDir, key);
  if (disk !== undefined) {
    mem.set(key, { expires: now + DEFAULT_TTL_MS, value: disk });
    stats.hits++;
    return disk;
  }
  stats.misses++;
  return undefined;
}

export function guideCacheSet(dataDir, key, value) {
  const expires = Date.now() + DEFAULT_TTL_MS;
  mem.set(key, { expires, value });
  writeDisk(dataDir, key, value, expires);
}

/**
 * Cached guide lookup. Returns card JSON with cache: "hit"|"miss"|"bypass".
 */
export function cachedGuide(dataDir, opts = {}) {
  const { game, q, id, topic, bypass_cache } = opts;
  if (bypass_cache || process.env.GAME_INTEL_GUIDE_CACHE === "0") {
    const v = guideAny(dataDir, { game, q, id, topic });
    return { ...v, cache: "bypass" };
  }
  const key = guideCacheKey({ game, q, id, topic });
  const hit = guideCacheGet(dataDir, key);
  if (hit !== undefined) {
    return { ...hit, cache: "hit" };
  }
  const value = guideAny(dataDir, { game, q, id, topic });
  // Only cache successful-ish cards (ok true) to avoid sticky misses
  if (value && value.ok) {
    guideCacheSet(dataDir, key, value);
  }
  return { ...value, cache: "miss" };
}

function dopamineRosterIds(dataDir) {
  const d = loadDopamine(dataDir);
  const ids = new Set();
  for (const team of d?.teams || []) {
    for (const m of team.members || []) {
      if (m?.id) ids.add(String(m.id).toLowerCase());
    }
  }
  return [...ids];
}

const NIKKE_WARM = ["rapi", "modernia", "scarlet", "alice"];
const BD2_WARM_Q = ["黑妹", "章鱼妹", "哥杀"];

/**
 * Preload popular cards into memory (+ disk). Safe no-op on missing files.
 */
export function warmGuideCache(dataDir) {
  let n = 0;
  const topics = ["all", "stigmata", "skills"];
  for (const id of dopamineRosterIds(dataDir)) {
    for (const topic of topics) {
      try {
        const v = guideAny(dataDir, { game: "hw", id, topic });
        if (v?.ok) {
          guideCacheSet(dataDir, guideCacheKey({ game: "hw", id, topic }), v);
          n++;
        }
      } catch {
        /* ignore */
      }
    }
  }
  // dopamine mode card
  try {
    const v = guideAny(dataDir, { game: "hw", q: "多巴胺", topic: "dopamine" });
    if (v?.ok) {
      guideCacheSet(
        dataDir,
        guideCacheKey({ game: "hw", q: "多巴胺", topic: "dopamine" }),
        v
      );
      n++;
    }
  } catch {
    /* ignore */
  }

  for (const id of NIKKE_WARM) {
    try {
      const v = guideAny(dataDir, { game: "nikke", id, topic: "all" });
      if (v?.ok) {
        guideCacheSet(dataDir, guideCacheKey({ game: "nikke", id, topic: "all" }), v);
        n++;
      }
    } catch {
      /* ignore */
    }
  }

  for (const q of BD2_WARM_Q) {
    try {
      const v = guideAny(dataDir, { game: "bd2", q, topic: "all" });
      if (v?.ok) {
        guideCacheSet(dataDir, guideCacheKey({ game: "bd2", q, topic: "all" }), v);
        n++;
      }
    } catch {
      /* ignore */
    }
  }

  stats.warm = n;
  return { ok: true, warmed: n, stats: guideCacheStats() };
}

export { DEFAULT_TTL_MS as GUIDE_CACHE_TTL_MS, listCharacterIdsForGame };
