import assert from "node:assert/strict";
import test from "node:test";
import {
  eventBoundaryMillis,
  eventDateISO,
  getCurrentlyLivePublishedEvents,
} from "./eventOrganizerDashboardDates.js";

test("parses a combined time range using the event's Manila calendar date", () => {
  const event = {
    dateISO: "2026-04-15",
    time: "10:00 AM - 12:30 PM",
  };

  assert.equal(
    eventBoundaryMillis(event),
    Date.UTC(2026, 3, 15, 2),
  );
  assert.equal(
    eventBoundaryMillis(event, true),
    Date.UTC(2026, 3, 15, 4, 30),
  );
});

test("uses nested schedule dates and time fields", () => {
  const event = {
    schedule: {
      date: "2026-04-15",
      start: "6 PM",
      end: "7:15 PM",
    },
  };

  assert.equal(
    eventBoundaryMillis(event),
    Date.UTC(2026, 3, 15, 10),
  );
  assert.equal(
    eventBoundaryMillis(event, true),
    Date.UTC(2026, 3, 15, 11, 15),
  );
});

test("prefers direct startAt and endAt instants", () => {
  const event = {
    startAt: "2026-04-15T10:00:00+08:00",
    endAt: "2026-04-15T11:30:00+08:00",
  };

  assert.equal(
    eventBoundaryMillis(event),
    Date.parse(event.startAt),
  );
  assert.equal(
    eventBoundaryMillis(event, true),
    Date.parse(event.endAt),
  );
  assert.equal(eventDateISO(event.startAt), "2026-04-15");
});

test("derives a Manila calendar date from a direct timestamp", () => {
  assert.equal(
    eventDateISO("2026-04-14T20:00:00Z"),
    "2026-04-15",
  );
});

test("includes live published events across organizations and excludes unpublished events", () => {
  const now = Date.parse("2026-04-15T11:00:00+08:00");
  const events = [
    {
      eventId: "other-org-published",
      organization: "Another Organization",
      status: "published",
      dateISO: "2026-04-15",
      time: "10:00 AM - 12:00 PM",
    },
    {
      eventId: "other-org-approved-published",
      organization: "Campus Group",
      status: "approved",
      published: true,
      dateISO: "2026-04-15",
      time: "9:00 AM - 1:00 PM",
    },
    {
      eventId: "approved-not-published",
      status: "approved",
      dateISO: "2026-04-15",
      time: "10:00 AM - 12:00 PM",
    },
    {
      eventId: "future",
      status: "published",
      dateISO: "2026-04-15",
      time: "1:00 PM - 2:00 PM",
    },
    {
      eventId: "completed",
      status: "completed",
      published: true,
      dateISO: "2026-04-15",
      time: "9:00 AM - 1:00 PM",
    },
  ];

  assert.deepEqual(
    getCurrentlyLivePublishedEvents(events, now).map((event) => event.eventId),
    ["other-org-approved-published", "other-org-published"],
  );
});
