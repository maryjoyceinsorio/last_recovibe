// Client-side academic calendar parser + date helpers. No dependencies, no Firestore.
// All dates are plain "YYYY-MM-DD" strings in Asia/Manila (no timezone math, sortable, query-safe).

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const D = "(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)";
const Y = "(\\d{4})";
const SEP = "\\s*(?:-|to|until|through|thru)\\s*";

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const monthNum = (s) => MONTHS[s.toLowerCase().replace(".", "")];

function validDate(y, m, d) {
  if (!m || d < 1 || d > 31) return false;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Patterns tried in order; each returns {start:[y|null,m,d], end:[y|null,m,d]} and the matched text.
const PATTERNS = [
  // Aug 31 - Sep 4, 2025  |  August 31, 2025 - September 4, 2025
  { re: new RegExp(`${MONTH_RE}\\s+${D}(?:,?\\s*${Y})?${SEP}${MONTH_RE}\\s+${D}(?:,?\\s*${Y})?`, "i"),
    f: (m) => ({ start: [m[3] ? +m[3] : null, monthNum(m[1]), +m[2]], end: [m[6] ? +m[6] : null, monthNum(m[4]), +m[5]], yAfter: !!m[6] && !m[3] }) },
  // Aug 18-22, 2025
  { re: new RegExp(`${MONTH_RE}\\s+${D}${SEP}${D}(?:,?\\s*${Y})?`, "i"),
    f: (m) => ({ start: [m[4] ? +m[4] : null, monthNum(m[1]), +m[2]], end: [m[4] ? +m[4] : null, monthNum(m[1]), +m[3]] }) },
  // 18-22 August 2025
  { re: new RegExp(`${D}${SEP}${D}\\s+${MONTH_RE}(?:,?\\s*${Y})?`, "i"),
    f: (m) => ({ start: [m[4] ? +m[4] : null, monthNum(m[3]), +m[1]], end: [m[4] ? +m[4] : null, monthNum(m[3]), +m[2]] }) },
  // 31 August - 4 September 2025
  { re: new RegExp(`${D}\\s+${MONTH_RE}(?:,?\\s*${Y})?${SEP}${D}\\s+${MONTH_RE}(?:,?\\s*${Y})?`, "i"),
    f: (m) => ({ start: [m[3] ? +m[3] : null, monthNum(m[2]), +m[1]], end: [m[6] ? +m[6] : null, monthNum(m[5]), +m[4]], yAfter: !!m[6] && !m[3] }) },
  // M/D/YYYY - M/D/YYYY
  { re: /(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:-|to|until)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i,
    f: (m) => ({ start: [+m[3], +m[1], +m[2]], end: [+m[6], +m[4], +m[5]] }) },
  // August 18, 2025
  { re: new RegExp(`${MONTH_RE}\\s+${D}(?:,?\\s*${Y})?`, "i"),
    f: (m) => ({ start: [m[3] ? +m[3] : null, monthNum(m[1]), +m[2]], end: null }) },
  // 18 August 2025
  { re: new RegExp(`${D}\\s+${MONTH_RE}(?:,?\\s*${Y})?`, "i"),
    f: (m) => ({ start: [m[3] ? +m[3] : null, monthNum(m[2]), +m[1]], end: null }) },
  // M/D/YYYY
  { re: /(\d{1,2})\/(\d{1,2})\/(\d{4})/, f: (m) => ({ start: [+m[3], +m[1], +m[2]], end: null }) }
];

const CATEGORY_RULES = [
  ["holiday", /holiday|no classes|suspension|independence|heroes|all saints|all souls|christmas|new year|bonifacio|rizal|eid|good friday|maundy|araw ng|ninoy|edsa|labor day|bataan|valor/i],
  ["exam", /exam|midterm|finals?\b|examination/i],
  ["enrollment", /enroll|registration|add(?:ing)?\/?drop|adding|dropping|late reg/i],
  ["deadline", /deadline|last day|submission|clearance/i],
  ["break", /break|vacation|recess|semestral/i],
  ["graduation", /graduat|commencement|recognition|baccalaureate|moving[- ]up/i],
  ["classes", /classes|start of|opening of|orientation|first day|class (?:start|begin|resum)/i]
];
export function guessCategory(title) {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  return "other";
}

const WEEKDAYS = /\b(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b\.?,?/gi;

function tidyTitle(s) {
  return s
    .replace(WEEKDAYS, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/^\s*(?:[-\u2022*\u00b7]|\d+[.)])\s+/, "")
    .replace(/^[\s\-:|\u2022*\u00b7,;.]+|[\s\-:|\u2022*\u00b7,;]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function normalizeLine(line) {
  return line.replace(/[\u2013\u2014\u2212]/g, "-").replace(/\u00a0/g, " ").replace(/\t+/g, "  ").trim();
}

function resolveYears(r, opts) {
  const guess = (m) => (m >= opts.yearStartMonth ? opts.academicYear : opts.academicYear + 1);
  const [sy0, sm, sd] = r.start;
  if (!r.end) {
    const sy = sy0 ?? guess(sm);
    return { sy, sm, sd, ey: sy, em: sm, ed: sd };
  }
  const [ey0, em, ed] = r.end;
  let sy, ey;
  if (sy0 != null && ey0 != null) { sy = sy0; ey = ey0; }
  else if (sy0 != null) { sy = sy0; ey = em < sm ? sy + 1 : sy; }
  else if (ey0 != null) { ey = ey0; sy = em < sm ? ey - 1 : ey; }
  else { sy = guess(sm); ey = em < sm ? sy + 1 : sy; }
  return { sy, sm, sd, ey, em, ed };
}

/**
 * parseAcademicCalendar(text, { academicYear: 2025, yearStartMonth: 6, semesterLabel: "1st Semester AY 2025-2026" })
 * returns [{ title, startDate, endDate, category, raw, warnings: [] }]
 */
export function parseAcademicCalendar(text, opts = {}) {
  const academicYear = Number(opts.academicYear) || new Date().getFullYear();
  const options = { academicYear, yearStartMonth: opts.yearStartMonth ?? 6 };
  const lines = String(text || "").split(/\r?\n/).map(normalizeLine).filter(Boolean);

  const found = lines.map((line) => {
    for (const p of PATTERNS) {
      const m = p.re.exec(line);
      if (m) return { line, match: m, p, text: m[0] };
    }
    return { line, match: null };
  });

  const out = [];
  let pendingTitle = "";
  for (let i = 0; i < found.length; i++) {
    const f = found[i];
    if (!f.match) {
      // title-only line: may belong to the next date-only line
      pendingTitle = pendingTitle ? `${pendingTitle} ${f.line}` : f.line;
      continue;
    }
    const raw = f.line;
    const r = f.p.f(f.match);
    const { sy, sm, sd, ey, em, ed } = resolveYears(r, options);
    const warnings = [];
    let title = tidyTitle(f.line.replace(f.text, " "));
    if (!title && pendingTitle) title = tidyTitle(pendingTitle);
    pendingTitle = "";
    if (!title) {
      // date-only line: take the next non-date line as the title
      const next = found[i + 1];
      if (next && !next.match) { title = tidyTitle(next.line); i++; }
    }
    if (!validDate(sy, sm, sd) || !validDate(ey, em, ed)) {
      warnings.push("Could not read this date");
    }
    let startDate = ymd(sy, sm, sd);
    let endDate = ymd(ey, em, ed);
    if (endDate < startDate) { warnings.push("End date was before start date; please check"); }
    if (!title) { warnings.push("No title found"); title = "(untitled)"; }
    out.push({ title, startDate, endDate, category: guessCategory(title), raw, warnings });
  }
  return out;
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Deterministic id so re-importing the same semester overwrites instead of duplicating. */
export function entryId(semesterId, e) {
  return `${slug(semesterId)}_${e.startDate}_${slug(e.title)}`;
}

/** Today in Asia/Manila as YYYY-MM-DD. */
export function todayManila(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const dayNum = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);

/** -> { stage: "ongoing" | "upcoming" | null, daysUntil, daysLeft } */
export function calendarAlertFor(entry, today = todayManila(), windowDays = 7) {
  if (!entry || !entry.startDate || !entry.endDate) return { stage: null };
  if (entry.endDate < today) return { stage: null };
  if (entry.startDate <= today) return { stage: "ongoing", daysLeft: daysBetween(today, entry.endDate) };
  const daysUntil = daysBetween(today, entry.startDate);
  return daysUntil <= windowDays ? { stage: "upcoming", daysUntil } : { stage: null };
}
