(() => {
  "use strict";

  const escapeHTML = (value) => String(value ?? "").replace(
    /[&<>"']/g,
    (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character],
  );

  function hasContent(value) {
    if (value == null) return false;
    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized !== "" && normalized.toLowerCase() !== "n/a";
    }
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "boolean") return true;
    if (Array.isArray(value)) return value.some(hasContent);
    if (value instanceof Date) return !Number.isNaN(value.getTime());
    if (typeof value === "object") return Object.values(value).some(hasContent);
    return false;
  }

  function values(value) {
    if (Array.isArray(value)) return value.filter(hasContent);
    return hasContent(value) ? [value] : [];
  }

  function text(value) {
    if (typeof value === "string") {
      const normalized = value.trim();
      return normalized.toLowerCase() === "n/a" ? "" : normalized;
    }
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
    if (!value || typeof value !== "object") return "";
    const preferred = [
      "name", "fullName", "displayName", "organizationName", "organization",
      "partnerName", "facultyName", "title", "label", "role", "notes", "note",
      "accessNeeds", "department", "email", "phone", "id",
    ];
    const fields = preferred.filter((field) => hasContent(value[field]));
    if (fields.length) return fields.map((field) => text(value[field])).filter(Boolean).join(" · ");
    return Object.values(value).map(text).filter(Boolean).join(" · ");
  }

  function firstValue(record, fields) {
    for (const field of fields) {
      const value = record?.[field];
      if (hasContent(value)) return value;
    }
    return "";
  }

  function listMarkup(items, fields) {
    const entries = values(items).map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        const value = text(item);
        return value ? `<li>${escapeHTML(value)}</li>` : "";
      }
      const details = fields.map(([label, aliases]) => {
        const value = text(firstValue(item, aliases));
        return value ? `<p><strong>${escapeHTML(label)}:</strong> ${escapeHTML(value)}</p>` : "";
      }).filter(Boolean).join("");
      const name = text(firstValue(item, [
        "name", "fullName", "displayName", "organizationName", "organization",
        "partnerName", "facultyName", "title", "label", "id",
      ]));
      return name || details
        ? `<li>${name ? `<strong>${escapeHTML(name)}</strong>` : ""}${details}</li>`
        : "";
    }).filter(Boolean);
    return entries.length ? `<ul>${entries.join("")}</ul>` : "";
  }

  function detailMarkup(event) {
    const partners = firstValue(event, [
      "partnerOrganizations", "partnerOrgs", "partner_organizations",
    ]);
    const guests = firstValue(event, [
      "externalGuests", "external_guests", "guests", "guestSpeakers",
    ]);
    const faculty = firstValue(event, [
      "participatingFaculty", "participating_faculty", "participatingFacultyMembers",
      "participating_faculty_members",
    ]);
    const roleNotes = firstValue(event, [
      "rolesAndNotes", "rolesNotes", "roleNotes", "roles_and_notes", "roles_notes",
    ]);
    const roles = firstValue(event, [
      "roles", "eventRoles", "participantRoles", "rolesAndResponsibilities",
      "roles_and_responsibilities",
    ]) || firstValue(roleNotes, ["roles", "role", "responsibilities"]) ||
      [...values(partners).map((item) => firstValue(item, ["role", "roles", "responsibility"])),
        ...values(guests).map((item) => firstValue(item, ["role", "topic"]))]
        .filter(Boolean);
    const notes = firstValue(event, [
      "collaborationNotes", "collaboration_notes", "eventNotes", "event_notes",
      "notes", "additionalNotes", "additional_notes",
    ]) || firstValue(roleNotes, ["notes", "note", "description"]) ||
      [...values(partners).map((item) => firstValue(item, ["notes", "note"])),
        ...values(guests).map((item) => firstValue(item, ["accessNeeds", "notes", "note"]))]
        .filter(Boolean);
    const partnerMarkup = listMarkup(partners, [
        ["Department", ["department"]],
        ["Details", ["subtitle", "description"]],
        ["Role", ["role"]],
        ["Notes", ["notes", "note"]],
      ]);
    const rolesText = text(roles);
    const notesText = text(notes);
    const guestMarkup = listMarkup(guests, [
        ["Organization", ["organization", "organizationName", "affiliation"]],
        ["Contact", ["email", "phone", "contact"]],
        ["Role", ["role", "topic"]],
        ["Notes", ["accessNeeds", "notes", "note"]],
      ]);
    const facultyMarkup = listMarkup(faculty, [
        ["Department", ["department", "college"]],
        ["Email", ["email"]],
        ["Role", ["role", "title"]],
      ]);
    const sections = [];
    if (partnerMarkup) {
      sections.push(
        `<section class="all-events-detail-section"><h3>Partner Orgs</h3>${partnerMarkup}</section>`,
      );
      if (rolesText || notesText) {
        const roleMarkup = rolesText
          ? `<p><strong>Roles:</strong> ${escapeHTML(rolesText)}</p>`
          : "";
        const notesMarkup = notesText
          ? `<p><strong>Notes:</strong> ${escapeHTML(notesText)}</p>`
          : "";
        sections.push(
          `<section class="all-events-detail-section"><h3>Roles, and Notes</h3>${roleMarkup}${notesMarkup}</section>`,
        );
      }
    }
    if (guestMarkup) {
      sections.push(
        `<section class="all-events-detail-section"><h3>Mga guests</h3>${guestMarkup}</section>`,
      );
    }
    if (facultyMarkup) {
      sections.push(
        `<section class="all-events-detail-section"><h3>Participating Faculty Members</h3>${facultyMarkup}</section>`,
      );
    }
    return sections.join("");
  }

  function renderInto(container, event) {
    if (!container || !event) return;
    container.querySelectorAll(".all-events-detail-section").forEach((section) => section.remove());
    container.insertAdjacentHTML("beforeend", detailMarkup(event));
  }

  function enhanceActiveDetails(event) {
    const modals = [...document.querySelectorAll('.student-event-overlay[aria-hidden="false"]')];
    const content = modals.at(-1)?.querySelector('[data-field="content"], .student-event-detail-content');
    renderInto(content, event);
  }

  function wrapOpen(apiName) {
    const api = window[apiName];
    if (!api || typeof api.open !== "function" || api.open.allEventsExtrasWrapped) return;

    const open = api.open;
    const wrappedOpen = function (event, ...options) {
      const result = open.call(this, event, ...options);
      enhanceActiveDetails(event);
      return result;
    };
    wrappedOpen.allEventsExtrasWrapped = true;
    api.open = wrappedOpen;
  }

  wrapOpen("RecovibeEventDetails");
  wrapOpen("RecovibeStudentEventDetails");
  window.RecovibeAllEventsDetailsExtras = { renderInto };
})();
