#!/usr/bin/env node
/**
 * Download Prydwen Limbus identity HTML via the Jina reader.
 * Prydwen itself answers this environment with a Cloudflare challenge.
 * Writes /tmp/limbus/html/{slug}.html. Skips files that already look complete.
 *
 * Usage: node mcp-server/scripts/fetch-limbus-pages.mjs
 */
import fs from "node:fs";
import path from "node:path";

const CATALOG = process.env.LIMBUS_CATALOG || "/tmp/limbus/catalog.json";
const OUT = process.env.LIMBUS_HTML || "/tmp/limbus/html";
const GAP_MS = Number(process.env.LIMBUS_FETCH_GAP_MS || 4000);

const EXTRA = ["https://www.prydwen.gg/limbus-company/team-database/"];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unblockAt(body) {
  const m = String(body).match(/until ([A-Za-z0-9: +]+GMT)/);
  if (!m) return Date.now() + 60_000;
  const t = Date.parse(m[1]);
  return Number.isNaN(t) ? Date.now() + 60_000 : t + 3000;
}

async function fetchHtml(url) {
  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers: {
      Accept: "text/html, text/plain",
      "User-Agent": "Mozilla/5.0 (compatible; game-intel-limbus/1.0)",
      "X-Return-Format": "html",
    },
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  if (res.status === 403 || res.status === 429) {
    const err = new Error(`blocked_${res.status}`);
    err.unblock = unblockAt(text);
    err.body = text.slice(0, 240);
    throw err;
  }
  if (!res.ok) throw new Error(`http_${res.status}`);
  if (!text.includes("<html") && !text.includes("skill-name") && !text.includes("team-database")) {
    const err = new Error("not_html");
    err.body = text.slice(0, 240);
    throw err;
  }
  return text;
}

function targets() {
  const rows = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
  const pages = rows.map((row) => ({
    file: path.join(OUT, `${row.slug}.html`),
    url: `https://www.prydwen.gg/limbus-company/identities/${row.slug}`,
  }));
  pages.push({
    file: path.join(OUT, "_team-database.html"),
    url: EXTRA[0],
  });
  return pages;
}

function done(file) {
  if (!fs.existsSync(file)) return false;
  const stat = fs.statSync(file);
  if (stat.size < 20_000) return false;
  const head = fs.readFileSync(file, "utf8").slice(0, 400);
  return !head.includes("AbuseAlleviationError") && !head.includes("cf-challenge");
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const pages = targets().filter((page) => !done(page.file));
  console.log(JSON.stringify({ todo: pages.length, out: OUT }));
  let i = 0;
  for (const page of pages) {
    i += 1;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const html = await fetchHtml(page.url);
        fs.writeFileSync(page.file, html);
        console.log(`${i}/${pages.length} ok ${path.basename(page.file)} ${html.length}`);
        break;
      } catch (error) {
        const wait = error.unblock ? Math.max(0, error.unblock - Date.now()) : 8000 * attempt;
        console.error(
          `${i}/${pages.length} fail ${path.basename(page.file)} attempt ${attempt} ${error.message} wait ${wait}`
        );
        if (attempt === 4) {
          fs.writeFileSync(
            `${page.file}.error`,
            `${error.message}\n${error.body || ""}\n`
          );
          break;
        }
        await sleep(wait);
      }
    }
    await sleep(GAP_MS);
  }
  const left = targets().filter((page) => !done(page.file)).length;
  console.log(JSON.stringify({ ok: left === 0, remaining: left }));
  if (left) process.exit(1);
}

main();
