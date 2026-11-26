import { askGemini, geminiEnabled, geminiStatus } from "./recoVibeGemini.js";
import {
  buildPersonalizedEventRecommendations,
  isEventRecommendationQuestion,
} from "./recoVibeRecommendations.mjs";

// RecoVibe built-in help chatbot. FAQ mode is local; optional Gemini requests use the companion module.
// Usage: import { mountHelpBot } from "./recoVibeHelpBot.js"; mountHelpBot({ role: "student" });

const FAQ = [
  {
    id: "hello", q: "Hello",
    keywords: ["hello", "hi", "hey", "good morning", "good afternoon", "kumusta", "tulong"],
    a: "Hi! I'm the RecoVibe helper. Ask me about finding or joining events, schedules, venues, slots, attendance, preferences, or your account and profile."
  },
  {
    id: "find-events", q: "How do I find events?",
    keywords: ["find events", "browse events", "search events", "available events", "hanap event", "maghanap ng event", "saan makikita event", "list of events"],
    a: "Open Events to browse published campus events. Use the search and filters to narrow the list, or open an event for its schedule, venue, registration details and available slots."
  },
  {
    id: "event-details", q: "Where can I check an event's schedule and venue?",
    keywords: ["event schedule", "event date", "event time", "event venue", "event location", "when is event", "where is event", "kailan ang event", "saan ang event", "oras ng event", "petsa ng event"],
    a: "Open Events and select an event to see its date, time and venue. The Calendar also shows events by date."
  },
  {
    id: "register", q: "How do I register for an event?",
    keywords: ["register", "registration", "join event", "sign up", "enroll event", "participate", "sumali", "mag register", "paano sumali", "paano mag register"],
    a: "To register for an event:\n1. Open the Events page and pick a published event.\n2. Open its details and press Register.\n3. You will see your status as Registered, and the event appears in your registered list.\nYou can only register for events that are published. Teachers do not register for or participate in events."
  },
  {
    id: "cancel", q: "How do I cancel my registration?",
    keywords: ["cancel registration", "unregister", "withdraw", "cancel event", "cancel my", "alis sa event", "kanselahin registration"],
    a: "Open the event you registered for and press Cancel registration. Your status changes to Cancelled. If the event is still open you can register again later."
  },
  {
    id: "attendance", q: "How does attendance scanning work?",
    keywords: ["attendance", "scan", "scanning", "qr", "check in", "check-in", "time in", "present", "dumalo", "attendance ko", "paano mag attendance"],
    a: "Attendance is recorded at the event:\n1. Register for the event beforehand.\n2. At the venue, show your QR code or ID to the organizer.\n3. The organizer scans it and your attendance is recorded.\nOnly registered students can be marked present."
  },
  {
    id: "attendance-missing", q: "My attendance was not recorded",
    keywords: ["attendance missing", "not recorded", "not counted", "absent", "wasn't scanned", "scan failed", "scan not working", "di na record", "hindi na record", "wala attendance"],
    a: "If your attendance is not showing:\n• Make sure your registration status was Registered before the event.\n• Refresh the page and check again after a few minutes.\n• If it is still missing, tell the event organizer on the day, with your name and student number, so they can check the scan list."
  },
  {
    id: "profile-help", q: "How do I update incorrect profile information?",
    keywords: ["correction", "request correction", "correct", "wrong", "mistake", "change my", "edit profile", "update profile", "wrong department", "wrong student number", "typo", "ayusin profile", "mali profile", "palitan profile"],
    a: "Profile details such as department, student number, year and section, teacher ID or organization cannot be edited directly. To fix one:\n1. Open your Profile.\n2. Press Request a correction.\n3. Choose the field, enter the correct value, and write a reason (10 to 500 characters).\n4. Submit. Your request shows up under My correction requests."
  },
  {
    id: "preferences", q: "How do preferences and recommendations work?",
    keywords: ["preferences", "recommendations", "recommended events", "personalize", "interests", "suggest events", "gusto ko", "rekomendasyon", "event suggestions"],
    a: "Use your event preferences to help RecoVibe highlight events that may interest you. Browse the recommended events on your dashboard, and open Events to see the full published list."
  },
  {
    id: "event-status", q: "Why can't I see an event?",
    keywords: ["can't see event", "cannot see event", "event missing", "event not showing", "hidden event", "not published", "draft", "di makita event", "hindi lumalabas event"],
    a: "Students only see published events. An event that is still pending, rejected or in draft is visible only to its organizer and reviewers. If an event should be visible, ask the organizer to check its status."
  },
];

const SUGGESTIONS = {
  student: ["find-events", "register", "preferences", "event-details", "profile-help", "attendance"]
};
let activeUnmount = null;

// ---------- matching ----------
const STOP = new Set("a an the is are am to of in on for and or my me i do does can how what why where when it this that with be there any ang mga ng sa ko mo po ba paano ano saan kailan the".split(" "));
const stem = (w) => (w.length > 4 ? w.replace(/(ing|ed|es|s)$/, "") : w);
const words = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).map(stem);
const meaningful = (s) => words(s).filter((w) => !STOP.has(w));

const INDEX = FAQ.map((f) => ({
  f,
  phrases: f.keywords.map((k) => " " + meaningful(k).join(" ") + " ").filter((p) => p.trim()),
  title: new Set(meaningful(f.q))
}));

function findAnswer(text) {
  const all = " " + meaningful(text).join(" ") + " ";
  const tokens = new Set(meaningful(text));
  let best = null, bestScore = 0;
  for (const it of INDEX) {
    let s = 0;
    for (const p of it.phrases) if (all.includes(p)) s += p.trim().includes(" ") ? 4 : 3;
    for (const t of it.title) if (tokens.has(t)) s += 1;
    if (s > bestScore) { bestScore = s; best = it.f; }
  }
  const titleOverlap = best
    ? [...tokens].filter((token) => INDEX.find((it) => it.f === best)?.title.has(token)).length
    : 0;
  return bestScore >= 3 || titleOverlap >= 2 ? best : null;
}

function eventIntent(text) {
  const q = words(text).join(" ");
  const hasEvent = /\b(event|activity|activiti)\b/.test(q);
  if (/\b(slot|capacity|bakante|ilan pa)\b/.test(q) || (hasEvent && /\bavailable\b/.test(q))) return "slots";
  if ((hasEvent || /\b(venue|location|lugar)\b/.test(q)) && /\b(venue|location|where|saan|lugar)\b/.test(q)) return "venue";
  if (/\b(registration|register|deadline|until|hanggang|enrollment)\b/.test(q) && (hasEvent || /\b(deadline|until|hanggang)\b/.test(q))) return "registration";
  if (/\b(when|date|schedule|time|kailan|petsa|oras|iskedyul)\b/.test(q) && hasEvent) return "schedule";
  if (/\b(upcoming|next|coming|list|what|ano|meron|hanap)\b/.test(q) && hasEvent) return "upcoming";
  return null;
}

function eventAnswer(text, getEvents) {
  const intent = eventIntent(text);
  if (!intent) return null;
  if (typeof getEvents !== "function") {
    return "I can't access the live event list on this page. Open Events or Calendar in the portal to check current event details.";
  }
  const events = getEvents();
  const now = Date.now();
  const upcoming = (Array.isArray(events) ? events : [])
    .filter((event) => event && Number(event.startMs || new Date(event.startAt || event.dateISO || 0).getTime()) >= now)
    .sort((a, b) => Number(a.startMs || 0) - Number(b.startMs || 0));
  if (!upcoming.length) return "There are no upcoming events in the event list currently loaded on this page. Open Events or Calendar to refresh and check again.";

  const questionWords = meaningful(text).filter((word) => !new Set(["event", "activiti", "slot", "venue", "location", "where", "saan", "lugar", "when", "date", "schedule", "time", "kailan", "petsa", "oras", "iskedyul", "registration", "register", "deadline", "until", "hanggang", "enrollment", "upcoming", "next", "coming", "list", "what", "ano", "meron", "hanap", "available", "bakante", "capacity", "ilan"]).has(word));
  const matching = upcoming.filter((event) => {
    const title = new Set(meaningful(event.name || event.title || ""));
    return questionWords.length > 0 && questionWords.some((word) => title.has(word));
  });
  const selected = matching.length ? matching.slice(0, 3) : upcoming.slice(0, 5);
  const dateText = (event) => {
    const value = Number(event.startMs) || new Date(event.startAt || event.dateISO || 0).getTime();
    return Number.isFinite(value) && value > 0
      ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Manila" }).format(value)
      : "schedule not listed";
  };
  const rows = selected.map((event) => {
    const title = event.name || event.title || "Untitled event";
    if (intent === "venue") return `${title}: ${event.venue || event.location || "venue not listed"}`;
    if (intent === "registration") {
      const deadline = Number(event.registrationDeadlineAt) || new Date(event.registrationDeadline || event.registrationEnd || 0).getTime();
      return `${title}: ${Number.isFinite(deadline) && deadline > 0 ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(deadline) : "registration date not listed"}`;
    }
    if (intent === "slots") {
      const slots = event.availableSlots != null && Number.isFinite(Number(event.availableSlots))
        ? Number(event.availableSlots)
        : event.slotsOpen != null && Number.isFinite(Number(event.slotsOpen))
          ? Number(event.slotsOpen)
          : null;
      return `${title}: ${slots === null ? "available slots not listed" : `${slots} slot${slots === 1 ? "" : "s"} available`}`;
    }
    return `${title}: ${dateText(event)}${event.venue || event.location ? ` · ${event.venue || event.location}` : ""}`;
  });
  const heading = matching.length ? "Event details from the loaded portal data:" : "Upcoming events from the loaded portal data:";
  return `${heading}\n${rows.map((row) => `• ${row}`).join("\n")}${!matching.length && upcoming.length > selected.length ? "\nOpen Events to see the full list." : ""}`;
}

function isPortalQuestion(text) {
  const portalTerms = new Set("event activity register registration join attendance scan qr calendar schedule venue location slot profile account correction notification preference recommendation".split(" "));
  return words(text).some((word) => portalTerms.has(word) || ["sumali", "dumalo", "iskedyul", "kalendaryo", "lugar", "bakante", "profile", "tulong"].includes(word));
}

function contextFor(q, n = 6) {
  const toks = new Set(words(q).filter((w) => !STOP.has(w)));
  return FAQ.map((f) => {
    const hay = new Set(words(f.q + " " + f.keywords.join(" ") + " " + f.a));
    let s = 0; toks.forEach((t) => { if (hay.has(t)) s++; });
    return { f, s };
  }).sort((a, b) => b.s - a.s).slice(0, n).filter((x) => x.s > 0).map((x) => x.f);
}

// ---------- UI ----------
const CSS = `
.rv-hb{--rv-main:var(--maroon,#7a1f2b);--rv-main-dark:#5a1420;--rv-gold:#e0b84f;--rv-bg:#fffdf8;--rv-line:#eadfca;--rv-bot:#f6efe2;--rv-ink:#2b2320;font-family:inherit;font-size:14px;color:var(--rv-ink)}
.rv-hb *{box-sizing:border-box}
.rv-hb [hidden]{display:none!important}
.rv-hb button{font:inherit}
.rv-hb button:focus-visible,.rv-hb input:focus-visible{outline:2px solid #2563eb;outline-offset:2px}

.rv-hb-fab{position:fixed;right:20px;bottom:20px;z-index:9998;width:58px;height:58px;border-radius:50%;border:0;color:#fff;font-size:26px;cursor:pointer;background:linear-gradient(145deg,var(--rv-main),var(--rv-main-dark));box-shadow:0 8px 22px rgba(90,20,32,.35);transition:transform .15s ease,box-shadow .15s ease}
.rv-hb-fab:hover{transform:translateY(-2px) scale(1.04);box-shadow:0 12px 26px rgba(90,20,32,.4)}

.rv-hb-panel{position:fixed;right:20px;bottom:92px;z-index:9999;width:380px;max-width:calc(100vw - 24px);height:min(600px,calc(100vh - 112px));display:none;flex-direction:column;background:var(--rv-bg);border:1px solid var(--rv-line);border-radius:18px;box-shadow:0 18px 48px rgba(43,35,32,.3);overflow:hidden}
.rv-hb-panel.open{display:flex}

.rv-hb-head{display:flex;align-items:center;gap:10px;padding:12px 12px 12px 14px;color:#fff;background:linear-gradient(135deg,var(--rv-main),var(--rv-main-dark))}
.rv-hb-titles{flex:1;min-width:0}
.rv-hb-titles b{display:block;font-size:15px;line-height:1.2}
.rv-hb-status{display:flex;align-items:center;gap:6px;font-size:11px;opacity:.9;margin-top:2px}
.rv-hb-status::before{content:"";width:7px;height:7px;border-radius:50%;background:#4ade80}
.rv-hb-actions{display:flex;gap:2px}
.rv-hb-ic{width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:#fff;font-size:18px;line-height:1;cursor:pointer}
.rv-hb-ic:hover{background:rgba(255,255,255,.16)}

.rv-hb-av{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--rv-gold);color:var(--rv-main);font-weight:700;font-size:13px;letter-spacing:.3px}
.rv-hb-av.sm{width:28px;height:28px;font-size:10px}

.rv-hb-msgs{position:relative;flex:1;overflow-y:auto;padding:16px 14px;display:flex;flex-direction:column;gap:12px;scroll-behavior:smooth;scrollbar-width:thin;scrollbar-color:#d9cdb6 transparent;background:linear-gradient(#fffdf8,#fbf6ea)}
.rv-hb-row{display:flex;gap:8px;align-items:flex-start}
.rv-hb-row.me{justify-content:flex-end}
.rv-hb-m{max-width:84%;padding:10px 13px;border-radius:16px;line-height:1.45;word-wrap:break-word;overflow-wrap:anywhere}
.rv-hb-m.bot{background:var(--rv-bot);border-top-left-radius:5px}
.rv-hb-m.me{color:#fff;background:linear-gradient(145deg,var(--rv-main),var(--rv-main-dark));border-bottom-right-radius:5px}
.rv-hb-p+.rv-hb-p,.rv-hb-p+.rv-hb-step,.rv-hb-step+.rv-hb-p{margin-top:6px}
.rv-hb-step{display:grid;grid-template-columns:22px 1fr;gap:8px;align-items:start;margin-top:6px}
.rv-hb-step:first-child{margin-top:0}
.rv-hb-n{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:var(--rv-main);color:#fff;font-size:11px;font-weight:700;margin-top:1px}
.rv-hb-dot{text-align:center;color:var(--rv-main);font-weight:700}

.rv-hb-dots{display:flex;gap:4px;padding:4px 2px}
.rv-hb-dots span{width:7px;height:7px;border-radius:50%;background:#9a8a78;opacity:.5}
@media (prefers-reduced-motion:no-preference){
  .rv-hb-dots span{animation:rvdot 1s infinite ease-in-out}
  .rv-hb-dots span:nth-child(2){animation-delay:.15s}
  .rv-hb-dots span:nth-child(3){animation-delay:.3s}
  @keyframes rvdot{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}}
  .rv-hb-panel.open{animation:rvpop .2s ease-out}
  @keyframes rvpop{from{opacity:0;transform:translateY(10px) scale(.98)}}
  .rv-hb-row{animation:rvin .18s ease-out}
  @keyframes rvin{from{opacity:0;transform:translateY(6px)}}
  .rv-hb-pulse{animation:rvpulse 1.8s ease-out 3}
  @keyframes rvpulse{0%{box-shadow:0 0 0 0 rgba(122,31,43,.5)}100%{box-shadow:0 0 0 18px rgba(122,31,43,0)}}
}

.rv-hb-chipswrap{padding:8px 0 8px 14px;border-top:1px solid var(--rv-line);background:#fff}
.rv-hb-chipslabel{font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:#8a7a68;margin-bottom:6px}
.rv-hb-chips{display:flex;gap:8px;overflow-x:auto;padding:0 14px 4px 0;scrollbar-width:none}
.rv-hb-chips::-webkit-scrollbar{display:none}
.rv-hb-chip{flex:none;white-space:nowrap;border:1px solid var(--rv-main);color:var(--rv-main);background:#fff;border-radius:999px;padding:6px 12px;font-size:12.5px;cursor:pointer;transition:background .12s,color .12s}
.rv-hb-chip:hover{background:var(--rv-main);color:#fff}

.rv-hb-form{display:flex;gap:8px;padding:10px 12px;background:#fff;border-top:1px solid var(--rv-line)}
.rv-hb-form input{flex:1;min-width:0;border:1px solid var(--rv-line);border-radius:999px;padding:10px 14px;background:#fffdf8}
.rv-hb-form input:focus{border-color:var(--rv-main)}
.rv-hb-send{flex:none;width:40px;height:40px;border:0;border-radius:50%;color:#fff;font-size:16px;cursor:pointer;background:linear-gradient(145deg,var(--rv-main),var(--rv-main-dark))}
.rv-hb-send:hover{filter:brightness(1.1)}
.rv-hb-note{padding:0 12px 9px;background:#fff;text-align:center;font-size:11px;color:#8a7a68}
.rv-hb-aitag{margin-top:8px;font-size:11px;color:#8a7a68}

@media (max-width:480px){
  .rv-hb-panel{left:12px;right:12px;width:auto;bottom:86px;height:min(78vh,calc(100vh - 100px))}
  .rv-hb-fab{right:14px;bottom:14px}
}
.rv-hb-chipshead{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;padding-right:14px}
.rv-hb-chipslabel{margin:0}
.rv-hb-minis{display:flex;gap:6px}
.rv-hb-mini{border:0;background:#f3ece0;color:var(--rv-main);border-radius:999px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer}
.rv-hb-mini:hover{background:var(--rv-main);color:#fff}
.rv-hb-in{animation:rvfade .22s ease-out}
@keyframes rvfade{from{opacity:0;transform:translateY(4px)}}
.rv-hb-sheet{position:absolute;left:0;right:0;bottom:0;z-index:2;display:flex;flex-direction:column;background:var(--rv-bg)}
.rv-hb-sheethead{display:flex;align-items:center;justify-content:space-between;padding:8px 8px 8px 14px;border-bottom:1px solid var(--rv-line);font-weight:700}
.rv-hb-sheetx{color:var(--rv-main)}
.rv-hb-sheetx:hover{background:#f3ece0}
.rv-hb-sheetbody{flex:1;overflow-y:auto;padding:4px 12px 16px}
.rv-hb-sheeth{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#8a7a68;margin:14px 2px 6px}
.rv-hb-q{display:block;width:100%;text-align:left;background:#fff;border:1px solid var(--rv-line);border-radius:10px;padding:9px 12px;margin-bottom:6px;cursor:pointer;color:var(--rv-ink);line-height:1.35}
.rv-hb-q:hover{border-color:var(--rv-main);color:var(--rv-main)}
`;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // always textContent: no HTML injection
  return n;
};

function renderBody(container, text) {
  String(text).split("\n").forEach((line) => {
    const step = /^(\d+)\.\s+(.*)$/.exec(line);
    const bullet = /^[\u2022\-]\s+(.*)$/.exec(line);
    if (step) {
      const r = el("div", "rv-hb-step");
      r.append(el("span", "rv-hb-n", step[1]), el("span", null, step[2]));
      container.appendChild(r);
    } else if (bullet) {
      const r = el("div", "rv-hb-step");
      r.append(el("span", "rv-hb-dot", "\u2022"), el("span", null, bullet[1]));
      container.appendChild(r);
    } else {
      container.appendChild(el("div", "rv-hb-p", line));
    }
  });
}

function resolveHits(q) {
  if (typeof rank === "function") return rank(q);
  const f = findAnswer(q);
  return f ? [{ f }] : [];
}

export function mountHelpBot({ role = "default", onUnanswered, getEvents, getStudentContext } = {}) {
  const roleKey = String(role).toLowerCase().replace(/[^a-z]/g, "");
  if (roleKey !== "student") {
    if (activeUnmount) activeUnmount();
    return () => {};
  }
  if (typeof document === "undefined" || document.getElementById("rv-hb")) return () => {};
  console.info("[RecoVibe help] AI status:", geminiStatus());
  const defaults = () => SUGGESTIONS.student;
  let currentChips = [];
  let currentChipsLabel = "";

  const style = el("style", null, CSS);
  const root = el("div", "rv-hb");
  root.id = "rv-hb";

  const fab = el("button", "rv-hb-fab rv-hb-pulse", "\u{1F4AC}");
  fab.type = "button";
  fab.setAttribute("aria-label", "Open help chat");
  fab.setAttribute("aria-expanded", "false");

  const panel = el("div", "rv-hb-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "RecoVibe help chat");

  const head = el("div", "rv-hb-head");
  const titles = el("div", "rv-hb-titles");
  titles.append(el("b", null, "RecoVibe Help"), el("small", "rv-hb-status", "Online \u00b7 instant answers"));
  const actions = el("div", "rv-hb-actions");
  const clear = el("button", "rv-hb-ic", "\u21bb");
  clear.type = "button";
  clear.title = "Start a new chat";
  clear.setAttribute("aria-label", "Start a new chat");
  const close = el("button", "rv-hb-ic", "\u00d7");
  close.type = "button";
  close.setAttribute("aria-label", "Close help chat");
  actions.append(clear, close);
  head.append(el("div", "rv-hb-av", "RV"), titles, actions);

  const msgs = el("div", "rv-hb-msgs");
  msgs.setAttribute("aria-live", "polite");

  const chipsWrap = el("div", "rv-hb-chipswrap");
  const chipsLabel = el("div", "rv-hb-chipslabel", "Suggested");
  const chipsHead = el("div", "rv-hb-chipshead");
  const minis = el("div", "rv-hb-minis");
  const moreBtn = el("button", "rv-hb-mini", "More \u21bb");
  moreBtn.type = "button";
  moreBtn.setAttribute("aria-label", "Show other questions");
  const allBtn = el("button", "rv-hb-mini", "All \u2630");
  allBtn.type = "button";
  allBtn.setAttribute("aria-label", "See all questions");
  minis.append(moreBtn, allBtn);
  chipsHead.append(chipsLabel, minis);
  const chips = el("div", "rv-hb-chips");
  chipsWrap.append(chipsHead, chips);

  const form = el("form", "rv-hb-form");
  const input = el("input");
  input.type = "text";
  input.maxLength = 200;
  input.placeholder = "Ask about events, attendance, corrections...";
  input.setAttribute("aria-label", "Your question");
  const send = el("button", "rv-hb-send", "\u27a4");
  send.type = "submit";
  send.setAttribute("aria-label", "Send");
  form.append(input, send);

  const note = el("div", "rv-hb-note", "Automated answers. For account problems, contact the OSAS office.");

  panel.append(head, msgs, chipsWrap, form, note);
  const sheet = el("div", "rv-hb-sheet");
  sheet.hidden = true;
  const sheetHead = el("div", "rv-hb-sheethead");
  const sheetClose = el("button", "rv-hb-ic rv-hb-sheetx", "\u00d7");
  sheetClose.type = "button";
  sheetClose.setAttribute("aria-label", "Close question list");
  sheetHead.append(el("span", null, "All questions"), sheetClose);
  const sheetBody = el("div", "rv-hb-sheetbody");
  sheet.append(sheetHead, sheetBody);
  panel.appendChild(sheet);
  root.append(fab, panel);
  document.head.appendChild(style);
  document.body.appendChild(root);

  let lastId = null;
  let greeted = false;
  const chat = [];
  const asked = new Set();
  let offset = 0;
  let busy = false;

  function addMsg(text, who) {
    const message = String(text);
    const row = el("div", "rv-hb-row " + who);
    if (who === "bot") row.appendChild(el("div", "rv-hb-av sm", "RV"));
    const bubble = el("div", "rv-hb-m " + who);
    renderBody(bubble, message);
    row.appendChild(bubble);
    msgs.appendChild(row);
    // Bot answers: scroll so the START of the answer is visible. User messages: scroll to the bottom.
    msgs.scrollTop = who === "bot" ? Math.max(0, row.offsetTop - 10) : msgs.scrollHeight;
    chat.push({ who, text: String(text) }); if (chat.length > 12) chat.shift();
    return row;
  }

  function addTyping() {
    const row = el("div", "rv-hb-row bot");
    row.appendChild(el("div", "rv-hb-av sm", "RV"));
    const bubble = el("div", "rv-hb-m bot");
    const dots = el("div", "rv-hb-dots");
    dots.append(el("span"), el("span"), el("span"));
    dots.setAttribute("aria-label", "Typing");
    bubble.appendChild(dots);
    row.appendChild(bubble);
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
    return row;
  }

  function renderChips() {
    chips.replaceChildren();
    const list = currentChips;
    chipsWrap.hidden = currentChips.length === 0 && currentChipsLabel === "";
    list.forEach(({ label: text, run }) => {
      const c = el("button", "rv-hb-chip", text);
      c.type = "button";
      c.addEventListener("click", run);
      chips.appendChild(c);
    });
    chips.scrollLeft = 0;
  }

  function setChips(list, label) {
    currentChips = list;
    currentChipsLabel = label;
    chipsLabel.textContent = label;
    renderChips();
    chipsWrap.classList.remove("rv-hb-in");
    void chipsWrap.offsetWidth;
    chipsWrap.classList.add("rv-hb-in");
  }

  const faqChip = (f) => ({ label: f.q, run: () => ask(f.q, f) });

  function pool() {
    const ok = (f) => !asked.has(f.id) && f.id !== "hello";
    const mine = FAQ.filter((f) => ok(f) && (!f.roles || f.roles.includes(roleKey)));
    const rest = FAQ.filter((f) => ok(f) && f.roles && !f.roles.includes(roleKey));
    return mine.concat(rest);
  }

  function showChips(ids, label) {
    let list = ids
      .map((id) => FAQ.find((f) => f.id === id))
      .filter((f) => f && f.id !== lastId && !asked.has(f.id));
    if (list.length < 4) {
      const have = new Set(list.map((f) => f.id));
      list = list.concat(pool().filter((f) => !have.has(f.id) && f.id !== lastId)).slice(0, 5);
    }
    offset = 0;
    setChips(list.slice(0, 5).map(faqChip), label);
  }

  function showMore() {
    if (busy) return;
    let p = pool();
    if (!p.length) { asked.clear(); p = pool(); }
    if (offset >= p.length) offset = 0;
    setChips(p.slice(offset, offset + 4).map(faqChip), "More questions");
    offset += 4;
  }

  function openSheet() {
    if (busy) return;
    sheetBody.replaceChildren();
    const groups = new Map();
    FAQ.forEach((f) => {
      if (f.id === "hello") return;
      const t = f.topic || "Questions";
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(f);
    });
    groups.forEach((list, t) => {
      sheetBody.appendChild(el("div", "rv-hb-sheeth", t));
      const mine = list.filter((f) => !f.roles || f.roles.includes(roleKey));
      const rest = list.filter((f) => f.roles && !f.roles.includes(roleKey));
      mine.concat(rest).forEach((f) => {
        const b = el("button", "rv-hb-q", (asked.has(f.id) ? "\u2713 " : "") + f.q);
        b.type = "button";
        b.addEventListener("click", () => { closeSheet(); ask(f.q, f); });
        sheetBody.appendChild(b);
      });
    });
    sheet.style.top = head.offsetHeight + "px";
    sheet.hidden = false;
    sheetBody.scrollTop = 0;
    sheetClose.focus();
  }

  function closeSheet() {
    sheet.hidden = true;
    input.focus();
  }

  function ask(text, known) {
    const q = String(text).trim();
    if (!q) return;
    if (busy) return;
    busy = true;
    addMsg(q, "me");
    setChips([], "");
    const typing = addTyping();

    const roleAnswer = (f) => (f.byRole && f.byRole[roleKey]) || f.a;

    function answerLocally(dynamicAnswer) {
      const hits = known ? [{ f: known }] : resolveHits(q);
      if (dynamicAnswer) {
        lastId = null;
        addMsg(dynamicAnswer, "bot");
        showChips(defaults(), "Suggested");
      } else if (hits.length) {
        const f = hits[0].f;
        lastId = f.id;
        asked.add(f.id);
        addMsg(roleAnswer(f), "bot");
        const related = hits.slice(1).map((h) => h.f.id);
        showChips(related.length ? related : defaults(), related.length ? "Related questions" : "Suggested");
      } else {
        lastId = null;
        addMsg("I can help with the RECOVIBE PUP Biñan portal, including events, schedules, registration, attendance, preferences, and account or profile help. Try rephrasing your question around one of those topics.", "bot");
        showChips(defaults(), "Try asking");
        if (typeof onUnanswered === "function") onUnanswered(q);
      }
    }

    (async () => {
      try {
        const dynamicAnswer = isEventRecommendationQuestion(q)
          ? buildPersonalizedEventRecommendations(
            typeof getEvents === "function" ? getEvents() : [],
            typeof getStudentContext === "function" ? getStudentContext() : {},
          )
          : eventAnswer(q, getEvents);
        const localHits = known ? [known] : resolveHits(q).map((hit) => hit.f);
        if (!known && !dynamicAnswer && !localHits.length && isPortalQuestion(q) && geminiEnabled()) {
          try {
            const answer = await askGemini(q, { role: roleKey, entries: contextFor(q, 6), history: chat.slice(0, -1) });
            typing.remove();
            const row = addMsg(answer, "bot");
            row.querySelector(".rv-hb-m").appendChild(el("div", "rv-hb-aitag", "AI answer \u00b7 may be inaccurate"));
            lastId = null;
            showChips(defaults(), "Suggested");
            return;
          } catch (e) {
            console.warn("[RecoVibe help] Gemini unavailable, using FAQ:", e.code || "", e.detail || e.message || e);
          }
        } else {
          await new Promise((r) => setTimeout(r, 350));
        }
        typing.remove();
        answerLocally(dynamicAnswer);
      } finally {
        typing.remove();
        busy = false;
      }
    })();
  }

  function greet() {
    lastId = null;
    addMsg("Hi! I can help with finding events, schedules and venues, registration, attendance, preferences, and account or profile help. What do you need?", "bot");
    showChips(defaults(), "Popular questions");
  }

  function open(v) {
    panel.classList.toggle("open", v);
    fab.setAttribute("aria-expanded", String(v));
    if (v) {
      fab.classList.remove("rv-hb-pulse");
      if (!greeted) { greeted = true; greet(); }
      input.focus();
    } else fab.focus();
  }

  const onFab = () => open(!panel.classList.contains("open"));
  const onClose = () => open(false);
  const onClear = () => {
    msgs.replaceChildren();
    chat.length = 0;
    asked.clear();
    offset = 0;
    busy = false;
    sheet.hidden = true;
    greet();
    input.focus();
  };
  const onSubmit = (e) => { e.preventDefault(); const v = input.value; input.value = ""; ask(v); };
  const onKey = (e) => {
    if (e.key !== "Escape" || !panel.classList.contains("open")) return;
    if (!sheet.hidden) closeSheet();
    else open(false);
  };

  fab.addEventListener("click", onFab);
  close.addEventListener("click", onClose);
  clear.addEventListener("click", onClear);
  form.addEventListener("submit", onSubmit);
  document.addEventListener("keydown", onKey);
  moreBtn.addEventListener("click", showMore);
  allBtn.addEventListener("click", openSheet);
  sheetClose.addEventListener("click", closeSheet);

  const unmount = function () {
    document.removeEventListener("keydown", onKey);
    root.remove();
    style.remove();
    if (activeUnmount === unmount) activeUnmount = null;
  };
  activeUnmount = unmount;
  return unmount;
}
