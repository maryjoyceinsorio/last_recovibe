import { auth, authReady, rtdb } from "../UserStudent/firebaseConfig.js";
import { get, push, ref, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const draftIdPattern = /^[A-Za-z0-9_-]+$/;
let pendingNavigationHref = "";
let saveInProgress = false;
let rescheduleOriginalDate = "";
let rescheduleValidationPending = false;
let isApplyingRescheduleDateConstraint = false;
let isHandlingRescheduleMutations = false;
const favoriteClickStart = new WeakMap();

function getFavoriteValue(button) {
  const pressed = button.getAttribute("aria-pressed");
  if (pressed === "true" || pressed === "false") return pressed === "true";
  const input = document.getElementById("addAsFavoriteState");
  return input?.value === "true";
}

function syncFavoriteControl(button, favorite) {
  const input = document.getElementById("addAsFavoriteState");
  if (input && input.value !== String(favorite)) {
    input.value = String(favorite);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  button.classList.toggle("is-active", favorite);
  button.setAttribute("aria-pressed", String(favorite));
  button.setAttribute(
    "aria-label",
    favorite ? "Remove this event from favorites" : "Add this event to favorites",
  );
  button.textContent = favorite ? "★ Added as Favorite" : "☆ Add as Favorite";

  let status = document.getElementById("createEventFavoriteStatus");
  if (!status || !button.parentElement?.contains(status)) {
    status = document.createElement("span");
    status.id = "createEventFavoriteStatus";
    status.className = "sr-only";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    button.insertAdjacentElement("afterend", status);
  }
  const statusText = favorite
    ? "This event will be added to Favorite Events after it is saved."
    : "This event will not be added to Favorite Events.";
  if (status.textContent !== statusText) status.textContent = statusText;
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("#btnAddAsFavorite");
  if (!button || button.disabled) return;
  favoriteClickStart.set(event, getFavoriteValue(button));
}, true);

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest("#btnAddAsFavorite");
  if (!button || button.disabled || !favoriteClickStart.has(event)) return;

  const startingValue = favoriteClickStart.get(event);
  const input = document.getElementById("addAsFavoriteState");
  const ariaValue = button.getAttribute("aria-pressed");
  const inputValue = input ? input.value === "true" : null;
  const changedAriaValue = ariaValue === "true" || ariaValue === "false"
    ? ariaValue === "true"
    : null;
  const nextValue = changedAriaValue !== null && changedAriaValue !== startingValue
    ? changedAriaValue
    : inputValue !== null && inputValue !== startingValue
      ? inputValue
      : !startingValue;
  syncFavoriteControl(button, nextValue);
}, false);

function getForm() {
  return document.getElementById("createEventMainForm");
}

function getFieldValue(id) {
  const field = document.getElementById(id);
  return typeof field?.value === "string" ? field.value.trim() : "";
}

function getCheckedValues(selector) {
  return Array.from(document.querySelectorAll(selector))
    .filter((input) => input.checked)
    .map((input) => String(input.value || "").trim())
    .filter(Boolean);
}

function cleanLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[•*-]\s*/, ""))
    .filter(Boolean);
}

function collectFormFields(form) {
  const fields = {};
  for (const [key, value] of new FormData(form).entries()) {
    if (typeof value !== "string") continue;
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      fields[key] = Array.isArray(fields[key]) ? [...fields[key], value] : [fields[key], value];
    } else {
      fields[key] = value;
    }
  }
  return fields;
}

function collectExternalGuests() {
  return Array.from(document.querySelectorAll("#externalGuestsList .ce-guest-card"))
    .map((card) => ({
      name: card.querySelector(".ce-guest-name")?.value.trim() || "",
      organization: card.querySelector(".ce-guest-org")?.value.trim() || "",
      email: card.querySelector(".ce-guest-email")?.value.trim() || "",
      role: card.querySelector(".ce-guest-role")?.value.trim() || "",
      accessNeeds: card.querySelector(".ce-guest-access")?.value.trim() || "",
    }));
}

function collectPartnerOrganizations() {
  return Array.from(document.querySelectorAll("#partnerOrgList .ce-partner-item"))
    .map((item) => ({
      id: item.dataset.partnerId || "",
      name: item.querySelector(".ce-partner-name")?.textContent.trim() || "",
      subtitle: item.querySelector(".ce-partner-subtitle-text")?.textContent.trim() || "",
      role: item.querySelector(".ce-partner-item-role")?.value || "Co-Organizer",
    }))
    .filter((organization) => organization.id || organization.name);
}

function collectSections() {
  const sections = Array.from(document.querySelectorAll("#targetSectionsList .ce-chip-label"))
    .map((chip) => chip.textContent.trim())
    .filter(Boolean);
  const pending = getFieldValue("targetSections")
    .split(/[,\n]/)
    .map((section) => section.trim())
    .filter(Boolean);
  return [...new Set([...sections, ...pending])];
}

function collectFaculty() {
  return Array.from(document.querySelectorAll("#facultyChipsList .ce-chip"))
    .map((chip) => {
      const name = chip.querySelector(".ce-chip-label")?.textContent.trim() || "";
      return name ? { id: name, name } : null;
    })
    .filter(Boolean);
}

function collectFacultyInCharge() {
  const chip = document.querySelector("#facultyInChargeChip .ce-chip-label");
  const name = chip?.textContent.trim() || "";
  return name ? { id: name, name } : null;
}

function collectDraftPayload(status = "draft") {
  const form = getForm();
  if (!form) throw new Error("The event form is not ready. Reload the page and try again.");

  const fields = collectFormFields(form);
  const eventName = getFieldValue("eventName") || "Untitled Event";
  const categories = getCheckedValues(".ce-cat-checkbox");
  const targetAudience = getFieldValue("targetAudience");
  const targetYearLevels = getCheckedValues(".ce-target-year");
  const targetDepartments = targetAudience === "Open to All"
    ? []
    : getCheckedValues(".ce-target-department");
  const targetOrganizations = targetAudience === "Open to All"
    ? []
    : getCheckedValues(".ce-target-organization");
  const targetSections = collectSections();
  const participantDocumentLink = getFieldValue("participantDocsLinks");
  const participantDocuments = participantDocumentLink
    ? [{ name: "Participant Documents", url: participantDocumentLink, type: "Google Drive" }]
    : [];
  const keyDetails = cleanLines(getFieldValue("keyDetails"));
  const requirements = cleanLines(getFieldValue("requirements"));
  const date = getFieldValue("eventDate");
  const dateEnd = getFieldValue("eventDateEnd") || date;
  const timeStart = getFieldValue("timeStart");
  const timeEnd = getFieldValue("timeEnd");
  const venue = getFieldValue("venue");
  const capacityText = getFieldValue("maxCapacity");
  const maxCapacity = capacityText ? Number(capacityText) : null;
  const externalGuests = collectExternalGuests();
  const partnerOrganizations = collectPartnerOrganizations();
  const approvalDocuments = getFieldValue("adminDoc-adminReview");
  const targetSectionsValue = targetSections;

  return {
    ...fields,
    title: eventName,
    name: eventName.slice(0, 120),
    eventName,
    favorite: document.getElementById("addAsFavoriteState")?.value === "true",
    ...(rescheduleOriginalDate ? { rescheduleOriginalDate } : {}),
    eventSource: getFieldValue("eventSource"),
    source: "event-organizer",
    categories,
    category: categories.join(", "),
    targetAudience,
    targetOrgs: targetOrganizations,
    targetOrganizations,
    targetYear: getFieldValue("targetYear") || (targetYearLevels.length ? targetYearLevels.join(", ") : "All Levels"),
    targetYearLevels,
    targetDepartments,
    targetSections: targetSectionsValue,
    date,
    dateISO: date,
    dateStart: date,
    dateEnd,
    endDate: dateEnd,
    endDateISO: dateEnd,
    dailySchedule: getFieldValue("dailySchedule"),
    timeStart,
    timeEnd,
    time: timeStart && timeEnd ? `${timeStart} - ${timeEnd}` : "",
    venue,
    location: venue,
    customVenueName: getFieldValue("customVenueName"),
    customVenueAddress: getFieldValue("customVenueAddress"),
    onlineMeetingLink: getFieldValue("onlineMeetingLink"),
    maxCapacity: Number.isFinite(maxCapacity) ? maxCapacity : null,
    capacity: Number.isFinite(maxCapacity) ? maxCapacity : null,
    registrationStart: getFieldValue("registrationStart"),
    registrationEnd: getFieldValue("registrationEnd") || getFieldValue("registrationDeadline"),
    registrationDeadline: getFieldValue("registrationEnd") || getFieldValue("registrationDeadline"),
    attendanceRequired: document.getElementById("attendanceRequired")?.checked ?? true,
    description: getFieldValue("description"),
    rationale: getFieldValue("rationale"),
    keyDetails,
    objectives: keyDetails,
    requirements,
    facultyInCharge: collectFacultyInCharge(),
    participatingFaculty: collectFaculty(),
    contactPerson: {
      name: getFieldValue("contactName"),
      email: getFieldValue("contactEmail"),
      phone: getFieldValue("contactPhone"),
    },
    contactName: getFieldValue("contactName"),
    contactEmail: getFieldValue("contactEmail"),
    contactPhone: getFieldValue("contactPhone"),
    participantDocuments,
    attachments: participantDocuments,
    approvalDocuments,
    adminDocuments: approvalDocuments,
    isCollaboration: Boolean(document.getElementById("isCollaboration")?.checked),
    partnerOrganizations,
    collaborationNotes: getFieldValue("collaborationNotes"),
    externalGuests,
    outsideGuests: externalGuests.length > 0,
    approvers: getCheckedValues("#approverList .ce-approver-checkbox"),
    status,
  };
}

function serializeFormForServer(status = "draft") {
  return collectDraftPayload(status);
}

globalThis.serializeFormForServer = serializeFormForServer;

function getDraftStatusElement() {
  let status = document.getElementById("clientDraftSaveStatus");
  if (status) return status;

  const form = getForm();
  if (!form) return null;
  status = document.createElement("p");
  status.id = "clientDraftSaveStatus";
  status.setAttribute("role", "alert");
  status.setAttribute("aria-live", "assertive");
  status.hidden = true;
  status.style.margin = "12px 0";
  status.style.color = "#a12622";
  form.insertAdjacentElement("afterend", status);
  return status;
}

function showDraftError(message) {
  const status = getDraftStatusElement();
  if (!status) {
    console.error("[CreateEventDrafts] " + message);
    return;
  }
  status.textContent = message;
  status.hidden = false;
}

function getDraftIdFromUrl() {
  const value = new URLSearchParams(window.location.search).get("draft") || "";
  return draftIdPattern.test(value) ? value : "";
}

function validDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDateKeyDays(value, days) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

function rescheduleStorageKey(draftId) {
  return `recovibeRescheduleOriginalDate_${draftId}`;
}

function applyRescheduleDateConstraint() {
  if (isApplyingRescheduleDateConstraint) return;
  const input = document.getElementById("eventDate");
  if (!input || !rescheduleOriginalDate) return;
  isApplyingRescheduleDateConstraint = true;
  try {
    const tomorrow = addDateKeyDays(localDateKey(new Date()), 1);
    const afterOriginal = addDateKeyDays(rescheduleOriginalDate, 1);
    const minimumDate = tomorrow > afterOriginal ? tomorrow : afterOriginal;
    if (input.min !== minimumDate) input.min = minimumDate;
    if (input.dataset.rescheduleOriginalDate !== rescheduleOriginalDate) {
      input.dataset.rescheduleOriginalDate = rescheduleOriginalDate;
    }
  } finally {
    isApplyingRescheduleDateConstraint = false;
  }
}

function validateRescheduleDate() {
  if (rescheduleValidationPending) {
    showDraftError(
      "Checking the original event date. Please wait and try again.",
    );
    return false;
  }
  if (!rescheduleOriginalDate) return true;
  const input = document.getElementById("eventDate");
  const value = input?.value || "";
  let message = "";
  if (!validDateKey(value)) {
    message = "Choose a valid new date for the rescheduled event.";
  } else if (value <= localDateKey(new Date())) {
    message = "The rescheduled event date must be in the future.";
  } else if (value <= rescheduleOriginalDate) {
    message = "Choose a date later than the event's original scheduled date.";
  }

  input?.setCustomValidity(message);
  if (!message) return true;
  showDraftError(message);
  input?.reportValidity();
  return false;
}

getForm()?.addEventListener("submit", (event) => {
  if (validateRescheduleDate()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

document.getElementById("eventDate")?.addEventListener("input", (event) => {
  event.currentTarget.setCustomValidity("");
});

async function loadRescheduleOriginalDate() {
  const queryDate = new URLSearchParams(window.location.search).get("rescheduleFrom") || "";
  if (validDateKey(queryDate)) {
    rescheduleOriginalDate = queryDate;
    applyRescheduleDateConstraint();
    return;
  }

  const draftId = getDraftIdFromUrl();
  if (!draftId || !auth || !rtdb) return;
  try {
    const storedDate = sessionStorage.getItem(rescheduleStorageKey(draftId)) || "";
    if (validDateKey(storedDate)) {
      rescheduleOriginalDate = storedDate;
      applyRescheduleDateConstraint();
      return;
    }
  } catch (error) {
    console.warn("[CreateEventDrafts] Could not restore the reschedule date from this session:", error);
  }

  rescheduleValidationPending = true;
  try {
    await authReady;
    const user = auth.currentUser;
    if (!user) return;
    const snapshot = await get(ref(rtdb, `drafts/${user.uid}/${draftId}`));
    const savedDate = snapshot.val()?.rescheduleOriginalDate;
    if (validDateKey(savedDate)) {
      rescheduleOriginalDate = savedDate;
      applyRescheduleDateConstraint();
    }
  } catch (error) {
    console.error("[CreateEventDrafts] Could not restore the reschedule date constraint:", error);
  } finally {
    rescheduleValidationPending = false;
  }
}

function makeErrorMessage(error) {
  const code = String(error?.code || "");
  if (code.includes("PERMISSION_DENIED") || code.includes("permission-denied")) {
    return "Your account cannot save drafts to Realtime Database. Check your organizer access or ask an administrator to review database rules.";
  }
  if (code.includes("NETWORK") || code.includes("network")) {
    return "The draft could not be saved because the network connection failed. Check your connection and try again.";
  }
  return error?.message || "The draft could not be saved. Check your connection and try again.";
}

function getMyEventsUrl(draftId) {
  const url = new URL("EventOrganizerMyEvents.html", window.location.href);
  url.searchParams.set("draft", draftId);
  return url.href;
}

function getRedirectUrl(draftId, requestedHref) {
  if (!requestedHref) return getMyEventsUrl(draftId);
  const url = new URL(requestedHref, window.location.href);
  if (url.pathname.toLowerCase().endsWith("/eventorganizermyevents.html")) {
    url.searchParams.set("draft", draftId);
  }
  return url.href;
}

async function saveDraftAndRedirect(confirmButton, requestedHref = "") {
  if (saveInProgress) return;
  if (!validateRescheduleDate()) return;
  saveInProgress = true;

  const saveButton = document.getElementById("btnSaveDraft");
  const priorConfirmDisabled = confirmButton.disabled;
  const priorSaveDisabled = saveButton?.disabled || false;
  confirmButton.disabled = true;
  if (saveButton) saveButton.disabled = true;

  try {
    await authReady;
    const user = auth?.currentUser;
    if (!user) throw new Error("Your session has expired. Sign in again before saving this draft.");
    if (!rtdb) throw new Error("Realtime Database is not configured for this application.");

    const parentRef = ref(rtdb, `drafts/${user.uid}`);
    const currentDraftId = getDraftIdFromUrl();
    const draftRef = currentDraftId
      ? ref(rtdb, `drafts/${user.uid}/${currentDraftId}`)
      : push(parentRef);
    const draftId = draftRef.key;
    if (!draftId) throw new Error("A draft ID could not be created. Please try again.");

    const existingSnapshot = await get(draftRef);
    const existingDraft = existingSnapshot.exists() ? existingSnapshot.val() : null;
    const now = Date.now();
    const payload = {
      ...serializeFormForServer("draft"),
      draftId,
      name: (getFieldValue("eventName") || "Untitled Event").slice(0, 120),
      status: "draft",
      organizerUid: user.uid,
      organizerName: getFieldValue("eventOrganizer"),
      createdByRole: "organizer",
      createdAt: typeof existingDraft?.createdAt === "number" ? existingDraft.createdAt : now,
      updatedAt: now,
    };

    await set(draftRef, payload);
    if (rescheduleOriginalDate) {
      try {
        sessionStorage.setItem(rescheduleStorageKey(draftId), rescheduleOriginalDate);
      } catch (error) {
        console.warn("[CreateEventDrafts] Could not keep the reschedule date constraint in this session:", error);
      }
    }
    try {
      sessionStorage.setItem("recovibeEventNotice", "Draft saved.");
    } catch (error) {
      console.warn("[CreateEventDrafts] Could not store the draft success notice:", error);
    }

    document.getElementById("confirmModalCancelBtn")?.click();
    window.location.assign(getRedirectUrl(draftId, requestedHref));
  } catch (error) {
    console.error("[CreateEventDrafts] Could not save event draft:", error);
    showDraftError(makeErrorMessage(error));
    confirmButton.disabled = false;
    if (saveButton) saveButton.disabled = false;
    if (priorConfirmDisabled) confirmButton.disabled = true;
    if (priorSaveDisabled && saveButton) saveButton.disabled = true;
  } finally {
    saveInProgress = false;
  }
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;

  const submitButton = event.target.closest("#btnSubmitApproval");
  if (submitButton && !validateRescheduleDate()) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }

  const anchor = event.target.closest("a[href]");
  if (anchor) {
    const href = anchor.getAttribute("href") || "";
    if (href && !href.startsWith("#") && !href.startsWith("javascript:")) {
      pendingNavigationHref = anchor.href;
    }
  }

  const confirmButton = event.target.closest("#confirmModalPrimaryBtn");
  if (!confirmButton) return;

  const modal = document.getElementById("ceConfirmModal");
  const title = modal?.querySelector("#confirmModalTitle")?.textContent.trim() || "";
  const buttonText = confirmButton.textContent.trim().toLowerCase();
  if (title === "Save Event to Firestore?" && !validateRescheduleDate()) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return;
  }
  const isSaveDraftDialog = title === "Save as Draft?" && buttonText === "save draft";
  const isUnsavedSaveDialog =
    title === "Unsaved Changes" &&
    buttonText === "save draft" &&
    Boolean(pendingNavigationHref);
  if (!isSaveDraftDialog && !isUnsavedSaveDialog) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  const requestedHref = isUnsavedSaveDialog ? pendingNavigationHref : "";
  pendingNavigationHref = "";
  void saveDraftAndRedirect(confirmButton, requestedHref);
}, true);

document.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement && event.target.id === "eventDate") {
    event.target.setCustomValidity("");
  }
});

const createEventRoot = document.getElementById("createEventRoot");
const rescheduleDateObserver = createEventRoot
  ? new MutationObserver(() => {
    if (isHandlingRescheduleMutations || isApplyingRescheduleDateConstraint) return;
    isHandlingRescheduleMutations = true;
    try {
      applyRescheduleDateConstraint();
    } finally {
      rescheduleDateObserver?.takeRecords();
      isHandlingRescheduleMutations = false;
    }
  })
  : null;
rescheduleDateObserver?.observe(createEventRoot, { childList: true });
window.addEventListener("pagehide", () => rescheduleDateObserver?.disconnect(), { once: true });
void loadRescheduleOriginalDate();
