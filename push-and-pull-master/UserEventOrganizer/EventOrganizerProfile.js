import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  updatePassword,
  verifyBeforeUpdateEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  auth,
  authReady,
  db,
  isFirebaseConfigured,
} from "../UserStudent/firebaseConfig.js";
import {
  deleteField,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  formatPhilippineMobile,
  isValidPhilippineMobile,
  mobileDigits,
} from "../portalProfileAccount.js";
import {
  CORRECTION_FIELDS_BY_ROLE,
  submitCorrectionRequest,
  subscribeMyCorrectionRequests,
} from "../correctionRequests.js";
import { updatePendingEmailNotice } from "../profilePendingEmail.js";

(() => {
  const profileStorageKey = "recovibeOrganizerProfile";
  const organizerIdKey = "recovibeOrganizerId";
  let profilePageLoadSignaled = false;

  function signalProfilePageReady() {
    if (profilePageLoadSignaled) return;
    profilePageLoadSignaled = true;
    window.dispatchEvent(new Event("page-data-ready"));
  }

  function formatPhilippinePhone(raw) {
    return formatPhilippineMobile(raw);
  }

  const invalidNameCharacters = /[^\p{L}\p{M} .'-]/gu;
  const validNamePattern = /^(?=.*\p{L})[\p{L}\p{M} .'-]+$/u;

  function isValidNamePart(value) {
    return validNamePattern.test(String(value || "").trim());
  }

  const DEFAULT_ORGANIZER = {
    firstName: "",
    middleName: "",
    lastName: "",
    name: "",
    email: "",
    contactNumber: "",
    organizerId: "",
    organization: "",
    role: "Event Organizer",
  };

  let profile = { ...DEFAULT_ORGANIZER };

  try {
    const stored = JSON.parse(localStorage.getItem(profileStorageKey) || "null");
    if (stored && typeof stored === "object") {
      profile = { ...DEFAULT_ORGANIZER, ...stored };
      if (!profile.firstName && profile.name) {
        const parts = profile.name.trim().split(/\s+/).filter(Boolean);
        profile.firstName = parts[0] || "";
        profile.lastName = parts.length > 1 ? parts[parts.length - 1] : "";
        profile.middleName = parts.length > 2 ? parts.slice(1, -1).join(" ") : "";
      }
    }
  } catch (error) {
    console.warn("Unable to read organizer profile:", error);
  }

  const storedOrganizerId = localStorage.getItem(organizerIdKey);
  if (storedOrganizerId && storedOrganizerId.includes("@")) {
    profile.email = profile.email || storedOrganizerId;
  }

  function showFeedback(message, isError = false) {
    const alert = document.getElementById("profileFeedbackAlert");
    const alertText = document.getElementById("profileFeedbackText");
    if (!alert || !alertText) return;
    alertText.textContent = message;
    alert.classList.toggle("error", isError);
    alert.hidden = false;
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => {
      toast.classList.remove("show");
    }, 3500);
  }

  function updateDisplay() {
    const firstName = String(profile.firstName || "").trim();
    const middleName = String(profile.middleName || "").trim();
    const lastName = String(profile.lastName || "").trim();
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ") || profile.name || "";
    profile.name = fullName;

    const initials = Array.from(firstName || fullName)[0]?.toUpperCase() || "";
    const org = typeof profile.organization === "object"
      ? profile.organization?.name || profile.organization?.label || profile.organization?.code || ""
      : profile.organization || "";
    const departmentValue = profile.department;
    const department = (
      typeof departmentValue === "object"
        ? departmentValue?.name || departmentValue?.label || departmentValue?.code
        : departmentValue
    ) || profile.departmentName || profile.departmentCode || profile.schoolDepartment || "";
    const storedOrganizerId = [
      profile.accountNumber,
      profile.accountNo,
      profile.organizerNumber,
      profile.organizerNo,
      profile.eoId,
      profile.organizerId,
      localStorage.getItem(organizerIdKey),
    ].map((value) => String(value || "").trim()).find(Boolean) || "";
    const organizationCode = String(
      profile.organizationCode || profile.orgCode || org || profile.organizationName || "",
    ).trim().replace(/\s+/g, "-").toUpperCase();
    const organizerId = /^EO-\d{3}-.+/i.test(storedOrganizerId)
      ? storedOrganizerId.toUpperCase()
      : /^\d+$/.test(storedOrganizerId) && organizationCode
        ? `EO-${storedOrganizerId.padStart(3, "0")}-${organizationCode}`
        : storedOrganizerId;

    // Hero Banner
    const heroAvatar = document.getElementById("heroAvatar");
    if (heroAvatar) heroAvatar.textContent = initials;
    const heroUserName = document.getElementById("heroUserName");
    if (heroUserName) heroUserName.textContent = fullName;
    const heroRoleBadge = document.getElementById("heroRoleBadge");
    if (heroRoleBadge) heroRoleBadge.textContent = "Organizer";

    // Sidebar
    const organizerAvatar = document.getElementById("organizerAvatar");
    if (organizerAvatar) organizerAvatar.textContent = initials;
    const organizerName = document.getElementById("organizerName");
    if (organizerName) organizerName.textContent = fullName;
    const organizerRole = document.getElementById("organizerRole");
    if (organizerRole) organizerRole.textContent = org ? `${org} account` : "Event Organizer";

    // Name Card View
    const viewFirstName = document.getElementById("viewFirstName");
    if (viewFirstName) viewFirstName.textContent = firstName || fullName;
    const viewMiddleName = document.getElementById("viewMiddleName");
    if (viewMiddleName) {
      if (middleName) {
        viewMiddleName.textContent = middleName;
      } else {
        viewMiddleName.innerHTML = '<span class="empty-muted">Not set</span>';
      }
    }
    const viewLastName = document.getElementById("viewLastName");
    if (viewLastName) viewLastName.textContent = lastName;

    // Contact Card View
    const viewEmail = document.getElementById("viewEmail");
    if (viewEmail) viewEmail.textContent = profile.email || "Not set";
    const viewContact = document.getElementById("viewContact");
    if (viewContact) {
      if (profile.contactNumber) {
        viewContact.textContent = formatPhilippinePhone(profile.contactNumber);
      } else {
        viewContact.innerHTML = '<span class="empty-muted">Not set</span>';
      }
    }
    updatePendingEmailNotice(profile, auth?.currentUser);

    // Organizer Details Card View
    const viewOrganizerId = document.getElementById("viewOrganizerId");
    if (viewOrganizerId) viewOrganizerId.textContent = organizerId || "Not set";
    const viewOrganization = document.getElementById("viewOrganization");
    if (viewOrganization) viewOrganization.textContent = org || "Not set";
    const viewDepartment = document.getElementById("viewDepartment");
    if (viewDepartment) viewDepartment.textContent = department || "Not set";
    const viewRole = document.getElementById("viewRole");
    if (viewRole) viewRole.textContent = profile.role || "Event Organizer";
  }

  async function persistOrganizerProfileFields(uid, fields) {
    if (!db || !isFirebaseConfigured) throw new Error("Profile storage is unavailable.");
    const profileRef = doc(db, "users", uid);
    await setDoc(profileRef, fields, { merge: true });
    const snapshot = await getDoc(profileRef);
    if (!snapshot.exists()) {
      throw new Error("The updated organizer profile could not be verified.");
    }
    return snapshot.data();
  }

  async function saveOrganizerProfileFields(uid, fields) {
    const persisted = await persistOrganizerProfileFields(uid, fields);
    for (const [field, expectedValue] of Object.entries(fields)) {
      if (persisted[field] !== expectedValue) {
        throw new Error("The organizer profile update could not be verified. Please try again.");
      }
    }
    return fields;
  }

  function syncProfileEmail(authUser) {
    profile.uid = authUser.uid;
    if (authUser.email) profile.email = authUser.email;
    localStorage.setItem(profileStorageKey, JSON.stringify(profile));
    updateDisplay();
    void syncVerifiedOrganizerEmail(authUser).then((result) => {
      if (!result || auth?.currentUser?.uid !== authUser.uid) return;
      profile.uid = authUser.uid;
      profile.email = result.email;
      if (result.pendingEmail) profile.pendingEmail = result.pendingEmail;
      else delete profile.pendingEmail;
      localStorage.setItem(profileStorageKey, JSON.stringify(profile));
      updateDisplay();
      if (result.changed) showFeedback("Email address verified and updated.");
    }).catch((error) => {
      console.warn("[EventOrganizerProfile] Could not sync verified email:", error);
    });
  }

  async function syncVerifiedOrganizerEmail(authUser) {
    if (!db || !isFirebaseConfigured || !authUser?.uid) return null;
    await authUser.reload();
    const currentUser = auth?.currentUser;
    const email = String(currentUser?.email || "").trim();
    if (!currentUser || currentUser.uid !== authUser.uid || !currentUser.emailVerified || !email) {
      return null;
    }

    const profileRef = doc(db, "users", authUser.uid);
    const profileSnapshot = await getDoc(profileRef);
    const data = profileSnapshot.exists() ? profileSnapshot.data() : {};
    const normalizedEmail = email.toLowerCase();
    const updates = {};
    if (String(data.email || "").trim().toLowerCase() !== normalizedEmail) {
      updates.email = email;
    }
    if (String(data.pendingEmail || "").trim().toLowerCase() === normalizedEmail) {
      updates.pendingEmail = deleteField();
    }
    if (Object.keys(updates).length) {
      const persisted = await persistOrganizerProfileFields(authUser.uid, updates);
      if (String(persisted.email || "").trim().toLowerCase() !== normalizedEmail) {
        throw new Error("The verified email could not be confirmed in the organizer profile.");
      }
      if (
        updates.pendingEmail &&
        String(persisted.pendingEmail || "").trim().toLowerCase() === normalizedEmail
      ) {
        throw new Error("The verified email is still marked as pending in the organizer profile.");
      }
    }

    const localPendingKey = `recovibe_pending_email_${authUser.uid}`;
    let localPendingEmail = "";
    try {
      localPendingEmail = String(
        JSON.parse(localStorage.getItem(localPendingKey) || "null")?.pendingEmail || "",
      ).trim().toLowerCase();
    } catch (error) {
      console.warn("[EventOrganizerProfile] Could not read pending email change:", error);
    }
    const localPendingConfirmed = localPendingEmail === normalizedEmail;
    if (localPendingConfirmed) {
      localStorage.removeItem(localPendingKey);
      sessionStorage.removeItem(localPendingKey);
    }

    const pendingEmail = String(data.pendingEmail || "").trim();
    const stillPendingEmail = pendingEmail && pendingEmail.toLowerCase() !== normalizedEmail
      ? pendingEmail
      : "";
    return Object.keys(updates).length || localPendingConfirmed
      ? { email, changed: true, pendingEmail: stillPendingEmail }
      : null;
  }

  async function loadOrganizerSelfProfile(authUser) {
    if (!db || !isFirebaseConfigured || !authUser?.uid) return;
    const snapshot = await getDoc(doc(db, "users", authUser.uid));
    if (!snapshot.exists() || auth?.currentUser?.uid !== authUser.uid) return;
    const savedProfile = snapshot.data();
    const editableFields = [
      "firstName",
      "middleName",
      "lastName",
      "fullName",
      "name",
      "contactNumber",
    ];
    const savedFields = Object.fromEntries(editableFields
      .filter((field) => typeof savedProfile[field] === "string")
      .map((field) => [field, savedProfile[field]]));
    profile = {
      ...profile,
      ...savedFields,
      uid: authUser.uid,
      email: authUser.email || profile.email,
    };
    localStorage.setItem(profileStorageKey, JSON.stringify(profile));
    updateDisplay();
  }

  /* -------------------------------------------------------------
     NAME CARD EDITING
  ------------------------------------------------------------- */
  const btnEditName = document.getElementById("btnEditName");
  const nameCardView = document.getElementById("nameCardView");
  const nameCardEdit = document.getElementById("nameCardEdit");
  const inputFirstName = document.getElementById("inputFirstName");
  const inputMiddleName = document.getElementById("inputMiddleName");
  const inputLastName = document.getElementById("inputLastName");
  const nameUnsavedCount = document.getElementById("nameUnsavedCount");
  const nameCancelBtn = document.getElementById("nameCancelBtn");
  const nameSaveBtn = document.getElementById("nameSaveBtn");
  const errFirstName = document.getElementById("errFirstName");
  const errLastName = document.getElementById("errLastName");

  function setNameEditMode(editing) {
    if (!nameCardView || !nameCardEdit) return;
    if (editing) {
      inputFirstName.value = profile.firstName || "";
      inputMiddleName.value = profile.middleName || "";
      inputLastName.value = profile.lastName || "";
      inputFirstName.classList.remove("is-invalid");
      inputMiddleName.classList.remove("is-invalid");
      inputLastName.classList.remove("is-invalid");
      if (errFirstName) errFirstName.classList.remove("is-visible");
      const errMiddleName = document.getElementById("errMiddleName");
      if (errMiddleName) errMiddleName.classList.remove("is-visible");
      if (errLastName) errLastName.classList.remove("is-visible");
      checkNameDirty();
      nameCardView.hidden = true;
      nameCardEdit.hidden = false;
      inputFirstName.focus();
    } else {
      nameCardEdit.hidden = true;
      nameCardView.hidden = false;
    }
  }

  function checkNameDirty() {
    const origFirst = (profile.firstName || "").trim();
    const origMid = (profile.middleName || "").trim();
    const origLast = (profile.lastName || "").trim();
    const curFirst = inputFirstName.value.trim();
    const curMid = inputMiddleName.value.trim();
    const curLast = inputLastName.value.trim();

    let changes = 0;
    if (curFirst !== origFirst) changes++;
    if (curMid !== origMid) changes++;
    if (curLast !== origLast) changes++;

    const isValid =
      isValidNamePart(curFirst) &&
      (!curMid || isValidNamePart(curMid)) &&
      isValidNamePart(curLast);
    const isDirty = changes > 0;

    nameSaveBtn.disabled = !isDirty || !isValid;
    nameUnsavedCount.classList.toggle("is-dirty", isDirty);
    if (!isDirty) {
      nameUnsavedCount.textContent = "No changes yet";
    } else {
      nameUnsavedCount.textContent = `${changes} unsaved ${changes === 1 ? "change" : "changes"}`;
    }
  }

  if (btnEditName) {
    btnEditName.addEventListener("click", () => setNameEditMode(true));
  }
  if (nameCancelBtn) {
    nameCancelBtn.addEventListener("click", () => setNameEditMode(false));
  }
  [inputFirstName, inputMiddleName, inputLastName].forEach((input) => {
    if (!input) return;
    input.addEventListener("input", () => {
      input.value = input.value.replace(invalidNameCharacters, "");
      const errorId = input === inputFirstName
        ? "errFirstName"
        : input === inputMiddleName
          ? "errMiddleName"
          : "errLastName";
      const valid = input === inputMiddleName
        ? !input.value.trim() || isValidNamePart(input.value)
        : isValidNamePart(input.value);
      const errorElement = document.getElementById(errorId);
      if (valid) {
        input.classList.remove("is-invalid");
        errorElement?.classList.remove("is-visible");
      } else {
        input.classList.add("is-invalid");
        if (errorElement) {
          errorElement.textContent = input.value.trim()
            ? "Use letters, spaces, hyphens, periods, and apostrophes only."
            : `${input === inputFirstName ? "First" : "Last"} name is required.`;
          errorElement.classList.add("is-visible");
        }
      }
      checkNameDirty();
    });
  });

  if (nameCardEdit) {
    nameCardEdit.addEventListener("submit", async (e) => {
      e.preventDefault();
      const first = inputFirstName.value.trim();
      const mid = inputMiddleName.value.trim();
      const last = inputLastName.value.trim();
      const firstValid = isValidNamePart(first);
      const middleValid = !mid || isValidNamePart(mid);
      const lastValid = isValidNamePart(last);

      let hasError = false;
      if (!firstValid) {
        inputFirstName.classList.add("is-invalid");
        if (errFirstName) {
          errFirstName.textContent = first ? "Use letters, spaces, hyphens, periods, and apostrophes only." : "First name is required.";
          errFirstName.classList.add("is-visible");
        }
        hasError = true;
      } else {
        inputFirstName.classList.remove("is-invalid");
        if (errFirstName) errFirstName.classList.remove("is-visible");
      }

      if (!middleValid) {
        inputMiddleName.classList.add("is-invalid");
        const errMiddleName = document.getElementById("errMiddleName");
        if (errMiddleName) {
          errMiddleName.textContent = "Use letters, spaces, hyphens, periods, and apostrophes only.";
          errMiddleName.classList.add("is-visible");
        }
        hasError = true;
      } else {
        inputMiddleName.classList.remove("is-invalid");
        const errMiddleName = document.getElementById("errMiddleName");
        if (errMiddleName) errMiddleName.classList.remove("is-visible");
      }

      if (!lastValid) {
        inputLastName.classList.add("is-invalid");
        if (errLastName) {
          errLastName.textContent = last ? "Use letters, spaces, hyphens, periods, and apostrophes only." : "Last name is required.";
          errLastName.classList.add("is-visible");
        }
        hasError = true;
      } else {
        inputLastName.classList.remove("is-invalid");
        if (errLastName) errLastName.classList.remove("is-visible");
      }

      if (hasError) return;

      const authUser = auth?.currentUser;
      if (!authUser?.uid || authUser.uid !== profile.uid || !db) {
        showFeedback("Sign in again before updating your profile name.", true);
        return;
      }

      const updatedNameFields = {
        firstName: first,
        middleName: mid,
        lastName: last,
        fullName: [first, mid, last].filter(Boolean).join(" "),
        name: [first, mid, last].filter(Boolean).join(" "),
      };
      nameSaveBtn.disabled = true;
      nameSaveBtn.textContent = "Saving...";
      try {
        const savedNameFields = await saveOrganizerProfileFields(authUser.uid, updatedNameFields);
        profile = { ...profile, ...savedNameFields };
        localStorage.setItem(profileStorageKey, JSON.stringify(profile));
        updateDisplay();
        setNameEditMode(false);
        showFeedback("Profile name updated successfully.");
      } catch (error) {
        console.error("[EventOrganizerProfile] Could not update organizer name:", error);
        const message = error?.code === "permission-denied"
          ? "Your name could not be saved because profile access was denied. Contact an administrator."
          : error?.message || "Could not save your name. Please try again.";
        showFeedback(message, true);
      } finally {
        nameSaveBtn.textContent = "Save";
        checkNameDirty();
      }
    });
  }

  /* -------------------------------------------------------------
     CONTACT CARD EDITING
  ------------------------------------------------------------- */
  const btnEditContact = document.getElementById("btnEditContact");
  const contactCardView = document.getElementById("contactCardView");
  const contactCardEdit = document.getElementById("contactCardEdit");
  const inputContactEmail = document.getElementById("inputContactEmail");
  const inputContactPhone = document.getElementById("inputContactPhone");
  const contactUnsavedCount = document.getElementById("contactUnsavedCount");
  const contactCancelBtn = document.getElementById("contactCancelBtn");
  const contactSaveBtn = document.getElementById("contactSaveBtn");
  const errContactEmail = document.getElementById("errContactEmail");
  const errContactPhone = document.getElementById("errContactPhone");

  function setContactEditMode(editing) {
    if (!contactCardView || !contactCardEdit) return;
    if (editing) {
      inputContactEmail.value = profile.email || "";
      inputContactPhone.value = formatPhilippinePhone(profile.contactNumber || "");
      inputContactEmail.classList.remove("is-invalid");
      inputContactPhone.classList.remove("is-invalid");
      if (errContactEmail) errContactEmail.classList.remove("is-visible");
      if (errContactPhone) errContactPhone.classList.remove("is-visible");
      checkContactDirty();
      contactCardView.hidden = true;
      contactCardEdit.hidden = false;
      inputContactEmail.focus();
    } else {
      contactCardEdit.hidden = true;
      contactCardView.hidden = false;
    }
  }

  function checkContactDirty() {
    const origEmail = (profile.email || "").trim().toLowerCase();
    const origPhone = mobileDigits(profile.contactNumber);
    const curEmail = inputContactEmail.value.trim().toLowerCase();
    const curPhone = mobileDigits(inputContactPhone.value);

    let changes = 0;
    if (curEmail !== origEmail) changes++;
    if (curPhone !== origPhone) changes++;

    const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(curEmail);
    const isPhoneValid = isValidPhilippineMobile(curPhone);
    const isValid = isEmailValid && isPhoneValid;
    const isDirty = changes > 0;

    if (!isEmailValid) {
      inputContactEmail.classList.add("is-invalid");
      if (errContactEmail) {
        errContactEmail.textContent = "Enter a valid email address.";
        errContactEmail.classList.add("is-visible");
      }
    }
    if (!isPhoneValid) {
      inputContactPhone.classList.add("is-invalid");
      if (errContactPhone) {
        errContactPhone.textContent = curPhone
          ? "Enter a valid 11-digit mobile number starting with 09."
          : "Contact number is required.";
        errContactPhone.classList.add("is-visible");
      }
    } else {
      inputContactPhone.classList.remove("is-invalid");
      if (errContactPhone) errContactPhone.classList.remove("is-visible");
    }

    contactSaveBtn.disabled = !isDirty || !isValid;
    contactUnsavedCount.classList.toggle("is-dirty", isDirty);
    if (!isDirty) {
      contactUnsavedCount.textContent = "No changes yet";
    } else {
      contactUnsavedCount.textContent = `${changes} unsaved ${changes === 1 ? "change" : "changes"}`;
    }
  }

  if (btnEditContact) {
    btnEditContact.addEventListener("click", () => setContactEditMode(true));
  }
  if (contactCancelBtn) {
    contactCancelBtn.addEventListener("click", () => setContactEditMode(false));
  }
  if (inputContactEmail) {
    inputContactEmail.addEventListener("input", () => {
      inputContactEmail.classList.remove("is-invalid");
      if (errContactEmail) {
        errContactEmail.textContent = "Enter a valid email address.";
        errContactEmail.classList.remove("is-visible");
      }
      checkContactDirty();
    });
  }
  if (inputContactPhone) {
    inputContactPhone.addEventListener("input", (e) => {
      const formatted = formatPhilippinePhone(e.target.value);
      e.target.value = formatted;
      checkContactDirty();
    });
  }

  if (contactCardEdit) {
    contactCardEdit.addEventListener("submit", async (e) => {
      e.preventDefault();
      const emailVal = inputContactEmail.value.trim().toLowerCase();
      const rawPhone = mobileDigits(inputContactPhone.value);
      const authUser = auth?.currentUser;
      const currentEmail = String(authUser?.email || profile.email || "").trim().toLowerCase();
      const emailChanged = emailVal !== currentEmail;
      const phoneChanged = rawPhone !== mobileDigits(profile.contactNumber);

      let hasError = false;
      if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        inputContactEmail.classList.add("is-invalid");
        if (errContactEmail) {
          errContactEmail.textContent = "Enter a valid email address.";
          errContactEmail.classList.add("is-visible");
        }
        hasError = true;
      } else {
        inputContactEmail.classList.remove("is-invalid");
        if (errContactEmail) errContactEmail.classList.remove("is-visible");
      }

      if (!isValidPhilippineMobile(rawPhone)) {
        inputContactPhone.classList.add("is-invalid");
        if (errContactPhone) {
          errContactPhone.textContent = "Enter a valid 11-digit mobile number starting with 09.";
          errContactPhone.classList.add("is-visible");
        }
        hasError = true;
      } else {
        inputContactPhone.classList.remove("is-invalid");
        if (errContactPhone) errContactPhone.classList.remove("is-visible");
      }

      if (hasError) return;

      if (!authUser?.uid || authUser.uid !== profile.uid || !db) {
        showFeedback("Sign in again before updating your contact details.", true);
        return;
      }

      contactSaveBtn.disabled = true;
      contactSaveBtn.textContent = "Saving...";
      let phoneSaved = false;
      let pendingEmailSyncWarning = false;
      let verificationAuthErrorCode = "";
      try {
        if (phoneChanged) {
          const savedContactFields = await saveOrganizerProfileFields(
            authUser.uid,
            { contactNumber: rawPhone },
          );
          profile = { ...profile, ...savedContactFields };
          phoneSaved = true;
        }
        if (emailChanged) {
          try {
            await verifyBeforeUpdateEmail(authUser, emailVal);
          } catch (authError) {
            verificationAuthErrorCode = authError?.code || "unknown";
            console.error("[EventOrganizerProfile] Firebase Auth email verification failed:", {
              code: verificationAuthErrorCode,
              error: authError,
            });
            throw authError;
          }
          profile.pendingEmail = emailVal;
          localStorage.setItem(
            `recovibe_pending_email_${authUser.uid}`,
            JSON.stringify({ pendingEmail: emailVal, oldEmail: profile.email, timestamp: Date.now() }),
          );
          try {
            await saveOrganizerProfileFields(authUser.uid, { pendingEmail: emailVal });
          } catch (pendingEmailError) {
            pendingEmailSyncWarning = true;
            console.warn("[EventOrganizerProfile] Could not save pending email for sign-in fallback:", pendingEmailError);
          }
        }
        localStorage.setItem(profileStorageKey, JSON.stringify(profile));
        updateDisplay();
        setContactEditMode(false);
        showFeedback(emailChanged
          ? `Verification was sent. Sign in with your current email until the new address is confirmed. If it does not arrive in Gmail (including Spam), delivery may be delayed or blocked at Firebase or mail provider level.`
          : "Contact details updated successfully.",
        pendingEmailSyncWarning);
      } catch (error) {
        console.error("[EventOrganizerProfile] Could not update contact details:", {
          code: error?.code || "unknown",
          error,
        });
        if (phoneSaved) {
          localStorage.setItem(profileStorageKey, JSON.stringify(profile));
          updateDisplay();
        }
        let message = error?.message || "Could not update contact details.";
        if (["auth/email-already-in-use", "auth/credential-already-in-use"].includes(error?.code)) {
          message = "That email address is already registered. Use a different email.";
          inputContactEmail.classList.add("is-invalid");
          if (errContactEmail) {
            errContactEmail.textContent = message;
            errContactEmail.classList.add("is-visible");
          }
        } else if (error?.code === "auth/invalid-email") {
          message = "Enter a valid email address.";
        } else if (error?.code === "auth/requires-recent-login") {
          message = "Please sign in again before changing your email address.";
        }
        if (verificationAuthErrorCode) {
          message = `${message} (Firebase Auth error: ${verificationAuthErrorCode})`;
        }
        if (phoneSaved) message = `Contact number saved. ${message}`;
        showFeedback(message, true);
      } finally {
        contactSaveBtn.disabled = false;
        contactSaveBtn.textContent = "Save";
        checkContactDirty();
      }
    });
  }

  /* -------------------------------------------------------------
     PASSWORD MODAL
  ------------------------------------------------------------- */
  const changePasswordBtn = document.getElementById("changePassword");
  const passwordModal = document.getElementById("passwordFormModal");
  const passwordForm = document.getElementById("passwordForm");
  const closePasswordModal = document.getElementById("closePasswordModal");
  const cancelPasswordChange = document.getElementById("cancelPasswordChange");
  const currentPasswordInput = document.getElementById("currentPassword");
  const newPasswordInput = document.getElementById("newPassword");
  const confirmPasswordInput = document.getElementById("confirmPassword");
  const passwordStatus = document.getElementById("passwordFormStatus");
  const passwordSubmitButton = passwordForm?.querySelector('button[type="submit"]');

  function resetPasswordFields() {
    passwordForm?.reset();
    document.querySelectorAll("[data-password-toggle]").forEach((button) => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (input) input.type = "password";
      button.setAttribute("aria-pressed", "false");
      const passwordName = button.dataset.passwordToggle === "currentPassword"
        ? "current password"
        : button.dataset.passwordToggle === "newPassword"
          ? "new password"
          : "confirmed password";
      button.setAttribute("aria-label", `Show ${passwordName}`);
      button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>';
    });
    if (passwordStatus) {
      passwordStatus.textContent = "";
    }
  }

  function openPasswordModal() {
    if (!passwordModal) return;
    resetPasswordFields();
    passwordModal.hidden = false;
    if (currentPasswordInput) currentPasswordInput.focus();
  }

  function closePasswordModalHandler() {
    if (!passwordModal) return;
    passwordModal.hidden = true;
    resetPasswordFields();
  }

  if (changePasswordBtn) changePasswordBtn.addEventListener("click", openPasswordModal);
  if (closePasswordModal) closePasswordModal.addEventListener("click", closePasswordModalHandler);
  if (cancelPasswordChange) cancelPasswordChange.addEventListener("click", closePasswordModalHandler);
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.passwordToggle);
      if (!input) return;
      const showPassword = input.type === "password";
      input.type = showPassword ? "text" : "password";
      button.setAttribute("aria-pressed", String(showPassword));
      const passwordName = button.dataset.passwordToggle === "currentPassword"
        ? "current password"
        : button.dataset.passwordToggle === "newPassword"
          ? "new password"
          : "confirmed password";
      button.setAttribute("aria-label", `${showPassword ? "Hide" : "Show"} ${passwordName}`);
      button.innerHTML = showPassword
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.1 0 9.5 7 9.5 7a15.7 15.7 0 0 1-3.1 3.8M6.2 6.2C3.9 7.7 2.5 12 2.5 12s3.4 7 9.5 7c1 0 1.9-.2 2.7-.5"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>';
    });
  });
  if (passwordModal) {
    passwordModal.addEventListener("click", (e) => {
      if (e.target === passwordModal || e.target.classList.contains("modal-backdrop")) {
        closePasswordModalHandler();
      }
    });
  }

  if (passwordForm) {
    passwordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const cur = currentPasswordInput?.value || "";
      const nw = newPasswordInput?.value || "";
      const conf = confirmPasswordInput?.value || "";
      if (passwordStatus) {
        passwordStatus.textContent = "";
      }

      if (!cur) {
        if (passwordStatus) passwordStatus.textContent = "Please enter your current password.";
        currentPasswordInput.focus();
        return;
      }
      if (nw.length < 6) {
        if (passwordStatus) passwordStatus.textContent = "New password must be at least 6 characters.";
        newPasswordInput.focus();
        return;
      }
      if (nw !== conf) {
        if (passwordStatus) passwordStatus.textContent = "New passwords do not match.";
        confirmPasswordInput.focus();
        return;
      }
      if (nw === cur) {
        if (passwordStatus) passwordStatus.textContent = "Choose a new password different from your current password.";
        newPasswordInput.focus();
        return;
      }

      const authUser = auth?.currentUser;
      if (!authUser?.email) {
        if (passwordStatus) passwordStatus.textContent = "Sign in again before changing your password.";
        return;
      }
      if (passwordSubmitButton) {
        passwordSubmitButton.disabled = true;
        passwordSubmitButton.textContent = "Updating...";
      }
      try {
        const credential = EmailAuthProvider.credential(authUser.email, cur);
        await reauthenticateWithCredential(authUser, credential);
        await updatePassword(authUser, nw);
        localStorage.removeItem("recovibeOrganizerPassword");
        closePasswordModalHandler();
        showToast("Password updated successfully.");
        showFeedback("Password changed successfully.");
      } catch (error) {
        console.error("[EventOrganizerProfile] Could not change password:", error);
        const message = ["auth/wrong-password", "auth/invalid-credential"].includes(error?.code)
          ? "Current password is incorrect."
          : error?.code === "auth/weak-password"
            ? "New password must be at least 6 characters."
            : error?.code === "auth/requires-recent-login"
              ? "Please sign in again before changing your password."
              : error?.code === "auth/too-many-requests"
                ? "Too many attempts. Please wait and try again."
                : error?.code === "auth/network-request-failed"
                  ? "Network error. Check your connection and try again."
                  : error?.message || "Could not change your password. Please try again.";
        if (passwordStatus) passwordStatus.textContent = message;
      } finally {
        if (passwordSubmitButton) {
          passwordSubmitButton.disabled = false;
          passwordSubmitButton.textContent = "Update Password";
        }
      }
    });
  }

  /* -------------------------------------------------------------
     REQUEST A CORRECTION MODAL
  ------------------------------------------------------------- */
  const btnRequestCorrection = document.getElementById("btnRequestCorrection");
  const correctionModal = document.getElementById("correctionModalOverlay");
  const closeCorrectionModal = document.getElementById("closeCorrectionModal");
  const btnCancelCorrection = document.getElementById("btnCancelCorrection");
  const correctionForm = document.getElementById("correctionForm");
  const correctionFieldSelect = document.getElementById("correctionFieldSelect");
  const correctionCurrentValue = document.getElementById("correctionCurrentValue");
  const correctionMessageInput = document.getElementById("correctionMessageInput");
  const correctionReasonInput = document.getElementById("correctionReasonInput");
  const errCorrectionField = document.getElementById("errCorrectionField");
  const errCorrectionMessage = document.getElementById("errCorrectionMessage");
  const errCorrectionReason = document.getElementById("errCorrectionReason");
  const correctionReasonCount = document.getElementById("correctionReasonCount");
  const correctionSubmitStatus = document.getElementById("correctionSubmitStatus");
  const correctionRequestsContent = document.getElementById("correctionRequestsContent");
  const correctionFields = CORRECTION_FIELDS_BY_ROLE.eventorganizer;
  const correctionFieldElements = {
    organization: "viewOrganization",
    position: "viewRole",
  };
  let correctionRequests = [];
  let correctionRequestsLoading = true;
  let correctionRequestsError = "";
  let correctionRequestsUnsubscribe = null;
  let correctionAuthUnsubscribe = null;
  let correctionRequestsTimeout = null;
  let correctionAuthGeneration = 0;
  let correctionAuthUser = null;
  let correctionSubmitInFlight = false;
  let correctionActive = true;

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
    return document.getElementById(correctionFieldElements[field])?.textContent?.trim() || "";
  }

  function correctionTimestamp(value) {
    if (value && typeof value.toMillis === "function") return value.toMillis();
    if (value && typeof value.toDate === "function") return value.toDate().getTime();
    if (value && typeof value.seconds === "number") return value.seconds * 1000;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    return null;
  }

  function updateCorrectionSubmitButton() {
    const btnSendCorrection = document.getElementById("btnSendCorrection");
    if (!btnSendCorrection) return;
    btnSendCorrection.disabled = correctionSubmitInFlight;
    btnSendCorrection.textContent = correctionSubmitInFlight ? "Sending..." : "Send request";
  }

  function updatePendingCorrectionFields() {
    if (!correctionFieldSelect) return;
    const pending = new Set(correctionRequests
      .filter((request) => String(request.status || "").trim().toLowerCase() === "pending")
      .map((request) => request.field));
    [...correctionFieldSelect.options].forEach((option) => {
      if (!option.value) return;
      const field = correctionFields.find((item) => item.field === option.value);
      option.disabled = pending.has(option.value);
      option.textContent = option.disabled ? `${field.label} - Request pending` : field.label;
    });
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
    correctionRequestsContent.innerHTML = correctionRequests.map((request) => {
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
        || correctionFields.find((item) => item.field === request.field)?.label
        || "Organizer detail";
      const reviewerNote = String(request.reviewNote || "").trim();
      return `<article class="cr-request-item">
        <p class="cr-request-field">${escapeCorrectionHtml(label)}</p>
        <span class="cr-status-pill${statusClass}">${status[0].toUpperCase()}${status.slice(1)}</span>
        <p class="cr-request-values">${escapeCorrectionHtml(request.currentValue)} &rarr; ${escapeCorrectionHtml(request.requestedValue)}</p>
        <p class="cr-request-date">${escapeCorrectionHtml(date)}</p>
        ${reviewerNote ? `<p class="cr-request-note"><strong>Reviewer note:</strong> ${escapeCorrectionHtml(reviewerNote)}</p>` : ""}
      </article>`;
    }).join("");
    updatePendingCorrectionFields();
    updateCorrectionSubmitButton();
  }

  function stopCorrectionRequests() {
    correctionRequestsUnsubscribe?.();
    correctionRequestsUnsubscribe = null;
    clearTimeout(correctionRequestsTimeout);
    correctionRequestsTimeout = null;
  }

  function startCorrectionRequests(user) {
    stopCorrectionRequests();
    correctionRequests = [];
    correctionRequestsLoading = true;
    correctionRequestsError = "";
    renderCorrectionRequests();
    updatePendingCorrectionFields();
    if (!user?.uid || auth?.currentUser?.uid !== user.uid || !db) {
      correctionRequestsLoading = false;
      correctionRequestsError = "Sign in to view your correction requests.";
      renderCorrectionRequests();
      signalProfilePageReady();
      return;
    }

    correctionRequestsTimeout = setTimeout(() => {
      if (!correctionRequestsLoading) return;
      correctionRequestsLoading = false;
      correctionRequestsError = "Requests are taking longer than expected to load.";
      renderCorrectionRequests();
      signalProfilePageReady();
    }, 5000);
    try {
      correctionRequestsUnsubscribe = subscribeMyCorrectionRequests(
        user.uid,
        (requests) => {
          correctionRequests = requests;
          correctionRequestsLoading = false;
          correctionRequestsError = "";
          clearTimeout(correctionRequestsTimeout);
          correctionRequestsTimeout = null;
          updatePendingCorrectionFields();
          renderCorrectionRequests();
          signalProfilePageReady();
        },
        (error) => {
          correctionRequestsLoading = false;
          correctionRequestsError = error?.code === "permission-denied"
            ? "You don't have permission to view your correction requests."
            : "Couldn't load your requests. Check your connection and retry.";
          clearTimeout(correctionRequestsTimeout);
          correctionRequestsTimeout = null;
          renderCorrectionRequests();
          signalProfilePageReady();
        },
      );
    } catch (error) {
      correctionRequestsLoading = false;
      correctionRequestsError = error?.message || "Couldn't load your requests. Check your connection and retry.";
      clearTimeout(correctionRequestsTimeout);
      correctionRequestsTimeout = null;
      renderCorrectionRequests();
      signalProfilePageReady();
    }
  }

  async function startCorrectionAuth() {
    const generation = ++correctionAuthGeneration;
    correctionRequestsLoading = true;
    correctionRequestsError = "";
    renderCorrectionRequests();
    correctionRequestsTimeout = setTimeout(() => {
      if (!correctionRequestsLoading) return;
      correctionRequestsLoading = false;
      correctionRequestsError = "Authentication is taking longer than expected.";
      renderCorrectionRequests();
      signalProfilePageReady();
    }, 5000);
    try {
      await authReady;
      if (!correctionActive || generation !== correctionAuthGeneration) return;
      if (!auth || !isFirebaseConfigured) {
        clearTimeout(correctionRequestsTimeout);
        correctionRequestsTimeout = null;
        correctionRequestsLoading = false;
        correctionRequestsError = "Correction requests are unavailable.";
        renderCorrectionRequests();
        signalProfilePageReady();
        return;
      }
      correctionAuthUnsubscribe = onAuthStateChanged(auth, (user) => {
        if (!correctionActive || generation !== correctionAuthGeneration) return;
        clearTimeout(correctionRequestsTimeout);
        correctionRequestsTimeout = null;
        if (!user?.uid) {
          stopCorrectionRequests();
          correctionAuthUser = null;
          correctionRequestsLoading = false;
          correctionRequestsError = "Sign in to view your correction requests.";
          renderCorrectionRequests();
          signalProfilePageReady();
          window.location.replace("EventOrganizerLogin.html");
          return;
        }
        correctionAuthUser = user;
        syncProfileEmail(user);
        void loadOrganizerSelfProfile(user).catch((error) => {
          console.warn("[EventOrganizerProfile] Could not load saved profile fields:", error);
        });
        startCorrectionRequests(user);
      });
    } catch (error) {
      clearTimeout(correctionRequestsTimeout);
      correctionRequestsTimeout = null;
      correctionRequestsLoading = false;
      correctionRequestsError = error?.message || "Couldn't initialize your correction requests.";
      renderCorrectionRequests();
      signalProfilePageReady();
    }
  }

  function stopCorrectionAuth() {
    correctionActive = false;
    correctionAuthGeneration += 1;
    correctionAuthUnsubscribe?.();
    correctionAuthUnsubscribe = null;
    stopCorrectionRequests();
  }

  function openCorrectionModal() {
    if (!correctionModal) return;
    if (correctionForm) correctionForm.reset();
    if (errCorrectionField) errCorrectionField.classList.remove("is-visible");
    if (errCorrectionMessage) errCorrectionMessage.classList.remove("is-visible");
    if (errCorrectionReason) errCorrectionReason.classList.remove("is-visible");
    if (correctionCurrentValue) correctionCurrentValue.value = "";
    if (correctionReasonCount) correctionReasonCount.textContent = "0";
    if (correctionSubmitStatus) correctionSubmitStatus.textContent = "";
    correctionSubmitStatus?.classList.remove("cr-is-error");
    updatePendingCorrectionFields();
    const availableField = [...(correctionFieldSelect?.options || [])]
      .find((option) => option.value && !option.disabled);
    if (availableField) correctionFieldSelect.value = availableField.value;
    if (correctionCurrentValue) {
      correctionCurrentValue.value = correctionCurrentValueFor(correctionFieldSelect?.value || "");
    }
    correctionModal.hidden = false;
    if (correctionFieldSelect) correctionFieldSelect.focus();
  }

  function closeCorrectionModalHandler() {
    if (!correctionModal || correctionSubmitInFlight) return;
    correctionModal.hidden = true;
  }

  correctionFields.forEach(({ field, label }) => {
    const option = document.createElement("option");
    option.value = field;
    option.textContent = label;
    correctionFieldSelect?.append(option);
  });
  correctionFieldSelect?.addEventListener("change", () => {
    if (correctionCurrentValue) {
      correctionCurrentValue.value = correctionCurrentValueFor(correctionFieldSelect.value);
    }
    errCorrectionField?.classList.remove("is-visible");
  });
  correctionReasonInput?.addEventListener("input", () => {
    if (correctionReasonCount) correctionReasonCount.textContent = String(correctionReasonInput.value.length);
    errCorrectionReason?.classList.remove("is-visible");
  });
  if (btnRequestCorrection) btnRequestCorrection.addEventListener("click", openCorrectionModal);
  if (closeCorrectionModal) closeCorrectionModal.addEventListener("click", closeCorrectionModalHandler);
  if (btnCancelCorrection) btnCancelCorrection.addEventListener("click", closeCorrectionModalHandler);
  if (correctionModal) {
    correctionModal.addEventListener("click", (e) => {
      if (e.target === correctionModal || e.target.classList.contains("correction-modal-backdrop")) {
        closeCorrectionModalHandler();
      }
    });
  }

  correctionForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
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
    if (!auth?.currentUser?.uid || auth.currentUser.uid !== correctionAuthUser?.uid) {
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
      const requesterName = [
        profile.firstName,
        profile.middleName,
        profile.lastName,
      ].filter(Boolean).join(" ") || profile.name || auth.currentUser.displayName || "Event Organizer";
      const requesterEmail = auth.currentUser.email || profile.email || "";
      await submitCorrectionRequest({
        field,
        currentValue,
        requestedValue,
        reason,
        requesterRole: "eventorganizer",
        requesterName,
        requesterEmail,
        organization: profile.organization || "",
      });
      correctionSubmitInFlight = false;
      updateCorrectionSubmitButton();
      closeCorrectionModalHandler();
      showToast("Correction request sent to OSAS.");
      showFeedback("Correction request submitted. OSAS will review it.");
    } catch (error) {
      if (correctionSubmitStatus) {
        correctionSubmitStatus.textContent = error?.code === "permission-denied"
          ? "You don't have permission to submit this request."
          : error?.message || "Couldn't send your request. Please try again.";
        correctionSubmitStatus.classList.add("cr-is-error");
      }
    } finally {
      correctionSubmitInFlight = false;
      updateCorrectionSubmitButton();
    }
  });

  correctionRequestsContent?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-retry-correction-requests]")) return;
    if (correctionAuthUser?.uid) startCorrectionRequests(correctionAuthUser);
    else startCorrectionAuth();
  });

  window.addEventListener("pagehide", stopCorrectionAuth);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && auth?.currentUser) syncProfileEmail(auth.currentUser);
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    correctionActive = true;
    startCorrectionAuth();
  });
  startCorrectionAuth();

  /* -------------------------------------------------------------
     FEEDBACK ALERT DISMISS & LOGOUT
  ------------------------------------------------------------- */
  const btnDismissFeedback = document.getElementById("btnDismissFeedback");
  if (btnDismissFeedback) {
    btnDismissFeedback.addEventListener("click", () => {
      const alert = document.getElementById("profileFeedbackAlert");
      if (alert) alert.hidden = true;
    });
  }

  const organizerLogout = document.getElementById("organizerLogout");
  if (organizerLogout) {
    organizerLogout.addEventListener("click", () => {
      localStorage.removeItem("recovibeOrganizerId");
    });
  }

  // Keyboard escape handler for modals
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (passwordModal && !passwordModal.hidden) closePasswordModalHandler();
      if (correctionModal && !correctionModal.hidden) closeCorrectionModalHandler();
    }
  });

  updateDisplay();
  document.getElementById("btnCancelEmailChange")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const authUser = auth?.currentUser;
    if (!authUser?.uid || authUser.uid !== profile.uid || !db || !isFirebaseConfigured) {
      showFeedback("Sign in again before canceling the email change.", true);
      return;
    }

    button.disabled = true;
    try {
      await updateDoc(doc(db, "users", authUser.uid), { pendingEmail: deleteField() });
      const pendingKey = `recovibe_pending_email_${authUser.uid}`;
      localStorage.removeItem(pendingKey);
      sessionStorage.removeItem(pendingKey);
      delete profile.pendingEmail;
      localStorage.setItem(profileStorageKey, JSON.stringify(profile));
      updateDisplay();
      showFeedback("Email change cancelled.");
    } catch (error) {
      console.error("[EventOrganizerProfile] Could not cancel the email change:", error);
      showFeedback(error?.message || "Could not cancel the email change.", true);
    } finally {
      button.disabled = false;
    }
  });
  if (profile.pendingEmail) {
    showFeedback(`Email change pending verification at ${profile.pendingEmail}. Keep using your current email until confirmed.`);
  }
})();
