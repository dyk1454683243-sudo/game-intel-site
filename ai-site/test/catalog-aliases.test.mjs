import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolvePublicPath } from "../src/public-json.js";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "../public");

test("catalog alias path is allowlisted", () => {
  assert.equal(resolvePublicPath("/v1/catalog-aliases.json"), "/v1/catalog-aliases.json");
  assert.equal(resolvePublicPath("/v1/not-a-route.json"), null);
});

test("published catalog aliases resolve official nicknames", () => {
  const file = path.join(publicDir, "v1/catalog-aliases.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(data.timezone, "Asia/Shanghai");
  assert.equal(data.aliases["绝区零"].id, "zenless-zone-zero");
  assert.equal(data.aliases["巫师3"].id, "the-witcher-3");
  assert.equal(data.aliases["绝地潜兵2"].id, "helldivers-2");
  assert.equal(data.aliases["荒野大镖客2"].id, "red-dead-redemption-2");
  assert.equal(data.aliases["젠레스 존 제로"].id, "zenless-zone-zero");
  const ids = new Set(Object.values(data.aliases).map((row) => row.id));
  for (const id of [
    "zenless-zone-zero",
    "wuthering-waves",
    "warframe",
    "stellar-blade",
    "cult-of-the-lamb",
    "arknights-endfield",
  ]) {
    assert.ok(ids.has(id), id);
  }
  assert.equal(data.count, Object.keys(data.aliases).length);
});
