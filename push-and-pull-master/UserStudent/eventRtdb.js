import {
  ref,
  runTransaction,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  doc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function validatePathSegment(value, name) {
  const segment = String(value || "").trim();
  if (!segment || /[.#$\[\]/]/.test(segment)) {
    throw new Error(`A valid ${name} is required for this event record.`);
  }
  return segment;
}

function normalizeRegistration(eventId, uid, value = {}) {
  const status = String(value.status || "registered").toLowerCase();
  if (!["registered", "cancelled"].includes(status)) {
    throw new Error("Registration status must be registered or cancelled.");
  }
  const now = Number(value.at || Date.now());
  const record = {
    uid,
    status,
    registeredAt: Number(value.registeredAt || now),
    cancelledAt: status === "cancelled"
      ? Number(value.cancelledAt || now)
      : null,
    at: now,
  };
  for (const field of ["name", "studentNo", "organization"]) {
    const text = String(value.student?.[field] || "").trim();
    if (text) record[field] = text.slice(0, 120);
  }
  return { eventId, uid, record };
}

function startFirestoreSync(db, collectionName, eventId, uid, record) {
  if (!db) return;
  try {
    void setDoc(
      doc(db, "events", eventId, collectionName, uid),
      record,
      { merge: true },
    ).catch((error) => {
      console.warn(`[Event ${collectionName}] Firestore mirror was not synced:`, {
        eventId,
        uid,
        code: error?.code || "unknown",
      });
    });
  } catch (error) {
    console.warn(`[Event ${collectionName}] Could not start Firestore mirror:`, {
      eventId,
      uid,
      code: error?.code || "unknown",
    });
  }
}

export async function writeEventRegistration({
  rtdb,
  db,
  eventId: eventIdValue,
  uid: uidValue,
  status = "registered",
  registeredAt,
  cancelledAt,
  at,
  student,
}) {
  if (!rtdb) throw new Error("Realtime Database is not configured.");
  const eventId = validatePathSegment(eventIdValue, "event ID");
  const uid = validatePathSegment(uidValue, "student UID");
  const { record } = normalizeRegistration(eventId, uid, {
    status,
    registeredAt,
    cancelledAt,
    at,
    student,
  });

  await update(ref(rtdb), {
    [`eventRegistrations/${eventId}/${uid}`]: record,
    [`userRegistrations/${uid}/${eventId}`]: record,
  });
  startFirestoreSync(db, "registrations", eventId, uid, {
    uid: record.uid,
    status: record.status,
    registeredAt: record.registeredAt,
    cancelledAt: record.cancelledAt,
    at: record.at,
  });
  return record;
}

export async function writeEventAttendance({
  rtdb,
  db,
  eventId: eventIdValue,
  uid: uidValue,
  attendance,
}) {
  if (!rtdb) throw new Error("Realtime Database is not configured.");
  const eventId = validatePathSegment(eventIdValue, "event ID");
  const uid = validatePathSegment(uidValue, "student UID");
  const record = {
    scannedAt: Number(attendance?.scannedAt || Date.now()),
    scannedBy: String(attendance?.scannedBy || ""),
    walkIn: Boolean(attendance?.walkIn),
    name: String(attendance?.name || ""),
    studentNo: String(attendance?.studentNo || ""),
    organization: String(attendance?.organization || ""),
  };
  const newPath = ref(rtdb, `eventAttendance/${eventId}/${uid}`);
  let transaction;
  let primaryPath = newPath;
  try {
    transaction = await runTransaction(
      newPath,
      (current) => current == null ? record : undefined,
      { applyLocally: false },
    );
  } catch (error) {
    if (error?.code !== "PERMISSION_DENIED" && error?.code !== "permission-denied") {
      throw error;
    }
    console.warn("[Event attendance] New RTDB path is unavailable; using the existing attendance path.");
    primaryPath = ref(rtdb, `attendance/${eventId}/${uid}`);
    transaction = await runTransaction(
      primaryPath,
      (current) => current == null ? record : undefined,
      { applyLocally: false },
    );
  }

  if (!transaction.committed) {
    return {
      committed: false,
      record: transaction.snapshot.val() || {},
    };
  }

  const mirrorPath = primaryPath === newPath
    ? ref(rtdb, `attendance/${eventId}/${uid}`)
    : newPath;
  try {
    void runTransaction(
      mirrorPath,
      (current) => current == null ? record : undefined,
      { applyLocally: false },
    ).catch((error) => {
      console.warn("[Event attendance] RTDB compatibility mirror was not synced:", {
        eventId,
        uid,
        code: error?.code || "unknown",
      });
    });
  } catch (error) {
    console.warn("[Event attendance] RTDB compatibility mirror was not synced:", {
      eventId,
      uid,
      code: error?.code || "unknown",
    });
  }

  startFirestoreSync(db, "attendance", eventId, uid, { uid, ...record });
  return { committed: true, record };
}
