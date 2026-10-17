#!/usr/bin/env python3
"""Build Arknights: Endfield guide cards from official pages, GameKee, BWIKI, and saved Prydwen markdown.

Does not invent tiers. A card without a combat-skill source stays stub:true.
Prydwen markdown is read from ENDFIELD_PRYDWEN_DIR (default /tmp/endfield/pry).
Pages that were captured inline are applied from OVERLAY below, with the same URL and Last updated date.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get("GAME_INTEL_DATA", ROOT / "data"))
GUIDE = DATA / "guides" / "arknights-endfield"
CHAR_DIR = GUIDE / "characters"
SITE = ROOT / "ai-site" / "public"
AS_OF = "2026-10-17"
TZ = "Asia/Shanghai"
GK = "https://www.gamekee.com"
ENTRY_LIST = f"{GK}/v1/entry/list?page_no=1&limit=2000"
PRY_DIR = Path(os.environ.get("ENDFIELD_PRYDWEN_DIR", "/tmp/endfield/pry"))
CACHE = Path("/tmp/endfield/build-cache")
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

OFFICIAL_EN = "https://endfield.gryphline.com/en-us/operator"
OFFICIAL_CN = "https://endfield.hypergryph.com/operator"
OFFICIAL_TW = "https://endfield.gryphline.com/zh-tw/operator"
NEWS = "https://endfield.gryphline.com/en-us/news"
NEWS_API = "https://web-news.gryphline.com/api/bulletin"

# Official list key -> card id. Two Endministrator portraits share one card.
SLUG = {
    "jsspsi": "si",
    "minghe": "argent-flow",
    "endministrator1": "endministrator",
    "endministrator2": "endministrator",
    "perlica": "perlica",
    "chen": "chen-qianyu",
    "typhoea": "typhoeus",
    "purrche": "purrchena",
    "lizhiyan": "arcane",
    "liino": "liino",
    "mifu": "mi-fu",
    "camille": "camille",
    "zhuangfy": "zhuang-fangyi",
    "tangtang": "tangtang",
    "rossi": "rossi",
    "laevatain": "laevatain",
    "yvonne": "yvonne",
    "gilberta": "gilberta",
    "ardelia": "ardelia",
    "ember": "ember",
    "lastrite": "last-rite",
    "lifeng": "lifeng",
    "pogranichnik": "pogranichnik",
    "alesh": "alesh",
    "arclight": "arclight",
    "avywenna": "avywenna",
    "dapan": "da-pan",
    "snowshine": "snowshine",
    "wulfgard": "wulfgard",
    "xaihi": "xaihi",
    "akekuri": "akekuri",
    "antal": "antal",
    "catcher": "catcher",
    "estella": "estella",
    "fluorite": "fluorite",
}

MONTHS = {
    "January": 1, "February": 2, "March": 3, "April": 4, "May": 5, "June": 6,
    "July": 7, "August": 8, "September": 9, "October": 10, "November": 11, "December": 12,
}

# Prydwen pages returned inline (not saved as markdown). Facts copied from those fetches.
OVERLAY = {
    "ember": {
        "updated": "2026-06-14",
        "tier": "T1",
        "prio": ["Off Field: Combo Skill > Ultimate = Basic Attack > Battle Skill"],
        "teams": [
            ["Endministrator", "Lifeng", "Chen Qianyu", "Ember"],
            ["Da Pan", "Lifeng", "Chen Qianyu", "Ember"],
            ["Endministrator", "Pogranichnik", "Chen Qianyu", "Ember"],
        ],
    },
    "snowshine": {
        "updated": "2026-06-14",
        "tier": "T1",
        "prio": ["Off Field: Combo Skill > Ultimate = Basic Attack > Battle Skill"],
        "teams": [["Yvonne", "Xaihi", "Ardelia", "Snowshine"]],
    },
    "akekuri": {
        "updated": "2026-06-14",
        "tier": "T0.5",
        "prio": ["Off Field: Ultimate > Combo Skill > Basic Attack > Battle Skill"],
        "teams": [["Laevatain", "Akekuri", "Antal", "Ardelia"]],
    },
    "catcher": {
        "updated": "2026-06-14",
        "tier": "T2",
        "prio": ["Off Field: Combo Skill > Ultimate = Basic Attack > Battle Skill"],
        "teams": [
            ["Endministrator", "Lifeng", "Chen Qianyu", "Catcher"],
            ["Da Pan", "Lifeng", "Chen Qianyu", "Catcher"],
        ],
    },
    "estella": {
        "updated": "2026-06-14",
        "tier": "T1.5",
        "prio": ["Off Field: Combo Skill > Ultimate > Basic Attack > Battle Skill"],
        "teams": [
            ["Endministrator", "Estella", "Alesh", "Ardelia"],
            ["Yvonne", "Xaihi", "Alesh", "Estella"],
        ],
    },
    "fluorite": {
        "updated": "2026-06-14",
        "tier": "T1.5",
        "prio": ["Off Field: Basic Attack >= Combo Skill > Ultimate > Battle Skill"],
        "teams": [["Yvonne", "Fluorite", "Xaihi", "Gilberta"]],
    },
}


def fetch(url, headers=None, timeout=40):
    last = None
    for attempt in range(3):
        req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.read()
        except Exception as exc:
            last = exc
            time.sleep(1.2 * (attempt + 1))
    raise last


def fetch_json(url, headers=None):
    return json.loads(fetch(url, headers).decode("utf-8"))


def clean_markup(text):
    s = unescape(str(text or "")).replace("\r", "")
    s = re.sub(r"\*+[a-z]+:#([^#*]+)#\*+", r"\1", s)
    s = re.sub(r"\*+[a-z]+:([^*]+)\*+", r"\1", s)
    s = re.sub(r"\*\*#([^#]+)#\*\*", r"\1", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = s.replace("{{颜色|蓝|", "").replace("{{颜色|自然|", "").replace("{{颜色|橙|", "")
    s = re.sub(r"\{\{[^}]+\}\}", "", s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    return s.strip()


def portrait_ok(url):
    if not url or not url.startswith("https://") or any(c in url for c in " \t?#"):
        return False
    try:
        host, path = re.match(r"https://([^/]+)(/.*)$", url).groups()
    except AttributeError:
        return False
    if host == "cdnimg-v2.gamekee.com":
        legacy = path.startswith("/wiki2.0/images/")
        sized = path.startswith("/wiki2.0/pro/") and "/images/" in path
        if not (legacy or sized):
            return False
    elif host == "cdn.prydwen.gg":
        if not path.startswith("/images/arknights-endfield/characters/"):
            return False
    else:
        return False
    return bool(re.search(r"\.(png|jpe?g|webp|gif)$", path, re.I))


def https_url(raw):
    s = str(raw or "").strip()
    if s.startswith("//"):
        s = "https:" + s
    return s.split("?")[0].split("#")[0]


def parse_operators(html):
    out = []
    parts = html.split("OperatorItem_operatorItem")
    for part in parts[1:]:
        keys = re.findall(r'data-key="([^"]+)"', part)
        rarity = re.search(r'data-rarity="(\d+)"', part)
        name = re.search(r"nameText[^>]*>([^<]+)", part)
        if not keys or not name or not rarity:
            continue
        image_key = keys[0]
        icons = keys[1:]
        out.append(
            {
                "key": image_key,
                "slug": SLUG.get(image_key),
                "name": unescape(name.group(1)).strip(),
                "rarity": int(rarity.group(1)),
                "class_key": icons[0] if icons else None,
                "element_key": icons[1] if len(icons) > 1 else None,
            }
        )
    return out


def row_cells(row):
    cells = []
    if not isinstance(row, list):
        return cells
    for i, cell in enumerate(row):
        if not isinstance(cell, dict):
            continue
        value = cell.get("value")
        if isinstance(value, str) and value.strip():
            cells.append({"i": i, "global": bool(cell.get("isGlobal")), "type": cell.get("type"), "value": value.strip()})
        elif cell.get("type") == "image" and isinstance(value, str) and value.strip():
            cells.append({"i": i, "global": False, "type": "image", "value": value.strip()})
    return cells


def labeled(cells, label):
    for n, cell in enumerate(cells):
        if cell["value"] == label and cell["type"] != "image":
            for nxt in cells[n + 1 :]:
                if nxt["type"] != "image" and nxt["value"] != label:
                    return nxt["value"]
    return None


def parse_gamekee(content_json):
    data = json.loads(content_json) if isinstance(content_json, str) else content_json
    base = data.get("baseData") or []
    rows = [row_cells(row) for row in base]
    meta = {}
    for cells in rows:
        if not cells:
            continue
        for label, key in (("角色名称", "name"), ("星级", "rarity"), ("职业", "role"), ("属性", "element"), ("武器类型", "weapon")):
            if any(c["value"] == label and c["type"] != "image" for c in cells):
                val = labeled(cells, label)
                if val and key not in meta and val not in ("图标", "技能属性"):
                    meta[key] = clean_markup(val)
    skills = []
    kind = {
        "普通攻击": "basic",
        "战技": "battle",
        "连携技": "combo",
        "终结技": "ultimate",
    }
    for cells in rows:
        if not cells or cells[0]["value"] not in kind:
            continue
        name = None
        for cell in cells[1:]:
            if cell["type"] != "image" and not cell["global"]:
                name = clean_markup(cell["value"])
                break
        bits = []
        labels = {
            "普通攻击描述": "普通攻击",
            "下落攻击描述": "下落攻击",
            "处决攻击描述": "处决攻击",
            "技能描述": "",
        }
        pending = None
        for cell in cells:
            if cell["global"] and cell["value"] in labels:
                pending = labels[cell["value"]]
                continue
            if pending is not None and cell["type"] != "image" and not cell["global"]:
                text = clean_markup(cell["value"])
                if text:
                    bits.append(f"{pending}：{text}" if pending else text)
                pending = None
        if name and bits:
            skills.append({"name": name, "type": kind[cells[0]["value"]], "summary": "\n".join(bits)})
    talent_name = None
    talent_kind = None
    for cells in rows:
        if not cells:
            continue
        head = cells[0]["value"]
        if head in ("天赋1", "天赋2"):
            talent_kind = "talent"
            talent_name = None
            continue
        if head in ("后勤技能1", "后勤技能2"):
            talent_kind = "base"
            talent_name = None
            continue
        if talent_kind and head == "名称":
            talent_name = labeled(cells, "名称")
            continue
        if talent_kind and talent_name and head in ("1阶描述", "2阶描述"):
            # The sentence sits in column 1. Later columns are material labels, not the effect.
            text = next((c["value"] for c in cells if c["i"] == 1 and not c["global"]), "")
            if not text:
                continue
            text = clean_markup(text)
            existing = next((s for s in skills if s["name"] == talent_name and s["type"] == talent_kind), None)
            line = f"{head}：{text}"
            if existing:
                existing["summary"] += "\n" + line
            else:
                skills.append({"name": clean_markup(talent_name), "type": talent_kind, "summary": line})
    stats = {}
    primary = secondary = None
    stat_names = {"力量", "敏捷", "智识", "意志", "生命", "攻击力"}
    for n, cells in enumerate(rows):
        if not cells or cells[0]["value"] not in stat_names:
            continue
        stat = cells[0]["value"]
        mark = next((c["value"] for c in cells if c["value"] in ("主", "副")), None)
        if mark == "主":
            primary = stat
        elif mark == "副":
            secondary = stat
        for look in rows[n + 1 : n + 5]:
            if look and look[0]["value"] == "数值":
                # Level columns sit at indexes 1..6 (Lv.1 through Lv.90). Later cells are materials.
                by_index = {c["i"]: c["value"] for c in look if re.fullmatch(r"\d+(?:\.\d+)?", c["value"])}
                ordered = [by_index[i] for i in range(1, 7) if i in by_index]
                if len(ordered) >= 2:
                    stats[stat] = {"1": ordered[0], "90": ordered[-1]}
                break
    portrait = None
    for cells in rows:
        if cells and cells[0]["value"] == "角色头像":
            img = next((c["value"] for c in cells if c["type"] == "image"), None)
            if img:
                portrait = https_url(img)
            break
    return {
        "meta": meta,
        "skills": skills,
        "attributes": {"primary": primary, "secondary": secondary, "level_90_and_1": stats} if stats else None,
        "head": portrait,
    }


def page_date(text):
    m = re.search(r"Last updated:\s*(\d{1,2})/([A-Za-z]+)/(\d{4})", text)
    if not m:
        return None
    month = MONTHS.get(m.group(2))
    if not month:
        return None
    return f"{int(m.group(3)):04d}-{month:02d}-{int(m.group(1)):02d}"


def parse_tier(text):
    start = text.find("### Gallery")
    if start < 0:
        start = text.find("### Ratings")
    window = text[start : start + 900] if start >= 0 else ""
    m = re.search(
        r"(?:######\s+([A-Za-z][A-Za-z /+-]{0,40})\s+)?(T[0-3](?:\.[05])?)\s+Umbral Monument",
        window,
    )
    if not m:
        return None
    role = (m.group(1) or "").strip()
    return {"role": role or None, "tier": m.group(2)}


def parse_prio(text):
    m = re.search(r"## Skill Priority(.*?)(?:Teams and Synergies|### Synergies|### Teams|\Z)", text, re.S)
    if not m or "aren't available" in m.group(1):
        return []
    lines = []
    label = None
    for raw in m.group(1).splitlines():
        line = raw.strip().lstrip("#").strip()
        if not line:
            continue
        if line.endswith(":") and ">" not in line:
            label = line[:-1]
            continue
        if ">" in line and any(word in line for word in ("Battle", "Ultimate", "Combo", "Basic")):
            cleaned = clean_markup(line.lstrip(">").strip())
            lines.append(f"{label}: {cleaned}" if label else cleaned)
    return lines


def parse_prydwen_skills(text):
    if "skills are currently missing" in text:
        return []
    m = re.search(r"### Skills\n(.*?)### Talents", text, re.S)
    if not m:
        return []
    body = m.group(1)
    chunks = re.split(r"\n(?=(?:Basic Attack|Battle Skill|Combo Skill|Ultimate)\n)", "\n" + body)
    kind = {"Basic Attack": "basic", "Battle Skill": "battle", "Combo Skill": "combo", "Ultimate": "ultimate"}
    skills = []
    for chunk in chunks:
        lines = [ln.strip() for ln in chunk.splitlines() if ln.strip()]
        if not lines or lines[0] not in kind:
            continue
        name = lines[1] if len(lines) > 1 and not lines[1].startswith("#") else lines[0]
        desc = []
        for line in lines[2:]:
            if line in ("Multipliers (Rank 12)", "Show Effects"):
                continue
            desc.append(re.sub(r"^#+\s*", "", line))
        summary = clean_markup(" ".join(desc))
        if summary and "currently missing" not in summary:
            skills.append({"name": name, "type": kind[lines[0]], "summary": summary})
    tm = re.search(r"### Talents\n(.*?)### Potential", text, re.S)
    if tm and "currently missing" not in tm.group(1):
        blocks = re.split(r"\n(?=(?:Base Talent|Combat Talent)\n)", "\n" + tm.group(1))
        for block in blocks:
            lines = [ln.strip() for ln in block.splitlines() if ln.strip()]
            if not lines or lines[0] not in ("Base Talent", "Combat Talent"):
                continue
            if len(lines) < 3:
                continue
            summary = clean_markup(" ".join(lines[2:]))
            if summary:
                skills.append(
                    {
                        "name": lines[1],
                        "type": "base" if lines[0] == "Base Talent" else "talent",
                        "summary": summary,
                    }
                )
    return skills


def parse_level90(text):
    m = re.search(r"### Attributes \(level 90\)(.*?)### Skills", text, re.S)
    if not m or "aren't available" in m.group(1):
        return None
    stats = {}
    for stat in ("Strength", "Agility", "Intellect", "Will"):
        hit = re.search(rf"{stat}\s+(\d+)", m.group(1))
        if hit:
            stats[stat] = hit.group(1)
    return stats or None


def member_ids(chunk, en_to_id):
    slugs = []
    for slug in re.findall(r"prydwen\.gg/arknights-endfield/characters/([a-z0-9-]+)", chunk):
        if slug not in slugs:
            slugs.append(slug)
    if len(slugs) == 4 and all(slug in set(en_to_id.values()) or slug in en_to_id.values() for slug in slugs):
        # slugs are ids
        if all(slug in en_to_id.values() for slug in slugs):
            return slugs
    names = []
    for line in chunk.splitlines():
        name = line.strip()
        if name in en_to_id and name not in names:
            names.append(name)
    if len(names) == 4:
        return [en_to_id[name] for name in names]
    return None


def teams_from_text(text, en_to_id):
    m = re.search(r"### Teams\n(.*)", text, re.S)
    if not m or "aren't available" in m.group(1)[:400]:
        return []
    found = []
    for n, block in enumerate(re.split(r"###### Team Members", m.group(1))[1:], 1):
        chunk = re.split(r"\n###### |\nTeam #", block, maxsplit=1)[0]
        ids = member_ids(chunk, en_to_id)
        if ids:
            found.append((n, ids))
    return found


def intro_facts(text, en_name):
    pat = (
        rf"{re.escape(en_name)} is a (\d)-star character.*?wields (?:an |a )?([A-Za-z][A-Za-z ]*?) and belongs to the ([A-Za-z ]+?) class"
    )
    m = re.search(pat, text, re.S)
    element = re.search(r"access to the ([A-Za-z]+) element", text)
    if not m:
        return None
    return {
        "rarity": int(m.group(1)),
        "weapon_en": m.group(2).strip(),
        "class_en": m.group(3).strip(),
        "element_en": element.group(1) if element else None,
    }


def bwiki_operator(title):
    q = urllib.parse.urlencode({"action": "parse", "page": title, "prop": "wikitext", "format": "json"})
    try:
        data = fetch_json("https://wiki.biligame.com/zmd/api.php?" + q)
    except Exception:
        return None
    if "error" in data:
        return None
    wt = data["parse"]["wikitext"]["*"]
    if wt.startswith("#REDIRECT"):
        target = re.search(r"\[\[:?([^\]]+)\]\]", wt)
        return {"redirect": target.group(1).strip() if target else wt}
    fields = {}
    for key, val in re.findall(r"\|([^=\n]+)=([^\n]*)", wt):
        fields[key.strip()] = val.strip()
    return fields


def html_page(title, body):
    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>{title}</title>
  <style>
    body{{font-family:system-ui,sans-serif;max-width:880px;margin:2rem auto;padding:0 1rem;line-height:1.55;color:#111}}
    a{{color:#06c}} code{{background:#f4f4f4;padding:.1em .35em;border-radius:4px}}
    .stub{{color:#a60}}.rich{{color:#070}} ul{{padding-left:1.2rem}}
    .meta{{color:#666;font-size:.9rem}} table{{border-collapse:collapse;width:100%}}
    td,th{{border:1px solid #ddd;padding:.4rem .55rem;text-align:left}}
  </style>
</head>
<body>
{body}
<hr/>
<p class="meta">game-intel guides · Asia/Shanghai · dual-publish from <code>data/guides/</code></p>
</body>
</html>
"""


def esc(value):
    return (
        str(value or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    en_ops = parse_operators(fetch(OFFICIAL_EN).decode("utf-8", "replace"))
    cn_ops = {row["key"]: row for row in parse_operators(fetch(OFFICIAL_CN).decode("utf-8", "replace"))}
    tw_ops = {row["key"]: row for row in parse_operators(fetch(OFFICIAL_TW).decode("utf-8", "replace"))}
    by_slug = {}
    for row in en_ops:
        slug = row["slug"]
        if not slug:
            raise SystemExit(f"unmapped official key {row['key']}")
        cn = cn_ops.get(row["key"])
        tw = tw_ops.get(row["key"])
        slot = by_slug.setdefault(
            slug,
            {
                "id": slug,
                "name_en": row["name"],
                "name_zh": cn["name"] if cn else None,
                "name_tw": tw["name"] if tw else None,
                "rarity": row["rarity"],
                "class_key": row["class_key"],
                "element_key": row["element_key"],
                "keys": [],
            },
        )
        slot["keys"].append(row["key"])
        if cn and slot["name_zh"] and cn["name"] != slot["name_zh"]:
            raise SystemExit(f"cn name mismatch {slug}")
        if row["rarity"] != slot["rarity"] or row["class_key"] != slot["class_key"] or row["element_key"] != slot["element_key"]:
            raise SystemExit(f"official variant mismatch {slug}")
    if len(by_slug) != 34:
        raise SystemExit(f"expected 34 unique operators, got {len(by_slug)}")

    entries = fetch_json(ENTRY_LIST, {"game-alias": "zmd", "Accept": "application/json"})
    if entries.get("code") != 0:
        raise SystemExit(entries.get("msg"))
    by_name = {}
    for row in entries["data"]:
        if row.get("pid") != 202693 or row.get("name") in ("测试",):
            continue
        name = str(row.get("name") or "").strip()
        prev = by_name.get(name)
        if prev is None or (row.get("type") == 3 and prev.get("type") != 3):
            by_name[name] = row

    class_map = {}
    element_map = {}
    parsed_gk = {}
    for slug, op in by_slug.items():
        entry = by_name.get(op["name_zh"])
        if not entry:
            continue
        cid = entry["content_id"]
        cache = CACHE / f"{cid}.json"
        if cache.exists():
            detail = json.loads(cache.read_text(encoding="utf-8"))
        else:
            detail = fetch_json(
                f"{GK}/v1/content/detail/{cid}",
                {"game-alias": "zmd", "Accept": "application/json", "Referer": f"{GK}/"},
            )["data"]
            cache.write_text(json.dumps(detail, ensure_ascii=False), encoding="utf-8")
            time.sleep(0.15)
        parsed = parse_gamekee(detail.get("content_json") or "{}")
        parsed["entry"] = entry
        parsed["updated_at"] = detail.get("updated_at")
        parsed_gk[slug] = parsed
        role = parsed["meta"].get("role")
        element = parsed["meta"].get("element")
        if role and op["class_key"]:
            class_map.setdefault(op["class_key"], set()).add(role)
        if element and op["element_key"]:
            element_map.setdefault(op["element_key"], set()).add(element)
    class_zh = {key: next(iter(vals)) for key, vals in class_map.items() if len(vals) == 1}
    element_zh = {key: next(iter(vals)) for key, vals in element_map.items() if len(vals) == 1}

    en_to_id = {op["name_en"]: slug for slug, op in by_slug.items()}
    id_to_zh = {slug: op["name_zh"] for slug, op in by_slug.items()}
    pry = {}
    for path in PRY_DIR.glob("*.txt"):
        text = path.read_text(encoding="utf-8", errors="replace")
        pry[path.stem] = text

    weapon_en_to_zh = {}
    for slug, op in by_slug.items():
        gk = parsed_gk.get(slug)
        text = pry.get(slug, "")
        facts = intro_facts(text, op["name_en"]) if text else None
        zh = ((gk or {}).get("meta") or {}).get("weapon")
        if facts and zh:
            weapon_en_to_zh.setdefault(facts["weapon_en"], set()).add(zh)
    weapon_zh = {key: next(iter(vals)) for key, vals in weapon_en_to_zh.items() if len(vals) == 1}

    bwiki_liino = bwiki_operator("梨诺") or {}
    bwiki_arcane = bwiki_operator("李织烟") or {}

    cards = {}
    for slug, op in by_slug.items():
        gk = parsed_gk.get(slug)
        text = pry.get(slug, "")
        pry_url = f"https://www.prydwen.gg/arknights-endfield/characters/{slug}"
        gk_url = f"{GK}/zmd/{gk['entry']['content_id']}.html" if gk else None
        sources = [OFFICIAL_CN, OFFICIAL_EN]
        if gk_url:
            sources.append(gk_url)
        if text:
            sources.append(pry_url)
        role = (gk or {}).get("meta", {}).get("role") or class_zh.get(op["class_key"])
        element = (gk or {}).get("meta", {}).get("element") or element_zh.get(op["element_key"])
        weapon = (gk or {}).get("meta", {}).get("weapon")
        rarity_n = op["rarity"]
        if gk and gk["meta"].get("rarity") and gk["meta"]["rarity"].rstrip("星") != str(rarity_n):
            raise SystemExit(f"rarity mismatch {slug}: official {rarity_n} gamekee {gk['meta']['rarity']}")
        skills = list((gk or {}).get("skills") or [])
        attributes = None
        if gk and gk.get("attributes") and gk["attributes"]["level_90_and_1"]:
            attributes = {
                "primary": gk["attributes"]["primary"],
                "secondary": gk["attributes"]["secondary"],
                "stats": gk["attributes"]["level_90_and_1"],
                "source": gk_url,
                "as_of": AS_OF,
                "note": "数值取 GameKee 图鉴各属性「数值」行的 Lv.1 与最后一列（表头为 Lv.90）。主/副来自该行的「主」「副」单元格。",
            }
        note_bits = []
        if slug == "endministrator":
            note_bits.append("官网干员列表有 endministrator1 与 endministrator2 两张立绘，职业、属性、星级相同，收成一张干员卡。")
        if slug == "arcane":
            redir = (bwiki_arcane or {}).get("redirect")
            if redir:
                note_bits.append(f"BWIKI 页面「李织烟」重定向到「{redir}」。官网中文名是诀，英文名是 Arcane，列表 key 为 lizhiyan。")
                sources.append("https://wiki.biligame.com/zmd/%E6%9D%8E%E7%BB%87%E7%83%9F")
        if slug == "liino" and bwiki_liino and not bwiki_liino.get("redirect"):
            sources.append("https://wiki.biligame.com/zmd/%E6%A2%A8%E8%AF%BA")
            if not weapon and bwiki_liino.get("武器"):
                weapon = bwiki_liino["武器"]
            if not role and bwiki_liino.get("职业"):
                role = bwiki_liino["职业"]
            if not element and bwiki_liino.get("属性"):
                element = bwiki_liino["属性"]
            note_bits.append("BWIKI「梨诺」模板的技能栏是空的，技能不从该页补。")
        if not skills and text:
            skills = parse_prydwen_skills(text)
            facts = intro_facts(text, op["name_en"])
            if facts and not weapon:
                weapon = weapon_zh.get(facts["weapon_en"], facts["weapon_en"])
            level90 = parse_level90(text)
            if level90 and not attributes:
                attributes = {
                    "level": 90,
                    "stats": level90,
                    "source": pry_url,
                    "as_of": page_date(text) or AS_OF,
                    "note": "只收录 Prydwen Attributes (level 90) 里写出的四项数字。页面没有在文本里标出主属性/副属性颜色，不补。",
                }
        if not skills:
            note_bits.append("官网干员页有身份。GameKee 图鉴和已抓到的 Prydwen 角色页都没有技能正文。")
        aliases = []
        if op.get("name_tw") and op["name_tw"] != op["name_zh"]:
            aliases.append(op["name_tw"])
        if slug == "arcane":
            aliases.append("李织烟")
        card = {
            "id": slug,
            "name": op["name_zh"] or op["name_en"],
            "name_zh": op["name_zh"],
            "name_en": op["name_en"],
            "aliases": aliases,
            "nicknames": [],
            "game": "arknights-endfield",
            "role": role,
            "rarity": f"{rarity_n}星",
            "element": element,
            "weapon": weapon,
            "skills": skills,
            "skill_prio": [],
            "attributes": attributes,
            "teams": {},
            "sources": sources,
            "stub": not bool(skills),
            "as_of": AS_OF,
            "official_keys": op["keys"],
            "prydwen_slug": slug,
        }
        if gk:
            card["gamekee_content_id"] = gk["entry"]["content_id"]
            card["gamekee_entry_id"] = gk["entry"]["id"]
            icon = https_url(gk["entry"].get("icon"))
            if portrait_ok(icon):
                card["portrait"] = icon
                card["portrait_source"] = ENTRY_LIST
                card["portrait_via"] = f"gamekee-entry-icon:zmd:{gk['entry']['id']}"
        if "portrait" not in card:
            pry_img = f"https://cdn.prydwen.gg/images/arknights-endfield/characters/{slug}_card.webp"
            if portrait_ok(pry_img):
                card["portrait"] = pry_img
                card["portrait_source"] = pry_url
                card["portrait_via"] = f"prydwen-character:{slug}"
                if pry_url not in card["sources"]:
                    card["sources"].append(pry_url)
            else:
                card["portrait"] = None
                card["portrait_source"] = None
                card["portrait_via"] = None
        tier = parse_tier(text) if text else None
        updated = page_date(text) if text else None
        prio = parse_prio(text) if text else []
        if slug in OVERLAY and not text:
            extra = OVERLAY[slug]
            tier = {"role": None, "tier": extra["tier"]}
            updated = extra["updated"]
            prio = extra["prio"]
            if pry_url not in card["sources"]:
                card["sources"].append(pry_url)
        card["skill_prio"] = prio
        position = " / ".join(bit for bit in (card["rarity"], card["role"], card["element"], card["weapon"]) if bit)
        if tier:
            role_bit = f"{tier['role']} " if tier.get("role") else ""
            card["ratings"] = {
                "checked": True,
                "as_of": updated or AS_OF,
                "url": pry_url,
                "umbral_monument": tier["tier"],
                "role": tier.get("role"),
            }
            card["summary"] = {
                "tier": f"Prydwen Umbral Monument {role_bit}{tier['tier']}".replace("  ", " "),
                "position": position,
                "stub": False,
                "caveat": f"档位是 Prydwen 角色页 Gallery/Ratings 里紧挨 Umbral Monument 的字母。页面 Last updated {updated or '未见日期'}。评审向，非官方。不把装备或武器条目里的 T 级当成角色档。",
                "sources": [pry_url] + ([gk_url] if gk_url else [OFFICIAL_CN]),
            }
        elif card["stub"]:
            card["summary"] = {
                "position": position,
                "stub": True,
                "caveat": "身份来自官网干员列表。技能正文未见可靠出处，不写强度档。",
                "sources": [OFFICIAL_CN, OFFICIAL_EN],
            }
        else:
            card["summary"] = {
                "position": position,
                "stub": True,
                "caveat": "技能和属性有图鉴或角色页出处。该页没有紧挨 Umbral Monument 的档位字母，不写强度档。",
                "sources": [u for u in (gk_url, pry_url, OFFICIAL_CN) if u],
            }
        if note_bits:
            card["note"] = " ".join(note_bits)
        verified = []
        if gk_url:
            verified.append(f"GameKee zmd/{gk['entry']['content_id']}")
        verified.append("官网干员列表")
        if text or slug in OVERLAY:
            verified.append(f"Prydwen /characters/{slug}")
        card["verified"] = "；".join(verified)
        cards[slug] = card

    # Teams after every card exists.
    for slug, text in pry.items():
        if slug not in cards:
            continue
        updated = page_date(text) or AS_OF
        url = f"https://www.prydwen.gg/arknights-endfield/characters/{slug}"
        for number, ids in teams_from_text(text, en_to_id):
            add_team(cards, number, ids, url, updated, id_to_zh, f"{cards[slug]['name_en']} · Team #{number}")
    for slug, extra in OVERLAY.items():
        url = f"https://www.prydwen.gg/arknights-endfield/characters/{slug}"
        for number, names in enumerate(extra["teams"], 1):
            ids = []
            ok = True
            for name in names:
                cid = en_to_id.get(name)
                if not cid or cid in ids:
                    ok = False
                    break
                ids.append(cid)
            if ok and len(ids) == 4:
                add_team(cards, number, ids, url, extra["updated"], id_to_zh, f"{by_slug[slug]['name_en']} · Team #{number}")

    CHAR_DIR.mkdir(parents=True, exist_ok=True)
    aliases = {}
    for slug, card in cards.items():
        write_json(CHAR_DIR / f"{slug}.json", card)
        for key in (slug, card["name_zh"], card["name_en"], *(card.get("aliases") or [])):
            if key and key not in aliases:
                aliases[key] = {"id": slug, "name": card["name_zh"] or card["name"], "kind": "character"}
    alias_doc = {
        "_meta": {
            "game": "arknights-endfield",
            "as_of": AS_OF,
            "note": "官网中英名、繁中名（与简体不同时）和 BWIKI 重定向。不编外号。",
        },
        "aliases": aliases,
    }
    write_json(GUIDE / "aliases.json", alias_doc)
    write_banners()
    write_codes()
    publish(cards, alias_doc)
    rich = sum(1 for c in cards.values() if not c["stub"])
    stub = sum(1 for c in cards.values() if c["stub"])
    conclusion_stub = sum(1 for c in cards.values() if not c["stub"] and c.get("summary", {}).get("stub"))
    teamed = sum(1 for c in cards.values() if c.get("teams", {}).get("comp"))
    print(json.dumps({"cards": len(cards), "rich": rich, "stub": stub, "conclusion_stub": conclusion_stub, "with_teams": teamed, "class_map": class_zh, "element_map": element_zh}, ensure_ascii=False, indent=2))


def add_team(cards, number, ids, url, updated, id_to_zh, label):
    names = [id_to_zh[i] for i in ids]
    line = f"Prydwen · {label}：{' / '.join(names)}（{url} ，as_of {updated}）"
    for cid in ids:
        comp = cards[cid].setdefault("teams", {}).setdefault("comp", [])
        if line not in comp:
            comp.append(line)
        if url not in cards[cid]["sources"]:
            cards[cid]["sources"].append(url)
        summary = cards[cid].get("summary")
        if summary and url not in summary.get("sources", []):
            summary["sources"].append(url)


def article_text(cid):
    data = fetch_json(f"{NEWS_API}/{cid}?lang=en-us&code=arknights_endfield_official")
    html = data["data"]["data"]
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return unescape(re.sub(r"[ \t]+", " ", text))


def write_banners():
    notes = article_text("9560")
    headhunt = article_text("4489")
    lto = article_text("2652")
    prev = article_text("3839")
    if "Sanctuary of Ink" not in notes or "Si" not in headhunt:
        raise SystemExit("banner articles did not contain the expected titles")
    common = {
        "timezone": None,
        "timezone_note": "公告写 server time。3839 写明 Asia Server Time Zone: UTC+8，Americas / Europe Server Time Zone: UTC-5。不把两套服务器时间收成一个偏移。",
        "as_of": AS_OF,
    }
    banners = [
        {
            "id": "endfield-rejuvenation-si",
            "name": "[Rejuvenation] Chartered Headhunting",
            "name_zh": "特许寻访 Rejuvenation",
            "kind": "chartered_headhunting",
            "status": "current",
            "up": ["Si"],
            "up_characters": [{"id": "si", "name": "祀", "label": "Si"}],
            "start_text": "After [Sanctuary of Ink] version update",
            "end_text": "Nov. 5, 2026 at 11:59 (server time)",
            "start": "2026-10-15",
            "end": None,
            "source": f"{NEWS}/4489",
            "note": "4489 与 9560 都写 Rate-UP 6★ operator [Si]。开始日取 9560 的 Asia Server 维护日 Oct. 15, 2026（UTC+8）；结束钟点公告只写 server time。",
            **common,
        },
        {
            "id": "endfield-seal-of-jade",
            "name": "[Seal of Jade Issue] Arsenal Issue",
            "kind": "arsenal_issue",
            "status": "current",
            "up": ["Jade Vessel (Greatsword)"],
            "up_characters": [],
            "start_text": "Opens after [Sanctuary of Ink] version update",
            "end_text": "ends after 3 [Chartered Headhunting] banners (starting from [Rejuvenation])",
            "start": "2026-10-15",
            "end": None,
            "source": f"{NEWS}/2652",
            "note": "武器池，Rate-UP 是 6★ weapon，不是干员。结束条件公告没有写成钟点。",
            **common,
        },
        {
            "id": "endfield-ancestral-spring-tangtang",
            "name": "[Ancestral Spring Flows Anew] RE-Factor Headhunting #1",
            "kind": "refactor_headhunting",
            "status": "upcoming",
            "up": ["Tangtang"],
            "up_characters": [{"id": "tangtang", "name": "汤汤", "label": "Tangtang"}],
            "start_text": "Oct. 29, 2026 at 12:00 (server time)",
            "end_text": "Nov. 19, 2026 at 11:59 (server time)",
            "start": None,
            "end": None,
            "source": f"{NEWS}/9560",
            "note": "写在 9560 的 New Headhunting 第 3 条。核对日 2026-10-17 还没到开始日，标 upcoming。",
            **common,
        },
        {
            "id": "endfield-tender-sprig",
            "name": "[Tender Sprig Issue] RE-Factor Issue #1",
            "kind": "refactor_issue",
            "status": "upcoming",
            "up": ["Brigand's Calling (Handcannon)"],
            "up_characters": [],
            "start_text": "Oct. 29, 2026 at 12:00 (server time)",
            "end_text": "Nov. 19, 2026 at 11:59 (server time)",
            "start": None,
            "end": None,
            "source": f"{NEWS}/9560",
            "note": "武器池。写在 9560 的 New Headhunting 第 4 条。",
            **common,
        },
        {
            "id": "endfield-resplendent-yvonne",
            "name": "[Resplendent Spectrum] RE-Factor Headhunting #1",
            "kind": "refactor_headhunting",
            "status": "ended",
            "up": ["Yvonne"],
            "up_characters": [{"id": "yvonne", "name": "伊冯", "label": "Yvonne"}],
            "start_text": "Sept. 24, 2026 at 12:00 (server time)",
            "end_text": "Before version update and maintenance",
            "start": None,
            "end": "2026-10-15",
            "source": f"{NEWS}/3839",
            "note": "3839 写结束于 version update and maintenance。9560 的 Asia Server 维护从 Oct. 15, 2026 at 06:00 (UTC+8) 开始。",
            **common,
        },
        {
            "id": "endfield-tag-artist",
            "name": "[Tag Artist Issue] RE-Factor Issue #1",
            "kind": "refactor_issue",
            "status": "ended",
            "up": ["Artzy Tyrannical (Handcannon)"],
            "up_characters": [],
            "start_text": "Sept. 24, 2026 at 12:00 (server time)",
            "end_text": "Before version update and maintenance",
            "start": None,
            "end": "2026-10-15",
            "source": f"{NEWS}/3839",
            "note": "与 Resplendent Spectrum 同一则公告的武器池。",
            **common,
        },
    ]
    # common dict was spread and also contains keys already set; timezone_note duplicated inside each banner via common, remove the file-level clash
    doc = {
        "game": "arknights-endfield",
        "as_of": AS_OF,
        "timezone_note": "当期和上一期寻访以官网公告为准。server time 同时对应 UTC+8（Asia）和 UTC-5（Americas / Europe），见 3839。不合成单一偏移。",
        "sources": [f"{NEWS}/9560", f"{NEWS}/4489", f"{NEWS}/2652", f"{NEWS}/3839"],
        "version": {
            "name": "[Sanctuary of Ink]",
            "maintenance_asia": "Oct. 15, 2026 at 06:00 – Oct. 15, 2026 at 12:00 (UTC+8)",
            "maintenance_americas_europe": "Oct. 14, 2026 at 17:00 – Oct. 14, 2026 at 23:00 (UTC-5)",
            "source": f"{NEWS}/9560",
            "note": "9560 没有写出数字版本号 1.6。Prydwen 角色页的 Update tracker 把同期评审写成 Patch 1.6。",
        },
        "banners": banners,
    }
    write_json(GUIDE / "banners.json", doc)


def table_rows(node, acc):
    if isinstance(node, dict):
        if node.get("type") == "table-row":
            cells = []
            for cell in node.get("children") or []:
                bits = []

                def walk(n):
                    if isinstance(n, dict):
                        if isinstance(n.get("text"), str) and n["text"].strip():
                            bits.append(n["text"].strip())
                        for ch in n.get("children") or []:
                            walk(ch)
                    elif isinstance(n, list):
                        for item in n:
                            walk(item)

                walk(cell)
                cells.append("".join(bits))
            acc.append(cells)
        for child in node.get("children") or []:
            table_rows(child, acc)
    elif isinstance(node, list):
        for item in node:
            table_rows(item, acc)


def write_codes():
    detail = fetch_json(
        f"{GK}/v1/content/detail/691172",
        {"game-alias": "zmd", "Accept": "application/json", "Referer": f"{GK}/"},
    )["data"]
    rows = []
    table_rows(json.loads(detail["content_json"]), rows)
    gk_url = f"{GK}/zmd/691172.html"
    updated = datetime.fromtimestamp(int(detail["updated_at"]), timezone.utc).date().isoformat()
    codes = []
    for cells in rows[1:]:
        if len(cells) < 3 or not cells[0] or cells[0] == "兑换码":
            continue
        codes.append(
            {
                "code": cells[0],
                "rewards": cells[1],
                "expires": None,
                "expires_text": None,
                "timezone": None,
                "status": "expired" if cells[2] == "已过期" else "expiry_not_stated",
                "note": f"GameKee 表格「是否过期」单元格写「{cells[2]}」。该页 updated_at 的 UTC 日期是 {updated}。",
                "source": gk_url,
                "checked": AS_OF,
            }
        )
    bwiki_cache = CACHE / "bwiki-codes.wiki"
    try:
        bwiki = fetch_json(
            "https://wiki.biligame.com/zmd/api.php?"
            + urllib.parse.urlencode({"action": "parse", "page": "兑换码", "prop": "wikitext", "format": "json"})
        )["parse"]["wikitext"]["*"]
        bwiki_cache.write_text(bwiki, encoding="utf-8")
    except Exception:
        if not bwiki_cache.exists():
            raise
        bwiki = bwiki_cache.read_text(encoding="utf-8")
    bwiki_url = "https://wiki.biligame.com/zmd/%E5%85%91%E6%8D%A2%E7%A0%81"
    bwiki_rows = []
    for match in re.finditer(r"'''([^']+)'''(.*?)(?=''')", bwiki + "'''", re.S):
        code = match.group(1).strip()
        block = re.sub(r"<br\s*/?>", " ", match.group(2), flags=re.I)
        window = re.search(r"兑换时间：''\s*([^'\n]+)", block)
        reward = re.search(r"奖励：''\s*([^'\n]+)", block)
        bwiki_rows.append(
            {
                "code": code,
                "rewards": reward.group(1).strip() if reward else None,
                "window": window.group(1).strip() if window else None,
                "pc_only": "仅限电脑端" in block,
            }
        )
    known = {row["code"] for row in codes}
    for row in bwiki_rows:
        if row["code"] in known:
            for existing in codes:
                if existing["code"] == row["code"] and row["window"]:
                    existing["expires_text"] = row["window"]
                    existing["note"] += f" BWIKI 同一码写兑换时间「{row['window']}」，没有年份和时区。"
            continue
        note = "BWIKI 原文。GameKee 表里没有这串字符。"
        if row["pc_only"]:
            note += " 仅限电脑端。"
        note += " 兑换时间没有写年份和时区，不换算成绝对时间。"
        codes.append(
            {
                "code": row["code"],
                "rewards": row["rewards"],
                "expires": None,
                "expires_text": row["window"],
                "timezone": None,
                "status": "window_stated_without_year",
                "note": note,
                "source": bwiki_url,
                "checked": AS_OF,
            }
        )
    doc = {
        "game": "arknights-endfield",
        "as_of": AS_OF,
        "checked": AS_OF,
        "timezone_note": "GameKee 过期单元格和 BWIKI 兑换时间都没有时区。BWIKI 的 1/22–1/29 没有年份。不把两页拼成同一个码的有效期。",
        "sources": [gk_url, bwiki_url],
        "note": "GameKee 页标题写「可用的兑换码」，表内单元格写「已过期」。BWIKI 另有一串码，其中 RETURENOFALL 与 GameKee 的 RETURNOFALL 差一个字母，两边都按原文保留。本文件没有在游戏内兑换。",
        "codes": codes,
    }
    write_json(GUIDE / "codes.json", doc)


def publish(cards, alias_doc):
    out_v1 = SITE / "v1" / "guides" / "arknights-endfield"
    out_html = SITE / "guides" / "arknights-endfield"
    (out_v1 / "characters").mkdir(parents=True, exist_ok=True)
    out_html.mkdir(parents=True, exist_ok=True)
    for name in ("aliases.json", "banners.json", "codes.json"):
        raw = json.loads((GUIDE / name).read_text(encoding="utf-8"))
        write_json(out_v1 / name, raw)
    index_chars = []
    for slug in sorted(cards):
        card = cards[slug]
        write_json(out_v1 / "characters" / f"{slug}.json", card)
        index_chars.append(
            {
                "id": card["id"],
                "name": card["name"],
                "name_zh": card["name_zh"] or card["name"],
                "stub": card["stub"],
                "sources": card["sources"],
                "portrait": card.get("portrait"),
            }
        )
        skills = "".join(
            f"<li><strong>{esc(s['name'])}</strong> <code>{esc(s['type'])}</code> — {esc(s['summary'])}</li>"
            for s in card["skills"]
        )
        sources = "".join(f'<li><a href="{esc(u)}">{esc(u)}</a></li>' for u in card["sources"])
        teams = "".join(f"<li>{esc(line)}</li>" for line in card.get("teams", {}).get("comp") or [])
        body = f"""<p><a href="/">首页</a> · <a href="/watchlist/">关注</a> · <a href="/character/?game=arknights-endfield&amp;id={esc(slug)}">人类界面</a> · <a href="./index.html">← 明日方舟：终末地</a></p>
<h1>{esc(card['name'])} <code>{esc(slug)}</code></h1>
<p class="{'stub' if card['stub'] else 'rich'}">{'stub card — skills not verified yet' if card['stub'] else 'verified card'}</p>
{f"<p>定位：{esc(card['role'])}</p>" if card.get('role') else ""}
<h2>技能</h2>
{f"<ul>{skills}</ul>" if skills else "<p class='stub'>（无 — 勿编造）</p>"}
{f"<h2>加点优先级</h2><ul>{''.join(f'<li>{esc(x)}</li>' for x in card['skill_prio'])}</ul>" if card['skill_prio'] else ""}
{f"<h2>配队</h2><ul>{teams}</ul>" if teams else ""}
<h2>来源</h2>
<ul>{sources}</ul>
<p class="meta">JSON: <a href="/v1/guides/arknights-endfield/characters/{esc(slug)}.json"><code>/v1/guides/arknights-endfield/characters/{esc(slug)}.json</code></a></p>"""
        (out_html / f"{slug}.html").write_text(html_page(f"{card['name']} · 明日方舟：终末地", body), encoding="utf-8")
    rich = sum(1 for c in cards.values() if not c["stub"])
    stub = sum(1 for c in cards.values() if c["stub"])
    game_index = {
        "game": "arknights-endfield",
        "name": "Arknights: Endfield",
        "name_zh": "明日方舟：终末地",
        "as_of": AS_OF,
        "timezone": TZ,
        "character_count": len(cards),
        "rich_count": rich,
        "stub_count": stub,
        "conclusion_stub_count": sum(1 for c in cards.values() if not c["stub"] and c.get("summary", {}).get("stub") is True),
        "links": {
            "banners": "/v1/guides/arknights-endfield/banners.json",
            "codes": "/v1/guides/arknights-endfield/codes.json",
        },
        "characters": index_chars,
    }
    write_json(out_v1 / "index.json", game_index)
    rows = "".join(
        f'<tr><td><a href="{esc(c["id"])}.html">{esc(c["id"])}</a></td><td>{esc(c["name"])}</td><td class="{"stub" if c["stub"] else "rich"}">{"stub" if c["stub"] else "rich"}</td></tr>'
        for c in index_chars
    )
    (out_html / "index.html").write_text(
        html_page(
            "明日方舟：终末地 攻略索引",
            f"""<h1>明日方舟：终末地 <span class="meta">(Arknights: Endfield)</span></h1>
<p class="meta">as_of {AS_OF} · {len(cards)} characters · rich {rich} / stub {stub}</p>
<p>AI JSON: <a href="/v1/guides/arknights-endfield/index.json"><code>/v1/guides/arknights-endfield/index.json</code></a> · <a href="/v1/guides/arknights-endfield/banners.json"><code>banners.json</code></a> · <a href="/v1/guides/arknights-endfield/codes.json"><code>codes.json</code></a></p>
<table><thead><tr><th>id</th><th>name</th><th>status</th></tr></thead><tbody>
{rows}
</tbody></table>""",
        ),
        encoding="utf-8",
    )
    summary = {
        "id": "arknights-endfield",
        "name": "Arknights: Endfield",
        "name_zh": "明日方舟：终末地",
        "character_count": len(cards),
        "rich_count": rich,
        "stub_count": stub,
        "path": "guides/arknights-endfield",
    }
    for index_path in (DATA / "guides" / "index.json", SITE / "v1" / "guides" / "index.json"):
        index = json.loads(index_path.read_text(encoding="utf-8"))
        games = [g for g in index.get("games", []) if g.get("id") != "arknights-endfield"]
        games.append(summary)
        games.sort(key=lambda g: g["id"])
        index["games"] = games
        write_json(index_path, index)
    html_index = SITE / "guides" / "index.html"
    if html_index.exists():
        html = html_index.read_text(encoding="utf-8")
        item = f'<li><a href="./arknights-endfield/index.html"><strong>明日方舟：终末地</strong></a> (arknights-endfield) — {len(cards)} chars (rich {rich} / stub {stub})</li>'
        if "arknights-endfield/index.html" not in html:
            html = html.replace("</ul>", item + "\n</ul>", 1)
            html_index.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    main()
