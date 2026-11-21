import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth, db, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";
import { logoutSuperAdmin } from "./superAdminLogout.js";
import {
  getSystemSettings,
  invalidateSystemSettingsCache,
} from "../systemSettingsDefaults.js";

(async () => {
  "use strict";
  const DEBUG = false;

  const settingsRef = db ? doc(db, "system_settings", "global_config") : null;
  const publicAccessSettingsRef = db ? doc(db, "systemSettings", "default") : null;
  const legacyAccessSettingsRef = db ? doc(db, "system_settings", "access") : null;

  // General settings controls
  const mainOrgSelect = document.getElementById("setting-main-org");
  const maxUploadInput = document.getElementById("setting-max-upload");

  // Organization directory controls
  const addOrgBtn = document.getElementById("add-organization-btn");
  const saveOrganizationsBtn = document.getElementById("save-organizations-btn");
  const orgListEl = document.getElementById("organization-directory-list");

  // Approval stages controls
  const stagesList = document.getElementById("approval-stages-list");
  const addStageBtn = document.getElementById("add-stage-btn");
  const saveStagesBtn = document.getElementById("save-stages-btn");
  const saveStagesBottomBtn = document.getElementById("save-stages-bottom-btn");
  const saveGeneralBtn = document.getElementById("save-general-btn");
  const stagesErrorEl = document.getElementById("approval-stages-error");
  const orgApprovalSelector = document.getElementById("org-approval-selector");
  const orgApprovalPills = document.getElementById("org-approval-pills");
  const orgApprovalStagesList = document.getElementById("org-approval-stages-list");
  const orgApprovalEditor = document.getElementById("org-approval-editor");
  const orgApprovalLoading = document.getElementById("org-approval-loading");
  const orgApprovalError = document.getElementById("org-approval-error");
  const orgApprovalErrorText = document.getElementById("org-approval-error-text");
  const orgApprovalDirectoryError = document.getElementById("org-approval-directory-error");
  const orgApprovalValidationError = document.getElementById("org-approval-validation-error");
  const orgApprovalSuccess = document.getElementById("org-approval-success");
  const orgApprovalStatusBadge = document.getElementById("org-approval-status-badge");
  const orgApprovalStartingCopy = document.getElementById("org-approval-starting-copy");
  const orgApprovalSaveBtn = document.getElementById("org-approval-save-btn");
  const orgApprovalDiscardBtn = document.getElementById("org-approval-discard-btn");
  const orgApprovalResetBtn = document.getElementById("org-approval-reset-btn");
  const orgApprovalAddStageBtn = document.getElementById("org-approval-add-stage-btn");
  const orgStageSwitchDialog = document.getElementById("org-stage-switch-dialog");
  const orgStageSwitchMessage = document.getElementById("org-stage-switch-message");
  const orgStageSwitchSaveBtn = document.getElementById("org-stage-switch-save-btn");
  const orgStageSwitchDiscardBtn = document.getElementById("org-stage-switch-discard-btn");
  const orgStageSwitchCancelBtn = document.getElementById("org-stage-switch-cancel-btn");

  // Confirmation dialog controls
  const confirmDialog = document.getElementById("settings-confirm-dialog");
  const confirmCancelBtn = document.getElementById("settings-confirm-cancel-btn");
  const confirmCloseBtn = document.getElementById("settings-confirm-close-btn");
  const confirmYesBtn = document.getElementById("settings-confirm-yes-btn");
  const statusMessage = document.getElementById("settings-status");

  // Access and registration controls
  const registrationToggle = document.getElementById("toggle-registration");
  const loginToggle = document.getElementById("toggle-login");
  const userLoginBadge = document.getElementById("badge-user-login");
  const eventRegBadge = document.getElementById("badge-event-registration");
  const modal = document.getElementById("settings-modal-backdrop");
  const modalForm = document.getElementById("settings-modal-form");
  const modalTitle = document.getElementById("settings-modal-title");
  const itemField = document.getElementById("settings-item-field");
  const itemLabel = document.getElementById("settings-item-label");
  const itemInput = document.getElementById("settings-item-input");
  const itemList = document.getElementById("settings-item-list");
  const submitButton = document.getElementById("settings-item-submit");
  const activeAccessUser = { current: null };
  const newSections = ["events", "registration", "notifications", "calendar", "audience"];
  const sectionLabels = {
    events: "Event rules",
    registration: "Registration",
    notifications: "Notifications",
    calendar: "Calendar and holidays",
    audience: "Audience",
  };
  const sectionBaseline = Object.create(null);
  let newSettingsReady = false;
  let lastSavedAt = 0;
  let confirmationRequiresLock = false;
  let pendingLegacyAuditMetadata = null;

  const defaultOrganizations = [
    { code: "ACES", name: "Association of Computer Engineering Students", adviserEmail: "" },
    { code: "HRSS", name: "Human Resource Students Society", adviserEmail: "" },
    { code: "IBITS", name: "Institute of Bachelors in Information Technology Studies", adviserEmail: "" },
    { code: "PIIE", name: "Philippine Institute of Industrial Engineers – PUP Biñan Student Chapter", adviserEmail: "" },
    { code: "SMS", name: "Samahan ng mga Mag-aaral ng Sikolohiya", adviserEmail: "" },
    { code: "YES", name: "Young Educators' Society", adviserEmail: "" },
  ];

  const defaultApprovalStages = [
    {
      id: "stage-1",
      name: "Organization Adviser",
      reviewer: "Organization Adviser",
      reviewerEmail: "",
      required: true,
    },
    {
      id: "stage-2",
      name: "Laboratory Head, Property Custodian, Administrative Officer",
      reviewer: "Laboratory Head, Property Custodian, Administrative Officer",
      reviewerEmail: "",
      required: true,
    },
    {
      id: "stage-3",
      name: "Head of Academic Programs, QAC Coordinator (HAP)",
      reviewer: "Head of Academic Programs, QAC Coordinator (HAP)",
      reviewerEmail: "",
      required: true,
    },
    {
      id: "stage-4",
      name: "OSAS",
      reviewer: "OSAS",
      reviewerEmail: "",
      required: true,
    },
  ];

  const defaultSettings = {
    mainOrganization: "IBITS",
    maxUploadSizeMb: 15,
    allowedDocumentTypes: "PDF, DOCX, JPG, PNG",
    organizations: defaultOrganizations,
    approvalStages: defaultApprovalStages,
    registrationEnabled: true,
    loginEnabled: true,
    eventRegistrationEnabled: true,
    userLoginEnabled: true,
    maintenanceMessage: "",
    venues: [],
    categories: [],
    eventSources: [],
  };

  let currentSettings = { ...defaultSettings };
  let workingOrganizations = JSON.parse(JSON.stringify(defaultOrganizations));
  let workingApprovalStages = JSON.parse(JSON.stringify(defaultApprovalStages));
  let workingMainOrg = "IBITS";
  const organizationStageDrafts = new Map();
  let selectedOrganizationStageCode = "";
  let organizationStagesSaving = false;
  const reviewerAccountLookups = new Map();
  let organizationApprovalLoadTimeout = null;

  let settingsReady = false;
  let pageLoadSignaled = false;
  let initializingDocument = false;
  let backfillingDefaults = null;
  let pendingSettingsSync = null;
  let accessMirrorSynced = false;
  let unsubscribeSettings = null;
  const pendingSettingsKey = "recovibe_system_settings_pending";

  // Cache loading
  try {
    const cachedSettings = localStorage.getItem("recovibeSystemSettings");
    if (cachedSettings) {
      currentSettings = normalizedSettings(JSON.parse(cachedSettings));
      workingApprovalStages = JSON.parse(JSON.stringify(currentSettings.approvalStages));
      workingOrganizations = JSON.parse(JSON.stringify(currentSettings.organizations));
      workingMainOrg = currentSettings.mainOrganization;
    }

    const cachedStages = localStorage.getItem("recovibe_approval_stages");
    if (cachedStages) {
      const parsed = JSON.parse(cachedStages);
      if (Array.isArray(parsed) && parsed.length > 0) {
        workingApprovalStages = normalizeApprovalStages(parsed);
        currentSettings.approvalStages = workingApprovalStages;
      }
    }
    const cachedOrgs = localStorage.getItem("recovibe_organizations");
    if (cachedOrgs) {
      const parsed = JSON.parse(cachedOrgs);
      if (Array.isArray(parsed) && parsed.length > 0) {
        workingOrganizations = normalizeOrganizations(parsed);
        currentSettings.organizations = workingOrganizations;
      }
    }
    const cachedMainOrg = localStorage.getItem("recovibe_main_org");
    if (cachedMainOrg) {
      workingMainOrg = cachedMainOrg;
      currentSettings.mainOrganization = cachedMainOrg;
    }
    const cachedMaxUpload = localStorage.getItem("recovibe_max_upload_size");
    if (cachedMaxUpload) {
      currentSettings.maxUploadSizeMb = Number(cachedMaxUpload) || 15;
    }
    const cachedAllowedDocs = localStorage.getItem("recovibe_allowed_doc_types");
    if (cachedAllowedDocs) {
      currentSettings.allowedDocumentTypes = cachedAllowedDocs;
    }
  } catch (error) {
    if (DEBUG) console.warn("Could not restore cached system settings:", error);
  }

  function showMessage(message, isError = false) {
    if (!statusMessage) return;
    statusMessage.textContent = message;
    statusMessage.dataset.state = isError ? "error" : "success";
    statusMessage.hidden = false;
    setTimeout(() => {
      if (statusMessage) statusMessage.hidden = true;
    }, 4500);
  }

  function setOrganizationApprovalLoading(isLoading) {
    if (orgApprovalLoading) orgApprovalLoading.hidden = !isLoading;
  }

  function flagValidationError(inputElement, errorMessage) {
    if (inputElement) {
      inputElement.classList.add("is-invalid");
      try {
        inputElement.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch (_) {}
      try {
        inputElement.focus();
      } catch (_) {}
    }
    if (stagesErrorEl) {
      stagesErrorEl.textContent = errorMessage;
      stagesErrorEl.hidden = false;
    }
    showMessage(errorMessage, true);
  }

  function actorTag() {
    return document.querySelector(".account-badge")?.textContent.trim() || "SA1";
  }

  function actorIdentifier() {
    const name =
      document.getElementById("superadmin-name")?.textContent.trim() ||
      "Super Admin";
    return `${actorTag()} – ${name}`;
  }

  function actorDisplayName() {
    const user = activeAccessUser.current;
    const profile = user?.profile || {};
    return [profile.firstName, profile.middleName, profile.lastName]
      .filter(Boolean)
      .join(" ") || profile.name || profile.fullName || user?.displayName || document.getElementById("superadmin-name")?.textContent.trim() || "Super Admin";
  }

  function settingsAuditMetadata(section, summary, changes) {
    const user = activeAccessUser.current;
    return {
      actorUid: user?.uid || "",
      actorName: actorDisplayName(),
      section,
      summary,
      changes: (changes || []).slice(0, 20),
      createdAt: serverTimestamp(),
    };
  }

  async function appendAudit(action, metadata = null) {
    if (!db) return;
    const auditMetadata = metadata || pendingLegacyAuditMetadata;
    pendingLegacyAuditMetadata = null;
    await addDoc(collection(db, "audit_logs"), {
      timestamp: serverTimestamp(),
      user: actorIdentifier(),
      action: auditMetadata ? "settings.update" : action,
      category: "System Settings",
      ...(auditMetadata || {}),
    });
  }

  function setReady(ready) {
    settingsReady = ready;
    if (ready && !pageLoadSignaled) {
      pageLoadSignaled = true;
      window.dispatchEvent(new Event("page-data-ready"));
    }
    if (mainOrgSelect) mainOrgSelect.disabled = !ready;
    if (maxUploadInput) maxUploadInput.disabled = !ready;
    if (addOrgBtn) addOrgBtn.disabled = !ready;
    if (saveOrganizationsBtn) saveOrganizationsBtn.disabled = !ready;
    if (addStageBtn) addStageBtn.disabled = !ready;
    if (saveStagesBtn) saveStagesBtn.disabled = !ready;
    if (saveStagesBottomBtn) saveStagesBottomBtn.disabled = !ready;
    if (saveGeneralBtn) saveGeneralBtn.disabled = !ready;
    if (orgApprovalSelector) orgApprovalSelector.disabled = !ready || organizationStagesSaving;
    orgApprovalPills?.querySelectorAll("button").forEach((button) => {
      button.disabled = !ready || organizationStagesSaving;
    });
    [
      orgApprovalSaveBtn,
      orgApprovalDiscardBtn,
      orgApprovalResetBtn,
      orgApprovalAddStageBtn,
    ].forEach((button) => {
      if (button) button.disabled = !ready || organizationStagesSaving;
    });
    setOrganizationApprovalLoading(!ready);
    if (orgApprovalEditor) orgApprovalEditor.hidden = !ready;

    if (orgListEl) {
      orgListEl.querySelectorAll("input, button").forEach((el) => {
        el.disabled = !ready;
      });
    }
    if (stagesList) {
      stagesList.querySelectorAll("input, button").forEach((el) => {
        el.disabled = !ready;
      });
    }
    if (orgApprovalStagesList) {
      orgApprovalStagesList.querySelectorAll("input, button").forEach((el) => {
        el.disabled = !ready || organizationStagesSaving;
      });
    }
    if (registrationToggle) registrationToggle.disabled = !ready;
    if (loginToggle) loginToggle.disabled = !ready;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeOrganizations(rawList) {
    const defaultNameMap = {
      IBITS: "Information Technology and Business Intelligence Society",
      ACES: "Association of Computer Engineering Students",
      CSC: "College Student Council",
      HRSS: "HRSS",
      PIIE: "Philippine Institute of Industrial Engineers",
      SMS: "SMS",
      YES: "YES",
      JPCS: "Junior Philippine Computer Society",
    };
    const normalized = (Array.isArray(rawList) ? rawList : []).map((item) => {
      if (typeof item === "string") {
        return {
          code: normalizeOrganizationCode(item),
          name: defaultNameMap[item.trim().toUpperCase()] || `${item.trim()} Student Organization`,
          adviserEmail: "",
          active: true,
        };
      }
      return {
        code: normalizeOrganizationCode(item && item.code ? item.code : (item?.name || "ORG")),
        name: item && item.name && item.name !== item.code ? String(item.name).trim() : (defaultNameMap[String(item?.code || "").toUpperCase()] || String(item?.name || item?.code || "Organization")),
        adviserEmail: String(item?.adviserEmail || item?.adviser?.email || "").trim().toLowerCase(),
        active: item?.active !== false,
      };
    });
    const seen = new Set();
    return [...normalized, ...defaultOrganizations.map((organization) => ({
      ...organization,
      active: true,
    }))].filter((organization) => {
      const code = normalizeOrganizationCode(organization.code);
      if (!code || seen.has(code.toLowerCase())) return false;
      seen.add(code.toLowerCase());
      organization.code = code;
      return true;
    });
  }

  function normalizeOrganizationCode(value) {
    return String(value || "").trim().toUpperCase();
  }

  function normalizeApprovalStages(rawStages) {
    let stages = defaultApprovalStages;
    if (Array.isArray(rawStages) && rawStages.length > 0) {
      stages = rawStages.map((stage, idx) => ({
        id: stage && stage.id ? String(stage.id) : `stage-${idx + 1}`,
        name: stage && typeof stage.name === "string" ? stage.name : `Stage ${idx + 1}`,
        reviewer: stage && typeof stage.reviewer === "string" ? stage.reviewer : "",
        reviewerEmail: String(stage?.reviewerEmail || stage?.email || "").trim().toLowerCase(),
        required: stage && typeof stage.required === "boolean" ? stage.required : true,
      }));
    }
    return stages;
  }

  function cacheSettings(settings, markPending = false) {
    try {
      localStorage.setItem("recovibeSystemSettings", JSON.stringify(settings));
      localStorage.setItem("recovibe_approval_stages", JSON.stringify(settings.approvalStages));
      localStorage.setItem("recovibe_organizations", JSON.stringify(settings.organizations));
      localStorage.setItem("recovibe_main_org", settings.mainOrganization || "");
      localStorage.setItem("recovibe_max_upload_size", String(settings.maxUploadSizeMb));
      localStorage.setItem("recovibe_allowed_doc_types", settings.allowedDocumentTypes || "");
      if (markPending) {
        const savedAt = Date.now();
        localStorage.setItem(pendingSettingsKey, JSON.stringify({
          settings,
          savedAt,
          revision: `${savedAt}-${Math.random().toString(36).slice(2)}`,
        }));
      }
      return true;
    } catch (error) {
      if (DEBUG) console.error("Could not cache system settings locally:", error);
      return false;
    }
  }

  function applySettingsToControls(settings) {
    currentSettings = normalizedSettings(settings);
    workingMainOrg = currentSettings.mainOrganization;
    workingOrganizations = JSON.parse(JSON.stringify(currentSettings.organizations));
    workingApprovalStages = JSON.parse(JSON.stringify(currentSettings.approvalStages));
    if (maxUploadInput) maxUploadInput.value = currentSettings.maxUploadSizeMb;
    if (registrationToggle) {
      registrationToggle.checked = currentSettings.registrationEnabled !== false;
      updateToggleBadge("registration", currentSettings.registrationEnabled !== false);
    }
    if (loginToggle) {
      loginToggle.checked = currentSettings.loginEnabled !== false;
      updateToggleBadge("login", currentSettings.loginEnabled !== false);
    }
    renderOrganizations();
    renderApprovalStages();
  }

  async function syncPendingSettings() {
    if (!settingsRef || !db || !navigator.onLine) return false;
    if (pendingSettingsSync) return pendingSettingsSync;

    pendingSettingsSync = (async () => {
      let synced = false;
      while (navigator.onLine) {
        let pending;
        try {
          pending = JSON.parse(localStorage.getItem(pendingSettingsKey) || "null");
        } catch (error) {
          if (DEBUG) console.error("Could not read pending system settings:", error);
          return false;
        }
        if (!pending?.settings) return synced;

        const revision = pending.revision || pending.savedAt;
        const pendingSettings = normalizedSettings(pending.settings);
        delete pendingSettings.approvalStagesByOrg;
        const accessFields = getAccessSettingsFields(pendingSettings);
        const batch = writeBatch(db);
        batch.set(settingsRef, {
          ...pendingSettings,
          updatedAt: serverTimestamp(),
          updatedBy: actorIdentifier(),
        }, { merge: true });
        if (publicAccessSettingsRef) {
          batch.set(publicAccessSettingsRef, {
            ...accessFields,
            updatedAt: serverTimestamp(),
            updatedBy: actorIdentifier(),
          }, { merge: true });
        }
        await batch.commit();
        synced = true;

        let latestPending;
        try {
          latestPending = JSON.parse(localStorage.getItem(pendingSettingsKey) || "null");
        } catch (error) {
          if (DEBUG) console.error("Could not verify pending system settings:", error);
          return false;
        }
        if (!latestPending?.settings) return true;
        if ((latestPending.revision || latestPending.savedAt) !== revision) continue;

        localStorage.removeItem(pendingSettingsKey);
        applySettingsToControls(pending.settings);
        cacheSettings(currentSettings);
        showMessage("Pending system settings synced to the cloud.");
        return true;
      }
      return synced;
    })();

    try {
      return await pendingSettingsSync;
    } catch (error) {
      console.error("[SystemSettings] Pending settings sync failed:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      showMessage("Changes are saved locally; cloud sync is still pending.", true);
      return false;
    } finally {
      pendingSettingsSync = null;
    }
  }

  window.addEventListener("online", () => {
    void syncPendingSettings();
  });

  function normalizedSettings(data) {
    const userLoginEnabled = typeof data.userLoginEnabled === "boolean"
      ? data.userLoginEnabled
      : typeof data.loginEnabled === "boolean"
        ? data.loginEnabled
        : true;
    const eventRegistrationEnabled = typeof data.eventRegistrationEnabled === "boolean"
      ? data.eventRegistrationEnabled
      : typeof data.registrationEnabled === "boolean"
        ? data.registrationEnabled
        : true;
    return {
      mainOrganization: typeof data.mainOrganization === "string" ? data.mainOrganization : "IBITS",
      maxUploadSizeMb: typeof data.maxUploadSizeMb === "number" ? data.maxUploadSizeMb : 15,
      allowedDocumentTypes: typeof data.allowedDocumentTypes === "string" ? data.allowedDocumentTypes : "PDF, DOCX, JPG, PNG",
      organizations: normalizeOrganizations(data.organizations),
      approvalStages: normalizeApprovalStages(data.approvalStages),
      approvalStagesByOrg: data.approvalStagesByOrg && typeof data.approvalStagesByOrg === "object"
        ? data.approvalStagesByOrg
        : {},
      registrationEnabled: eventRegistrationEnabled,
      loginEnabled: userLoginEnabled,
      eventRegistrationEnabled,
      userLoginEnabled,
      maintenanceMessage: typeof data.maintenanceMessage === "string"
        ? data.maintenanceMessage
        : "",
      venues: Array.isArray(data.venues) ? data.venues.filter((item) => typeof item === "string") : [],
      categories: Array.isArray(data.categories) ? data.categories.filter((item) => typeof item === "string") : [],
      eventSources: Array.isArray(data.eventSources) ? data.eventSources.filter((item) => typeof item === "string") : [],
    };
  }

  // --- Render Functions ---

  function renderMainOrgSelect() {
    if (!mainOrgSelect) return;
    const currentVal = normalizeOrganizationCode(mainOrgSelect.value || workingMainOrg || "ibits");
    mainOrgSelect.innerHTML = "";

    const validCodes = (workingOrganizations || [])
      .filter((org) => org.active !== false)
      .map((o) => normalizeOrganizationCode(o.code))
      .filter(Boolean);

    if (!validCodes.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No organizations available";
      mainOrgSelect.appendChild(opt);
      workingMainOrg = "";
      return;
    }

    validCodes.forEach((code) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = code.toUpperCase();
      if (code === currentVal || code === workingMainOrg) {
        opt.selected = true;
      }
      mainOrgSelect.appendChild(opt);
    });

    if (validCodes.includes(workingMainOrg)) {
      mainOrgSelect.value = workingMainOrg;
    } else {
      mainOrgSelect.value = validCodes[0];
      workingMainOrg = validCodes[0];
    }
  }

  function renderOrganizations() {
    if (!orgListEl) return;
    orgListEl.replaceChildren();

    const orgs = workingOrganizations || [];
    if (!orgs.length) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "settings-stage-empty";
      emptyDiv.textContent = "No organizations in directory. Click '+ Add organization' above to add one.";
      orgListEl.appendChild(emptyDiv);
      renderMainOrgSelect();
      renderOrganizationStageControls();
      return;
    }

    orgs.forEach((org, index) => {
      const row = document.createElement("div");
      row.className = "settings-org-row";
      row.dataset.index = String(index);
      row.dataset.orgCode = normalizeOrganizationCode(org.code);

      const initialChar = org.code && org.code.trim() ? org.code.trim()[0].toUpperCase() : "?";
      const active = org.active !== false;
      const approvalSelected = normalizeOrganizationCode(org.code) === selectedOrganizationStageCode;
      if (!active) row.classList.add("is-inactive");
      if (approvalSelected) row.classList.add("is-approval-selected");

      row.innerHTML = `
        <button class="settings-org-badge settings-org-stage-select" type="button" aria-pressed="${approvalSelected}" aria-label="Select ${escapeHtml(org.code || "organization")} to edit approval stages" title="Edit approval stages for ${escapeHtml(org.code || "organization")}">${escapeHtml(initialChar)}</button>
        <label class="sr-only" for="settings-org-code-${index}">Organization code</label>
        <input
          type="text"
          id="settings-org-code-${index}"
          class="settings-org-code-input"
          value="${escapeHtml((org.code || "").toUpperCase())}"
          style="text-transform: uppercase;"
          placeholder="Code"
          aria-label="Organization Code"
          ${!settingsReady ? "disabled" : ""}
        />
        <label class="sr-only" for="settings-org-name-${index}">Full organization name</label>
        <input
          type="text"
          id="settings-org-name-${index}"
          class="settings-org-name-input"
          value="${escapeHtml(org.name || "")}"
          placeholder="Full Organization Name"
          aria-label="Full Organization Name"
          ${!settingsReady ? "disabled" : ""}
        />
        <label class="sr-only" for="settings-org-adviser-${index}">Adviser email</label>
        <input
          type="email"
          id="settings-org-adviser-${index}"
          class="settings-org-adviser-input"
          value="${escapeHtml(org.adviserEmail || "")}"
          placeholder="Adviser email"
          aria-label="${escapeHtml(org.code || "Organization")} adviser email"
          ${!settingsReady ? "disabled" : ""}
        />
        <button class="settings-org-remove-btn" type="button" aria-label="${active ? "Deactivate" : "Activate"} ${escapeHtml(org.code || "organization")}" title="${active ? "Deactivate" : "Activate"} organization" ${!settingsReady ? "disabled" : ""}>
          ${active ? "×" : "↻"}
        </button>
      `;

      const badge = row.querySelector(".settings-org-badge");
      const codeInput = row.querySelector(".settings-org-code-input");
      const nameInput = row.querySelector(".settings-org-name-input");
      const adviserInput = row.querySelector(".settings-org-adviser-input");
      const removeBtn = row.querySelector(".settings-org-remove-btn");
      const selectStageBtn = row.querySelector(".settings-org-stage-select");

      if (codeInput) {
        codeInput.addEventListener("input", (e) => {
          org.code = normalizeOrganizationCode(e.target.value);
          row.dataset.orgCode = org.code;
          const char = org.code ? org.code[0].toUpperCase() : "?";
          if (badge) badge.textContent = char;
          if (selectStageBtn) {
            selectStageBtn.setAttribute("aria-label", `Select ${org.code || "organization"} to edit approval stages`);
            selectStageBtn.title = `Edit approval stages for ${org.code || "organization"}`;
          }
          codeInput.classList.remove("is-invalid");
          document.querySelectorAll(".settings-org-code-input.is-invalid").forEach((el) => el.classList.remove("is-invalid"));
          if (stagesErrorEl) stagesErrorEl.hidden = true;
          renderMainOrgSelect();
        });
        codeInput.addEventListener("change", renderOrganizationStageControls);
      }

      if (nameInput) {
        nameInput.addEventListener("input", (e) => {
          org.name = e.target.value;
          nameInput.classList.remove("is-invalid");
          document.querySelectorAll(".settings-org-name-input.is-invalid").forEach((el) => el.classList.remove("is-invalid"));
          if (stagesErrorEl) stagesErrorEl.hidden = true;
        });
      }

      if (adviserInput) {
        let previousAdviserEmail = String(org.adviserEmail || "").trim().toLowerCase();
        adviserInput.addEventListener("focus", () => {
          previousAdviserEmail = String(org.adviserEmail || "").trim().toLowerCase();
        });
        adviserInput.addEventListener("input", (e) => {
          org.adviserEmail = e.target.value.trim().toLowerCase();
          adviserInput.classList.remove("is-invalid");
          if (stagesErrorEl) stagesErrorEl.hidden = true;
        });
        adviserInput.addEventListener("change", () => {
          const code = normalizeOrganizationCode(org.code);
          const changed = syncOrganizationAdviserEmailToDraft(code, previousAdviserEmail);
          previousAdviserEmail = String(org.adviserEmail || "").trim().toLowerCase();
          if (changed && code === selectedOrganizationStageCode) {
            clearOrganizationStageError();
            if (orgApprovalSuccess) orgApprovalSuccess.hidden = true;
            renderOrganizationApprovalStages();
          }
        });
      }

      if (removeBtn) {
        removeBtn.addEventListener("click", () => {
          toggleOrganizationActive(index);
        });
      }
      if (selectStageBtn) {
        selectStageBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          void requestOrganizationStageSelection(normalizeOrganizationCode(org.code));
        });
      }

      orgListEl.appendChild(row);
    });

    renderMainOrgSelect();
    renderOrganizationStageControls();
  }

  orgApprovalSelector?.addEventListener("change", () => {
    void requestOrganizationStageSelection(normalizeOrganizationCode(orgApprovalSelector.value));
  });

  function addOrganization() {
    if (!settingsReady) return;
    workingOrganizations.push({ code: "", name: "", adviserEmail: "", active: true });
    renderOrganizations();
    if (orgListEl) {
      const lastRow = orgListEl.lastElementChild;
      const codeInp = lastRow?.querySelector(".settings-org-code-input");
      if (codeInp) {
        codeInp.focus();
      }
    }
    if (stagesErrorEl) stagesErrorEl.hidden = true;
  }

  function toggleOrganizationActive(index) {
    if (!settingsReady) return;
    if (index < 0 || index >= workingOrganizations.length) return;
    workingOrganizations[index].active = workingOrganizations[index].active === false;
    renderOrganizations();
    if (stagesErrorEl) stagesErrorEl.hidden = true;
  }

  function renderApprovalStages() {
    if (!stagesList) return;
    stagesList.replaceChildren();

    const stages = workingApprovalStages || [];
    if (!stages.length) {
      const emptyDiv = document.createElement("div");
      emptyDiv.className = "settings-stage-empty";
      emptyDiv.textContent = "No approval stages configured. Click '+ Add stage' above to add one.";
      stagesList.appendChild(emptyDiv);
      return;
    }

    stages.forEach((stage, index) => {
      const isFirst = index === 0;
      const isLast = index === stages.length - 1;

      const card = document.createElement("div");
      card.className = "settings-stage-card";
      card.dataset.stageId = stage.id;
      card.dataset.index = String(index);

      card.innerHTML = `
        <div class="settings-stage-reorder">
          <button class="settings-reorder-btn settings-reorder-up" type="button" aria-label="Move stage up" ${isFirst || !settingsReady ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16m0-16l-5 5m5-5l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="settings-stage-number">${index + 1}</span>
          <button class="settings-reorder-btn settings-reorder-down" type="button" aria-label="Move stage down" ${isLast || !settingsReady ? "disabled" : ""}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V4m0 16l-5-5m5 5l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>

        <div class="settings-stage-body">
          <div class="settings-stage-col-name">
            <label class="settings-stage-field-label">
              <span>Stage name</span>
              <input
                type="text"
                class="settings-stage-input settings-stage-name-input"
                data-field="name"
                value="${escapeHtml(stage.name)}"
                placeholder="Stage name"
                aria-label="Stage name"
                ${!settingsReady ? "disabled" : ""}
              />
            </label>
            <label class="settings-stage-required-label">
              <input
                type="checkbox"
                class="settings-stage-required-checkbox"
                ${stage.required ? "checked" : ""}
                ${!settingsReady ? "disabled" : ""}
              />
              <span>Required</span>
            </label>
          </div>

          <div class="settings-stage-col-reviewer">
            <label class="settings-stage-field-label">
              <span>Reviewer display name</span>
              <input
                type="text"
                class="settings-stage-input settings-stage-reviewer-input"
                data-field="reviewer"
                value="${escapeHtml(stage.reviewer)}"
                placeholder="Reviewer name"
                aria-label="Reviewer display name"
                ${!settingsReady ? "disabled" : ""}
              />
            </label>
            <label class="settings-stage-field-label">
              <span>Reviewer account email (optional)</span>
              <input
                type="email"
                class="settings-stage-input settings-stage-reviewer-email-input"
                data-field="reviewerEmail"
                value="${escapeHtml(stage.reviewerEmail || "")}"
                placeholder="name@example.com"
                aria-label="Reviewer account email for ${escapeHtml(stage.name)} (optional)"
                ${!settingsReady ? "disabled" : ""}
              />
            </label>
          </div>
        </div>

        <button class="settings-stage-remove-btn" type="button" aria-label="Remove ${escapeHtml(stage.name)}" ${!settingsReady ? "disabled" : ""}>
          ✕
        </button>
      `;

      const upBtn = card.querySelector(".settings-reorder-up");
      const downBtn = card.querySelector(".settings-reorder-down");
      const nameInput = card.querySelector(".settings-stage-name-input");
      const reviewerInput = card.querySelector(".settings-stage-reviewer-input");
      const reviewerEmailInput = card.querySelector(".settings-stage-reviewer-email-input");
      const reqCheckbox = card.querySelector(".settings-stage-required-checkbox");
      const removeBtn = card.querySelector(".settings-stage-remove-btn");

      if (upBtn) {
        upBtn.addEventListener("click", () => moveStage(index, -1));
      }
      if (downBtn) {
        downBtn.addEventListener("click", () => moveStage(index, 1));
      }
      if (nameInput) {
        nameInput.addEventListener("input", (e) => {
          stage.name = e.target.value;
          nameInput.classList.remove("is-invalid");
          document.querySelectorAll(".settings-stage-name-input.is-invalid").forEach((el) => el.classList.remove("is-invalid"));
          if (stagesErrorEl) stagesErrorEl.hidden = true;
        });
      }
      if (reviewerInput) {
        reviewerInput.addEventListener("input", (e) => {
          stage.reviewer = e.target.value;
          reviewerInput.classList.remove("is-invalid");
          document.querySelectorAll(".settings-stage-reviewer-input.is-invalid").forEach((el) => el.classList.remove("is-invalid"));
          if (stagesErrorEl) stagesErrorEl.hidden = true;
        });
      }
      if (reviewerEmailInput) {
        reviewerEmailInput.addEventListener("input", (e) => {
          stage.reviewerEmail = e.target.value.trim().toLowerCase();
          reviewerEmailInput.classList.remove("is-invalid");
          if (stagesErrorEl) stagesErrorEl.hidden = true;
        });
      }
      if (reqCheckbox) {
        reqCheckbox.addEventListener("change", (e) => {
          stage.required = e.target.checked;
          document.querySelectorAll(".settings-stage-required-checkbox.is-invalid").forEach((el) => el.classList.remove("is-invalid"));
          if (stagesErrorEl) stagesErrorEl.hidden = true;
        });
      }
      if (removeBtn) {
        removeBtn.addEventListener("click", () => removeStage(index));
      }

      stagesList.appendChild(card);
    });
  }

  function addApprovalStage() {
    if (!settingsReady) return;
    const newIndex = workingApprovalStages.length + 1;
    const newStage = {
      id: `stage-${Date.now()}`,
      name: `Stage ${newIndex}`,
      reviewer: "",
      reviewerEmail: "",
      required: true,
    };
    workingApprovalStages.push(newStage);
    renderApprovalStages();
    if (stagesList) {
      const addedInput = stagesList.querySelector(`[data-stage-id="${newStage.id}"] .settings-stage-name-input`);
      if (addedInput) {
        addedInput.focus();
        addedInput.select();
      }
    }
    if (stagesErrorEl) stagesErrorEl.hidden = true;
  }

  function removeStage(index) {
    if (!settingsReady) return;
    if (index < 0 || index >= workingApprovalStages.length) return;
    workingApprovalStages.splice(index, 1);
    renderApprovalStages();
    if (stagesErrorEl) stagesErrorEl.hidden = true;
  }

  function moveStage(index, delta) {
    if (!settingsReady) return;
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= workingApprovalStages.length) return;
    const moved = workingApprovalStages[index];
    workingApprovalStages[index] = workingApprovalStages[targetIndex];
    workingApprovalStages[targetIndex] = moved;
    renderApprovalStages();
  }

  function getOrganizationStageCodes() {
    const seen = new Set();
    return (workingOrganizations || [])
      .map((organization) => normalizeOrganizationCode(organization.code))
      .filter((code) => {
        const key = code.toLowerCase();
        if (!code || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function createOrganizationStageCopy(stages) {
    return (Array.isArray(stages) ? stages : []).map((stage, index) => ({
      id: String(stage?.id || stage?.key || makeOrganizationStageId(stage?.name || `Stage ${index + 1}`)),
      name: String(stage?.name || stage?.label || `Stage ${index + 1}`),
      required: typeof stage?.required === "boolean" ? stage.required : true,
      reviewerName: String(stage?.reviewerName || stage?.reviewer || ""),
      reviewerEmail: String(stage?.reviewerEmail || stage?.email || "").trim().toLowerCase(),
      order: index,
    }));
  }

  function makeOrganizationStageId(name) {
    const slug = String(name || "stage")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "stage";
    return `${slug}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function savedOrganizationStageEntry(code) {
    const map = currentSettings.approvalStagesByOrg;
    return map && typeof map === "object" ? map[code] : null;
  }

  function getOrganizationAdviserEmail(code) {
    const organization = (workingOrganizations || []).find(
      (entry) => normalizeOrganizationCode(entry.code) === normalizeOrganizationCode(code),
    );
    return String(organization?.adviserEmail || "").trim().toLowerCase();
  }

  function createOrganizationStageDraft(code) {
    const entry = savedOrganizationStageEntry(code);
    const hasCustomEntry = Boolean(
      entry &&
      typeof entry === "object" &&
      Array.isArray(entry.stages) &&
      entry.stages.length,
    );
    const stages = hasCustomEntry
      ? createOrganizationStageCopy(entry.stages)
      : createOrganizationStageCopy(currentSettings.approvalStages || defaultApprovalStages);
    const adviserStage = stages[0];
    const directoryAdviserEmail = getOrganizationAdviserEmail(code);
    const savedAdviserEmail = String(adviserStage?.reviewerEmail || "").trim().toLowerCase();
    const adviserEmailManuallyOverridden = Boolean(
      hasCustomEntry && savedAdviserEmail && savedAdviserEmail !== directoryAdviserEmail,
    );
    const adviserEmailSynced = Boolean(adviserStage && !adviserEmailManuallyOverridden);
    const adviserEmailChanged = adviserEmailSynced && savedAdviserEmail !== directoryAdviserEmail;
    if (adviserEmailSynced) adviserStage.reviewerEmail = directoryAdviserEmail;
    return {
      stages,
      custom: hasCustomEntry,
      dirty: hasCustomEntry && adviserEmailChanged,
      adviserEmailManuallyOverridden,
      syncedAdviserEmail: adviserEmailSynced ? directoryAdviserEmail : "",
    };
  }

  function syncOrganizationAdviserEmailToDraft(code, previousAdviserEmail = "") {
    const draft = organizationStageDrafts.get(code);
    const adviserStage = draft?.stages?.[0];
    if (!draft || !adviserStage || draft.adviserEmailManuallyOverridden) return false;

    const nextAdviserEmail = getOrganizationAdviserEmail(code);
    const previousEmail = String(previousAdviserEmail || draft.syncedAdviserEmail || "")
      .trim()
      .toLowerCase();
    const stageEmail = String(adviserStage.reviewerEmail || "").trim().toLowerCase();
    const canSync = !draft.custom ||
      !stageEmail ||
      stageEmail === previousEmail ||
      stageEmail === draft.syncedAdviserEmail;
    if (!canSync) {
      draft.adviserEmailManuallyOverridden = true;
      return false;
    }

    draft.syncedAdviserEmail = nextAdviserEmail;
    if (stageEmail === nextAdviserEmail) return false;
    adviserStage.reviewerEmail = nextAdviserEmail;
    if (draft.custom) draft.dirty = true;
    return true;
  }

  function currentOrganizationStageDraft() {
    return organizationStageDrafts.get(selectedOrganizationStageCode) || null;
  }

  function showOrganizationStageError(message, input = null) {
    if (orgApprovalValidationError) {
      orgApprovalValidationError.textContent = message;
      orgApprovalValidationError.hidden = false;
    }
    if (input) {
      input.setAttribute("aria-invalid", "true");
      input.focus();
    }
  }

  function clearOrganizationStageError() {
    if (orgApprovalValidationError) {
      orgApprovalValidationError.textContent = "";
      orgApprovalValidationError.hidden = true;
    }
    orgApprovalStagesList?.querySelectorAll("[aria-invalid='true']").forEach((input) => {
      input.removeAttribute("aria-invalid");
    });
  }

  function markOrganizationStageDraftDirty() {
    const draft = currentOrganizationStageDraft();
    if (!draft) return;
    draft.dirty = true;
    if (orgApprovalSuccess) orgApprovalSuccess.hidden = true;
    if (orgApprovalDiscardBtn) orgApprovalDiscardBtn.disabled = false;
  }

  function createOrganizationStageInput(labelText, type, value, maxLength) {
    const label = document.createElement("label");
    const text = document.createElement("span");
    const input = document.createElement("input");
    text.textContent = labelText;
    input.type = type;
    input.value = value;
    if (maxLength) input.maxLength = maxLength;
    input.disabled = !settingsReady || organizationStagesSaving;
    label.append(text, input);
    return { label, input };
  }

  function getReviewerAccount(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) return Promise.resolve({ status: "empty" });
    if (reviewerAccountLookups.has(normalizedEmail)) {
      return reviewerAccountLookups.get(normalizedEmail);
    }
    const lookup = (async () => {
      try {
        const result = await getDocs(query(
          collection(db, "adminUser"),
          where("email", "==", normalizedEmail),
        ));
        const accountSnapshot = result.docs.find((entry) =>
          String(entry.data()?.email || "").trim().toLowerCase() === normalizedEmail,
        );
        if (!accountSnapshot) return { status: "missing" };
        const account = accountSnapshot.data() || {};
        const nameParts = [account.firstName, account.middleName, account.lastName]
          .map((part) => String(part || "").trim())
          .filter(Boolean);
        const name = String(
          account.fullName || account.name || account.displayName || nameParts.join(" ") ||
          account.username || "Unknown name",
        );
        const role = String(account.role || account.adminRole || account.userRole || account.roleSuffix || "Unknown role");
        return { status: "found", name, role };
      } catch (error) {
        console.error("[ApprovalStages] reviewer account lookup failed:", error?.code, error?.message);
        return { status: "error", error };
      }
    })();
    reviewerAccountLookups.set(normalizedEmail, lookup);
    return lookup;
  }

  function renderReviewerLookupStatus(statusElement, state) {
    statusElement.className = "settings-reviewer-lookup-status";
    if (state.status === "found") {
      statusElement.textContent = `Account found: ${state.name} (${state.role})`;
      statusElement.classList.add("is-found");
    } else if (state.status === "missing") {
      statusElement.textContent = "No admin account with this email";
      statusElement.classList.add("is-missing");
    } else if (state.status === "checking") {
      statusElement.textContent = "Checking admin account...";
      statusElement.classList.add("is-checking");
    } else if (state.status === "error") {
      statusElement.textContent = "Could not verify this admin account.";
      statusElement.classList.add("is-error");
    } else {
      statusElement.textContent = "";
    }
  }

  function renderOrganizationApprovalStages() {
    if (!orgApprovalStagesList) return;
    orgApprovalStagesList.replaceChildren();
    const draft = currentOrganizationStageDraft();
    if (!draft || !draft.stages.length) {
      const empty = document.createElement("p");
      empty.className = "settings-stage-empty";
      empty.textContent = "No stages configured. Add at least one stage before saving.";
      orgApprovalStagesList.appendChild(empty);
    } else {
      draft.stages.forEach((stage, index) => {
        const card = document.createElement("article");
        card.className = "settings-org-approval-stage-card";
        card.dataset.index = String(index);
        card.setAttribute("role", "listitem");

        const orderControls = document.createElement("div");
        orderControls.className = "settings-org-approval-stage-order";
        const up = document.createElement("button");
        up.type = "button";
        up.textContent = "↑";
        up.setAttribute("aria-label", `Move ${stage.name || `stage ${index + 1}`} up`);
        up.disabled = index === 0 || !settingsReady || organizationStagesSaving;
        const number = document.createElement("span");
        number.textContent = String(index + 1);
        const down = document.createElement("button");
        down.type = "button";
        down.textContent = "↓";
        down.setAttribute("aria-label", `Move ${stage.name || `stage ${index + 1}`} down`);
        down.disabled = index === draft.stages.length - 1 || !settingsReady || organizationStagesSaving;
        orderControls.append(up, number, down);

        const fields = document.createElement("div");
        fields.className = "settings-org-approval-stage-fields";
        const stageName = createOrganizationStageInput("Stage name", "text", stage.name, 60);
        stageName.input.autocomplete = "off";
        stageName.input.addEventListener("input", () => {
          stage.name = stageName.input.value;
          up.setAttribute("aria-label", `Move ${stage.name || `stage ${index + 1}`} up`);
          down.setAttribute("aria-label", `Move ${stage.name || `stage ${index + 1}`} down`);
          remove.setAttribute("aria-label", `Remove ${stage.name || `stage ${index + 1}`}`);
          markOrganizationStageDraftDirty();
          clearOrganizationStageError();
        });
        const reviewer = createOrganizationStageInput("Reviewer display name", "text", stage.reviewerName, 80);
        reviewer.input.addEventListener("input", () => {
          stage.reviewerName = reviewer.input.value;
          markOrganizationStageDraftDirty();
          clearOrganizationStageError();
        });
        const reviewerEmail = createOrganizationStageInput(
          "Reviewer account email (optional)",
          "email",
          stage.reviewerEmail,
          254,
        );
        reviewerEmail.input.autocomplete = "email";
        const reviewerLookupStatus = document.createElement("span");
        reviewerLookupStatus.className = "settings-reviewer-lookup-status";
        reviewerLookupStatus.setAttribute("role", "status");
        const reviewerMappingNote = document.createElement("span");
        reviewerMappingNote.className = "settings-reviewer-mapping-note";
        reviewerMappingNote.textContent =
          "The reviewer must also be linked to this organization in the approver mapping (set up in Firebase console).";
        reviewerEmail.label.append(reviewerLookupStatus, reviewerMappingNote);
        const lookupReviewer = async () => {
          const email = String(reviewerEmail.input.value || "").trim().toLowerCase();
          if (!email) {
            renderReviewerLookupStatus(reviewerLookupStatus, { status: "empty" });
            return { status: "empty" };
          }
          renderReviewerLookupStatus(reviewerLookupStatus, { status: "checking" });
          const result = await getReviewerAccount(email);
          if (String(reviewerEmail.input.value || "").trim().toLowerCase() === email) {
            renderReviewerLookupStatus(reviewerLookupStatus, result);
          }
          return result;
        };
        let reviewerLookupTimer = null;
        reviewerEmail.input.addEventListener("input", () => {
          stage.reviewerEmail = reviewerEmail.input.value;
          if (index === 0) {
            const directoryEmail = getOrganizationAdviserEmail(selectedOrganizationStageCode);
            draft.adviserEmailManuallyOverridden =
              String(stage.reviewerEmail || "").trim().toLowerCase() !== directoryEmail;
            if (!draft.adviserEmailManuallyOverridden) {
              draft.syncedAdviserEmail = directoryEmail;
            }
          }
          markOrganizationStageDraftDirty();
          clearOrganizationStageError();
          clearTimeout(reviewerLookupTimer);
          reviewerLookupTimer = setTimeout(() => {
            void lookupReviewer();
          }, 350);
        });
        reviewerEmail.input.addEventListener("blur", () => {
          clearTimeout(reviewerLookupTimer);
          void lookupReviewer();
        });
        if (String(stage.reviewerEmail || "").trim()) {
          void lookupReviewer();
        }
        const requiredLabel = document.createElement("label");
        requiredLabel.className = "settings-org-approval-required";
        const required = document.createElement("input");
        required.type = "checkbox";
        required.checked = stage.required === true;
        required.disabled = !settingsReady || organizationStagesSaving;
        required.addEventListener("change", () => {
          stage.required = required.checked;
          markOrganizationStageDraftDirty();
          clearOrganizationStageError();
        });
        const requiredText = document.createElement("span");
        requiredText.textContent = "Required";
        requiredLabel.append(required, requiredText);
        fields.append(stageName.label, reviewer.label, reviewerEmail.label, requiredLabel);

        const remove = document.createElement("button");
        remove.className = "settings-org-stage-remove";
        remove.type = "button";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", `Remove ${stage.name || `stage ${index + 1}`}`);
        remove.disabled = !settingsReady || organizationStagesSaving;
        remove.addEventListener("click", () => {
          const label = stage.name || `stage ${index + 1}`;
          if (!window.confirm(`Remove "${label}" from ${selectedOrganizationStageCode} stages?`)) return;
          draft.stages.splice(index, 1);
          markOrganizationStageDraftDirty();
          renderOrganizationApprovalStages();
        });
        up.addEventListener("click", () => moveOrganizationStage(index, -1));
        down.addEventListener("click", () => moveOrganizationStage(index, 1));
        card.append(orderControls, fields, remove);
        orgApprovalStagesList.appendChild(card);
      });
    }
    renderOrganizationStageStatus();
  }

  function moveOrganizationStage(index, delta) {
    const draft = currentOrganizationStageDraft();
    if (!draft || organizationStagesSaving) return;
    const target = index + delta;
    if (target < 0 || target >= draft.stages.length) return;
    const [stage] = draft.stages.splice(index, 1);
    draft.stages.splice(target, 0, stage);
    markOrganizationStageDraftDirty();
    renderOrganizationApprovalStages();
    orgApprovalStagesList?.querySelector(`[data-index="${target}"] button[aria-label*="up"]`)?.focus();
  }

  function renderOrganizationStageStatus() {
    const draft = currentOrganizationStageDraft();
    if (!draft) return;
    if (orgApprovalStatusBadge) {
      orgApprovalStatusBadge.textContent = draft.custom ? "Custom stages" : "Using default stages";
      orgApprovalStatusBadge.classList.toggle("is-custom", draft.custom);
    }
    if (orgApprovalStartingCopy) orgApprovalStartingCopy.hidden = draft.custom;
    if (orgApprovalSaveBtn) {
      orgApprovalSaveBtn.textContent = `Save ${selectedOrganizationStageCode} stages`;
      orgApprovalSaveBtn.disabled = !settingsReady || organizationStagesSaving;
    }
    if (orgApprovalDiscardBtn) {
      orgApprovalDiscardBtn.disabled = !settingsReady || organizationStagesSaving || !draft.dirty;
    }
    if (orgApprovalResetBtn) {
      orgApprovalResetBtn.disabled = !settingsReady || organizationStagesSaving || !draft.custom;
    }
    if (orgApprovalAddStageBtn) {
      orgApprovalAddStageBtn.disabled = !settingsReady || organizationStagesSaving;
    }
  }

  function renderOrganizationStageControls() {
    if (!orgApprovalSelector || !orgApprovalPills) return;
    const codes = getOrganizationStageCodes();
    const currentCodeIsPresent = codes.includes(selectedOrganizationStageCode);
    if (!currentCodeIsPresent) {
      selectedOrganizationStageCode = codes[0] || "";
    }
    orgApprovalSelector.replaceChildren();
    orgApprovalPills.replaceChildren();
    codes.forEach((code) => {
      const organization = (workingOrganizations || []).find(
        (entry) => normalizeOrganizationCode(entry.code) === code,
      );
      const option = document.createElement("option");
      option.value = code;
      option.textContent = organization?.name
        ? `${code} - ${organization.name}`
        : code;
      option.selected = code === selectedOrganizationStageCode;
      orgApprovalSelector.appendChild(option);

      const pill = document.createElement("button");
      pill.className = "settings-org-approval-pill";
      pill.type = "button";
      pill.textContent = code;
      pill.setAttribute("aria-pressed", String(code === selectedOrganizationStageCode));
      pill.disabled = !settingsReady || organizationStagesSaving;
      pill.addEventListener("click", () => {
        void requestOrganizationStageSelection(code);
      });
      orgApprovalPills.appendChild(pill);
    });
    if (selectedOrganizationStageCode) {
      orgApprovalSelector.value = selectedOrganizationStageCode;
      if (!organizationStageDrafts.has(selectedOrganizationStageCode)) {
        organizationStageDrafts.set(
          selectedOrganizationStageCode,
          createOrganizationStageDraft(selectedOrganizationStageCode),
        );
      }
    } else {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No organizations available";
      orgApprovalSelector.appendChild(option);
    }
    orgListEl?.querySelectorAll(".settings-org-row").forEach((row) => {
      const selected = normalizeOrganizationCode(row.dataset.orgCode) === selectedOrganizationStageCode;
      row.classList.toggle("is-approval-selected", selected);
      row.querySelector(".settings-org-stage-select")?.setAttribute("aria-pressed", String(selected));
    });
    renderOrganizationStageDirectoryError();
    renderOrganizationApprovalStages();
  }

  function renderOrganizationStageDirectoryError() {
    if (!orgApprovalDirectoryError) return;
    const invalidCode = (workingOrganizations || []).find((organization) =>
      [".", "/", "[", "]", "*", "~"].some((character) =>
        String(organization.code || "").includes(character),
      ),
    );
    if (!invalidCode) {
      orgApprovalDirectoryError.textContent = "";
      orgApprovalDirectoryError.hidden = true;
      return;
    }
    const code = String(invalidCode.code || "");
    orgApprovalDirectoryError.textContent =
      `Organization code "${code}" contains a Firestore field-path character. Remove ., /, [, ], *, and ~ before configuring or saving its stages.`;
    orgApprovalDirectoryError.hidden = false;
  }

  function resetOrganizationStageDraft(code) {
    organizationStageDrafts.set(code, createOrganizationStageDraft(code));
    clearOrganizationStageError();
    renderOrganizationApprovalStages();
  }

  function selectOrganizationStages(code) {
    selectedOrganizationStageCode = code;
    if (!organizationStageDrafts.has(code)) {
      organizationStageDrafts.set(code, createOrganizationStageDraft(code));
    }
    if (orgApprovalSuccess) orgApprovalSuccess.hidden = true;
    renderOrganizationStageControls();
  }

  async function requestOrganizationStageSelection(code) {
    if (!code || code === selectedOrganizationStageCode) return;
    const currentDraft = currentOrganizationStageDraft();
    if (!currentDraft?.dirty) {
      selectOrganizationStages(code);
      return;
    }
    if (!orgStageSwitchDialog || orgStageSwitchDialog.open) return;
    if (orgStageSwitchMessage) {
      orgStageSwitchMessage.textContent =
        `Save changes to ${selectedOrganizationStageCode} stages before switching to ${code}?`;
    }
    const previousFocus = document.activeElement;
    const answer = await new Promise((resolve) => {
      const finish = (choice) => {
        orgStageSwitchDialog.removeEventListener("close", onClose);
        orgStageSwitchSaveBtn?.removeEventListener("click", onSave);
        orgStageSwitchDiscardBtn?.removeEventListener("click", onDiscard);
        orgStageSwitchCancelBtn?.removeEventListener("click", onCancel);
        resolve(choice);
      };
      const onClose = () => finish("cancel");
      const onSave = () => {
        orgStageSwitchDialog.close();
        finish("save");
      };
      const onDiscard = () => {
        orgStageSwitchDialog.close();
        finish("discard");
      };
      const onCancel = () => {
        orgStageSwitchDialog.close();
        finish("cancel");
      };
      orgStageSwitchDialog.addEventListener("close", onClose, { once: true });
      orgStageSwitchSaveBtn?.addEventListener("click", onSave, { once: true });
      orgStageSwitchDiscardBtn?.addEventListener("click", onDiscard, { once: true });
      orgStageSwitchCancelBtn?.addEventListener("click", onCancel, { once: true });
      orgStageSwitchDialog.showModal();
      orgStageSwitchCancelBtn?.focus();
    });
    if (answer === "save") {
      if (await saveOrganizationStages()) selectOrganizationStages(code);
      else renderOrganizationStageControls();
    } else if (answer === "discard") {
      resetOrganizationStageDraft(selectedOrganizationStageCode);
      selectOrganizationStages(code);
    } else {
      renderOrganizationStageControls();
      previousFocus?.focus?.();
    }
  }

  function validateOrganizationStageDraft(draft) {
    if (!draft || draft.stages.length < 1 || draft.stages.length > 8) {
      return { message: "Add between 1 and 8 approval stages.", input: orgApprovalAddStageBtn };
    }
    const names = new Set();
    let hasRequiredStage = false;
    for (let index = 0; index < draft.stages.length; index += 1) {
      const stage = draft.stages[index];
      const card = orgApprovalStagesList?.querySelector(`[data-index="${index}"]`);
      const name = String(stage.name || "").trim();
      const reviewerName = String(stage.reviewerName || "");
      const email = String(stage.reviewerEmail || "").trim();
      if (name.length < 2 || name.length > 60) {
        return {
          message: `Stage ${index + 1} name must be 2 to 60 characters.`,
          input: card?.querySelector(".settings-org-approval-stage-fields label input"),
        };
      }
      const nameKey = name.toLocaleLowerCase();
      if (names.has(nameKey)) {
        return {
          message: `Stage name "${name}" is duplicated. Stage names must be unique within this organization.`,
          input: card?.querySelector(".settings-org-approval-stage-fields label input"),
        };
      }
      names.add(nameKey);
      if (reviewerName.length > 80) {
        return {
          message: `Reviewer display name for "${name}" must be 0 to 80 characters.`,
          input: card?.querySelectorAll(".settings-org-approval-stage-fields label input")[1],
        };
      }
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return {
          message: `Enter a valid reviewer account email for "${name}", or leave it blank.`,
          input: card?.querySelectorAll(".settings-org-approval-stage-fields label input")[2],
        };
      }
      if (typeof stage.required !== "boolean") {
        return { message: `Set whether "${name}" is required.`, input: card?.querySelector('input[type="checkbox"]') };
      }
      hasRequiredStage ||= stage.required;
    }
    if (!hasRequiredStage) {
      return {
        message: "At least one stage must be marked Required.",
        input: orgApprovalStagesList?.querySelector('input[type="checkbox"]'),
      };
    }
    return null;
  }

  function setOrganizationStagesSaving(saving) {
    organizationStagesSaving = saving;
    orgApprovalStagesList?.querySelectorAll("input, button").forEach((control) => {
      control.disabled = saving;
    });
    orgApprovalPills?.querySelectorAll("button").forEach((button) => {
      button.disabled = saving || !settingsReady;
    });
    renderOrganizationStageStatus();
    if (orgApprovalSelector) orgApprovalSelector.disabled = saving || !settingsReady;
  }

  async function saveOrganizationStages() {
    if (!settingsReady || organizationStagesSaving) return false;
    clearOrganizationStageError();
    const code = selectedOrganizationStageCode;
    if (!code) {
      showOrganizationStageError("Select an organization from the directory before saving.");
      return false;
    }
    if ([".", "/", "[", "]", "*", "~"].some((character) => code.includes(character))) {
      showOrganizationStageError(
        `Organization code "${code}" contains a Firestore field-path character. Remove ., /, [, ], *, and ~.`,
      );
      return false;
    }
    const draft = currentOrganizationStageDraft();
    const invalid = validateOrganizationStageDraft(draft);
    if (invalid) {
      showOrganizationStageError(invalid.message, invalid.input);
      return false;
    }
    if (!settingsRef || !db || !auth?.currentUser?.uid) {
      showOrganizationStageError("A signed-in super admin and Firestore connection are required to save stages.");
      return false;
    }

    setOrganizationStagesSaving(true);
    if (orgApprovalSuccess) orgApprovalSuccess.hidden = true;
    const reviewerEmails = [...new Set(draft.stages
      .map((stage) => String(stage.reviewerEmail || "").trim().toLowerCase())
      .filter(Boolean))];
    const reviewerAccounts = await Promise.all(reviewerEmails.map((email) => getReviewerAccount(email)));
    if (reviewerAccounts.some((account) => account.status === "error")) {
      showOrganizationStageError("Could not verify one or more reviewer accounts. Correct the email or try again later.");
      setOrganizationStagesSaving(false);
      return false;
    }
    if (
      reviewerAccounts.some((account) => account.status === "missing") &&
      !window.confirm("This reviewer has no account yet and will not be able to see proposals. Save anyway?")
    ) {
      setOrganizationStagesSaving(false);
      return false;
    }

    const stages = draft.stages.map((stage, order) => ({
      id: String(stage.id),
      name: String(stage.name).trim(),
      required: stage.required,
      reviewerName: String(stage.reviewerName || "").trim(),
      reviewerEmail: String(stage.reviewerEmail || "").trim().toLowerCase(),
      order,
    }));
    try {
      await setDoc(settingsRef, {
        approvalStagesByOrg: {
          [code]: {
            stages,
            updatedAt: serverTimestamp(),
            updatedBy: auth.currentUser.uid,
          },
        },
      }, { merge: true });

      const savedEntry = {
        stages,
        updatedAt: new Date().toISOString(),
        updatedBy: auth.currentUser.uid,
      };
      currentSettings.approvalStagesByOrg = {
        ...(currentSettings.approvalStagesByOrg || {}),
        [code]: savedEntry,
      };
      cacheSettings(currentSettings);
      organizationStageDrafts.set(code, {
        stages: createOrganizationStageCopy(stages),
        custom: true,
        dirty: false,
        adviserEmailManuallyOverridden: draft.adviserEmailManuallyOverridden,
        syncedAdviserEmail: draft.syncedAdviserEmail,
      });
      renderOrganizationStageControls();
      if (orgApprovalSuccess) {
        orgApprovalSuccess.textContent = `${code} approval stages saved successfully.`;
        orgApprovalSuccess.hidden = false;
      }
      try {
        await appendAudit(
          `${actorTag()} updated per-organization approval stages for ${code} (${stages.length} stages)`,
        );
      } catch (auditError) {
        console.warn("Organization approval stages were saved, but the audit log could not be written:", auditError);
        showMessage(`Saved ${code} stages, but the audit log could not be written.`, true);
      }
      return true;
    } catch (error) {
      console.error(`Unable to save ${code} approval stages:`, error);
      showOrganizationStageError(`Could not save ${code} stages. Check your connection and permissions, then try again.`);
      return false;
    } finally {
      setOrganizationStagesSaving(false);
    }
  }

  async function resetOrganizationStagesToDefault() {
    const code = selectedOrganizationStageCode;
    const draft = currentOrganizationStageDraft();
    if (!settingsReady || organizationStagesSaving || !code || !draft?.custom) return;
    if ([".", "/", "[", "]", "*", "~"].some((character) => code.includes(character))) {
      showOrganizationStageError(
        `Organization code "${code}" contains a Firestore field-path character. Remove ., /, [, ], *, and ~.`,
      );
      return;
    }
    if (!window.confirm(`Reset ${code} to the default approval stages? This removes only its custom stages and discards any unsaved edits.`)) {
      return;
    }
    if (!settingsRef || !db || !auth?.currentUser?.uid) {
      showOrganizationStageError("A signed-in super admin and Firestore connection are required to reset stages.");
      return;
    }
    setOrganizationStagesSaving(true);
    if (orgApprovalSuccess) orgApprovalSuccess.hidden = true;
    try {
      await updateDoc(settingsRef, {
        [`approvalStagesByOrg.${code}`]: deleteField(),
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid,
      });
      const map = { ...(currentSettings.approvalStagesByOrg || {}) };
      delete map[code];
      currentSettings.approvalStagesByOrg = map;
      cacheSettings(currentSettings);
      resetOrganizationStageDraft(code);
      if (orgApprovalSuccess) {
        orgApprovalSuccess.textContent = `${code} now uses the default approval stages.`;
        orgApprovalSuccess.hidden = false;
      }
      try {
        await appendAudit(`${actorTag()} reset ${code} approval stages to default`);
      } catch (auditError) {
        console.warn("Organization stages were reset, but the audit log could not be written:", auditError);
        showMessage(`Reset ${code} stages, but the audit log could not be written.`, true);
      }
    } catch (error) {
      console.error(`Unable to reset ${code} approval stages:`, error);
      showOrganizationStageError(`Could not reset ${code} stages. Check your connection and permissions, then try again.`);
    } finally {
      setOrganizationStagesSaving(false);
    }
  }

  orgApprovalSelector?.addEventListener("change", (event) => {
    void requestOrganizationStageSelection(event.currentTarget.value);
  });
  orgApprovalSaveBtn?.addEventListener("click", () => void saveOrganizationStages());
  orgApprovalDiscardBtn?.addEventListener("click", () => {
    if (selectedOrganizationStageCode) resetOrganizationStageDraft(selectedOrganizationStageCode);
  });
  orgApprovalResetBtn?.addEventListener("click", () => void resetOrganizationStagesToDefault());
  orgApprovalAddStageBtn?.addEventListener("click", () => {
    const draft = currentOrganizationStageDraft();
    if (!draft || organizationStagesSaving) return;
    if (draft.stages.length >= 8) {
      showOrganizationStageError("An organization can have no more than 8 approval stages.");
      return;
    }
    const name = `Stage ${draft.stages.length + 1}`;
    draft.stages.push({
      id: makeOrganizationStageId(name),
      name,
      required: true,
      reviewerName: "",
      reviewerEmail: "",
      order: draft.stages.length,
    });
    markOrganizationStageDraftDirty();
    renderOrganizationApprovalStages();
    orgApprovalStagesList?.querySelector(`[data-index="${draft.stages.length - 1}"] input`)?.focus();
  });

  // --- Save Validation and Confirmation ---

  function handleSaveGeneralSettingsClick() {
    if (!settingsReady) return;

    const rawUpload = (maxUploadInput?.value || "").trim();
    const maxUploadVal = Number(rawUpload);
    if (!rawUpload || isNaN(maxUploadVal) || !Number.isInteger(maxUploadVal) || maxUploadVal < 1 || maxUploadVal > 50) {
      flagValidationError(maxUploadInput, "Maximum upload size must be a whole number between 1 and 50 MB.");
      return;
    }

    if (!workingOrganizations || !workingOrganizations.some((organization) => organization.active !== false)) {
      flagValidationError(addOrgBtn, "At least one active organization is required in the directory.");
      return;
    }
    const selectedMainOrg = normalizeOrganizationCode(mainOrgSelect?.value || workingMainOrg);
    if (!workingOrganizations.some((organization) =>
      organization.active !== false && normalizeOrganizationCode(organization.code) === selectedMainOrg
    )) {
      flagValidationError(mainOrgSelect, "Please select an active main organizing organization.");
      return;
    }

    handleSaveSettingsClick();
  }

  function handleSaveSettingsClick() {
    if (!settingsReady) return;
    if (stagesErrorEl) {
      stagesErrorEl.hidden = true;
      stagesErrorEl.textContent = "";
    }

    document.querySelectorAll(".is-invalid").forEach((el) => el.classList.remove("is-invalid"));

    // 1. Validate Organizations Directory first
    if (!workingOrganizations || !workingOrganizations.length) {
      flagValidationError(addOrgBtn, "At least one organization is required in the directory.");
      return;
    }

    for (let i = 0; i < workingOrganizations.length; i++) {
      const o = workingOrganizations[i];
      const row = orgListEl?.querySelector(`[data-index="${i}"]`);
      const code = (o.code || "").trim();
      const name = (o.name || "").trim();

      if (!code) {
        const inp = row?.querySelector(".settings-org-code-input");
        flagValidationError(inp, `Please enter an organization code for Row ${i + 1}.`);
        return;
      }
      if (code.length > 25) {
        const inp = row?.querySelector(".settings-org-code-input");
        flagValidationError(inp, `Organization code "${code}" exceeds the 25-character limit.`);
        return;
      }
      if ([".", "/", "[", "]", "*", "~"].some((character) => code.includes(character))) {
        const inp = row?.querySelector(".settings-org-code-input");
        flagValidationError(
          inp,
          `Organization code "${code}" contains a Firestore field-path character. Remove ., /, [, ], *, and ~.`,
        );
        if (orgApprovalDirectoryError) {
          orgApprovalDirectoryError.textContent = `Organization code "${code}" contains a Firestore field-path character. Remove ., /, [, ], *, and ~.`;
          orgApprovalDirectoryError.hidden = false;
        }
        return;
      }
      if (!name) {
        const inp = row?.querySelector(".settings-org-name-input");
        flagValidationError(inp, `Please enter an organization name for "${code}".`);
        return;
      }
      const adviserEmail = String(o.adviserEmail || "").trim();
      if (adviserEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adviserEmail)) {
        const inp = row?.querySelector(".settings-org-adviser-input");
        flagValidationError(inp, `Enter a valid adviser email for "${code}", or leave it blank.`);
        return;
      }
    }

    // Check duplicate organization codes (case-insensitive)
    const seenOrgCodes = new Map();
    for (let i = 0; i < workingOrganizations.length; i++) {
      const codeKey = (workingOrganizations[i].code || "").trim().toLowerCase();
      if (seenOrgCodes.has(codeKey)) {
        const firstIdx = seenOrgCodes.get(codeKey);
        const row = orgListEl?.querySelector(`[data-index="${i}"]`);
        const firstRow = orgListEl?.querySelector(`[data-index="${firstIdx}"]`);
        const inp = row?.querySelector(".settings-org-code-input");
        firstRow?.querySelector(".settings-org-code-input")?.classList.add("is-invalid");
        flagValidationError(
          inp,
          `Duplicate organization code "${workingOrganizations[i].code.trim()}". Each organization must have a unique code.`
        );
        return;
      }
      seenOrgCodes.set(codeKey, i);
    }

    // Check duplicate organization names (case-insensitive)
    const seenOrgNames = new Map();
    for (let i = 0; i < workingOrganizations.length; i++) {
      const nameKey = (workingOrganizations[i].name || "").trim().toLowerCase();
      if (seenOrgNames.has(nameKey)) {
        const firstIdx = seenOrgNames.get(nameKey);
        const row = orgListEl?.querySelector(`[data-index="${i}"]`);
        const firstRow = orgListEl?.querySelector(`[data-index="${firstIdx}"]`);
        const inp = row?.querySelector(".settings-org-name-input");
        firstRow?.querySelector(".settings-org-name-input")?.classList.add("is-invalid");
        flagValidationError(
          inp,
          `Duplicate organization name "${workingOrganizations[i].name.trim()}". Each organization must have a unique name.`
        );
        return;
      }
      seenOrgNames.set(nameKey, i);
    }

    const seenAdviserEmails = new Map();
    for (let i = 0; i < workingOrganizations.length; i++) {
      const email = String(workingOrganizations[i].adviserEmail || "").trim().toLowerCase();
      if (!email) continue;
      if (seenAdviserEmails.has(email)) {
        const row = orgListEl?.querySelector(`[data-index="${i}"]`);
        const firstRow = orgListEl?.querySelector(`[data-index="${seenAdviserEmails.get(email)}"]`);
        const input = row?.querySelector(".settings-org-adviser-input");
        firstRow?.querySelector(".settings-org-adviser-input")?.classList.add("is-invalid");
        flagValidationError(input, "An adviser email can only be assigned to one organization.");
        return;
      }
      seenAdviserEmails.set(email, i);
    }

    // 2. Validate General Settings
    const selectedMainOrg = (mainOrgSelect?.value || workingMainOrg || "").trim();
    if (!selectedMainOrg) {
      flagValidationError(mainOrgSelect, "Please select a main organizing organization.");
      return;
    }

    const orgExists = workingOrganizations.some(
      (o) => (o.code || "").trim().toLowerCase() === selectedMainOrg.toLowerCase()
    );
    if (!orgExists) {
      flagValidationError(
        mainOrgSelect,
        `Selected main organization "${selectedMainOrg}" is not present in the organization directory. Please select an active organization.`
      );
      return;
    }
    workingMainOrg = selectedMainOrg;

    const rawUpload = (maxUploadInput?.value || "").trim();
    const maxUploadVal = Number(rawUpload);
    if (!rawUpload || isNaN(maxUploadVal) || !Number.isInteger(maxUploadVal) || maxUploadVal < 1 || maxUploadVal > 100) {
      flagValidationError(maxUploadInput, "Maximum upload size must be a whole number between 1 and 100 MB.");
      return;
    }

    // 3. Validate Approval Stages
    if (!workingApprovalStages || !workingApprovalStages.length) {
      flagValidationError(addStageBtn, "At least one approval stage is required.");
      return;
    }

    for (let i = 0; i < workingApprovalStages.length; i++) {
      const s = workingApprovalStages[i];
      const card = stagesList?.querySelector(`[data-index="${i}"]`);
      const sName = (s.name || "").trim();
      const sRev = (s.reviewer || "").trim();

      if (!sName) {
        const inp = card?.querySelector(".settings-stage-name-input");
        flagValidationError(inp, `Please enter a stage name for Step ${i + 1}.`);
        return;
      }
      if (!sRev) {
        const inp = card?.querySelector(".settings-stage-reviewer-input");
        flagValidationError(inp, `Please assign a reviewer for Step ${i + 1} ("${sName}").`);
        return;
      }
      const reviewerEmail = String(s.reviewerEmail || "").trim();
      if (reviewerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reviewerEmail)) {
        const inp = card?.querySelector(".settings-stage-reviewer-email-input");
        flagValidationError(inp, `Enter a valid reviewer email for Step ${i + 1}, or leave it blank.`);
        return;
      }
    }

    const seenReviewerEmails = new Map();
    for (let i = 0; i < workingApprovalStages.length; i++) {
      const email = String(workingApprovalStages[i].reviewerEmail || "").trim().toLowerCase();
      if (!email) continue;
      if (seenReviewerEmails.has(email)) {
        const card = stagesList?.querySelector(`[data-index="${i}"]`);
        const firstCard = stagesList?.querySelector(`[data-index="${seenReviewerEmails.get(email)}"]`);
        const input = card?.querySelector(".settings-stage-reviewer-email-input");
        firstCard?.querySelector(".settings-stage-reviewer-email-input")?.classList.add("is-invalid");
        flagValidationError(input, "A reviewer email can only be assigned to one approval stage.");
        return;
      }
      seenReviewerEmails.set(email, i);
    }

    // Check duplicate stage names (case-insensitive)
    const seenStageNames = new Map();
    for (let i = 0; i < workingApprovalStages.length; i++) {
      const nameKey = (workingApprovalStages[i].name || "").trim().toLowerCase();
      if (seenStageNames.has(nameKey)) {
        const firstIdx = seenStageNames.get(nameKey);
        const card = stagesList?.querySelector(`[data-index="${i}"]`);
        const firstCard = stagesList?.querySelector(`[data-index="${firstIdx}"]`);
        const inp = card?.querySelector(".settings-stage-name-input");
        firstCard?.querySelector(".settings-stage-name-input")?.classList.add("is-invalid");
        flagValidationError(
          inp,
          `Duplicate stage name "${workingApprovalStages[i].name.trim()}". Each approval stage must have a unique name.`
        );
        return;
      }
      seenStageNames.set(nameKey, i);
    }

    // Check at least one stage is marked as required
    const hasRequired = workingApprovalStages.some((s) => s.required);
    if (!hasRequired) {
      const card = stagesList?.querySelector(`[data-index="0"]`);
      const chk = card?.querySelector(".settings-stage-required-checkbox");
      flagValidationError(chk, "At least one approval stage must be marked as Required.");
      return;
    }

    openConfirmationDialog({
      title: "Save System Settings?",
      text: `Are you sure you want to save changes to the system settings? These updates (General settings, ${workingOrganizations.length} organization(s) in directory, and ${workingApprovalStages.length} sequential approval stages) will apply to new proposals. Existing proposals keep their current approval workflow.`,
      yesText: "Yes, Save",
      cancelText: "No, Cancel",
      onConfirm: async () => {
        return await persistAllSettings();
      },
      onCancel: () => {},
    });
  }

  async function persistAllSettings() {
    const nextMainOrg = workingMainOrg;
    const nextMaxUpload = Number(maxUploadInput?.value) || 15;
    const nextAllowedDocs = currentSettings.allowedDocumentTypes;
    const nextOrgs = JSON.parse(JSON.stringify(workingOrganizations));
    const nextStages = JSON.parse(JSON.stringify(workingApprovalStages));

    currentSettings.mainOrganization = nextMainOrg;
    currentSettings.maxUploadSizeMb = nextMaxUpload;
    currentSettings.allowedDocumentTypes = nextAllowedDocs;
    currentSettings.organizations = nextOrgs;
    currentSettings.approvalStages = nextStages;

    if (!cacheSettings(currentSettings, Boolean(settingsRef))) {
      showMessage("Could not save system settings to the local cache.", true);
      return false;
    }

    renderOrganizations();
    renderApprovalStages();

    if (!settingsRef) {
      localStorage.removeItem(pendingSettingsKey);
      showMessage("System settings saved locally.");
      return true;
    }

    try {
      await setDoc(
        settingsRef,
        {
          mainOrganization: nextMainOrg,
          maxUploadSizeMb: nextMaxUpload,
          allowedDocumentTypes: nextAllowedDocs,
          organizations: nextOrgs,
          approvalStages: nextStages,
          registrationEnabled: currentSettings.registrationEnabled ?? true,
          loginEnabled: currentSettings.loginEnabled ?? true,
          venues: currentSettings.venues || [],
          categories: currentSettings.categories || [],
          eventSources: currentSettings.eventSources || [],
          updatedAt: serverTimestamp(),
          updatedBy: actorIdentifier(),
        },
        { merge: true }
      );

      try {
        await appendAudit(`${actorTag()} updated system settings (General, Organization Directory, and Approval Stages)`);
      } catch (auditErr) {
        console.warn("Audit log notice:", auditErr);
      }

      localStorage.removeItem(pendingSettingsKey);
      showMessage("System settings saved successfully.");
      return true;
    } catch (err) {
      console.error("Unable to save system settings:", err);
      showMessage("Saved locally. Cloud sync is pending and will retry when the connection is available.", true);
      return true;
    }
  }

  function backfillMissingFields(data) {
    if (backfillingDefaults) return backfillingDefaults;
    const missingFields = {};
    const normalized = normalizedSettings(data);
    Object.entries(defaultSettings).forEach(([field, defaultValue]) => {
      if (field in data) return;
      if (field === "userLoginEnabled") {
        missingFields[field] = normalized.userLoginEnabled;
      } else if (field === "eventRegistrationEnabled") {
        missingFields[field] = normalized.eventRegistrationEnabled;
      } else if (field === "maintenanceMessage") {
        missingFields[field] = currentSettings.maintenanceMessage || "";
      } else {
        missingFields[field] = defaultValue;
      }
    });
    if (!Object.keys(missingFields).length) return Promise.resolve();

    backfillingDefaults = updateDoc(settingsRef, {
      ...missingFields,
      updatedAt: serverTimestamp(),
    })
      .catch((error) => {
        if (DEBUG) console.error("Unable to initialize missing system settings:", error);
      })
      .finally(() => {
        backfillingDefaults = null;
      });
    return backfillingDefaults;
  }

  // --- Initial Render from Cache ---
  renderOrganizations();
  renderApprovalStages();
  if (maxUploadInput) maxUploadInput.value = currentSettings.maxUploadSizeMb;

  // --- Event Listeners Setup ---
  if (mainOrgSelect) {
    mainOrgSelect.addEventListener("change", (e) => {
      workingMainOrg = e.target.value;
      mainOrgSelect.classList.remove("is-invalid");
      if (stagesErrorEl) stagesErrorEl.hidden = true;
    });
  }

  if (maxUploadInput) {
    maxUploadInput.addEventListener("input", () => {
      maxUploadInput.classList.remove("is-invalid");
      if (stagesErrorEl) stagesErrorEl.hidden = true;
    });
  }

  if (addOrgBtn) {
    addOrgBtn.addEventListener("click", addOrganization);
  }

  if (saveOrganizationsBtn) {
    saveOrganizationsBtn.addEventListener("click", handleSaveSettingsClick);
  }

  if (addStageBtn) {
    addStageBtn.addEventListener("click", addApprovalStage);
  }

  if (saveStagesBtn) {
    saveStagesBtn.addEventListener("click", handleSaveSettingsClick);
  }

  if (saveStagesBottomBtn) {
    saveStagesBottomBtn.addEventListener("click", handleSaveSettingsClick);
  }

  if (saveGeneralBtn) {
    saveGeneralBtn.addEventListener("click", handleSaveGeneralSettingsClick);
  }

  let pendingConfirmAction = null;
  let pendingCancelAction = null;

  function openConfirmationDialog({
    title = "Confirm Action",
    text = "Are you sure?",
    yesText = "Yes, Save",
    cancelText = "No, Cancel",
    requireLock = false,
    onConfirm = null,
    onCancel = null,
  }) {
    if (!confirmDialog) return;
    const titleEl = document.getElementById("settings-confirm-title");
    const textEl = document.getElementById("settings-confirm-text");
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = text;
    if (confirmYesBtn) confirmYesBtn.textContent = yesText;
    if (confirmCancelBtn) confirmCancelBtn.textContent = cancelText;
    confirmationRequiresLock = requireLock;
    const lockField = document.getElementById("settings-lock-confirm-field");
    const lockInput = document.getElementById("settings-lock-confirm-input");
    if (lockField) lockField.hidden = !requireLock;
    if (lockInput) {
      lockInput.value = "";
      lockInput.setAttribute("aria-required", requireLock ? "true" : "false");
    }

    pendingConfirmAction = onConfirm;
    pendingCancelAction = onCancel;
    confirmDialog.showModal();
    if (requireLock) lockInput?.focus();
  }

  function dismissConfirmation(runCancel = true) {
    if (runCancel && typeof pendingCancelAction === "function") {
      try {
        pendingCancelAction();
      } catch (e) {
        if (DEBUG) console.error("Cancel callback error:", e);
      }
    }
    pendingConfirmAction = null;
    pendingCancelAction = null;
    confirmationRequiresLock = false;
    const lockField = document.getElementById("settings-lock-confirm-field");
    const lockInput = document.getElementById("settings-lock-confirm-input");
    if (lockField) lockField.hidden = true;
    if (lockInput) lockInput.value = "";
    if (confirmDialog && confirmDialog.open) {
      confirmDialog.close();
    }
    refreshLegacyDirty();
  }

  if (confirmCloseBtn) {
    confirmCloseBtn.addEventListener("click", () => dismissConfirmation(true));
  }

  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener("click", () => dismissConfirmation(true));
  }

  if (confirmDialog) {
    confirmDialog.addEventListener("cancel", () => dismissConfirmation(true));
    confirmDialog.addEventListener("click", (event) => {
      if (event.target === confirmDialog) dismissConfirmation(true);
    });
  }

  if (confirmYesBtn) {
    confirmYesBtn.addEventListener("click", async () => {
      if (confirmationRequiresLock) {
        const lockInput = document.getElementById("settings-lock-confirm-input");
        if (lockInput?.value !== "LOCK") {
          showMessage('Type "LOCK" exactly to turn off user login.', true);
          lockInput?.focus();
          return;
        }
      }
      confirmYesBtn.disabled = true;
      try {
        if (typeof pendingConfirmAction === "function") {
          const action = pendingConfirmAction;
          const ok = await action();
          if (ok !== false) {
            pendingConfirmAction = null;
            pendingCancelAction = null;
            confirmDialog?.close();
          }
        } else {
          const ok = await persistAllSettings();
          if (ok) {
            confirmDialog?.close();
          }
        }
      } catch (err) {
        if (DEBUG) console.error("Confirmation action error:", err);
      } finally {
        confirmYesBtn.disabled = false;
      }
    });
  }

  function updateToggleBadge(type, isEnabled) {
    const badge = type === "login" ? userLoginBadge : eventRegBadge;
    const toggle = type === "login" ? loginToggle : registrationToggle;
    toggle?.setAttribute("aria-checked", isEnabled ? "true" : "false");
    if (!badge) return;
    if (isEnabled) {
      badge.textContent = "On";
      badge.classList.remove("is-off");
      badge.classList.add("is-on");
    } else {
      badge.textContent = "Off";
      badge.classList.remove("is-on");
      badge.classList.add("is-off");
    }
  }

  function cloneSettings(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function timestampMillis(value) {
    if (value && typeof value.toMillis === "function") return value.toMillis();
    if (value && typeof value.toDate === "function") return value.toDate().getTime();
    if (value && Number.isFinite(value.seconds)) return value.seconds * 1000;
    if (value instanceof Date) return value.getTime();
    return 0;
  }

  function savedByName(data) {
    if (data?.updatedByName) return String(data.updatedByName);
    const updatedBy = String(data?.updatedBy || data?.user || "");
    const separator = updatedBy.lastIndexOf(" – ");
    return separator >= 0 ? updatedBy.slice(separator + 3) : updatedBy || "Super Admin";
  }

  function updateLastSaved(data) {
    const savedAt = timestampMillis(data?.updatedAt || data?.timestamp || data?.createdAt);
    if (!savedAt || savedAt < lastSavedAt) return;
    lastSavedAt = savedAt;
    const date = new Date(savedAt);
    const dateText = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
    const label = document.getElementById("settings-last-saved");
    if (label) label.textContent = `Last saved by ${savedByName(data)} on ${dateText}`;
  }

  function parseTagValues(value) {
    return [...new Set(String(value || "")
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean))];
  }

  function renderTags(input, list) {
    if (!input || !list) return;
    list.replaceChildren();
    parseTagValues(input.value).forEach((value) => {
      const tag = document.createElement("span");
      tag.className = "settings-tag";
      tag.textContent = value;
      list.appendChild(tag);
    });
  }

  function readHolidayRows() {
    return [...document.querySelectorAll("#holiday-list [data-holiday-row]")].map((row) => ({
      date: row.querySelector("[data-holiday-field='date']")?.value || "",
      name: row.querySelector("[data-holiday-field='name']")?.value.trim() || "",
      type: row.querySelector("[data-holiday-field='type']")?.value || "public",
    }));
  }

  function readAudienceRows(kind) {
    return [...document.querySelectorAll(`#audience-${kind}-list [data-audience-row]`)].map((row) => ({
      code: normalizeOrganizationCode(row.querySelector("[data-audience-field='code']")?.value),
      name: row.querySelector("[data-audience-field='name']")?.value.trim() || "",
      active: row.querySelector("[data-audience-field='active']")?.checked !== false,
    }));
  }

  function readSettingsSection(section) {
    const values = {};
    document.querySelectorAll(`[data-section="${section}"][data-field]`).forEach((field) => {
      if (field.type === "checkbox") {
        values[field.dataset.field] = field.checked;
      } else if (field.type === "number") {
        values[field.dataset.field] = field.value.trim() === "" ? "" : Number(field.value);
      } else if (field.dataset.field === "allowedCategories") {
        values[field.dataset.field] = parseTagValues(field.value);
      } else {
        values[field.dataset.field] = field.value;
      }
    });
    if (section === "calendar") values.holidays = readHolidayRows();
    if (section === "audience") {
      values.departments = readAudienceRows("departments");
      values.programs = readAudienceRows("programs");
    }
    return values;
  }

  function renderHolidayRows(holidays) {
    const list = document.getElementById("holiday-list");
    if (!list) return;
    list.replaceChildren();
    (Array.isArray(holidays) ? holidays : []).forEach((holiday, index) => {
      const row = document.createElement("div");
      row.className = "settings-calendar-row";
      row.dataset.holidayRow = "true";

      const dateLabel = document.createElement("label");
      dateLabel.className = "sr-only";
      dateLabel.htmlFor = `holiday-date-${index}`;
      dateLabel.textContent = "Holiday date";
      const dateInput = document.createElement("input");
      dateInput.type = "date";
      dateInput.id = `holiday-date-${index}`;
      dateInput.dataset.holidayField = "date";
      dateInput.value = String(holiday?.date || "");
      dateInput.setAttribute("aria-label", "Holiday date");

      const nameLabel = document.createElement("label");
      nameLabel.className = "sr-only";
      nameLabel.htmlFor = `holiday-name-${index}`;
      nameLabel.textContent = "Holiday name";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.id = `holiday-name-${index}`;
      nameInput.dataset.holidayField = "name";
      nameInput.maxLength = 120;
      nameInput.value = String(holiday?.name || "");
      nameInput.placeholder = "Holiday name";
      nameInput.setAttribute("aria-label", "Holiday name");

      const typeLabel = document.createElement("label");
      typeLabel.className = "sr-only";
      typeLabel.htmlFor = `holiday-type-${index}`;
      typeLabel.textContent = "Holiday type";
      const typeSelect = document.createElement("select");
      typeSelect.id = `holiday-type-${index}`;
      typeSelect.dataset.holidayField = "type";
      typeSelect.setAttribute("aria-label", "Holiday type");
      [["public", "Public"], ["academic", "Academic"], ["other", "Other"]].forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        typeSelect.appendChild(option);
      });
      typeSelect.value = ["public", "academic", "other"].includes(holiday?.type) ? holiday.type : "other";

      const removeButton = document.createElement("button");
      removeButton.className = "settings-row-remove";
      removeButton.type = "button";
      removeButton.textContent = "Remove";
      removeButton.setAttribute("aria-label", `Remove ${holiday?.name || "holiday"} row`);
      removeButton.addEventListener("click", () => {
        const values = readHolidayRows();
        values.splice(index, 1);
        renderHolidayRows(values);
        updateSectionDirty("calendar");
      });

      row.append(dateLabel, dateInput, nameLabel, nameInput, typeLabel, typeSelect, removeButton);
      list.appendChild(row);
    });
  }

  function renderAudienceRows(kind, records) {
    const list = document.getElementById(`audience-${kind}-list`);
    if (!list) return;
    list.replaceChildren();
    (Array.isArray(records) ? records : []).forEach((record, index) => {
      const row = document.createElement("div");
      row.className = "settings-audience-row";
      row.dataset.audienceRow = "true";

      const codeLabel = document.createElement("label");
      codeLabel.className = "sr-only";
      codeLabel.htmlFor = `audience-${kind}-code-${index}`;
      codeLabel.textContent = `${kind === "departments" ? "Department" : "Program"} code`;
      const codeInput = document.createElement("input");
      codeInput.type = "text";
      codeInput.id = codeLabel.htmlFor;
      codeInput.dataset.audienceField = "code";
      codeInput.maxLength = 32;
      codeInput.value = normalizeOrganizationCode(record?.code).toUpperCase();
      codeInput.style.textTransform = "uppercase";
      codeInput.placeholder = "Code";

      const nameLabel = document.createElement("label");
      nameLabel.className = "sr-only";
      nameLabel.htmlFor = `audience-${kind}-name-${index}`;
      nameLabel.textContent = `${kind === "departments" ? "Department" : "Program"} name`;
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.id = nameLabel.htmlFor;
      nameInput.dataset.audienceField = "name";
      nameInput.maxLength = 120;
      nameInput.value = String(record?.name || "");
      nameInput.placeholder = "Name";

      const activeLabel = document.createElement("label");
      activeLabel.className = "settings-audience-active";
      const activeInput = document.createElement("input");
      activeInput.type = "checkbox";
      activeInput.setAttribute("role", "switch");
      activeInput.setAttribute("aria-checked", record?.active === false ? "false" : "true");
      activeInput.dataset.audienceField = "active";
      activeInput.checked = record?.active !== false;
      activeLabel.append(activeInput, document.createTextNode("Active"));

      row.append(codeLabel, codeInput, nameLabel, nameInput, activeLabel);
      list.appendChild(row);
    });
  }

  function setSettingsSection(section, values) {
    document.querySelectorAll(`[data-section="${section}"][data-field]`).forEach((field) => {
      const value = values?.[field.dataset.field];
      if (field.type === "checkbox") {
        field.checked = value !== false;
        field.setAttribute("aria-checked", field.checked ? "true" : "false");
      } else if (field.type === "number") {
        field.value = value ?? "";
      } else if (field.dataset.field === "allowedCategories") {
        field.value = Array.isArray(value) ? value.join(", ") : "";
        renderTags(field, document.getElementById("events-categories-tags"));
      } else {
        field.value = value ?? "";
      }
    });
    if (section === "calendar") renderHolidayRows(values?.holidays || []);
    if (section === "audience") {
      renderAudienceRows("departments", values?.departments || []);
      renderAudienceRows("programs", values?.programs || []);
    }
    sectionBaseline[section] = cloneSettings(readSettingsSection(section));
    updateLastSaved(values);
    updateSectionDirty(section);
  }

  function showSectionError(section, message, input = null) {
    const error = document.getElementById(`error-${section}`);
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
    input?.classList.add("is-invalid");
    input?.focus();
    showMessage(message, true);
    return false;
  }

  function clearSectionError(section) {
    const error = document.getElementById(`error-${section}`);
    if (error) {
      error.textContent = "";
      error.hidden = true;
    }
    document.querySelectorAll(`[data-settings-section="${section}"] .is-invalid`).forEach((field) => field.classList.remove("is-invalid"));
  }

  function validIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function validateSettingsSection(section, values) {
    clearSectionError(section);
    const numberInputs = [...document.querySelectorAll(`[data-section="${section}"][type="number"]`)];
    for (const input of numberInputs) {
      const value = Number(input.value);
      const min = Number(input.min);
      const max = Number(input.max);
      if (!input.value.trim() || !Number.isInteger(value) || value < min || value > max) {
        return showSectionError(section, `Enter a whole number between ${min} and ${max}.`, input);
      }
    }

    if (section === "events") {
      if (!values.allowedCategories.length) {
        return showSectionError(section, "Add at least one allowed category.", document.getElementById("events-allowed-categories"));
      }
      if (new Set(values.allowedCategories.map((item) => item.toLowerCase())).size !== values.allowedCategories.length) {
        return showSectionError(section, "Allowed categories must be unique.", document.getElementById("events-allowed-categories"));
      }
    }

    if (section === "calendar") {
      const dates = new Set();
      for (let index = 0; index < values.holidays.length; index += 1) {
        const holiday = values.holidays[index];
        const row = document.querySelectorAll("#holiday-list [data-holiday-row]")[index];
        const dateInput = row?.querySelector("[data-holiday-field='date']");
        const nameInput = row?.querySelector("[data-holiday-field='name']");
        if (!validIsoDate(holiday.date)) return showSectionError(section, "Each holiday needs a valid date.", dateInput);
        if (!holiday.name) return showSectionError(section, "Each holiday needs a name.", nameInput);
        if (dates.has(holiday.date)) return showSectionError(section, `The holiday date ${holiday.date} appears more than once.`, dateInput);
        dates.add(holiday.date);
      }
    }

    if (section === "audience") {
      const seen = new Set();
      for (const kind of ["departments", "programs"]) {
        const rows = values[kind];
        for (let index = 0; index < rows.length; index += 1) {
          const record = rows[index];
          const row = document.querySelectorAll(`#audience-${kind}-list [data-audience-row]`)[index];
          const codeInput = row?.querySelector("[data-audience-field='code']");
          const nameInput = row?.querySelector("[data-audience-field='name']");
          if (!record.code) return showSectionError(section, "Each department or program needs a code containing letters or digits.", codeInput);
          if (!record.name) return showSectionError(section, "Each department or program needs a name.", nameInput);
          if (seen.has(record.code)) return showSectionError(section, `The code "${record.code.toUpperCase()}" must be unique across departments and programs.`, codeInput);
          seen.add(record.code);
        }
      }
    }

    return true;
  }

  function sectionIsDirty(section) {
    if (!sectionBaseline[section]) return false;
    return JSON.stringify(readSettingsSection(section)) !== JSON.stringify(sectionBaseline[section]);
  }

  function updateSectionDirty(section) {
    if (!newSections.includes(section) || !newSettingsReady) return;
    const dirty = sectionIsDirty(section);
    const status = document.getElementById(`dirty-${section}`);
    if (status) status.hidden = !dirty;
    const nav = document.getElementById(`nav-dirty-${section}`);
    if (nav) nav.hidden = !dirty;
    updateStickySave();
  }

  function currentLegacyDirty() {
    const general = JSON.stringify({
      mainOrganization: normalizeOrganizationCode(mainOrgSelect?.value || workingMainOrg),
      maxUploadSizeMb: Number(maxUploadInput?.value),
    }) !== JSON.stringify({
      mainOrganization: normalizeOrganizationCode(currentSettings.mainOrganization),
      maxUploadSizeMb: currentSettings.maxUploadSizeMb,
    });
    const organizations = JSON.stringify(workingOrganizations) !== JSON.stringify(currentSettings.organizations);
    const approval = JSON.stringify(workingApprovalStages) !== JSON.stringify(currentSettings.approvalStages);
    const access = Boolean(loginToggle?.checked) !== (currentSettings.loginEnabled !== false)
      || Boolean(registrationToggle?.checked) !== (currentSettings.registrationEnabled !== false);
    const message = (document.getElementById("setting-maintenance-message")?.value || "") !== (sectionBaseline.access?.message || "");
    return { general, organizations, approval, access, message };
  }

  function refreshLegacyDirty() {
    const dirty = currentLegacyDirty();
    const labels = {
      general: "general",
      organizations: "organizations",
      approval: "approval",
      access: "access",
    };
    Object.entries(labels).forEach(([key, section]) => {
      const nav = document.getElementById(`nav-dirty-${section}`);
      if (nav) nav.hidden = !(dirty[key] || (key === "access" && dirty.message));
    });
    const generalLabel = document.getElementById("dirty-general");
    const organizationsLabel = document.getElementById("dirty-organizations");
    const accessMessageLabel = document.getElementById("dirty-access-message");
    if (generalLabel) generalLabel.hidden = !dirty.general;
    if (organizationsLabel) organizationsLabel.hidden = !dirty.organizations;
    if (accessMessageLabel) accessMessageLabel.hidden = !dirty.message;
  }

  function legacyPart2AuditMetadata() {
    const changes = [];
    const nextMainOrg = normalizeOrganizationCode(mainOrgSelect?.value || workingMainOrg);
    const previousMainOrg = normalizeOrganizationCode(currentSettings.mainOrganization);
    if (previousMainOrg !== nextMainOrg) {
      changes.push({ field: "mainOrganization", from: previousMainOrg, to: nextMainOrg });
    }

    const nextUpload = Number(maxUploadInput?.value);
    if (currentSettings.maxUploadSizeMb !== nextUpload) {
      changes.push({ field: "maxUploadSizeMb", from: currentSettings.maxUploadSizeMb, to: nextUpload });
    }

    if (JSON.stringify(currentSettings.organizations) !== JSON.stringify(workingOrganizations)) {
      changes.push({
        field: "organizations",
        from: currentSettings.organizations,
        to: cloneSettings(workingOrganizations),
      });
    }
    if (!changes.length) return null;

    const changedGeneral = changes.some((change) => change.field !== "organizations");
    const changedOrganizations = changes.some((change) => change.field === "organizations");
    const section = changedGeneral && changedOrganizations
      ? "general,organizations"
      : changedGeneral ? "general" : "organizations";
    return settingsAuditMetadata(section, "Updated General settings and organization directory", changes);
  }

  function updateStickySave() {
    const dirtySections = newSections.filter(sectionIsDirty);
    const bar = document.getElementById("settings-sticky-save");
    const message = document.getElementById("settings-sticky-message");
    if (bar) bar.hidden = dirtySections.length === 0;
    if (message) {
      const names = dirtySections.map((section) => sectionLabels[section]);
      message.textContent = names.length
        ? `You have unsaved changes in ${names.join(", ")}.`
        : "You have unsaved changes.";
    }
  }

  async function loadNewSettings() {
    const [loadedSettings, accessSettings, globalSettings] = await Promise.all([
      Promise.all(newSections.map(async (section) => [section, await getSystemSettings(section)])),
      getSystemSettings("access"),
      getSystemSettings("global_config"),
    ]);
    loadedSettings.forEach(([section, values]) => setSettingsSection(section, values));
    const messageInput = document.getElementById("setting-maintenance-message");
    const message = String(
      globalSettings.maintenanceMessage || accessSettings.message || "",
    );
    currentSettings.maintenanceMessage = message;
    if (messageInput) messageInput.value = message;
    sectionBaseline.access = { message };
    updateLastSaved(globalSettings);
    newSettingsReady = true;
    newSections.forEach(updateSectionDirty);
    refreshLegacyDirty();
  }

  function wireSettingsEnhancements() {
    document.addEventListener("click", (event) => {
      const button = event.target instanceof Element
        ? event.target.closest("#save-general-btn, #save-stages-btn, #save-stages-bottom-btn, #save-organizations-btn")
        : null;
      if (!button) return;
      pendingLegacyAuditMetadata = legacyPart2AuditMetadata();
      window.setTimeout(() => {
        if (!confirmDialog?.open) pendingLegacyAuditMetadata = null;
      }, 0);
    }, true);
    confirmDialog?.addEventListener("close", () => {
      pendingLegacyAuditMetadata = null;
    });

    document.querySelectorAll(".settings-tag-entry").forEach((input) => {
      input.addEventListener("input", () => {
        const tagListId = input.id === "events-allowed-categories" ? "events-categories-tags" : "";
        renderTags(input, tagListId ? document.getElementById(tagListId) : null);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || !input.value.trim()) return;
        event.preventDefault();
        if (!input.value.endsWith(",")) input.value = `${input.value.trim()}, `;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    document.querySelectorAll(".settings-new-section").forEach((sectionElement) => {
      sectionElement.addEventListener("input", () => updateSectionDirty(sectionElement.dataset.settingsSection));
      sectionElement.addEventListener("change", (event) => {
        if (event.target.type === "checkbox") {
          event.target.setAttribute("aria-checked", event.target.checked ? "true" : "false");
        }
        updateSectionDirty(sectionElement.dataset.settingsSection);
      });
    });

    document.getElementById("setting-maintenance-message")?.addEventListener("input", refreshLegacyDirty);
    [mainOrgSelect, maxUploadInput].forEach((input) => {
      input?.addEventListener("input", refreshLegacyDirty);
      input?.addEventListener("change", refreshLegacyDirty);
    });
    orgListEl?.addEventListener("input", refreshLegacyDirty);
    orgListEl?.addEventListener("change", refreshLegacyDirty);
    orgListEl?.addEventListener("click", () => setTimeout(refreshLegacyDirty, 0));
    stagesList?.addEventListener("input", refreshLegacyDirty);
    stagesList?.addEventListener("change", refreshLegacyDirty);
    stagesList?.addEventListener("click", () => setTimeout(refreshLegacyDirty, 0));
    addOrgBtn?.addEventListener("click", () => setTimeout(refreshLegacyDirty, 0));
    addStageBtn?.addEventListener("click", () => setTimeout(refreshLegacyDirty, 0));
    [loginToggle, registrationToggle].forEach((input) => {
      input?.addEventListener("change", refreshLegacyDirty);
    });

    document.getElementById("add-holiday-btn")?.addEventListener("click", () => {
      renderHolidayRows([...readHolidayRows(), { date: "", name: "", type: "public" }]);
      updateSectionDirty("calendar");
    });

    document.querySelectorAll("[data-add-audience]").forEach((button) => {
      button.addEventListener("click", () => {
        const kind = button.dataset.addAudience;
        const values = readSettingsSection("audience");
        values[kind].push({ code: "", name: "", active: true });
        renderAudienceRows(kind, values[kind]);
        updateSectionDirty("audience");
      });
    });

    document.querySelectorAll("[data-save-section]").forEach((button) => {
      button.addEventListener("click", () => void saveSettingsSection(button.dataset.saveSection, button));
    });
    document.getElementById("save-new-settings-btn")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      for (const section of newSections.filter(sectionIsDirty)) {
        if (!(await saveSettingsSection(section, button, true))) break;
      }
    });
    document.getElementById("discard-new-settings-btn")?.addEventListener("click", () => {
      newSections.filter(sectionIsDirty).forEach((section) => setSettingsSection(section, sectionBaseline[section]));
      newSections.forEach(updateSectionDirty);
      showMessage("Unsaved new settings were discarded.");
    });
    document.getElementById("save-access-message-btn")?.addEventListener("click", saveAccessMessage);
    document.getElementById("export-settings-btn")?.addEventListener("click", exportSettings);
    document.getElementById("preview-holiday-csv-btn")?.addEventListener("click", previewHolidayCsv);
    document.getElementById("holiday-csv-input")?.addEventListener("input", () => {
      document.getElementById("holiday-csv-preview")?.replaceChildren();
    });

    const exportButton = document.getElementById("export-settings-btn");
    if (exportButton) exportButton.disabled = !db;
    refreshLegacyDirty();
  }

  async function saveSettingsSection(section, button, fromStickyBar = false) {
    if (!newSections.includes(section)) return false;
    const values = readSettingsSection(section);
    const previousValues = cloneSettings(sectionBaseline[section] || {});
    if (!validateSettingsSection(section, values)) return false;
    const originalLabel = button?.textContent || "Save Changes";
    if (button) {
      button.disabled = true;
      button.textContent = "Saving...";
      if (fromStickyBar) {
        document.querySelectorAll("[data-save-section]").forEach((item) => { item.disabled = true; });
      }
    }

    try {
      if (!db) throw new Error("Firestore is not configured.");
      const name = actorDisplayName();
      await setDoc(doc(db, "system_settings", section), {
        ...values,
        updatedAt: serverTimestamp(),
        updatedBy: actorIdentifier(),
        updatedByName: name,
      }, { merge: true });
      sectionBaseline[section] = cloneSettings(values);
      invalidateSystemSettingsCache(section);
      updateLastSaved({ updatedAt: new Date(), updatedByName: name });
      clearSectionError(section);
      try {
        const changedFields = Object.keys(values)
          .filter((field) => JSON.stringify(previousValues[field]) !== JSON.stringify(values[field]))
          .slice(0, 20)
          .map((field) => ({ field, from: previousValues[field] ?? null, to: values[field] }));
        await appendAudit(
          `${actorTag()} updated ${sectionLabels[section]} settings`,
          settingsAuditMetadata(section, `Saved ${sectionLabels[section]} settings`, changedFields),
        );
      } catch (auditError) {
        console.warn("Settings were saved, but the audit log could not be written:", auditError);
      }
      updateSectionDirty(section);
      showMessage(`${sectionLabels[section]} settings saved.`);
      return true;
    } catch (error) {
      const code = String(error?.code || "").toLowerCase();
      const isPermissionError = code.includes("permission-denied");
      const isNetworkError = code.includes("unavailable") || code.includes("network") || !navigator.onLine;
      const message = isPermissionError
        ? `Permission denied while saving ${sectionLabels[section]}. Check the superadmin Firestore rules.`
        : isNetworkError
          ? `Network error while saving ${sectionLabels[section]}. Your changes are still on the form; try again when connected.`
          : `Could not save ${sectionLabels[section]}: ${error?.message || "Unknown Firestore error."}`;
      showSectionError(section, message);
      return false;
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
      if (fromStickyBar) {
        document.querySelectorAll("[data-save-section]").forEach((item) => { item.disabled = false; });
      }
    }
  }

  async function saveAccessMessage() {
    const input = document.getElementById("setting-maintenance-message");
    const error = document.getElementById("access-message-error");
    const button = document.getElementById("save-access-message-btn");
    const message = input?.value.trim() || "";
    if (error) error.hidden = true;
    if (message.length > 500) {
      if (error) {
        error.textContent = "Maintenance message must be 500 characters or fewer.";
        error.hidden = false;
      }
      return;
    }
    if (!db) return showMessage("Firestore is not configured.", true);
    const originalLabel = button?.textContent || "Save message";
    const previousMessage = sectionBaseline.access?.message || "";
    if (button) {
      button.disabled = true;
      button.textContent = "Saving...";
    }
    try {
      currentSettings.maintenanceMessage = message;
      const accessFields = getAccessSettingsFields(currentSettings);
      const batch = writeBatch(db);
      batch.set(settingsRef, {
        ...accessFields,
        updatedBy: actorIdentifier(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      batch.set(publicAccessSettingsRef, {
        ...accessFields,
        updatedBy: actorIdentifier(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      batch.set(legacyAccessSettingsRef, {
        message,
        updatedBy: actorIdentifier(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      await batch.commit();
      cacheSettings(currentSettings);
      sectionBaseline.access = { message };
      invalidateSystemSettingsCache("global_config");
      invalidateSystemSettingsCache("access");
      updateLastSaved({ updatedAt: new Date(), updatedByName: actorDisplayName() });
      try {
        await appendAudit(
          `${actorTag()} updated the maintenance message`,
          settingsAuditMetadata("access", "Updated maintenance message", [
            { field: "message", from: previousMessage, to: message },
          ]),
        );
      } catch (auditError) {
        console.warn("Maintenance message saved, but the audit log could not be written:", auditError);
      }
      refreshLegacyDirty();
      showMessage("Maintenance message saved.");
    } catch (saveError) {
      const code = String(saveError?.code || "").toLowerCase();
      const messageText = code.includes("permission-denied")
        ? "Permission denied while saving the maintenance message."
        : code.includes("unavailable") || code.includes("network") || !navigator.onLine
          ? "Network error while saving the maintenance message. Your text remains on the form."
          : `Could not save the maintenance message: ${saveError?.message || "Unknown Firestore error."}`;
      if (error) {
        error.textContent = messageText;
        error.hidden = false;
      }
      showMessage(messageText, true);
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  }

  async function exportSettings() {
    if (!db) return showMessage("Firestore is not configured; settings were not exported.", true);
    const paths = ["global_config", "access", ...newSections];
    const button = document.getElementById("export-settings-btn");
    if (button) button.disabled = true;
    try {
      const entries = await Promise.all(paths.map(async (section) => {
        const snapshot = await getDoc(doc(db, "system_settings", section));
        return [section, snapshot.exists() ? snapshot.data() : null];
      }));
      const exportData = Object.fromEntries(entries);
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `recovibe-system-settings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showMessage("Settings exported.");
    } catch (error) {
      showMessage(`Could not export settings: ${error?.message || "Firestore read failed."}`, true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function parseCsvRow(line) {
    const cells = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && line[index + 1] === '"' && quoted) {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === "," && !quoted) {
        cells.push(value.trim());
        value = "";
      } else {
        value += char;
      }
    }
    if (quoted) return null;
    cells.push(value.trim());
    return cells;
  }

  function previewHolidayCsv() {
    const text = document.getElementById("holiday-csv-input")?.value || "";
    const preview = document.getElementById("holiday-csv-preview");
    if (!preview) return;
    preview.replaceChildren();
    const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const parsed = [];
    const errors = [];
    rows.forEach((line, index) => {
      const cells = parseCsvRow(line);
      if (!cells || cells.length !== 3) {
        errors.push(`Row ${index + 1}: expected date,name,type.`);
        return;
      }
      if (index === 0 && cells[0].toLowerCase() === "date" && cells[1].toLowerCase() === "name") return;
      const [date, name, rawType] = cells;
      const type = rawType.toLowerCase();
      if (!validIsoDate(date) || !name || !["public", "academic", "other"].includes(type)) {
        errors.push(`Row ${index + 1}: use a valid YYYY-MM-DD date, a name, and public, academic, or other.`);
        return;
      }
      parsed.push({ date, name, type });
    });

    const existingDates = new Set(readHolidayRows().map((item) => item.date));
    const newDates = new Set();
    parsed.forEach((holiday) => {
      if (existingDates.has(holiday.date) || newDates.has(holiday.date)) {
        errors.push(`Date ${holiday.date} is duplicated in the current list or CSV.`);
      }
      newDates.add(holiday.date);
    });

    const result = document.createElement("p");
    result.textContent = errors.length
      ? `Preview found ${errors.length} issue(s): ${errors.join(" ")}`
      : `${parsed.length} valid holiday row(s) ready to add.`;
    preview.appendChild(result);
    if (!errors.length && parsed.length) {
      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "settings-outline-btn";
      addButton.textContent = "Add valid rows";
      addButton.addEventListener("click", () => {
        renderHolidayRows([...readHolidayRows(), ...parsed]);
        updateSectionDirty("calendar");
        result.textContent = `${parsed.length} holiday row(s) added to the form. Save Calendar and holidays to persist them.`;
        addButton.remove();
      });
      preview.appendChild(addButton);
    }
  }

  async function verifySuperAdminAccess() {
    if (!isFirebaseConfigured || !auth || !db) {
      window.location.replace("SuperAdminLogin.html");
      return false;
    }
    const user = await new Promise((resolve) => {
      let unsubscribe = null;
      unsubscribe = onAuthStateChanged(auth, (authenticatedUser) => {
        unsubscribe?.();
        resolve(authenticatedUser);
      });
    });
    if (!user) {
      window.location.replace("SuperAdminLogin.html");
      return false;
    }
    try {
      const profileSnapshot = await getDoc(doc(db, "adminUser", user.uid));
      const profile = profileSnapshot.exists() ? profileSnapshot.data() : null;
      const role = String(profile?.role || profile?.userRole || "").trim().toLowerCase().replace(/[\s_-]/g, "");
      const status = String(profile?.status || "active").trim().toLowerCase().replace(/[\s_-]/g, "");
      if (!profile || role !== "superadmin" || ["disabled", "inactive", "suspended"].includes(status)) {
        window.location.replace("SuperAdminLogin.html");
        return false;
      }
      activeAccessUser.current = { uid: user.uid, displayName: user.displayName, profile };
      const fullName = actorDisplayName();
      document.querySelectorAll("#sidebar-user-name").forEach((element) => { element.textContent = fullName; });
      document.querySelectorAll("#sidebar-user-avatar").forEach((element) => { element.textContent = fullName.charAt(0).toUpperCase(); });
      document.querySelectorAll("#sidebar-user-role").forEach((element) => { element.textContent = "Super Admin account"; });
      return true;
    } catch (error) {
      if (DEBUG) console.warn("Could not verify System Settings access:", error);
      window.location.replace("SuperAdminLogin.html");
      return false;
    }
  }

  document.querySelectorAll(".logout-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (link.dataset.rvLogoutConfirmed !== "true") return;
      event.preventDefault();
      void logoutSuperAdmin(
        auth,
        link,
        link.getAttribute("href") || "SuperAdminLogin.html",
      );
    });
  });

  async function persistSystemToggles(changes = []) {
    if (!cacheSettings(currentSettings, Boolean(settingsRef))) {
      showMessage("Could not save access settings to the local cache.", true);
      return false;
    }

    if (!settingsRef) {
      localStorage.removeItem(pendingSettingsKey);
      showMessage("Access and registration settings updated locally.");
      return true;
    }

    try {
      const accessFields = getAccessSettingsFields(currentSettings);
      const batch = writeBatch(db);
      batch.set(settingsRef, {
        ...accessFields,
        updatedAt: serverTimestamp(),
        updatedBy: actorIdentifier(),
      }, { merge: true });
      batch.set(publicAccessSettingsRef, {
        ...accessFields,
        updatedAt: serverTimestamp(),
        updatedBy: actorIdentifier(),
      }, { merge: true });
      await batch.commit();
      updateLastSaved({ updatedAt: new Date(), updatedBy: actorIdentifier() });

      try {
        await appendAudit(
          `${actorTag()} updated Access and Registration settings (Login: ${
            currentSettings.loginEnabled ? "ON" : "OFF"
          }, Registration: ${currentSettings.registrationEnabled ? "ON" : "OFF"})`,
          settingsAuditMetadata("access", "Updated access and registration toggles", changes)
        );
      } catch (auditErr) {
        console.warn("Audit log notice:", auditErr);
      }

      localStorage.removeItem(pendingSettingsKey);
      refreshLegacyDirty();
      showMessage("Access and registration settings saved.");
      return true;
    } catch (err) {
      console.error("[SystemSettings] Access settings save failed:", {
        code: err?.code || "unknown",
        message: err?.message || String(err),
      });
      showMessage("Saved locally. Cloud sync is pending and will retry when the connection is available.", true);
      return true;
    }
  }

  function getAccessSettingsFields(settings) {
    const loginEnabled = settings.loginEnabled !== false;
    const registrationEnabled = settings.registrationEnabled !== false;
    const maintenanceMessage = typeof settings.maintenanceMessage === "string"
      ? settings.maintenanceMessage
      : "";
    return {
      userLoginEnabled: loginEnabled,
      eventRegistrationEnabled: registrationEnabled,
      maintenanceMessage,
      loginEnabled,
      registrationEnabled,
    };
  }

  async function syncAccessSettingsMirror(data) {
    if (accessMirrorSynced || !publicAccessSettingsRef || !settingsRef) return;
    accessMirrorSynced = true;
    try {
      const [mirrorSnapshot, legacyAccess] = await Promise.all([
        getDoc(publicAccessSettingsRef),
        getSystemSettings("access"),
      ]);
      const mirror = mirrorSnapshot.exists() ? mirrorSnapshot.data() : {};
      const settings = normalizedSettings(data);
      const maintenanceMessage = Object.prototype.hasOwnProperty.call(
        data,
        "maintenanceMessage",
      )
        ? settings.maintenanceMessage
        : String(legacyAccess.message || mirror.maintenanceMessage || mirror.message || "");
      settings.maintenanceMessage = maintenanceMessage;
      currentSettings.maintenanceMessage = maintenanceMessage;
      const accessFields = getAccessSettingsFields(settings);
      const isCurrent = mirrorSnapshot.exists() &&
        Object.keys(accessFields).every((field) => mirror[field] === accessFields[field]);
      if (!isCurrent) {
        await setDoc(publicAccessSettingsRef, {
          ...accessFields,
          updatedAt: serverTimestamp(),
          updatedBy: actorIdentifier(),
        }, { merge: true });
      }
      cacheSettings(currentSettings);
    } catch (error) {
      console.error("[SystemSettings] Could not sync public access settings:", {
        code: error?.code || "unknown",
        message: error?.message || String(error),
      });
      showMessage("The student access settings could not be synchronized.", true);
    }
  }

  if (loginToggle) {
    loginToggle.addEventListener("change", () => {
      if (!settingsReady) {
        loginToggle.checked = currentSettings.loginEnabled ?? true;
        updateToggleBadge("login", loginToggle.checked);
        showMessage("System settings are still loading. Please wait...", true);
        return;
      }

      const nextVal = loginToggle.checked;
      loginToggle.setAttribute("aria-checked", nextVal ? "true" : "false");

      if (!nextVal) {
        // Turning OFF: confirmation required!
        const previousValue = currentSettings.loginEnabled !== false;
        openConfirmationDialog({
          title: "Turn off User Login?",
          text: "When off, only super admins can sign in. Everyone else sees a maintenance message. Are you sure you want to turn off user login?",
          yesText: "Yes, Turn Off",
          cancelText: "No, Keep On",
          requireLock: true,
          onConfirm: async () => {
            currentSettings.loginEnabled = false;
            currentSettings.userLoginEnabled = false;
            loginToggle.checked = false;
            updateToggleBadge("login", false);
            return await persistSystemToggles([{ field: "userLoginEnabled", from: previousValue, to: false }]);
          },
          onCancel: () => {
            loginToggle.checked = true;
            updateToggleBadge("login", true);
          },
        });
      } else {
        // Turning ON: confirm enabling
        const previousValue = currentSettings.loginEnabled !== false;
        openConfirmationDialog({
          title: "Turn on User Login?",
          text: "Are you sure you want to turn on user login? Students, teachers, and organizers will be able to sign in normally.",
          yesText: "Yes, Turn On",
          cancelText: "No, Keep Off",
          onConfirm: async () => {
            currentSettings.loginEnabled = true;
            currentSettings.userLoginEnabled = true;
            loginToggle.checked = true;
            updateToggleBadge("login", true);
            return await persistSystemToggles([{ field: "userLoginEnabled", from: previousValue, to: true }]);
          },
          onCancel: () => {
            loginToggle.checked = false;
            updateToggleBadge("login", false);
          },
        });
      }
    });
  }

  if (registrationToggle) {
    registrationToggle.addEventListener("change", () => {
      if (!settingsReady) {
        registrationToggle.checked = currentSettings.registrationEnabled ?? true;
        updateToggleBadge("registration", registrationToggle.checked);
        showMessage("System settings are still loading. Please wait...", true);
        return;
      }

      const nextVal = registrationToggle.checked;
      registrationToggle.setAttribute("aria-checked", nextVal ? "true" : "false");

      if (!nextVal) {
        // Turning OFF: confirmation required!
        const previousValue = currentSettings.registrationEnabled !== false;
        openConfirmationDialog({
          title: "Turn off Event Registration?",
          text: "When off, students cannot register for any event, including ones that are open now. Are you sure you want to turn off event registration?",
          yesText: "Yes, Turn Off",
          cancelText: "No, Keep On",
          onConfirm: async () => {
            currentSettings.registrationEnabled = false;
            currentSettings.eventRegistrationEnabled = false;
            registrationToggle.checked = false;
            updateToggleBadge("registration", false);
            return await persistSystemToggles([{ field: "eventRegistrationEnabled", from: previousValue, to: false }]);
          },
          onCancel: () => {
            registrationToggle.checked = true;
            updateToggleBadge("registration", true);
          },
        });
      } else {
        // Turning ON: confirm enabling
        const previousValue = currentSettings.registrationEnabled !== false;
        openConfirmationDialog({
          title: "Turn on Event Registration?",
          text: "Are you sure you want to turn on event registration? Students will be able to register for events.",
          yesText: "Yes, Turn On",
          cancelText: "No, Keep Off",
          onConfirm: async () => {
            currentSettings.registrationEnabled = true;
            currentSettings.eventRegistrationEnabled = true;
            registrationToggle.checked = true;
            updateToggleBadge("registration", true);
            return await persistSystemToggles([{ field: "eventRegistrationEnabled", from: previousValue, to: true }]);
          },
          onCancel: () => {
            registrationToggle.checked = false;
            updateToggleBadge("registration", false);
          },
        });
      }
    });
  }

  if (registrationToggle) {
    registrationToggle.checked = currentSettings.registrationEnabled !== false;
    updateToggleBadge("registration", currentSettings.registrationEnabled !== false);
  }
  if (loginToggle) {
    loginToggle.checked = currentSettings.loginEnabled !== false;
    updateToggleBadge("login", currentSettings.loginEnabled !== false);
  }

  if (!(await verifySuperAdminAccess())) return;
  wireSettingsEnhancements();

  function clearOrganizationApprovalLoadTimeout() {
    if (organizationApprovalLoadTimeout) {
      clearTimeout(organizationApprovalLoadTimeout);
      organizationApprovalLoadTimeout = null;
    }
  }

  function showOrganizationApprovalLoadError(step, error) {
    clearOrganizationApprovalLoadTimeout();
    unsubscribeSettings?.();
    unsubscribeSettings = null;
    const code = error?.code || "unknown";
    const message = error?.message || "Unknown error";
    console.error(`[ApprovalStages] ${step} failed:`, code, message);
    setReady(true);
    setOrganizationApprovalLoading(false);
    if (orgApprovalEditor) orgApprovalEditor.hidden = true;
    if (orgApprovalErrorText) {
      orgApprovalErrorText.textContent = "Could not load organization approval stages. Use Retry to try again.";
    }
    if (orgApprovalError) orgApprovalError.hidden = false;
  }

  function startSettingsListener() {
    clearOrganizationApprovalLoadTimeout();
    unsubscribeSettings?.();
    if (!settingsRef) {
      showOrganizationApprovalLoadError(
        "settings reference",
        Object.assign(new Error("Firestore is not configured."), { code: "unavailable" }),
      );
      return;
    }

    setReady(false);
    if (orgApprovalError) orgApprovalError.hidden = true;
    setOrganizationApprovalLoading(true);
    organizationApprovalLoadTimeout = setTimeout(() => {
      showOrganizationApprovalLoadError(
        "settings snapshot timeout",
        Object.assign(new Error("No settings snapshot arrived within 5 seconds."), { code: "timeout" }),
      );
    }, 5000);
    try {
      unsubscribeSettings = onSnapshot(
        settingsRef,
        async (snapshot) => {
          clearOrganizationApprovalLoadTimeout();
          try {
            if (!snapshot.exists()) {
              const initialSettings = normalizedSettings(currentSettings);
              currentSettings = initialSettings;
              workingOrganizations = JSON.parse(JSON.stringify(initialSettings.organizations));
              workingApprovalStages = JSON.parse(JSON.stringify(initialSettings.approvalStages));
              renderOrganizations();
              renderApprovalStages();
              cacheSettings(initialSettings, true);
              setOrganizationApprovalLoading(false);
              if (orgApprovalError) orgApprovalError.hidden = true;
              if (orgApprovalEditor) orgApprovalEditor.hidden = false;
              setReady(true);
              renderOrganizationApprovalStages();
              if (!initializingDocument) {
                initializingDocument = true;
                void syncPendingSettings().finally(() => {
                  initializingDocument = false;
                });
              }
              return;
            }

            const data = snapshot.data();
            currentSettings = normalizedSettings(data);
            updateLastSaved(data);

            organizationStageDrafts.forEach((draft, code) => {
              if (!draft.dirty) organizationStageDrafts.delete(code);
            });

            const activeEl = document.activeElement;
            const isEditingOrg = activeEl && activeEl.closest("#organization-directory-list");
            const isEditingStage = activeEl && activeEl.closest("#approval-stages-list");
            const isEditingGeneral = activeEl && (activeEl === maxUploadInput || activeEl === mainOrgSelect);

            if (!isEditingGeneral) {
              workingMainOrg = currentSettings.mainOrganization;
              if (maxUploadInput) maxUploadInput.value = currentSettings.maxUploadSizeMb;
            }

            if (!isEditingOrg) {
              workingOrganizations = JSON.parse(JSON.stringify(currentSettings.organizations || defaultOrganizations));
              renderOrganizations();
            }

            if (!isEditingStage) {
              workingApprovalStages = JSON.parse(JSON.stringify(currentSettings.approvalStages || defaultApprovalStages));
              renderApprovalStages();
            }

            if (registrationToggle) {
              registrationToggle.checked = currentSettings.registrationEnabled !== false;
              updateToggleBadge("registration", currentSettings.registrationEnabled !== false);
            }
            if (loginToggle) {
              loginToggle.checked = currentSettings.loginEnabled !== false;
              updateToggleBadge("login", currentSettings.loginEnabled !== false);
            }
            cacheSettings(currentSettings);
            await syncAccessSettingsMirror(data);
            refreshLegacyDirty();
            if (orgApprovalError) orgApprovalError.hidden = true;
            setOrganizationApprovalLoading(false);
            if (orgApprovalEditor) orgApprovalEditor.hidden = false;
            setReady(true);
            renderOrganizationApprovalStages();
            if (localStorage.getItem(pendingSettingsKey)) {
              void syncPendingSettings();
            }

            const hasMissingFields = Object.keys(defaultSettings).some(
              (field) => !(field in data),
            );
            if (hasMissingFields) {
              void backfillMissingFields(data).catch((error) => {
                console.error("[ApprovalStages] settings backfill failed:", error?.code, error?.message);
              });
            }
          } catch (error) {
            showOrganizationApprovalLoadError("settings snapshot processing", error);
          }
        },
        (error) => {
          showOrganizationApprovalLoadError("settings snapshot", error);
        },
      );
    } catch (error) {
      showOrganizationApprovalLoadError("settings listener", error);
    }
  }

  document.getElementById("org-approval-retry-btn")?.addEventListener("click", startSettingsListener);
  startSettingsListener();
  void loadNewSettings().catch((error) => {
    console.error("Could not load additional system settings:", error?.code, error?.message);
    showMessage("Some additional system settings could not be loaded.", true);
  });

  window.addEventListener("pagehide", () => {
    clearOrganizationApprovalLoadTimeout();
    unsubscribeSettings?.();
    unsubscribeSettings = null;
  }, { once: true });
})();
