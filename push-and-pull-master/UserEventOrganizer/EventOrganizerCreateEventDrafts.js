import { auth, authReady, rtdb } from "../UserStudent/firebaseConfig.js";
import { get, push, ref, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const draftIdPattern = /^[A-Za-z0-9_-]+$/;
let pendingNavigationHref = "";
let saveInProgress = false;
let rescheduleOriginalDate = "";
let rescheduleValidationPending = false;
let isApplyingRescheduleDateConstraint = false;
let isHandlingRescheduleMutations = false;
let draftForHydration = null;
let draftReadPromise = null;
let draftPageReady = false;
let draftHydrationApplied = false;
let draftHydrationScheduled = false;
let draftHydrationFollowupPending = false;
let draftHydrationFollowupTimer = 0;
let isApplyingDraftHydration = false;
let draftModeActivationAttempted = false;
const draftUserEditedFields = new Set();
const favoriteClickStart = new WeakMap();
const targetSectionPattern = /^\d-\d$/;
const targetSectionPartialPattern = /^(?:\d(?:-\d?)?)?$/;

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

function markDraftUserEdit(event) {
  if (!draftPageReady ||
      draftHydrationApplied && !draftHydrationFollowupPending ||
      isApplyingDraftHydration ||
      !event.isTrusted || !(event.target instanceof Element)) return;
  const form = getForm();
  if (!form?.contains(event.target)) return;

  const target = event.target;
  const key = target.getAttribute("name") || target.id;
  if (key) draftUserEditedFields.add(key);
  if (target.closest("#btnAddAsFavorite")) draftUserEditedFields.add("favorite");
  if (target.matches(".ce-cat-checkbox")) draftUserEditedFields.add("categories");
  if (target.matches(".ce-target-year, #targetAllYears")) {
    draftUserEditedFields.add("targetYearLevels");
  }
  if (target.matches(".ce-target-organization, .ce-target-department")) {
    draftUserEditedFields.add("targetOrganizations");
    draftUserEditedFields.add("targetDepartments");
  }
  if (target.closest("#targetSectionsList")) draftUserEditedFields.add("targetSections");
  if (target.id === "targetSectionsMode") draftUserEditedFields.add("targetSections");
  if (target.closest("#facultyChipsList")) draftUserEditedFields.add("participatingFaculty");
  if (target.closest("#facultyInChargeChip")) draftUserEditedFields.add("facultyInCharge");
  if (target.closest("#partnerOrgList")) draftUserEditedFields.add("partnerOrganizations");
  if (target.closest("#externalGuestsList")) draftUserEditedFields.add("externalGuests");
  if (target.id === "venue" || target.closest(
    "#wrap-customVenueName, #wrap-customVenueAddress, #wrap-outsideVenueLocation, #insidePupCampus, #insidePupBuilding, #insidePupRoomInput, #insidePupRoomNumbersState",
  )) {
    draftUserEditedFields.add("venueDetails");
  }
}

document.addEventListener("input", markDraftUserEdit, true);
document.addEventListener("change", markDraftUserEdit, true);
document.addEventListener("click", markDraftUserEdit, true);

function targetSectionsEnabled() {
  const audience = document.getElementById("targetAudience")?.value || "";
  const mode = document.getElementById("targetSectionsMode")?.value || "all";
  return audience !== "Open to All" && mode === "others";
}

function setTargetSectionsError(message) {
  const input = document.getElementById("targetSections");
  const error = document.getElementById("error-targetSections");
  if (error) {
    error.textContent = message;
    error.hidden = !message;
  }
  if (input) input.setAttribute("aria-invalid", String(Boolean(message)));
}

function renderDraftTargetSectionTags(sections) {
  const list = document.getElementById("targetSectionsList");
  if (!list) return;
  list.replaceChildren(...sections.map((section, index) => {
    const chip = document.createElement("div");
    chip.className = "ce-chip";
    chip.dataset.sectionIndex = String(index);
    const label = document.createElement("span");
    label.className = "ce-chip-label";
    label.textContent = section;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ce-chip-remove";
    remove.dataset.removeSectionIdx = String(index);
    remove.setAttribute("aria-label", `Remove section ${section}`);
    remove.textContent = "✕";
    chip.append(label, remove);
    return chip;
  }));
}

function collectTargetSectionChips() {
  return Array.from(document.querySelectorAll("#targetSectionsList .ce-chip-label"))
    .map((chip) => chip.textContent.trim())
    .filter(Boolean);
}

function validateTargetSections(allowPartialInput = false) {
  if (!targetSectionsEnabled()) {
    setTargetSectionsError("");
    return true;
  }

  const chips = Array.from(document.querySelectorAll("#targetSectionsList .ce-chip-label"))
    .map((chip) => chip.textContent.trim())
    .filter(Boolean);
  const input = document.getElementById("targetSections");
  const pending = (input?.value || "")
    .split(/[,\n]/)
    .map((section) => section.trim())
    .filter(Boolean);
  const invalidChip = chips.find((section) => !targetSectionPattern.test(section));
  const invalidPending = pending.find((section, index) => {
    const isPartialEntry = allowPartialInput &&
      pending.length === 1 &&
      !/[,\n]/.test(input?.value || "") &&
      index === 0;
    return isPartialEntry
      ? !targetSectionPartialPattern.test(section)
      : !targetSectionPattern.test(section);
  });
  const invalid = invalidChip || invalidPending;
  setTargetSectionsError(
    invalid
      ? `"${invalid}" is not a valid section. Use one digit for each part, such as 1-1.`
      : "",
  );
  return !invalid;
}

document.addEventListener("keydown", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.id !== "targetSections") return;

  if (event.key === "Enter" || event.key === ",") {
    if (input.value.trim() && !validateTargetSections()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    return;
  }

  if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const proposed = `${input.value.slice(0, start)}${event.key}${input.value.slice(end)}`;
  if (!/^[0-9-]$/.test(event.key) || !targetSectionPartialPattern.test(proposed)) {
    event.preventDefault();
    setTargetSectionsError(
      "Use one digit for each part of the section, separated by a hyphen (for example, 1-1).",
    );
    return;
  }
  validateTargetSections(true);
}, true);

document.addEventListener("input", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.id !== "targetSections") return;
  if (/[,\n]/.test(input.value) && !validateTargetSections()) {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  validateTargetSections(true);
}, true);

document.addEventListener("blur", (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || input.id !== "targetSections") return;
  if (input.value.trim() && !validateTargetSections()) {
    event.stopImmediatePropagation();
  }
}, true);

document.addEventListener("change", (event) => {
  if (!(event.target instanceof HTMLSelectElement) ||
      !["targetAudience", "targetSectionsMode"].includes(event.target.id)) return;
  window.queueMicrotask(() => validateTargetSections(true));
}, true);

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const remove = event.target.closest("#targetSectionsList [data-remove-section-idx]");
  if (!remove) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  const chip = remove.closest(".ce-chip");
  const remaining = Array.from(document.querySelectorAll("#targetSectionsList .ce-chip"))
    .filter((item) => item !== chip)
    .map((item) => item.querySelector(".ce-chip-label")?.textContent.trim() || "")
    .filter(Boolean);
  const mode = document.getElementById("targetSectionsMode");
  if (!mode) return;
  mode.value = "all";
  mode.dispatchEvent(new Event("change", { bubbles: true }));
  mode.value = "others";
  mode.dispatchEvent(new Event("change", { bubbles: true }));

  const input = document.getElementById("targetSections");
  if (input && remaining.length) {
    input.value = `${remaining.join(",")},`;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  window.queueMicrotask(() => validateTargetSections(true));
}, true);

document.addEventListener("submit", (event) => {
  if (!(event.target instanceof HTMLFormElement) ||
      event.target.id !== "createEventMainForm" ||
      validateTargetSections()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  document.getElementById("targetSections")?.focus();
}, true);

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element) ||
      !event.target.closest("#btnSubmitApproval") ||
      validateTargetSections()) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  document.getElementById("targetSections")?.focus();
}, true);

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

function collectFormInputSnapshot(form, overrides = {}) {
  const indexes = new Map();
  return Array.from(form.querySelectorAll("input, select, textarea"))
    .map((control, ordinal) => {
      if (control instanceof HTMLInputElement && control.type === "file") return null;
      const identity = control.name || control.id || "";
      const index = indexes.get(identity) || 0;
      indexes.set(identity, index + 1);
      const record = {
        id: control.id || "",
        name: control.name || "",
        ordinal,
        index,
        type: control.type || "",
        className: control.className || "",
      };
      const overrideKey = control.id && Object.prototype.hasOwnProperty.call(overrides, control.id)
        ? control.id
        : control.name && Object.prototype.hasOwnProperty.call(overrides, control.name)
          ? control.name
          : "";

      if (overrideKey) {
        record.value = String(overrides[overrideKey] ?? "");
      } else if (control instanceof HTMLSelectElement && control.multiple) {
        record.selectedValues = Array.from(control.selectedOptions, (option) => option.value);
      } else {
        record.value = control.value;
      }
      if (control instanceof HTMLInputElement &&
          ["checkbox", "radio"].includes(control.type)) {
        record.checked = control.checked;
      }
      return record;
    })
    .filter(Boolean);
}

function collectInsidePupVenue() {
  if (!getFieldValue("venue").includes("Others | Inside PUP")) return null;

  const campus = document.getElementById("insidePupCampus")?.value || "";
  const building = document.getElementById("insidePupBuilding")?.value || "";
  const chipRooms = Array.from(document.querySelectorAll("#wrap-customVenueAddress .ce-chips-list .ce-chip-name"))
    .map((chip) => chip.textContent.trim())
    .filter(Boolean);
  const storedRooms = (document.getElementById("insidePupRoomNumbersState")?.value || "")
    .split(/[,\s]+/)
    .map((room) => room.trim())
    .filter(Boolean);
  const rooms = [...new Set([...chipRooms, ...storedRooms])];
  const pendingRoom = document.getElementById("insidePupRoomInput")?.value || "";
  const location = campus === "CITE"
    ? "CITE"
    : campus === "PUP Biñan"
      ? [campus, building].filter(Boolean).join(" — ")
      : "";
  const customVenueName = location
    ? `${location}${rooms.length ? ` (Rooms: ${rooms.join(", ")})` : ""}`
    : getFieldValue("customVenueName");
  const customVenueAddress = campus
    ? rooms[0] || ""
    : getFieldValue("customVenueAddress");

  return {
    campus,
    building,
    rooms,
    pendingRoom,
    customVenueName,
    customVenueAddress,
  };
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
  const sections = collectTargetSectionChips();
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
  const insidePupVenue = collectInsidePupVenue();
  const customVenueName = insidePupVenue?.customVenueName ?? getFieldValue("customVenueName");
  const customVenueAddress = insidePupVenue?.customVenueAddress ?? getFieldValue("customVenueAddress");
  const formValues = collectFormInputSnapshot(form, {
    customVenueName,
    customVenueAddress,
  });
  const multiVenue = globalThis.createEventMultiVenue;
  const selectedVenueState = multiVenue?.getSelectedVenues?.() || [];
  const selectedVenues = selectedVenueState.length
    ? selectedVenueState
    : venue
      ? venue.split(" + ").filter(Boolean)
      : [];
  const venueRooms = multiVenue?.getRoomNumbers?.() || [];

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
    targetSectionsChips: collectTargetSectionChips(),
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
    selectedVenues,
    venueRooms,
    customVenueName,
    customVenueAddress,
    outsideVenueLocation: getFieldValue("outsideVenueLocation"),
    venueDetails: insidePupVenue
      ? {
          campus: insidePupVenue.campus,
          building: insidePupVenue.building,
          rooms: insidePupVenue.rooms,
          pendingRoom: insidePupVenue.pendingRoom,
        }
      : null,
    formValues,
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
  }

  const draftId = getDraftIdFromUrl();
  if (!draftId || !auth || !rtdb) return;
  let storedDate = "";
  try {
    storedDate = sessionStorage.getItem(rescheduleStorageKey(draftId)) || "";
    if (!rescheduleOriginalDate && validDateKey(storedDate)) {
      rescheduleOriginalDate = storedDate;
      applyRescheduleDateConstraint();
    }
  } catch (error) {
    console.warn("[CreateEventDrafts] Could not restore the reschedule date from this session:", error);
  }

  rescheduleValidationPending = !rescheduleOriginalDate;
  try {
    await authReady;
    const user = auth.currentUser;
    if (!user) return;
    const snapshot = await get(ref(rtdb, `drafts/${user.uid}/${draftId}`));
    const savedDraft = snapshot.val();
    if (savedDraft?.status === "draft") draftForHydration = savedDraft;
    const savedDate = savedDraft?.rescheduleOriginalDate;
    if (!rescheduleOriginalDate && validDateKey(savedDate)) {
      rescheduleOriginalDate = savedDate;
      applyRescheduleDateConstraint();
    }
  } catch (error) {
    console.error("[CreateEventDrafts] Could not restore the reschedule date constraint:", error);
  } finally {
    rescheduleValidationPending = false;
  }
}

function draftControlWasEdited(control, record = {}) {
  const keys = [control.id, control.name, record.id, record.name].filter(Boolean);
  if (keys.some((key) => draftUserEditedFields.has(key))) return true;
  const className = `${control.className || ""} ${record.className || ""}`;
  if (className.includes("ce-cat-checkbox") &&
      draftUserEditedFields.has("categories")) return true;
  if ((className.includes("ce-target-year") || control.id === "targetAllYears") &&
      draftUserEditedFields.has("targetYearLevels")) return true;
  if (control.id === "targetYear" &&
      draftUserEditedFields.has("targetYearLevels")) return true;
  if ((className.includes("ce-target-organization") ||
       className.includes("ce-target-department")) &&
      (draftUserEditedFields.has("targetOrganizations") ||
       draftUserEditedFields.has("targetDepartments"))) return true;
  if ((control.id === "targetSections" || control.name === "targetSections") &&
      draftUserEditedFields.has("targetSections")) return true;
  if (["addAsFavoriteState", "btnAddAsFavorite"].some((key) => keys.includes(key)) &&
      draftUserEditedFields.has("favorite")) return true;
  if (["venue", "customVenueName", "customVenueAddress", "insidePupCampus",
    "insidePupBuilding", "insidePupRoomInput", "insidePupRoomNumbersState",
    "outsideVenueLocation"]
    .some((key) => keys.includes(key)) &&
      draftUserEditedFields.has("venueDetails")) return true;
  if (control.closest("#facultyChipsList") &&
      draftUserEditedFields.has("participatingFaculty")) return true;
  if (control.closest("#facultyInChargeChip") &&
      draftUserEditedFields.has("facultyInCharge")) return true;
  if (control.closest("#partnerOrgList") &&
      draftUserEditedFields.has("partnerOrganizations")) return true;
  return Boolean(control.closest("#externalGuestsList") &&
    draftUserEditedFields.has("externalGuests"));
}

function restoreFormInputSnapshot(form, values) {
  if (!Array.isArray(values)) return;
  const controls = Array.from(form.querySelectorAll("input, select, textarea"));
  values.forEach((record) => {
    if (!record || typeof record !== "object") return;
    const control = findSnapshotControl(controls, record);
    if (!control || control instanceof HTMLInputElement && control.type === "file" ||
        draftControlWasEdited(control, record)) return;

    if (control instanceof HTMLSelectElement && Array.isArray(record.selectedValues)) {
      const selected = new Set(record.selectedValues.map(String));
      Array.from(control.options).forEach((option) => {
        option.selected = selected.has(option.value);
      });
    } else if (typeof record.value === "string" || typeof record.value === "number") {
      control.value = String(record.value);
    }
    if (control instanceof HTMLInputElement &&
        typeof record.checked === "boolean") {
      control.checked = record.checked;
    }
  });
}

function findSnapshotControl(controls, record) {
  let control = record.id
    ? controls.find((candidate) => candidate.id === record.id)
    : null;
  if (!control && record.name) {
    control = controls.filter((candidate) => candidate.name === record.name)[record.index || 0] || null;
  }
  if (!control && Number.isInteger(record.ordinal)) control = controls[record.ordinal] || null;
  return control;
}

function restoreInsidePupVenue(form, venueDetails) {
  if (!venueDetails || typeof venueDetails !== "object" ||
      draftUserEditedFields.has("venueDetails")) return;
  const campus = form.querySelector("#insidePupCampus");
  const building = form.querySelector("#insidePupBuilding");
  const roomNumbers = form.querySelector("#insidePupRoomNumbersState");
  const pendingRoom = form.querySelector("#insidePupRoomInput");
  if (campus) campus.value = String(venueDetails.campus || "");
  if (building) building.value = String(venueDetails.building || "");
  if (roomNumbers) {
    roomNumbers.value = Array.isArray(venueDetails.rooms)
      ? venueDetails.rooms.map(String).join(",")
      : "";
  }
  if (pendingRoom) pendingRoom.value = String(venueDetails.pendingRoom || "");
}

function restoreCanonicalDraftFields(form, draft) {
  const venueDetails = draft.venueDetails && typeof draft.venueDetails === "object"
    ? draft.venueDetails
    : {};
  const rooms = Array.isArray(venueDetails.rooms)
    ? venueDetails.rooms.map(String).filter(Boolean)
    : [];
  const campus = String(venueDetails.campus || "");
  const building = String(venueDetails.building || "");
  const venueLocation = campus === "PUP Biñan"
    ? [campus, building].filter(Boolean).join(" — ")
    : campus;
  const computedVenueName = venueLocation
    ? `${venueLocation}${rooms.length ? ` (Rooms: ${rooms.join(", ")})` : ""}`
    : "";
  const keyDetails = Array.isArray(draft.keyDetails)
    ? draft.keyDetails.map((line) => `• ${String(line).replace(/^[•*-]\s*/, "")}`).join("\n")
    : draft.keyDetails;
  const requirements = Array.isArray(draft.requirements)
    ? draft.requirements.map((line) => `• ${String(line).replace(/^[•*-]\s*/, "")}`).join("\n")
    : draft.requirements;
  const dateStart = [draft.eventDate, draft.dateStart, draft.dateISO, draft.date]
    .find((value) => value !== null && value !== undefined && String(value).trim()) || "";
  const timeParts = String(draft.time || "").split(/\s+-\s+/);
  const values = {
    eventName: [draft.title, draft.eventName, draft.name],
    eventSource: [draft.eventSource],
    targetYear: [
      Array.isArray(draft.targetYearLevels) ? draft.targetYearLevels.join(", ") : "",
      draft.targetYear,
    ],
    eventDate: [dateStart],
    eventDateEnd: [draft.eventDateEnd, draft.dateEnd, draft.endDate, draft.endDateISO, dateStart],
    dailySchedule: [draft.dailySchedule],
    timeStart: [draft.timeStart, timeParts[0]],
    timeEnd: [draft.timeEnd, timeParts[1]],
    venue: [draft.venue, draft.location],
    customVenueName: [draft.customVenueName, draft.venueName, computedVenueName, draft.building],
    customVenueAddress: [
      draft.customVenueAddress,
      draft.venueAddress,
      draft.roomNumber,
      rooms[0],
    ],
    outsideVenueLocation: [draft.outsideVenueLocation],
    maxCapacity: [draft.maxCapacity, draft.capacity],
    registrationStart: [draft.registrationStart],
    registrationEnd: [draft.registrationEnd, draft.registrationDeadline],
    registrationDeadline: [draft.registrationDeadline, draft.registrationEnd],
    onlineMeetingLink: [draft.onlineMeetingLink, draft.meetingLink],
    description: [draft.description],
    rationale: [draft.rationale],
    keyDetails: [keyDetails, draft.objectives],
    requirements: [requirements],
    contactName: [draft.contactPerson?.name, draft.contactName],
    contactEmail: [draft.contactPerson?.email, draft.contactEmail],
    contactPhone: [draft.contactPerson?.phone, draft.contactPhone],
    collaborationNotes: [draft.collaborationNotes],
  };

  Object.entries(values).forEach(([id, candidates]) => {
    const control = form.querySelector(`#${id}`);
    if (!control || draftControlWasEdited(control) ||
        hasNonEmptySnapshotValue(draft, id)) return;
    const value = candidates.find((candidate) =>
      candidate !== null && candidate !== undefined && String(candidate).trim(),
    );
    if (value === undefined) return;
    const stringValue = String(value);
    if (control instanceof HTMLSelectElement &&
        !Array.from(control.options).some((option) => option.value === stringValue)) return;
    control.value = stringValue;
  });
}

function hasNonEmptySnapshotValue(draft, id) {
  const values = draft.formValues;
  if (!Array.isArray(values)) return false;
  const record = values.find((candidate) =>
    candidate && (candidate.id === id || candidate.name === id),
  );
  if (!record || typeof record.value !== "string" || !record.value.trim()) return false;
  if (id === "eventName" && record.value.trim() === "Untitled Event" &&
      [draft.title, draft.eventName, draft.name].some((value) =>
        value && String(value).trim() !== "Untitled Event")) return false;
  if (id === "targetYear" && record.value.trim() === "All Levels" &&
      Array.isArray(draft.targetYearLevels) && draft.targetYearLevels.length) return false;
  return true;
}

function dispatchDraftDependencyChanges(form) {
  if (!form) return;
  const dependentIds = new Set([
    "targetAudience",
    "targetSectionsMode",
    "venue",
    "outsideGuests",
    "isCollaboration",
  ]);
  const previewSelectors = [
    "#eventName",
    "#eventSource",
    "#targetYear",
    "#description",
    "#rationale",
    "#eventDate",
    "#eventDateEnd",
    "#dailySchedule",
    "#timeStart",
    "#timeEnd",
    "#customVenueName",
    "#customVenueAddress",
    "#maxCapacity",
    "#registrationStart",
    "#registrationEnd",
    "#registrationDeadline",
    "#onlineMeetingLink",
    ".ce-cat-checkbox",
    ".ce-target-year",
    ".ce-target-organization",
    ".ce-target-department",
    "#attendanceRequired",
  ].join(", ");
  form.querySelectorAll("input, select, textarea").forEach((control) => {
    if (draftControlWasEdited(control)) return;
    if (dependentIds.has(control.id)) {
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (!control.matches(previewSelectors)) return;
    if (!(control instanceof HTMLInputElement) ||
        !["checkbox", "radio"].includes(control.type)) {
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function waitForFormRender() {
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(finish, 100);
    if (typeof window.requestAnimationFrame !== "function") {
      finish();
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(finish));
  });
}

function draftFormNeedsReapply(draft, form) {
  const controls = Array.from(form.querySelectorAll("input, select, textarea"));
  if (Array.isArray(draft.formValues)) {
    for (const record of draft.formValues) {
      if (!record || typeof record !== "object") continue;
      const control = findSnapshotControl(controls, record);
      if (!control || draftControlWasEdited(control, record)) continue;
      if (control instanceof HTMLInputElement &&
          typeof record.checked === "boolean" &&
          control.checked !== record.checked) return true;
      if (control instanceof HTMLSelectElement &&
          Array.isArray(record.selectedValues)) {
        const selected = Array.from(control.selectedOptions, (option) => option.value);
        if (selected.length !== record.selectedValues.length ||
            selected.some((value, index) => value !== String(record.selectedValues[index]))) return true;
      } else if (typeof record.value === "string" &&
          control.value !== record.value) {
        return true;
      }
    }
  }

  const savedTitle = [draft.title, draft.eventName, draft.name]
    .find((value) => value && String(value).trim() &&
      String(value).trim() !== "Untitled Event");
  const eventNameInput = form.querySelector("#eventName");
  if (savedTitle && eventNameInput &&
      !draftControlWasEdited(eventNameInput) &&
      !eventNameInput.value.trim()) return true;
  const categories = Array.isArray(draft.categories)
    ? draft.categories
    : String(draft.category || "").split(",").map((value) => value.trim()).filter(Boolean);
  if (categories.length && !draftUserEditedFields.has("categories") &&
      !form.querySelector(".ce-cat-checkbox:checked")) return true;
  const expectedFields = [
    ["eventDate", [draft.eventDate, draft.dateStart, draft.dateISO, draft.date]],
    ["eventDateEnd", [draft.eventDateEnd, draft.dateEnd, draft.endDate, draft.endDateISO, draft.date]],
    ["dailySchedule", [draft.dailySchedule]],
    ["timeStart", [draft.timeStart]],
    ["timeEnd", [draft.timeEnd]],
    ["venue", [draft.venue, draft.location]],
    ["maxCapacity", [draft.maxCapacity, draft.capacity]],
    ["targetYear", [
      Array.isArray(draft.targetYearLevels) ? draft.targetYearLevels.join(", ") : "",
      draft.targetYear,
    ]],
    ["description", [draft.description]],
  ];
  for (const [id, candidates] of expectedFields) {
    const control = form.querySelector(`#${id}`);
    const expected = candidates.find((value) =>
      value !== null && value !== undefined && String(value).trim(),
    );
    if (control && expected !== undefined &&
        !draftControlWasEdited(control) && !String(control.value).trim()) return true;
  }
  return false;
}

function restoreDraftFormFields(draft) {
  const form = getForm();
  if (!form) return;

  const years = Array.isArray(draft.targetYearLevels)
    ? draft.targetYearLevels.map(String)
    : String(draft.targetYear || "")
      .split(",")
      .map((year) => year.trim())
      .filter((year) => year && year !== "All Levels");
  const categories = Array.isArray(draft.categories)
    ? draft.categories.map(String)
    : String(draft.category || "").split(",").map((category) => category.trim()).filter(Boolean);
  const guests = Array.isArray(draft.externalGuests) ? draft.externalGuests : [];
  const collaboration = typeof draft.isCollaboration === "boolean"
    ? draft.isCollaboration
    : Boolean(Array.isArray(draft.partnerOrganizations) && draft.partnerOrganizations.length);

  if (!draftUserEditedFields.has("targetYearLevels")) {
    form.querySelectorAll(".ce-target-year").forEach((input) => {
      input.checked = years.includes(input.value);
    });
    const allYears = form.querySelector("#targetAllYears");
    if (allYears) allYears.checked = years.length === 0;
  }
  if (!draftUserEditedFields.has("categories")) {
    form.querySelectorAll(".ce-cat-checkbox").forEach((input) => {
      input.checked = categories.includes(input.value);
    });
  }

  const collaborationInput = form.querySelector("#isCollaboration");
  if (collaborationInput && !draftUserEditedFields.has("isCollaboration") &&
      typeof draft.isCollaboration === "boolean") {
    collaborationInput.checked = draft.isCollaboration;
  } else if (collaborationInput && !draftUserEditedFields.has("isCollaboration")) {
    collaborationInput.checked = collaboration;
  }
  const attendanceInput = form.querySelector("#attendanceRequired");
  if (attendanceInput && !draftUserEditedFields.has("attendanceRequired") &&
      typeof draft.attendanceRequired === "boolean") {
    attendanceInput.checked = draft.attendanceRequired;
  }
  const outsideGuestsInput = form.querySelector("#outsideGuests");
  if (outsideGuestsInput && !draftUserEditedFields.has("outsideGuests")) {
    outsideGuestsInput.checked = Boolean(draft.outsideGuests || guests.length);
  }

  form.querySelectorAll("input[name], select[name], textarea[name]").forEach((control) => {
    const name = control.name;
    if (!name || name === "targetSections" || control instanceof HTMLInputElement &&
        ["checkbox", "radio", "file"].includes(control.type) ||
        !Object.prototype.hasOwnProperty.call(draft, name) ||
        draftControlWasEdited(control)) return;

    const savedValue = draft[name];
    if (Array.isArray(savedValue) || savedValue && typeof savedValue === "object") return;
    const value = savedValue === null ? "" : String(savedValue);
    if (control instanceof HTMLSelectElement &&
        !Array.from(control.options).some((option) => option.value === value)) return;
    control.value = value;
  });
  restoreFormInputSnapshot(form, draft.formValues);
  restoreInsidePupVenue(form, draft.venueDetails);
  restoreCanonicalDraftFields(form, draft);
  const favoriteButton = document.getElementById("btnAddAsFavorite");
  if (favoriteButton && typeof draft.favorite === "boolean" &&
      !draftUserEditedFields.has("favorite")) {
    syncFavoriteControl(favoriteButton, draft.favorite);
  }

  const sectionsMode = form.querySelector("#targetSectionsMode");
  const sectionsWrap = form.querySelector("#targetSectionsCustomWrap");
  if (sectionsMode && typeof draft.targetSectionsMode === "string" &&
      !draftControlWasEdited(sectionsMode)) {
    sectionsMode.value = draft.targetSectionsMode;
  }
  if (sectionsWrap && sectionsMode) sectionsWrap.hidden = sectionsMode.value !== "others";
  const savedSectionChips = Array.isArray(draft.targetSectionsChips)
    ? draft.targetSectionsChips
    : draft.targetSections;
  const sections = Array.isArray(savedSectionChips)
    ? [...new Set(savedSectionChips.map((section) => String(section).trim()).filter(Boolean))]
    : [];
  if (sectionsMode?.value === "others" && sections.length &&
      !draftUserEditedFields.has("targetSections")) {
    renderDraftTargetSectionTags(sections);
  }
}

function synchronizeHydratedDraft(draft) {
  restoreDraftFormFields(draft);
  dispatchDraftDependencyChanges(getForm());
  restoreDraftFormFields(draft);
  getForm()?.querySelector("#eventName")?.dispatchEvent(
    new Event("input", { bubbles: true }),
  );
  validateTargetSections(true);
  window.dispatchEvent(new CustomEvent("create-event-draft-hydrated", {
    detail: { draft },
  }));
}

function scheduleDraftHydrationFollowup(draft, draftId) {
  draftHydrationFollowupPending = true;
  draftHydrationFollowupTimer = window.setTimeout(() => {
    draftHydrationFollowupTimer = 0;
    const form = getForm();
    try {
      if (draftId === getDraftIdFromUrl() && form &&
          document.querySelector(
            "#createEventRoot .ce-mode-btn[data-mode='new'][aria-checked='true'], " +
            "#createEventRoot .ce-mode-btn[data-mode='new'].is-active",
          ) &&
          draftFormNeedsReapply(draft, form)) {
        isApplyingDraftHydration = true;
        synchronizeHydratedDraft(draft);
      }
    } catch (error) {
      console.error("[CreateEventDrafts] Could not complete the final draft restore pass:", error);
    } finally {
      isApplyingDraftHydration = false;
      draftHydrationFollowupPending = false;
    }
  }, 180);
}

function activateNewEventForm() {
  const button = document.querySelector("#createEventRoot .ce-mode-btn[data-mode='new']");
  if (!button) return false;
  if (button.getAttribute("aria-checked") === "true" ||
      button.classList.contains("is-active")) {
    draftModeActivationAttempted = true;
    return true;
  }
  if (draftModeActivationAttempted) return false;
  draftModeActivationAttempted = true;
  button.click();
  const activeButton = document.querySelector(
    "#createEventRoot .ce-mode-btn[data-mode='new']",
  );
  return activeButton?.getAttribute("aria-checked") === "true" ||
    Boolean(activeButton?.classList.contains("is-active"));
}

async function applyDraftHydration() {
  if (!draftPageReady || draftHydrationApplied || draftHydrationScheduled ||
      isApplyingDraftHydration ||
      !getDraftIdFromUrl() || !draftReadPromise) return;
  draftHydrationScheduled = true;
  try {
    const requestedDraftId = getDraftIdFromUrl();
    await draftReadPromise;
    if (draftHydrationApplied || !draftForHydration ||
        requestedDraftId !== getDraftIdFromUrl()) {
      draftHydrationScheduled = false;
      return;
    }
    if (!activateNewEventForm()) {
      draftHydrationScheduled = false;
      return;
    }
    await waitForFormRender();
    if (requestedDraftId !== getDraftIdFromUrl() ||
        !document.querySelector(
          "#createEventRoot .ce-mode-btn[data-mode='new'][aria-checked='true'], " +
          "#createEventRoot .ce-mode-btn[data-mode='new'].is-active",
        ) ||
        !getForm()) {
      draftHydrationScheduled = false;
      return;
    }

    isApplyingDraftHydration = true;
    synchronizeHydratedDraft(draftForHydration);
    draftHydrationApplied = true;
    scheduleDraftHydrationFollowup(draftForHydration, requestedDraftId);
  } catch (error) {
    console.error("[CreateEventDrafts] Could not restore all saved draft fields:", error);
    showDraftError("Some saved fields could not be restored. Refresh the page and continue editing again.");
  } finally {
    isApplyingDraftHydration = false;
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
    const formSnapshot = serializeFormForServer("draft");
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
    const eventName = String(formSnapshot.eventName || "Untitled Event");
    const payload = {
      ...formSnapshot,
      draftId,
      name: eventName.slice(0, 120),
      status: "draft",
      organizerUid: user.uid,
      organizerName: String(formSnapshot.eventOrganizer || ""),
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
    document.documentElement.dataset.allowCreateEventNavigation = "true";
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
  if (title === "Submit Event?" && !validateRescheduleDate()) {
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
      if (getDraftIdFromUrl()) activateNewEventForm();
      applyRescheduleDateConstraint();
    } finally {
      rescheduleDateObserver?.takeRecords();
      isHandlingRescheduleMutations = false;
    }
  })
  : null;
rescheduleDateObserver?.observe(createEventRoot, { childList: true });
window.addEventListener("pagehide", () => {
  rescheduleDateObserver?.disconnect();
  window.clearTimeout(draftHydrationFollowupTimer);
  draftHydrationFollowupPending = false;
}, { once: true });
window.addEventListener("page-data-ready", () => {
  if (getDraftIdFromUrl()) activateNewEventForm();
  draftPageReady = true;
  void applyDraftHydration();
});
draftReadPromise = loadRescheduleOriginalDate();
