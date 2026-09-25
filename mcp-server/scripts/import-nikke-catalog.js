#!/usr/bin/env node
/**
 * Import NIKKE character stubs from GameKee entry list (pid=64599) + Prydwen list.
 * Never overwrites rich (non-stub) cards. Offline fallback: nikke-catalog-seed.json
 *
 * Usage: node mcp-server/scripts/import-nikke-catalog.js [--offline]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pinyin } from "pinyin-pro";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const DATA = process.env.GAME_INTEL_DATA || path.join(ROOT, "data");
const OUT_DIR = path.join(DATA, "guides", "nikke", "characters");
const ALIAS_PATH = path.join(DATA, "guides", "nikke", "aliases.json");
const SEED_PATH = path.join(__dirname, "nikke-catalog-seed.json");
const GK = "https://www.gamekee.com";
const PRYDWEN = "https://www.prydwen.gg";
const CHAR_FOLDER_PID = 64599;
const AS_OF = "2026-09";
const UA = "game-intel-catalog/0.3.19";

/** GameKee CN display name → Prydwen slug (canonical id). Only sure mappings. */
const CN_TO_ID = {
  "吉尔提：神力兔女郎": "guilty", // Mighty Bunny not yet on Prydwen list — keep guilty base; override below if needed
  "德雷克：终极反派": "drake-great-villain",
  雪子: "yukiko",
  "QUEEN(真）": "queen-makoto",
  "麦斯威尔：平凡技师": "maxwell-ordinary-mechanic",
  "拉普拉斯：究极英雄": "laplace-ultimate-hero",
  "玛律恰那：海洋进修": "marciana-marine-study",
  "灰姑娘：琉璃波光": "cinderella-crystal-wave",
  方舟黑色游侠: "ark-ranger-black",
  普莉卡: "prika",
  敏特: "mint",
  "尼恩：透视之眼": "neon-vision-eye",
  阿维斯塔: "avistar",
  "阿妮斯：超级巨星": "anis-star",
  白鹤: "snow-crane",
  "阿尔卡娜：命运伴侣": "arcana-fortune-mate",
  "E.H.": "e-h",
  泷奈: "takina-inoue",
  千束: "chisato-nishikigi",
  薇尔维特: "velvet",
  蕾贝儿: "label",
  "白雪公主：重型武装": "snow-white-heavy-arms",
  "布丽德：静默轨道": "brid-silent-track",
  "迪塞尔：冬日甜心": "diesel-winter-sweets",
  "索林：霜之旅票": "soline-frost-ticket",
  莉贝雷利奥: "liberalio",
  钟鸣: "chime",
  娜由塔: "nayuta",
  "德尔塔：怪盗忍者": "delta-ninja-thief",
  吉儿: "jill-valentine",
  艾达: "ada-wong",
  "米尔克：花漾兔女郎": "milk-blooming-bunny",
  "爱德：特务兔女郎": "ade-agent-bunny",
  "贝斯蒂：战术升级": "vesti-tactical-upgrade",
  "银华：战术升级": "eunhwa-tactical-upgrade",
  "艾玛：战术升级": "emma-tactical-upgrade",
  "伊莱格：BOOM与惊吓": "elegg-boom-and-shock",
  "桃乐丝：机缘巧遇": "dorothy-serendipity",
  索拉: "sora",
  渡鸦: "crow",
  伊芙: "eve",
  K: "k",
  阿尔卡娜: "arcana",
  "米哈拉：羁绊锁链": "mihara-bonding-chain",
  莫莉: "molly", // may not exist on Prydwen — pinyin fallback later if needed
  小美人鱼: "siren",
  克劳斯特: "crust",
  布蕾德: "bready",
  特蕾娜: "trina",
  "零（暂称）": "rei-ayanami-tentative-name",
  "明日香：WILLE": "asuka-shikinami-langley-wille",
  "安克：天真的女仆": "anchor-innocent-maid",
  "马斯特：浪漫的女仆": "mast-romantic-maid",
  玛娜: "mana",
  "拉毗：小红帽": "rapi-red-hood",
  "吉萝婷：寒冬杀手": "guillotine-winter-slayer",
  "梅登：冰玫瑰": "maiden-ice-rose",
  芙罗拉: "flora",
  格拉维: "grave",
  灰姑娘: "cinderella",
  "长发公主：纯洁恩典": "rapunzel-pure-grace",
  鲁玛妮: "rumani",
  潘托姆: "phantom",
  "坎西：逃生女王": "quency-escape-queen",
  露姬: "rouge",
  真理: "truth", // check — may be Quiry? Actually 真理 might be different
  零: "rei-ayanami",
  明日香: "asuka-shikinami-langley",
  茨瓦伊: "zwei",
  爱因: "ein",
  "罗珊娜：高雅海洋": "rosanna-chic-ocean",
  "樱花：夏日绽放": "sakura-bloom-in-summer",
  克雷伊: "clay",
  "爱丽丝：仙境兔女郎": "alice-wonderland-bunny",
  "索达：闪亮兔女郎": "soda-twinkling-bunny",
  特罗尼: "trony",
  吉洛: "kilo",
  皇冠: "crown",
  贝伊: "bay",
  雷姆: "rem",
  爱蜜莉雅: "emilia",
  "D:杀手妻子": "d-killer-wife",
  伊莱格: "elegg",
  爱德: "ade",
  "普丽瓦蒂：不友善的女仆": "privaty-unkind-maid",
  牡丹: "moran",
  莱昂纳: "leona",
  "红莲：暗影": "scarlet-black-shadow",
  "米卡：雪地伙伴": "mica-snow-buddy",
  "鲁德米拉：冬日之主": "ludmilla-winter-owner",
  托比: "tove",
  "白雪公主：纯真年代": "innocent-dayss-snow-white",
  小红帽: "red-hood",
  基里: "quiry",
  蒂亚: "tia",
  娜嘉: "naga",
  玛律恰那: "marciana",
  A2: "a2",
  "2B": "2b",
  "海伦：海蓝宝石": "aqua-marine-helm",
  "阿妮斯：闪耀夏日": "sparkling-summer-anis",
  马斯特: "mast",
  尼罗: "nero",
  "尼恩：蓝色海洋": "blue-ocean-neon",
  "梅里：海湾女神": "bay-goddess-mary",
  罗珊娜: "rosanna",
  诺亚尔: "noir",
  布兰儿: "blanc",
  莱伊: "liter",
  桃乐丝: "dorothy",
  D: "d",
  尼希利斯塔: "nihilister",
  樱花: "sakura",
  饼干: "biscuit",
  帕瓦: "power",
  玛奇玛: "makima",
  索达: "soda",
  可可: "cocoa",
  坎西: "quency",
  森: "sin",
  吉尔提: "guilty",
  毒蛇: "viper",
  豺狼: "jackal",
  神罚: "guillotine", // wait — 神罚 is Guillotine? Actually 神罚 might be different... Guillotine CN is 吉萝婷. 神罚 = ?
  安妮奇迹仙女: "miracle-fairy-anne",
  "安妮：奇迹仙女": "miracle-fairy-anne",
  "露菲：冬日购物狂": "winter-shopper-rupee",
  拉普拉斯: "laplace",
  海伦: "helm",
  朵拉: "dolla",
  长发公主: "rapunzel",
  红莲: "scarlet",
  梅登: "maiden",
  诺伊斯: "noise",
  哈兰: "harran",
  杨: "yan",
  尤妮: "yuni",
  爱丽丝: "alice",
  普丽瓦蒂: "privaty",
  吉萝婷: "guillotine",
  迪塞尔: "diesel",
  沃纶姆: "volume",
  诺雅: "noah",
  舒格: "sugar",
  尤莉亚: "julia",
  西格娜: "signal",
  德雷克: "drake",
  麦斯威尔: "maxwell",
  艾菲涅尔: "epinel",
  银华: "eunhwa",
  布丽德: "brid",
  白雪公主: "snow-white",
  阿莉亚: "aria",
  克拉乌: "crow", // 克拉乌 might be Crow? Actually Crow is 渡鸦. 克拉乌 = Claude? skip
  桑迪: "centi",
  鲁德米拉: "ludmilla",
  波莉: "poli",
  艾玛: "emma",
  普琳玛: "frima",
  梅里: "mary",
  艾德米: "admi",
  米兰达: "miranda",
  索林: "soline",
  艾可希雅: "exia",
  尤尔夏: "yulha",
  诺薇儿: "novel",
  丽塔: "liter", // NO — Liter is 莱伊. Rita is Rita - not on list? Actually there's no Rita on Prydwen... wait 丽塔 might be Rita. Checking - not in list. Use pinyin.
  佩珀: "pepper",
  富克旺: "folkwang",
  米尔克: "milk",
  贝斯蒂: "vesti",
  露菲: "rupee",
  伊莎贝尔: "isabel",
  埃葵斯: "ether",
  胡桃: "kurumi",
  克莱尔: "claire-redfield",
  百合: "lily",
  樱: "sakura-suzuhara",
  美里: "mari-makinami-illustrious",
  拉姆: "ram",
  帕斯卡: "pascal",
  安克: "anchor",
  姬野: "himeno",
  尼夫: "neve",
  拉毗: "rapi",
  贝洛塔: "belorta",
  N102: "n102",
  米卡: "mica",
  阿妮斯: "anis",
  艾瑟儿: "ether", // Ether CN often 埃葵斯; 艾瑟儿 might be Ether too — duplicate risk
  米哈拉: "mihara",
  德尔塔: "delta",
  尼恩: "neon",
  舒恩: "schoen", // may not exist
  谢芙蒂: "shift", // Shift Up? Actually 谢芙蒂 = ?
  机甲谢芙蒂: "shift-up",
  产品12: "product-12",
  "士兵E.G": "soldier-eg",
  "士兵F.A": "soldier-fa",
  IDoll花: "idoll-flower",
  产品08: "product-08",
  iDoll海: "idoll-ocean",
  "士兵O.W": "soldier-ow",
  iDoll太阳: "idoll-sun",
  产品23: "product-23",
};

// Fix uncertain / wrong mappings after review:
delete CN_TO_ID["吉尔提：神力兔女郎"]; // no sure Prydwen slug yet
delete CN_TO_ID["神罚"]; // uncertain
delete CN_TO_ID["克拉乌"]; // uncertain vs Crow
delete CN_TO_ID["丽塔"]; // Rita not on Prydwen list
delete CN_TO_ID["真理"]; // uncertain
delete CN_TO_ID["莫莉"]; // may not exist
delete CN_TO_ID["舒恩"];
delete CN_TO_ID["谢芙蒂"];
delete CN_TO_ID["机甲谢芙蒂"];
delete CN_TO_ID["艾瑟儿"]; // Ether already 埃葵斯
CN_TO_ID["吉尔提：神力兔女郎"] = "guilty-mighty-bunny"; // dedicated id even if not on Prydwen

/** Common CN nicknames → id (only sure from GameKee 角色昵称 + community). */
const NICK_TO_ID = {
  老奶奶: "rita", // will map after Rita card exists via pinyin id
  老麦: "maxwell",
  反派: "drake",
  大反派: "drake",
  草莓糖: "diesel",
  小提琴: "julia",
  滑板: "epinel",
  中二: "guillotine",
  中二病: "guillotine",
  初音: "privaty",
  长发: "rapunzel",
  睡莲: "frima",
  英雄: "laplace",
  hero: "laplace",
  圣诞露菲: "winter-shopper-rupee",
  圣露: "winter-shopper-rupee",
  圣安: "miracle-fairy-anne",
  火龙: "nihilister",
  doro: "dorothy",
  桃子: "dorothy",
  企鹅妹: "liter",
  白兔: "blanc",
  黑兔: "noir",
  水梅: "bay-goddess-mary",
  夏日梅里: "bay-goddess-mary",
  泳装梅里: "bay-goddess-mary",
  水阿: "sparkling-summer-anis",
  水海伦: "aqua-marine-helm",
  老师: "marciana",
  黑JK: "naga",
  白jk: "tia",
  白JK: "tia",
  小白雪: "innocent-dayss-snow-white",
  冬日女王: "ludmilla-winter-owner",
  女王: "ludmilla-winter-owner",
  冬日米卡: "mica-snow-buddy",
  黑莲: "scarlet-black-shadow",
  女仆初音: "privaty-unkind-maid",
  人妻D: "d-killer-wife",
  妻D: "d-killer-wife",
  "7D": "d-killer-wife",
  emt: "emilia",
  黑啦啦队: "bay",
  白啦啦队: "clay",
  兔爱: "alice-wonderland-bunny",
  索达兔: "soda-twinkling-bunny",
  水樱: "sakura-bloom-in-summer",
  夏日樱花: "sakura-bloom-in-summer",
  泳装樱花: "sakura-bloom-in-summer",
  水罗: "rosanna-chic-ocean",
  一期香: "asuka-shikinami-langley",
  二期香: "asuka-shikinami-langley-wille",
  风香: "asuka-shikinami-langley-wille",
  独眼香: "asuka-shikinami-langley-wille",
  水坎西: "quency-escape-queen",
  棺材女: "grave",
  冬梅: "maiden-ice-rose",
  女仆马斯特: "mast-romantic-maid",
  女仆安克: "anchor-innocent-maid",
  红毗: "rapi-red-hood",
  超毗: "rapi-red-hood",
  超米: "mihara-bonding-chain",
  水桃: "dorothy-serendipity",
  水蜜桃: "dorothy-serendipity",
  水母: "liberalio",
  // User-requested sure nicknames
  现代化枪: "modernia",
  魔导: "modernia",
  摩登: "modernia",
};

function clean(n) {
  return String(n || "").replace(/\ufeff/g, "").trim();
}

function toPinyinId(name, contentId) {
  const n = clean(name);
  let ascii = n
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (ascii && /[a-z]/.test(ascii) && ascii.length >= 2) return ascii;
  const py = pinyin(n, { toneType: "none", type: "array" })
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (py && py.length >= 2) return py;
  return `c${contentId}`;
}

function toId(name, contentId) {
  const n = clean(name);
  if (CN_TO_ID[n]) return CN_TO_ID[n];
  return toPinyinId(n, contentId);
}

function isRich(card) {
  if (!card) return false;
  if (card.stub === true) return false;
  if (card.stub === false) return true;
  if (Array.isArray(card.skills) && card.skills.length > 0) return true;
  return false;
}

async function fetchGameKeeEntries() {
  const url = `${GK}/v1/entry/list?page_no=1&limit=2000`;
  const res = await fetch(url, {
    headers: {
      "game-alias": "nikke",
      Accept: "application/json",
      "User-Agent": UA,
    },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const body = await res.json();
  if (body.code !== 0 || !Array.isArray(body.data)) {
    throw new Error(body.msg || "bad_entry_list");
  }
  return body.data
    .filter((x) => x.pid === CHAR_FOLDER_PID && !x.is_del)
    .map((x) => ({
      entry_id: x.id,
      name: clean(x.name),
      content_id: x.content_id,
      name_alias: x.name_alias || "",
    }));
}

async function fetchPrydwenList() {
  const res = await fetch(`${PRYDWEN}/nikke/characters`, {
    headers: {
      Accept: "text/html",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`prydwen_http_${res.status}`);
  const html = await res.text();
  const map = new Map();
  const re =
    /href="\/nikke\/characters\/([a-z0-9-]+)"[\s\S]{0,600}?alt="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    const slug = m[1];
    const alt = m[2];
    if (/Burst|element|Type|icon/i.test(alt)) continue;
    if (!map.has(slug)) map.set(slug, alt);
  }
  return [...map.entries()].map(([id, name_en]) => ({ id, name_en }));
}

function loadSeed() {
  if (!fs.existsSync(SEED_PATH)) return { gamekee: [], prydwen: [] };
  return JSON.parse(fs.readFileSync(SEED_PATH, "utf8"));
}

function stubFromGameKee(row, id) {
  return {
    id,
    name: row.name,
    name_zh: row.name,
    name_en: null,
    aliases: [],
    nicknames: [],
    game: "nikke",
    role: null,
    skills: [],
    skill_prio: [],
    burst: null,
    weapon: null,
    element: null,
    manufacturer: null,
    teams: {},
    sources: row.content_id
      ? [`${GK}/nikke/${row.content_id}.html`]
      : [],
    stub: true,
    note: "Catalog stub from GameKee 角色图鉴. Expand skills only from verified 图鉴/Prydwen.",
    as_of: AS_OF,
    gamekee_content_id: row.content_id ?? null,
    gamekee_entry_id: row.entry_id ?? null,
    prydwen_slug: CN_TO_ID[row.name] || null,
  };
}

function stubFromPrydwen(row) {
  return {
    id: row.id,
    name: row.name_en,
    name_zh: null,
    name_en: row.name_en,
    aliases: [],
    nicknames: [],
    game: "nikke",
    role: null,
    skills: [],
    skill_prio: [],
    burst: null,
    weapon: null,
    element: null,
    manufacturer: null,
    teams: {},
    sources: [`${PRYDWEN}/nikke/characters/${row.id}`],
    stub: true,
    note: "Catalog stub from Prydwen character list. Expand skills only from verified GameKee/Prydwen.",
    as_of: AS_OF,
    gamekee_content_id: null,
    gamekee_entry_id: null,
    prydwen_slug: row.id,
  };
}

function mergeCard(existing, incoming) {
  if (isRich(existing)) return existing;
  const next = { ...existing };
  if (!next.name_zh && incoming.name_zh) next.name_zh = incoming.name_zh;
  if (!next.name_en && incoming.name_en) next.name_en = incoming.name_en;
  if (incoming.name_zh && !next.name) next.name = incoming.name_zh;
  if (incoming.gamekee_content_id && !next.gamekee_content_id) {
    next.gamekee_content_id = incoming.gamekee_content_id;
    next.gamekee_entry_id = incoming.gamekee_entry_id;
  }
  if (incoming.prydwen_slug && !next.prydwen_slug) {
    next.prydwen_slug = incoming.prydwen_slug;
  }
  const sources = new Set([...(next.sources || []), ...(incoming.sources || [])]);
  next.sources = [...sources];
  // Prefer CN display name when GameKee provides it
  if (incoming.name_zh) {
    next.name = incoming.name_zh;
    next.name_zh = incoming.name_zh;
  }
  return next;
}

function buildAliases(cardsById) {
  const aliases = {};
  const put = (key, id, name, kind = "character") => {
    const k = String(key || "").trim();
    if (!k || !id || !cardsById.has(id)) return;
    if (aliases[k]) return;
    aliases[k] = { id, name: name || cardsById.get(id).name, kind };
  };

  for (const [id, card] of cardsById) {
    put(id, id, card.name_zh || card.name_en || card.name);
    if (card.name_zh) put(card.name_zh, id, card.name_zh);
    if (card.name_en) put(card.name_en, id, card.name_zh || card.name_en);
    if (card.name && card.name !== card.name_zh) put(card.name, id, card.name);
    for (const a of card.aliases || []) put(a, id, card.name_zh || card.name);
    for (const n of card.nicknames || []) put(n, id, card.name_zh || card.name);
  }

  for (const [nick, id] of Object.entries(NICK_TO_ID)) {
    if (!cardsById.has(id)) continue;
    const card = cardsById.get(id);
    put(nick, id, card.name_zh || card.name);
    // also attach to card nicknames
    card.nicknames = [...new Set([...(card.nicknames || []), nick])];
  }

  // Sure base-name aliases
  const sure = [
    ["红莲", "scarlet"],
    ["爱丽丝", "alice"],
    ["现代化枪", "modernia"],
    ["拉毗", "rapi"],
    ["阿妮斯", "anis"],
    ["尼恩", "neon"],
  ];
  for (const [nick, id] of sure) {
    if (cardsById.has(id)) {
      put(nick, id, cardsById.get(id).name_zh || cardsById.get(id).name);
      const c = cardsById.get(id);
      c.aliases = [...new Set([...(c.aliases || []), nick])];
    }
  }

  return aliases;
}

function updateGuidesIndex(cardsById) {
  const indexPath = path.join(DATA, "guides", "index.json");
  let index = { games: [] };
  if (fs.existsSync(indexPath)) {
    index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  }
  let rich = 0;
  let stub = 0;
  for (const c of cardsById.values()) {
    if (isRich(c)) rich++;
    else stub++;
  }
  const entry = (index.games || []).find((g) => g.id === "nikke");
  if (entry) {
    entry.character_count = cardsById.size;
    entry.rich_count = rich;
    entry.stub_count = stub;
  }
  index.as_of = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  return { character_count: cardsById.size, rich_count: rich, stub_count: stub };
}

async function main() {
  const offline = process.argv.includes("--offline");
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let gamekee = [];
  let prydwen = [];
  let source = "seed";

  if (!offline) {
    try {
      gamekee = await fetchGameKeeEntries();
      source = "gamekee_entry_list";
    } catch (e) {
      console.error("gamekee fetch failed:", e.message);
    }
    try {
      prydwen = await fetchPrydwenList();
      source = source === "gamekee_entry_list" ? "gamekee+prydwen" : "prydwen";
    } catch (e) {
      console.error("prydwen fetch failed:", e.message);
    }
    if (!gamekee.length && !prydwen.length) {
      const seed = loadSeed();
      gamekee = seed.gamekee || [];
      prydwen = seed.prydwen || [];
      source = "seed_fallback";
    } else {
      fs.writeFileSync(
        SEED_PATH,
        JSON.stringify({ gamekee, prydwen, as_of: AS_OF }, null, 2) + "\n"
      );
    }
  } else {
    const seed = loadSeed();
    gamekee = seed.gamekee || [];
    prydwen = seed.prydwen || [];
    source = "offline_seed";
  }

  // Load existing rich cards
  const cardsById = new Map();
  if (fs.existsSync(OUT_DIR)) {
    for (const f of fs.readdirSync(OUT_DIR).filter((x) => x.endsWith(".json"))) {
      const card = JSON.parse(fs.readFileSync(path.join(OUT_DIR, f), "utf8"));
      if (card.id) cardsById.set(card.id, card);
    }
  }

  let written = 0;
  let skipped_rich = 0;
  let merged = 0;

  // Prydwen first (canonical English ids)
  for (const row of prydwen) {
    if (!row.id) continue;
    const stub = stubFromPrydwen(row);
    if (cardsById.has(row.id)) {
      if (isRich(cardsById.get(row.id))) {
        skipped_rich++;
        continue;
      }
      cardsById.set(row.id, mergeCard(cardsById.get(row.id), stub));
      merged++;
    } else {
      cardsById.set(row.id, stub);
      written++;
    }
  }

  // GameKee overlay / add
  const usedIds = new Set(cardsById.keys());
  for (const row of gamekee) {
    if (!row.name || !row.content_id) continue;
    let id = toId(row.name, row.content_id);
    if (!CN_TO_ID[row.name] && usedIds.has(id) && !cardsById.get(id)?.gamekee_content_id) {
      // collision on pinyin — suffix
      id = `${id}-${row.content_id}`;
    }
    usedIds.add(id);
    const stub = stubFromGameKee(row, id);
    if (cardsById.has(id)) {
      if (isRich(cardsById.get(id))) {
        skipped_rich++;
        continue;
      }
      cardsById.set(id, mergeCard(cardsById.get(id), stub));
      merged++;
    } else {
      cardsById.set(id, stub);
      written++;
    }
  }

  // Ensure modernia exists (Prydwen has it; CN nickname 现代化枪)
  if (!cardsById.has("modernia") && prydwen.some((p) => p.id === "modernia")) {
    // already from prydwen
  }

  // Attach nicknames onto cards + build aliases.json
  const aliases = buildAliases(cardsById);

  // Write all stubs (don't overwrite rich)
  for (const [id, card] of cardsById) {
    const dest = path.join(OUT_DIR, `${id}.json`);
    if (fs.existsSync(dest) && isRich(JSON.parse(fs.readFileSync(dest, "utf8")))) {
      continue;
    }
    fs.writeFileSync(dest, JSON.stringify(card, null, 2) + "\n");
  }

  fs.writeFileSync(
    ALIAS_PATH,
    JSON.stringify(
      {
        _meta: {
          game: "nikke",
          note: "Nickname/name → canonical id. GameKee 角色昵称 + sure community nicknames only; never invent.",
          as_of: AS_OF,
        },
        aliases,
      },
      null,
      2
    ) + "\n"
  );

  const counts = updateGuidesIndex(cardsById);

  console.log(
    JSON.stringify(
      {
        ok: true,
        source,
        gamekee_discovered: gamekee.length,
        prydwen_discovered: prydwen.length,
        written,
        merged,
        skipped_rich,
        aliases: Object.keys(aliases).length,
        ...counts,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
