import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
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
  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-pass");
  const loginButton = document.getElementById("login-submit");
  const banner = document.getElementById("login-banner");
  const rememberMe = document.getElementById("remember-me");
  const rememberedEmailKey = "rememberedEmail_admin";
  let signInVerified = false;
  const profileCollections = ["adminUser", "users"];

  function clearRememberedEmail() {
    try {
      localStorage.removeItem(rememberedEmailKey);
    } catch (error) {
      console.warn("[AdminLogin] Could not clear remembered email:", error?.code || "unknown");
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
      console.warn("[AdminLogin] Could not save remembered email:", error?.code || "unknown");
    }
  }

  try {
    const rememberedEmail = localStorage.getItem(rememberedEmailKey);
    if (rememberedEmail) {
      emailInput.value = rememberedEmail;
      rememberMe.checked = true;
    }
  } catch (error) {
    console.warn("[AdminLogin] Could not read remembered email:", error?.code || "unknown");
  }
  rememberMe.addEventListener("change", () => {
    if (!rememberMe.checked) clearRememberedEmail();
  });

  document
    .querySelector('.link-btn[href*="ForgetPassword"]')
    ?.setAttribute("href", "AdminForgetPassword.html");

  const setInvalid = (id, invalid) =>
    document.getElementById(id).classList.toggle("invalid", invalid);

  function clearStoredProfiles() {
    clearPortalProfileCaches();
  }

  function showError(message) {
    banner.textContent = message;
    banner.classList.add("show");
  }

  const maintenanceNotice = takeMaintenanceNotice();
  if (maintenanceNotice) showError(maintenanceNotice);
  const portalRoleNotice = takePortalRoleNotice();
  if (portalRoleNotice) showError(portalRoleNotice);

  function authErrorMessage(error) {
    switch (error?.code) {
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
      case "auth/invalid-email":
        return "Incorrect email or password.";
      case "auth/too-many-requests":
        return "Too many sign-in attempts. Please try again later.";
      case "auth/network-request-failed":
        return "A network error prevented sign-in. Check your connection and try again.";
      case "auth/user-disabled":
        return "This account is disabled. Contact an administrator for help.";
      case "portal/email-change-pending":
        return "If your email change is still pending, verify the new address and sign in with your current email until then.";
      default:
        return "Unable to sign in right now. Please try again.";
    }
  }

  function normalizeRole(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
  }

  function profileRoles(profile) {
    return [
      profile?.role,
      profile?.userRole,
      ...(Array.isArray(profile?.roles) ? profile.roles : []),
    ].flatMap((value) =>
      String(value || "")
        .split(/[,&/|]+/)
        .map(normalizeRole)
        .filter(Boolean),
    );
  }

  function isDisabledProfile(profile) {
    const status = String(profile?.status || "").trim().toLowerCase();
    return profile?.isActive === false || ["inactive", "disabled"].includes(status);
  }

  function resolveRole(profiles) {
    const priorities = [
      { role: "Super Admin", normalized: "superadmin" },
      { role: "Admin", normalized: "admin" },
      { role: "Admin", normalized: "osas" },
      { role: "Event Organizer", normalized: "eventorganizer" },
      { role: "Teacher", normalized: "teacher" },
      { role: "Teacher", normalized: "teacheradviser" },
      { role: "Teacher", normalized: "faculty" },
      { role: "Teacher", normalized: "adviser" },
      { role: "Student", normalized: "student" },
    ];
    for (const priority of priorities) {
      const profileRecord = profiles.find(
        (candidate) =>
          profileRoles(candidate.data).includes(priority.normalized),
      );
      if (profileRecord) return { ...profileRecord, resolvedRole: priority.role };
    }
    return profiles[0]
      ? {
          ...profiles[0],
          resolvedRole: String(
            profiles[0].data.role ||
              profiles[0].data.userRole ||
              profiles[0].data.roles?.[0] ||
              "",
          ).trim(),
        }
      : null;
  }

  async function findProfile(uid) {
    const reads = await Promise.allSettled(
      profileCollections.map(async (collectionName) => {
        const profileSnapshot = await getDoc(doc(db, collectionName, uid));
        return profileSnapshot.exists()
          ? { collectionName, data: profileSnapshot.data() }
          : null;
      }),
    );
    const lookupErrors = reads
      .filter((read) => read.status === "rejected")
      .map((read) => read.reason);
    const profiles = reads
      .filter((read) => read.status === "fulfilled" && read.value)
      .map((read) => read.value);
    const disabledAdminProfile = profiles.find(
      (candidate) =>
        candidate.collectionName === "adminUser" &&
        isDisabledProfile(candidate.data),
    );
    if (disabledAdminProfile) {
      return {
        ...disabledAdminProfile,
        resolvedRole: "Admin",
        disabled: true,
        candidates: profiles,
      };
    }
    const resolution = resolveRole(profiles);
    if (resolution?.resolvedRole === "Super Admin") {
      console.info("[AdminLogin] Role resolution:", {
        uid,
        candidates: profiles.map((candidate) => ({
          col: candidate.collectionName,
          role: candidate.data.role,
        })),
        finalRole: "Super Admin",
      });
      return { ...resolution, candidates: profiles };
    }
    if (
      resolution &&
      ["Admin", "Event Organizer", "Student"].includes(resolution.resolvedRole)
    ) {
      return { ...resolution, candidates: profiles };
    }
    if (lookupErrors.length) {
      console.error("[AdminLogin] Could not verify all administrator profiles:", lookupErrors);
      throw lookupErrors[0];
    }
    if (resolution) return { ...resolution, candidates: profiles };

    const studentSnapshot = await getDoc(doc(db, "users", uid));
    if (!studentSnapshot.exists()) return null;
    const studentProfile = {
      collectionName: "users",
      data: studentSnapshot.data(),
    };
    return {
      ...resolveRole([studentProfile]),
      candidates: [studentProfile],
    };
  }

  function profileName(profile, email) {
    const nameParts = [profile.firstName, profile.middleName, profile.lastName]
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    return (
      profile.fullName ||
      profile.name ||
      profile.displayName ||
      nameParts.join(" ") ||
      email.split("@")[0]
    );
  }

  async function handleSignIn() {
    const normalizedEmail = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    setInvalid("field-email", !validEmail);
    setInvalid("field-pass", !password);
    banner.classList.remove("show");

    if (!validEmail || !password) {
      clearRememberedEmail();
      return;
    }
    if (!isFirebaseConfigured || !auth || !db) {
      clearRememberedEmail();
      showError("Firebase authentication is unavailable. Please try again later.");
      return;
    }

    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";
    clearStoredProfiles();
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
          "[AdminLogin] Could not set auth persistence; using the default:",
          persistenceError?.code || "unknown",
        );
      }
      const credential = await signInWithPendingEmailFallback(
        auth,
        db,
        normalizedEmail,
        password,
        "all",
        profileCollectionsForRole("all"),
      );
      authenticated = true;
      const profileRecord = await findProfile(credential.user.uid);

      if (!profileRecord) {
        await signOut(auth);
        authenticated = false;
        clearPortalProfileCaches();
        showError(
          `Your account signed in, but no profile was found for UID ${credential.user.uid}. Contact an administrator.`,
        );
        return;
      }

      const profile = profileRecord.data;
      if (
        profileRecord.disabled ||
        (profileRecord.collectionName === "adminUser" && isDisabledProfile(profile))
      ) {
        await signOut(auth);
        authenticated = false;
        clearPortalProfileCaches();
        showError("This admin account is disabled or inactive. Contact a super admin for help.");
        return;
      }
      const role = profileRecord.resolvedRole;
      const normalizedRole = normalizeRole(role);
      if (!["admin", "osas"].includes(normalizedRole)) {
        await signOut(auth);
        authenticated = false;
        clearPortalProfileCaches();
        showError(
          `This account belongs to the ${role || "another"} portal. Use the matching portal sign-in page.`,
        );
        return;
      }
      if (String(profile.status || "").trim().toLowerCase() === "suspended") {
        await signOut(auth);
        authenticated = false;
        clearPortalProfileCaches();
        showError("This account is suspended. Contact an administrator for help.");
        return;
      }

      const emailSync = await syncVerifiedProfileEmail(
        auth,
        db,
        credential.user,
        "admin",
        profileCollectionsForRole("admin"),
      );
      if (emailSync) {
        profile.email = emailSync.email;
        if (emailSync.pendingEmail) profile.pendingEmail = emailSync.pendingEmail;
        else delete profile.pendingEmail;
      }
      const authenticatedEmail = credential.user.email || normalizedEmail;
      const name = profileName(profile, authenticatedEmail);
      const authenticatedProfile = {
        ...profile,
        uid: credential.user.uid,
        name,
        email: authenticatedEmail,
      };

      if (normalizedRole !== "superadmin") {
        let accessSettings;
        try {
          accessSettings = await readSystemAccessSettings(db);
        } catch (error) {
          await signOut(auth);
          clearStoredProfiles();
          console.error("[AdminLogin] Could not verify login availability:", {
            code: error?.code || "unknown",
            message: error?.message || String(error),
          });
          showError("Could not verify sign-in availability. Check your connection and try again.");
          return;
        }
        if (!accessSettings.userLoginEnabled) {
          await signOut(auth);
          clearStoredProfiles();
          showError(maintenanceMessage(accessSettings));
          return;
        }
      }

      clearPortalProfileCaches();
      localStorage.setItem(
        "recovibeAdminProfile",
        JSON.stringify({ ...authenticatedProfile, role: "Admin" }),
      );
      localStorage.setItem("recovibeAdminId", authenticatedEmail);
      saveRememberedEmail(authenticatedEmail);
      signInVerified = true;
      window.location.assign("AdminDashboard.html");
    } catch (error) {
      if (authenticated) {
        try {
          await signOut(auth);
        } catch (signOutError) {
          console.error("[AdminLogin] Unable to clear unverified Auth session:", signOutError);
        }
      }
      console.error("[AdminLogin] Firebase sign-in/profile lookup failed:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      if (error?.code === "portal/email-change-pending") {
        showError(authErrorMessage(error));
      } else if (error?.code?.startsWith("auth/")) {
        showError(authErrorMessage(error));
      } else if (
        error?.code === "permission-denied" ||
        error?.code === "firestore/permission-denied"
      ) {
        showError("Your account signed in, but its profile could not be read. Contact an administrator to verify profile access.");
      } else if (
        ["unavailable", "firestore/unavailable", "deadline-exceeded", "firestore/deadline-exceeded"].includes(error?.code)
      ) {
        showError("Your account signed in, but a network or Firestore error prevented profile verification. Check your connection and try again.");
      } else {
        showError("Your account signed in, but its profile could not be verified. Contact an administrator.");
      }
    } finally {
      if (!signInVerified) clearRememberedEmail();
      loginButton.disabled = false;
      loginButton.textContent = "Sign in";
    }
  }

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
