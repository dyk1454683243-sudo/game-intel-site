/** Load published JSON and run the stateless personal filter. Stores nothing. */
import { assemblePersonal, parseFollows, shanghaiToday } from "../public/ui/personal.js";
import { readPublic } from "./public-json.js";

export async function readPublished(env, origin, pathname) {
  const got = await readPublic(env, origin, pathname);
  if (!got.ok) return null;
  return got.data;
}

export async function personalDocument(env, origin, input, today = shanghaiToday()) {
  const parsed = parseFollows(input || {});
  if (!parsed.ok) return parsed;
  return assemblePersonal(parsed.follows, (pathname) => readPublished(env, origin, pathname), today);
}
