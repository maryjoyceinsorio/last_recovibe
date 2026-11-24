import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  signOut,
  updatePassword,
  verifyBeforeUpdateEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { push, ref, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { auth, authReady, db, isRtdbConfigured, rtdb } from "../UserStudent/firebaseConfig.js";
import {
  formatPhilippineMobile,
  isValidPhilippineMobile,
  mobileDigits,
  profileCollectionsForRole,
  syncVerifiedProfileEmail,
} from "../portalProfileAccount.js";

(async () => {
  "use strict";
  import("./AdminNotificationData.js")
    .then(({ startAdminNotificationBadge }) => startAdminNotificationBadge())
    .catch(() => document.querySelectorAll("[data-notification-count]").forEach((badge) => { badge.hidden = true; }));
  let profile = {};
  let firebaseUser = null;
  let hasAdminProfileDocument = false;
  const cachedProfile = read("recovibeAdminProfile", {}),
    identity = localStorage.getItem("recovibeAdminId") || "";
  const root = document.getElementById("profileRoot"),
    toastElement = document.querySelector(".admin-toast"),
    namePattern = /^[\p{L}\p{M}]+(?:[ .'-][\p{L}\p{M}]+)*\.?$/u,
    phonePattern = /^09\d{9}$/;
  const numberNameError = "Numbers are not allowed in names. Use letters, spaces, hyphens, periods, and apostrophes only.";
  const invalidNameError = "Use letters, spaces, hyphens, periods, and apostrophes only.";
  function isValidNamePart(value) {
    const normalized = String(value || "").trim().normalize("NFC");
    const length = Array.from(normalized).length;
    return length >= 1 && length <= 50 && namePattern.test(normalized);
  }
  function isValidAdminDetailText(value) {
    const normalized = String(value || "").trim().normalize("NFC");
    const length = Array.from(normalized).length;
    return length >= 1 && length <= 150 && namePattern.test(normalized);
  }
  function sanitizeNameInput(input) {
    const originalValue = input.value;
    const selectionStart = input.selectionStart === null ? originalValue.length : input.selectionStart;
    const selectionEnd = input.selectionEnd === null ? selectionStart : input.selectionEnd;
    const safeBeforeStart = originalValue.slice(0, selectionStart).replace(/[^\p{L}\p{M} .'-]/gu, "");
    const safeSelection = originalValue.slice(selectionStart, selectionEnd).replace(/[^\p{L}\p{M} .'-]/gu, "");
    const sanitizedValue = originalValue.replace(/[^\p{L}\p{M} .'-]/gu, "");
    if (sanitizedValue === originalValue) return;
    input.value = sanitizedValue;
    input.setSelectionRange(
      safeBeforeStart.length,
      safeBeforeStart.length + safeSelection.length,
    );
  }
  let profileLoadExpired = false;
  let pageLoadSignaled = false;
  const signalProfilePageReady = () => {
    if (pageLoadSignaled) return;
    pageLoadSignaled = true;
    window.dispatchEvent(new Event("page-data-ready"));
  };
  async function saveAccountProfileFields(uid, fields) {
    const batch = writeBatch(db);
    batch.set(doc(db, "users", uid), fields, { merge: true });
    if (hasAdminProfileDocument) {
      batch.set(doc(db, "adminUser", uid), fields, { merge: true });
    }
    await batch.commit();
  }
  async function saveOsasAdminDetails(uid, fields) {
    if (!hasAdminProfileDocument) {
      throw new Error("The Admin profile record is unavailable. Please sign in again before saving.");
    }
    const batch = writeBatch(db);
    batch.set(doc(db, "adminUser", uid), fields, { merge: true });
    batch.set(doc(db, "users", uid), fields, { merge: true });
    await batch.commit();
  }
  const profileLoadTimer = setTimeout(() => {
    profileLoadExpired = true;
    root.innerHTML = '<div class="admin-error" role="alert">Could not load your verified Admin profile in time. <button class="admin-row-action" type="button" id="retryAdminProfile">Try again</button></div>';
    root.querySelector("#retryAdminProfile").addEventListener("click", () => window.location.reload());
    signalProfilePageReady();
  }, 9000);
  try {
    await authReady;
    if (profileLoadExpired) return;
    if (!auth || !db) throw new Error("Firebase authentication is unavailable.");
    await auth.authStateReady();
    if (profileLoadExpired) return;
    const user = auth.currentUser;
    if (!user) {
      clearTimeout(profileLoadTimer);
      location.replace("AdminLogin.html");
      return;
    }
    firebaseUser = user;
    await syncVerifiedProfileEmail(
      auth,
      db,
      user,
      "admin",
      profileCollectionsForRole("admin"),
    );
    const [adminResult, userResult] = await Promise.allSettled([
      getDoc(doc(db, "adminUser", user.uid)),
      getDoc(doc(db, "users", user.uid)),
    ]);
    if (profileLoadExpired) return;
    hasAdminProfileDocument =
      adminResult.status === "fulfilled" && adminResult.value.exists();
    const adminProfile = hasAdminProfileDocument
      ? adminResult.value.data()
      : {};
    const userProfile = userResult.status === "fulfilled" && userResult.value.exists()
      ? userResult.value.data()
      : {};
    if (adminResult.status === "rejected" && userResult.status === "rejected") {
      throw adminResult.reason;
    }
    const sameAccountCache = cachedProfile.uid === user.uid ? cachedProfile : {};
    profile = {
      ...userProfile,
      ...adminProfile,
      firstName: sameAccountCache.firstName || userProfile.firstName || adminProfile.firstName,
      middleName: sameAccountCache.middleName ?? userProfile.middleName ?? adminProfile.middleName,
      lastName: sameAccountCache.lastName || userProfile.lastName || adminProfile.lastName,
      fullName: sameAccountCache.fullName || userProfile.fullName || adminProfile.fullName,
      name: sameAccountCache.name || userProfile.name || adminProfile.name,
      contactNumber: sameAccountCache.contactNumber ?? userProfile.contactNumber ?? adminProfile.contactNumber,
      contact: sameAccountCache.contact ?? userProfile.contact ?? adminProfile.contact,
      uid: user.uid,
      email: user.email || userProfile.email || adminProfile.email || "",
    };
    const verifiedRole = String(profile.role || profile.userRole || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (verifiedRole !== "admin") {
      clearTimeout(profileLoadTimer);
      location.replace("AdminLogin.html");
      return;
    }
    clearTimeout(profileLoadTimer);
  } catch (error) {
    clearTimeout(profileLoadTimer);
    if (profileLoadExpired) return;
    console.error("Could not verify the signed-in Admin profile:", error);
    root.innerHTML = '<div class="admin-error" role="alert">Could not load your verified Admin profile. <button class="admin-row-action" type="button" id="retryAdminProfile">Try again</button></div>';
    root.querySelector("#retryAdminProfile").addEventListener("click", () => window.location.reload());
    signalProfilePageReady();
    return;
  }
  let dirty = false,
    nameDirty = false,
    contactDirty = false,
    adminDetailsDirty = false;
  const fullName =
    profile.fullName ||
    profile.name ||
    [profile.firstName, profile.middleName, profile.lastName]
      .filter(Boolean)
      .join(" ") ||
    firebaseUser.displayName ||
    (firebaseUser.email || identity).split("@")[0];
  const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
  const storedFirstName = String(profile.firstName || "").trim();
  const storedMiddleName = String(profile.middleName || "").trim();
  const storedLastName = String(profile.lastName || "").trim();
  const firstName = storedFirstName || nameParts[0] || "";
  const firstNameParts = firstName.split(/\s+/).filter(Boolean);
  const matchesFirstName = firstNameParts.every(
    (part, index) => nameParts[index]?.toLowerCase() === part.toLowerCase(),
  );
  const remainingNameParts = matchesFirstName
    ? nameParts.slice(firstNameParts.length)
    : [];
  const lastName =
    storedLastName ||
    (storedFirstName && firstNameParts.length > 1
      ? remainingNameParts.at(-1) || ""
      : nameParts.length > 1
        ? nameParts.at(-1)
        : "");
  const lastNameParts = lastName.split(/\s+/).filter(Boolean);
  const matchesLastName = lastNameParts.every(
    (part, index) =>
      nameParts[nameParts.length - lastNameParts.length + index]?.toLowerCase() ===
      part.toLowerCase(),
  );
  const inferredMiddleName =
    matchesFirstName &&
    matchesLastName &&
    firstNameParts.length + lastNameParts.length <= nameParts.length
      ? nameParts
          .slice(firstNameParts.length, nameParts.length - lastNameParts.length)
          .join(" ")
      : "";
  profile.firstName = firstName;
  profile.middleName = storedMiddleName || inferredMiddleName;
  profile.lastName = lastName;
  document.querySelector("[data-name]").textContent = fullName.toUpperCase();
  document.querySelector("[data-avatar]").textContent = fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  document.querySelector(".admin-logout").onclick = async (event) => {
    event.preventDefault();
    try {
      await signOut(auth);
    } finally {
      ["recovibeAdminId", "recovibeAdminProfile"].forEach((key) => localStorage.removeItem(key));
      location.replace("AdminLogin.html");
    }
  };
  root.innerHTML = `<section class="admin-profile-card"><h2>Personal Information</h2><div class="profile-summary-grid" id="profileSummary"></div><div class="admin-profile-actions"><button class="admin-button" id="editProfile" type="button">Edit Profile</button><button class="admin-button" id="changePassword" type="button">Change Password</button></div><form class="admin-profile-form" id="profileForm" hidden novalidate><div class="admin-field"><label for="firstName">First Name</label><input id="firstName" autocomplete="given-name"></div><div class="admin-field"><label for="middleName">Middle Name</label><input id="middleName" autocomplete="additional-name"></div><label class="admin-checkbox"><input id="noMiddleName" type="checkbox"> I don't have a middle name</label><div class="admin-field"><label for="lastName">Last Name</label><input id="lastName" autocomplete="family-name"></div><div class="admin-field"><label for="emailAddress">Email Address</label><input id="emailAddress" type="email" readonly></div><div class="admin-field"><label for="contactNumber">Contact Number</label><input id="contactNumber" type="tel" autocomplete="tel" placeholder="09XXXXXXXXX or +639XXXXXXXXX"></div><p class="admin-error-text" id="profileError" role="alert"></p><div class="admin-profile-actions"><button class="admin-button green" type="submit">Save</button><button class="admin-button" id="cancelEdit" type="button">Cancel</button></div></form></section><div class="admin-modal-backdrop" id="passwordLayer" hidden style="display:none"><section class="admin-dialog admin-password-dialog" role="dialog" aria-modal="true" aria-labelledby="passwordTitle" tabindex="-1"><button class="admin-close" id="passwordClose" type="button" aria-label="Close password dialog">×</button><h2 id="passwordTitle">Change Password</h2><form id="passwordForm" novalidate><div class="admin-field"><label for="currentPassword">Current Password</label><div class="password-control"><input id="currentPassword" type="password" autocomplete="current-password"><button type="button" data-toggle="currentPassword" aria-label="Show current password">◉</button></div></div><div class="admin-field"><label for="newPassword">New Password</label><div class="password-control"><input id="newPassword" type="password" autocomplete="new-password"><button type="button" data-toggle="newPassword" aria-label="Show new password">◉</button></div></div><p class="password-rules">At least 8 characters, including uppercase, lowercase, and a number.</p><div class="admin-field"><label for="confirmPassword">Confirm New Password</label><div class="password-control"><input id="confirmPassword" type="password" autocomplete="new-password"><button type="button" data-toggle="confirmPassword" aria-label="Show confirmation password">◉</button></div></div><p class="admin-error-text" id="passwordError" role="alert"></p><div class="admin-dialog-actions"><button class="admin-button green" type="submit">Update Password</button><button class="admin-button" id="cancelPassword" type="button">Cancel</button></div></form></section></div>`;
  const passwordLayerMarkup = root.querySelector("#passwordLayer").outerHTML;
  const adminIdSource = [
    "accountNumber", "accountNo", "adminId", "admin_id",
    "approverId", "approver_id", "employeeId", "employee_id",
  ].find((key) => String(profile[key] || "").trim());
  const canEditAdminId = adminIdSource === "adminId";
  let adminId = String(profile.accountNumber || profile.accountNo || profile.adminId || profile.admin_id || profile.approverId || profile.approver_id || profile.employeeId || profile.employee_id || "").trim();
  const stageLabels = {
    org_adv: "Organization Adviser",
    sir_abelida: "Laboratory Head, Property Custodian, Administrative Officer",
    hap: "Head of Academic Programs, QAC Coordinator (HAP)",
    osas: "OSAS",
  };
  const normalizeStageValue = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const stageIdentity = [
    profile.accountNumber, profile.accountNo, profile.account_number, profile.account_no,
    profile.approvalStage, profile.approvalStageKey, profile.assignedApprovalStage,
    profile.approverStage, profile.approverKey, profile.approvalRole,
    profile.approverRole, profile.assignedRole, profile.assignedApprover,
    profile.adminRole, profile.roleName, profile.stageKey, profile.position,
  ].map(normalizeStageValue);
  const stageAliases = {
    org_adv: ["orgadv", "orgadviser", "organizationadviser", "organizationadviserreview", "adviser"],
    sir_abelida: ["sirabelida", "abelida", "abelidas", "laboratoryhead", "propertycustodian", "administrativeofficer", "labhead"],
    hap: ["hap", "headofacademicprograms", "qaccoordinator", "headofacademicprogramsqaccoordinator"],
    osas: ["osas", "osasreview"],
  };
  const accountStageValues = [
    profile.accountNumber, profile.accountNo, profile.account_number, profile.account_no,
  ].map(normalizeStageValue);
  const accountStageKey = accountStageValues.some((value) => value.includes("administrative"))
    ? "sir_abelida"
    : accountStageValues.some((value) => value.includes("orgadviser") || value.includes("orgadvisor"))
      ? "org_adv"
      : accountStageValues.some((value) => value.includes("hap"))
        ? "hap"
        : accountStageValues.some((value) => value.includes("osas"))
          ? "osas"
          : null;
  const currentStageKey = accountStageKey || Object.keys(stageAliases).find((key) =>
    stageAliases[key].some((alias) => stageIdentity.includes(alias)),
  );
  const isOsasAccount = currentStageKey === "osas" || [
    profile.position,
    profile.role,
    profile.userRole,
    profile.roleSuffix,
    profile.approverRole,
    profile.approver_role,
    profile.adminRole,
    profile.roleName,
    adminId,
  ].some((value) => {
    const normalized = normalizeStageValue(value);
    return normalized.includes("osas") && !normalized.startsWith("nonosas") && !normalized.startsWith("notosas");
  });
  const hasStableOsasMarker = [
    profile.role,
    profile.userRole,
    profile.roleSuffix,
    profile.approverRole,
    profile.approver_role,
    profile.adminRole,
    profile.roleName,
    adminId,
    profile.accountNumber,
    profile.accountNo,
    profile.account_number,
    profile.account_no,
    profile.approvalStage,
    profile.approvalStageKey,
    profile.assignedApprovalStage,
    profile.approverStage,
    profile.approverKey,
    profile.approvalRole,
    profile.assignedRole,
    profile.assignedApprover,
    profile.stageKey,
  ].some((value) => {
    const normalized = normalizeStageValue(value);
    return normalized.includes("osas") && !normalized.startsWith("nonosas") && !normalized.startsWith("notosas");
  });
  const positionMustRetainOsasMarker = isOsasAccount && !hasStableOsasMarker;
  let position = (isOsasAccount && profile.position) ? String(profile.position).trim() : stageLabels[currentStageKey] ||
    String(profile.position || profile.title || profile.role_title || profile.approver_role || profile.approverRole || "").trim();
  const role = String(profile.role || profile.userRole || "").trim();
  let campus = String(profile.campus || "PUP Biñan Campus").trim();
  document.querySelector("[data-role]").textContent = position;
  document.querySelector("[data-role]").title = position;
  root.innerHTML = `<section class="content-container"><header class="hero-banner"><div class="hero-left"><div class="hero-avatar" id="heroAvatar" aria-hidden="true"></div><div class="hero-info"><h1 class="hero-name" id="heroUserName"></h1><div class="hero-badges"><span class="hero-badge" id="heroRoleBadge"></span></div></div></div><div class="hero-actions"><button type="button" class="btn-outlined-hero" id="changePassword">Change password</button></div></header><section class="profile-cards-grid"><article class="profile-card"><div class="card-header-flex"><h2 class="card-title">Name</h2><button type="button" class="btn-outlined-card" id="editProfile" data-edit-profile>Edit</button></div><div class="card-view-mode" id="profileSummary"><div class="fields-grid cols-3"><div class="field-item"><span class="field-label">First Name</span><span class="field-value" id="viewFirstName"></span></div><div class="field-item"><span class="field-label">Middle Name</span><span class="field-value" id="viewMiddleName"></span></div><div class="field-item"><span class="field-label">Last Name</span><span class="field-value" id="viewLastName"></span></div></div></div><form class="admin-profile-form card-edit-mode" id="profileForm" hidden novalidate><div class="admin-field"><label for="firstName">First Name</label><input id="firstName" autocomplete="given-name"></div><div class="admin-field"><label for="middleName">Middle Name</label><input id="middleName" autocomplete="additional-name"></div><label class="admin-checkbox"><input id="noMiddleName" type="checkbox"> I don't have a middle name</label><div class="admin-field"><label for="lastName">Last Name</label><input id="lastName" autocomplete="family-name"></div><p class="admin-error-text" id="profileError" role="alert"></p><div class="admin-profile-actions"><button class="admin-button green" type="submit">Save</button><button class="admin-button" id="cancelEdit" type="button">Cancel</button></div></form></article><article class="profile-card"><div class="card-header-flex"><h2 class="card-title">Contact</h2><button type="button" class="btn-outlined-card" data-edit-profile>Edit</button></div><div class="card-view-mode" id="contactSummary"><div class="fields-grid cols-2"><div class="field-item"><span class="field-label">Email Address</span><span class="field-value" id="viewEmail"></span></div><div class="field-item"><span class="field-label">Contact Number</span><span class="field-value" id="viewContact"></span></div></div></div></article><article class="profile-card full-width-card"><div class="card-header-flex card-title-locked-row"><h2 class="card-title">Admin details</h2><span class="badge-locked"><svg class="label-lock" viewBox="0 0 20 20" fill="currentColor" width="12" height="12" aria-hidden="true"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd" /></svg> Locked</span></div><div class="fields-grid cols-4-responsive"><div class="field-item"><span class="field-label"><svg class="label-lock" viewBox="0 0 20 20" fill="currentColor" width="11" height="11" aria-hidden="true"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg> Admin ID</span><span class="field-value" id="viewAdminId"></span></div><div class="field-item"><span class="field-label"><svg class="label-lock" viewBox="0 0 20 20" fill="currentColor" width="11" height="11" aria-hidden="true"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg> Position</span><span class="field-value" id="viewPosition"></span></div><div class="field-item"><span class="field-label"><svg class="label-lock" viewBox="0 0 20 20" fill="currentColor" width="11" height="11" aria-hidden="true"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 0 1 2 -2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg> Role</span><span class="field-value" id="viewRole"></span></div><div class="field-item"><span class="field-label"><svg class="label-lock" viewBox="0 0 20 20" fill="currentColor" width="11" height="11" aria-hidden="true"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 0 1 2 -2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg> Campus</span><span class="field-value" id="viewCampus"></span></div></div><div class="locked-note-box"><p class="locked-note-text">These details come from school records, so you cannot change them here. If something is wrong, ask OSAS to correct it.</p><button type="button" class="btn-outlined-card" id="btnRequestCorrection">Request a correction</button></div></article></section></section>${passwordLayerMarkup}`;
  root.querySelector("#heroAvatar").textContent = fullName.split(/\s+/).map((part) => part[0]).filter(Boolean).slice(0, 1).join("").toUpperCase();
  root.querySelector("#heroUserName").textContent = fullName;
  root.querySelector("#heroRoleBadge").textContent = role || "Not set";
  root.querySelector("#viewAdminId").textContent = adminId || "Not set";
  root.querySelector("#viewPosition").textContent = position || "Not set";
  root.querySelector("#viewRole").textContent = role || "Not set";
  root.querySelector("#viewCampus").textContent = campus || "Not set";
  const adminDetailsCard = root.querySelector(".full-width-card");
  const adminDetailsSummary = adminDetailsCard.querySelector(".fields-grid");
  let adminDetailsForm = null;
  let adminDetailsEditButton = null;
  let adminDetailsPosition = null;
  let adminDetailsCampus = null;
  let adminDetailsAdminId = null;
  let adminDetailsError = null;
  let adminDetailsSaveButton = null;
  let adminDetailsInputFeedback = "";
  if (isOsasAccount) {
    adminDetailsCard.querySelector(".badge-locked").remove();
    const editableDetailLabels = new Set([
      "Position",
      "Campus",
      ...(canEditAdminId ? ["Admin ID"] : []),
    ]);
    adminDetailsCard.querySelectorAll(".field-item").forEach((field) => {
      const label = field.querySelector(".field-label")?.textContent.trim();
      if (editableDetailLabels.has(label)) field.querySelector(".label-lock")?.remove();
    });
    adminDetailsEditButton = document.createElement("button");
    adminDetailsEditButton.type = "button";
    adminDetailsEditButton.className = "btn-outlined-card";
    adminDetailsEditButton.id = "editAdminDetails";
    adminDetailsEditButton.textContent = "Edit";
    adminDetailsCard.querySelector(".card-header-flex").append(adminDetailsEditButton);

    adminDetailsForm = document.createElement("form");
    adminDetailsForm.className = "admin-profile-form card-edit-mode";
    adminDetailsForm.id = "adminDetailsForm";
    adminDetailsForm.hidden = true;
    adminDetailsForm.noValidate = true;
    adminDetailsForm.innerHTML = `<div class="fields-grid ${canEditAdminId ? "cols-3" : "cols-2"}" style="grid-column:1/-1"><div class="admin-field"><label for="adminDetailsPosition">Position</label><input id="adminDetailsPosition" type="text" maxlength="150" required></div><div class="admin-field"><label for="adminDetailsCampus">Campus</label><input id="adminDetailsCampus" type="text" maxlength="150" required></div>${canEditAdminId ? '<div class="admin-field"><label for="adminDetailsAdminId">Admin ID</label><input id="adminDetailsAdminId" type="text" maxlength="100" required></div>' : ""}</div><p class="admin-error-text" id="adminDetailsError" role="alert"></p><div class="admin-profile-actions"><button class="admin-button green" id="saveAdminDetails" type="submit">Save</button><button class="admin-button" id="cancelAdminDetails" type="button">Cancel</button></div>`;
    adminDetailsSummary.insertAdjacentElement("afterend", adminDetailsForm);
    adminDetailsPosition = adminDetailsForm.querySelector("#adminDetailsPosition");
    adminDetailsCampus = adminDetailsForm.querySelector("#adminDetailsCampus");
    adminDetailsAdminId = adminDetailsForm.querySelector("#adminDetailsAdminId");
    adminDetailsError = adminDetailsForm.querySelector("#adminDetailsError");
    adminDetailsSaveButton = adminDetailsForm.querySelector("#saveAdminDetails");
  }
  root.querySelector("#contactSummary").insertAdjacentHTML("afterend", '<form class="admin-profile-form card-edit-mode" id="contactForm" hidden novalidate><div class="admin-field"><label for="emailAddress">Email Address</label><input id="emailAddress" type="email" autocomplete="email" required></div><div class="admin-field"><label for="contactNumber">Contact Number</label><input id="contactNumber" type="tel" inputmode="numeric" autocomplete="tel" maxlength="13" placeholder="09XXXXXXXXX" required></div><p class="admin-error-text" id="contactError" role="alert"></p><div class="admin-profile-actions"><button class="admin-button green" id="saveContact" type="submit">Save</button><button class="admin-button" id="cancelContact" type="button">Cancel</button></div></form>');
  root.insertAdjacentHTML("beforeend", '<div class="admin-correction-overlay" id="correctionModal" hidden><div class="admin-correction-dialog" role="dialog" aria-modal="true" aria-labelledby="correctionTitle"><button type="button" class="admin-close" id="closeCorrection" aria-label="Close dialog">×</button><h2 id="correctionTitle">Request a correction</h2><p>Tell OSAS which admin record detail needs to be updated and what it should say.</p><form id="correctionForm"><div class="admin-field"><label for="correctionField">Which detail is wrong?</label><select id="correctionField" required><option value="">Select a detail</option><option>Admin ID</option><option>Position</option><option>Role</option><option>Campus</option></select></div><div class="admin-field"><label for="correctionMessage">Tell OSAS what it should say</label><textarea id="correctionMessage" required minlength="10" rows="4"></textarea></div><p class="admin-error-text" id="correctionError" role="alert"></p><div class="admin-dialog-actions"><button class="admin-button" id="cancelCorrection" type="button">Cancel</button><button class="admin-button green" type="submit">Send request</button></div></form></div></div>');
  const correctionModal = root.querySelector("#correctionModal");
  const requestCorrectionButton = root.querySelector("#btnRequestCorrection");
  if (isOsasAccount) {
    requestCorrectionButton.hidden = true;
    requestCorrectionButton.style.display = "none";
    root.querySelector(".locked-note-text").textContent =
      "These details come from school records. As OSAS, you manage record correction approvals directly.";
  }
  requestCorrectionButton.onclick = () => {
    if (isOsasAccount) return;
    correctionModal.hidden = false;
    root.querySelector("#correctionField").focus();
  };
  const closeCorrection = () => { correctionModal.hidden = true; root.querySelector("#correctionForm").reset(); root.querySelector("#correctionError").textContent = ""; };
  root.querySelector("#closeCorrection").onclick = closeCorrection;
  root.querySelector("#cancelCorrection").onclick = closeCorrection;
  root.querySelector("#correctionForm").onsubmit = async (event) => {
    event.preventDefault();
    const field = root.querySelector("#correctionField").value;
    const message = root.querySelector("#correctionMessage").value.trim();
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    if (!field || message.length < 10) {
      root.querySelector("#correctionError").textContent = "Select a detail and provide at least 10 characters.";
      return;
    }
    if (!isRtdbConfigured || !rtdb || !firebaseUser) {
      root.querySelector("#correctionError").textContent = "Correction requests are unavailable. Please try again later.";
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = "Sending...";
    try {
      const requestRef = push(ref(rtdb, "correctionRequests"));
      await set(requestRef, {
        uid: firebaseUser.uid,
        adminId,
        adminName: profile.name || fullName,
        field,
        message,
        status: "open",
        createdAt: Date.now(),
      });
      closeCorrection();
      toast("Correction request sent.");
    } catch (error) {
      console.error("Could not submit Admin correction request:", error);
      root.querySelector("#correctionError").textContent = "Could not send your request. Please try again.";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Send request";
    }
  };

  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch {
      return fallback;
    }
  }
  function toast(message) {
    toastElement.textContent = message;
    toastElement.hidden = false;
    clearTimeout(toastElement._timer);
    toastElement._timer = setTimeout(() => (toastElement.hidden = true), 3000);
  }
  function display() {
    root.querySelector("#viewFirstName").textContent = profile.firstName || "Not set";
    root.querySelector("#viewMiddleName").textContent = profile.middleName || "Not set";
    root.querySelector("#viewMiddleName").classList.toggle("empty-muted", !profile.middleName);
    root.querySelector("#viewLastName").textContent = profile.lastName || "Not set";
    const emailView = root.querySelector("#viewEmail");
    const email = profile.email || identity || "Not set";
    const atIndex = email.lastIndexOf("@");
    if (atIndex > 0) {
      const localPart = document.createElement("span");
      localPart.className = "contact-email-local";
      localPart.textContent = email.slice(0, atIndex);
      const domain = document.createElement("span");
      domain.className = "contact-email-domain";
      domain.textContent = email.slice(atIndex);
      emailView.replaceChildren(localPart, document.createElement("wbr"), domain);
    } else {
      emailView.textContent = email;
    }
    root.querySelector("#viewContact").textContent = profile.contactNumber || "Not set";
  }
  function esc(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch],
    );
  }
  const nameForm = root.querySelector("#profileForm");
  const nameFirst = root.querySelector("#firstName");
  const nameMiddle = root.querySelector("#middleName");
  const nameLast = root.querySelector("#lastName");
  const noMiddleName = root.querySelector("#noMiddleName");
  const nameError = root.querySelector("#profileError");
  const nameSaveButton = nameForm.querySelector('[type="submit"]');
  const contactForm = root.querySelector("#contactForm");
  const contactEmail = root.querySelector("#emailAddress");
  const contactNumber = root.querySelector("#contactNumber");
  const contactError = root.querySelector("#contactError");
  const contactSaveButton = contactForm.querySelector('[type="submit"]');
  [nameFirst, nameMiddle, nameLast].forEach((input) => { input.maxLength = 100; });
  let nameInputFeedback = "";
  contactEmail.maxLength = 254;
  nameFirst.required = true;
  nameLast.required = true;

  function updateDirtyState() {
    dirty = nameDirty || contactDirty || adminDetailsDirty;
  }

  function updateNameState() {
    const first = nameFirst.value.trim();
    const middle = noMiddleName.checked ? "" : nameMiddle.value.trim();
    const last = nameLast.value.trim();
    const valid =
      isValidNamePart(first) &&
      isValidNamePart(last) &&
      (noMiddleName.checked || isValidNamePart(middle)) &&
      !nameInputFeedback;
    if (nameInputFeedback) {
      nameError.textContent = nameInputFeedback;
    } else if ([first, middle, last].some((value) => /\d/.test(value))) {
      nameError.textContent = numberNameError;
    } else if (!valid) {
      nameError.textContent =
        `${invalidNameError} First and last names are required; middle name is required unless you select the checkbox.`;
    } else {
      nameError.textContent = "";
    }
    nameDirty =
      first !== String(profile.firstName || "").trim() ||
      middle !== String(profile.middleName || "").trim() ||
      last !== String(profile.lastName || "").trim();
    nameSaveButton.disabled = !nameDirty || !valid;
    updateDirtyState();
  }

  function setNameEditing(value) {
    const card = root.querySelector("#profileSummary").closest(".profile-card");
    nameForm.hidden = !value;
    root.querySelector("#profileSummary").hidden = value;
    card.querySelector("[data-edit-profile]").hidden = value;
    nameError.textContent = "";
    if (value) {
      nameInputFeedback = "";
      nameFirst.value = profile.firstName || "";
      nameMiddle.value = profile.middleName || "";
      nameLast.value = profile.lastName || "";
      noMiddleName.checked = !profile.middleName;
      nameMiddle.disabled = noMiddleName.checked;
      nameMiddle.required = !noMiddleName.checked;
      nameFirst.focus();
    }
    nameDirty = false;
    updateNameState();
  }

  function updateContactState() {
    const email = contactEmail.value.trim().toLowerCase();
    const phone = mobileDigits(contactNumber.value);
    contactDirty =
      email !== String(profile.email || identity).trim().toLowerCase() ||
      phone !== mobileDigits(profile.contactNumber);
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const validPhone = phonePattern.test(phone) && isValidPhilippineMobile(phone);
    if (!email || !validEmail || !phone || !validPhone) {
      contactError.textContent = !email
        ? "Email address is required."
        : !validEmail
          ? "Enter a valid email address."
          : !phone
            ? "Contact number is required."
            : "Use a Philippine mobile number in 09XXXXXXXXX format.";
    }
    contactSaveButton.disabled = !contactDirty || !validEmail || !validPhone;
    updateDirtyState();
  }

  function setContactEditing(value) {
    const card = root.querySelector("#contactSummary").closest(".profile-card");
    contactForm.hidden = !value;
    root.querySelector("#contactSummary").hidden = value;
    card.querySelector("[data-edit-profile]").hidden = value;
    contactError.textContent = "";
    if (value) {
      contactEmail.value = profile.email || identity;
      contactNumber.value = formatPhilippineMobile(profile.contactNumber || "");
      contactEmail.focus();
    }
    contactDirty = false;
    updateContactState();
  }

  function updateAdminDetailsState() {
    if (!adminDetailsForm) return;
    const nextPosition = adminDetailsPosition.value.trim();
    const nextCampus = adminDetailsCampus.value.trim();
    const nextAdminId = adminDetailsAdminId?.value.trim() || "";
    const positionIsValid = isValidAdminDetailText(nextPosition);
    const campusIsValid = isValidAdminDetailText(nextCampus);
    const positionPreservesOsas =
      !positionMustRetainOsasMarker || normalizeStageValue(nextPosition).includes("osas");
    const valid =
      positionIsValid &&
      campusIsValid &&
      positionPreservesOsas &&
      (!canEditAdminId || (nextAdminId.length > 0 && nextAdminId.length <= 100));
    adminDetailsDirty =
      nextPosition !== position ||
      nextCampus !== campus ||
      (canEditAdminId && nextAdminId !== adminId);
    if (adminDetailsInputFeedback) {
      adminDetailsError.textContent = adminDetailsInputFeedback;
    } else if (/\d/.test(nextPosition) || /\d/.test(nextCampus)) {
      adminDetailsError.textContent = numberNameError;
    } else if (!positionIsValid || !campusIsValid) {
      adminDetailsError.textContent =
        "Enter a non-empty Position and Campus of 150 characters or fewer using letters, spaces, hyphens, periods, and apostrophes only.";
    } else if (!positionPreservesOsas) {
      adminDetailsError.textContent =
        "Keep OSAS in the Position value because it is the only OSAS account marker.";
    } else if (!valid) {
      adminDetailsError.textContent = "Enter a valid Admin ID of 100 characters or fewer.";
    } else {
      adminDetailsError.textContent = "";
    }
    adminDetailsSaveButton.disabled = !adminDetailsDirty || !valid;
    updateDirtyState();
  }

  function setAdminDetailsEditing(value) {
    if (!adminDetailsForm) return;
    adminDetailsForm.hidden = !value;
    adminDetailsSummary.hidden = value;
    adminDetailsSummary.style.display = value ? "none" : "";
    adminDetailsEditButton.hidden = value;
    adminDetailsEditButton.style.display = value ? "none" : "";
    adminDetailsError.textContent = "";
    adminDetailsInputFeedback = "";
    if (value) {
      adminDetailsPosition.value = position;
      adminDetailsCampus.value = campus;
      if (adminDetailsAdminId) adminDetailsAdminId.value = adminId;
      adminDetailsPosition.focus();
    } else {
      adminDetailsPosition.value = position;
      adminDetailsCampus.value = campus;
      if (adminDetailsAdminId) adminDetailsAdminId.value = adminId;
    }
    adminDetailsDirty = false;
    updateAdminDetailsState();
  }

  root.querySelectorAll("[data-edit-profile]").forEach((button) => {
    button.onclick = () => {
      if (button.closest(".profile-card").querySelector("#contactSummary")) {
        setContactEditing(true);
      } else {
        setNameEditing(true);
      }
    };
  });
  [nameFirst, nameMiddle, nameLast].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        nameInputFeedback = numberNameError;
        updateNameState();
      }
    });
    input.addEventListener("beforeinput", (event) => {
      if (typeof event.data === "string" && /\d/.test(event.data)) {
        event.preventDefault();
        nameInputFeedback = numberNameError;
        updateNameState();
      }
    });
  });
  nameForm.addEventListener("input", (event) => {
    const input = event.target;
    if (![nameFirst, nameMiddle, nameLast].includes(input)) return;
    const originalValue = input.value;
    const hasDigits = /\d/.test(originalValue);
    const hasInvalidCharacters = /[^\p{L}\p{M} .'-]/u.test(originalValue);
    sanitizeNameInput(input);
    nameInputFeedback = hasDigits
      ? numberNameError
      : hasInvalidCharacters
        ? invalidNameError
        : "";
    updateNameState();
  });
  noMiddleName.addEventListener("change", (event) => {
    nameMiddle.disabled = event.target.checked;
    nameMiddle.required = !event.target.checked;
    if (event.target.checked) nameMiddle.value = "";
    else nameMiddle.focus();
    nameInputFeedback = "";
    nameError.textContent = "";
    updateNameState();
  });
  contactForm.addEventListener("input", (event) => {
    if (event.target === contactNumber) {
      contactNumber.value = formatPhilippineMobile(contactNumber.value);
    }
    contactError.textContent = "";
    updateContactState();
  });
  root.querySelector("#cancelEdit").onclick = () => {
    if (nameDirty && !confirm("Discard your unsaved name changes?")) return;
    setNameEditing(false);
  };
  root.querySelector("#cancelContact").onclick = () => {
    if (contactDirty && !confirm("Discard your unsaved contact changes?")) return;
    setContactEditing(false);
  };
  nameForm.onsubmit = async (event) => {
    event.preventDefault();
    const first = nameFirst.value.trim();
    const middle = noMiddleName.checked ? "" : nameMiddle.value.trim();
    const last = nameLast.value.trim();
    const hasDigits = [first, middle, last].some((value) => /\d/.test(value));
    if (nameInputFeedback || hasDigits || !isValidNamePart(first) ||
      !isValidNamePart(last) || (!noMiddleName.checked && !isValidNamePart(middle))) {
      nameError.textContent = nameInputFeedback || (hasDigits
        ? numberNameError
        : `${invalidNameError} First and last names are required; middle name is required unless you select the checkbox.`);
      return;
    }
    if (!firebaseUser?.uid || firebaseUser.uid !== profile.uid || !db) {
      nameError.textContent = "Sign in again before updating your profile name.";
      return;
    }
    const fullName = [first, middle, last].filter(Boolean).join(" ");
    nameSaveButton.disabled = true;
    nameSaveButton.textContent = "Saving...";
    try {
      const updatedNameFields = {
        firstName: first,
        middleName: middle,
        lastName: last,
        fullName,
        name: fullName,
      };
      await saveAccountProfileFields(firebaseUser.uid, updatedNameFields);
      profile = {
        ...profile,
        ...updatedNameFields,
      };
      localStorage.setItem("recovibeAdminProfile", JSON.stringify(profile));
      document.querySelector("[data-name]").textContent = fullName.toUpperCase();
      document.querySelector("[data-avatar]").textContent = fullName
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
      root.querySelector("#heroAvatar").textContent = fullName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 1)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
      root.querySelector("#heroUserName").textContent = fullName;
      display();
      setNameEditing(false);
      toast("Profile name saved.");
    } catch (saveError) {
      console.error("[AdminProfile] Could not update profile name:", saveError);
      nameError.textContent = saveError?.message || "Could not save your name.";
    } finally {
      nameSaveButton.textContent = "Save";
      updateNameState();
    }
  };
  contactForm.onsubmit = async (event) => {
    event.preventDefault();
    const email = contactEmail.value.trim().toLowerCase();
    const normalizedPhone = mobileDigits(contactNumber.value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      contactError.textContent = "Enter a valid email address.";
      contactEmail.focus();
      return;
    }
    if (!phonePattern.test(normalizedPhone) || !isValidPhilippineMobile(normalizedPhone)) {
      contactError.textContent = "Use a Philippine mobile number in 09XXXXXXXXX format.";
      contactNumber.focus();
      return;
    }
    if (!firebaseUser?.uid || firebaseUser.uid !== profile.uid || !db) {
      contactError.textContent = "Sign in again before updating your contact details.";
      return;
    }
    const emailChanged = email !== String(profile.email || "").trim().toLowerCase();
    const phoneChanged = normalizedPhone !== mobileDigits(profile.contactNumber);
    contactSaveButton.disabled = true;
    contactSaveButton.textContent = "Saving...";
    try {
      if (emailChanged) {
        await verifyBeforeUpdateEmail(firebaseUser, email);
      }
      const updatedContactFields = {};
      if (phoneChanged) {
        updatedContactFields.contactNumber = normalizedPhone;
        updatedContactFields.contact = normalizedPhone;
      }
      if (emailChanged) updatedContactFields.pendingEmail = email;
      if (Object.keys(updatedContactFields).length) {
        await saveAccountProfileFields(firebaseUser.uid, updatedContactFields);
      }
      if (phoneChanged) {
        profile.contactNumber = normalizedPhone;
        profile.contact = normalizedPhone;
      }
      if (emailChanged) {
        profile.pendingEmail = email;
        localStorage.setItem(
          `recovibe_pending_email_${firebaseUser.uid}`,
          JSON.stringify({ pendingEmail: email, oldEmail: profile.email, timestamp: Date.now() }),
        );
      }
      localStorage.setItem("recovibeAdminProfile", JSON.stringify(profile));
      display();
      setContactEditing(false);
      toast(emailChanged
        ? "Verification sent. Keep using your current email until you confirm the new address."
        : "Contact details saved.");
    } catch (saveError) {
      console.error("[AdminProfile] Could not update contact details:", saveError);
      contactError.textContent = saveError?.message || "Could not update contact details.";
    } finally {
      contactSaveButton.textContent = "Save";
      updateContactState();
    }
  };
  if (adminDetailsForm) {
    adminDetailsEditButton.onclick = () => setAdminDetailsEditing(true);
    [adminDetailsPosition, adminDetailsCampus].forEach((input) => {
      input.addEventListener("keydown", (event) => {
        if (!/^[0-9]$/.test(event.key)) return;
        event.preventDefault();
        adminDetailsInputFeedback = numberNameError;
        updateAdminDetailsState();
      });
      input.addEventListener("beforeinput", (event) => {
        if (typeof event.data !== "string" || !/\d/.test(event.data)) return;
        event.preventDefault();
        adminDetailsInputFeedback = numberNameError;
        updateAdminDetailsState();
      });
      input.addEventListener("input", () => {
        const originalValue = input.value;
        const hasDigits = /\d/.test(originalValue);
        const hasInvalidCharacters = /[^\p{L}\p{M} .'-]/u.test(originalValue);
        sanitizeNameInput(input);
        adminDetailsInputFeedback = hasDigits
          ? numberNameError
          : hasInvalidCharacters
            ? invalidNameError
            : "";
        updateAdminDetailsState();
      });
    });
    adminDetailsForm.addEventListener("input", (event) => {
      if (event.target === adminDetailsPosition || event.target === adminDetailsCampus) return;
      adminDetailsError.textContent = "";
      adminDetailsInputFeedback = "";
      updateAdminDetailsState();
    });
    root.querySelector("#cancelAdminDetails").onclick = () => {
      if (adminDetailsDirty && !confirm("Discard your unsaved Admin detail changes?")) return;
      setAdminDetailsEditing(false);
    };
    adminDetailsForm.onsubmit = async (event) => {
      event.preventDefault();
      const nextPosition = adminDetailsPosition.value.trim().normalize("NFC");
      const nextCampus = adminDetailsCampus.value.trim().normalize("NFC");
      const nextAdminId = adminDetailsAdminId?.value.trim() || "";
      const positionPreservesOsas =
        !positionMustRetainOsasMarker || normalizeStageValue(nextPosition).includes("osas");
      if (adminDetailsInputFeedback || /\d/.test(nextPosition) || /\d/.test(nextCampus) ||
        !isValidAdminDetailText(nextPosition) || !isValidAdminDetailText(nextCampus) ||
        !positionPreservesOsas || (canEditAdminId && (!nextAdminId || nextAdminId.length > 100))) {
        adminDetailsError.textContent = adminDetailsInputFeedback ||
          (/\d/.test(nextPosition) || /\d/.test(nextCampus)
            ? numberNameError
            : !isValidAdminDetailText(nextPosition) || !isValidAdminDetailText(nextCampus)
              ? "Enter a non-empty Position and Campus of 150 characters or fewer using letters, spaces, hyphens, periods, and apostrophes only."
              : !positionPreservesOsas
                ? "Keep OSAS in the Position value because it is the only OSAS account marker."
                : "Enter a valid Admin ID of 100 characters or fewer.");
        return;
      }
      if (!firebaseUser?.uid || firebaseUser.uid !== profile.uid || !db) {
        adminDetailsError.textContent = "Sign in again before updating Admin details.";
        return;
      }
      const updatedAdminDetails = {
        position: nextPosition,
        campus: nextCampus,
      };
      if (canEditAdminId) updatedAdminDetails.adminId = nextAdminId;
      adminDetailsSaveButton.disabled = true;
      adminDetailsSaveButton.textContent = "Saving...";
      try {
        await saveOsasAdminDetails(firebaseUser.uid, {
          ...updatedAdminDetails,
          updatedAt: serverTimestamp(),
        });
        profile = { ...profile, ...updatedAdminDetails };
        position = nextPosition;
        campus = nextCampus;
        if (canEditAdminId) adminId = nextAdminId;
        localStorage.setItem("recovibeAdminProfile", JSON.stringify(profile));
        root.querySelector("#viewAdminId").textContent = adminId || "Not set";
        root.querySelector("#viewPosition").textContent = position || "Not set";
        root.querySelector("#viewCampus").textContent = campus || "Not set";
        document.querySelector("[data-role]").textContent = position;
        document.querySelector("[data-role]").title = position;
        setAdminDetailsEditing(false);
        toast("Admin details saved.");
      } catch (saveError) {
        console.error("[AdminProfile] Could not update Admin details:", saveError);
        adminDetailsError.textContent = saveError?.message || "Could not save Admin details.";
      } finally {
        adminDetailsSaveButton.textContent = "Save";
        updateAdminDetailsState();
      }
    };
  }
  const layer = root.querySelector("#passwordLayer");
  function closePassword() {
    layer.hidden = true;
    layer.style.display = "none";
    document.body.style.overflow = "";
    root.querySelector("#changePassword").focus();
    root.querySelector("#passwordError").textContent = "";
    root.querySelector("#passwordForm").reset();
  }
  root.querySelector("#changePassword").onclick = () => {
    layer.hidden = false;
    layer.style.display = "grid";
    document.body.style.overflow = "hidden";
    root.querySelector("#currentPassword").focus();
  };
  root.querySelectorAll("[data-toggle]").forEach(
    (button) =>
      (button.onclick = () => {
        const input = document.getElementById(button.dataset.toggle),
          visible = input.type === "password";
        input.type = visible ? "text" : "password";
        button.setAttribute("aria-pressed", String(visible));
        button.setAttribute(
          "aria-label",
          `${visible ? "Hide" : "Show"} ${input.labels[0]?.textContent.toLowerCase() || "password"}`,
        );
      }),
  );
  root.querySelector("#passwordClose").onclick = closePassword;
  root.querySelector("#cancelPassword").onclick = closePassword;
  layer.addEventListener("click", (event) => {
    if (event.target === layer) closePassword();
  });
  root.querySelector("#passwordForm").onsubmit = async (event) => {
    event.preventDefault();
    const current = root.querySelector("#currentPassword").value,
      next = root.querySelector("#newPassword").value,
      confirmValue = root.querySelector("#confirmPassword").value,
      error = root.querySelector("#passwordError"),
      button = event.submitter || event.currentTarget.querySelector('[type="submit"]');
    error.textContent = "";
    if (
      !current ||
      next.length < 8 ||
      !/[A-Z]/.test(next) ||
      !/[a-z]/.test(next) ||
      !/[0-9]/.test(next)
    ) {
      error.textContent =
        "Use at least 8 characters with uppercase, lowercase, and a number.";
      return;
    }
    if (next !== confirmValue) {
      error.textContent = "The new passwords do not match.";
      return;
    }
    button.disabled = true;
    button.textContent = "Updating…";
    try {
      if (!firebaseUser?.email) throw new Error("Your signed-in account could not be verified.");
      const credential = EmailAuthProvider.credential(firebaseUser.email, current);
      await reauthenticateWithCredential(firebaseUser, credential);
      await updatePassword(firebaseUser, next);
      closePassword();
      toast("Password changed successfully.");
    } catch (failure) {
      error.textContent =
        failure.code === "auth/wrong-password" || failure.code === "auth/invalid-credential"
          ? "Current password is incorrect."
          : failure.code === "auth/requires-recent-login"
            ? "Please sign in again before changing your password."
            : "Password could not be changed. Please try again.";
    } finally {
      button.disabled = false;
      button.textContent = "Update Password";
    }
  };
  layer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePassword();
      return;
    }
    if (event.key === "Tab") {
      const controls = [
        ...layer.querySelectorAll("button:not(:disabled),input:not(:disabled)"),
      ];
      if (event.shiftKey && document.activeElement === controls[0]) {
        event.preventDefault();
        controls.at(-1).focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === controls.at(-1)
      ) {
        event.preventDefault();
        controls[0].focus();
      }
    }
  });
  window.addEventListener("beforeunload", (event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  display();
  if (profile.pendingEmail) {
    toast(`Email change pending verification at ${profile.pendingEmail}. Keep using your current email until confirmed.`);
  }
  signalProfilePageReady();
})();
