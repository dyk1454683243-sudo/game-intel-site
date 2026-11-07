/**
 * personal_digest, planner, and compare against the published JSON in ai-site/public.
 * No network and no follow storage.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleCompare, parseCompareIds } from "../ai-site/public/ui/compare.js";
import { assemblePersonal, parseFollows, shanghaiToday } from "../ai-site/public/ui/personal.js";
import { assemblePlanner, parseResourceQuery } from "../ai-site/public/ui/planner.js";
import { assembleStatus } from "../ai-site/src/status.js";

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../ai-site/public");

export function readPublicFile(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/v1/")) return null;
  if (pathname.includes("..") || pathname.includes("\\") || pathname.includes("\0")) return null;
  const rel = pathname.slice(1);
  if (!/^v1\/[a-z0-9][a-z0-9_./-]{0,180}\.json$/.test(rel)) return null;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export async function personalFromPublic(input, today = shanghaiToday()) {
  const parsed = parseFollows(input || {});
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return assemblePersonal(parsed.follows, async (pathname) => readPublicFile(pathname), today);
}

export async function plannerFromPublic(input = {}, today = shanghaiToday()) {
  const resources = parseResourceQuery(input.resources || "");
  if (!resources.ok) return { ok: false, error: resources.error, message: resources.message };
  return assemblePlanner(async (pathname) => readPublicFile(pathname), {
    today,
    game: input.game || "",
    resources: resources.resources,
  });
}

export async function compareFromPublic(input = {}) {
  const parsed = parseCompareIds(input.ids || "");
  if (!parsed.ok) return { ok: false, error: parsed.error, message: parsed.message };
  return assembleCompare(
    async (pathname) => readPublicFile(pathname),
    parsed.ids.map((row) => `${row.game}:${row.id}`)
  );
}

export async function statusFromPublic(input = {}, today = shanghaiToday()) {
  return assembleStatus(async (pathname) => readPublicFile(pathname), {
    today,
    game: input.game || "",
  });
}
