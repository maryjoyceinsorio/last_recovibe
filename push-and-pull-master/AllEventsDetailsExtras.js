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

  function values(value) {
    if (value == null || value === "") return [];
    return Array.isArray(value) ? value.filter((item) => item != null && item !== "") : [value];
  }

  function text(value) {
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
    if (!value || typeof value !== "object") return "";
    const preferred = [
      "name", "fullName", "displayName", "organizationName", "organization",
      "partnerName", "facultyName", "title", "label", "role", "notes", "note",
      "accessNeeds", "department", "email", "phone", "id",
    ];
    const fields = preferred.filter((field) => value[field] != null && value[field] !== "");
    if (fields.length) return fields.map((field) => text(value[field])).filter(Boolean).join(" · ");
    return Object.values(value).map(text).filter(Boolean).join(" · ");
  }

  function firstValue(record, fields) {
    for (const field of fields) {
      const value = record?.[field];
      if (value == null || value === "") continue;
      if (Array.isArray(value) && value.length === 0) continue;
      return value;
    }
    return "";
  }

  function listMarkup(items, fields) {
    const entries = values(items).map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        return `<li>${escapeHTML(text(item))}</li>`;
      }
      const details = fields.map(([label, aliases]) => {
        const value = text(firstValue(item, aliases));
        return value ? `<p><strong>${escapeHTML(label)}:</strong> ${escapeHTML(value)}</p>` : "";
      }).filter(Boolean).join("");
      const name = text(firstValue(item, [
        "name", "fullName", "displayName", "organizationName", "organization",
        "partnerName", "facultyName", "title", "label", "id",
      ]));
      return `<li>${name ? `<strong>${escapeHTML(name)}</strong>` : ""}${details}</li>`;
    }).filter(Boolean);
    return entries.length ? `<ul>${entries.join("")}</ul>` : "<p>N/A</p>";
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
    const sections = [
      `<section class="all-events-detail-section"><h3>Partner Orgs</h3>${listMarkup(partners, [
        ["Department", ["department"]],
        ["Details", ["subtitle", "description"]],
        ["Role", ["role"]],
        ["Notes", ["notes", "note"]],
      ])}</section>`,
      `<section class="all-events-detail-section"><h3>Roles, and Notes</h3><p><strong>Roles:</strong> ${escapeHTML(text(roles) || "N/A")}</p><p><strong>Notes:</strong> ${escapeHTML(text(notes) || "N/A")}</p></section>`,
      `<section class="all-events-detail-section"><h3>Mga guests</h3>${listMarkup(guests, [
        ["Organization", ["organization", "organizationName", "affiliation"]],
        ["Contact", ["email", "phone", "contact"]],
        ["Role", ["role", "topic"]],
        ["Notes", ["accessNeeds", "notes", "note"]],
      ])}</section>`,
      `<section class="all-events-detail-section"><h3>Participating Faculty Members</h3>${listMarkup(faculty, [
        ["Department", ["department", "college"]],
        ["Email", ["email"]],
        ["Role", ["role", "title"]],
      ])}</section>`,
    ];
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
