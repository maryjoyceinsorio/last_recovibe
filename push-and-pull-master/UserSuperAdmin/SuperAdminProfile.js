import { auth, authReady, db } from "../UserStudent/firebaseConfig.js";
import { verifyBeforeUpdateEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  deleteField,
  doc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  formatPhilippineMobile,
  isValidPhilippineMobile,
  mobileDigits,
  profileCollectionsForRole,
  savePendingProfileEmail,
  saveProfileFields,
  syncVerifiedProfileEmail,
} from "../portalProfileAccount.js";
import {
  pendingEmailNoticeMarkup,
  updatePendingEmailNotice,
} from "../profilePendingEmail.js";

(async () => {
  await authReady;
  const validNamePattern = /^(?=.*\p{L})[\p{L}\p{M} .'-]+$/u;
  const isValidNamePart = (value) => validNamePattern.test(String(value || "").trim());
  const storageKey = "recovibeAdminProfile";
  const fallback = {
    firstName: "",
    middleName: "",
    lastName: "",
    name: "",
    role: "Super Admin",
    email: "",
    contactNumber: "",
    accountNumber: "",
    department: "",
    organization: "",
    campus: "",
  };

  let profile = { ...fallback };
  document.getElementById("contactCardView")?.insertAdjacentHTML(
    "afterbegin",
    pendingEmailNoticeMarkup,
  );
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (stored && typeof stored === "object") profile = { ...profile, ...stored };
  } catch (error) {
    console.warn("Unable to read Super Admin profile:", error);
  }

  const text = (id, value, fallbackText = "Not set") => {
    const element = document.getElementById(id);
    if (element) element.textContent = value || fallbackText;
  };

  function showFeedback(message, isError = false) {
    text("profileFeedbackText", message);
    const alert = document.getElementById("profileFeedbackAlert");
    if (alert) {
      alert.classList.toggle("error", isError);
      alert.hidden = false;
    }
  }

  function saveProfile() {
    localStorage.setItem(storageKey, JSON.stringify(profile));
  }

  function updateDisplay() {
    const first = String(profile.firstName || "").trim();
    const middle = String(profile.middleName || "").trim();
    const last = String(profile.lastName || "").trim();
    const fullName = [first, middle, last].filter(Boolean).join(" ") || profile.name || "";
    profile.name = fullName;
    const initial = (first || fullName).charAt(0).toUpperCase();
    const accountId = profile.accountNumber || profile.accountNo || profile.employeeId || profile.uid || "Not set";
    text("heroAvatar", initial, "");
    text("sidebar-user-avatar", initial, "");
    text("heroUserName", fullName, "");
    text("sidebar-user-name", fullName, "");
    text("viewFirstName", first);
    const middleEl = document.getElementById("viewMiddleName");
    if (middleEl) middleEl.innerHTML = middle ? middle : '<span class="empty-muted">Not set</span>';
    text("viewLastName", last);
    text("viewEmail", profile.email);
    const contactEl = document.getElementById("viewContact");
    if (contactEl) contactEl.innerHTML = profile.contactNumber || '<span class="empty-muted">Not set</span>';
    text("viewAdminId", accountId);
    const departmentEl = document.getElementById("viewDepartment");
    if (departmentEl) departmentEl.innerHTML = profile.department || profile.organization || '<span class="empty-muted">Not set</span>';
    const designationEl = document.getElementById("viewDesignation");
    if (designationEl) designationEl.innerHTML = profile.designation || profile.role || '<span class="empty-muted">Not set</span>';
    text("viewCampus", profile.campus);
    updatePendingEmailNotice(profile, auth?.currentUser);
  }

  const detailsView = document.getElementById("detailsCardView");
  const detailsEdit = document.getElementById("detailsCardEdit");
  const detailsInputs = ["inputDepartment", "inputDesignation", "inputCampus"]
    .map((id) => document.getElementById(id));
  const detailsSaveButton = document.getElementById("detailsSaveBtn");
  const detailsUnsavedCount = document.getElementById("detailsUnsavedCount");
  const originalDetails = () => [
    profile.department || profile.organization || "",
    profile.designation || profile.role || "",
    profile.campus || "",
  ];
  function updateDetailsDirty() {
    const originals = originalDetails();
    const changed = detailsInputs.some((input, index) => input.value.trim() !== originals[index]);
    detailsUnsavedCount.textContent = changed ? "Unsaved changes" : "No changes yet";
    detailsSaveButton.disabled = !changed;
  }
  document.getElementById("btnEditDetails")?.addEventListener("click", () => {
    document.getElementById("inputDepartment").value = profile.department || profile.organization || "";
    document.getElementById("inputDesignation").value = profile.designation || profile.role || "";
    document.getElementById("inputCampus").value = profile.campus || "";
    document.getElementById("editAdminId").textContent = profile.accountNumber || profile.accountNo || profile.employeeId || profile.uid || "Not set";
    detailsView.hidden = true;
    detailsEdit.hidden = false;
    updateDetailsDirty();
  });
  detailsInputs.forEach((input) => input.addEventListener("input", updateDetailsDirty));
  document.getElementById("detailsCancelBtn")?.addEventListener("click", () => {
    detailsEdit.hidden = true;
    detailsView.hidden = false;
  });
  detailsEdit?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const authUser = auth?.currentUser;
    if (!authUser?.uid || !db) {
      showFeedback("Sign in again before updating your profile details.", true);
      return;
    }
    const updatedDetails = {
      department: detailsInputs[0].value.trim(),
      designation: detailsInputs[1].value.trim(),
      campus: detailsInputs[2].value.trim(),
    };
    detailsSaveButton.disabled = true;
    detailsSaveButton.textContent = "Saving...";
    try {
      await saveProfileFields(
        db,
        authUser.uid,
        "superadmin",
        updatedDetails,
        profileCollectionsForRole("superadmin"),
      );
      profile = { ...profile, uid: authUser.uid, ...updatedDetails };
      saveProfile();
      updateDisplay();
      detailsEdit.hidden = true;
      detailsView.hidden = false;
      showFeedback("Super Admin details updated successfully.");
    } catch (error) {
      console.error("[SuperAdminProfile] Could not update profile details:", error);
      showFeedback(error?.message || "Could not save your profile details.", true);
    } finally {
      detailsSaveButton.textContent = "Save";
      updateDetailsDirty();
    }
  });

  const nameView = document.getElementById("nameCardView");
  const nameEdit = document.getElementById("nameCardEdit");
  const nameInputs = ["inputFirstName", "inputMiddleName", "inputLastName"]
    .map((id) => document.getElementById(id));
  nameInputs.forEach((input) => { input.maxLength = 100; });
  const nameSaveButton = document.getElementById("nameSaveBtn");
  const nameUnsavedCount = document.getElementById("nameUnsavedCount");
  function updateNameDirty() {
    const [first, middle, last] = nameInputs.map((input) => input.value.trim());
    const changed =
      first !== String(profile.firstName || "").trim() ||
      middle !== String(profile.middleName || "").trim() ||
      last !== String(profile.lastName || "").trim();
    nameUnsavedCount.textContent = changed ? "Unsaved changes" : "No changes yet";
    nameSaveButton.disabled = !changed;
  }
  document.getElementById("btnEditName")?.addEventListener("click", () => {
    nameInputs[0].value = profile.firstName || "";
    nameInputs[1].value = profile.middleName || "";
    nameInputs[2].value = profile.lastName || "";
    nameView.hidden = true;
    nameEdit.hidden = false;
    updateNameDirty();
    nameInputs[0].focus();
  });
  nameInputs.forEach((input) => input.addEventListener("input", updateNameDirty));
  document.getElementById("nameCancelBtn")?.addEventListener("click", () => {
    nameEdit.hidden = true;
    nameView.hidden = false;
  });
  nameEdit?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const [firstName, middleName, lastName] = nameInputs.map((input) => input.value.trim());
    if (
      !isValidNamePart(firstName) ||
      (middleName && !isValidNamePart(middleName)) ||
      !isValidNamePart(lastName)
    ) {
      showFeedback("Enter valid first and last names; middle name may be left blank.", true);
      const invalidInput = !isValidNamePart(firstName)
        ? nameInputs[0]
        : middleName && !isValidNamePart(middleName)
          ? nameInputs[1]
          : nameInputs[2];
      invalidInput.focus();
      return;
    }
    const authUser = auth?.currentUser;
    if (!authUser?.uid || !db) {
      showFeedback("Sign in again before updating your profile name.", true);
      return;
    }
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");
    const updatedName = {
      firstName,
      middleName,
      lastName,
      fullName,
      name: fullName,
    };
    nameSaveButton.disabled = true;
    nameSaveButton.textContent = "Saving...";
    try {
      await saveProfileFields(
        db,
        authUser.uid,
        "superadmin",
        updatedName,
        profileCollectionsForRole("superadmin"),
      );
      profile = { ...profile, uid: authUser.uid, ...updatedName };
      saveProfile();
      updateDisplay();
      nameEdit.hidden = true;
      nameView.hidden = false;
      showFeedback("Profile name updated successfully.");
    } catch (error) {
      console.error("[SuperAdminProfile] Could not update profile name:", error);
      showFeedback(error?.message || "Could not save your profile name.", true);
    } finally {
      nameSaveButton.textContent = "Save";
      updateNameDirty();
    }
  });

  const contactView = document.getElementById("contactCardView");
  const contactEdit = document.getElementById("contactCardEdit");
  document.getElementById("btnEditContact")?.addEventListener("click", () => {
    document.getElementById("inputContactEmail").value = profile.email || "";
    document.getElementById("inputContactPhone").value = formatPhilippineMobile(profile.contactNumber || "");
    contactView.hidden = true;
    contactEdit.hidden = false;
  });
  document.getElementById("contactCancelBtn")?.addEventListener("click", () => {
    contactEdit.hidden = true;
    contactView.hidden = false;
  });
  const contactEmailInput = document.getElementById("inputContactEmail");
  const contactPhoneInput = document.getElementById("inputContactPhone");
  contactEmailInput.maxLength = 254;
  contactPhoneInput?.addEventListener("input", () => {
    contactPhoneInput.value = formatPhilippineMobile(contactPhoneInput.value);
  });
  contactEdit?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = contactEmailInput.value.trim().toLowerCase();
    const phone = mobileDigits(contactPhoneInput.value);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showFeedback("Enter a valid email address.", true);
      contactEmailInput.focus();
      return;
    }
    if (!isValidPhilippineMobile(phone)) {
      showFeedback("Enter a Philippine mobile number in 09XXXXXXXXX format.", true);
      contactPhoneInput.focus();
      return;
    }

    const authUser = auth?.currentUser;
    if (!authUser?.uid || !db) {
      showFeedback("Sign in again before updating your contact details.", true);
      return;
    }
    const emailChanged = email !== String(profile.email || "").trim().toLowerCase();
    const phoneChanged = phone !== mobileDigits(profile.contactNumber);
    try {
      if (emailChanged) {
        await verifyBeforeUpdateEmail(authUser, email);
        profile.pendingEmail = email;
        localStorage.setItem(
          `recovibe_pending_email_${authUser.uid}`,
          JSON.stringify({ pendingEmail: email, oldEmail: profile.email, timestamp: Date.now() }),
        );
        await savePendingProfileEmail(
          db,
          authUser.uid,
          "superadmin",
          email,
          profileCollectionsForRole("superadmin"),
        );
      }
      if (phoneChanged) {
        await saveProfileFields(
          db,
          authUser.uid,
          "superadmin",
          { contactNumber: phone },
          profileCollectionsForRole("superadmin"),
        );
      }
      profile.uid = authUser.uid;
      profile.contactNumber = phone;
      saveProfile();
      updateDisplay();
      contactEdit.hidden = true;
      contactView.hidden = false;
      showFeedback(emailChanged
        ? "Verification was sent. Keep using your current email until you confirm the new address."
        : "Contact details updated successfully.");
    } catch (error) {
      console.error("[SuperAdminProfile] Could not update contact details:", error);
      showFeedback(error?.message || "Could not update contact details.", true);
    }
  });

  document.getElementById("btnCancelEmailChange")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const authUser = auth?.currentUser;
    const uid = authUser?.uid || profile.uid;
    if (!uid || !db) {
      showFeedback("Sign in again before canceling the email change.", true);
      return;
    }

    button.disabled = true;
    try {
      const results = await Promise.allSettled(
        profileCollectionsForRole("superadmin").map((collectionName) =>
          updateDoc(doc(db, collectionName, uid), { pendingEmail: deleteField() }),
        ),
      );
      const failure = results.find(
        (result) => result.status === "rejected" && result.reason?.code !== "not-found",
      );
      if (failure) throw failure.reason;

      const pendingKey = `recovibe_pending_email_${uid}`;
      localStorage.removeItem(pendingKey);
      sessionStorage.removeItem(pendingKey);
      delete profile.pendingEmail;
      profile.uid = uid;
      saveProfile();
      updateDisplay();
      showFeedback("Email change cancelled.");
    } catch (error) {
      console.error("[SuperAdminProfile] Could not cancel the email change:", error);
      showFeedback(error?.message || "Could not cancel the email change.", true);
    } finally {
      button.disabled = false;
    }
  });

  const passwordModal = document.getElementById("passwordFormModal");
  document.getElementById("changePassword")?.addEventListener("click", () => { passwordModal.hidden = false; });
  document.getElementById("closePasswordModal")?.addEventListener("click", () => { passwordModal.hidden = true; });
  document.getElementById("passwordForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const password = document.getElementById("newPassword").value;
    const status = document.getElementById("passwordFormStatus");
    if (password.length < 6 || password !== document.getElementById("confirmPassword").value) {
      status.textContent = "Use at least 6 characters and matching passwords.";
      return;
    }
    localStorage.setItem("recovibeSuperAdminPassword", password);
    passwordModal.hidden = true;
    showFeedback("Password changed successfully.");
  });

  document.getElementById("btnDismissFeedback")?.addEventListener("click", () => {
    document.getElementById("profileFeedbackAlert").hidden = true;
  });

  window.addEventListener("superadmin-profile-authorized", (event) => {
    if (event.detail?.profile) profile = { ...profile, ...event.detail.profile };
    updateDisplay();
    window.dispatchEvent(new Event("page-data-ready"));
  });
  async function syncProfileEmail() {
    const authUser = auth?.currentUser;
    if (!authUser?.uid || !db) return;
    try {
      const result = await syncVerifiedProfileEmail(
        auth,
        db,
        authUser,
        "superadmin",
        profileCollectionsForRole("superadmin"),
      );
      if (!result || auth?.currentUser?.uid !== authUser.uid) return;
      profile.uid = authUser.uid;
      profile.email = result.email;
      if (result.pendingEmail) profile.pendingEmail = result.pendingEmail;
      else delete profile.pendingEmail;
      saveProfile();
      updateDisplay();
      if (result.changed) showFeedback("Email address verified and updated.");
    } catch (error) {
      console.warn("[SuperAdminProfile] Could not sync verified email:", error);
    }
  }
  await syncProfileEmail();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void syncProfileEmail();
  });
  updateDisplay();
  if (profile.pendingEmail) {
    showFeedback(`Email change pending verification at ${profile.pendingEmail}. Keep using your current email until confirmed.`);
  }
})().catch((error) => console.error("[SuperAdminProfile] Could not initialize profile:", error));
