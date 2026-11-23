import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  limit,
  onSnapshot,
  or,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { app, auth, db, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";
import { mountHelpBot } from "../recoVibeHelpBot.js";
import {
  eventBoundaryMillis,
  eventDateISO,
  getCurrentlyLivePublishedEvents,
  toEventDate,
} from "./eventOrganizerDashboardDates.js";

const { toMillis, formatCreatedDate } = window.RecovibeOrganizerDashboardDates;
const CREATION_DATE_PATHS = [
  ["createdAt"],
  ["created_at"],
  ["dateCreated"],
  ["date_created"],
  ["createdDate"],
  ["created_date"],
  ["createdAtMs"],
  ["created_at_ms"],
  ["createdTimestamp"],
  ["created_timestamp"],
  ["creationTimestamp"],
  ["timestampCreated"],
  ["timeCreated"],
  ["creationDate"],
  ["dateCreatedAt"],
  ["createdOn"],
  ["created_on"],
  ["submittedAt"],
  ["submitted_at"],
  ["submittedTimestamp"],
  ["submittedDate"],
  ["submittedOn"],
  ["submitted_on"],
  ["dateSubmitted"],
  ["date_submitted"],
  ["metadata", "createdAt"],
  ["metadata", "created_at"],
  ["metadata", "dateCreated"],
  ["metadata", "createdDate"],
  ["metadata", "createdTimestamp"],
  ["meta", "createdAt"],
  ["meta", "created_at"],
  ["timestamps", "createdAt"],
  ["timestamps", "created_at"],
  ["audit", "createdAt"],
  ["audit", "created_at"],
  ["audit", "createdDate"],
  ["audit", "timestamp"],
];
const GENERIC_TIMESTAMP_PATHS = [
  ["timestamp"],
  ["metadata", "timestamp"],
  ["meta", "timestamp"],
  ["timestamps", "timestamp"],
];
const UPDATED_DATE_PATHS = [
  ["updatedAt"],
  ["updated_at"],
  ["lastUpdatedAt"],
  ["modifiedAt"],
  ["dateModified"],
  ["metadata", "updatedAt"],
  ["metadata", "updated_at"],
  ["timestamps", "updatedAt"],
  ["audit", "updatedAt"],
];
const loginPath = "EventOrganizerLogin.html";
const actionRows = document.getElementById("organizerActionRows");
const actionTable = document.getElementById("actionRequiredTable");
const upcomingEventsList = document.getElementById("upcomingEventsList");
const happeningNowList = document.getElementById("happeningNowList");
const logoutButton = document.getElementById("organizerLogout");
const dashboardStatus = document.getElementById("dashboardStatusMessage");
let unsubscribeEvents = null;
let unsubscribeHappeningNowEvents = [];
let unsubscribeAuth = null;
let organizerEvents = [];
let happeningNowEvents = [];
let happeningNowEventsLoading = false;
let happeningNowEventsError = "";
let happeningNowEventsLoadingTimer = null;
let happeningNowEventSnapshotsBySource = new Map();
let organizerIdentity = null;
let eventSnapshotsBySource = new Map();
let academicNotificationItems = [];
let unsubscribeAcademicNotifications = null;
let signingOut = false;
let dashboardPageLoadSignaled = false;
const pendingInitialDashboardSources = new Set(["events"]);
const dashboardMessages = new Map();

function signalDashboardPageReady() {
  if (dashboardPageLoadSignaled) return;
  dashboardPageLoadSignaled = true;
  window.dispatchEvent(new Event("page-data-ready"));
}

function settleInitialDashboardSource(source) {
  pendingInitialDashboardSources.delete(source);
  if (pendingInitialDashboardSources.size === 0) signalDashboardPageReady();
}

function setDashboardMessage(source, message) {
  if (!dashboardStatus) return;
  if (message) dashboardMessages.set(source, message);
  else dashboardMessages.delete(source);
  dashboardStatus.textContent = [...dashboardMessages.values()].join(" ");
  dashboardStatus.hidden = dashboardMessages.size === 0;
}

function renderAcademicCalendarAlerts() {
  const container = document.getElementById("academicCalendarAlerts");
  if (!container) return;
  const items = academicNotificationItems
    .filter((item) => item.type === "academic_calendar")
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

const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );

function normalizedIdentityValue(value) {
  if (value && typeof value === "object") {
    value = value.organizationCode || value.orgCode || value.code ||
      value.organizationName || value.orgName || value.name || value.label || "";
  }
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readOrganizerIdentity(user) {
  let profile = {};
  try {
    const storedProfile = localStorage.getItem("recovibeOrganizerProfile");
    profile = storedProfile ? JSON.parse(storedProfile) || {} : {};
  } catch (error) {
    console.error("Unable to read organizer identity:", error);
  }
  const rawOrganizations = [
    profile.organizationCode,
    profile.orgCode,
    profile.organizationName,
    profile.organization,
    profile.orgName,
    profile.councilName,
  ].flatMap((value) =>
    value && typeof value === "object"
      ? [
          value.organizationCode,
          value.orgCode,
          value.code,
          value.organizationName,
          value.orgName,
          value.name,
          value.label,
        ]
      : [value],
  ).filter(Boolean);
  const cscAliases = ["CSC", "Campus Student Council", "CSC Representative"];
  const normalizedOrganizations = new Set(
    rawOrganizations.map(normalizedIdentityValue).filter(Boolean),
  );
  if (cscAliases.some((alias) => normalizedOrganizations.has(normalizedIdentityValue(alias)))) {
    cscAliases.forEach((alias) => normalizedOrganizations.add(normalizedIdentityValue(alias)));
  }
  const titleCase = (value) =>
    value.replace(/\b\w/g, (letter) => letter.toUpperCase());
  const organizationQueryValues = new Set();
  rawOrganizations.concat(
    cscAliases.filter((alias) => normalizedOrganizations.has(normalizedIdentityValue(alias))),
  ).forEach((value) => {
    const text = String(value).trim();
    if (!text) return;
    organizationQueryValues.add(text);
    organizationQueryValues.add(text.toUpperCase());
    organizationQueryValues.add(text.toLowerCase());
    organizationQueryValues.add(titleCase(text.toLowerCase()));
  });
  const rawEmails = [user.email, profile.email, profile.organizerEmail]
    .map((email) => String(email || "").trim())
    .filter(Boolean);
  return {
    uid: String(user.uid || ""),
    emails: new Set(
      rawEmails.map((email) => email.toLowerCase()),
    ),
    emailQueryValues: [...new Set(rawEmails.flatMap((email) => [
      email,
      email.toLowerCase(),
      email.toUpperCase(),
    ]))].slice(0, 30),
    organizations: normalizedOrganizations,
    organizationQueryValues: [...organizationQueryValues].slice(0, 30),
  };
}

function eventBelongsToOrganizer(event, identity = organizerIdentity) {
  if (!identity) return false;
  const ownerIds = [
    event.organizerUid,
    event.organizerId,
    event.createdBy,
    event.createdByUid,
    event.submittedBy,
    event.submittedByUid,
    event.creatorUid,
    event.creatorId,
    event.createdByUserId,
    event.userUid,
    event.uid,
    event.userId,
    event.ownerId,
    event.ownerUid,
  ].flatMap(ownershipIdentityValues).map((value) => String(value || ""));
  if (identity.uid && ownerIds.includes(identity.uid)) return true;
  const ownerEmails = [
    event.organizerEmail,
    event.createdByEmail,
    event.creatorEmail,
    event.submittedByEmail,
    event.ownerEmail,
    event.email,
    ...ownerIds,
  ].map((email) => String(email || "").trim().toLowerCase());
  if (ownerEmails.some((email) => identity.emails.has(email))) return true;
  const eventOrganizations = [
    event.organizationCode,
    event.orgCode,
    event.organizationName,
    event.organization,
    event.organizerOrganization,
    event.orgName,
    event.councilName,
    event.council,
    event.organizerName,
  ].map(normalizedIdentityValue).filter(Boolean);
  return eventOrganizations.some((organization) =>
    identity.organizations.has(organization),
  );
}

function ownershipIdentityValues(value) {
  if (!value || typeof value !== "object") return [value];
  return [value.uid, value.userId, value.id, value.email].filter(Boolean);
}

function eventBelongsToCurrentAccount(event) {
  const user = auth?.currentUser;
  const uid = String(user?.uid || "").trim();
  const ownerIdentifiers = [
    event.organizerId,
    event.organizerUid,
    event.createdByUid,
    event.createdBy,
    event.submittedBy,
    event.submittedByUid,
    event.creatorUid,
    event.creatorId,
    event.createdByUserId,
    event.userUid,
    event.uid,
    event.userId,
    event.ownerId,
    event.ownerUid,
  ].flatMap(ownershipIdentityValues)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (uid && ownerIdentifiers.includes(uid)) return true;
  const uidValues = ownerIdentifiers.filter((value) => !value.includes("@"));
  if (uidValues.length) return false;

  const email = String(user?.email || "").trim().toLowerCase();
  if (!email) return false;
  return [
    event.organizerEmail,
    event.createdByEmail,
    event.submittedByEmail,
    event.creatorEmail,
    event.ownerEmail,
    event.email,
    ...ownerIdentifiers,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .includes(email);
}

function valueAtPath(record, path) {
  return path.reduce(
    (value, key) => value && typeof value === "object" ? value[key] : undefined,
    record,
  );
}

function findNestedTimestampValues(record, keyPattern, maxDepth = 5) {
  const values = [];
  const visited = new WeakSet();
  const visit = (value, depth) => {
    if (!value || typeof value !== "object" || depth > maxDepth || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    Object.entries(value).forEach(([key, nestedValue]) => {
      if (keyPattern.test(key)) values.push(nestedValue);
      if (nestedValue && typeof nestedValue === "object") visit(nestedValue, depth + 1);
    });
  };
  visit(record, 0);
  return values;
}

function eventTimestampMillis(value) {
  if (value && typeof value.toDate === "function") {
    try {
      const date = value.toDate();
      const millis = date instanceof Date ? date.getTime() : NaN;
      if (Number.isFinite(millis)) return millis;
    } catch (error) {
      console.warn("Could not read event creation timestamp:", error);
    }
  }
  const millis = toMillis(value);
  if (millis !== null) return millis;
  if (value && typeof value === "object") {
    const seconds = Number(value.seconds ?? value._seconds);
    const nanoseconds = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      return seconds * 1000 + nanoseconds / 1000000;
    }
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (/^\d{10,13}$/.test(text)) return toMillis(Number(text));
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}(?:\s|$)/.test(text)) {
      const parsed = Date.parse(text);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (/\b\d{4}\b/.test(text) && /[A-Za-z/-]/.test(text)) {
      const parsed = Date.parse(text);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function resolveEventCreatedAt(data, documentSnapshot) {
  const nestedCreationValues = findNestedTimestampValues(
    data,
    /(?:created|creation|submitted|submission|timestamp|timeCreated|dateCreated)/i,
  );
  const nestedUpdateValues = findNestedTimestampValues(
    data,
    /(?:updated|modified|lastChanged)/i,
  );
  const candidateValues = [
    ...CREATION_DATE_PATHS.map((path) => valueAtPath(data, path)),
    ...nestedCreationValues,
    ...GENERIC_TIMESTAMP_PATHS.map((path) => valueAtPath(data, path)),
    documentSnapshot.createTime,
    ...UPDATED_DATE_PATHS.map((path) => valueAtPath(data, path)),
    ...nestedUpdateValues,
    documentSnapshot.updateTime,
  ];
  const resolvedMillis = candidateValues
    .map(eventTimestampMillis)
    .find((millis) => millis !== null) ?? null;
  if (resolvedMillis !== null) return resolvedMillis;
  return documentSnapshot.metadata?.hasPendingWrites === true
    ? Date.now()
    : null;
}

function normalizeEvent(documentSnapshot) {
  const data = documentSnapshot.data();
  const schedule = data.schedule && typeof data.schedule === "object"
    ? data.schedule
    : {};
  const createdAt = resolveEventCreatedAt(data, documentSnapshot);
  const dateISO = data.eventDate || data.dateISO || data.dateStart || data.date ||
    data.event_date || data.date_start || data.startDate || data.start_date ||
    schedule.date || schedule.startDate || schedule.startDateTime ||
    eventDateISO(schedule.startAt || data.startDateTime || data.startAt) || "";
  const endDateISO = data.endDateISO || data.dateEnd || data.endDate ||
    data.end_date || schedule.endDate || schedule.dateEnd || schedule.endDateTime ||
    eventDateISO(schedule.endAt || data.endDateTime || data.endAt) || dateISO;
  const startTime = data.timeStart || data.startTime ||
    schedule.timeStart || schedule.startTime || schedule.start || "";
  const endTime = data.timeEnd || data.endTime ||
    schedule.timeEnd || schedule.endTime || schedule.end || "";
  const categories = Array.isArray(data.categories)
    ? data.categories.filter(Boolean).join(", ")
    : data.categories;

  return {
    ...data,
    id: documentSnapshot.id,
    eventId: documentSnapshot.id,
    title: data.eventName || data.title || "Untitled event",
    category: categories || data.category || data.eventType || "General",
    dateISO,
    endDateISO,
    startTime,
    endTime,
    time: data.time || schedule.time ||
      [startTime, endTime].filter(Boolean).join(" - "),
    location: data.venue || data.location || "Location TBA",
    venue: data.venue || data.location || "Location TBA",
    description: data.eventDescription || data.description || "",
    status: displayStatus(data.status),
    createdAt,
  };
}

function formatDate(value, options = {}) {
  const date = toEventDate(value);
  if (!date) return "Date TBA";
  return date.toLocaleDateString("en-US", options);
}

function statusClass(status) {
  return String(status || "Upcoming")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
}

  function displayStatus(status) {
    const normalized = normalizeStatus(status || "Pending");
    if (normalized === "rejected") return "Rejected";
    if (normalized === "revision") return "Needs Revision";
    if (normalized === "cancelled") return "Cancelled";
    if (normalized === "completed") return "Completed";
    if (normalized === "published") return "Published";
    if (normalized === "pending") return "Pending";
    if (normalized === "approved") return "Approved";
    if (normalized === "draft") return "Draft";
    if (normalized === "unknown") return "Unknown";
    return status || "Pending";
  }

function setCount(id, count) {
  const element = document.getElementById(id);
  if (!element) return;
  const nextCount = String(count);
  if (element.textContent !== nextCount) {
    const card = element.closest(".organizer-stat");
    if (card && element.textContent.trim() !== "") {
      card.classList.remove("stat-highlight");
      void card.offsetWidth;
      card.classList.add("stat-highlight");
    }
    element.textContent = nextCount;
  }
}

function normalizeStatus(status) {
  const raw = String(status ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (
    ["pending approval", "pending review", "awaiting approval", "awaiting review", "under review", "in review", "reviewing", "submitted"].includes(raw) ||
    raw.startsWith("pending ")
  ) return "pending";
  if ([
    "needs revision", "revision requested", "changes requested", "returned",
    "returned for revision", "returned for changes", "returned for correction",
    "needs changes", "needs correction", "revision", "rev",
  ].includes(raw)) return "revision";
  if (
    ["rejected", "reject", "rej", "disapproved", "disapprove", "denied"].includes(raw) ||
    raw.startsWith("rejected ") ||
    raw.startsWith("disapproved ")
  ) return "rejected";
  if ([
    "approve", "fully approved", "ready to publish", "ready for publication",
    "awaiting publication", "approved pending publish",
    "approved pending publication", "approved but unpublished",
    "approved and unpublished", "ok",
  ].includes(raw)) return "approved";
  if (["live", "published live"].includes(raw)) return "published";
  if (raw === "canceled") return "cancelled";
  return raw;
}

function hasTrueFlag(value) {
  return value === true || value === 1 || ["true", "yes", "1"].includes(String(value ?? "").trim().toLowerCase());
}

function getEventStatusValues(event) {
  return [
    event.status, event.approvalStatus, event.approval_status, event.adminStatus,
    event.admin_status, event.adminApprovalStatus, event.approvalState,
    event.approval_state, event.reviewStatus, event.reviewDecision,
    event.submissionStatus, event.workflowStatus, event.publicationStatus,
    event.moderationStatus, event.eventStatus, event.decision,
    event.isApproved, event.approved, event.published,
    event.approval?.approvalStatus, event.approval?.status,
    event.approval?.state, event.approval?.decision,
    event.admin?.status, event.review?.status, event.review?.decision,
    event.workflow?.status, event.moderation?.status,
    event.approvalData?.status, event.approvalData?.approvalStatus,
  ].filter((status) => status !== null && status !== undefined && status !== "").map(normalizeStatus);
}

function getEffectiveStatus(event) {
  const firestoreStatuses = getEventStatusValues(event);
  const eventStatus = firestoreStatuses[0] || "";
  if (eventStatus === "draft") return "draft";
  if (firestoreStatuses.includes("cancelled")) return "cancelled";
  if (firestoreStatuses.includes("rejected") || [event.isRejected, event.rejected].some(hasTrueFlag)) {
    return "rejected";
  }
  if (firestoreStatuses.includes("revision") || [event.revisionRequested, event.needsRevision].some(hasTrueFlag)) {
    return "revision";
  }
  const isPublished = ["published", "cancelled"].find((value) => firestoreStatuses.includes(value));
  if (isPublished) return isPublished;
  if ([event.published, event.isPublished, event.isLive].some(hasTrueFlag)) return "published";
  const approval = event.approval;
  if (normalizeStatus(approval?.status) === "published") return "published";
  const stageEntries = Array.isArray(event.approvalStages) ? event.approvalStages : Object.values(event.approvalStages || {});
  const requiredStageStatuses = stageEntries
    .filter((stage) => !stage || typeof stage !== "object" || (stage.required !== false && stage.enabled !== false))
    .map((stage) => normalizeStatus(typeof stage === "string" ? stage : stage?.status || stage?.approvalStatus || stage?.state || stage?.decision));
  if (firestoreStatuses.includes("approved")) return "approved";
  if ([event.isApproved, event.approved].some(hasTrueFlag)) return "approved";
  const members = Object.values(approval?.members || {});
  const approvalStatus = normalizeStatus(approval?.status);
  if (approvalStatus === "rejected" || approvalStatus === "revision" || approvalStatus === "approved") return approvalStatus;
  if (members.length > 0 && members.every((member) => ["approved", "ok"].includes(normalizeStatus(member.status)))) return "approved";
  if (requiredStageStatuses.includes("rejected")) return "rejected";
  if (requiredStageStatuses.includes("revision")) return "revision";
  if (requiredStageStatuses.length > 0 && requiredStageStatuses.every((status) => status === "approved")) return "approved";
  const fallbackStatus = firestoreStatuses.find((status) => status === "pending") || eventStatus || "pending";
  return fallbackStatus === "completed" ? "unknown" : fallbackStatus;
}

function hasEventEnded(event, now = Date.now()) {
  const end = eventBoundaryMillis(event, true);
  return end !== null && end <= now;
}

function getDashboardStatus(event) {
  const status = getEffectiveStatus(event);
  return status === "published" && hasEventEnded(event) ? "completed" : status;
}

function isTerminalActionEvent(event) {
  const statuses = getEventStatusValues(event);
  const terminalStatuses = ["completed", "complete", "ended", "finished", "cancelled"];
  return (
    [event.completed, event.isCompleted, event.ended, event.isEnded, event.cancelled, event.canceled]
      .some(hasTrueFlag) ||
    statuses.some((status) => terminalStatuses.includes(status)) ||
    hasEventEnded(event)
  );
}

function getSummaryEventStatus(event) {
  const statuses = getEventStatusValues(event);
  const effectiveStatus = getEffectiveStatus(event);
  const excludedStatuses = ["rejected", "revision", "draft", "cancelled"];
  if (
    excludedStatuses.includes(effectiveStatus) ||
    statuses.some((status) => excludedStatuses.includes(status))
  ) return effectiveStatus;

  const explicitlyApproved = ["approved", "published"].includes(effectiveStatus) ||
    statuses.some((status) => ["approved", "published"].includes(status)) ||
    [event.isApproved, event.approved, event.published, event.isPublished, event.isLive]
      .some(hasTrueFlag);
  const explicitlyCompleted = statuses.some((status) =>
    ["completed", "complete", "ended", "finished"].includes(status),
  );
  const endedByDate = hasEventEnded(event);
  const pendingOnly = statuses.includes("pending") &&
    !explicitlyApproved &&
    !explicitlyCompleted;
  if (pendingOnly) return "pending";
  if (explicitlyCompleted || endedByDate) return "completed";
  if (explicitlyApproved) return "approved";
  return effectiveStatus;
}

function renderStatistics() {
  const status = (event) =>
    String(event.status || "Upcoming")
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, " ");
  setCount(
    "activeEventsCount",
    organizerEvents.filter((event) =>
      [
        "upcoming",
        "pending",
        "pending approval",
        "approved",
        "draft",
      ].includes(getDashboardStatus(event)),
    ).length,
  );
  setCount(
    "pendingApprovalCount",
    organizerEvents.filter((event) =>
      ["pending", "pending approval", "needs revision"].includes(status(event)) &&
      !["approved", "published"].includes(getEffectiveStatus(event)),
    ).length,
  );
  setCount(
    "approvedEventsCount",
    organizerEvents.filter((event) =>
      ["approved", "published", "completed"].includes(getSummaryEventStatus(event)),
    ).length,
  );
  setCount(
    "completedEventsCount",
    organizerEvents.filter((event) =>
      getSummaryEventStatus(event) === "completed",
    ).length,
  );
}

function renderActionRows() {
  if (!actionRows) return;
  const actionableEvents = organizerEvents.filter((event) => {
    if (!eventBelongsToCurrentAccount(event)) return false;
    if (isTerminalActionEvent(event)) return false;
    const workflowStatus = getEffectiveStatus(event);
    const summaryStatus = getSummaryEventStatus(event);
    return workflowStatus === "pending" ||
      ["revision", "rejected", "draft"].includes(workflowStatus) ||
      (workflowStatus === "approved" && summaryStatus === "approved");
  }).sort((first, second) => {
    const firstCreated = toMillis(first.createdAt);
    const secondCreated = toMillis(second.createdAt);
    if (firstCreated === null) return secondCreated === null ? 0 : 1;
    if (secondCreated === null) return -1;
    return secondCreated - firstCreated;
  }).slice(0, 5);
  if (!actionableEvents.length) {
    actionRows.innerHTML = `<tr><td colspan="3"><div class="dashboard-empty-state"><strong>Nothing needs your action right now.</strong></div></td></tr>`;
    return;
  }

  actionRows.innerHTML = actionableEvents
    .map(
      (event) => {
        const status = displayStatus(getDashboardStatus(event));
        const createdAt = toMillis(event.createdAt);
        const createdAtText = formatCreatedDate(createdAt);
        return `<tr data-firestore-event-id="${escapeHtml(event.eventId)}" style="cursor: pointer;">
        <td><strong>${escapeHtml(event.title)}</strong><small>${escapeHtml(event.category || event.eventType || "General")}</small></td>
        <td>${escapeHtml(createdAtText)}</td>
        <td><span class="organizer-status ${statusClass(status)}">${escapeHtml(status)}</span></td>
      </tr>`;
      },
    )
    .join("");
}

function renderHappeningNow() {
  if (!happeningNowList) return;
  const happeningNow = getCurrentlyLivePublishedEvents(
    getHappeningNowCandidates(),
    Date.now(),
  );
  if (happeningNowEventsError && !happeningNow.length) {
    happeningNowList.innerHTML = `<div class="dashboard-empty-state compact"><strong>Could not load campus events</strong><span>${escapeHtml(happeningNowEventsError)}</span></div>`;
    return;
  }
  if (happeningNowEventsLoading && !happeningNow.length) {
    happeningNowList.innerHTML = `<div class="dashboard-empty-state compact"><strong>Loading campus events...</strong></div>`;
    return;
  }

  if (!happeningNow.length) {
    happeningNowList.innerHTML = `<div class="dashboard-empty-state compact"><strong>No events happening today</strong><span>Events scheduled for today will appear here.</span></div>`;
    return;
  }

  happeningNowList.innerHTML = happeningNow
    .map((event) => {
      const month = formatDate(event.dateISO, { month: "short" }).toUpperCase();
      const day = formatDate(event.dateISO, { day: "2-digit" });
      const year = formatDate(event.dateISO, { year: "numeric" });
      return `<article class="upcoming-event" data-firestore-event-id="${escapeHtml(event.eventId)}" style="cursor: pointer;">
        <div class="upcoming-event-date"><span class="upcoming-event-month">${escapeHtml(month)}</span><strong>${escapeHtml(day)}</strong><small>${escapeHtml(year)}</small></div>
        <div class="upcoming-event-content"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.time || "Time TBA")}</span><span>${escapeHtml(event.venue || "Location TBA")}</span></div>
      </article>`;
    })
    .join("");
}

function getHappeningNowCandidates() {
  const eventsById = new Map();
  [...happeningNowEvents, ...organizerEvents].forEach((event) => {
    const eventId = String(event.eventId || event.id || "");
    if (eventId) eventsById.set(eventId, event);
  });
  return [...eventsById.values()];
}

function renderUpcomingEvents() {
  if (!upcomingEventsList) return;
  const now = Date.now();

  const upcoming = organizerEvents
    .filter((event) => {
      const start = eventBoundaryMillis(event);
      const status = getDashboardStatus(event);
      return start !== null && start > now &&
        status !== "rejected" && status !== "cancelled";
    })
    .sort((first, second) => eventBoundaryMillis(first) - eventBoundaryMillis(second))
    .slice(0, 4);

  if (!upcoming.length) {
    upcomingEventsList.innerHTML = `<div class="dashboard-empty-state compact"><strong>No upcoming events</strong><span>Future events you create will appear here.</span></div>`;
    return;
  }

  upcomingEventsList.innerHTML = upcoming
    .map((event) => {
      const month = formatDate(event.dateISO, { month: "short" }).toUpperCase();
      const day = formatDate(event.dateISO, { day: "2-digit" });
      const year = formatDate(event.dateISO, { year: "numeric" });
      return `<article class="upcoming-event" data-firestore-event-id="${escapeHtml(event.eventId)}" style="cursor: pointer;">
        <div class="upcoming-event-date"><span class="upcoming-event-month">${escapeHtml(month)}</span><strong>${escapeHtml(day)}</strong><small>${escapeHtml(year)}</small></div>
        <div class="upcoming-event-content"><strong>${escapeHtml(event.title)}</strong><span>${escapeHtml(event.time || "Time TBA")}</span><span>${escapeHtml(event.venue || "Location TBA")}</span></div>
      </article>`;
    })
    .join("");
}

function renderDashboard() {
  organizerEvents.sort((first, second) => {
    const firstCreated = toMillis(first.createdAt) ?? 0;
    const secondCreated = toMillis(second.createdAt) ?? 0;
    return secondCreated - firstCreated;
  });
  renderStatistics();
  renderActionRows();
  renderHappeningNow();
  renderUpcomingEvents();
}

const actionHead = actionTable?.querySelector("thead");
if (actionHead) {
  const headerRow = document.createElement("tr");
  ["EVENT NAME", "DATE CREATED", "STATUS"].forEach((label) => {
    const heading = document.createElement("th");
    heading.textContent = label;
    headerRow.append(heading);
  });
  actionHead.replaceChildren(headerRow);
}
renderDashboard();
const dashboardRefreshTimer = window.setInterval(renderDashboard, 60000);

actionRows?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-firestore-event-id]");
  if (!item) return;
  const selectedEvent = organizerEvents.find(
    (eventItem) => eventItem.eventId === item.dataset.firestoreEventId,
  );
  if (selectedEvent) {
    window.RecovibeEventDetails?.open(selectedEvent, {
      showApprovalDocuments: true,
    });
  }
});

[happeningNowList, upcomingEventsList].forEach((container) => {
  container?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-firestore-event-id]");
    if (!item) return;
    const sourceEvents = container === happeningNowList
      ? getHappeningNowCandidates()
      : organizerEvents;
    const selectedEvent = sourceEvents.find(
      (eventItem) => eventItem.eventId === item.dataset.firestoreEventId,
    );
    if (selectedEvent) {
      window.RecovibeEventDetails?.open(selectedEvent, {
        showApprovalDocuments: container !== happeningNowList,
      });
    }
  });
});

function stopDashboardListeners() {
  unsubscribeEvents?.forEach((unsubscribe) => unsubscribe());
  unsubscribeEvents = null;
  unsubscribeHappeningNowEvents.forEach((unsubscribe) => unsubscribe());
  unsubscribeHappeningNowEvents = [];
  window.clearTimeout(happeningNowEventsLoadingTimer);
  happeningNowEventsLoadingTimer = null;
  happeningNowEvents = [];
  happeningNowEventsLoading = false;
  happeningNowEventsError = "";
  happeningNowEventSnapshotsBySource.clear();
  eventSnapshotsBySource.clear();
  unsubscribeAcademicNotifications?.();
  unsubscribeAcademicNotifications = null;
  academicNotificationItems = [];
  renderAcademicCalendarAlerts();
}

function startDashboardListeners(user) {
  try {
    organizerIdentity = readOrganizerIdentity(user);
    eventSnapshotsBySource = new Map();
    const eventsRef = collection(db, "events");
    const eventQueries = [
      [
        "owner-uid",
        query(
          eventsRef,
          or(
            where("organizerUid", "==", user.uid),
            where("organizerId", "==", user.uid),
            where("createdBy", "==", user.uid),
          ),
        ),
      ],
    ];
    [
      "createdByUid",
      "submittedBy",
      "submittedByUid",
      "creatorUid",
      "creatorId",
      "createdByUserId",
      "userUid",
      "uid",
      "userId",
      "ownerId",
      "ownerUid",
    ].forEach((field) => {
      eventQueries.push([
        `owner-uid-${field}`,
        query(eventsRef, where(field, "==", user.uid)),
      ]);
    });
    if (organizerIdentity.emails.size) {
      [
        "organizerEmail",
        "createdByEmail",
        "submittedByEmail",
        "creatorEmail",
        "ownerEmail",
        "email",
        "createdBy",
        "submittedBy",
      ].forEach((field) => {
        eventQueries.push([
          `owner-email-${field}`,
          query(eventsRef, where(field, "in", organizerIdentity.emailQueryValues)),
        ]);
      });
    }
    if (organizerIdentity.organizationQueryValues.length) {
      [
        "organizationCode",
        "organizationName",
        "organization",
        "organizerOrganization",
        "orgCode",
        "orgName",
        "councilName",
        "council",
        "organizerName",
      ].forEach((field) => {
        eventQueries.push([
          `organization-${field}`,
          query(eventsRef, where(field, "in", organizerIdentity.organizationQueryValues)),
        ]);
      });
    }

    const pendingEventSources = new Set(eventQueries.map(([source]) => source));
    const failedEventSources = new Set();
    const eventSourcesAtLimit = new Set();
    const refreshEvents = () => {
      const documentsById = new Map();
      eventSnapshotsBySource.forEach((documents) => {
        documents.forEach((documentSnapshot, id) => {
          const current = documentsById.get(id);
          const currentUpdatedAt = current?.updateTime?.toMillis?.() || 0;
          const nextUpdatedAt = documentSnapshot.updateTime?.toMillis?.() || 0;
          if (!current || nextUpdatedAt >= currentUpdatedAt) {
            documentsById.set(id, documentSnapshot);
          }
        });
      });
      organizerEvents = [...documentsById.values()]
        .map(normalizeEvent)
        .filter((event) => eventBelongsToOrganizer(event));
      renderDashboard();
      if (pendingEventSources.size === 0) {
        if (failedEventSources.size === eventQueries.length) {
          setDashboardMessage(
            "events",
            "Could not load your events. Check your connection and try again.",
          );
        } else {
          setDashboardMessage(
            "events",
            eventSourcesAtLimit.size
              ? "The dashboard event sample reached its 100-event source limit. Use All Events to browse the full paginated list."
              : "",
          );
        }
        settleInitialDashboardSource("events");
      }
    };

    unsubscribeEvents = eventQueries.map(([source, eventsQuery]) =>
      onSnapshot(
        query(eventsQuery, limit(100)),
        (snapshot) => {
          if (snapshot.size === 100) eventSourcesAtLimit.add(source);
          else eventSourcesAtLimit.delete(source);
          eventSnapshotsBySource.set(source, new Map(
            snapshot.docs.map((documentSnapshot) => [documentSnapshot.id, documentSnapshot]),
          ));
          pendingEventSources.delete(source);
          failedEventSources.delete(source);
          refreshEvents();
        },
        (error) => {
          console.error(`Unable to load organizer dashboard events (${source}):`, error.code, error.message);
          pendingEventSources.delete(source);
          failedEventSources.add(source);
          refreshEvents();
        },
      ),
    );

    const happeningNowQueries = [
      [
        "public-status",
        query(eventsRef, where("status", "in", [
          "approved", "Approved", "APPROVED",
          "published", "Published", "PUBLISHED",
          "completed", "Completed", "COMPLETED",
          "ended", "Ended", "ENDED",
          "rescheduled", "Rescheduled", "RESCHEDULED",
          "ongoing", "Ongoing", "ONGOING",
          "upcoming", "Upcoming", "UPCOMING",
          "active", "Active", "ACTIVE",
        ])),
      ],
      [
        "public-publication-status",
        query(eventsRef, where("publicationStatus", "in", [
          "published", "Published", "PUBLISHED",
        ])),
      ],
      ["public-published", query(eventsRef, where("published", "==", true))],
      ["public-is-published", query(eventsRef, where("isPublished", "==", true))],
    ];
    const pendingHappeningNowSources = new Set(
      happeningNowQueries.map(([source]) => source),
    );
    const failedHappeningNowSources = new Map();
    happeningNowEventSnapshotsBySource = new Map();
    happeningNowEventsLoading = true;
    happeningNowEventsError = "";
    renderHappeningNow();
    window.clearTimeout(happeningNowEventsLoadingTimer);
    happeningNowEventsLoadingTimer = window.setTimeout(() => {
      happeningNowEventsLoadingTimer = null;
      if (!happeningNowEventsLoading) return;
      happeningNowEventsLoading = false;
      if (happeningNowEventSnapshotsBySource.size === 0) {
        happeningNowEventsError =
          "Campus event sources are taking longer than expected. Check your connection and retry.";
      }
      renderHappeningNow();
    }, 8000);

    const refreshHappeningNowEvents = () => {
      const documentsById = new Map();
      happeningNowEventSnapshotsBySource.forEach((documents) => {
        documents.forEach((documentSnapshot, id) => {
          const current = documentsById.get(id);
          const currentUpdatedAt = current?.updateTime?.toMillis?.() || 0;
          const nextUpdatedAt = documentSnapshot.updateTime?.toMillis?.() || 0;
          if (!current || nextUpdatedAt >= currentUpdatedAt) {
            documentsById.set(id, documentSnapshot);
          }
        });
      });
      happeningNowEvents = [...documentsById.values()]
        .map(normalizeEvent)
        .filter(isStudentEventPublished);
      if (pendingHappeningNowSources.size === 0) {
        happeningNowEventsLoading = false;
        window.clearTimeout(happeningNowEventsLoadingTimer);
        happeningNowEventsLoadingTimer = null;
        if (failedHappeningNowSources.size === happeningNowQueries.length) {
          const failures = [...failedHappeningNowSources.values()];
          happeningNowEventsError = failures.every(
            (error) => error?.code === "permission-denied",
          )
            ? "Your account cannot read published campus events."
            : "Check your connection and try again.";
        } else {
          happeningNowEventsError = "";
        }
      }
      renderHappeningNow();
    };

    try {
      unsubscribeHappeningNowEvents = happeningNowQueries.map(([source, eventsQuery]) =>
        onSnapshot(
          query(eventsQuery, limit(100)),
          (snapshot) => {
            happeningNowEventSnapshotsBySource.set(source, new Map(
              snapshot.docs.map((documentSnapshot) => [
                documentSnapshot.id,
                documentSnapshot,
              ]),
            ));
            pendingHappeningNowSources.delete(source);
            failedHappeningNowSources.delete(source);
            refreshHappeningNowEvents();
          },
          (error) => {
            console.warn(
              `Unable to load EO dashboard Happening Now source (${source}):`,
              { code: error?.code || "unknown" },
            );
            pendingHappeningNowSources.delete(source);
            failedHappeningNowSources.set(source, error);
            refreshHappeningNowEvents();
          },
        ),
      );
    } catch (error) {
      console.error("Unable to start EO dashboard Happening Now sources:", error);
      pendingHappeningNowSources.clear();
      failedHappeningNowSources.set("startup", error);
      happeningNowEventsLoading = false;
      window.clearTimeout(happeningNowEventsLoadingTimer);
      happeningNowEventsLoadingTimer = null;
      happeningNowEventsError = error?.code === "permission-denied"
        ? "Your account cannot read published campus events."
        : "Check your connection and try again.";
      renderHappeningNow();
    }
  } catch (error) {
    console.error("Unable to start organizer event listener:", error.code, error.message);
    setDashboardMessage("events", "Could not start loading your events. Please try again.");
    settleInitialDashboardSource("events");
  }

}

if (!isFirebaseConfigured || !auth || !db) {
  setDashboardMessage("events", "Event data is unavailable. Please contact support.");
  pendingInitialDashboardSources.clear();
  signalDashboardPageReady();
} else {
  auth
    .authStateReady()
    .then(() => {
      unsubscribeAuth = onAuthStateChanged(
        auth,
        (user) => {
          stopDashboardListeners();
          organizerEvents = [];
          if (!user) {
            window.location.replace(loginPath);
            return;
          }
          mountHelpBot({ role: "eventorganizer", ai: { firebaseConfig: app.options } });
          setDashboardMessage("events", "Loading your dashboard...");
          startDashboardListeners(user);
          if (window.OrganizerNotificationData?.subscribe) {
            unsubscribeAcademicNotifications = window.OrganizerNotificationData.subscribe((state) => {
              academicNotificationItems = Array.isArray(state.items) ? state.items : [];
              renderAcademicCalendarAlerts();
            });
          }
          renderDashboard();
        },
        (error) => {
          console.error("Unable to observe organizer authentication state:", error.code, error.message);
          setDashboardMessage("events", "Could not verify your session. Check your connection and try again.");
          pendingInitialDashboardSources.clear();
          signalDashboardPageReady();
        },
      );
    })
    .catch((error) => {
      console.error("Unable to initialize organizer authentication state:", error.code, error.message);
      setDashboardMessage("events", "Could not verify your session. Check your connection and try again.");
      pendingInitialDashboardSources.clear();
      signalDashboardPageReady();
    });
}

logoutButton?.addEventListener("click", async (event) => {
  event.preventDefault();
  if (signingOut) return;
  signingOut = true;
  logoutButton.disabled = true;
  stopDashboardListeners();
  try {
    if (auth) {
      await auth.authStateReady();
      await signOut(auth);
    }
    localStorage.removeItem("recovibeOrganizerId");
    localStorage.removeItem("recovibeOrganizerProfile");
    window.location.assign(loginPath);
  } catch (error) {
    console.error("Unable to sign out organizer:", error);
    setDashboardMessage("events", "Could not sign out. Your session is still active; please try again.");
    signingOut = false;
    logoutButton.disabled = false;
    if (auth?.currentUser) startDashboardListeners(auth.currentUser);
  }
});

window.addEventListener("beforeunload", () => {
  window.clearInterval(dashboardRefreshTimer);
  unsubscribeAuth?.();
  stopDashboardListeners();
});
