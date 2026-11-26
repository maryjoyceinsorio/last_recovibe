import assert from "node:assert/strict";
import test from "node:test";
import {
  getEventPhase,
  shouldHideOtherOrganizationCancelledEvent,
} from "./eventOrganizerAllEventsVisibility.mjs";

const now = Date.parse("2026-11-26T07:00:00Z");
const eventBoundaryMillis = (event, isEnd = false) =>
  isEnd ? event.endMillis ?? null : event.startMillis ?? null;

test("classifies cancellation and completion from any loaded status field", () => {
  assert.equal(
    getEventPhase({ publicationStatus: "Canceled" }, now, eventBoundaryMillis),
    "cancelled",
  );
  assert.equal(
    getEventPhase({ eventStatus: "completed" }, now, eventBoundaryMillis),
    "completed",
  );
});

test("classifies an ended active event as completed", () => {
  assert.equal(
    getEventPhase(
      { status: "active", endMillis: now - 1 },
      now,
      eventBoundaryMillis,
    ),
    "completed",
  );
});

test("hides cancelled events from other organizations, including person-label sources", () => {
  const otherOrganizationEvent = {
    organizerId: "another-organizer",
    organizationCode: "OTHER",
    organizerName: "Event Organizer: Warren Ken Ducot Tuazon",
  };

  assert.equal(
    shouldHideOtherOrganizationCancelledEvent(
      otherOrganizationEvent,
      "cancelled",
      "current-user",
      "CURRENT",
    ),
    true,
  );
  assert.equal(
    shouldHideOtherOrganizationCancelledEvent(
      otherOrganizationEvent,
      "completed",
      "current-user",
      "CURRENT",
    ),
    false,
  );
});

test("keeps cancelled events owned by the current organizer or organization", () => {
  assert.equal(
    shouldHideOtherOrganizationCancelledEvent(
      { organizerUid: "current-user" },
      "cancelled",
      "current-user",
      "CURRENT",
    ),
    false,
  );
  assert.equal(
    shouldHideOtherOrganizationCancelledEvent(
      { organizationCode: "CURRENT" },
      "cancelled",
      "current-user",
      "CURRENT",
    ),
    false,
  );
});

test("uses an explicit organization code over a conflicting display label", () => {
  assert.equal(
    shouldHideOtherOrganizationCancelledEvent(
      {
        organizationCode: "OTHER",
        organizationName: "CURRENT",
      },
      "cancelled",
      "current-user",
      "CURRENT",
    ),
    true,
  );
});

test("does not hide active events from another organization", () => {
  assert.equal(
    shouldHideOtherOrganizationCancelledEvent(
      { organizationCode: "OTHER" },
      "upcoming",
      "current-user",
      "CURRENT",
    ),
    false,
  );
  assert.equal(
    shouldHideOtherOrganizationCancelledEvent(
      { organizationCode: "OTHER" },
      "ongoing",
      "current-user",
      "CURRENT",
    ),
    false,
  );
});

test("keeps completed events from other organizations visible", () => {
  assert.equal(
    shouldHideOtherOrganizationCancelledEvent(
      { organizationCode: "OTHER" },
      "completed",
      "current-user",
      "CURRENT",
    ),
    false,
  );
});
