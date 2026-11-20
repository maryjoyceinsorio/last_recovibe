import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";

(() => {
  "use strict";

  const DEBUG = false;
  const INITIAL_LISTENER_TIMEOUT_MS = 8000;
  const accountSourceStates = { users: "loading", adminUser: "loading" };
  const listenerStates = {
    users: { connected: false, everConnected: false, failed: false },
    adminUser: { connected: false, everConnected: false, failed: false },
    recentAudit: { connected: false, everConnected: false, failed: false },
    globalConfig: { connected: false, everConnected: false, failed: false },
  };
  const initialSources = new Set(["users", "adminUser", "recentAudit", "globalConfig"]);
  let studentDocs = [];
  let adminUserDocs = [];
  let unsubscribeUsers = null;
  let unsubscribeAdminUsers = null;
  let unsubscribeRecentAudit = null;
  let unsubscribeGlobalConfig = null;
  let pageReady = false;

  const roleStats = {
    student: {
      label: "Students",
      totalId: "ao-student-total",
      activeId: "ao-student-active",
      barId: "ao-student-bar",
      source: "users",
    },
    teacher: {
      label: "Teachers",
      totalId: "ao-teacher-total",
      activeId: "ao-teacher-active",
      barId: "ao-teacher-bar",
      source: "adminUser",
    },
    eo: {
      label: "Event organizers",
      totalId: "ao-eo-total",
      activeId: "ao-eo-active",
      barId: "ao-eo-bar",
      source: "adminUser",
    },
    admin: {
      label: "Admins",
      totalId: "ao-admin-total",
      activeId: "ao-admin-active",
      barId: "ao-admin-bar",
      source: "adminUser",
    },
  };

  const greetingElement = document.getElementById("dashboard-greeting");
  const dateElement = document.getElementById("dashboard-today-date");
  const dateValueElement = document.getElementById("dashboard-date-value");
  const liveBadge = document.getElementById("dashboard-live-badge");
  const liveDot = document.getElementById("dashboard-live-dot");
  const liveText = document.getElementById("dashboard-live-text");
  const accountError = document.getElementById("ao-error");
  const accountRetry = document.getElementById("ao-retry");
  const recentList = document.getElementById("recent-audit-list");
  const recentEmpty = document.getElementById("recent-audit-empty");
  const recentError = document.getElementById("recent-audit-error");
  const recentErrorText = document.getElementById("recent-audit-error-text");
  const recentRetry = document.getElementById("recent-audit-retry");
  const loginState = document.getElementById("dashboard-login-state");
  const registrationState = document.getElementById("dashboard-registration-state");
  const statusNote = document.getElementById("dashboard-status-note");
  const statusError = document.getElementById("dashboard-status-error");
  const statusRetry = document.getElementById("dashboard-status-retry");

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function setText(element, value) {
    if (element) element.innerHTML = esc(value);
  }

  function setInitialReady(source) {
    initialSources.delete(source);
    if (!pageReady && initialSources.size === 0) {
      pageReady = true;
      window.dispatchEvent(new Event("page-data-ready"));
    }
  }

  function setListenerState(source, connected, failed = false) {
    const state = listenerStates[source];
    if (!state) return;
    state.connected = connected;
    state.failed = failed;
    if (connected) state.everConnected = true;
    renderLiveBadge();
  }

  function setListenerFromSnapshot(source, snapshot) {
    setListenerState(source, snapshot.metadata?.fromCache !== true);
  }

  function markListenerConnecting(source) {
    setListenerState(source, false, false);
  }

  function renderLiveBadge() {
    if (!liveBadge || !liveText) return;
    const states = [listenerStates.users, listenerStates.adminUser];
    const allConnected = states.every((state) => state.connected && !state.failed);
    const offline = states.some(
      (state) => state.failed || (state.everConnected && !state.connected),
    );
    const label = allConnected ? "LIVE" : offline ? "Offline" : "Connecting";
    setText(liveText, label);
    liveBadge.classList.toggle("is-live", allConnected);
    liveBadge.classList.toggle("is-offline", !allConnected);
    if (liveDot) liveDot.setAttribute("aria-label", label);
  }

  function manilaDateParts(date) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    return Object.fromEntries(parts.map((part) => [part.type, part.value]));
  }

  function setDashboardDate() {
    const now = new Date();
    const parts = manilaDateParts(now);
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(now);
    setText(dateValueElement, formatted);
    if (dateElement) dateElement.dateTime = `${parts.year}-${parts.month}-${parts.day}`;
  }

  function greetingForManilaHour() {
    const hourPart = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(new Date()).find((part) => part.type === "hour");
    const hour = Number(hourPart?.value);
    return hour < 12
      ? "Good morning"
      : hour < 17
        ? "Good afternoon"
        : "Good evening";
  }

  function fullNameFromProfile(profile = {}, user = {}) {
    const firstLastName = [profile.firstName, profile.middleName, profile.lastName]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ");
    return String(
      firstLastName ||
      profile.fullName ||
      profile.name ||
      profile.displayName ||
      user.displayName ||
      "Super Admin",
    );
  }

  function renderAuthenticatedProfile(profile = {}, user = {}) {
    const fullName = fullNameFromProfile(profile, user);
    const greetingName =
      String(profile.lastName || "").trim() ||
      (fullName === "Super Admin" ? fullName : fullName.trim().split(/\s+/).at(-1));
    setText(greetingElement, `${greetingForManilaHour()}, ${greetingName}`);
    setText(document.getElementById("sidebar-user-name"), fullName);
    setText(document.getElementById("sidebar-user-role"), "Super Admin account");
    setText(
      document.getElementById("sidebar-user-avatar"),
      fullName.trim().charAt(0).toUpperCase() || "S",
    );
  }

  function setLoadingMarkup(element, small = false) {
    if (!element) return;
    const className = small
      ? "dashboard-skeleton dashboard-skeleton--small"
      : "dashboard-skeleton";
    element.innerHTML = `<span class="${className}" aria-hidden="true"></span>`;
  }

  function classifyRole(role) {
    const normalized = String(role || "").trim().toLowerCase().replace(/\s+/g, "");
    if (normalized === "student") return "student";
    if (normalized === "teacher") return "teacher";
    if (normalized === "eventorganizer") return "eo";
    if (normalized === "admin" || normalized === "superadmin") return "admin";
    return null;
  }

  function isActiveAccount(data) {
    const status = String(data.status || "").toLowerCase();
    return status === "active" || (status === "" && data.isActive === true);
  }

  function formatCount(value) {
    return Number(value).toLocaleString("en-US");
  }

  function setProgressBar(id, active, total) {
    const bar = document.getElementById(id);
    if (!bar) return;
    const percentage = total > 0
      ? Math.min(100, Math.max(0, (active / total) * 100))
      : 0;
    bar.style.width = `${percentage}%`;
  }

  function renderRoleActive(element, active, sourceState) {
    if (!element) return;
    if (sourceState === "loading") {
      setLoadingMarkup(element, true);
      return;
    }
    if (sourceState === "error") {
      setText(element, "Unavailable");
      return;
    }
    element.innerHTML = `<span class="dashboard-active-dot" aria-hidden="true"></span>${esc(`${formatCount(active)} active now`)}`;
  }

  function renderAccountCounts(totals, actives, totalActiveUsers) {
    Object.entries(roleStats).forEach(([key, config]) => {
      const sourceState = accountSourceStates[config.source];
      const totalElement = document.getElementById(config.totalId);
      const activeElement = document.getElementById(config.activeId);
      if (sourceState === "loading") {
        setLoadingMarkup(totalElement);
      } else if (sourceState === "error") {
        setText(totalElement, "—");
      } else {
        setText(totalElement, formatCount(totals[key]));
      }
      renderRoleActive(activeElement, actives[key], sourceState);
      setProgressBar(
        config.barId,
        sourceState === "ready" ? actives[key] : 0,
        sourceState === "ready" ? totals[key] : 0,
      );
    });

    const totalState = [accountSourceStates.users, accountSourceStates.adminUser];
    const activeTotalElement = document.getElementById("ao-active-total");
    if (totalState.every((state) => state === "ready")) {
      setText(activeTotalElement, formatCount(totalActiveUsers));
      const overallTotal = Object.values(totals).reduce((sum, count) => sum + count, 0);
      setProgressBar("ao-active-bar", totalActiveUsers, overallTotal);
    } else if (totalState.includes("error")) {
      setText(activeTotalElement, "—");
      setProgressBar("ao-active-bar", 0, 0);
    } else {
      setLoadingMarkup(activeTotalElement);
      setProgressBar("ao-active-bar", 0, 0);
    }
    if (accountError) {
      accountError.hidden = !totalState.includes("error");
    }
  }

  function recomputeAndRender() {
    const totals = { student: 0, teacher: 0, eo: 0, admin: 0 };
    const actives = { student: 0, teacher: 0, eo: 0, admin: 0 };
    let totalActiveUsers = 0;
    [...studentDocs, ...adminUserDocs].forEach((data) => {
      const role = classifyRole(data.role);
      if (!role) return;
      totals[role] += 1;
      if (isActiveAccount(data)) {
        actives[role] += 1;
        totalActiveUsers += 1;
      }
    });
    renderAccountCounts(totals, actives, totalActiveUsers);
  }

  function setAccountSourceError(source, error) {
    accountSourceStates[source] = "error";
    if (DEBUG) console.error(`Dashboard ${source} listener failed.`, error);
    setListenerState(source, false, true);
    recomputeAndRender();
    setInitialReady(source);
  }

  function subscribeAccountsOverview() {
    unsubscribeUsers?.();
    unsubscribeAdminUsers?.();
    unsubscribeUsers = null;
    unsubscribeAdminUsers = null;
    accountSourceStates.users = "loading";
    accountSourceStates.adminUser = "loading";
    studentDocs = [];
    adminUserDocs = [];
    markListenerConnecting("users");
    markListenerConnecting("adminUser");
    recomputeAndRender();

    if (!isFirebaseConfigured || !db) {
      setAccountSourceError("users", new Error("Firebase is not configured."));
      setAccountSourceError("adminUser", new Error("Firebase is not configured."));
      return;
    }

    try {
      unsubscribeUsers = onSnapshot(
        collection(db, "users"),
        { includeMetadataChanges: true },
        (snapshot) => {
          studentDocs = snapshot.docs
            .map((documentSnapshot) => documentSnapshot.data() || {})
            .filter(
              (data) =>
                String(data.role || data.userRole || "")
                  .trim()
                  .toLowerCase() === "student",
            );
          accountSourceStates.users = "ready";
          setListenerFromSnapshot("users", snapshot);
          recomputeAndRender();
          setInitialReady("users");
        },
        (error) => setAccountSourceError("users", error),
      );
    } catch (error) {
      setAccountSourceError("users", error);
    }

    try {
      unsubscribeAdminUsers = onSnapshot(
        collection(db, "adminUser"),
        { includeMetadataChanges: true },
        (snapshot) => {
          adminUserDocs = snapshot.docs.map(
            (documentSnapshot) => documentSnapshot.data() || {},
          );
          accountSourceStates.adminUser = "ready";
          setListenerFromSnapshot("adminUser", snapshot);
          recomputeAndRender();
          setInitialReady("adminUser");
        },
        (error) => setAccountSourceError("adminUser", error),
      );
    } catch (error) {
      setAccountSourceError("adminUser", error);
    }
  }

  function manilaDateKey(date) {
    const parts = manilaDateParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function dateFrom(value) {
    if (value?.toDate) return value.toDate();
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function dayHeading(date, todayKey, yesterdayKey) {
    if (!date) return "Date unavailable";
    const key = manilaDateKey(date);
    if (key === todayKey) return "Today";
    if (key === yesterdayKey) return "Yesterday";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      weekday: "long",
      month: "short",
      day: "numeric",
    }).format(date);
  }

  function formatManilaTime(date) {
    return date
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: "Asia/Manila",
          hour: "numeric",
          minute: "2-digit",
        }).format(date)
      : "Time unavailable";
  }

  function mapActionToHeadline(entry) {
    const action = String(entry.action || entry.actionHeader || "").trim();
    const code = action.toLowerCase();
    const readableHeader = String(entry.actionHeader || "").trim();
    const targetName = String(entry.targetName || "").trim();
    const knownHeadlines = {
      password_reset_sent: "Password reset email sent",
      user_created: "New user created",
      suspend: "Account suspended",
      reactivate: "Account reactivated",
      role_change: "Role changed",
      "settings.update": "Settings updated",
    };

    if (code === "settings.update") {
      const section = String(entry.section || entry.summary || "").trim();
      return section
        ? `Settings updated: ${section}`
        : "Settings updated: section not recorded";
    }
    if (knownHeadlines[code]) {
      return targetName ? `${knownHeadlines[code]}: ${targetName}` : knownHeadlines[code];
    }
    if (!/\s/.test(action) && /\s/.test(readableHeader)) return readableHeader;
    if (/\s/.test(action)) return action;
    if (/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i.test(action)) {
      const readable = action
        .split(/[._-]+/)
        .filter(Boolean)
        .join(" ")
        .replace(/^./, (character) => character.toUpperCase());
      return targetName ? `${readable}: ${targetName}` : readable;
    }
    return action || "Activity recorded";
  }

  function activityIconType(entry) {
    const action = String(entry.action || entry.actionHeader || "").trim().toLowerCase();
    const readableAction = String(entry.actionHeader || "").trim().toLowerCase();
    if (
      action === "user_created" ||
      /created new .*account/i.test(action) ||
      /created new .*account/i.test(readableAction)
    ) return "user";
    if (action === "password_reset_sent" || /password reset/.test(action) || /password reset/.test(readableAction)) {
      return "reset";
    }
    if (action === "suspend" || /account suspended/.test(action) || /account suspended/.test(readableAction)) {
      return "suspend";
    }
    if (
      action === "settings.update" ||
      String(entry.category || "").toLowerCase().includes("settings")
    ) {
      return "settings";
    }
    return "neutral";
  }

  function createActivityIcon(type) {
    const icon = document.createElement("span");
    icon.className = `dashboard-activity-icon dashboard-activity-icon--${type}`;
    icon.setAttribute("aria-hidden", "true");
    const paths = {
      user: '<circle cx="9" cy="8" r="3.2"></circle><path d="M3.5 20v-1.6a5.5 5.5 0 0 1 11 0V20M18 8v6M15 11h6"></path>',
      reset: '<circle cx="8" cy="15" r="4"></circle><path d="m11 12 8-8 2 2-2 2 2 2-3 3-2-2-2 2"></path>',
      suspend: '<circle cx="12" cy="12" r="9"></circle><path d="m6 6 12 12"></path>',
      settings: '<circle cx="12" cy="12" r="3"></circle><path d="m19.4 15 .1.1 1.2 1-1.4 2.4-1.5-.6a8 8 0 0 1-1.5.9l-.3 1.6h-2.8l-.3-1.6a8 8 0 0 1-1.5-.9l-1.5.6-1.4-2.4 1.2-1a7 7 0 0 1 0-1.8l-1.2-1 1.4-2.4 1.5.6a8 8 0 0 1 1.5-.9l.3-1.6h2.8l.3 1.6a8 8 0 0 1 1.5.9l1.5-.6 1.4 2.4-1.2 1a7 7 0 0 1-.1 1.7Z"></path>',
      neutral: '<circle cx="12" cy="12" r="3"></circle>',
    };
    icon.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${paths[type] || paths.neutral}</svg>`;
    return icon;
  }

  function normalizeAuditEntry(documentSnapshot) {
    const data = documentSnapshot.data() || {};
    return {
      ...data,
      id: documentSnapshot.id,
      user: data.user || data.actorName || data.performedBy || "",
      action: data.action || data.actionHeader || "",
      timestamp: data.timestamp || data.createdAt || null,
    };
  }

  function renderRecentSkeleton() {
    if (!recentList) return;
    recentList.hidden = false;
    recentEmpty.hidden = true;
    recentError.hidden = true;
    recentList.innerHTML = Array.from({ length: 4 }, () =>
      '<div class="dashboard-activity-skeleton" aria-hidden="true"><span></span><div><i></i><i></i></div><b></b></div>',
    ).join("");
  }

  function renderRecentError(message) {
    recentList.replaceChildren();
    recentList.hidden = true;
    recentEmpty.hidden = true;
    setText(recentErrorText, message);
    recentError.hidden = false;
  }

  function makeActivityEntry(entry) {
    const row = document.createElement("article");
    row.className = "dashboard-activity-entry";
    row.append(createActivityIcon(activityIconType(entry)));

    const copy = document.createElement("div");
    copy.className = "dashboard-activity-copy";
    const headline = document.createElement("h3");
    headline.className = "dashboard-activity-headline";
    setText(headline, mapActionToHeadline(entry));
    const actor = document.createElement("p");
    actor.className = "dashboard-activity-actor";
    const actorName = String(entry.actorName || entry.user || entry.performedBy || "").trim();
    setText(actor, actorName || "Actor not recorded");
    copy.append(headline, actor);
    row.append(copy);

    const time = document.createElement("time");
    time.className = "dashboard-activity-time";
    const date = dateFrom(entry.timestamp);
    if (date) time.dateTime = date.toISOString();
    setText(time, formatManilaTime(date));
    row.append(time);
    return row;
  }

  function renderRecentActivity(records) {
    recentError.hidden = true;
    recentList.replaceChildren();
    recentList.hidden = records.length === 0;
    recentEmpty.hidden = records.length !== 0;
    if (!records.length) return;

    const now = new Date();
    const todayKey = manilaDateKey(now);
    const yesterday = new Date(`${todayKey}T00:00:00+08:00`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayKey = manilaDateKey(yesterday);
    const groups = new Map();
    records.slice(0, 8).forEach((record) => {
      const date = dateFrom(record.timestamp);
      const key = date ? manilaDateKey(date) : "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    });

    groups.forEach((dayRecords) => {
      const date = dayRecords.map((record) => dateFrom(record.timestamp)).find(Boolean);
      const heading = document.createElement("h3");
      heading.className = "dashboard-activity-day";
      setText(heading, dayHeading(date, todayKey, yesterdayKey));
      const group = document.createElement("div");
      group.className = "dashboard-activity-group";
      dayRecords.forEach((record) => group.append(makeActivityEntry(record)));
      recentList.append(heading, group);
    });
  }

  function subscribeRecentAudit() {
    unsubscribeRecentAudit?.();
    unsubscribeRecentAudit = null;
    markListenerConnecting("recentAudit");
    renderRecentSkeleton();
    if (!isFirebaseConfigured || !db) {
      setListenerState("recentAudit", false, true);
      renderRecentError("Could not load recent activity. Check Firebase and retry.");
      setInitialReady("recentAudit");
      return;
    }

    try {
      unsubscribeRecentAudit = onSnapshot(
        query(collection(db, "audit_logs"), orderBy("timestamp", "desc"), limit(8)),
        { includeMetadataChanges: true },
        (snapshot) => {
          const records = snapshot.docs.map(normalizeAuditEntry);
          setListenerFromSnapshot("recentAudit", snapshot);
          renderRecentActivity(records);
          setInitialReady("recentAudit");
        },
        (error) => {
          if (DEBUG) console.error("Recent activity listener failed.", error);
          setListenerState("recentAudit", false, true);
          renderRecentError("Could not load recent activity. Please retry.");
          setInitialReady("recentAudit");
        },
      );
    } catch (error) {
      if (DEBUG) console.error("Could not attach the recent activity listener.", error);
      setListenerState("recentAudit", false, true);
      renderRecentError("Could not load recent activity. Please retry.");
      setInitialReady("recentAudit");
    }
  }

  function setStatusPill(element, value) {
    if (!element) return;
    element.classList.remove("is-loading", "is-on", "is-off");
    element.classList.add(value ? "is-on" : "is-off");
    setText(element, value ? "On" : "Off");
  }

  function setStatusUnavailable() {
    [loginState, registrationState].forEach((element) => {
      if (!element) return;
      element.classList.remove("is-on", "is-off");
      element.classList.add("is-loading");
      setText(element, "Unavailable");
    });
    if (statusError) statusError.hidden = false;
  }

  function subscribeSystemStatus() {
    unsubscribeGlobalConfig?.();
    unsubscribeGlobalConfig = null;
    markListenerConnecting("globalConfig");
    statusError.hidden = true;
    [loginState, registrationState].forEach((element) => {
      if (!element) return;
      element.classList.remove("is-on", "is-off");
      element.classList.add("is-loading");
      setText(element, "Loading");
    });
    setText(statusNote, "Read-only. Change these flags in System Settings.");

    if (!isFirebaseConfigured || !db) {
      setListenerState("globalConfig", false, true);
      setStatusUnavailable();
      setInitialReady("globalConfig");
      return;
    }

    try {
      unsubscribeGlobalConfig = onSnapshot(
        doc(db, "system_settings", "global_config"),
        { includeMetadataChanges: true },
        (snapshot) => {
          const data = snapshot.exists() ? snapshot.data() || {} : {};
          const loginEnabled = typeof data.loginEnabled === "boolean"
            ? data.loginEnabled
            : true;
          const registrationEnabled = typeof data.registrationEnabled === "boolean"
            ? data.registrationEnabled
            : true;
          setStatusPill(loginState, loginEnabled);
          setStatusPill(registrationState, registrationEnabled);
          setText(
            statusNote,
            snapshot.exists()
              ? "Read-only. Change these flags in System Settings."
              : "No saved configuration; defaults are On. Change these flags in System Settings.",
          );
          statusError.hidden = true;
          setListenerFromSnapshot("globalConfig", snapshot);
          setInitialReady("globalConfig");
        },
        (error) => {
          if (DEBUG) console.error("System settings listener failed.", error);
          setListenerState("globalConfig", false, true);
          setStatusUnavailable();
          setInitialReady("globalConfig");
        },
      );
    } catch (error) {
      if (DEBUG) console.error("Could not attach the system settings listener.", error);
      setListenerState("globalConfig", false, true);
      setStatusUnavailable();
      setInitialReady("globalConfig");
    }
  }

  function retryAccountListeners() {
    if (accountError) accountError.hidden = true;
    subscribeAccountsOverview();
  }

  function stopListeners() {
    unsubscribeUsers?.();
    unsubscribeAdminUsers?.();
    unsubscribeRecentAudit?.();
    unsubscribeGlobalConfig?.();
    unsubscribeUsers = null;
    unsubscribeAdminUsers = null;
    unsubscribeRecentAudit = null;
    unsubscribeGlobalConfig = null;
  }

  setDashboardDate();
  window.addEventListener("superadmin-profile-authorized", (event) => {
    const { profile, user } = event.detail || {};
    renderAuthenticatedProfile(profile || {}, user || {});
  });
  try {
    const storedProfile = JSON.parse(localStorage.getItem("recovibeAdminProfile") || "null");
    renderAuthenticatedProfile(storedProfile || {}, {});
  } catch {
    renderAuthenticatedProfile({}, {});
  }

  accountRetry?.addEventListener("click", retryAccountListeners);
  recentRetry?.addEventListener("click", subscribeRecentAudit);
  statusRetry?.addEventListener("click", subscribeSystemStatus);
  window.addEventListener("pagehide", stopListeners, { once: true });
  window.addEventListener("beforeunload", stopListeners, { once: true });

  if (!isFirebaseConfigured || !db) {
    accountSourceStates.users = "error";
    accountSourceStates.adminUser = "error";
    recomputeAndRender();
    setListenerState("users", false, true);
    setListenerState("adminUser", false, true);
    renderRecentError("Could not load recent activity. Check Firebase and retry.");
    setListenerState("recentAudit", false, true);
    setStatusUnavailable();
    setListenerState("globalConfig", false, true);
    initialSources.clear();
    setInitialReady("users");
  } else {
    subscribeAccountsOverview();
    subscribeRecentAudit();
    subscribeSystemStatus();
  }

  window.setTimeout(() => {
    [...initialSources].forEach((source) => {
      if (source === "users" || source === "adminUser") {
        setAccountSourceError(source, new Error("Initial listener response timed out."));
      } else if (source === "recentAudit") {
        setListenerState(source, false, true);
        renderRecentError("Could not load recent activity. Please retry.");
        setInitialReady(source);
      } else if (source === "globalConfig") {
        setListenerState(source, false, true);
        setStatusUnavailable();
        setInitialReady(source);
      }
    });
  }, INITIAL_LISTENER_TIMEOUT_MS);
})();
