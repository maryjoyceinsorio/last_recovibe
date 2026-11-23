import assert from "node:assert/strict";
import test from "node:test";
import {
  createAttendanceQrPayload,
  parseAttendanceQrPayload,
} from "./attendanceQr.js";

test("attendance QR payload includes the signed-in user and event context", () => {
  const payload = JSON.parse(createAttendanceQrPayload({
    user: { uid: "student-123", email: "student@example.edu" },
    eventId: "event-456",
    eventName: "Campus Forum",
  }));

  assert.equal(payload.type, "recovibe-attendance");
  assert.equal(payload.version, 1);
  assert.equal(payload.uid, "student-123");
  assert.equal(payload.email, "student@example.edu");
  assert.equal(payload.eventId, "event-456");
  assert.equal(payload.eventName, "Campus Forum");
  assert.equal(payload.registrationStatus, "registered");
  assert.equal(typeof payload.issuedAt, "number");
  assert.ok(payload.nonce);
});

test("attendance QR parser resolves the student and rejects another event", () => {
  const rawPayload = createAttendanceQrPayload({
    user: { uid: "student-123", email: "student@example.edu" },
    eventId: "event-456",
  });

  assert.equal(parseAttendanceQrPayload(rawPayload, "event-456").uid, "student-123");
  assert.throws(
    () => parseAttendanceQrPayload(rawPayload, "event-other"),
    /different event/,
  );
});

test("refreshing an attendance QR produces a newer timestamp and nonce", () => {
  const options = {
    user: { uid: "student-123", email: "student@example.edu" },
    eventId: "event-456",
  };
  const first = JSON.parse(createAttendanceQrPayload(options));
  const refreshed = JSON.parse(createAttendanceQrPayload(options));

  assert.ok(refreshed.issuedAt > first.issuedAt);
  assert.notEqual(refreshed.nonce, first.nonce);
});

test("attendance QR payload requires a user and supports generic profile codes", () => {
  assert.throws(
    () => createAttendanceQrPayload({ user: null, eventId: "event-456" }),
    /Sign in/,
  );
  const profilePayload = JSON.parse(createAttendanceQrPayload({
    user: { uid: "student-123", email: "student@example.edu" },
  }));
  assert.equal(profilePayload.eventId, "");
  assert.equal(profilePayload.registrationStatus, "profile");
  assert.equal(parseAttendanceQrPayload(JSON.stringify(profilePayload), "event-456").uid, "student-123");
  assert.throws(
    () => parseAttendanceQrPayload(
      JSON.stringify({ ...profilePayload, registrationStatus: "registered" }),
      "event-456",
    ),
    /no event context/,
  );
});
