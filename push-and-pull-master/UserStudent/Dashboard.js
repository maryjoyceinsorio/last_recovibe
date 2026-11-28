/**
 * RecoVibe - Student Dashboard
 * PUP Biñan Campus Student Platform
 *
 * Implements:
 * - Server-time aligned schedule (.info/serverTimeOffset)
 * - Happening now section with live badge, progress bar, checked-in counter, and inline QR
 * - Upcoming events section with starts-in countdown and quick registration
 * - Recommended for you section matching student preferences
 * - PUP Connect! universal search with text highlighting
 * - Interactive Calendar preview with glowing live dots, registered dots, and day details
 * - 30-second interval automatic state transition without page reload
 * - Live screen reader announcements and offline support
 */

import {
  app,
  auth,
  db,
  rtdb,
  isFirebaseConfigured,
  isRtdbConfigured,
} from "./firebaseConfig.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collectionGroup,
  collection,
  doc,
  limit,
  onSnapshot,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref,
  onValue,
  off,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { fetchMonthHolidays } from "../holidayService.js";
import {
  createAttendanceQrPayload,
  renderAttendanceQr,
} from "./attendanceQr.js";
import { writeEventRegistration } from "./eventRtdb.js";
import {
  isRegistrationActive,
  mergeUserRegistrationMaps,
} from "./eventRegistrationData.js";
import {
  isEventVisibleToStudent,
  isStudentEventPublished,
  isStudentEventStatus,
  STUDENT_EVENT_QUERY_STATUSES,
} from "./eventAudience.js";
import { getEventDateRange } from "./calendarDateRange.mjs";
import {
  clearCachedStudentProfile,
  loadStudentProfile,
  renderStudentSidebar,
} from "./studentIdentity.js";
import { mountHelpBot } from "../recoVibeHelpBot.js";
import {
  EVENT_REGISTRATION_CLOSED_MESSAGE,
  getCachedSystemAccessSettings,
  readSystemAccessSettings,
} from "../systemAccess.js";
import { isResourceExhausted } from "./firestoreRetry.js";

/* ---------------------------------------------------------
   STATE
--------------------------------------------------------- */
let currentUid = null;
let academicCalendarItems = [];
let serverTimeOffset = 0;
const attendanceQrPayloads = new Map();
let qrRenderGeneration = 0;
let systemAccessSettings = getCachedSystemAccessSettings();

function renderAcademicCalendarAlerts() {
  const container = document.getElementById("academicCalendarAlerts");
  if (!container) return;
  const items = academicCalendarItems
    .slice()
    .sort((a, b) => Number(b.stage === "ongoing") - Number(a.stage === "ongoing") ||
      (a.sortKey || 0) - (b.sortKey || 0))
    .slice(0, 3);
  container.hidden = items.length === 0;
  container.innerHTML = items.length
    ? `<strong>Official dates</strong>${items.map((item) =>
      `<article class="academic-calendar-alert" data-category="${escapeHtml(item.category || "other")}"><span>${escapeHtml(item.title || "Official date")}</span><small>${escapeHtml(item.message || "")}</small></article>`,
    ).join("")}`
    : "";
}

window.addEventListener("student-academic-calendar-alerts", (event) => {
  academicCalendarItems = Array.isArray(event.detail) ? event.detail : [];
  renderAcademicCalendarAlerts();
});
academicCalendarItems = Array.isArray(window.StudentAcademicCalendarItems)
  ? window.StudentAcademicCalendarItems
  : [];

const studentProfile = {
  firstName: "",
  middleName: "",
  lastName: "",
  fullName: "",
  studentNo: "",
  organization: "",
  department: "",
  departmentCode: "",
  StudentOrgs: [],
  departments: [],
};

function uniqueProfileValues(...values) {
  const seen = new Set();
  return values
    .flatMap((value) => Array.isArray(value) ? value : value == null ? [] : [value])
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map((value) => String(value).trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const studentPreferences = {
  categories: [],
  sources: [],
  tags: [],
  organizations: [],
};

let rawEventsMap = new Map(); // id -> normalized event
let realtimeEventsMap = new Map();
let firestoreEventsMap = new Map();
let unsubscribeFirestoreEvents = null;
let retryEventFetch = null;
let eventFetchLoading = true;
let eventFetchError = null;
let eventFetchTimeout = null;
let realtimeEventsLoaded = !isRtdbConfigured;
let realtimeEventsTimeout = null;
let pageLoadSignaled = false;

function signalPageLoadReady() {
  if (pageLoadSignaled || eventFetchLoading) return;
  pageLoadSignaled = true;
  window.dispatchEvent(new Event("page-data-ready"));
}
let registeredEventIds = new Set();
const firestoreRegistrationRecords = new Map();
const rtdbRegistrationRecords = new Map();
let firestoreRegistrationUnsubscribe = null;
let rtdbRegistrationUnsubscribe = null;
let registrationListenerUid = null;
const attendanceMap = new Map(); // eventId -> { scannedAt, scannedBy, walkIn }
const attendanceListeners = new Map(); // eventId -> unsub function
const pendingRegistrationIds = new Set();
const eventDetailsDataMap = new Map();
let openQrEventId = null; // Event ID whose inline QR is displayed
const openDetailsEventIds = new Set(); // Set of event IDs whose details are open

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const nowInitial = new Date();
const state = {
  query: "",
  calMonth: nowInitial.getMonth(),
  calYear: nowInitial.getFullYear(),
  calSelectedDate: new Date(nowInitial.getFullYear(), nowInitial.getMonth(), nowInitial.getDate()),
};

const activeCleanups = [];
let tickInterval = null;


let currentMonthHolidays = [];
let lastFetchedHolidayMonth = -1;
let lastFetchedHolidayYear = -1;

function isHolidayEvent(ev) {
  if (!ev) return false;
  const id = String(ev.id || ev.eventId || "");
  const src = String(ev.source || "").toLowerCase();
  const cat = String(ev.category || "").toLowerCase();
  return (
    ev.isHoliday === true ||
    id.startsWith("holiday:") ||
    src.includes("holiday") ||
    cat.includes("holiday")
  );
}

async function syncMonthHolidays() {
  const y = state.calYear;
  const m = state.calMonth;
  if (lastFetchedHolidayYear === y && lastFetchedHolidayMonth === m) return;
  lastFetchedHolidayYear = y;
  lastFetchedHolidayMonth = m;
  try {
    const list = await fetchMonthHolidays(y, m);
    if (state.calYear === y && state.calMonth === m) {
      currentMonthHolidays = Array.isArray(list) ? list : [];
      renderCalendar();
    }
  } catch (err) {
    console.warn("Could not load month holidays for calendar preview:", err);
  }
}

/* ---------------------------------------------------------
   TIME HELPERS
--------------------------------------------------------- */
function getNow() {
  return Date.now() + serverTimeOffset;
}

function getGreetingPrefix(now) {
  const hour = new Date(now).getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

function formatTime(val) {
  if (!val) return "";
  const d = typeof val === "number" ? new Date(val) : new Date(String(val));
  if (isNaN(d.getTime())) return String(val);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function formatDate(val) {
  if (!val) return "";
  const d = typeof val === "number" ? new Date(val) : new Date(String(val));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatRemainingTime(ms) {
  if (ms <= 0) return "Ending now";
  const totalMins = Math.floor(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) {
    return mins > 0 ? `Ends in ${hours}h ${mins}m` : `Ends in ${hours}h`;
  }
  return mins > 0 ? `Ends in ${mins}m` : "Ends in <1m";
}

function formatStartsIn(ms) {
  if (ms <= 0) return "Starting now";
  const totalMins = Math.floor(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) {
    return mins > 0 ? `Starts in ${hours}h ${mins}m` : `Starts in ${hours}h`;
  }
  return `Starts in ${Math.max(1, mins)}m`;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getPublicDocumentLinks(event) {
  const documents = [];
  const addDocument = (entry, fallbackName) => {
    if (typeof entry === "string") {
      documents.push({ name: fallbackName, url: entry });
      return;
    }
    if (!entry || typeof entry !== "object") return;
    const url = entry.url || entry.downloadURL || entry.downloadUrl || entry.fileUrl || entry.path;
    if (url) documents.push({ name: entry.name || entry.fileName || fallbackName, url });
  };

  [event.participantDocuments].forEach((list) => {
    if (Array.isArray(list)) list.forEach((entry, index) => addDocument(entry, `Event document ${index + 1}`));
  });
  const seen = new Set();
  return documents.filter(({ url }) => {
    try {
      const parsed = new URL(String(url));
      if (parsed.protocol !== "https:" || seen.has(parsed.href)) return false;
      seen.add(parsed.href);
      return true;
    } catch {
      return false;
    }
  });
}

function renderPublicDocumentLinks(event) {
  const documents = getPublicDocumentLinks(event);
  if (!documents.length) return "";
  return `
    <div class="inline-details-row">
      <span class="inline-details-label">Attached documents</span>
      <div class="inline-details-desc">${documents.map((document) =>
        `<a href="${escapeHtml(document.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(document.name)}</a>`,
      ).join("<br>")}</div>
    </div>
  `;
}

function getEventCategories(event) {
  const value = event.categories || event.category || event.tag || "";
  const values = Array.isArray(value) ? value : String(value).split(/[,\n]+/);
  return values.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeSearchText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function matchesEventSearch(event) {
  const query = normalizeSearchText(state.query);
  return !query || normalizeSearchText(event.name).includes(query);
}

function getDashboardEventDetails(eventId, event) {
  const capacity = Number(event.capacity) || 0;
  const registeredCount = Math.max(0, Number(event.registeredCount) || 0);
  const details = {
    ...(eventDetailsDataMap.get(eventId) || event),
    id: eventId,
    eventId,
    name: event.name,
    title: event.name,
    capacity,
    maxCapacity: capacity,
    maxSlots: capacity,
    registeredCount,
  };
  if (capacity > 0) {
    details.slotsOpen = Math.max(0, capacity - registeredCount);
    details.availableSlots = details.slotsOpen;
    details.slots = details.slotsOpen;
  } else {
    details.capacityMode = "N/A";
    details.slotsOpen = undefined;
    details.availableSlots = undefined;
    details.slots = undefined;
  }
  return details;
}

function getRegistrationDeadlineAt(event) {
  const closeTimeValue =
    event.registrationCloseTime ??
    event.registration_close_time ??
    event.registrationEndTime ??
    event.registration_end_time ??
    "";
  const closeTime = String(closeTimeValue || "").trim();
  const hasCloseTime = closeTimeValue !== "" && closeTimeValue != null;
  const closeTimeIsTimestamp = hasCloseTime &&
    !/^\d{1,2}(?::\d{2}(?::\d{2}(?:\.\d+)?)?)?\s*(?:AM|PM)?$/i.test(closeTime);
  const closeTimeParts = closeTime.match(
    /^(\d{1,2})(?::(\d{2}))?(?::(\d{2})(?:\.\d+)?)?\s*(AM|PM)?$/i,
  );
  let closeHour = Number(closeTimeParts?.[1] || 23);
  const closeMinute = closeTimeParts?.[2] || (closeTimeParts ? "00" : "59");
  const closeSecond = closeTimeParts?.[3] || (closeTimeParts ? "00" : "59");
  if (closeTimeParts?.[4]?.toUpperCase() === "PM" && closeHour < 12) closeHour += 12;
  if (closeTimeParts?.[4]?.toUpperCase() === "AM" && closeHour === 12) closeHour = 0;
  const closeTimeForDate = closeTimeParts
    ? `${String(closeHour).padStart(2, "0")}:${closeMinute}:${closeSecond}`
    : "23:59:59.999";
  const deadlineFields = [
    event.registrationDeadlineAt,
    event.registration_deadline_at,
    event.registrationCloseAt,
    event.registration_close_at,
    event.registrationEnd,
    event.registration_end,
    event.registrationDeadline,
    event.registration_deadline,
  ];
  const dateFields = [
    closeTimeIsTimestamp ? closeTimeValue : undefined,
    event.registrationEndDate,
    event.registration_end_date,
    event.registrationCloseDate,
    event.registration_close_date,
  ];
  const parseDeadline = (value) => {
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
    if (typeof value === "number") return value;
    const text = String(value || "").trim();
    if (!text) return NaN;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return Date.parse(`${text}T${closeTimeForDate}+08:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) {
      return Date.parse(`${text.replace(" ", "T")}+08:00`);
    }
    return Date.parse(text);
  };
  for (const value of [...deadlineFields, ...dateFields]) {
    if (value === undefined || value === null || value === "") continue;
    if (
      closeTimeIsTimestamp &&
      /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim())
    ) {
      const timestamp = parseDeadline(closeTimeValue);
      if (Number.isFinite(timestamp)) return timestamp;
    }
    const timestamp = parseDeadline(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return NaN;
}

function normalizeRegistrationStatus(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

function isClosedRegistrationStatus(value) {
  const status = normalizeRegistrationStatus(value);
  return [
    "closed",
    "registration closed",
    "registration is closed",
    "registration ended",
    "expired",
    "ended",
    "disabled",
    "not open",
    "registration not open",
    "not accepting registrations",
  ].includes(status) || /\bregistration\b.*\bclosed\b/.test(status);
}

function isFullRegistrationStatus(value) {
  return ["full", "fully booked", "sold out"].includes(
    normalizeRegistrationStatus(value),
  );
}

function getRegistrationBlockReason(event, now = getNow(), eventEndMs = event.endMs) {
  if (!systemAccessSettings.eventRegistrationEnabled) {
    return EVENT_REGISTRATION_CLOSED_MESSAGE;
  }
  const statuses = [
    event.status,
    event.eventStatus,
    event.event_status,
    event.publicationStatus,
    event.publication_status,
    event.registrationStatus,
    event.registration_status,
    event.registrationState,
    event.registration_state,
    event.registrationStatusLabel,
    event.registration_status_label,
    event.regStatus,
    event.reg_status,
    event.registrationAvailability,
    event.registration_availability,
    event.registrationLabel,
    event.registration_label,
    event.registration?.status,
    event.registration?.state,
    event.registration,
    event.availability,
  ];
  const deadlineAt = getRegistrationDeadlineAt(event);
  const fullStatus = statuses.some(isFullRegistrationStatus);
  const endedStatus = [
    event.status,
    event.eventStatus,
    event.event_status,
    event.publicationStatus,
    event.publication_status,
  ].some((value) =>
    ["completed", "complete", "ended", "finished", "cancelled", "canceled"]
      .includes(normalizeRegistrationStatus(value)),
  );
  const endAt = Number(eventEndMs);
  if (
    event.registrationClosed === true ||
    event.registration_closed === true ||
    event.isRegistrationClosed === true ||
    event.registration === false ||
    event.registrationEnabled === false ||
    event.registration_enabled === false ||
    event.isRegistrationOpen === false ||
    event.is_registration_open === false ||
    event.registrationOpen === false ||
    event.registration_open === false ||
    event.allowRegistration === false ||
    event.allow_registration === false ||
    statuses.some(isClosedRegistrationStatus) ||
    endedStatus ||
    Number.isFinite(deadlineAt) && now > deadlineAt ||
    Number.isFinite(endAt) && endAt > 0 && now >= endAt
  ) {
    return "Registration Closed";
  }
  const capacity = Number(
    event.capacity ?? event.maxCapacity ?? event.maxSlots ?? event.slots,
  );
  const registeredCount = Math.max(0, Number(event.registeredCount) || 0);
  const remainingSlots = Number(
    event.slotsOpen ??
      event.availableSlots ??
      event.slotsLeft ??
      event.remainingSlots ??
      event.slots_remaining,
  );
  const noCapacityLimit = event.capacityMode === "N/A";
  return (
    fullStatus ||
    !noCapacityLimit && (
      Number.isFinite(capacity) && capacity > 0 && registeredCount >= capacity ||
      Number.isFinite(remainingSlots) && remainingSlots <= 0
    )
  )
    ? "Fully Booked"
    : "";
}

function highlightMatch(text, query) {
  if (!query || !text) return escapeHtml(text);
  const q = query.trim();
  if (!q) return escapeHtml(text);
  const str = String(text);
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
  const parts = str.split(regex);
  return parts
    .map((part) => {
      if (part.toLowerCase() === q.toLowerCase()) {
        return `<mark class="search-highlight">${escapeHtml(part)}</mark>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

function categoryClass(cat) {
  const c = String(cat || "").toLowerCase();
  if (c.includes("tech") || c.includes("innovation")) return "tech";
  if (c.includes("sport") || c.includes("fitness")) return "sports";
  if (c.includes("art") || c.includes("culture")) return "arts";
  if (c.includes("academic") || c.includes("learn")) return "academic";
  if (c.includes("leader") || c.includes("career")) return "leadership-career";
  return "academic";
}

function eventMetaIconClock() {
  return '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7" stroke="currentColor" stroke-width="1.4"/><path d="M10 6v4l2.5 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
}

function eventMetaIconPin() {
  return '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 17.5S15.5 12.8 15.5 8.5a5.5 5.5 0 1 0-11 0c0 4.3 5.5 9 5.5 9Z" stroke="currentColor" stroke-width="1.4"/><circle cx="10" cy="8.3" r="2" stroke="currentColor" stroke-width="1.4"/></svg>';
}

/* ---------------------------------------------------------
   EVENT NORMALIZATION & CLASSIFICATION
--------------------------------------------------------- */
function calendarDateToISO(value) {
  if (!value) return "";
  if (typeof value === "object" && typeof value.toDate === "function") {
    return calendarDateToISO(value.toDate());
  }
  if (typeof value === "object" && Number.isFinite(value.seconds)) {
    return calendarDateToISO(new Date(value.seconds * 1000));
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(value);
    const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
      ? value
      : "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return calendarDateToISO(date);
}

function calendarEventDateRange(event) {
  const eventDateRange = getEventDateRange(event);
  if (!eventDateRange) return null;
  const start = calendarDateToISO(eventDateRange.start);
  const end = calendarDateToISO(eventDateRange.end);
  return start ? { start, end: end && end >= start ? end : start } : null;
}

function calendarEventOccursOn(event, isoDate) {
  const range = calendarEventDateRange(event);
  return Boolean(range && range.start <= isoDate && isoDate <= range.end);
}

function normalizeEvent(id, data) {
  eventDetailsDataMap.set(String(id), data);
  const eventDateRange = getEventDateRange(data);
  const name = data.name || data.title || data.eventName || "Untitled Event";
  const categoryValue = data.category || data.categories || data.tag || "Academic & Learning";
  const categories = (Array.isArray(categoryValue)
    ? categoryValue
    : String(categoryValue).split(/[,\n]+/)
  ).map((category) => String(category || "").trim()).filter(Boolean);
  const sourceValue = String(
    data.source ||
      data.eventSource ||
      data.organizationName ||
      data.organization ||
      data.orgName ||
      data.organizerOrganization ||
      data.organizerName ||
      "",
  ).trim().toLowerCase();
  const source = /\bcsc\b/.test(sourceValue) ||
    sourceValue.includes("campus student council") ||
    sourceValue.includes("central student council")
    ? "Organizational"
    : /organization|organizational|ibits|event organizer|organizer/.test(sourceValue)
      ? "Organizational"
      : /external|admin|other/.test(sourceValue)
        ? "Others / External"
        : /pup|campus|cite|teacher|faculty/.test(sourceValue)
          ? "PUP Official"
          : data.source || data.eventSource
            ? "Others / External"
            : "PUP Official";
  const organizationValue =
    data.organizationName ||
    data.organization ||
    data.orgName ||
    data.organizerOrganization ||
    data.organizationCode ||
    data.orgCode ||
    data.organizerName ||
    data.organizer;
  let organizationName = typeof organizationValue === "object"
    ? String(
        organizationValue?.name ||
          organizationValue?.organizationName ||
          organizationValue?.organizationCode ||
          organizationValue?.code ||
          "",
      ).trim()
    : String(organizationValue || "").trim();
  if (["event organizer", "not specified", "n/a"].includes(organizationName.toLowerCase())) {
    organizationName = "";
  }
  const registrationEnd =
    data.registrationDeadlineAt ??
    data.registration_deadline_at ??
    data.registrationEnd ??
    data.registration_end ??
    data.registrationDeadline ??
    data.registration_deadline ??
    data.registrationCloseAt ??
    data.registration_close_at ??
    data.registrationEndDate ??
    data.registration_end_date ??
    data.registrationCloseDate ??
    data.registration_close_date ??
    data.registrationCloseTime ??
    data.registration_close_time ??
    data.registrationEndTime ??
    data.registration_end_time ??
    "";
  const dateISO = calendarDateToISO(
    eventDateRange?.start ||
      data.dateISO || data.eventDate || data.event_date || data.date ||
      data.startDate || data.start_date || data.dateStart || data.startDateTime ||
      data.schedule?.date || data.schedule?.startDate,
  );
  const endDateISO = calendarDateToISO(
    eventDateRange?.end ||
      data.endDateISO || data.eventEndDate || data.endDate || data.end_date ||
      data.dateEnd || data.end || data.schedule?.endDate,
  );
  const toMillis = (value) => {
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toMillis === "function") return value.toMillis();
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const timeToManilaMillis = (isoDate, timeValue, useEndOfDay = false) => {
    if (!isoDate) return 0;
    const [year, month, day] = isoDate.split("-").map(Number);
    if (useEndOfDay) {
      return Date.UTC(year, month - 1, day + 1, -8, 0, 0, -1);
    }
    const time = String(timeValue || "").trim();
    const match = time.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!match) return Date.UTC(year, month - 1, day, -8, 0);
    let hours = Number(match[1]);
    const minutes = Number(match[2] || 0);
    if (match[3]?.toUpperCase() === "PM" && hours < 12) hours += 12;
    if (match[3]?.toUpperCase() === "AM" && hours === 12) hours = 0;
    return Date.UTC(year, month - 1, day, hours - 8, minutes);
  };
  const eventTimes = String(data.time || "").split(/\s*[-–—]\s*/);
  const startTime = eventTimes[0] || data.timeStart || data.startTime;
  const endTime = eventTimes[1] || data.timeEnd || data.endTime;
  let startMs = eventDateRange?.start.getTime() || 0;
  if (data.startAt) {
    startMs = toMillis(data.startAt);
  }
  if (!startMs && dateISO) {
    startMs = timeToManilaMillis(dateISO, startTime);
  }
  if (isNaN(startMs) || startMs === 0) startMs = Date.now();

  let endMs = eventDateRange?.end.getTime() || 0;
  if (data.endAt) {
    endMs = toMillis(data.endAt);
  }
  if (!endMs && endDateISO) {
    endMs = timeToManilaMillis(endDateISO, endTime, !endTime);
  }
  if (!endMs && dateISO) {
    endMs = timeToManilaMillis(dateISO, "", true);
  }
  if (isNaN(endMs) || endMs <= 0) {
    endMs = startMs;
  }

  return {
    id: String(id),
    name: name,
    title: name,
    venue: data.venue || data.location || "PUP Biñan Campus",
    location: data.venue || data.location || "PUP Biñan Campus",
    category: categories.join(", ") || "Academic & Learning",
    categories,
    tags: data.tags || data.eventTags || [],
    tag: data.tag || "",
    source,
    organizationName,
    registrationEnd,
    registrationDeadline:
      data.registrationDeadline || data.registration_deadline || registrationEnd,
    registrationDeadlineAt: getRegistrationDeadlineAt(data),
    registrationClosed:
      data.registrationClosed === true ||
      data.registration_closed === true ||
      data.isRegistrationClosed === true ||
      data.registration === false ||
      data.registrationEnabled === false ||
      data.registration_enabled === false ||
      data.isRegistrationOpen === false ||
      data.is_registration_open === false ||
      data.registrationOpen === false ||
      data.registration_open === false ||
      data.allowRegistration === false ||
      data.allow_registration === false ||
      [
        data.registrationStatus,
        data.registration_status,
        data.registrationState,
        data.registration_state,
        data.registrationStatusLabel,
        data.registration_status_label,
        data.regStatus,
        data.reg_status,
        data.registrationAvailability,
        data.registration_availability,
        data.registrationLabel,
        data.registration_label,
        data.registration?.status,
        data.registration?.state,
        data.registration,
      ].some(isClosedRegistrationStatus),
    registrationStatus:
      data.registrationStatus ||
      data.registration_status ||
      data.registrationState ||
      data.registration_state ||
      data.registrationStatusLabel ||
      data.registration_status_label ||
      data.regStatus ||
      data.reg_status ||
      data.registrationAvailability ||
      data.registration_availability ||
      data.registrationLabel ||
      data.registration_label ||
      data.registration?.status ||
      data.registration?.state ||
      data.registration ||
      "",
    registrationEnabled: data.registrationEnabled ?? data.registration_enabled,
    isRegistrationOpen:
      data.isRegistrationOpen ??
      data.is_registration_open ??
      data.registrationOpen ??
      data.registration_open,
    registrationCloseTime:
      data.registrationCloseTime ||
      data.registration_close_time ||
      data.registrationEndTime ||
      data.registration_end_time ||
      "",
    registrationEndDate:
      data.registrationEndDate ||
      data.registration_end_date ||
      data.registrationCloseDate ||
      data.registration_close_date ||
      "",
    startAt: data.startAt || new Date(startMs).toISOString(),
    endAt: data.endAt || new Date(endMs).toISOString(),
    startMs: startMs,
    endMs: endMs,
    dateISO,
    endDateISO,
    status: String(
      data.status ||
      data.eventStatus ||
      data.event_status ||
      data.publicationStatus ||
      data.publication_status ||
      (data.published === true || data.isPublished === true ? "published" : ""),
    ).trim().toLowerCase(),
    eventStatus: data.eventStatus || "",
    event_status: data.event_status || "",
    publicationStatus: data.publicationStatus || "",
    publication_status: data.publication_status || "",
    organizerUid: data.organizerUid || "",
    organizerName: data.organizerName || data.organizer || "Event Organizer",
    targetAudience: data.targetAudience || data.target_audience ||
      data.audienceType || data.audience_type || data.audience || "",
    targetDepartments: [
      data.targetDepartments,
      data.target_departments,
      data.targetDepartment,
      data.target_department,
      data.departments,
    ].flatMap((departments) =>
      Array.isArray(departments) ? departments : departments ? [departments] : [],
    ),
    targetDepartmentIds: data.targetDepartmentIds || data.target_department_ids || [],
    targetOrganizations: [
      data.targetOrganizations,
      data.target_organizations,
      data.targetOrg,
      data.target_org,
      data.targetOrgCode,
      data.target_org_code,
      data.targetOrganization,
      data.target_organization,
      data.targetOrganizationCodes,
      data.target_organization_codes,
      data.targetOrganizationNames,
      data.target_organization_names,
      data.targetOrgs,
      data.target_orgs,
      data.TargetOrgs,
      data.StudentOrgs,
      data.studentOrgs,
      data.student_orgs,
      data.audienceOrganizations,
      data.audience_organizations,
    ].flatMap((targets) =>
      Array.isArray(targets) ? targets : targets ? [targets] : [],
    ),
    targetOrgs: [
      data.targetOrgs,
      data.target_orgs,
      data.targetOrganizations,
      data.target_organizations,
      data.targetOrg,
      data.target_org,
      data.targetOrgCode,
      data.target_org_code,
      data.targetOrganization,
      data.target_organization,
    ].flatMap((targets) =>
      Array.isArray(targets) ? targets : targets ? [targets] : [],
    ),
    studentOrgs: data.studentOrgs || data.student_orgs || [],
    TargetOrgs: [
      data.TargetOrgs,
      data.targetOrgs,
      data.target_orgs,
    ].flatMap((targets) =>
      Array.isArray(targets) ? targets : targets ? [targets] : [],
    ),
    audienceOrganizations: data.audienceOrganizations || [],
    coOrganizerOrganizations: data.coOrganizerOrganizations || [],
    coOrganizerOrgIds: data.coOrganizerOrgIds || [],
    coOrganizerOrganization: data.coOrganizerOrganization || "",
    collaboratorOrganizations: data.collaboratorOrganizations || [],
    collaboratorOrgIds: data.collaboratorOrgIds || [],
    collaboratorOrganization: data.collaboratorOrganization || "",
    collaborationOrganizations: data.collaborationOrganizations || [],
    collaborationOrgIds: data.collaborationOrgIds || [],
    collaborationOrganization: data.collaborationOrganization || "",
    collaboratingOrganizations: data.collaboratingOrganizations || [],
    collaboratingOrganization: data.collaboratingOrganization || "",
    coOrganizer: data.coOrganizer || "",
    collaborator: data.collaborator || "",
    coOrganizers: data.coOrganizers || [],
    collaborators: data.collaborators || [],
    organizationCode: data.organizationCode || "",
    organizationId: data.organizationId || "",
    organizerOrganization: data.organizerOrganization || "",
    orgCode: data.orgCode || "",
    orgId: data.orgId || "",
    organization: data.organization || "",
    organizationName: data.organizationName || "",
    orgName: data.orgName || "",
    creatorRole: data.creatorRole || data.createdByRole || "",
    eventSource: data.eventSource || "",
    organizer: data.organizer || "",
    capacity: Number(
      data.capacity ?? data.maxCapacity ?? data.maxSlots ?? data.slots ?? 0,
    ),
    capacityMode: data.capacityMode || "",
    registeredCount: Number(data.registeredCount ?? data.registered_count ?? 0),
    slotsOpen: data.slotsOpen ?? data.slots_open,
    availableSlots: data.availableSlots ?? data.available_slots,
    slotsLeft: data.slotsLeft ?? data.slots_left,
    remainingSlots: data.remainingSlots ?? data.remaining_slots,
    checkedInCount: Number(data.checkedInCount ?? 0),
    description: data.description || data.desc || "No additional description provided.",
    adminDocuments: data.adminDocuments || "",
    approvalDocuments: Array.isArray(data.approvalDocuments) ? data.approvalDocuments : [],
    participantDocuments: Array.isArray(data.participantDocuments) ? data.participantDocuments : [],
    attachments: Array.isArray(data.attachments) ? data.attachments : [],
  };
}

function rebuildStudentEvents() {
  const allEventsMap = new Map([...realtimeEventsMap, ...firestoreEventsMap]);
  try {
    localStorage.setItem(
      "recovibeEventsCache",
      JSON.stringify(Array.from(allEventsMap.values())),
    );
  } catch (error) {
    console.warn("Could not cache public events:", error);
  }

  rawEventsMap = new Map(
    [...allEventsMap].filter(([, event]) =>
      isEventVisibleToStudent(event, studentProfile),
    ),
  );
  const eventsList = Array.from(rawEventsMap.values());
  syncRegistrationsFromRtdb(eventsList);
  syncRegistrationsFromFirestore(eventsList);
  renderHappeningNow();
  renderUpcoming();
  renderRecommended();
  renderCalendar();
}

function normalizeFirestoreStudentEvent(documentSnapshot) {
  const data = documentSnapshot.data();
  if (!isStudentEventStatus(data.status) || !isStudentEventPublished(data)) return null;
  const rawStatus = String(data.status || "").trim().toLowerCase();
  const preserveStatus =
    [
      "approved",
      "published",
      "upcoming",
      "ongoing",
      "active",
      "live",
      "completed",
      "rescheduled",
    ].includes(rawStatus) ||
    isClosedRegistrationStatus(rawStatus) ||
    isFullRegistrationStatus(rawStatus);
  const startAt =
    data.startAt ??
    data.start_at ??
    data.startDateTime ??
    data.start_date_time ??
    data.schedule?.startAt ??
    data.schedule?.startDateTime;
  const endAt =
    data.endAt ??
    data.end_at ??
    data.endDateTime ??
    data.end_date_time ??
    data.schedule?.endAt ??
    data.schedule?.endDateTime;

  const rawDate =
    data.eventDate ||
    data.event_date ||
    data.dateISO ||
    data.date ||
    data.startDate ||
    data.start_date ||
    data.dateStart ||
    data.schedule?.date ||
    data.schedule?.startDate ||
    "";
  const timestampToIso = (value) =>
    value?.toDate ? value.toDate().toISOString() : value;
  const normalizedStartAt = timestampToIso(startAt);
  const normalizedEndAt = timestampToIso(endAt);
  const eventDateRange = getEventDateRange({
    ...data,
    startAt: normalizedStartAt,
    endAt: normalizedEndAt,
  });
  const dateISO = calendarDateToISO(eventDateRange?.start) || calendarDateToISO(rawDate);
  const endDateISO = calendarDateToISO(eventDateRange?.end);
  const time =
    data.time ||
    [data.timeStart || data.startTime, data.timeEnd || data.endTime]
      .filter(Boolean)
      .join(" - ");
  return normalizeEvent(documentSnapshot.id, {
    ...data,
    name: data.eventName || data.title || data.name || "Untitled Event",
    dateISO,
    endDateISO,
    time,
    startAt: normalizedStartAt,
    endAt: normalizedEndAt,
    venue: data.venue || data.location || data.venueOther,
    description: data.eventDescription || data.description || data.desc,
    status: preserveStatus
      ? data.status
      : "published",
    organizerUid: data.organizerUid || data.organizerId || data.createdBy || "",
  });
}

function getEventClassification(ev, now) {
  const statuses = [
    ev.status,
    ev.eventStatus,
    ev.event_status,
    ev.publicationStatus,
    ev.publication_status,
  ].map(normalizeRegistrationStatus);
  if (
    statuses.some((status) =>
      ["completed", "complete", "ended", "finished", "cancelled", "canceled"].includes(status),
    ) ||
    !Number.isFinite(Number(ev.startMs)) ||
    !Number.isFinite(Number(ev.endMs)) ||
    now >= Number(ev.endMs)
  ) {
    return "past";
  }
  if (statuses.some((status) => ["ongoing", "active", "live"].includes(status))) {
    return "live";
  }
  if (statuses.some((status) =>
    ["approved", "published", "upcoming", "rescheduled", "ongoing", "active", "live"].includes(status),
  )) {
    if (ev.startMs <= now && now < ev.endMs) {
      return "live";
    }
    if (ev.startMs > now) {
      return "upcoming";
    }
  }
  return "past";
}

function isEventJoinable(event, now = getNow()) {
  return (
    getEventClassification(event, now) === "upcoming" &&
    !getRegistrationBlockReason(event, now)
  );
}

/* ---------------------------------------------------------
   STORAGE & CACHE
--------------------------------------------------------- */
function loadStudentPreferences() {
  try {
    const storedUser = JSON.parse(
      localStorage.getItem("recovibeCurrentUser") ||
        sessionStorage.getItem("recovibeCurrentUser") ||
        "{}",
    );
    if (!currentUid || storedUser.uid !== currentUid) return;
    const raw = storedUser.preferences && JSON.stringify(storedUser.preferences)
      || localStorage.getItem(`recovibePreferences:${currentUid}`);
    const preferences = raw ? JSON.parse(raw) : {};
    studentPreferences.categories = Array.isArray(preferences.categories)
      ? preferences.categories
      : Array.isArray(preferences)
        ? preferences
        : [];
    studentPreferences.sources = Array.isArray(preferences.sources)
      ? preferences.sources
      : [];
    studentPreferences.tags = Array.isArray(preferences.tags)
      ? preferences.tags
      : [];
    studentPreferences.organizations = Array.isArray(preferences.organizations)
      ? preferences.organizations
      : [];
  } catch (e) {
    console.warn("Could not read preferences:", e);
  }
}

function readParticipationsFromStorage() {
  try {
    if (!currentUid) return [];
    const raw = localStorage.getItem(`recovibeParticipations:${currentUid}`);
    if (!raw) return [];
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => (typeof item === "string" ? item : String(item.id || item.eventId || "")))
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

function saveParticipationsToStorage() {
  try {
    if (!currentUid) return;
    const arr = Array.from(registeredEventIds);
    localStorage.setItem(`recovibeParticipations:${currentUid}`, JSON.stringify(arr));
  } catch (e) {
    console.warn("Could not save participations:", e);
  }
}

function loadFallbackEvents() {
  try {
    const cached = localStorage.getItem("recovibeEventsCache");
    if (cached) {
      const list = JSON.parse(cached);
      if (Array.isArray(list) && list.length > 0) {
        list.forEach((item) => {
          if (!isStudentEventPublished(item)) return;
          const ev = normalizeEvent(item.id || item.eventId, item);
          realtimeEventsMap.set(ev.id, ev);
        });
        rebuildStudentEvents();
        return;
      }
    }
  } catch (e) {}

  if (Array.isArray(window.RECOVIBE_EVENTS) && window.RECOVIBE_EVENTS.length > 0) {
    window.RECOVIBE_EVENTS.forEach((item) => {
      if (!isStudentEventPublished(item)) return;
      const ev = normalizeEvent(item.id || item.eventId, item);
      realtimeEventsMap.set(ev.id, ev);
    });
  }
  rebuildStudentEvents();
}

/* ---------------------------------------------------------
   CLIENT-SIDE QR GENERATION
--------------------------------------------------------- */
function getDashboardQrPayload(eventId) {
  const user = auth?.currentUser;
  if (!currentUid || user?.uid !== currentUid) {
    throw new Error("Sign in again to load your attendance QR code.");
  }
  const cacheKey = `${currentUid}:${eventId}`;
  if (attendanceQrPayloads.has(cacheKey)) return attendanceQrPayloads.get(cacheKey);

  const event = rawEventsMap.get(eventId);
  const payload = createAttendanceQrPayload({
    user,
    eventId,
    eventName: event?.name || "",
    registrationStatus: "registered",
  });
  attendanceQrPayloads.set(cacheKey, payload);
  return payload;
}

async function renderQrToCanvas(canvas, token) {
  try {
    await renderAttendanceQr(canvas, token, {
      width: 150,
      displayWidth: 150,
    });
  } catch (err) {
    console.error("renderQrToCanvas error:", err);
    throw err;
  }
}

/* ---------------------------------------------------------
   ACCESSIBILITY & TOASTS
--------------------------------------------------------- */
function announce(message) {
  const el = document.getElementById("dashboardLiveAnnouncer");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => {
    el.textContent = message;
  }, 40);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("is-visible");
  setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 3200);
}

/* ---------------------------------------------------------
   ATTENDANCE LISTENERS (Scoped strictly to live registered events)
--------------------------------------------------------- */
function syncAttendanceListeners(liveEvents) {
  if (!currentUid || !isRtdbConfigured) return;

  const activeLiveIds = new Set();
  liveEvents.forEach((ev) => {
    if (registeredEventIds.has(ev.id)) {
      activeLiveIds.add(ev.id);
    }
  });

  // Cleanup listeners no longer needed
  attendanceListeners.forEach((unsub, eventId) => {
    if (!activeLiveIds.has(eventId)) {
      unsub();
      attendanceListeners.delete(eventId);
    }
  });

  // Attach listeners for registered live events
  activeLiveIds.forEach((eventId) => {
    if (!attendanceListeners.has(eventId)) {
      const attendanceRefs = [
        ref(rtdb, `attendance/${eventId}/${currentUid}`),
        ref(rtdb, `events/${eventId}/attendance/${currentUid}`),
        ref(rtdb, `eventAttendance/${eventId}/${currentUid}`),
      ];
      const attendanceValues = [null, null, null];
      const listeners = attendanceRefs.map((attRef, index) => {
        const onValCallback = (snap) => {
          attendanceValues[index] = snap.val();
          const val = attendanceValues
            .filter(Boolean)
            .reduce((latest, candidate) =>
              !latest || Number(candidate.scannedAt) >= Number(latest.scannedAt)
                ? candidate
                : latest,
            null);
          if (!val?.scannedAt) {
            attendanceMap.delete(eventId);
            return;
          }
          const previous = attendanceMap.get(eventId);
          attendanceMap.set(eventId, val);
          if (previous?.scannedAt === val.scannedAt) return;
          if (openQrEventId === eventId) openQrEventId = null;
          const ev = rawEventsMap.get(eventId);
          const evName = ev ? ev.name : "Event";
          const timeStr = formatTime(val.scannedAt);
          announce(`Checked in to ${evName} at ${timeStr}.`);
          showToast(`Checked in to ${evName}!`);
          renderHappeningNow();
          renderCalendarDayEvents();
        };
        onValue(attRef, onValCallback);
        return () => off(attRef, "value", onValCallback);
      });
      attendanceListeners.set(eventId, () => {
        listeners.forEach((unsubscribe) => unsubscribe());
      });
    }
  });
}

/* ---------------------------------------------------------
   RENDERING
--------------------------------------------------------- */

// 1. Top Bar Greeting & Date
function renderGreeting() {
  const now = Date.now();
  const greetingEl = document.getElementById("dashboardGreeting");
  const greetingNameEl = document.getElementById("greetingName");
  const todayDateEl = document.getElementById("todayDate");

  const prefix = getGreetingPrefix(now);
  const firstName = studentProfile.firstName || "";

  if (greetingEl) {
    greetingEl.innerHTML = `${prefix}${firstName ? `, <span id="greetingName">${escapeHtml(firstName)}</span>` : ""}`;
  } else if (greetingNameEl) {
    greetingNameEl.textContent = firstName;
  }

  if (todayDateEl) {
    todayDateEl.textContent = new Date(now).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }
}

// 2. Recommended for you (Matches preferences, soonest first)
function renderRecommended() {
  const container = document.getElementById("recGrid");
  if (!container) return;
  if (renderEventFetchState(container)) return;

  const now = getNow();
  const normalizePreference = normalizeSearchText;
  const userCategories = new Set(
    (studentPreferences.categories || [])
      .map(normalizePreference)
      .filter(Boolean),
  );
  const upcoming = Array.from(rawEventsMap.values())
    .filter((ev) => getEventClassification(ev, now) === "upcoming")
    .sort((a, b) => a.startMs - b.startMs);
  const matched = upcoming
    .filter((ev) =>
      isEventJoinable(ev, now) &&
      getEventCategories(ev).some((category) =>
        userCategories.has(normalizePreference(category)),
      ),
    );
  const recommendations = matched.length ? matched : upcoming;

  if (recommendations.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="width: 100%;">
        <div class="empty-state-title">No upcoming events at this time.</div>
        <div class="empty-state-sub">Update your <a href="StudentProfile.html#preferencesPanel" style="color: var(--maroon-700); text-decoration: underline;">preferences</a> to get personalized recommendations.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = recommendations
    .map((ev) => {
      const categories = getEventCategories(ev);
      const primaryCategory = categories[0] || "Academic & Learning";
      const sourceLabel =
        ev.source === "Organizational" && ev.organizationName
          ? `Organized by ${ev.organizationName}`
          : ev.source || "PUP Official";

      return `
        <article class="rec-card" id="rec-card-${ev.id}" data-event-id="${ev.id}">
          <div class="rec-category-row">
            <div class="rec-category-pills">
              <span class="category category-${categoryClass(primaryCategory)}">${escapeHtml(primaryCategory)}</span>
              ${categories.length > 1 ? `<span class="rec-category-more">+${categories.length - 1}</span>` : ""}
              <span class="rec-source-pill">${escapeHtml(sourceLabel)}</span>
            </div>
          </div>
          <h3>${escapeHtml(ev.name)}</h3>
          <div class="rec-when">${formatDate(ev.startMs)} · ${formatTime(ev.startMs)}</div>
          <div class="rec-venue">${escapeHtml(ev.venue)}</div>
          <div class="rec-match">${matched.length ? "Matches your preferences" : "Coming up soon"}</div>
          <button type="button" class="btn-outline btn-toggle-details rec-details-button" data-event-id="${ev.id}">Event Details</button>
        </article>
      `;
    })
    .join("");
}

function renderEventFetchState(container) {
  if (eventFetchError) {
    container.innerHTML = `
      <div class="empty-state" role="alert">
        <div class="empty-state-title">Events could not be loaded.</div>
        <div class="empty-state-sub">${escapeHtml(eventFetchError)}</div>
        <button type="button" class="btn-outline btn-retry-event-fetch">Retry</button>
      </div>
    `;
    return true;
  }
  if (eventFetchLoading && rawEventsMap.size === 0) {
    container.textContent = "Loading events...";
    return true;
  }
  return false;
}

// 3. Happening Now Section
function renderHappeningNow() {
  const container = document.getElementById("happeningNowList");
  const badge = document.getElementById("happeningLiveBadge");
  if (!container) return;
  const qrRenderRequestId = ++qrRenderGeneration;
  if (renderEventFetchState(container)) {
    if (badge) badge.hidden = true;
    return;
  }

  const now = getNow();
  const allEvents = Array.from(rawEventsMap.values());
  const liveEvents = allEvents.filter((ev) => getEventClassification(ev, now) === "live");

  // Keep attendance listeners in sync
  syncAttendanceListeners(liveEvents);

  // Update header badge
  if (badge) {
    if (liveEvents.length > 0) {
      badge.textContent = `${liveEvents.length} live`;
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  // Filter by search query
  const q = normalizeSearchText(state.query);
  const filtered = liveEvents.filter(matchesEventSearch);

  if (liveEvents.length === 0) {
    const upcoming = allEvents
      .filter((ev) => getEventClassification(ev, now) === "upcoming")
      .sort((a, b) => a.startMs - b.startMs);
    let nextMsg = "Check back soon.";
    if (upcoming.length > 0) {
      const nextDiff = upcoming[0].startMs - now;
      nextMsg = `Next event starts in ${formatStartsIn(nextDiff).replace("Starts in ", "")}.`;
    }
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No ongoing events</div>
        <div class="empty-state-sub">${nextMsg}</div>
      </div>
    `;
    return;
  }

  if (filtered.length === 0 && q) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No live events match “${escapeHtml(state.query)}”.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered
    .map((ev) => {
      const isRegistered = registeredEventIds.has(ev.id);
      const att = attendanceMap.get(ev.id);
      const isCheckedIn = Boolean(att && att.scannedAt);
      const isQrOpen = openQrEventId === ev.id;
      const isDetailsOpen = openDetailsEventIds.has(ev.id);

      // Progress bar
      const duration = Math.max(1, ev.endMs - ev.startMs);
      const elapsed = Math.max(0, now - ev.startMs);
      const pct = Math.min(100, Math.max(0, Math.round((elapsed / duration) * 100)));

      // Checked-in counter
      let checkedInText = "Be the first to check in";
      if (ev.checkedInCount > 0) {
        if (ev.capacity > 0) {
          checkedInText = `${ev.checkedInCount} / ${ev.capacity} checked in`;
        } else {
          checkedInText = `${ev.checkedInCount} student${ev.checkedInCount === 1 ? "" : "s"} checked in`;
        }
      }

      // Action button
      let actionHtml = "";
      if (isCheckedIn) {
        actionHtml = `<span class="tag-checked-in"><svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg> Checked in at ${formatTime(att.scannedAt)}</span>`;
      } else if (isRegistered) {
        actionHtml = `<button type="button" class="btn-primary-sm btn-toggle-qr" data-event-id="${ev.id}" aria-expanded="${isQrOpen}">${isQrOpen ? "Hide QR" : "Show my QR"}</button>`;
      } else {
        const registrationBlockReason = getRegistrationBlockReason(ev, now);
        if (registrationBlockReason) {
          actionHtml = `<button type="button" class="btn-disabled-sm" disabled>${registrationBlockReason}</button>`;
        } else {
          const isRegistering = pendingRegistrationIds.has(ev.id);
          actionHtml = `<button type="button" class="btn-primary-sm btn-register" data-event-id="${ev.id}" ${isRegistering ? "disabled aria-busy=\"true\"" : ""}>${isRegistering ? "Registering..." : "Register"}</button>`;
        }
      }

      // Inline QR Panel
      let qrPanelHtml = "";
      if (isQrOpen && !isCheckedIn) {
        qrPanelHtml = `
          <div class="inline-qr-panel" id="inlineQrPanel_${ev.id}" role="region" aria-label="Attendance QR Code">
            <div class="inline-qr-canvas-wrap">
              <canvas id="inlineQrCanvas_${ev.id}" width="150" height="150" aria-label="Attendance QR Code"></canvas>
            </div>
            <div class="inline-qr-name">${escapeHtml(studentProfile.fullName)}</div>
            <div class="inline-qr-sub">${escapeHtml([studentProfile.studentNo, studentProfile.organization].filter(Boolean).join(" · "))}</div>
            <div class="inline-qr-note">Show this at the entrance.</div>
            <div class="inline-qr-actions">
              <button type="button" class="btn-refresh-qr" data-event-id="${ev.id}">Refresh code</button>
              <button type="button" class="btn-hide-qr btn-toggle-qr" data-event-id="${ev.id}">Hide QR</button>
            </div>
          </div>
        `;
      }

      // Inline Details Panel
      let detailsPanelHtml = "";
      if (isDetailsOpen) {
        detailsPanelHtml = `
          <div class="inline-details-panel" id="inlineDetails_${ev.id}">
            <div class="inline-details-row">
              <span class="inline-details-label">About</span>
              <div class="inline-details-desc">${escapeHtml(ev.description)}</div>
            </div>
            <div class="inline-details-row">
              <span class="inline-details-label">Organizer</span>
              <div>${escapeHtml(ev.organizerName || "PUP Biñan Campus")} (${escapeHtml(ev.source || "Official")})</div>
            </div>
            ${renderPublicDocumentLinks(ev)}
            ${ev.capacity > 0 ? `<div class="inline-details-row"><span class="inline-details-label">Capacity</span><div>${ev.capacity} attendees (${ev.registeredCount} registered)</div></div>` : ""}
          </div>
        `;
      }

      const categories = getEventCategories(ev);
      const primaryCategory = categories[0] || "Academic & Learning";
      return `
        <article class="event-card event-card--live" id="live-card-${ev.id}" data-event-id="${ev.id}">
          <div class="event-body">
            <h3 class="event-title">${highlightMatch(ev.name, state.query)}</h3>
            <div class="event-top-row">
              <div class="event-card-categories">
                <span class="category category-${categoryClass(primaryCategory)}">${escapeHtml(primaryCategory)}</span>
                ${categories.length > 1 ? `<span class="rec-category-more">+${categories.length - 1}</span>` : ""}
              </div>
              <span class="tag-live"><span class="pulse-dot" aria-hidden="true"></span>Live</span>
              <span class="live-ends-in">${formatRemainingTime(ev.endMs - now)}</span>
              ${isRegistered && !isCheckedIn ? '<span class="tag-registered-small">Registered</span>' : ''}
            </div>
            <div class="event-meta">
              <span>${eventMetaIconClock()} ${formatTime(ev.startMs)}</span>
              <span>${eventMetaIconPin()} ${highlightMatch(ev.venue, state.query)}</span>
            </div>
            <div class="progress-bar-wrap" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Event progress (${pct}%)">
              <div class="progress-bar-fill" style="width: ${pct}%"></div>
            </div>
            <div class="event-foot">
              <span class="checked-in-count">
                <svg width="13" height="13" viewBox="0 0 20 20" fill="none"><path d="M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 18a7 7 0 0 1 14 0" stroke="currentColor" stroke-width="1.5"/></svg>
                ${checkedInText}
              </span>
              <div class="event-actions">
                ${actionHtml}
                <button type="button" class="btn-outline btn-toggle-details" data-event-id="${ev.id}" aria-expanded="${isDetailsOpen}">Details</button>
              </div>
            </div>
            ${qrPanelHtml}
            ${detailsPanelHtml}
          </div>
        </article>
      `;
    })
    .join("");

  // Trigger canvas drawing for active QR panel
  if (openQrEventId) {
    const eventId = openQrEventId;
    requestAnimationFrame(async () => {
      if (qrRenderRequestId !== qrRenderGeneration || eventId !== openQrEventId) return;
      const canvas = document.getElementById(`inlineQrCanvas_${eventId}`);
      const panel = document.getElementById(`inlineQrPanel_${eventId}`);
      if (!canvas || !canvas.isConnected || !panel) return;

      const note = panel.querySelector(".inline-qr-note");
      if (note) note.textContent = "Preparing QR code...";
      try {
        const payload = getDashboardQrPayload(eventId);
        await renderQrToCanvas(canvas, payload);
        if (qrRenderRequestId !== qrRenderGeneration || !canvas.isConnected) return;
        if (note) note.textContent = "Show this at the entrance.";
      } catch (error) {
        if (qrRenderRequestId !== qrRenderGeneration || !canvas.isConnected) return;
        console.error("Could not load the Dashboard attendance QR code:", error);
        if (note) {
          note.textContent = `Attendance QR could not be generated: ${error?.message || "Please try again."}`;
        }
      }
    });
  }
}

// 4. Upcoming Events Section
function renderUpcoming() {
  const container = document.getElementById("upcomingEventsList");
  if (!container) return;
  if (renderEventFetchState(container)) return;

  const now = getNow();
  const allEvents = Array.from(rawEventsMap.values());
  const upcomingEvents = allEvents
    .filter((ev) => getEventClassification(ev, now) === "upcoming")
    .sort((a, b) => a.startMs - b.startMs);

  const q = normalizeSearchText(state.query);
  const filtered = upcomingEvents.filter(matchesEventSearch);

  if (upcomingEvents.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No upcoming events.</div>
        <div class="empty-state-sub">Check back later for new events.</div>
      </div>
    `;
    return;
  }

  if (filtered.length === 0 && q) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No events match “${escapeHtml(state.query)}”.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered
    .slice(0, 3)
    .map((ev) => {
      const isRegistered = registeredEventIds.has(ev.id);
      const isDetailsOpen = openDetailsEventIds.has(ev.id);

      const evDate = new Date(ev.startMs);

      const dateParts = {
        month: evDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
        day: evDate.getDate(),
        year: evDate.getFullYear(),
      };
      let actionBtn = "";
      if (!isRegistered) {
        const registrationBlockReason = getRegistrationBlockReason(ev, now);
        if (registrationBlockReason) {
          actionBtn = `<button type="button" class="btn-disabled-sm" disabled>${registrationBlockReason}</button>`;
        } else {
          const isRegistering = pendingRegistrationIds.has(ev.id);
          actionBtn = `<button type="button" class="btn-primary-sm btn-register" data-event-id="${ev.id}" ${isRegistering ? "disabled aria-busy=\"true\"" : ""}>${isRegistering ? "Registering..." : "Register"}</button>`;
        }
      }

      let detailsPanelHtml = "";
      if (isDetailsOpen) {
        detailsPanelHtml = `
          <div class="inline-details-panel" id="inlineDetails_${ev.id}">
            <div class="inline-details-row">
              <span class="inline-details-label">About</span>
              <div class="inline-details-desc">${escapeHtml(ev.description)}</div>
            </div>
            <div class="inline-details-row">
              <span class="inline-details-label">Organizer</span>
              <div>${escapeHtml(ev.organizerName || "PUP Biñan Campus")} (${escapeHtml(ev.source || "Official")})</div>
            </div>
            ${renderPublicDocumentLinks(ev)}
            ${ev.capacity > 0 ? `<div class="inline-details-row"><span class="inline-details-label">Capacity</span><div>${ev.capacity} attendees (${ev.registeredCount} registered)</div></div>` : ""}
          </div>
        `;
      }

      const categories = getEventCategories(ev);
      const primaryCategory = categories[0] || "Academic & Learning";
      return `
        <article class="event-card" id="upcoming-card-${ev.id}" data-event-id="${ev.id}">
          <div class="event-date">
            <span class="mon">${dateParts.month}</span>
            <span class="day">${dateParts.day}</span>
            <span class="year">${dateParts.year}</span>
          </div>
          <div class="event-body">
            <h3 class="event-title">${highlightMatch(ev.name, state.query)}</h3>
            <div class="event-top-row">
              <div class="event-card-categories">
                <span class="category category-${categoryClass(primaryCategory)}">${escapeHtml(primaryCategory)}</span>
                ${categories.length > 1 ? `<span class="rec-category-more">+${categories.length - 1}</span>` : ""}
              </div>
              ${isRegistered ? '<span class="tag-registered-small">Registered</span>' : ''}
            </div>
            <div class="event-meta">
              <span>${eventMetaIconClock()} ${formatTime(ev.startMs)}</span>
              <span>${eventMetaIconPin()} ${highlightMatch(ev.venue, state.query)}</span>
            </div>
            <div class="event-foot">
              <span class="slots">${ev.capacity > 0 ? `${Math.max(0, Math.min(ev.capacity, ev.capacity - ev.registeredCount))} slots left` : "Open registration"}</span>
              <div class="event-actions">
                ${actionBtn}
                <button type="button" class="btn-outline btn-toggle-details" data-event-id="${ev.id}" aria-expanded="${isDetailsOpen}">Details</button>
              </div>
            </div>
            ${detailsPanelHtml}
          </div>
        </article>
      `;
    })
    .join("");
}

// 5. Calendar Preview Grid & Day Events
function renderCalendar() {
  const calMonthLabel = document.getElementById("calMonthLabel");
  const calDays = document.getElementById("calDays");
  if (!calDays || !calMonthLabel) return;

  calDays.innerHTML = "";
  syncMonthHolidays();

  const now = getNow();
  const year = state.calYear;
  const month = state.calMonth;
  calMonthLabel.textContent = `${MONTH_NAMES[month]} ${year}`;

  const firstDay = new Date(year, month, 1).getDay(); // 0 is Sunday
  const lastDate = new Date(year, month + 1, 0).getDate();
  const prevMonthLastDate = new Date(year, month, 0).getDate();

  const nowDate = new Date(now);
  const isCurrentMonth = nowDate.getFullYear() === year && nowDate.getMonth() === month;
  const todayDateNum = nowDate.getDate();

  const selYear = state.calSelectedDate.getFullYear();
  const selMonth = state.calSelectedDate.getMonth();
  const selDateNum = state.calSelectedDate.getDate();

  const allEvents = Array.from(rawEventsMap.values());

  let html = "";

  // Trailing days from previous month
  for (let i = firstDay - 1; i >= 0; i--) {
    const d = prevMonthLastDate - i;
    html += `<button type="button" class="cal-day is-muted" tabindex="-1" disabled aria-hidden="true"><span class="cal-day-number">${d}</span></button>`;
  }

  // Days of current month
  for (let d = 1; d <= lastDate; d++) {
    const isToday = isCurrentMonth && d === todayDateNum;
    const isSelected = selYear === year && selMonth === month && selDateNum === d;

    const classes = ["cal-day"];
    if (isToday) classes.push("is-today");
    if (isSelected) classes.push("is-selected");

    const isoStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const holidaysOnDay = currentMonthHolidays.filter((h) => h.date === isoStr);
    const eventsOnDay = allEvents.filter(
      (ev) => calendarEventDateRange(ev)?.start === isoStr,
    );
    let dotsHtml = "";
    if (eventsOnDay.length > 0 || holidaysOnDay.length > 0) {
      const liveEvents = eventsOnDay.filter((ev) => getEventClassification(ev, now) === "live");
      const registeredEvents = eventsOnDay.filter((ev) => registeredEventIds.has(ev.id));
      const hasHoliday = holidaysOnDay.length > 0 || eventsOnDay.some(isHolidayEvent);
      const hasOther = eventsOnDay.some((ev) => !registeredEventIds.has(ev.id) && !isHolidayEvent(ev));
      const eventTitles = (events) =>
        events.map((ev) => ev.name || ev.title || "Untitled event").join(", ");

      const indicators = [];
      if (liveEvents.length) {
        indicators.push(`<span class="cal-event-dot dot-live" title="${escapeHtml(`Live: ${eventTitles(liveEvents)}`)}"></span>`);
      }
      if (registeredEvents.length) {
        indicators.push(`<span class="cal-event-dot dot-registered" title="${escapeHtml(`Registered: ${eventTitles(registeredEvents)}`)}"></span>`);
      }
      if (hasHoliday && indicators.length < 3) {
        const holidayTitles = [
          ...holidaysOnDay.map((holiday) => holiday.title),
          ...eventsOnDay.filter(isHolidayEvent).map((ev) => ev.name || ev.title || "Holiday"),
        ];
        indicators.push(`<span class="cal-event-dot dot-holiday" title="${escapeHtml(`Holiday: ${holidayTitles.join(", ")}`)}"></span>`);
      }
      if (hasOther && indicators.length < 3) {
        const otherEvents = eventsOnDay.filter((ev) => !registeredEventIds.has(ev.id) && !isHolidayEvent(ev));
        indicators.push(`<span class="cal-event-dot dot-other" title="${escapeHtml(`Event: ${eventTitles(otherEvents)}`)}"></span>`);
      }

      dotsHtml = `<span class="cal-day-indicators">${indicators.slice(0, 3).join("")}</span>`;
    } else {
      dotsHtml = '<span class="cal-day-indicators"></span>';
    }
    html += `
      <button
        type="button"
        class="${classes.join(" ")}"
        data-date="${isoStr}"
        data-day="${d}"
        aria-label="${d} ${MONTH_NAMES[month]} ${year}${eventsOnDay.length ? `, ${eventsOnDay.length} events` : ""}"
        aria-pressed="${isSelected}"
      >
        <span class="cal-day-number">${d}</span>
        ${dotsHtml}
      </button>
    `;
  }

  // Trailing days into next month to complete row of 7
  const totalDaysRendered = firstDay + lastDate;
  const nextDays = (7 - (totalDaysRendered % 7)) % 7;
  for (let d = 1; d <= nextDays; d++) {
    html += `<button type="button" class="cal-day is-muted" tabindex="-1" disabled aria-hidden="true"><span class="cal-day-number">${d}</span></button>`;
  }

  calDays.innerHTML = html;
  renderCalendarDayEvents();
}

function renderCalendarDayEvents() {
  const container = document.getElementById("calDayEvents");
  if (!container) return;
  container.innerHTML = "";
  if (eventFetchError) {
    container.innerHTML = `
      <div class="empty-state" role="alert">
        <div class="empty-state-title">Events could not be loaded.</div>
        <div class="empty-state-sub">${escapeHtml(eventFetchError)}</div>
        <button type="button" class="btn-outline btn-retry-event-fetch">Retry</button>
      </div>
    `;
    return;
  }
  if (eventFetchLoading && rawEventsMap.size === 0) {
    container.textContent = "Loading events...";
    return;
  }

  const now = getNow();
  const selDate = state.calSelectedDate;
  const year = selDate.getFullYear();
  const month = selDate.getMonth();
  const day = selDate.getDate();
  const selIso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const dateLabel = selDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const holidaysOnDay = currentMonthHolidays.filter((h) => h.date === selIso);
  const allEvents = Array.from(rawEventsMap.values());
  const matching = allEvents.filter(
    (ev) => calendarEventDateRange(ev)?.start === selIso,
  );

  // Render Holidays (No Event Details modal, just the name of the Holiday)
  const holidayRowsHtml = holidaysOnDay
    .map(
      (h) => `
        <div class="cal-selected-event cal-selected-event--holiday" style="cursor: default;" aria-label="${escapeHtml(h.title)} (Holiday)">
          <span class="cal-event-marker dot-holiday"></span>
          <div class="cal-selected-event-copy" style="flex:1;">
            <strong>${escapeHtml(h.title)}</strong>
            <small>Holiday</small>
          </div>
        </div>
      `,
    )
    .join("");

  // Render events (and handle any events that are holidays without action buttons)
  const eventRowsHtml = matching
    .map((ev) => {
      if (isHolidayEvent(ev)) {
        return `
          <div class="cal-selected-event cal-selected-event--holiday" style="cursor: default;" aria-label="${escapeHtml(ev.name)} (Holiday)">
            <span class="cal-event-marker dot-holiday"></span>
            <div class="cal-selected-event-copy" style="flex:1;">
              <strong>${escapeHtml(ev.name)}</strong>
              <small>Holiday</small>
            </div>
          </div>
        `;
      }

      const classification = getEventClassification(ev, now);

      let tagClass = "dot-other";
      if (classification === "live") {
        tagClass = "dot-live";
      }

      return `
        <div class="cal-selected-event">
          <span class="cal-event-marker ${tagClass}"></span>
          <div class="cal-selected-event-copy" style="flex:1;">
            <strong>${escapeHtml(ev.name)}</strong>
            <small>${formatTime(ev.startMs)} · ${escapeHtml(ev.venue)}</small>
          </div>
        </div>
      `;
    })
    .join("");

  let eventsHtml = "";
  if (holidaysOnDay.length === 0 && matching.length === 0) {
    eventsHtml = '<p class="cal-day-empty">No events on this day.</p>';
  } else {
    eventsHtml = `${holidayRowsHtml}${eventRowsHtml}`;
  }

  const isoStr = selIso;

  container.innerHTML = `
    <div class="cal-day-events-heading" style="display:flex; justify-content:space-between; align-items:center;">
      <span>${dateLabel}</span>
      <a href="Events.html?from=${isoStr}&to=${isoStr}" class="cal-open-day-link" style="font-size: 11.5px; font-weight: 600; color: var(--maroon-700); text-decoration: underline;" title="View this day in Events">View Events</a>
    </div>
    <div class="cal-selected-events">${eventsHtml}</div>
  `;
}

/* ---------------------------------------------------------
   USER ACTIONS: Register & Cancel Registration
--------------------------------------------------------- */
function registrationFailure(message) {
  return { success: false, message };
}

async function handleRegister(eventId) {
  if (!eventId) return registrationFailure("This event is no longer available.");
  if (pendingRegistrationIds.has(eventId)) {
    return registrationFailure("Registration is already in progress.");
  }
  if (registeredEventIds.has(eventId)) {
    const message = "You are already registered for this event.";
    showToast(message);
    announce(message);
    return registrationFailure(message);
  }

  pendingRegistrationIds.add(eventId);
  try {
    renderHappeningNow();
    renderUpcoming();
    renderRecommended();
    renderCalendar();
    return await performRegistration(eventId);
  } finally {
    pendingRegistrationIds.delete(eventId);
    renderHappeningNow();
    renderUpcoming();
    renderRecommended();
    renderCalendar();
  }
}

async function performRegistration(eventId) {
  try {
    systemAccessSettings = await readSystemAccessSettings(db);
  } catch (error) {
    if (isResourceExhausted(error)) {
    systemAccessSettings = getCachedSystemAccessSettings();
    const notice = "Firestore is busy. Using your last available registration settings.";
    console.warn("[StudentDashboard] Using cached registration settings after quota exhaustion.");
    showToast(notice);
    announce(notice);
    } else {
    console.error("[StudentDashboard] Could not verify event registration availability:", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
    });
    const message = "Could not verify event registration availability. Check your connection and try again.";
    showToast(message);
    return registrationFailure(message);
    }
  }
  if (!systemAccessSettings.eventRegistrationEnabled) {
    showToast(EVENT_REGISTRATION_CLOSED_MESSAGE);
    announce(EVENT_REGISTRATION_CLOSED_MESSAGE);
    renderHappeningNow();
    renderUpcoming();
    renderRecommended();
    renderCalendar();
    return registrationFailure(EVENT_REGISTRATION_CLOSED_MESSAGE);
  }

  const ev = rawEventsMap.get(eventId);
  if (!ev) {
    showToast("This event is no longer available. Refresh and try again.");
    return registrationFailure("This event is no longer available. Refresh and try again.");
  }
  if (!auth?.currentUser) {
    const message = "Please sign in again before registering.";
    showToast(message);
    announce("Sign in is required to register for events.");
    return registrationFailure(message);
  }
  const uid = String(auth.currentUser.uid || "").trim();
  if (!uid) {
    const message = "Your session is not ready. Please try again.";
    showToast(message);
    announce("Your session is not ready.");
    return registrationFailure(message);
  }
  if (!isRtdbConfigured || !rtdb) {
    const message = "Registration is unavailable right now. Please try again later.";
    showToast(message);
    announce("Registration is unavailable.");
    return registrationFailure(message);
  }

  const registrationBlockReason = getRegistrationBlockReason(ev);
  if (registrationBlockReason) {
    showToast(registrationBlockReason);
    announce(registrationBlockReason);
    return registrationFailure(registrationBlockReason);
  }

  renderHappeningNow();
  renderUpcoming();
  renderRecommended();
  renderCalendar();
  announce(`Registering for ${ev.name}...`);

  try {
    const registeredAt = Date.now();
    await writeEventRegistration({
      rtdb,
      db,
      eventId,
      uid,
      status: "registered",
      registeredAt,
      cancelledAt: null,
      at: registeredAt,
      student: {
        name: studentProfile.fullName,
        studentNo: studentProfile.studentNo,
        organization: studentProfile.organization,
      },
    });

    registeredEventIds.add(eventId);
    const nextRegisteredCount = Math.max(0, Number(ev.registeredCount) || 0) + 1;
    ev.registeredCount = Number.isFinite(ev.capacity) && ev.capacity > 0
      ? Math.min(ev.capacity, nextRegisteredCount)
      : nextRegisteredCount;
    saveParticipationsToStorage();
    const now = getNow();
    if (getEventClassification(ev, now) === "live") {
      syncAttendanceListeners([ev]);
    }
    announce(`Registered for ${ev.name}.`);
    showToast(`Registered for ${ev.name}`);
  } catch (err) {
    console.error("registerForEvent failed:", err);
    const errorCode = String(err?.code || "").toLowerCase();
    const errorText = String(err?.message || "").toLowerCase();
    let message = err?.message || "Could not register for this event. Please try again.";
    if (
      errorCode.includes("resource-exhausted") ||
      errorCode === "429" ||
      errorText.includes("too many requests") ||
      /\b429\b/.test(errorText)
    ) {
      message = "Registration is busy right now. Please wait a moment and try again.";
    } else if (
      errorCode === "already-registered" ||
      errorCode.includes("already-exists") ||
      errorText.includes("already registered") ||
      errorCode.includes("permission-denied") && registeredEventIds.has(eventId)
    ) {
      message = "You are already registered for this event.";
    } else if (errorText.includes("currently closed by the administrator")) {
      message = EVENT_REGISTRATION_CLOSED_MESSAGE;
    } else if (
      errorText.includes("registration closed") ||
      errorText.includes("registration is closed") ||
      errorText.includes("deadline")
    ) {
      message = "Registration Closed";
    } else if (errorText.includes("fully booked") || errorText.includes("full")) {
      message = "Fully Booked";
    } else if (errorCode.includes("permission-denied")) {
      message = "Registration was denied by Realtime Database security rules. Please contact an administrator.";
    }
    showToast(message);
    announce(message);
    return registrationFailure(message);
  }
  return true;
}

async function handleCancelRegistration(eventId) {
  const ev = rawEventsMap.get(eventId);
  const evName = ev ? ev.name : "event";
  const wasRegistered = registeredEventIds.has(eventId);

  // Optimistic update
  registeredEventIds.delete(eventId);
  saveParticipationsToStorage();

  if (openQrEventId === eventId) {
    openQrEventId = null;
  }

  if (attendanceListeners.has(eventId)) {
    const unsub = attendanceListeners.get(eventId);
    unsub();
    attendanceListeners.delete(eventId);
  }
  attendanceMap.delete(eventId);

  renderHappeningNow();
  renderUpcoming();
  renderRecommended();
  renderCalendar();

  announce(`Cancelled registration for ${evName}.`);
  showToast(`Cancelled registration for ${evName}`);

  if (!isRtdbConfigured || !rtdb || !auth?.currentUser?.uid) {
    registeredEventIds.add(eventId);
    saveParticipationsToStorage();
    renderHappeningNow();
    renderUpcoming();
    renderRecommended();
    renderCalendar();
    const message = "Registration is unavailable right now. Please try again later.";
    showToast(message);
    announce(message);
    return false;
  }

  try {
    const uid = String(auth.currentUser.uid);
    if (ev?.endMs && getNow() >= ev.endMs) {
      throw new Error("Registration can't be cancelled after the event ends.");
    }
    const cancelledAt = Date.now();
    await writeEventRegistration({
      rtdb,
      db,
      eventId,
      uid,
      status: "cancelled",
      registeredAt: cancelledAt,
      cancelledAt,
      at: cancelledAt,
      student: {
        name: studentProfile.fullName,
        studentNo: studentProfile.studentNo,
        organization: studentProfile.organization,
      },
    });
    if (wasRegistered && ev) {
      ev.registeredCount = Math.max(0, (Number(ev.registeredCount) || 0) - 1);
    }
  } catch (err) {
    console.warn("cancelRegistration notice:", err);
    registeredEventIds.add(eventId);
    saveParticipationsToStorage();
    renderHappeningNow();
    renderUpcoming();
    renderRecommended();
    renderCalendar();
    const msg = err.message || "Could not cancel registration.";
    showToast(msg);
    announce(msg);
    return false;
  }
  return true;
}

window.recovibeRegisterForEvent = handleRegister;
window.recovibeCancelRegistration = handleCancelRegistration;

/* ---------------------------------------------------------
   REALTIME DATABASE LISTENERS & SYNC
--------------------------------------------------------- */
function syncRegistrationsFromRtdb(eventsList) {
  if (!currentUid || !isRtdbConfigured || !rtdb) return;
  if (registrationListenerUid !== currentUid) {
    firestoreRegistrationUnsubscribe?.();
    rtdbRegistrationUnsubscribe?.();
    firestoreRegistrationUnsubscribe = null;
    rtdbRegistrationUnsubscribe = null;
    firestoreRegistrationRecords.clear();
    rtdbRegistrationRecords.clear();
    registrationListenerUid = currentUid;
  }
  if (rtdbRegistrationUnsubscribe) return;

  const listenerUid = currentUid;
  rtdbRegistrationUnsubscribe = onValue(
    ref(rtdb, `userRegistrations/${listenerUid}`),
    (snapshot) => {
      if (currentUid !== listenerUid) return;
      rtdbRegistrationRecords.clear();
      Object.entries(snapshot.val() || {}).forEach(([eventId, registration]) => {
        rtdbRegistrationRecords.set(eventId, registration);
      });
      applyMergedRegistrationStates();
    },
    (error) => console.warn("Could not load RTDB student registrations:", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
    }),
  );
}

function syncRegistrationsFromFirestore(eventsList) {
  if (!currentUid || !db || !isFirebaseConfigured || firestoreRegistrationUnsubscribe) return;
  const listenerUid = currentUid;
  firestoreRegistrationUnsubscribe = onSnapshot(
    query(
      collectionGroup(db, "registrations"),
      where("uid", "==", listenerUid),
    ),
    (snapshot) => {
      if (currentUid !== listenerUid) return;
      firestoreRegistrationRecords.clear();
      snapshot.forEach((registrationDocument) => {
        const eventId = registrationDocument.ref.parent.parent?.id;
        if (!eventId) return;
        firestoreRegistrationRecords.set(eventId, {
          ...registrationDocument.data(),
          uid: registrationDocument.data().uid || listenerUid,
        });
      });
      applyMergedRegistrationStates();
    },
    (error) => console.warn("Firestore student registrations are unavailable:", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
    }),
  );
}

function applyMergedRegistrationStates() {
  const merged = mergeUserRegistrationMaps(
    firestoreRegistrationRecords,
    rtdbRegistrationRecords,
  );
  let changed = false;
  merged.forEach((registration, eventId) => {
    const wasRegistered = registeredEventIds.has(eventId);
    const isRegistered = isRegistrationActive(registration);
    if (isRegistered) registeredEventIds.add(eventId);
    else registeredEventIds.delete(eventId);
    changed ||= wasRegistered !== isRegistered;
  });
  if (!changed) return;
  saveParticipationsToStorage();
  renderHappeningNow();
  renderUpcoming();
  renderRecommended();
  renderCalendar();
}

function initDataListeners(authenticatedUser = auth?.currentUser) {
  unsubscribeFirestoreEvents?.();
  unsubscribeFirestoreEvents = null;
  clearTimeout(realtimeEventsTimeout);
  realtimeEventsLoaded = !isRtdbConfigured;
  if (isRtdbConfigured) {
    realtimeEventsTimeout = window.setTimeout(() => {
      realtimeEventsLoaded = true;
      signalPageLoadReady();
    }, 8000);
  }
  if (!authenticatedUser) {
    eventFetchLoading = false;
    eventFetchError = "Sign in to load student events.";
    renderHappeningNow();
    renderUpcoming();
    renderRecommended();
    renderCalendar();
    signalPageLoadReady();
  }
  if (isFirebaseConfigured && db && authenticatedUser) {
    eventFetchLoading = true;
    eventFetchError = null;
    const handleEventsSnapshot = (snapshot) => {
      clearTimeout(eventFetchTimeout);
      eventFetchTimeout = null;
      eventFetchLoading = false;
      eventFetchError = null;
      const publishedEvents = new Map();
      snapshot.docs.forEach((eventDocument) => {
        const event = normalizeFirestoreStudentEvent(eventDocument);
        if (!event) return;
        const realtimeEvent = realtimeEventsMap.get(event.id);
        if (realtimeEvent) {
          event.registeredCount = realtimeEvent.registeredCount ?? event.registeredCount;
          event.checkedInCount = realtimeEvent.checkedInCount ?? event.checkedInCount;
        }
        publishedEvents.set(event.id, event);
      });
      firestoreEventsMap = publishedEvents;
      rebuildStudentEvents();
      signalPageLoadReady();
    };
    const listenForEvents = (eventsQuery) => {
      clearTimeout(eventFetchTimeout);
      eventFetchTimeout = window.setTimeout(() => {
        if (!eventFetchLoading) return;
        unsubscribeFirestoreEvents?.();
        unsubscribeFirestoreEvents = null;
        eventFetchLoading = false;
        eventFetchError = "Events are taking longer than expected. Check your connection and retry.";
        renderHappeningNow();
        renderUpcoming();
        renderRecommended();
        renderCalendar();
        signalPageLoadReady();
      }, 8000);
      try {
        unsubscribeFirestoreEvents = onSnapshot(
          eventsQuery,
          handleEventsSnapshot,
          (error) => {
            console.error("Event Fetch Error:", error);
            clearTimeout(eventFetchTimeout);
            eventFetchTimeout = null;
            eventFetchLoading = false;
            eventFetchError = error?.code === "permission-denied"
              ? "Your account cannot read published events. Check your sign-in and Firestore access."
              : "Check your connection and try again.";
            renderHappeningNow();
            renderUpcoming();
            renderRecommended();
            renderCalendar();
            signalPageLoadReady();
          },
        );
      } catch (error) {
        console.error("Event Fetch Error:", error);
        clearTimeout(eventFetchTimeout);
        eventFetchTimeout = null;
        eventFetchLoading = false;
        eventFetchError = error?.code === "permission-denied"
          ? "Your account cannot read published events. Check your sign-in and Firestore access."
          : "Check your connection and try again.";
        renderHappeningNow();
        renderUpcoming();
        renderRecommended();
        renderCalendar();
        signalPageLoadReady();
      }
    };
    const publishedEventsQuery = () =>
      query(
        collection(db, "events"),
        where("status", "in", STUDENT_EVENT_QUERY_STATUSES),
        limit(150),
      );
    retryEventFetch = () => {
      unsubscribeFirestoreEvents?.();
      eventFetchLoading = true;
      eventFetchError = null;
      renderHappeningNow();
      renderUpcoming();
      renderRecommended();
      renderCalendar();
      listenForEvents(publishedEventsQuery());
    };
    try {
      listenForEvents(publishedEventsQuery());
    } catch (error) {
      console.error("Event Fetch Error:", error);
      clearTimeout(eventFetchTimeout);
      eventFetchTimeout = null;
      eventFetchLoading = false;
      eventFetchError = error?.code === "permission-denied"
        ? "Your account cannot read published events. Check your sign-in and Firestore access."
        : "Check your connection and try again.";
      renderHappeningNow();
      renderUpcoming();
      renderRecommended();
      renderCalendar();
      signalPageLoadReady();
    }
    activeCleanups.push(() => {
      clearTimeout(eventFetchTimeout);
      unsubscribeFirestoreEvents?.();
    });
  } else if (authenticatedUser) {
    eventFetchLoading = false;
    eventFetchError = "Event services are unavailable. Please retry.";
    renderHappeningNow();
    renderUpcoming();
    renderRecommended();
    renderCalendar();
    signalPageLoadReady();
  }

  // 1. Server time offset
  if (isRtdbConfigured) {
    const offsetRef = ref(rtdb, ".info/serverTimeOffset");
    const onOffset = (snap) => {
      serverTimeOffset = Number(snap.val() || 0);
      renderGreeting();
      renderHappeningNow();
      renderUpcoming();
      renderRecommended();
      renderCalendar();
    };
    onValue(offsetRef, onOffset);
    activeCleanups.push(() => off(offsetRef, "value", onOffset));
  }

  // 2. Public Events query
  if (isRtdbConfigured) {
    const eventsQuery = ref(rtdb, "publicEvents");

    const onEvents = (snap) => {
      const data = snap.val() || {};
      const newMap = new Map();
      Object.entries(data).forEach(([id, item]) => {
        if (item && isStudentEventPublished(item)) {
          newMap.set(id, normalizeEvent(id, item));
        }
      });
      realtimeEventsMap = newMap;
      realtimeEventsLoaded = true;
      clearTimeout(realtimeEventsTimeout);
      realtimeEventsTimeout = null;
      rebuildStudentEvents();
      signalPageLoadReady();
    };

    const onEventsError = (error) => {
      console.error("Could not load real-time student events:", error);
      realtimeEventsLoaded = true;
      clearTimeout(realtimeEventsTimeout);
      realtimeEventsTimeout = null;
      signalPageLoadReady();
    };
    onValue(eventsQuery, onEvents, onEventsError);
    activeCleanups.push(() => {
      clearTimeout(realtimeEventsTimeout);
      off(eventsQuery, "value", onEvents);
    });
  } else {
    realtimeEventsLoaded = true;
    loadFallbackEvents();
    renderHappeningNow();
    renderUpcoming();
    renderRecommended();
    renderCalendar();
    signalPageLoadReady();
  }
}

/* ---------------------------------------------------------
   INTERACTION WIRING
--------------------------------------------------------- */
function wireEvents() {
  // Search input: filters Happening now and Upcoming events together
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.query = e.target.value.trim();
      renderHappeningNow();
      renderUpcoming();
    });
  }

  // Calendar prev/next navigation
  const calPrev = document.getElementById("calPrev");
  const calNext = document.getElementById("calNext");
  if (calPrev) {
    calPrev.addEventListener("click", () => {
      if (state.calMonth === 0) {
        state.calMonth = 11;
        state.calYear -= 1;
      } else {
        state.calMonth -= 1;
      }
      renderCalendar();
    });
  }
  if (calNext) {
    calNext.addEventListener("click", () => {
      if (state.calMonth === 11) {
        state.calMonth = 0;
        state.calYear += 1;
      } else {
        state.calMonth += 1;
      }
      renderCalendar();
    });
  }

  // Calendar day selection
  const calDays = document.getElementById("calDays");
  if (calDays) {
    calDays.addEventListener("click", (e) => {
      const btn = e.target.closest(".cal-day:not(.is-muted)");
      if (!btn) return;
      const dayNum = Number(btn.getAttribute("data-day"));
      if (dayNum) {
        state.calSelectedDate = new Date(state.calYear, state.calMonth, dayNum);
        renderCalendar();
      }
    });
  }

  // Event delegation for actions (Register, Cancel, QR toggle, Details toggle)
  document.addEventListener("click", (e) => {
    const retryBtn = e.target.closest(".btn-retry-event-fetch");
    if (retryBtn) {
      e.preventDefault();
      eventFetchError = null;
      eventFetchLoading = true;
      renderHappeningNow();
      renderUpcoming();
      if (retryEventFetch && auth?.currentUser) {
        retryEventFetch();
      } else {
        eventFetchLoading = false;
        eventFetchError = auth?.currentUser
          ? "Event fetching is not available. Reload the dashboard and try again."
          : "Sign in to load student events.";
        renderHappeningNow();
        renderUpcoming();
        renderRecommended();
        renderCalendar();
      }
      return;
    }

    // Register
    const regBtn = e.target.closest(".btn-register");
    if (regBtn) {
      e.preventDefault();
      e.stopPropagation();
      const eventId = regBtn.getAttribute("data-event-id");
      const event = eventId && rawEventsMap.get(eventId);
      if (event && window.RecovibeStudentEventDetails) {
        const opened =
          window.RecovibeStudentEventDetails.openRegistrationConfirmation(
            getDashboardEventDetails(eventId, event),
          );
        if (!opened) showToast("This event is no longer available for registration.");
      } else {
        showToast("Event details are unavailable. Please try again.");
      }
      return;
    }

    // Toggle Inline QR
    const refreshQrBtn = e.target.closest(".btn-refresh-qr");
    if (refreshQrBtn) {
      e.preventDefault();
      const eventId = refreshQrBtn.getAttribute("data-event-id");
      if (eventId && eventId === openQrEventId) {
        attendanceQrPayloads.delete(`${currentUid}:${eventId}`);
        renderHappeningNow();
      }
      return;
    }

    const qrBtn = e.target.closest(".btn-toggle-qr");
    if (qrBtn) {
      e.preventDefault();
      const eventId = qrBtn.getAttribute("data-event-id");
      if (eventId) {
        attendanceQrPayloads.delete(`${currentUid}:${eventId}`);
        openQrEventId = openQrEventId === eventId ? null : eventId;
        renderHappeningNow();
      }
      return;
    }

    // Toggle Details
    const detailsBtn = e.target.closest(".btn-toggle-details");
    if (detailsBtn) {
      e.preventDefault();
      const eventId = detailsBtn.getAttribute("data-event-id");
      if (eventId) {
        const event = rawEventsMap.get(eventId);
        if (event && window.RecovibeStudentEventDetails) {
          window.RecovibeStudentEventDetails.open(
            getDashboardEventDetails(eventId, event),
            { dashboard: true },
          );
          return;
        }
        if (openDetailsEventIds.has(eventId)) {
          openDetailsEventIds.delete(eventId);
        } else {
          openDetailsEventIds.add(eventId);
        }
        renderHappeningNow();
        renderUpcoming();
      }
      return;
    }
  });

  // Preferences updated event
  window.addEventListener("recovibe:preferences-updated", () => {
    loadStudentPreferences();
    renderRecommended();
  });
  window.addEventListener("storage", (e) => {
    if (
      e.key === "recovibeUserPreferences" ||
      e.key === "recovibeStudentPreferences" ||
      e.key === "recovibePreferences" ||
      e.key === "recovibePreferencesUpdated" ||
      String(e.key || "").startsWith("recovibePreferences:")
    ) {
      loadStudentPreferences();
      renderRecommended();
    }
    if (e.key === `recovibeParticipations:${currentUid}`) {
      registeredEventIds = new Set(readParticipationsFromStorage());
      renderHappeningNow();
      renderUpcoming();
      renderRecommended();
      renderCalendar();
    }
  });
}

function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  try {
    localStorage.removeItem("sidebarCollapsed");
    sidebar.classList.remove("is-collapsed");
  } catch {}

  renderStudentSidebar(studentProfile);
}

function initOfflineSupport() {
  window.addEventListener("offline", () => {
    showToast("You are offline. Showing cached events.");
  });
}

/* ---------------------------------------------------------
   LIFECYCLE & CLEANUP
--------------------------------------------------------- */
function setupCleanup() {
  const handleAccessSettingsChanged = (event) => {
    if (event.detail?.error) return;
    systemAccessSettings = {
      ...systemAccessSettings,
      ...event.detail,
    };
    renderHappeningNow();
    renderUpcoming();
    renderRecommended();
    renderCalendar();
  };
  window.addEventListener(
    "system-access-settings-changed",
    handleAccessSettingsChanged,
  );

  const cleanupAll = () => {
    if (tickInterval) clearInterval(tickInterval);
    attendanceListeners.forEach((unsub) => unsub());
    attendanceListeners.clear();
    firestoreRegistrationUnsubscribe?.();
    rtdbRegistrationUnsubscribe?.();
    firestoreRegistrationUnsubscribe = null;
    rtdbRegistrationUnsubscribe = null;
    registrationListenerUid = null;
    activeCleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch (e) {}
    });
    window.removeEventListener(
      "system-access-settings-changed",
      handleAccessSettingsChanged,
    );
  };

  window.addEventListener("beforeunload", cleanupAll);
  window.addEventListener("pagehide", cleanupAll);
}

/* ---------------------------------------------------------
   INIT
--------------------------------------------------------- */
function init() {
  initSidebar();
  renderGreeting();
  renderRecommended();
  renderCalendar();
  initOfflineSupport();
  wireEvents();
  setupCleanup();

  // Evaluate event state every 30 seconds
  tickInterval = setInterval(() => {
    renderGreeting();
    renderHappeningNow();
    renderUpcoming();
    renderRecommended();
    renderCalendar();
  }, 30000);

  // Auth state listener
  if (auth) {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        currentUid = null;
        firestoreRegistrationUnsubscribe?.();
        rtdbRegistrationUnsubscribe?.();
        firestoreRegistrationUnsubscribe = null;
        rtdbRegistrationUnsubscribe = null;
        registrationListenerUid = null;
        firestoreRegistrationRecords.clear();
        rtdbRegistrationRecords.clear();
        attendanceQrPayloads.clear();
        registeredEventIds.clear();
        rawEventsMap.clear();
        clearCachedStudentProfile();
        window.location.replace("StudentLogin.html");
        return;
      }

      if (currentUid && currentUid !== user.uid) {
        firestoreRegistrationUnsubscribe?.();
        rtdbRegistrationUnsubscribe?.();
        firestoreRegistrationUnsubscribe = null;
        rtdbRegistrationUnsubscribe = null;
        registrationListenerUid = null;
        firestoreRegistrationRecords.clear();
        rtdbRegistrationRecords.clear();
        attendanceQrPayloads.clear();
        registeredEventIds.clear();
        rawEventsMap.clear();
        firestoreEventsMap.clear();
        realtimeEventsMap.clear();
        Object.keys(studentProfile).forEach((key) => delete studentProfile[key]);
        renderStudentSidebar({});
        renderGreeting();
        renderRecommended();
        renderCalendar();
      }
      currentUid = user.uid;
      try {
        const profile = await loadStudentProfile(user);
        if (auth.currentUser?.uid !== user.uid) return;
        mountHelpBot({
          role: "student",
          ai: { firebaseConfig: app.options },
          getEvents: () => Array.from(rawEventsMap.values()),
          getStudentContext: () => ({
            interests: [
              studentProfile.interests,
              ...studentPreferences.categories,
              ...studentPreferences.tags,
            ],
            programs: [studentProfile.program, studentProfile.course],
            departments: studentProfile.departments,
            organizations: [
              studentProfile.organization,
              studentProfile.courseOrganization,
              studentProfile.StudentOrgs,
            ],
            preferredOrganizations: studentPreferences.organizations,
            pastEventIds: Array.from(registeredEventIds),
          }),
        });

        Object.keys(studentProfile).forEach((key) => delete studentProfile[key]);
        Object.assign(studentProfile, profile);
        const fullName = String(
          profile.fullName ||
            profile.name ||
            [profile.firstName, profile.middleName, profile.lastName]
              .filter(Boolean)
              .join(" "),
        ).trim();
        studentProfile.firstName = profile.firstName || fullName.split(/\s+/)[0] || "";
        studentProfile.fullName = fullName;
        studentProfile.studentNo =
          profile.studentNumber || profile.studentNo || profile.studentId || "";
        studentProfile.organization =
          profile.organization ||
          profile.courseOrganization ||
          profile.courseOrg ||
          profile.organizationCode ||
          profile.organizationName ||
          "";
        studentProfile.courseOrganization =
          profile.courseOrganization || profile.courseOrg || studentProfile.organization;
        studentProfile.courseOrg = profile.courseOrg || studentProfile.organization;
        studentProfile.StudentOrgs = uniqueProfileValues(
          profile.StudentOrgs,
          profile.studentOrgs,
          profile.organizations,
          studentProfile.organization,
        );
        studentProfile.department = profile.department || profile.departmentCode || "";
        studentProfile.departmentCode = profile.departmentCode || profile.department || "";
        studentProfile.departments = uniqueProfileValues(
          profile.departments,
          profile.departmentCodes,
          profile.department,
          profile.departmentCode,
          profile.course,
          profile.program,
        );
        studentPreferences.categories = Array.isArray(profile.preferences?.categories)
          ? profile.preferences.categories
          : [];
        studentPreferences.sources = Array.isArray(profile.preferences?.sources)
          ? profile.preferences.sources
          : [];
        studentPreferences.tags = Array.isArray(profile.preferences?.tags)
          ? profile.preferences.tags
          : [];
        studentPreferences.organizations = Array.isArray(profile.preferences?.organizations)
          ? profile.preferences.organizations
          : [];
        registeredEventIds = new Set(readParticipationsFromStorage());

        renderStudentSidebar(profile);
        renderGreeting();
        initSidebar();
        renderRecommended();
        rebuildStudentEvents();
        initDataListeners(user);
      } catch (profileError) {
        console.error("Could not verify the signed-in student profile:", profileError);
        if (String(profileError?.message || "").includes("not a student profile")) {
          clearCachedStudentProfile();
          await signOut(auth);
          window.location.replace("StudentLogin.html");
          return;
        }
        eventFetchLoading = false;
        eventFetchError = "Your student profile could not be verified. Please sign in again.";
        renderHappeningNow();
        renderUpcoming();
        renderRecommended();
        renderCalendar();
      }
    }, (error) => {
      console.error("Could not verify the signed-in student:", error);
      eventFetchLoading = false;
      eventFetchError = "Could not verify sign-in. Please check your connection and retry.";
      renderHappeningNow();
      renderUpcoming();
      renderRecommended();
      renderCalendar();
      signalPageLoadReady();
    });
  } else {
    window.location.replace("StudentLogin.html");
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
