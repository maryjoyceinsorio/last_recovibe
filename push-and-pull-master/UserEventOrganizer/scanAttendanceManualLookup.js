const INACTIVE_REGISTRATION_STATUSES = new Set([
  "cancelled",
  "canceled",
  "declined",
  "inactive",
  "not registered",
  "unregistered",
  "withdrawn",
]);

function normalizeText(value) {
  return String(value || "").trim();
}

export function normalizeManualWalkInEntry({ name, studentNo, organization } = {}) {
  const cleanName = normalizeText(name).slice(0, 120);
  if (!cleanName) return null;
  return {
    name: cleanName,
    studentNo: normalizeText(studentNo).replace(/\s+/g, " ").toUpperCase().slice(0, 60),
    organization: normalizeText(organization).slice(0, 120),
  };
}

function isActiveRegistration(registration) {
  if (registration === true) return true;
  if (!registration || typeof registration !== "object") return false;
  const status = normalizeText(registration.status)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return registration.registered !== false &&
    registration.isRegistered !== false &&
    !INACTIVE_REGISTRATION_STATUSES.has(status);
}

function attendeeFromRegistration(uid, registration) {
  const record = registration && typeof registration === "object" ? registration : {};
  const student = record.student && typeof record.student === "object" ? record.student : {};
  const firstName = record.firstName || student.firstName || "";
  const lastName = record.lastName || student.lastName || "";
  return {
    uid: String(uid),
    name: normalizeText(
      record.studentName ||
      record.fullName ||
      record.name ||
      record.displayName ||
      student.fullName ||
      student.name ||
      [firstName, record.middleName || student.middleName, lastName].filter(Boolean).join(" "),
    ),
    studentNo: normalizeText(
      record.studentNumber ||
      record.studentNo ||
      record.studentId ||
      record.idNumber ||
      student.studentNumber ||
      student.studentNo ||
      student.studentId ||
      "",
    ).toUpperCase(),
    organization: normalizeText(
      record.organization ||
      record.courseOrganization ||
      record.course ||
      record.department ||
      student.organization ||
      student.courseOrganization ||
      student.course ||
      student.department ||
      "",
    ),
    course: normalizeText(
      record.courseOrganization ||
      record.course ||
      record.department ||
      student.courseOrganization ||
      student.course ||
      student.department ||
      "",
    ),
    section: normalizeText(record.section || student.section || ""),
  };
}

export function buildManualAttendeeIndex(firestoreRegistrations = [], realtimeRegistrations = {}) {
  const attendees = new Map();
  const mergeRegistration = (uid, registration) => {
    const key = normalizeText(uid);
    if (!key || !isActiveRegistration(registration)) return;
    const previous = attendees.get(key) || {
      uid: key,
      name: "",
      studentNo: "",
      organization: "",
      course: "",
      section: "",
    };
    const next = attendeeFromRegistration(key, registration);
    attendees.set(key, {
      uid: key,
      name: next.name || previous.name,
      studentNo: next.studentNo || previous.studentNo,
      organization: next.organization || previous.organization,
      course: next.course || previous.course,
      section: next.section || previous.section,
    });
  };

  Object.entries(realtimeRegistrations || {}).forEach(([uid, registration]) => {
    mergeRegistration(uid, registration);
  });
  firestoreRegistrations.forEach((registration) => {
    if (!registration || typeof registration !== "object") return;
    const uid = normalizeText(
      registration.uid ||
      registration.userId ||
      registration.studentUid ||
      registration.id,
    );
    if (!uid) return;
    if (!isActiveRegistration(registration)) {
      attendees.delete(uid);
      return;
    }
    mergeRegistration(uid, registration);
  });

  return [...attendees.values()].sort((left, right) =>
    left.studentNo.localeCompare(right.studentNo) || left.name.localeCompare(right.name),
  );
}

export function searchManualAttendees(attendees, searchTerm, checkedInUids = new Set()) {
  const term = normalizeText(searchTerm);
  if (!term) return [];
  const normalizedTerm = term.toLocaleLowerCase();
  const normalizedStudentNo = term.toUpperCase();
  return attendees
    .filter((student) =>
      student.studentNo.includes(normalizedStudentNo) ||
      student.name.toLocaleLowerCase().includes(normalizedTerm) ||
      student.uid.toLocaleLowerCase().includes(normalizedTerm),
    )
    .map((student) => ({
      ...student,
      checkedIn: checkedInUids.has(String(student.uid)),
    }));
}
