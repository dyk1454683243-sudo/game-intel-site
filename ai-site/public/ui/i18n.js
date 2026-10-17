/**
 * UI locale helpers. Default is zh-CN with no URL prefix.
 * English lives under /en and Japanese under /ja.
 * Game facts, claims, skills, and headlines are not translated here.
 */

export const SITE_ORIGIN = "https://game-intel-ai.dyk1454683243.workers.dev";

export const LOCALES = Object.freeze([
  { id: "zh-CN", prefix: "", hreflang: "zh-CN", og: "zh_CN", htmlLang: "zh-CN", endonym: "中文" },
  { id: "en", prefix: "/en", hreflang: "en", og: "en_US", htmlLang: "en", endonym: "English" },
  { id: "ja", prefix: "/ja", hreflang: "ja", og: "ja_JP", htmlLang: "ja", endonym: "日本語" },
]);

const LOCALE_IDS = new Set(LOCALES.map((row) => row.id));

let currentLang = "zh-CN";

export function normalizeLang(value) {
  const raw = String(value || "").trim();
  if (raw === "en" || raw.toLowerCase() === "en-us") return "en";
  if (raw === "ja" || raw.toLowerCase() === "ja-jp") return "ja";
  if (raw === "zh" || raw.toLowerCase() === "zh-cn" || raw === "zh-CN") return "zh-CN";
  return "zh-CN";
}

export function getLang() {
  return currentLang;
}

export function setLang(value) {
  currentLang = normalizeLang(value);
  return currentLang;
}

export function withLang(value, fn) {
  const prev = currentLang;
  currentLang = normalizeLang(value);
  try {
    return fn();
  } finally {
    currentLang = prev;
  }
}

export function localeById(id) {
  const lang = normalizeLang(id);
  return LOCALES.find((row) => row.id === lang) || LOCALES[0];
}

export function tx(zh, en, ja) {
  if (currentLang === "en") return en;
  if (currentLang === "ja") return ja;
  return zh;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text || text === "null") return "";
  return text;
}

function hasCjk(value) {
  return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/.test(value);
}

/**
 * English display uses only a name already stored on the card (`name_en`, or a
 * non-CJK `name`). Otherwise the original name stays. Japanese uses `name_ja`
 * only when the card already has one.
 */
export function displayCharacterName(card, lang = currentLang) {
  if (!card || typeof card !== "object") return "";
  const name = cleanName(card.name);
  const nameZh = cleanName(card.name_zh);
  const nameEn = cleanName(card.name_en);
  const nameJa = cleanName(card.name_ja);
  const id = cleanName(card.id);
  const locale = normalizeLang(lang);
  if (locale === "en") {
    if (nameEn) return nameEn;
    if (name && !hasCjk(name)) return name;
    return nameZh || name || id;
  }
  if (locale === "ja") {
    if (nameJa) return nameJa;
    return nameZh || name || id;
  }
  return nameZh || name || id;
}

export function displayGameName(game, lang = currentLang) {
  if (!game || typeof game !== "object") return "";
  const name = cleanName(game.name);
  const nameZh = cleanName(game.name_zh);
  const nameEn = cleanName(game.name_en);
  const nameJa = cleanName(game.name_ja);
  const id = cleanName(game.id);
  const locale = normalizeLang(lang);
  if (locale === "en") {
    if (nameEn) return nameEn;
    if (name && !hasCjk(name)) return name;
    return nameZh || name || id;
  }
  if (locale === "ja") {
    if (nameJa) return nameJa;
    return nameZh || name || id;
  }
  return nameZh || name || id;
}

export function displaySinnerName(sinner, lang = currentLang) {
  if (!sinner || typeof sinner !== "object") return "";
  const name = cleanName(sinner.name);
  const nameZh = cleanName(sinner.name_zh);
  const nameEn = cleanName(sinner.name_en);
  const nameJa = cleanName(sinner.name_ja);
  const id = cleanName(sinner.id);
  const locale = normalizeLang(lang);
  if (locale === "en") {
    if (nameEn) return nameEn;
    if (name && !hasCjk(name)) return name;
    return nameZh || name || id;
  }
  if (locale === "ja") {
    if (nameJa) return nameJa;
    return nameZh || name || id;
  }
  return nameZh || nameEn || name || id;
}

export function isMachinePath(pathname) {
  const path = pathname || "/";
  if (path === "/v1" || path.startsWith("/v1/")) return true;
  if (path === "/mcp" || path.startsWith("/mcp/")) return true;
  if (path.startsWith("/.well-known/")) return true;
  if (path === "/developers" || path.startsWith("/developers/")) return true;
  if (path === "/server-card" || path === "/openapi.json" || path === "/llms.txt") return true;
  if (path === "/schema" || path.startsWith("/schema/")) return true;
  if (path === "/ui" || path.startsWith("/ui/")) return true;
  return false;
}

export function wantsHtmlNotFound(pathname) {
  const { path } = stripLocale(pathname);
  if (isMachinePath(path)) return false;
  if (/\.(?:json|txt|xml|css|js|mjs|png|jpe?g|gif|webp|svg|ico|atom|map|webmanifest)$/i.test(path)) return false;
  return true;
}

export function stripLocale(pathname) {
  const path = pathname && pathname.startsWith("/") ? pathname : `/${pathname || ""}`;
  const match = path.match(/^\/(en|ja)(?=\/|$)/);
  if (!match) return { lang: "zh-CN", path: path || "/" };
  const rest = path.slice(match[0].length) || "/";
  return { lang: match[1], path: rest.startsWith("/") ? rest : `/${rest}` };
}

export function localizePath(pathname, lang = currentLang) {
  const raw = String(pathname || "/");
  const hashAt = raw.indexOf("#");
  const hash = hashAt === -1 ? "" : raw.slice(hashAt);
  const beforeHash = hashAt === -1 ? raw : raw.slice(0, hashAt);
  const queryAt = beforeHash.indexOf("?");
  const search = queryAt === -1 ? "" : beforeHash.slice(queryAt);
  const pathOnly = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  if (!pathOnly.startsWith("/")) return raw;
  const { path } = stripLocale(pathOnly);
  if (isMachinePath(path)) return `${path}${search}${hash}`;
  const prefix = localeById(lang).prefix;
  let next = path;
  if (prefix) next = path === "/" ? `${prefix}/` : `${prefix}${path}`;
  return `${next}${search}${hash}`;
}

export function pageAlternates(pathname, search = "") {
  const { path } = stripLocale(pathname);
  const query = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  const rows = LOCALES.map((loc) => ({
    hreflang: loc.hreflang,
    lang: loc.id,
    href: absoluteUrl(localizePath(`${path}${query}`, loc.id)),
  }));
  const fallback = rows.find((row) => row.lang === "zh-CN");
  rows.push({ hreflang: "x-default", lang: "x-default", href: fallback.href });
  return rows;
}

export function absoluteUrl(pathname) {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${SITE_ORIGIN}${path}`;
}

export function languageSwitcher(pathname, lang = currentLang) {
  const active = normalizeLang(lang);
  const label = tx("语言", "Language", "言語");
  const links = LOCALES.map((loc) => {
    const href = localizePath(pathname, loc.id);
    const current = loc.id === active ? ' aria-current="true"' : "";
    return `<a href="${escapeHtml(href)}" hreflang="${loc.hreflang}" lang="${loc.htmlLang}"${current}>${loc.endonym}</a>`;
  }).join("");
  return `<nav class="lang-switch" aria-label="${escapeHtml(label)}">${links}</nav>`;
}

export function localeIds() {
  return [...LOCALE_IDS];
}
