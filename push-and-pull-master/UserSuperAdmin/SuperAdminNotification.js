import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";
import { getCurrentStageKey, getEventStage } from "../eventWorkflow.js";
import { logoutSuperAdmin } from "./superAdminLogout.js";

(() => {
  "use strict";

  const DEBUG = false;
  const READ_TIMEOUT_MS = 5000;
  const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const SOURCE_NAMES = ["events", "accounts", "settings", "audit", "stored"];
  const root = document.getElementById("notificationRoot");
  const main = document.getElementById("main-content");
  const list = document.getElementById("notificationList");
  const subtitle = document.getElementById("notificationSubtitle");
  const fullError = document.getElementById("fullError");
  const sourceBanner = document.getElementById("sourceBanner");
  const sourceBannerText = document.getElementById("sourceBannerText");
  const loadingSkeleton = document.getElementById("loadingSkeleton");
  const offlineNote = document.getElementById("offlineNote");
  const navBadge = document.getElementById("navUnreadBadge");
  const markAllButton = document.getElementById("markAllRead");
  const clearReadButton = document.getElementById("clearRead");
  const searchInput = document.getElementById("notificationSearch");
  const pageController = new AbortController();
  const sourceTimers = new Set();
  const sourceStatus = Object.fromEntries(SOURCE_NAMES.map((name) => [name, "idle"]));
  const sourceData = Object.fromEntries(SOURCE_NAMES.map((name) => [name, null]));
  const accountNamesById = new Map();
  const filters = { tab: "all", category: "", summary: "all", search: "" };
  let stateKey = "";
  let localState = { readStates: {}, removedIds: [] };
  let authUnsubscribe = null;
  let authTimer = 0;
  let stopped = false;
  let sourcesStarted = false;
  let storageWarning = "";

  function log(...args) {
    if (DEBUG) console.debug("[SuperAdminNotifications]", ...args);
  }

  function asDate(value) {
    if (value && typeof value.toDate === "function") return asDate(value.toDate());
    if (value && typeof value.toMillis === "function") return new Date(value.toMillis());
    if (value && typeof value.seconds === "number") return new Date(value.seconds * 1000);
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof value === "string" && value.trim()) {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  function timestampFrom(...values) {
    for (const value of values) {
      const date = asDate(value);
      if (date) return date.toISOString();
    }
    return null;
  }

  function dateFromItem(item) {
    return asDate(item.timestamp);
  }

  function safeText(value) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    const text = String(value).replace(/\b[A-Za-z0-9_-]{20,}\b/g, "").trim();
    return !text || text.length > 200 ? "" : text;
  }

  function profileName(data) {
    return safeText(
      [data?.firstName, data?.middleName, data?.lastName].map(safeText).filter(Boolean).join(" ") ||
      data?.fullName || data?.displayName || data?.name,
    );
  }

  function actorName(data, keys = ["actorName", "performedBy", "user", "createdByName"]) {
    for (const key of keys) {
      const rawValue = String(data?.[key] || "");
      const candidate = safeText(rawValue);
      if (candidate) return candidate;
      if (rawValue && accountNamesById.has(rawValue)) return accountNamesById.get(rawValue);
      const relatedId = data?.[`${key}Uid`] || data?.[`${key}Id`];
      if (relatedId && accountNamesById.has(String(relatedId))) return accountNamesById.get(String(relatedId));
    }
    for (const key of ["actorUid", "userId", "uid", "createdBy", "updatedBy", "submittedBy"]) {
      const id = String(data?.[key] || "");
      if (id && accountNamesById.has(id)) return accountNamesById.get(id);
    }
    return "";
  }

  function stableSuffix(value) {
    let hash = 2166136261;
    for (const character of String(value)) {
      hash ^= character.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function makeItem(source, identity, category, priority, title, message, timestamp, link = "", actor = "") {
    const item = {
      id: `${source}:${stableSuffix(identity)}`,
      category,
      priority,
      title: String(title || "Notification"),
      message: String(message || ""),
      timestamp: timestampFrom(timestamp),
      read: false,
      source,
    };
    if (link) item.link = link;
    if (actor) item.actorName = actor;
    return item;
  }

  function readLocalState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(stateKey) || "null");
      localState = {
        readStates: parsed?.readStates && typeof parsed.readStates === "object" ? parsed.readStates : {},
        removedIds: Array.isArray(parsed?.removedIds) ? parsed.removedIds.filter((id) => typeof id === "string") : [],
      };
      storageWarning = "";
    } catch (error) {
      storageWarning = "Read and removed states couldn’t be read from this browser.";
      console.error("[SuperAdminNotifications] local state read failed:", error?.message || String(error));
      localState = { readStates: {}, removedIds: [] };
    }
  }

  function saveLocalState() {
    try {
      localStorage.setItem(stateKey, JSON.stringify(localState));
      storageWarning = "";
    } catch (error) {
      storageWarning = "Read and removed states couldn’t be saved in this browser.";
      console.error("[SuperAdminNotifications] local state save failed:", error?.message || String(error));
    }
  }

  function docsFrom(snapshot) {
    return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  }

  async function loadEvents() {
    const snapshot = await getDocs(query(collection(db, "events"), limit(100)));
    return docsFrom(snapshot);
  }

  async function loadAccounts() {
    const accountCollection = collection(db, "adminUser");
    const [created, updated] = await Promise.all([
      getDocs(query(accountCollection, orderBy("createdAt", "desc"), limit(20))),
      getDocs(query(accountCollection, orderBy("updatedAt", "desc"), limit(20))),
    ]);
    const profiles = new Map();
    [...created.docs, ...updated.docs].forEach((entry) => {
      const data = entry.data();
      profiles.set(entry.id, { id: entry.id, ...data });
    });
    profiles.forEach((profile, id) => {
      const name = profileName(profile);
      if (name) accountNamesById.set(id, name);
      if (profile.uid && name) accountNamesById.set(String(profile.uid), name);
    });
    return [...profiles.values()];
  }

  async function loadSettings() {
    const snapshot = await getDocs(query(collection(db, "system_settings"), limit(20)));
    return docsFrom(snapshot);
  }

  async function loadAudit() {
    const snapshot = await getDocs(query(
      collection(db, "audit_logs"),
      orderBy("timestamp", "desc"),
      limit(20),
    ));
    return docsFrom(snapshot);
  }

  async function loadStoredNotifications() {
    const snapshot = await getDocs(query(
      collection(db, "notifications"),
      where("recipientRole", "==", "admin"),
      limit(20),
    ));
    return docsFrom(snapshot);
  }

  function withReadTimeout(task) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        sourceTimers.delete(timer);
        const error = new Error("Read timed out after 5 seconds.");
        error.code = "timeout";
        reject(error);
      }, READ_TIMEOUT_MS);
      sourceTimers.add(timer);
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => {
          window.clearTimeout(timer);
          sourceTimers.delete(timer);
        });
    });
  }

  function loadSource(name, loader) {
    sourceStatus[name] = "pending";
    sourceData[name] = null;
    render();
    return withReadTimeout(loader)
      .then((data) => {
        if (stopped) return;
        sourceData[name] = data;
        sourceStatus[name] = "loaded";
        log(`${name} loaded`, data.length);
        console.info(`[SuperAdminNotifications] ${name} loaded:`, data.length);
      })
      .catch((error) => {
        if (stopped) return;
        sourceData[name] = null;
        sourceStatus[name] = "failed";
        const code = error?.code || "unknown";
        const message = error?.message || String(error);
        console.error(`[SuperAdminNotifications] ${name} failed:`, code, message);
      })
      .finally(() => {
        if (stopped) return;
        render();
      });
  }

  function eventTitle(event) {
    return safeText(event.title || event.eventName || event.name) || "Untitled event";
  }

  function normalizedStatus(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  }

  function eventIsPending(event) {
    const statuses = [event.status, event.approvalStatus, event.publicationStatus].map(normalizedStatus);
    return statuses.some((status) =>
      ["pending", "pendingapproval", "forapproval", "awaitingreview", "underreview", "inreview"].includes(status),
    );
  }

  function stageAssignment(event) {
    const stageKey = getCurrentStageKey(event);
    const workflow = getEventStage(event);
    const stage = workflow.stages.find((entry) => entry.key === stageKey);
    const assignment = event.approverAssignments?.[stageKey] ||
      event.approvalAssignments?.[stageKey] ||
      event.stageAssignments?.[stageKey] ||
      {};
    const stageFields = {
      org_adv: ["orgAdviserUid", "organizationAdviserUid", "adviserUid", "orgAdviserEmail", "organizationAdviserEmail", "adviserEmail"],
      sir_abelida: ["labHeadUid", "laboratoryHeadUid", "propertyCustodianUid", "sirAbelidaUid", "labHeadEmail", "laboratoryHeadEmail", "propertyCustodianEmail"],
      hap: ["hapUid", "qacCoordinatorUid", "hapEmail", "qacCoordinatorEmail"],
      osas: ["osasUid", "osasEmail"],
    };
    const fields = [
      assignment.reviewerUid, assignment.reviewerId, assignment.reviewerEmail,
      assignment.reviewerName, assignment.assignedTo, assignment.assignee,
      assignment.approverUid, assignment.approverEmail, assignment.email,
      stage?.reviewerEmail, stage?.reviewerUid, stage?.reviewerName, stage?.source?.reviewerEmail,
      event.currentReviewerEmail, event.currentReviewerUid, event.assignedReviewer,
      event.reviewerEmail, event.reviewerUid,
      ...(stageFields[stageKey] || []).map((field) => event[field]),
    ];
    return { stage, stageKey, assigned: fields.some((value) => Boolean(String(value || "").trim())) };
  }

  function eventActor(event) {
    return actorName(event, ["organizerName", "submittedByName", "createdByName", "actorName"]) ||
      actorName(event, ["organizerUid", "organizerId", "creatorUid", "createdByUid", "submittedByUid"]);
  }

  function eventLink(event) {
    return `../UserAdmin/AdminApproval.html?review=${encodeURIComponent(event.id)}&source=firestore`;
  }

  function eventItems(events) {
    const items = [];
    for (const event of events) {
      if (!eventIsPending(event)) continue;
      const stage = stageAssignment(event);
      const submitted = asDate(event.submittedAt || event.createdAt || event.updatedAt);
      const overdue = submitted && Date.now() - submitted.getTime() >= 3 * DAY_MS;
      if (!overdue && stage.assigned) continue;
      const ageMessage = overdue
        ? `Waiting for ${stage.stage?.label || "review"} for ${Math.floor((Date.now() - submitted.getTime()) / DAY_MS)} days.`
        : "No reviewer is assigned to the current approval stage.";
      const eventName = eventTitle(event);
      items.push(makeItem(
        "event-action",
        `${event.id}:${stage.stageKey || "unassigned"}:${submitted?.toISOString() || ""}`,
        "Events",
        "action",
        `Needs review: ${eventName}`,
        `${ageMessage} Open the proposal to review its approval stage.`,
        submitted,
        eventLink(event),
        eventActor(event),
      ));
    }
    return items
      .sort((a, b) => (dateFromItem(b)?.getTime() || 0) - (dateFromItem(a)?.getTime() || 0))
      .slice(0, 20);
  }

  function latestDecision(event, status) {
    const entries = [
      ...(Array.isArray(event.reviewHistory) ? event.reviewHistory : []),
      ...(Array.isArray(event.approvalHistory) ? event.approvalHistory : []),
      ...(Array.isArray(event.reviewLogs) ? event.reviewLogs : []),
      ...(Array.isArray(event.reviewLog) ? event.reviewLog : []),
    ];
    const wanted = status === "approved" ? ["approved", "approve"] :
      status === "rejected" ? ["rejected", "reject", "revision", "needsrevision"] :
        ["cancelled", "canceled", "cancel"];
    return entries.slice().reverse().find((entry) => wanted.includes(normalizedStatus(entry.action || entry.decision || entry.status)));
  }

  function approvalItems(events) {
    return events.map((event) => {
      const statuses = [event.approvalStatus, event.status, event.publicationStatus].map(normalizedStatus);
      const label = statuses.some((status) => ["cancelled", "canceled"].includes(status)) ? "cancelled" :
        statuses.some((status) => ["rejected", "revision", "needsrevision"].includes(status)) ? "rejected" :
          statuses.some((status) => status.includes("approv") && status !== "pendingapproval") ||
          (statuses.includes("published") && !statuses.includes("pendingapproval")) ? "approved" : "";
      if (!label) return null;
      const decision = latestDecision(event, label);
      const when = timestampFrom(
        decision?.at, decision?.timestamp, decision?.createdAt,
        decision?.reviewedAt, event.reviewedAt, event.cancellation?.cancelledAt,
        event.cancelledAt, event.statusUpdatedAt, event.updatedAt,
      );
      const date = asDate(when);
      if (!date || Date.now() - date.getTime() > RECENT_WINDOW_MS || date.getTime() > Date.now() + DAY_MS) return null;
      const title = eventTitle(event);
      const actor = actorName(decision || event, ["actorName", "reviewerName", "reviewedByName", "byName", "actor", "reviewer", "by"]) ||
        actorName(event, ["reviewedByName", "approvedByName", "actorName"]);
      return makeItem(
        "approval",
        `${event.id}:${label}:${date.toISOString()}`,
        "Approvals",
        "info",
        `${title} ${label}`,
        `The proposal was ${label}${actor ? ` by ${actor}` : ""}.`,
        date,
        eventLink(event),
        actor,
      );
    }).filter(Boolean)
      .sort((a, b) => (dateFromItem(b)?.getTime() || 0) - (dateFromItem(a)?.getTime() || 0))
      .slice(0, 20);
  }

  function accountItems(accounts) {
    const now = Date.now();
    const items = [];
    accounts.forEach((account) => {
      const role = safeText(account.role || account.userRole) || "Staff";
      const name = profileName(account) || role;
      const created = asDate(account.createdAt);
      if (created && now - created.getTime() <= RECENT_WINDOW_MS && created.getTime() <= now + DAY_MS) {
        items.push(makeItem(
          "account-created",
          `${account.id}:created:${created.toISOString()}`,
          "Accounts",
          "info",
          `New ${role} account`,
          `${name} was added to the admin directory.`,
          created,
          "UserManagement.html",
          actorName(account, ["createdByName", "actorName"]),
        ));
      }
      const status = normalizedStatus(account.status || (account.isActive === false ? "inactive" : ""));
      if (["disabled", "inactive", "suspended"].includes(status)) {
        const changed = asDate(account.statusUpdatedAt || account.disabledAt || account.suspendedAt || account.updatedAt);
        if (changed && now - changed.getTime() <= RECENT_WINDOW_MS && changed.getTime() <= now + DAY_MS) {
          const label = status === "suspended" ? "suspended" : status;
          items.push(makeItem(
            "account-status",
            `${account.id}:${status}:${changed.toISOString()}`,
            "Accounts",
            "info",
            `Account ${label}`,
            `${name} became ${label}.`,
            changed,
            "UserManagement.html",
            actorName(account, ["updatedByName", "actorName"]),
          ));
        }
      }
    });
    return items
      .sort((a, b) => (dateFromItem(b)?.getTime() || 0) - (dateFromItem(a)?.getTime() || 0))
      .slice(0, 20);
  }

  function auditTime(entry) {
    return timestampFrom(entry.timestamp, entry.createdAt, entry.at);
  }

  function securityAudit(entry) {
    const action = normalizedStatus(entry.action || entry.actionHeader || entry.category || "");
    const text = `${entry.action || ""} ${entry.actionHeader || ""} ${entry.details || ""} ${entry.summary || ""}`.toLowerCase();
    return action.includes("rolechange") ||
      ["suspend", "reactivate", "passwordreset", "failed", "failure", "denied", "unauthorized"].some((part) => action.includes(part) || text.includes(part)) ||
      Boolean(entry.unusual === true || entry.failed === true || entry.success === false);
  }

  function settingsAudit(entry) {
    const category = String(entry.category || "").toLowerCase();
    const action = String(entry.action || entry.actionHeader || "").toLowerCase();
    return category.includes("setting") || action.includes("settings") ||
      action.includes("approval stage") || action.includes("approvalstage");
  }

  function auditItems(entries) {
    return entries.flatMap((entry) => {
      const date = auditTime(entry);
      if (!date) return [];
      const actor = actorName(entry, ["actorName", "performedByName", "user", "performedBy", "actor"]);
      const actionLabel = safeText(entry.actionHeader || entry.action) || "Activity recorded";
      const details = safeText(entry.summary || entry.details || entry.description);
      if (settingsAudit(entry)) {
        return [makeItem(
          "settings-audit",
          entry.id,
          "Settings",
          "info",
          actionLabel,
          details || "System settings were updated.",
          date,
          "SuperAdminSystemSettings.html",
          actor,
        )];
      }
      if (!securityAudit(entry)) return [];
      const target = safeText(entry.targetName || entry.accountName || entry.subjectName);
      const message = [details, target && `Account: ${target}`].filter(Boolean).join(" · ") || actionLabel;
      const actorQuery = actor ? `?user=${encodeURIComponent(actor)}` : "";
      return [makeItem(
        "security-audit",
        entry.id,
        "Security",
        /failed|failure|denied|unauthori/i.test(`${entry.action || ""} ${entry.details || ""}`) ? "action" : "info",
        actionLabel,
        message,
        date,
        `SuperAdminAuditLogs.html${actorQuery}`,
        actor,
      )];
    }).sort((a, b) => (dateFromItem(b)?.getTime() || 0) - (dateFromItem(a)?.getTime() || 0)).slice(0, 20);
  }

  function settingsFallbackItems(settings, audits) {
    if (audits.some(settingsAudit)) return [];
    return settings.map((record) => {
      const date = asDate(record.updatedAt);
      if (!date || Date.now() - date.getTime() > RECENT_WINDOW_MS || date.getTime() > Date.now() + DAY_MS) return null;
      const hasApprovalStages = Object.prototype.hasOwnProperty.call(record, "approvalStages") ||
        Object.prototype.hasOwnProperty.call(record, "approvalStagesByOrg");
      const isApprovalSetting = hasApprovalStages || /approval/i.test(record.id);
      const title = isApprovalSetting ? "Approval stages updated" : "System settings updated";
      const settingsName = safeText(record.id) || "System";
      const scope = record.id === "global_config" ? "Global settings" : `${settingsName} settings`;
      const actor = actorName(record, ["updatedByName", "updatedBy"]);
      return makeItem(
        "settings-document",
        `${record.id}:${date.toISOString()}`,
        "Settings",
        "info",
        title,
        `${scope} were updated${actor ? ` by ${actor}` : ""}.`,
        date,
        "SuperAdminSystemSettings.html",
        actor,
      );
    }).filter(Boolean).sort((a, b) => (dateFromItem(b)?.getTime() || 0) - (dateFromItem(a)?.getTime() || 0)).slice(0, 20);
  }

  function storedItems(notifications) {
    return notifications.map((notification) => {
      const date = timestampFrom(notification.createdAt, notification.timestamp, notification.updatedAt);
      const title = safeText(notification.title || notification.subject) || "Notification";
      const message = safeText(notification.message || notification.body) || "";
      return makeItem(
        "stored-notification",
        notification.id,
        notification.category && /approval|event/i.test(notification.category) ? "Approvals" : "Events",
        "info",
        title,
        message,
        date,
        "",
        actorName(notification),
      );
    });
  }

  function currentItems() {
    const items = [];
    if (sourceData.events) items.push(...eventItems(sourceData.events), ...approvalItems(sourceData.events));
    if (sourceData.accounts) items.push(...accountItems(sourceData.accounts));
    if (sourceData.audit) items.push(...auditItems(sourceData.audit));
    if (sourceData.settings) items.push(...settingsFallbackItems(sourceData.settings, sourceData.audit || []));
    if (sourceData.stored) items.push(...storedItems(sourceData.stored));
    const byId = new Map();
    items.forEach((item) => {
      const storedRead = localState.readStates[item.id];
      byId.set(item.id, {
        ...item,
        read: typeof storedRead === "boolean" ? storedRead : item.read,
      });
    });
    const removed = new Set(localState.removedIds);
    return [...byId.values()]
      .filter((item) => !removed.has(item.id))
      .sort((a, b) => (dateFromItem(b)?.getTime() || 0) - (dateFromItem(a)?.getTime() || 0));
  }

  function sameDay(left, right) {
    return left && right &&
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate();
  }

  function groupName(item) {
    const date = dateFromItem(item);
    const today = new Date();
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (sameDay(date, today)) return "Today";
    if (sameDay(date, yesterday)) return "Yesterday";
    return "Earlier";
  }

  function relativeTime(date) {
    if (!date) return "Time unavailable";
    const elapsed = date.getTime() - Date.now();
    const units = [
      ["year", 365 * DAY_MS], ["month", 30 * DAY_MS], ["week", 7 * DAY_MS],
      ["day", DAY_MS], ["hour", 60 * 60 * 1000], ["minute", 60 * 1000],
    ];
    const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
    for (const [unit, size] of units) {
      if (Math.abs(elapsed) >= size || unit === "minute") return formatter.format(Math.round(elapsed / size), unit);
    }
    return "just now";
  }

  function absoluteTime(date) {
    if (!date) return "Time unavailable";
    return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function makeSvg(pathData) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
    return svg;
  }

  function iconFor(category) {
    const paths = {
      Approvals: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
      Accounts: "M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6M23 11h-6",
      Settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M19.4 15l1.3 1-1.4 2.4-1.6-.6a8 8 0 0 1-1.5.9l-.3 1.7h-2.8l-.3-1.7a8 8 0 0 1-1.5-.9l-1.6.6-1.4-2.4 1.3-1a7 7 0 0 1 0-2l-1.3-1 1.4-2.4 1.6.6a8 8 0 0 1 1.5-.9l.3-1.7h2.8l.3 1.7a8 8 0 0 1 1.5.9l1.6-.6 1.4 2.4-1.3 1a7 7 0 0 1 0 2Z",
      Security: "M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11M9 12l2 2 4-4",
      Events: "M3 5h18v16H3zM16 3v4M8 3v4M3 10h18M7 14h4M7 17h7",
    };
    return makeSvg(paths[category] || paths.Events);
  }

  function iconButton(action, label, iconPath) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sa-icon-button";
    button.dataset.action = action;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.append(makeSvg(iconPath));
    return button;
  }

  function primaryLink(href, label) {
    const link = document.createElement("a");
    link.className = "sa-primary-link";
    link.href = href;
    link.textContent = label;
    return link;
  }

  function cardFor(item) {
    const article = document.createElement("article");
    article.className = `sa-notification-card${item.read ? "" : " is-unread"}${item.priority === "action" ? " is-action" : ""}`;
    article.dataset.notificationId = item.id;

    const icon = document.createElement("span");
    icon.className = "sa-notification-icon";
    icon.append(iconFor(item.category));
    if (!item.read) {
      const dot = document.createElement("span");
      dot.className = "sa-unread-dot";
      dot.setAttribute("aria-label", "Unread");
      icon.append(dot);
    }

    const copy = document.createElement("div");
    copy.className = "sa-notification-copy";
    const title = document.createElement("h3");
    title.className = "sa-notification-title";
    title.textContent = item.title;
    const message = document.createElement("p");
    message.className = "sa-notification-message";
    message.textContent = item.message;
    copy.append(title, message);

    const meta = document.createElement("div");
    meta.className = "sa-notification-meta";
    const tag = document.createElement("span");
    tag.className = "sa-category-tag";
    tag.textContent = item.category;
    const time = document.createElement("time");
    const date = dateFromItem(item);
    if (date) time.dateTime = date.toISOString();
    time.textContent = relativeTime(date);
    time.title = absoluteTime(date);
    meta.append(tag, time);
    if (item.actorName) {
      const actor = document.createElement("span");
      actor.textContent = `By ${item.actorName}`;
      meta.append(actor);
    }
    copy.append(meta);

    const actions = document.createElement("div");
    actions.className = "sa-notification-actions";
    actions.append(
      iconButton("toggle-read", item.read ? "Mark as unread" : "Mark as read", "M20 11.1V12a8 8 0 1 1-4.7-7.3M20 4v6h-6M8 12l2.5 2.5L20 5"),
      iconButton("remove", "Remove notification", "M4 6h16M9 6V4h6v2m-9 0 1 14h10l1-14M10 10v6M14 10v6"),
    );
    if (item.priority === "action") actions.append(primaryLink(item.link, "Review"));
    else if (item.category === "Settings") actions.append(primaryLink(item.link, "Open settings"));
    else if (item.category === "Security") actions.append(primaryLink(item.link, "View activity"));
    else if (item.link) actions.append(primaryLink(item.link, item.category === "Accounts" ? "View account" : "Open"));
    article.append(icon, copy, actions);
    return article;
  }

  function matchingItems(items) {
    const search = filters.search.trim().toLowerCase();
    return items.filter((item) => {
      if (filters.tab === "unread" && item.read) return false;
      if (filters.tab === "needsAction" && item.priority !== "action") return false;
      if (filters.category && item.category !== filters.category) return false;
      if (filters.summary === "needsAction" && item.priority !== "action") return false;
      if (filters.summary === "unread" && item.read) return false;
      const date = dateFromItem(item);
      if (filters.summary === "today" && !sameDay(date, new Date())) return false;
      if (filters.summary === "week" && (!date || Date.now() - date.getTime() > 7 * DAY_MS || date.getTime() > Date.now() + DAY_MS)) return false;
      if (search && !`${item.title} ${item.message} ${item.category} ${item.actorName || ""}`.toLowerCase().includes(search)) return false;
      return true;
    });
  }

  function addEmptyState() {
    const state = document.createElement("div");
    state.className = "sa-notification-state";
    const title = document.createElement("strong");
    title.textContent = "You’re all caught up";
    const message = document.createElement("p");
    message.textContent = "No notifications match this view.";
    state.append(title, message);
    list.append(state);
  }

  function renderGroups(items) {
    list.replaceChildren();
    const groups = ["Today", "Yesterday", "Earlier"];
    let rendered = 0;
    groups.forEach((groupNameValue) => {
      const groupItems = items.filter((item) => groupName(item) === groupNameValue);
      if (!groupItems.length) return;
      const section = document.createElement("section");
      section.className = "sa-notification-group";
      const heading = document.createElement("h2");
      heading.textContent = groupNameValue;
      const cards = document.createElement("div");
      cards.className = "sa-notification-grid";
      groupItems.forEach((item) => cards.append(cardFor(item)));
      section.append(heading, cards);
      list.append(section);
      rendered += groupItems.length;
    });
    if (!rendered && sourceStatusDone()) addEmptyState();
  }

  function sourceStatusDone() {
    return SOURCE_NAMES.every((name) => sourceStatus[name] === "loaded" || sourceStatus[name] === "failed");
  }

  function countToday(items) {
    return items.filter((item) => sameDay(dateFromItem(item), new Date())).length;
  }

  function countSince(items, milliseconds) {
    const now = Date.now();
    return items.filter((item) => {
      const date = dateFromItem(item);
      return date && now - date.getTime() <= milliseconds && date.getTime() <= now + DAY_MS;
    }).length;
  }

  function updateControls(items) {
    const unreadCount = items.filter((item) => !item.read).length;
    const actionCount = items.filter((item) => item.priority === "action").length;
    document.getElementById("summaryActionCount").textContent = String(actionCount);
    document.getElementById("summaryUnreadCount").textContent = String(unreadCount);
    document.getElementById("summaryTodayCount").textContent = String(countToday(items));
    document.getElementById("summaryWeekCount").textContent = String(countSince(items, 7 * DAY_MS));
    const summaryAriaLabels = {
      needsAction: `${actionCount} notifications need action. Filter notifications that need action.`,
      unread: `${unreadCount} unread notifications. Filter unread notifications.`,
      today: `${countToday(items)} notifications today. Filter notifications from today.`,
      week: `${countSince(items, 7 * DAY_MS)} notifications this week. Filter notifications from this week.`,
    };
    document.querySelectorAll("[data-summary-filter]").forEach((button) => {
      button.setAttribute("aria-label", summaryAriaLabels[button.dataset.summaryFilter]);
    });
    subtitle.textContent = `${actionCount} need action, ${unreadCount} unread`;
    navBadge.hidden = unreadCount === 0;
    navBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    navBadge.setAttribute("aria-label", `${unreadCount} unread notifications`);
    markAllButton.disabled = unreadCount === 0;
    clearReadButton.disabled = !items.some((item) => item.read);
    markAllButton.setAttribute("aria-label", `Mark all ${unreadCount} unread notifications as read`);
    const categoryCounts = new Map();
    items.forEach((item) => categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1));
    document.querySelectorAll("[data-category-count]").forEach((count) => {
      const category = count.dataset.categoryCount;
      const categoryCount = categoryCounts.get(category) || 0;
      count.textContent = String(categoryCount);
      count.parentElement.setAttribute("aria-label", `${category}: ${categoryCount} notifications`);
    });
    document.querySelectorAll("[data-tab-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(filters.tab === button.dataset.tabFilter));
    });
    document.querySelectorAll("[data-category-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(filters.category === button.dataset.categoryFilter));
    });
    document.querySelectorAll("[data-summary-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(filters.summary === button.dataset.summaryFilter));
    });
  }

  function render() {
    if (stopped) return;
    const items = currentItems();
    const completed = sourceStatusDone();
    const failures = SOURCE_NAMES.filter((name) => sourceStatus[name] === "failed");
    loadingSkeleton.hidden = SOURCE_NAMES.some((name) =>
      sourceStatus[name] === "loaded" || sourceStatus[name] === "failed",
    );
    fullError.hidden = !(completed && failures.length === SOURCE_NAMES.length);
    sourceBanner.hidden = failures.length === 0 || failures.length === SOURCE_NAMES.length;
    sourceBannerText.textContent = storageWarning
      ? `${storageWarning} Some notifications couldn't be loaded.`
      : "Some notifications couldn't be loaded.";
    document.getElementById("retryNotifications").disabled = failures.length === 0;
    if (completed) main.setAttribute("aria-busy", "false");
    updateControls(items);
    if (completed && failures.length === SOURCE_NAMES.length) list.replaceChildren();
    else renderGroups(matchingItems(items));
    offlineNote.hidden = navigator.onLine && !storageWarning;
    offlineNote.textContent = storageWarning || "You’re offline. Showing notifications already loaded in this browser.";
  }

  function refreshReadState() {
    readLocalState();
    render();
  }

  function setRead(item, read) {
    localState.readStates[item.id] = read;
    saveLocalState();
    render();
  }

  function removeItem(item) {
    const removed = new Set(localState.removedIds);
    removed.add(item.id);
    localState.removedIds = [...removed];
    saveLocalState();
    render();
  }

  function retryFailed() {
    const names = SOURCE_NAMES.filter((name) => sourceStatus[name] === "failed" || sourceStatus[name] === "idle");
    if (names.length) void startSources(names);
  }

  async function startSources(names = SOURCE_NAMES) {
    const loaders = {
      events: loadEvents,
      accounts: loadAccounts,
      settings: loadSettings,
      audit: loadAudit,
      stored: loadStoredNotifications,
    };
    await Promise.all(names.map((name) => loadSource(name, loaders[name])));
    if (!stopped && sourceStatusDone()) window.dispatchEvent(new Event("page-data-ready"));
  }

  function showAccessError() {
    if (stopped) return;
    loadingSkeleton.hidden = true;
    document.getElementById("accessError").hidden = false;
    main.setAttribute("aria-busy", "false");
  }

  function handleAuthorized(user, profile) {
    if (sourcesStarted || stopped) return;
    const role = String(profile?.role || profile?.userRole || "").toLowerCase().replace(/[^a-z]/g, "");
    const status = String(profile?.status || "active").trim().toLowerCase();
    if (!user || role !== "superadmin" || profile?.isActive === false || ["disabled", "inactive", "suspended"].includes(status)) {
      showAccessError();
      return;
    }
    sourcesStarted = true;
    window.clearTimeout(authTimer);
    document.getElementById("accessError").hidden = true;
    stateKey = `recovibeSuperAdminNotifications:${user.uid}`;
    readLocalState();
    void startSources();
  }

  async function authorizeUser(user) {
    if (!user || stopped) {
      showAccessError();
      return;
    }
    try {
      const profileSnapshot = await getDoc(doc(db, "adminUser", user.uid));
      if (stopped) return;
      if (!profileSnapshot.exists()) {
        showAccessError();
        return;
      }
      const profile = profileSnapshot.data();
      const fullName = profileName(profile) || safeText(user.displayName) || "Super Admin";
      document.getElementById("sidebar-user-name").textContent = fullName;
      document.getElementById("sidebar-user-avatar").textContent = fullName.charAt(0).toUpperCase();
      document.getElementById("sidebar-user-role").textContent = "Super Admin account";
      handleAuthorized(user, profile);
    } catch (error) {
      if (stopped) return;
      console.error("[SuperAdminNotifications] authorization failed:", error?.code || "unknown", error?.message || String(error));
      showAccessError();
    }
  }

  function handleClick(event) {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target || !root.contains(target)) return;
    if (target.dataset.tabFilter) {
      filters.tab = target.dataset.tabFilter;
      filters.summary = "all";
      render();
      return;
    }
    if (target.dataset.categoryFilter) {
      filters.category = filters.category === target.dataset.categoryFilter ? "" : target.dataset.categoryFilter;
      render();
      return;
    }
    if (target.dataset.summaryFilter) {
      filters.summary = filters.summary === target.dataset.summaryFilter ? "all" : target.dataset.summaryFilter;
      if (filters.summary === "needsAction" || filters.summary === "unread") filters.tab = "all";
      render();
      return;
    }
    if (target.id === "markAllRead") {
      currentItems().filter((item) => !item.read).forEach((item) => { localState.readStates[item.id] = true; });
      saveLocalState();
      render();
      return;
    }
    if (target.id === "clearRead") {
      const removed = new Set(localState.removedIds);
      currentItems().filter((item) => item.read).forEach((item) => removed.add(item.id));
      localState.removedIds = [...removed];
      saveLocalState();
      render();
      return;
    }
    if (target.id === "retryNotifications" || target.id === "retryAllNotifications") {
      retryFailed();
      return;
    }
    const card = target.closest("[data-notification-id]");
    if (!card) return;
    const item = currentItems().find((entry) => entry.id === card.dataset.notificationId);
    if (!item) return;
    if (target.dataset.action === "toggle-read") setRead(item, !item.read);
    if (target.dataset.action === "remove") removeItem(item);
  }

  function handleInput(event) {
    if (event.target === searchInput) {
      filters.search = searchInput.value;
      render();
    }
  }

  function handleStorage(event) {
    if (event.key === stateKey) {
      readLocalState();
      render();
    }
  }

  function handlePageHide() {
    stopped = true;
    window.clearTimeout(authTimer);
    if (authUnsubscribe) {
      authUnsubscribe();
      authUnsubscribe = null;
    }
    sourceTimers.forEach((timer) => window.clearTimeout(timer));
    sourceTimers.clear();
    pageController.abort();
    window.removeEventListener("pagehide", handlePageHide);
  }

  function initialize() {
    root.addEventListener("click", handleClick, { signal: pageController.signal });
    root.addEventListener("input", handleInput, { signal: pageController.signal });
    window.addEventListener("online", render, { signal: pageController.signal });
    window.addEventListener("offline", render, { signal: pageController.signal });
    window.addEventListener("storage", handleStorage, { signal: pageController.signal });
    window.addEventListener("pagehide", handlePageHide, { once: true });
    document.getElementById("logoutLink").addEventListener("click", (event) => {
      event.preventDefault();
      void logoutSuperAdmin(auth, event.currentTarget, event.currentTarget.getAttribute("href") || "SuperAdminLogin.html");
    }, { signal: pageController.signal });
    if (!isFirebaseConfigured || !auth || !db) {
      SOURCE_NAMES.forEach((name) => {
        sourceStatus[name] = "failed";
        const error = new Error("Firebase is not configured.");
        error.code = "unavailable";
        console.error(`[SuperAdminNotifications] ${name} failed:`, error.code, error.message);
      });
      render();
      return;
    }
    authTimer = window.setTimeout(() => {
      if (!sourcesStarted) showAccessError();
    }, READ_TIMEOUT_MS);
    authUnsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (!user) {
          showAccessError();
          return;
        }
        void authorizeUser(user);
      },
      (error) => {
        console.error("[SuperAdminNotifications] authentication failed:", error?.code || "unknown", error?.message || String(error));
        showAccessError();
      },
    );
    render();
  }

  initialize();
})();