#!/usr/bin/env node
/**
 * Best-effort: shell mcp-server/cli.js → public/v1/{digest,calendar-hw,radar}.json
 * Failures log to stderr but do not fail the process (exit 0) so publish can continue.
 */
import "./require-node22.mjs";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(__dirname, "..");
const ROOT = path.resolve(SITE, "..");
const CLI = path.join(ROOT, "mcp-server", "cli.js");
const OUT = path.join(SITE, "public", "v1");
const TIMEOUT_MS = Number(process.env.EXPORT_INTEL_TIMEOUT_MS || 180000);

function shanghaiIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}+08:00`;
}

function mkdirp(p) {
  fs.mkdirSync(p, { recursive: true });
}

function mcpSdkResolves() {
  try {
    const require = createRequire(path.join(ROOT, "mcp-server", "package.json"));
    require.resolve("@modelcontextprotocol/sdk/package.json");
    return true;
  } catch {
    return false;
  }
}

function ensureMcpDeps() {
  if (mcpSdkResolves()) return;
  const mcpDir = path.join(ROOT, "mcp-server");
  const hasLock = fs.existsSync(path.join(mcpDir, "package-lock.json"));
  const npmCmd = hasLock ? "ci" : "install";
  console.log(
    `[export-intel] npm ${npmCmd} in mcp-server (missing @modelcontextprotocol/sdk)`
  );
  const r = spawnSync("npm", [npmCmd], {
    cwd: mcpDir,
    encoding: "utf8",
    stdio: "inherit",
    timeout: Number(process.env.EXPORT_INTEL_NPM_TIMEOUT_MS || 300000),
  });
  if (r.error || r.status !== 0) {
    const why = r.error ? String(r.error.message || r.error) : `exit ${r.status}`;
    console.error(`[export-intel] mcp-server dependency install failed: ${why}`);
  }
}

function runCli(args) {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    timeout: TIMEOUT_MS,
    env: process.env,
  });
  if (r.error) {
    return { ok: false, error: String(r.error.message || r.error), args };
  }
  if (r.status !== 0) {
    return {
      ok: false,
      error: (r.stderr || "").trim() || `exit ${r.status}`,
      args,
      stderr: r.stderr,
    };
  }
  try {
    return { ok: true, data: JSON.parse(r.stdout) };
  } catch (e) {
    return {
      ok: false,
      error: `json_parse: ${e.message}`,
      args,
      stdout_head: (r.stdout || "").slice(0, 200),
    };
  }
}

function writeOut(name, payload, source) {
  mkdirp(OUT);
  const body =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? {
          meta: {
            generated_at: shanghaiIso(),
            timezone: "Asia/Shanghai",
            source,
          },
          ...payload,
        }
      : {
          meta: {
            generated_at: shanghaiIso(),
            timezone: "Asia/Shanghai",
            source,
          },
          data: payload,
        };
  const dest = path.join(OUT, name);
  fs.writeFileSync(dest, JSON.stringify(body, null, 2) + "\n", "utf8");
  console.log(`[export-intel] wrote ${dest}`);
}

const jobs = [
  {
    file: "digest.json",
    args: ["digest", "--summarize"],
    source: "game-intel cli digest --summarize",
  },
  {
    file: "calendar-hw.json",
    args: ["calendar", "--game", "hw", "--limit", "20"],
    source: "game-intel cli calendar --game hw",
  },
  {
    file: "radar.json",
    args: ["radar"],
    source: "game-intel cli radar",
  },
];

let okCount = 0;
let failCount = 0;

if (!fs.existsSync(CLI)) {
  console.error(`[export-intel] missing CLI: ${CLI}`);
  process.exit(0);
}

ensureMcpDeps();

for (const job of jobs) {
  console.log(`[export-intel] running: node cli.js ${job.args.join(" ")}`);
  const r = runCli(job.args);
  if (!r.ok) {
    failCount++;
    console.error(`[export-intel] FAIL ${job.file}: ${r.error}`);
    continue;
  }
  try {
    writeOut(job.file, r.data, job.source);
    okCount++;
  } catch (e) {
    failCount++;
    console.error(`[export-intel] write FAIL ${job.file}: ${e.message}`);
  }
}

console.log(`[export-intel] done ok=${okCount} fail=${failCount}`);
process.exit(0);
