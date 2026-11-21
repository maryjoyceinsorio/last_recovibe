import { deleteApp, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";
import { logoutSuperAdmin } from "./superAdminLogout.js";
import { DEFAULTS, getSystemSettings } from "../systemSettingsDefaults.js";

(() => {
  "use strict";

  const PAGE_SIZE = 10;
  const ALLOWED_ROLES = ["Student", "Event Organizer", "Admin", "Teacher", "Super Admin"];
  const MAIN = document.getElementById("main-content");
  const BODY = document.getElementById("user-table-tbody");
  const TOAST = document.getElementById("user-management-status");
  const LOAD_ERROR = document.getElementById("user-load-error");
  const LOAD_ERROR_MESSAGE = document.getElementById("user-load-error-message");
  const RETRY_BUTTON = document.getElementById("retry-user-load");
  const SEARCH_INPUT = document.getElementById("user-search-input");
  const RESULT_COUNT = document.getElementById("user-result-count");
  const PAGINATION_SUMMARY = document.getElementById("user-pagination-summary");
  const PREVIOUS_BUTTON = document.getElementById("previous-user-page");
  const NEXT_BUTTON = document.getElementById("next-user-page");
  const CREATE_BUTTON = document.getElementById("create-user-button");
  const DETAILS_DIALOG = document.getElementById("user-details-modal-backdrop");
  const CREATE_DIALOG = document.getElementById("create-user-dialog");
  const ACCOUNT_TYPE_DIALOG = document.getElementById("account-type-dialog");
  const EDIT_PROFILE_DIALOG = document.getElementById("edit-profile-dialog");
  const ACTION_CONFIRM_DIALOG = document.getElementById("action-confirm-dialog");
  const CREATE_FORM = document.getElementById("create-user-form");
  const EDIT_PROFILE_FORM = document.getElementById("edit-profile-form");
  const EDIT_FIRST_NAME_INPUT = document.getElementById("edit-user-first-name");
  const EDIT_MIDDLE_NAME_INPUT = document.getElementById("edit-user-middle-name");
  const EDIT_LAST_NAME_INPUT = document.getElementById("edit-user-last-name");
  const EDIT_ACCOUNT_INPUT = document.getElementById("edit-user-account-number");
  const EDIT_EMAIL_INPUT = document.getElementById("edit-user-email");
  const EDIT_CONTACT_INPUT = document.getElementById("edit-user-contact-number");
  const EDIT_SUFFIX_INPUT = document.getElementById("edit-user-role-suffix");
  const EDIT_PROGRAM_INPUT = document.getElementById("edit-user-program");
  const CREATE_ROLE_INPUT = document.getElementById("new-user-role-value");
  const CREATE_ROLE_SELECT = document.getElementById("new-user-role");
  const CREATE_FIRST_NAME_INPUT = document.getElementById("new-user-first-name");
  const CREATE_MIDDLE_NAME_INPUT = document.getElementById("new-user-middle-name");
  const CREATE_LAST_NAME_INPUT = document.getElementById("new-user-last-name");
  const CREATE_NO_MIDDLE_NAME_INPUT = document.getElementById("new-user-no-middle-name");
  const CREATE_EMAIL_INPUT = document.getElementById("new-user-email");
  const CREATE_ACCOUNT_INPUT = document.getElementById("new-user-account");
  const CREATE_PASSWORD_INPUT = document.getElementById("new-user-password");
  const CREATE_PASSWORD_CONFIRMATION_INPUT = document.getElementById("new-user-password-confirmation");
  const CREATE_ORGANIZATION_INPUT = document.getElementById("new-user-organization");
  const CREATE_ORGANIZATION_SELECT = document.getElementById("new-user-organization-select");
  const CREATE_SUFFIX_INPUT = document.getElementById("new-user-role-suffix");
  const CREATE_AUTH_FIELDS = document.getElementById("staff-auth-fields");
  const CREATE_ORGANIZATION_FIELD = document.getElementById("field-user-organization");
  const CREATE_ORGANIZATION_SELECT_FIELD = document.getElementById("field-user-organization-select");
  const CREATE_SUFFIX_FIELD = document.getElementById("field-user-suffix");
  const CREATE_ACCOUNT_LABEL = document.getElementById("new-user-account-label");
  const STATUS_ACTION_BUTTON = document.getElementById("toggle-user-status-button");
  const EDIT_PROFILE_BUTTON = document.getElementById("edit-user-button");
  const DELETE_USER_BUTTON = document.getElementById("delete-user-button");
  const AUDIT_LINK = document.getElementById("view-user-activity");
  const EDIT_ROLE_SELECT = document.getElementById("edit-user-role");
  const EDIT_PROFILE_HINT = document.getElementById("edit-profile-hint");
  const EDIT_ORGANIZATION_SELECT = document.getElementById("edit-user-organization");
  const EDIT_ORGANIZATION_FIELD = document.getElementById("edit-user-organization-field");
  const EDIT_PROGRAM_FIELD = document.getElementById("edit-user-program-field");
  const EDIT_ROLE_SUFFIX_FIELD = document.getElementById("edit-user-role-suffix-field");
  const EDIT_PROFILE_SAVE_BUTTON = document.getElementById("save-edit-profile-button");
  const CONFIRM_TITLE = document.getElementById("action-confirm-title");
  const CONFIRM_MESSAGE = document.getElementById("action-confirm-message");
  const CONFIRM_BUTTON = document.getElementById("confirm-action-button");
  const CANCEL_CONFIRM_BUTTON = document.getElementById("cancel-action-confirm");
  const DETAILS_CLOSE_BUTTON = DETAILS_DIALOG?.querySelector("[data-close-dialog]");

  let users = [];
  let adminUsers = [];
  let sourceLoaded = { users: false, adminUser: false };
  let sourceErrors = { users: "", adminUser: "" };
  let unsubscribeUsers = null;
  let unsubscribeAdminUsers = null;
  let authUnsubscribe = null;
  let currentAdmin = null;
  let currentAdminName = "";
  let selectedUserKey = "";
  let roleFilter = "All";
  let suspendedOnly = false;
  let sortKey = "name";
  let sortDirection = "asc";
  let currentPage = 1;
  let searchTimer = null;
  let toastTimer = null;
  let pageReadySignaled = false;
  let accountNumberManuallyEdited = false;
  let pendingAction = null;

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function profileName(profile, user) {
    return String(
      [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ")
        || profile.fullName
        || profile.name
        || user.displayName
        || user.email
        || "Super Admin",
    );
  }

  function renderSidebarProfile(profile, user) {
    const fullName = profileName(profile, user);
    const sidebarName = document.getElementById("sidebar-user-name");
    const sidebarRole = document.getElementById("sidebar-user-role");
    const sidebarAvatar = document.getElementById("sidebar-user-avatar");
    if (sidebarName) sidebarName.textContent = fullName;
    if (sidebarRole) sidebarRole.textContent = "Super Admin account";
    if (sidebarAvatar) sidebarAvatar.textContent = fullName.trim().charAt(0).toUpperCase() || "S";
  }

  function normalizedText(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function normalizedRole(value) {
    const role = normalizedText(value).replace(/[_-]+/g, " ").replace(/\s+/g, " ");
    const roles = {
      student: "Student",
      "event organizer": "Event Organizer",
      eventorganizer: "Event Organizer",
      admin: "Admin",
      teacher: "Teacher",
      "super admin": "Super Admin",
      superadmin: "Super Admin",
    };
    return roles[role] || "Unknown";
  }

  function statusFor(data) {
    const source = data.status ?? (data.isActive === false ? "Inactive" : "Active");
    const status = String(source || "Active").trim();
    const canonical = {
      active: "Active",
      suspended: "Suspended",
      inactive: "Inactive",
      disabled: "Disabled",
    };
    return canonical[normalizedText(status)] || status || "Active";
  }

  function normalizeUser(snapshot, collectionName) {
    const data = snapshot.data() || {};
    const firstLast = [data.firstName, data.lastName].filter(Boolean).join(" ").trim();
    const fullName = String(data.fullName || firstLast || data.name || data.displayName || "Unnamed user").trim();
    return {
      id: snapshot.id,
      uid: String(data.uid || snapshot.id),
      collectionName,
      data,
      fullName,
      email: String(data.email || ""),
      accountNumber: String(data.accountNumber || data.studentNumber || data.accountNo || data.studentNo || ""),
      role: normalizedRole(data.role || data.userRole || (collectionName === "users" ? "Student" : "")),
      status: statusFor(data),
    };
  }

  function userKey(user) {
    return `${user.collectionName}:${user.id}`;
  }

  function getAllUsers() {
    return users.concat(adminUsers);
  }

  function getCurrentUser(key) {
    return getAllUsers().find((user) => userKey(user) === key) || null;
  }

  function isSuspended(user) {
    return normalizedText(user.status) === "suspended";
  }

  function isActive(user) {
    return normalizedText(user.status) === "active";
  }

  function isOwnAccount(user) {
    return Boolean(currentAdmin && (user.uid === currentAdmin.uid || user.id === currentAdmin.uid));
  }

  function activeSuperAdminCount() {
    return adminUsers.filter((user) => user.role === "Super Admin" && isActive(user)).length;
  }

  function isLastActiveSuperAdmin(user) {
    return user.role === "Super Admin" && isActive(user) && activeSuperAdminCount() <= 1;
  }

  function canChangeToRole(user, role) {
    if (!ALLOWED_ROLES.includes(role)) return false;
    if (user.collectionName === "users") return role === "Student";
    return role !== "Student";
  }

  function showToast(message, type) {
    if (!TOAST) return;
    TOAST.textContent = String(message);
    TOAST.dataset.state = type || "success";
    TOAST.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      TOAST.hidden = true;
    }, 6500);
  }

  function signalPageReady() {
    if (pageReadySignaled) return;
    pageReadySignaled = true;
    window.dispatchEvent(new Event("page-data-ready"));
  }

  function setLoadError(message, retryPage) {
    if (LOAD_ERROR_MESSAGE) LOAD_ERROR_MESSAGE.textContent = message;
    if (LOAD_ERROR) LOAD_ERROR.hidden = false;
    if (RETRY_BUTTON) {
      RETRY_BUTTON.onclick = retryPage ? () => window.location.reload() : () => subscribeUserCollections();
    }
    signalPageReady();
  }

  function clearLoadError() {
    if (LOAD_ERROR) LOAD_ERROR.hidden = true;
    if (LOAD_ERROR_MESSAGE) LOAD_ERROR_MESSAGE.textContent = "";
  }

  function getRoleClass(role) {
    return normalizedText(role).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
  }

  function renderSummary(allUsers) {
    const count = (role) => allUsers.filter((user) => user.role === role).length;
    const summary = {
      "summary-total": allUsers.length,
      "summary-students": count("Student"),
      "summary-organizers": count("Event Organizer"),
      "summary-staff": allUsers.filter((user) => ["Admin", "Teacher", "Super Admin"].includes(user.role)).length,
      "summary-suspended": allUsers.filter(isSuspended).length,
    };
    Object.entries(summary).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) element.textContent = String(value);
    });
  }

  function matchesFilters(user) {
    const searchTerm = normalizedText(SEARCH_INPUT?.value);
    const matchesSearch = !searchTerm || [user.fullName, user.email, user.accountNumber]
      .some((value) => normalizedText(value).includes(searchTerm));
    const matchesRole = roleFilter === "All" || user.role === roleFilter;
    const matchesStatus = !suspendedOnly || isSuspended(user);
    return matchesSearch && matchesRole && matchesStatus;
  }

  function filteredUsers() {
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    return getAllUsers()
      .filter(matchesFilters)
      .sort((a, b) => {
        let comparison = 0;
        if (sortKey === "role") comparison = collator.compare(a.role, b.role);
        else if (sortKey === "status") comparison = collator.compare(a.status, b.status);
        else comparison = collator.compare(a.fullName, b.fullName);
        return sortDirection === "asc" ? comparison : -comparison;
      });
  }

  function renderSkeletonRows() {
    if (!BODY) return;
    BODY.innerHTML = "";
    for (let index = 0; index < 5; index += 1) {
      const row = document.createElement("tr");
      row.className = "user-skeleton-row";
      for (let column = 0; column < 5; column += 1) {
        const cell = document.createElement("td");
        const skeleton = document.createElement("span");
        skeleton.className = "user-skeleton";
        skeleton.setAttribute("aria-hidden", "true");
        cell.appendChild(skeleton);
        row.appendChild(cell);
      }
      BODY.appendChild(row);
    }
  }

  function renderEmptyState() {
    if (!BODY) return;
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "user-empty-cell";
    cell.innerHTML = `<div class="user-empty-state"><span class="user-empty-icon" aria-hidden="true">⌕</span><p>${esc("No users match your filters")}</p><button class="user-clear-filters" type="button">Clear filters</button></div>`;
    cell.querySelector(".user-clear-filters")?.addEventListener("click", clearFilters);
    row.appendChild(cell);
    BODY.appendChild(row);
  }

  function renderLoadFailureRow() {
    if (!BODY) return;
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.className = "user-empty-cell";
    cell.textContent = "User data could not be loaded. Retry to try again.";
    row.appendChild(cell);
    BODY.appendChild(row);
  }

  function renderUserRow(user) {
    const row = document.createElement("tr");
    row.dataset.userKey = userKey(user);
    if (userKey(user) === selectedUserKey) row.classList.add("is-selected");

    const userCell = document.createElement("td");
    userCell.className = "user-identity-cell";
    const avatar = document.createElement("span");
    avatar.className = "user-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = user.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
    const identity = document.createElement("span");
    identity.className = "user-identity-copy";
    const name = document.createElement("strong");
    name.textContent = user.fullName;
    const email = document.createElement("span");
    email.className = "user-row-email";
    email.textContent = user.email || "No email on file";
    identity.append(name, email);
    userCell.append(avatar, identity);

    const accountCell = document.createElement("td");
    accountCell.className = "user-account-cell";
    const account = document.createElement("span");
    account.textContent = user.accountNumber || "—";
    accountCell.appendChild(account);

    const roleCell = document.createElement("td");
    const rolePill = document.createElement("span");
    rolePill.className = `user-role-pill role--${getRoleClass(user.role)}`;
    rolePill.textContent = user.role;
    roleCell.appendChild(rolePill);

    const statusCell = document.createElement("td");
    const statusPill = document.createElement("span");
    statusPill.className = `user-status-pill ${isSuspended(user) ? "status--suspended" : isActive(user) ? "status--active" : "status--inactive"}`;
    statusPill.textContent = user.status;
    statusCell.appendChild(statusPill);

    const actionCell = document.createElement("td");
    const viewButton = document.createElement("button");
    viewButton.className = "user-view-button";
    viewButton.type = "button";
    viewButton.textContent = "View";
    viewButton.setAttribute("aria-label", `View details for ${user.fullName}`);
    viewButton.addEventListener("click", () => openUserDetails(userKey(user)));
    actionCell.appendChild(viewButton);

    row.append(userCell, accountCell, roleCell, statusCell, actionCell);
    return row;
  }

  function renderPagination(total) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    currentPage = Math.min(Math.max(currentPage, 1), pages);
    const first = total ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
    const last = Math.min(currentPage * PAGE_SIZE, total);
    if (PAGINATION_SUMMARY) PAGINATION_SUMMARY.textContent = `Showing ${first} to ${last} of ${total}`;
    if (PREVIOUS_BUTTON) PREVIOUS_BUTTON.disabled = currentPage <= 1 || !sourceLoaded.users || !sourceLoaded.adminUser;
    if (NEXT_BUTTON) NEXT_BUTTON.disabled = currentPage >= pages || !sourceLoaded.users || !sourceLoaded.adminUser;
  }

  function renderSortState() {
    document.querySelectorAll(".user-sort-button").forEach((button) => {
      const header = button.closest("th");
      const marker = button.querySelector("span");
      const active = button.dataset.sort === sortKey;
      if (header) header.setAttribute("aria-sort", active ? (sortDirection === "asc" ? "ascending" : "descending") : "none");
      if (marker) marker.textContent = active ? (sortDirection === "asc" ? "↑" : "↓") : "↕";
    });
  }

  function renderUsers() {
    if (!BODY) return;
    const allUsers = getAllUsers();
    const ready = sourceLoaded.users && sourceLoaded.adminUser;
    const errors = Object.values(sourceErrors).filter(Boolean);
    const results = filteredUsers();
    renderSummary(allUsers);
    renderSortState();

    if (RESULT_COUNT) {
      RESULT_COUNT.textContent = ready
        ? `${results.length} ${results.length === 1 ? "user" : "users"}${roleFilter !== "All" || suspendedOnly || normalizedText(SEARCH_INPUT?.value) ? " matching filters" : ""}`
        : "Loading users…";
    }
    if (MAIN) MAIN.setAttribute("aria-busy", String(!ready));
    if (CREATE_BUTTON) CREATE_BUTTON.disabled = !ready || errors.length > 0;
    if (errors.length) {
      setLoadError(errors.join(" "), false);
    } else {
      clearLoadError();
    }

    BODY.replaceChildren();
    if (!ready) {
      renderSkeletonRows();
      renderPagination(0);
      return;
    }
    if (results.length === 0) {
      if (errors.length && allUsers.length === 0) renderLoadFailureRow();
      else renderEmptyState();
      renderPagination(0);
      return;
    }

    const start = (currentPage - 1) * PAGE_SIZE;
    results.slice(start, start + PAGE_SIZE).forEach((user) => BODY.appendChild(renderUserRow(user)));
    renderPagination(results.length);
    if (DETAILS_DIALOG?.open && selectedUserKey && !results.some((user) => userKey(user) === selectedUserKey)) {
      closeDetails();
    } else if (DETAILS_DIALOG?.open && selectedUserKey) {
      updateDetailsPanel();
    }
  }

  function clearFilters() {
    if (SEARCH_INPUT) SEARCH_INPUT.value = "";
    roleFilter = "All";
    suspendedOnly = false;
    currentPage = 1;
    document.querySelectorAll("[data-role-filter]").forEach((button) => {
      const active = button.dataset.roleFilter === "All";
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const suspendedButton = document.getElementById("suspended-only-filter");
    if (suspendedButton) {
      suspendedButton.classList.remove("is-active");
      suspendedButton.setAttribute("aria-pressed", "false");
    }
    renderUsers();
  }

  function roleBadgeClass(element, role) {
    element.className = `user-role-pill role--${getRoleClass(role)}`;
  }

  function setEditRoleChoices(user) {
    if (!EDIT_ROLE_SELECT) return;
    const lastSuperAdmin = isLastActiveSuperAdmin(user);
    const ownAccount = isOwnAccount(user);
    Array.from(EDIT_ROLE_SELECT.options).forEach((option) => {
      const sameCollection = canChangeToRole(user, option.value);
      const wouldDemoteLastSuperAdmin = lastSuperAdmin && option.value !== "Super Admin";
      const wouldChangeOwnRole = ownAccount && option.value !== user.role;
      option.disabled = !sameCollection || wouldDemoteLastSuperAdmin || wouldChangeOwnRole;
      option.title = !sameCollection
        ? "Changing to this role requires moving the profile to another collection, which is not supported."
        : wouldDemoteLastSuperAdmin
          ? "The last active superadmin cannot be demoted."
          : wouldChangeOwnRole
            ? "You cannot change your own role."
          : "";
    });
    EDIT_ROLE_SELECT.value = user.role;
    if (EDIT_PROFILE_HINT) {
      const collectionNote = user.collectionName === "users"
        ? "This profile is stored in users; only Student can be assigned."
        : "This profile is stored in adminUser; Student cannot be assigned without moving profile data.";
      EDIT_PROFILE_HINT.textContent = [
        collectionNote,
        ownAccount ? "Your own role cannot be changed here." : "",
        lastSuperAdmin ? "The last active superadmin cannot be demoted or deleted." : "",
        "Email changes update the Firestore profile; Firebase Authentication email is unchanged.",
      ].filter(Boolean).join(" ");
    }
  }

  function updateDetailsPanel() {
    const user = getCurrentUser(selectedUserKey);
    if (!user || !DETAILS_DIALOG) return;
    const name = document.getElementById("user-details-name");
    const avatar = document.getElementById("user-details-avatar");
    const role = document.getElementById("user-details-role");
    const status = document.getElementById("user-details-status");
    const email = document.getElementById("user-detail-email");
    const account = document.getElementById("user-detail-account-number");
    const roleValue = document.getElementById("user-detail-role");
    const statusValue = document.getElementById("user-detail-status-value");
    if (name) name.textContent = user.fullName;
    if (avatar) avatar.textContent = user.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
    if (role) {
      role.textContent = user.role;
      roleBadgeClass(role, user.role);
    }
    if (status) {
      status.textContent = user.status;
      status.className = `user-status-pill ${isSuspended(user) ? "status--suspended" : isActive(user) ? "status--active" : "status--inactive"}`;
    }
    if (email) email.textContent = user.email || "No email on file";
    if (account) account.textContent = user.accountNumber || "—";
    if (roleValue) roleValue.textContent = user.role;
    if (statusValue) statusValue.textContent = user.status;

    const ownAccount = isOwnAccount(user);
    const lastSuperAdmin = isLastActiveSuperAdmin(user);
    const canToggleStatus = !ownAccount && !(lastSuperAdmin && isActive(user));
    if (STATUS_ACTION_BUTTON) {
      STATUS_ACTION_BUTTON.textContent = isActive(user) ? "Suspend account" : "Reactivate account";
      STATUS_ACTION_BUTTON.classList.toggle("danger", isActive(user));
      STATUS_ACTION_BUTTON.classList.toggle("primary", !isActive(user));
      STATUS_ACTION_BUTTON.disabled = !canToggleStatus;
      STATUS_ACTION_BUTTON.title = ownAccount
        ? "You cannot suspend or reactivate your own account."
        : lastSuperAdmin && isActive(user)
          ? "The last active superadmin cannot be suspended."
          : "";
    }
    if (EDIT_PROFILE_BUTTON) {
      EDIT_PROFILE_BUTTON.disabled = false;
      EDIT_PROFILE_BUTTON.title = "Edit this user's profile details.";
    }
    if (DELETE_USER_BUTTON) {
      DELETE_USER_BUTTON.disabled = ownAccount || lastSuperAdmin;
      DELETE_USER_BUTTON.title = ownAccount
        ? "You cannot delete your own account profile."
        : lastSuperAdmin
          ? "The last active superadmin profile cannot be deleted."
          : "Remove this user's Firestore profile.";
    }
    const safetyNote = document.getElementById("user-safety-note");
    if (safetyNote) {
      safetyNote.textContent = ownAccount
        ? "Your own account cannot be suspended or deleted here. Your role also cannot be changed."
        : lastSuperAdmin && isActive(user)
          ? "This is the last active superadmin and cannot be suspended, demoted, or deleted."
          : "";
    }
    if (AUDIT_LINK) {
      const params = new URLSearchParams();
      params.set("user", user.fullName);
      params.set("uid", user.uid || user.id);
      AUDIT_LINK.href = `SuperAdminAuditLogs.html?${params.toString()}`;
    }
  }

  function updateEditOrganizationFields(role) {
    if (EDIT_ORGANIZATION_FIELD) EDIT_ORGANIZATION_FIELD.hidden = role === "Student";
    if (EDIT_PROGRAM_FIELD) EDIT_PROGRAM_FIELD.hidden = role !== "Student";
    if (EDIT_ROLE_SUFFIX_FIELD) {
      EDIT_ROLE_SUFFIX_FIELD.hidden = !["Admin", "Teacher", "Super Admin"].includes(role);
    }
  }

  async function openEditProfile() {
    const user = selectedUserKey ? getCurrentUser(selectedUserKey) : null;
    if (!user || !EDIT_PROFILE_FORM) return;
    const parts = user.fullName.split(/\s+/).filter(Boolean);
    const data = user.data || {};
    EDIT_FIRST_NAME_INPUT.value = String(data.firstName || parts[0] || "");
    EDIT_MIDDLE_NAME_INPUT.value = String(
      data.middleName || (parts.length > 2 ? parts.slice(1, -1).join(" ") : ""),
    );
    EDIT_LAST_NAME_INPUT.value = String(
      data.lastName || (parts.length > 1 ? parts[parts.length - 1] : ""),
    );
    EDIT_ACCOUNT_INPUT.value = user.accountNumber;
    EDIT_EMAIL_INPUT.value = user.email;
    EDIT_CONTACT_INPUT.value = String(data.contactNumber || "");
    EDIT_SUFFIX_INPUT.value = String(data.roleSuffix || "");
    EDIT_PROGRAM_INPUT.value = String(
      data.program || data.department || data.organizationDepartment || data.organization || "",
    );
    setEditRoleChoices(user);
    updateEditOrganizationFields(user.role);
    await loadOrganizationOptions(EDIT_ORGANIZATION_SELECT);
    const organizationCode = organizationCodeFromRecord({
      organizationCode: data.organizationCode,
      orgCode: data.orgCode,
      organization: data.organization,
      organizationName: data.organizationName,
      orgName: data.orgName,
    });
    if (
      organizationCode &&
      !Array.from(EDIT_ORGANIZATION_SELECT.options).some(
        (option) => option.value === organizationCode,
      )
    ) {
      EDIT_ORGANIZATION_SELECT.add(new Option(organizationCode, organizationCode));
    }
    EDIT_ORGANIZATION_SELECT.value = organizationCode;
    EDIT_PROFILE_DIALOG?.showModal();
    EDIT_FIRST_NAME_INPUT.focus();
  }

  function openUserDetails(key) {
    selectedUserKey = key;
    renderUsers();
    updateDetailsPanel();
    if (!DETAILS_DIALOG?.open) DETAILS_DIALOG?.showModal();
    DETAILS_CLOSE_BUTTON?.focus();
  }

  function closeDetails() {
    if (DETAILS_DIALOG?.open) DETAILS_DIALOG.close();
    selectedUserKey = "";
    renderUsers();
  }

  function showConfirm(action, title, message, confirmText) {
    pendingAction = action;
    if (CONFIRM_TITLE) CONFIRM_TITLE.textContent = title;
    if (CONFIRM_MESSAGE) CONFIRM_MESSAGE.textContent = message;
    if (CONFIRM_BUTTON) CONFIRM_BUTTON.textContent = confirmText || "Confirm";
    if (!ACTION_CONFIRM_DIALOG?.open) ACTION_CONFIRM_DIALOG?.showModal();
  }

  function currentUserForAction(action) {
    return getCurrentUser(action.userKey);
  }

  function userActionError(error, operation) {
    const code = String(error?.code || "");
    if (code.includes("permission-denied")) return `Permission denied while ${operation}. Check the Firestore rules for this collection.`;
    if (code.includes("auth/email-already-in-use")) return "That email address is already associated with an Auth account.";
    if (code.includes("auth/weak-password")) return "The temporary password must be at least 8 characters.";
    if (code.includes("auth/invalid-email")) return "Enter a valid email address.";
    if (code.includes("auth/user-not-found")) return "No Auth account was found for this email address.";
    return `${operation} failed${error?.message ? `: ${error.message}` : "."}`;
  }

  async function writeAuditEntry({ action, target, summary, changes }) {
    try {
      await addDoc(collection(db, "audit_logs"), {
        timestamp: serverTimestamp(),
        user: currentAdminName || currentAdmin?.email || currentAdmin?.uid || "Super Admin",
        action,
        category: "User Management",
        targetUid: target.uid || target.id,
        targetName: target.fullName,
        summary,
        changes,
      });
    } catch (error) {
      console.warn("User Management audit entry could not be written.", error);
    }
  }

  async function confirmStatusChange(action) {
    const user = currentUserForAction(action);
    if (!user) throw new Error("The selected user is no longer available. Refresh the list and try again.");
    if (isOwnAccount(user)) throw new Error("You cannot suspend or reactivate your own account.");
    if (action.status === "Suspended" && isLastActiveSuperAdmin(user)) {
      throw new Error("The last active superadmin cannot be suspended.");
    }
    await updateDoc(doc(db, user.collectionName, user.id), {
      status: action.status,
      isActive: action.status === "Active",
      updatedAt: serverTimestamp(),
      updatedBy: currentAdmin.uid,
    });
    await writeAuditEntry({
      action: action.status === "Suspended" ? "suspend" : "reactivate",
      target: user,
      summary: `${user.fullName} was ${action.status === "Suspended" ? "suspended" : "reactivated"}.`,
      changes: [
        { field: "status", from: user.status, to: action.status },
        { field: "isActive", from: Boolean(user.data.isActive), to: action.status === "Active" },
      ],
    });
    showToast(`${user.fullName} was ${action.status === "Suspended" ? "suspended" : "reactivated"}.`);
  }

  function getProfileMemberships(data, previousOrganizationCode, nextOrganizationCode) {
    const memberships = Array.isArray(data.organizations) ? data.organizations : [];
    return memberships.filter((membership) => {
      const code = organizationCodeFromRecord(membership);
      return !code || (code !== previousOrganizationCode && code !== nextOrganizationCode);
    });
  }

  function buildEditProfileUpdates(user) {
    const role = EDIT_ROLE_SELECT.value;
    if (!canChangeToRole(user, role)) {
      throw new Error("Changing this role would require moving the profile to a different collection.");
    }
    if (isOwnAccount(user) && role !== user.role) {
      throw new Error("You cannot change your own role.");
    }
    if (isLastActiveSuperAdmin(user) && role !== "Super Admin") {
      throw new Error("The last active superadmin cannot be demoted.");
    }

    const firstName = EDIT_FIRST_NAME_INPUT.value.trim();
    const middleName = EDIT_MIDDLE_NAME_INPUT.value.trim();
    const lastName = EDIT_LAST_NAME_INPUT.value.trim();
    const email = EDIT_EMAIL_INPUT.value.trim().toLowerCase();
    const accountNumber = EDIT_ACCOUNT_INPUT.value.trim();
    if (duplicateProfileEmail(email, userKey(user))) {
      throw new Error("Another profile already uses this email address.");
    }
    if (duplicateAccountNumber(accountNumber, userKey(user))) {
      throw new Error("Another profile already uses this account number.");
    }

    const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");
    const profileUpdates = {
      firstName,
      lastName,
      fullName,
      email,
      accountNumber,
      role,
    };
    if (user.data.userRole !== undefined) profileUpdates.userRole = role;
    if (user.data.accountNo !== undefined) profileUpdates.accountNo = accountNumber;
    if (user.collectionName === "users" || user.data.studentNumber !== undefined) {
      profileUpdates.studentNumber = accountNumber;
    }
    if (user.data.studentNo !== undefined) profileUpdates.studentNo = accountNumber;
    const removeFields = [];
    if (middleName) profileUpdates.middleName = middleName;
    else removeFields.push("middleName");

    const contactNumber = EDIT_CONTACT_INPUT.value.trim();
    if (contactNumber) profileUpdates.contactNumber = contactNumber;
    else removeFields.push("contactNumber");
    if (user.data.contactNo !== undefined) {
      if (contactNumber) profileUpdates.contactNo = contactNumber;
      else removeFields.push("contactNo");
    }

    const roleSuffix = ["Admin", "Teacher", "Super Admin"].includes(role)
      ? EDIT_SUFFIX_INPUT.value.trim().toUpperCase()
      : "";
    if (roleSuffix) profileUpdates.roleSuffix = roleSuffix;
    else removeFields.push("roleSuffix");

    const oldOrganizationCode = organizationCodeFromRecord({
      organizationCode: user.data.organizationCode,
      orgCode: user.data.orgCode,
      organization: user.data.organization,
      organizationName: user.data.organizationName,
      orgName: user.data.orgName,
    });
    const nextOrganizationCode = role === "Student"
      ? ""
      : normalizeOrganizationCode(EDIT_ORGANIZATION_SELECT.value);
    if (role === "Student") {
      const program = EDIT_PROGRAM_INPUT.value.trim();
      if (program) {
        profileUpdates.program = program;
        profileUpdates.organization = program;
        profileUpdates.department = program;
        profileUpdates.organizationDepartment = program;
      } else {
        removeFields.push("program", "organization", "department", "organizationDepartment");
      }
    } else {
      if (nextOrganizationCode) {
        profileUpdates.organization = nextOrganizationCode;
        profileUpdates.organizationCode = nextOrganizationCode;
        profileUpdates.orgCode = nextOrganizationCode;
        profileUpdates.department = nextOrganizationCode;
        profileUpdates.organizationDepartment = nextOrganizationCode;
        const memberships = getProfileMemberships(
          user.data,
          oldOrganizationCode,
          nextOrganizationCode,
        );
        profileUpdates.organizations = [...memberships, nextOrganizationCode];
      } else {
        removeFields.push(
          "organization",
          "organizationCode",
          "orgCode",
          "organizationName",
          "orgName",
          "department",
          "organizationDepartment",
        );
        const memberships = getProfileMemberships(user.data, oldOrganizationCode, "");
        if (memberships.length) profileUpdates.organizations = memberships;
        else removeFields.push("organizations");
      }
    }

    const isOrgAdviser = role === "Admin" && isOrgAdviserSuffix(roleSuffix);
    if (isOrgAdviser && nextOrganizationCode) {
      const oldAdviserEmails = Array.isArray(user.data.adviserEmails)
        ? user.data.adviserEmails
        : [];
      profileUpdates.adviserEmail = email;
      profileUpdates.adviserEmails = [
        ...new Set([
          ...oldAdviserEmails
            .map((value) => String(value || "").trim().toLowerCase())
            .filter((value) => value && value !== normalizedText(user.email)),
          email,
        ]),
      ];
    } else {
      removeFields.push("adviserEmail", "adviserEmails");
    }

    return { profileUpdates, removeFields };
  }

  async function saveProfileEdits() {
    const user = selectedUserKey ? getCurrentUser(selectedUserKey) : null;
    if (!user) throw new Error("The selected user is no longer available. Refresh the list and try again.");
    const { profileUpdates, removeFields } = buildEditProfileUpdates(user);
    const firestoreUpdates = {
      ...profileUpdates,
      updatedAt: serverTimestamp(),
      updatedBy: currentAdmin.uid,
    };
    removeFields.forEach((field) => {
      firestoreUpdates[field] = deleteField();
    });
    await updateDoc(doc(db, user.collectionName, user.id), firestoreUpdates);

    const updatedData = { ...user.data, ...profileUpdates };
    removeFields.forEach((field) => delete updatedData[field]);
    const updatedUser = {
      ...user,
      data: updatedData,
      fullName: profileUpdates.fullName,
      email: profileUpdates.email,
      accountNumber: profileUpdates.accountNumber,
      role: profileUpdates.role,
    };
    if (user.collectionName === "users") {
      users = users.map((entry) => userKey(entry) === userKey(user) ? updatedUser : entry);
    } else {
      adminUsers = adminUsers.map((entry) => userKey(entry) === userKey(user) ? updatedUser : entry);
    }

    await writeAuditEntry({
      action: "user_profile_updated",
      target: updatedUser,
      summary: `Updated ${user.fullName}'s profile.`,
      changes: [
        { field: "fullName", from: user.fullName, to: profileUpdates.fullName },
        { field: "email", from: user.email, to: profileUpdates.email },
        { field: "accountNumber", from: user.accountNumber, to: profileUpdates.accountNumber },
        { field: "contactNumber", from: user.data.contactNumber || "", to: profileUpdates.contactNumber || "" },
        { field: "role", from: user.role, to: profileUpdates.role },
        { field: "roleSuffix", from: user.data.roleSuffix || "", to: profileUpdates.roleSuffix || "" },
        {
          field: "organizationCode",
          from: organizationCodeFromRecord(user.data),
          to: profileUpdates.organizationCode || "",
        },
      ],
    });
    EDIT_PROFILE_DIALOG?.close();
    renderUsers();
    updateDetailsPanel();
    showToast(`${updatedUser.fullName}'s profile was updated.`);
  }

  async function confirmDeleteUserProfile(action) {
    const user = currentUserForAction(action);
    if (!user) throw new Error("The selected user is no longer available. Refresh the list and try again.");
    if (isOwnAccount(user)) throw new Error("You cannot delete your own account profile.");
    if (isLastActiveSuperAdmin(user)) {
      throw new Error("The last active superadmin profile cannot be deleted.");
    }
    await deleteDoc(doc(db, user.collectionName, user.id));
    if (user.collectionName === "users") {
      users = users.filter((entry) => userKey(entry) !== userKey(user));
    } else {
      adminUsers = adminUsers.filter((entry) => userKey(entry) !== userKey(user));
    }
    await writeAuditEntry({
      action: "user_profile_deleted",
      target: user,
      summary: `Removed ${user.fullName}'s Firestore profile. Firebase Authentication account remains.`,
      changes: [{ field: "profile", from: "present", to: "deleted" }],
    });
    closeDetails();
    showToast("Firestore profile deleted. The Firebase Authentication account remains.");
  }

  function duplicateProfileEmail(email, excludeKey = "") {
    const normalizedEmail = normalizedText(email);
    return getAllUsers().some((user) =>
      userKey(user) !== excludeKey && normalizedText(user.email) === normalizedEmail,
    );
  }

  function duplicateAccountNumber(accountNumber, excludeKey = "") {
    const normalizedAccount = normalizedText(accountNumber);
    return normalizedAccount && getAllUsers().some((user) =>
      userKey(user) !== excludeKey && normalizedText(user.accountNumber) === normalizedAccount,
    );
  }

  function validateCreateUser() {
    if (!CREATE_FORM?.reportValidity()) return false;
    const role = CREATE_ROLE_INPUT?.value;
    const email = CREATE_EMAIL_INPUT?.value.trim();
    const accountNumber = CREATE_ACCOUNT_INPUT?.value.trim();
    const password = CREATE_PASSWORD_INPUT?.value || "";
    if (!ALLOWED_ROLES.includes(role)) {
      showToast("Choose a valid account role.", "error");
      return false;
    }
    if (password.length < 8) {
      CREATE_PASSWORD_INPUT?.setCustomValidity("Use at least 8 characters.");
      CREATE_PASSWORD_INPUT?.reportValidity();
      return false;
    }
    CREATE_PASSWORD_INPUT?.setCustomValidity("");
    if (password !== CREATE_PASSWORD_CONFIRMATION_INPUT?.value) {
      CREATE_PASSWORD_CONFIRMATION_INPUT?.setCustomValidity("Passwords do not match.");
      CREATE_PASSWORD_CONFIRMATION_INPUT?.reportValidity();
      return false;
    }
    CREATE_PASSWORD_CONFIRMATION_INPUT?.setCustomValidity("");
    if (duplicateProfileEmail(email)) {
      CREATE_EMAIL_INPUT?.setCustomValidity("An account with this email is already in the loaded profiles.");
      CREATE_EMAIL_INPUT?.reportValidity();
      return false;
    }
    CREATE_EMAIL_INPUT?.setCustomValidity("");
    if (duplicateAccountNumber(accountNumber)) {
      CREATE_ACCOUNT_INPUT?.setCustomValidity("This account number is already in use.");
      CREATE_ACCOUNT_INPUT?.reportValidity();
      return false;
    }
    CREATE_ACCOUNT_INPUT?.setCustomValidity("");
    return true;
  }

  function normalizeOrganizationCode(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
  }

  function organizationCodeFromRecord(organization, fallback = "") {
    if (typeof organization === "string") return normalizeOrganizationCode(organization);
    return normalizeOrganizationCode(
      organization?.code ||
      organization?.organizationCode ||
      organization?.orgCode ||
      organization?.id ||
      organization?.organization ||
      fallback,
    );
  }

  function profileDataForCreate({
    role,
    fullName,
    firstName,
    middleName,
    lastName,
    email,
    accountNumber,
    contactNumber,
    organization,
    organizationCode,
    roleSuffix,
  }) {
    const orgAdviser = role === "Admin" &&
      String(roleSuffix || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "") === "orgadviser";
    const normalizedOrganizationCode = normalizeOrganizationCode(organizationCode);
    const profile = {
      fullName,
      firstName,
      lastName,
      email,
      accountNumber,
      role,
      status: "Active",
      isActive: true,
      createdAt: serverTimestamp(),
    };
    if (middleName) profile.middleName = middleName;
    if (roleSuffix) profile.roleSuffix = roleSuffix;
    if (contactNumber) profile.contactNumber = contactNumber;
    if (organization) {
      profile.organization = organization;
      profile.department = organization;
      profile.organizationDepartment = organization;
    }
    if (normalizedOrganizationCode) {
      const profileOrganization = normalizedOrganizationCode;
      profile.organization = profileOrganization;
      profile.organizationCode = profileOrganization;
      profile.orgCode = profileOrganization;
      profile.organizations = [profileOrganization];
      profile.department = profileOrganization;
      profile.organizationDepartment = profileOrganization;
      if (orgAdviser) {
        const adviserEmail = String(email || "").trim().toLowerCase();
        profile.adviserEmail = adviserEmail;
        profile.adviserEmails = [adviserEmail];
      }
    }
    if (role === "Student") {
      profile.studentNumber = accountNumber;
      if (organization) profile.program = organization;
    }
    return profile;
  }

  async function createAuthAndProfile(data) {
    let secondaryApp = null;
    let secondaryAuth = null;
    try {
      secondaryApp = initializeApp(getApp().options, `user-management-create-${Date.now()}`);
      secondaryAuth = getAuth(secondaryApp);
      const credential = await createUserWithEmailAndPassword(secondaryAuth, data.email, data.password);
      const uid = credential.user.uid;
      const collectionName = data.role === "Student" ? "users" : "adminUser";
      const profile = profileDataForCreate(data);
      try {
        await setDoc(doc(db, collectionName, uid), { ...profile, uid });
      } catch (profileError) {
        const wrappedError = new Error(`The Auth account was created, but the ${collectionName} profile could not be written.`);
        wrappedError.code = profileError?.code || "profile-write-failed";
        wrappedError.createdUid = uid;
        wrappedError.cause = profileError;
        throw wrappedError;
      }
      return { uid, collectionName, profile };
    } finally {
      if (secondaryAuth) {
        try {
          await signOut(secondaryAuth);
        } catch (error) {
          console.warn("The temporary account-creation Auth session could not be signed out.", error);
        }
      }
      if (secondaryApp) {
        try {
          await deleteApp(secondaryApp);
        } catch (error) {
          console.warn("The temporary account-creation Firebase app could not be closed.", error);
        }
      }
    }
  }

  async function syncOrganizationAdviserMapping(data) {
    const organizationCode = normalizeOrganizationCode(data.organizationCode);
    const email = String(data.email || "").trim().toLowerCase();
    if (!db || !organizationCode || !email) {
      throw new Error("Organization and email are required to sync an adviser mapping.");
    }

    const configRef = doc(db, "system_settings", "global_config");
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(configRef);
      const config = snapshot.exists() ? snapshot.data() || {} : {};
      const configuredOrganizations = config.organizations;
      const isObjectMap = configuredOrganizations &&
        typeof configuredOrganizations === "object" &&
        !Array.isArray(configuredOrganizations);
      const hasConfiguredOrganizations = Array.isArray(configuredOrganizations)
        ? configuredOrganizations.length > 0
        : Boolean(isObjectMap && Object.keys(configuredOrganizations).length);
      const sourceOrganizations = hasConfiguredOrganizations && Array.isArray(configuredOrganizations)
        ? configuredOrganizations.map((organization) => ({ organization }))
        : hasConfiguredOrganizations && isObjectMap
          ? Object.entries(configuredOrganizations).map(([key, organization]) => ({
              key,
              organization: typeof organization === "object" && organization
                ? { code: key, ...organization }
                : { code: key, name: typeof organization === "string" ? organization : key },
            }))
          : DEFAULTS.global_config.organizations.map((organization) => ({ organization }));
      const organizations = sourceOrganizations.map(({ key, organization }) => {
        const record = typeof organization === "string"
          ? { code: organization }
          : { ...(organization || {}) };
        return { key, record };
      });

      let organizationEntry = organizations.find(({ key, record }) =>
        organizationCodeFromRecord(record, key) === organizationCode,
      );
      if (!organizationEntry) {
        const officialOrganization = DEFAULTS.global_config.organizations.find(
          (organization) => normalizeOrganizationCode(organization.code) === organizationCode,
        );
        organizationEntry = {
          record: officialOrganization
            ? { ...officialOrganization }
            : { code: organizationCode, name: organizationCode },
        };
        organizations.push(organizationEntry);
      }

      const existingAdviserEmails = [
        organizationEntry.record.adviserEmail,
        ...(Array.isArray(organizationEntry.record.adviserEmails)
          ? organizationEntry.record.adviserEmails
          : typeof organizationEntry.record.adviserEmails === "string"
            ? [organizationEntry.record.adviserEmails]
            : []),
      ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
      const updatedRecord = {
        ...organizationEntry.record,
        adviserEmail: existingAdviserEmails[0] || email,
        adviserEmails: [...new Set([...existingAdviserEmails, email])],
      };
      organizationEntry.record = updatedRecord;

      const nextOrganizations = isObjectMap
        ? Object.fromEntries(organizations.map(({ key, record }) => [
            key || organizationCodeFromRecord(record),
            record,
          ]))
        : organizations.map(({ record }) => record);
      transaction.set(configRef, { organizations: nextOrganizations }, { merge: true });
    });
  }

  async function createUserAndNotify(action) {
    const account = await createAuthAndProfile(action.data);
    let adviserMappingError = null;
    if (
      action.data.role === "Admin" &&
      isOrgAdviserSuffix(action.data.roleSuffix) &&
      action.data.organizationCode
    ) {
      try {
        await syncOrganizationAdviserMapping(action.data);
      } catch (error) {
        adviserMappingError = error;
        console.error("Could not sync the organization adviser mapping.", error);
      }
    }
    const target = {
      uid: account.uid,
      id: account.uid,
      fullName: action.data.fullName,
    };
    await writeAuditEntry({
      action: "user_created",
      target,
      summary: `Created ${action.data.role} account for ${action.data.fullName}.`,
      changes: [
        { field: "role", from: "", to: action.data.role },
        { field: "email", from: "", to: action.data.email },
        { field: "accountNumber", from: "", to: action.data.accountNumber },
        { field: "status", from: "", to: "Active" },
      ],
    });
    const mappingNotice = adviserMappingError
      ? " Organization adviser mapping could not be synced; the user profile was saved."
      : "";
    try {
      await sendPasswordResetEmail(auth, action.data.email);
      await writeAuditEntry({
        action: "password_reset_sent",
        target,
        summary: `Sent a password reset email to ${action.data.fullName}.`,
        changes: [{ field: "passwordResetEmail", from: "not sent", to: "sent" }],
      });
      showToast(`Account created. A password reset email was sent to ${action.data.email}.${mappingNotice}`);
    } catch (error) {
      showToast(`Account created, but the password reset email could not be sent: ${userActionError(error, "sending the password reset email")} UID: ${account.uid}.${mappingNotice}`, "error");
    }
    CREATE_FORM?.reset();
    accountNumberManuallyEdited = false;
    CREATE_DIALOG?.close();
  }

  async function executePendingAction() {
    if (!pendingAction || !currentAdmin) return;
    const action = pendingAction;
    if (CONFIRM_BUTTON) {
      CONFIRM_BUTTON.disabled = true;
      CONFIRM_BUTTON.setAttribute("aria-busy", "true");
    }
    try {
      if (action.type === "status") await confirmStatusChange(action);
      else if (action.type === "delete-profile") await confirmDeleteUserProfile(action);
      else if (action.type === "create") await createUserAndNotify(action);
      ACTION_CONFIRM_DIALOG?.close();
      pendingAction = null;
      renderUsers();
      if (selectedUserKey && getCurrentUser(selectedUserKey)) updateDetailsPanel();
    } catch (error) {
      if (error?.createdUid) {
        showToast(`The Auth account exists, but its profile was not saved. UID: ${error.createdUid}. ${userActionError(error, "saving the profile")}`, "error");
      } else {
        showToast(userActionError(error, "applying this change"), "error");
      }
      console.error("User Management action failed.", error);
    } finally {
      if (CONFIRM_BUTTON) {
        CONFIRM_BUTTON.disabled = false;
        CONFIRM_BUTTON.removeAttribute("aria-busy");
      }
    }
  }

  function suggestAccountNumber(role, organization, suffix) {
    const allNumbers = getAllUsers().map((user) => user.accountNumber).filter(Boolean);
    const rolePrefix = {
      "Event Organizer": "EO",
      Admin: "Admin",
      Teacher: "Teacher",
      "Super Admin": "SA",
    }[role];
    if (!rolePrefix) return "";
    let sequence = 0;
    const matcher = new RegExp(`^${rolePrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[-_ ]?(\\d+)`, "i");
    allNumbers.forEach((value) => {
      const match = String(value).match(matcher);
      if (match) sequence = Math.max(sequence, Number(match[1]) || 0);
    });
    const number = String(sequence + 1).padStart(3, "0");
    if (role === "Event Organizer") return `EO-${number}${organization ? `-${organization.toUpperCase()}` : ""}`;
    if (role === "Admin") return `Admin-${number}${suffix ? `-${suffix.toUpperCase()}` : ""}`;
    if (role === "Teacher") return `Teacher-${number}${suffix ? `-${suffix.toUpperCase()}` : ""}`;
    return `SA-${number}${suffix ? `-${suffix.toUpperCase()}` : ""}`;
  }

  function updateAccountSuggestion(force) {
    if (!CREATE_ACCOUNT_INPUT || !CREATE_ROLE_INPUT) return;
    if (!force && accountNumberManuallyEdited) return;
    const suggestion = suggestAccountNumber(
      CREATE_ROLE_INPUT.value,
      CREATE_ORGANIZATION_SELECT?.value || CREATE_ORGANIZATION_INPUT?.value.trim(),
      CREATE_SUFFIX_INPUT?.value.trim(),
    );
    if (suggestion) CREATE_ACCOUNT_INPUT.value = suggestion;
  }

  function isOrgAdviserSuffix(value) {
    return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "") === "orgadviser";
  }

  function updateCreateOrganizationField() {
    const role = CREATE_ROLE_INPUT?.value;
    const showOrganizationSelect = role === "Event Organizer" || role === "Admin";
    if (CREATE_ORGANIZATION_SELECT_FIELD) {
      CREATE_ORGANIZATION_SELECT_FIELD.hidden = !showOrganizationSelect;
    }
    if (CREATE_ORGANIZATION_FIELD) {
      CREATE_ORGANIZATION_FIELD.hidden = role !== "Student";
    }
    if (CREATE_ORGANIZATION_INPUT) CREATE_ORGANIZATION_INPUT.required = false;
    const label = CREATE_ORGANIZATION_SELECT_FIELD?.querySelector("span");
    if (label) label.textContent = role === "Admin" ? "Organization (optional)" : "Organization";
  }

  async function loadOrganizationOptions(select = CREATE_ORGANIZATION_SELECT) {
    if (!select) return;
    const settings = await getSystemSettings("global_config");
    const configuredOrganizations = Array.isArray(settings.organizations)
      ? settings.organizations
      : settings.organizations && typeof settings.organizations === "object"
        ? Object.entries(settings.organizations).map(([code, organization]) =>
            typeof organization === "object" && organization
              ? { code, ...organization }
              : code,
          )
        : [];
    const organizations = configuredOrganizations.length
      ? configuredOrganizations
      : DEFAULTS.global_config.organizations;
    const options = organizations
      .map((organization) => ({
        code: organizationCodeFromRecord(organization),
        name: typeof organization === "object" && organization
          ? String(organization.name || organization.organizationName || "")
          : "",
      }))
      .filter((organization) => organization.code)
      .filter((organization, index, values) => values.findIndex(
        (value) => value.code === organization.code,
      ) === index)
      .map(({ code, name }) => {
        const option = document.createElement("option");
        option.value = code;
        option.textContent = name ? `${code} — ${name}` : code;
        return option;
      });
    select.replaceChildren(
      new Option("Unassigned", ""),
      ...options,
    );
  }

  function setCreateRole(role) {
    if (!ALLOWED_ROLES.includes(role)) return;
    CREATE_ROLE_INPUT.value = role;
    if (CREATE_ROLE_SELECT) CREATE_ROLE_SELECT.value = role;
    if (CREATE_ACCOUNT_INPUT) CREATE_ACCOUNT_INPUT.value = "";
    if (CREATE_AUTH_FIELDS) CREATE_AUTH_FIELDS.hidden = false;
    if (CREATE_PASSWORD_INPUT) CREATE_PASSWORD_INPUT.required = true;
    if (CREATE_PASSWORD_CONFIRMATION_INPUT) CREATE_PASSWORD_CONFIRMATION_INPUT.required = true;
    const needsSuffix = ["Admin", "Teacher", "Super Admin"].includes(role);
    if (CREATE_SUFFIX_FIELD) CREATE_SUFFIX_FIELD.hidden = !needsSuffix;
    if (CREATE_ACCOUNT_LABEL) {
      CREATE_ACCOUNT_LABEL.textContent = role === "Student" ? "Student number" : "Account number";
    }
    updateCreateOrganizationField();
    accountNumberManuallyEdited = false;
    updateAccountSuggestion(true);
    ACCOUNT_TYPE_DIALOG?.close();
    if (!CREATE_DIALOG?.open) CREATE_DIALOG?.showModal();
    CREATE_FIRST_NAME_INPUT?.focus();
  }

  function startCreateFlow() {
    if (CREATE_BUTTON?.disabled) return;
    if (!sourceLoaded.users || !sourceLoaded.adminUser || Object.values(sourceErrors).some(Boolean)) {
      showToast("Wait for both user collections to load before creating an account.", "error");
      return;
    }
    void loadOrganizationOptions().catch((error) => {
      console.error("Could not load configured organizations for account creation.", error);
    });
    ACCOUNT_TYPE_DIALOG?.showModal();
  }

  function subscribeUserCollections() {
    unsubscribeUsers?.();
    unsubscribeAdminUsers?.();
    sourceLoaded = { users: false, adminUser: false };
    sourceErrors = { users: "", adminUser: "" };
    users = [];
    adminUsers = [];
    clearLoadError();
    renderUsers();

    const handleSnapshot = (collectionName, snapshot) => {
      sourceLoaded[collectionName] = true;
      sourceErrors[collectionName] = "";
      const normalized = snapshot.docs.map((item) => normalizeUser(item, collectionName));
      if (collectionName === "users") {
        users = normalized.filter((user) => user.role === "Student");
      } else {
        adminUsers = normalized;
      }
      renderUsers();
      signalPageReady();
    };
    const handleError = (collectionName, error) => {
      sourceLoaded[collectionName] = true;
      sourceErrors[collectionName] = `${collectionName} collection: ${error?.message || "read failed"}`;
      console.error(`Unable to load ${collectionName} collection.`, error);
      renderUsers();
      signalPageReady();
    };

    try {
      unsubscribeUsers = onSnapshot(
        collection(db, "users"),
        (snapshot) => handleSnapshot("users", snapshot),
        (error) => handleError("users", error),
      );
      unsubscribeAdminUsers = onSnapshot(
        collection(db, "adminUser"),
        (snapshot) => handleSnapshot("adminUser", snapshot),
        (error) => handleError("adminUser", error),
      );
    } catch (error) {
      unsubscribeUsers?.();
      unsubscribeAdminUsers?.();
      unsubscribeUsers = null;
      unsubscribeAdminUsers = null;
      sourceLoaded = { users: true, adminUser: true };
      sourceErrors.users = error?.message || "Unable to subscribe to user records.";
      sourceErrors.adminUser = error?.message || "Unable to subscribe to admin records.";
      setLoadError("Unable to load user data. Check your connection and retry.", false);
      console.error("User Management data subscriptions failed.", error);
      renderUsers();
    }
  }

  async function verifySuperAdmin(user) {
    if (!user) {
      await signOut(auth).catch(() => {});
      window.location.replace("SuperAdminLogin.html");
      return;
    }
    try {
      const profileSnapshot = await getDoc(doc(db, "adminUser", user.uid));
      const profile = profileSnapshot.exists() ? profileSnapshot.data() : null;
      const role = normalizedRole(profile?.role || profile?.userRole);
      const status = String(profile?.status || (profile?.isActive === false ? "Inactive" : "Active"));
      if (role !== "Super Admin" || ["suspended", "inactive", "disabled"].includes(normalizedText(status))) {
        await signOut(auth).catch(() => {});
        window.location.replace("SuperAdminLogin.html");
        return;
      }
      currentAdmin = user;
      currentAdminName = profileName(profile, user);
      renderSidebarProfile(profile, user);
      subscribeUserCollections();
    } catch (error) {
      console.error("Unable to verify Super Admin access.", error);
      setLoadError("We could not verify your Super Admin access. Check your connection and retry.", true);
    }
  }

  function setupEvents() {
    CREATE_BUTTON?.addEventListener("click", startCreateFlow);
    document.querySelector(".logout-link")?.addEventListener("click", async (event) => {
      event.preventDefault();
      const link = event.currentTarget;
      await logoutSuperAdmin(
        auth,
        link,
        link.getAttribute("href") || "SuperAdminLogin.html",
      );
    });
    SEARCH_INPUT?.addEventListener("input", () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        currentPage = 1;
        renderUsers();
      }, 250);
    });
    document.querySelectorAll("[data-role-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        roleFilter = button.dataset.roleFilter || "All";
        currentPage = 1;
        document.querySelectorAll("[data-role-filter]").forEach((pill) => {
          const active = pill === button;
          pill.classList.toggle("is-active", active);
          pill.setAttribute("aria-pressed", String(active));
        });
        renderUsers();
      });
    });
    document.getElementById("suspended-only-filter")?.addEventListener("click", (event) => {
      suspendedOnly = !suspendedOnly;
      const button = event.currentTarget;
      button.classList.toggle("is-active", suspendedOnly);
      button.setAttribute("aria-pressed", String(suspendedOnly));
      currentPage = 1;
      renderUsers();
    });
    document.querySelectorAll(".user-sort-button").forEach((button) => {
      button.addEventListener("click", () => {
        if (sortKey === button.dataset.sort) sortDirection = sortDirection === "asc" ? "desc" : "asc";
        else {
          sortKey = button.dataset.sort || "name";
          sortDirection = "asc";
        }
        currentPage = 1;
        renderUsers();
      });
    });
    PREVIOUS_BUTTON?.addEventListener("click", () => {
      if (currentPage > 1) {
        currentPage -= 1;
        renderUsers();
      }
    });
    NEXT_BUTTON?.addEventListener("click", () => {
      const pages = Math.ceil(filteredUsers().length / PAGE_SIZE);
      if (currentPage < pages) {
        currentPage += 1;
        renderUsers();
      }
    });

    document.querySelectorAll("[data-select-role]").forEach((button) => {
      button.addEventListener("click", () => setCreateRole(button.dataset.selectRole));
    });
    document.querySelectorAll("[data-close-dialog]").forEach((button) => {
      button.addEventListener("click", () => button.closest("dialog")?.close());
    });
    DETAILS_DIALOG?.addEventListener("close", () => {
      selectedUserKey = "";
      renderUsers();
    });
    CREATE_DIALOG?.addEventListener("close", () => {
      CREATE_FORM?.reset();
      if (CREATE_AUTH_FIELDS) CREATE_AUTH_FIELDS.hidden = true;
      if (CREATE_SUFFIX_FIELD) CREATE_SUFFIX_FIELD.hidden = true;
      if (CREATE_MIDDLE_NAME_INPUT) CREATE_MIDDLE_NAME_INPUT.disabled = false;
      if (CREATE_PASSWORD_INPUT) CREATE_PASSWORD_INPUT.required = false;
      if (CREATE_PASSWORD_CONFIRMATION_INPUT) CREATE_PASSWORD_CONFIRMATION_INPUT.required = false;
      if (CREATE_ORGANIZATION_INPUT) CREATE_ORGANIZATION_INPUT.required = false;
      updateCreateOrganizationField();
      accountNumberManuallyEdited = false;
    });

    CREATE_ACCOUNT_INPUT?.addEventListener("input", () => {
      accountNumberManuallyEdited = true;
      CREATE_ACCOUNT_INPUT.setCustomValidity("");
    });
    CREATE_EMAIL_INPUT?.addEventListener("input", () => CREATE_EMAIL_INPUT.setCustomValidity(""));
    CREATE_PASSWORD_INPUT?.addEventListener("input", () => CREATE_PASSWORD_INPUT.setCustomValidity(""));
    CREATE_PASSWORD_CONFIRMATION_INPUT?.addEventListener("input", () => CREATE_PASSWORD_CONFIRMATION_INPUT.setCustomValidity(""));
    CREATE_ORGANIZATION_INPUT?.addEventListener("input", () => updateAccountSuggestion(false));
    CREATE_ORGANIZATION_SELECT?.addEventListener("change", () => updateAccountSuggestion(false));
    CREATE_SUFFIX_INPUT?.addEventListener("input", () => {
      updateCreateOrganizationField();
      updateAccountSuggestion(false);
    });

    CREATE_NO_MIDDLE_NAME_INPUT?.addEventListener("change", () => {
      if (!CREATE_MIDDLE_NAME_INPUT) return;
      CREATE_MIDDLE_NAME_INPUT.disabled = CREATE_NO_MIDDLE_NAME_INPUT.checked;
      if (CREATE_MIDDLE_NAME_INPUT.disabled) CREATE_MIDDLE_NAME_INPUT.value = "";
    });
    CREATE_FORM?.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!validateCreateUser()) return;
      const fullName = [
        CREATE_FIRST_NAME_INPUT?.value.trim(),
        CREATE_NO_MIDDLE_NAME_INPUT?.checked ? "" : CREATE_MIDDLE_NAME_INPUT?.value.trim(),
        CREATE_LAST_NAME_INPUT?.value.trim(),
      ].filter(Boolean).join(" ");
      const data = {
        role: CREATE_ROLE_INPUT.value,
        fullName,
        firstName: CREATE_FIRST_NAME_INPUT?.value.trim() || "",
        middleName: CREATE_NO_MIDDLE_NAME_INPUT?.checked ? "" : CREATE_MIDDLE_NAME_INPUT?.value.trim() || "",
        lastName: CREATE_LAST_NAME_INPUT?.value.trim() || "",
        email: CREATE_EMAIL_INPUT.value.trim(),
        accountNumber: CREATE_ACCOUNT_INPUT.value.trim(),
        password: CREATE_PASSWORD_INPUT.value,
        contactNumber: document.getElementById("new-user-contact")?.value.trim() || "",
        organization: CREATE_ORGANIZATION_INPUT?.value.trim() || "",
        organizationCode: normalizeOrganizationCode(CREATE_ORGANIZATION_SELECT?.value),
        roleSuffix: CREATE_SUFFIX_INPUT?.value.trim() || "",
      };
      showConfirm(
        { type: "create", data },
        "Create account",
        `Create an active ${data.role} account for ${data.fullName} (${data.email})? A password reset email will be sent.`,
        "Create account",
      );
    });

    STATUS_ACTION_BUTTON?.addEventListener("click", () => {
      const user = selectedUserKey ? getCurrentUser(selectedUserKey) : null;
      if (!user) return;
      const status = isActive(user) ? "Suspended" : "Active";
      showConfirm(
        { type: "status", status, userKey: selectedUserKey },
        status === "Suspended" ? "Suspend account" : "Reactivate account",
        `${status === "Suspended" ? "Suspend" : "Reactivate"} ${user.fullName}'s account?`,
        status === "Suspended" ? "Suspend account" : "Reactivate account",
      );
    });
    EDIT_PROFILE_BUTTON?.addEventListener("click", () => {
      void openEditProfile().catch((error) => {
        console.error("Could not open the edit profile form.", error);
        showToast(userActionError(error, "opening the profile editor"), "error");
      });
    });
    EDIT_ROLE_SELECT?.addEventListener("change", () => {
      updateEditOrganizationFields(EDIT_ROLE_SELECT.value);
    });
    EDIT_PROFILE_FORM?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!EDIT_PROFILE_FORM.reportValidity()) return;
      if (EDIT_PROFILE_SAVE_BUTTON) {
        EDIT_PROFILE_SAVE_BUTTON.disabled = true;
        EDIT_PROFILE_SAVE_BUTTON.setAttribute("aria-busy", "true");
      }
      try {
        await saveProfileEdits();
      } catch (error) {
        showToast(userActionError(error, "saving the profile"), "error");
        console.error("User profile update failed.", error);
      } finally {
        if (EDIT_PROFILE_SAVE_BUTTON) {
          EDIT_PROFILE_SAVE_BUTTON.disabled = false;
          EDIT_PROFILE_SAVE_BUTTON.removeAttribute("aria-busy");
        }
      }
    });
    DELETE_USER_BUTTON?.addEventListener("click", () => {
      const user = selectedUserKey ? getCurrentUser(selectedUserKey) : null;
      if (!user || DELETE_USER_BUTTON.disabled) return;
      showConfirm(
        { type: "delete-profile", userKey: selectedUserKey },
        "Delete account profile?",
        `Delete ${user.fullName}'s Firestore profile? This removes the profile from User Management, but the Firebase Authentication account will remain.`,
        "Delete profile",
      );
    });

    CONFIRM_BUTTON?.addEventListener("click", executePendingAction);
    CANCEL_CONFIRM_BUTTON?.addEventListener("click", () => {
      pendingAction = null;
      ACTION_CONFIRM_DIALOG?.close();
    });
    ACTION_CONFIRM_DIALOG?.addEventListener("close", () => {
      if (pendingAction?.type === "create" && CREATE_DIALOG?.open) CREATE_DIALOG.close();
      pendingAction = null;
    });
  }

  function setupPasswordToggles() {
    document.querySelectorAll(".sa-password-toggle-button").forEach((toggle) => {
      const input = document.getElementById(toggle.getAttribute("aria-controls"));
      if (!input) return;
      toggle.addEventListener("click", () => {
        const showing = input.type === "password";
        input.type = showing ? "text" : "password";
        toggle.setAttribute("aria-pressed", String(showing));
        toggle.setAttribute("aria-label", `${showing ? "Hide" : "Show"} ${input.id.endsWith("confirmation") ? "confirm password" : "password"}`);
        const wrapper = toggle.closest(".sa-password-toggle");
        wrapper?.classList.toggle("is-visible", showing);
      });
    });
  }

  function init() {
    setupEvents();
    setupPasswordToggles();
    renderUsers();
    if (!isFirebaseConfigured || !auth || !db) {
      setLoadError("Firebase is not configured for this page. Check the connection and retry.", true);
      return;
    }
    authUnsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user) void verifySuperAdmin(user);
        else void verifySuperAdmin(null);
      },
      (error) => {
        console.error("Unable to read the current authentication state.", error);
        setLoadError("We could not verify your sign-in. Check your connection and retry.", true);
      },
    );
  }

  window.addEventListener("pagehide", () => {
    unsubscribeUsers?.();
    unsubscribeAdminUsers?.();
    authUnsubscribe?.();
    window.clearTimeout(searchTimer);
    window.clearTimeout(toastTimer);
  }, { once: true });

  init();
})();
