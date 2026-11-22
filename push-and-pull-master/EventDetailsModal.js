(function () {
  "use strict";

  if (window.RecovibeEventDetails) return;

  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = new URL(
    "EventDetailsModal.css",
    document.currentScript.src,
  ).href;
  document.head.appendChild(stylesheet);

  const escapeHTML = (value) =>
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

  const asList = (value) => {
    if (value == null || value === "") return [];
    return (Array.isArray(value) ? value : [value]).filter(
      (item) => item != null && item !== "",
    );
  };

  const dateText = (value) => {
    if (!value) return "";
    const dateValue = value instanceof Date
      ? value
      : new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(dateValue.getTime())
      ? String(value)
      : `${String(dateValue.getMonth() + 1).padStart(2, "0")} / ${String(dateValue.getDate()).padStart(2, "0")} / ${dateValue.getFullYear()}`;
  };

  const safeHttpUrl = (value) => {
    try {
      const url = new URL(String(value));
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };

  const firstValue = (record, fields) => {
    for (const field of fields) {
      const value = record && record[field];
      if (value === undefined || value === null) continue;
      if (typeof value === "string" && !value.trim()) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (
        typeof value === "object" &&
        !Array.isArray(value) &&
        !(value instanceof Date) &&
        typeof value.toDate !== "function" &&
        Object.keys(value).length === 0
      ) continue;
      return value;
    }
    return "";
  };

  const eventText = (value) => {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.map(eventText).filter(Boolean).join(", ");
    if (value && typeof value === "object") {
      return eventText(firstValue(value, [
        "name", "fullName", "full_name", "displayName", "display_name",
        "facultyName", "adviserName", "advisorName", "title", "label", "text",
        "content", "description", "objective", "objectives", "rule", "rules",
        "message", "remark", "remarks", "note", "notes", "reminder",
        "reminders", "instruction", "items", "values", "value",
        "fileName", "filename", "id",
      ]));
    }
    return "";
  };

  const approvalReasonDetails = (event) => {
    const specificReasonFields = [
      "rejectionReason", "rejection_reason", "disapprovalReason",
      "disapproval_reason", "rejectReason", "reject_reason",
      "disapproveReason", "disapprove_reason", "statusReason",
      "status_reason", "reviewReason", "review_reason", "decisionReason",
      "decision_reason", "rejectionComments", "rejection_comments",
      "disapprovalNotes", "disapproval_notes", "reviewerNote",
      "reviewer_note", "reviewerRemarks", "reviewer_remarks",
      "reviewRemarks", "review_remarks", "reviewNote", "review_note",
      "approvalNote", "approval_note", "adminNote", "admin_note",
      "adminRemarks", "admin_remarks", "adminFeedback", "admin_feedback",
    ];
    const noteFields = [
      "note", "notes", "comment", "comments", "remarks", "feedback", "reason",
    ];
    const statusFields = [
      "status", "eventStatus", "event_status", "approvalStatus",
      "approval_status", "adminApprovalStatus", "reviewStatus",
      "review_status", "registrationStatus", "decision",
      "approvalDecision", "approval_decision", "reviewDecision",
      "review_decision",
    ];
    const reviewObjects = [event];
    const visited = new Set();
    const candidates = [];
    let rejected = false;
    while (reviewObjects.length) {
      const current = reviewObjects.pop();
      if (!current || typeof current !== "object" || visited.has(current)) continue;
      visited.add(current);
      const status = statusFields
        .map((field) => String(current[field] || ""))
        .map((value) => value.trim().toLowerCase().replace(/[\s_-]+/g, ""));
      const rejectedRecord = status.some((value) => /(reject|disapprov)/.test(value));
      if (rejectedRecord) rejected = true;
      const reason = eventText(firstValue(current, specificReasonFields));
      const note = eventText(firstValue(current, noteFields));
      const text = reason || note;
      if (text) {
        const stage = eventText(firstValue(current, [
          "stageLabel", "stageName", "stage", "stageKey", "approvalStage",
        ]));
        const reviewer = eventText(firstValue(current, [
          "reviewerName", "reviewedByName", "decidedByName", "actorName",
          "byName", "reviewer", "reviewedBy", "decidedBy", "actor",
        ]));
        const dateValue = firstValue(current, [
          "timestamp", "decidedAt", "reviewedAt", "updatedAt", "createdAt", "at",
        ]);
        let timestamp = 0;
        if (typeof dateValue?.toMillis === "function") timestamp = dateValue.toMillis();
        else if (typeof dateValue?.toDate === "function") timestamp = dateValue.toDate().getTime();
        else if (dateValue instanceof Date) timestamp = dateValue.getTime();
        else if (typeof dateValue === "number") timestamp = dateValue;
        else if (dateValue) timestamp = Date.parse(String(dateValue)) || 0;
        candidates.push({
          text,
          rejectedRecord,
          specific: Boolean(reason),
          isRoot: current === event,
          stage,
          reviewer,
          timestamp,
        });
      }
      Object.entries(current).forEach(([key, value]) => {
        if (!/approval|review|decision|moderation|stage|history/i.test(key)) return;
        if (Array.isArray(value)) {
          value.forEach((entry) => {
            if (entry && typeof entry === "object") reviewObjects.push(entry);
          });
        } else if (value && typeof value === "object") {
          reviewObjects.push(value);
        }
      });
    }
    const rejectedCandidates = candidates
      .filter((candidate) => candidate.rejectedRecord)
      .sort((left, right) =>
        Number(left.isRoot) - Number(right.isRoot) ||
        Number(right.specific) - Number(left.specific) ||
        right.timestamp - left.timestamp,
      );
    const reasonCandidate = rejectedCandidates[0] ||
      candidates.find((candidate) => candidate.isRoot && candidate.specific) ||
      candidates.find((candidate) => candidate.specific) ||
      candidates.sort((left, right) => right.timestamp - left.timestamp)[0];
    return {
      rejected,
      reason: reasonCandidate?.text || "",
      context: reasonCandidate
        ? [reasonCandidate.stage && `Stage: ${reasonCandidate.stage}`,
          reasonCandidate.reviewer && `Reviewer: ${reasonCandidate.reviewer}`]
          .filter(Boolean)
          .join(" · ")
        : "",
      show: rejected || Boolean(reasonCandidate),
    };
  };

  const formatEventTime = (value, event) => {
    if (typeof value === "function") {
      try {
        value = value(event);
      } catch {
        return "";
      }
    }
    if (value instanceof Date) {
      return Number.isNaN(value.getTime())
        ? ""
        : new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Manila",
            hour: "2-digit",
            minute: "2-digit",
          }).format(value);
    }
    if (value && typeof value === "object") {
      if (typeof value.toDate === "function") {
        try {
          return formatEventTime(value.toDate(), event);
        } catch {
          return "";
        }
      }
      const timestampSeconds = value.seconds ?? value._seconds;
      if (timestampSeconds != null && Number.isFinite(Number(timestampSeconds))) {
        return formatEventTime(Number(timestampSeconds) * 1000, event);
      }
      if (Number.isFinite(Number(value.hour))) {
        value = `${value.hour}:${String(value.minute || 0).padStart(2, "0")} ${value.period || value.meridiem || ""}`;
      } else {
        value = firstValue(value, [
          "time", "value", "timestamp", "dateTime", "date",
        ]);
      }
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value >= 1e11) return formatEventTime(new Date(value), event);
      if (value >= 1e9) return formatEventTime(new Date(value * 1000), event);
      if (value >= 0 && value < 24) {
        const hours = Math.floor(value);
        const minutes = Math.round((value - hours) * 60);
        return formatEventTime(`${hours}:${String(minutes).padStart(2, "0")}`, event);
      }
      if (Number.isInteger(value) && value >= 100 && value <= 2359) {
        return formatEventTime(
          `${Math.floor(value / 100)}:${String(value % 100).padStart(2, "0")}`,
          event,
        );
      }
      return "";
    }
    if (typeof value !== "string") return "";
    const text = value.trim();
    if (!text) return "";
    if (/^\d{10,13}$/.test(text)) {
      return formatEventTime(Number(text), event);
    }
    if (/^\d{3,4}$/.test(text)) {
      return formatEventTime(Number(text), event);
    }
    const clock = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(A\.?M\.?|P\.?M\.?)?$/i.exec(text);
    if (clock) {
      let hour = Number(clock[1]);
      const minute = Number(clock[2] || 0);
      const meridiem = clock[3]?.replace(/\./g, "").toUpperCase();
      if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) return "";
      if (meridiem) hour = (hour % 12) + (meridiem === "PM" ? 12 : 0);
      return `${String(hour % 12 || 12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
    }
    if (/^\d{4}-\d{2}-\d{2}[T ]/.test(text)) {
      const date = new Date(text);
      return Number.isNaN(date.getTime()) ? "" : formatEventTime(date, event);
    }
    return "";
  };

  const startTimeFields = [
    "timeStart", "time_start", "timeStartAt", "startTime", "start_time",
    "eventTimeStart", "eventStartTime", "event_time_start", "event_start_time",
    "startAt", "start_at", "eventStartAt",
    "event_start_at", "eventTimeStartAt", "startDateTime", "startDateAndTime",
    "eventStartDateTime", "startTimestamp", "timestampStart",
    "eventStartTimestamp", "eventTimestampStart", "eventStart", "start",
  ];
  const endTimeFields = [
    "timeEnd", "time_end", "timeEndAt", "endTime", "end_time",
    "eventTimeEnd", "eventEndTime", "event_time_end", "event_end_time",
    "endAt", "end_at", "eventEndAt", "event_end_at", "eventTimeEndAt",
    "endDateTime", "endDateAndTime", "eventEndDateTime", "endTimestamp",
    "timestampEnd", "eventEndTimestamp", "eventTimestampEnd", "eventEnd", "end",
  ];
  const eventTimeFrom = (record, fields) => {
    for (const field of fields) {
      const formatted = formatEventTime(record && record[field], record);
      if (formatted) return formatted;
    }
    return "";
  };
  const eventTimeRange = (event) => {
    const ranges = [
      event && event.time,
      event && event.timeRange,
      event && event.eventTime,
      event && event.eventTimeRange,
    ];
    for (const range of ranges) {
      const rangeStart = range && typeof range === "object"
        ? firstValue(range, ["start", "timeStart", "startTime"])
        : "";
      const rangeEnd = range && typeof range === "object"
        ? firstValue(range, ["end", "timeEnd", "endTime"])
        : "";
      if (rangeStart || rangeEnd) {
        const start = formatEventTime(rangeStart, event);
        const end = formatEventTime(rangeEnd, event);
        if (start || end) return [start, end];
      }
      if (typeof range !== "string") continue;
      const parts = range.split(/\s*(?:[-–—]|\bto\b)\s*/i);
      if (parts.length === 2) {
        const start = formatEventTime(parts[0], event);
        const end = formatEventTime(parts[1], event);
        if (start || end) return [start, end];
      }
    }
    return ["", ""];
  };
  const getEventTimes = (event) => {
    const [rangeStart, rangeEnd] = eventTimeRange(event);
    const firstSchedule = Array.isArray(event && event.dailySchedules)
      ? event.dailySchedules[0]
      : null;
    return [
      eventTimeFrom(event, startTimeFields) ||
        eventTimeFrom(firstSchedule, startTimeFields) || rangeStart,
      eventTimeFrom(event, endTimeFields) ||
        eventTimeFrom(firstSchedule, endTimeFields) || rangeEnd,
    ];
  };

  const listMarkup = (items) => {
    const values = normalizeList(items)
      .map(eventText)
      .filter(Boolean);
    return `<ul class="student-event-list">${(values.length ? values : ["N/A"])
      .map((item) => `<li>${escapeHTML(item)}</li>`)
      .join("")}</ul>`;
  };

  const documentMarkup = (items, redirect = true) => items.map((item) => {
    const rawUrl = typeof item === "string"
      ? item
      : firstValue(item, [
          "url", "href", "downloadURL", "downloadUrl", "fileUrl", "fileURL",
        "file_url", "documentUrl", "documentURL", "document_url",
        "documentLink", "document_link", "participantDocumentUrl",
        "participant_document_url", "participantDocumentLink",
        "webViewLink", "web_view_link", "link", "googleDriveUrl",
        "google_drive_url", "googleDriveLink", "google_drive_link",
        ]);
    const href = safeHttpUrl(rawUrl);
    const name = eventText(firstValue(item, [
      "name", "title", "fileName", "filename", "documentName",
    ])) || (href ? "Participant document" : eventText(item));
    if (!name) return "";
    const icon =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.5v10m0 0 3.5-3.5M10 12.5 6.5 9M3.5 13.5v3h13v-3"/></svg>';
    const link = href
      ? redirect
        ? `<a class="student-event-document-link" href="${escapeHTML(href)}" target="_blank" rel="noopener noreferrer" aria-label="Open ${escapeHTML(name)}">Open Link</a>`
        : `<a href="${escapeHTML(href)}" download="${escapeHTML(name)}" aria-label="Download ${escapeHTML(name)}" title="Download ${escapeHTML(name)}">${icon}</a>`
      : '<span class="student-event-document-unavailable" aria-disabled="true">Link unavailable</span>';
    return `<div class="student-event-attachment"><span>${escapeHTML(name)}</span>${link}</div>`;
  }).join("");

  const categoryTone = (value) => {
    const category = String(value || "").toLowerCase();
    if (/social|arts|culture/.test(category)) return "purple";
    if (/university|campus|community/.test(category)) return "green";
    if (/academic|tech|innovation/.test(category)) return "blue";
    if (/sport|fitness/.test(category)) return "orange";
    return "maroon";
  };

  function normalizeList(value) {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((item) => {
      if (typeof item === "string")
        return item
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
      return item == null ? [] : [item];
    });
  }

  function getRequirements(event) {
    const requirements = event.requirements;
    if (Array.isArray(requirements) || typeof requirements === "string") {
      return normalizeList(requirements);
    }
    if (requirements && typeof requirements === "object") {
      return [
        ...normalizeList(requirements.required),
        ...normalizeList(requirements.recommended),
      ];
    }
    return normalizeList(event.requiredDocuments || event.requirementsList);
  }

  function createModal() {
    const overlay = document.createElement("div");
    overlay.className = "event-details-overlay student-event-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML = `
      <section class="event-details-dialog student-event-dialog" role="dialog" aria-modal="true" aria-labelledby="sharedEventDetailsTitle" tabindex="-1">
        <header class="student-event-shell-header">
          <button class="student-event-close event-details-close" type="button" aria-label="Close event details">&times;</button>
          <div class="student-event-top" data-field="header"></div>
        </header>
        <div class="student-event-content">
          <div class="student-event-detail-content" data-field="content"></div>
        </div>
        <footer class="student-event-footer event-details-footer"><p class="student-event-notice" role="status"></p><button type="button" class="student-event-action event-details-action"></button></footer>
      </section>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  let overlay;
  let previousFocus;
  let savedScrollY = 0;
  let savedBodyStyles;

  function getOverlay() {
    if (!overlay) overlay = createModal();
    return overlay;
  }

  function isHoliday(event) {
    if (!event) return true;
    const id = String(event.id || event.eventId || "");
    const src = String(
      event.source || event.eventSource || event.organizerName || "",
    ).toLowerCase();
    const cat = String(event.category || "").toLowerCase();
    const title = String(event.title || event.name || "").toLowerCase();
    return (
      event.isHoliday === true ||
      id.startsWith("holiday:") ||
      src.includes("holiday") ||
      cat.includes("holiday") ||
      title.includes("philippine holiday") ||
      title.includes("holiday")
    );
  }

  function render(event, options = {}) {
    if (!event || isHoliday(event)) return;
    const source = [
      event.source || event.eventSource || event.campus || event.office,
      event.sourceOther,
    ].filter(Boolean).join(" · ") || "N/A";
    const organizer =
      event.organizerName || event.organizer || event.organization || "N/A";
    const categories = normalizeList(event.categories || event.category || event.tag);
    const categoryNames = categories.map((item) =>
      typeof item === "object" ? item.name || item.title || item.label || "" : item,
    ).filter(Boolean);
    const badgeList = categoryNames.length ? categoryNames : ["General"];
    const targetAudience = normalizeList(event.targetAudience || event.targetYear)
      .map((item) => typeof item === "object" ? item.name || item.title || item.label || "" : item)
      .filter(Boolean)
      .join(", ") || "Open to All";
    const attendanceRequired =
      typeof event.attendanceRequired === "boolean"
        ? event.attendanceRequired ? "Required" : "Not Required"
        : event.attendanceRequired || "N/A";
    const dateStart = event.dateStart || event.dateISO || event.date;
    const dateEnd = event.dateEnd || event.endDate || event.eventEndDate || dateStart;
    const timeText = (value) => formatEventTime(value, event) || "N/A";
    const [eventStartTime, eventEndTime] = getEventTimes(event);
    const dailySchedules = Array.isArray(event.dailySchedules)
      ? event.dailySchedules
      : [];
    const differentTimesByDay =
      dailySchedules.length > 0 &&
      (/different\s+time/i.test(String(event.dailySchedule || "")) ||
        dailySchedules.length > 1);
    const scheduleRows = dailySchedules
      .map((schedule, index) => {
        const scheduleDate = schedule.date || schedule.dateISO || "";
        const scheduleLabel =
          schedule.label ||
          (index === 0
            ? "First Day"
            : index === dailySchedules.length - 1
              ? "Last Day"
              : `Day ${index + 1}`);
        return `<div class="student-event-daily-row"><strong>${escapeHTML(scheduleLabel)}</strong><span>${escapeHTML(dateText(scheduleDate) || "N/A")}</span><strong>Time Start</strong><span>${escapeHTML(eventTimeFrom(schedule, startTimeFields) || "N/A")}</span><strong>Time End</strong><span>${escapeHTML(eventTimeFrom(schedule, endTimeFields) || "N/A")}</span></div>`;
      })
      .join("");
    const dateTimeText = (value) => {
      if (!value) return "N/A";
      const [date, time] = String(value).split(/[T ]/, 2);
      return `${dateText(date) || "N/A"}${time ? ` · ${timeText(time) !== "N/A" ? timeText(time) : timeText(value)}` : ""}`;
    };
    const venue = [
      event.venue || event.location || event.venueOther || event.venueName,
      event.room || event.roomNumber,
    ].filter(Boolean).join(" · ") || "N/A";
    const venueType = event.venueType || event.weatherContingency || "N/A";
    const rawCapacity =
      event.capacity ?? event.maxCapacity ?? event.maxSlots ?? event.slots;
    const parsedCapacity = rawCapacity == null || rawCapacity === ""
      ? NaN
      : Number(rawCapacity);
    const capacityKnown =
      Number.isFinite(parsedCapacity) && parsedCapacity >= 0;
    const capacity = capacityKnown ? Math.floor(parsedCapacity) : null;
    const noCapacityLimit =
      capacity == null && event.capacityMode === "N/A";
    const registeredCount = Math.max(
      0,
      Math.floor(Number(event.registeredCount) || 0),
    );
    const slotsLeft =
      capacity == null
        ? Infinity
        : Math.max(0, Math.min(capacity, capacity - registeredCount));
    const openSlots = slotsLeft;
    const expectedParticipants =
      event.expectedParticipants ?? event.registeredCount ??
      (!capacityKnown ? "N/A" : Math.max(0, Number(capacity) - Number(slotsLeft || 0)));
    const descriptionValue = firstValue(event, [
      "description", "descriptionText", "description_text",
      "eventDescription", "eventDescriptionText", "event_description",
      "desc", "about",
      "eventDetails", "eventSummary",
    ]);
    const description = (Array.isArray(descriptionValue)
      ? descriptionValue
      : [descriptionValue])
      .flatMap((item) => eventText(item).split(/\n\s*\n/))
      .map((item) => item.trim())
      .filter(Boolean);
    const requirements = getRequirements(event);
    const rules = [
      ...asList(firstValue(event, [
        "participationRules", "participation_rules", "participationGuidelines",
        "participation_guidelines", "rules", "eventRules", "event_rules",
        "rulesAndReminders", "rules_and_reminders", "rulesReminders",
        "rules_reminders", "remindersAndRules", "reminders_and_rules",
        "rulesAndRegulations", "guidelines",
      ])),
      ...asList(firstValue(event, [
        "reminders", "reminder", "eventReminders",
      ])),
      ...requirements,
    ];
    const approvalReason = approvalReasonDetails(event);
    const approvalReasonMarkup = approvalReason.show
      ? `<aside class="student-event-rejection-reason" role="note"><strong>Disapproval / rejection reason</strong>${approvalReason.context ? `<span>${escapeHTML(approvalReason.context)}</span>` : ""}<p>${escapeHTML(approvalReason.reason || "No disapproval reason was provided.")}</p></aside>`
      : "";
    const objectives = firstValue(event, [
      "objectives", "objective", "eventObjectives", "event_objectives",
      "objectivesList", "learningObjectives", "learning_objectives",
      "keyDetails", "key_details", "detailedInfo", "detailed_info",
      "focusAreas", "focus_areas", "expectedOutcomes", "expected_outcomes",
      "outcomes", "goals",
    ]);
    const participantDocuments = asList(
      firstValue(event, [
        "participantDocuments", "participant_documents", "participantDocs",
        "participant_docs", "participantDocumentUrls", "participant_document_urls",
        "participantDocumentUrl", "participant_document_url", "participantDocLinks",
        "participantDocsLink", "participantDocumentLinks",
        "participantDocumentLink", "participant_document_link", "participantFiles",
        "registrationDocuments", "registration_documents",
        "registrationDocumentLinks", "registrationDocLinks", "attachments",
      ]),
    );
    const approvalDocuments = options.showApprovalDocuments
      ? asList(
          event.approvalDocuments ||
            event.approvalDocs ||
            event.organizerDocuments,
        )
      : [];
    const contactInfo =
      event.contactPerson && typeof event.contactPerson === "object"
        ? event.contactPerson
        : {};
    const contactParts = (typeof event.contactPerson === "string"
      ? event.contactPerson
      : event.contactName || ""
    ).split(/[\n,|]+/).map((item) => item.trim()).filter(Boolean);
    const contactEmail =
      contactInfo.email ||
      event.contactEmail ||
      contactParts.find((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)) ||
      "";
    const contactPhone =
      contactInfo.phone ||
      event.contactPhone ||
      contactParts.find((item) => /\+?[\d() -]{7,}/.test(item) && /\d{7}/.test(item)) ||
      "";
    const contactName =
      contactInfo.name ||
      event.contactName ||
      contactParts.find((item) => item !== contactEmail && item !== contactPhone) ||
      event.organizerName ||
      "";
    const facultyInChargeValue = firstValue(event, [
      "facultyInCharge", "faculty_in_charge", "facultyInChargeName",
      "faculty_in_charge_name", "facultyName", "faculty_name", "faculty",
      "adviserName", "adviser_name", "advisorName", "advisor_name",
      "adviser", "advisor", "facultyAdvisor", "faculty_advisor",
      "facultyAdviser", "faculty_adviser", "facultyAdvisorName",
      "faculty_advisor_name", "teacherInCharge", "teacher_in_charge",
      "assignedFaculty", "assigned_faculty",
    ]) || firstValue(contactInfo, [
      "facultyInCharge", "faculty_in_charge", "facultyAdviser",
      "facultyAdvisor", "adviserName", "advisorName", "facultyName",
    ]) || firstValue(event.approval, [
      "facultyInCharge", "faculty_in_charge", "facultyAdviser",
      "facultyAdvisor", "adviserName", "advisorName", "facultyName",
    ]);
    const facultyInChargeName = eventText(facultyInChargeValue) ||
      eventText(firstValue(event, [
        "facultyInChargeId", "faculty_in_charge_id", "facultyId",
        "faculty_id", "adviserId", "adviser_id", "advisorId", "advisor_id",
      ]));
    const bannerUrl =
      typeof event.bannerImage === "string" &&
      /^data:image\/(?:png|jpeg|webp);base64,/i.test(event.bannerImage)
        ? event.bannerImage
        : safeHttpUrl(event.bannerImage || event.bannerUrl);
    const modal = getOverlay();
    const header = modal.querySelector('[data-field="header"]');
    const title = event.title || event.eventName || "Untitled event";
    header.innerHTML = `
      <div class="student-event-heading">
        <h2 class="student-event-title" id="sharedEventDetailsTitle">${escapeHTML(title)}</h2>
        <p><strong>Event Organizer:</strong> ${escapeHTML(organizer)}</p>
        <p><strong>Event Source:</strong> ${escapeHTML(source)}</p>
      </div>
      <div class="student-event-header-meta">
        <div><strong>Categories:</strong><div class="student-event-categories" title="${escapeHTML(badgeList.join(", "))}">${badgeList.map((category) => `<span class="student-event-pill student-event-pill--${categoryTone(category)}" title="${escapeHTML(category)}">${escapeHTML(category)}</span>`).join("")}</div></div>
        <p><strong>Target Audience:</strong> ${escapeHTML(targetAudience)}</p>
        <p><strong>Attendance:</strong> ${escapeHTML(attendanceRequired)}</p>
      </div>`;
    const infoCard = (label, value) =>
      `<div class="student-event-info-card"><strong>${escapeHTML(label)}</strong><span>${escapeHTML(value || "N/A")}</span></div>`;
    const registrationEnd = event.registrationEnd || event.registrationDeadline;
    const platformUrl = safeHttpUrl(event.platformLink);
    const detailContent = [
      `<section class="student-event-info" aria-label="Event schedule and capacity">
        ${infoCard("Date Start", dateText(dateStart) || "N/A")}
        ${infoCard("Date End", dateText(dateEnd) || "N/A")}
        ${infoCard("Time Start", differentTimesByDay ? "See daily schedule" : eventStartTime || "N/A")}
        ${infoCard("Time End", differentTimesByDay ? "See daily schedule" : eventEndTime || "N/A")}
        ${infoCard("Venue", venue)}
        ${infoCard("Venue Type", venueType)}
        ${infoCard("Max Capacity", noCapacityLimit ? "No limit" : capacityKnown ? `${capacity} People` : "N/A")}
        ${infoCard("Expected Participants", String(expectedParticipants))}
        ${infoCard("Slots Left", noCapacityLimit ? "Open registration" : capacityKnown ? `${slotsLeft ?? Math.max(0, Number(capacity) - Number(event.registeredCount || 0))} of ${capacity}` : "N/A")}
      </section>`,
      `<section class="student-event-section student-event-registration">
        <h3>Registration Information</h3>
        <div class="student-event-registration-grid">
          <p><strong>Registration Start:</strong> ${escapeHTML(dateTimeText(event.registrationStart) || "N/A")}</p>
          <p><strong>Registration End:</strong> ${escapeHTML(dateTimeText(registrationEnd) || "N/A")}</p>
        </div>
      </section>`,
      differentTimesByDay
        ? `<section class="student-event-section student-event-daily-schedule"><h3>Different Time Per Day</h3><div>${scheduleRows}</div></section>`
        : "",
      platformUrl
        ? `<section class="student-event-section"><h3>Event Platform</h3><p><a href="${escapeHTML(platformUrl)}" target="_blank" rel="noopener noreferrer">Join event online</a></p></section>`
        : "",
      `<section class="student-event-section student-event-description"><h3>Event Description</h3>${bannerUrl ? `<img class="event-details-banner student-event-banner" src="${escapeHTML(bannerUrl)}" alt="${escapeHTML(event.bannerFileName || title)}">` : ""}${description.map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join("")}</section>`,
      `<section class="student-event-section"><h3>Rationale</h3><p>${escapeHTML(eventText(firstValue(event, [
        "rationale", "rationaleText", "rationale_text", "eventRationale",
        "event_rationale", "justification", "eventJustification",
        "event_justification", "background", "eventBackground",
        "event_background", "reason",
      ])) || "N/A")}</p></section>`,
      `<section class="student-event-section"><h3>Objectives</h3>${listMarkup(asList(objectives).length ? asList(objectives) : ["N/A"])}</section>`,
      `<section class="student-event-section"><h3>Rules &amp; Reminders</h3>${listMarkup(rules.length ? rules : ["N/A"])}</section>`,
      approvalReasonMarkup,
      `<div class="student-event-bottom-grid">
        <section class="student-event-section student-event-contact"><h3>Contact Person</h3><p><strong>Name:</strong> ${escapeHTML(contactName || "N/A")}</p><p><strong>Email:</strong> ${contactEmail ? `<a href="mailto:${escapeHTML(contactEmail)}">${escapeHTML(contactEmail)}</a>` : "N/A"}</p><p><strong>Number:</strong> ${escapeHTML(contactPhone || "N/A")}</p><p><strong>Faculty In Charge:</strong> ${escapeHTML(facultyInChargeName || "N/A")}</p></section>
        <section class="student-event-section student-event-documents"><h3>Participant Documents</h3><p>Open the participant document links in a new tab.</p><div class="student-event-attachments">${participantDocuments.length ? documentMarkup(participantDocuments) : '<p class="student-event-no-documents">No files attached.</p>'}</div><small>(Make sure to download and fill up these files. Its needed for participation)</small>${approvalDocuments.length ? `<div class="student-event-approval-documents"><p><strong>Approval Documents</strong></p><div class="student-event-attachments">${documentMarkup(approvalDocuments)}</div></div>` : ""}</section>
      </div>`,
    ].join("");
    modal.querySelector('[data-field="content"]').innerHTML = detailContent;

    const action = modal.querySelector(".event-details-action");
    action.textContent = options.actionLabel || "Continue";
    action.disabled =
      typeof options.onAction !== "function" || Boolean(options.actionDisabled);
    modal.querySelector(".student-event-notice").textContent =
      event.registrationStatus || event.status || "Registration status: N/A";
    action.onclick =
      typeof options.onAction === "function"
        ? () => {
            const response = options.onAction(event);
            if (typeof response === "string") action.textContent = response;
          }
        : null;

    previousFocus = document.activeElement;
    savedScrollY = window.scrollY;
    const pageWidth = document.documentElement.clientWidth;
    savedBodyStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    document.body.classList.add("event-details-page-locked");
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.width = `${pageWidth}px`;
    document.body.style.overflow = "hidden";
    modal.setAttribute("aria-hidden", "false");
    void modal.offsetWidth;
    modal.classList.add("is-open");
    modal.querySelector(".event-details-close").focus();
  }

  function close() {
    if (!overlay || overlay.getAttribute("aria-hidden") === "true") return;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("event-details-page-locked");
    document.body.style.position = savedBodyStyles.position;
    document.body.style.top = savedBodyStyles.top;
    document.body.style.width = savedBodyStyles.width;
    document.body.style.overflow = savedBodyStyles.overflow;
    window.scrollTo(0, savedScrollY);
    if (previousFocus && typeof previousFocus.focus === "function")
      previousFocus.focus();
  }

  document.addEventListener("click", (event) => {
    if (!overlay || overlay.getAttribute("aria-hidden") === "true") return;
    if (
      event.target.closest(".event-details-close") ||
      event.target === overlay
    )
      close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  window.RecovibeEventDetails = { open: render, close };

  function createStudentRegistrationModal() {
    const detailOverlay = document.createElement("div");
    detailOverlay.className = "student-event-overlay";
    detailOverlay.setAttribute("aria-hidden", "true");
    detailOverlay.innerHTML = `
      <section class="student-event-dialog" id="studentEventDetailsDialog" role="dialog" aria-modal="true" aria-labelledby="studentEventTitle" tabindex="-1">
        <header class="student-event-shell-header">
          <button class="student-event-close" type="button" aria-label="Close event details">&times;</button>
          <div class="student-event-top"></div>
        </header>
        <div class="student-event-content"><div class="student-event-detail-content"></div></div>
        <footer class="student-event-footer event-details-footer"><p class="student-event-notice" role="status"></p><button class="student-event-action event-details-action" type="button"></button></footer>
      </section>`;

    const confirmOverlay = document.createElement("div");
    confirmOverlay.className =
      "student-event-overlay student-event-confirm-overlay";
    confirmOverlay.setAttribute("aria-hidden", "true");
    confirmOverlay.innerHTML = `
      <section class="student-event-confirm" role="dialog" aria-modal="true" aria-labelledby="studentEventConfirmTitle" tabindex="-1">
        <h2 id="studentEventConfirmTitle"></h2><p class="student-event-confirm-message"></p>
        <p class="student-event-error" role="alert"></p>
        <div class="student-event-confirm-actions"><button class="student-event-confirm-primary" type="button"></button><button class="student-event-confirm-cancel" type="button"></button></div>
      </section>`;
    document.body.append(detailOverlay, confirmOverlay);

    const detailDialog = detailOverlay.querySelector('[role="dialog"]');
    const confirmDialog = confirmOverlay.querySelector('[role="dialog"]');
    const detailContent = detailOverlay.querySelector(".student-event-detail-content");
    const detailHeader = detailOverlay.querySelector(".student-event-top");
    const actionButton = detailOverlay.querySelector(".student-event-action");
    const primaryButton = confirmOverlay.querySelector(
      ".student-event-confirm-primary",
    );
    const cancelButton = confirmOverlay.querySelector(
      ".student-event-confirm-cancel",
    );
    const titleElement = confirmOverlay.querySelector(
      "#studentEventConfirmTitle",
    );
    const messageElement = confirmOverlay.querySelector(
      ".student-event-confirm-message",
    );
    const errorElement = confirmOverlay.querySelector(".student-event-error");
    const noticeElement = detailOverlay.querySelector(".student-event-notice");
    const participationKey = "recovibeParticipations";
    const slotsKey = "recovibeEventSlots";
    let selectedEvent = null;
    let selectedAction = "join";
    let pending = false;
    let dashboardRegistrationConfirmation = false;
    let previousFocus = null;
    let bodyOverflow = "";

    const readObject = (key) => {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "{}");
        return value && typeof value === "object" && !Array.isArray(value)
          ? value
          : {};
      } catch (error) {
        return {};
      }
    };
    const readIds = () => {
      try {
        const value = JSON.parse(
          localStorage.getItem(participationKey) || "[]",
        );
        return new Set(Array.isArray(value) ? value.map(String) : []);
      } catch (error) {
        return new Set();
      }
    };
    const capacity = (event) =>
      event.capacityMode === "N/A"
        ? null
        : Math.max(
            0,
            Math.floor(
              Number(
                event.capacity ??
                  event.maxCapacity ??
                  event.maxSlots ??
                  event.slots ??
                  0,
              ) || 0,
            ),
          );
    const openSlots = (event) => {
      if (event.capacityMode === "N/A") return Infinity;
      const eventCapacity = capacity(event);
      const registeredCount = Math.max(
        0,
        Math.floor(Number(event.registeredCount) || 0),
      );
      return Math.max(
        0,
        Math.min(eventCapacity, eventCapacity - registeredCount),
      );
    };
    const categoryTone = (value) => {
      const category = String(value || "").toLowerCase();
      if (/leadership|career/.test(category)) return "maroon";
      if (/academic|university/.test(category)) return "blue";
      if (/tech|innovation|org|seminar/.test(category)) return "purple";
      if (/sport|fitness|community/.test(category)) return "green";
      if (/social|art|culture|music|competition/.test(category)) return "orange";
      return "maroon";
    };
    const displayText = (value, fallback = "N/A", event = selectedEvent) => {
      let result = value;
      if (typeof result === "function") {
        try {
          result = result(event);
        } catch (error) {
          return fallback;
        }
      }
      if (typeof result === "string") {
        const normalized = result.trim();
        return !normalized ||
          /^(?:undefined|null|nan|infinity|\[object object\])$/i.test(normalized) ||
          /^(?:async\s+)?function\b|^(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(normalized)
          ? fallback
          : normalized;
      }
      if (typeof result === "number") return Number.isFinite(result) ? String(result) : fallback;
      if (typeof result === "boolean") return result ? "Yes" : "No";
      if (result && typeof result === "object") {
        const label = firstValue(result, [
          "name", "title", "label", "text", "content", "description",
          "objective", "objectives", "rule", "rules", "reminder",
          "reminders", "instruction", "items", "values", "value",
          "fullName", "full_name", "displayName", "display_name",
          "facultyName", "adviserName", "advisorName",
          "filename", "fileName", "id",
        ]);
        return label === undefined ? fallback : displayText(label, fallback, event);
      }
      return fallback;
    };
    const text = (item) => displayText(item, "");
    const entries = (value) => {
      const values =
        value == null || value === ""
          ? []
          : Array.isArray(value)
            ? value
            : [value];
      return values.flatMap((item) =>
        typeof item === "string"
          ? item
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
          : item == null
            ? []
            : [item],
      );
    };
    const bullets = (value) => {
      const items = entries(value).map(text).filter(Boolean);
      return `<ul class="student-event-list">${(items.length ? items : ["N/A"])
        .map((item) => `<li>${escapeHTML(item)}</li>`)
        .join("")}</ul>`;
    };
    const dateText = (value) => {
      let dateValue = value;
      if (typeof dateValue === "function") {
        try {
          dateValue = dateValue(selectedEvent);
        } catch (error) {
          return "N/A";
        }
      }
      if (typeof dateValue?.toDate === "function") dateValue = dateValue.toDate();
      const date = dateValue instanceof Date
        ? dateValue
        : typeof dateValue === "number"
          ? new Date(dateValue)
          : typeof dateValue === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateValue)
            ? new Date(`${dateValue.slice(0, 10)}T00:00:00`)
            : null;
      return date && !Number.isNaN(date.getTime())
        ? `${String(date.getMonth() + 1).padStart(2, "0")} / ${String(date.getDate()).padStart(2, "0")} / ${date.getFullYear()}`
        : "N/A";
    };
    const dateTimeText = (value) => {
      if (!value) return "N/A";
      if (typeof value === "function") {
        try {
          value = value(selectedEvent);
        } catch (error) {
          return "N/A";
        }
      }
      if (value instanceof Date || typeof value?.toDate === "function") {
        const formattedTime = formatEventTime(value, selectedEvent);
        return `${dateText(value)}${formattedTime ? ` · ${formattedTime}` : ""}`;
      }
      const [date, time] = String(value).split(/[T ]/, 2);
      const formattedTime = time
        ? timeText(time) !== "N/A"
          ? timeText(time)
          : timeText(value)
        : "";
      const formattedDate = dateText(date);
      return formattedDate === "N/A"
        ? "N/A"
        : `${formattedDate}${formattedTime ? ` · ${formattedTime}` : ""}`;
    };
    const timeText = (value) =>
      formatEventTime(value, selectedEvent) || "N/A";
    const eventTimes = (event) =>
      getEventTimes(event).map((value) => value || "N/A");
    const minuteOfDay = (value) => {
      const twelve = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(value || ""));
      if (twelve)
        return (
          ((Number(twelve[1]) % 12) +
            (twelve[3].toUpperCase() === "PM" ? 12 : 0)) *
            60 +
          Number(twelve[2])
        );
      const twentyFour = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
      return twentyFour
        ? Number(twentyFour[1]) * 60 + Number(twentyFour[2])
        : null;
    };
    const hasStartedOrEnded = (event) => {
      const eventStartAt = Number(event.startAt);
      const eventEndAt = Number(event.endAt);
      if (Number.isFinite(eventStartAt) && eventStartAt > 0 && Date.now() >= eventStartAt)
        return true;
      if (Number.isFinite(eventEndAt) && eventEndAt > 0 && Date.now() >= eventEndAt)
        return true;
      const iso = String(event.dateISO || event.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
      const now = new Date();
      const dateParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(now);
      const part = (type) => dateParts.find((item) => item.type === type)?.value;
      const today = `${part("year")}-${part("month")}-${part("day")}`;
      if (iso < today) return true;
      if (iso > today) return false;
      const [start, end] = eventTimes(event);
      const timeParts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Manila",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(now);
      const current = Number(timeParts.find((item) => item.type === "hour")?.value) * 60 +
        Number(timeParts.find((item) => item.type === "minute")?.value);
      const startMinutes = minuteOfDay(start);
      const endMinutes = minuteOfDay(end);
      return (
        (startMinutes !== null && current >= startMinutes) ||
        (endMinutes !== null && current >= endMinutes)
      );
    };
    const blockReason = (event, action) => {
      if (action === "join") {
        try {
          const settings = JSON.parse(
            localStorage.getItem("recovibeSystemSettings") || "{}",
          );
          if (
            settings.eventRegistrationEnabled === false ||
            settings.registrationEnabled === false
          ) {
            return "Event registration is currently closed by the administrator.";
          }
        } catch (error) {
          console.warn("[StudentEventDetails] Could not read access settings:", {
            code: error?.code || "unknown",
            message: error?.message || String(error),
          });
        }
      }
      const registrationEnd = event.registrationEnd || event.registrationDeadline;
      const deadlineText = String(registrationEnd || "").trim();
      const deadlineAt = registrationEnd instanceof Date
        ? registrationEnd.getTime()
        : typeof registrationEnd?.toDate === "function"
          ? registrationEnd.toDate().getTime()
          : Number.isFinite(registrationEnd?.seconds)
            ? registrationEnd.seconds * 1000
            : typeof registrationEnd === "number"
              ? registrationEnd
              : deadlineText
                ? Date.parse(
                    /^\d{4}-\d{2}-\d{2}$/.test(deadlineText)
                      ? `${deadlineText}T23:59:59.999+08:00`
                      : /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(deadlineText)
                        ? `${deadlineText.replace(" ", "T")}+08:00`
                        : deadlineText,
                  )
                : NaN;
      const registrationClosed =
        event.registrationClosed === true ||
        event.registrationEnabled === false ||
        String(event.status || event.publicationStatus || "").trim().toLowerCase() === "closed" ||
        String(event.registrationStatus || "").trim().toLowerCase() === "closed";
      if (
        action === "join" &&
        readIds().has(String(event.id || event.eventId))
      ) return "You are already registered for this event.";
      const status = String(event.status || event.publicationStatus || "").toLowerCase();
      if (
        ["cancelled", "canceled", "completed"].includes(status) ||
        hasStartedOrEnded(event)
      )
        return "This event is no longer open for registration.";
      if (
        action === "join" &&
        (registrationClosed ||
          Number.isFinite(deadlineAt) && Date.now() > deadlineAt)
      )
        return "Registration Closed";
      if (action === "join" && openSlots(event) <= 0) return "Fully Booked";
      return "";
    };
    const registrationState = (event) => {
      if (readIds().has(String(event.id || event.eventId))) return "Registered";
      return blockReason(event, "join") || "Open";
    };
    function attachmentsMarkup(event) {
      const fileFields = [
        "participantDocuments", "participant_documents", "participantDocs",
        "participant_docs", "participantDocumentUrls", "participant_document_urls",
        "participantDocumentUrl", "participant_document_url", "participantDocLinks",
        "participantDocsLink", "participantDocumentLinks",
        "participantDocumentLink", "participant_document_link", "participantFiles",
        "registrationDocuments", "registration_documents",
        "registrationDocumentLinks", "registrationDocLinks", "attachments",
      ];
      const files = fileFields
        .map((field) => entries(event[field]))
        .find((items) => items.length) || [];
      return files.length
        ? documentMarkup(files)
        : '<p class="student-event-no-documents">No files attached.</p>';
    }

    function renderEvent(event) {
      const categories = entries(
        event.categories || event.category || event.tag,
      );
      const times = eventTimes(event);
      const total = event.maxCapacity ?? capacity(event);
      const savedCapacityValues = [
        event.maxCapacity,
        event.maxSlots,
        event.capacity,
        event.slots,
      ];
      const capacityKnown =
        total != null &&
        savedCapacityValues.some(
          (value) =>
            value != null &&
            String(value).trim() !== "" &&
            Number.isFinite(Number(value)) &&
            Number(value) >= 0,
        );
      const noCapacityLimit = total == null && event.capacityMode === "N/A";
      const available = openSlots(event);
      let availabilityValue = available;
      if (typeof availabilityValue === "function") {
        try {
          availabilityValue = availabilityValue(event);
        } catch (error) {
          availabilityValue = null;
        }
      }
      const availableNumber = typeof availabilityValue === "number"
        ? availabilityValue
        : typeof availabilityValue === "string" && availabilityValue.trim()
          ? Number(availabilityValue)
          : NaN;
      const totalNumber = Number(total);
      const displayedSlots = Number.isFinite(availableNumber)
        ? Math.max(0, Math.floor(availableNumber))
        : null;
      const participants =
        event.expectedParticipants ??
        event.registeredCount ??
        (!capacityKnown ? "N/A" : Math.max(0, total - available));
      const slotsLeft = displayedSlots;
      const dateStart = event.dateStart || event.dateISO || event.date;
      const dateEnd =
        event.dateEnd || event.endDate || event.eventEndDate || dateStart;
      const bannerUrl =
        typeof event.bannerImage === "string" &&
        /^data:image\/(?:png|jpeg|webp);base64,/i.test(event.bannerImage)
          ? event.bannerImage
          : safeHttpUrl(event.bannerImage || event.bannerUrl);
      const dailySchedules = Array.isArray(event.dailySchedules)
        ? event.dailySchedules
        : [];
      const differentTimesByDay =
        dailySchedules.length > 0 &&
        (/different\s+time/i.test(String(event.dailySchedule || "")) ||
          dailySchedules.length > 1);
      const venue =
        event.venue ||
        event.location ||
        event.venueOther ||
        event.venueName ||
        "N/A";
      const venueType =
        event.venueType || event.weatherContingency || "N/A";
      const source = [
        event.source || event.eventSource || event.campus || event.office,
        event.sourceOther,
      ]
        .filter((value) => value != null && value !== "")
        .map((value) => displayText(value, "", event))
        .filter(Boolean)
        .join(" · ") || "N/A";
      const targetAudienceValue =
        event.targetAudience || event.targetYear || "Open to All";
      const targetAudience = entries(targetAudienceValue)
        .map(text)
        .filter(Boolean)
        .join(", ") || "Open to All";
      const attendanceRequired =
        typeof event.attendanceRequired === "boolean"
          ? event.attendanceRequired
            ? "Required"
            : "Not Required"
          : displayText(event.attendanceRequired, "N/A", event);
      const descriptionValue = firstValue(event, [
        "description", "descriptionText", "description_text",
        "eventDescription", "eventDescriptionText", "event_description",
        "desc", "about",
        "eventDetails", "eventSummary",
      ]);
      const description = (Array.isArray(descriptionValue)
        ? descriptionValue
        : [descriptionValue])
        .flatMap((item) => displayText(item, "", event).split(/\n\s*\n/))
        .map((item) => item.trim())
        .filter(Boolean);
      const contactPerson = typeof event.contactPerson === "function"
        ? displayText(event.contactPerson, "", event)
        : event.contactPerson;
      const contactInfo =
        contactPerson && typeof contactPerson === "object"
          ? contactPerson
          : {};
      const contactParts = (typeof contactPerson === "string"
        ? contactPerson
        : displayText(event.contactName, "", event))
        .split(/[\n,|]+/)
        .map((item) => item.trim())
        .filter(Boolean);
      const email =
        contactInfo.email ||
        displayText(event.contactEmail, "", event) ||
        contactParts.find((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)) ||
        "";
      const phone =
        contactInfo.phone ||
        displayText(event.contactPhone, "", event) ||
        contactParts.find(
          (item) => /\+?[\d() -]{7,}/.test(item) && /\d{7}/.test(item),
        ) ||
        "";
      const person =
        contactInfo.name ||
        displayText(event.contactName, "", event) ||
        contactParts.find((item) => item !== email && item !== phone) ||
        event.organizerName ||
        "N/A";
      const facultyInChargeValue = firstValue(event, [
        "facultyInCharge", "faculty_in_charge", "facultyInChargeName",
        "faculty_in_charge_name", "facultyName", "faculty_name", "faculty",
        "adviserName", "adviser_name", "advisorName", "advisor_name",
        "adviser", "advisor", "facultyAdvisor", "faculty_advisor",
        "facultyAdviser", "faculty_adviser", "facultyAdvisorName",
        "faculty_advisor_name", "teacherInCharge", "teacher_in_charge",
        "assignedFaculty", "assigned_faculty",
      ]) || firstValue(contactInfo, [
        "facultyInCharge", "faculty_in_charge", "facultyAdviser",
        "facultyAdvisor", "adviserName", "advisorName", "facultyName",
      ]) || firstValue(event.approval, [
        "facultyInCharge", "faculty_in_charge", "facultyAdviser",
        "facultyAdvisor", "adviserName", "advisorName", "facultyName",
      ]);
      const facultyInChargeName = displayText(facultyInChargeValue, "", event) ||
        displayText(firstValue(event, [
          "facultyInChargeId", "faculty_in_charge_id", "facultyId",
          "faculty_id", "adviserId", "adviser_id", "advisorId", "advisor_id",
        ]), "", event);
      const badgeList = categories.length ? categories : ["General"];
      const objectives = firstValue(event, [
        "objectives", "objective", "eventObjectives", "event_objectives",
        "objectivesList", "learningObjectives", "learning_objectives",
        "keyDetails", "key_details", "detailedInfo", "detailed_info",
        "focusAreas", "focus_areas", "expectedOutcomes", "expected_outcomes",
        "outcomes", "goals",
      ]);
      const rules = [
        ...entries(firstValue(event, [
          "participationRules", "participation_rules", "participationGuidelines",
          "participation_guidelines", "rules", "eventRules", "event_rules",
          "rulesAndReminders", "rules_and_reminders", "rulesReminders",
          "rules_reminders", "remindersAndRules", "reminders_and_rules",
          "rulesAndRegulations", "guidelines",
        ])),
        ...entries(firstValue(event, [
          "reminders", "reminder", "eventReminders",
        ])),
        ...(event.requirements && typeof event.requirements === "object" && !Array.isArray(event.requirements)
          ? [
              ...entries(event.requirements.required),
              ...entries(event.requirements.recommended),
            ]
          : entries(event.requirements)),
      ];
      const approvalReason = approvalReasonDetails(event);
      const approvalReasonMarkup = approvalReason.show
        ? `<aside class="student-event-rejection-reason" role="note"><strong>Disapproval / rejection reason</strong>${approvalReason.context ? `<span>${escapeHTML(approvalReason.context)}</span>` : ""}<p>${escapeHTML(approvalReason.reason || "No disapproval reason was provided.")}</p></aside>`
        : "";
      const infoCard = (label, value, className = "") =>
        `<div class="student-event-info-card${className ? ` ${className}` : ""}"><strong>${escapeHTML(label)}</strong><span>${escapeHTML(displayText(value, "N/A", event))}</span></div>`;
      const scheduleRows = dailySchedules
        .map((schedule, index) => {
          const scheduleDate = schedule.date || schedule.dateISO || "";
          const scheduleLabel =
            schedule.label ||
            (index === 0
              ? "First Day"
              : index === dailySchedules.length - 1
                ? "Last Day"
                : `Day ${index + 1}`);
          return `<div class="student-event-daily-row"><strong>${escapeHTML(displayText(scheduleLabel, "N/A", event))}</strong><span>${escapeHTML(dateText(scheduleDate))}</span><strong>Time Start</strong><span>${escapeHTML(eventTimeFrom(schedule, startTimeFields) || "N/A")}</span><strong>Time End</strong><span>${escapeHTML(eventTimeFrom(schedule, endTimeFields) || "N/A")}</span></div>`;
        })
        .join("");
      detailHeader.innerHTML = `
        <div class="student-event-heading">
          <h2 class="student-event-title" id="studentEventTitle">${escapeHTML(displayText(event.title || event.eventName || "Untitled event", "Untitled event", event))}</h2>
          <p><strong>Event Organizer:</strong> ${escapeHTML(displayText(event.organizerName || event.organizer || event.organization || "N/A", "N/A", event))}</p>
          <p><strong>Event Source:</strong> ${escapeHTML(source)}</p>
        </div>
        <div class="student-event-header-meta">
          <div><strong>Categories:</strong><div class="student-event-categories" title="${escapeHTML(badgeList.map(text).join(", "))}">${badgeList.map((category) => `<span class="student-event-pill student-event-pill--${categoryTone(text(category))}" title="${escapeHTML(text(category))}">${escapeHTML(text(category))}</span>`).join("")}</div></div>
          <p><strong>Target Audience:</strong> ${escapeHTML(targetAudience)}</p>
          <p><strong>Attendance:</strong> ${escapeHTML(displayText(attendanceRequired, "N/A", event))}</p>
        </div>`;
      detailContent.innerHTML = `
        <section class="student-event-info" aria-label="Event schedule and capacity">
          ${infoCard("Date Start", dateText(dateStart))}
          ${infoCard("Date End", dateText(dateEnd))}
          ${infoCard("Time Start", differentTimesByDay ? "See daily schedule" : times[0])}
          ${infoCard("Time End", differentTimesByDay ? "See daily schedule" : times[1])}
          ${infoCard("Venue", [displayText(venue, "", event), displayText(event.room || event.roomNumber, "", event)].filter(Boolean).join(" · "))}
          ${infoCard("Venue Type", venueType)}
          ${infoCard("Max Capacity", noCapacityLimit ? "No limit" : capacityKnown && Number.isFinite(totalNumber) ? `${Math.max(0, Math.floor(totalNumber))} People` : "Not specified")}
          ${infoCard("Expected Participants", participants)}
          ${infoCard("Slots Left", noCapacityLimit ? "Unlimited" : capacityKnown && slotsLeft !== null && Number.isFinite(totalNumber) ? `${slotsLeft} of ${Math.max(0, Math.floor(totalNumber))}` : "Not specified")}
        </section>
        <section class="student-event-section student-event-registration">
          <h3>Registration Information</h3>
          <div class="student-event-registration-grid">
            <p><strong>Registration Start:</strong> ${escapeHTML(dateTimeText(event.registrationStart))}</p>
            <p><strong>Registration End:</strong> ${escapeHTML(dateTimeText(event.registrationEnd || event.registrationDeadline))}</p>
          </div>
        </section>
        ${differentTimesByDay ? `<section class="student-event-section student-event-daily-schedule"><h3>Different Time Per Day</h3><div>${scheduleRows}</div></section>` : ""}
        ${safeHttpUrl(event.platformLink) ? `<section class="student-event-section"><h3>Event Platform</h3><p><a href="${escapeHTML(safeHttpUrl(event.platformLink))}" target="_blank" rel="noopener noreferrer">Join event online</a></p></section>` : ""}
        <section class="student-event-section student-event-description"><h3>Event Description</h3>${bannerUrl ? `<img class="event-details-banner student-event-banner" src="${escapeHTML(bannerUrl)}" alt="${escapeHTML(displayText(event.bannerFileName || event.title || "Event banner", "Event banner", event))}">` : ""}${description.map((paragraph) => `<p>${escapeHTML(paragraph)}</p>`).join("")}</section>
        <section class="student-event-section"><h3>Rationale</h3><p>${escapeHTML(displayText(firstValue(event, [
          "rationale", "rationaleText", "rationale_text", "eventRationale",
          "event_rationale", "justification", "eventJustification",
          "event_justification", "background", "eventBackground",
          "event_background", "reason",
        ]), "N/A", event))}</p></section>
        <section class="student-event-section"><h3>Objectives</h3>${bullets(objectives)}</section>
        <section class="student-event-section"><h3>Rules &amp; Reminders</h3>${bullets(rules)}</section>
        ${approvalReasonMarkup}
        <div class="student-event-bottom-grid">
          <section class="student-event-section student-event-contact"><h3>Contact Person</h3><p><strong>Name:</strong> ${escapeHTML(displayText(person || "N/A", "N/A", event))}</p><p><strong>Email:</strong> ${email ? `<a href="mailto:${escapeHTML(displayText(email, "N/A", event))}">${escapeHTML(displayText(email, "N/A", event))}</a>` : "N/A"}</p><p><strong>Number:</strong> ${escapeHTML(displayText(phone || "N/A", "N/A", event))}</p><p><strong>Faculty In Charge:</strong> ${escapeHTML(displayText(facultyInChargeName || "N/A", "N/A", event))}</p></section>
          <section class="student-event-section student-event-documents"><h3>Participant Documents</h3><p>Open the participant document links in a new tab.</p><div class="student-event-attachments">${attachmentsMarkup(event)}</div><small>(Make sure to download and fill up these files. Its needed for participation)</small></section>
        </div>`;
    }

    function updateAction() {
      const registered = readIds().has(
        String(selectedEvent && (selectedEvent.id || selectedEvent.eventId)),
      );
      selectedAction = registered ? "cancel" : "join";
      const reason = blockReason(selectedEvent, selectedAction);
      const state = registrationState(selectedEvent);
      actionButton.textContent = pending
        ? "Processing..."
        : registered
          ? "Cancel Participation"
          : reason || "Register";
      actionButton.classList.toggle("is-cancel", registered);
      actionButton.disabled = pending || Boolean(reason);
      actionButton.title = reason;
      actionButton.setAttribute(
        "aria-label",
        reason
          ? `${actionButton.textContent}. ${reason}`
          : actionButton.textContent,
      );
      noticeElement.textContent = state;
    }

    const handleAccessSettingsChanged = () => {
      if (!selectedEvent) return;
      renderEvent(selectedEvent);
      updateAction();
    };
    window.addEventListener(
      "system-access-settings-changed",
      handleAccessSettingsChanged,
    );
    window.addEventListener("pagehide", () => {
      window.removeEventListener(
        "system-access-settings-changed",
        handleAccessSettingsChanged,
      );
    }, { once: true });

    function closeConfirmation(restore = true) {
      confirmOverlay.classList.remove("is-open");
      confirmOverlay.setAttribute("aria-hidden", "true");
      errorElement.textContent = "";
      if (restore && detailOverlay.classList.contains("is-open"))
        actionButton.focus();
    }

    function closeDetails() {
      closeConfirmation(false);
      detailOverlay.classList.remove("is-open");
      detailOverlay.setAttribute("aria-hidden", "true");
      document.body.style.overflow = bodyOverflow;
      if (previousFocus && typeof previousFocus.focus === "function")
        previousFocus.focus();
      selectedEvent = null;
      dashboardRegistrationConfirmation = false;
    }

    function openConfirmation() {
      if (!selectedEvent || pending) return;
      updateAction();
      if (actionButton.disabled) return;
      selectedAction = readIds().has(
        String(selectedEvent.id || selectedEvent.eventId),
      )
        ? "cancel"
        : "join";
      titleElement.textContent =
        selectedAction === "join" ? "Join Event?" : "Cancel Participation?";
      messageElement.textContent =
        selectedAction === "join"
          ? `Are you sure you want to join the ${selectedEvent.title}? By confirming, you will be registered as a participant for this event.`
          : `Are you sure you want to cancel your participation in the ${selectedEvent.title}? Your slot may be made available to another student.`;
      primaryButton.textContent =
        selectedAction === "join" ? "Participate" : "Yes";
      cancelButton.textContent = selectedAction === "join" ? "Cancel" : "No";
      errorElement.textContent = "";
      confirmOverlay.setAttribute("aria-hidden", "false");
      confirmOverlay.classList.add("is-open");
      primaryButton.focus();
    }

    async function confirmAction() {
      if (!selectedEvent || pending) return;
      const action = selectedAction;
      if (action === "join") {
        const blocked = blockReason(selectedEvent, "join");
        if (blocked) {
          errorElement.textContent = blocked;
          updateAction();
          return;
        }
      }
      pending = true;
      primaryButton.disabled = true;
      cancelButton.disabled = true;
      primaryButton.textContent = "Saving...";
      updateAction();
      try {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
        const id = String(selectedEvent.id || selectedEvent.eventId);
        const registrations = readIds();
        const savedSlots = readObject(slotsKey);
        const previousSlots = { ...savedSlots };
        const available = openSlots(selectedEvent);
        const limit = capacity(selectedEvent);
        if (action === "join") {
          if (registrations.has(id))
            throw new Error("You are already registered for this event.");
          const blocked = blockReason(selectedEvent, "join");
          if (blocked) throw new Error(blocked);
          if (selectedEvent.capacityMode !== "N/A" && available <= 0)
            throw new Error("No slots are available for this event.");
          if (typeof window.recovibeRegisterForEvent === "function") {
            if ((await window.recovibeRegisterForEvent(id)) === false) {
              throw new Error(
                blockReason(selectedEvent, "join") ||
                  "The registration could not be completed.",
              );
            }
          }
          registrations.add(id);
          if (selectedEvent.capacityMode !== "N/A")
            savedSlots[id] = available - 1;
          else delete savedSlots[id];
        } else {
          if (!registrations.has(id))
            throw new Error("You are not registered for this event.");
          if (typeof window.recovibeCancelRegistration === "function") {
            if ((await window.recovibeCancelRegistration(id)) === false) {
              throw new Error("The registration could not be cancelled.");
            }
          }
          registrations.delete(id);
          if (limit !== null) savedSlots[id] = Math.min(limit, available + 1);
          else delete savedSlots[id];
        }
        localStorage.setItem(slotsKey, JSON.stringify(savedSlots));
        try {
          localStorage.setItem(
            participationKey,
            JSON.stringify([...registrations]),
          );
        } catch (error) {
          localStorage.setItem(slotsKey, JSON.stringify(previousSlots));
          throw error;
        }
        selectedEvent.slotsOpen =
          selectedEvent.capacityMode === "N/A" ? undefined : savedSlots[id];
        if (selectedEvent.capacityMode !== "N/A") {
          selectedEvent.slotsLeft = savedSlots[id];
          selectedEvent.availableSlots = savedSlots[id];
          selectedEvent.registeredCount = Math.max(
            0,
            Number(selectedEvent.registeredCount || 0) +
              (action === "join" ? 1 : -1),
          );
        }
        closeConfirmation(false);
        renderEvent(selectedEvent);
        updateAction();
        const successMessage = action === "cancel"
          ? `Cancelled registration to ${selectedEvent.title}.`
          : `You registered for ${selectedEvent.title}.`;
        const toast = document.getElementById("toast");
        if (toast) {
          toast.textContent = successMessage;
          toast.classList.add("is-visible");
          window.clearTimeout(toast._studentEventTimer);
          toast._studentEventTimer = window.setTimeout(
            () => toast.classList.remove("is-visible"),
            4000,
          );
        }
        document.dispatchEvent(
          new CustomEvent("recovibeParticipationChanged", {
            detail: { eventId: id, action, slotsOpen: savedSlots[id] },
          }),
        );
      } catch (error) {
        const message = String(error?.message || "");
        if (action === "cancel") {
          errorElement.textContent = "Could not cancel your registration. Please try again.";
        } else if (/already registered/i.test(message)) {
          errorElement.textContent = "You are already registered for this event.";
        } else if (/currently closed by the administrator/i.test(message)) {
          errorElement.textContent =
            "Event registration is currently closed by the administrator.";
        } else if (/registration closed|deadline|registration is closed/i.test(message)) {
          errorElement.textContent = "Registration Closed";
        } else if (/fully booked|event is full|no slots/i.test(message)) {
          errorElement.textContent = "Fully Booked";
        } else if (/no longer open|started or ended|event has ended/i.test(message)) {
          errorElement.textContent = "This event is no longer open for registration.";
        } else {
          errorElement.textContent = "Could Not Register for this Event. Please try again.";
        }
      } finally {
        pending = false;
        primaryButton.disabled = false;
        cancelButton.disabled = false;
        primaryButton.textContent =
          selectedAction === "join" ? "Participate" : "Yes";
        updateAction();
      }
    }

    detailOverlay
      .querySelector(".student-event-close")
      .addEventListener("click", closeDetails);
    detailOverlay.addEventListener("click", (event) => {
      if (event.target === detailOverlay) closeDetails();
    });
    confirmOverlay.addEventListener("click", (event) => {
      if (event.target === confirmOverlay && !pending) closeConfirmation();
    });
    actionButton.addEventListener("click", openConfirmation);
    primaryButton.addEventListener("click", confirmAction);
    cancelButton.addEventListener("click", () => {
      if (!pending) closeConfirmation();
    });
    document.addEventListener("keydown", (event) => {
      if (!detailOverlay.classList.contains("is-open")) return;
      if (event.key === "Escape") {
        if (confirmOverlay.classList.contains("is-open")) closeConfirmation();
        else closeDetails();
        return;
      }
      if (event.key !== "Tab") return;
      const top = confirmOverlay.classList.contains("is-open")
        ? confirmDialog
        : detailDialog;
      const focusable = [
        ...top.querySelectorAll(
          'button:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length);
      if (!focusable.length) {
        event.preventDefault();
        top.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !top.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !top.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    });
    window.addEventListener("storage", (event) => {
      if (!selectedEvent || ![participationKey, slotsKey].includes(event.key))
        return;
      selectedEvent.slotsOpen = openSlots(selectedEvent);
      renderEvent(selectedEvent);
      updateAction();
    });

    return {
      open(event, options = {}) {
        if (!event || isHoliday(event)) return;
        selectedEvent = event;
        dashboardRegistrationConfirmation =
          options.dashboardRegistrationConfirmation === true;
        previousFocus = document.activeElement;
        bodyOverflow = document.body.style.overflow;
        renderEvent(event);
        updateAction();
        document.body.style.overflow = "hidden";
        detailOverlay.setAttribute("aria-hidden", "false");
        detailOverlay.classList.add("is-open");
        detailDialog.focus();
        if (dashboardRegistrationConfirmation) openConfirmation();
      },
      close: closeDetails,
    };
  }

  window.RecovibeStudentEventDetails = createStudentRegistrationModal();
})();
