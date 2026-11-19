// Firestore access for the PUP academic calendar. Client-side only (Spark plan, no Cloud Functions).
// Collection: academicCalendar/{id}  { title, startDate, endDate, category, semesterId, semesterLabel, ... }
// Dates are "YYYY-MM-DD" strings in Asia/Manila.
import {
  collection, doc, writeBatch, updateDoc, deleteDoc, getDocs,
  query, where, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { entryId, todayManila, calendarAlertFor } from "./academicCalendarParser.js";
import { assertOsas } from "./correctionAccess.js";

const COL = "academicCalendar";
const CATEGORIES = ["holiday", "exam", "enrollment", "deadline", "break", "graduation", "classes", "other"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function validEntry(e) {
  return e && typeof e.title === "string" && e.title.trim().length >= 2 && e.title.length <= 200
    && YMD.test(e.startDate) && YMD.test(e.endDate) && e.endDate >= e.startDate;
}

/** OSAS only. One write per entry, in one batch. Deterministic ids: re-importing a semester overwrites, never duplicates. */
export async function saveCalendarEntries(db, auth, { semesterId, semesterLabel, entries }) {
  await assertOsas(db, auth);
  const user = auth.currentUser;
  const clean = (entries || []).filter((e) => e.include !== false && validEntry(e));
  if (!clean.length) throw new Error("Nothing valid to save. Check the dates and titles.");
  if (clean.length > 400) throw new Error("Too many entries in one import (max 400).");

  const batch = writeBatch(db);
  for (const e of clean) {
    batch.set(doc(db, COL, entryId(semesterId, e)), {
      title: e.title.trim(),
      startDate: e.startDate,
      endDate: e.endDate,
      category: CATEGORIES.includes(e.category) ? e.category : "other",
      semesterId,
      semesterLabel: semesterLabel || semesterId,
      source: "osas-import",
      updatedBy: user.uid,
      updatedByName: user.displayName || user.email || "",
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
  await batch.commit();
  return clean.length;
}

/** OSAS only. Edit one existing entry (id stays the same). */
export async function updateCalendarEntry(db, auth, id, changes) {
  await assertOsas(db, auth);
  const next = { ...changes };
  const probe = { title: next.title ?? "x1", startDate: next.startDate, endDate: next.endDate };
  if (next.startDate && next.endDate && !validEntry(probe)) throw new Error("Invalid dates or title.");
  if (next.category && !CATEGORIES.includes(next.category)) next.category = "other";
  await updateDoc(doc(db, COL, id), { ...next, updatedBy: auth.currentUser.uid, updatedAt: serverTimestamp() });
}

/** OSAS only. */
export async function deleteCalendarEntry(db, auth, id) {
  await assertOsas(db, auth);
  await deleteDoc(doc(db, COL, id));
}

/** One-time read of a semester (for the OSAS management list). */
export async function getSemesterEntries(db, semesterId) {
  const snap = await getDocs(query(collection(db, COL), where("semesterId", "==", semesterId)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/**
 * Entries that overlap [fromYmd, toYmd] (for the calendar month view).
 * Single inequality (endDate >= from) + orderBy endDate: no composite index needed; the start side is filtered here.
 */
export function subscribeCalendarRange(db, fromYmd, toYmd, onData, onError) {
  const q = query(collection(db, COL), where("endDate", ">=", fromYmd), orderBy("endDate"), limit(150));
  return onSnapshot(q, (snap) => {
    onData(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => e.startDate <= toYmd));
  }, (err) => onError && onError(err));
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (s) => { const [, m, d] = s.split("-").map(Number); return `${MON[m - 1]} ${d}`; };
const rangeText = (e) => (e.startDate === e.endDate ? short(e.startDate) : `${short(e.startDate)} to ${short(e.endDate)}`);

function toAlerts(docs, today, windowDays) {
  const out = [];
  for (const e of docs) {
    const a = calendarAlertFor(e, today, windowDays);
    if (!a.stage) continue;
    const message = a.stage === "ongoing"
      ? `Ongoing now: ${e.title} (${rangeText(e)})`
      : `${e.title} starts ${a.daysUntil === 0 ? "today" : a.daysUntil === 1 ? "tomorrow" : `in ${a.daysUntil} days`} (${rangeText(e)})`;
    out.push({
      id: `acad-${e.id}-${a.stage}`,          // stage in the id: "upcoming" then "ongoing" are separate notifications
      docId: e.id,
      type: "academic_calendar",
      stage: a.stage,
      category: e.category || "other",
      title: e.category === "holiday" ? `Holiday: ${e.title}` : e.title,
      message,
      startDate: e.startDate,
      endDate: e.endDate,
      sortKey: a.stage === "ongoing" ? 0 : 1 + a.daysUntil
    });
  }
  return out.sort((x, y) => x.sortKey - y.sortKey);
}

/**
 * Real-time alerts for dashboards and notification pages. No writes. Reads at most 15 docs on load,
 * then only changes. Recomputes every 30 minutes and when the tab becomes visible, so "upcoming" turns
 * into "ongoing" at midnight (Manila) without a reload.
 * Returns an unsubscribe function; also cleans up on pagehide (never unload/beforeunload).
 */
export function subscribeCalendarAlerts(db, onItems, onError, { windowDays = 7 } = {}) {
  let docs = [];
  let stopped = false;
  const recompute = () => { if (!stopped) onItems(toAlerts(docs, todayManila(), windowDays)); };

  const q = query(collection(db, COL), where("endDate", ">=", todayManila()), orderBy("endDate"), limit(15));
  const unsub = onSnapshot(q, (snap) => {
    docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    recompute();
  }, (err) => { if (onError) onError(err); });

  const timer = setInterval(recompute, 30 * 60 * 1000);
  const onVisible = () => { if (document.visibilityState === "visible") recompute(); };
  document.addEventListener("visibilitychange", onVisible);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    unsub();
  };
  window.addEventListener("pagehide", stop, { once: true });
  return stop;
}
