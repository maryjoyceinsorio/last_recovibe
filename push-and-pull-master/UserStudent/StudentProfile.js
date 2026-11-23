import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
  verifyBeforeUpdateEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  auth,
  authReady,
  db,
  rtdb,
  isFirebaseConfigured,
  isRtdbConfigured,
} from "./firebaseConfig.js";
import { ref, onValue, off, set, update, push } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  clearCachedStudentProfile,
  loadStudentProfile,
  renderStudentSidebar,
  syncVerifiedStudentEmail,
} from "./studentIdentity.js";
import {
  CORRECTION_FIELDS_BY_ROLE,
  submitCorrectionRequest,
  subscribeMyCorrectionRequests,
} from "../correctionRequests.js";
import {
  formatPhilippineMobile,
  isValidPhilippineMobile,
  mobileDigits,
  savePendingProfileEmail,
} from "../portalProfileAccount.js";
import {
  commitAttendanceQrCanvas,
  createAttendanceQrCanvas,
  createAttendanceQrPayload,
  renderAttendanceQr,
} from "./attendanceQr.js";

const DEFAULT_STUDENT = {};

function uniqueProfileValues(...values) {
  const seen = new Set();
  return values
    .flatMap((value) => Array.isArray(value) ? value : value == null ? [] : [value])
    .filter((value) => typeof value === "string" || typeof value === "number")
    .map((value) => String(value).trim())
    .filter((value) => {
      const key = value.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function formatPhilippinePhone(raw) {
  return formatPhilippineMobile(raw);
}

function unformatPhone(formatted) {
  return mobileDigits(formatted);
}

function normalizeStudentNumber(value) {
  return String(value || "").trim().toUpperCase();
}

function studentOrganization(profile = {}, fallbackProfile = {}) {
  const departmentValues = [
    profile.department,
    profile.departmentCode,
    profile.program,
    profile.course,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const organization = String(profile.organization || "").trim();
  if (organization && !departmentValues.includes(organization.toLowerCase())) return organization;

  const fallbackDepartmentValues = [
    fallbackProfile.department,
    fallbackProfile.departmentCode,
    fallbackProfile.program,
    fallbackProfile.course,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const fallbackOrganization = String(fallbackProfile.organization || "").trim();
  return fallbackOrganization &&
    !fallbackDepartmentValues.includes(fallbackOrganization.toLowerCase())
    ? fallbackOrganization
    : "";
}

function hydrateUserProfile() {
  const local = JSON.parse(localStorage.getItem("recovibeCurrentUser") || sessionStorage.getItem("recovibeCurrentUser") || "null");
  const authenticatedUid = auth?.currentUser?.uid || "";
  const user = authenticatedUid && local?.uid === authenticatedUid ? { ...local } : {};
  user.StudentOrgs = uniqueProfileValues(
    user.StudentOrgs,
    user.studentOrgs,
    user.organizations,
    user.organization,
    user.courseOrganization,
    user.courseOrg,
  );
  user.departments = uniqueProfileValues(
    user.departments,
    user.departmentCodes,
    user.department,
    user.departmentCode,
    user.course,
    user.program,
  );
  const storedFirstName = String(user.firstName || "").trim();
  const storedMiddleName = String(user.middleName || "").trim();
  const storedLastName = String(user.lastName || "").trim();
  const storedFullName = String(user.name || user.fullName || "").trim();
  const nameFromProfile = [storedFirstName, storedMiddleName, storedLastName]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  const displayName = storedFullName || nameFromProfile;
  const firstName =
    storedFirstName ||
    storedFullName.split(/\s+/).filter(Boolean)[0] ||
    nameFromProfile.split(/\s+/).filter(Boolean)[0] ||
    "";
  const initials = [
    firstName,
    user.lastName || (storedFullName.split(/\s+/).filter(Boolean).length > 1
      ? storedFullName.split(/\s+/).filter(Boolean).at(-1)
      : ""),
  ]
    .filter(Boolean)
    .map((part) => Array.from(String(part))[0]?.toUpperCase() || "")
    .join("");
  const organization = studentOrganization(user);
  const studentNo = normalizeStudentNumber(user.studentNumber || user.studentId);
  const yearSec = String(user.yearSection || user.year || "").replace(/^Year\s+/i, "").trim();
  const department = String(user.department || user.program || user.course || "").trim();
  const email = String(user.email || "").trim().toLowerCase();
  const contact = String(user.contactNumber || user.contact || "").trim();

  // Header & sidebar elements
  document.querySelectorAll(".user-name, #userName, #heroUserName").forEach((element) => {
    element.textContent = displayName;
  });
  renderStudentSidebar(user);
  document.querySelectorAll("#heroAvatar, .hero-avatar").forEach((element) => {
    element.textContent = initials;
  });
  document.querySelectorAll("#userFirstName").forEach((element) => {
    element.textContent = firstName;
  });

  // Name Card View
  const viewFirst = document.getElementById("viewFirstName");
  if (viewFirst) viewFirst.textContent = storedFirstName || firstName;
  const viewMid = document.getElementById("viewMiddleName");
  if (viewMid) {
    if (storedMiddleName) {
      viewMid.textContent = storedMiddleName;
    } else {
      viewMid.innerHTML = '<span class="empty-muted">Not set</span>';
    }
  }
  const viewLast = document.getElementById("viewLastName");
  if (viewLast) viewLast.textContent = storedLastName;

  // Contact Card View
  const viewEm = document.getElementById("viewEmail");
  if (viewEm) viewEm.textContent = email;
  const viewPhone = document.getElementById("viewContact");
  if (viewPhone) viewPhone.textContent = formatPhilippinePhone(contact);

  // Student Details Card View
  const viewStudNo = document.getElementById("viewStudentNumber");
  if (viewStudNo) viewStudNo.textContent = studentNo;
  const viewYrSec = document.getElementById("viewYearSection");
  if (viewYrSec) viewYrSec.textContent = yearSec;
  const viewDept = document.getElementById("viewDepartment");
  if (viewDept) viewDept.textContent = department;
  const viewOrg = document.getElementById("viewOrganization");
  if (viewOrg) viewOrg.textContent = organization;

  // QR card summaries
  const qrName = document.getElementById("qrCardStudentName");
  if (qrName) qrName.textContent = displayName;
  const qrNo = document.getElementById("qrCardStudentNumber");
  if (qrNo) qrNo.textContent = studentNo;
  const qrOrg = document.getElementById("qrCardStudentOrg");
  if (qrOrg) qrOrg.textContent = organization;
  const qrModalName = document.getElementById("qrModalStudentName");
  if (qrModalName) qrModalName.textContent = displayName;

  // Pending verification notice
  const pendingRaw = localStorage.getItem("recovibe_pending_email_" + (user.uid || "me")) ||
    (user.pendingEmail ? JSON.stringify({ pendingEmail: user.pendingEmail }) : "");
  const pendingBox = document.getElementById("pendingVerificationBox");
  if (pendingRaw) {
    try {
      const pendingData = JSON.parse(pendingRaw);
      if (pendingData && pendingData.pendingEmail) {
        if (pendingBox) {
          pendingBox.hidden = false;
          const pendingEmailEl = document.getElementById("pendingVerificationEmail");
          const currentEmailEl = document.getElementById("currentSignInEmail");
          if (pendingEmailEl) pendingEmailEl.textContent = pendingData.pendingEmail;
          if (currentEmailEl) currentEmailEl.textContent = email;
        }
      } else if (pendingBox) {
        pendingBox.hidden = true;
      }
    } catch {
      if (pendingBox) pendingBox.hidden = true;
    }
  } else if (pendingBox) {
    pendingBox.hidden = true;
  }
}

(async () => {
  await authReady;
  hydrateUserProfile();
  const localUser = JSON.parse(localStorage.getItem("recovibeCurrentUser") || sessionStorage.getItem("recovibeCurrentUser") || "null");
  let user =
    auth?.currentUser?.uid && localUser?.uid === auth.currentUser.uid
      ? { ...DEFAULT_STUDENT, ...localUser }
      : DEFAULT_STUDENT;
  const preferenceKey = "recovibePreferences";
  const accountPreferenceKey = `recovibePreferences:${user.uid || user.email || "student"}`;
  const categories = [
    "Academic & Learning",
    "Tech & Innovation",
    "Seminars & Workshops",
    "Leadership & Career",
    "Orgs & Student Acts",
    "Social Events",
    "University & Campuses",
    "Community & Outreach",
    "Music & Entertainment",
    "Arts & Culture",
    "Sports & Fitness",
    "Competitions",
  ];
  const sources = [
    "PUP Official",
    "Organizational",
    "Others / External",
  ];
  function normalizePreferredSources(values) {
    return [...new Set(values.map((source) => {
      const value = String(source || "").trim();
      const normalized = value.toLowerCase().replace(/\s+/g, " ");
      if (
        /\bcsc\b/.test(normalized) ||
        /campus student council|central student council/.test(normalized)
      ) {
        return "Organizational";
      }
      if (/^(others?\s*\/\s*external|other|external)$/.test(normalized)) {
        return "Others / External";
      }
      return sources.find((label) => label.toLowerCase() === normalized) || value;
    }).filter(Boolean))];
  }
  const defaults = {
    categories: ["Academic & Learning", "Tech & Innovation"],
    sources,
  };
  let preferences = user.preferences ||
    JSON.parse(localStorage.getItem(accountPreferenceKey) || "null") ||
    JSON.parse(localStorage.getItem(preferenceKey) || "null") ||
    defaults;
  if (!Array.isArray(preferences.categories) || !Array.isArray(preferences.sources)) {
    preferences = defaults;
  }
  preferences = {
    ...preferences,
    sources: normalizePreferredSources(preferences.sources),
  };

  function showToast(message, isError = false) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.style.backgroundColor = isError ? "var(--maroon-primary)" : "var(--text-dark)";
    toast.classList.add("is-visible");
    window.clearTimeout(toast._timer);
    toast._timer = window.setTimeout(() => {
      toast.classList.remove("is-visible");
    }, 2800);
  }
  window.showToast = showToast;

  function showConfirmation({
    title = "Confirm Action",
    message = "Are you sure you want to proceed?",
    confirmText = "Confirm",
    cancelText = "Cancel",
    isDanger = false,
  } = {}) {
    return new Promise((resolve) => {
      const overlay = document.getElementById("confirmModalOverlay");
      const titleEl = document.getElementById("confirmModalTitle");
      const msgEl = document.getElementById("confirmModalMessage");
      const confirmBtn = document.getElementById("confirmModalConfirmBtn");
      const cancelBtn = document.getElementById("confirmModalCancelBtn");
      const backdrop = document.getElementById("confirmModalBackdrop");
      const iconEl = document.getElementById("confirmModalIcon");

      if (!overlay || !confirmBtn || !cancelBtn) {
        resolve(window.confirm(message));
        return;
      }

      if (titleEl) titleEl.textContent = title;
      if (msgEl) msgEl.textContent = message;
      confirmBtn.textContent = confirmText;
      cancelBtn.textContent = cancelText;

      if (iconEl) {
        iconEl.classList.toggle("danger", Boolean(isDanger));
      }
      if (isDanger) {
        confirmBtn.classList.add("btn-danger");
        confirmBtn.classList.remove("btn-primary");
      } else {
        confirmBtn.classList.remove("btn-danger");
        confirmBtn.classList.add("btn-primary");
      }

      overlay.hidden = false;
      overlay.style.display = "flex";
      confirmBtn.focus();

      const cleanup = (result) => {
        overlay.hidden = true;
        overlay.style.display = "none";
        confirmBtn.removeEventListener("click", onConfirm);
        cancelBtn.removeEventListener("click", onCancel);
        backdrop?.removeEventListener("click", onCancel);
        document.removeEventListener("keydown", onKeydown);
        resolve(result);
      };

      const onConfirm = () => cleanup(true);
      const onCancel = () => cleanup(false);
      const onKeydown = (e) => {
        if (e.key === "Escape") onCancel();
      };

      confirmBtn.addEventListener("click", onConfirm);
      cancelBtn.addEventListener("click", onCancel);
      backdrop?.addEventListener("click", onCancel);
      document.addEventListener("keydown", onKeydown);
    });
  }
  window.showConfirmation = showConfirmation;

  const setText = (id, value, fallback = "Not provided") => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value || "").trim() || fallback;
  };
  const studentNo = normalizeStudentNumber(user.studentNumber || user.studentId);
  const department = String(user.department || user.program || user.course || "").trim();
  const storedName = String(user.fullName || user.name || "").trim();
  const nameParts = storedName.split(/\s+/).filter(Boolean);
  const firstName = String(user.firstName || "").trim() || nameParts[0] || "";
  const lastName =
    String(user.lastName || "").trim() ||
    (nameParts.length > 1 ? nameParts.at(-1) : "");
  setText("profileFirstName", firstName);
  setText(
    "profileMiddleName",
    String(user.middleName || "").trim() ||
      (nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : "—"),
  );
  setText("profileLastName", lastName);
  setText("profileStudentId", studentNo);
  setText("profileEmail", user.email);
  setText("profileContact", user.contactNumber || user.contact);
  setText("profileDepartment", department);
  setText("profileYear", user.year);
  setText("profileOrganization", studentOrganization(user));
  setText("qrCardStudentName", storedName);
  setText("qrCardStudentNumber", normalizeStudentNumber(user.studentNumber || user.studentId));
  setText("qrCardStudentOrg", studentOrganization(user));
  setText(
    "todayDate",
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  );
  const renderSummary = (id, items, emptyMessage = "None chosen yet") => {
    const container = document.getElementById(id);
    if (!container) return;
    container.replaceChildren();
    if (!items || !items.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "preference-empty";
      const emptySpan = document.createElement("span");
      emptySpan.className = "empty-muted";
      emptySpan.textContent = emptyMessage;
      emptyState.append(emptySpan);
      container.append(emptyState);
      return;
    }
    items.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = id === "categorySummary" ? "chip chip-maroon" : "chip chip-gold";
      chip.textContent = item;
      container.append(chip);
    });
  };
  renderSummary(
    "categorySummary",
    preferences.categories,
    "None chosen yet",
  );
  renderSummary("sourceSummary", preferences.sources, "None chosen yet");

  const passwordFormModal = document.getElementById("passwordFormModal");
  const passwordForm = document.getElementById("passwordForm");
  const passwordFormStatus = document.getElementById("passwordFormStatus");
  const passwordUpdateSubmitBtn = document.getElementById("passwordUpdateSubmitBtn");
  const cancelPasswordChangeBtn = document.getElementById("cancelPasswordChange");
  const passwordCloseBtn = document.getElementById("closePasswordModal");
  const passwordFieldIds = ["currentPassword", "newPassword", "confirmPassword"];
  let passwordUpdateInProgress = false;
  let passwordUpdateSaving = false;
  let passwordSuccessCloseTimer = null;

  function setPasswordStatus(message, isError = false) {
    if (!passwordFormStatus) return;
    passwordFormStatus.textContent = message;
    passwordFormStatus.style.color = message
      ? isError ? "var(--red-500)" : "#1b6d43"
      : "";
    passwordFormStatus.setAttribute("role", isError ? "alert" : "status");
    passwordFormStatus.setAttribute("aria-live", isError ? "assertive" : "polite");
  }

  function resetPasswordVisibility() {
    passwordForm?.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
      const input = document.getElementById(toggle.dataset.passwordToggle);
      if (input) input.type = "password";
      const label = toggle.dataset.passwordLabel || "password";
      toggle.setAttribute("aria-pressed", "false");
      toggle.setAttribute("aria-label", `Show ${label}`);
      toggle.title = `Show ${label}`;
    });
  }

  function setPasswordSaving(isSaving) {
    passwordUpdateSaving = isSaving;
    passwordForm?.setAttribute("aria-busy", String(isSaving));
    passwordFieldIds.forEach((id) => {
      const input = document.getElementById(id);
      if (input) input.disabled = isSaving;
    });
    if (cancelPasswordChangeBtn) cancelPasswordChangeBtn.disabled = isSaving;
    if (passwordCloseBtn) passwordCloseBtn.disabled = isSaving;
    if (passwordUpdateSubmitBtn) {
      passwordUpdateSubmitBtn.disabled = isSaving || passwordUpdateInProgress;
      passwordUpdateSubmitBtn.textContent = isSaving ? "Updating..." : "Update Password";
    }
  }

  function passwordUpdateErrorMessage(error) {
    switch (error?.code) {
      case "auth/invalid-credential":
      case "auth/invalid-login-credentials":
      case "auth/user-mismatch":
      case "auth/wrong-password":
        return "Current password is incorrect.";
      case "auth/requires-recent-login":
      case "auth/user-token-expired":
        return "Your sign-in has expired. Sign in again, then retry changing your password.";
      case "auth/weak-password":
        return "The new password does not meet the password requirements.";
      case "auth/too-many-requests":
        return "Too many attempts. Wait a few minutes, then try again.";
      case "auth/network-request-failed":
        return "A network error interrupted the password update. Check your connection and try again.";
      case "auth/operation-not-allowed":
        return "Password sign-in is not enabled for this account.";
      case "auth/user-disabled":
        return "This account is disabled. Contact support for help.";
      default:
        return error?.message || "Password could not be changed. Please try again.";
    }
  }

  /* ==========================================================================
     Feedback Alert Banner Controller
     ========================================================================== */
  let feedbackAlertTimer = null;
  function showFeedbackAlert(message, isError = false, showProfileRetry = false) {
    const alertEl = document.getElementById("profileFeedbackAlert");
    const textEl = document.getElementById("profileFeedbackText");
    const retryButton = document.getElementById("btnRetryProfileFetch");
    if (retryButton) retryButton.hidden = !showProfileRetry;
    if (!alertEl || !textEl) {
      showToast(message, isError);
      return;
    }
    textEl.textContent = message;
    alertEl.classList.toggle("error", Boolean(isError));
    alertEl.hidden = false;
    if (feedbackAlertTimer) clearTimeout(feedbackAlertTimer);
    if (showProfileRetry) {
      feedbackAlertTimer = null;
      return;
    }
    feedbackAlertTimer = setTimeout(() => {
      alertEl.hidden = true;
      feedbackAlertTimer = null;
    }, 4000);
  }

  function clearProfileLoadFeedback() {
    const retryButton = document.getElementById("btnRetryProfileFetch");
    if (!retryButton || retryButton.hidden) return;
    const alertEl = document.getElementById("profileFeedbackAlert");
    if (alertEl) alertEl.hidden = true;
    retryButton.hidden = true;
    if (feedbackAlertTimer) clearTimeout(feedbackAlertTimer);
    feedbackAlertTimer = null;
  }

  document.getElementById("btnDismissFeedback")?.addEventListener("click", () => {
    const alertEl = document.getElementById("profileFeedbackAlert");
    const retryButton = document.getElementById("btnRetryProfileFetch");
    if (alertEl) alertEl.hidden = true;
    if (retryButton) retryButton.hidden = true;
    if (feedbackAlertTimer) clearTimeout(feedbackAlertTimer);
    feedbackAlertTimer = null;
  });

  /* ==========================================================================
     Validation Helpers
     ========================================================================== */
  const namePattern = /^[\p{L}\p{M}]+(?:[ .'-][\p{L}\p{M}]+)*\.?$/u;
  const emailPattern =
    /^(?=.{1,254}$)(?!.*\.\.)[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,}$/i;
  function isValidName(value) {
    const normalized = value.normalize("NFC");
    const length = Array.from(normalized).length;
    return length >= 1 && length <= 50 && namePattern.test(normalized);
  }

  function sanitizeNameValue(value) {
    return value.replace(/[^\p{L}\p{M} .'-]/gu, "");
  }

  function sanitizeNameInput(input) {
    const originalValue = input.value;
    const selectionStart = input.selectionStart === null
      ? originalValue.length
      : input.selectionStart;
    const selectionEnd = input.selectionEnd === null
      ? selectionStart
      : input.selectionEnd;
    const safeBeforeStart = sanitizeNameValue(originalValue.slice(0, selectionStart));
    const safeSelection = sanitizeNameValue(originalValue.slice(selectionStart, selectionEnd));
    const sanitizedValue = sanitizeNameValue(originalValue);
    if (sanitizedValue === originalValue) return;

    input.value = sanitizedValue;
    input.setSelectionRange(
      safeBeforeStart.length,
      safeBeforeStart.length + safeSelection.length,
    );
  }

  function isValidEmail(value) {
    if (
      value.length > 254 ||
      /\s/.test(value) ||
      (value.match(/@/g) || []).length !== 1
    ) {
      return false;
    }
    const [local, domain] = value.split("@");
    return (
      local.length <= 64 &&
      !local.startsWith(".") &&
      !local.endsWith(".") &&
      !domain.startsWith(".") &&
      !domain.endsWith(".") &&
      emailPattern.test(value)
    );
  }

  function normalizeName(value) {
    return value
      .replace(/ {2,}/g, " ")
      .replace(/^ /, "")
      .replace(/(^|[ '-])(\p{L})/gu, (_, separator, letter) =>
        separator + letter.toUpperCase(),
      );
  }

  /* ==========================================================================
     State & Single-Card Edit Coordination
     ========================================================================== */
  const savedState = {
    firstName: String(user.firstName || "").trim(),
    middleName: String(user.middleName || "").trim(),
    lastName: String(user.lastName || "").trim(),
    email: String(user.email || "").trim().toLowerCase(),
    contactNumber: unformatPhone(user.contactNumber || user.contact),
  };

  let activeEditCard = null; // null | "name" | "contact" | "preferences"

  // 1. Name Card DOM
  const btnEditName = document.getElementById("btnEditName");
  const nameCardView = document.getElementById("nameCardView");
  const nameCardEdit = document.getElementById("nameCardEdit");
  const inputFirstName = document.getElementById("inputFirstName");
  const inputMiddleName = document.getElementById("inputMiddleName");
  const inputLastName = document.getElementById("inputLastName");
  const errFirstName = document.getElementById("errFirstName");
  const errMiddleName = document.getElementById("errMiddleName");
  const errLastName = document.getElementById("errLastName");
  const nameUnsavedCount = document.getElementById("nameUnsavedCount");
  const nameCancelBtn = document.getElementById("nameCancelBtn");
  const nameSaveBtn = document.getElementById("nameSaveBtn");

  // 2. Contact Card DOM
  const btnEditContact = document.getElementById("btnEditContact");
  const contactCardView = document.getElementById("contactCardView");
  const contactCardEdit = document.getElementById("contactCardEdit");
  const inputContactEmail = document.getElementById("inputContactEmail");
  const errContactEmail = document.getElementById("errContactEmail");
  const emailDifferentWarning = document.getElementById("emailDifferentWarning");
  const inputContactPhone = document.getElementById("inputContactPhone");
  const errContactPhone = document.getElementById("errContactPhone");
  const contactUnsavedCount = document.getElementById("contactUnsavedCount");
  const contactCancelBtn = document.getElementById("contactCancelBtn");
  const contactSaveBtn = document.getElementById("contactSaveBtn");
  const btnCancelEmailChange = document.getElementById("btnCancelEmailChange");

  // 3. Locked Student Details Card & Correction Modal DOM
  const btnRequestCorrection = document.getElementById("btnRequestCorrection");
  const correctionModalOverlay = document.getElementById("correctionModalOverlay");
  const correctionModalBackdrop = document.getElementById("correctionModalBackdrop");
  const closeCorrectionModal = document.getElementById("closeCorrectionModal");
  const btnCancelCorrection = document.getElementById("btnCancelCorrection");
  const correctionForm = document.getElementById("correctionForm");
  const correctionFieldSelect = document.getElementById("correctionFieldSelect");
  const correctionCurrentValue = document.getElementById("correctionCurrentValue");
  const errCorrectionField = document.getElementById("errCorrectionField");
  const correctionMessageInput = document.getElementById("correctionMessageInput");
  const errCorrectionMessage = document.getElementById("errCorrectionMessage");
  const correctionReasonInput = document.getElementById("correctionReasonInput");
  const errCorrectionReason = document.getElementById("errCorrectionReason");
  const correctionReasonCount = document.getElementById("correctionReasonCount");
  const correctionSubmitStatus = document.getElementById("correctionSubmitStatus");
  const correctionRequestsContent = document.getElementById("correctionRequestsContent");
  const btnSendCorrection = document.getElementById("btnSendCorrection");
  const correctionRequestsBatchSize = 3;
  let correctionRequests = [];
  let correctionRequestsVisibleCount = correctionRequestsBatchSize;
  let correctionRequestsLoading = true;
  let correctionRequestsError = "";
  let correctionRequestsUnsubscribe = null;
  let correctionRequestsTimeout = null;
  let correctionUid = "";
  let correctionProfileData = null;
  let correctionAuthUser = null;
  let correctionSubmitInFlight = false;
  let correctionPageActive = true;

  // 4. Preferences Card DOM
  const editPreferencesBtn = document.getElementById("editPreferences");
  const preferencesCardView = document.getElementById("preferencesCardView");
  const preferencesCardEdit = document.getElementById("preferencesCardEdit");
  const groupLearningCareer = document.getElementById("groupLearningCareer");
  const groupCampusLife = document.getElementById("groupCampusLife");
  const groupArtsSportsFun = document.getElementById("groupArtsSportsFun");
  const categoryCountBadge = document.getElementById("categoryCountBadge");
  const btnSelectAllCategories = document.getElementById("btnSelectAllCategories");
  const btnClearAllCategories = document.getElementById("btnClearAllCategories");
  const errCategories = document.getElementById("errCategories");
  const sourceCountBadge = document.getElementById("sourceCountBadge");
  const btnTurnAllSourcesOn = document.getElementById("btnTurnAllSourcesOn");
  const prefSourcesList = document.getElementById("prefSourcesList");
  const errSources = document.getElementById("errSources");
  const prefSummaryText = document.getElementById("prefSummaryText");
  const preferencesUnsavedCount = document.getElementById("preferencesUnsavedCount");
  const cancelPreferencesBtn = document.getElementById("cancelPreferencesBtn");
  const savePreferencesBtn = document.getElementById("savePreferencesBtn");

  let currentEditCategories = new Set(preferences.categories || []);
  let currentEditSources = new Set(preferences.sources || []);

  function isPreferencesEditing() {
    return Boolean(
      activeEditCard === "preferences" ||
      (preferencesCardEdit && !preferencesCardEdit.hidden && preferencesCardEdit.style.display !== "none")
    );
  }

  function getPreferencesDirtyCount() {
    const savedCats = new Set(preferences.categories || []);
    const savedSrcs = new Set(preferences.sources || []);
    let count = 0;
    for (const cat of categories) {
      if (savedCats.has(cat) !== currentEditCategories.has(cat)) {
        count++;
      }
    }
    for (const src of sources) {
      if (savedSrcs.has(src) !== currentEditSources.has(src)) {
        count++;
      }
    }
    return count;
  }

  function isNameEditing() {
    return Boolean(activeEditCard === "name" || (nameCardEdit && !nameCardEdit.hidden && nameCardEdit.style.display !== "none"));
  }

  function isContactEditing() {
    return Boolean(activeEditCard === "contact" || (contactCardEdit && !contactCardEdit.hidden && contactCardEdit.style.display !== "none"));
  }

  function getNameDirtyCount() {
    if (!inputFirstName || !inputMiddleName || !inputLastName) return 0;
    let count = 0;
    if (inputFirstName.value.trim() !== (savedState.firstName || "")) count++;
    if (inputMiddleName.value.trim() !== (savedState.middleName || "")) count++;
    if (inputLastName.value.trim() !== (savedState.lastName || "")) count++;
    return count;
  }

  function getContactDirtyCount() {
    if (!inputContactEmail || !inputContactPhone) return 0;
    let count = 0;
    if (inputContactEmail.value.trim().toLowerCase() !== (savedState.email || "").toLowerCase()) count++;
    if (unformatPhone(inputContactPhone.value) !== (savedState.contactNumber || "")) count++;
    return count;
  }

  function updateNameDirtyUI() {
    if (!nameUnsavedCount || !nameSaveBtn) return;
    const count = getNameDirtyCount();
    if (count === 0) {
      nameUnsavedCount.textContent = "No changes yet";
      nameUnsavedCount.classList.remove("is-dirty");
      nameSaveBtn.disabled = true;
    } else {
      nameUnsavedCount.textContent = `${count} unsaved ${count === 1 ? "change" : "changes"}`;
      nameUnsavedCount.classList.add("is-dirty");
      nameSaveBtn.disabled = false;
    }
  }

  function updateContactDirtyUI() {
    if (!contactUnsavedCount || !contactSaveBtn) return;
    const count = getContactDirtyCount();
    if (count === 0) {
      contactUnsavedCount.textContent = "No changes yet";
      contactUnsavedCount.classList.remove("is-dirty");
      contactSaveBtn.disabled = true;
    } else {
      contactUnsavedCount.textContent = `${count} unsaved ${count === 1 ? "change" : "changes"}`;
      contactUnsavedCount.classList.add("is-dirty");
      contactSaveBtn.disabled = false;
    }
  }

  /* ==========================================================================
     1. Name Card Controller
     ========================================================================== */
  function clearNameErrors() {
    [
      { input: inputFirstName, err: errFirstName },
      { input: inputMiddleName, err: errMiddleName },
      { input: inputLastName, err: errLastName },
    ].forEach(({ input, err }) => {
      if (input) input.classList.remove("is-invalid");
      if (err) {
        err.textContent = "";
        err.classList.remove("is-visible");
      }
    });
  }

  function validateNameField(field) {
    if (field === "firstName") {
      const val = inputFirstName.value.trim();
      if (!val) {
        inputFirstName.classList.add("is-invalid");
        errFirstName.textContent = "Enter your first name.";
        errFirstName.classList.add("is-visible");
        return false;
      }
      if (/\d/.test(val)) {
        inputFirstName.classList.add("is-invalid");
        errFirstName.textContent = "Numbers are not allowed in name fields.";
        errFirstName.classList.add("is-visible");
        return false;
      }
      if (!isValidName(val)) {
        inputFirstName.classList.add("is-invalid");
        errFirstName.textContent = "Use letters, spaces, hyphens, periods, or apostrophes (up to 50 characters).";
        errFirstName.classList.add("is-visible");
        return false;
      }
      inputFirstName.classList.remove("is-invalid");
      errFirstName.textContent = "";
      errFirstName.classList.remove("is-visible");
      return true;
    }
    if (field === "lastName") {
      const val = inputLastName.value.trim();
      if (!val) {
        inputLastName.classList.add("is-invalid");
        errLastName.textContent = "Enter your last name.";
        errLastName.classList.add("is-visible");
        return false;
      }
      if (/\d/.test(val)) {
        inputLastName.classList.add("is-invalid");
        errLastName.textContent = "Numbers are not allowed in name fields.";
        errLastName.classList.add("is-visible");
        return false;
      }
      if (!isValidName(val)) {
        inputLastName.classList.add("is-invalid");
        errLastName.textContent = "Use letters, spaces, hyphens, periods, or apostrophes (up to 50 characters).";
        errLastName.classList.add("is-visible");
        return false;
      }
      inputLastName.classList.remove("is-invalid");
      errLastName.textContent = "";
      errLastName.classList.remove("is-visible");
      return true;
    }
    if (field === "middleName") {
      const val = inputMiddleName.value.trim();
      if (/\d/.test(val)) {
        inputMiddleName.classList.add("is-invalid");
        errMiddleName.textContent = "Numbers are not allowed in name fields.";
        errMiddleName.classList.add("is-visible");
        return false;
      }
      if (val && !isValidName(val)) {
        inputMiddleName.classList.add("is-invalid");
        errMiddleName.textContent = "Use letters, spaces, hyphens, periods, or apostrophes (up to 50 characters).";
        errMiddleName.classList.add("is-visible");
        return false;
      }
      inputMiddleName.classList.remove("is-invalid");
      errMiddleName.textContent = "";
      errMiddleName.classList.remove("is-visible");
      return true;
    }
    return true;
  }

  function openNameEdit() {
    if (isPreferencesEditing()) {
      if (getPreferencesDirtyCount() > 0) {
        showFeedbackAlert("Save or cancel your changes to Preferences before editing Name.", true);
        return;
      }
      closePreferencesEdit(true);
    }
    if (isContactEditing()) {
      if (getContactDirtyCount() > 0) {
        showFeedbackAlert("Save or cancel your changes to Contact before editing Name.", true);
        return;
      }
      closeContactEdit(true);
    }
    inputFirstName.value = savedState.firstName || "";
    inputMiddleName.value = savedState.middleName || "";
    inputLastName.value = savedState.lastName || "";
    clearNameErrors();
    updateNameDirtyUI();
    nameCardView.hidden = true;
    nameCardEdit.hidden = false;
    activeEditCard = "name";
    inputFirstName.focus();
  }

  function closeNameEdit(force = false) {
    clearNameErrors();
    nameCardEdit.hidden = true;
    nameCardView.hidden = false;
    if (activeEditCard === "name") activeEditCard = null;
  }

  async function cancelNameEdit() {
    const count = getNameDirtyCount();
    if (count > 0) {
      const discard = await showConfirmation({
        title: "Discard changes?",
        message: `Discard your ${count} unsaved ${count === 1 ? "change" : "changes"}?`,
        confirmText: "Discard",
        cancelText: "Keep editing",
        isDanger: true,
      });
      if (!discard) return;
    }
    closeNameEdit();
  }

  btnEditName?.addEventListener("click", openNameEdit);
  nameCancelBtn?.addEventListener("click", cancelNameEdit);

  [
    { input: inputFirstName, field: "firstName" },
    { input: inputMiddleName, field: "middleName" },
    { input: inputLastName, field: "lastName" },
  ].forEach(({ input, field }) => {
    if (!input) return;
    input.addEventListener("keydown", (event) => {
      if (/^[0-9]$/.test(event.key)) event.preventDefault();
    });
    input.addEventListener("beforeinput", (event) => {
      if (typeof event.data === "string" && /\d/.test(event.data)) {
        event.preventDefault();
      }
    });
    input.addEventListener("paste", (event) => {
      const pastedValue = event.clipboardData?.getData("text");
      if (typeof pastedValue !== "string") return;
      event.preventDefault();
      input.setRangeText(
        sanitizeNameValue(pastedValue),
        input.selectionStart,
        input.selectionEnd,
        "end",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.addEventListener("input", () => {
      sanitizeNameInput(input);
      if (input.classList.contains("is-invalid")) validateNameField(field);
      updateNameDirtyUI();
    });
  });

  inputFirstName?.addEventListener("blur", () => {
    if (inputFirstName.value.trim()) {
      inputFirstName.value = normalizeName(inputFirstName.value.trim());
    }
    validateNameField("firstName");
    updateNameDirtyUI();
  });

  inputMiddleName?.addEventListener("blur", () => {
    if (inputMiddleName.value.trim()) {
      inputMiddleName.value = normalizeName(inputMiddleName.value.trim());
    }
    validateNameField("middleName");
    updateNameDirtyUI();
  });

  inputLastName?.addEventListener("blur", () => {
    if (inputLastName.value.trim()) {
      inputLastName.value = normalizeName(inputLastName.value.trim());
    }
    validateNameField("lastName");
    updateNameDirtyUI();
  });

  nameCardEdit?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const validFirst = validateNameField("firstName");
    const validLast = validateNameField("lastName");
    const validMid = validateNameField("middleName");
    if (!validFirst || !validLast || !validMid) return;

    const first = normalizeName(inputFirstName.value.trim());
    const mid = inputMiddleName.value.trim() ? normalizeName(inputMiddleName.value.trim()) : "";
    const last = normalizeName(inputLastName.value.trim());
    if (/\d/.test(first) || /\d/.test(mid) || /\d/.test(last)) {
      validateNameField("firstName");
      validateNameField("middleName");
      validateNameField("lastName");
      return;
    }

    nameSaveBtn.disabled = true;
    nameSaveBtn.textContent = "Saving...";

    try {
      const fullName = [first, mid, last].filter(Boolean).join(" ");
      const updatedNameFields = {
        firstName: first,
        middleName: mid,
        lastName: last,
        fullName,
        name: fullName,
      };
      if (isFirebaseConfigured && rtdb && user.uid) {
        await update(ref(rtdb, `users/${user.uid}`), updatedNameFields);
      }
      if (isFirebaseConfigured && db && user.uid) {
        await setDoc(doc(db, "users", user.uid), updatedNameFields, { merge: true });
      }
      savedState.firstName = first;
      savedState.middleName = mid;
      savedState.lastName = last;

      user = { ...user, ...updatedNameFields };
      localStorage.setItem("recovibeCurrentUser", JSON.stringify(user));

      hydrateUserProfile();
      closeNameEdit();
      showFeedbackAlert("Name updated.");
    } catch (err) {
      console.error("Failed to save name:", err);
      showFeedbackAlert(err.message || "Could not save name changes.", true);
    } finally {
      nameSaveBtn.disabled = false;
      nameSaveBtn.textContent = "Save";
    }
  });

  /* ==========================================================================
     2. Contact Card Controller
     ========================================================================== */
  function clearContactErrors() {
    inputContactEmail?.classList.remove("is-invalid");
    if (errContactEmail) {
      errContactEmail.textContent = "";
      errContactEmail.classList.remove("is-visible");
    }
    inputContactPhone?.classList.remove("is-invalid");
    if (errContactPhone) {
      errContactPhone.textContent = "";
      errContactPhone.classList.remove("is-visible");
    }
  }

  function validateContactField(field) {
    if (field === "phone") {
      const digits = unformatPhone(inputContactPhone.value);
      if (!digits || !isValidPhilippineMobile(digits)) {
        inputContactPhone.classList.add("is-invalid");
        errContactPhone.textContent = "Enter a valid 11-digit mobile number (e.g. 0912 345 6789).";
        errContactPhone.classList.add("is-visible");
        return false;
      }
      inputContactPhone.classList.remove("is-invalid");
      errContactPhone.textContent = "";
      errContactPhone.classList.remove("is-visible");
      return true;
    }
    if (field === "email") {
      const val = inputContactEmail.value.trim().toLowerCase();
      if (!val || !isValidEmail(val)) {
        inputContactEmail.classList.add("is-invalid");
        errContactEmail.textContent = "Enter a valid email address.";
        errContactEmail.classList.add("is-visible");
        return false;
      }
      inputContactEmail.classList.remove("is-invalid");
      errContactEmail.textContent = "";
      errContactEmail.classList.remove("is-visible");
      return true;
    }
    return true;
  }

  function openContactEdit() {
    if (isPreferencesEditing()) {
      if (getPreferencesDirtyCount() > 0) {
        showFeedbackAlert("Save or cancel your changes to Preferences before editing Contact.", true);
        return;
      }
      closePreferencesEdit(true);
    }
    if (isNameEditing()) {
      if (getNameDirtyCount() > 0) {
        showFeedbackAlert("Save or cancel your changes to Name before editing Contact.", true);
        return;
      }
      closeNameEdit(true);
    }
    inputContactEmail.value = savedState.email || "";
    inputContactPhone.value = formatPhilippinePhone(savedState.contactNumber || "");
    clearContactErrors();
    if (emailDifferentWarning) emailDifferentWarning.hidden = true;
    updateContactDirtyUI();
    contactCardView.hidden = true;
    contactCardEdit.hidden = false;
    activeEditCard = "contact";
    inputContactPhone.focus();
  }

  function closeContactEdit(force = false) {
    clearContactErrors();
    contactCardEdit.hidden = true;
    contactCardView.hidden = false;
    if (activeEditCard === "contact") activeEditCard = null;
  }

  async function cancelContactEdit() {
    const count = getContactDirtyCount();
    if (count > 0) {
      const discard = await showConfirmation({
        title: "Discard changes?",
        message: `Discard your ${count} unsaved ${count === 1 ? "change" : "changes"}?`,
        confirmText: "Discard",
        cancelText: "Keep editing",
        isDanger: true,
      });
      if (!discard) return;
    }
    closeContactEdit();
  }

  btnEditContact?.addEventListener("click", openContactEdit);
  contactCancelBtn?.addEventListener("click", cancelContactEdit);

  inputContactPhone?.addEventListener("input", (e) => {
    const rawVal = e.target.value;
    const digitsOnly = rawVal.replace(/\D/g, "");
    e.target.value = formatPhilippinePhone(digitsOnly);
    updateContactDirtyUI();
  });

  inputContactPhone?.addEventListener("blur", () => {
    validateContactField("phone");
    updateContactDirtyUI();
  });

  inputContactEmail?.addEventListener("input", () => {
    const val = inputContactEmail.value.trim().toLowerCase();
    if (val && val !== (savedState.email || "").toLowerCase() && isValidEmail(val)) {
      if (emailDifferentWarning) emailDifferentWarning.hidden = false;
    } else {
      if (emailDifferentWarning) emailDifferentWarning.hidden = true;
    }
    updateContactDirtyUI();
  });

  inputContactEmail?.addEventListener("blur", () => {
    validateContactField("email");
    updateContactDirtyUI();
  });

  contactCardEdit?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const validPhone = validateContactField("phone");
    const validEmail = validateContactField("email");
    if (!validPhone || !validEmail) return;

    const phoneDigits = unformatPhone(inputContactPhone.value);
    const newEmail = inputContactEmail.value.trim().toLowerCase();
    const phoneChanged = phoneDigits !== savedState.contactNumber;
    const emailChanged = newEmail !== (savedState.email || "").toLowerCase();

    contactSaveBtn.disabled = true;
    contactSaveBtn.textContent = "Saving...";

    let pendingEmailSyncWarning = false;
    try {
      if (phoneChanged) {
        if (isFirebaseConfigured && rtdb && user.uid) {
          await update(ref(rtdb, `users/${user.uid}`), {
            contactNumber: phoneDigits,
          });
        }
        if (isFirebaseConfigured && db && user.uid) {
          await updateDoc(doc(db, "users", user.uid), {
            contactNumber: phoneDigits,
            contact: phoneDigits,
          });
        }
        savedState.contactNumber = phoneDigits;
        user.contactNumber = phoneDigits;
        user.contact = phoneDigits;
      }

      if (emailChanged) {
        const signedInAuthUser = auth?.currentUser;
        if (
          !isFirebaseConfigured ||
          !signedInAuthUser ||
          signedInAuthUser.uid !== user.uid
        ) {
          throw new Error("Please sign in again before changing your email address.");
        }
        await verifyBeforeUpdateEmail(signedInAuthUser, newEmail);
        user.pendingEmail = newEmail;
        savedState.pendingEmail = newEmail;
        localStorage.setItem(
          "recovibe_pending_email_" + (user.uid || "me"),
          JSON.stringify({
            pendingEmail: newEmail,
            oldEmail: savedState.email,
            timestamp: Date.now(),
          })
        );
        if (db && user.uid) {
          try {
            await savePendingProfileEmail(db, user.uid, "student", newEmail, ["users"]);
          } catch (pendingEmailError) {
            pendingEmailSyncWarning = true;
            console.warn("Could not save pending email for sign-in fallback:", pendingEmailError);
          }
        }
      }

      localStorage.setItem("recovibeCurrentUser", JSON.stringify(user));
      hydrateUserProfile();
      closeContactEdit();
      showFeedbackAlert(
        emailChanged
          ? "Verification was sent. Sign in with your current email until the new address is confirmed."
          : "Contact details updated.",
        pendingEmailSyncWarning,
      );
    } catch (err) {
      console.error("Failed to save contact:", err);
      if (err.code === "auth/email-already-in-use") {
        inputContactEmail.classList.add("is-invalid");
        errContactEmail.textContent = "This email is already registered.";
        errContactEmail.classList.add("is-visible");
      } else if (err.code === "auth/requires-recent-login") {
        showFeedbackAlert("Please log in again before changing your email address.", true);
      } else {
        showFeedbackAlert(err.message || "Could not save contact details.", true);
      }
    } finally {
      contactSaveBtn.disabled = false;
      contactSaveBtn.textContent = "Save";
    }
  });

  btnCancelEmailChange?.addEventListener("click", async () => {
    localStorage.removeItem("recovibe_pending_email_" + (user.uid || "me"));
    sessionStorage.removeItem("recovibe_pending_email_" + (user.uid || "me"));
    delete user.pendingEmail;
    delete savedState.pendingEmail;
    if (db && user.uid) {
      try {
        await updateDoc(doc(db, "users", user.uid), { pendingEmail: deleteField() });
      } catch (error) {
        console.warn("Could not clear pending email change:", error);
      }
    }
    localStorage.setItem("recovibeCurrentUser", JSON.stringify(user));
    const pendingBox = document.getElementById("pendingVerificationBox");
    if (pendingBox) pendingBox.hidden = true;
    showFeedbackAlert("Email change cancelled.");
  });

  /* ==========================================================================
     3. Student Details Card Correction Modal Controller
     ========================================================================== */
  const studentCorrectionFields = CORRECTION_FIELDS_BY_ROLE.student;
  const studentCorrectionFieldElements = {
    studentNumber: "viewStudentNumber",
    program: "viewDepartment",
    yearSection: "viewYearSection",
  };

  function populateCorrectionFieldOptions() {
    if (!correctionFieldSelect) return;
    [...correctionFieldSelect.options].slice(1).forEach((option) => option.remove());
    studentCorrectionFields.forEach(({ field, label }) => {
      const option = document.createElement("option");
      option.value = field;
      option.textContent = label;
      correctionFieldSelect.append(option);
    });
  }

  function escapeCorrectionHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function correctionCurrentValueFor(field) {
    const element = document.getElementById(studentCorrectionFieldElements[field]);
    return element?.textContent?.trim() || "";
  }

  function correctionTimestamp(value) {
    if (value && typeof value.toMillis === "function") return value.toMillis();
    if (value && typeof value.toDate === "function") return value.toDate().getTime();
    if (value && typeof value.seconds === "number") return value.seconds * 1000;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  }

  function renderCorrectionRequests() {
    if (!correctionRequestsContent) return;
    if (correctionRequestsLoading) {
      correctionRequestsContent.innerHTML = '<p class="cr-state" role="status">Loading your requests...</p>';
      updateCorrectionSubmitButton();
      return;
    }
    if (correctionRequestsError) {
      correctionRequestsContent.innerHTML = `<p class="cr-state" role="alert">${escapeCorrectionHtml(correctionRequestsError)}</p><button class="cr-retry-button" type="button" data-retry-correction-requests>Retry</button>`;
      updateCorrectionSubmitButton();
      return;
    }
    if (!correctionRequests.length) {
      correctionRequestsContent.innerHTML = '<p class="cr-state">No correction requests yet.</p>';
      updateCorrectionSubmitButton();
      return;
    }

    correctionRequestsVisibleCount = Math.max(
      correctionRequestsBatchSize,
      Math.min(correctionRequestsVisibleCount, correctionRequests.length),
    );
    const visibleRequests = correctionRequests.slice(0, correctionRequestsVisibleCount);
    const toggleButton = correctionRequests.length > correctionRequestsBatchSize
      ? `<button class="cr-retry-button" type="button" data-toggle-correction-requests aria-expanded="${correctionRequestsVisibleCount >= correctionRequests.length}">${correctionRequestsVisibleCount >= correctionRequests.length ? "Show less" : "Load more"}</button>`
      : "";
    correctionRequestsContent.innerHTML = visibleRequests.map((request) => {
      const rawStatus = String(request.status || "").trim().toLowerCase();
      const status = rawStatus === "rejected"
        ? "rejected"
        : ["approved", "resolved"].includes(rawStatus) ? "approved" : "pending";
      const statusClass = status === "pending" ? "" : ` cr-is-${status}`;
      const timestamp = correctionTimestamp(request.createdAt);
      const date = timestamp
        ? new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Manila",
            month: "short",
            day: "numeric",
            year: "numeric",
          }).format(new Date(timestamp))
        : "Date unavailable";
      const label = request.fieldLabel
        || studentCorrectionFields.find((item) => item.field === request.field)?.label
        || "Student detail";
      const reviewerNote = String(request.reviewNote || "").trim();
      return `<article class="cr-request-item">
        <p class="cr-request-field">${escapeCorrectionHtml(label)}</p>
        <span class="cr-status-pill${statusClass}">${status[0].toUpperCase()}${status.slice(1)}</span>
        <p class="cr-request-values">${escapeCorrectionHtml(request.currentValue)} &rarr; ${escapeCorrectionHtml(request.requestedValue)}</p>
        <p class="cr-request-date">${escapeCorrectionHtml(date)}</p>
        ${reviewerNote ? `<p class="cr-request-note"><strong>Reviewer note:</strong> ${escapeCorrectionHtml(reviewerNote)}</p>` : ""}
      </article>`;
    }).join("") + toggleButton;
    updatePendingCorrectionFields();
    updateCorrectionSubmitButton();
  }

  function updatePendingCorrectionFields() {
    if (!correctionFieldSelect) return;
    const pending = new Set(correctionRequests
      .filter((request) => String(request.status || "").trim().toLowerCase() === "pending")
      .map((request) => request.field));
    [...correctionFieldSelect.options].forEach((option) => {
      if (!option.value) return;
      const field = studentCorrectionFields.find((item) => item.field === option.value);
      option.disabled = pending.has(option.value);
      option.textContent = option.disabled ? `${field.label} - Request pending` : field.label;
    });
  }

  function updateCorrectionSubmitButton() {
    if (!btnSendCorrection) return;
    btnSendCorrection.disabled = correctionSubmitInFlight;
    btnSendCorrection.textContent = correctionSubmitInFlight ? "Sending..." : "Send";
  }

  function stopCorrectionRequests() {
    correctionRequestsUnsubscribe?.();
    correctionRequestsUnsubscribe = null;
    clearTimeout(correctionRequestsTimeout);
    correctionRequestsTimeout = null;
  }

  function startCorrectionRequests(uid, profileData) {
    if (!correctionPageActive) return;
    stopCorrectionRequests();
    correctionUid = uid;
    correctionProfileData = profileData;
    correctionRequests = [];
    correctionRequestsVisibleCount = correctionRequestsBatchSize;
    correctionRequestsLoading = true;
    correctionRequestsError = "";
    renderCorrectionRequests();
    updatePendingCorrectionFields();
    if (!uid || auth?.currentUser?.uid !== uid || !db) {
      correctionRequestsLoading = false;
      correctionRequestsError = "Sign in to view your correction requests.";
      renderCorrectionRequests();
      return;
    }

    correctionRequestsTimeout = setTimeout(() => {
      if (!correctionRequestsLoading) return;
      correctionRequestsLoading = false;
      correctionRequestsError = "Requests are taking longer than expected to load.";
      renderCorrectionRequests();
    }, 5000);
    try {
      correctionRequestsUnsubscribe = subscribeMyCorrectionRequests(
        uid,
        (requests) => {
          if (!correctionPageActive) return;
          correctionRequests = requests;
          correctionRequestsLoading = false;
          correctionRequestsError = "";
          clearTimeout(correctionRequestsTimeout);
          correctionRequestsTimeout = null;
          updatePendingCorrectionFields();
          renderCorrectionRequests();
        },
        (error) => {
          if (!correctionPageActive) return;
          correctionRequestsLoading = false;
          correctionRequestsError = error?.code === "permission-denied"
            ? "You don't have permission to view your correction requests."
            : "Couldn't load your requests. Check your connection and retry.";
          clearTimeout(correctionRequestsTimeout);
          correctionRequestsTimeout = null;
          renderCorrectionRequests();
        },
      );
    } catch (error) {
      correctionRequestsLoading = false;
      correctionRequestsError = error?.message || "Couldn't load your requests. Check your connection and retry.";
      clearTimeout(correctionRequestsTimeout);
      correctionRequestsTimeout = null;
      renderCorrectionRequests();
    }
  }

  function openCorrectionModal() {
    if (correctionFieldSelect) correctionFieldSelect.value = "";
    if (correctionMessageInput) correctionMessageInput.value = "";
    if (correctionCurrentValue) correctionCurrentValue.value = "";
    if (correctionReasonInput) correctionReasonInput.value = "";
    if (correctionReasonCount) correctionReasonCount.textContent = "0";
    if (correctionSubmitStatus) correctionSubmitStatus.textContent = "";
    correctionSubmitStatus?.classList.remove("cr-is-error");
    if (errCorrectionField) {
      errCorrectionField.textContent = "";
      errCorrectionField.classList.remove("is-visible");
    }
    if (errCorrectionMessage) {
      errCorrectionMessage.textContent = "";
      errCorrectionMessage.classList.remove("is-visible");
    }
    if (errCorrectionReason) {
      errCorrectionReason.textContent = "";
      errCorrectionReason.classList.remove("is-visible");
    }
    updatePendingCorrectionFields();
    const availableField = [...(correctionFieldSelect?.options || [])]
      .find((option) => option.value && !option.disabled);
    if (availableField) correctionFieldSelect.value = availableField.value;
    if (correctionCurrentValue) {
      correctionCurrentValue.value = correctionCurrentValueFor(correctionFieldSelect?.value || "");
    }
    if (correctionModalOverlay) correctionModalOverlay.hidden = false;
    correctionFieldSelect?.focus();
  }

  function closeCorrectionModalDialog() {
    if (correctionSubmitInFlight) return;
    if (correctionModalOverlay) correctionModalOverlay.hidden = true;
  }

  populateCorrectionFieldOptions();
  correctionFieldSelect?.addEventListener("change", () => {
    if (correctionCurrentValue) {
      correctionCurrentValue.value = correctionCurrentValueFor(correctionFieldSelect.value);
    }
    if (errCorrectionField) errCorrectionField.classList.remove("is-visible");
  });
  correctionReasonInput?.addEventListener("input", () => {
    if (correctionReasonCount) correctionReasonCount.textContent = String(correctionReasonInput.value.length);
    errCorrectionReason?.classList.remove("is-visible");
  });
  btnRequestCorrection?.addEventListener("click", openCorrectionModal);
  closeCorrectionModal?.addEventListener("click", closeCorrectionModalDialog);
  btnCancelCorrection?.addEventListener("click", closeCorrectionModalDialog);
  correctionModalBackdrop?.addEventListener("click", closeCorrectionModalDialog);
  correctionRequestsContent?.addEventListener("click", (event) => {
    if (event.target.closest("[data-toggle-correction-requests]")) {
      correctionRequestsVisibleCount = correctionRequestsVisibleCount >= correctionRequests.length
        ? correctionRequestsBatchSize
        : Math.min(
            correctionRequests.length,
            correctionRequestsVisibleCount + correctionRequestsBatchSize,
          );
      renderCorrectionRequests();
      return;
    }
    if (event.target.closest("[data-retry-correction-requests]") && correctionUid && correctionProfileData) {
      startCorrectionRequests(correctionUid, correctionProfileData);
    }
  });
  window.addEventListener("pagehide", () => {
    correctionPageActive = false;
    stopCorrectionRequests();
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    authReady.then(() => {
      correctionPageActive = true;
      if (correctionAuthUser?.uid && auth?.currentUser?.uid === correctionAuthUser.uid) {
        startCorrectionRequests(correctionAuthUser.uid, correctionProfileData);
      } else if (!auth?.currentUser) {
        window.location.replace("StudentLogin.html");
      }
    }).catch((error) => {
      console.error("Could not restore the student profile session:", error);
    });
  });
  window.addEventListener("student-correction-profile-ready", (event) => {
    const { uid, profile } = event.detail || {};
    if (!correctionPageActive || !uid || auth?.currentUser?.uid !== uid) return;
    correctionAuthUser = { uid };
    startCorrectionRequests(uid, profile);
  });
  window.addEventListener("student-correction-signed-out", () => {
    stopCorrectionRequests();
    correctionAuthUser = null;
    correctionProfileData = null;
    correctionRequestsLoading = false;
    correctionRequestsError = "Sign in to view your correction requests.";
    renderCorrectionRequests();
  });
  window.addEventListener("student-correction-unavailable", () => {
    correctionRequestsLoading = false;
    correctionRequestsError = "Correction requests are unavailable.";
    renderCorrectionRequests();
  });

  correctionForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const field = correctionFieldSelect?.value || "";
    const currentValue = correctionCurrentValueFor(field);
    const requestedValue = correctionMessageInput?.value.trim() || "";
    const reason = correctionReasonInput?.value.trim() || "";
    const isPending = !correctionRequestsLoading && !correctionRequestsError && correctionRequests.some((request) =>
      request.field === field && String(request.status || "").trim().toLowerCase() === "pending",
    );
    const fieldError = !field || isPending;
    const valueError = !requestedValue || requestedValue.length > 200 || requestedValue === currentValue;
    const reasonError = reason.length < 10 || reason.length > 500;

    if (errCorrectionField) {
      errCorrectionField.textContent = isPending
        ? "A request is already pending for this detail."
        : "Select a read-only detail to correct.";
      errCorrectionField.classList.toggle("is-visible", fieldError);
    }
    if (errCorrectionMessage) {
      errCorrectionMessage.textContent = valueError
        ? "Enter a different requested value (1-200 characters)."
        : "";
      errCorrectionMessage.classList.toggle("is-visible", valueError);
    }
    if (errCorrectionReason) {
      errCorrectionReason.textContent = reasonError
        ? "Explain the reason in 10-500 characters."
        : "";
      errCorrectionReason.classList.toggle("is-visible", reasonError);
    }
    if (fieldError || valueError || reasonError) return;
    if (!auth?.currentUser?.uid || auth.currentUser.uid !== correctionUid) {
      if (correctionSubmitStatus) {
        correctionSubmitStatus.textContent = "Sign in again before submitting.";
        correctionSubmitStatus.classList.add("cr-is-error");
      }
      return;
    }

    correctionSubmitInFlight = true;
    updateCorrectionSubmitButton();
    if (correctionSubmitStatus) {
      correctionSubmitStatus.textContent = "";
      correctionSubmitStatus.classList.remove("cr-is-error");
    }

    try {
      const authUser = auth.currentUser;
      const profileName = [
        correctionProfileData?.firstName,
        correctionProfileData?.middleName,
        correctionProfileData?.lastName,
      ].filter(Boolean).join(" ");
      const requesterName = correctionProfileData?.fullName
        || correctionProfileData?.name
        || profileName
        || authUser.displayName
        || "Student";
      const requesterEmail = correctionProfileData?.email || authUser.email || "";
      await submitCorrectionRequest({
        field,
        currentValue,
        requestedValue,
        reason,
        requesterRole: "student",
        requesterName,
        requesterEmail,
        studentNumber: correctionProfileData?.studentNumber || correctionProfileData?.studentId || "",
      });
      correctionSubmitInFlight = false;
      updateCorrectionSubmitButton();
      closeCorrectionModalDialog();
      showFeedbackAlert("Correction request sent.");
    } catch (err) {
      if (correctionSubmitStatus) {
        correctionSubmitStatus.textContent = err?.code === "permission-denied"
          ? "You don't have permission to submit this request."
          : err?.message || "Couldn't send your request. Please try again.";
        correctionSubmitStatus.classList.add("cr-is-error");
      }
    } finally {
      correctionSubmitInFlight = false;
      updateCorrectionSubmitButton();
    }
  });

  /* ==========================================================================
     Real-Time Database Sync & Email Verification Sync
     ========================================================================== */
  if (isFirebaseConfigured && rtdb && user.uid) {
    const userRtdbRef = ref(rtdb, `users/${user.uid}`);
    const stopUserRealtimeSync = onValue(userRtdbRef, (snap) => {
      if (auth?.currentUser?.uid !== user.uid) return;
      const val = snap.val();
      if (val) {
        let changed = false;
        [
          "firstName", "middleName", "lastName", "contactNumber",
          "studentNo", "yearSection", "department", "organization", "email"
        ].forEach((k) => {
          const nextValue = k === "email" && auth.currentUser.emailVerified
            ? auth.currentUser.email
            : k === "organization"
              ? studentOrganization({ ...user, ...val }, user)
              : val[k];
          if (nextValue !== undefined && nextValue !== user[k]) {
            user[k] = nextValue;
            if (savedState[k] !== undefined && activeEditCard === null) {
              savedState[k] = nextValue;
            }
            changed = true;
          }
        });
        if (changed) {
          localStorage.setItem("recovibeCurrentUser", JSON.stringify(user));
          hydrateUserProfile();
        }
        if (val.preferences && Array.isArray(val.preferences.categories) && Array.isArray(val.preferences.sources)) {
          if (!isPreferencesEditing()) {
            preferences = {
              ...val.preferences,
              sources: normalizePreferredSources(val.preferences.sources),
            };
            user.preferences = preferences;
            localStorage.setItem(preferenceKey, JSON.stringify(preferences));
            localStorage.setItem(accountPreferenceKey, JSON.stringify(preferences));
            renderSummary("categorySummary", preferences.categories, "None chosen yet");
            renderSummary("sourceSummary", preferences.sources, "None chosen yet");
          }
        }
      }
    });
    window.addEventListener("pagehide", stopUserRealtimeSync, { once: true });
  }

  let pendingEmailSyncPromise = null;
  async function syncPendingVerifiedEmail(authUser) {
    if (!authUser?.uid) return;
    if (pendingEmailSyncPromise) return pendingEmailSyncPromise;
    pendingEmailSyncPromise = (async () => {
      try {
        const syncResult = await syncVerifiedStudentEmail(authUser);
        if (!syncResult || auth?.currentUser?.uid !== authUser.uid) return;
        user.email = syncResult.email;
        savedState.email = syncResult.email;
        if (syncResult.pendingEmail) {
          user.pendingEmail = syncResult.pendingEmail;
          savedState.pendingEmail = syncResult.pendingEmail;
        } else {
          delete user.pendingEmail;
          delete savedState.pendingEmail;
        }
        localStorage.setItem("recovibeCurrentUser", JSON.stringify(user));
        hydrateUserProfile();
        if (syncResult.changed) showFeedbackAlert("Email address verified and updated.");
      } catch (error) {
        console.warn("Could not sync verified student email:", error);
      } finally {
        pendingEmailSyncPromise = null;
      }
    })();
    return pendingEmailSyncPromise;
  }

  if (isFirebaseConfigured && auth) {
    onAuthStateChanged(auth, (authUser) => {
      if (authUser) void syncPendingVerifiedEmail(authUser);
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && auth.currentUser) {
        void syncPendingVerifiedEmail(auth.currentUser);
      }
    });
  }

  window.cancelActiveCardEdit = () => {
    if (isPreferencesEditing()) {
      cancelPreferencesBtn?.click();
      return true;
    }
    if (isNameEditing()) {
      nameCancelBtn?.click();
      return true;
    }
    if (isContactEditing()) {
      contactCancelBtn?.click();
      return true;
    }
    return false;
  };

  window.addEventListener("beforeunload", (event) => {
    if (
      (isNameEditing() && getNameDirtyCount() > 0) ||
      (isContactEditing() && getContactDirtyCount() > 0) ||
      (isPreferencesEditing() && getPreferencesDirtyCount() > 0)
    ) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  function openPasswordModal() {
    if (passwordUpdateSaving) return;
    if (passwordSuccessCloseTimer) {
      clearTimeout(passwordSuccessCloseTimer);
      passwordSuccessCloseTimer = null;
    }
    passwordForm.reset();
    resetPasswordVisibility();
    setPasswordStatus("");
    if (passwordFormModal) {
      passwordFormModal.hidden = false;
      passwordFormModal.style.display = "flex";
    }
    if (passwordForm) {
      passwordForm.hidden = false;
    }
    document.getElementById("currentPassword")?.focus();
  }
  window.openPasswordModal = openPasswordModal;

  function closePasswordModal() {
    if (passwordUpdateSaving) return;
    if (passwordSuccessCloseTimer) {
      clearTimeout(passwordSuccessCloseTimer);
      passwordSuccessCloseTimer = null;
    }
    if (passwordFormModal) {
      passwordFormModal.hidden = true;
      passwordFormModal.style.display = "none";
    }
    if (passwordForm) {
      passwordForm.hidden = true;
      passwordForm.reset();
    }
    resetPasswordVisibility();
    setPasswordStatus("");
  }
  window.closePasswordModal = closePasswordModal;

  document.getElementById("changePassword")?.addEventListener("click", openPasswordModal);
  cancelPasswordChangeBtn?.addEventListener("click", closePasswordModal);
  passwordCloseBtn?.addEventListener("click", closePasswordModal);
  passwordFormModal?.addEventListener("click", (event) => {
    if (event.target === passwordFormModal) {
      closePasswordModal();
    }
  });

  passwordForm?.querySelectorAll("[data-password-toggle]").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const input = document.getElementById(toggle.dataset.passwordToggle);
      if (!input) return;
      const isVisible = input.type === "password";
      input.type = isVisible ? "text" : "password";
      const label = toggle.dataset.passwordLabel || "password";
      toggle.setAttribute("aria-pressed", String(isVisible));
      toggle.setAttribute("aria-label", `${isVisible ? "Hide" : "Show"} ${label}`);
      toggle.title = `${isVisible ? "Hide" : "Show"} ${label}`;
    });
  });

  passwordForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (passwordUpdateInProgress) return;
    setPasswordStatus("");
    const current = document.getElementById("currentPassword").value;
    const next = document.getElementById("newPassword").value;
    const confirmation = document.getElementById("confirmPassword").value;
    if (!current.length) {
      setPasswordStatus("Enter your current password.", true);
      return;
    }
    if (!next.length) {
      setPasswordStatus("Enter a new password.", true);
      return;
    }
    if (!confirmation.length) {
      setPasswordStatus("Confirm your new password.", true);
      return;
    }
    if (
      next.length < 8 ||
      next.length > 64 ||
      /\s/.test(next) ||
      !/[A-Z]/.test(next) ||
      !/[a-z]/.test(next) ||
      !/\d/.test(next) ||
      !/[^\p{L}\p{N}\s]/u.test(next)
    ) {
      setPasswordStatus(
        "Use 8–64 characters with uppercase, lowercase, a number, and a special character, without spaces.",
        true,
      );
      return;
    }
    if (next === current) {
      setPasswordStatus("The new password must be different from the current password.", true);
      return;
    }
    if (next !== confirmation) {
      setPasswordStatus("The new passwords do not match.", true);
      return;
    }

    passwordUpdateInProgress = true;
    if (passwordUpdateSubmitBtn) passwordUpdateSubmitBtn.disabled = true;
    try {
      const confirmed = await showConfirmation({
        title: "Change Password?",
        message: "Are you sure you want to change your account password? You will need your new password for future sign-ins.",
        confirmText: "Update Password",
        cancelText: "Cancel",
        isDanger: false,
      });
      if (!confirmed || passwordFormModal?.hidden) return;

      setPasswordSaving(true);
      await authReady;
      const signedInUser = auth?.currentUser;
      if (!signedInUser) {
        throw new Error("Your session has expired. Sign in again before changing your password.");
      }
      if (!signedInUser.email) {
        throw new Error("This account does not have a sign-in email.");
      }
      if (!signedInUser.providerData?.some(
        (provider) => provider.providerId === EmailAuthProvider.PROVIDER_ID,
      )) {
        throw new Error("This account does not use email and password sign-in.");
      }
      await reauthenticateWithCredential(
        signedInUser,
        EmailAuthProvider.credential(signedInUser.email, current),
      );
      if (auth?.currentUser?.uid !== signedInUser.uid) {
        throw new Error("Your account changed during this request. Sign in again and retry.");
      }
      await updatePassword(signedInUser, next);
      passwordForm.reset();
      resetPasswordVisibility();
      setPasswordStatus("Password changed successfully.");
      showToast("Password updated successfully.");
      passwordSuccessCloseTimer = window.setTimeout(() => {
        passwordSuccessCloseTimer = null;
        closePasswordModal();
      }, 1200);
    } catch (error) {
      console.error("Student password update failed:", error);
      const message = passwordUpdateErrorMessage(error);
      setPasswordStatus(message, true);
      showToast(message, true);
    } finally {
      passwordUpdateInProgress = false;
      setPasswordSaving(false);
    }
  });
  setText("heroUserName", storedName || firstName);
  hydrateUserProfile();

  const sidebar = document.getElementById("sidebar");
  try {
    localStorage.removeItem("sidebarCollapsed");
  } catch {}
  if (sidebar) {
    sidebar.classList.remove("is-collapsed");
    requestAnimationFrame(() => sidebar.classList.add("is-ready"));
  }
  const logoutBtn = document.querySelector(".logout");
  if (logoutBtn && !logoutBtn.dataset.wired) {
    logoutBtn.dataset.wired = "true";
    logoutBtn.addEventListener("click", async (event) => {
      event.preventDefault();
      const confirmedByLogoutDialog = logoutBtn.dataset.rvLogoutConfirmed === "true";
      delete logoutBtn.dataset.rvLogoutConfirmed;
      const confirmed = confirmedByLogoutDialog || await showConfirmation({
        title: "Log Out?",
        message: "Are you sure you want to log out of your RecoVibe account?",
        confirmText: "Log Out",
        cancelText: "Cancel",
        isDanger: true,
      });
      if (!confirmed) return;

      try {
        if (auth) {
          if (auth.currentUser) {
            await syncPendingVerifiedEmail(auth.currentUser);
          }
          const { signOut } = await import(
            "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"
          );
          await signOut(auth);
        }
      } catch (e) {
        console.warn("Sign out error", e);
      }
      localStorage.removeItem("recovibeCurrentUser");
      sessionStorage.removeItem("recovibeCurrentUser");
      window.location.href = "StudentLogin.html";
    });
  }

  /* ==========================================================================
     4. Preferences Card Controller (Inline Editor)
     ========================================================================== */
  const CATEGORY_GROUPS = {
    "Learning and career": [
      "Academic & Learning",
      "Tech & Innovation",
      "Seminars & Workshops",
      "Leadership & Career",
    ],
    "Campus life": [
      "Orgs & Student Acts",
      "Social Events",
      "University & Campuses",
      "Community & Outreach",
    ],
    "Arts, sports, and fun": [
      "Music & Entertainment",
      "Arts & Culture",
      "Sports & Fitness",
      "Competitions",
    ],
  };

  const SOURCE_DESCRIPTIONS = {
    "PUP Official": "University offices and campuses",
    "Teacher / Faculty": "Events from your instructors",
    "Organizational": "Student organizations, including student councils",
    "Others / External": "Partners and outside organizers",
  };

  const CHECK_ICON_SVG = `<svg class="chip-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-6"/></svg>`;
  const PLUS_ICON_SVG = `<svg class="chip-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>`;

  function updateChipElement(btn, isSelected) {
    btn.setAttribute("aria-pressed", String(isSelected));
    btn.classList.toggle("is-selected", isSelected);
    btn.innerHTML = `${isSelected ? CHECK_ICON_SVG : PLUS_ICON_SVG}<span>${btn.dataset.category}</span>`;
  }

  function updatePreferencesDirtyUI() {
    const catCount = currentEditCategories.size;
    const srcCount = currentEditSources.size;

    // 1. Live Counters
    if (categoryCountBadge) {
      categoryCountBadge.textContent = `- ${catCount} of ${categories.length} selected`;
    }
    if (sourceCountBadge) {
      sourceCountBadge.textContent = `- ${srcCount} of ${sources.length} on`;
    }

    // 2. Validation
    const hasValidCats = catCount >= 1;
    const hasValidSrcs = srcCount >= 1;

    if (errCategories) {
      errCategories.classList.toggle("is-visible", !hasValidCats);
    }
    if (errSources) {
      errSources.classList.toggle("is-visible", !hasValidSrcs);
    }

    // 3. Dynamic Summary Line
    if (prefSummaryText) {
      if (!hasValidCats || !hasValidSrcs) {
        prefSummaryText.textContent = "Choose at least one category and one source to get recommendations.";
        prefSummaryText.classList.add("is-warning");
      } else {
        const catWord = catCount === 1 ? "category" : "categories";
        const srcWord = srcCount === 1 ? "source" : "sources";
        prefSummaryText.textContent = `You will see ${catCount} ${catWord} of events from ${srcCount} ${srcWord}.`;
        prefSummaryText.classList.remove("is-warning");
      }
    }

    // 4. Footer Unsaved Count & Save Button
    const dirtyCount = getPreferencesDirtyCount();
    if (preferencesUnsavedCount) {
      if (dirtyCount === 0) {
        preferencesUnsavedCount.textContent = "No changes yet";
        preferencesUnsavedCount.classList.remove("is-dirty");
      } else {
        preferencesUnsavedCount.textContent = `${dirtyCount} unsaved ${dirtyCount === 1 ? "change" : "changes"}`;
        preferencesUnsavedCount.classList.add("is-dirty");
      }
    }

    if (savePreferencesBtn) {
      savePreferencesBtn.disabled = !(dirtyCount > 0 && hasValidCats && hasValidSrcs);
    }
  }

  function renderCategoryGroup(container, catList) {
    if (!container) return;
    container.replaceChildren();
    catList.forEach((cat) => {
      const isSelected = currentEditCategories.has(cat);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `btn-pref-chip${isSelected ? " is-selected" : ""}`;
      btn.dataset.category = cat;
      btn.setAttribute("aria-pressed", String(isSelected));
      btn.innerHTML = `${isSelected ? CHECK_ICON_SVG : PLUS_ICON_SVG}<span>${cat}</span>`;

      const toggleChip = () => {
        const nextState = !currentEditCategories.has(cat);
        if (nextState) {
          currentEditCategories.add(cat);
        } else {
          currentEditCategories.delete(cat);
        }
        updateChipElement(btn, nextState);
        updatePreferencesDirtyUI();
      };

      btn.addEventListener("click", toggleChip);
      btn.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggleChip();
        }
      });
      container.append(btn);
    });
  }

  function renderCategoryChips() {
    renderCategoryGroup(groupLearningCareer, CATEGORY_GROUPS["Learning and career"]);
    renderCategoryGroup(groupCampusLife, CATEGORY_GROUPS["Campus life"]);
    renderCategoryGroup(groupArtsSportsFun, CATEGORY_GROUPS["Arts, sports, and fun"]);
  }

  function renderSourceRows() {
    if (!prefSourcesList) return;
    prefSourcesList.replaceChildren();

    sources.forEach((src) => {
      const isOn = currentEditSources.has(src);
      const desc = SOURCE_DESCRIPTIONS[src] || "";

      const row = document.createElement("div");
      row.className = "pref-source-row";
      row.tabIndex = 0;
      row.dataset.source = src;
      row.setAttribute("role", "button");
      row.setAttribute("aria-pressed", String(isOn));

      const info = document.createElement("div");
      info.className = "pref-source-info";

      const nameEl = document.createElement("span");
      nameEl.className = "pref-source-name";
      nameEl.textContent = src;

      const descEl = document.createElement("span");
      descEl.className = "pref-source-desc";
      descEl.textContent = desc;

      info.append(nameEl, descEl);

      const label = document.createElement("label");
      label.className = "pref-switch";

      const input = document.createElement("input");
      input.type = "checkbox";
      input.className = "pref-switch-input";
      input.setAttribute("role", "switch");
      input.setAttribute("aria-label", `Toggle ${src}`);
      input.checked = isOn;

      const slider = document.createElement("span");
      slider.className = "pref-switch-slider";

      label.append(input, slider);
      row.append(info, label);

      const toggleSource = (forcedValue) => {
        const nextVal = typeof forcedValue === "boolean" ? forcedValue : !input.checked;
        input.checked = nextVal;
        if (nextVal) {
          currentEditSources.add(src);
        } else {
          currentEditSources.delete(src);
        }
        row.setAttribute("aria-pressed", String(nextVal));
        updatePreferencesDirtyUI();
      };

      row.addEventListener("click", (e) => {
        if (e.target === input) return;
        e.preventDefault();
        toggleSource();
      });

      row.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggleSource();
        }
      });

      input.addEventListener("change", (e) => {
        e.stopPropagation();
        toggleSource(input.checked);
      });

      prefSourcesList.append(row);
    });
  }

  // Quick Action Buttons
  btnSelectAllCategories?.addEventListener("click", () => {
    categories.forEach((cat) => currentEditCategories.add(cat));
    [groupLearningCareer, groupCampusLife, groupArtsSportsFun].forEach((group) => {
      if (!group) return;
      group.querySelectorAll(".btn-pref-chip").forEach((btn) => {
        updateChipElement(btn, true);
      });
    });
    updatePreferencesDirtyUI();
  });

  btnClearAllCategories?.addEventListener("click", () => {
    currentEditCategories.clear();
    [groupLearningCareer, groupCampusLife, groupArtsSportsFun].forEach((group) => {
      if (!group) return;
      group.querySelectorAll(".btn-pref-chip").forEach((btn) => {
        updateChipElement(btn, false);
      });
    });
    updatePreferencesDirtyUI();
  });

  btnTurnAllSourcesOn?.addEventListener("click", () => {
    sources.forEach((src) => currentEditSources.add(src));
    if (prefSourcesList) {
      prefSourcesList.querySelectorAll(".pref-source-row").forEach((row) => {
        row.setAttribute("aria-pressed", "true");
        const chk = row.querySelector(".pref-switch-input");
        if (chk) chk.checked = true;
      });
    }
    updatePreferencesDirtyUI();
  });

  function openPreferencesEdit() {
    if (isNameEditing()) {
      if (getNameDirtyCount() > 0) {
        showFeedbackAlert("Save or cancel your changes to Name before editing Preferences.", true);
        return;
      }
      closeNameEdit(true);
    }
    if (isContactEditing()) {
      if (getContactDirtyCount() > 0) {
        showFeedbackAlert("Save or cancel your changes to Contact before editing Preferences.", true);
        return;
      }
      closeContactEdit(true);
    }

    currentEditCategories = new Set(preferences.categories || []);
    currentEditSources = new Set(preferences.sources || []);

    renderCategoryChips();
    renderSourceRows();
    updatePreferencesDirtyUI();

    preferencesCardView.hidden = true;
    preferencesCardEdit.hidden = false;
    activeEditCard = "preferences";
  }
  window.openPreferencesEditor = openPreferencesEdit;

  function closePreferencesEdit(force = false) {
    preferencesCardEdit.hidden = true;
    preferencesCardView.hidden = false;
    if (activeEditCard === "preferences") activeEditCard = null;
  }
  window.closePreferencesEditor = closePreferencesEdit;

  async function cancelPreferencesEdit() {
    const count = getPreferencesDirtyCount();
    if (count > 0) {
      const discard = await showConfirmation({
        title: "Discard changes?",
        message: `Discard your ${count} unsaved ${count === 1 ? "change" : "changes"}?`,
        confirmText: "Discard",
        cancelText: "Keep editing",
        isDanger: true,
      });
      if (!discard) return;
    }
    closePreferencesEdit();
  }

  editPreferencesBtn?.addEventListener("click", openPreferencesEdit);
  cancelPreferencesBtn?.addEventListener("click", cancelPreferencesEdit);

  preferencesCardEdit?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (currentEditCategories.size === 0 || currentEditSources.size === 0) return;

    savePreferencesBtn.disabled = true;
    savePreferencesBtn.textContent = "Saving...";

    const newCategories = categories.filter((c) => currentEditCategories.has(c));
    const newSources = sources.filter((s) => currentEditSources.has(s));
    const newPreferences = {
      categories: newCategories,
      sources: newSources,
    };

    try {
      const preferenceWrites = [];
      if (isFirebaseConfigured && rtdb && user.uid) {
        preferenceWrites.push(update(ref(rtdb, `users/${user.uid}/preferences`), newPreferences));
      }
      if (isFirebaseConfigured && db && user.uid) {
        preferenceWrites.push(updateDoc(doc(db, "users", user.uid), { preferences: newPreferences }));
      }
      await Promise.all(preferenceWrites);

      preferences = newPreferences;
      user.preferences = newPreferences;
      localStorage.setItem(preferenceKey, JSON.stringify(newPreferences));
      localStorage.setItem(accountPreferenceKey, JSON.stringify(newPreferences));
      localStorage.setItem("recovibeCurrentUser", JSON.stringify(user));

      localStorage.setItem("recovibePreferencesUpdated", String(Date.now()));
      window.dispatchEvent(new CustomEvent("recovibe:preferences-updated", { detail: newPreferences }));
      try {
        const channel = new BroadcastChannel("recovibe_preferences");
        channel.postMessage({ type: "PREFERENCES_UPDATED", preferences: newPreferences, uid: user.uid });
        channel.close();
      } catch (err) {
        // BroadcastChannel unsupported or blocked
      }

      renderSummary("categorySummary", preferences.categories, "None chosen yet");
      renderSummary("sourceSummary", preferences.sources, "None chosen yet");

      closePreferencesEdit();
      showFeedbackAlert("Preferences saved. Your recommendations will update.");
    } catch (err) {
      console.error("Failed to save preferences:", err);
      showFeedbackAlert(err.message || "Could not save preferences.", true);
    } finally {
      savePreferencesBtn.disabled = false;
      savePreferencesBtn.textContent = "Save preferences";
      updatePreferencesDirtyUI();
    }
  });
})();

/* ==========================================================================
   Student QR Attendance: Card Component, Full-Screen Modal & renderMyQr
   ========================================================================== */

function getStudentQrData(profile = {}, authUser = auth?.currentUser) {
  const registration = profile.registration && typeof profile.registration === "object"
    ? profile.registration
    : {};
  const studentNumberCandidates = [
    profile.studentNumber,
    profile.studentNo,
    profile.studentId,
    registration.studentNumber,
    registration.studentNo,
    registration.studentId,
  ]
    .map(normalizeStudentNumber)
    .filter(Boolean);
  const studentNumber = studentNumberCandidates[0] || "";
  const qrUser = authUser?.uid
    ? { uid: authUser.uid, email: authUser.email || profile.email || "" }
    : null;
  const payload = createAttendanceQrPayload({
    user: qrUser,
    registrationStatus: "profile",
  });

  const organization = studentOrganization(profile);
  const storedName = String(profile.name || profile.fullName || "").trim();
  const fullName = storedName || [
    profile.firstName,
    profile.middleName,
    profile.lastName,
  ].map((part) => String(part || "").trim()).filter(Boolean).join(" ");

  return { payload, studentNumber, organization, fullName };
}

function formatScannedTime(scannedAt) {
  if (!scannedAt) return "Checked in";
  const date = new Date(typeof scannedAt === "number" ? scannedAt : String(scannedAt));
  if (Number.isNaN(date.getTime())) return "Checked in";
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const isToday = new Date().toDateString() === date.toDateString();
  return isToday
    ? `Today at ${timeStr}`
    : `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${timeStr}`;
}

function downloadCanvasAsPng(canvas, filename = "student-qr-code.png") {
  if (!canvas) return false;
  try {
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch (err) {
    console.error("Failed to download QR code image", err);
    return false;
  }
}

function renderMyQr(canvas, options = {}) {
  if (!canvas) return () => {};

  const payload = String(options.payload || "").trim();
  const width = options.width || 720;
  const displayWidth = options.displayWidth || 180;
  const skeleton = options.skeletonEl;
  const canvasBox = options.canvasBoxEl || canvas.parentElement;
  const errorBox = options.errorEl;
  const errorMessage = options.errorMessageEl;
  const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : null;
  let active = true;

  function setUIState(state, message = "Couldn't load your QR code") {
    if (skeleton) {
      skeleton.hidden = state !== "loading";
      skeleton.style.display = state === "loading" ? "flex" : "none";
    }
    if (canvasBox) {
      canvasBox.hidden = state !== "ready";
      canvasBox.style.display = state === "ready" ? "flex" : "none";
    }
    if (errorBox) {
      errorBox.hidden = state !== "error";
      errorBox.style.display = state === "error" ? "flex" : "none";
    }
    if (errorMessage) errorMessage.textContent = message;
    if (onStateChange) onStateChange(state);
  }

  async function loadAndRender() {
    if (!active) return;
    setUIState("loading");

    try {
      if (!canvas.getContext("2d")) {
        throw new Error("Your QR code could not be displayed. Please try again.");
      }
      await renderAttendanceQr(canvas, payload, {
        width,
        displayWidth,
      });
      if (!active) return;

      if (active) setUIState("ready");
    } catch (err) {
      if (!active) return;
      console.error("Could not render the student QR code:", err);
      setUIState("error", err.message || "Couldn't load your QR code. Please try again.");
    }
  }

  loadAndRender();

  return function cleanup() {
    active = false;
  };
}

// Initialize QR Attendance Card and Modal on the Profile Page
(() => {
  const card = document.getElementById("studentQrCard");
  if (!card) return;

  // QR Card Elements
  const canvas = document.getElementById("studentQrCanvas");
  const qrCardFrame = document.getElementById("qrCardFrameWrapper");
  const skeleton = document.getElementById("qrCardSkeleton");
  const canvasBox = document.getElementById("qrCardCanvasBox");
  const errorBox = document.getElementById("qrCardError");
  const errorMessage = document.getElementById("qrCardErrorMessage");
  const retryBtn = document.getElementById("qrCardRetryBtn");
  const nameEl = document.getElementById("qrCardStudentName");
  const numberEl = document.getElementById("qrCardStudentNumber");
  const orgEl = document.getElementById("qrCardStudentOrg");
  const showFullBtn = document.getElementById("btnShowFullScreenQr");
  const refreshBtn = document.getElementById("btnRefreshQrCode");
  const downloadBtn = document.getElementById("btnDownloadQrCard");
  const checkedInBadge = document.getElementById("qrCardStatusBadge");
  const checkedInBanner = document.getElementById("qrCheckedInBanner");
  const checkedInEventName = document.getElementById("qrCheckedInEventName");
  const checkedInTime = document.getElementById("qrCheckedInTime");
  const refreshFeedback = document.getElementById("qrCardRefreshFeedback");
  const checkedInUnsubscribers = [];

  // Full-screen Modal Elements
  const modalOverlay = document.getElementById("qrModalOverlay");
  const modalCloseBtn = document.getElementById("qrModalCloseBtn");
  const modalCloseActionBtn = document.getElementById("qrModalCloseActionBtn");
  const modalBackdrop = document.getElementById("qrModalBackdrop");
  const modalCanvas = document.getElementById("qrModalCanvas");
  const modalSkeleton = document.getElementById("qrModalSkeleton");
  const modalCanvasBox = document.getElementById("qrModalCanvasBox");
  const modalError = document.getElementById("qrModalError");
  const modalErrorMessage = document.getElementById("qrModalErrorMessage");
  const modalRetryBtn = document.getElementById("qrModalRetryBtn");
  const modalStudentName = document.getElementById("qrModalStudentName");
  const modalEventName = document.getElementById("qrModalEventName");
  const modalRefreshBtn = document.getElementById("qrModalRefreshBtn");
  const modalDownloadBtn = document.getElementById("qrModalDownloadBtn");

  // Ensure modal is strictly hidden on initial page load
  if (modalOverlay) {
    modalOverlay.hidden = true;
    modalOverlay.style.display = "none";
    modalOverlay.setAttribute("aria-hidden", "true");
  }

  // Initial state: hide checked-in tags until confirmed by Realtime Database
  if (checkedInBadge) checkedInBadge.hidden = true;
  if (checkedInBanner) checkedInBanner.hidden = true;

  let currentStudentNumber = "";
  let currentStudentName = "";
  let currentQrPayload = "";
  let cardQrReady = false;
  let modalQrReady = false;
  let qrRefreshInProgress = false;
  let qrRefreshFeedbackTimer = null;

  function setCardQrActionsEnabled(canDownload, canRefresh = canDownload) {
    if (downloadBtn) downloadBtn.disabled = !canDownload;
    if (refreshBtn) refreshBtn.disabled = !canRefresh;
  }

  function setModalQrActionsEnabled(canDownload, canRefresh = canDownload) {
    if (modalDownloadBtn) modalDownloadBtn.disabled = !canDownload;
    if (modalRefreshBtn) modalRefreshBtn.disabled = !canRefresh;
  }

  function updateStudentCardInfo(userObj) {
    const user = userObj || {};
    const qrData = getStudentQrData(user);
    currentStudentName = qrData.fullName;
    currentStudentNumber = qrData.studentNumber;
    currentQrPayload = qrData.payload;

    if (nameEl) nameEl.textContent = currentStudentName;
    if (numberEl) numberEl.textContent = currentStudentNumber;
    if (orgEl) orgEl.textContent = qrData.organization;
    if (modalStudentName) modalStudentName.textContent = currentStudentName;
  }

  let cardQrCleanup = null;

  function initCardQr() {
    if (cardQrCleanup) {
      cardQrCleanup();
      cardQrCleanup = null;
    }
    if (!canvas) return;

    cardQrCleanup = renderMyQr(canvas, {
      studentNumber: currentStudentNumber,
      payload: currentQrPayload,
      width: 720,
      displayWidth: 180,
      skeletonEl: skeleton,
      canvasBoxEl: canvasBox,
      errorEl: errorBox,
      errorMessageEl: errorMessage,
      onStateChange: (state) => {
        cardQrReady = state === "ready";
        setCardQrActionsEnabled(cardQrReady, state !== "loading");
      },
    });
  }

  function setQrRefreshFeedback(message, isError = false) {
    if (!refreshFeedback) return;
    if (qrRefreshFeedbackTimer) {
      clearTimeout(qrRefreshFeedbackTimer);
      qrRefreshFeedbackTimer = null;
    }
    refreshFeedback.textContent = message;
    refreshFeedback.hidden = !message;
    refreshFeedback.classList.toggle("is-error", isError);
    if (message && !isError) {
      qrRefreshFeedbackTimer = setTimeout(() => {
        refreshFeedback.hidden = true;
        qrRefreshFeedbackTimer = null;
      }, 4000);
    }
  }

  function setQrRefreshBusy(isBusy) {
    if (qrCardFrame) {
      qrCardFrame.classList.toggle("is-refreshing", isBusy);
      qrCardFrame.setAttribute("aria-busy", String(isBusy));
    }
    if (refreshBtn) {
      refreshBtn.disabled = isBusy;
      refreshBtn.classList.toggle("is-refreshing", isBusy);
      refreshBtn.setAttribute("aria-busy", String(isBusy));
      const label = document.getElementById("btnRefreshQrLabel");
      if (label) label.textContent = isBusy ? "Refreshing..." : "Refresh code";
    }
    if (modalRefreshBtn) {
      modalRefreshBtn.disabled = isBusy;
      modalRefreshBtn.classList.toggle("is-refreshing", isBusy);
      modalRefreshBtn.setAttribute("aria-busy", String(isBusy));
      const label = document.getElementById("qrModalRefreshLabel");
      if (label) label.textContent = isBusy ? "Refreshing..." : "Refresh code";
    }
    if (isBusy) {
      if (downloadBtn) downloadBtn.disabled = true;
      if (modalDownloadBtn) modalDownloadBtn.disabled = true;
    }
  }

  async function handleRefreshCode() {
    if (qrRefreshInProgress) return;
    const authUser = auth?.currentUser;
    if (!authUser?.uid) {
      setQrRefreshFeedback("Sign in again before refreshing your QR code.", true);
      return;
    }

    const hadExistingQr = cardQrReady;
    qrRefreshInProgress = true;
    setQrRefreshBusy(true);
    setQrRefreshFeedback("Updating your QR code...");
    try {
      const refreshedProfile = await loadStudentProfile(authUser);
      if (auth?.currentUser?.uid !== authUser.uid) {
        throw new Error("Your account changed. Sign in again before refreshing your QR code.");
      }
      const qrData = getStudentQrData(refreshedProfile, authUser);
      const visibleModal = modalOverlay && !modalOverlay.hidden && modalOverlay.style.display !== "none";
      const targets = [{ canvas, width: 720 }];
      if (visibleModal && modalCanvas) targets.push({ canvas: modalCanvas, width: 720 });
      if (targets.some((target) => !target.canvas || !target.canvas.getContext("2d"))) {
        throw new Error("The QR code display is unavailable. Please try again.");
      }

      const stagedCanvases = await Promise.all(
        targets.map((target) => createAttendanceQrCanvas(qrData.payload, target.width)),
      );
      if (auth?.currentUser?.uid !== authUser.uid) {
        throw new Error("Your account changed. Sign in again before refreshing your QR code.");
      }
      targets.forEach((target, index) => {
        const displayWidth = target.canvas === modalCanvas ? 260 : 180;
        commitAttendanceQrCanvas(target.canvas, stagedCanvases[index], displayWidth);
      });

      updateStudentCardInfo(refreshedProfile);
      cardQrReady = true;
      if (visibleModal) modalQrReady = true;
      setCardQrActionsEnabled(true);
      if (visibleModal) setModalQrActionsEnabled(true);
      setQrRefreshFeedback("Code refreshed.");
    } catch (err) {
      console.error("Could not refresh the student QR code:", err);
      setQrRefreshFeedback(
        hadExistingQr
          ? "Couldn't refresh your QR code. Your current code is still available. Please try again."
          : "Couldn't refresh your QR code. Please try again.",
        true,
      );
    } finally {
      qrRefreshInProgress = false;
      setQrRefreshBusy(false);
      const signedInUserIsCurrent = auth?.currentUser?.uid === profileAuthUid;
      setCardQrActionsEnabled(signedInUserIsCurrent && cardQrReady, signedInUserIsCurrent);
      setModalQrActionsEnabled(signedInUserIsCurrent && modalQrReady, signedInUserIsCurrent);
    }
  }

  function handleDownloadCode(targetCanvas, targetButton) {
    const downloadId = currentStudentNumber || auth?.currentUser?.uid || "";
    if (!currentQrPayload || !downloadId || targetButton?.disabled) {
      return;
    }
    const downloaded = downloadCanvasAsPng(
      targetCanvas,
      `recovibe-attendance-code-${downloadId.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`,
    );
    const toastFn = window.showToast || (typeof showToast === "function" ? showToast : null);
    if (toastFn) {
      toastFn(downloaded ? "QR code downloaded." : "Could not download your QR code. Please try again.", !downloaded);
    }
  }

  if (retryBtn) {
    retryBtn.addEventListener("click", (e) => {
      e.preventDefault();
      initCardQr();
    });
  }
  if (refreshBtn) {
    refreshBtn.addEventListener("click", (e) => {
      e.preventDefault();
      void handleRefreshCode();
    });
  }
  if (downloadBtn) {
    downloadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      handleDownloadCode(canvas, downloadBtn);
    });
  }

  function getAllKnownEventIds() {
    const ids = new Set(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    try {
      const parts = JSON.parse(localStorage.getItem("recovibeParticipations") || "[]");
      if (Array.isArray(parts)) parts.forEach((id) => ids.add(String(id)));
    } catch {}
    try {
      const orgEvents = JSON.parse(localStorage.getItem("recovibeOrganizerEvents") || "[]");
      if (Array.isArray(orgEvents)) {
        orgEvents.forEach((e) => {
          const id = e.id || e.eventId;
          if (id) ids.add(String(id));
        });
      }
    } catch {}
    try {
      const teacherEvents = JSON.parse(localStorage.getItem("recovibeTeacherEvents") || "[]");
      if (Array.isArray(teacherEvents)) {
        teacherEvents.forEach((e) => {
          const id = e.id || e.eventId;
          if (id) ids.add(String(id));
        });
      }
    } catch {}
    if (Array.isArray(window.RECOVIBE_EVENTS)) {
      window.RECOVIBE_EVENTS.forEach((e) => {
        const id = e.id || e.eventId;
        if (id) ids.add(String(id));
      });
    }
    return Array.from(ids);
  }

  function getEventTitle(eventId) {
    try {
      if (Array.isArray(window.RECOVIBE_EVENTS)) {
        const ev = window.RECOVIBE_EVENTS.find((e) => String(e.id || e.eventId) === String(eventId));
        if (ev && ev.title) return ev.title;
      }
      const orgEvents = JSON.parse(localStorage.getItem("recovibeOrganizerEvents") || "[]");
      const orgEv = (orgEvents || []).find((e) => String(e.id || e.eventId) === String(eventId));
      if (orgEv && orgEv.title) return orgEv.title;

      const teacherEvents = JSON.parse(localStorage.getItem("recovibeTeacherEvents") || "[]");
      const teachEv = (teacherEvents || []).find((e) => String(e.id || e.eventId) === String(eventId));
      if (teachEv && teachEv.title) return teachEv.title;
    } catch {}
    return `Event #${eventId}`;
  }

  // Real-time checked-in state check across events (Task 5)
  function stopCheckedInWatchers() {
    checkedInUnsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    if (checkedInBadge) checkedInBadge.hidden = true;
    if (checkedInBanner) checkedInBanner.hidden = true;
  }

  function setupCheckedInWatcher() {
    stopCheckedInWatchers();
    if (!rtdb) return;
    const uid = auth?.currentUser?.uid;
    if (!uid) return;

    const eventIds = getAllKnownEventIds();

    eventIds.forEach((eventId) => {
      const attendanceRef = ref(rtdb, `attendance/${eventId}/${uid}`);
      const unsubscribe = onValue(attendanceRef, (snapshot) => {
        const val = snapshot.val();
        if (val && val.scannedAt) {
          const title = getEventTitle(eventId);
          const formatted = formatScannedTime(val.scannedAt);

          if (checkedInBadge) checkedInBadge.hidden = false;
          if (checkedInBanner) checkedInBanner.hidden = false;
          if (checkedInEventName) checkedInEventName.textContent = title;
          if (checkedInTime) checkedInTime.textContent = formatted;
        }
      }, (err) => {
        console.warn(`Attendance watcher notice for ${eventId}:`, err);
      });
      checkedInUnsubscribers.push(unsubscribe);
    });
  }

  window.addEventListener("pagehide", stopCheckedInWatchers, { once: true });

  // Connect Firebase Auth to populate Profile and refresh QR
  let user = {};
  let profileAuthUid = "";
  let profileLoadRequestId = 0;
  let profileFeedbackTimer = null;

  function getCachedProfileForUser(uid) {
    for (const storage of [localStorage, sessionStorage]) {
      try {
        const cached = JSON.parse(storage.getItem("recovibeCurrentUser") || "null");
        if (cached && typeof cached === "object" && cached.uid === uid) {
          return cached;
        }
      } catch (error) {
        console.warn("Could not read the cached student profile:", error);
      }
    }
    return {};
  }

  function setProfileText(id, value, fallback = "Not provided") {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value || "").trim() || fallback;
  }

  function clearProfileLoadFeedback() {
    const alertEl = document.getElementById("profileFeedbackAlert");
    const retryButton = document.getElementById("btnRetryProfileFetch");
    if (alertEl) alertEl.hidden = true;
    if (retryButton) retryButton.hidden = true;
    if (profileFeedbackTimer) clearTimeout(profileFeedbackTimer);
    profileFeedbackTimer = null;
  }

  function showProfileLoadFeedback(message) {
    const alertEl = document.getElementById("profileFeedbackAlert");
    const textEl = document.getElementById("profileFeedbackText");
    const retryButton = document.getElementById("btnRetryProfileFetch");
    if (!alertEl || !textEl) {
      console.warn("Profile load status:", message);
      return;
    }
    textEl.textContent = message;
    alertEl.classList.add("error");
    alertEl.hidden = false;
    if (retryButton) retryButton.hidden = false;
    if (profileFeedbackTimer) clearTimeout(profileFeedbackTimer);
    profileFeedbackTimer = null;
  }

  function renderStudentProfileData(profile) {
    const fullName = String(
      profile.fullName ||
        profile.name ||
        [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" "),
    ).trim();
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName = String(profile.firstName || nameParts[0] || "").trim();
    const middleName = String(
      profile.middleName || (nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : ""),
    ).trim();
    const lastName = String(
      profile.lastName || (nameParts.length > 1 ? nameParts.at(-1) : ""),
    ).trim();
    const studentNumber = normalizeStudentNumber(
      profile.studentNumber || profile.studentNo || profile.studentId,
    );
    const department = profile.department || profile.program || profile.course;
    const yearSection = profile.yearSection || profile.year;
    const contact = profile.contactNumber || profile.contact;
    const organization = studentOrganization(profile);

    setProfileText("profileFirstName", firstName);
    setProfileText("profileMiddleName", middleName);
    setProfileText("profileLastName", lastName);
    setProfileText("profileStudentId", studentNumber);
    setProfileText("profileEmail", profile.email);
    setProfileText("profileContact", contact);
    setProfileText("profileDepartment", department);
    setProfileText("profileYear", yearSection);
    setProfileText("profileOrganization", organization);
    setProfileText("viewFirstName", firstName);
    setProfileText("viewLastName", lastName);
    setProfileText("viewEmail", profile.email);
    setProfileText("viewContact", formatPhilippinePhone(contact));
    setProfileText("viewStudentNumber", studentNumber);
    setProfileText("viewYearSection", yearSection);
    setProfileText("viewDepartment", department);
    setProfileText("viewOrganization", organization);

    const middleNameView = document.getElementById("viewMiddleName");
    if (middleNameView) {
      if (middleName) {
        middleNameView.textContent = middleName;
      } else {
        middleNameView.innerHTML = '<span class="empty-muted">Not set</span>';
      }
    }

    if (fullName) setProfileText("heroUserName", fullName);
    renderStudentSidebar(profile);
    updateStudentCardInfo(profile);
  }

  async function loadAuthenticatedStudentProfile(authUser) {
    const requestId = ++profileLoadRequestId;
    stopCheckedInWatchers();
    if (!authUser) {
      window.dispatchEvent(new Event("student-correction-signed-out"));
      profileAuthUid = "";
      currentStudentNumber = "";
      currentStudentName = "";
      currentQrPayload = "";
      cardQrReady = false;
      modalQrReady = false;
      setCardQrActionsEnabled(false);
      setModalQrActionsEnabled(false);
      clearCachedStudentProfile();
      window.location.replace("StudentLogin.html");
      return;
    }
    profileAuthUid = authUser.uid;
    const profileMain = document.getElementById("profileMain");
    const cachedProfile = user.uid === authUser.uid
      ? user
      : getCachedProfileForUser(authUser.uid);
    const cachedName = String(
      cachedProfile.fullName ||
        cachedProfile.name ||
        [cachedProfile.firstName, cachedProfile.middleName, cachedProfile.lastName]
          .filter(Boolean)
          .join(" "),
    ).trim();
    const fallbackName = cachedName || String(authUser.displayName || "").trim();
    const fallbackNameParts = fallbackName.split(/\s+/).filter(Boolean);
    const fallbackProfile = {
      ...cachedProfile,
      uid: authUser.uid,
      email: cachedProfile.email || authUser.email || "",
      organization: studentOrganization(cachedProfile),
      fullName: fallbackName,
      name: fallbackName,
      firstName: cachedProfile.firstName || fallbackNameParts[0] || "",
      middleName: cachedProfile.middleName ||
        (fallbackNameParts.length > 2 ? fallbackNameParts.slice(1, -1).join(" ") : ""),
      lastName: cachedProfile.lastName ||
        (fallbackNameParts.length > 1 ? fallbackNameParts.at(-1) : ""),
    };
    user = { ...fallbackProfile };
    renderStudentProfileData(fallbackProfile);
    clearProfileLoadFeedback();
    profileMain?.removeAttribute("hidden");
    window.dispatchEvent(new Event("page-data-ready"));
    const profileLoadWarningTimer = setTimeout(() => {
      if (requestId === profileLoadRequestId) {
        showProfileLoadFeedback(
          "Showing available profile details while the latest profile data loads.",
        );
      }
    }, 8000);
    if (!db) {
      clearTimeout(profileLoadWarningTimer);
      window.dispatchEvent(new Event("student-correction-unavailable"));
      showProfileLoadFeedback("Showing available profile details. The profile service is unavailable.");
      return;
    }

    try {
      const profileData = await loadStudentProfile(authUser);
      if (
        requestId !== profileLoadRequestId ||
        auth.currentUser?.uid !== profileAuthUid
      ) return;
      clearTimeout(profileLoadWarningTimer);
      const merged = {
        ...profileData,
        uid: authUser.uid,
        email: profileData.email || authUser.email || "",
        organization: studentOrganization(profileData, user),
        studentNumber: normalizeStudentNumber(profileData.studentNumber || profileData.studentId),
        studentId: normalizeStudentNumber(profileData.studentNumber || profileData.studentId),
        StudentOrgs: uniqueProfileValues(
          profileData.StudentOrgs,
          profileData.studentOrgs,
          profileData.organizations,
          profileData.organization,
          profileData.courseOrganization,
          profileData.courseOrg,
        ),
        departments: uniqueProfileValues(
          profileData.departments,
          profileData.departmentCodes,
          profileData.department,
          profileData.departmentCode,
          profileData.course,
          profileData.program,
        ),
      };
      user = { ...user, ...merged };
      hydrateUserProfile();
      clearProfileLoadFeedback();
      renderStudentProfileData(merged);
      window.dispatchEvent(new CustomEvent("student-correction-profile-ready", {
        detail: { uid: authUser.uid, profile: merged },
      }));
      profileMain?.removeAttribute("hidden");
      window.dispatchEvent(new Event("page-data-ready"));
      initCardQr();
      setupCheckedInWatcher();
    } catch (err) {
      if (requestId !== profileLoadRequestId) return;
      clearTimeout(profileLoadWarningTimer);
      console.error("Could not load the signed-in student profile:", err);
      showProfileLoadFeedback("Showing available profile details. The latest profile could not be loaded.");
      window.dispatchEvent(new Event("student-correction-unavailable"));
    }
  }

  onAuthStateChanged(auth, (authUser) => {
    loadAuthenticatedStudentProfile(authUser);
  });
  window.addEventListener("page-data-retry", () => {
    const authUser = auth?.currentUser;
    if (authUser) loadAuthenticatedStudentProfile(authUser);
  });
  document.getElementById("btnRetryProfileFetch")?.addEventListener("click", () => {
    const authUser = auth?.currentUser;
    if (authUser) loadAuthenticatedStudentProfile(authUser);
  });

  // Modal Component Setup (Task 2)
  let modalQrCleanup = null;
  let previousFocusedElement = null;

  function openModal(eventName = "") {
    if (!modalOverlay) return;
    previousFocusedElement = document.activeElement;

    if (modalStudentName) modalStudentName.textContent = currentStudentName;
    if (modalEventName) {
      if (eventName) {
        modalEventName.textContent = eventName;
        modalEventName.hidden = false;
        modalEventName.style.display = "block";
      } else {
        modalEventName.hidden = true;
        modalEventName.style.display = "none";
      }
    }

    modalOverlay.hidden = false;
    modalOverlay.style.display = "flex";
    modalOverlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    initModalQr();

    if (modalCloseBtn) modalCloseBtn.focus();
  }

  function closeModal() {
    if (!modalOverlay || (modalOverlay.hidden && modalOverlay.style.display === "none")) return;
    modalOverlay.hidden = true;
    modalOverlay.style.display = "none";
    modalOverlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";

    if (modalQrCleanup) {
      modalQrCleanup();
      modalQrCleanup = null;
    }

    if (previousFocusedElement && typeof previousFocusedElement.focus === "function") {
      previousFocusedElement.focus();
    }
  }

  function initModalQr() {
    if (modalQrCleanup) {
      modalQrCleanup();
      modalQrCleanup = null;
    }
    if (!modalCanvas) return;

    modalQrCleanup = renderMyQr(modalCanvas, {
      studentNumber: currentStudentNumber,
      payload: currentQrPayload,
      width: 720,
      displayWidth: 260,
      skeletonEl: modalSkeleton,
      canvasBoxEl: modalCanvasBox,
      errorEl: modalError,
      errorMessageEl: modalErrorMessage,
      onStateChange: (state) => {
        modalQrReady = state === "ready";
        setModalQrActionsEnabled(modalQrReady, state !== "loading");
      },
    });
  }

  if (showFullBtn) {
    showFullBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openModal();
    });
  }
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    });
  }
  if (modalCloseActionBtn) {
    modalCloseActionBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    });
  }
  if (modalBackdrop) {
    modalBackdrop.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
    });
  }
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) {
        e.preventDefault();
        closeModal();
      }
    });
  }
  if (modalRetryBtn) {
    modalRetryBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      initModalQr();
    });
  }
  if (modalRefreshBtn) {
    modalRefreshBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void handleRefreshCode();
    });
  }
  if (modalDownloadBtn) {
    modalDownloadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleDownloadCode(modalCanvas, modalDownloadBtn);
    });
  }

  // Close on Escape and manage Accessible Focus Trap
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const confirmOverlay = document.getElementById("confirmModalOverlay");
      if (confirmOverlay && !confirmOverlay.hidden && confirmOverlay.style.display !== "none") {
        document.getElementById("confirmModalCancelBtn")?.click();
        return;
      }

      const correctionModal = document.getElementById("correctionModalOverlay");
      if (correctionModal && !correctionModal.hidden && correctionModal.style.display !== "none") {
        document.getElementById("btnCancelCorrection")?.click();
        return;
      }

      if (typeof window.cancelActiveCardEdit === "function" && window.cancelActiveCardEdit()) {
        return;
      }

      const passModal = document.getElementById("passwordFormModal");
      if (passModal && !passModal.hidden && passModal.style.display !== "none") {
        if (typeof window.closePasswordModal === "function") {
          window.closePasswordModal();
        } else {
          document.getElementById("cancelPasswordChange")?.click();
        }
        return;
      }

      if (modalOverlay && !modalOverlay.hidden && modalOverlay.style.display !== "none") {
        closeModal();
        return;
      }
    }

    if (!modalOverlay || modalOverlay.hidden || modalOverlay.style.display === "none") return;

    if (event.key === "Tab") {
      const focusable = modalOverlay.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const focusableElements = Array.from(focusable).filter((el) => !el.hidden && el.offsetParent !== null);
      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          event.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          event.preventDefault();
        }
      }
    }
  });
})();
