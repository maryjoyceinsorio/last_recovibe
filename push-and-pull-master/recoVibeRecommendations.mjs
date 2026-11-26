function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function textValues(value) {
  if (value == null) return [];
  if (Array.isArray(value) || value instanceof Set) {
    return Array.from(value).flatMap(textValues);
  }
  if (typeof value === "object") return Object.values(value).flatMap(textValues);
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text ? [text] : [];
  }
  return [];
}

function hasTerm(value, term) {
  const normalizedValue = normalizeText(value);
  const normalizedTerm = normalizeText(term);
  return Boolean(
    normalizedTerm &&
      ` ${normalizedValue} `.includes(` ${normalizedTerm} `),
  );
}

function getTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventStart(event) {
  return getTimestamp(event.startMs || event.startAt || event.dateISO);
}

function eventEnd(event, startAt) {
  return getTimestamp(event.endMs || event.endAt || event.endDateISO) || startAt;
}

function isActiveOrUpcoming(event, now) {
  const status = normalizeText(
    event.status ||
      event.eventStatus ||
      event.event_status ||
      event.publicationStatus ||
      event.publication_status,
  );
  if (["cancelled", "canceled", "completed", "complete", "ended", "finished"].includes(status)) {
    return false;
  }
  const startAt = eventStart(event);
  const endAt = eventEnd(event, startAt);
  return startAt > 0 && endAt > now;
}

function eventSearchText(event) {
  return [
    event.name,
    event.title,
    event.description,
    event.category,
    event.categories,
    event.tags,
    event.tag,
    event.source,
    event.organizationName,
    event.organization,
    event.targetAudience,
    event.targetDepartments,
    event.targetDepartmentIds,
    event.targetOrganizations,
    event.targetOrgs,
  ]
    .flatMap(textValues)
    .map(normalizeText)
    .filter(Boolean)
    .join(" ");
}

function formatSchedule(startAt) {
  if (!startAt) return "date and time not listed";
  return new Intl.DateTimeFormat("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  }).format(startAt);
}

export function isEventRecommendationQuestion(text) {
  const query = normalizeText(text);
  const asksForEvents = /\b(events?|activities|activity)\b/.test(query);
  const asksPersonally = /\bfor me\b|\bfor my\b|\bpersonalized\b|\btailored\b|\bmy recommendations\b/.test(query);
  const asksToRecommend = /\b(recommend|recommended|recommendation|recommendations|suggest|suggested|suggestion|suggestions)\b/.test(query);
  return (asksForEvents && (asksToRecommend || asksPersonally)) ||
    (asksToRecommend && asksPersonally);
}

export function buildPersonalizedEventRecommendations(events, studentContext = {}, now = Date.now()) {
  const loadedEvents = Array.isArray(events) ? events.filter((event) => event && typeof event === "object") : [];
  const upcoming = loadedEvents
    .filter((event) => isActiveOrUpcoming(event, now))
    .sort((a, b) => eventStart(a) - eventStart(b));

  if (!upcoming.length) {
    return "I don't see any active or upcoming events in the events already loaded on this page. Check the Events page later for updates.";
  }

  const pastEventIds = new Set(textValues(studentContext.pastEventIds));
  const pastInterestTerms = loadedEvents
    .filter((event) => pastEventIds.has(String(event.id || event.eventId || "")))
    .filter((event) => eventEnd(event, eventStart(event)) <= now)
    .flatMap((event) => [
      ...textValues(event.categories || event.category),
      ...textValues(event.tags || event.tag),
    ]);

  const signals = [
    ...textValues(studentContext.interests).map((term) => ({ term, reason: "interest" })),
    ...textValues(studentContext.categories).map((term) => ({ term, reason: "interest" })),
    ...textValues(studentContext.tags).map((term) => ({ term, reason: "interest" })),
    ...textValues(studentContext.programs).map((term) => ({ term, reason: "program" })),
    ...textValues(studentContext.departments).map((term) => ({ term, reason: "program" })),
    ...textValues(studentContext.organizations).map((term) => ({ term, reason: "organization" })),
    ...textValues(studentContext.preferredOrganizations).map((term) => ({ term, reason: "organization" })),
    ...pastInterestTerms.map((term) => ({ term, reason: "participation" })),
  ].filter(({ term }) => normalizeText(term).length > 1);

  const weights = { interest: 8, organization: 7, program: 6, participation: 5 };
  const reasonText = (reason, term) => {
    if (reason === "interest") return `matches your interest in ${term}`;
    if (reason === "program") return `is relevant to your program or course (${term})`;
    if (reason === "organization") return `is connected to your organization (${term})`;
    return `is similar to an event category you've participated in (${term})`;
  };
  const ranked = upcoming.map((event) => {
    const searchable = eventSearchText(event);
    const matchedSignals = new Map();
    signals.forEach(({ term, reason }) => {
      if (!hasTerm(searchable, term)) return;
      const key = `${reason}:${normalizeText(term)}`;
      if (!matchedSignals.has(key)) matchedSignals.set(key, { term, reason });
    });
    const matches = Array.from(matchedSignals.values());
    const score = matches.reduce((total, match) => total + weights[match.reason], 0);
    return { event, matches, score, startAt: eventStart(event) };
  });
  const matched = ranked.filter((item) => item.score > 0);
  const selected = (matched.length ? matched : ranked).slice(0, 3);
  const intro = matched.length
    ? "Based on your saved interests and student profile, these active or upcoming events may suit you:"
    : "I couldn't find an exact match to the interests or profile details currently available, but here are active or upcoming events to explore:";
  const rows = selected.map(({ event, matches, startAt }) => {
    const title = event.name || event.title || "Untitled event";
    const venue = event.venue || event.location || "Venue not listed";
    const why = matches.length
      ? matches.slice(0, 2).map(({ reason, term }) => reasonText(reason, term)).join(" and ")
      : "suggested as one of the next active or upcoming events";
    return `• ${title} — ${formatSchedule(startAt)} · ${venue}. Why: ${why}.`;
  });

  return `${intro}\n${rows.join("\n")}`;
}
