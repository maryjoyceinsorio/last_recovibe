function normalizeRecord(uid, value) {
  if (value === true) return { uid: String(uid), status: "registered" };
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    uid: String(value.uid || value.userId || uid || ""),
  };
}

function recordTime(record) {
  return [
    "updatedAt",
    "scannedAt",
    "checkedInAt",
    "checkInAt",
    "at",
    "cancelledAt",
    "registeredAt",
  ]
    .map((key) => record?.[key])
    .reduce((latest, value) => {
      const timestamp = typeof value?.toMillis === "function"
        ? value.toMillis()
        : Number(value);
      return Number.isFinite(timestamp) && timestamp > latest ? timestamp : latest;
    }, 0);
}

export function mergeRegistrationRecord(first, second) {
  if (!first) return second || null;
  if (!second) return first;
  const firstIsNewer = recordTime(first) > recordTime(second);
  const newer = firstIsNewer ? first : second;
  const older = firstIsNewer ? second : first;
  return { ...older, ...newer, uid: newer.uid || older.uid };
}

function entriesOf(source) {
  if (source instanceof Map) return [...source.entries()];
  if (Array.isArray(source)) {
    return source.map((record, index) => [
      record?.uid || record?.userId || record?.id || String(index),
      record,
    ]);
  }
  return source && typeof source === "object" ? Object.entries(source) : [];
}

export function mergeRegistrationMapsByUid(...sources) {
  const merged = new Map();
  sources.forEach((source) => {
    entriesOf(source).forEach(([key, value]) => {
      const record = normalizeRecord(key, value);
      if (!record?.uid) return;
      merged.set(
        record.uid,
        mergeRegistrationRecord(merged.get(record.uid), record),
      );
    });
  });
  return Object.fromEntries(merged);
}

export function mergeUserRegistrationMaps(firestoreMap, rtdbMap) {
  const eventIds = new Set([
    ...entriesOf(firestoreMap).map(([eventId]) => String(eventId)),
    ...entriesOf(rtdbMap).map(([eventId]) => String(eventId)),
  ]);
  const merged = new Map();
  eventIds.forEach((eventId) => {
    const firestoreRecord = firestoreMap instanceof Map
      ? firestoreMap.get(eventId)
      : firestoreMap?.[eventId];
    const rtdbRecord = rtdbMap instanceof Map
      ? rtdbMap.get(eventId)
      : rtdbMap?.[eventId];
    const record = mergeRegistrationRecord(
      normalizeRecord(eventId, firestoreRecord),
      normalizeRecord(eventId, rtdbRecord),
    );
    if (record) merged.set(eventId, record);
  });
  return merged;
}

export function isRegistrationActive(record) {
  if (record === true) return true;
  if (!record || typeof record !== "object") return false;
  const status = String(record.status || "registered")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .trim();
  return record.registered !== false &&
    record.isRegistered !== false &&
    !["cancelled", "canceled", "declined", "inactive", "not registered", "unregistered", "withdrawn"]
      .includes(status);
}
