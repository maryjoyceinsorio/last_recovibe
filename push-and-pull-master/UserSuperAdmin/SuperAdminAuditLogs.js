import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { get, ref } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  db,
  isFirebaseConfigured,
  isRtdbConfigured,
  rtdb,
} from "../UserStudent/firebaseConfig.js";

(() => {
  "use strict";

  const PAGE_SIZE = 25;
  const EVENT_PAGE_SIZE = 100;
  const DEBUG = false;
  const CORE_CATEGORIES = ["Account created", "Account edited", "Settings", "Events"];
  const KNOWN_ACTOR_ROLES = [
    "Super Admin",
    "Admin",
    "Teacher",
    "Student",
    "Event Organizer",
    "Organization Adviser",
    "Laboratory Head",
    "Property Custodian",
    "Administrative Officer",
    "Head of Academic Programs",
    "QAC Coordinator",
    "OSAS",
  ];
  const ACTION_HEADLINES = {
    user_created: "Account created",
    suspend: "Account suspended",
    reactivate: "Account reactivated",
    role_change: "Account role changed",
    password_reset_sent: "Password reset email sent",
    "settings.update": "Settings updated",
  };
  const params = new URLSearchParams(window.location.search);
  let userFilter = (params.get("user") || "").trim();
  let uidFilter = (params.get("uid") || "").trim();
  let loadedRecords = [];
  let publishedEventRecords = [];
  let publishedEventCursor = null;
  let hasMorePublishedEvents = false;
  let isLoadingEventPage = false;
  let lastDocument = null;
  let hasMore = true;
  let isLoading = false;
  let initialLoadComplete = false;
  let pageReady = false;
  let loadError = "";
  let eventLoadError = "";
  let eventLoadInProgress = false;
  let selectedActor = "";
  let selectedCategory = "All";
  let searchText = "";
  let searchTimer = 0;
  const participantCache = new Map();
  const participantPanels = new Map();

  const list = document.getElementById("audit-log-list");
  const searchInput = document.getElementById("audit-search");
  const actorSelect = document.getElementById("audit-actor-filter");
  const dateSelect = document.getElementById("audit-date-filter");
  const customRange = document.getElementById("audit-custom-date-range");
  const customStart = document.getElementById("audit-custom-start");
  const customEnd = document.getElementById("audit-custom-end");
  const categoryFilters = document.getElementById("audit-category-filters");
  const resultCount = document.getElementById("audit-result-count");
  const userFilterChip = document.getElementById("audit-user-filter-chip");
  const userFilterText = document.getElementById("audit-user-filter-text");
  const clearUserFilterButton = document.getElementById("audit-user-filter-clear");
  const emptyState = document.getElementById("audit-empty-state");
  const clearFiltersButton = document.getElementById("audit-clear-filters");
  const errorState = document.getElementById("audit-error-state");
  const errorText = document.getElementById("audit-error-text");
  const retryButton = document.getElementById("audit-retry");
  const loadMoreButton = document.getElementById("audit-load-more");
  const exportButton = document.getElementById("audit-export-csv");
  const eventWarning = document.getElementById("audit-events-warning");
  const eventWarningText = document.getElementById("audit-events-warning-text");
  const retryEventsButton = document.getElementById("audit-retry-events");

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function setText(element, value) {
    if (element) element.innerHTML = esc(value);
  }

  function valueText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  function dateFrom(value) {
    if (value?.toDate) return value.toDate();
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function withReadTimeout(promise, timeoutMs = 20000) {
    let timeoutId;
    return Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error("Participant data request timed out.")),
          timeoutMs,
        );
      }),
    ]).finally(() => window.clearTimeout(timeoutId));
  }

  function isPublishedEventData(data = {}) {
    const statuses = [
      data.status,
      data.publicationStatus,
      data.approval?.status,
      data.approvalStatus,
    ].map((value) => valueText(value).trim().toLowerCase().replace(/[ _-]+/g, " "));
    const hasPublishedStatus = statuses.some(
      (status) => ["published", "published live", "live", "completed"].includes(status),
    );
    const hasPublishedFlag = [data.published, data.isPublished, data.isLive].some(
      (value) => value === true || String(value).trim().toLowerCase() === "true",
    );
    return hasPublishedStatus || hasPublishedFlag || Boolean(data.publishedAt);
  }

  function normalizePublishedEvent(documentSnapshot) {
    const data = documentSnapshot.data() || {};
    if (!isPublishedEventData(data)) return null;
    const organizerName = valueText(
      data.organizerName || data.organizer || data.createdByName || data.creatorName,
    ).trim();
    const organizationName = valueText(
      data.organizationName ||
      data.organizerOrganization ||
      data.organizationCode ||
      data.orgCode ||
      data.organization ||
      data.organizerOrg,
    ).trim();
    const title = valueText(data.title || data.eventName || data.name || "Untitled event").trim();
    return {
      id: `published-event-${documentSnapshot.id}`,
      recordType: "published-event",
      eventId: documentSnapshot.id,
      eventTitle: title,
      organizerUid: valueText(data.organizerUid || data.organizerId || data.createdBy).trim(),
      organizerName,
      organizationName,
      actorRole: valueText(
        data.creatorRole || data.createdByRole || data.organizerRole || "Event Organizer",
      ).trim(),
      action: "Event published",
      category: "Events",
      timestamp:
        data.publishedAt ||
        data.publication?.publishedAt ||
        data.approval?.publishedAt ||
        data.updatedAt ||
        data.createdAt ||
        null,
      rawData: data,
      eventData: data,
    };
  }

  async function loadPublishedEvents() {
    if (eventLoadInProgress) return;
    if (!isFirebaseConfigured || !db) {
      eventLoadError = "Published Events are unavailable because Firebase is not configured.";
      render();
      return;
    }
    eventLoadInProgress = true;
    eventLoadError = "";
    publishedEventRecords = [];
    publishedEventCursor = null;
    hasMorePublishedEvents = false;
    try {
      const snapshot = await withReadTimeout(getDocs(query(
        collection(db, "events"),
        orderBy(documentId()),
        limit(EVENT_PAGE_SIZE),
      )));
      publishedEventRecords = snapshot.docs
        .map(normalizePublishedEvent)
        .filter(Boolean);
      publishedEventCursor = snapshot.docs.at(-1) || null;
      hasMorePublishedEvents = snapshot.size === EVENT_PAGE_SIZE;
      eventLoadError = "";
    } catch (error) {
      if (DEBUG) console.error("Could not load published events.", error);
      eventLoadError = "Could not load Published Events. Check your connection and retry.";
    } finally {
      eventLoadInProgress = false;
      render();
    }
  }

  async function loadNextPublishedEvents() {
    if (isLoadingEventPage || !hasMorePublishedEvents || !publishedEventCursor) return;
    isLoadingEventPage = true;
    eventLoadError = "";
    render();
    try {
      const snapshot = await withReadTimeout(getDocs(query(
        collection(db, "events"),
        orderBy(documentId()),
        startAfter(publishedEventCursor),
        limit(EVENT_PAGE_SIZE),
      )));
      publishedEventRecords = [
        ...publishedEventRecords,
        ...snapshot.docs.map(normalizePublishedEvent).filter(Boolean),
      ];
      publishedEventCursor = snapshot.docs.at(-1) || publishedEventCursor;
      hasMorePublishedEvents = snapshot.size === EVENT_PAGE_SIZE;
    } catch (error) {
      console.error("Could not load another page of published events:", error);
      eventLoadError = "More published events could not be loaded. Retry to continue.";
    } finally {
      isLoadingEventPage = false;
      render();
    }
  }

  function normalizeRecord(documentSnapshot) {
    const data = documentSnapshot.data() || {};
    return {
      ...data,
      rawData: data,
      id: documentSnapshot.id,
      user: data.user || data.actorName || data.performedBy || "System",
      action: data.action || data.actionHeader || "Activity recorded",
      timestamp: data.timestamp || data.createdAt || null,
    };
  }

  function isPublishedEventRecord(record) {
    return record?.recordType === "published-event";
  }

  function eventOrganizerLabel(record) {
    const organizer = valueText(record.organizerName).trim();
    const organization = valueText(record.organizationName).trim();
    if (organizer && organization && organizer.toLowerCase() !== organization.toLowerCase()) {
      return `${organizer} · ${organization}`;
    }
    return organizer || organization || "Organizer not recorded";
  }

  function normalizedActorName(record) {
    if (isPublishedEventRecord(record)) return eventOrganizerLabel(record);
    const rawActor = valueText(
      record.actorName || record.user || record.performedBy || "System",
    ).trim();
    const shortTag = rawActor.match(/^\s*((?:SA\d+|[A-Z]))\s+[–—-]\s+(.+)$/i);
    if (!shortTag) return rawActor;
    const hasRoleLabel = KNOWN_ACTOR_ROLES.some(
      (role) => role.toLowerCase() === shortTag[2].trim().toLowerCase(),
    );
    return hasRoleLabel ? shortTag[1].trim() : shortTag[2].trim();
  }

  function normalizedActorRole(record) {
    if (isPublishedEventRecord(record)) {
      return valueText(record.actorRole || "Event Organizer");
    }
    const storedRole = valueText(record.actorRole || record.userRole).trim();
    if (storedRole) return storedRole;
    const rawActor = valueText(record.actorName || record.user || record.performedBy).trim();
    const shortTag = rawActor.match(/^\s*(?:SA\d+|[A-Z])\s+[–—-]\s+(.+)$/i);
    if (shortTag) {
      const knownRole = KNOWN_ACTOR_ROLES.find(
        (role) => role.toLowerCase() === shortTag[1].trim().toLowerCase(),
      );
      if (knownRole) return knownRole;
    }
    return "Role not recorded";
  }

  function actionCode(record) {
    if (isPublishedEventRecord(record)) return "event.published";
    return valueText(record.rawData?.action || record.action || "")
      .trim()
      .toLowerCase();
  }

  function categoryFor(record) {
    if (isPublishedEventRecord(record)) return "Events";
    const code = actionCode(record);
    const category = valueText(record.category).trim();
    if (code === "user_created" || category.toLowerCase() === "account created") {
      return "Account created";
    }
    if (
      ["suspend", "reactivate", "role_change", "password_reset_sent"].includes(code) ||
      category.toLowerCase() === "account edited"
    ) {
      return "Account edited";
    }
    if (code === "settings.update" || category.toLowerCase().includes("settings")) {
      return "Settings";
    }
    return category || "Other";
  }

  function headlineFor(record) {
    if (isPublishedEventRecord(record)) {
      return `Event published: ${valueText(record.eventTitle || "Untitled event")}`;
    }
    const code = actionCode(record);
    const headline = ACTION_HEADLINES[code];
    if (!headline) {
      return valueText(record.actionHeader || record.action || "Activity recorded");
    }
    const target = valueText(record.targetName).trim();
    return target ? `${headline}: ${target}` : headline;
  }

  function detailTextFor(record) {
    if (isPublishedEventRecord(record)) return "";
    const raw = record.rawData || record;
    for (const value of [raw.summary, raw.details, raw.description, raw.actionHeader, raw.action]) {
      const text = valueText(value).trim();
      if (text) return text;
    }
    return "";
  }

  function parseLegacyChanges(value) {
    const sentence = valueText(value).trim();
    const match = sentence.match(
      /^Edited user information for .+ \([^()]+\):\s*(.+)$/i,
    );
    if (!match) return null;

    const parts = match[1].split(";");
    if (!parts.length) return null;
    const changes = [];
    for (const part of parts) {
      const change = part.trim().match(/^([^:]+):\s*(.*?)\s*->\s*(.*?)\s*$/);
      if (!change || !change[1].trim()) return null;
      changes.push({
        field: change[1].trim(),
        from: change[2],
        to: change[3],
      });
    }
    return changes.length ? changes : null;
  }

  function normalizeChanges(record) {
    const raw = record.rawData || record;
    if (Array.isArray(raw.changes) && raw.changes.length) {
      return raw.changes.map((change) => {
        if (change && typeof change === "object") {
          return {
            field: valueText(change.field || change.label || "Field"),
            from: valueText(change.from ?? change.oldValue ?? ""),
            to: valueText(change.to ?? change.newValue ?? ""),
          };
        }
        return { field: "Change", from: "", to: valueText(change) };
      });
    }
    return parseLegacyChanges(detailTextFor(record));
  }

  function plainDetailsFor(record) {
    const raw = record.rawData || record;
    if (Array.isArray(raw.changes) && raw.changes.length) {
      return valueText(raw.summary || raw.details || "");
    }
    const text = detailTextFor(record);
    if (parseLegacyChanges(text)) return "";
    if (ACTION_HEADLINES[actionCode(record)] && text === actionCode(record)) return "";
    return text;
  }

  function displayNoteFor(record) {
    if (isPublishedEventRecord(record)) {
      const organizer = valueText(record.organizerName).trim();
      const organization = valueText(record.organizationName).trim();
      if (organizer && organization && organizer.toLowerCase() === organization.toLowerCase()) {
        return `Organization: ${organization}`;
      }
      return [
        organizer ? `Organizer: ${organizer}` : "",
        organization ? `Organization: ${organization}` : "",
      ].filter(Boolean).join(" · ") || "Organizer and organization not recorded";
    }
    if (actionCode(record) !== "settings.update") return "";
    const raw = record.rawData || record;
    return valueText(raw.section || raw.summary || "Section not recorded");
  }

  function getManilaParts(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  }

  function manilaDateKey(date) {
    if (!date) return "";
    const parts = getManilaParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function formatManilaTime(date) {
    if (!date) return "Time unavailable";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function formatManilaIso(date) {
    if (!date) return "";
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+08:00`;
  }

  function dayHeading(date, todayKey, yesterdayKey) {
    const key = manilaDateKey(date);
    if (!key) return "Date unavailable";
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      month: "short",
      day: "numeric",
    }).format(date);
    if (key === todayKey) return `Today - ${dateLabel}`;
    if (key === yesterdayKey) return `Yesterday - ${dateLabel}`;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function dateRange() {
    const mode = dateSelect?.value || "all";
    const now = new Date();
    const todayKey = manilaDateKey(now);
    const todayStart = new Date(`${todayKey}T00:00:00+08:00`);
    if (mode === "today") return { start: todayStart.getTime(), end: now.getTime() };
    if (mode === "7days" || mode === "30days") {
      const start = new Date(todayStart);
      start.setUTCDate(start.getUTCDate() - (mode === "7days" ? 6 : 29));
      return { start: start.getTime(), end: now.getTime() };
    }
    if (mode === "custom") {
      const start = customStart?.value
        ? new Date(`${customStart.value}T00:00:00+08:00`).getTime()
        : null;
      let end = null;
      if (customEnd?.value) {
        const endDate = new Date(`${customEnd.value}T00:00:00+08:00`);
        endDate.setUTCDate(endDate.getUTCDate() + 1);
        end = endDate.getTime();
      }
      return { start, end };
    }
    return { start: null, end: null };
  }

  function recordMatchesUserFilter(record) {
    const terms = [userFilter, uidFilter]
      .map((term) => term.toLowerCase())
      .filter(Boolean);
    if (!terms.length) return true;
    const fields = [
      record.user,
      record.actorName,
      normalizedActorName(record),
      record.targetName,
      record.targetUid,
      record.eventTitle,
      record.eventId,
      record.organizerUid,
      record.organizationName,
    ].map((value) => valueText(value).toLowerCase());
    return terms.some((term) => fields.some((field) => field.includes(term)));
  }

  function recordMatchesFilters(record, range) {
    const actor = normalizedActorName(record);
    if (selectedActor && actor !== selectedActor) return false;
    if (selectedCategory !== "All" && categoryFor(record) !== selectedCategory) return false;
    if (!recordMatchesUserFilter(record)) return false;

    const date = dateFrom(record.timestamp);
    if (range.start !== null && (!date || date.getTime() < range.start)) return false;
    if (range.end !== null && (!date || date.getTime() >= range.end)) return false;

    const queryText = searchText.trim().toLowerCase();
    if (!queryText) return true;
    const fields = [
      record.action,
      record.actionHeader,
      record.user,
      record.actorName,
      actor,
      record.targetName,
      record.targetUid,
      record.targetAccountNumber,
      record.targetAccountNo,
      record.accountNumber,
      record.accountNo,
      record.studentNumber,
      record.email,
      record.targetEmail,
      record.summary,
      record.details,
      record.section,
      record.category,
      record.eventTitle,
      record.eventId,
      record.organizerUid,
      record.organizerName,
      record.organizationName,
    ].map((value) => valueText(value).toLowerCase());
    return fields.some((field) => field.includes(queryText));
  }

  function filteredRecords() {
    const range = dateRange();
    return [...loadedRecords, ...publishedEventRecords]
      .filter((record) => recordMatchesFilters(record, range))
      .sort((left, right) => {
        const leftTime = dateFrom(left.timestamp)?.getTime() || 0;
        const rightTime = dateFrom(right.timestamp)?.getTime() || 0;
        return rightTime - leftTime;
      });
  }

  function createIcon(category) {
    const icon = document.createElement("span");
    icon.className = "audit-entry-icon";
    icon.setAttribute("aria-hidden", "true");
    if (category === "Account created") {
      icon.classList.add("audit-entry-icon--created");
      icon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><circle cx="9" cy="8" r="3.2"></circle><path d="M3.5 20v-1.6a5.5 5.5 0 0 1 11 0V20M18 8v6M15 11h6"></path></svg>';
    } else if (category === "Account edited") {
      icon.classList.add("audit-entry-icon--edited");
      icon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="m4 16.8-.8 4 4-.8L20 7.2 16.8 4 4 16.8Z"></path><path d="m14.8 6 3.2 3.2"></path></svg>';
    } else if (category === "Settings") {
      icon.classList.add("audit-entry-icon--settings");
      icon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"></path><path d="m19.4 15 .1.1 1.2 1-1.4 2.4-1.5-.6a8 8 0 0 1-1.5.9l-.3 1.6h-2.8l-.3-1.6a8 8 0 0 1-1.5-.9l-1.5.6-1.4-2.4 1.2-1a7 7 0 0 1 0-1.8l-1.2-1 1.4-2.4 1.5.6a8 8 0 0 1 1.5-.9l.3-1.6h2.8l.3 1.6a8 8 0 0 1 1.5.9l1.5-.6 1.4 2.4-1.2 1a7 7 0 0 1-.1 1.7Z"></path></svg>';
    } else if (category === "Events") {
      icon.classList.add("audit-entry-icon--events");
      icon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><rect x="3.5" y="5" width="17" height="16" rx="2"></rect><path d="M7.5 3v4M16.5 3v4M3.5 9h17"></path><path d="m8 14 2.2 2.2L16 11"></path></svg>';
    } else {
      icon.classList.add("audit-entry-icon--neutral");
      icon.innerHTML = '<svg viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="3"></circle></svg>';
    }
    return icon;
  }

  function formatChange(change) {
    return `${valueText(change.field)}: ${valueText(change.from)} -> ${valueText(change.to)}`;
  }

  function appendDiffRows(container, changes) {
    const rows = document.createElement("div");
    rows.className = "audit-diff-list";
    changes.forEach((change) => {
      const row = document.createElement("div");
      row.className = "audit-diff-row";
      const field = document.createElement("span");
      field.className = "audit-diff-field";
      setText(field, change.field);
      const oldValue = document.createElement("span");
      oldValue.className = "audit-diff-value audit-diff-value--old";
      setText(oldValue, change.from || "—");
      const arrow = document.createElement("span");
      arrow.className = "audit-diff-arrow";
      arrow.setAttribute("aria-hidden", "true");
      setText(arrow, "→");
      const newValue = document.createElement("span");
      newValue.className = "audit-diff-value audit-diff-value--new";
      setText(newValue, change.to || "—");
      row.append(field, oldValue, arrow, newValue);
      rows.append(row);
    });
    container.append(rows);
  }

  function makeEntryRow(record) {
    const row = document.createElement("div");
    row.className = "audit-entry-row";

    const category = categoryFor(record);
    row.append(createIcon(category));

    const content = document.createElement("div");
    content.className = "audit-entry-content";
    const headline = document.createElement("h3");
    headline.className = "audit-entry-headline";
    setText(headline, headlineFor(record));
    content.append(headline);

    const note = displayNoteFor(record);
    if (note) {
      const noteLine = document.createElement("p");
      noteLine.className = "audit-entry-note";
      setText(noteLine, note);
      content.append(noteLine);
    }

    const meta = document.createElement("div");
    meta.className = "audit-entry-meta";
    const actor = document.createElement("span");
    actor.className = "audit-entry-actor";
    setText(actor, `${normalizedActorName(record)} · ${normalizedActorRole(record)}`);
    const badge = document.createElement("span");
    badge.className = `audit-category-badge ${categoryClass(category)}`;
    setText(badge, category);
    meta.append(actor, badge);
    content.append(meta);
    row.append(content);

    const timestamp = document.createElement("time");
    timestamp.className = "audit-entry-time";
    const date = dateFrom(record.timestamp);
    if (date) timestamp.dateTime = date.toISOString();
    setText(timestamp, formatManilaTime(date));
    row.append(timestamp);
    return row;
  }

  function toRecordObject(value) {
    return value && typeof value === "object" ? value : {};
  }

  function participantMapKey(uid, data) {
    const studentNumber = valueText(data.studentNumber || data.studentNo || data.studentId).trim();
    return uid || studentNumber;
  }

  function addParticipantSource(map, uidValue, dataValue, source) {
    const data = toRecordObject(dataValue);
    const uid = valueText(data.uid || data.studentUid || data.userId || uidValue).trim();
    const key = participantMapKey(uid, data);
    if (!key) return;
    const current = map.get(key) || { uid, registrationData: null, attendanceData: null };
    if (source === "attendance") {
      current.attendanceData = { ...(current.attendanceData || {}), ...data };
    } else {
      current.registrationData = { ...(current.registrationData || {}), ...data };
    }
    map.set(key, current);
  }

  function registrationIsCancelled(data) {
    const status = valueText(data.status || data.registrationStatus).trim().toLowerCase();
    return ["cancelled", "canceled", "withdrawn", "unregistered"].includes(status) ||
      Boolean(data.cancelledAt);
  }

  function participantAttendanceStatus(participant) {
    const attendance = participant.attendanceData || {};
    const registration = participant.registrationData || {};
    const attendanceStatus = valueText(
      attendance.status ||
      attendance.attendanceStatus ||
      attendance.participationStatus ||
      registration.status ||
      registration.registrationStatus,
    ).trim().toLowerCase().replace(/[-_]+/g, " ");
    if (
      attendance.scannedAt ||
      attendance.checkedInAt ||
      attendance.checkInAt ||
      registration.scannedAt ||
      registration.checkedInAt ||
      registration.checkInAt ||
      attendance.checkedIn === true ||
      attendanceStatus.includes("check")
    ) {
      return "Checked In";
    }
    if (
      attendance.attended === true ||
      registration.attended === true ||
      ["attended", "completed"].includes(attendanceStatus)
    ) {
      return "Attended";
    }
    return "Registered";
  }

  function profileName(profile, source) {
    const firstAndLast = [
      source.firstName || profile.firstName,
      source.lastName || profile.lastName,
    ].filter(Boolean).join(" ").trim();
    return valueText(
      profile.fullName ||
      profile.name ||
      firstAndLast ||
      source.studentName ||
      source.fullName ||
      source.name ||
      source.student?.fullName ||
      source.student?.name ||
      "Student",
    ).trim();
  }

  async function fetchEventParticipants(eventId) {
    const sources = [];
    if (db) {
      sources.push({
        name: "Firestore registrations",
        load: () => withReadTimeout(
          getDocs(collection(db, "events", eventId, "registrations")),
        ),
      });
    }
    if (isRtdbConfigured && rtdb) {
      sources.push(
        {
          name: "Realtime Database registrations",
          load: () => withReadTimeout(get(ref(rtdb, `registrations/${eventId}`))),
        },
        {
          name: "Event attendance",
          load: () => withReadTimeout(get(ref(rtdb, `events/${eventId}/attendance`))),
        },
        {
          name: "Legacy attendance",
          load: () => withReadTimeout(get(ref(rtdb, `attendance/${eventId}`))),
        },
      );
    }
    if (!sources.length) throw new Error("Participant records are unavailable.");

    const results = await Promise.allSettled(sources.map((source) => source.load()));
    const participantsById = new Map();
    const failures = [];
    let successfulSources = 0;
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failures.push(sources[index].name);
        return;
      }
      successfulSources += 1;
      const { name } = sources[index];
      if (name === "Firestore registrations") {
        result.value.docs.forEach((registration) => {
          addParticipantSource(
            participantsById,
            registration.id,
            registration.data() || {},
            "registration",
          );
        });
        return;
      }
      const rows = result.value.val() || {};
      if (!rows || typeof rows !== "object") return;
      Object.entries(rows).forEach(([uid, row]) => {
        if (row === false || row == null) return;
        addParticipantSource(
          participantsById,
          uid,
          row === true ? { status: "registered" } : row,
          name.includes("attendance") ? "attendance" : "registration",
        );
      });
    });

    if (!successfulSources) {
      throw new Error("Could not read registration or attendance records.");
    }

    const activeParticipants = [...participantsById.values()].filter((participant) => {
      if (participant.attendanceData) return true;
      return !registrationIsCancelled(participant.registrationData || {});
    });
    const profiles = new Map();
    const uids = [...new Set(activeParticipants.map((participant) => participant.uid).filter(Boolean))];
    if (db && uids.length) {
      const chunks = [];
      for (let index = 0; index < uids.length; index += 30) {
        chunks.push(uids.slice(index, index + 30));
      }
      const profileResults = await Promise.allSettled(chunks.map((uidChunk) =>
        withReadTimeout(getDocs(query(
          collection(db, "users"),
          where(documentId(), "in", uidChunk),
        ))),
      ));
      profileResults.forEach((result) => {
        if (result.status === "rejected") {
          failures.push("Student profiles");
          return;
        }
        result.value.docs.forEach((profileDocument) => {
          profiles.set(profileDocument.id, profileDocument.data() || {});
        });
      });
    }

    const participants = activeParticipants.map((participant) => {
      const registration = participant.registrationData || {};
      const attendance = participant.attendanceData || {};
      const source = { ...registration, ...attendance };
      const profile = profiles.get(participant.uid) || {};
      const studentNumber = valueText(
        profile.studentNumber ||
        profile.studentNo ||
        profile.studentId ||
        source.studentNumber ||
        source.studentNo ||
        source.studentId ||
        "—",
      ).trim();
      const program = valueText(
        profile.departmentCode ||
        profile.department ||
        profile.program ||
        profile.course ||
        source.departmentCode ||
        source.department ||
        source.program ||
        source.course ||
        source.student?.departmentCode ||
        source.student?.department ||
        source.student?.program ||
        source.student?.course ||
        "",
      ).trim();
      const organization = valueText(
        profile.courseOrganization ||
        profile.courseOrg ||
        profile.organization ||
        profile.organizationCode ||
        source.courseOrganization ||
        source.courseOrg ||
        source.organization ||
        source.organizationCode ||
        source.student?.courseOrganization ||
        source.student?.courseOrg ||
        source.student?.organization ||
        "",
      ).trim();
      return {
        name: profileName(profile, source),
        studentNumber,
        programOrganization: program && organization && program.toLowerCase() !== organization.toLowerCase()
          ? `${program} / ${organization}`
          : program || organization || "—",
        status: participantAttendanceStatus(participant),
      };
    });

    if (!participants.length && failures.length) {
      throw new Error("Participant records could not all be verified.");
    }
    return {
      participants,
      warning: failures.length
        ? "Some registration or profile records could not be loaded; this list may be incomplete."
        : "",
    };
  }

  function renderParticipantPanel(panel, result) {
    panel.replaceChildren();
    if (result.status === "loading") {
      const loading = document.createElement("p");
      loading.className = "audit-participant-state";
      loading.setAttribute("role", "status");
      setText(loading, "Loading student participants…");
      panel.append(loading);
      return;
    }
    if (result.status === "error") {
      const message = document.createElement("p");
      message.className = "audit-participant-state audit-participant-state--error";
      setText(message, "Could not load student participants. Please retry.");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "audit-secondary-button";
      setText(retry, "Retry participants");
      retry.addEventListener("click", () => result.retry());
      panel.append(message, retry);
      return;
    }
    if (!result.participants.length) {
      const empty = document.createElement("p");
      empty.className = "audit-participant-state";
      setText(empty, "No student participants recorded yet");
      panel.append(empty);
      return;
    }

    if (result.warning) {
      const warning = document.createElement("p");
      warning.className = "audit-participant-warning";
      setText(warning, result.warning);
      panel.append(warning);
    }
    const tableWrap = document.createElement("div");
    tableWrap.className = "audit-participants-table-wrap";
    const table = document.createElement("table");
    table.className = "audit-participants-table";
    const caption = document.createElement("caption");
    caption.className = "visually-hidden";
    setText(caption, "Students registered or checked in for this event");
    const head = document.createElement("thead");
    const headerRow = document.createElement("tr");
    ["Student Name", "Student Number", "Program / Organization", "Participation / Attendance Status"]
      .forEach((label) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        setText(cell, label);
        headerRow.append(cell);
      });
    head.append(headerRow);
    const body = document.createElement("tbody");
    result.participants.forEach((participant) => {
      const row = document.createElement("tr");
      for (const value of [
        participant.name,
        participant.studentNumber,
        participant.programOrganization,
        participant.status,
      ]) {
        const cell = document.createElement("td");
        setText(cell, value);
        row.append(cell);
      }
      body.append(row);
    });
    table.append(caption, head, body);
    tableWrap.append(table);
    panel.append(tableWrap);
  }

  function renderEventParticipantPanels(eventId, result) {
    const panels = participantPanels.get(eventId);
    if (!panels) return;
    panels.forEach((panel) => {
      if (panel.isConnected) renderParticipantPanel(panel, result);
      else panels.delete(panel);
    });
  }

  async function loadEventParticipants(record, panel) {
    const key = record.eventId;
    if (!participantPanels.has(key)) participantPanels.set(key, new Set());
    participantPanels.get(key).add(panel);
    const cached = participantCache.get(key);
    if (cached?.status === "loaded") {
      renderParticipantPanel(panel, cached);
      return;
    }
    if (cached?.status === "loading") {
      renderParticipantPanel(panel, { status: "loading" });
      return;
    }

    participantCache.set(key, { status: "loading" });
    renderParticipantPanel(panel, { status: "loading" });
    try {
      const result = await fetchEventParticipants(key);
      const loaded = { status: "loaded", ...result };
      participantCache.set(key, loaded);
      renderEventParticipantPanels(key, loaded);
    } catch (error) {
      if (DEBUG) console.error("Could not load event participants.", error);
      const failed = { status: "error", retry: () => loadEventParticipants(record, panel) };
      participantCache.set(key, failed);
      renderEventParticipantPanels(key, failed);
    } finally {
      if (participantCache.get(key)?.status === "loading") {
        const failed = { status: "error", retry: () => loadEventParticipants(record, panel) };
        participantCache.set(key, failed);
        renderEventParticipantPanels(key, failed);
      }
    }
  }

  function makePublishedEventCard(record) {
    const card = document.createElement("article");
    card.className = "audit-entry-card audit-published-event-card";
    const details = document.createElement("details");
    details.className = "audit-entry-details audit-event-details";
    const summary = document.createElement("summary");
    summary.append(makeEntryRow(record));
    const chevron = document.createElement("span");
    chevron.className = "audit-entry-chevron";
    chevron.setAttribute("aria-hidden", "true");
    summary.append(chevron);
    const panel = document.createElement("div");
    panel.className = "audit-entry-expanded audit-event-participants";
    panel.setAttribute("aria-live", "polite");
    details.append(summary, panel);
    details.addEventListener("toggle", () => {
      if (details.open) void loadEventParticipants(record, panel);
    });
    card.append(details);
    return card;
  }

  function categoryClass(category) {
    if (category === "Account created") return "audit-category-badge--created";
    if (category === "Account edited") return "audit-category-badge--edited";
    if (category === "Settings") return "audit-category-badge--settings";
    if (category === "Events") return "audit-category-badge--events";
    return "audit-category-badge--other";
  }

  function makeEntryCard(record) {
    if (isPublishedEventRecord(record)) return makePublishedEventCard(record);
    const card = document.createElement("article");
    card.className = "audit-entry-card";
    const changes = normalizeChanges(record);
    const plainText = plainDetailsFor(record);

    if (changes?.length) {
      const details = document.createElement("details");
      details.className = "audit-entry-details";
      const summary = document.createElement("summary");
      summary.append(makeEntryRow(record));
      const chevron = document.createElement("span");
      chevron.className = "audit-entry-chevron";
      chevron.setAttribute("aria-hidden", "true");
      summary.append(chevron);
      details.append(summary);

      const panel = document.createElement("div");
      panel.className = "audit-entry-expanded";
      if (plainText) {
        const description = document.createElement("p");
        description.className = "audit-entry-description";
        setText(description, plainText);
        panel.append(description);
      }
      appendDiffRows(panel, changes);
      details.append(panel);
      card.append(details);
    } else {
      card.append(makeEntryRow(record));
      if (plainText) {
        const description = document.createElement("p");
        description.className = "audit-entry-plain-details";
        setText(description, plainText);
        card.append(description);
      }
    }
    return card;
  }

  function makeDayHeading(records, todayKey, yesterdayKey) {
    const date = records.map((record) => dateFrom(record.timestamp)).find(Boolean);
    const heading = document.createElement("h2");
    heading.className = "audit-day-heading";
    setText(heading, dayHeading(date, todayKey, yesterdayKey));
    return heading;
  }

  function renderRecords(records) {
    list.replaceChildren();
    if (!records.length) {
      if (eventLoadInProgress) {
        renderSkeleton();
        return;
      }
      emptyState.hidden = false;
      loadMoreButton.hidden = true;
      return;
    }
    emptyState.hidden = true;

    const now = new Date();
    const todayKey = manilaDateKey(now);
    const yesterday = new Date(`${todayKey}T00:00:00+08:00`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayKey = manilaDateKey(yesterday);
    const groups = new Map();
    for (const record of records) {
      const date = dateFrom(record.timestamp);
      const key = manilaDateKey(date) || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    for (const dayRecords of groups.values()) {
      list.append(makeDayHeading(dayRecords, todayKey, yesterdayKey));
      const group = document.createElement("div");
      group.className = "audit-day-group";
      dayRecords.forEach((record) => group.append(makeEntryCard(record)));
      list.append(group);
    }
  }

  function renderCategoryFilters() {
    const values = new Set(
      [...loadedRecords, ...publishedEventRecords].map(categoryFor),
    );
    const otherCategories = [...values]
      .filter((category) => !CORE_CATEGORIES.includes(category))
      .sort((left, right) => left.localeCompare(right));
    const categories = ["All", ...CORE_CATEGORIES, ...otherCategories];
    categoryFilters.replaceChildren();
    categories.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "audit-category-filter";
      if (selectedCategory === category) button.classList.add("is-active");
      button.setAttribute("aria-pressed", String(selectedCategory === category));
      setText(button, category);
      button.addEventListener("click", () => {
        selectedCategory = category;
        render();
      });
      categoryFilters.append(button);
    });
  }

  function renderActors() {
    const previousActor = selectedActor;
    const actors = [...new Set(
      [...loadedRecords, ...publishedEventRecords]
        .map(normalizedActorName)
        .filter(Boolean),
    )]
      .sort((left, right) => left.localeCompare(right));
    actorSelect.replaceChildren();
    const allActors = document.createElement("option");
    allActors.value = "";
    setText(allActors, "All actors");
    actorSelect.append(allActors);
    actors.forEach((actor) => {
      const option = document.createElement("option");
      option.value = actor;
      setText(option, actor);
      actorSelect.append(option);
    });
    selectedActor = actors.includes(previousActor) ? previousActor : "";
    actorSelect.value = selectedActor;
  }

  function renderUserFilterChip() {
    const filterValue = userFilter || uidFilter;
    userFilterChip.hidden = !filterValue;
    if (filterValue) setText(userFilterText, `Filtered by: ${filterValue}`);
  }

  function render() {
    renderActors();
    renderCategoryFilters();
    renderUserFilterChip();
    const matches = filteredRecords();
    const allRecordsCount = loadedRecords.length + publishedEventRecords.length;
    const hasUnloadedRecords = hasMore || hasMorePublishedEvents;
    setText(
      resultCount,
      `${matches.length} of ${allRecordsCount}${hasUnloadedRecords ? "+" : ""} entries`,
    );
    errorState.hidden = !loadError;
    if (loadError) setText(errorText, loadError);
    eventWarning.hidden = !eventLoadError;
    if (eventLoadError) setText(eventWarningText, eventLoadError);
    retryEventsButton.disabled = eventLoadInProgress || isLoadingEventPage;
    setText(
      retryEventsButton,
      eventLoadInProgress || isLoadingEventPage ? "Loading..." : "Retry Published Events",
    );
    if (!initialLoadComplete && isLoading) {
      renderSkeleton();
      loadMoreButton.hidden = true;
    } else if (loadError && !loadedRecords.length && !publishedEventRecords.length) {
      list.replaceChildren();
      emptyState.hidden = true;
      loadMoreButton.hidden = true;
    } else {
      renderRecords(matches);
    }
    loadMoreButton.hidden =
      !(hasMore && loadedRecords.length) && !hasMorePublishedEvents;
    loadMoreButton.disabled = isLoading || isLoadingEventPage || eventLoadInProgress;
    setText(
      loadMoreButton,
      isLoading || isLoadingEventPage || eventLoadInProgress ? "Loading..." : "Load more",
    );
    exportButton.disabled = matches.length === 0;
  }

  function renderSkeleton() {
    list.innerHTML = Array.from({ length: 5 }, () =>
      '<div class="audit-skeleton-card" aria-hidden="true"><span></span><div><i></i><i></i></div><b></b></div>',
    ).join("");
    emptyState.hidden = true;
  }

  function signalPageReady() {
    if (pageReady) return;
    pageReady = true;
    window.dispatchEvent(new Event("page-data-ready"));
  }

  async function loadPage(reset = false) {
    if (isLoading) return;
    if (!isFirebaseConfigured || !db) {
      loadError = "Audit Logs are unavailable because Firebase is not configured.";
      initialLoadComplete = true;
      render();
      signalPageReady();
      return;
    }

    if (reset) {
      loadedRecords = [];
      lastDocument = null;
      hasMore = true;
      loadError = "";
      errorState.hidden = true;
      renderSkeleton();
    } else {
      loadError = "";
      errorState.hidden = true;
    }

    isLoading = true;
    loadMoreButton.disabled = true;
    if (!reset && loadedRecords.length) setText(loadMoreButton, "Loading...");
    try {
      const auditCollection = collection(db, "audit_logs");
      const pageQuery = lastDocument
        ? query(
            auditCollection,
            orderBy("timestamp", "desc"),
            startAfter(lastDocument),
            limit(PAGE_SIZE),
          )
        : query(
            auditCollection,
            orderBy("timestamp", "desc"),
            limit(PAGE_SIZE),
          );
      const snapshot = await getDocs(pageQuery);
      const pageRecords = snapshot.docs.map(normalizeRecord);
      if (reset) loadedRecords = pageRecords;
      else loadedRecords = [...loadedRecords, ...pageRecords];
      if (snapshot.docs.length) lastDocument = snapshot.docs[snapshot.docs.length - 1];
      hasMore = snapshot.docs.length === PAGE_SIZE;
      initialLoadComplete = true;
      loadError = "";
      render();
      signalPageReady();
    } catch (error) {
      if (DEBUG) console.error("Could not load Audit Logs.", error);
      loadError = loadedRecords.length
        ? "Could not load more entries. Retry to continue."
        : "Could not load Audit Logs. Check your connection and retry.";
      initialLoadComplete = true;
      render();
      signalPageReady();
    } finally {
      isLoading = false;
      loadMoreButton.disabled = false;
      if (initialLoadComplete) render();
    }
  }

  function clearUserFilter() {
    userFilter = "";
    uidFilter = "";
    const url = new URL(window.location.href);
    url.searchParams.delete("user");
    url.searchParams.delete("uid");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    render();
  }

  function clearAllFilters() {
    window.clearTimeout(searchTimer);
    searchText = "";
    selectedActor = "";
    selectedCategory = "All";
    searchInput.value = "";
    actorSelect.value = "";
    dateSelect.value = "all";
    customStart.value = "";
    customEnd.value = "";
    customRange.hidden = true;
    clearUserFilter();
  }

  function csvCell(value) {
    let text = valueText(value);
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportDetails(record) {
    if (isPublishedEventRecord(record)) return displayNoteFor(record);
    const changes = normalizeChanges(record);
    if (changes?.length) return changes.map(formatChange).join("; ");
    const details = detailTextFor(record);
    if (details === actionCode(record) && displayNoteFor(record)) return displayNoteFor(record);
    return details;
  }

  function exportCsv() {
    const records = filteredRecords();
    if (!records.length) return;
    const rows = [
      ["Timestamp", "User", "Action", "Category", "Details"],
      ...records.map((record) => [
        formatManilaIso(dateFrom(record.timestamp)),
        normalizedActorName(record),
        headlineFor(record),
        categoryFor(record),
        exportDetails(record),
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `audit-logs-${manilaDateKey(new Date())}.csv`;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
  }

  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchText = searchInput.value;
      render();
    }, 250);
  });
  actorSelect.addEventListener("change", () => {
    selectedActor = actorSelect.value;
    render();
  });
  dateSelect.addEventListener("change", () => {
    customRange.hidden = dateSelect.value !== "custom";
    render();
  });
  customStart.addEventListener("change", render);
  customEnd.addEventListener("change", render);
  clearUserFilterButton.addEventListener("click", clearUserFilter);
  clearFiltersButton.addEventListener("click", clearAllFilters);
  retryButton.addEventListener("click", () => loadPage(loadedRecords.length === 0));
  retryEventsButton.addEventListener("click", () => {
    if (eventLoadInProgress) return;
    void loadPublishedEvents();
    render();
  });
  loadMoreButton.addEventListener("click", async () => {
    const pendingLoads = [];
    if (hasMore && loadedRecords.length) pendingLoads.push(loadPage(false));
    if (hasMorePublishedEvents) pendingLoads.push(loadNextPublishedEvents());
    await Promise.all(pendingLoads);
  });
  exportButton.addEventListener("click", exportCsv);

  renderUserFilterChip();
  renderSkeleton();
  void loadPublishedEvents();
  void loadPage(true);
})();
