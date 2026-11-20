import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./UserStudent/firebaseConfig.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEBUG = false;

export const DEFAULTS = Object.freeze({
  global_config: Object.freeze({
    loginEnabled: true,
    registrationEnabled: true,
    organizations: [
      { code: "ACES", name: "Association of Computer Engineering Students", adviserEmail: "" },
      { code: "HRSS", name: "Human Resource Students Society", adviserEmail: "" },
      { code: "IBITS", name: "Institute of Bachelors in Information Technology Studies", adviserEmail: "" },
      { code: "PIIE", name: "Philippine Institute of Industrial Engineers – PUP Biñan Student Chapter", adviserEmail: "" },
      { code: "SMS", name: "Samahan ng mga Mag-aaral ng Sikolohiya", adviserEmail: "" },
      { code: "YES", name: "Young Educators' Society", adviserEmail: "" },
    ],
  }),
  access: Object.freeze({
    message: "",
  }),
  events: Object.freeze({
    minimumDaysBeforeEvent: 7,
    maximumDurationDays: 7,
    maximumEventsPerOrganizationPerMonth: 5,
    defaultCapacity: 100,
    detectVenueConflicts: true,
    finalDocumentsDueDaysAfterEvent: 7,
    allowedCategories: [
      "Academic & Learning",
      "Arts & Culture",
      "Sports & Fitness",
      "Community Service",
      "Other",
    ],
  }),
  registration: Object.freeze({
    opensDaysBeforeEvent: 30,
    closesHoursBeforeStart: 1,
    studentCancellationHoursBeforeStart: 24,
    qrCheckInOpensMinutesBeforeStart: 30,
    qrCheckInClosesMinutesAfterStart: 60,
    walkInAllowed: false,
    markAbsentAfterEventEnds: true,
  }),
  notifications: Object.freeze({
    eventSubmitted: true,
    eventApproved: true,
    eventRejected: true,
    eventPublished: true,
    eventCancelledOrRescheduled: true,
    registrationConfirmation: true,
    eventTomorrowReminder: true,
  }),
  calendar: Object.freeze({
    holidays: [],
    holidayEventPolicy: "warn",
  }),
  audience: Object.freeze({
    departments: [
      { code: "BSCpE", name: "Bachelor of Science in Computer Engineering", active: true },
      { code: "BSBA-HRM", name: "Bachelor of Science in Business Administration major in Human Resource Management", active: true },
      { code: "BSIT", name: "Bachelor of Science in Information Technology", active: true },
      { code: "DIT", name: "Diploma in Information Technology", active: true },
      { code: "BSIE", name: "Bachelor of Science in Industrial Engineering", active: true },
      { code: "BSP", name: "Bachelor of Science in Psychology", active: true },
      { code: "BEEd", name: "Bachelor of Elementary Education", active: true },
      { code: "BSEd", name: "Bachelor of Secondary Education", active: true },
    ],
    programs: [
      { code: "BSCpE", name: "Bachelor of Science in Computer Engineering", active: true },
      { code: "BSBA-HRM", name: "Bachelor of Science in Business Administration major in Human Resource Management", active: true },
      { code: "BSIT", name: "Bachelor of Science in Information Technology", active: true },
      { code: "DIT", name: "Diploma in Information Technology", active: true },
      { code: "BSIE", name: "Bachelor of Science in Industrial Engineering", active: true },
      { code: "BSP", name: "Bachelor of Science in Psychology", active: true },
      { code: "BEEd", name: "Bachelor of Elementary Education", active: true },
      { code: "BSEd", name: "Bachelor of Secondary Education", active: true },
    ],
  }),
});

const cache = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function invalidateSystemSettingsCache(section) {
  if (section) {
    cache.delete(section);
    return;
  }
  cache.clear();
}

export async function getSystemSettings(section) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, section)) {
    throw new Error(`Unknown system settings section: ${section}`);
  }

  const cached = cache.get(section);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return clone(cached.value);
  }

  const fallback = clone(DEFAULTS[section]);
  try {
    if (!db) throw new Error("Firestore is not configured.");
    const snapshot = await getDoc(doc(db, "system_settings", section));
    const value = snapshot.exists()
      ? { ...fallback, ...snapshot.data() }
      : fallback;
    cache.set(section, { loadedAt: Date.now(), value });
    return clone(value);
  } catch (error) {
    if (DEBUG) console.warn(`[systemSettingsDefaults] Using ${section} defaults:`, error);
    cache.set(section, { loadedAt: Date.now(), value: fallback });
    return clone(fallback);
  }
}
