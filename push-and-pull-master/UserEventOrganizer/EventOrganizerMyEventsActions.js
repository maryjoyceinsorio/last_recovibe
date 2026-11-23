import { auth, authReady, db, rtdb } from "../UserStudent/firebaseConfig.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  push,
  ref,
  set,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const tableBody = document.getElementById("eventTableBody");
const searchInput = document.getElementById("eventSearch");
const dateFilter = document.getElementById("eventDateFilter");
const tracker = document.getElementById("trackerModalOverlay");
const cancelOverlay = document.getElementById("cancelEventConfirmOverlay");
const rescheduleOverlay = document.getElementById("rescheduleEventOverlay");
const actionStatus = document.getElementById("myEventsActionStatus");
const cancelFeedback = document.getElementById("cancelEventFeedback");
const rescheduleFeedback = document.getElementById("rescheduleEventFeedback");
const rescheduleForm = document.getElementById("rescheduleEventForm");
const rescheduleDate = document.getElementById("rescheduleEventDate");
const rescheduleStartTime = document.getElementById("rescheduleEventStartTime");
const rescheduleEndTime = document.getElementById("rescheduleEventEndTime");

const publishedTrackerActionIds = [
  "btnTrackerEdit",
  "btnTrackerDelete",
  "btnTrackerRemind",
  "btnTrackerResubmit",
  "btnTrackerPublish",
];

let selectedEventId = "";
let lastFocusedElement = null;
let isSaving = false;
let cachedOrganizerEventsById = null;
const requestedDraftId = new URLSearchParams(window.location.search).get("draft") || "";
let requestedDraftRevealed = false;

function normalized(value) {
  return String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function setHidden(element, hidden) {
  if (element && element.hidden !== hidden) element.hidden = hidden;
}

function getRow(eventId) {
  return Array.from(tableBody?.querySelectorAll("tr[data-event-id]") || [])
    .find((row) => row.dataset.eventId === String(eventId)) || null;
}

function rowIsPublished(row) {
  const badge = row?.querySelector(".organizer-status");
  if (!badge) return false;
  const statusText = normalized(badge.textContent);
  return badge.classList.contains("published") ||
    statusText === "published" ||
    statusText === "rescheduled" ||
    (Boolean(row.querySelector('[data-action="scan"]')) &&
      !["completed", "cancelled", "canceled"].includes(statusText));
}

function rowIsCompleted(row) {
  const badge = row?.querySelector(".organizer-status");
  const statusText = normalized(badge?.textContent);
  if (badge?.classList.contains("completed") ||
      ["complete", "completed", "ended"].includes(statusText)) {
    return true;
  }
  const cachedEvent = getCachedOrganizerEvent(row?.dataset.eventId);
  return [
    cachedEvent?.status,
    cachedEvent?.publicationStatus,
    cachedEvent?.eventStatus,
    cachedEvent?.approvalStatus,
  ].some((status) => ["complete", "completed", "ended"].includes(normalized(status))) ||
    cachedEvent?.completed === true ||
    cachedEvent?.isCompleted === true;
}

function getCachedOrganizerEvent(eventId) {
  if (!eventId) return null;
  if (!cachedOrganizerEventsById) {
    let events;
    try {
      const saved = localStorage.getItem("recovibeOrganizerEvents");
      events = saved ? JSON.parse(saved) : [];
    } catch (error) {
      console.warn("Could not read cached organizer events for action filtering:", error);
    }
    if (!Array.isArray(events) && typeof window.getOrganizerEvents === "function") {
      try {
        events = window.getOrganizerEvents();
      } catch (error) {
        console.error("Could not load organizer events for action filtering:", error);
        events = [];
      }
    }
    cachedOrganizerEventsById = new Map();
    if (Array.isArray(events)) {
      for (const event of events) {
        for (const id of [event?.eventId, event?.id]) {
          if (id !== undefined && id !== null) {
            cachedOrganizerEventsById.set(String(id), event);
          }
        }
      }
    }
  }
  return cachedOrganizerEventsById.get(String(eventId)) || null;
}

function rowIsDraft(row) {
  const statusText = normalized(row?.querySelector(".organizer-status")?.textContent);
  const approvalProgress = normalized(
    row?.querySelector('[data-label="Approval progress"]')?.textContent,
  );
  return row?.dataset.draft === "true" ||
    statusText === "draft" ||
    approvalProgress === "not-submitted";
}

function hideCompletedTableActions(row) {
  const actions = row.querySelector(".event-actions");
  if (actions?.childElementCount) actions.replaceChildren();
}

function hideDraftTrackerAction(row) {
  if (!rowIsDraft(row)) return;
  for (const button of row.querySelectorAll('.event-actions [data-action="view"]')) {
    if (normalized(button.textContent) === "view-tracker") button.remove();
  }
}

function keepOnlyPublishedTableActions(row) {
  const actions = row.querySelector(".event-actions");
  if (!actions) return;

  let scanButton = actions.querySelector('[data-action="scan"]');
  let cancelButton = actions.querySelector("[data-my-events-action='cancel']");
  for (const control of actions.querySelectorAll("button, a")) {
    if (control !== scanButton && control !== cancelButton) control.remove();
  }
  if (!scanButton) {
    scanButton = document.createElement("a");
    scanButton.className = "event-action";
    scanButton.dataset.action = "scan";
    scanButton.href = `EventOrganizerScanAttendance.html?${new URLSearchParams({
      eventId: row.dataset.eventId || "",
    }).toString()}`;
    scanButton.textContent = "Scan Attendance";
    actions.append(scanButton);
  }
  scanButton.dataset.eventId = row.dataset.eventId || "";
  if (scanButton && scanButton.dataset.publishedScanLabel !== "true") {
    scanButton.textContent = "Scan Attendance";
    scanButton.dataset.publishedScanLabel = "true";
  }

  if (!cancelButton) {
    cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "event-action event-action-danger";
    cancelButton.dataset.myEventsAction = "cancel";
    cancelButton.textContent = "Cancel Event";
    actions.prepend(cancelButton);
  }
  cancelButton.dataset.eventId = row.dataset.eventId || "";
}

function syncPublishedActions() {
  for (const row of tableBody?.querySelectorAll("tr[data-event-id]") || []) {
    if (rowIsCompleted(row)) {
      hideCompletedTableActions(row);
    } else {
      hideDraftTrackerAction(row);
      if (rowIsPublished(row)) keepOnlyPublishedTableActions(row);
    }
  }
  revealRequestedDraft();

  const selectedRow = getRow(selectedEventId);
  const isCompleted = Boolean(selectedEventId && rowIsCompleted(selectedRow));
  const isPublished = Boolean(selectedEventId && rowIsPublished(selectedRow));
  const cancelButton = document.getElementById("btnTrackerCancel");
  const scanButton = document.getElementById("btnTrackerScan");
  const leftActions = tracker?.querySelector(".tracker-footer-left");
  const rightActions = tracker?.querySelector(".tracker-footer-right");

  if (isCompleted) {
    for (const id of [...publishedTrackerActionIds, "btnTrackerCancel", "btnTrackerScan"]) {
      setHidden(document.getElementById(id), true);
    }
    setHidden(leftActions, true);
    setHidden(rightActions, true);
    return;
  }

  for (const id of publishedTrackerActionIds) {
    const button = document.getElementById(id);
    if (isPublished) setHidden(button, true);
  }

  if (!isPublished) return;
  if (cancelButton) {
    setHidden(cancelButton, false);
    cancelButton.disabled = false;
    if (cancelButton.dataset.publishedCancelLabel !== "true") {
      cancelButton.textContent = "Cancel Event";
      cancelButton.dataset.publishedCancelLabel = "true";
    }
  }
  setHidden(scanButton, false);
  setHidden(leftActions, false);
  setHidden(rightActions, true);
}

function revealRequestedDraft() {
  if (!requestedDraftId || requestedDraftRevealed) return;
  const row = getRow(requestedDraftId);
  if (!row || row.dataset.draft !== "true") return;

  requestedDraftRevealed = true;
  row.classList.add("new-event-highlight");
  row.scrollIntoView({ behavior: "smooth", block: "center" });

  let notice = "Draft saved. It is listed in My Events.";
  try {
    notice = sessionStorage.getItem("recovibeEventNotice") || notice;
    sessionStorage.removeItem("recovibeEventNotice");
  } catch (error) {
    console.warn("Could not read the saved-draft notice:", error);
  }
  showActionStatus(notice);
}

function prepareRequestedDraftView() {
  if (!requestedDraftId) return;
  if (searchInput?.value) {
    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (dateFilter && dateFilter.value !== "all") {
    dateFilter.value = "all";
    dateFilter.dispatchEvent(new Event("change", { bubbles: true }));
  }
  revealRequestedDraft();
}

function restoreTrackerActions() {
  for (const id of publishedTrackerActionIds) {
    setHidden(document.getElementById(id), false);
  }
  const cancelButton = document.getElementById("btnTrackerCancel");
  if (cancelButton?.dataset.publishedCancelLabel === "true") {
    cancelButton.textContent = "Cancel Proposal";
    delete cancelButton.dataset.publishedCancelLabel;
  }
  setHidden(document.getElementById("btnTrackerScan"), false);
  setHidden(tracker?.querySelector(".tracker-footer-left"), false);
  setHidden(tracker?.querySelector(".tracker-footer-right"), false);
}

function errorDescription(error, operation) {
  const code = error?.code ? ` (${error.code})` : "";
  const detail = error?.message ? ` ${error.message}` : "";
  return `${operation} failed${code}.${detail}`;
}

function showActionStatus(message, isError = false) {
  if (!actionStatus) return;
  actionStatus.textContent = message;
  actionStatus.classList.toggle("is-error", isError);
  actionStatus.hidden = !message;
}

function setFeedback(element, message, isError = true) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", isError);
  element.hidden = !message;
}

function showDialog(overlay, focusTarget) {
  if (!overlay) return;
  if (!cancelOverlay?.hidden || !rescheduleOverlay?.hidden) {
    cancelOverlay.hidden = true;
    rescheduleOverlay.hidden = true;
  } else {
    lastFocusedElement = document.activeElement;
  }
  overlay.hidden = false;
  document.body.classList.add("my-events-dialog-open");
  window.requestAnimationFrame(() => focusTarget?.focus());
}

function closeDialogs(restoreFocus = true) {
  setHidden(cancelOverlay, true);
  setHidden(rescheduleOverlay, true);
  document.body.classList.remove("my-events-dialog-open");
  if (restoreFocus && lastFocusedElement?.isConnected) lastFocusedElement.focus();
}

function openCancelConfirmation(eventId, opener) {
  if (!eventId || isSaving) return;
  selectedEventId = String(eventId);
  lastFocusedElement = opener || document.activeElement;
  showActionStatus("");
  setFeedback(cancelFeedback, "");
  showDialog(cancelOverlay, document.getElementById("backCancelEvent"));
}

function toDate(value) {
  if (value && typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const dateOnly = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    return new Date(
      Number(dateOnly[1]),
      Number(dateOnly[2]) - 1,
      Number(dateOnly[3]),
    );
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateKey(value) {
  const date = toDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function firstValue(object, keys) {
  for (const key of keys) {
    if (object && Object.prototype.hasOwnProperty.call(object, key) &&
      object[key] !== undefined && object[key] !== null && object[key] !== "") {
      return object[key];
    }
  }
  return null;
}

function timeInputValue(value) {
  if (value instanceof Date || (value && typeof value.toDate === "function")) {
    const date = toDate(value);
    return date
      ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
      : "";
  }
  const stringValue = String(value || "").trim();
  const twelveHour = stringValue.match(/(\d{1,2}):([0-5]\d)\s*(AM|PM)/i);
  if (twelveHour) {
    let hours = Number(twelveHour[1]) % 12;
    if (twelveHour[3].toUpperCase() === "PM") hours += 12;
    return `${String(hours).padStart(2, "0")}:${twelveHour[2]}`;
  }
  const twentyFourHour = stringValue.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|$)/);
  if (twentyFourHour) {
    return `${String(Number(twentyFourHour[1])).padStart(2, "0")}:${twentyFourHour[2]}`;
  }
  return "";
}

function splitCombinedTime(value) {
  const parts = String(value || "").split(/\s*(?:-|–|to)\s*/i);
  return parts.length >= 2 ? [timeInputValue(parts[0]), timeInputValue(parts[1])] : ["", ""];
}

function eventStartTime(event) {
  const direct = firstValue(event, ["timeStart", "startTime"]);
  if (direct) return timeInputValue(direct);
  const nested = firstValue(event.schedule || {}, ["timeStart", "startTime"]);
  if (nested) return timeInputValue(nested);
  const combined = firstValue(event, ["time", "eventTime"]);
  return splitCombinedTime(combined)[0];
}

function eventEndTime(event) {
  const direct = firstValue(event, ["timeEnd", "endTime"]);
  if (direct) return timeInputValue(direct);
  const nested = firstValue(event.schedule || {}, ["timeEnd", "endTime"]);
  if (nested) return timeInputValue(nested);
  const combined = firstValue(event, ["time", "eventTime"]);
  return splitCombinedTime(combined)[1];
}

function eventDateRange(event) {
  const start = firstValue(event, ["dateStart", "dateISO", "date", "startDate"]) ||
    firstValue(event.schedule || {}, ["dateStart", "dateISO", "date", "startDate"]);
  const end = firstValue(event, ["dateEnd", "endDateISO", "endDate"]) ||
    firstValue(event.schedule || {}, ["dateEnd", "endDateISO", "endDate"]) || start;
  return { start: dateKey(start), end: dateKey(end) || dateKey(start) };
}

function eventIsPublished(event) {
  const statuses = [event.status, event.publicationStatus].map(normalized);
  if (statuses.some((status) =>
    ["cancelled", "canceled", "completed", "complete", "ended"].includes(status))) {
    return false;
  }
  const publishedStatus = statuses.some((status) =>
    ["published", "rescheduled", "live", "ongoing", "happening-now", "active"].includes(status));
  const publishedFlag = [event.published, event.isPublished, event.publish]
    .some((value) => value === true || String(value).toLowerCase() === "true");
  return publishedStatus || publishedFlag || Boolean(event.publishedAt || event.publishedOn);
}

async function getOwnedPublishedEvent(eventId) {
  await authReady;
  const user = auth?.currentUser;
  if (!user || !db) throw new Error("Sign in with the event organizer account to continue.");

  const eventRef = doc(db, "events", String(eventId));
  const snapshot = await getDoc(eventRef);
  if (!snapshot.exists()) throw new Error("This event is no longer available in Firestore.");
  const event = snapshot.data() || {};
  const ownerUid = String(
    event.organizerUid || event.organizerUID || event.createdByUid ||
    event.ownerUid || event.organizerId || event.createdBy || "",
  );
  if (!ownerUid || ownerUid !== user.uid) {
    throw new Error("Your signed-in account does not own this event.");
  }
  if (!eventIsPublished(event)) {
    throw new Error("Only currently published events can be canceled or rescheduled.");
  }
  return { event, eventRef, user };
}

function openRescheduleDialog() {
  if (!selectedEventId || isSaving) return;
  showActionStatus("");
  setFeedback(rescheduleFeedback, "");
  rescheduleForm?.reset();
  showDialog(rescheduleOverlay, rescheduleDate);
  void loadRescheduleEvent();
}

async function loadRescheduleEvent() {
  const eventId = selectedEventId;
  const saveButton = document.getElementById("saveRescheduleEvent");
  if (saveButton) saveButton.disabled = true;
  setFeedback(rescheduleFeedback, "Loading the current event schedule...", false);
  try {
    const result = await getOwnedPublishedEvent(eventId);
    if (selectedEventId !== eventId) return;
    const dates = eventDateRange(result.event);
    if (!dates.start) throw new Error("This event does not have a usable start date to reschedule.");
    const tomorrow = plusDays(dateKey(new Date()), 1);
    const dayAfterCurrentSchedule = plusDays(dates.start, 1);
    rescheduleDate.min = [tomorrow, dayAfterCurrentSchedule].sort().pop() || tomorrow;
    rescheduleDate.dataset.originalDate = dates.start;
    rescheduleDate.value = "";
    rescheduleStartTime.value = eventStartTime(result.event);
    rescheduleEndTime.value = eventEndTime(result.event);
    setFeedback(rescheduleFeedback, `Choose a date after ${dates.start} and after today.`, false);
  } catch (error) {
    console.error("Could not load event schedule for rescheduling:", error);
    setFeedback(rescheduleFeedback, errorDescription(error, "Loading the event schedule"));
  } finally {
    if (saveButton) saveButton.disabled = false;
  }
}

function plusDays(dateString, days) {
  const date = toDate(dateString);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function daysBetween(first, second) {
  const start = toDate(first);
  const end = toDate(second);
  if (!start || !end) return 0;
  const utcStart = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const utcEnd = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((utcEnd - utcStart) / 86400000));
}

function formatDateLike(original, isoDate) {
  if (typeof original === "string") {
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(original)) {
      const [year, month, day] = isoDate.split("-");
      return `${month}/${day}/${year}`;
    }
    if (/^[A-Za-z]{3,}/.test(original)) {
      return toDate(isoDate).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
    return isoDate;
  }
  if (original instanceof Date) {
    const date = toDate(isoDate);
    return date;
  }
  if (original && typeof original.toDate === "function") {
    const date = toDate(isoDate);
    return Timestamp.fromDate(date);
  }
  return isoDate;
}

function formatTimeForDisplay(time) {
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function formatTimeFieldLike(original, time) {
  return typeof original === "string" && /AM|PM/i.test(original)
    ? formatTimeForDisplay(time)
    : time;
}

function formatTimeLike(original, startTime, endTime) {
  if (typeof original !== "string") return original;
  if (/AM|PM/i.test(original)) {
    return `${formatTimeForDisplay(startTime)} - ${formatTimeForDisplay(endTime)}`;
  }
  return `${startTime} - ${endTime}`;
}

function updateDateTimeObject(source, startDate, startTime, endTime, startOffset = 0, duration = 0) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return source;
  const updated = { ...source };
  let changed = false;
  for (const key of ["date", "dateISO", "dateStart", "startDate"]) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) {
      updated[key] = formatDateLike(source[key], plusDays(startDate, startOffset));
      changed = true;
    }
  }
  for (const key of ["dateEnd", "endDateISO", "endDate"]) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) {
      updated[key] = formatDateLike(source[key], plusDays(startDate, startOffset + duration));
      changed = true;
    }
  }
  for (const key of ["timeStart", "startTime"]) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) {
      updated[key] = formatTimeFieldLike(source[key], startTime);
      changed = true;
    }
  }
  for (const key of ["timeEnd", "endTime"]) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) {
      updated[key] = formatTimeFieldLike(source[key], endTime);
      changed = true;
    }
  }
  for (const key of ["time", "eventTime"]) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] != null) {
      updated[key] = formatTimeLike(source[key], startTime, endTime);
      changed = true;
    }
  }
  return changed ? updated : source;
}

function buildScheduleUpdate(event, newStartDate, startTime, endTime) {
  const currentDates = eventDateRange(event);
  if (!currentDates.start) throw new Error("This event has no supported date field to update.");
  const duration = daysBetween(currentDates.start, currentDates.end);
  const patch = {};

  for (const key of ["date", "dateISO", "dateStart", "startDate"]) {
    if (Object.prototype.hasOwnProperty.call(event, key) && event[key] != null) {
      patch[key] = formatDateLike(event[key], newStartDate);
    }
  }
  for (const key of ["dateEnd", "endDateISO", "endDate"]) {
    if (Object.prototype.hasOwnProperty.call(event, key) && event[key] != null) {
      patch[key] = formatDateLike(event[key], plusDays(newStartDate, duration));
    }
  }
  for (const key of ["timeStart", "startTime"]) {
    if (Object.prototype.hasOwnProperty.call(event, key) && event[key] != null) {
      patch[key] = formatTimeFieldLike(event[key], startTime);
    }
  }
  for (const key of ["timeEnd", "endTime"]) {
    if (Object.prototype.hasOwnProperty.call(event, key) && event[key] != null) {
      patch[key] = formatTimeFieldLike(event[key], endTime);
    }
  }
  for (const key of ["time", "eventTime"]) {
    if (Object.prototype.hasOwnProperty.call(event, key) && typeof event[key] === "string") {
      patch[key] = formatTimeLike(event[key], startTime, endTime);
    }
  }

  for (const key of ["schedule", "dailySchedule", "dailySchedules"]) {
    if (!Object.prototype.hasOwnProperty.call(event, key) || !event[key]) continue;
    const schedule = event[key];
    if (Array.isArray(schedule)) {
      patch[key] = schedule.map((entry, index) =>
        updateDateTimeObject(entry, newStartDate, startTime, endTime, index));
    } else if (typeof schedule === "object") {
      patch[key] = updateDateTimeObject(schedule, newStartDate, startTime, endTime, 0, duration);
    }
  }

  for (const key of ["startAt", "endAt"]) {
    if (!Object.prototype.hasOwnProperty.call(event, key) || !event[key]) continue;
    const isStart = key === "startAt";
    const date = isStart ? newStartDate : plusDays(newStartDate, duration);
    const time = isStart ? startTime : endTime;
    if (typeof event[key] === "string") {
      patch[key] = `${date} ${time}`;
    } else if (event[key] instanceof Date || typeof event[key]?.toDate === "function") {
      patch[key] = Timestamp.fromDate(new Date(`${date}T${time}:00`));
    }
  }

  const hasDateField = ["date", "dateISO", "dateStart", "startDate"]
    .some((key) => Object.prototype.hasOwnProperty.call(patch, key));
  if (!hasDateField) throw new Error("This event has no supported date field to update.");
  patch.updatedAt = serverTimestamp();
  return patch;
}

function validateNewRescheduleDate(date, existingDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || dateKey(date) !== date) {
    throw new Error("Choose a valid new date.");
  }
  if (date <= dateKey(new Date())) {
    throw new Error("The new event date must be in the future.");
  }
  if (date <= existingDate) {
    throw new Error("Choose a date later than the event's current scheduled date.");
  }
}

function sanitizeDraftValue(value) {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeDraftValue).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, entry]) => [key, sanitizeDraftValue(entry)])
        .filter(([, entry]) => entry !== undefined),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function buildRescheduleDraft(event, user, newStartDate, startTime, endTime) {
  const currentDates = eventDateRange(event);
  if (!currentDates.start) throw new Error("This event does not have a usable current start date.");
  validateNewRescheduleDate(newStartDate, currentDates.start);
  if (!startTime || !endTime || endTime <= startTime) {
    throw new Error("Enter a valid start and end time; the end time must be later.");
  }

  const duration = daysBetween(currentDates.start, currentDates.end);
  const newEndDate = plusDays(newStartDate, duration);
  const scheduleSource = {
    ...event,
    date: currentDates.start,
    dateEnd: currentDates.end,
  };
  const scheduleUpdate = buildScheduleUpdate(scheduleSource, newStartDate, startTime, endTime);
  delete scheduleUpdate.updatedAt;

  const title = String(firstValue(event, ["title", "eventName", "name"]) || "Untitled Event");
  const now = Date.now();
  const draft = {
    ...event,
    ...scheduleUpdate,
    id: undefined,
    eventId: undefined,
    title,
    name: title.slice(0, 120),
    eventName: title,
    date: newStartDate,
    dateISO: newStartDate,
    dateStart: newStartDate,
    dateEnd: newEndDate,
    endDate: newEndDate,
    endDateISO: newEndDate,
    timeStart: startTime,
    timeEnd: endTime,
    time: `${startTime} - ${endTime}`,
    status: "draft",
    publicationStatus: "draft",
    published: false,
    isPublished: false,
    publish: false,
    organizerUid: user.uid,
    organizerId: user.uid,
    createdBy: user.uid,
    createdByRole: "organizer",
    createdAt: now,
    updatedAt: now,
    rescheduleOriginalDate: currentDates.start,
  };
  delete draft.approvalHistory;
  delete draft.reviewHistory;
  delete draft.reviewLogs;
  return sanitizeDraftValue(draft);
}

async function createRescheduleDraft(event, user, newStartDate, startTime, endTime) {
  if (!rtdb) throw new Error("Realtime Database is not configured for this application.");
  const draftRef = push(ref(rtdb, `drafts/${user.uid}`));
  if (!draftRef.key) throw new Error("A draft ID could not be created.");
  await set(draftRef, buildRescheduleDraft(event, user, newStartDate, startTime, endTime));
  return draftRef.key;
}

async function prepareRescheduleDraft(event, user) {
  const date = rescheduleDate.value;
  const startTime = rescheduleStartTime.value;
  const endTime = rescheduleEndTime.value;
  const existingDate = eventDateRange(event).start;
  validateNewRescheduleDate(date, existingDate);
  return createRescheduleDraft(event, user, date, startTime, endTime);
}

async function confirmEventCancellation() {
  if (!selectedEventId || isSaving) return;
  isSaving = true;
  const confirmButton = document.getElementById("confirmCancelEvent");
  if (confirmButton) confirmButton.disabled = true;
  setFeedback(cancelFeedback, "");

  try {
    const { event, eventRef } = await getOwnedPublishedEvent(selectedEventId);
    const update = { status: "cancelled", updatedAt: serverTimestamp() };
    if (Object.prototype.hasOwnProperty.call(event, "approvalStatus")) {
      update.approvalStatus = "cancelled";
    }
    await updateDoc(eventRef, update);
    closeDialogs(false);
    if (tracker && !tracker.hidden) {
      document.getElementById("btnTrackerClose")?.click();
    }
    showActionStatus("Event canceled. The published event status has been updated.");
  } catch (error) {
    console.error("Could not cancel published event:", error);
    setFeedback(cancelFeedback, errorDescription(error, "Canceling the event"));
  } finally {
    isSaving = false;
    if (confirmButton) confirmButton.disabled = false;
  }
}

async function submitReschedule(event) {
  event.preventDefault();
  if (!selectedEventId || isSaving) return;
  isSaving = true;
  const saveButton = document.getElementById("saveRescheduleEvent");
  const originalButtonText = saveButton?.textContent || "";
  if (saveButton) saveButton.disabled = true;
  setFeedback(rescheduleFeedback, "");

  try {
    const { event: currentEvent, user } =
      await getOwnedPublishedEvent(selectedEventId);
    const draftId = await prepareRescheduleDraft(currentEvent, user);
    try {
      sessionStorage.setItem(
        "recovibeEventNotice",
        "Reschedule draft created. Review and submit it from Create Event.",
      );
      sessionStorage.setItem(
        `recovibeRescheduleOriginalDate_${draftId}`,
        eventDateRange(currentEvent).start,
      );
    } catch (error) {
      console.warn("Could not save reschedule session details:", error);
    }
    closeDialogs(false);
    window.location.assign(
      `EventOrganizerCreateEvent.html?draft=${encodeURIComponent(draftId)}&rescheduleFrom=${encodeURIComponent(eventDateRange(currentEvent).start)}`,
    );
  } catch (error) {
    console.error("Could not prepare the rescheduled event draft:", error);
    setFeedback(rescheduleFeedback, errorDescription(error, "Preparing the rescheduled event"));
  } finally {
    isSaving = false;
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = originalButtonText;
    }
  }
}

tableBody?.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const cancelButton = target?.closest("[data-my-events-action='cancel']");
  if (cancelButton) {
    event.preventDefault();
    event.stopImmediatePropagation();
    openCancelConfirmation(cancelButton.dataset.eventId, cancelButton);
    return;
  }

  const row = target?.closest("tr[data-event-id]");
  if (row) {
    selectedEventId = row.dataset.eventId || "";
    if (!rowIsPublished(row)) restoreTrackerActions();
    syncPublishedActions();
  }
}, true);

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const trackerCancel = target?.closest("#btnTrackerCancel");
  if (!trackerCancel || !selectedEventId || !rowIsPublished(getRow(selectedEventId))) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  openCancelConfirmation(selectedEventId, trackerCancel);
}, true);

document.getElementById("backCancelEvent")?.addEventListener("click", () => closeDialogs());
document.getElementById("confirmCancelEvent")?.addEventListener("click", () => {
  void confirmEventCancellation();
});
document.getElementById("rescheduleFromCancel")?.addEventListener("click", openRescheduleDialog);
document.getElementById("backFromReschedule")?.addEventListener("click", () => {
  setHidden(rescheduleOverlay, true);
  setHidden(cancelOverlay, false);
  setFeedback(cancelFeedback, "");
  window.requestAnimationFrame(() => document.getElementById("rescheduleFromCancel")?.focus());
});
document.getElementById("closeRescheduleEvent")?.addEventListener("click", () => closeDialogs());
rescheduleForm?.addEventListener("submit", (event) => void submitReschedule(event));
cancelOverlay?.addEventListener("click", (event) => {
  if (event.target === cancelOverlay) closeDialogs();
});
rescheduleOverlay?.addEventListener("click", (event) => {
  if (event.target === rescheduleOverlay) closeDialogs();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (!cancelOverlay?.hidden || !rescheduleOverlay?.hidden)) {
    closeDialogs();
  }
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", prepareRequestedDraftView, { once: true });
} else {
  prepareRequestedDraftView();
}

window.addEventListener("recovibeOrganizerEventsChanged", () => {
  cachedOrganizerEventsById = null;
  syncPublishedActions();
});
window.addEventListener("storage", (event) => {
  if (event.key === "recovibeOrganizerEvents") {
    cachedOrganizerEventsById = null;
    syncPublishedActions();
  }
});

const tableObserver = tableBody
  ? new MutationObserver(syncPublishedActions)
  : null;
tableObserver?.observe(tableBody, { childList: true, subtree: true });

const trackerObserver = tracker
  ? new MutationObserver(syncPublishedActions)
  : null;
trackerObserver?.observe(tracker, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["hidden"],
});

syncPublishedActions();
