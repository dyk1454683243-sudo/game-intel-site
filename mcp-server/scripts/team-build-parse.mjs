/**
 * Pure extractors for short 配队 / 养成 lines.
 * They copy published sentences. They do not invent partners, grades, or skill levels.
 */

export const HW_TITLE_ALIAS = {
  珠哈: "yuha",
  艾弗莉特: "ai_fu_li_te",
  贝尔加: "bei_er_jia",
  格里塞尔达: "ge_li_ze_er_da",
  莉珊德莉亚: "lysandria",
  艾尔内斯特: "ai_er_nie_si_te",
};

export const HW_MODE_KEYS = ["story", "rift_45", "dopamine", "spec_ops", "union", "training"];

const MODE_HEADER = {
  主线开荒: "story",
  "45层裂隙": "rift_45",
  多巴胺: "dopamine",
  特殊作战: "spec_ops",
  总力战: "union",
  特殊训练场: "training",
};

const BLURB_RE =
  /配队|队友|队伍|射击队|女王队|火塞|毒队|三鲸|猫队|配合|搭档|适用于|不推荐|常驻|常客|出场|双子|鲸/;

const NOTE_RE = /射击队|女王队|火塞|毒队|3猫队|三鲸|钦定/;

export function normName(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/[·・:：()（）<>《》「」"'“”]/g, "")
    .toLowerCase();
}

export function nameKeys(card) {
  const keys = [];
  for (const value of [card?.name_zh, card?.name, ...(card?.aliases || []), ...(card?.nicknames || [])]) {
    const text = String(value || "").trim();
    if (text.length < 2) continue;
    if (/^[a-z0-9]+$/i.test(text) && text.length < 4) continue;
    keys.push(text);
  }
  return keys;
}

export function clip(text, max = 180) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("；"), cut.lastIndexOf("，"));
  if (i >= 24) return cut.slice(0, i + 1);
  return `${cut.trim()}…`;
}

export function hanCount(text) {
  return (String(text || "").match(/[\u4e00-\u9fff]/g) || []).length;
}

export function matchCardByTitle(title, cards, aliasMap = HW_TITLE_ALIAS) {
  const raw = String(title || "");
  const token = raw
    .replace(/角色测评|服装测评|测评|简评|抽取建议/g, "")
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[<>《》]/g, "")
    .replace(/\s+/g, "")
    .trim();
  if (aliasMap[token] && cards.some((card) => card.id === aliasMap[token])) return aliasMap[token];
  const tn = normName(raw);
  const hits = [];
  for (const card of cards) {
    let best = 0;
    for (const key of nameKeys(card)) {
      const nk = normName(key);
      if (nk.length >= 2 && tn.includes(nk) && nk.length > best) best = nk.length;
    }
    if (best) hits.push({ id: card.id, best });
  }
  if (hits.length) {
    const max = Math.max(...hits.map((hit) => hit.best));
    const ids = [...new Set(hits.filter((hit) => hit.best === max).map((hit) => hit.id))];
    if (ids.length === 1) return ids[0];
    return null;
  }
  if (token.length >= 2) {
    const sub = cards.filter((card) => String(card.name_zh || card.name || "").includes(token));
    const ids = [...new Set(sub.map((card) => card.id))];
    if (ids.length === 1) return ids[0];
  }
  return null;
}

export function nodeText(node) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n !== "object") return;
    if (typeof n.text === "string" && n.text.trim()) {
      const cleaned = n.text
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/\s+/g, " ")
        .trim();
      if (cleaned) out.push(cleaned);
    }
    if (n.children) walk(n.children);
  };
  walk(node);
  return out.join("").replace(/\s+/g, " ").trim();
}

export function parseContentNodes(content) {
  let nodes = content;
  if (typeof nodes === "string") {
    const trimmed = nodes.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        nodes = JSON.parse(trimmed);
      } catch {
        return [];
      }
    } else {
      return [{ type: "paragraph", children: [{ text: nodes }] }];
    }
  }
  return Array.isArray(nodes) ? nodes : [];
}

export function sectionText(nodes, headerRe) {
  let on = false;
  const buf = [];
  for (const node of nodes) {
    const type = String(node?.type || "");
    if (/^header/.test(type)) {
      const heading = nodeText(node);
      if (on) break;
      if (headerRe.test(heading)) on = true;
      continue;
    }
    if (!on) continue;
    const text = nodeText(node);
    if (text) buf.push(text);
  }
  return buf.join(" ").replace(/\s+/g, " ").trim();
}

export function acceptProse(text, { max = 180, kind = "team" } = {}) {
  const t = clip(text, max);
  if (!t || hanCount(t) < 6) return "";
  if (
    /请不要参考|暂不参考|求赞|退款|选号流程|请配合当下|具备时效性|魔怔xp|配队当挂件|能够胜任部分场景|名字稀有度|词条推荐|普池兑换|还有待开发|仅供参考|预测配队|基本仓管|配队推荐#|自选B\d|旧版.*配队/.test(
      t
    )
  ) {
    return "";
  }
  if (/^(无|暂无|没有)$/.test(t)) return "";
  const digits = (t.match(/\d/g) || []).length;
  if (digits > 8 && digits > hanCount(t)) return "";
  if (kind === "skill" && !/级|点|优先|>|升级|潜能|主动|被动/.test(t)) return "";
  if (kind === "blurb" && !BLURB_RE.test(t)) return "";
  if (kind === "note" && !NOTE_RE.test(t)) return "";
  if (kind === "team" && !/配队|队友|队伍|配合|搭档|辅助|队/.test(t)) return "";
  return t;
}

export function sectionParagraphs(nodes, headerRe) {
  let on = false;
  const buf = [];
  for (const node of nodes) {
    const type = String(node?.type || "");
    if (/^header/.test(type)) {
      const heading = nodeText(node);
      if (on) break;
      if (headerRe.test(heading)) on = true;
      continue;
    }
    if (!on) continue;
    const text = nodeText(node);
    if (text) buf.push(text);
  }
  return buf;
}

export function parseModeTable(nodes) {
  const table = nodes.find((node) => node?.type === "table");
  if (!table) return [];
  const rows = (table.children || []).map((row) => (row.children || []).map(nodeText));
  if (!rows.length) return [];
  const head = rows[0];
  const nameIdx = head.indexOf("角色名");
  if (nameIdx < 0) return [];
  const col = {};
  for (const [label, key] of Object.entries(MODE_HEADER)) {
    const idx = head.indexOf(label);
    if (idx >= 0) col[key] = idx;
  }
  const out = [];
  for (const cells of rows.slice(1)) {
    const name = cells[nameIdx];
    if (!name) continue;
    const fit = {};
    for (const key of HW_MODE_KEYS) {
      const value = cells[col[key]] || "";
      if (value === "√" || value === "×") fit[key] = value;
    }
    if (Object.keys(fit).length) out.push({ name, fit });
  }
  return out;
}

export function parseCharacterFolds(nodes) {
  const out = [];
  for (const block of nodes) {
    if (block?.type !== "flod") continue;
    const title = typeof block.title === "string" ? block.title : nodeText(block.title);
    if (!/简评|其他评价/.test(title || "")) continue;
    let name = null;
    let buf = [];
    const flush = () => {
      if (!name) return;
      out.push({ name, lines: buf });
    };
    for (const child of block.children || []) {
      const styled = child?.customClass && String(child.customClass).includes("custom-block-style");
      if (child?.type === "paragraph" && styled) {
        flush();
        name = nodeText(child)
          .replace(/[（(][^）)]*[）)]/g, "")
          .replace(/半神化/g, "")
          .trim();
        buf = [];
        continue;
      }
      const text = nodeText(child);
      if (text) buf.push(text);
    }
    flush();
  }
  return out;
}

export function noteClauses(note) {
  return String(note || "")
    .split(/[。；\n]/)
    .map((part) => acceptProse(part, { max: 140, kind: "note" }))
    .filter(Boolean);
}

export function sectionTeamLines(paragraphs, cards, selfId) {
  const out = [];
  for (const raw of paragraphs) {
    const focused = teamSentences(raw);
    if (focused.length) {
      for (const line of focused) pushUnique(out, line, 2);
      continue;
    }
    const text = acceptProse(raw, { max: 140, kind: "section" });
    if (!text) continue;
    const hits = cardsMentioned(text, cards).filter((hit) => hit.id !== selfId);
    if (hits.length && text.length >= 18) pushUnique(out, text, 2);
  }
  return out;
}

export function teamSentences(text) {
  return String(text || "")
    .split(/[。；\n]/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => /配合|配个|配队|阵容|物理队|魔法队|队友|队伍|射击队|女王队|火塞|毒队|三鲸|鲸|适用于|不推荐/.test(part))
    .map((part) => acceptProse(part, { max: 140, kind: "section" }))
    .filter((part) => part && (part.length >= 18 || /需要|绑定|队伍|阵容|射击队|女王队|火塞|毒队|三鲸/.test(part)));
}

function boundedName(text, key) {
  const src = String(text);
  const needle = String(key).toLowerCase();
  const lower = src.toLowerCase();
  let from = 0;
  while (from < lower.length) {
    const index = lower.indexOf(needle, from);
    if (index < 0) return false;
    const before = index > 0 ? src[index - 1] : "";
    const after = src[index + key.length] || "";
    const glue = /[\u4e00-\u9fffA-Za-z0-9]/;
    if (!glue.test(before) && !glue.test(after)) return true;
    from = index + 1;
  }
  return false;
}

export function cardsMentioned(text, cards) {
  const normText = normName(text);
  const hits = [];
  for (const card of cards) {
    const canonical = new Set(
      [card.name_zh, card.name].filter((value) => value && String(value).trim().length >= 2).map(normName)
    );
    for (const key of nameKeys(card)) {
      const nk = normName(key);
      if (nk.length < 2 || !normText.includes(nk)) continue;
      if (!canonical.has(nk) && nk.length < 4 && !boundedName(text, key)) continue;
      hits.push({ id: card.id, key, nk });
    }
  }
  return hits
    .filter(
      (hit) =>
        !hits.some(
          (other) => other.id !== hit.id && other.nk.length > hit.nk.length && other.nk.includes(hit.nk)
        )
    )
    .filter((hit, index, arr) => arr.findIndex((other) => other.id === hit.id) === index);
}

const GUIDE_CONTEXT_RE = /爆裂阶段|优先级T|常见固定配队|人人都可以/;
const GUIDE_LINE_RE = /配队|队友|队伍|阵容|一起|绑定|搭配|优先级|爆裂阶段|同一队伍|12333|11233|32333|获得的阵容|T[0-3][:：]/;

export function notesFromGuide(paragraphs, cards, { maxPerCard = 3 } = {}) {
  const out = new Map();
  let context = "";
  let contextLeft = 0;
  const add = (id, line) => {
    const cleaned = acceptProse(clip(line, 160), { max: 160, kind: "section" });
    if (!cleaned || hanCount(cleaned) < 4) return;
    if (cleaned.length < 18 && !/需要|绑定|一起|阵容|优先级|12333|11233|32333/.test(cleaned)) return;
    if (/随机选择|其余没有提到/.test(cleaned)) return;
    const text = cleaned;
    if (!out.has(id)) out.set(id, []);
    const bucket = out.get(id);
    if (bucket.length >= maxPerCard) return;
    if (bucket.some((prev) => prev.includes(text) || text.includes(prev))) return;
    bucket.push(text);
  };
  for (const raw of paragraphs) {
    const paragraph = String(raw || "").replace(/\s+/g, " ").trim();
    if (!paragraph) continue;
    if (GUIDE_CONTEXT_RE.test(paragraph) && paragraph.length <= 48) {
      context = clip(paragraph, 36);
      contextLeft = 1;
    }
    const hits = cardsMentioned(paragraph, cards);
    let line = "";
    if (GUIDE_LINE_RE.test(paragraph)) line = paragraph;
    else if (
      hits.length &&
      context &&
      contextLeft > 0 &&
      /优先级|爆裂阶段|阵容/.test(context) &&
      paragraph.length <= 36
    ) {
      line = `${context} ${paragraph}`;
    }
    if (contextLeft > 0 && !GUIDE_CONTEXT_RE.test(paragraph)) contextLeft = 0;
    if (!line || !hits.length) continue;
    const shown = clip(line, 160);
    for (const hit of hits) {
      if (!normName(shown).includes(hit.nk || normName(hit.key))) continue;
      add(hit.id, line);
    }
  }
  return out;
}

export function pushUnique(list, line, max = 3) {
  const text = String(line || "").trim();
  if (!text) return list;
  if (list.some((prev) => prev === text || (prev.length > 12 && (prev.includes(text) || text.includes(prev))))) {
    return list;
  }
  if (list.length >= max) return list;
  list.push(text);
  return list;
}

export function costumeInTitle(card, title) {
  const costumes = Array.isArray(card?.costumes) ? card.costumes : [];
  const hits = costumes.filter((costume) => costume?.name && String(title || "").includes(costume.name));
  if (hits.length === 1) return hits[0].name;
  if (/原皮/.test(String(title || ""))) {
    const base = costumes.find((costume) => costume?.type === "原皮" && costume.name);
    if (base) return base.name;
  }
  return null;
}

export function bd2Lines(paragraphs) {
  const skill = [];
  const team = [];
  for (const raw of paragraphs) {
    const text = String(raw || "").replace(/\s+/g, " ").trim();
    if (!text || hanCount(text) < 6) continue;
    if (/求赞|退款|选号流程|周年庆|魔怔/.test(text)) continue;
    if (/^综合评价/.test(text)) continue;
    if (/潜能开启建议|技能优先级|加点推荐|技能加点/.test(text)) {
      const line = acceptProse(text, { max: 160, kind: "skill" });
      if (line) pushUnique(skill, line, 2);
    }
    for (const line of teamSentences(text)) pushUnique(team, line, 2);
  }
  return { skill, team };
}

export function skillPrioFromNikke(skillprio) {
  if (!skillprio || typeof skillprio !== "object") return [];
  const lines = [];
  const order = String(skillprio["Skill Order Priority"] || skillprio.SkillPrioOrder || "").trim();
  const req = String(
    skillprio["Recommended Skill Investments"] || skillprio.SkillPrioReq || ""
  ).trim();
  const budget = String(skillprio["Budget Skill investments"] || skillprio.SkillPrioBudget || "").trim();
  if (order) lines.push(`技能顺序 ${order}`);
  if (req) lines.push(`推荐练度 ${req}`);
  if (budget) lines.push(`预算练度 ${budget}`);
  return lines;
}
