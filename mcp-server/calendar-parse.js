/**
 * Pure calendar date/type parsers (no MCP / network).
 * Used by index.js and unit-testable in isolation.
 */

/** Asia/Shanghai calendar year/month/day for defaulting undated ranges. */
export function shanghaiYmd(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

export const EN_MONTH_MAP = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

export const EN_MONTH_ALT =
  "January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sept\\.?|Sep\\.?|Oct\\.?|Nov\\.?|Dec\\.?";

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function toYmd(y, m, d) {
  const yy = Number(y);
  const mm = Number(m);
  const dd = Number(d);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) {
    return null;
  }
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${pad2(mm)}-${pad2(dd)}`;
}

/** Last calendar day of month (1–12). */
export function lastDayOfMonth(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null;
  // Day 0 of next month = last day of m
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function defaultEventYear(month, explicitYear) {
  if (explicitYear) return explicitYear;
  const now = shanghaiYmd();
  return now.year;
}

/** Shanghai YMD string for "today". */
export function shanghaiTodayYmd(d = new Date()) {
  const sh = shanghaiYmd(d);
  return toYmd(sh.year, sh.month, sh.day);
}

/** Shanghai YMD string for tomorrow (calendar day in Asia/Shanghai). */
export function shanghaiTomorrowYmd(d = new Date()) {
  const sh = shanghaiYmd(d);
  const utcNoon = Date.UTC(sh.year, sh.month - 1, sh.day, 4, 0, 0); // ~12:00 CST
  const next = shanghaiYmd(new Date(utcNoon + 86400000));
  return toYmd(next.year, next.month, next.day);
}

/**
 * Relative day phrases in Asia/Shanghai.
 * Only fills start when absolute dates are absent.
 * 本週/本周 alone does NOT invent a date.
 */
export function applyRelativeDayPhrases(text, dates = {}) {
  let { start = null, end = null } = dates;
  if (start || end) return { start, end };
  const raw = String(text || "");
  if (!raw.trim()) return { start: null, end: null };

  // today / 今日上線 — do NOT invent dates from 本週/本周 alone
  if (/今日上線|今日上线|今天|本日|今日|\btoday\b/i.test(raw)) {
    return { start: shanghaiTodayYmd(), end: null };
  }
  if (/明天|明日|\btomorrow\b/i.test(raw)) {
    return { start: shanghaiTomorrowYmd(), end: null };
  }
  return { start: null, end: null };
}

/**
 * Parse CN/EN/JP/KR date tokens + ranges + relative day phrases.
 * Returns { start, end, precision?: 'month' }.
 * Day-level hits win over month-only (YYYY-MM-01 … last day).
 * Month-only keeps precision:'month' so callers can keep confidence low.
 */
export function parseDatesFromText(text) {
  let raw = String(text || "");
  if (!raw.trim()) return { start: null, end: null };

  // Drop parenthetical "last updated" stamps — not event windows
  raw = raw.replace(
    /[（(][^）)]{0,24}?(?:更新|updated|update)[^）)]{0,8}[）)]/gi,
    " "
  );

  const hits = [];

  const pushHit = (y, m, d, idx, len, rawStr) => {
    const mm = Number(m);
    const dd = Number(d);
    if (!Number.isFinite(mm) || !Number.isFinite(dd)) return;
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return;
    const yy = y != null && y !== "" ? Number(y) : null;
    hits.push({
      y: Number.isFinite(yy) ? yy : null,
      m: mm,
      d: dd,
      idx: idx ?? 0,
      len: len ?? 0,
      raw: rawStr || "",
    });
  };

  for (const m of raw.matchAll(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/g)) {
    pushHit(m[1], m[2], m[3], m.index, m[0].length, m[0]);
  }

  for (const m of raw.matchAll(
    /(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号號]/g
  )) {
    pushHit(m[1] || null, m[2], m[3], m.index, m[0].length, m[0]);
  }

  for (const m of raw.matchAll(
    /(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g
  )) {
    pushHit(m[1] || null, m[2], m[3], m.index, m[0].length, m[0]);
  }

  const enRe = new RegExp(
    `\\b(${EN_MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(20\\d{2}))?\\b`,
    "gi"
  );
  for (const m of raw.matchAll(enRe)) {
    const mon = EN_MONTH_MAP[String(m[1]).toLowerCase().replace(/\./g, "")];
    if (!mon) continue;
    pushHit(m[3] || null, mon, m[2], m.index, m[0].length, m[0]);
  }

  for (const m of raw.matchAll(/\b(\d{1,2})[\/\-](\d{1,2})(?!\d)(?![\/\-]\d)/g)) {
    const idx = m.index ?? 0;
    const covered = hits.some(
      (h) => idx >= h.idx && idx < h.idx + Math.max(h.len, 1)
    );
    if (covered) continue;
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
    pushHit(null, mm, dd, idx, m[0].length, m[0]);
  }

  hits.sort((a, b) => a.idx - b.idx || a.len - b.len);

  const hitToYmd = (h) => {
    if (!h) return null;
    return toYmd(defaultEventYear(h.m, h.y), h.m, h.d);
  };

  let start = null;
  let end = null;

  const untilRe = /\b(?:until|till|through|截止|至|到)\s+/i;
  const fromToRe = /\bfrom\b[\s\S]{0,40}?\bto\b/i;

  if (hits.length >= 2) {
    start = hitToYmd(hits[0]);
    end = hitToYmd(hits[hits.length - 1]);
    if (start && end && start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    if (start && end && start === end) end = null;
  } else if (hits.length === 1) {
    const h = hits[0];
    const ymd = hitToYmd(h);
    const before = raw.slice(Math.max(0, h.idx - 12), h.idx);
    if (untilRe.test(before) || /\buntil\b/i.test(raw.slice(0, h.idx))) {
      start = null;
      end = ymd;
    } else {
      start = ymd;
      end = null;
    }
  }

  const rangeRe =
    /\b(\d{1,2})[\/\-](\d{1,2})\s*[-–—~～〜]\s*(\d{1,2})[\/\-](\d{1,2})\b/;
  const rm = raw.match(rangeRe);
  if (rm) {
    start = toYmd(defaultEventYear(Number(rm[1]), null), rm[1], rm[2]);
    end = toYmd(defaultEventYear(Number(rm[3]), null), rm[3], rm[4]);
  }

  void fromToRe;

  // Absolute day-level window wins — do not fall through to month-only
  if (start || end) {
    return { start, end };
  }

  // Month-only: EN "September 2026" / "Sept. 2026" / "in September 2026" / "September, 2026"
  // CN "2026年9月" (no day); KR "2026년 9월" (no 일)
  const monthHits = [];
  const pushMonth = (y, m, idx, len, rawStr) => {
    const yy = Number(y);
    const mm = Number(m);
    if (!Number.isFinite(yy) || !Number.isFinite(mm)) return;
    if (mm < 1 || mm > 12) return;
    const last = lastDayOfMonth(yy, mm);
    if (!last) return;
    monthHits.push({
      y: yy,
      m: mm,
      start: toYmd(yy, mm, 1),
      end: toYmd(yy, mm, last),
      idx: idx ?? 0,
      len: len ?? 0,
      raw: rawStr || "",
    });
  };

  const enMonthOnly = new RegExp(
    `(?:\\bin\\s+)?(${EN_MONTH_ALT})\\s*,?\\s*(20\\d{2})\\b`,
    "gi"
  );
  for (const m of raw.matchAll(enMonthOnly)) {
    // Skip if this span is actually "Month Day, Year" (day-level already handled)
    const afterMonth = raw.slice(m.index + m[1].length, m.index + m[0].length);
    if (/^\s+\d{1,2}(?:st|nd|rd|th)?\b/i.test(afterMonth)) continue;
    const mon = EN_MONTH_MAP[String(m[1]).toLowerCase().replace(/\./g, "")];
    if (!mon) continue;
    pushMonth(m[2], mon, m.index, m[0].length, m[0]);
  }

  for (const m of raw.matchAll(
    /(20\d{2})\s*年\s*(\d{1,2})\s*月(?!\s*\d{1,2}\s*[日号號])/g
  )) {
    pushMonth(m[1], m[2], m.index, m[0].length, m[0]);
  }

  for (const m of raw.matchAll(
    /(20\d{2})\s*년\s*(\d{1,2})\s*월(?!\s*\d{1,2}\s*일)/g
  )) {
    pushMonth(m[1], m[2], m.index, m[0].length, m[0]);
  }

  monthHits.sort((a, b) => a.idx - b.idx || a.len - b.len);

  if (monthHits.length) {
    const first = monthHits[0];
    const last = monthHits[monthHits.length - 1];
    let mStart = first.start;
    let mEnd = last.end;
    if (mStart && mEnd && mStart > mEnd) {
      const tmp = mStart;
      mStart = mEnd;
      mEnd = tmp;
    }
    return { start: mStart, end: mEnd, precision: "month" };
  }

  // Relative day phrases only when no absolute window found
  return applyRelativeDayPhrases(raw, { start, end });
}

export function classifyEventType(text) {
  const t = String(text || "");
  if (/维护|維護|maintenance|点検|정기\s*점검/i.test(t)) return "maintenance";
  if (/联动|聯動|collab(?:oration)?|コラボ|persona\b/i.test(t)) {
    return "collab";
  }
  if (
    /卡池|招募|pickup|\bbanner\b|limited\s*recruit|한정\s*모집|ガチャ/i.test(t)
  ) {
    return "banner";
  }
  if (/登录|登錄|签到|簽到|\blogin\b|check-?in/i.test(t)) return "login";
  if (/活动|活動|\bevent\b|\bseason\b|시즌|イベント/i.test(t)) return "event";
  return "other";
}

function truncateLocal(s, n = 80) {
  const t = String(s || "");
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

export function stripDatesForNote(title) {
  let t = String(title || "");
  t = t.replace(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/g, " ");
  t = t.replace(/(?:20\d{2}\s*年\s*)?\d{1,2}\s*月\s*\d{1,2}\s*[日号號]/g, " ");
  t = t.replace(/(?:20\d{2}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ");
  t = t.replace(
    new RegExp(
      `\\b(${EN_MONTH_ALT})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s*20\\d{2})?\\b`,
      "gi"
    ),
    " "
  );
  // Month-only EN / CN / KR
  t = t.replace(
    new RegExp(`(?:\\bin\\s+)?(${EN_MONTH_ALT})\\s*,?\\s*20\\d{2}\\b`, "gi"),
    " "
  );
  t = t.replace(/20\d{2}\s*年\s*\d{1,2}\s*月/g, " ");
  t = t.replace(/20\d{2}\s*년\s*\d{1,2}\s*월/g, " ");
  t = t.replace(
    /\b\d{1,2}[\/\-]\d{1,2}(?:\s*[-–—~～〜]\s*\d{1,2}[\/\-]\d{1,2})?\b/g,
    " "
  );
  t = t.replace(/\b(?:from|to|until|till|through)\b/gi, " ");
  t = t.replace(/今日上線|今日上线|今天|本日|明日|明天|\btoday\b|\btomorrow\b/gi, " ");
  t = t.replace(/[-–—~～〜至到]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

export function buildEventNote(title, type) {
  const stripped = stripDatesForNote(title);
  if (stripped && stripped.length >= 3) return truncateLocal(stripped, 80);
  return truncateLocal(String(type || "event"), 80);
}

/** Typed calendar events preferred for body-fetch enrichment. */
export const TYPED_EVENT_RANK = {
  banner: 0,
  event: 1,
  maintenance: 2,
  collab: 3,
  login: 4,
  other: 5,
};

export function eventNeedsDateEnrichment(ev) {
  if (!ev) return false;
  // Lack both start and end (weak/null window)
  return !ev.start && !ev.end;
}

/**
 * Bump confidence when a solid day-level window exists.
 * Month-only ranges (precision:'month') stay **low** — do not promote blindly.
 */
export function bumpEventConfidence(ev) {
  if (!ev) return ev;
  if (ev.precision === "month") {
    ev.confidence = "low";
    return ev;
  }
  const hasTypeSignal = ev.type && ev.type !== "other";
  if (ev.start && ev.end) ev.confidence = "high";
  else if ((ev.start || ev.end) && hasTypeSignal) ev.confidence = "high";
  return ev;
}
