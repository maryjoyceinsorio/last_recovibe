import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, authReady, db, isFirebaseConfigured } from "./firebaseConfig.js";
import {
  clearCachedStudentProfile,
  loadStudentProfile,
  normalizeStudentNumber,
  studentNumberValidationMessage as validateStudentNumber,
} from "./studentIdentity.js";
import {
  clearPortalProfileCaches,
  maintenanceMessage,
  readSystemAccessSettings,
  resolvePortalRole,
  takeMaintenanceNotice,
  takePortalRoleNotice,
} from "../systemAccess.js";

const studentNumberInput = document.getElementById("student-number");
const passwordInput = document.getElementById("student-pass");
const submitButton = document.getElementById("login-submit");
const submitButtonLabel = submitButton.textContent.trim();
const rememberMe = document.getElementById("remember-me");
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const studentCollections = ["users", "students"];
const studentNumberFields = ["studentNumber", "student_number", "studentNo", "student_no", "studentId"];
let studentNumberValidationShown = false;
let passwordValidationShown = false;
let studentNumberPasteError = "";

function setInvalid(fieldId, invalid, message = "") {
  const field = document.getElementById(fieldId);
  field.classList.toggle("invalid", invalid);
  const error = field.querySelector(".error-msg");
  if (error) error.textContent = message;
}

function looksLikeEmailIdentifier(value) {
  return /[^0-9BN\s-]/i.test(String(value || "")) || String(value || "").includes("@");
}

function normalizeLoginIdentifier(value) {
  const identifier = String(value || "").trim();
  return looksLikeEmailIdentifier(identifier)
    ? identifier
    : normalizeStudentNumber(identifier);
}

function studentNumberValidationMessage(value) {
  const identifier = String(value || "").trim();
  if (!identifier) return "Student number or email is required.";
  if (looksLikeEmailIdentifier(identifier)) {
    return emailPattern.test(identifier) ? "" : "Enter a valid email address or student number.";
  }
  return validateStudentNumber(identifier);
}

function isStudentProfileRecord(snapshot, collectionName) {
  const data = snapshot.data();
  const role = String(data.role || data.userRole || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  return role === "student" || (collectionName === "students" && !role);
}

async function findStudentProfilesByNumber(studentNumber) {
  const lookups = studentCollections.flatMap((collectionName) =>
    studentNumberFields.map((field) => ({ collectionName, field })),
  );
  const results = await Promise.allSettled(lookups.map(({ collectionName, field }) =>
    getDocs(query(
      collection(db, collectionName),
      where(field, "==", studentNumber),
      limit(10),
    )),
  ));
  const profiles = new Map();
  const failures = [];
  let completedLookups = 0;
  results.forEach((result, index) => {
    const lookup = lookups[index];
    if (result.status === "rejected") {
      failures.push({
        collection: lookup.collectionName,
        field: lookup.field,
        code: result.reason?.code || "unknown",
      });
      return;
    }
    completedLookups += 1;
    result.value.docs.forEach((snapshot) => {
      if (!isStudentProfileRecord(snapshot, lookup.collectionName)) return;
      profiles.set(`${lookup.collectionName}/${snapshot.id}`, {
        collectionName: lookup.collectionName,
        snapshot,
        data: snapshot.data(),
      });
    });
  });
  if (failures.length) {
    console.warn("[StudentLogin] Some Student Number lookups failed.", {
      failedLookups: failures,
      completedLookups,
    });
  }
  return {
    profiles: [...profiles.values()],
    lookupUnavailable: failures.length > 0 && profiles.size === 0,
  };
}

async function findStudentProfilesByEmail(email) {
  const lookups = studentCollections.flatMap((collectionName) =>
    ["email", "pendingEmail"].map((field) => ({ collectionName, field })),
  );
  const results = await Promise.allSettled(lookups.map(({ collectionName, field }) =>
    getDocs(query(
      collection(db, collectionName),
      where(field, "==", email),
      limit(10),
    )),
  ));
  const profiles = new Map();
  results.forEach((result, index) => {
    const lookup = lookups[index];
    if (result.status === "rejected") {
      console.warn("[StudentLogin] Email profile lookup failed.", {
        collection: lookup.collectionName,
        field: lookup.field,
        code: result.reason?.code || "unknown",
      });
      return;
    }
    result.value.docs.forEach((snapshot) => {
      if (!isStudentProfileRecord(snapshot, lookup.collectionName)) return;
      profiles.set(`${lookup.collectionName}/${snapshot.id}`, {
        collectionName: lookup.collectionName,
        snapshot,
        data: snapshot.data(),
      });
    });
  });
  return [...profiles.values()];
}

function setStudentNumberError(message) {
  setInvalid("field-student-number", Boolean(message), message);
  if (message) studentNumberInput.setAttribute("aria-invalid", "true");
  else studentNumberInput.removeAttribute("aria-invalid");
}

function clearPasswordAfterSignInFailure() {
  passwordInput.value = "";
  passwordValidationShown = false;
  setInvalid("field-pass", false);
}

function showBanner(message) {
  const banner = document.getElementById("login-banner");
  banner.textContent = message;
  banner.classList.add("show");
}

const maintenanceNotice = takeMaintenanceNotice();
if (maintenanceNotice) showBanner(maintenanceNotice);
const portalRoleNotice = takePortalRoleNotice();
if (portalRoleNotice) showBanner(portalRoleNotice);

function loginErrorMessage(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
    case "auth/invalid-email":
      return "Incorrect sign-in email, Student Number, or password.";
    case "student/profile-mismatch":
      return "The student profile does not match this account. Try your email address or contact support.";
    case "student/profile-lookup-failed":
      return "Could not look up your Student Number. Try signing in with your email address or check your connection.";
    case "student/profile-not-found":
      return "No student account matched that Student Number. Check the number or try your email address.";
    case "student/profile-email-missing":
      return "No sign-in email was found for that student profile. Try your email address or contact support.";
    case "profile/role-mismatch":
      return "This account belongs to a different portal. Sign in through the correct portal.";
    case "profile/not-found":
      return "No Student profile was found for this account. Use the correct portal or contact support.";
    case "profile/email-mismatch":
      return "This account's profile does not match its sign-in email. Contact support.";
    case "permission-denied":
    case "firestore/permission-denied":
      return "Your account signed in, but its student profile could not be read. Contact support to verify profile access.";
    case "unavailable":
    case "firestore/unavailable":
    case "deadline-exceeded":
    case "firestore/deadline-exceeded":
      return "Your account signed in, but a network or Firestore error prevented profile verification. Check your connection and try again.";
    case "student/email-change-pending":
      return "If your email change is still pending, verify the new address and sign in with your current email until then.";
    case "auth/too-many-requests":
      return "Too many sign-in attempts. Please wait and try again.";
    case "auth/network-request-failed":
      return "A network error prevented sign-in. Check your connection and try again.";
    case "auth/user-disabled":
      return "This account is disabled. Contact support for help.";
    default:
      return "Unable to sign in right now. Please try again.";
  }
}

async function signIn(submittedPassword) {
  if (submitButton.disabled) return;
  studentNumberValidationShown = true;
  passwordValidationShown = true;
  const identifier = String(studentNumberInput.value || "").trim();
  const emailLogin = emailPattern.test(identifier);
  const studentNumber = emailLogin ? "" : normalizeStudentNumber(identifier);
  studentNumberInput.value = emailLogin ? identifier : studentNumber;
  const password = String(passwordInput.value || submittedPassword || "");
  const banner = document.getElementById("login-banner");
  const studentNumberError = studentNumberPasteError ||
    studentNumberValidationMessage(identifier);
  const passwordError = password ? "" : "Password is required.";

  setStudentNumberError(studentNumberError);
  setInvalid("field-pass", Boolean(passwordError), passwordError);
  banner.classList.remove("show");
  if (studentNumberError || passwordError) {
    if (studentNumberError) studentNumberInput.focus();
    else passwordInput.focus();
    return;
  }

  if (!isFirebaseConfigured || !auth || !db) {
    setStudentNumberError("Unable to sign in right now. Please try again.");
    clearPasswordAfterSignInFailure();
    return;
  }

  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "Signing in...";
  banner.textContent = "Verifying student account...";
  banner.classList.add("show");

  let diagnosticStage = "access settings";
  try {
    let accessSettings;
    try {
      accessSettings = await readSystemAccessSettings(db);
    } catch (error) {
      console.error("[StudentLogin] Could not verify login availability:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      showBanner("Could not verify sign-in availability. Check your connection and try again.");
      return;
    }
    if (!accessSettings.userLoginEnabled) {
      showBanner(maintenanceMessage(accessSettings));
      return;
    }

    await authReady;
    if (auth.currentUser) await signOut(auth);
    diagnosticStage = emailLogin ? "email profile lookup" : "Student Number profile lookup";
    const numberLookup = emailLogin ? null : await findStudentProfilesByNumber(studentNumber);
    const profiles = emailLogin
      ? await findStudentProfilesByEmail(identifier.toLowerCase())
      : numberLookup.profiles;
    if (!emailLogin && !profiles.length) {
      console.warn("[StudentLogin] No student profile matched the supplied Student Number.", {
        fields: studentNumberFields,
        collections: studentCollections,
      });
    }

    const emailCandidates = new Map();
    const pendingEmailCandidates = new Set();
    const addEmailCandidate = (value, source, pending = false) => {
      const email = String(value || "").trim().toLowerCase();
      if (!email || !emailPattern.test(email)) return;
      if (!emailCandidates.has(email)) emailCandidates.set(email, source);
      if (pending) pendingEmailCandidates.add(email);
    };
    if (emailLogin) addEmailCandidate(identifier, "entered email");
    profiles.forEach(({ data }) => {
      addEmailCandidate(data.email, "profile email");
      addEmailCandidate(data.pendingEmail, "profile pending email", true);
    });

    const cachedKeys = new Set();
    if (studentNumber) cachedKeys.add(`recovibe_pending_email_student_${studentNumber}`);
    profiles.forEach(({ snapshot }) => {
      cachedKeys.add(`recovibe_pending_email_${snapshot.id}`);
    });
    for (const storage of [localStorage, sessionStorage]) {
      const keys = new Set(cachedKeys);
      try {
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (key?.startsWith("recovibe_pending_email_")) keys.add(key);
        }
      } catch (error) {
        console.warn("[StudentLogin] Could not inspect cached email changes.", {
          code: error?.name || "unknown",
        });
      }

      try {
        const cachedProfile = JSON.parse(storage.getItem("recovibeCurrentUser") || "null");
        const cachedStudentNumber = normalizeStudentNumber(
          cachedProfile?.studentNumber || cachedProfile?.studentNo || cachedProfile?.studentId,
        );
        const cachedEmail = String(cachedProfile?.email || "").trim().toLowerCase();
        const cachedPendingEmail = String(cachedProfile?.pendingEmail || "").trim().toLowerCase();
        const matchesStudentNumber = studentNumber && cachedStudentNumber === studentNumber;
        const matchesEmail = emailLogin &&
          [cachedEmail, cachedPendingEmail].includes(identifier.toLowerCase());
        if (matchesStudentNumber || matchesEmail) {
          addEmailCandidate(cachedProfile.email, "cached profile email");
          addEmailCandidate(cachedProfile.pendingEmail, "cached profile pending email", true);
        }
      } catch (error) {
        console.warn("[StudentLogin] Could not read the cached student profile.", {
          code: error?.name || "unknown",
        });
      }

      for (const key of keys) {
        try {
          const cached = JSON.parse(storage.getItem(key) || "null");
          const cachedStudentNumber = normalizeStudentNumber(cached?.studentNumber);
          const matchesStudentNumberKey =
            key === `recovibe_pending_email_student_${studentNumber}`;
          const matchesRetrievedProfile = profiles.some(({ snapshot }) =>
            key === `recovibe_pending_email_${snapshot.id}`,
          );
          if (
            studentNumber &&
            !matchesStudentNumberKey &&
            cachedStudentNumber !== studentNumber &&
            !matchesRetrievedProfile
          ) continue;
          const cachedOldEmail = String(cached?.oldEmail || "").trim().toLowerCase();
          const cachedPendingEmail = String(cached?.pendingEmail || "").trim().toLowerCase();
          if (emailLogin && cachedOldEmail !== identifier.toLowerCase() &&
            cachedPendingEmail !== identifier.toLowerCase()) continue;
          addEmailCandidate(cached?.oldEmail, "cached previous email");
          addEmailCandidate(cached?.pendingEmail, "cached pending email", true);
        } catch (error) {
          console.warn("[StudentLogin] Could not read a cached email change.", {
            code: error?.name || "unknown",
          });
        }
      }
    }

    if (!emailCandidates.size) {
      console.warn("[StudentLogin] No usable email candidates were found.", {
        identifierType: emailLogin ? "email" : "student-number",
      });
      if (numberLookup?.lookupUnavailable) {
        throw Object.assign(new Error("Student Number lookup was unavailable."), {
          code: "student/profile-lookup-failed",
        });
      }
      if (studentNumber && !profiles.length) {
        throw Object.assign(new Error("No student profile matched the supplied Student Number."), {
          code: "student/profile-not-found",
        });
      }
      if (studentNumber) {
        throw Object.assign(new Error("The student profile has no usable sign-in email."), {
          code: "student/profile-email-missing",
        });
      }
      throw Object.assign(new Error("No sign-in email was found for this account."), {
        code: "auth/user-not-found",
      });
    }

    try {
      await setPersistence(
        auth,
        rememberMe.checked ? browserLocalPersistence : browserSessionPersistence,
      );
    } catch (persistenceError) {
      console.warn(
        "[StudentLogin] Could not set auth persistence; using the default:",
        persistenceError?.code || "unknown",
      );
    }
    let credential;
    const failedCandidates = [];
    diagnosticStage = "Firebase Authentication";
    for (const [candidateEmail, source] of emailCandidates) {
      try {
        credential = await signInWithEmailAndPassword(auth, candidateEmail, password);
        break;
      } catch (error) {
        failedCandidates.push({ email: candidateEmail, error });
        console.warn("[StudentLogin] Authentication candidate failed.", {
          source,
          code: error?.code || "unknown",
        });
        if (![
          "auth/user-not-found",
          "auth/invalid-credential",
          "auth/wrong-password",
          "auth/invalid-email",
        ].includes(error?.code)) {
          throw error;
        }
      }
    }
    if (!credential) {
      const pendingAddressUnverified = failedCandidates.some(({ email, error }) =>
        pendingEmailCandidates.has(email) && error?.code === "auth/user-not-found",
      );
      if (pendingAddressUnverified) {
        throw Object.assign(new Error("The new email address has not been verified yet."), {
          code: "student/email-change-pending",
        });
      }
      throw failedCandidates.at(-1)?.error || new Error("Student sign-in failed.");
    }
    if (profiles.length && !profiles.some(({ snapshot, data }) =>
      snapshot.id === credential.user.uid || data.uid === credential.user.uid,
    )) {
      await signOut(auth);
      console.warn("[StudentLogin] Authenticated UID did not match a lookup profile.", {
        code: "student/profile-mismatch",
      });
      throw Object.assign(new Error("Student profile identity mismatch."), {
        code: "student/profile-mismatch",
      });
    }

    const authenticatedRole = await resolvePortalRole(db, credential.user.uid);
    if (authenticatedRole !== "student") {
      await signOut(auth);
      throw Object.assign(new Error("The authenticated account is not a student account."), {
        code: authenticatedRole ? "profile/role-mismatch" : "profile/not-found",
      });
    }

    diagnosticStage = "student profile load and email sync";
    const profile = await loadStudentProfile(credential.user, {
      storage: rememberMe.checked ? "local" : "session",
      createIfMissing: false,
    });
    accessSettings = await readSystemAccessSettings(db);
    if (!accessSettings.userLoginEnabled) {
      await signOut(auth);
      clearCachedStudentProfile();
      showBanner(maintenanceMessage(accessSettings));
      return;
    }
    const profileRole = String(profile.role || profile.userRole || "").trim().toLowerCase();
    const roleMismatch = Boolean(profileRole && profileRole !== "student");
    const profileMismatch = String(profile.email || "").trim().toLowerCase() !==
      String(credential.user.email || "").trim().toLowerCase() ||
      (profile.uid && profile.uid !== credential.user.uid) ||
      roleMismatch;
    if (profileMismatch) {
      await signOut(auth);
      clearCachedStudentProfile();
      console.warn("[StudentLogin] Loaded profile did not match authenticated student.", {
        code: roleMismatch ? "profile/role-mismatch" : "student/profile-mismatch",
      });
      throw Object.assign(new Error("Student profile identity mismatch."), {
        code: roleMismatch ? "profile/role-mismatch" : "student/profile-mismatch",
      });
    }
    clearPortalProfileCaches();
    const authenticatedProfile = {
      ...profile,
      uid: credential.user.uid,
      email: credential.user.email || profile.email,
      role: "Student",
    };
    const profileStorage = rememberMe.checked ? localStorage : sessionStorage;
    profileStorage.setItem("recovibeCurrentUser", JSON.stringify(authenticatedProfile));
    window.location.assign("Dashboard.html");
  } catch (error) {
    if (auth.currentUser) {
      try {
        await signOut(auth);
      } catch (signOutError) {
        console.warn("[StudentLogin] Could not clear failed sign-in:", signOutError?.code || "unknown");
      }
    }
    clearPortalProfileCaches();
    clearCachedStudentProfile();
    console.warn("[StudentLogin] Sign-in flow failed.", {
      stage: diagnosticStage,
      code: error?.code || "unknown",
    });
    if (error?.code === "student/email-change-pending") {
      setStudentNumberError("");
      showBanner(loginErrorMessage(error));
    } else {
      setStudentNumberError(loginErrorMessage(error));
    }
    clearPasswordAfterSignInFailure();
    studentNumberInput.focus();
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = submitButtonLabel;
    if (banner.textContent === "Verifying student account...") {
      banner.textContent = "";
      banner.classList.remove("show");
    }
  }
}

document.getElementById("student-login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const formPassword = new FormData(event.currentTarget).get("password");
  signIn(passwordInput.value || String(formPassword || ""));
});
studentNumberInput.addEventListener("input", () => {
  studentNumberPasteError = "";
  const start = studentNumberInput.selectionStart ?? studentNumberInput.value.length;
  const end = studentNumberInput.selectionEnd ?? start;
  const rawValue = studentNumberInput.value;
  const value = normalizeLoginIdentifier(rawValue);
  if (rawValue !== value) {
    studentNumberInput.value = value;
    studentNumberInput.setSelectionRange(
      normalizeLoginIdentifier(rawValue.slice(0, start)).length,
      normalizeLoginIdentifier(rawValue.slice(0, end)).length,
    );
  }
  if (studentNumberValidationShown) {
    setStudentNumberError(studentNumberValidationMessage(value));
  }
});
studentNumberInput.addEventListener("blur", () => {
  studentNumberValidationShown = true;
  const value = normalizeLoginIdentifier(studentNumberInput.value);
  studentNumberInput.value = value;
  setStudentNumberError(
    studentNumberPasteError || studentNumberValidationMessage(value),
  );
});
studentNumberInput.addEventListener("paste", (event) => {
  event.preventDefault();
  studentNumberValidationShown = true;
  const pastedText = String(event.clipboardData?.getData("text") || "").trim();
  if (looksLikeEmailIdentifier(pastedText)) {
    const email = pastedText.toLowerCase();
    const message = emailPattern.test(email)
      ? ""
      : "Enter a valid email address or student number.";
    studentNumberPasteError = message;
    studentNumberInput.value = email;
    setStudentNumberError(message);
    return;
  }
  const pasted = pastedText.toUpperCase().replace(/\s/g, "");
  const message = studentNumberValidationMessage(pasted);
  if (message) {
    studentNumberPasteError = message;
    setStudentNumberError(message);
    return;
  }
  studentNumberPasteError = "";
  const start = studentNumberInput.selectionStart ?? studentNumberInput.value.length;
  const end = studentNumberInput.selectionEnd ?? start;
  const value = normalizeLoginIdentifier(studentNumberInput.value);
  studentNumberInput.value = normalizeLoginIdentifier(
    value.slice(0, start) + pasted + value.slice(end),
  );
  const caret = Math.min(start + pasted.length, studentNumberInput.value.length);
  studentNumberInput.setSelectionRange(caret, caret);
  setStudentNumberError(studentNumberValidationMessage(studentNumberInput.value));
});
passwordInput.addEventListener("input", () => {
  if (passwordInput.value) {
    setInvalid("field-pass", false);
  } else if (passwordValidationShown) {
    setInvalid("field-pass", true, "Password is required.");
  }
});
passwordInput.addEventListener("blur", () => {
  if (passwordInput.value) {
    setInvalid("field-pass", false);
    return;
  }
  if (!passwordValidationShown) return;
  const message = passwordInput.value ? "" : "Password is required.";
  setInvalid("field-pass", Boolean(message), message);
});
(function () {
  const toggle = document.getElementById("pass-toggle");
  let isVisible = false;
  let inputHadFocus = false;
  let selectionStart = null;
  let selectionEnd = null;
  let selectionDirection = "none";

  passwordInput.addEventListener("blur", () => {
    selectionStart = passwordInput.selectionStart;
    selectionEnd = passwordInput.selectionEnd;
    selectionDirection = passwordInput.selectionDirection;
  });
  toggle.addEventListener("mousedown", (event) => {
    inputHadFocus = document.activeElement === passwordInput;
    selectionStart = passwordInput.selectionStart;
    selectionEnd = passwordInput.selectionEnd;
    selectionDirection = passwordInput.selectionDirection;
    if (inputHadFocus) event.preventDefault();
  });
  toggle.addEventListener("click", function () {
    const restoreFocus = inputHadFocus;
    inputHadFocus = false;
    if (selectionStart === null || selectionEnd === null) {
      selectionStart = passwordInput.selectionStart;
      selectionEnd = passwordInput.selectionEnd;
      selectionDirection = passwordInput.selectionDirection;
    }
    isVisible = !isVisible;
    passwordInput.type = isVisible ? "text" : "password";
    toggle.classList.toggle("is-visible", isVisible);
    toggle.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
    toggle.setAttribute("aria-pressed", String(isVisible));
    requestAnimationFrame(() => {
      if (restoreFocus) passwordInput.focus({ preventScroll: true });
      if (selectionStart !== null && selectionEnd !== null) {
        passwordInput.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
      }
    });
  });
})();
