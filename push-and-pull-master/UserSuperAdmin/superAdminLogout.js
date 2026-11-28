import { signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { buildLogoutRedirectUrl } from "../UserStudent/portalAuthLifecycle.js";

const LOGOUT_TIMEOUT_MS = 3000;
const AUTH_STORAGE_KEYS = [
  "recovibeAdminId",
  "recovibeAdminProfile",
  "recovibeSuperAdminPassword",
];

function removeStorageKeys(storage, storageName) {
  for (const key of AUTH_STORAGE_KEYS) {
    try {
      storage.removeItem(key);
    } catch (error) {
      console.warn(`Could not clear ${storageName} key "${key}" during logout.`, error);
    }
  }
}

function resetLogoutUi(logoutLink) {
  logoutLink?.removeAttribute("aria-busy");
  logoutLink?.removeAttribute("disabled");

  const overlay = document.getElementById("rvLogoutConfirmOverlay") ||
    document.getElementById("confirmModalOverlay");
  if (!overlay) return;

  overlay.removeAttribute("aria-busy");
  const confirmButton = overlay.querySelector(
    "[data-rv-logout-confirm], #confirmModalConfirmBtn",
  );
  const cancelButton = overlay.querySelector(
    "[data-rv-logout-cancel], #confirmModalCancelBtn",
  );
  if (confirmButton) {
    confirmButton.disabled = false;
    confirmButton.textContent = "Log out";
  }
  if (cancelButton) cancelButton.disabled = false;
}

export async function logoutSuperAdmin(auth, logoutLink, loginUrl = "SuperAdminLogin.html") {
  let timeoutId = 0;
  try {
    logoutLink?.setAttribute("aria-busy", "true");
    if (auth) {
      await Promise.race([
        signOut(auth),
        new Promise((_, reject) => {
          timeoutId = window.setTimeout(
            () => reject(new Error("Firebase sign-out timed out.")),
            LOGOUT_TIMEOUT_MS,
          );
        }),
      ]);
    }
  } catch (error) {
    window.clearTimeout(timeoutId);
    console.error("Super Admin sign-out did not complete.", error);
    try {
      window.dispatchEvent(new Event("superadmin-logout-reset"));
      resetLogoutUi(logoutLink);
    } catch (resetError) {
      console.warn("Could not reset the logout controls.", resetError);
    }
    window.alert("Could not sign out. Your session is still active; please try again.");
    return;
  }

  window.clearTimeout(timeoutId);
  try {
    removeStorageKeys(window.localStorage, "localStorage");
  } catch (error) {
    console.warn("Could not access localStorage during logout.", error);
  }
  try {
    removeStorageKeys(window.sessionStorage, "sessionStorage");
  } catch (error) {
    console.warn("Could not access sessionStorage during logout.", error);
  }
  try {
    window.dispatchEvent(new Event("superadmin-logout-reset"));
  } catch (error) {
    console.warn("Could not reset the logout dialog state.", error);
  }
  try {
    resetLogoutUi(logoutLink);
  } catch (error) {
    console.warn("Could not reset the logout controls.", error);
  }

  const logoutUrl = buildLogoutRedirectUrl(loginUrl);
  try {
    window.location.replace(logoutUrl);
  } catch (error) {
    console.error("Could not replace the page with the Super Admin login.", error);
    try {
      window.location.href = logoutUrl;
    } catch (fallbackError) {
      console.error("Could not redirect to the Super Admin login.", fallbackError);
    }
  }
}
