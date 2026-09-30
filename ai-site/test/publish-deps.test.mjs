import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { nodeSatisfiesPublish } from "../scripts/require-node22.mjs";

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

test("engines require Node >=22 for the site and the mcp server publish installs", () => {
  const sitePkg = JSON.parse(fs.readFileSync(path.join(site, "package.json"), "utf8"));
  const mcpPkg = JSON.parse(fs.readFileSync(path.join(root, "mcp-server/package.json"), "utf8"));
  assert.equal(sitePkg.engines.node, ">=22");
  assert.equal(mcpPkg.engines.node, ">=22");
});

test("nodeSatisfiesPublish accepts 22 and newer and rejects older majors", () => {
  assert.equal(nodeSatisfiesPublish("22.0.0"), true);
  assert.equal(nodeSatisfiesPublish("v22.14.0"), true);
  assert.equal(nodeSatisfiesPublish("23.1.0"), true);
  assert.equal(nodeSatisfiesPublish("20.18.1"), false);
  assert.equal(nodeSatisfiesPublish("v18.20.0"), false);
  assert.equal(nodeSatisfiesPublish("21.7.3"), false);
  assert.equal(nodeSatisfiesPublish(""), false);
  assert.equal(nodeSatisfiesPublish("not-node"), false);
});

test("export entrypoints import the Node 22 guard before other modules", () => {
  for (const name of ["export-guides.mjs", "export-intel.mjs", "export-games.mjs"]) {
    const src = fs.readFileSync(path.join(site, "scripts", name), "utf8");
    const guardAt = src.indexOf('import "./require-node22.mjs"');
    const firstImport = src.search(/^import /m);
    assert.equal(guardAt, firstImport, name);
  }
});

test("publish.sh --check-node passes on this Node and refuses a Node 20 stub", () => {
  const script = path.join(site, "scripts/publish.sh");
  const ok = spawnSync("bash", [script, "--check-node"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /\[publish\] node v/);
  assert.doesNotMatch(`${ok.stdout}\n${ok.stderr}`, /export-guides|wrangler|npm ci/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "node20-stub-"));
  const stub = path.join(dir, "node");
  fs.writeFileSync(
    stub,
    "#!/bin/sh\nif [ \"$1\" = \"-v\" ] || [ \"$1\" = \"--version\" ]; then echo v20.18.1; exit 0; fi\necho \"unexpected node args: $*\" >&2\nexit 99\n"
  );
  fs.chmodSync(stub, 0o755);
  const bad = spawnSync("bash", [script], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Use Node >=22/);
  assert.match(bad.stderr, /v20\.18\.1/);
  assert.doesNotMatch(`${bad.stdout}\n${bad.stderr}`, /export-guides|wrangler|npm ci/);
});

test("mcp-server lockfile pins @modelcontextprotocol/sdk", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "mcp-server/package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "mcp-server/package-lock.json"), "utf8"));
  const declared = pkg.dependencies["@modelcontextprotocol/sdk"];
  assert.ok(declared);
  assert.equal(lock.packages[""].dependencies["@modelcontextprotocol/sdk"], declared);
  assert.ok(lock.packages["node_modules/@modelcontextprotocol/sdk"].version);
});
