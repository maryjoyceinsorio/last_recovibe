import { isStudentEventPublished } from "../UserStudent/eventAudience.js";

const MANILA_OFFSET_HOURS = 8;

function isValidCalendarDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function parseEventInstant(value) {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 100000000000 ? value * 1000 : value;
  }
  if (value && typeof value.toDate === "function") {
    try {
      return parseEventInstant(value.toDate());
    } catch {
      return null;
    }
  }
  if (value && typeof value.toMillis === "function") {
    try {
      const millis = value.toMillis();
      return Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }
  if (value && typeof value === "object") {
    const seconds = Number(value.seconds ?? value._seconds);
    const nanoseconds = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      return seconds * 1000 + nanoseconds / 1000000;
    }
  }
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (!text || /^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const normalized = text.replace(
    /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)/,
    "$1T$2",
  );
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized);
  const localIso = /^\d{4}-\d{2}-\d{2}T/.test(normalized);
  const dateText = localIso && !hasTimezone
    ? `${normalized}+08:00`
    : normalized;
  const millis = Date.parse(dateText);
  return Number.isFinite(millis) ? millis : null;
}

function manilaDateParts(value) {
  const dateOnly = typeof value === "string" &&
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    return isValidCalendarDate(year, month, day) ? { year, month, day } : null;
  }

  let millis = parseEventInstant(value);
  if (millis === null && value) {
    const date = value instanceof Date ? value : new Date(String(value));
    millis = date.getTime();
  }
  if (!Number.isFinite(millis)) return null;

  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(millis));
  const parts = Object.fromEntries(dateParts.map(({ type, value: part }) => [type, part]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

export function eventDateISO(value) {
  const parts = manilaDateParts(value);
  if (!parts) return "";
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function toEventDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value.toDate === "function") {
    try {
      return toEventDate(value.toDate());
    } catch {
      return null;
    }
  }
  const dateOnly = typeof value === "string" &&
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    return isValidCalendarDate(year, month, day)
      ? new Date(year, month - 1, day)
      : null;
  }
  const instant = parseEventInstant(value);
  if (instant !== null) return new Date(instant);
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseTime(value) {
  const match = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)?$/i.exec(
    String(value || "").trim(),
  );
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const second = Number(match[3] || 0);
  const meridiem = String(match[4] || "").toUpperCase();
  if (minute > 59 || second > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (meridiem === "PM") hour += 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute, second };
}

function parseTimeRange(value) {
  const match = /^\s*(.+?)\s*(?:-|–|—|\bto\b)\s*(.+?)\s*$/i.exec(
    String(value || ""),
  );
  if (!match) return null;
  const start = parseTime(match[1]);
  const end = parseTime(match[2]);
  return start && end ? [start, end] : null;
}

function boundaryTime(event, isEnd) {
  const schedule = event.schedule && typeof event.schedule === "object"
    ? event.schedule
    : {};
  const directValues = isEnd
    ? [event.endTime, event.timeEnd, schedule.endTime, schedule.timeEnd, schedule.end]
    : [event.startTime, event.timeStart, schedule.startTime, schedule.timeStart, schedule.start];
  for (const value of directValues) {
    const parsed = parseTime(value);
    if (parsed) return parsed;
    const range = parseTimeRange(value);
    if (range) return range[isEnd ? 1 : 0];
  }

  const rangeValues = [
    event.time,
    event.timeRange,
    schedule.time,
    schedule.timeRange,
    event.startTime,
    event.timeStart,
    event.endTime,
    event.timeEnd,
    schedule.startTime,
    schedule.timeStart,
    schedule.endTime,
    schedule.timeEnd,
    schedule.start,
    schedule.end,
  ];
  for (const value of rangeValues) {
    const range = parseTimeRange(value);
    if (range) return range[isEnd ? 1 : 0];
    if (!isEnd) {
      const parsed = parseTime(value);
      if (parsed) return parsed;
    }
  }
  return null;
}

export function eventBoundaryMillis(event, isEnd = false) {
  const schedule = event.schedule && typeof event.schedule === "object"
    ? event.schedule
    : {};
  const directValue = isEnd
    ? event.endAt || event.endsAt || event.endDateTime ||
      schedule.endAt || schedule.endDateTime || schedule.end
    : event.startAt || event.startsAt || event.startDateTime ||
      schedule.startAt || schedule.startDateTime || schedule.start;
  const directMillis = parseEventInstant(directValue);
  if (directMillis !== null) return directMillis;

  const startDate = event.dateISO || event.eventDate || event.event_date ||
    event.dateStart || event.date || event.startDate || event.start_date ||
    schedule.date || schedule.startDate || schedule.startDateTime;
  const dateValue = isEnd
    ? event.endDateISO || event.dateEnd || event.endDate || event.end_date ||
      schedule.endDate || schedule.dateEnd || schedule.endDateTime || startDate
    : startDate;
  const parts = manilaDateParts(dateValue);
  if (!parts) return null;

  const time = boundaryTime(event, isEnd) || (isEnd
    ? { hour: 23, minute: 59, second: 59, millisecond: 999 }
    : { hour: 0, minute: 0, second: 0, millisecond: 0 });
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    time.hour - MANILA_OFFSET_HOURS,
    time.minute,
    time.second,
    time.millisecond || 0,
  );
}

export function getCurrentlyLivePublishedEvents(events, now = Date.now()) {
  return events
    .filter((event) => {
      if (!isStudentEventPublished(event)) return false;
      const statuses = [
        event.status,
        event.eventStatus,
        event.event_status,
        event.publicationStatus,
        event.publication_status,
      ].map((status) =>
        String(status || "").trim().toLowerCase().replace(/[ _-]+/g, " "),
      );
      if (
        statuses.some((status) =>
          ["completed", "complete", "ended", "finished", "cancelled", "canceled"].includes(status),
        ) ||
        [
          event.completed,
          event.isCompleted,
          event.ended,
          event.isEnded,
          event.cancelled,
          event.canceled,
        ].some((value) =>
          value === true || value === 1 ||
          ["true", "yes", "1"].includes(String(value || "").trim().toLowerCase()),
        )
      ) {
        return false;
      }
      const start = eventBoundaryMillis(event);
      const end = eventBoundaryMillis(event, true);
      return start !== null && end !== null && now >= start && now <= end;
    })
    .sort((first, second) =>
      eventBoundaryMillis(first) - eventBoundaryMillis(second),
    );
}
