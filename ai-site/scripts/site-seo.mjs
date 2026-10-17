/**
 * Human-page shells, robots.txt, and sitemap.xml.
 * Called from the export scripts. Does not publish and does not touch /v1 JSON.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCALES,
  SITE_ORIGIN,
  absoluteUrl,
  getLang,
  languageSwitcher,
  localeById,
  localizePath,
  stripLocale,
  tx,
  withLang,
} from "../public/ui/i18n.js";
import { renderHeadTags, renderSitemapIndex, renderUrlSet, seoModel, staticDocument } from "../public/ui/seo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, "..");

function tri(zh, en, ja) {
  return tx(zh, en, ja);
}

const SHELLS = [
  {
    view: "home",
    path: "/",
    file: "index.html",
    copies: ["ui/home.html"],
    rootCopy: true,
    crumbs: () => [],
    title: ["首页 · game-intel", "Home · game-intel", "ホーム · game-intel"],
    description: [
      "今日情报摘要。人从观察名单继续，AI 读同一份已发布的 /v1 JSON。",
      "Today's intel brief. People continue from the watchlist. AI reads the same published /v1 JSON.",
      "今日の情報摘要。人はウォッチリストへ。AI は同じ公開 /v1 JSON を読む。",
    ],
    loading: [
      "正在读取 /v1/digest.json 与 /v1/radar.json …",
      "Reading /v1/digest.json and /v1/radar.json …",
      "/v1/digest.json と /v1/radar.json を読んでいます…",
    ],
    noscript: [
      "需要 JavaScript。本页只展示已发布的 /v1 JSON。",
      "JavaScript is required. This page only shows published /v1 JSON.",
      "JavaScript が必要。このページは公開済みの /v1 JSON だけを出す。",
    ],
  },
  {
    view: "catalog",
    path: "/catalog/",
    file: "catalog/index.html",
    crumbs: () => [tri("目录", "Catalog", "カタログ")],
    title: ["目录 · game-intel", "Catalog · game-intel", "カタログ · game-intel"],
    description: [
      "游戏目录。stub 身份卡只展示名称、平台、标签、出处和 steam_appid。",
      "Game catalog. Stub identity cards show the stored name, platforms, tags, sources, and steam_appid.",
      "ゲーム目録。stub の身元カードは名前、プラットフォーム、タグ、出典、steam_appid だけ。",
    ],
    loading: ["正在读取 /v1/games/index.json …", "Reading /v1/games/index.json …", "/v1/games/index.json を読んでいます…"],
    noscript: [
      "需要 JavaScript。本页只展示已发布的 /v1 JSON。",
      "JavaScript is required. This page only shows published /v1 JSON.",
      "JavaScript が必要。このページは公開済みの /v1 JSON だけを出す。",
    ],
  },
  {
    view: "watchlist",
    path: "/watchlist/",
    file: "watchlist/index.html",
    crumbs: () => [tri("观察名单", "Watchlist", "ウォッチリスト")],
    title: ["观察名单 · game-intel", "Watchlist · game-intel", "ウォッチリスト · game-intel"],
    description: [
      "观察名单上的游戏。已深耕的有角色图鉴，其余只保留身份。",
      "Games on the watchlist. Guides exist only where they were already published. The rest stay identity-only.",
      "ウォッチリストのゲーム。深掘りがあるものだけ役割図鑑。ほかは身元だけ。",
    ],
    loading: ["正在读取 /v1/watchlist.json …", "Reading /v1/watchlist.json …", "/v1/watchlist.json を読んでいます…"],
    noscript: [
      "需要 JavaScript。本页只展示已发布的 /v1 JSON。",
      "JavaScript is required. This page only shows published /v1 JSON.",
      "JavaScript が必要。このページは公開済みの /v1 JSON だけを出す。",
    ],
  },
  {
    view: "game",
    path: "/game/",
    file: "game/index.html",
    crumbs: () => [tri("目录", "Catalog", "カタログ"), tri("游戏", "Game", "ゲーム")],
    title: ["游戏 · game-intel", "Game · game-intel", "ゲーム · game-intel"],
    description: [
      "一部游戏的身份卡。平台、标签和出处来自已发布 JSON，不编造评分或价格。",
      "One game's identity card. Platforms, tags, and sources come from published JSON. No invented scores or prices.",
      "一つのゲームの身元カード。プラットフォーム、タグ、出典は公開 JSON。点数や価格は作らない。",
    ],
    loading: ["正在读取 /v1/games/ …", "Reading /v1/games/ …", "/v1/games/ を読んでいます…"],
    noscript: [
      "需要 JavaScript。本页只展示已发布的 /v1 JSON。",
      "JavaScript is required. This page only shows published /v1 JSON.",
      "JavaScript が必要。このページは公開済みの /v1 JSON だけを出す。",
    ],
  },
  {
    view: "character",
    path: "/character/",
    file: "character/index.html",
    crumbs: () => [tri("观察名单", "Watchlist", "ウォッチリスト"), tri("角色", "Character", "キャラクター")],
    title: ["角色 · game-intel", "Character · game-intel", "キャラクター · game-intel"],
    description: [
      "角色卡。技能、结论和配队保持已发布原文。",
      "Character card. Skills, conclusions, and teams stay in the published language.",
      "キャラカード。スキル、結論、編成は公開された原文のまま。",
    ],
    loading: ["正在读取 /v1/guides/ …", "Reading /v1/guides/ …", "/v1/guides/ を読んでいます…"],
    noscript: [
      "需要 JavaScript。本页只展示已发布的 /v1 JSON。",
      "JavaScript is required. This page only shows published /v1 JSON.",
      "JavaScript が必要。このページは公開済みの /v1 JSON だけを出す。",
    ],
  },
  {
    view: "me",
    path: "/me/",
    file: "me/index.html",
    crumbs: () => [tri("我的关注", "Following", "フォロー")],
    title: ["我的关注 · game-intel", "Following · game-intel", "フォロー · game-intel"],
    description: [
      "按这台浏览器里的关注列表过滤已发布数据。名单不上传。",
      "Filters published data by the follow list in this browser. The list is not uploaded.",
      "このブラウザのフォローで公開データを絞る。リストは送らない。",
    ],
    loading: [
      "正在读取本机关注列表和已发布的 /v1 JSON …",
      "Reading this browser's follow list and published /v1 JSON …",
      "このブラウザのフォローと公開 /v1 JSON を読んでいます…",
    ],
    noscript: [
      "需要 JavaScript。关注名单只存在这台浏览器，页面只读取已发布的 /v1 JSON。",
      "JavaScript is required. The follow list stays in this browser. The page only reads published /v1 JSON.",
      "JavaScript が必要。フォローはこのブラウザだけ。ページは公開 /v1 JSON だけを読む。",
    ],
  },
  {
    view: "for-ai",
    path: "/for-ai/",
    file: "for-ai/index.html",
    crumbs: () => [tri("给 AI", "For AI", "AI 向け")],
    title: ["给 AI · game-intel", "For AI · game-intel", "AI 向け · game-intel"],
    description: [
      "人和 AI 读同一份已发布数据。MCP、OpenAPI、llms.txt。",
      "People and AI read the same published data. MCP, OpenAPI, and llms.txt.",
      "人と AI は同じ公開データを読む。MCP、OpenAPI、llms.txt。",
    ],
    loading: ["正在打开给 AI …", "Opening For AI …", "AI 向けを開いています…"],
    noscriptHtml: true,
    noscript: [
      '需要 JavaScript。开发者说明见 <a href="/developers/">/developers/</a>。OpenAPI <a href="/v1/openapi.json">/v1/openapi.json</a>。本页说明 MCP、<a href="/openapi.json">OpenAPI</a> 和 <a href="/llms.txt">llms.txt</a>。',
      'JavaScript is required. Developer notes: <a href="/en/developers/">/en/developers/</a>. OpenAPI <a href="/v1/openapi.json">/v1/openapi.json</a>. This page points at MCP, <a href="/openapi.json">OpenAPI</a>, and <a href="/llms.txt">llms.txt</a>.',
      'JavaScript が必要。開発者ノートは <a href="/ja/developers/">/ja/developers/</a>。OpenAPI は <a href="/v1/openapi.json">/v1/openapi.json</a>。このページは MCP、<a href="/openapi.json">OpenAPI</a>、<a href="/llms.txt">llms.txt</a>。',
    ],
  },
  {
    view: "claims",
    path: "/claims/",
    file: "claims/index.html",
    crumbs: () => [tri("核对墙", "Claims", "照合")],
    title: ["核对墙 · game-intel", "Claims · game-intel", "照合 · game-intel"],
    description: [
      "带 https 出处的投稿镜像。未经人工核对之前不可信。",
      "Mirror of submissions that include an https source. Untrusted until a person checks them.",
      "https 出典つき投稿のミラー。人が確認するまで信頼できない。",
    ],
    loading: ["正在读取 /v1/claims.json …", "Reading /v1/claims.json …", "/v1/claims.json を読んでいます…"],
    noscriptHtml: true,
    noscript: [
      '需要 JavaScript。POST /v1/claims 公开，不需要密钥。sources 必须是 https，缺则拒绝。每条都有 as_of。未经人工核对并导出之前，陈述不可信。',
      "JavaScript is required. POST /v1/claims is public and needs no key. sources must be https. Each row has as_of. Statements are untrusted until a person checks them and they are exported.",
      "JavaScript が必要。POST /v1/claims は公開で鍵は不要。sources は https。各行に as_of。人が確認して書き出すまで陳述は信頼できない。",
    ],
  },
];

function pick(row) {
  return tri(row[0], row[1], row[2]);
}

function shellCrumbs(shell) {
  const names = shell.crumbs();
  const home = { name: tri("首页", "Home", "ホーム"), path: localizePath("/") };
  if (!names.length) return [home];
  const last = names[names.length - 1];
  const crumbs = [home];
  if (names.length === 2) {
    crumbs.push({ name: names[0], path: localizePath(shell.path === "/game/" ? "/catalog/" : "/watchlist/") });
  }
  crumbs.push({ name: last, path: localizePath(shell.path) });
  return crumbs;
}

function shellDocument(shell) {
  const lang = getLang();
  const model = seoModel({
    lang,
    title: pick(shell.title),
    description: pick(shell.description),
    pathname: shell.path,
    crumbs: shellCrumbs(shell),
  });
  const locale = localeById(lang);
  const noscript = shell.noscriptHtml ? pick(shell.noscript) : `<p>${pick(shell.noscript)}</p>`;
  const claimsExtra = shell.view === "claims"
    ? `\n    <p><a href="/v1/claims.json">/v1/claims.json</a></p>`
    : "";
  return `<!DOCTYPE html>
<html lang="${locale.htmlLang}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  ${renderHeadTags(model)}
  <link rel="stylesheet" href="/ui/app.css"/>
</head>
<body data-view="${shell.view}" data-lang="${locale.id}">
  <div id="app">${languageSwitcher(shell.path, lang)}<p class="meta">${pick(shell.loading)}</p></div>
  <noscript>${noscript}${shell.view === "claims" && lang === "zh-CN" ? claimsExtra : ""}</noscript>
  <script type="module" src="/ui/app.js"></script>
</body>
</html>
`;
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

export function buildShells(publicDir = path.join(SITE, "public"), siteDir = SITE) {
  for (const locale of LOCALES) {
    withLang(locale.id, () => {
      for (const shell of SHELLS) {
        const html = shellDocument(shell);
        const rel = locale.prefix ? `${locale.prefix.slice(1)}/${shell.file}` : shell.file;
        writeText(path.join(publicDir, rel), html);
        if (!locale.prefix) {
          for (const copy of shell.copies || []) writeText(path.join(publicDir, copy), html);
          if (shell.rootCopy) writeText(path.join(siteDir, "index.html"), html);
        }
      }
    });
  }
  for (const locale of LOCALES) {
    withLang(locale.id, () => {
      const pathname = localizePath("/404.html");
      const title = tri("找不到页面 · game-intel", "Page not found · game-intel", "ページがない · game-intel");
      const description = tri(
        "这个地址没有页面。",
        "There is no page at this address.",
        "このアドレスにページはない。"
      );
      const body = `<h1>${tri("找不到页面", "Page not found", "ページがない")}</h1>
<p>${description}</p>
<p><a href="${localizePath("/")}">${tri("回到首页", "Back to home", "ホームへ")}</a></p>`;
      const html = staticDocument({
        lang: locale.id,
        title,
        description,
        pathname,
        crumbs: [
          { name: tri("首页", "Home", "ホーム"), path: localizePath("/") },
          { name: tri("找不到页面", "Page not found", "ページがない"), path: pathname },
        ],
        body,
      }).replace('content="index, follow"', 'content="noindex"');
      const file = locale.prefix ? path.join(publicDir, locale.prefix.slice(1), "404.html") : path.join(publicDir, "404.html");
      writeText(file, html);
    });
  }
  writeText(
    path.join(publicDir, "robots.txt"),
    `User-agent: *\nAllow: /\nAllow: /v1/\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`
  );
}

function shanghaiDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function htmlToUrl(rel) {
  const posix = rel.split(path.sep).join("/");
  if (posix === "index.html") return "/";
  if (posix.endsWith("/index.html")) return `/${posix.slice(0, -"index.html".length)}`;
  return `/${posix}`;
}

function walkHtml(dir, prefix, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "v1" || entry.name === "ui" || entry.name === "schema") continue;
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkHtml(abs, rel, out);
    else if (entry.name.endsWith(".html") && entry.name !== "404.html" && !rel.endsWith("/404.html")) out.push(htmlToUrl(rel));
  }
}

export function writeSitemap(publicDir = path.join(SITE, "public")) {
  const urls = [];
  walkHtml(publicDir, "", urls);
  const groups = new Map();
  for (const urlPath of urls) {
    const bare = stripLocale(urlPath).path;
    if (!groups.has(bare)) groups.set(bare, new Set());
    groups.get(bare).add(urlPath);
  }
  const lastmod = shanghaiDay();
  const buckets = { "zh-CN": [], en: [], ja: [] };
  const bares = [...groups.keys()].sort();
  for (const bare of bares) {
    const have = groups.get(bare);
    const alternates = [];
    for (const locale of LOCALES) {
      const localized = localizePath(bare, locale.id);
      if (have.has(localized)) alternates.push({ hreflang: locale.hreflang, href: absoluteUrl(localized) });
    }
    const zh = alternates.find((row) => row.hreflang === "zh-CN");
    if (zh) alternates.push({ hreflang: "x-default", href: zh.href });
    else if (alternates[0]) alternates.push({ hreflang: "x-default", href: alternates[0].href });
    for (const locale of LOCALES) {
      const localized = localizePath(bare, locale.id);
      if (!have.has(localized)) continue;
      buckets[locale.id].push({ loc: absoluteUrl(localized), lastmod, alternates });
    }
  }
  writeText(path.join(publicDir, "sitemap-zh.xml"), renderUrlSet(buckets["zh-CN"]));
  writeText(path.join(publicDir, "sitemap-en.xml"), renderUrlSet(buckets.en));
  writeText(path.join(publicDir, "sitemap-ja.xml"), renderUrlSet(buckets.ja));
  writeText(
    path.join(publicDir, "sitemap.xml"),
    renderSitemapIndex([
      `${SITE_ORIGIN}/sitemap-zh.xml`,
      `${SITE_ORIGIN}/sitemap-en.xml`,
      `${SITE_ORIGIN}/sitemap-ja.xml`,
    ])
  );
  return { zh: buckets["zh-CN"].length, en: buckets.en.length, ja: buckets.ja.length };
}

function dedupeTitle(html) {
  let seen = 0;
  return html.replace(/[ \t]*<title>[\s\S]*?<\/title>\n?/g, (match) => {
    seen += 1;
    return seen === 1 ? match : "";
  });
}

function injectHead(html, model) {
  if (html.includes('rel="canonical"')) return dedupeTitle(html);
  let tags = renderHeadTags(model);
  if (/<title>/.test(html)) tags = tags.replace(/<title>[\s\S]*?<\/title>\n?\s*/, "");
  return dedupeTitle(html.replace("</head>", `  ${tags}\n</head>`));
}

const SKETCHES = [
  {
    file: "index.html",
    path: "/sketches/",
    title: ["草图索引 · game-intel", "Wireframes · game-intel", "下絵 · game-intel"],
    description: [
      "首页、游戏页、角色卡的线框。不读取 /v1。",
      "Wireframes for home, game, and character. They do not read /v1.",
      "ホーム、ゲーム、キャラの下絵。/v1 は読まない。",
    ],
  },
  {
    file: "home.html",
    path: "/sketches/home.html",
    title: ["草图 · 首页", "Wireframe · Home", "下絵 · ホーム"],
    description: ["首页线框。", "Home wireframe.", "ホームの下絵。"],
  },
  {
    file: "game.html",
    path: "/sketches/game.html",
    title: ["草图 · 游戏页", "Wireframe · Game", "下絵 · ゲーム"],
    description: ["游戏页线框。", "Game wireframe.", "ゲームページの下絵。"],
  },
  {
    file: "character.html",
    path: "/sketches/character.html",
    title: ["草图 · 角色卡", "Wireframe · Character", "下絵 · キャラ"],
    description: ["角色卡线框。", "Character wireframe.", "キャラカードの下絵。"],
  },
];

function patchSketches(publicDir) {
  const dir = path.join(publicDir, "sketches");
  for (const sketch of SKETCHES) {
    const file = path.join(dir, sketch.file);
    if (!fs.existsSync(file)) continue;
    withLang("zh-CN", () => {
      const model = seoModel({
        lang: "zh-CN",
        title: sketch.title[0],
        description: sketch.description[0],
        pathname: sketch.path,
        crumbs: [
          { name: "首页", path: "/" },
          { name: "草图", path: "/sketches/" },
          ...(sketch.path === "/sketches/" ? [] : [{ name: sketch.title[0], path: sketch.path }]),
        ],
      });
      let html = fs.readFileSync(file, "utf8");
      html = injectHead(html, model);
      if (!html.includes('class="lang-switch"')) {
        html = html.replace("<body>", `<body>\n${languageSwitcher(sketch.path, "zh-CN")}`);
      }
      fs.writeFileSync(file, html, "utf8");
    });
    for (const locale of LOCALES) {
      if (locale.id === "zh-CN") continue;
      withLang(locale.id, () => {
        const pathname = localizePath(sketch.path, locale.id);
        const title = pick(sketch.title);
        const description = pick(sketch.description);
        const home = localizePath("/sketches/", locale.id);
        const links = ["index.html", "home.html", "game.html", "character.html"]
          .map((name) => {
            const href = localizePath(`/sketches/${name === "index.html" ? "" : name}`.replace(/\/$/, "/") , locale.id);
            const label = name === "index.html" ? tri("索引", "Index", "索引") : name.replace(".html", "");
            return `<a href="${name === "index.html" ? home : localizePath(`/sketches/${name}`, locale.id)}">${label}</a>`;
          })
          .join(" · ");
        const body = `<p><strong>${tri("草图", "Wireframe", "下絵")}</strong></p>
<nav>${links}</nav>
<h1>${title}</h1>
<p>${description}</p>
<p><a href="${localizePath("/for-ai/", locale.id)}">${tri("给 AI", "For AI", "AI 向け")}</a></p>`;
        const html = staticDocument({
          lang: locale.id,
          title,
          description,
          pathname,
          crumbs: [
            { name: tri("首页", "Home", "ホーム"), path: localizePath("/") },
            { name: tri("草图", "Wireframes", "下絵"), path: home },
          ],
          body,
        }).replace('href="/ui/app.css"', 'href="/sketches/sketch.css"');
        const out = path.join(publicDir, locale.prefix.slice(1), "sketches", sketch.file);
        writeText(out, html.replace("<link rel=\"stylesheet\" href=\"/ui/app.css\"/>", ""));
      });
    }
  }
}

function patchDevelopers(publicDir) {
  const file = path.join(publicDir, "developers", "index.html");
  if (!fs.existsSync(file)) return;
  const original = fs.readFileSync(file, "utf8");
  withLang("zh-CN", () => {
    const model = seoModel({
      lang: "zh-CN",
      title: "开发者 · game-intel",
      description: "公开只读 API 和远程 MCP。匿名可调用。事实以已发布 JSON 里的 https 出处为准。",
      pathname: "/developers/",
      crumbs: [
        { name: "首页", path: "/" },
        { name: "开发者", path: "/developers/" },
      ],
    });
    let html = injectHead(original, model);
    if (!html.includes('class="lang-switch"')) {
      html = html.replace("<main id=\"main\">", `${languageSwitcher("/developers/", "zh-CN")}\n<main id="main">`);
    }
    fs.writeFileSync(file, html, "utf8");
  });
  const mainMatch = original.match(/<main id="main">[\s\S]*<\/main>/);
  const main = mainMatch ? mainMatch[0] : "<main id=\"main\"><p>/developers/</p></main>";
  for (const locale of LOCALES) {
    if (locale.id === "zh-CN") continue;
    withLang(locale.id, () => {
      const pathname = localizePath("/developers/", locale.id);
      const title = tri("开发者 · game-intel", "Developers · game-intel", "開発者 · game-intel");
      const description = tri(
        "公开只读 API 和远程 MCP。",
        "Public read API and remote MCP. The contract below is the published bilingual note.",
        "公開の読み取り API とリモート MCP。下の契約文は公開済みの二言語ノートで、ゲームデータの再翻訳ではない。"
      );
      const note = tri(
        "",
        "<p>The sections below are the published bilingual contract. Paths, limits, and examples are unchanged.</p>",
        "<p>下の節は公開済みの二言語の契約文。パス、上限、例はそのまま。</p>"
      );
      const nav = [
        ["/", tri("首页", "Home", "ホーム")],
        ["/catalog/", tri("目录", "Catalog", "カタログ")],
        ["/watchlist/", tri("观察名单", "Watchlist", "ウォッチリスト")],
        ["/me/", tri("我的关注", "Following", "フォロー")],
        ["/claims/", tri("核对墙", "Claims", "照合")],
        ["/for-ai/", tri("给 AI", "For AI", "AI 向け")],
        ["/developers/", tri("开发者", "Developers", "開発者")],
      ]
        .map(([href, label]) => `<a href="${localizePath(href, locale.id)}"${href === "/developers/" ? ' aria-current="page"' : ""}>${label}</a>`)
        .join("\n");
      const body = `<header class="top"><a class="brand" href="${localizePath("/", locale.id)}">game-intel</a><nav aria-label="${tri("主导航", "Primary", "メインメニュー")}">${nav}</nav></header>
${note}
${main}`;
      let html = staticDocument({
        lang: locale.id,
        title,
        description,
        pathname,
        crumbs: [
          { name: tri("首页", "Home", "ホーム"), path: localizePath("/") },
          { name: tri("开发者", "Developers", "開発者"), path: pathname },
        ],
        body,
      });
      html = html.replace("<style>", `<link rel="stylesheet" href="/ui/app.css"/>\n  <style>`);
      writeText(path.join(publicDir, locale.prefix.slice(1), "developers", "index.html"), html);
    });
  }
}

export function buildLocalizedSite(publicDir = path.join(SITE, "public"), siteDir = SITE) {
  buildShells(publicDir, siteDir);
  patchSketches(publicDir);
  patchDevelopers(publicDir);
  return writeSitemap(publicDir);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const counts = buildLocalizedSite();
  console.log(JSON.stringify({ ok: true, sitemap: counts }));
}
