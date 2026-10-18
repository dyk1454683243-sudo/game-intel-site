import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { handleRequest, route } from "../src/worker.js";
import { displayCharacterName, displayGameName, setLang, withLang } from "../public/ui/i18n.js";
import { renderCharacter, renderFrame } from "../public/ui/render.js";

const site = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(site, "public");
const origin = "https://game-intel-ai.dyk1454683243.workers.dev";

function read(rel) {
  return fs.readFileSync(path.join(publicDir, rel), "utf8");
}

function alternates(html) {
  const out = {};
  for (const match of html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)) {
    out[match[1]] = match[2];
  }
  return out;
}

function canonical(html) {
  const match = html.match(/<link rel="canonical" href="([^"]+)"/);
  return match ? match[1] : "";
}

function assets() {
  return {
    async fetch(req) {
      const rel = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, "");
      const file = path.normalize(path.join(publicDir, rel));
      if (!file.startsWith(publicDir)) return new Response("no", { status: 403 });
      try {
        return new Response(fs.readFileSync(file), { status: 200 });
      } catch {
        return new Response("missing", { status: 404 });
      }
    },
  };
}

test("sitemap index lists each language and hreflang alternates stay aligned", () => {
  const index = read("sitemap.xml");
  assert.match(index, /<sitemapindex/);
  for (const name of ["sitemap-zh.xml", "sitemap-en.xml", "sitemap-ja.xml"]) {
    assert.match(index, new RegExp(`${origin}/${name}`));
  }
  const docs = {
    "zh-CN": read("sitemap-zh.xml"),
    en: read("sitemap-en.xml"),
    ja: read("sitemap-ja.xml"),
  };
  const required = {
    "zh-CN": [`${origin}/`, `${origin}/catalog/`, `${origin}/games/balatro.html`, `${origin}/guides/hw/lysandria.html`],
    en: [`${origin}/en/`, `${origin}/en/catalog/`, `${origin}/en/games/balatro.html`, `${origin}/en/guides/hw/lysandria.html`],
    ja: [`${origin}/ja/`, `${origin}/ja/catalog/`, `${origin}/ja/games/balatro.html`, `${origin}/ja/guides/hw/lysandria.html`],
  };
  for (const [lang, xml] of Object.entries(docs)) {
    assert.match(xml, /<urlset/);
    assert.doesNotMatch(xml, /\/v1\//);
    assert.doesNotMatch(xml, /\/mcp/);
    for (const loc of required[lang]) {
      assert.match(xml, new RegExp(`<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>`));
    }
    const sample = xml.slice(xml.indexOf("<url>"), xml.indexOf("</url>") + 6);
    for (const code of ["zh-CN", "en", "ja", "x-default"]) {
      assert.match(sample, new RegExp(`hreflang="${code}"`));
    }
    assert.match(sample, new RegExp(`hreflang="x-default" href="${origin}/"`));
  }
});

test("homepage head includes the Google Search Console verification tag", () => {
  const tag =
    '<meta name="google-site-verification" content="dDvLWlS-NRhgYTEgf7Tf8SKePsFCJQhkH9xq3b-ZkZk" />';
  for (const rel of ["index.html", "en/index.html", "ja/index.html"]) {
    const html = read(rel);
    const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
    assert.ok(head.includes(tag), rel);
  }
});

test("hreflang alternates are mutual and each page has a canonical", () => {
  const groups = [
    ["catalog/index.html", "en/catalog/index.html", "ja/catalog/index.html"],
    ["games/balatro.html", "en/games/balatro.html", "ja/games/balatro.html"],
    ["guides/hw/lysandria.html", "en/guides/hw/lysandria.html", "ja/guides/hw/lysandria.html"],
    ["index.html", "en/index.html", "ja/index.html"],
  ];
  for (const group of groups) {
    const pages = group.map((rel) => ({ rel, html: read(rel), alt: null, canon: "" }));
    for (const page of pages) {
      page.alt = alternates(page.html);
      page.canon = canonical(page.html);
      assert.ok(page.canon, page.rel);
      for (const code of ["zh-CN", "en", "ja", "x-default"]) assert.ok(page.alt[code], `${page.rel} ${code}`);
      assert.equal(page.alt["x-default"], page.alt["zh-CN"]);
    }
    const signature = JSON.stringify(pages[0].alt);
    for (const page of pages) {
      assert.equal(JSON.stringify(page.alt), signature, page.rel);
    }
    assert.equal(pages[0].canon, pages[0].alt["zh-CN"]);
    assert.equal(pages[1].canon, pages[1].alt.en);
    assert.equal(pages[2].canon, pages[2].alt.ja);
    assert.match(pages[0].html, /<title>[^<]+<\/title>/);
    assert.match(pages[0].html, /<meta name="description" content="[^"]+"/);
    assert.match(pages[1].html, /property="og:title"/);
    assert.match(pages[2].html, /name="twitter:card"/);
    assert.notEqual(canonical(pages[0].html), canonical(pages[1].html));
  }
});

test("language prefix does not move /v1 or /mcp, and missing pages are HTTP 404", async () => {
  const env = { ASSETS: assets(), CLAIMS: { async get() { return null; } } };
  const mcp = await route(new Request(`${origin}/mcp`), env);
  assert.equal(mcp.status, 405);
  assert.equal(await route(new Request(`${origin}/en/mcp`), env), null);
  assert.equal(await route(new Request(`${origin}/ja/mcp`), env), null);
  assert.equal(await route(new Request(`${origin}/en/v1/games/hw.json`), env), null);
  assert.equal(await route(new Request(`${origin}/ja/v1/claims`), env), null);
  assert.equal(await route(new Request(`${origin}/en/.well-known/mcp.json`), env), null);
  const discovery = await route(new Request(`${origin}/.well-known/mcp.json`), env);
  assert.equal(discovery.status, 200);

  const missingApi = await handleRequest(new Request(`${origin}/v1/no-such-document.json`), env);
  assert.equal(missingApi.status, 404);
  assert.equal((await missingApi.json()).error, "not_found");

  const prefixed = await handleRequest(new Request(`${origin}/en/v1/games/hw.json`), env);
  assert.equal(prefixed.status, 404);
  assert.equal(await prefixed.text(), "missing");
  assert.equal(prefixed.headers.get("x-api-version"), null);

  const lost = await handleRequest(new Request(`${origin}/no-such-human-page`), env);
  assert.equal(lost.status, 404);
  assert.match(lost.headers.get("content-type"), /text\/html/);
  const lostHtml = await lost.text();
  assert.match(lostHtml, /找不到页面|404/);
  assert.doesNotMatch(lostHtml, /"error":"not_found"/);

  const lostEn = await handleRequest(new Request(`${origin}/en/no-such-human-page`), env);
  assert.equal(lostEn.status, 404);
  assert.match(await lostEn.text(), /lang="en"/);
});

test("english names come only from card fields and published skill text stays put", () => {
  assert.equal(displayCharacterName({ name: "莉珊德莉娅", name_en: "Lysandria" }, "en"), "Lysandria");
  assert.equal(displayCharacterName({ name: "莉珊德莉娅", name_zh: "莉珊德莉娅", name_en: null }, "en"), "莉珊德莉娅");
  assert.equal(displayCharacterName({ name: "Zwei", name_zh: "茨瓦伊" }, "en"), "Zwei");
  assert.equal(displayCharacterName({ name_zh: "茨瓦伊" }, "en"), "茨瓦伊");
  assert.equal(displayCharacterName({ name: "茨瓦伊", name_zh: "茨瓦伊", name_en: "Zwei" }, "zh-CN"), "茨瓦伊");
  assert.equal(displayCharacterName({ name: "茨瓦伊", name_ja: "" }, "ja"), "茨瓦伊");
  assert.equal(displayGameName({ name: "Balatro", name_zh: "小丑牌" }, "en"), "Balatro");
  assert.equal(displayGameName({ name_zh: "小丑牌" }, "en"), "小丑牌");

  const card = JSON.parse(read("v1/guides/hw/characters/lysandria.json"));
  const english = withLang("en", () => renderCharacter("hw", card));
  assert.match(english, /Lysandria/);
  assert.match(english, /旋转斩/);
  assert.match(english, /<h2>Conclusion<\/h2>/);
  assert.match(withLang("en", () => renderFrame("character", english, { path: "/character/?game=hw&id=lysandria" })), /class="lang-switch"/);
  assert.match(withLang("en", () => renderFrame("character", english, { path: "/character/?game=hw&id=lysandria" })), /href="\/en\/character\/\?game=hw&amp;id=lysandria"/);
  setLang("zh-CN");
});

test("robots.txt points at the sitemap and does not block /v1", () => {
  const robots = read("robots.txt");
  assert.match(robots, new RegExp(`Sitemap: ${origin}/sitemap.xml`));
  assert.match(robots, /Allow: \/v1\//);
  assert.doesNotMatch(robots, /Disallow:\s*\/v1/);
});
