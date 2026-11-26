import assert from "node:assert/strict";
import test from "node:test";
import {
  isEventVisibleToStudent,
  isStudentEventPublished,
  isStudentEventStatus,
} from "./eventAudience.js";

test("warns for every mixed-audience event without targets", () => {
  const originalEnvironment = process.env.NODE_ENV;
  const originalWarn = console.warn;
  const warnings = [];
  process.env.NODE_ENV = "development";
  console.warn = (...args) => warnings.push(args);

  try {
    assert.equal(
      isEventVisibleToStudent(
        { title: "IT Akwe", targetAudience: "Mixed Audience" },
        {},
      ),
      true,
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /Mixed-audience event "IT Akwe"/);

    assert.equal(
      isEventVisibleToStudent(
        { title: "Malformed event", targetAudience: "Mixed Audience" },
        {},
      ),
      true,
    );
    assert.equal(warnings.length, 2);
    assert.match(warnings[1][0], /Mixed-audience event "Malformed event"/);
  } finally {
    console.warn = originalWarn;
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
});

test("approved but unpublished events remain hidden", () => {
  assert.equal(isStudentEventPublished({ status: "approved" }), false);
  assert.equal(
    isStudentEventPublished({ status: "approved", approvalStatus: "approved" }),
    false,
  );
});

test("published events and approved events with a publish marker are visible", () => {
  assert.equal(isStudentEventPublished({ status: "published" }), true);
  assert.equal(
    isStudentEventPublished({ status: "approved", published: true }),
    true,
  );
  assert.equal(
    isStudentEventPublished({ publicationStatus: "Published" }),
    true,
  );
  assert.equal(isStudentEventPublished({ status: "rescheduled" }), true);
});

test("active, ongoing, and upcoming statuses are student-visible event states", () => {
  for (const status of ["ACTIVE", "Ongoing", "upcoming"]) {
    assert.equal(isStudentEventStatus(status), true);
    assert.equal(isStudentEventPublished({ status }), true);
  }
  assert.equal(
    isStudentEventPublished({ status: "ongoing", approvalStatus: "pending" }),
    false,
  );
});

test("events without audience metadata or targeting remain visible to students", () => {
  assert.equal(isEventVisibleToStudent({ title: "Legacy published event" }, {}), true);
  assert.equal(
    isEventVisibleToStudent(
      { title: "Targeted event", targetAudience: "Organization Members Only" },
      {},
    ),
    false,
  );
});

test("unpublished lifecycle states override publication markers", () => {
  assert.equal(
    isStudentEventPublished({ status: "pending", published: true }),
    false,
  );
  assert.equal(
    isStudentEventPublished({ status: "draft", publicationStatus: "published" }),
    false,
  );
  assert.equal(
    isStudentEventPublished({ status: "published", approvalStatus: "pending" }),
    false,
  );
  assert.equal(
    isStudentEventPublished({ status: "published", published: false }),
    false,
  );
  assert.equal(
    isStudentEventPublished({ status: "published", approved: false }),
    false,
  );
});
