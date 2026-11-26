import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getDocCached } from "./firestoreReadCache.js";

const ACCESS_SETTINGS_PATH = ["systemSettings", "default"];
const MAINTENANCE_NOTICE_KEY = "recovibeMaintenanceNotice";
const PORTAL_ROLE_NOTICE_KEY = "recovibePortalRoleNotice";
const PORTAL_PROFILE_CACHE_KEYS = [
  "recovibeCurrentUser",
  "recovibeCurrentTeacher",
  "recovibeTeacher",
  "recovibeTeacherId",
  "recovibeCurrentOrganizer",
  "recovibeOrganizer",
  "recovibeOrganizerProfile",
  "recovibeOrganizerId",
  "recovibeAdminProfile",
  "recovibeAdminId",
  "recovibeSuperAdminProfile",
];
const DEFAULT_MAINTENANCE_MESSAGE =
  "System maintenance is in progress. Sign-in is temporarily unavailable. Please try again later.";
const ACCESS_SETTINGS_CACHE_MS = 15000;
let cachedAccessSettings = null;
let cachedAccessSettingsExpiresAt = 0;
let accessSettingsReadPromise = null;
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
  if (cachedAccessSettings && Date.now() < cachedAccessSettingsExpiresAt) {
    return { ...cachedAccessSettings };
  }
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
  if (cachedAccessSettings && Date.now() < cachedAccessSettingsExpiresAt) {
    return { ...cachedAccessSettings };
  }
  if (accessSettingsReadPromise) return accessSettingsReadPromise;

  const request = (async () => {
    const snapshot = await getDocCached(
      getDoc,
      doc(db, ...ACCESS_SETTINGS_PATH),
      "system-settings",
      ACCESS_SETTINGS_CACHE_MS,
    );
    const settings = normalizeSettings(snapshot.exists() ? snapshot.data() : {});
    cacheSettings(settings);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("system-access-settings-changed", {
        detail: settings,
      }));
    }
    return settings;
  })();
  accessSettingsReadPromise = request;
  try {
    return await request;
  } finally {
    if (accessSettingsReadPromise === request) accessSettingsReadPromise = null;
  }
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

export function takePortalRoleNotice() {
  try {
    const message = sessionStorage.getItem(PORTAL_ROLE_NOTICE_KEY);
    if (message) sessionStorage.removeItem(PORTAL_ROLE_NOTICE_KEY);
    return message || "";
  } catch (error) {
    console.warn("[PortalRole] Could not read the portal notice:", {
      code: error?.code || "unknown",
      message: error?.message || String(error),
    });
    return "";
  }
}

export function clearPortalProfileCaches() {
  for (const storageName of ["localStorage", "sessionStorage"]) {
    try {
      const storage = window[storageName];
      PORTAL_PROFILE_CACHE_KEYS.forEach((key) => storage.removeItem(key));
    } catch (error) {
      console.warn("[PortalRole] Could not clear cached portal profiles:", {
        storage: storageName,
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
    }
  }
}

function profileRoles(profile) {
  return [
    profile?.role,
    profile?.userRole,
    ...(Array.isArray(profile?.roles) ? profile.roles : []),
  ].flatMap((value) =>
    String(value || "")
      .split(/[,&/|]+/)
      .map((role) => role.trim().toLowerCase().replace(/[^a-z0-9]/g, ""))
      .filter(Boolean),
  );
}

function profileIsInactive(profile) {
  const status = String(profile?.status || "").trim().toLowerCase();
  return profile?.isActive === false ||
    ["disabled", "inactive", "suspended"].includes(status);
}

async function getAccountRoleInfo(db, uid) {
  if (!db || !uid) return { role: "", roles: [] };
  const reads = await Promise.allSettled([
    getDocCached(getDoc, doc(db, "adminUser", uid), uid),
    getDocCached(getDoc, doc(db, "users", uid), uid),
    getDocCached(getDoc, doc(db, "students", uid), uid),
    getDocCached(getDoc, doc(db, "eventOrganizations", uid), uid),
  ]);
  const snapshots = reads.map((result) =>
    result.status === "fulfilled" ? result.value : null,
  );
  const adminProfile = snapshots[0]?.exists() ? snapshots[0].data() : null;
  const disabledAdminProfile = adminProfile && profileIsInactive(adminProfile);
  const profiles = snapshots.slice(0, 3)
    .filter((snapshot) => snapshot?.exists())
    .map((snapshot) => snapshot.data())
    .filter((profile) => {
      if (profileIsInactive(profile)) return false;
      if (
        disabledAdminProfile &&
        profileRoles(profile).some((role) =>
          ["admin", "osas", "superadmin"].includes(role),
        )
      ) {
        return false;
      }
      return true;
    });
  const roles = new Set(profiles.flatMap(profileRoles));
  if ([...roles].some((role) => ["superadmin", "superadministrator"].includes(role))) {
    roles.add("superadmin");
    return { role: "superadmin", roles: [...roles] };
  }
  const rolePriorities = [
    { role: "admin", aliases: ["admin", "osas"] },
    { role: "eventorganizer", aliases: ["eventorganizer", "organizer", "eo"] },
    { role: "teacher", aliases: ["teacher", "teacheradviser", "faculty", "adviser"] },
    { role: "student", aliases: ["student"] },
  ];
  for (const priority of rolePriorities) {
    if ([...roles].some((role) => priority.aliases.includes(role))) {
      roles.add(priority.role);
      return { role: priority.role, roles: [...roles] };
    }
  }
  const userProfile = snapshots[1]?.exists() ? snapshots[1].data() : {};
  const userHasStudentNumber = [
    userProfile.studentNumber,
    userProfile.student_number,
    userProfile.studentNo,
    userProfile.student_no,
    userProfile.studentId,
  ].some((value) => String(value || "").trim());
  if (
    (snapshots[2]?.exists() && !profileRoles(snapshots[2].data()).length) ||
    (userHasStudentNumber && !profileRoles(userProfile).length)
  ) {
    roles.add("student");
    return { role: "student", roles: [...roles] };
  }
  if (
    snapshots[3]?.exists() &&
    String(snapshots[3].data()?.organizationCode || "").trim()
  ) {
    roles.add("eventorganizer");
    return { role: "eventorganizer", roles: [...roles] };
  }
  const readError = reads.find((result) => result.status === "rejected");
  if (readError) throw readError.reason;
  return { role: "", roles: [...roles] };
}

async function getAccountRole(db, uid) {
  const account = await getAccountRoleInfo(db, uid);
  return account.role;
}

export function resolvePortalRole(db, uid) {
  if (!db || !uid) return Promise.resolve("");
  return getAccountRole(db, uid);
}

function loginPath(role) {
  const routes = {
    student: "UserStudent/StudentLogin.html",
    eventorganizer: "UserEventOrganizer/EventOrganizerLogin.html",
    admin: "UserAdmin/AdminLogin.html",
    teacher: "UserTeacher/TeacherLogin.html",
    superadmin: "UserSuperAdmin/SuperAdminLogin.html",
  };
  const route = routes[role] || routes.student;
  const pagePath = window.location.pathname;
  const sectionMatch = pagePath.match(
    /\/(?:UserStudent|UserAdmin|UserEventOrganizer|UserSuperAdmin|UserTeacher)\//i,
  );
  const appRoot = sectionMatch ? pagePath.slice(0, sectionMatch.index) : "";
  return `${appRoot}/${route}`;
}

const PORTAL_CONTEXTS = [
  {
    directory: "UserStudent",
    role: "student",
    label: "Student",
    home: "Dashboard.html",
    login: "StudentLogin.html",
  },
  {
    directory: "UserEventOrganizer",
    role: "eventorganizer",
    label: "Event Organizer",
    home: "EventOrganizerDashBoard.html",
    login: "EventOrganizerLogin.html",
  },
  {
    directory: "UserTeacher",
    role: "teacher",
    label: "Teacher",
    home: "TeacherDashBoard.html",
    login: "TeacherLogin.html",
  },
  {
    directory: "UserAdmin",
    role: "admin",
    label: "Admin",
    home: "AdminDashboard.html",
    login: "AdminLogin.html",
  },
  {
    directory: "UserSuperAdmin",
    role: "superadmin",
    label: "Super Admin",
    home: "SuperAdminDashboard.html",
    login: "SuperAdminLogin.html",
  },
];

function currentPortalContext() {
  const pathname = window.location.pathname;
  const match = pathname.match(
    /\/(UserStudent|UserEventOrganizer|UserTeacher|UserAdmin|UserSuperAdmin)\//i,
  );
  if (!match) return null;
  const context = PORTAL_CONTEXTS.find(
    (item) => item.directory.toLowerCase() === match[1].toLowerCase(),
  );
  const filename = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (
    !context ||
    /(?:Login|ForgetPassword|PasswordReset|Password-Reset|password-reset-request|Registration)\.html$/i.test(filename)
  ) {
    return null;
  }
  return {
    ...context,
    appRoot: pathname.slice(0, match.index),
  };
}

function roleLabel(role) {
  return PORTAL_CONTEXTS.find((context) => context.role === role)?.label || "another";
}

function showPortalRoleNotice(message) {
  if (!message || !document.body) return;
  const notice = document.createElement("div");
  notice.setAttribute("role", "status");
  notice.textContent = message;
  Object.assign(notice.style, {
    position: "fixed",
    top: "16px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    maxWidth: "min(92vw, 680px)",
    padding: "12px 18px",
    borderRadius: "10px",
    background: "#fff8e6",
    color: "#342500",
    boxShadow: "0 6px 24px rgba(0,0,0,.2)",
    font: "500 14px/1.45 system-ui, sans-serif",
  });
  document.body.append(notice);
  window.setTimeout(() => notice.remove(), 8000);
}

function createPortalRoleGate() {
  const gate = document.createElement("div");
  gate.setAttribute("role", "status");
  gate.textContent = "Verifying your portal account...";
  Object.assign(gate.style, {
    position: "fixed",
    inset: "0",
    zIndex: "2147483646",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background: "#f8f6f2",
    color: "#342500",
    font: "600 16px/1.5 system-ui, sans-serif",
    textAlign: "center",
  });
  (document.body || document.documentElement).append(gate);
  return gate;
}

function portalDestination(context, page) {
  return `${context.appRoot}/${context.directory}/${page}`;
}

export function startPortalRoleGuard(auth, db) {
  if (!auth || !db || typeof window === "undefined") return;
  const context = currentPortalContext();
  if (!context) return;

  const gate = createPortalRoleGate();
  let active = true;
  let redirecting = false;

  const redirectForRole = async (
    user,
    actualRole,
    message,
    destination,
    signOutUnverified = true,
  ) => {
    if (redirecting || !active) return;
    redirecting = true;
    try {
      sessionStorage.setItem(PORTAL_ROLE_NOTICE_KEY, message);
    } catch (error) {
      console.warn("[PortalRole] Could not save the portal notice:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
    }
    if (
      signOutUnverified &&
      !actualRole &&
      user &&
      auth.currentUser?.uid === user.uid
    ) {
      try {
        await signOut(auth);
      } catch (error) {
        console.error("[PortalRole] Could not sign out an unverified session:", {
          code: error?.code || "unknown",
          message: error?.message || String(error),
        });
      }
    }
    if (active) window.location.replace(destination);
  };

  const unsubscribe = onAuthStateChanged(auth, async (user) => {
    if (!active || redirecting) return;
    if (!user) {
      await redirectForRole(
        null,
        "",
        `Sign in to access the ${context.label} Portal.`,
        portalDestination(context, context.login),
      );
      return;
    }

    try {
      const account = await getAccountRoleInfo(db, user.uid);
      const actualRole = account.role;
      if (!active || auth.currentUser?.uid !== user.uid) return;
      if (!account.roles.includes(context.role)) {
        if (actualRole) {
          const destinationContext = PORTAL_CONTEXTS.find(
            (item) => item.role === actualRole,
          );
          const message = `You are signed in as ${roleLabel(actualRole)}. The ${context.label} Portal was blocked; opening your ${roleLabel(actualRole)} Portal instead.`;
          await redirectForRole(
            user,
            actualRole,
            message,
            destinationContext
              ? portalDestination(destinationContext, destinationContext.home)
              : loginPath(actualRole),
          );
        } else {
          await redirectForRole(
            user,
            "",
            "This account does not have a recognized portal role. Sign in with an authorized account.",
            portalDestination(context, context.login),
          );
        }
        return;
      }

      gate.remove();
      showPortalRoleNotice(takePortalRoleNotice());
    } catch (error) {
      console.error("[PortalRole] Could not verify the active account role:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      await redirectForRole(
        user,
        "",
        "Your portal role could not be verified. The page was blocked; please try again.",
        portalDestination(context, context.login),
        false,
      );
    }
  });

  window.addEventListener("pagehide", () => {
    active = false;
    unsubscribe();
  }, { once: true });
}

function cacheSettings(settings) {
  cachedAccessSettings = normalizeSettings(settings);
  cachedAccessSettingsExpiresAt = Date.now() + ACCESS_SETTINGS_CACHE_MS;
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
      cachedAccessSettingsExpiresAt = 0;
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
