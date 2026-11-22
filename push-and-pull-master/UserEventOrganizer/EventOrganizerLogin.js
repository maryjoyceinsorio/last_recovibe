import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, authReady, db, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";
import {
  profileCollectionsForRole,
  signInWithPendingEmailFallback,
  syncVerifiedProfileEmail,
} from "../portalProfileAccount.js";
import {
  clearPortalProfileCaches,
  maintenanceMessage,
  readSystemAccessSettings,
  takeMaintenanceNotice,
  takePortalRoleNotice,
} from "../systemAccess.js";

(() => {
  document
    .querySelector('.link-btn[href*="ForgetPassword"]')
    ?.setAttribute("href", "EventOrganizerForgetPassword.html");
  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-pass");
  const loginButton = document.getElementById("login-submit");
  const banner = document.getElementById("login-banner");
  const rememberMe = document.getElementById("remember-me");
  const rememberedEmailKey = "rememberedEmail_event_organizer";
  let signInVerified = false;
  const maintenanceNotice = takeMaintenanceNotice();
  if (maintenanceNotice) {
    banner.textContent = maintenanceNotice;
    banner.classList.add("show");
  }
  const portalRoleNotice = takePortalRoleNotice();
  if (portalRoleNotice) {
    banner.textContent = portalRoleNotice;
    banner.classList.add("show");
  }

  function clearRememberedEmail() {
    try {
      localStorage.removeItem(rememberedEmailKey);
    } catch (error) {
      console.warn("[EventOrganizerLogin] Could not clear remembered email:", error?.code || "unknown");
    }
  }

  function saveRememberedEmail(email) {
    if (!rememberMe.checked) {
      clearRememberedEmail();
      return;
    }
    try {
      localStorage.setItem(rememberedEmailKey, email);
    } catch (error) {
      console.warn("[EventOrganizerLogin] Could not save remembered email:", error?.code || "unknown");
    }
  }

  try {
    const rememberedEmail = localStorage.getItem(rememberedEmailKey);
    if (rememberedEmail) {
      emailInput.value = rememberedEmail;
      rememberMe.checked = true;
    }
  } catch (error) {
    console.warn("[EventOrganizerLogin] Could not read remembered email:", error?.code || "unknown");
  }
  rememberMe.addEventListener("change", () => {
    if (!rememberMe.checked) clearRememberedEmail();
  });

  const setInvalid = (id, invalid) =>
    document.getElementById(id).classList.toggle("invalid", invalid);
  let signingIn = false;
  const PROFILE_VERIFICATION_TIMEOUT_MS = 12000;

  function withTimeout(promise, timeoutMs) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
      timeoutId = window.setTimeout(() => {
        reject(Object.assign(new Error("Organizer profile verification timed out."), {
          code: "profile/timeout",
        }));
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
  }

  function normalizeRole(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function getOrganizerProfileData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const nestedProfile = [data.profile, data.userProfile, data.organizerProfile]
      .find((value) => value && typeof value === "object" && !Array.isArray(value));
    return nestedProfile ? { ...data, ...nestedProfile } : data;
  }

  function getOrganizerProfileNestedField(data) {
    return ["profile", "userProfile", "organizerProfile"].find((field) =>
      data?.[field] && typeof data[field] === "object" && !Array.isArray(data[field]),
    ) || "";
  }

  function getOrganizerProfileSource(record, documentId) {
    return {
      collectionName: record.collectionName,
      documentId: documentId || record.profileRef?.id || "",
      nestedField: getOrganizerProfileNestedField(record.data),
    };
  }

  function getOrganizerProfileRole(profile) {
    const roleValue = [
      profile.role,
      profile.userRole,
      profile.accountType,
      profile.userType,
      profile.profile?.role,
      profile.userProfile?.role,
      profile.organizerProfile?.role,
    ].find((value) => String(value || "").trim());
    if (roleValue && typeof roleValue === "object") {
      return normalizeRole(roleValue.name || roleValue.value || roleValue.key || roleValue.code);
    }
    return normalizeRole(roleValue);
  }

  function hasOrganizerRole(profile) {
    return ["eventorganizer", "organizer", "eo"].includes(getOrganizerProfileRole(profile));
  }

  function getProfileOrganizationCode(profile) {
    const organization = profile.organization;
    return String(
      profile.organizationCode ||
      profile.orgCode ||
      organization?.organizationCode ||
      organization?.orgCode ||
      organization?.code ||
      "",
    ).trim();
  }

  async function findOrganizerProfile(uid, email) {
    const collectionNames = profileCollectionsForRole("eventorganizer");
    const directReads = await Promise.allSettled(collectionNames.map(async (collectionName) => {
      const profileRef = doc(db, collectionName, uid);
      const snapshot = await getDoc(profileRef);
      return snapshot.exists()
        ? { collectionName, data: snapshot.data(), profileRef }
        : null;
    }));
    const directErrors = directReads
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    const directRecords = directReads
      .filter((result) => result.status === "fulfilled" && result.value)
      .map((result) => result.value);
    const directOrganizer = directRecords.find((record) =>
      record.collectionName !== "eventOrganizations" &&
      hasOrganizerRole(getOrganizerProfileData(record.data)),
    );
    if (directOrganizer) {
      return {
        profile: getOrganizerProfileData(directOrganizer.data),
        profileSource: getOrganizerProfileSource(directOrganizer, uid),
        emailLookup: false,
      };
    }

    const directOrganization = directRecords.find((record) =>
      record.collectionName === "eventOrganizations",
    );
    const hasConflictingRole = directRecords.some((record) =>
      getOrganizerProfileRole(getOrganizerProfileData(record.data)),
    );
    if (
      directOrganization &&
      getProfileOrganizationCode(getOrganizerProfileData(directOrganization.data)) &&
      !hasConflictingRole
    ) {
      return {
        profile: {
          ...getOrganizerProfileData(directOrganization.data),
          role: "Event Organizer",
        },
        profileSource: getOrganizerProfileSource(directOrganization, uid),
        emailLookup: false,
      };
    }

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const emailDocumentReads = normalizedEmail
      ? await Promise.allSettled(collectionNames.map(async (collectionName) => {
          const snapshot = await getDoc(doc(db, collectionName, normalizedEmail));
          return snapshot.exists()
            ? [{ collectionName, documentId: snapshot.id, data: snapshot.data() }]
            : [];
        }))
      : [];
    const emailQueryReads = normalizedEmail
      ? await Promise.allSettled(collectionNames.map(async (collectionName) => {
          const snapshot = await getDocs(query(
            collection(db, collectionName),
            where("email", "==", normalizedEmail),
          ));
          return snapshot.docs.map((profileSnapshot) => ({
            collectionName,
            documentId: profileSnapshot.id,
            data: profileSnapshot.data(),
          }));
        }))
      : [];
    const emailReads = [...emailDocumentReads, ...emailQueryReads];
    const emailErrors = emailReads
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason);
    const emailRecords = emailReads
      .filter((result) => result.status === "fulfilled")
      .flatMap((result) => result.value);
    const hasConflictingDirectRole = directRecords.some((record) => {
      if (record.collectionName === "eventOrganizations") return false;
      const profile = getOrganizerProfileData(record.data);
      return getOrganizerProfileRole(profile) && !hasOrganizerRole(profile);
    });
    const emailOrganizer = emailRecords.find((record) =>
      record.collectionName !== "eventOrganizations" &&
      hasOrganizerRole(getOrganizerProfileData(record.data)),
    );
    if (emailOrganizer && !hasConflictingDirectRole) {
      return {
        profile: getOrganizerProfileData(emailOrganizer.data),
        profileSource: getOrganizerProfileSource(emailOrganizer, emailOrganizer.documentId),
        emailLookup: true,
      };
    }

    const emailOrganization = emailRecords.find((record) =>
      record.collectionName === "eventOrganizations",
    );
    const hasEmailRole = emailRecords.some((record) =>
      getOrganizerProfileRole(getOrganizerProfileData(record.data)),
    );
    if (
      emailOrganization &&
      getProfileOrganizationCode(getOrganizerProfileData(emailOrganization.data)) &&
      !hasEmailRole &&
      !hasConflictingDirectRole
    ) {
      return {
        profile: {
          ...getOrganizerProfileData(emailOrganization.data),
          role: "Event Organizer",
        },
        profileSource: getOrganizerProfileSource(emailOrganization, emailOrganization.documentId),
        emailLookup: true,
      };
    }

    const profiles = directRecords
      .filter((record) => record.collectionName !== "eventOrganizations")
      .map((record) => getOrganizerProfileData(record.data));
    const errors = [...directErrors, ...emailErrors];
    if (errors.length) throw errors[0];
    if (profiles.length || emailRecords.length) {
      throw Object.assign(new Error("Account is not an organizer account."), {
        code: "profile/role-mismatch",
      });
    }
    throw Object.assign(new Error("Organizer profile was not found."), {
      code: "profile/not-found",
    });
  }

  async function handleSignIn() {
    if (signingIn) return;
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    setInvalid("field-email", !validEmail);
    setInvalid("field-pass", !password);
    banner.classList.remove("show");
    if (!validEmail || !password) {
      clearRememberedEmail();
      return;
    }

    if (!isFirebaseConfigured || !auth || !db) {
      clearRememberedEmail();
      banner.textContent = "Sign in is unavailable. Please contact support.";
      banner.classList.add("show");
      return;
    }

    let accessSettings;
    try {
      accessSettings = await readSystemAccessSettings(db);
    } catch (error) {
      console.error("[EventOrganizerLogin] Could not verify login availability:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      clearRememberedEmail();
      banner.textContent = "Could not verify sign-in availability. Check your connection and try again.";
      banner.classList.add("show");
      return;
    }
    if (!accessSettings.userLoginEnabled) {
      clearRememberedEmail();
      banner.textContent = maintenanceMessage(accessSettings);
      banner.classList.add("show");
      return;
    }

    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";
    signingIn = true;
    let authenticated = false;
    try {
      await authReady;
      try {
        await setPersistence(
          auth,
          rememberMe.checked ? browserLocalPersistence : browserSessionPersistence,
        );
      } catch (persistenceError) {
        console.warn(
          "[EventOrganizerLogin] Could not set auth persistence; using the default:",
          persistenceError?.code || "unknown",
        );
      }
      const credential = await signInWithPendingEmailFallback(
        auth,
        db,
        email,
        password,
        "eventorganizer",
        profileCollectionsForRole("eventorganizer"),
      );
      authenticated = true;
      clearPortalProfileCaches();
      banner.textContent = "Verifying organizer account...";
      banner.classList.add("show");
      const profileResult = await withTimeout(
        findOrganizerProfile(credential.user.uid, credential.user.email || email),
        PROFILE_VERIFICATION_TIMEOUT_MS,
      );
      if (!profileResult.emailLookup) {
        await syncVerifiedProfileEmail(
          auth,
          db,
          credential.user,
          "eventorganizer",
          [profileResult.profileSource.collectionName],
        );
      }
      accessSettings = await readSystemAccessSettings(db);
      if (!accessSettings.userLoginEnabled) {
        await signOut(auth);
        clearRememberedEmail();
        banner.textContent = maintenanceMessage(accessSettings);
        banner.classList.add("show");
        return;
      }

      const organizerProfile = {
        ...profileResult.profile,
        uid: credential.user.uid,
        email: credential.user.email || email,
        profileSource: profileResult.profileSource,
      };
      localStorage.setItem("recovibeOrganizerId", credential.user.uid);
      localStorage.setItem(
        "recovibeOrganizerProfile",
        JSON.stringify(organizerProfile),
      );
      saveRememberedEmail(credential.user.email || email);
      signInVerified = true;
      window.location.assign("EventOrganizerDashBoard.html");
    } catch (error) {
      if (authenticated) {
        try {
          await signOut(auth);
        } catch (signOutError) {
          console.error("[EventOrganizerLogin] Unable to clear unverified session:", {
            code: signOutError?.code || "unknown",
            message: signOutError?.message || String(signOutError),
          });
        }
      }
      clearPortalProfileCaches();
      console.error("[EventOrganizerLogin] Sign-in/profile verification failed:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      if (
        error?.code === "portal/email-change-pending"
      ) {
        banner.textContent = "If your email change is still pending, verify the new address and sign in with your current email until then.";
      } else if (
        ["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password", "auth/invalid-email"].includes(
          error?.code,
        )
      ) {
        banner.textContent = "Incorrect email or password.";
      } else if (error?.code === "auth/too-many-requests") {
        banner.textContent = "Too many attempts. Please try again later.";
      } else if (
        error?.code === "auth/network-request-failed" ||
        error?.code === "unavailable" ||
        error?.code === "firestore/unavailable"
      ) {
        banner.textContent = "A network error prevented account verification. Check your connection and try again.";
      } else if (
        error?.code === "permission-denied" ||
        error?.code === "firestore/permission-denied"
      ) {
        banner.textContent = "Your account signed in, but its organizer profile could not be read. Ask an administrator to verify its profile access.";
      } else if (error?.code === "profile/not-found") {
        banner.textContent = "Your account signed in, but no organizer profile was found. Ask an administrator to verify your organizer account.";
      } else if (error?.code === "profile/role-mismatch") {
        banner.textContent = "This account is not assigned the Event Organizer role. Ask an administrator to check its role.";
      } else if (error?.code === "profile/timeout") {
        banner.textContent = "Organizer account verification is taking too long. Check your connection and try again.";
      } else {
        banner.textContent =
          "Your account could not be verified for the organizer portal. Contact an administrator.";
      }
      banner.classList.add("show");
    } finally {
      if (!signInVerified) clearRememberedEmail();
      signingIn = false;
      loginButton.disabled = false;
      loginButton.textContent = "Sign in";
    }
  }

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });

  loginButton.addEventListener("click", handleSignIn);
  passwordInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") handleSignIn();
  });
  const passwordToggle = document.getElementById("pass-toggle");
  let passwordVisible = false;
  let inputHadFocus = false;
  let selectionStart = null;
  let selectionEnd = null;
  let selectionDirection = "none";

  passwordInput.addEventListener("blur", () => {
    selectionStart = passwordInput.selectionStart;
    selectionEnd = passwordInput.selectionEnd;
    selectionDirection = passwordInput.selectionDirection;
  });
  passwordToggle.addEventListener("mousedown", (event) => {
    inputHadFocus = document.activeElement === passwordInput;
    selectionStart = passwordInput.selectionStart;
    selectionEnd = passwordInput.selectionEnd;
    selectionDirection = passwordInput.selectionDirection;
    if (inputHadFocus) event.preventDefault();
  });
  passwordToggle.addEventListener("click", () => {
    const restoreFocus = inputHadFocus;
    inputHadFocus = false;
    if (selectionStart === null || selectionEnd === null) {
      selectionStart = passwordInput.selectionStart;
      selectionEnd = passwordInput.selectionEnd;
      selectionDirection = passwordInput.selectionDirection;
    }
    passwordVisible = !passwordVisible;
    passwordInput.type = passwordVisible ? "text" : "password";
    passwordToggle.classList.toggle("is-visible", passwordVisible);
    passwordToggle.setAttribute("aria-label", passwordVisible ? "Hide password" : "Show password");
    passwordToggle.setAttribute("aria-pressed", String(passwordVisible));
    requestAnimationFrame(() => {
      if (restoreFocus) passwordInput.focus({ preventScroll: true });
      if (selectionStart !== null && selectionEnd !== null) {
        passwordInput.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
      }
    });
  });
})();
