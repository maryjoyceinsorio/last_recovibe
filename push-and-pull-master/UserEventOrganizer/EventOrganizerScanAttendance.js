import { auth, authReady, db, rtdb, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, off, get } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  collection,
  endAt,
  getDocs,
  doc,
  getDoc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAt,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  buildManualAttendeeIndex,
  normalizeManualWalkInEntry,
  searchManualAttendees,
} from "./scanAttendanceManualLookup.js";
import { writeEventAttendance } from "../UserStudent/eventRtdb.js";
import {
  isRegistrationActive,
  mergeRegistrationMapsByUid,
} from "../UserStudent/eventRegistrationData.js";
import { parseAttendanceQrPayload } from "../UserStudent/attendanceQr.js";
import {
  getDocCached,
  getDocsCached,
} from "../firestoreReadCache.js";

// DOM Element References
const organizerTodayDate = document.getElementById("organizerTodayDate");
const organizerAvatar = document.getElementById("organizerAvatar");
const organizerName = document.getElementById("organizerName");
const organizerRole = document.getElementById("organizerRole");
const organizerLogout = document.getElementById("organizerLogout");

const eventSelect = document.getElementById("eventSelect");
const metaDateTime = document.getElementById("metaDateTime");
const metaVenue = document.getElementById("metaVenue");
const metaCount = document.getElementById("metaCount");

const scanResultBanner = document.getElementById("scanResultBanner");
const bannerIconCol = document.getElementById("bannerIconCol");
const bannerStatusTitle = document.getElementById("bannerStatusTitle");
const bannerStudentName = document.getElementById("bannerStudentName");
const bannerStudentMeta = document.getElementById("bannerStudentMeta");
const bannerExtraNote = document.getElementById("bannerExtraNote");
const bannerActions = document.getElementById("bannerActions");
const btnWalkInConfirm = document.getElementById("btnWalkInConfirm");
const btnDismissBanner = document.getElementById("btnDismissBanner");

const walkInToggle = document.getElementById("walkInToggle");
const scannerLiveDot = document.getElementById("scannerLiveDot");
const btnToggleCamera = document.getElementById("btnToggleCamera");
const btnToggleCameraLabel = document.getElementById("btnToggleCameraLabel");
const btnSwitchCamera = document.getElementById("btnSwitchCamera");
const cameraPausedBox = document.getElementById("cameraPausedBox");
const btnResumePausedCamera = document.getElementById("btnResumePausedCamera");
const cameraErrorBox = document.getElementById("cameraErrorBox");
const cameraErrorTitle = document.getElementById("cameraErrorTitle");
const cameraErrorMessage = document.getElementById("cameraErrorMessage");
const btnRetryCamera = document.getElementById("btnRetryCamera");

const manualCheckInForm = document.getElementById("manualCheckInForm");
const manualStudentNo = document.getElementById("manualStudentNo");
const btnManualSubmit = document.getElementById("btnManualSubmit");
const manualValidationError = document.getElementById("manualValidationError");
const manualSearchResult = document.getElementById("manualSearchResult");
const manualHint = document.getElementById("manualHint");
const manualWalkInEntry = document.getElementById("manualWalkInEntry");
const manualWalkInForm = document.getElementById("manualWalkInForm");
const manualWalkInName = document.getElementById("manualWalkInName");
const manualWalkInStudentNo = document.getElementById("manualWalkInStudentNo");
const manualWalkInOrganization = document.getElementById("manualWalkInOrganization");
const manualWalkInError = document.getElementById("manualWalkInError");
const btnManualWalkInSubmit = document.getElementById("btnManualWalkInSubmit");

const btnCompleteEvent = document.getElementById("btnCompleteEvent");
const scanEmptyEventsBox = document.getElementById("scanEmptyEventsBox");
const scanCompletedBanner = document.getElementById("scanCompletedBanner");
const completedBannerSummary = document.getElementById("completedBannerSummary");

const completeConfirmModalOverlay = document.getElementById("completeConfirmModalOverlay");
const btnCancelCompleteModal = document.getElementById("btnCancelCompleteModal");
const btnConfirmCompleteModal = document.getElementById("btnConfirmCompleteModal");
const confirmModalEventName = document.getElementById("confirmModalEventName");
const confirmModalWarning = document.getElementById("confirmModalWarning");
const confirmModalCheckedIn = document.getElementById("confirmModalCheckedIn");
const confirmModalWalkIns = document.getElementById("confirmModalWalkIns");
const confirmModalAbsent = document.getElementById("confirmModalAbsent");

const walkInConfirmModalOverlay = document.getElementById("walkInConfirmModalOverlay");
const walkInModalHeading = document.getElementById("walkInModalHeading");
const walkInModalDescription = document.getElementById("walkInModalDescription");
const btnCancelWalkInModal = document.getElementById("btnCancelWalkInModal");
const btnConfirmWalkInModal = document.getElementById("btnConfirmWalkInModal");

const manualConfirmModalOverlay = document.getElementById("manualConfirmModalOverlay");
const manualConfirmStudentNo = document.getElementById("manualConfirmStudentNo");
const manualConfirmWalkInNotice = document.getElementById("manualConfirmWalkInNotice");
const btnCancelManualConfirm = document.getElementById("btnCancelManualConfirm");
const btnAcceptManualConfirm = document.getElementById("btnAcceptManualConfirm");

const rosterTabsRow = document.getElementById("rosterTabsRow");
const tabCheckedIn = document.getElementById("tabCheckedIn");
const tabAbsent = document.getElementById("tabAbsent");
const tabCountCheckedIn = document.getElementById("tabCountCheckedIn");
const tabCountAbsent = document.getElementById("tabCountAbsent");
const rosterCountSubtitle = document.getElementById("rosterCountSubtitle");
const rosterTableHead = document.getElementById("rosterTableHead");
const rosterTableBody = document.getElementById("rosterTableBody");
const btnExportCsv = document.getElementById("btnExportCsv");

// Application State
let currentEvents = [];
let currentEventId = null;
let organizerUid = "";
let organizerOrganizationCode = "";
let authContextVersion = 0;
let organizerDisplayName = "";
let eventsRefreshTimer = null;
let eventLoadInProgress = false;
let eventLoadPending = false;
let scanPageLoadSignaled = false;
function signalScanPageReady() {
  if (scanPageLoadSignaled) return;
  scanPageLoadSignaled = true;
  window.dispatchEvent(new Event("page-data-ready"));
}
function showEventLoadFailure(error) {
  const details = {
    code: error?.code || "unknown",
    message: error?.message || String(error),
  };
  console.error("[Scan Attendance] Published event load failed:", details, error);
  if (eventSelect) {
    eventSelect.disabled = false;
    eventSelect.replaceChildren(
      new Option("Could not load events. Please try again.", ""),
      new Option("Retry loading events", "__retry__"),
    );
    eventSelect.value = "";
    eventSelect.onchange = (event) => {
      if (event.target.value === "__retry__") loadEventsList();
    };
  }
  if (btnCompleteEvent) btnCompleteEvent.disabled = true;
  if (scanEmptyEventsBox) {
    scanEmptyEventsBox.hidden = false;
    scanEmptyEventsBox.querySelector("h3")?.replaceChildren(document.createTextNode("Failed to load events"));
    scanEmptyEventsBox.querySelector("p")?.replaceChildren(document.createTextNode("Check your connection and choose retry above."));
  }
  signalScanPageReady();
}

function withTimeout(operation, timeoutMs, message) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => window.clearTimeout(timeoutId));
}
const scanUrlParams = new URLSearchParams(window.location.search);
const requestedEventId = scanUrlParams.get("eventId")?.trim() || "";
console.log("[Scan Attendance] URL eventId:", requestedEventId || "(none)");
let activeAttendanceRef = null;
let activeEventAttendanceRef = null;
let activeEventAttendanceV2Ref = null;
let currentAttendanceRows = [];
let currentAbsentRows = [];
let currentRosterTab = "checkedIn"; // "checkedIn" | "absent"
let html5QrCodeInstance = null;
let cameraStatus = "uninitialized"; // 'uninitialized' | 'running' | 'paused' | 'stopped'
let currentFacingMode = "environment"; // 'environment' | 'user'

function normalizeEventDate(value) {
  const resolved = value && typeof value.toDate === "function" ? value.toDate() : value;
  if (resolved instanceof Date) {
    if (Number.isNaN(resolved.getTime())) return "";
    return `${resolved.getFullYear()}-${String(resolved.getMonth() + 1).padStart(2, "0")}-${String(resolved.getDate()).padStart(2, "0")}`;
  }
  const text = String(resolved || "").trim();
  const match = /^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})/.exec(text);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function normalizeEventTime(value) {
  const resolved = value && typeof value.toDate === "function" ? value.toDate() : value;
  const date = resolved instanceof Date
    ? resolved
    : typeof resolved === "string" && /^\d{4}-\d{2}-\d{2}T/.test(resolved)
      ? new Date(resolved)
      : null;
  if (date && !Number.isNaN(date.getTime())) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return String(resolved || "").trim();
}

function eventIsOwnedByOrganizer(data) {
  return [data.createdBy, data.organizerId, data.organizerUid]
    .some((id) => String(id || "") === String(organizerUid));
}

function normalizeOrganizationCode(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function isOrganizerRole(value) {
  return ["eventorganizer", "organizer", "eo"].includes(
    String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""),
  );
}

async function getOrganizerOrganizationFromProfile(user) {
  if (!db || !user?.uid) throw new Error("Sign in before loading organization events.");
  const reads = await Promise.allSettled([
    getDocCached(getDoc, doc(db, "adminUser", user.uid), user.uid),
    getDocCached(getDoc, doc(db, "users", user.uid), user.uid),
    getDocCached(getDoc, doc(db, "eventOrganizations", user.uid), user.uid),
  ]);
  const profiles = reads.slice(0, 2)
    .filter((result) => result.status === "fulfilled" && result.value.exists())
    .map((result) => result.value.data());
  const organizerProfile = profiles.find((profile) =>
    isOrganizerRole(profile.role || profile.userRole),
  );
  const organizationResult = reads[2];
  const organizationRecord = organizationResult.status === "fulfilled" &&
    organizationResult.value.exists()
    ? organizationResult.value.data()
    : {};
  const hasConflictingRole = profiles.some((profile) =>
    String(profile.role || profile.userRole || "").trim(),
  );

  if (!organizerProfile && (hasConflictingRole || !organizationRecord.organizationCode)) {
    const readError = reads.find((result) => result.status === "rejected")?.reason;
    if (readError) throw readError;
    throw new Error("Your organizer account does not have a verified organization.");
  }

  const profile = organizerProfile || organizationRecord;
  const organizationCode = normalizeOrganizationCode(
    organizationRecord.organizationCode ||
    profile.organizationCode ||
    profile.orgCode ||
    profile.organization ||
    profile.organizationName ||
    profile.orgName,
  );
  if (!organizationCode) {
    throw new Error("Your organizer profile must have an organization assigned.");
  }
  return organizationCode;
}

function eventIsScanReady(data) {
  const status = String(data.status || "").trim().toLowerCase().replace(/[ _-]+/g, " ");
  if (
    ["cancelled", "canceled", "rejected", "disapproved", "completed", "ended", "archived", "expired"]
      .includes(status) ||
    data.cancelled === true ||
    data.canceled === true ||
    data.rejected === true ||
    data.disapproved === true ||
    data.completed === true ||
    data.isCompleted === true ||
    data.ended === true ||
    data.archived === true ||
    data.isArchived === true
  ) {
    return false;
  }
  return ["approved", "published", "rescheduled"].includes(status) || data.published === true;
}

function normalizeAttendanceEvent(id, data) {
  const schedule = data.schedule && typeof data.schedule === "object" ? data.schedule : {};
  const rawStart =
    data.startAt || data.startTime || data.timeStart ||
    schedule.timeStart || schedule.startTime || schedule.start || data.time || "";
  const rawEnd = data.endAt || data.endTime || data.timeEnd ||
    schedule.timeEnd || schedule.endTime || schedule.end || "";
  const startDate = normalizeEventDate(
    data.eventDate || data.dateISO || data.date || data.dateStart ||
    schedule.date || schedule.startDate || rawStart,
  );
  const endDate = normalizeEventDate(
    data.endDate || data.endDateISO || data.dateEnd || data.dateEndISO || startDate,
  );
  const timeRange = String(rawStart).match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  const status = String(data.status || "").trim().toLowerCase();

  return {
    ...data,
    id: String(id),
    name: data.eventName || data.title || data.name || "Untitled event",
    dateISO: startDate,
    dateEndISO: endDate || startDate,
    startAt: normalizeEventTime(timeRange ? timeRange[1] : rawStart),
    endAt: normalizeEventTime(timeRange ? timeRange[2] : rawEnd),
    venue: data.venue || data.location || data.venueOther || "—",
    status: status === "completed" ? "completed" : "published",
    allowWalkIn: Boolean(data.allowWalkIn),
  };
}

let lastScannedText = "";
let lastScannedTime = 0;
let isScanThrottled = false;
let isWalkInAllowed = false;
let pendingWalkInToken = null;
let pendingWalkInState = null;
let manualCheckInInProgress = false;
let manualSearchTimer = null;
let manualSearchRequestId = 0;
let manualSearchMatches = [];
let manualSearchTerm = "";
let manualSearchEventId = null;
let manualSelectedStudentUid = "";
const manualRegistrationCache = new Map();
const manualProfileSearchCache = new Map();

// Initialize Date & Profile
if (false) (() => {
  if (organizerTodayDate) {
    organizerTodayDate.textContent = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  try {
    const orgProfile = JSON.parse(localStorage.getItem("recovibeOrganizerProfile") || "{}");
    const name = orgProfile.fullName || orgProfile.name ||
      [orgProfile.firstName, orgProfile.middleName, orgProfile.lastName].filter(Boolean).join(" ") || "Event Organizer";
    const isTeacher = false;
    /*
    const orgName = `${orgProfile.organization || "PUP Biñan"} account`;
    */
    const legacyOrgName = isTeacher
      ? (teacherProfile.department || teacherProfile.role || "Faculty")
      : `${orgProfile.organization || "PUP Biñan"} organizer`;
    if (organizerName) organizerName.textContent = name;
    if (organizerRole) organizerRole.textContent = "";
    if (organizerAvatar) {
      const initials = name.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase() || "EO";
      organizerAvatar.textContent = initials;
    }

    // Adapt sidebar links for Teacher session
    if (isTeacher) {
      const navLinks = document.querySelectorAll(".organizer-sidebar .nav-item");
      navLinks.forEach((link) => {
        const text = link.querySelector(".nav-label")?.textContent?.trim();
        if (text === "Dashboard") link.href = "../UserTeacher/TeacherDashBoard.html";
        else if (text === "All Events") link.href = "../UserTeacher/TeacherAllEvent.html";
        else if (text === "Calendar") link.href = "../UserTeacher/TeacherCalendar.html";
        else if (text === "Create Event") link.href = "../UserTeacher/TeacherCreate.html";
        else if (text === "My Events") {
          link.href = "../UserTeacher/TeacherMyEvent.html";
          link.classList.add("is-active");
        }
        else if (text === "Notifications") link.href = "../UserTeacher/TeacherNotification.html";
        else if (text === "Profile") link.href = "../UserTeacher/TeacherProfile.html";
        else if (text === "Scan Attendance" || text === "Activity Summary") {
          link.style.display = "none";
        }
      });
      if (organizerLogout) organizerLogout.href = "../UserTeacher/TeacherLogin.html";
      const emptyBtn = scanEmptyEventsBox?.querySelector("a");
      if (emptyBtn) emptyBtn.href = "../UserTeacher/TeacherMyEvent.html";
    }
    const orgName = `${orgProfile.organization || "PUP BiÃ±an"} account · ${orgProfile.accountNumber || orgProfile.accountNo || orgProfile.organizerNumber || orgProfile.organizerNo || "EO"}`;
    if (organizerName) organizerName.textContent = name;
    if (organizerRole) organizerRole.textContent = orgName;
    if (organizerAvatar) {
      const initials = name.split(/\s+/).filter(Boolean).map(p => p[0]).slice(0, 2).join("").toUpperCase() || "EO";
      organizerAvatar.textContent = initials;
    }
  } catch (err) {
    console.warn("Could not read profile:", err);
  }
})();

function renderOrganizerProfile() {
  let profile = {};
  try {
    profile = JSON.parse(localStorage.getItem("recovibeOrganizerProfile") || "{}");
  } catch (registrationError) {
    console.warn("[Scan Attendance] Registration lookup failed:", registrationError);
  }
  organizerDisplayName = profile.fullName || profile.name ||
    [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ") ||
    auth?.currentUser?.displayName || auth?.currentUser?.email || "Event Organizer";
  if (organizerName) organizerName.textContent = organizerDisplayName;
  if (organizerRole) organizerRole.textContent = `${profile.organization || ""} organizer`.trim();
  if (organizerAvatar) {
    organizerAvatar.textContent = organizerDisplayName
      .split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "EO";
  }
}

// Task 1: Auth & Role Guard (event organizers only)
withTimeout(authReady, 15000, "Timed out waiting for authentication to initialize.")
  .then(() => onAuthStateChanged(auth, async (user) => {
  const authRequestId = ++authContextVersion;
  if (!user) {
    organizerUid = "";
    organizerOrganizationCode = "";
    window.location.replace("EventOrganizerLogin.html");
    return;
  }

  organizerUid = user.uid;
  organizerOrganizationCode = "";
  try {
    organizerOrganizationCode = await withTimeout(
      getOrganizerOrganizationFromProfile(user),
      15000,
      "Timed out verifying your organization.",
    );
    if (authRequestId !== authContextVersion) return;
  } catch (verificationError) {
    if (authRequestId !== authContextVersion) return;
    await stopCameraScanner();
    if (activeAttendanceRef) off(activeAttendanceRef);
    if (activeEventAttendanceRef) off(activeEventAttendanceRef);
    if (activeEventAttendanceV2Ref) off(activeEventAttendanceV2Ref);
    activeAttendanceRef = null;
    activeEventAttendanceRef = null;
    activeEventAttendanceV2Ref = null;
    currentEvents = [];
    currentEventId = null;
    currentAttendanceRows = [];
    currentAbsentRows = [];
    [
      btnCompleteEvent,
      walkInToggle,
      btnToggleCamera,
      btnSwitchCamera,
      btnManualSubmit,
      manualStudentNo,
      btnExportCsv,
    ].forEach((control) => {
      if (control) control.disabled = true;
    });
    if (metaDateTime) metaDateTime.textContent = "—";
    if (metaVenue) metaVenue.textContent = "—";
    if (metaCount) metaCount.textContent = "0 checked in";
    updateRosterDisplay();
    showEventLoadFailure(verificationError);
    return;
  }

  if (authRequestId !== authContextVersion) return;
  renderOrganizerProfile();

  initApp().catch((error) => {
    showEventLoadFailure(error);
  });
})).catch((error) => {
  showEventLoadFailure(error);
});

if (organizerLogout) {
  organizerLogout.addEventListener("click", async (e) => {
    e.preventDefault();
    cleanupCamera();
    try {
      if (auth) await signOut(auth);
    } catch {}
    localStorage.removeItem("recovibeOrganizerId");
    localStorage.removeItem("recovibeOrganizerProfile");
    localStorage.removeItem("recovibeCurrentOrganizer");
    localStorage.removeItem("recovibeTeacherId");
    window.location.href = "EventOrganizerLogin.html";
  });
}

// Audio Feedback (Web Audio API)
function playSuccessChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    console.warn("Web audio chime error:", e);
  }
}

function playWarningBuzz() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.setValueAtTime(260, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
  } catch (e) {
    console.warn("Web audio buzz error:", e);
  }
}

function playErrorTone() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.setValueAtTime(140, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    console.warn("Web audio error tone:", e);
  }
}

function triggerVibration(pattern) {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  } catch {}
}

// Task 4: Arm's-length Result Banner
function showResultBanner({ type, title, name, meta, note, allowWalkInAction, token }) {
  if (!scanResultBanner) return;

  scanResultBanner.hidden = false;
  scanResultBanner.className = `scan-result-banner banner-${type}`;

  if (bannerStatusTitle) bannerStatusTitle.textContent = title;
  if (bannerStudentName) {
    bannerStudentName.textContent = name;
    bannerStudentName.hidden = !name;
  }
  if (bannerStudentMeta) {
    bannerStudentMeta.textContent = meta;
    bannerStudentMeta.hidden = !meta;
  }
  if (bannerExtraNote) {
    if (note) {
      bannerExtraNote.textContent = note;
      bannerExtraNote.hidden = false;
    } else {
      bannerExtraNote.hidden = true;
    }
  }

  // Icons based on state
  let iconSvg = "";
  if (type === "ok") {
    iconSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    `;
    playSuccessChime();
    triggerVibration([80]);
  } else if (type === "already") {
    iconSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 14 14"/>
      </svg>
    `;
  } else if (type === "not-registered") {
    iconSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    `;
  } else {
    // replaced or error
    iconSvg = `
      <svg viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>
    `;
  }
  if (bannerIconCol) bannerIconCol.innerHTML = iconSvg;

  // Walk-in action button for "not_registered"
  if (allowWalkInAction && token) {
    pendingWalkInToken = token;
    if (bannerActions) bannerActions.hidden = false;
  } else {
    pendingWalkInToken = null;
    if (bannerActions) bannerActions.hidden = true;
  }
}

function dismissBanner() {
  if (scanResultBanner) {
    scanResultBanner.hidden = true;
  }
  pendingWalkInToken = null;
}

if (btnDismissBanner) {
  btnDismissBanner.addEventListener("click", dismissBanner);
}

if (btnWalkInConfirm) {
  btnWalkInConfirm.addEventListener("click", async () => {
    if (!pendingWalkInToken || !currentEventId) return;
    const tokenToProcess = pendingWalkInToken;
    const confirmed = window.confirm("Are you sure you want to check in this student as a walk-in attendee?");
    if (!confirmed) return;
    dismissBanner();
    await processAttendance({
      eventId: currentEventId,
      token: tokenToProcess,
      allowWalkIn: true,
    });
  });
}


// Task 2: Event Selector & Default to Today / Next Upcoming
async function loadEventsList() {
  if (eventLoadInProgress) {
    eventLoadPending = true;
    return;
  }
  eventLoadInProgress = true;
  const loadContextVersion = authContextVersion;
  const loadOrganizerUid = organizerUid;
  let loadOrganizationCode = "";
  const isCurrentLoad = () =>
    loadContextVersion === authContextVersion && loadOrganizerUid === organizerUid;
  console.log("[Scan Attendance] Starting published event load", { organizerUid });
  if (eventSelect) eventSelect.replaceChildren();

  try {
    if (!isFirebaseConfigured || !db || !organizerUid) {
      throw new Error("Firestore is not configured.");
    }
    loadOrganizationCode = await withTimeout(
      getOrganizerOrganizationFromProfile(auth.currentUser),
      15000,
      "Timed out verifying your organization.",
    );
    if (!isCurrentLoad()) return;
    organizerOrganizationCode = loadOrganizationCode;
    const eventsMap = new Map();
    const organizerEventsQuery = query(
      collection(db, "events"),
      where("organizationCode", "==", loadOrganizationCode),
    );
    const eventSnapshot = await withTimeout(
      getDocsCached(
        getDocs,
        organizerEventsQuery,
        `scan-events:${loadOrganizationCode}`,
        loadOrganizerUid,
      ),
      15000,
      "Timed out loading your events.",
    );
    if (!isCurrentLoad() || loadOrganizationCode !== organizerOrganizationCode) return;
    eventSnapshot.docs.forEach((eventDocument) => {
      const data = eventDocument.data();
      const eventOrganizationCode = String(data.organizationCode || "")
        .trim()
        .replace(/\s+/g, " ")
        .toUpperCase();
      if (
        eventOrganizationCode === loadOrganizationCode &&
        eventIsOwnedByOrganizer(data) &&
        eventIsScanReady(data)
      ) {
        const event = normalizeAttendanceEvent(eventDocument.id, data);
        eventsMap.set(event.id, event);
      }
    });
    currentEvents = [...eventsMap.values()];
    console.log("[Scan Attendance] Published events found:", currentEvents.length);
    await populateEventDropdown();
  } catch (error) {
    if (!isCurrentLoad()) return;
    currentEvents = [];
    showEventLoadFailure(error);
  } finally {
    eventLoadInProgress = false;
    if (eventLoadPending) {
      eventLoadPending = false;
      loadEventsList();
    } else signalScanPageReady();
  }
  return;

  /* Legacy unfiltered event loader retained below only as page-local history. */
  /*
  const eventsMap = new Map();

  // Start the realtime load without blocking the Firestore event list.
  const realtimeEventsPromise = (async () => {
    if (!rtdb) return;
    try {
      const snap = await get(ref(rtdb, "events"));
      const rtdbEvents = snap.val();
      if (rtdbEvents && typeof rtdbEvents === "object") {
        Object.entries(rtdbEvents).forEach(([id, val]) => {
          if (val && typeof val === "object") {
            const status = String(val.status || "published").trim().toLowerCase();
            if (status === "published" || status === "completed") {
              eventsMap.set(String(id), {
                id: String(id),
                name: val.name || val.title || `Event #${id}`,
                startAt: val.startAt || val.dateISO || val.date || "",
                endAt: val.endAt || "",
                venue: val.venue || val.location || "PUP Biñan Campus",
                dateISO: val.dateISO || (val.startAt ? String(val.startAt).slice(0, 10) : ""),
                status: status,
                completedAt: val.completedAt || null,
                allowWalkIn: Boolean(val.allowWalkIn),
              });
            }
          }
        });
      }
    } catch (e) {
      console.warn("RTDB events fetch notice:", e);
    }
  })();

  // Load Firestore events and tolerate an unavailable query without discarding
  // results from the other queries.
  if (db) {
    const eventsRef = collection(db, "events");
    const eventRequests = [
      getDocs(query(eventsRef, where("status", "in", ["published", "completed"]))),
      getDocs(query(eventsRef, where("published", "==", true))),
      getDocs(query(eventsRef, where("isPublished", "==", true))),
    ];
    if (requestedEventId) {
      eventRequests.push(getDoc(doc(db, "events", requestedEventId)));
    }

    const eventResults = await Promise.allSettled(eventRequests);
    const eventDocuments = new Map();
    eventResults.forEach((result, index) => {
      if (result.status === "rejected") {
        console.warn("Firestore attendance event query notice:", result.reason);
        return;
      }

      const resultValue = result.value;
      if (Array.isArray(resultValue.docs)) {
        resultValue.docs.forEach((document) => {
          eventDocuments.set(document.id, document);
        });
      } else if (index === eventRequests.length - 1 && resultValue.exists()) {
        eventDocuments.set(resultValue.id, resultValue);
      }
    });

    eventDocuments.forEach((document) => {
      const data = document.data();
      const id = document.id;
      let status = String(data.status || "").trim().toLowerCase();
      if (!["published", "completed"].includes(status) &&
          (data.published === true || data.isPublished === true)) {
        status = "published";
      }
      if (status === "published" || status === "completed") {
        eventsMap.set(String(id), {
          id: String(id),
          name: data.eventName || data.title || `Event #${id}`,
          startAt: data.startTime || data.dateISO || data.eventDate || "",
          endAt: data.endTime || "",
          venue: data.venue || data.location || "PUP Biñan Campus",
          dateISO: data.eventDate || data.dateISO || "",
          status: status,
          completedAt: data.completedAt || null,
          allowWalkIn: Boolean(data.allowWalkIn),
        });
      }
    });
  }

  // Load local events before rendering so Firestore results can be supplemented.
  ["recovibeOrganizerEvents", "recovibeTeacherEvents", "recovibeEvents"].forEach((storageKey) => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(stored)) {
        stored.forEach((ev) => {
          const id = String(ev.id || ev.eventId);
          const rawStatus = String(ev.status || "published").toLowerCase();
          const isEligible = ["published", "approved", "completed"].includes(rawStatus);
          const normStatus = rawStatus === "completed" ? "completed" : "published";
          if (id && !eventsMap.has(id) && isEligible) {
            eventsMap.set(id, {
              id,
              name: ev.title || ev.eventName || `Event #${id}`,
              startAt: ev.time || ev.startTime || "",
              endAt: ev.endTime || "",
              venue: ev.venue || ev.location || "PUP Biñan Campus",
              dateISO: ev.dateISO || ev.date || "",
              status: normStatus,
              completedAt: ev.completedAt || null,
              allowWalkIn: Boolean(ev.allowWalkIn),
            });
          }
        });
      }
    } catch {}
  });

  if (requestedEventContext.id && !eventsMap.has(requestedEventContext.id) && requestedEventContext.name) {
    eventsMap.set(requestedEventContext.id, requestedEventContext);
  }

  currentEvents = Array.from(eventsMap.values());
  populateEventDropdown();

  await realtimeEventsPromise;
  currentEvents = Array.from(eventsMap.values());
  populateEventDropdown();
  */
}

async function populateEventDropdown() {
  const scanEventCard = document.querySelector(".scan-event-card");
  const scanLayoutGrid = document.querySelector(".scan-layout-grid");
  const scanRosterSection = document.querySelector(".scan-attendance-list-section");

  if (eventSelect) {
    eventSelect.onchange = (event) => {
      showEventDetails(event.target.value).catch((error) => {
        showEventLoadFailure(error);
      });
    };
  }

  const setAttendanceControlsDisabled = (disabled) => {
    [btnCompleteEvent, walkInToggle, btnToggleCamera, btnSwitchCamera, btnManualSubmit,
      manualStudentNo, manualWalkInName, manualWalkInStudentNo, manualWalkInOrganization,
      btnManualWalkInSubmit, btnExportCsv].forEach((control) => {
      if (control) control.disabled = disabled;
    });
  };

  if (currentEvents.length === 0) {
    currentEventId = null;
    stopCameraScanner();
    setAttendanceControlsDisabled(true);
    if (eventSelect) {
      eventSelect.disabled = false;
      eventSelect.replaceChildren(new Option("No published events", ""));
    }
    if (metaDateTime) metaDateTime.textContent = "—";
    if (metaVenue) metaVenue.textContent = "—";
    if (metaCount) metaCount.textContent = "0 checked in";
    currentAttendanceRows = [];
    currentAbsentRows = [];
    updateRosterDisplay();
    if (scanEmptyEventsBox) scanEmptyEventsBox.hidden = Boolean(requestedEventId);
    if (scanEmptyEventsBox.querySelector("h3")) scanEmptyEventsBox.querySelector("h3").textContent = "No published events are available";
    if (scanEmptyEventsBox.querySelector("p")) scanEmptyEventsBox.querySelector("p").textContent = "Published events will appear here when they are ready for attendance.";
    if (scanEventCard) scanEventCard.style.display = "";
    if (scanLayoutGrid) scanLayoutGrid.style.display = "";
    if (scanRosterSection) scanRosterSection.style.display = "";
    return;
  }

  if (scanEmptyEventsBox) scanEmptyEventsBox.hidden = true;
  if (scanEventCard) scanEventCard.style.display = "";
  if (scanLayoutGrid) scanLayoutGrid.style.display = "";
  if (scanRosterSection) scanRosterSection.style.display = "";
  setAttendanceControlsDisabled(false);
  if (btnManualSubmit) btnManualSubmit.disabled = true;

  if (!eventSelect) return;
  eventSelect.replaceChildren(new Option("Select an event", ""));
  currentEvents.forEach((event) => {
    const option = document.createElement("option");
    option.value = event.id;
    option.textContent = event.name;
    eventSelect.appendChild(option);
  });

  let bestMatchEvent = null;

  if (requestedEventId) {
    bestMatchEvent = currentEvents.find((e) => String(e.id) === requestedEventId);
  }
  if (!bestMatchEvent && currentEventId) {
    bestMatchEvent = currentEvents.find((event) => String(event.id) === String(currentEventId));
  }

  const nowForSelection = new Date();
  const todayStr = `${nowForSelection.getFullYear()}-${String(nowForSelection.getMonth() + 1).padStart(2, "0")}-${String(nowForSelection.getDate()).padStart(2, "0")}`;

  // 1. Look for event happening today
  if (!bestMatchEvent) {
    bestMatchEvent = currentEvents.find((e) => e.dateISO === todayStr && e.status === "published");
  }

  // 2. Otherwise find next upcoming published event
  if (!bestMatchEvent) {
    const upcoming = currentEvents
      .filter((e) => e.dateISO && e.dateISO >= todayStr && e.status === "published")
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    if (upcoming.length > 0) bestMatchEvent = upcoming[0];
  }

  // 3. Fallback to any published or first event
  if (!bestMatchEvent) {
    bestMatchEvent = currentEvents.find((e) => e.status === "published") || currentEvents[0];
  }

  if (bestMatchEvent) {
    eventSelect.value = bestMatchEvent.id;
    if (String(currentEventId) !== String(bestMatchEvent.id)) {
      await showEventDetails(bestMatchEvent.id);
    }
  }
}

async function showEventDetails(eventId) {
  if (!eventId) return;
  clearManualSearch(true);
  console.log("[Scan Attendance] Loading event details:", eventId);
  await stopCameraScanner();
  dismissBanner();
  const eventSnapshot = await withTimeout(
    getDocCached(
      getDoc,
      doc(db, "events", String(eventId)),
      auth?.currentUser?.uid,
    ),
    15000,
    "Timed out loading the selected event.",
  );
  if (!eventSnapshot.exists()) {
    throw Object.assign(new Error("The selected event no longer exists."), { code: "not-found" });
  }

  const eventData = eventSnapshot.data();
  const eventOrganizationCode = String(eventData.organizationCode || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
  if (
    !eventIsOwnedByOrganizer(eventData) ||
    !eventIsScanReady(eventData) ||
    eventOrganizationCode !== organizerOrganizationCode
  ) {
    throw Object.assign(new Error("This event is not available for attendance."), { code: "permission-denied" });
  }
  const ev = normalizeAttendanceEvent(eventSnapshot.id, eventData);
  const existingIndex = currentEvents.findIndex((event) => String(event.id) === String(eventId));
  if (existingIndex >= 0) currentEvents[existingIndex] = ev;
  else currentEvents.push(ev);
  currentEventId = String(eventId);
  clearManualSearch(true);
  if (eventSelect) {
    if (
      eventSelect.options.length === 1 &&
      !eventSelect.options[0].value &&
      eventSelect.options[0].textContent.toLowerCase().includes("loading")
    ) {
      eventSelect.replaceChildren(new Option("Select an event", ""));
    }
    let option = Array.from(eventSelect.options).find((item) => item.value === currentEventId);
    if (!option) {
      option = new Option(ev.name, currentEventId);
      eventSelect.appendChild(option);
    } else {
      option.textContent = ev.name;
    }
    eventSelect.disabled = false;
    eventSelect.value = currentEventId;
  }
  if (scanEmptyEventsBox) scanEmptyEventsBox.hidden = true;
  const scanEventCard = document.querySelector(".scan-event-card");
  const scanLayoutGrid = document.querySelector(".scan-layout-grid");
  const scanRosterSection = document.querySelector(".scan-attendance-list-section");
  if (scanEventCard) scanEventCard.style.display = "";
  if (scanLayoutGrid) scanLayoutGrid.style.display = "";
  if (scanRosterSection) scanRosterSection.style.display = "";
  [btnCompleteEvent, walkInToggle, btnToggleCamera, btnSwitchCamera, btnManualSubmit,
    manualStudentNo, manualWalkInName, manualWalkInStudentNo, manualWalkInOrganization,
    btnManualWalkInSubmit, btnExportCsv].forEach((control) => {
    if (control) control.disabled = false;
  });
  if (btnManualSubmit) btnManualSubmit.disabled = true;

  const dateFormatted = ev.dateISO || "Date TBA";
  const timeRange = [ev.startAt, ev.endAt].filter(Boolean).join(" - ");
  const timeFormatted = timeRange ? ` · ${timeRange}` : "";
  if (metaDateTime) metaDateTime.textContent = `${dateFormatted}${timeFormatted}`;
  if (metaVenue) metaVenue.textContent = ev.venue || "PUP Biñan Campus";

  const isCompleted = ev.status === "completed";
  if (isCompleted) {
    if (btnCompleteEvent) btnCompleteEvent.hidden = true;
    if (walkInToggle) walkInToggle.disabled = true;
    if (btnManualWalkInSubmit) btnManualWalkInSubmit.disabled = true;

    if (scanLayoutGrid) scanLayoutGrid.style.display = "none";
    if (scanCompletedBanner) scanCompletedBanner.hidden = false;
    if (rosterTabsRow) rosterTabsRow.hidden = false;

    await stopCameraScanner();
  } else {
    if (btnCompleteEvent) btnCompleteEvent.hidden = false;
    if (walkInToggle) walkInToggle.disabled = false;
    if (btnManualWalkInSubmit) btnManualWalkInSubmit.disabled = false;
    if (scanLayoutGrid) scanLayoutGrid.style.display = "";
    if (scanCompletedBanner) scanCompletedBanner.hidden = true;
    if (rosterTabsRow) rosterTabsRow.hidden = true;

    // Reset tab to checked in
    currentRosterTab = "checkedIn";
    if (tabCheckedIn) tabCheckedIn.classList.add("is-active");
    if (tabAbsent) tabAbsent.classList.remove("is-active");

  }

  // Restore walk-in policy for selected event
  const savedWalkIn = localStorage.getItem(`recovibe_walkin_${eventId}`);
  if (savedWalkIn !== null) {
    applyWalkInState(savedWalkIn === "true");
  } else {
    applyWalkInState(Boolean(ev.allowWalkIn));
  }

  // Subscribe to real-time attendance for selected event (Task 7 & 8)
  subscribeAttendance(eventId, isCompleted);
}

// Tasks 7 & 8: Real-time Attendance Listener & Table
function subscribeAttendance(eventId, isCompleted) {
  if (activeAttendanceRef) {
    off(activeAttendanceRef);
    activeAttendanceRef = null;
  }
  if (activeEventAttendanceRef) {
    off(activeEventAttendanceRef);
    activeEventAttendanceRef = null;
  }
  if (activeEventAttendanceV2Ref) {
    off(activeEventAttendanceV2Ref);
    activeEventAttendanceV2Ref = null;
  }

  currentAttendanceRows = [];
  currentAbsentRows = [];
  updateRosterDisplay();

  if (!rtdb) {
    try {
      const saved = JSON.parse(localStorage.getItem(`recovibe_attendance_${eventId}`) || "[]");
      currentAttendanceRows = saved;
      updateRosterDisplay();
    } catch {}
    return;
  }

  const attendanceRowsBySource = new Map([
    ["firestore", []],
    ["legacy", []],
    ["event", []],
    ["eventAttendance", []],
  ]);
  const updateMergedAttendanceRows = () => {
    if (String(currentEventId) !== String(eventId)) return;
    const mergedRows = new Map();
    ["firestore", "legacy", "event", "eventAttendance"].forEach((sourceName) => {
      attendanceRowsBySource.get(sourceName).forEach((row) => {
        const key = String(row.uid);
        const previous = mergedRows.get(key);
        if (!previous || Number(row.scannedAt) >= Number(previous.scannedAt)) {
          mergedRows.set(key, { ...previous, ...row });
        }
      });
    });
    const checkedInRows = [...mergedRows.values()]
      .sort((a, b) => Number(b.scannedAt) - Number(a.scannedAt));
    currentAttendanceRows = checkedInRows;

    updateRosterDisplay();
    void refreshAbsentRows(eventId, checkedInRows).then(() => {
      if (String(currentEventId) === String(eventId)) updateRosterDisplay();
    });
  };
  const normalizeAttendanceRecord = (uid, row) => {
    if (!row || typeof row !== "object") return null;
    const scannedAtValue = row.scannedAt || row.checkedInAt || row.checkInAt;
    const scannedAt = typeof scannedAtValue?.toMillis === "function"
      ? scannedAtValue.toMillis()
      : Number(scannedAtValue) || Date.parse(scannedAtValue) || Date.now();
    return {
      uid,
      scannedAt,
      scannedBy: row.scannedBy || "Event Organizer",
      walkIn: Boolean(row.walkIn),
      name: row.name || row.studentName || row.student?.name || "Student",
      studentNo: row.studentNo || row.studentNumber || row.student?.studentNo || (row.walkIn ? "" : uid),
      organization: row.organization || row.student?.organization || (row.walkIn ? "" : "PUP Biñan"),
    };
  };
  const normalizeAttendanceRows = (data) =>
    Object.entries(data && typeof data === "object" ? data : {})
      .map(([uid, row]) => normalizeAttendanceRecord(uid, row))
      .filter(Boolean);
  const applyAttendanceSnapshot = (snapshot, source) => {
    attendanceRowsBySource.set(source, normalizeAttendanceRows(snapshot.val()));
    updateMergedAttendanceRows();
  };
  if (db && isFirebaseConfigured) {
    getDocsCached(
      getDocs,
      collection(db, "events", eventId, "attendance"),
      `scan-attendance:${eventId}`,
      auth?.currentUser?.uid,
    )
      .then((snapshot) => {
        attendanceRowsBySource.set(
          "firestore",
          snapshot.docs
            .map((attendanceDocument) =>
              normalizeAttendanceRecord(attendanceDocument.id, attendanceDocument.data()),
            )
            .filter(Boolean),
        );
        updateMergedAttendanceRows();
      })
      .catch((error) => console.warn("[Scan Attendance] Firestore attendance lookup failed:", {
        eventId,
        code: error?.code || "unknown",
      }));
  }
  const handleAttendanceError = (error) => {
    console.error("[Scan Attendance] Realtime attendance listener failed:", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
      eventId,
    }, error);
  };

  activeAttendanceRef = ref(rtdb, `attendance/${eventId}`);
  onValue(activeAttendanceRef, (snapshot) => {
    applyAttendanceSnapshot(snapshot, "legacy");
  }, handleAttendanceError);

  activeEventAttendanceRef = ref(rtdb, `events/${eventId}/attendance`);
  onValue(activeEventAttendanceRef, (snapshot) => {
    applyAttendanceSnapshot(snapshot, "event");
  }, handleAttendanceError);

  activeEventAttendanceV2Ref = ref(rtdb, `eventAttendance/${eventId}`);
  onValue(activeEventAttendanceV2Ref, (snapshot) => {
    applyAttendanceSnapshot(snapshot, "eventAttendance");
  }, handleAttendanceError);
}

async function refreshAbsentRows(eventId, checkedInRows) {
  if (!rtdb) return;
  try {
    const absSnap = await get(ref(rtdb, `absences/${eventId}`));
    if (String(currentEventId) !== String(eventId)) return;
    const absData = absSnap.val();
    if (absData && typeof absData === "object" && Object.keys(absData).length > 0) {
      currentAbsentRows = Object.entries(absData).map(([uid, r]) => ({
        uid,
        name: r.name || "Student",
        studentNo: r.studentNo || uid,
        organization: r.organization || "PUP Biñan",
      }));
    } else {
      const checkedUids = new Set(checkedInRows.map((r) => r.uid));
      const registrationIndex = await loadManualRegistrationIndex(eventId);
      if (String(currentEventId) !== String(eventId)) return;
      currentAbsentRows = registrationIndex.attendees
        .filter((student) => !checkedUids.has(student.uid))
        .map((student) => ({
          uid: student.uid,
          name: student.name || "Student",
          studentNo: student.studentNo || student.uid,
          organization: student.organization || "PUP Biñan",
        }));
    }
  } catch (e) {
    console.warn("Error refreshing absent rows:", e);
  }
}

function updateRosterDisplay() {
  const countCheckedIn = currentAttendanceRows.length;
  const countWalkIns = currentAttendanceRows.filter((r) => r.walkIn).length;
  const countAbsent = currentAbsentRows.length;

  if (metaCount) metaCount.textContent = `${countCheckedIn} checked in`;
  if (btnExportCsv) btnExportCsv.disabled = !currentEventId || countCheckedIn === 0;
  if (tabCountCheckedIn) tabCountCheckedIn.textContent = countCheckedIn;
  if (tabCountAbsent) tabCountAbsent.textContent = countAbsent;

  if (completedBannerSummary) {
    completedBannerSummary.textContent = `Checked in: ${countCheckedIn} · Walk-ins: ${countWalkIns} · Absent: ${countAbsent}`;
  }

  if (rosterCountSubtitle) {
    if (currentRosterTab === "checkedIn") {
      rosterCountSubtitle.textContent = `${countCheckedIn} student${countCheckedIn === 1 ? "" : "s"} checked in`;
    } else {
      rosterCountSubtitle.textContent = `${countAbsent} student${countAbsent === 1 ? "" : "s"} absent`;
    }
  }

  if (!rosterTableBody) return;

  if (currentRosterTab === "checkedIn") {
    if (rosterTableHead) {
      rosterTableHead.innerHTML = `
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Student Name</th>
          <th scope="col">Student Number</th>
          <th scope="col">Organization</th>
          <th scope="col">Type</th>
          <th scope="col">Scanned By</th>
        </tr>
      `;
    }
    if (countCheckedIn === 0) {
      rosterTableBody.innerHTML = `
        <tr class="empty-state-row">
          <td colspan="6">
            <div class="empty-table-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
              </svg>
              <p>No check-ins recorded yet for this event.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    rosterTableBody.innerHTML = currentAttendanceRows
      .map((row) => {
        const date = new Date(row.scannedAt);
        const timeStr = !Number.isNaN(date.getTime())
          ? date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })
          : "Just now";
        const typeBadge = row.walkIn
          ? `<span class="badge-tag badge-walkin">Walk-in</span>`
          : `<span class="badge-tag badge-registered">Registered</span>`;

        return `
          <tr>
            <td><strong>${timeStr}</strong></td>
            <td>${escapeHtml(row.name)}</td>
            <td><code>${escapeHtml(row.studentNo || "—")}</code></td>
            <td>${escapeHtml(row.organization || "—")}</td>
            <td>${typeBadge}</td>
            <td><small>${escapeHtml(row.scannedBy)}</small></td>
          </tr>
        `;
      })
      .join("");
  } else {
    if (rosterTableHead) {
      rosterTableHead.innerHTML = `
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Student Name</th>
          <th scope="col">Student Number</th>
          <th scope="col">Organization</th>
          <th scope="col">Status</th>
          <th scope="col">Scanned By</th>
        </tr>
      `;
    }
    if (countAbsent === 0) {
      rosterTableBody.innerHTML = `
        <tr class="empty-state-row">
          <td colspan="6">
            <div class="empty-table-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="32" height="32" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 8v4M12 16h.01"/>
              </svg>
              <p>No absent students recorded for this event.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    rosterTableBody.innerHTML = currentAbsentRows
      .map((row) => {
        return `
          <tr>
            <td><strong>—</strong></td>
            <td>${escapeHtml(row.name)}</td>
            <td><code>${escapeHtml(row.studentNo)}</code></td>
            <td>${escapeHtml(row.organization)}</td>
            <td><span class="badge-tag" style="background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;">Absent</span></td>
            <td><small>—</small></td>
          </tr>
        `;
      })
      .join("");
  }
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}

// Roster Tabs
if (tabCheckedIn) {
  tabCheckedIn.addEventListener("click", () => {
    currentRosterTab = "checkedIn";
    tabCheckedIn.classList.add("is-active");
    if (tabAbsent) tabAbsent.classList.remove("is-active");
    updateRosterDisplay();
  });
}

if (tabAbsent) {
  tabAbsent.addEventListener("click", () => {
    currentRosterTab = "absent";
    tabAbsent.classList.add("is-active");
    if (tabCheckedIn) tabCheckedIn.classList.remove("is-active");
    updateRosterDisplay();
  });
}

// Complete Event Button & Modal Validation
if (btnCompleteEvent) {
  btnCompleteEvent.addEventListener("click", async () => {
    // 1. Validation: check if an event is selected
    if (!currentEventId) {
      alert("Please select an active event first.");
      return;
    }

    const ev = currentEvents.find((e) => String(e.id) === String(currentEventId));
    if (!ev) {
      alert("Selected event could not be found. Please choose an event from the list.");
      return;
    }

    // 2. Validation: check if event is already completed
    if (ev.status === "completed") {
      alert(`"${ev.name || "This event"}" has already been marked as completed.`);
      btnCompleteEvent.hidden = true;
      return;
    }

    btnCompleteEvent.disabled = true;
    btnCompleteEvent.textContent = "Validating...";

    try {
      let registrationSnapshots = [];
      let attendanceSnapshots = [];
      if (rtdb) {
        const snapshotResults = await Promise.allSettled([
          get(ref(rtdb, `registrations/${currentEventId}`)),
          get(ref(rtdb, `eventRegistrations/${currentEventId}`)),
          get(ref(rtdb, `attendance/${currentEventId}`)),
          get(ref(rtdb, `events/${currentEventId}/attendance`)),
          get(ref(rtdb, `eventAttendance/${currentEventId}`)),
        ]);
        if (snapshotResults.every((result) => result.status === "rejected")) {
          throw snapshotResults[0].reason;
        }
        registrationSnapshots = snapshotResults
          .slice(0, 2)
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value);
        attendanceSnapshots = snapshotResults
          .slice(2)
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value);
      }
      const regData = mergeRegistrationMapsByUid(
        ...registrationSnapshots.map((snapshot) => snapshot.val() || {}),
      );
      const attData = mergeRegistrationMapsByUid(
        ...attendanceSnapshots.map((snapshot) => snapshot.val() || {}),
      );

      let totalCheckedIn = 0;
      let totalWalkIns = 0;
      Object.values(attData).forEach((row) => {
        if (row) {
          totalCheckedIn++;
          if (row.walkIn) totalWalkIns++;
        }
      });

      let totalAbsent = 0;
      Object.entries(regData).forEach(([uid, registration]) => {
        if (isRegistrationActive(registration) && !attData[uid]) totalAbsent++;
      });

      // Populate counts in modal
      if (confirmModalCheckedIn) confirmModalCheckedIn.textContent = totalCheckedIn;
      if (confirmModalWalkIns) confirmModalWalkIns.textContent = totalWalkIns;
      if (confirmModalAbsent) confirmModalAbsent.textContent = totalAbsent;

      // Populate event name
      if (confirmModalEventName) {
        confirmModalEventName.textContent = ev.name || ev.title || "this event";
      }

      // Validation warnings: zero attendees or future date
      const todayStr = new Date().toISOString().slice(0, 10);
      const isFuture = Boolean(ev.dateISO && ev.dateISO > todayStr);
      const hasZeroCheckIns = totalCheckedIn === 0;

      if (confirmModalWarning) {
        if (hasZeroCheckIns && isFuture) {
          confirmModalWarning.textContent = `Caution: This event is scheduled for a future date (${ev.dateISO}) and has 0 attendees checked in. Completing it will immediately finalize attendance and record all registered attendees as absent.`;
          confirmModalWarning.hidden = false;
        } else if (hasZeroCheckIns) {
          confirmModalWarning.textContent = "Notice: 0 attendees have checked in so far. Completing this event will record all registered students as absent.";
          confirmModalWarning.hidden = false;
        } else if (isFuture) {
          confirmModalWarning.textContent = `Notice: This event is scheduled for a future date (${ev.dateISO}). Completing it will close attendance immediately.`;
          confirmModalWarning.hidden = false;
        } else {
          confirmModalWarning.hidden = true;
        }
      }

      if (completeConfirmModalOverlay) completeConfirmModalOverlay.hidden = false;
      btnCancelCompleteModal?.focus();
    } catch (e) {
      console.warn("Complete event precheck notice:", e);
      if (confirmModalCheckedIn) confirmModalCheckedIn.textContent = currentAttendanceRows.length;
      if (confirmModalWalkIns) confirmModalWalkIns.textContent = currentAttendanceRows.filter((r) => r.walkIn).length;
      if (confirmModalAbsent) confirmModalAbsent.textContent = currentAbsentRows.length;
      if (confirmModalEventName) confirmModalEventName.textContent = ev.name || ev.title || "this event";
      if (completeConfirmModalOverlay) completeConfirmModalOverlay.hidden = false;
      btnCancelCompleteModal?.focus();
    } finally {
      btnCompleteEvent.disabled = false;
      btnCompleteEvent.textContent = "Complete event";
    }
  });
}

function closeCompleteModal() {
  if (completeConfirmModalOverlay) {
    completeConfirmModalOverlay.hidden = true;
    btnCompleteEvent?.focus();
  }
}

if (btnCancelCompleteModal) {
  btnCancelCompleteModal.addEventListener("click", closeCompleteModal);
}

if (completeConfirmModalOverlay) {
  completeConfirmModalOverlay.addEventListener("click", (e) => {
    if (e.target === completeConfirmModalOverlay) {
      closeCompleteModal();
    }
  });
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (completeConfirmModalOverlay && !completeConfirmModalOverlay.hidden) {
      closeCompleteModal();
    }
    if (walkInConfirmModalOverlay && !walkInConfirmModalOverlay.hidden) {
      if (typeof closeWalkInModal === "function") closeWalkInModal();
      else walkInConfirmModalOverlay.hidden = true;
    }
    if (manualConfirmModalOverlay && !manualConfirmModalOverlay.hidden) {
      if (typeof closeManualConfirmModal === "function") closeManualConfirmModal();
      else manualConfirmModalOverlay.hidden = true;
    }
  }
});

if (btnConfirmCompleteModal) {
  btnConfirmCompleteModal.addEventListener("click", async () => {
    if (!currentEventId) return;

    const ev = currentEvents.find((e) => String(e.id) === String(currentEventId));
    if (!ev) return;

    btnConfirmCompleteModal.disabled = true;
    btnConfirmCompleteModal.textContent = "Completing...";

    try {
      if (!db) {
        throw new Error("Firestore must be configured to complete this event.");
      }
      const completedAt = Date.now();
      await updateDoc(doc(db, "events", currentEventId), {
        status: "completed",
        completedAt: serverTimestamp(),
      });

      ev.status = "completed";
      ev.completedAt = completedAt;

      // Keep only this page's organizer-side cache in sync; the authoritative status is saved above.
      ["recovibeOrganizerEvents"].forEach((key) => {
        try {
          const list = JSON.parse(localStorage.getItem(key) || "[]");
          if (Array.isArray(list)) {
            let updated = false;
            list.forEach((item) => {
              if (String(item.id || item.eventId) === String(currentEventId)) {
                item.status = "completed";
                item.completedAt = Date.now();
                updated = true;
              }
            });
            if (updated) {
              localStorage.setItem(key, JSON.stringify(list));
            }
          }
        } catch (e) {}
      });

      try {
        downloadAttendanceCsv(ev, { allowEmpty: true });
      } catch (downloadError) {
        console.error("Event completed, but the attendance CSV could not be downloaded:", downloadError);
        alert(`Event completed, but the attendance CSV could not be downloaded: ${downloadError?.message || String(downloadError)}`);
      }

      const completedEventId = currentEventId;
      await stopCameraScanner();
      if (completeConfirmModalOverlay) completeConfirmModalOverlay.hidden = true;
      currentEvents = currentEvents.filter((item) => String(item.id) !== String(completedEventId));
      currentEventId = null;
      populateEventDropdown();
    } catch (err) {
      alert("Could not complete event: " + (err.message || err));
    } finally {
      btnConfirmCompleteModal.disabled = false;
      btnConfirmCompleteModal.textContent = "Confirm & Complete";
    }
  });
}

// Task 9: CSV Export (Exports active tab: Checked in or Absent)
if (btnExportCsv) {
  btnExportCsv.addEventListener("click", () => {
    const ev = currentEvents.find((e) => String(e.id) === String(currentEventId));
    const eventTitle = ev ? ev.name : "Event";
    const dateStamp = new Date().toISOString().slice(0, 10);
    const safeName = eventTitle.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);

    if (currentRosterTab === "checkedIn") {
      downloadAttendanceCsv(ev);
    } else {
      if (!currentAbsentRows || currentAbsentRows.length === 0) {
        alert("No absent records to export.");
        return;
      }
      const headers = ["Event", "Student Name", "Student Number", "Organization", "Status"];
      const csvLines = [headers.join(",")];
      currentAbsentRows.forEach((row) => {
        csvLines.push([
          `"${eventTitle.replace(/"/g, '""')}"`,
          `"${(row.name || "").replace(/"/g, '""')}"`,
          `"${(row.studentNo || "").replace(/"/g, '""')}"`,
          `"${(row.organization || "").replace(/"/g, '""')}"`,
          `"Absent"`,
        ].join(","));
      });
      downloadCsv(csvLines.join("\r\n"), `absent-${safeName}-${dateStamp}.csv`);
    }
  });
}

function downloadAttendanceCsv(event, { allowEmpty = false } = {}) {
  const rows = Array.isArray(currentAttendanceRows) ? currentAttendanceRows : [];
  if (!allowEmpty && rows.length === 0) {
    alert("No attendance records to export yet.");
    return false;
  }

  const eventTitle = String(event?.name || event?.title || "Event");
  const dateStamp = new Date().toISOString().slice(0, 10);
  const safeName = eventTitle.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 30);
  const headers = ["Time", "Student Name", "Student Number", "Organization", "Type", "Scanned By"];
  const csvLines = [headers.join(",")];
  rows.forEach((row) => {
    const date = new Date(row.scannedAt);
    const time = !Number.isNaN(date.getTime()) ? date.toLocaleTimeString("en-US") : "";
    const type = row.walkIn ? "Walk-in" : "Registered";
    csvLines.push([
      `"${time}"`,
      `"${(row.name || "").replace(/"/g, '""')}"`,
      `"${(row.studentNo || "").replace(/"/g, '""')}"`,
      `"${(row.organization || "").replace(/"/g, '""')}"`,
      `"${type}"`,
      `"${(row.scannedBy || "").replace(/"/g, '""')}"`,
    ].join(","));
  });
  downloadCsv(csvLines.join("\r\n"), `attendance-${safeName}-${dateStamp}.csv`);
  return true;
}

function downloadCsv(content, filename) {
  const csvContent = "\uFEFF" + content; // UTF-8 BOM
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.download = filename;
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Task 3: Camera Scanner with html5-qrcode
async function startCameraScanner() {
  if (!currentEventId) return;
  if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
    if (cameraErrorBox) cameraErrorBox.hidden = false;
    if (cameraErrorTitle) cameraErrorTitle.textContent = "Secure connection required";
    if (cameraErrorMessage) cameraErrorMessage.textContent = "Camera scanning requires HTTPS or localhost. Use manual student number check-in instead.";
    return;
  }
  if (typeof window.Html5Qrcode === "undefined") {
    console.warn("html5-qrcode library is not loaded yet.");
    return;
  }

  const readerElement = document.getElementById("qrReader");
  if (!readerElement) return;

  if (cameraErrorBox) cameraErrorBox.hidden = true;
  if (cameraPausedBox) cameraPausedBox.hidden = true;

  try {
    if (typeof window.Html5Qrcode.getCameras === "function") {
      const cameras = await window.Html5Qrcode.getCameras();
      if (!cameras.length) throw new Error("No camera found");
      if (btnSwitchCamera) btnSwitchCamera.disabled = cameras.length < 2;
    }
    if (!html5QrCodeInstance) {
      html5QrCodeInstance = new window.Html5Qrcode("qrReader");
    }

    const config = {
      fps: 10,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const edge = Math.min(viewfinderWidth, viewfinderHeight) * 0.75;
        return { width: Math.max(220, Math.floor(edge)), height: Math.max(220, Math.floor(edge)) };
      },
      aspectRatio: 1.0,
    };

    cameraStatus = "starting";
    await html5QrCodeInstance.start(
      { facingMode: currentFacingMode },
      config,
      onScanSuccess,
      onScanFailure,
    );

    cameraStatus = "running";
    if (scannerLiveDot) scannerLiveDot.classList.remove("dot-paused", "dot-error");
    if (btnToggleCameraLabel) btnToggleCameraLabel.textContent = "Pause camera";
  } catch (err) {
    console.error("Camera start error:", err);
    cameraStatus = "stopped";
    if (scannerLiveDot) scannerLiveDot.classList.add("dot-paused", "dot-error");
    if (btnToggleCameraLabel) btnToggleCameraLabel.textContent = "Start camera";

    if (cameraErrorBox) {
      cameraErrorBox.hidden = false;
      const isDenied = err && (err.name === "NotAllowedError" || String(err).includes("denied") || String(err).includes("Permission"));
      if (cameraErrorTitle) {
        cameraErrorTitle.textContent = isDenied ? "Camera permission denied" : "Camera unavailable";
      }
      if (cameraErrorMessage) {
        cameraErrorMessage.textContent = isDenied
          ? "Please allow camera access in your browser settings to scan attendance QR codes at the door."
          : "Could not access the camera. Please check device permissions or use manual student number check-in.";
      }
    }
  }
}

async function pauseCameraScanner() {
  if (html5QrCodeInstance && cameraStatus === "running") {
    try {
      if (typeof html5QrCodeInstance.pause === "function") {
        html5QrCodeInstance.pause(true);
      } else {
        await html5QrCodeInstance.stop();
      }
    } catch (e) {
      console.warn("Error pausing camera:", e);
    }
  }
  cameraStatus = "paused";
  if (scannerLiveDot) scannerLiveDot.classList.add("dot-paused");
  if (cameraPausedBox) cameraPausedBox.hidden = false;
  if (btnToggleCameraLabel) btnToggleCameraLabel.textContent = "Resume camera";
}

async function resumeCameraScanner() {
  if (cameraPausedBox) cameraPausedBox.hidden = true;
  if (html5QrCodeInstance && cameraStatus === "paused") {
    try {
      if (typeof html5QrCodeInstance.resume === "function") {
        html5QrCodeInstance.resume();
        cameraStatus = "running";
        if (scannerLiveDot) scannerLiveDot.classList.remove("dot-paused", "dot-error");
        if (btnToggleCameraLabel) btnToggleCameraLabel.textContent = "Pause camera";
        return;
      }
    } catch (e) {
      console.warn("Resume failed, restarting:", e);
    }
  }
  await startCameraScanner();
}

async function stopCameraScanner() {
  if (html5QrCodeInstance && (cameraStatus === "running" || cameraStatus === "paused")) {
    try {
      await html5QrCodeInstance.stop();
    } catch (e) {
      console.warn("Error stopping camera:", e);
    }
  }
  cameraStatus = "stopped";
  if (cameraPausedBox) cameraPausedBox.hidden = true;
  if (scannerLiveDot) scannerLiveDot.classList.add("dot-paused");
  if (btnToggleCameraLabel) btnToggleCameraLabel.textContent = "Start camera";
}

function cleanupCamera() {
  if (html5QrCodeInstance) {
    try {
      html5QrCodeInstance.stop().catch(() => {});
    } catch {}
  }
}

window.addEventListener("beforeunload", cleanupCamera);

if (btnRetryCamera) {
  btnRetryCamera.addEventListener("click", async () => {
    btnRetryCamera.disabled = true;
    const oldText = btnRetryCamera.textContent;
    btnRetryCamera.textContent = "Connecting...";
    try {
      await startCameraScanner();
    } finally {
      btnRetryCamera.disabled = false;
      btnRetryCamera.textContent = oldText;
    }
  });
}

if (btnResumePausedCamera) {
  btnResumePausedCamera.addEventListener("click", async () => {
    await resumeCameraScanner();
  });
}

if (btnToggleCamera) {
  btnToggleCamera.addEventListener("click", async () => {
    if (cameraStatus === "running") {
      await pauseCameraScanner();
    } else if (cameraStatus === "paused") {
      await resumeCameraScanner();
    } else {
      await startCameraScanner();
    }
  });
}

if (btnSwitchCamera) {
  btnSwitchCamera.addEventListener("click", async () => {
    if (cameraStatus !== "running" && cameraStatus !== "paused") {
      alert("Please start the camera before switching camera views.");
      return;
    }
    currentFacingMode = currentFacingMode === "environment" ? "user" : "environment";
    await stopCameraScanner();
    await startCameraScanner();
  });
}

// Walk-in Toggle with Confirmation Modal
function stripStudentNo(val) {
  return String(val || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

function applyWalkInState(newState) {
  isWalkInAllowed = Boolean(newState);
  if (walkInToggle) {
    walkInToggle.checked = isWalkInAllowed;
    walkInToggle.setAttribute("aria-checked", String(isWalkInAllowed));
  }
  if (currentEventId) {
    try {
      localStorage.setItem(`recovibe_walkin_${currentEventId}`, isWalkInAllowed ? "true" : "false");
    } catch {}
  }
  if (manualWalkInEntry) manualWalkInEntry.hidden = !isWalkInAllowed;
  if (manualHint) {
    manualHint.textContent = isWalkInAllowed
      ? "Search registered attendees above or use the walk-in form below."
      : "Select one registered student to confirm attendance.";
  }
  if (!isWalkInAllowed) {
    manualWalkInForm?.reset();
    if (manualWalkInError) {
      manualWalkInError.hidden = true;
      manualWalkInError.textContent = "";
    }
  }
}

function openWalkInModal(targetState) {
  pendingWalkInState = targetState;

  if (walkInModalHeading) {
    walkInModalHeading.textContent = targetState
      ? "Allow Walk-In Attendance?"
      : "Disable Walk-In Attendance?";
  }
  if (walkInModalDescription) {
    walkInModalDescription.innerHTML = targetState
      ? "Are you sure you want to <strong>allow walk-ins</strong>? Students who are not registered in advance will be permitted to check in at the entrance."
      : "Are you sure you want to <strong>disable walk-ins</strong>? Only students who are pre-registered will be permitted to check in.";
  }
  if (btnConfirmWalkInModal) {
    btnConfirmWalkInModal.textContent = targetState
      ? "Yes, Allow Walk-ins"
      : "Yes, Restrict Walk-ins";
  }
  if (walkInConfirmModalOverlay) {
    walkInConfirmModalOverlay.hidden = false;
  }
  btnConfirmWalkInModal?.focus();
}

function closeWalkInModal() {
  if (walkInConfirmModalOverlay) {
    walkInConfirmModalOverlay.hidden = true;
  }
  pendingWalkInState = null;
  // Always synchronize toggle visual to actual confirmed state
  if (walkInToggle) {
    walkInToggle.checked = isWalkInAllowed;
    walkInToggle.setAttribute("aria-checked", String(isWalkInAllowed));
  }
}

if (walkInToggle) {
  walkInToggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (walkInToggle.disabled) return;
    const targetState = !isWalkInAllowed;
    openWalkInModal(targetState);
  });
}

if (btnCancelWalkInModal) {
  btnCancelWalkInModal.addEventListener("click", closeWalkInModal);
}

if (btnConfirmWalkInModal) {
  btnConfirmWalkInModal.addEventListener("click", () => {
    if (pendingWalkInState !== null) {
      applyWalkInState(pendingWalkInState);
    }
    closeWalkInModal();
  });
}

if (walkInConfirmModalOverlay) {
  walkInConfirmModalOverlay.addEventListener("click", (e) => {
    if (e.target === walkInConfirmModalOverlay) {
      closeWalkInModal();
    }
  });
}

// QR Code Scanned Callback
async function onScanSuccess(decodedText) {
  if (isScanThrottled) return;

  const now = Date.now();
  // Task 3: Ignore repeat reads of the same code for 5 seconds
  if (decodedText === lastScannedText && now - lastScannedTime < 5000) {
    return;
  }

  // Task 3: Pause 1.5 seconds between scans
  isScanThrottled = true;
  lastScannedText = decodedText;
  lastScannedTime = now;

  setTimeout(() => {
    isScanThrottled = false;
  }, 1500);

  const allowWalkIn = isWalkInAllowed;
  await processAttendance({
    eventId: currentEventId,
    token: decodedText.trim(),
    allowWalkIn,
  });
}

function onScanFailure() {
  // Ignored per-frame failures during standard viewfinder scanning
}

// Attendance is processed in the client and stored in Realtime Database.
async function processAttendance({ eventId, token, allowWalkIn }) {
  if (!eventId) {
    alert("Please select an active event first.");
    return;
  }

  try {
    const result = await handleLocalAttendanceProcessing(eventId, token, allowWalkIn);
    handleAttendanceResult(result, token);
  } catch (err) {
    console.error("Attendance scan error:", err);
    const msg = err.message || "An unexpected error occurred during check-in.";
    showResultBanner({
      type: "error",
      title: "Check-in failed",
      name: "",
      meta: "",
      note: msg,
    });
  }
}

// Firestore is used for student lookup; attendance is written directly to RTDB.
async function handleLocalAttendanceProcessing(eventId, token, allowWalkIn, registeredStudent = null) {
  if (!rtdb || !auth?.currentUser) {
    throw new Error("Sign in and connect to Firebase before recording attendance.");
  }

  const rawToken = String(token || "").trim();
  const qrPayload = parseAttendanceQrPayload(rawToken, eventId);
  const normalizedStudentNo = formatStudentNo(qrPayload ? "" : rawToken);
  const hasStudentNumber = STUDENT_NO_REGEX.test(normalizedStudentNo);
  if (!hasStudentNumber && !rawToken && !registeredStudent?.uid) {
    return { status: "invalid_format", student: { studentNo: "" } };
  }

  let uid = "";
  let studentData = null;
  if (registeredStudent?.uid) {
    uid = String(registeredStudent.uid);
    studentData = {
      name: registeredStudent.name || "Student",
      studentNo: formatStudentNo(
        registeredStudent.studentNo || (registeredStudent.walkIn ? "" : normalizedStudentNo),
      ),
      organization: registeredStudent.organization || registeredStudent.course ||
        (registeredStudent.walkIn ? "" : "PUP Biñan"),
    };
  } else if (qrPayload) {
    uid = String(qrPayload.uid);
    const [legacyResult, eventResult] = await Promise.allSettled([
      get(ref(rtdb, `registrations/${eventId}/${uid}`)),
      get(ref(rtdb, `eventRegistrations/${eventId}/${uid}`)),
    ]);
    if (legacyResult.status === "rejected" && eventResult.status === "rejected") {
      throw legacyResult.reason;
    }
    const registration = mergeRegistrationMapsByUid(
      { [uid]: legacyResult.status === "fulfilled" ? legacyResult.value.val() : null },
      { [uid]: eventResult.status === "fulfilled" ? eventResult.value.val() : null },
    )[uid] || {};
    studentData = {
      name: registration.name ||
        String(qrPayload.email || "").split("@")[0] ||
        "Student",
      studentNo: formatStudentNo(registration.studentNo || registration.studentNumber || uid),
      organization: registration.organization || "PUP Biñan",
    };
  } else {
    let studentDocument = null;
    if (hasStudentNumber) {
      let studentSnapshot = await getDocsCached(
        getDocs,
        query(
          collection(db, "users"),
          where("studentNumber", "==", normalizedStudentNo),
        ),
        `scan-student-number:${normalizedStudentNo}`,
        auth?.currentUser?.uid,
      );
      if (studentSnapshot.empty) {
        studentSnapshot = await getDocsCached(
          getDocs,
          query(
            collection(db, "users"),
            where("studentId", "==", normalizedStudentNo),
          ),
          `scan-student-id:${normalizedStudentNo}`,
          auth?.currentUser?.uid,
        );
      }
      studentDocument = studentSnapshot.docs[0] || null;
    } else {
      const studentSnapshot = await getDocCached(
        getDoc,
        doc(db, "users", rawToken),
        auth?.currentUser?.uid,
      );
      studentDocument = studentSnapshot.exists() ? studentSnapshot : null;
    }

    if (!studentDocument) {
      return { status: "not_found", student: { studentNo: normalizedStudentNo } };
    }
    uid = studentDocument.id;
    const studentProfile = studentDocument.data() || {};
    studentData = {
      name: studentProfile.fullName ||
        `${studentProfile.firstName || ""} ${studentProfile.lastName || ""}`.trim() ||
        studentProfile.name ||
        "Student",
      studentNo: formatStudentNo(
        studentProfile.studentNumber || studentProfile.studentId || normalizedStudentNo,
      ),
      organization: studentProfile.organization ||
        studentProfile.courseOrganization ||
        studentProfile.department ||
        "PUP Biñan",
    };
  }

  const knownAttendance = currentAttendanceRows.find((r) =>
    String(r.uid || "") === uid || stripStudentNo(r.studentNo) === stripStudentNo(normalizedStudentNo)
  );
  if (knownAttendance) {
    return { status: "already", student: knownAttendance, scannedAt: knownAttendance.scannedAt };
  }
  const [
    existingAttendanceResult,
    eventAttendanceResult,
    legacyEventAttendanceResult,
  ] = await Promise.allSettled([
    get(ref(rtdb, `attendance/${eventId}/${uid}`)),
    get(ref(rtdb, `eventAttendance/${eventId}/${uid}`)),
    get(ref(rtdb, `events/${eventId}/attendance/${uid}`)),
  ]);
  if (
    existingAttendanceResult.status === "rejected" &&
    eventAttendanceResult.status === "rejected" &&
    legacyEventAttendanceResult.status === "rejected"
  ) {
    throw existingAttendanceResult.reason;
  }
  const existingAttendance = mergeRegistrationMapsByUid(
    {
      [uid]: existingAttendanceResult.status === "fulfilled"
        ? existingAttendanceResult.value.val()
        : null,
    },
    {
      [uid]: eventAttendanceResult.status === "fulfilled"
        ? eventAttendanceResult.value.val()
        : null,
    },
    {
      [uid]: legacyEventAttendanceResult.status === "fulfilled"
        ? legacyEventAttendanceResult.value.val()
        : null,
    },
  )[uid];
  if (existingAttendance) {
    return {
      status: "already",
      student: { ...studentData, ...existingAttendance },
      scannedAt: existingAttendance.scannedAt,
    };
  }

  // Check registration from the selected event's existing registration records.
  const cleanUid = stripStudentNo(uid);
  const cleanStudentNo = stripStudentNo(studentData.studentNo);

  let isRegistered = Boolean(registeredStudent?.uid && !registeredStudent.walkIn);
  if (registeredStudent?.walkIn && studentData.studentNo) {
    const cleanWalkInStudentNo = stripStudentNo(studentData.studentNo);
    isRegistered = currentAbsentRows.some((row) =>
      stripStudentNo(row.studentNo) === cleanWalkInStudentNo,
    );
  }

  // 1. Check currentAbsentRows (loaded from registrations for this event)
  if (currentAbsentRows.some((r) => {
    const s = stripStudentNo(r.studentNo);
    const u = stripStudentNo(r.uid);
    return s === cleanStudentNo || s === cleanUid || u === cleanUid;
  })) {
    isRegistered = true;
  }

  // 2. Check the event-keyed RTDB registrations, including the legacy path.
  if (!isRegistered && rtdb && !registeredStudent?.walkIn) {
    try {
      const [legacyResult, eventResult] = await Promise.allSettled([
        get(ref(rtdb, `registrations/${eventId}`)),
        get(ref(rtdb, `eventRegistrations/${eventId}`)),
      ]);
      if (legacyResult.status === "rejected" && eventResult.status === "rejected") {
        throw legacyResult.reason;
      }
      const registrations = mergeRegistrationMapsByUid(
        legacyResult.status === "fulfilled" ? legacyResult.value.val() || {} : {},
        eventResult.status === "fulfilled" ? eventResult.value.val() || {} : {},
      );
      const directRegistration = registrations[uid];
      isRegistered = isRegistrationActive(directRegistration) ||
        Object.values(registrations).some((registration) =>
          isRegistrationActive(registration) && (
            stripStudentNo(registration.studentNo || registration.studentNumber) === cleanStudentNo ||
            stripStudentNo(registration.uid) === cleanUid
          ),
        );
      if (!isRegistered && cleanStudentNo) {
        isRegistered = Object.values(registrations).some((registration) =>
          isRegistrationActive(registration) &&
          stripStudentNo(registration.studentNo || registration.studentNumber) === cleanStudentNo,
        );
      }
    } catch (registrationError) {
      console.warn("[Scan Attendance] Registration lookup failed:", registrationError);
    }
  }

  if (!isRegistered && !allowWalkIn) {
    return {
      status: "not_registered",
      student: studentData,
    };
  }

  // Record attendance
  const now = Date.now();
  const scannedBy = organizerDisplayName || auth?.currentUser?.displayName || auth?.currentUser?.email || "Event Organizer";

  const isWalkIn = !isRegistered;
  const attendanceRow = {
    scannedAt: now,
    scannedBy,
    walkIn: isWalkIn,
    name: studentData.name,
    studentNo: studentData.studentNo,
    organization: studentData.organization,
  };

  const attendanceWrite = await writeEventAttendance({
    rtdb,
    db,
    eventId,
    uid,
    attendance: attendanceRow,
  });
  if (!attendanceWrite.committed) {
    const existingAttendance = attendanceWrite.record || {};
    return {
      status: "already",
      student: { ...studentData, ...existingAttendance },
      scannedAt: existingAttendance.scannedAt,
    };
  }

  // If registered student checked in, remove from absent rows
  if (!isWalkIn) {
    currentAbsentRows = currentAbsentRows.filter((r) => {
      const s = stripStudentNo(r.studentNo);
      const u = stripStudentNo(r.uid);
      return s !== cleanStudentNo && s !== cleanUid && u !== cleanUid;
    });
  }

  // Update local list
  currentAttendanceRows = [
    { uid, ...attendanceRow },
    ...currentAttendanceRows.filter((row) => row.uid !== uid),
  ];
  updateRosterDisplay();
  try {
    localStorage.setItem(`recovibe_attendance_${eventId}`, JSON.stringify(currentAttendanceRows));
  } catch {}

  return {
    status: "ok",
    walkIn: isWalkIn,
    student: studentData,
  };
}

// Result Dispatcher (Task 4)
function handleAttendanceResult(result, originalToken) {
  if (!result) return;

  const student = result.student || {};
  const sName = student.name || "";
  const sNum = student.studentNo || student.studentNumber || "—";
  const sOrg = student.organization || "PUP Biñan";
  const metaText = `${sNum} · ${sOrg}`;

  if (result.status === "ok") {
    const isWalkIn = Boolean(result.walkIn);
    showResultBanner({
      type: "ok",
      title: isWalkIn ? "Checked in (Walk-in)" : "Checked in",
      name: sName,
      meta: metaText,
      note: "Attendance recorded successfully.",
    });
  } else if (result.status === "already") {
    const earlierDate = result.scannedAt ? new Date(result.scannedAt) : null;
    const earlierTimeStr = earlierDate && !Number.isNaN(earlierDate.getTime())
      ? earlierDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "earlier";
    showResultBanner({
      type: "already",
      title: "Already checked in",
      name: sName,
      meta: metaText,
      note: `This student was already checked in at ${earlierTimeStr}.`,
    });
  } else if (result.status === "not_registered") {
    showResultBanner({
      type: "not-registered",
      title: "Not registered",
      name: sName,
      meta: metaText,
      note: "This student is not registered for this event.",
      allowWalkInAction: true,
      token: originalToken,
    });
  } else if (result.status === "not_found") {
    showResultBanner({
      type: "error",
      title: "Student not found",
      name: "",
      meta: sNum,
      note: "No student with this student number was found.",
    });
  } else if (result.status === "invalid_format") {
    showResultBanner({
      type: "error",
      title: "Invalid student number",
      name: "",
      meta: sNum,
      note: "Student number must follow the format 2023-00123-BN-0.",
    });
  } else if (result.status === "replaced") {
    showResultBanner({
      type: "replaced",
      title: "Replaced QR code",
      name: sName,
      meta: metaText,
      note: "This QR code was replaced. Ask the student to download their new one.",
    });
  } else {
    showResultBanner({
      type: "error",
      title: "Check-in notice",
      name: sName,
      meta: metaText,
      note: result.message || "Could not process this QR code.",
    });
  }
}

// Task 6: Manual Lookup
const STUDENT_NO_REGEX = /^\d{4}-\d{5}-BN-\d$/;

function formatStudentNo(val) {
  return String(val || "").trim().toUpperCase();
}

function clearManualSearch(clearInput = false) {
  if (manualSearchTimer) {
    clearTimeout(manualSearchTimer);
    manualSearchTimer = null;
  }
  manualSearchRequestId += 1;
  manualSearchMatches = [];
  manualSearchTerm = "";
  manualSearchEventId = null;
  manualSelectedStudentUid = "";
  if (clearInput && manualStudentNo) manualStudentNo.value = "";
  if (manualStudentNo) manualStudentNo.classList.remove("input-error");
  if (manualValidationError) {
    manualValidationError.hidden = true;
    manualValidationError.textContent = "";
  }
  if (manualSearchResult) {
    manualSearchResult.replaceChildren();
    manualSearchResult.className = "manual-search-result";
    manualSearchResult.hidden = true;
  }
  if (btnManualSubmit) btnManualSubmit.disabled = true;
}

function showManualSearchMessage(message, state = "") {
  if (!manualSearchResult) return;
  manualSearchResult.replaceChildren();
  manualSearchResult.className = "manual-search-result";
  if (state) manualSearchResult.classList.add(state);
  const messageRow = document.createElement("p");
  messageRow.className = "manual-search-message";
  messageRow.textContent = message;
  manualSearchResult.appendChild(messageRow);
  manualSearchResult.hidden = false;
}

function renderManualSearchResults(matches, term, eventId, preferredUid = "") {
  manualSearchMatches = matches;
  manualSearchTerm = term;
  manualSearchEventId = eventId;
  if (!manualSearchResult) return;
  manualSearchResult.replaceChildren();
  manualSearchResult.className = "manual-search-result";
  const availableMatches = matches.filter((student) => !student.checkedIn);
  const selectedStudent = availableMatches.find((student) =>
    String(student.uid) === String(preferredUid || manualSelectedStudentUid),
  );
  manualSelectedStudentUid = selectedStudent?.uid || "";

  if (matches.length === 0) {
    showManualSearchMessage(isWalkInAllowed
      ? "No registered student found. Enter their name below to check in as a walk-in."
      : "No registered student found. Search by student number or name.");
  } else {
    matches.forEach((student) => {
      const row = document.createElement("button");
      const isSelected = String(student.uid) === String(manualSelectedStudentUid);
      row.type = "button";
      row.className = "manual-search-result-row";
      row.dataset.manualStudentUid = student.uid;
      row.setAttribute("aria-pressed", String(isSelected));
      row.disabled = student.checkedIn || manualCheckInInProgress;
      const details = document.createElement("div");
      details.className = "manual-search-result-details";
      const name = document.createElement("span");
      name.className = "manual-search-result-name";
      name.textContent = student.name || "Student";
      const meta = document.createElement("span");
      meta.className = "manual-search-result-meta";
      meta.textContent = [
        student.studentNo,
        student.course,
        student.section,
        student.organization,
        student.studentNo ? "" : student.uid,
      ]
        .filter(Boolean)
        .join(" · ");
      const status = document.createElement("span");
      status.className = `manual-search-status ${student.checkedIn ? "already" : "registered"}`;
      status.textContent = student.checkedIn ? "Already checked in" : "Registered";
      details.append(name, meta);
      row.append(details, status);
      manualSearchResult.appendChild(row);
    });
    if (availableMatches.length > 1 && !selectedStudent) {
      const messageRow = document.createElement("p");
      messageRow.className = "manual-search-message";
      messageRow.textContent = "Select the registered student to check in, or continue typing to narrow your search.";
      manualSearchResult.appendChild(messageRow);
    } else if (availableMatches.length === 0) {
      const messageRow = document.createElement("p");
      messageRow.className = "manual-search-message";
      messageRow.textContent = "All matching students are already checked in.";
      manualSearchResult.appendChild(messageRow);
    }
  }

  manualSearchResult.hidden = false;
  const currentEvent = currentEvents.find((event) => String(event.id) === String(eventId));
  if (btnManualSubmit) {
    btnManualSubmit.disabled =
      manualCheckInInProgress ||
      !rtdb ||
      !auth?.currentUser ||
      String(currentEventId) !== String(eventId) ||
      currentEvent?.status === "completed" ||
      !selectedStudent;
  }
}

async function loadManualRegistrationIndex(eventId) {
  const key = String(eventId);
  const cached = manualRegistrationCache.get(key);
  if (cached?.value && Date.now() - cached.loadedAt < 30000) return cached.value;
  if (cached?.promise) return cached.promise;

  const promise = (async () => {
    const [firestoreResult, legacyRealtimeResult, realtimeResult] = await Promise.allSettled([
      db
        ? getDocs(collection(db, "events", key, "registrations"))
        : Promise.reject(new Error("Firestore is unavailable.")),
      rtdb
        ? get(ref(rtdb, `registrations/${key}`))
        : Promise.reject(new Error("Realtime Database is unavailable.")),
      rtdb
        ? get(ref(rtdb, `eventRegistrations/${key}`))
        : Promise.reject(new Error("Realtime Database is unavailable.")),
    ]);
    const hasFirestoreData = firestoreResult.status === "fulfilled";
    const hasRealtimeData =
      legacyRealtimeResult.status === "fulfilled" ||
      realtimeResult.status === "fulfilled";
    if (!hasFirestoreData && !hasRealtimeData) {
      const failures = [
        firestoreResult.reason,
        legacyRealtimeResult.reason,
        realtimeResult.reason,
      ]
        .map((error) => error?.code || error?.message)
        .filter(Boolean)
        .join("; ");
      throw new Error(`Could not read event registrations. ${failures}`.trim());
    }
    if (firestoreResult.status === "rejected") {
      console.warn("[Scan Attendance] Firestore registration lookup failed:", firestoreResult.reason);
    }
    if (legacyRealtimeResult.status === "rejected" || realtimeResult.status === "rejected") {
      console.warn(
        "[Scan Attendance] One or more RTDB registration paths could not be loaded:",
        legacyRealtimeResult.status === "rejected"
          ? legacyRealtimeResult.reason
          : realtimeResult.reason,
      );
    }

    const firestoreRegistrations = firestoreResult.status === "fulfilled"
      ? firestoreResult.value.docs.map((registrationDocument) => ({
        ...registrationDocument.data(),
        id: registrationDocument.id,
        uid: registrationDocument.id,
      }))
      : [];
    const realtimeRegistrations = mergeRegistrationMapsByUid(
      legacyRealtimeResult.status === "fulfilled"
        ? legacyRealtimeResult.value.val() || {}
        : {},
      realtimeResult.status === "fulfilled"
        ? realtimeResult.value.val() || {}
        : {},
    );
    const mergedRegistrations = mergeRegistrationMapsByUid(
      firestoreRegistrations,
      realtimeRegistrations,
    );
    return {
      attendees: buildManualAttendeeIndex([], mergedRegistrations),
      hasPartialSourceFailure:
        firestoreResult.status === "rejected" ||
        legacyRealtimeResult.status === "rejected" ||
        realtimeResult.status === "rejected",
    };
  })();
  manualRegistrationCache.set(key, { promise });

  try {
    const value = await promise;
    manualRegistrationCache.set(key, { value, loadedAt: Date.now() });
    return value;
  } catch (error) {
    manualRegistrationCache.delete(key);
    throw error;
  }
}

function titleCaseManualSearchTerm(term) {
  return String(term || "")
    .trim()
    .toLocaleLowerCase()
    .replace(/(^|\s)(\S)/g, (_, space, character) => `${space}${character.toLocaleUpperCase()}`);
}

async function findRegisteredProfiles(term, eventId, attendees) {
  const registeredUids = new Set(attendees.map((student) => String(student.uid)));
  if (!db || !registeredUids.size || term.length < 3) {
    return { attendees, hasPartialFailure: false };
  }

  const cacheKey = `${auth?.currentUser?.uid || ""}:${eventId}:${term}`;
  let cached = manualProfileSearchCache.get(cacheKey);
  if (!cached || Date.now() - cached.loadedAt >= 60000) {
    const isStudentNumberSearch = /\d/.test(term);
    const searchTerm = isStudentNumberSearch ? term : titleCaseManualSearchTerm(term);
    const nameTokens = searchTerm.split(/\s+/).filter(Boolean);
    const searchFields = isStudentNumberSearch
      ? ["studentNumber", "studentNo", "studentId"].map((field) => ({ field, term: searchTerm }))
      : [
          { field: "fullName", term: searchTerm },
          { field: "name", term: searchTerm },
          { field: "firstName", term: nameTokens[0] },
          { field: "lastName", term: nameTokens[nameTokens.length - 1] },
        ];
    const results = await Promise.allSettled(searchFields.map(({ field, term: fieldTerm }) => getDocs(query(
      collection(db, "users"),
      orderBy(field),
      startAt(fieldTerm),
      endAt(`${fieldTerm}\uf8ff`),
      limit(50),
    ))));
    const successfulResults = results.filter((result) => result.status === "fulfilled");
    if (!successfulResults.length) {
      throw results[0]?.reason || new Error("Could not search student profiles.");
    }
    cached = {
      profiles: successfulResults.flatMap((result) =>
        result.value.docs.map((profileDocument) => ({
          ...profileDocument.data(),
          uid: profileDocument.id,
        })),
      ),
      hasPartialFailure: successfulResults.length !== results.length,
      loadedAt: Date.now(),
    };
    manualProfileSearchCache.set(cacheKey, cached);
  }

  const registeredProfiles = cached.profiles.filter((profile) =>
    registeredUids.has(String(profile.uid)),
  );
  return {
    attendees: registeredProfiles.length
      ? buildManualAttendeeIndex([...attendees, ...registeredProfiles], {})
      : attendees,
    hasPartialFailure: cached.hasPartialFailure,
  };
}

async function searchManualStudents(term, eventId, requestId) {
  if (
    requestId !== manualSearchRequestId ||
    String(eventId || "") !== String(currentEventId || "") ||
    formatStudentNo(manualStudentNo?.value) !== term
  ) return;

  if (!eventId || (!db && !rtdb)) {
    if (manualValidationError) {
      manualValidationError.textContent = "Could not load this event's registrations. Please try again.";
      manualValidationError.hidden = false;
    }
    if (manualSearchResult) manualSearchResult.hidden = true;
    return;
  }

  try {
    const registrationIndex = await loadManualRegistrationIndex(eventId);
    if (
      requestId !== manualSearchRequestId ||
      String(eventId || "") !== String(currentEventId || "") ||
      formatStudentNo(manualStudentNo?.value) !== term
    ) return;

    const checkedInUids = new Set(
      currentAttendanceRows.map((row) => String(row.uid || "")),
    );
    let attendees = registrationIndex.attendees;
    let profileLookupHadPartialFailure = false;
    let matches = searchManualAttendees(attendees, term, checkedInUids);
    if (matches.length === 0 && attendees.length > 0) {
      const profileSearch = await findRegisteredProfiles(term, eventId, attendees);
      attendees = profileSearch.attendees;
      profileLookupHadPartialFailure = profileSearch.hasPartialFailure;
      if (
        requestId !== manualSearchRequestId ||
        String(eventId || "") !== String(currentEventId || "") ||
        formatStudentNo(manualStudentNo?.value) !== term
      ) return;
      matches = searchManualAttendees(attendees, term, checkedInUids);
    }
    renderManualSearchResults(matches, term, eventId);
    if (
      (registrationIndex.hasPartialSourceFailure || profileLookupHadPartialFailure) &&
      manualValidationError
    ) {
      manualValidationError.textContent =
        "Some registration or profile records could not be loaded. Search results may be incomplete.";
      manualValidationError.hidden = false;
    } else if (manualValidationError) {
      manualValidationError.hidden = true;
      manualValidationError.textContent = "";
    }
  } catch (error) {
    if (
      requestId !== manualSearchRequestId ||
      String(eventId || "") !== String(currentEventId || "") ||
      formatStudentNo(manualStudentNo?.value) !== term
    ) return;
    console.error("[Scan Attendance] Manual registration search failed:", error);
    if (manualValidationError) {
      const code = error?.code ? ` (${error.code})` : "";
      manualValidationError.textContent =
        `Could not search this event's registrations${code}. ${error?.message || "Please retry."}`;
      manualValidationError.hidden = false;
    }
    if (manualSearchResult) manualSearchResult.hidden = true;
    if (btnManualSubmit) btnManualSubmit.disabled = true;
  }
}

function runManualSearch(immediate = false) {
  if (manualSearchTimer) {
    clearTimeout(manualSearchTimer);
    manualSearchTimer = null;
  }
  const term = formatStudentNo(manualStudentNo?.value);
  if (manualValidationError) {
    manualValidationError.hidden = true;
    manualValidationError.textContent = "";
  }
  manualStudentNo?.classList.remove("input-error");
  if (!term) {
    clearManualSearch();
    return;
  }

  manualSearchMatches = [];
  manualSearchTerm = term;
  manualSearchEventId = String(currentEventId || "");
  manualSelectedStudentUid = "";
  const requestId = ++manualSearchRequestId;
  const eventId = currentEventId;
  if (btnManualSubmit) btnManualSubmit.disabled = true;
  showManualSearchMessage("Searching registered students…", "is-loading");
  if (immediate) {
    searchManualStudents(term, eventId, requestId);
  } else {
    manualSearchTimer = window.setTimeout(() => {
      manualSearchTimer = null;
      searchManualStudents(term, eventId, requestId);
    }, 300);
  }
}

async function checkInManualSearchResult(student) {
  if (
    manualCheckInInProgress ||
    !student ||
    !currentEventId ||
    String(manualSearchEventId) !== String(currentEventId) ||
    String(manualSelectedStudentUid) !== String(student.uid) ||
    student.checkedIn
  ) return;

  const eventId = currentEventId;
  const currentEvent = currentEvents.find((event) => String(event.id) === String(eventId));
  if (currentEvent?.status === "completed") return;
  manualCheckInInProgress = true;
  if (btnManualSubmit) {
    btnManualSubmit.textContent = "Checking in...";
  }
  renderManualSearchResults(manualSearchMatches, manualSearchTerm, manualSearchEventId);
  if (manualValidationError) {
    manualValidationError.hidden = true;
    manualValidationError.textContent = "";
  }

  try {
    const lookupToken = student.studentNo || student.uid;
    const result = await handleLocalAttendanceProcessing(eventId, lookupToken, false, student);
    handleAttendanceResult(result, lookupToken);
    if (result.status === "ok" || result.status === "already") {
      renderManualSearchResults(
        manualSearchMatches.map((match) =>
          match.uid === student.uid ? { ...match, checkedIn: true } : match
        ),
        manualSearchTerm,
        manualSearchEventId,
      );
    } else if (result.status === "not_registered") {
      manualSearchMatches = [];
      showManualSearchMessage("No registered student found. Search by student number or name.");
    }
  } catch (error) {
    console.error("Manual check-in error:", error);
    if (manualValidationError) {
      const code = error?.code ? ` (${error.code})` : "";
      manualValidationError.textContent =
        `Could not record attendance${code}. ${error?.message || "Please retry."}`;
      manualValidationError.hidden = false;
    }
    showResultBanner({
      type: "error",
      title: "Lookup failed",
      name: student.name,
      meta: student.studentNo,
      note: error.message || "Could not record attendance for this student number.",
    });
  } finally {
    manualCheckInInProgress = false;
    if (btnManualSubmit) {
      btnManualSubmit.textContent = "Check In";
    }
    renderManualSearchResults(
      manualSearchMatches,
      manualSearchTerm,
      manualSearchEventId,
    );
  }
}

if (manualSearchResult) {
  manualSearchResult.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const resultButton = target?.closest("button[data-manual-student-uid]");
    if (!resultButton || resultButton.disabled) return;
    const student = manualSearchMatches.find((match) =>
      String(match.uid) === String(resultButton.dataset.manualStudentUid),
    );
    if (!student || student.checkedIn || manualCheckInInProgress) return;
    renderManualSearchResults(
      manualSearchMatches,
      manualSearchTerm,
      manualSearchEventId,
      student.uid,
    );
    Array.from(manualSearchResult.querySelectorAll("button[data-manual-student-uid]"))
      .find((button) => button.dataset.manualStudentUid === String(student.uid))
      ?.focus();
  });
}

if (manualStudentNo) {
  manualStudentNo.addEventListener("input", () => runManualSearch());
}

if (manualCheckInForm) {
  manualCheckInForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const term = formatStudentNo(manualStudentNo?.value);
    const selectedStudent = manualSearchMatches.find((student) =>
      String(student.uid) === String(manualSelectedStudentUid) && !student.checkedIn,
    );
    if (
      term &&
      term === manualSearchTerm &&
      String(manualSearchEventId) === String(currentEventId) &&
      selectedStudent
    ) {
      void checkInManualSearchResult(selectedStudent);
    } else if (
      term &&
      term === manualSearchTerm &&
      manualSearchMatches.some((student) => !student.checkedIn)
    ) {
      if (manualValidationError) {
        manualValidationError.textContent = "Select one registered student from the search results before checking in.";
        manualValidationError.hidden = false;
      }
    } else {
      runManualSearch(true);
    }
  });
}

if (manualWalkInForm) {
  manualWalkInForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (manualCheckInInProgress) return;

    const eventId = currentEventId;
    const currentEvent = currentEvents.find((item) => String(item.id) === String(eventId));
    const attendee = normalizeManualWalkInEntry({
      name: manualWalkInName?.value,
      studentNo: manualWalkInStudentNo?.value,
      organization: manualWalkInOrganization?.value,
    });
    if (!isWalkInAllowed) {
      if (manualWalkInError) {
        manualWalkInError.textContent = "Enable Allow walk-ins before checking in a walk-in attendee.";
        manualWalkInError.hidden = false;
      }
      return;
    }
    if (!attendee) {
      if (manualWalkInError) {
        manualWalkInError.textContent = "Enter the attendee's name to continue.";
        manualWalkInError.hidden = false;
      }
      manualWalkInName?.focus();
      return;
    }
    if (!eventId || currentEvent?.status === "completed" || !rtdb || !auth?.currentUser) {
      if (manualWalkInError) {
        manualWalkInError.textContent = currentEvent?.status === "completed"
          ? "This event is complete and no longer accepting check-ins."
          : "Select an active event and sign in before recording attendance.";
        manualWalkInError.hidden = false;
      }
      return;
    }

    manualCheckInInProgress = true;
    if (btnManualWalkInSubmit) {
      btnManualWalkInSubmit.disabled = true;
      btnManualWalkInSubmit.textContent = "Checking in...";
    }
    if (manualWalkInError) {
      manualWalkInError.hidden = true;
      manualWalkInError.textContent = "";
    }

    const uid = `walkin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      const walkInAttendee = { ...attendee, uid, walkIn: true };
      const result = await handleLocalAttendanceProcessing(eventId, uid, true, walkInAttendee);
      if (String(currentEventId) === String(eventId)) {
        handleAttendanceResult(result, uid);
        if (result.status === "ok") manualWalkInForm.reset();
        if (result.status !== "ok" && manualWalkInError) {
          manualWalkInError.textContent = result.status === "already"
            ? "This attendee has already been checked in."
            : "Could not record this walk-in. Please check the details and try again.";
          manualWalkInError.hidden = false;
        }
      }
    } catch (error) {
      console.error("Manual walk-in check-in error:", error);
      if (manualWalkInError) {
        const code = error?.code ? ` (${error.code})` : "";
        manualWalkInError.textContent =
          `Could not record this walk-in${code}. ${error?.message || "Please retry."}`;
        manualWalkInError.hidden = false;
      }
      showResultBanner({
        type: "error",
        title: "Walk-in check-in failed",
        name: attendee.name,
        meta: attendee.studentNo,
        note: error.message || "Could not record this walk-in.",
      });
    } finally {
      manualCheckInInProgress = false;
      if (btnManualWalkInSubmit) {
        btnManualWalkInSubmit.disabled = !isWalkInAllowed;
        btnManualWalkInSubmit.textContent = "Check in walk-in";
      }
    }
  });
}

// App Initialization
async function initApp() {
  if (eventsRefreshTimer) clearInterval(eventsRefreshTimer);
  await loadEventsList();
  eventsRefreshTimer = window.setInterval(() => loadEventsList(), 60000);
}
