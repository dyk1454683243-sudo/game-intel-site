import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(site, "..");

test("publish.sh installs mcp-server deps before export-intel", () => {
  const sh = fs.readFileSync(path.join(site, "scripts/publish.sh"), "utf8");
  const installAt = sh.search(/\bnpm ci\b/);
  const intelAt = sh.indexOf("scripts/export-intel.mjs");
  assert.notEqual(installAt, -1);
  assert.notEqual(intelAt, -1);
  assert.ok(installAt < intelAt, "npm ci must run before export-intel");
  assert.match(sh, /mcp-server/);
});

test("export-intel installs @modelcontextprotocol/sdk when it does not resolve", () => {
  const src = fs.readFileSync(path.join(site, "scripts/export-intel.mjs"), "utf8");
  assert.match(src, /@modelcontextprotocol\/sdk/);
  assert.match(src, /npm/);
  const ensureAt = src.indexOf("ensureMcpDeps()");
  const jobAt = src.indexOf("for (const job of jobs)");
  assert.ok(ensureAt !== -1 && jobAt !== -1 && ensureAt < jobAt);
});

test("mcp-server lockfile pins @modelcontextprotocol/sdk", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "mcp-server/package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "mcp-server/package-lock.json"), "utf8"));
  const declared = pkg.dependencies["@modelcontextprotocol/sdk"];
  assert.ok(declared);
  assert.equal(lock.packages[""].dependencies["@modelcontextprotocol/sdk"], declared);
  assert.ok(lock.packages["node_modules/@modelcontextprotocol/sdk"].version);
});
