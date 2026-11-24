(() => {
  const DEBUG = false;
  const STORAGE_KEY = "recovibeOrganizerNotifications";
  const DELETED_STORAGE_KEY = "recovibeOrganizerDeletedNotifications";
  const PERMANENTLY_DELETED_STORAGE_KEY = "recovibeOrganizerPermanentlyDeletedNotifications";
  const MAX_EVENTS = 15;
  const MAX_OWN_EVENTS_PER_QUERY = 100;
  const MAX_REGISTRATIONS_PER_EVENT = 100;
  const DAY = 24 * 60 * 60 * 1000;
  const subscribers = new Set();
  const listenerStops = new Map();
  const statuses = new Map();
  const firestoreNotificationQueries = new Map([
    ["userId", new Map()],
    ["recipientUid", new Map()],
  ]);
  const rtdbNotifications = new Map();
  const firestoreEventQueries = new Map([
    ["organizerId", new Map()],
    ["organizerUid", new Map()],
  ]);
  const rtdbEvents = new Map();
  const registrations = new Map();
  const firestoreRegistrations = new Map();
  const rtdbRegistrations = new Map();
  const legacyRegistrationLoads = new Set();
  const readOverrides = new Map();
  const registrationErrors = new Set();
  let activeUid = "";
  let loading = true;
  let authUnsubscribe = null;
  let timeoutId = null;
  let firebase = null;
  let authModule = null;
  let firestoreModule = null;
  let readCacheModule = null;
  let databaseModule = null;
  let initialized = false;
  let lifecycleActive = true;
  let sourceError = "";
  let academicCalendarItems = [];
  let academicCalendarUnsubscribe = null;
  let academicCalendarTimer = null;

  function debug(...args) {
    if (DEBUG) console.debug("[OrganizerNotifications]", ...args);
  }

  function readStoredNotifications(uid) {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (!Array.isArray(value) || !uid) return Array.isArray(value) ? value : [];
      return value.filter((item) =>
        item.ownerUid === uid ||
        item.organizerId === uid ||
        item.organizerUid === uid ||
        item.recipientUid === uid ||
        item.userId === uid,
      );
    } catch (error) {
      debug("Could not read notification state:", error);
      return [];
    }
  }

  function toMillis(value) {
    if (value && typeof value.toMillis === "function") return value.toMillis();
    if (value && typeof value.toDate === "function") return value.toDate().getTime();
    if (value && typeof value.seconds === "number") return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const text = value.trim();
      const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      if (dateOnly) {
        return Date.parse(`${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}T00:00:00+08:00`) || 0;
      }
      if (/^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}/.test(text) &&
          !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
        return Date.parse(`${text.replace(" ", "T")}+08:00`) || 0;
      }
      const parsed = Date.parse(text);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
  }

  function isoTime(value) {
    const millis = toMillis(value);
    return millis ? new Date(millis).toISOString() : "";
  }

  function ownerEvents() {
    const byId = new Map();
    firestoreEventQueries.forEach((items) => items.forEach((event, id) => byId.set(id, event)));
    rtdbEvents.forEach((event, id) => byId.set(id, event));
    return [...byId.values()].map((event) => ({
      ...event,
      id: String(event.id || event.eventId || ""),
    })).filter((event) => event.id);
  }

  function normalizeStatus(value) {
    const text = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
    if (text.includes("revision") || text.includes("revise")) return "needs revision";
    if (text.includes("resched")) return "rescheduled";
    if (text.includes("cancel")) return "cancelled";
    if (text.includes("publish")) return "published";
    if (text.includes("approv")) return "approved";
    if (text.includes("reject") || text.includes("denied")) return "rejected";
    if (text.includes("pending") || text.includes("draft")) return text;
    return "";
  }

  function notificationStatus(item) {
    return [item.eventStatus, item.status, item.type, item.title, item.message]
      .map(normalizeStatus)
      .find(Boolean) || "";
  }

  function eventStatus(event) {
    return normalizeStatus(event.status || event.publicationStatus || event.eventStatus);
  }

  function eventTitle(event) {
    return String(event.title || event.name || event.eventName || "Untitled event");
  }

  function eventStartMillis(event) {
    const direct = event.startAt || event.start_at || event.startDateTime || event.start_date_time;
    if (direct) return toMillis(direct);
    const date = String(event.dateISO || event.date || event.startDate || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 0;
    const time = String(event.startTime || event.schedule?.startTime || event.time || "")
      .split(/\s*[-–—]\s*/)[0]
      .trim();
    const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(time);
    if (!match) return toMillis(date);
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (match[3]) {
      if (match[3].toUpperCase() === "PM" && hour < 12) hour += 12;
      if (match[3].toUpperCase() === "AM" && hour === 12) hour = 0;
    }
    return Date.parse(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`) || 0;
  }

  function manilaDay(millis) {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(millis));
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function isPublished(event) {
    return eventStatus(event) === "published";
  }

  function selectedEvents() {
    const now = Date.now();
    return ownerEvents().sort((first, second) => {
      const firstStart = eventStartMillis(first);
      const secondStart = eventStartMillis(second);
      const firstRank = firstStart >= now ? firstStart - now : now - firstStart + DAY;
      const secondRank = secondStart >= now ? secondStart - now : now - secondStart + DAY;
      return firstRank - secondRank;
    }).slice(0, MAX_EVENTS);
  }

  function normalizedItem(id, raw, source) {
    const data = raw && typeof raw === "object" ? raw : {};
    const createdAt = isoTime(data.createdAt || data.createdAtMillis || data.registeredAt);
    const readOverride = readOverrides.get(String(id));
    return {
      ...data,
      id: String(id),
      ownerUid: activeUid,
      title: String(data.title || data.eventTitle || data.eventName || "Notification"),
      message: String(data.message || data.body || ""),
      type: String(data.type || "default"),
      read: readOverride === undefined ? data.read === true || data.isRead === true : readOverride,
      createdAt,
      eventId: String(data.eventId || ""),
      source,
    };
  }

  function updateRegistrationDocuments(eventId) {
    const merged = new Map();
    [...(firestoreRegistrations.get(eventId) || []), ...(rtdbRegistrations.get(eventId) || [])]
      .forEach((registration, index) => {
        const key = String(
          registration.uid ||
          registration.userId ||
          registration.studentId ||
          registration.id ||
          `record-${index}`,
        );
        merged.set(key, registration);
      });
    registrations.set(eventId, [...merged.values()]);
    publish();
  }

  function registrationItems(event) {
    const eventId = event.id;
    const documents = registrations.get(eventId);
    if (!documents) return [];
    const groups = new Map();
    documents.forEach((registration) => {
      const millis = toMillis(registration.registeredAt);
      const day = millis ? manilaDay(millis) : "unknown";
      const group = groups.get(day) || { count: 0, latest: 0, name: "" };
      group.count += 1;
      if (millis >= group.latest) {
        group.latest = millis;
        group.name = String(
          registration.studentName || registration.name || registration.fullName || "",
        ).trim();
      }

      groups.set(day, group);
    });
    return [...groups.entries()].map(([day, group]) => {
      const title = group.count === 1
        ? `${group.name || "A student"} registered for ${eventTitle(event)}`
        : `${group.count} students registered for ${eventTitle(event)}`;
      return {
        id: `registrations-${eventId}-${day}-${group.count}`,
        title,
        message: "",
        type: "registrations",
        eventId,
        createdAt: isoTime(group.latest),
        registeredAt: isoTime(group.latest),
        source: "derived",
      };
    });
  }

  function derivedItems(events, directNotifications) {
    const now = Date.now();
    const cutoff = now - 30 * DAY;
    const firestoreStatuses = new Set(directNotifications.filter((item) => item.source === "firestore").map((item) => {
      const status = notificationStatus(item);
      return item.eventId && status ? `${item.eventId}|${status}` : "";
    }).filter(Boolean));
    const derived = [];

    events.forEach((event) => {
      const eventId = event.id;
      const title = eventTitle(event);
      const status = eventStatus(event);
      if (status && !["draft", "pending"].includes(status)) {
        const statusTime = [event.reviewedAt, event.updatedAt, event.publishedAt]
          .map(toMillis)
          .find(Boolean) || 0;
        if (statusTime >= cutoff &&
            ["approved", "published", "rejected", "needs revision", "cancelled", "rescheduled"].includes(status) &&
            !firestoreStatuses.has(`${eventId}|${status}`)) {
          const stamp = statusTime;
          derived.push({
            id: `${status.replace(/\s+/g, "-")}-${eventId}-${stamp}`,
            title: `${title} was ${status}`,
            message: String(event.statusReason || event.rejectionReason || ""),
            type: status,
            eventStatus: status,
            eventId,
            createdAt: isoTime(statusTime),
            source: "derived",
          });
        }
      }

      const registeredCount = Number(event.registeredCount);
      const capacity = Number(event.capacity);
      if (Number.isFinite(registeredCount) && Number.isFinite(capacity) &&
          capacity > 0 && registeredCount >= capacity) {
        const stamp = toMillis(event.updatedAt);
        derived.push({
          id: `full-${eventId}-${stamp}`,
          title: `${title} is full`,
          message: "",
          type: "full",
          eventId,
          createdAt: isoTime(stamp),
          source: "derived",
        });
      }

      if (isPublished(event)) {
        const start = eventStartMillis(event);
        const remaining = start - now;
        if (start && remaining > 0 && remaining <= DAY) {
          const tomorrow = manilaDay(start) !== manilaDay(now);
          const when = tomorrow ? "tomorrow" : `in ${Math.max(1, Math.ceil(remaining / 3600000))} hours`;
          derived.push({
            id: `reminder-${eventId}-${start}`,
            title: `${title} starts ${when}`,
            message: "",
            type: "reminder",
            eventId,
            createdAt: isoTime(now),
            source: "derived",
          });
        }
      }
    });

    selectedEvents().forEach((event) => derived.push(...registrationItems(event)));
    return derived;
  }

  function mergedItems() {
    const merged = new Map();
    const direct = [];
    firestoreNotificationQueries.forEach((items) => items.forEach((item, id) => {
        const normalized = normalizedItem(id, item, "firestore");
        merged.set(normalized.id, normalized);
        direct.push(normalized);
      }));
    rtdbNotifications.forEach((item, id) => {
      const normalized = normalizedItem(id, item, "rtdb");
      if (!merged.has(normalized.id)) merged.set(normalized.id, normalized);
      direct.push(normalized);
    });

    const events = ownerEvents();
    derivedItems(events, direct).forEach((item) => {
      const normalized = normalizedItem(item.id, item, "derived");
      if (!merged.has(normalized.id)) merged.set(normalized.id, normalized);
    });
    academicCalendarItems.forEach((item) => {
      const normalized = normalizedItem(item.id, item, "derived");
      if (!merged.has(normalized.id)) merged.set(normalized.id, normalized);
    });
    let deletedIds = new Set();
    let permanentlyDeletedIds = new Set();
    try {
      const deleted = JSON.parse(localStorage.getItem(DELETED_STORAGE_KEY) || "[]");
      if (Array.isArray(deleted)) {
        deletedIds = new Set(
          deleted
            .filter((item) => item.ownerUid === activeUid)
            .map((item) => String(item.id)),
        );
      }
    } catch (error) {
      debug("Could not read deleted notification state:", error);
    }
    try {
      const deleted = JSON.parse(localStorage.getItem(PERMANENTLY_DELETED_STORAGE_KEY) || "[]");
      if (Array.isArray(deleted)) {
        permanentlyDeletedIds = new Set(
          deleted
            .filter((item) => item?.ownerUid === activeUid)
            .map((item) => String(item.id)),
        );
      }
    } catch (error) {
      debug("Could not read permanently deleted notification state:", error);
    }
    return [...merged.values()].filter((item) =>
      !deletedIds.has(item.id) && !permanentlyDeletedIds.has(item.id)
    ).sort(
      (first, second) => toMillis(second.createdAt) - toMillis(first.createdAt),
    );
  }

  function storedItems() {
    const existing = readStoredNotifications("");
    const otherUsers = existing.filter((item) => item.ownerUid && item.ownerUid !== activeUid);
    return [...otherUsers, ...mergedItems()];
  }

  function updateBadge(items) {
    const unread = items.filter((item) => !item.read).length;
    document.querySelectorAll("#navNotifBadge").forEach((badge) => {
      badge.textContent = unread > 9 ? "9+" : unread ? String(unread) : "";
      badge.hidden = unread === 0;
    });
    return unread;
  }

  function allSourcesFailed() {
    return statuses.size > 0 && [...statuses.values()].every((status) => status === "error");
  }

  function publish() {
    const items = activeUid ? mergedItems() : [];
    const unreadCount = updateBadge(items);
    if (activeUid) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(storedItems()));
      } catch (error) {
        debug("Could not save merged notifications:", error);
      }
    }
    const state = {
      uid: activeUid,
      items,
      loading,
      error: allSourcesFailed() ? sourceError || "Notifications could not be loaded." : "",
      counts: {
        firestore: [...firestoreNotificationQueries.values()]
          .reduce((total, items) => total + items.size, 0),
        rtdb: rtdbNotifications.size,
        events: ownerEvents().length,
        registrations: [...registrations.values()].reduce((total, itemsForEvent) => total + itemsForEvent.length, 0),
        merged: items.length,
        unread: unreadCount,
      },
    };
    debug("Notification state:", {
      uid: state.uid,
      loading: state.loading,
      ...state.counts,
      firstItem: state.items[0] || null,
    });
    subscribers.forEach((callback) => callback(state));
  }

  function settleSource(key, status, error) {
    statuses.set(key, status);
    if (error) {
      sourceError = "Notifications could not be loaded. Check your connection and try again.";
      debug(`${key} failed:`, error);
    }
    if (loading) {
      loading = false;
      clearTimeout(timeoutId);
    }
    publish();
  }

  function clearListeners() {
    listenerStops.forEach((stop) => stop());
    listenerStops.clear();
    registrations.clear();
    firestoreRegistrations.clear();
    rtdbRegistrations.clear();
    legacyRegistrationLoads.clear();
    registrationErrors.clear();
    clearTimeout(academicCalendarTimer);
    academicCalendarTimer = null;
    academicCalendarUnsubscribe?.();
    academicCalendarUnsubscribe = null;
    academicCalendarItems = [];
  }

  function reset(uid) {
    clearListeners();
    activeUid = uid || "";
    loading = true;
    sourceError = "";
    statuses.clear();
    firestoreNotificationQueries.forEach((items) => items.clear());
    rtdbNotifications.clear();
    firestoreEventQueries.forEach((items) => items.clear());
    rtdbEvents.clear();
    readOverrides.clear();
    academicCalendarItems = [];
    readStoredNotifications(activeUid).forEach((item) => {
      if (item.id && typeof item.read === "boolean") {
        readOverrides.set(String(item.id), item.read);
      }
    });
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      if (loading) {
        loading = false;
        publish();
      }
    }, 5000);
    if (!activeUid) {
      loading = false;
      clearTimeout(timeoutId);
    }
    publish();
  }

  function listen(key, reference, onData) {
    statuses.set(key, "pending");
    try {
      const stop = firestoreModule.onSnapshot(reference, (snapshot) => {
        onData(snapshot);
        settleSource(key, "ready");
      }, (error) => settleSource(key, "error", error));
      listenerStops.set(key, stop);
    } catch (error) {
      settleSource(key, "error", error);
    }
  }

  function attachRegistrations(uid, events) {
    const selected = events.slice(0, MAX_EVENTS);
    const selectedIds = new Set(selected.map((event) => event.id));
    [...listenerStops.keys()].forEach((key) => {
      const eventId = key.startsWith("registration-fallback:")
        ? key.slice("registration-fallback:".length)
        : key.startsWith("registration:")
          ? key.slice("registration:".length)
          : "";
      if (eventId && !selectedIds.has(eventId)) {
        listenerStops.get(key)?.();
        listenerStops.delete(key);
        registrations.delete(eventId);
        firestoreRegistrations.delete(eventId);
        rtdbRegistrations.delete(eventId);
        legacyRegistrationLoads.delete(eventId);
        registrationErrors.delete(eventId);
      }
    });
    selected.forEach((event) => {
      const key = `registration:${event.id}`;
      if (!firebase?.db || !firestoreModule) return;
      const registrationsRef = firestoreModule.query(
        firestoreModule.collection(firebase.db, "events", event.id, "registrations"),
        firestoreModule.limit(MAX_REGISTRATIONS_PER_EVENT),
      );
      if (!legacyRegistrationLoads.has(event.id)) {
        legacyRegistrationLoads.add(event.id);
        const getDocsCached = readCacheModule?.getDocsCached;
        const read = getDocsCached
          ? getDocsCached(
              firestoreModule.getDocs,
              registrationsRef,
              `legacy-registrations:${event.id}`,
              uid,
            )
          : firestoreModule.getDocs(registrationsRef);
        read.then((snapshot) => {
          if (uid !== activeUid || !selectedIds.has(event.id)) return;
          firestoreRegistrations.set(event.id, snapshot.docs.map((document) => ({
            ...document.data(),
            uid: document.data().uid || document.id,
          })));
          updateRegistrationDocuments(event.id);
        }).catch((error) => {
          if (!registrationErrors.has(event.id)) {
            registrationErrors.add(event.id);
            debug(`Could not read legacy registrations for ${event.id}:`, error);
          }
        });
      }

      if (listenerStops.has(key)) return;
      if (firebase?.isRtdbConfigured && firebase.rtdb && databaseModule) {
        try {
          const stop = databaseModule.onValue(
            databaseModule.ref(firebase.rtdb, `eventRegistrations/${event.id}`),
            (snapshot) => {
              const value = snapshot.val();
              const items = value && typeof value === "object"
                ? Object.entries(value).map(([uidKey, data]) => ({
                    ...data,
                    uid: data?.uid || uidKey,
                  }))
                : [];
              rtdbRegistrations.set(event.id, items);
              updateRegistrationDocuments(event.id);
            },
            (error) => {
              if (!registrationErrors.has(event.id)) {
                registrationErrors.add(event.id);
                debug(`Could not read RTDB registrations for ${event.id}; using Firestore updates:`, error);
              }
              rtdbRegistrations.delete(event.id);
              updateRegistrationDocuments(event.id);
              attachFirestoreRegistrationFallback(event.id, registrationsRef);
            },
          );
          listenerStops.set(key, stop);
        } catch (error) {
          debug(`Could not subscribe to RTDB registrations for ${event.id}; using Firestore updates:`, error);
          attachFirestoreRegistrationFallback(event.id, registrationsRef);
        }
      } else {
        attachFirestoreRegistrationFallback(event.id, registrationsRef);
      }
    });
  }

  function attachFirestoreRegistrationFallback(eventId, registrationsRef) {
    const key = `registration-fallback:${eventId}`;
    if (listenerStops.has(key) || !firestoreModule) return;
    try {
      const stop = firestoreModule.onSnapshot(registrationsRef, (snapshot) => {
        firestoreRegistrations.set(eventId, snapshot.docs.map((document) => ({
          ...document.data(),
          uid: document.data().uid || document.id,
        })));
        updateRegistrationDocuments(eventId);
      }, (error) => {
        if (!registrationErrors.has(eventId)) {
          registrationErrors.add(eventId);
          debug(`Could not read registrations for ${eventId}; skipping registration notifications:`, error);
        }
        firestoreRegistrations.delete(eventId);
        updateRegistrationDocuments(eventId);
      });
      listenerStops.set(key, stop);
    } catch (error) {
      if (!registrationErrors.has(eventId)) {
        registrationErrors.add(eventId);
        debug(`Could not subscribe to registrations for ${eventId}:`, error);
      }
    }
  }

  function startFirestore(uid) {
    if (!firebase?.db || !firestoreModule) return;
    const eventsRef = firestoreModule.collection(firebase.db, "events");
    const notificationsRef = firestoreModule.collection(firebase.db, "notifications");
    listen("notifications:userId", firestoreModule.query(
      notificationsRef,
      firestoreModule.where("userId", "==", uid),
      firestoreModule.limit(100),
    ), (snapshot) => {
      const target = firestoreNotificationQueries.get("userId");
      target.clear();
      snapshot.docs.forEach((document) => target.set(
        document.id,
        { ...document.data(), id: document.id, source: "firestore" },
      ));
    });
    listen("notifications:recipientUid", firestoreModule.query(
      notificationsRef,
      firestoreModule.where("recipientUid", "==", uid),
      firestoreModule.limit(100),
    ), (snapshot) => {
      const target = firestoreNotificationQueries.get("recipientUid");
      target.clear();
      snapshot.docs.forEach((document) => target.set(
        document.id,
        { ...document.data(), id: document.id, source: "firestore" },
      ));
    });

    ["organizerId", "organizerUid"].forEach((field) => {
      const key = `events:${field}`;
      listen(key, firestoreModule.query(
        eventsRef,
        firestoreModule.where(field, "==", uid),
        firestoreModule.limit(MAX_OWN_EVENTS_PER_QUERY),
      ), (snapshot) => {
        const target = firestoreEventQueries.get(field);
        target.clear();
        snapshot.docs.forEach((document) => target.set(
          document.id,
          { ...document.data(), id: document.id },
        ));
        attachRegistrations(uid, selectedEvents());
      });
    });
  }

  function startRtdb(uid) {
    if (!firebase?.isRtdbConfigured || !firebase.rtdb || !databaseModule) return;
    [
      ["rtdb:notifications", `notifications/${uid}`, rtdbNotifications],
      ["rtdb:events", `organizerEvents/${uid}`, rtdbEvents],
    ].forEach(([key, path, target]) => {
      statuses.set(key, "pending");
      try {
        const sourceRef = databaseModule.query(
          databaseModule.ref(firebase.rtdb, path),
          databaseModule.limitToLast(100),
        );
        const stop = databaseModule.onValue(
          sourceRef,
          (snapshot) => {
            target.clear();
            const value = snapshot.val();
            if (value && typeof value === "object") {
              Object.entries(value).forEach(([id, data]) => {
                if (data && typeof data === "object") {
                  target.set(id, { ...data, id, source: key === "rtdb:notifications" ? "rtdb" : "event" });
                }
              });
            }
            if (key === "rtdb:events") attachRegistrations(uid, selectedEvents());
            settleSource(key, "ready");
          },
          (error) => settleSource(key, "error", error),
        );
        listenerStops.set(key, stop);
      } catch (error) {
        settleSource(key, "error", error);
      }
    });
  }

  function start(uid) {
    reset(uid);
    if (!uid) return;
    if (!firebase?.db || !firestoreModule) {
      sourceError = "Notifications are unavailable because Firebase is not configured.";
      statuses.set("firebase", "error");
      loading = false;
      clearTimeout(timeoutId);
      publish();
      return;
    }
    startFirestore(uid);
    startRtdb(uid);
    startAcademicCalendar(uid);
  }

  function startAcademicCalendar(uid) {
    let settled = false;
    const finish = (items) => {
      if (settled || !lifecycleActive || uid !== activeUid) return;
      settled = true;
      clearTimeout(academicCalendarTimer);
      academicCalendarTimer = null;
      academicCalendarItems = (items || []).map((item) => ({
        ...item,
        type: "academic_calendar",
        source: "derived",
        createdAt: null,
        ownerUid: uid,
        read: readOverrides.get(String(item.id)) === true,
      }));
      settleSource("academicCalendar", "ready");
    };
    academicCalendarTimer = setTimeout(() => {
      debug("Academic calendar notifications timed out.");
      finish([]);
    }, 5000);
    import("../academicCalendarStore.js")
      .then(({ subscribeCalendarAlerts }) => {
        if (settled || !lifecycleActive || uid !== activeUid) return;
        academicCalendarUnsubscribe = subscribeCalendarAlerts(
          firebase.db,
          finish,
          (error) => {
            debug("Academic calendar notification source failed:", error);
            finish([]);
          },
        );
      })
      .catch((error) => {
        debug("Could not start academic calendar notifications:", error);
        finish([]);
      });
  }

  function fallbackUid() {
    try {
      const profile = JSON.parse(localStorage.getItem("recovibeOrganizerProfile") || "{}");
      return String(
        profile.uid || profile.userId || profile.id ||
        localStorage.getItem("recovibeOrganizerId") || "",
      ).trim();
    } catch (error) {
      debug("Could not read cached organizer profile for the no-auth fallback:", error);
      return String(localStorage.getItem("recovibeOrganizerId") || "").trim();
    }
  }

  async function initialize() {
    if (initialized || !lifecycleActive) return;
    initialized = true;
    try {
      [firebase, authModule, firestoreModule, readCacheModule] = await Promise.all([
        import("../UserStudent/firebaseConfig.js"),
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
        import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
        import("../firestoreReadCache.js"),
      ]);
      try {
        databaseModule = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js");
      } catch (error) {
        databaseModule = null;
        debug("Realtime Database SDK is unavailable; skipping RTDB notification sources:", error);
      }
      await firebase.authReady;
      if (!firebase.auth) {
        const uid = fallbackUid();
        if (uid) debug("Using cached organizer uid because there is no Auth user:", uid);
        start(uid);
        return;
      }
      authUnsubscribe = authModule.onAuthStateChanged(firebase.auth, (user) => {
        const uid = user?.uid || fallbackUid();
        if (!user && uid) debug("Using cached organizer uid because there is no Auth user:", uid);
        debug("Using organizer uid:", uid || "(none)");
        start(uid);
      });
    } catch (error) {
      sourceError = "Notifications could not be initialized. Check your connection and try again.";
      statuses.set("initialization", "error");
      loading = false;
      clearTimeout(timeoutId);
      debug("Could not initialize notification listeners:", error);
      publish();
    }
  }

  function stop() {
    lifecycleActive = false;
    initialized = false;
    authUnsubscribe?.();
    authUnsubscribe = null;
    clearListeners();
    clearTimeout(timeoutId);
  }

  function subscribe(callback) {
    subscribers.add(callback);
    callback({
      uid: activeUid,
      items: activeUid ? mergedItems() : [],
      loading,
      error: allSourcesFailed() ? sourceError : "",
      counts: { merged: activeUid ? mergedItems().length : 0 },
    });
    return () => subscribers.delete(callback);
  }

  function setRead(id, read) {
    readOverrides.set(String(id), Boolean(read));
    publish();
  }

  function markPermanentlyDeleted(id) {
    const notificationId = String(id || "");
    if (!activeUid || !notificationId) {
      throw new Error("The signed-in organizer or notification could not be verified.");
    }
    let existing = [];
    try {
      const value = JSON.parse(localStorage.getItem(PERMANENTLY_DELETED_STORAGE_KEY) || "[]");
      if (Array.isArray(value)) existing = value;
    } catch (error) {
      debug("Could not read permanently deleted notification state:", error);
    }
    const otherUsers = existing.filter((item) => item?.ownerUid !== activeUid);
    const currentUser = existing.filter(
      (item) => item?.ownerUid === activeUid && String(item.id) !== notificationId,
    );
    localStorage.setItem(
      PERMANENTLY_DELETED_STORAGE_KEY,
      JSON.stringify([...otherUsers, ...currentUser, { id: notificationId, ownerUid: activeUid }]),
    );
    publish();
  }

  function retry() {
    if (activeUid) start(activeUid);
    else {
      initialized = false;
      lifecycleActive = true;
      void initialize();
    }
  }

  window.OrganizerNotificationData = { subscribe, setRead, markPermanentlyDeleted, retry };
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      lifecycleActive = true;
      void initialize();
    }
  });
  window.addEventListener("recovibeOrganizerNotificationsChanged", () => {
    readStoredNotifications(activeUid).forEach((item) => {
      if (item.id && typeof item.read === "boolean") {
        readOverrides.set(String(item.id), item.read);
      }
    });
    publish();
  });
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      readOverrides.clear();
      readStoredNotifications(activeUid).forEach((item) => {
        if (item.id && typeof item.read === "boolean") {
          readOverrides.set(String(item.id), item.read);
        }
      });
      publish();
    }
  });
  void initialize();
})();
