import test from "node:test";
import assert from "node:assert/strict";

import {
  isRegistrationActive,
  mergeRegistrationMapsByUid,
  mergeUserRegistrationMaps,
} from "./eventRegistrationData.js";

test("registration sources merge by UID and retain the newest cancellation", () => {
  const merged = mergeRegistrationMapsByUid(
    { student1: { uid: "student1", status: "registered", at: 100 } },
    { student1: { uid: "student1", status: "cancelled", at: 200 } },
  );

  assert.equal(Object.keys(merged).length, 1);
  assert.equal(merged.student1.status, "cancelled");
  assert.equal(isRegistrationActive(merged.student1), false);
});

test("user registration maps preserve distinct events for one UID", () => {
  const firestore = new Map([
    ["event1", { uid: "student1", status: "registered", at: 100 }],
    ["event2", { uid: "student1", status: "registered", at: 100 }],
  ]);
  const rtdb = new Map([
    ["event1", { uid: "student1", status: "cancelled", at: 200 }],
  ]);

  const merged = mergeUserRegistrationMaps(firestore, rtdb);

  assert.equal(merged.size, 2);
  assert.equal(merged.get("event1").status, "cancelled");
  assert.equal(merged.get("event2").status, "registered");
});

test("legacy true-valued registrations normalize to active UID records", () => {
  const merged = mergeRegistrationMapsByUid({ student1: true });

  assert.equal(merged.student1.uid, "student1");
  assert.equal(isRegistrationActive(merged.student1), true);
});

test("attendance sources retain the most recent check-in by UID", () => {
  const merged = mergeRegistrationMapsByUid(
    { student1: { uid: "student1", scannedAt: 100 } },
    { student1: { uid: "student1", scannedAt: 200 } },
  );

  assert.equal(merged.student1.scannedAt, 200);
});
