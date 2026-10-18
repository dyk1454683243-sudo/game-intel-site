/**
 * Shared head tags, JSON-LD, and sitemap XML. No DOM and no Node APIs.
 * Facts (ratings, prices, skill text) are never invented here.
 */
import {
  LOCALES,
  SITE_ORIGIN,
  absoluteUrl,
  displayGameName,
  escapeHtml,
  languageSwitcher,
  localeById,
  pageAlternates,
  stripLocale,
} from "./i18n.js";

export function seoModel({
  lang = "zh-CN",
  title,
  description,
  pathname,
  search = "",
  crumbs = [],
  videoGame = null,
  robots = "index, follow",
}) {
  const locale = localeById(lang);
  const { path } = stripLocale(pathname || "/");
  const query = search ? (search.startsWith("?") ? search : `?${search}`) : "";
  const localizedPath = locale.prefix
    ? path === "/"
      ? `${locale.prefix}/${query}`
      : `${locale.prefix}${path}${query}`
    : `${path}${query}`;
  const canonicalHref = absoluteUrl(localizedPath);
  const alternates = pageAlternates(path, query);
  const graph = [websiteNode()];
  if (Array.isArray(crumbs) && crumbs.length > 1) graph.push(breadcrumbNode(crumbs, locale.id));
  if (videoGame) graph.push(videoGameNode(videoGame, canonicalHref, locale.id));
  return {
    lang: locale.id,
    htmlLang: locale.htmlLang,
    title,
    description,
    robots,
    canonical: canonicalHref,
    alternates,
    ogLocale: locale.og,
    ogAlternates: LOCALES.filter((row) => row.id !== locale.id).map((row) => row.og),
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": graph,
    },
  };
}

function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": `${SITE_ORIGIN}/#website`,
    name: "game-intel",
    url: `${SITE_ORIGIN}/`,
    inLanguage: LOCALES.map((row) => row.hreflang),
  };
}

function breadcrumbNode(crumbs, lang) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      item: absoluteUrl(crumb.path || "/"),
    })),
    inLanguage: localeById(lang).hreflang,
  };
}

function videoGameNode(game, pageUrl, lang) {
  const name = displayGameName(game, lang) || game.id;
  const node = {
    "@type": "VideoGame",
    name,
    url: pageUrl,
  };
  const alts = [];
  for (const value of [game.name, game.name_zh, game.name_en, game.name_ja]) {
    if (typeof value === "string" && value.trim() && value.trim() !== name && !alts.includes(value.trim())) {
      alts.push(value.trim());
    }
  }
  if (alts.length) node.alternateName = alts;
  if (Array.isArray(game.platforms) && game.platforms.length) node.gamePlatform = game.platforms;
  if (game.steam_appid != null && game.steam_appid !== "") node.identifier = String(game.steam_appid);
  const same = [];
  for (const source of game.sources || []) {
    const url = source && typeof source === "object" ? source.url : source;
    if (typeof url === "string" && /^https:\/\//i.test(url)) same.push(url);
  }
  if (same.length) node.sameAs = same;
  return node;
}

export const GOOGLE_SITE_VERIFICATION_TAG =
  '<meta name="google-site-verification" content="dDvLWlS-NRhgYTEgf7Tf8SKePsFCJQhkH9xq3b-ZkZk" />';

export function renderHeadTags(model) {
  const alternates = model.alternates
    .map((row) => `<link rel="alternate" hreflang="${escapeHtml(row.hreflang)}" href="${escapeHtml(row.href)}"/>`)
    .join("\n  ");
  const ogAlt = model.ogAlternates
    .map((code) => `<meta property="og:locale:alternate" content="${escapeHtml(code)}"/>`)
    .join("\n  ");
  const json = JSON.stringify(model.jsonLd).replace(/</g, "\\u003c");
  return `${GOOGLE_SITE_VERIFICATION_TAG}
  <title>${escapeHtml(model.title)}</title>
  <meta name="description" content="${escapeHtml(model.description)}"/>
  <meta name="robots" content="${escapeHtml(model.robots)}"/>
  <link rel="canonical" href="${escapeHtml(model.canonical)}"/>
  ${alternates}
  <meta property="og:site_name" content="game-intel"/>
  <meta property="og:type" content="website"/>
  <meta property="og:title" content="${escapeHtml(model.title)}"/>
  <meta property="og:description" content="${escapeHtml(model.description)}"/>
  <meta property="og:url" content="${escapeHtml(model.canonical)}"/>
  <meta property="og:locale" content="${escapeHtml(model.ogLocale)}"/>
  ${ogAlt}
  <meta name="twitter:card" content="summary"/>
  <meta name="twitter:title" content="${escapeHtml(model.title)}"/>
  <meta name="twitter:description" content="${escapeHtml(model.description)}"/>
  <script type="application/ld+json">${json}</script>`;
}

export function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STATIC_CSS = `body{font-family:system-ui,sans-serif;max-width:880px;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#111}
    a{color:#06c} code{background:#f4f4f4;padding:.1em .35em;border-radius:4px}
    .stub{color:#a60}.rich{color:#070} ul{padding-left:1.2rem}
    .meta{color:#666;font-size:.9rem} table{border-collapse:collapse;width:100%}
    td,th{border:1px solid #ddd;padding:.4rem .55rem;text-align:left}
    .tag{display:inline-block;background:#eef2f7;border-radius:4px;padding:.05em .4em;margin:0 .2em .2em 0;font-size:.85rem}
    .wl{font-weight:600}
    .lang-switch{display:flex;gap:.5rem;margin:0 0 1rem}
    .lang-switch a[aria-current="true"]{font-weight:700}
    .conclusion{background:#f7fafc;border:1px solid #c8d6e5;border-radius:8px;padding:.75rem 1rem;margin:1rem 0}
    .conclusion h2{font-size:1rem;margin:0 0 .5rem;color:#234}
    .conclusion dl{margin:0;display:grid;grid-template-columns:7.5em 1fr;gap:.35rem .75rem}
    .conclusion dt{font-weight:600;color:#456}
    .conclusion dd{margin:0}
    .conclusion .srcs{list-style:none;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:.35rem .75rem}
    .conclusion .srcs a{font-size:.85rem}`;

export function staticDocument({ lang, title, description, pathname, crumbs, videoGame, body }) {
  const model = seoModel({ lang, title, description, pathname, crumbs, videoGame });
  return `<!DOCTYPE html>
<html lang="${localeById(lang).htmlLang}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  ${renderHeadTags(model)}
  <style>
    ${STATIC_CSS}
  </style>
</head>
<body>
${languageSwitcher(pathname, lang)}
${body}
<hr/>
<p class="meta">game-intel · Asia/Shanghai</p>
</body>
</html>
`;
}

export function renderSitemapIndex(locs) {
  const body = locs
    .map((loc) => `  <sitemap>\n    <loc>${xmlEscape(loc)}</loc>\n  </sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

export function renderUrlSet(entries) {
  const body = entries
    .map((entry) => {
      const links = (entry.alternates || [])
        .map(
          (row) =>
            `    <xhtml:link rel="alternate" hreflang="${xmlEscape(row.hreflang)}" href="${xmlEscape(row.href)}"/>`
        )
        .join("\n");
      const lastmod = entry.lastmod ? `\n    <lastmod>${xmlEscape(entry.lastmod)}</lastmod>` : "";
      return `  <url>\n    <loc>${xmlEscape(entry.loc)}</loc>${lastmod}\n${links}\n  </url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
}
