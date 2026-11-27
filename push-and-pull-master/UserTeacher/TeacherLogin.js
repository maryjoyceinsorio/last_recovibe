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
  const banner = document.getElementById("login-banner");
  const loginButton = document.getElementById("login-submit");
  const rememberMe = document.getElementById("remember-me");
  const rememberedEmailKey = "rememberedEmail_teacher";
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
  const setInvalid = (id, invalid) =>
    document.getElementById(id).classList.toggle("invalid", invalid);

  function clearRememberedEmail() {
    try {
      localStorage.removeItem(rememberedEmailKey);
    } catch (error) {
      console.warn("[TeacherLogin] Could not clear remembered email:", error?.code || "unknown");
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
      console.warn("[TeacherLogin] Could not save remembered email:", error?.code || "unknown");
    }
  }

  function hasTeacherRole(profile) {
    const roles = [
      profile?.role,
      profile?.userRole,
      ...(Array.isArray(profile?.roles) ? profile.roles : []),
    ].flatMap((value) =>
      String(value || "")
        .split(/[,&/|]+/)
        .map((role) => role.trim().toLowerCase().replace(/[^a-z0-9]/g, ""))
        .filter(Boolean),
    );
    return roles.some((role) =>
      ["teacher", "teacheradviser", "faculty", "adviser"].includes(role),
    );
  }

  try {
    const rememberedEmail = localStorage.getItem(rememberedEmailKey);
    if (rememberedEmail) {
      emailInput.value = rememberedEmail;
      rememberMe.checked = true;
    }
  } catch (error) {
    console.warn("[TeacherLogin] Could not read remembered email:", error?.code || "unknown");
  }
  rememberMe.addEventListener("change", () => {
    if (!rememberMe.checked) clearRememberedEmail();
  });

  async function handleSignIn() {
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

    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";
    let authenticated = false;
    try {
      let accessSettings;
      try {
        accessSettings = await readSystemAccessSettings(db);
      } catch (error) {
        console.error("[TeacherLogin] Could not verify login availability:", {
          code: error?.code || "unknown",
          message: error?.message || String(error),
        });
        banner.textContent = "Could not verify sign-in availability. Check your connection and try again.";
        banner.classList.add("show");
        return;
      }
      if (!accessSettings.userLoginEnabled) {
        banner.textContent = maintenanceMessage(accessSettings);
        banner.classList.add("show");
        return;
      }

      await authReady;
      try {
        await setPersistence(
          auth,
          rememberMe.checked ? browserLocalPersistence : browserSessionPersistence,
        );
      } catch (persistenceError) {
        console.warn(
          "[TeacherLogin] Could not set auth persistence; using the default:",
          persistenceError?.code || "unknown",
        );
      }
      const credential = await signInWithPendingEmailFallback(
        auth,
        db,
        email,
        password,
        "teacher",
        profileCollectionsForRole("teacher"),
      );
      authenticated = true;
      clearPortalProfileCaches();
      const profileSnapshot = await getDoc(
        doc(db, "adminUser", credential.user.uid),
      );
      if (!profileSnapshot.exists()) {
        throw Object.assign(new Error("Teacher profile was not found."), {
          code: "profile/not-found",
        });
      }

      const profile = profileSnapshot.data();
      if (!hasTeacherRole(profile)) {
        throw Object.assign(new Error("Account is not a teacher account."), {
          code: "profile/role-mismatch",
        });
      }
      const emailSync = await syncVerifiedProfileEmail(
        auth,
        db,
        credential.user,
        "teacher",
        profileCollectionsForRole("teacher"),
      );
      if (emailSync) {
        profile.email = emailSync.email;
        if (emailSync.pendingEmail) profile.pendingEmail = emailSync.pendingEmail;
        else delete profile.pendingEmail;
      }
      accessSettings = await readSystemAccessSettings(db);
      if (!accessSettings.userLoginEnabled) {
        await signOut(auth);
        authenticated = false;
        banner.textContent = maintenanceMessage(accessSettings);
        banner.classList.add("show");
        return;
      }

      const teacher = {
        ...profile,
        uid: credential.user.uid,
        email: credential.user.email || email,
        name:
          profile.fullName ||
          profile.name ||
          [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
          email.split("@")[0],
      };
      localStorage.setItem("recovibeCurrentTeacher", JSON.stringify(teacher));
      localStorage.setItem("recovibeTeacherId", credential.user.email || email);
      saveRememberedEmail(credential.user.email || email);
      signInVerified = true;
      window.location.assign("TeacherDashBoard.html");
    } catch (error) {
      if (authenticated && !signInVerified) {
        try {
          await signOut(auth);
        } catch (signOutError) {
          console.error("[TeacherLogin] Unable to clear unverified session:", {
            code: signOutError?.code || "unknown",
            message: signOutError?.message || String(signOutError),
          });
        }
      }
      clearPortalProfileCaches();
      console.error("[TeacherLogin] Sign-in/profile verification failed:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      banner.textContent =
        error?.code === "portal/email-change-pending"
          ? "If your email change is still pending, verify the new address and sign in with your current email until then."
          : error?.code === "profile/role-mismatch"
          ? "This account belongs to a different portal. Sign in through the correct portal."
          : error?.code === "profile/not-found"
          ? "Your account signed in, but no teacher profile was found. Ask an administrator to verify your account."
          : ["permission-denied", "firestore/permission-denied"].includes(error?.code)
          ? "Your account signed in, but its teacher profile could not be read. Ask an administrator to verify profile access."
          : ["unavailable", "firestore/unavailable", "deadline-exceeded", "firestore/deadline-exceeded"].includes(error?.code)
          ? "A network or Firestore error prevented account verification. Check your connection and try again."
          : error?.code?.startsWith("auth/")
          ? ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(error.code)
            ? "Incorrect email or password."
            : error.code === "auth/too-many-requests"
            ? "Too many sign-in attempts. Please wait and try again later."
            : error.code === "auth/network-request-failed"
            ? "A network error prevented sign-in. Check your connection and try again."
            : error.code === "auth/user-disabled"
            ? "This account is disabled. Contact an administrator for help."
            : "Unable to sign in right now. Please try again."
          : "Your account could not be verified for the teacher portal. Contact an administrator.";
      banner.classList.add("show");
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
