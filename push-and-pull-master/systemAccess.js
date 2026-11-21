import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ACCESS_SETTINGS_PATH = ["systemSettings", "default"];
const MAINTENANCE_NOTICE_KEY = "recovibeMaintenanceNotice";
const DEFAULT_MAINTENANCE_MESSAGE =
  "System maintenance is in progress. Sign-in is temporarily unavailable. Please try again later.";
export const EVENT_REGISTRATION_CLOSED_MESSAGE =
  "Event registration is currently closed by the administrator.";

function normalizeSettings(data = {}) {
  const userLoginEnabled = typeof data.userLoginEnabled === "boolean"
    ? data.userLoginEnabled
    : typeof data.loginEnabled === "boolean"
      ? data.loginEnabled
      : true;
  const eventRegistrationEnabled = typeof data.eventRegistrationEnabled === "boolean"
    ? data.eventRegistrationEnabled
    : typeof data.registrationEnabled === "boolean"
      ? data.registrationEnabled
      : true;
  const maintenanceMessage = typeof data.maintenanceMessage === "string"
    ? data.maintenanceMessage
    : typeof data.message === "string"
      ? data.message
      : "";

  return {
    userLoginEnabled,
    eventRegistrationEnabled,
    maintenanceMessage,
    loginEnabled: userLoginEnabled,
    registrationEnabled: eventRegistrationEnabled,
  };
}

export function getCachedSystemAccessSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem("recovibeSystemSettings") || "{}");
    return normalizeSettings(stored);
  } catch (error) {
    console.warn("[SystemAccess] Could not read cached access settings:", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
    });
    return normalizeSettings();
  }
}

export async function readSystemAccessSettings(db) {
  if (!db) throw new Error("Firestore is not configured.");
  const snapshot = await getDoc(doc(db, ...ACCESS_SETTINGS_PATH));
  const settings = normalizeSettings(snapshot.exists() ? snapshot.data() : {});
  cacheSettings(settings);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("system-access-settings-changed", {
      detail: settings,
    }));
  }
  return settings;
}

export function maintenanceMessage(settings) {
  return String(settings?.maintenanceMessage || "").trim() ||
    DEFAULT_MAINTENANCE_MESSAGE;
}

export function takeMaintenanceNotice() {
  try {
    const message = sessionStorage.getItem(MAINTENANCE_NOTICE_KEY);
    if (message) sessionStorage.removeItem(MAINTENANCE_NOTICE_KEY);
    return message || "";
  } catch (error) {
    console.warn("[SystemAccess] Could not read the maintenance notice:", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
    });
    return "";
  }
}

function normalizeRole(profile) {
  return String(profile?.role || profile?.userRole || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function getAccountRole(db, uid) {
  const reads = await Promise.allSettled([
    getDoc(doc(db, "adminUser", uid)),
    getDoc(doc(db, "users", uid)),
    getDoc(doc(db, "eventOrganizations", uid)),
  ]);
  const snapshots = reads.map((result) =>
    result.status === "fulfilled" ? result.value : null,
  );
  const profiles = snapshots.slice(0, 2)
    .filter((snapshot) => snapshot?.exists())
    .map((snapshot) => snapshot.data());
  const roles = profiles.map(normalizeRole).filter(Boolean);
  if (roles.some((role) => ["superadmin", "superadministrator"].includes(role))) {
    return "superadmin";
  }

  const role = roles.find((value) =>
    [
      "admin",
      "eventorganizer",
      "organizer",
      "eo",
      "student",
      "teacher",
      "faculty",
      "adviser",
    ].includes(value),
  );
  if (role) {
    if (role === "organizer" || role === "eo") return "eventorganizer";
    if (role === "faculty" || role === "adviser") return "teacher";
    return role;
  }
  if (
    snapshots[2]?.exists() &&
    String(snapshots[2].data()?.organizationCode || "").trim()
  ) {
    return "eventorganizer";
  }
  const readError = reads.find((result) => result.status === "rejected");
  if (readError) throw readError.reason;
  return "";
}

function loginPath(role) {
  const routes = {
    student: "UserStudent/StudentLogin.html",
    eventorganizer: "UserEventOrganizer/EventOrganizerLogin.html",
    admin: "UserAdmin/AdminLogin.html",
    teacher: "UserTeacher/TeacherLogin.html",
  };
  const route = routes[role] || routes.student;
  const pagePath = window.location.pathname;
  const sectionMatch = pagePath.match(
    /\/(?:UserStudent|UserAdmin|UserEventOrganizer|UserSuperAdmin|UserTeacher)\//i,
  );
  const appRoot = sectionMatch ? pagePath.slice(0, sectionMatch.index) : "";
  return `${appRoot}/${route}`;
}

function cacheSettings(settings) {
  try {
    const cached = JSON.parse(
      localStorage.getItem("recovibeSystemSettings") || "{}",
    );
    localStorage.setItem(
      "recovibeSystemSettings",
      JSON.stringify({
        ...cached,
        ...settings,
      }),
    );
  } catch (error) {
    console.warn("[SystemAccess] Could not cache access settings:", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
    });
  }
}

export function startActiveSessionAccessGuard(auth, db) {
  if (
    typeof window === "undefined" ||
    !auth ||
    !db ||
    /(?:Student|Admin|EventOrganizer|SuperAdmin|Teacher)Login\.html$/i.test(
      window.location.pathname,
    )
  ) {
    return;
  }

  let active = true;
  let settingsReady = false;
  let settings = getCachedSystemAccessSettings();
  let currentUser = null;
  let enforcingUid = "";

  const publishSettings = (nextSettings) => {
    settings = normalizeSettings(nextSettings);
    settingsReady = true;
    cacheSettings(settings);
    window.dispatchEvent(new CustomEvent("system-access-settings-changed", {
      detail: settings,
    }));
    void enforceCurrentSession();
  };

  const enforceCurrentSession = async () => {
    const user = currentUser;
    if (
      !active ||
      !settingsReady ||
      !user ||
      settings.userLoginEnabled !== false ||
      enforcingUid === user.uid
    ) {
      return;
    }

    enforcingUid = user.uid;
    try {
      const role = await getAccountRole(db, user.uid);
      if (
        !active ||
        auth.currentUser?.uid !== user.uid ||
        settings.userLoginEnabled !== false ||
        role === "superadmin"
      ) {
        return;
      }

      try {
        sessionStorage.setItem(
          MAINTENANCE_NOTICE_KEY,
          maintenanceMessage(settings),
        );
      } catch (error) {
        console.warn("[SystemAccess] Could not save the maintenance notice:", {
          code: error?.code || "unknown",
          message: error?.message || String(error),
        });
      }

      await signOut(auth);
      if (active) window.location.replace(loginPath(role));
    } catch (error) {
      console.error("[SystemAccess] Could not verify the active account:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      if (active && auth.currentUser?.uid === user.uid) {
        try {
          sessionStorage.setItem(
            MAINTENANCE_NOTICE_KEY,
            maintenanceMessage(settings),
          );
          await signOut(auth);
          if (active) window.location.replace(loginPath(""));
        } catch (signOutError) {
          console.error("[SystemAccess] Could not end the restricted session:", {
            code: signOutError?.code || "unknown",
            message: signOutError?.message || String(signOutError),
          });
        }
      }
    } finally {
      if (enforcingUid === user.uid) enforcingUid = "";
    }
  };

  const unsubscribeSettings = onSnapshot(
    doc(db, ...ACCESS_SETTINGS_PATH),
    (snapshot) => publishSettings(snapshot.exists() ? snapshot.data() : {}),
    (error) => {
      console.error("[SystemAccess] Settings listener failed:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      settingsReady = true;
      window.dispatchEvent(new CustomEvent("system-access-settings-changed", {
        detail: { ...settings, error },
      }));
      void enforceCurrentSession();
    },
  );
  const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
    currentUser = user;
    void enforceCurrentSession();
  });

  window.addEventListener("pagehide", () => {
    active = false;
    unsubscribeSettings();
    unsubscribeAuth();
  }, { once: true });
}
