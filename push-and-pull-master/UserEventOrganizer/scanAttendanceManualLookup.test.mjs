import test from "node:test";
import assert from "node:assert/strict";
import {
  buildManualAttendeeIndex,
  searchManualAttendees,
} from "./scanAttendanceManualLookup.js";

test("manual attendee index merges Firestore details with UID-only RTDB registrations", () => {
  const attendees = buildManualAttendeeIndex(
    [
      {
        id: "student-a",
        uid: "student-a",
        status: "registered",
        studentName: "Ada Lovelace",
        studentNumber: "2023-00123-BN-0",
      },
      {
        id: "student-b",
        uid: "student-b",
        status: "cancelled",
        studentName: "Grace Hopper",
      },
    ],
    {
      "student-a": true,
      "student-b": true,
      "student-c": true,
    },
  );

  assert.equal(attendees.length, 2);
  assert.deepEqual(
    searchManualAttendees(attendees, "2023-00123-BN-0").map((student) => student.uid),
    ["student-a"],
  );
  assert.equal(searchManualAttendees(attendees, "ada")[0].name, "Ada Lovelace");
  assert.equal(searchManualAttendees(attendees, "student-c")[0].uid, "student-c");
  assert.equal(searchManualAttendees(attendees, "Grace").length, 0);
});

test("manual attendee index reads student profile aliases and checked-in state", () => {
  const attendees = buildManualAttendeeIndex(
    [],
    {
      "student-a": {
        student: {
          firstName: "Ada",
          lastName: "Lovelace",
          studentId: "2023-00123-BN-0",
        },
        course: "Computer Studies",
      },
    },
  );

  assert.deepEqual(
    searchManualAttendees(attendees, "lovelace", new Set(["student-a"])).map((student) => ({
      uid: student.uid,
      studentNo: student.studentNo,
      checkedIn: student.checkedIn,
    })),
    [{
      uid: "student-a",
      studentNo: "2023-00123-BN-0",
      checkedIn: true,
    }],
  );
});
