import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPersonalizedEventRecommendations,
  isEventRecommendationQuestion,
} from "./recoVibeRecommendations.mjs";

const now = Date.UTC(2026, 10, 26, 6);

test("recognizes personalized recommendation wording", () => {
  for (const question of [
    "Do you have any recommended events for me?",
    "recommend events",
    "events for me",
    "suggest events",
  ]) {
    assert.equal(isEventRecommendationQuestion(question), true, question);
  }
  assert.equal(isEventRecommendationQuestion("When is the next event?"), false);
});

test("ranks loaded upcoming events by saved interests and includes event details", () => {
  const answer = buildPersonalizedEventRecommendations(
    [
      {
        id: "robotics",
        name: "Robotics Workshop",
        categories: ["Technology"],
        startMs: now + 86_400_000,
        endMs: now + 90_000_000,
        venue: "Lab 2",
      },
      {
        id: "sports",
        name: "Sports Festival",
        categories: ["Sports"],
        startMs: now + 3_600_000,
        endMs: now + 7_200_000,
        venue: "Main court",
      },
      {
        id: "active",
        name: "Active Coding Session",
        categories: ["Technology"],
        startMs: now - 3_600_000,
        endMs: now + 3_600_000,
        venue: "Room 4",
      },
      {
        id: "past",
        name: "Old Technology Talk",
        categories: ["Technology"],
        startMs: now - 86_400_000,
        endMs: now - 80_000_000,
        venue: "Auditorium",
      },
    ],
    { interests: ["Technology"], pastEventIds: ["past"] },
    now,
  );

  assert.match(answer, /Robotics Workshop/);
  assert.match(answer, /Active Coding Session/);
  assert.match(answer, /matches your interest in Technology/);
  assert.match(answer, /Lab 2/);
  assert.match(answer, /Nov 27, 2026/);
  assert.doesNotMatch(answer, /Sports Festival|Old Technology Talk/);
});

test("uses a clear general-event fallback when no profile signals match", () => {
  const answer = buildPersonalizedEventRecommendations(
    [{
      name: "Campus Art Fair",
      category: "Arts",
      startMs: now + 86_400_000,
      endMs: now + 90_000_000,
      venue: "Student plaza",
    }],
    { interests: ["Robotics"], programs: ["BSIT"] },
    now,
  );

  assert.match(answer, /couldn't find an exact match/i);
  assert.match(answer, /Campus Art Fair/);
  assert.match(answer, /suggested as one of the next active or upcoming events/);
});

test("reports when no active or upcoming loaded events are available", () => {
  const answer = buildPersonalizedEventRecommendations(
    [{
      name: "Cancelled event",
      status: "cancelled",
      startMs: now + 86_400_000,
      endMs: now + 90_000_000,
    }],
    {},
    now,
  );

  assert.match(answer, /don't see any active or upcoming events/i);
});
