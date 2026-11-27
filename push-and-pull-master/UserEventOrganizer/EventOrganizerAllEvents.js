import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  query,
  startAfter,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  auth,
  authReady,
  db,
  isFirebaseConfigured,
} from "../UserStudent/firebaseConfig.js";
import { syncOrganizerOrganization } from "../organizationScope.js";
import {
  getEventPhase,
  shouldHideOtherOrganizationCancelledEvent,
} from "./eventOrganizerAllEventsVisibility.mjs";
import { isFullyApproved as isEventFullyApproved } from "../eventWorkflow.js";
import { eventBoundaryMillis as manilaEventBoundaryMillis } from "./eventOrganizerDashboardDates.js";

(() => {
  const EVENT_PAGE_SIZE = 100;
  let events = [];
  let isLoading = true;
  let loadError = "";
  const unsubscribeEvents = [];
  const eventSnapshotsBySource = new Map();
  const additionalEventSnapshotsBySource = new Map();
  const eventSourcesSettled = new Set();
  const eventSourceFailures = new Set();
  let activeEventQueryBases = [];
  let refreshEventSources = () => {};
  const eventCursorsBySource = new Map();
  const eventSourcesHaveMore = new Set();
  let eventPageLoading = false;
  let eventPageError = "";
  const happeningNowRows = document.getElementById("happeningNowEvents");
  const upcomingRows = document.getElementById("upcomingEvents");
  const completedRows = document.getElementById("completedEvents");
  const cancelledRows = document.getElementById("cancelledEvents");
  const upcomingSection = document.getElementById("upcomingEventsSection");
  const completedSection = document.getElementById("completedEventsSection");
  const cancelledSection = document.getElementById("cancelledEventsSection");
  const upcomingHeading = document.querySelector("#upcomingEventsSection h2");
  const search = document.getElementById("eventSearch");
  const status = document.getElementById("eventStatusFilter");
  const category = document.getElementById("eventCategoryFilter");
  let organizerId = "";
  let organizerOrganizationCode = "";
  const eventPageStatus = document.createElement("p");
  const loadMoreEventsButton = document.createElement("button");
  eventPageStatus.className = "organizer-empty";
  eventPageStatus.setAttribute("role", "status");
  eventPageStatus.setAttribute("aria-live", "polite");
  loadMoreEventsButton.type = "button";
  loadMoreEventsButton.className = "filter-button";
  loadMoreEventsButton.textContent = "Load more events";
  const loadMoreEventsWrap = document.createElement("div");
  loadMoreEventsWrap.className = "organizer-load-more-wrap";
  loadMoreEventsWrap.appendChild(loadMoreEventsButton);
  if (cancelledRows || completedRows) {
    (cancelledRows || completedRows).insertAdjacentElement("afterend", eventPageStatus);
    eventPageStatus.insertAdjacentElement("afterend", loadMoreEventsWrap);
  }
  loadMoreEventsButton.addEventListener("click", loadNextEventPage);
  let pageLoadSignaled = false;
  const signalPageReady = () => {
    if (pageLoadSignaled) return;
    pageLoadSignaled = true;
    window.dispatchEvent(new Event("page-data-ready"));
  };
  const state = {
    view: "all",
    source: "All Sources",
    category: "all",
    date: "all",
    status: "all",
  };
  const initialEventId = new URLSearchParams(window.location.search).get(
    "eventId",
  );

  const organizerToday = document.getElementById("organizerToday");
  if (organizerToday) {
    organizerToday.textContent = new Date().toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );
  const sourceMatches = {
    "PUP Official": ["pup official", "pup biñan", "pup biñan campus", "pup cite", "pup main"],
    Organizational: ["organizational", "organization", "event organizer", "ibits", "organizer"],
    "Others / External": ["others / external", "other / external", "others/external", "admin", "external"],
  };
  const categoryMatches = {
    "Academic & Learning": ["academic", "learning"],
    "Tech & Innovation": ["tech", "innovation"],
    "Leadership & Career": ["leadership", "career"],
    "Sports & Fitness": ["sport", "fitness"],
    "Music & Entertainment": ["music", "entertainment"],
    "Orgs & Student Acts": ["org", "organization", "student act"],
    "Social Events": ["social"],
    "Community & Outreach": ["community", "outreach"],
    Competitions: ["competition", "hackathon"],
    "Seminars & Workshops": ["seminar", "workshop"],
    "Arts & Culture": ["art", "culture"],
    "University & Campuses": ["university", "campus"],
  };
  function normalizeSource(source) {
    const value = String(source || "").trim().toLowerCase();
    if (
      /\bcsc\b/.test(value) ||
      value.includes("campus student council") ||
      value.includes("central student council")
    ) return "Organizational";
    if (sourceMatches.Organizational.some((source) => value.includes(source))) {
      return "Organizational";
    }
    if (sourceMatches["PUP Official"].some((source) => value.includes(source))) {
      return "PUP Official";
    }
    if (sourceMatches["Others / External"].some((source) => value.includes(source))) {
      return "Others / External";
    }
    return "Others / External";
  }
  function eventSourceText(event) {
    return [
      event.source,
      event.eventSource,
      event.organization,
      event.organizationName,
      event.organizerName,
    ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  }
  function sourceGroups(event) {
    const value = eventSourceText(event);
    const normalized = normalizeSource(value);
    if (normalized !== "Organizational") return [normalized];
    return ["Organizational", "Others / External"];
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function eventDateObject(event, isEnd = false) {
    let rawDate = isEnd
      ? event.endDateISO || event.dateEnd || event.endDate || event.eventEndDate ||
        event.dateISO || event.eventDate || event.date
      : event.dateISO || event.dateStart || event.startDate ||
        event.eventDate || event.date;
    if (rawDate && typeof rawDate.toDate === "function") rawDate = rawDate.toDate();
    const date = rawDate instanceof Date
      ? new Date(rawDate)
      : typeof rawDate === "number"
        ? new Date(rawDate)
        : new Date(String(rawDate || "").slice(0, 10) + "T00:00:00");
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function eventPhase(event, now = Date.now()) {
    return getEventPhase(event, now, manilaEventBoundaryMillis);
  }

  function isApprovedUpcomingEvent(event) {
    const statusValues = [
      event.status,
      event.approvalStatus,
      event.approval_status,
      event.adminStatus,
      event.admin_status,
      event.publicationStatus,
      event.eventStatus,
      event.submissionStatus,
      event.workflowStatus,
      event.reviewStatus,
      event.reviewDecision,
      event.approval?.status,
      event.approval?.approvalStatus,
      event.review?.status,
      event.review?.decision,
      event.workflow?.status,
      event.approvalData?.status,
      event.approvalData?.approvalStatus,
    ].map((value) => String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, ""));
    const excludedStatus = /^(pending|awaitingapproval|awaitingreview|underreview|inreview|reviewing|submitted|draft|rejected|disapproved|revision|needsrevision|cancelled|canceled|completed|complete|ended|finished)/;
    const hasExplicitApprovalStatus = statusValues.some((status) =>
      ["approved", "fullyapproved", "approvedandunpublished", "approvedbutunpublished", "published", "publishedlive"].includes(status),
    );
    const blockingFlags = [
      event.pending,
      event.isPending,
      event.draft,
      event.isDraft,
      event.isRejected,
      event.rejected,
      event.revision,
      event.isRevision,
      event.revisionRequested,
      event.needsRevision,
      event.isCancelled,
      event.cancelled,
      event.canceled,
      event.completed,
      event.isCompleted,
    ];
    const hasIneligibleFlag = blockingFlags.some((value) =>
      value === true || value === 1 ||
      ["true", "yes", "1"].includes(String(value || "").trim().toLowerCase()) ||
      ["pending", "draft", "rejected", "revision", "cancelled", "canceled", "completed"]
        .includes(String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "")),
    );
    return (isEventFullyApproved(event) || hasExplicitApprovalStatus) &&
      !hasIneligibleFlag &&
      !statusValues.some((status) => excludedStatus.test(status));
  }

  function dateRangeBounds(value) {
    const date = new Date(today);
    if (value === "today") return [date, date];
    if (value === "tomorrow") {
      const tomorrow = new Date(date);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return [tomorrow, tomorrow];
    }
    if (value === "this_week") {
      const start = new Date(date);
      start.setDate(start.getDate() - start.getDay());
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return [start, end];
    }
    if (value === "this_weekend") {
      if (date.getDay() === 0) return [date, date];
      const start = new Date(date);
      start.setDate(start.getDate() + 6 - start.getDay());
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return [start, end];
    }
    if (value === "next_week") {
      const start = new Date(date);
      start.setDate(start.getDate() + 7 - start.getDay());
      const end = new Date(start);
      end.setDate(end.getDate() + 6);
      return [start, end];
    }
    if (value === "this_month")
      return [new Date(date.getFullYear(), date.getMonth(), 1), new Date(date.getFullYear(), date.getMonth() + 1, 0)];
    if (value === "next_month")
      return [new Date(date.getFullYear(), date.getMonth() + 1, 1), new Date(date.getFullYear(), date.getMonth() + 2, 0)];
    return null;
  }

  function matches(event) {
    const query = search.value.trim().toLowerCase();
    const date = eventDateObject(event);
    const categoryValues = categoryMatches[state.category] || [];
    const customRange = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/.exec(state.date);
    const range = dateRangeBounds(state.date);
    const filteredDay = date && new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dateMatches =
      state.date === "all" ||
      (filteredDay && range && filteredDay >= range[0] && filteredDay <= range[1]) ||
      (filteredDay &&
        customRange &&
        filteredDay >= new Date(`${customRange[1]}T00:00:00`) &&
        filteredDay <= new Date(`${customRange[2]}T00:00:00`));
    const eventStatus = String(event.status || "")
      .trim()
      .toLowerCase()
      .replace(/[ _-]+/g, " ");
    const phase = eventPhase(event);
    if (
      state.view === "all" &&
      shouldHideOtherOrganizationCancelledEvent(
        event,
        phase,
        organizerId,
        organizerOrganizationCode,
      )
    ) {
      return false;
    }
    const isCancelled = phase === "cancelled";
    const isRescheduled =
      event.rescheduled === true || eventStatus === "rescheduled";
    const isCompleted = phase === "completed";
    const isHappening = phase === "ongoing" && !isCancelled && !isRescheduled;
    const isUpcoming = phase === "upcoming" && !isCancelled && !isRescheduled &&
      isApprovedUpcomingEvent(event);
    const statusMatches =
      state.status === "all" ||
      (state.status === "ongoing" && isHappening) ||
      (state.status === "upcoming" && isUpcoming) ||
      (state.status === "canceled" && isCancelled) ||
      (state.status === "completed" && isCompleted) ||
      (state.status === "rescheduled" && isRescheduled);

    return (
      (state.view === "all" ||
        String(event.organizerId || "") === String(organizerId)) &&
      (state.source === "All Sources" ||
        sourceGroups(event).includes(state.source === "CSC" ? "Organizational" : state.source)) &&
      (state.category === "all" ||
        categoryValues.some((value) =>
          String(event.category || event.eventType || "")
            .toLowerCase()
            .includes(value),
        )) &&
      dateMatches &&
      statusMatches &&
      (!query ||
        `${event.title} ${event.category} ${event.location}`
          .toLowerCase()
          .includes(query))
    );
  }

  function eventCard(event) {
    const date = eventDateObject(event);
    const dateLabel = date
      ? date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "Date TBA";
    const rawCapacity = Number(
      event.capacity ?? event.maxCapacity ?? event.maxSlots ?? event.slots ?? 0,
    );
    const totalSlots = Number.isFinite(rawCapacity)
      ? Math.max(0, Math.floor(rawCapacity))
      : 0;
    const registeredCount = Math.max(
      0,
      Math.floor(Number(event.registeredCount) || 0),
    );
    const openSlots = Math.max(
      0,
      Math.min(totalSlots, totalSlots - registeredCount),
    );
    const eventId = escape(event.eventId || event.id || "");
    const phase = eventPhase(event);
    const phaseLabel = phase === "unknown"
      ? String(event.status || "Schedule TBA")
      : phase.charAt(0).toUpperCase() + phase.slice(1);
    return `<article class="published-event-card" id="organizer-event-card-${eventId}" data-event-id="${eventId}"><div class="published-event-content" id="published-event-content-${eventId}"><div class="published-event-heading"><div><h2 class="published-event-title" id="published-event-title-${eventId}">${escape(event.title)}</h2><p class="published-event-source" id="published-event-source-${eventId}">${escape(normalizeSource(eventSourceText(event)))}</p></div></div><div class="published-event-meta" id="published-event-meta-${eventId}"><span id="published-event-date-label-${eventId}" class="visually-hidden">${escape(dateLabel)}</span><span class="published-event-meta-time" id="published-event-time-${eventId}">${escape(event.time || "Time TBA")}</span><span class="published-event-meta-location" id="published-event-location-${eventId}">${escape(event.location || "Location TBA")}${event.room ? `&nbsp;·&nbsp;${escape(event.room)}` : ""}</span></div><div class="published-event-footer"><div class="published-event-summary" id="published-event-summary-${eventId}"><div class="published-event-tags" id="published-event-category-group-${eventId}"><span id="published-event-category-${eventId}">${escape(event.category || "General")}</span></div><span class="published-event-capacity" id="published-event-capacity-${eventId}">${openSlots} of ${totalSlots} Slots Open</span><span class="published-event-phase published-event-phase--${escape(phase)}">${escape(phaseLabel)}</span></div><div class="published-event-actions"><button type="button" id="published-event-details-${eventId}" data-preview-id="${eventId}">View Details</button></div></div></div><div class="published-event-date" id="published-event-date-${eventId}" aria-label="${escape(dateLabel)}"><span class="published-event-month" id="published-event-month-${eventId}">${date ? date.toLocaleDateString("en-US", { month: "short" }) : "TBA"}</span><strong class="published-event-day" id="published-event-day-${eventId}">${date ? date.getDate() : ""}</strong><span class="published-event-year" id="published-event-year-${eventId}">${date ? date.getFullYear() : ""}</span></div></article>`;
  }

  function renderList(element, list, emptyText = "No events match your filters.") {
    if (isLoading) {
      element.replaceChildren();
      return;
    }
    if (loadError) {
      element.innerHTML = `<div class="organizer-empty">${escape(loadError)}</div>`;
      return;
    }
    if (!events.length) {
      element.innerHTML =
        '<div class="organizer-empty">No events are available yet.</div>';
      return;
    }
    if (!list.length) {
      element.innerHTML = `<div class="organizer-empty">${escape(emptyText)}</div>`;
      return;
    }
    element.innerHTML = list
      .map((event) => eventCard(event))
      .join("");
  }

  function render() {
    const visible = events
      .filter(matches)
      .sort(
        (first, second) =>
          new Date(second.createdAt || 0).getTime() -
          new Date(first.createdAt || 0).getTime(),
      );
    const happeningNow = visible.filter((event) => eventPhase(event) === "ongoing");
    const completed = visible
      .filter((event) => eventPhase(event) === "completed")
      .sort((first, second) => {
        const firstStart = manilaEventBoundaryMillis(first) ?? 0;
        const secondStart = manilaEventBoundaryMillis(second) ?? 0;
        const firstEnd = manilaEventBoundaryMillis(first, true) ?? firstStart;
        const secondEnd = manilaEventBoundaryMillis(second, true) ?? secondStart;
        return secondEnd - firstEnd || secondStart - firstStart;
      });
    const cancelled = visible.filter((event) => eventPhase(event) === "cancelled");
    const upcoming = visible.filter((event) =>
      isApprovedUpcomingEvent(event) &&
      !happeningNow.includes(event) &&
      !completed.includes(event) &&
      !cancelled.includes(event),
    ).sort(
      (first, second) =>
        (manilaEventBoundaryMillis(first) ?? 0) -
        (manilaEventBoundaryMillis(second) ?? 0),
    );
    if (upcomingHeading) {
      const headingLabel = state.status === "all"
        ? "Upcoming"
        : state.status.charAt(0).toUpperCase() + state.status.slice(1);
      upcomingHeading.textContent = headingLabel;
    }
    if (upcomingSection) {
      upcomingSection.hidden = !["all", "upcoming", "rescheduled"].includes(state.status);
    }
    if (completedSection) completedSection.hidden = state.status !== "completed";
    if (cancelledSection) cancelledSection.hidden = state.status !== "canceled";
    renderList(happeningNowRows, happeningNow, "No ongoing events");
    renderList(upcomingRows, upcoming);
    renderList(completedRows, completed, "No completed events");
    renderList(cancelledRows, cancelled, "No canceled events");
    updateEventPagination();
  }

  function updateEventPagination() {
    const hasMore = eventSourcesHaveMore.size > 0;
    eventPageStatus.hidden = !eventPageError && !hasMore;
    eventPageStatus.textContent = eventPageError ||
      `Showing ${events.length} loaded events. Load more to check older records.`;
    loadMoreEventsButton.hidden = !hasMore;
    loadMoreEventsButton.disabled = eventPageLoading;
    loadMoreEventsButton.textContent = eventPageLoading ? "Loading..." : "Load more events";
  }

  async function loadNextEventPage() {
    if (eventPageLoading || !eventSourcesHaveMore.size) return;
    eventPageLoading = true;
    eventPageError = "";
    updateEventPagination();
    const failures = [];
    const sources = [...eventSourcesHaveMore];
    await Promise.all(sources.map(async (source) => {
      const baseQuery = activeEventQueryBases.find(([querySource]) => querySource === source)?.[1];
      const cursor = eventCursorsBySource.get(source);
      if (!baseQuery || !cursor) return;
      try {
        const snapshot = await getDocs(query(
          baseQuery,
          startAfter(cursor),
          limit(EVENT_PAGE_SIZE),
        ));
        const documents = additionalEventSnapshotsBySource.get(source) || new Map();
        snapshot.docs.forEach((eventDocument) => {
          documents.set(eventDocument.id, eventDocument);
        });
        additionalEventSnapshotsBySource.set(source, documents);
        eventCursorsBySource.set(source, snapshot.docs.at(-1) || cursor);
        if (snapshot.size < EVENT_PAGE_SIZE) eventSourcesHaveMore.delete(source);
      } catch (error) {
        failures.push({ source, error });
        console.error(`Unable to load another Event Organizer event page (${source}):`, error);
      }
    }));
    refreshEventSources();
    eventPageError = failures.length
      ? "Some additional events could not be loaded. Please try again."
      : "";
    eventPageLoading = false;
    render();
  }

  function openDetails(eventId) {
    const event = events.find(
      (item) => String(item.eventId || item.id) === String(eventId),
    );
    if (!event) return;
    event.source = normalizeSource(eventSourceText(event));
    const canReview = String(event.organizerId) === String(organizerId);
    window.RecovibeEventDetails?.open(
      event,
      canReview
        ? {
            showApprovalDocuments: true,
            actionLabel: "Review Documents",
            onAction: () => "Document review is available for this event.",
          }
        : {},
    );
  }

  function closeDetails() {
    const modal = document.getElementById("organizerEventModal");
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
  }

  function closeMenus() {
    document
      .querySelectorAll(".filter-menu.show")
      .forEach((menu) => menu.classList.remove("show"));
    document
      .querySelectorAll('.filter-button[aria-expanded="true"]')
      .forEach((button) => button.setAttribute("aria-expanded", "false"));
  }

  function createDropdown(filter, label, options) {
    const wrapper = document.createElement("div");
    wrapper.className = `filter-dropdown filter-dropdown--${filter}`;
    wrapper.innerHTML = `<button type="button" class="filter-button" data-filter="${filter}" aria-expanded="false">${label}</button><div class="filter-menu" data-menu="${filter}">${options.map((option) => `<button type="button" class="filter-option${option.value === options[0].value ? " active" : ""}" data-value="${escape(option.value)}">${escape(option.label)}</button>`).join("")}</div>`;
    return wrapper;
  }

  function createDateRangePicker(host, select) {
    const wrapper = document.createElement("div");
    const trigger = document.createElement("button");
    const panel = document.createElement("section");
    wrapper.className = "date-range-picker organizer-all-date-range-picker";
    trigger.className = "date-range-trigger organizer-all-date-range-trigger";
    trigger.type = "button";
    trigger.textContent = "All Dates";
    trigger.setAttribute("aria-label", "Date filter: All Dates");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", `${select.id}PickerPanel`);
    panel.className = "date-range-panel organizer-all-date-range-panel";
    panel.id = `${select.id}PickerPanel`;
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-labelledby", `${panel.id}Title`);
    panel.innerHTML = `<header class="date-range-header"><h2 id="${panel.id}Title">Choose date range</h2><button type="button" class="date-range-close" aria-label="Close date picker">&times;</button></header><div class="date-range-quick" role="group" aria-label="Quick date ranges"></div><div class="date-range-months" aria-label="Choose dates"></div><div class="date-range-fields"><label>From<input type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY-MM-DD" aria-label="Start date"></label><label>To<input type="text" inputmode="numeric" autocomplete="off" placeholder="YYYY-MM-DD" aria-label="End date"></label></div><p class="date-range-error" role="alert" aria-live="polite"></p><footer class="date-range-actions"><button type="button" class="date-range-clear">Clear</button><button type="button" class="date-range-cancel">Cancel</button><button type="button" class="date-range-apply">Apply</button></footer>`;
    wrapper.appendChild(trigger);
    host.appendChild(wrapper);
    host.classList.add("date-range-host");
    document.body.appendChild(panel);

    const startInput = panel.querySelector(".date-range-fields label:first-child input");
    const endInput = panel.querySelector(".date-range-fields label:last-child input");
    const quick = panel.querySelector(".date-range-quick");
    const monthsElement = panel.querySelector(".date-range-months");
    const error = panel.querySelector(".date-range-error");
    const pad = (value) => String(value).padStart(2, "0");
    const dateString = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const parseDate = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
      const [year, month, day] = value.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
    };
    const addDays = (date, count) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rangeFor = (preset) => {
      const day = new Date(today);
      if (preset === "today") return [day, day];
      if (preset === "tomorrow") return [addDays(day, 1), addDays(day, 1)];
      if (preset === "this_week") {
        const start = addDays(day, -day.getDay());
        return [start, addDays(start, 6)];
      }
      if (preset === "this_weekend") {
        if (day.getDay() === 0) return [day, day];
        const saturday = addDays(day, 6 - day.getDay());
        return [saturday, addDays(saturday, 1)];
      }
      if (preset === "next_week") {
        const start = addDays(day, 7 - day.getDay());
        return [start, addDays(start, 6)];
      }
      if (preset === "this_month") return [new Date(day.getFullYear(), day.getMonth(), 1), new Date(day.getFullYear(), day.getMonth() + 1, 0)];
      if (preset === "next_month") return [new Date(day.getFullYear(), day.getMonth() + 1, 1), new Date(day.getFullYear(), day.getMonth() + 2, 0)];
      return null;
    };
    const baseOptions = [
      { value: "today", label: "Today" },
      { value: "tomorrow", label: "Tomorrow" },
      { value: "this_week", label: "This week" },
      { value: "this_weekend", label: "This weekend" },
      { value: "next_week", label: "Next week" },
      { value: "this_month", label: "This month" },
      { value: "next_month", label: "Next month" },
      { value: "all", label: "All time" },
    ];
    const options = [...baseOptions];
    ["upcoming", "past"].forEach((value) => {
      const oldOption = [...select.options].find((option) => option.value === value);
      if (oldOption) options.push({ value, label: oldOption.textContent.trim() });
    });
    let applied = { value: select.value || "all", start: "", end: "" };
    let pending = { ...applied };
    let shownMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    let hoverDate = "";
    let previousBodyOverflow = null;

    function setPending(value, bounds = null) {
      if (value.startsWith("custom:")) {
        const [, start, end] = value.split(":");
        pending = { value: "custom", start, end };
      } else if (bounds) {
        pending = { value, start: dateString(bounds[0]), end: dateString(bounds[1]) };
      } else if (value === "all" || value === "upcoming" || value === "past") {
        pending = { value, start: "", end: "" };
      } else {
        const presetBounds = rangeFor(value);
        pending = presetBounds
          ? { value, start: dateString(presetBounds[0]), end: dateString(presetBounds[1]) }
          : { value: "custom", start: "", end: "" };
      }
      startInput.value = pending.start;
      endInput.value = pending.end;
      if (pending.start) {
        const parsed = parseDate(pending.start);
        if (parsed) shownMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
      }
      error.textContent = "";
      renderCalendars();
    }
    function syncPicker() {
      const start = startInput.value.trim();
      const end = endInput.value.trim();
      const startDate = start ? parseDate(start) : null;
      const endDate = end ? parseDate(end) : null;
      if ((start && !startDate) || (end && !endDate)) {
        error.textContent = "Enter a valid date (YYYY-MM-DD).";
      } else if (startDate && endDate && start && end && start > end) {
        error.textContent = "Start date must be on or before end date.";
      } else {
        error.textContent = "";
      }
      if (pending.value === "custom" && !error.textContent) {
        const effectiveStart = start || end;
        const effectiveEnd = end || start;
        const matchingPreset = options.find(({ value }) => {
          const bounds = rangeFor(value);
          return bounds && dateString(bounds[0]) === effectiveStart &&
            dateString(bounds[1]) === effectiveEnd;
        });
        if (matchingPreset) pending = { ...pending, value: matchingPreset.value };
      }
      const unchanged = pending.value === applied.value
        && pending.start === applied.start
        && pending.end === applied.end;
      panel.querySelector(".date-range-apply").disabled = Boolean(error.textContent) || unchanged;
      quick.querySelectorAll("button").forEach((button) => {
        const active = button.dataset.value === pending.value;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      monthsElement.querySelectorAll(".date-range-day").forEach((button) => {
        const value = button.dataset.date;
        const selected = value === pending.start || value === pending.end;
        const previewEnd = pending.end || hoverDate;
        const lower = previewEnd && previewEnd < pending.start ? previewEnd : pending.start;
        const upper = previewEnd && previewEnd < pending.start ? pending.start : previewEnd;
        button.classList.toggle("selected", selected);
        button.classList.toggle("in-range", Boolean(lower && upper && value > lower && value < upper));
        button.classList.toggle("range-preview-end", Boolean(hoverDate && value === hoverDate));
        if (selected) button.setAttribute("aria-pressed", "true");
        else button.setAttribute("aria-pressed", "false");
      });
    }
    function renderMonth(monthDate, index) {
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();
      const section = document.createElement("section");
      section.className = "date-range-month";
      section.setAttribute("aria-label", monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" }));
      const title = document.createElement("h3");
      title.className = "date-range-month-title";
      title.textContent = monthDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      section.appendChild(title);
      const weekdayRow = document.createElement("div");
      weekdayRow.className = "date-range-weekdays";
      weekdayRow.setAttribute("aria-hidden", "true");
      ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].forEach((label) => {
        const weekday = document.createElement("span");
        weekday.textContent = label;
        weekdayRow.appendChild(weekday);
      });
      section.appendChild(weekdayRow);
      const grid = document.createElement("div");
      grid.className = "date-range-days";
      grid.setAttribute("role", "grid");
      const first = new Date(year, month, 1);
      for (let blank = 0; blank < first.getDay(); blank += 1) {
        const spacer = document.createElement("span");
        spacer.className = "date-range-empty-day";
        spacer.setAttribute("aria-hidden", "true");
        grid.appendChild(spacer);
      }
      const count = new Date(year, month + 1, 0).getDate();
      for (let day = 1; day <= count; day += 1) {
        const value = `${year}-${pad(month + 1)}-${pad(day)}`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "date-range-day";
        button.dataset.date = value;
        button.textContent = String(day);
        button.setAttribute("role", "gridcell");
        button.setAttribute("aria-label", new Date(year, month, day).toLocaleDateString("en-US", { dateStyle: "full" }));
        button.classList.toggle("is-today", value === dateString(today));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!pending.start || pending.end) {
            pending = { value: "custom", start: value, end: "" };
          } else if (value < pending.start) {
            pending = { value: "custom", start: value, end: pending.start };
          } else {
            pending = { value: "custom", start: pending.start, end: value };
          }
          hoverDate = "";
          startInput.value = pending.start;
          endInput.value = pending.end;
          error.textContent = "";
          renderCalendars();
          monthsElement.querySelector(`[data-date="${pending.end || pending.start}"]`)?.focus();
        });
        grid.appendChild(button);
      }
      section.appendChild(grid);
      if (index > 0) section.classList.add("date-range-next-month");
      return section;
    }
    function renderCalendars() {
      monthsElement.replaceChildren();
      const previous = document.createElement("button");
      previous.type = "button";
      previous.className = "date-range-month-nav date-range-previous";
      previous.setAttribute("aria-label", "Previous month");
      previous.textContent = "\u2039";
      previous.addEventListener("click", (event) => {
        event.stopPropagation();
        shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() - 1, 1);
        renderCalendars();
        monthsElement.querySelector(".date-range-previous")?.focus();
      });
      const next = document.createElement("button");
      next.type = "button";
      next.className = "date-range-month-nav date-range-next";
      next.setAttribute("aria-label", "Next month");
      next.textContent = "\u203a";
      next.addEventListener("click", (event) => {
        event.stopPropagation();
        shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1);
        renderCalendars();
        monthsElement.querySelector(".date-range-next")?.focus();
      });
      monthsElement.append(previous, renderMonth(shownMonth, 0), renderMonth(new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 1), 1), next);
      syncPicker();
    }
    options.forEach(({ value, label }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "date-range-quick-option";
      button.dataset.value = value;
      button.textContent = label;
      button.addEventListener("click", () => {
        if (value === "all" || value === "upcoming" || value === "past") setPending(value);
        else setPending(value, rangeFor(value));
      });
      quick.appendChild(button);
    });
    [startInput, endInput].forEach((input) => input.addEventListener("input", () => {
      hoverDate = "";
      const start = startInput.value.trim();
      const end = endInput.value.trim();
      pending = start || end ? { value: "custom", start, end } : { value: "all", start: "", end: "" };
      const enteredDate = parseDate(pending.start) || parseDate(pending.end);
      if (enteredDate) shownMonth = new Date(enteredDate.getFullYear(), enteredDate.getMonth(), 1);
      error.textContent = "";
      renderCalendars();
    }));
    monthsElement.addEventListener("pointerover", (event) => {
      const button = event.target.closest(".date-range-day");
      if (!button || !pending.start || pending.end) return;
      hoverDate = button.dataset.date;
      syncPicker();
    });
    monthsElement.addEventListener("pointerleave", () => {
      if (!hoverDate) return;
      hoverDate = "";
      syncPicker();
    });
    function triggerLabel(selection) {
      if (selection.value === "all") return "All Dates";
      if (selection.value === "upcoming" || selection.value === "past")
        return options.find((option) => option.value === selection.value)?.label || selection.value;
      const preset = options.find((option) => option.value === selection.value);
      if (preset) return preset.label;
      if (selection.start && selection.end) {
        const start = parseDate(selection.start);
        const end = parseDate(selection.end);
        if (start && end) {
          const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const endLabel = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
          return selection.start === selection.end ? endLabel : `${startLabel} \u2013 ${endLabel}`;
        }
      }
      return "Custom range";
    }
    function validCustomRange() {
      const start = startInput.value.trim();
      const end = endInput.value.trim();
      if (!start && !end) return { value: "all", start: "", end: "" };
      const startDate = parseDate(start || end);
      const endDate = parseDate(end || start);
      if (!startDate || !endDate) {
        error.textContent = "Enter a valid date (YYYY-MM-DD).";
        return null;
      }
      if (start && end && start > end) {
        error.textContent = "Start date must be on or before end date.";
        return null;
      }
      return { value: "custom", start: start || end, end: end || start };
    }
    function closePicker(restore = true) {
      panel.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (restore) {
        pending = { ...applied };
        if (pending.start) {
          const parsed = parseDate(pending.start);
          if (parsed) shownMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
        }
        startInput.value = pending.start;
        endInput.value = pending.end;
        error.textContent = "";
        hoverDate = "";
        renderCalendars();
      }
      if (previousBodyOverflow !== null) {
        document.body.style.overflow = previousBodyOverflow;
        previousBodyOverflow = null;
      }
      trigger.focus();
    }
    function positionPanel() {
      if (panel.hidden) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 8;
      const width = Math.min(720, window.innerWidth - margin * 2);
      panel.style.width = `${width}px`;
      panel.style.left = `${Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin))}px`;
      const height = panel.getBoundingClientRect().height;
      const below = rect.bottom + height + margin <= window.innerHeight;
      const top = below ? rect.bottom + margin : rect.top - height - margin;
      panel.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
    }
    function openPicker() {
      pending = { ...applied };
      startInput.value = pending.start;
      endInput.value = pending.end;
      if (pending.start) {
        const parsed = parseDate(pending.start);
        if (parsed) shownMonth = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
      } else shownMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      error.textContent = "";
      renderCalendars();
      panel.hidden = false;
      trigger.setAttribute("aria-expanded", "true");
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      positionPanel();
      panel.querySelector(".date-range-close").focus();
    }
    trigger.addEventListener("click", () => panel.hidden ? openPicker() : closePicker(true));
    panel.querySelector(".date-range-close").addEventListener("click", () => closePicker(true));
    panel.querySelector(".date-range-cancel").addEventListener("click", () => closePicker(true));
    panel.querySelector(".date-range-clear").addEventListener("click", () => setPending("all"));
    panel.querySelector(".date-range-apply").addEventListener("click", () => {
      let selection = pending;
      if (pending.value === "custom") {
        selection = validCustomRange();
        if (!selection) return;
      }
      applied = { ...selection };
      let value = selection.value;
      if (value === "custom") value = `custom:${selection.start}:${selection.end}`;
      if (![...select.options].some((option) => option.value === value)) {
        select.add(new Option(triggerLabel(selection), value));
      }
      select.value = value;
      trigger.textContent = triggerLabel(selection);
      trigger.setAttribute("aria-label", `Date filter: ${trigger.textContent}`);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closePicker(true);
    });
    document.addEventListener("click", (event) => {
      if (!panel.hidden && !wrapper.contains(event.target) && !panel.contains(event.target)) closePicker(true);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        closePicker(true);
      }
    });
    panel.addEventListener("keydown", (event) => {
      const button = event.target.closest(".date-range-day");
      if (!button) return;
      const [year, month, day] = button.dataset.date.split("-").map(Number);
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (!offsets[event.key]) return;
      event.preventDefault();
      const target = new Date(year, month - 1, day + offsets[event.key]);
      const value = dateString(target);
      if (!monthsElement.querySelector(`[data-date="${value}"]`)) {
        shownMonth = new Date(target.getFullYear(), target.getMonth(), 1);
        renderCalendars();
      }
      monthsElement.querySelector(`[data-date="${value}"]`)?.focus();
    });
    window.addEventListener("resize", positionPanel);
    window.addEventListener("scroll", positionPanel, true);
    select.classList.add("date-range-native-select");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;
    select.hidden = true;
    if (select.parentElement !== host) host.appendChild(select);
    host.insertBefore(wrapper, select);
    const currentValue = select.value || "all";
    setPending(currentValue);
    applied = { ...pending };
    trigger.textContent = triggerLabel(applied);
    trigger.setAttribute("aria-label", `Date filter: ${trigger.textContent}`);
    renderCalendars();
  }

  function setupDropdowns() {
    const toolbar = search.parentElement;
    toolbar.querySelector(".organizer-button")?.remove();
    const filterBar = document.createElement("div");
    filterBar.className = "filter-bar";
    const dateOptions = [
      { value: "today", label: "Today" },
      { value: "tomorrow", label: "Tomorrow" },
      { value: "this_week", label: "This week" },
      { value: "this_weekend", label: "This weekend" },
      { value: "next_week", label: "Next week" },
      { value: "this_month", label: "This month" },
      { value: "next_month", label: "Next month" },
      { value: "all", label: "All time" },
    ];
    const dateFilter = document.createElement("select");
    dateFilter.id = "organizerDateFilter";
    dateFilter.setAttribute("aria-label", "Filter by date");
    dateOptions.forEach(({ value, label }) => dateFilter.add(new Option(label, value)));
    dateFilter.value = "all";
    const dateRangeHost = document.createElement("div");
    dateRangeHost.className = "filter-dropdown filter-dropdown--date";
    filterBar.append(
      createDropdown("events", "All Events", [
        { value: "all", label: "All Events" },
        { value: "mine", label: "My Events" },
      ]),
      createDropdown("sources", "All Sources", [
        "All Sources",
        "PUP Official",
        "Organizational",
        "Others / External",
      ].map((value) => ({ value, label: value }))),
      createDropdown("category", "Category", [
        { value: "all", label: "All Categories" },
        ...Object.keys(categoryMatches).map((value) => ({
          value,
          label: value,
        })),
      ]),
      dateRangeHost,
      createDropdown("status", "Event Status", [
        { value: "all", label: "All Statuses" },
        { value: "ongoing", label: "Ongoing" },
        { value: "upcoming", label: "Upcoming" },
        { value: "canceled", label: "Canceled" },
        { value: "completed", label: "Completed" },
        { value: "rescheduled", label: "Rescheduled" },
      ]),
    );
    createDateRangePicker(dateRangeHost, dateFilter);
    dateFilter.addEventListener("change", () => {
      state.date = dateFilter.value;
      render();
    });
    toolbar.insertBefore(filterBar, status);
    status.hidden = true;
    category.hidden = true;
    filterBar.addEventListener("click", (event) => {
      const button = event.target.closest(".filter-button");
      const option = event.target.closest(".filter-option");
      if (option) {
        const filter = option
          .closest(".filter-dropdown")
          .querySelector(".filter-button").dataset.filter;
        const stateKey =
          filter === "events"
            ? "view"
            : filter === "sources"
              ? "source"
              : filter;
        state[stateKey] = option.dataset.value;
        option.parentElement
          .querySelectorAll(".filter-option")
          .forEach((item) => item.classList.toggle("active", item === option));
        option
          .closest(".filter-dropdown")
          .querySelector(".filter-button").childNodes[0].textContent =
          option.textContent;
        closeMenus();
        render();
        return;
      }
      if (button) {
        const menu = button.nextElementSibling;
        const open = menu.classList.contains("show");
        closeMenus();
        if (!open) {
          menu.classList.add("show");
          button.setAttribute("aria-expanded", "true");
        }
      }
    });
  }

  search.addEventListener("input", render);
  document.addEventListener("click", (event) => {
    if (event.target.dataset.previewId)
      openDetails(event.target.dataset.previewId);
  });
  document.getElementById("modalClose").addEventListener("click", closeDetails);
  document
    .getElementById("modalReviewDocuments")
    .addEventListener("click", (event) => {
      const selectedEvent = events.find(
        (item) =>
          String(item.eventId || item.id) ===
          String(event.currentTarget.dataset.eventId),
      );
      if (
        !selectedEvent ||
        String(selectedEvent.organizerId) !== String(organizerId)
      ) {
        document.getElementById("modalReviewNotice").textContent =
          "Only the organizer who created this event can review its documents.";
        return;
      }
      document.getElementById("modalReviewNotice").textContent =
        "Document review is available for this event.";
    });
  document
    .getElementById("organizerEventModal")
    .addEventListener("click", (event) => {
      if (event.target.id === "organizerEventModal") closeDetails();
    });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".filter-dropdown")) closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenus();
      closeDetails();
    }
  });
  setupDropdowns();
  render();

  if (!isFirebaseConfigured || !auth || !db) {
    isLoading = false;
    loadError = "Event data is unavailable. Please contact support.";
    render();
    signalPageReady();
  } else {
    authReady.then(() => onAuthStateChanged(auth, async (user) => {
      unsubscribeEvents.forEach((unsubscribe) => unsubscribe());
      unsubscribeEvents.length = 0;
      eventSnapshotsBySource.clear();
      additionalEventSnapshotsBySource.clear();
      eventSourcesSettled.clear();
      eventSourceFailures.clear();
      eventCursorsBySource.clear();
      eventSourcesHaveMore.clear();
      activeEventQueryBases = [];
      eventPageLoading = false;
      eventPageError = "";
      refreshEventSources = () => {};
      if (!user) {
        window.location.replace("EventOrganizerLogin.html");
        return;
      }

      organizerId = user.uid;
      organizerOrganizationCode = "";
      isLoading = true;
      loadError = "";
      render();
      let organizationCode = "";
      try {
        organizationCode = await syncOrganizerOrganization();
      } catch (error) {
        console.warn("Could not verify organizer organization; loading public schedule events.", {
          code: error?.code || "unknown",
        });
      }
      if (auth.currentUser?.uid !== user.uid) return;
      organizerOrganizationCode = organizationCode;
      const eventsRef = collection(db, "events");
      const eventQueries = [
        ["public-status", query(eventsRef, where("status", "in", [
          "approved", "Approved", "APPROVED",
          "published", "Published", "PUBLISHED",
          "completed", "Completed", "COMPLETED",
          "ended", "Ended", "ENDED",
          "rescheduled", "Rescheduled", "RESCHEDULED",
          "ongoing", "Ongoing", "ONGOING",
          "upcoming", "Upcoming", "UPCOMING",
          "active", "Active", "ACTIVE",
        ]))],
        ["public-publication-status", query(eventsRef, where("publicationStatus", "in", [
          "published", "Published", "PUBLISHED",
        ]))],
        ["public-published", query(eventsRef, where("published", "==", true))],
        ["public-is-published", query(eventsRef, where("isPublished", "==", true))],
        ["owner-organizer-uid", query(eventsRef, where("organizerUid", "==", user.uid))],
        ["owner-organizer-id", query(eventsRef, where("organizerId", "==", user.uid))],
        ["owner-created-by", query(eventsRef, where("createdBy", "==", user.uid))],
      ];
      if (organizationCode) {
        eventQueries.push([
          "organization",
          query(eventsRef, where("organizationCode", "==", organizationCode)),
        ]);
      }
      activeEventQueryBases = eventQueries;

      let initialEventOpened = false;
      const refreshEvents = () => {
        const mergedDocuments = new Map();
        eventSnapshotsBySource.forEach((sourceDocuments) => {
          sourceDocuments.forEach((eventDocument, id) => {
            const previous = mergedDocuments.get(id);
            const previousTime = previous?.updateTime?.toMillis?.() || 0;
            const currentTime = eventDocument.updateTime?.toMillis?.() || 0;
            if (!previous || currentTime >= previousTime) {
              mergedDocuments.set(id, eventDocument);
            }
          });
        });
        additionalEventSnapshotsBySource.forEach((sourceDocuments) => {
          sourceDocuments.forEach((eventDocument, id) => {
            const previous = mergedDocuments.get(id);
            const previousTime = previous?.updateTime?.toMillis?.() || 0;
            const currentTime = eventDocument.updateTime?.toMillis?.() || 0;
            if (!previous || currentTime >= previousTime) {
              mergedDocuments.set(id, eventDocument);
            }
          });
        });
        events = [...mergedDocuments.values()]
          .map((eventDocument) => {
            const data = eventDocument.data();
            const statuses = [data.status, data.publicationStatus]
              .map((value) => String(value || "").trim().toLowerCase().replace(/[ _-]+/g, " "));
            const isDisplayable =
              statuses.some((value) =>
                ["approved", "published", "completed", "complete", "ended", "rescheduled", "ongoing", "upcoming", "active"].includes(value),
              ) ||
              data.published === true ||
              data.isPublished === true ||
              data.isApproved === true;
            if (!isDisplayable) return null;
            const eventDate = data.eventDate || data.dateISO || data.dateStart || data.date || "";
            const createdAt = data.createdAt?.toDate
              ? data.createdAt.toDate().toISOString()
              : data.createdAt || "";
            const startTime = data.startTime || data.timeStart || "";
            const endTime = data.endTime || data.timeEnd || "";
            return {
              ...data,
              id: eventDocument.id,
              eventId: eventDocument.id,
              title: data.eventName || data.title || "Untitled",
              dateISO: eventDate,
              endDateISO: data.endDateISO || data.dateEnd || data.endDate ||
                data.eventEndDate || eventDate,
              startTime,
              endTime,
              time:
                data.time ||
                [startTime, endTime].filter(Boolean).join(" - ") ||
                "Time TBA",
              location: data.venue || data.location || data.venueOther || "",
              category: data.category || data.eventType || "General",
              source:
                data.source ||
                data.eventSource ||
                data.organization ||
                data.organizationName ||
                data.organizerOrganization ||
                data.organizerName ||
                (data.organizerId
                  ? "Organizational"
                  : "Others / External"),
              createdAt,
              organizerId: data.organizerId || data.organizerUid || data.createdBy || "",
            };
          })
          .filter(Boolean);
        isLoading = eventSourcesSettled.size < eventQueries.length;
        loadError = eventSourcesSettled.size === eventQueries.length &&
          eventSourceFailures.size === eventQueries.length
          ? "Could not load events. Please try again later."
          : "";
        render();
        if (!isLoading) signalPageReady();
        if (!initialEventOpened && initialEventId && events.some(
          (event) => String(event.eventId || event.id) === String(initialEventId),
        )) {
          initialEventOpened = true;
          openDetails(initialEventId);
        }
      };
      refreshEventSources = refreshEvents;

      eventQueries.forEach(([source, eventsQuery]) => {
        const unsubscribe = onSnapshot(
          query(eventsQuery, limit(EVENT_PAGE_SIZE)),
          (snapshot) => {
            eventSnapshotsBySource.set(source, new Map(
              snapshot.docs.map((eventDocument) => [eventDocument.id, eventDocument]),
            ));
            if (!additionalEventSnapshotsBySource.has(source)) {
              eventCursorsBySource.set(source, snapshot.docs.at(-1) || null);
              if (snapshot.size === EVENT_PAGE_SIZE) {
                eventSourcesHaveMore.add(source);
              } else {
                eventSourcesHaveMore.delete(source);
              }
            }
            eventSourcesSettled.add(source);
            eventSourceFailures.delete(source);
            refreshEvents();
          },
          (error) => {
            console.warn(`Unable to load All Events source (${source}):`, {
              code: error?.code || "unknown",
            });
            eventSourcesSettled.add(source);
            eventSourceFailures.add(source);
            refreshEvents();
          },
        );
        unsubscribeEvents.push(unsubscribe);
      });
    })).catch((error) => {
      console.error("Could not restore organizer authentication state:", error);
      isLoading = false;
      loadError = "Could not verify your session. Please refresh and try again.";
      render();
      signalPageReady();
    });
  }
})();
