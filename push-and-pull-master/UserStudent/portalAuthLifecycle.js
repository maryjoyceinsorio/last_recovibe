import { getAuth, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { app } from "./firebaseApp.js";

const portals = {
  UserStudent: {
    login: "StudentLogin.html",
    dashboard: "Dashboard.html",
    keys: ["recovibeCurrentUser"],
  },
  UserEventOrganizer: {
    login: "EventOrganizerLogin.html",
    dashboard: "EventOrganizerDashBoard.html",
    keys: [
      "recovibeOrganizerId",
      "recovibeOrganizerProfile",
      "recovibeCurrentOrganizer",
      "recovibeTeacherId",
      "recovibeOrganizer",
    ],
  },
  UserSuperAdmin: {
    login: "SuperAdminLogin.html",
    dashboard: "SuperAdminDashboard.html",
    keys: [
      "recovibeAdminId",
      "recovibeAdminProfile",
      "recovibeSuperAdminPassword",
    ],
  },
};

const pathParts = window.location.pathname.split("/").filter(Boolean);
const portalName = pathParts[pathParts.length - 2];
const portal = portals[portalName];
const pageName = pathParts[pathParts.length - 1] || "";
const auth = app ? getAuth(app) : null;
const isLoginPage = Boolean(portal && pageName === portal.login);
const originalVisibility = window.__rvAuthOriginalVisibility || "";
const LOGOUT_HISTORY_MARKER = "recovibeLogoutHistoryPortal";
let logoutInProgress = false;

function storedValue(key) {
  for (const storageName of ["localStorage", "sessionStorage"]) {
    try {
      const storage = window[storageName];
      const value = storage.getItem(key);
      if (value) return value;
    } catch (error) {
      console.warn(`[Portal Auth] Could not read ${key} from ${storageName}.`, error);
    }
  }
  return "";
}

function storedProfiles(key) {
  const profiles = [];
  for (const storageName of ["localStorage", "sessionStorage"]) {
    try {
      const profile = JSON.parse(window[storageName].getItem(key) || "null");
      if (profile && typeof profile === "object") profiles.push(profile);
    } catch (error) {
      console.warn(`[Portal Auth] Could not read cached ${key} from ${storageName}.`, error);
    }
  }
  return profiles;
}

function matchesSignedInUser(profile, user) {
  if (!profile || !user) return false;
  const uid = profile.uid || profile.id || "";
  const email = String(profile.email || "").trim().toLowerCase();
  return (uid && uid === user.uid) ||
    (email && email === String(user.email || "").trim().toLowerCase());
}

function activeDashboard(user) {
  const isStudent = storedProfiles("recovibeCurrentUser")
    .some((profile) => matchesSignedInUser(profile, user));
  if (portalName === "UserStudent" && isStudent) {
    return new URL("../UserStudent/Dashboard.html", window.location.href).href;
  }

  const isOrganizer = [
    "recovibeOrganizerProfile",
    "recovibeCurrentOrganizer",
    "recovibeOrganizer",
  ].some((key) => storedProfiles(key).some((profile) => matchesSignedInUser(profile, user))) ||
    storedValue("recovibeOrganizerId") === user.uid ||
    storedValue("recovibeTeacherId") === user.uid;
  if (portalName === "UserEventOrganizer" && isOrganizer) {
    return new URL("../UserEventOrganizer/EventOrganizerDashBoard.html", window.location.href).href;
  }

  const isSuperAdmin = storedProfiles("recovibeAdminProfile")
    .some((profile) => matchesSignedInUser(profile, user)) ||
    String(storedValue("recovibeAdminId")).trim().toLowerCase() ===
      String(user.email || "").trim().toLowerCase();
  if (portalName === "UserSuperAdmin" && isSuperAdmin) {
    return new URL("../UserSuperAdmin/SuperAdminDashboard.html", window.location.href).href;
  }

  if (isStudent) return new URL("../UserStudent/Dashboard.html", window.location.href).href;
  if (isOrganizer) {
    return new URL("../UserEventOrganizer/EventOrganizerDashBoard.html", window.location.href).href;
  }
  if (isSuperAdmin) return new URL("../UserSuperAdmin/SuperAdminDashboard.html", window.location.href).href;
  return new URL(portal.dashboard, window.location.href).href;
}

function clearPortalMarkers() {
  for (const storageName of ["localStorage", "sessionStorage"]) {
    try {
      const storage = window[storageName];
      for (const key of portal.keys) {
        storage.removeItem(key);
      }
    } catch (error) {
      console.warn(`[Portal Auth] Could not clear ${storageName} during logout.`, error);
    }
  }
}

function loginUrl() {
  return new URL(portal.login, window.location.href).href;
}

export function buildLogoutRedirectUrl(loginPage) {
  try {
    window.sessionStorage.setItem(LOGOUT_HISTORY_MARKER, portalName);
    const destination = new URL(loginPage, window.location.href);
    destination.searchParams.set("afterLogout", "1");
    return destination.href;
  } catch (error) {
    console.error("[Portal Auth] Could not preserve logout history state.", error);
    return new URL("../FirstPage.html", window.location.href).href;
  }
}

function clearLogoutHistoryMarker() {
  try {
    window.sessionStorage.removeItem(LOGOUT_HISTORY_MARKER);
  } catch (error) {
    console.warn("[Portal Auth] Could not clear logout history state.", error);
  }
}

function setProtectedPageHidden(hidden) {
  if (hidden) {
    document.documentElement.style.visibility = "hidden";
    document.documentElement.dataset.rvAuthPending = "true";
    return;
  }
  document.documentElement.style.visibility = originalVisibility;
  delete document.documentElement.dataset.rvAuthPending;
}

async function verifyProtectedPage() {
  setProtectedPageHidden(true);
  if (!auth) {
    console.error("[Portal Auth] Firebase Auth is unavailable; redirecting to login.");
    window.location.replace(loginUrl());
    return;
  }
  try {
    await auth.authStateReady();
  } catch (error) {
    console.error("[Portal Auth] Could not initialize Firebase Auth.", error);
    window.location.replace(loginUrl());
    return;
  }
  if (!auth.currentUser) {
    clearPortalMarkers();
    window.location.replace(loginUrl());
    return;
  }
  setProtectedPageHidden(false);
}

async function handleLoginPageShow(event = null) {
  if (!auth) return;
  try {
    await auth.authStateReady();
  } catch (error) {
    console.error("[Portal Auth] Could not initialize Firebase Auth on the login page.", error);
    return;
  }
  if (auth.currentUser) {
    clearLogoutHistoryMarker();
    window.location.replace(activeDashboard(auth.currentUser));
    return;
  }

  const navigationEntry = performance.getEntriesByType("navigation")[0];
  if (!event?.persisted && navigationEntry?.type !== "back_forward") return;

  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.get("afterLogout") === "1") return;

  let pendingPortal = "";
  try {
    pendingPortal = window.sessionStorage.getItem(LOGOUT_HISTORY_MARKER) || "";
  } catch (error) {
    console.warn("[Portal Auth] Could not read logout history state.", error);
    return;
  }
  if (pendingPortal !== portalName) return;

  clearLogoutHistoryMarker();
  const homeUrl = new URL("../FirstPage.html", window.location.href);
  try {
    const previousUrl = document.referrer ? new URL(document.referrer) : null;
    if (
      previousUrl &&
      previousUrl.origin === homeUrl.origin &&
      previousUrl.pathname === homeUrl.pathname
    ) {
      window.history.back();
      return;
    }
  } catch (error) {
    console.warn("[Portal Auth] Could not inspect the previous login-page URL.", error);
  }
  window.location.replace(homeUrl.href);
}

async function performLogout(logoutLink) {
  if (logoutInProgress) return;
  logoutInProgress = true;
  logoutLink.setAttribute("aria-busy", "true");
  setProtectedPageHidden(true);

  try {
    if (!auth) throw new Error("Firebase Auth is unavailable.");
    await auth.authStateReady();
    if (auth.currentUser) await signOut(auth);
    if (auth.currentUser) throw new Error("Firebase Auth still has an active user after sign-out.");
    clearPortalMarkers();
    window.location.replace(buildLogoutRedirectUrl(portal.login));
  } catch (error) {
    console.error("[Portal Auth] Could not sign out.", error);
    logoutLink.removeAttribute("aria-busy");
    logoutInProgress = false;
    setProtectedPageHidden(false);
    window.alert("Could not sign out. Your session is still active; please try again.");
  }
}

function bindConfirmedLogout() {
  if (
    portalName === "UserSuperAdmin" ||
    pageName === "StudentProfile.html" ||
    pageName === "EventOrganizerDashBoard.html" ||
    pageName === "EventOrganizerScanAttendance.html"
  ) return;
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("a, button")
      : null;
    if (!target || target.dataset.rvLogoutConfirmed !== "true") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void performLogout(target);
  }, true);
}

if (portal) {
  if (isLoginPage) {
    void handleLoginPageShow();
    window.addEventListener("pageshow", (event) => {
      void handleLoginPageShow(event);
    });
  } else {
    void verifyProtectedPage();
    window.addEventListener("pagehide", () => setProtectedPageHidden(true));
    window.addEventListener("pageshow", (event) => {
      if (event.persisted || document.documentElement.dataset.rvAuthPending === "true") {
        void verifyProtectedPage();
      }
    });
    bindConfirmedLogout();
  }
}
