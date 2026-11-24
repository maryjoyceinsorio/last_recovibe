(() => {
  "use strict";

  const dashboard = document.getElementById("adminActivitySummaryDashboard");
  const dataContainer = document.getElementById("reportDataContainer");
  if (!dashboard || !dataContainer) return;

  const periodFilter = document.getElementById("activityPeriodFilter");
  const venueFilter = document.getElementById("activityVenueFilter");
  const sourceFilter = document.getElementById("activitySourceFilter");
  const categoryFilter = document.getElementById("activityCategoryFilter");
  const statusFilter = document.getElementById("activityStatusFilter");
  const eventSearch = document.getElementById("activityEventSearch");
  const eventDateFilter = document.getElementById("activityEventDateFilter");
  const participationSearch = document.getElementById("participationEventSearch");
  const participationSelect = document.getElementById("participationEventSelect");
  const paginationSlot = document.getElementById("activityEventsPagination");
  const exportButton = document.getElementById("activityExportButton");
  const legacyDownloadButton = document.getElementById("downloadCopyBtn");
  const errorState = document.getElementById("reportErrorState");
  const errorMessage = document.getElementById("reportErrorMessage");
  const summaryError = document.getElementById("activitySummaryError");

  const elements = {
    eventsMetric: document.getElementById("activityMetricEvents"),
    registrationsMetric: document.getElementById("activityMetricRegistrations"),
    attendanceMetric: document.getElementById("activityMetricAttendance"),
    venuesMetric: document.getElementById("activityMetricVenues"),
    fillMetric: document.getElementById("activityMetricFillRate"),
    noShowsMetric: document.getElementById("activityMetricNoShows"),
    registrationsChart: document.getElementById("registrationsChart"),
    venueChart: document.getElementById("venueUsageChart"),
    eventsEmpty: document.getElementById("activityEventsEmpty"),
    eventsTableWrap: document.getElementById("activityEventsTableWrap"),
    eventsTableBody: document.getElementById("activityEventsTableBody"),
    venuesEmpty: document.getElementById("activityVenuesEmpty"),
    venuesTableWrap: document.getElementById("activityVenuesTableWrap"),
    venuesTableBody: document.getElementById("activityVenuesTableBody"),
    participationEmpty: document.getElementById("participationEventEmpty"),
    participationTitle: document.getElementById("participationSelectedEventName"),
    participationMeta: document.getElementById("participationSelectedEventMeta"),
    participationRegistered: document.getElementById("participationRegistered"),
    participationAttended: document.getElementById("participationAttended"),
    participationCancelled: document.getElementById("participationCancelled"),
    participationNoShows: document.getElementById("participationNoShows"),
    participationRate: document.getElementById("participationAttendanceRate"),
    mostParticipated: document.getElementById("activityMostParticipatedList"),
    mostParticipatedEmpty: document.getElementById("activityMostParticipatedEmpty"),
    lastUpdated: document.getElementById("activityLastUpdated"),
  };

  let allEvents = [];
  let currentEvents = [];
  let todayISO = "";

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function eventDate(event) {
    const raw = String(event.dateISO || event.date || "").trim();
    const isoDate = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (isoDate) return isoDate;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(parsed);
  }

  function dateFromISO(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day, 12);
  }

  function formatISODate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function getPeriodRange() {
    if (periodFilter.value === "all" || !todayISO) return null;
    const today = dateFromISO(todayISO);
    let start;
    let end;

    if (periodFilter.value === "year") {
      start = `${today.getFullYear()}-01-01`;
      end = `${today.getFullYear()}-12-31`;
    } else if (periodFilter.value === "month") {
      start = formatISODate(new Date(today.getFullYear(), today.getMonth(), 1, 12));
      end = formatISODate(new Date(today.getFullYear(), today.getMonth() + 1, 0, 12));
    } else if (periodFilter.value === "week") {
      const firstDay = new Date(today);
      firstDay.setDate(today.getDate() - today.getDay());
      const lastDay = new Date(firstDay);
      lastDay.setDate(firstDay.getDate() + 6);
      start = formatISODate(firstDay);
      end = formatISODate(lastDay);
    } else {
      start = todayISO;
      end = todayISO;
    }

    return { start, end };
  }

  function registrationCount(event) {
    const explicit = [
      event.confirmedParticipantsCount,
      event.confirmedRegistrations,
      event.registrationCount,
      event.registeredCount,
      event.attendeesCount,
    ].find((value) => value !== null && value !== undefined && Number.isFinite(Number(value)));
    if (explicit !== undefined) return Math.max(0, Number(explicit));
    const capacity = Number(event.capacity || 0);
    return capacity > 0 ? Math.max(0, capacity - Number(event.openSlots || 0)) : 0;
  }

  function attendanceCount(event) {
    const value = event.attendedCount ?? event.completedAttendance ?? event.attendanceCount;
    return value !== undefined && value !== null && Number.isFinite(Number(value))
      ? Math.max(0, Number(value))
      : null;
  }

  function noShowCount(event) {
    const value = event.noShowCount ?? event.noShows ?? event.absentParticipantsCount ?? event.absentCount;
    return value !== undefined && value !== null && Number.isFinite(Number(value))
      ? Math.max(0, Number(value))
      : 0;
  }

  function sourceText(event) {
    return [
      event.source,
      event.eventSource,
      event.organization,
      event.organizationName,
      event.organizerName,
    ].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  }

  function normalizedSource(event) {
    const value = sourceText(event).toLowerCase();
    if (/\bcsc\b/.test(value) || value.includes("campus student council") ||
        value.includes("central student council")) return "Organizational";
    if (["organizational", "organization", "event organizer", "ibits", "organizer"]
      .some((part) => value.includes(part))) return "Organizational";
    if (["pup official", "pup biñan", "pup biñan campus", "pup cite", "pup main"]
      .some((part) => value.includes(part))) return "PUP Official";
    return "Others / External";
  }

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

  function filteredEvents() {
    const range = getPeriodRange();
    return allEvents.filter((event) => {
      const state = event.summaryState || "excluded";
      if (state === "excluded") return false;
      const date = eventDate(event);
      if (range && (!date || date < range.start || date > range.end)) return false;
      if (venueFilter.value !== "all" && String(event.venue || "").trim() !== venueFilter.value) return false;
      if (sourceFilter.value !== "all" && normalizedSource(event) !== sourceFilter.value) return false;
      if (categoryFilter.value !== "all") {
        const category = String(event.category || event.eventType || "").toLowerCase();
        if (!(categoryMatches[categoryFilter.value] || []).some((part) => category.includes(part))) return false;
      }
      return statusFilter.value === "all" || state === statusFilter.value;
    });
  }

  function updateVenueOptions() {
    const selected = venueFilter.value;
    const venues = [...new Set(allEvents.map((event) => String(event.venue || "").trim()).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right));
    venueFilter.replaceChildren(new Option("All venues", "all"));
    venues.forEach((venue) => venueFilter.add(new Option(venue, venue)));
    venueFilter.value = venues.includes(selected) ? selected : "all";
  }

  function renderCharts(events) {
    if (!events.length) {
      elements.registrationsChart.innerHTML = "<p>No event data yet.</p>";
      elements.venueChart.innerHTML = "<p>No venues used yet.</p>";
      return;
    }

    const today = todayISO ? dateFromISO(todayISO) : new Date();
    const firstMonth = new Date(today.getFullYear(), today.getMonth() - 11, 1, 12);
    const months = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(firstMonth.getFullYear(), firstMonth.getMonth() + index, 1, 12);
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
        label: date.toLocaleDateString("en-US", { month: "short" }),
        value: 0,
      };
    });
    const monthsByKey = new Map(months.map((month) => [month.key, month]));
    events.forEach((event) => {
      const month = monthsByKey.get(eventDate(event).slice(0, 7));
      if (month) month.value += registrationCount(event);
    });
    const maxRegistrations = Math.max(1, ...months.map((month) => month.value));
    elements.registrationsChart.innerHTML = `<div class="activity-chart-bars">${months.map((month) => `
      <div class="activity-chart-bar-group" title="${escapeHTML(month.label)}: ${month.value.toLocaleString()} registrations">
        <span class="activity-chart-bar" style="height:${Math.max(2, (month.value / maxRegistrations) * 76)}px"></span>
        <span class="activity-chart-bar-label">${escapeHTML(month.label)}</span>
      </div>`).join("")}</div>`;

    const venueCounts = new Map();
    events.forEach((event) => {
      const venue = String(event.venue || "").trim();
      if (venue) venueCounts.set(venue, (venueCounts.get(venue) || 0) + 1);
    });
    const topVenues = [...venueCounts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 6);
    if (!topVenues.length) {
      elements.venueChart.innerHTML = "<p>No venues used yet.</p>";
      return;
    }
    const maxEvents = Math.max(1, ...topVenues.map(([, count]) => count));
    elements.venueChart.innerHTML = `<div class="activity-chart-bars">${topVenues.map(([venue, count]) => `
      <div class="activity-chart-bar-group" title="${escapeHTML(venue)}: ${count} events">
        <span class="activity-chart-bar" style="height:${Math.max(2, (count / maxEvents) * 76)}px"></span>
        <span class="activity-chart-bar-label">${escapeHTML(venue)}</span>
      </div>`).join("")}</div>`;
  }

  function renderEventTable(events) {
    const query = eventSearch.value.trim().toLowerCase();
    const date = eventDateFilter.value;
    const visible = events.filter((event) => {
      const searchText = `${event.title || ""} ${event.venue || ""} ${sourceText(event)} ${event.category || ""}`.toLowerCase();
      return (!query || searchText.includes(query)) && (!date || eventDate(event) === date);
    });

    elements.eventsTableBody.replaceChildren();
    elements.eventsEmpty.hidden = visible.length > 0;
    elements.eventsTableWrap.hidden = visible.length === 0;
    if (!visible.length) {
      elements.eventsEmpty.innerHTML = `<strong>${events.length ? "No events match these filters." : "No event data available."}</strong>`;
    }

    visible.forEach((event) => {
      const registrations = registrationCount(event);
      const attendance = attendanceCount(event);
      const attendanceRate = event.summaryState === "completed" &&
        attendance !== null && registrations > 0
        ? `${((attendance / registrations) * 100).toFixed(1)}%`
        : "—";
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHTML(event.title || "Untitled Event")}</td>
        <td>${escapeHTML(eventDate(event) || "—")}</td>
        <td>${escapeHTML(event.venue || "—")}</td>
        <td>${registrations.toLocaleString()}</td>
        <td>${attendanceRate}</td>
        <td>${escapeHTML(String(event.summaryState || "unknown").replace(/_/g, " "))}</td>`;
      elements.eventsTableBody.appendChild(row);
    });
  }

  function renderVenueTable(events) {
    const stats = new Map();
    events.forEach((event) => {
      const venue = String(event.venue || "").trim();
      if (!venue) return;
      const value = stats.get(venue) || { events: 0, registrations: 0, capacity: 0 };
      value.events += 1;
      value.registrations += registrationCount(event);
      value.capacity += Number(event.capacity) > 0 ? Number(event.capacity) : 0;
      stats.set(venue, value);
    });

    const entries = [...stats.entries()].sort((left, right) =>
      right[1].events - left[1].events || left[0].localeCompare(right[0]));
    elements.venuesEmpty.hidden = entries.length > 0;
    elements.venuesTableWrap.hidden = entries.length === 0;
    elements.venuesTableBody.replaceChildren();
    entries.forEach(([venue, value]) => {
      const fillRate = value.capacity
        ? `${((value.registrations / value.capacity) * 100).toFixed(1)}%`
        : "—";
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${escapeHTML(venue)}</td>
        <td>${value.events.toLocaleString()}</td>
        <td>${value.registrations.toLocaleString()}</td>
        <td>${value.capacity ? value.capacity.toLocaleString() : "—"}</td>
        <td>${fillRate}</td>`;
      elements.venuesTableBody.appendChild(row);
    });
  }

  function renderSelectedParticipation(event) {
    if (!event) {
      elements.participationEmpty.hidden = false;
      elements.participationEmpty.textContent = currentEvents.length
        ? "No events match your search."
        : "No event data available.";
      elements.participationTitle.textContent = "No event selected";
      elements.participationMeta.textContent = "";
      elements.participationRegistered.textContent = "0";
      elements.participationAttended.textContent = "0";
      elements.participationCancelled.textContent = "0";
      elements.participationNoShows.textContent = "0";
      elements.participationRate.textContent = "—";
      return;
    }

    const registrations = registrationCount(event);
    const attendance = attendanceCount(event);
    elements.participationEmpty.hidden = true;
    elements.participationTitle.textContent = event.title || "Untitled Event";
    elements.participationMeta.textContent = [eventDate(event), event.venue].filter(Boolean).join(" · ") ||
      "No date or venue recorded";
    elements.participationRegistered.textContent = registrations.toLocaleString();
    elements.participationAttended.textContent = (attendance ?? 0).toLocaleString();
    elements.participationCancelled.textContent = Number(event.cancelledParticipantsCount || 0).toLocaleString();
    elements.participationNoShows.textContent = noShowCount(event).toLocaleString();
    elements.participationRate.textContent = attendance !== null && registrations > 0
      ? `${((attendance / registrations) * 100).toFixed(1)}%`
      : "—";
  }

  function renderParticipation(events) {
    const query = participationSearch.value.trim().toLowerCase();
    const matches = events.filter((event) => String(event.title || "").toLowerCase().includes(query));
    const previousSelection = participationSelect.value;
    participationSelect.replaceChildren();
    if (!matches.length) {
      participationSelect.add(new Option(events.length ? "No events match your search" : "No events available", ""));
      participationSelect.value = "";
      renderSelectedParticipation(null);
    } else {
      matches.forEach((event) => {
        const id = String(event.id || event.eventId || event.title);
        const date = eventDate(event);
        participationSelect.add(new Option(
          date ? `${event.title || "Untitled Event"} — ${date}` : event.title || "Untitled Event",
          id,
        ));
      });
      const selected = matches.find((event) =>
        String(event.id || event.eventId || event.title) === previousSelection) || matches[0];
      participationSelect.value = String(selected.id || selected.eventId || selected.title);
      renderSelectedParticipation(selected);
    }

    const topEvents = events
      .map((event) => ({ event, participants: registrationCount(event) }))
      .filter((entry) => entry.participants > 0)
      .sort((left, right) => right.participants - left.participants ||
        String(left.event.title || "").localeCompare(String(right.event.title || "")))
      .slice(0, 5);
    elements.mostParticipated.replaceChildren();
    elements.mostParticipatedEmpty.hidden = topEvents.length > 0;
    topEvents.forEach(({ event, participants }) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.className = "activity-most-participated-name";
      name.textContent = event.title || "Untitled Event";
      const count = document.createElement("span");
      count.className = "activity-most-participated-count";
      count.textContent = `${participants.toLocaleString()} participants`;
      item.append(name, count);
      elements.mostParticipated.appendChild(item);
    });
  }

  function renderSummary() {
    currentEvents = filteredEvents();
    const registrations = currentEvents.reduce((total, event) => total + registrationCount(event), 0);
    const venues = new Set(currentEvents.map((event) => String(event.venue || "").trim()).filter(Boolean));
    const completed = currentEvents.filter((event) => event.summaryState === "completed");
    const attendanceEvents = completed
      .map((event) => ({ event, attendance: attendanceCount(event) }))
      .filter((entry) => entry.attendance !== null);
    const attendanceRegistrations = attendanceEvents.reduce(
      (total, entry) => total + registrationCount(entry.event), 0);
    const attended = attendanceEvents.reduce((total, entry) => total + entry.attendance, 0);
    const capacityEvents = currentEvents.filter((event) => Number(event.capacity) > 0);
    const capacity = capacityEvents.reduce((total, event) => total + Number(event.capacity), 0);
    const capacityRegistrations = capacityEvents.reduce((total, event) => total + registrationCount(event), 0);
    const noShows = completed.reduce((total, event) => total + noShowCount(event), 0);

    elements.eventsMetric.textContent = currentEvents.length.toLocaleString();
    elements.registrationsMetric.textContent = registrations.toLocaleString();
    elements.attendanceMetric.textContent = attendanceRegistrations
      ? `${((attended / attendanceRegistrations) * 100).toFixed(1)}%`
      : "—";
    elements.venuesMetric.textContent = venues.size.toLocaleString();
    elements.fillMetric.textContent = capacity
      ? `${((capacityRegistrations / capacity) * 100).toFixed(1)}%`
      : "—";
    elements.noShowsMetric.textContent = noShows.toLocaleString();

    renderCharts(currentEvents);
    renderEventTable(currentEvents);
    renderVenueTable(currentEvents);
    renderParticipation(currentEvents);
  }

  function syncLegacyPagination() {
    if (!paginationSlot) return;
    const status = dataContainer.querySelector(".report-pagination-status");
    const button = [...dataContainer.querySelectorAll(".report-retry-btn")]
      .find((candidate) => /load more events/i.test(candidate.textContent));
    [status, button].filter(Boolean).forEach((control) => {
      if (control.parentElement !== paginationSlot) paginationSlot.appendChild(control);
    });
  }

  function exportCurrentEvents() {
    const rows = [
      ["Event", "Event date", "Venue", "Source", "Category", "Status", "Registrations", "Attended"],
      ...currentEvents.map((event) => [
        event.title || "Untitled Event",
        eventDate(event),
        event.venue || "",
        normalizedSource(event),
        event.category || event.eventType || "",
        String(event.summaryState || "unknown").replace(/_/g, " "),
        registrationCount(event),
        attendanceCount(event) ?? "",
      ]),
    ];
    const csv = rows.map((row) => row.map((value) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`,
    ).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `admin-activity-summary-${todayISO || "loaded-data"}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setActivityTab(tab) {
    const isEvents = tab === "events";
    const eventsTab = document.getElementById("activityEventsTab");
    const venuesTab = document.getElementById("activityVenuesTab");
    eventsTab.classList.toggle("is-active", isEvents);
    eventsTab.setAttribute("aria-selected", String(isEvents));
    venuesTab.classList.toggle("is-active", !isEvents);
    venuesTab.setAttribute("aria-selected", String(!isEvents));
    document.getElementById("activityEventsPanel").hidden = !isEvents;
    document.getElementById("activityVenuesPanel").hidden = isEvents;
  }

  [periodFilter, venueFilter, sourceFilter, categoryFilter, statusFilter].forEach((filter) => {
    filter.addEventListener("change", renderSummary);
  });
  eventSearch.addEventListener("input", () => renderEventTable(currentEvents));
  eventDateFilter.addEventListener("change", () => renderEventTable(currentEvents));
  participationSearch.addEventListener("input", () => renderParticipation(currentEvents));
  participationSelect.addEventListener("change", () => {
    const selected = currentEvents.find((event) =>
      String(event.id || event.eventId || event.title) === participationSelect.value);
    renderSelectedParticipation(selected || null);
  });
  document.querySelectorAll("[data-activity-tab]").forEach((button) => {
    button.addEventListener("click", () => setActivityTab(button.dataset.activityTab));
  });
  document.getElementById("activityRefreshButton").addEventListener("click", renderSummary);
  exportButton.addEventListener("click", exportCurrentEvents);

  if (legacyDownloadButton) {
    const exportAvailabilityObserver = new MutationObserver(() => {
      exportButton.disabled = legacyDownloadButton.disabled;
    });
    exportAvailabilityObserver.observe(legacyDownloadButton, {
      attributes: true,
      attributeFilter: ["disabled"],
    });
    exportButton.disabled = legacyDownloadButton.disabled;
  }

  dataContainer.addEventListener("admin-activity-summary-data", (event) => {
    allEvents = Array.isArray(event.detail?.events) ? event.detail.events : [];
    todayISO = String(event.detail?.today || "");
    const updatedLabel = String(event.detail?.lastUpdated || "");
    elements.lastUpdated.textContent = updatedLabel
      ? `Last updated ${updatedLabel}`
      : "Last updated —";
    updateVenueOptions();
    renderSummary();
    summaryError.hidden = true;
  });

  if (errorState && errorMessage) {
    const errorObserver = new MutationObserver(() => {
      if (errorState.hidden) return;
      summaryError.textContent = errorMessage.textContent;
      summaryError.hidden = false;
    });
    errorObserver.observe(errorState, { attributes: true, childList: true, subtree: true });
  }

  const paginationObserver = new MutationObserver(syncLegacyPagination);
  paginationObserver.observe(dataContainer, { childList: true, subtree: true });
  syncLegacyPagination();
})();
