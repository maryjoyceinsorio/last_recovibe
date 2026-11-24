import { loadCalendarData } from "../calendarDataService.js";
import { auth, db } from "../UserStudent/firebaseConfig.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { parseAcademicCalendar } from "../academicCalendarParser.js";
import {
  deleteCalendarEntry,
  getSemesterEntries,
  saveCalendarEntries,
  updateCalendarEntry,
} from "../academicCalendarStore.js";
import { isOsasProfile } from "../correctionAccess.js";

(() => {
  "use strict";
  import("./AdminNotificationData.js")
    .then(({ startAdminNotificationBadge }) => startAdminNotificationBadge())
    .catch(() => document.querySelectorAll("[data-notification-count]").forEach((badge) => { badge.hidden = true; }));
  let profile = {};
  const root = document.getElementById("calendarRoot"),
    statusElement = document.getElementById("calendarStatus"),
    calendarLayout = document.getElementById("calendarLayout"),
    host = document.getElementById("calendarModalHost"),
    monthSelect = document.getElementById("adminMonthSelect"),
    yearSelect = document.getElementById("adminYearSelect"),
    calendarGrid = document.getElementById("adminMonthGrid"),
    upcomingItems = document.getElementById("adminUpcomingItems"),
    categoryFilters = [
      ...document.querySelectorAll("[data-calendar-category]"),
    ],
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
    }).format(new Date());
  let viewed = new Date(),
    activePopup = null,
    firestoreEvents = [],
    holidays = [],
    monthDataSequence = 0,
    loadedMonthDataKey = "",
    authUnsubscribe = null,
    authTimeout = null,
    startupAttempt = 0,
    pageLoadSignaled = false;
  const signalCalendarPageReady = () => {
    if (pageLoadSignaled) return;
    pageLoadSignaled = true;
    window.dispatchEvent(new Event("page-data-ready"));
  };
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const academicCategoryOptions = [
    ["holiday", "Holiday"],
    ["exam", "Exam"],
    ["enrollment", "Enrollment"],
    ["deadline", "Deadline"],
    ["break", "Break"],
    ["graduation", "Graduation"],
    ["classes", "Classes"],
    ["other", "Other"],
  ];
  let academicManagerReady = false;
  let academicPreviewEntries = [];
  const selectedCategories = new Set(
    categoryFilters.map((filter) => filter.dataset.calendarCategory),
  );
  monthSelect.innerHTML = monthNames
    .map((month, index) => `<option value="${index}">${month}</option>`)
    .join("");
  document.querySelector(".admin-logout").onclick = async (event) => {
    event.preventDefault();
    try {
      await signOut(auth);
    } finally {
      localStorage.removeItem("recovibeAdminId");
      localStorage.removeItem("recovibeAdminProfile");
      location.replace("AdminLogin.html");
    }
  };
  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch {
      return fallback;
    }
  }
    function setAcademicManagerStatus(message, isError = false) {
      const status = document.getElementById("academicCalendarStatus");
      if (!status) return;
      status.textContent = message;
      status.classList.toggle("is-error", isError);
    }
    function academicSemesterDetails() {
      const startYear = Number(
        document.getElementById("academicYearSelect").value,
      );
      const semester = document.getElementById("academicSemesterSelect").value;
      const endYear = startYear + 1;
      const semesterLabel =
        `${semester === "summer" ? "Summer" : `${semester} Semester`} AY ${startYear}-${endYear}`;
      return {
        semesterId: `${startYear}-${endYear}-${semester}`,
        semesterLabel,
      };
    }
    function createAcademicCategorySelect(value) {
      const select = document.createElement("select");
      academicCategoryOptions.forEach(([category, label]) => {
        const option = document.createElement("option");
        option.value = category;
        option.textContent = label;
        select.appendChild(option);
      });
      select.value = academicCategoryOptions.some(([category]) => category === value)
        ? value
        : "other";
      return select;
    }
    function renderAcademicPreview(entries) {
      const body = document.getElementById("academicCalendarPreview");
      if (!body) return;
      body.replaceChildren();
      entries.forEach((entry, index) => {
        const row = document.createElement("tr");
        if (entry.warnings?.length) row.classList.add("has-warning");
        const includeCell = document.createElement("td");
        const include = document.createElement("input");
        include.type = "checkbox";
        include.checked = entry.include !== false;
        include.dataset.entryIndex = String(index);
        includeCell.appendChild(include);
        const titleCell = document.createElement("td");
        const title = document.createElement("input");
        title.type = "text";
        title.value = String(entry.title || "");
        title.dataset.entryIndex = String(index);
        titleCell.appendChild(title);
        const startCell = document.createElement("td");
        const startDate = document.createElement("input");
        startDate.type = "date";
        startDate.value = entry.startDate || "";
        startDate.dataset.entryIndex = String(index);
        startCell.appendChild(startDate);
        const endCell = document.createElement("td");
        const endDate = document.createElement("input");
        endDate.type = "date";
        endDate.value = entry.endDate || "";
        endDate.dataset.entryIndex = String(index);
        endCell.appendChild(endDate);
        const categoryCell = document.createElement("td");
        const category = createAcademicCategorySelect(entry.category);
        category.dataset.entryIndex = String(index);
        categoryCell.appendChild(category);
        const warningCell = document.createElement("td");
        warningCell.textContent = (entry.warnings || []).join("; ");
        row.append(
          includeCell,
          titleCell,
          startCell,
          endCell,
          categoryCell,
          warningCell,
        );
        body.appendChild(row);
      });
    }
    async function loadSavedAcademicEntries() {
      const savedList = document.getElementById("academicCalendarSaved");
      if (!savedList) return;
      savedList.replaceChildren();
      const { semesterId } = academicSemesterDetails();
      setAcademicManagerStatus("Loading saved entries…");
      try {
        const entries = await getSemesterEntries(db, semesterId);
        if (!entries.length) {
          const empty = document.createElement("p");
          empty.textContent = "No saved entries for this semester.";
          savedList.appendChild(empty);
        }
        entries.forEach((entry) => {
          const row = document.createElement("div");
          row.className = "admin-academic-saved-row";
          const title = document.createElement("input");
          title.type = "text";
          title.value = String(entry.title || "");
          title.setAttribute("aria-label", "Entry title");
          const startDate = document.createElement("input");
          startDate.type = "date";
          startDate.value = entry.startDate || "";
          startDate.setAttribute("aria-label", "Start date");
          const endDate = document.createElement("input");
          endDate.type = "date";
          endDate.value = entry.endDate || "";
          endDate.setAttribute("aria-label", "End date");
          const category = createAcademicCategorySelect(entry.category);
          category.setAttribute("aria-label", "Category");
          const update = document.createElement("button");
          update.type = "button";
          update.textContent = "Update";
          update.addEventListener("click", async () => {
            await withAcademicManagerSaving(async () => {
              await updateCalendarEntry(db, auth, entry.id, {
                title: title.value,
                startDate: startDate.value,
                endDate: endDate.value,
                category: category.value,
              });
              await loadSavedAcademicEntries();
              setAcademicManagerStatus("Entry updated.");
            });
          });
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Delete";
          remove.addEventListener("click", async () => {
            if (!window.confirm(`Delete "${entry.title}" from this semester?`)) return;
            await withAcademicManagerSaving(async () => {
              await deleteCalendarEntry(db, auth, entry.id);
              await loadSavedAcademicEntries();
              setAcademicManagerStatus("Entry deleted.");
            });
          });
          row.append(title, startDate, endDate, category, update, remove);
          savedList.appendChild(row);
        });
      } catch (error) {
        setAcademicManagerStatus(error.message || String(error), true);
      }
    }
    async function withAcademicManagerSaving(action) {
      const panel = document.getElementById("academicCalendarManager");
      const controls = [...panel.querySelectorAll("button, input, select, textarea")];
      const previousStates = controls.map((control) => control.disabled);
      controls.forEach((control) => { control.disabled = true; });
      try {
        await action();
      } catch (error) {
        setAcademicManagerStatus(error.message || String(error), true);
      } finally {
        controls.forEach((control, index) => {
          control.disabled = previousStates[index];
        });
      }
    }
    function setupAcademicManager() {
      if (academicManagerReady) return;
      academicManagerReady = true;
      const panel = document.getElementById("academicCalendarManager");
      const button = document.getElementById("manageAcademicCalendar");
      const close = document.getElementById("academicManagerClose");
      const yearSelect = document.getElementById("academicYearSelect");
      const semesterSelect = document.getElementById("academicSemesterSelect");
      const currentYear = new Date().getFullYear();
      for (let year = currentYear - 5; year <= currentYear + 5; year += 1) {
        const option = document.createElement("option");
        option.value = String(year);
        option.textContent = String(year);
        yearSelect.appendChild(option);
      }
      yearSelect.value = String(currentYear);
      const closePanel = () => { panel.hidden = true; };
      button.addEventListener("click", () => {
        panel.hidden = false;
        loadSavedAcademicEntries();
      });
      close.addEventListener("click", closePanel);
      panel.addEventListener("click", (event) => {
        if (event.target === panel) closePanel();
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !panel.hidden) closePanel();
      });
      yearSelect.addEventListener("change", loadSavedAcademicEntries);
      semesterSelect.addEventListener("change", loadSavedAcademicEntries);
      document.getElementById("academicCalendarParse").addEventListener("click", () => {
        try {
          const academicYear = Number(yearSelect.value);
          academicPreviewEntries = parseAcademicCalendar(
            document.getElementById("academicCalendarText").value,
            { academicYear, yearStartMonth: 6 },
          );
          renderAcademicPreview(academicPreviewEntries);
          setAcademicManagerStatus(`${academicPreviewEntries.length} entries parsed.`);
        } catch (error) {
          setAcademicManagerStatus(error.message || String(error), true);
        }
      });
      document.getElementById("academicCalendarSave").addEventListener("click", () => {
        const body = document.getElementById("academicCalendarPreview");
        const entries = [...body.querySelectorAll("tr")].map((row, index) => {
          const fields = row.querySelectorAll("input, select");
          return {
            ...academicPreviewEntries[index],
            include: fields[0].checked,
            title: fields[1].value,
            startDate: fields[2].value,
            endDate: fields[3].value,
            category: fields[4].value,
          };
        });
        void withAcademicManagerSaving(async () => {
          const result = await saveCalendarEntries(db, auth, {
            ...academicSemesterDetails(),
            entries,
          });
          await loadSavedAcademicEntries();
          setAcademicManagerStatus(`${result} entries saved.`);
        });
      });
      document.getElementById("academicCalendarImage").addEventListener("change", async (event) => {
        const image = event.target.files?.[0];
        if (!image) return;
        await withAcademicManagerSaving(async () => {
          setAcademicManagerStatus("Recognizing image text…");
          const tesseractModule = await import(
            "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.esm.min.js"
          );
          const recognize = tesseractModule.recognize ||
            tesseractModule.default?.recognize;
          if (typeof recognize !== "function") {
            throw new Error("Image text recognition could not be initialized.");
          }
          const result = await recognize(image, "eng");
          document.getElementById("academicCalendarText").value =
            String(result.data?.text || "");
          setAcademicManagerStatus("Recognized text is ready to review and correct before parsing.");
        });
      });
    }
  async function verifyAdmin(user) {
    const [adminResult, userResult] = await Promise.allSettled([
      getDoc(doc(db, "adminUser", user.uid)),
      getDoc(doc(db, "users", user.uid)),
    ]);
    const adminProfile = adminResult.status === "fulfilled" && adminResult.value.exists()
      ? adminResult.value.data()
      : {};
    const userProfile = userResult.status === "fulfilled" && userResult.value.exists()
      ? userResult.value.data()
      : {};
    if (adminResult.status === "rejected" && userResult.status === "rejected") {
      throw adminResult.reason;
    }
    profile = { ...userProfile, ...adminProfile };
    const role = String(profile.role || profile.userRole || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (role !== "admin" || !getApprovalPosition(profile, true)) {
      location.replace("AdminLogin.html");
      return false;
    }
    const name = profile.name || [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(" ") || user.displayName || user.email?.split("@")[0] || "";
    document.querySelector("[data-name]").textContent = name.toUpperCase();
    document.querySelector("[data-avatar]").textContent = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
    const roleElement = document.querySelector("[data-role]");
    roleElement.textContent = getApprovalPosition(profile);
    roleElement.title = roleElement.textContent;
    const manageButton = document.getElementById("manageAcademicCalendar");
    const canManageAcademicCalendar = isOsasProfile(profile);
    if (manageButton) manageButton.hidden = !canManageAcademicCalendar;
    if (canManageAcademicCalendar) setupAcademicManager();
    return true;
  }
  function getApprovalPosition(adminProfile, requireRecognizedStage = false) {
    const labels = {
      org_adv: "Organization Adviser",
      sir_abelida: "Laboratory Head, Property Custodian, Administrative Officer",
      hap: "Head of Academic Programs, QAC Coordinator (HAP)",
      osas: "OSAS",
    };
    const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    const accountValues = [
      adminProfile.accountNumber,
      adminProfile.accountNo,
      adminProfile.account_number,
      adminProfile.account_no,
    ].map(normalize);
    const declared = [
      adminProfile.approvalStage, adminProfile.approvalStageKey,
      adminProfile.assignedApprovalStage, adminProfile.approverStage,
      adminProfile.approverKey, adminProfile.approvalRole,
      adminProfile.approverRole, adminProfile.assignedRole,
      adminProfile.assignedApprover, adminProfile.adminRole,
      adminProfile.roleName, adminProfile.stageKey, adminProfile.position,
    ].map(normalize);
    const aliases = {
      org_adv: ["orgadv", "orgadviser", "organizationadviser", "organizationadvisor", "adviser"],
      sir_abelida: ["sirabelida", "abelida", "abelidas", "laboratoryhead", "propertycustodian", "administrativeofficer", "labhead"],
      hap: ["hap", "headofacademicprograms", "qaccoordinator"],
      osas: ["osas"],
    };
    const key = accountValues.some((value) => value.includes("administrative"))
      ? "sir_abelida"
      : accountValues.some((value) => value.includes("orgadviser") || value.includes("orgadvisor"))
        ? "org_adv"
        : accountValues.some((value) => value.includes("hap"))
          ? "hap"
          : accountValues.some((value) => value.includes("osas"))
            ? "osas"
            : Object.keys(aliases).find((stage) => declared.some((value) => aliases[stage].some((alias) => value.includes(alias))));
    return labels[key] || (requireRecognizedStage ? "" : String(adminProfile.position || adminProfile.title || adminProfile.role_title || adminProfile.approver_role || adminProfile.approverRole || "").trim());
  }
  function stopAuthWait() {
    clearTimeout(authTimeout);
    authTimeout = null;
    authUnsubscribe?.();
    authUnsubscribe = null;
  }
  function showStartError(error) {
    startupAttempt += 1;
    stopAuthWait();
    console.error("Could not verify Admin access or load calendar:", error);
    statusElement.className = "admin-error";
    statusElement.setAttribute("role", "alert");
    statusElement.innerHTML = 'Could not load the calendar. <button class="admin-row-action" type="button" id="retryCalendar">Try again</button>';
    statusElement.hidden = false;
    calendarLayout.hidden = true;
    statusElement.querySelector("#retryCalendar").addEventListener("click", start);
    signalCalendarPageReady();
  }
  function start() {
    stopAuthWait();
    const attempt = ++startupAttempt;
    statusElement.className = "admin-loading";
    statusElement.setAttribute("role", "status");
    statusElement.textContent = "Loading calendar…";
    statusElement.hidden = false;
    calendarLayout.hidden = true;
    if (!auth || !db) {
      showStartError(new Error("Firebase authentication is unavailable."));
      return;
    }
    let finished = false;
    const finish = () => {
      if (finished || attempt !== startupAttempt) return false;
      finished = true;
      stopAuthWait();
      return true;
    };
    authTimeout = setTimeout(() => {
      if (finish()) {
        showStartError(new Error("Calendar startup timed out."));
      }
    }, 9000);
    authUnsubscribe = onAuthStateChanged(auth, async (user) => {
      if (finished || attempt !== startupAttempt) return;
      if (!user) {
        finish();
        location.replace("AdminLogin.html");
        return;
      }
      let verified = false;
      let loaded = false;
      let loadError = null;
      try {
        verified = await verifyAdmin(user);
        if (verified) {
          loaded = await loadMonthData(viewed.getFullYear(), viewed.getMonth());
          if (!loaded) throw new Error("Calendar event data could not be loaded.");
        }
      } catch (error) {
        loadError = error;
      } finally {
        if (finish()) {
          if (loadError) {
            showStartError(loadError);
          } else if (verified && loaded) {
            calendarLayout.hidden = false;
            statusElement.hidden = true;
            signalCalendarPageReady();
          }
        }
      }
    });
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
  function stageVisible(event) {
    const status = String(event.status || "")
      .toLowerCase()
      .replace(/[ _-]+/g, " ");
    return (
      [
        "awaiting final documents",
        "final documents submitted",
        "ready to publish",
        "approved",
        "published",
        "cancelled",
        "canceled",
        "completed",
      ].includes(status) || event.published === true
    );
  }
  function allEvents() {
    const saved = ["recovibeTeacherEvents", "recovibeOrganizerEvents"].flatMap(
      (key) => {
        const list = read(key, []);
        return Array.isArray(list) ? list : [];
      },
    );
    const source = Array.isArray(window.RECOVIBE_EVENTS)
      ? window.RECOVIBE_EVENTS
      : [];
    const seen = new Set();
    return [...saved, ...source, ...firestoreEvents].filter((event) => {
      const id = String(event.eventId || event.id || "");
      if (
        !id ||
        seen.has(id) ||
        !stageVisible(event) ||
        ["cancelled", "canceled"].includes(
          String(event.status || "").toLowerCase(),
        )
      )
        return false;
      seen.add(id);
      return true;
    });
  }
  function sourceName(event) {
    return eventCategory(event);
  }
  function eventCategory(event) {
    const sources = [
      event.category,
      event.categories,
      event.eventSource,
      event.source,
      event.organization,
      event.organizer,
      event.organizerName,
      event.tag,
      event.title,
      event.eventName,
      event.name,
    ].flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase())
      .filter(Boolean);
    if (
      event.isHoliday === true ||
      String(event.id || event.eventId || "").startsWith("holiday:") ||
      sources.some((source) => source.includes("holiday"))
    ) return "Holiday";
    if (sources.some((source) =>
      /(^|[^a-z])csc([^a-z]|$)/.test(source) ||
      source.includes("campus student council") ||
      source.includes("central student council"),
    )) return "Organizational";
    if (sources.some((source) => source.includes("binan"))) return "Others/External";
    if (sources.some((source) =>
      source.includes("organization") ||
      source.includes("organizational") ||
      source.includes("event organizer") ||
      source.includes("orgs & student acts") ||
      /(^|[^a-z0-9])(ibits|aces|jpcs|pice|iie|piie|hrss|sms|yes|jma|jphia|pasoa|chrms|cites)(?=$|[^a-z0-9])/.test(source),
    )) return "Organizational";
    if (sources.some((source) =>
      source.includes("pup") ||
      source.includes("official") ||
      source.includes("cite") ||
      source.includes("teacher") ||
      source.includes("faculty"),
    )) return "PUP Official";
    if (
      event.organizerId ||
      event.organization ||
      Array.isArray(event.targetOrgs) && event.targetOrgs.length > 0 ||
      Array.isArray(event.targetOrganizations) && event.targetOrganizations.length > 0
    ) return "Organizational";
    return "Others/External";
  }
  function eventCategoryGroups(event) {
    const category = eventCategory(event);
    if (category !== "Organizational") return [category];
    const sourceValues = [
      event.category, event.categories, event.eventSource, event.source,
      event.organization, event.organizer, event.organizerName, event.tag,
      event.title, event.eventName, event.name,
    ].flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => String(value || "").normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "").trim().toLowerCase());
    return ["Organizational", "Others/External"];
  }
  function visibleEvents() {
    const calendarEvents = [
      ...allEvents(),
      ...holidays.map((holiday) => ({
        ...holiday,
        id: holiday.id || `holiday:${holiday.date}:${holiday.title || holiday.name || ""}`,
        title: holiday.title || holiday.name || "Holiday",
        dateISO: holiday.date,
        source: "Holiday",
        isHoliday: true,
      })),
    ];
    const seen = new Set();
    return calendarEvents.filter((event) => {
      const id = String(event.eventId || event.id || `${dateOf(event)}:${event.title || ""}`);
      if (seen.has(id)) return false;
      seen.add(id);
      return eventCategoryGroups(event).some((category) =>
        selectedCategories.has(category),
      );
    });
  }
  function dateOf(event) {
    return String(event.dateISO || event.date || "").slice(0, 10);
  }
  function render() {
    try {
      const year = viewed.getFullYear(),
        month = viewed.getMonth(),
        first = new Date(year, month, 1),
        offset = first.getDay(),
        days = new Date(year, month + 1, 0).getDate(),
        events = visibleEvents();
      renderYearOptions();
      monthSelect.value = String(month);
      yearSelect.value = String(year);
      const cells = [];
      for (let index = 0; index < offset; index++) cells.push(cell("", "muted", ""));
      for (let day = 1; day <= days; day++) {
        const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          dayEvents = events.filter((event) => dateOf(event) === iso);
        cells.push(cell(day, iso === today ? "today" : "", iso, dayEvents));
      }
      while (cells.length % 7 !== 0) cells.push(cell("", "muted", ""));
      calendarGrid.innerHTML = cells.join("");
      renderUpcoming(events);
      renderHolidayBadges();
      void loadMonthData(year, month);
    } catch (error) {
      console.error("Unable to render admin calendar:", error);
      calendarGrid.innerHTML =
        '<div class="admin-error" role="alert">Could not display the calendar. <button class="admin-row-action" type="button" id="retryCalendarRender">Try again</button></div>';
      calendarGrid.querySelector("#retryCalendarRender").addEventListener("click", () => {
        loadedMonthDataKey = "";
        start();
      });
    }
  }
  function isHolidayEvent(event) {
    if (!event) return false;
    const id = String(event.id || event.eventId || "");
    const src = String(event.source || event.organizerName || "").toLowerCase();
    const cat = String(event.category || "").toLowerCase();
    const title = String(event.title || "").toLowerCase();
    return (
      event.isHoliday === true ||
      id.startsWith("holiday:") ||
      src.includes("holiday") ||
      cat.includes("holiday") ||
      title.includes("holiday") ||
      sourceName(event) === "Philippine Holiday" ||
      sourceName(event) === "Holiday"
    );
  }
  function cell(day, klass, iso, dayEvents = []) {
    const categoryClasses = {
      "PUP Official": "pup-official",
      Organizational: "organizational",
      "Others/External": "others-external",
      Holiday: "holiday",
    };
    const visibleBars = dayEvents.slice(0, 2).map((event) => {
      const categoryClass = categoryClasses[eventCategory(event)] || "others-external";
      const title = esc(event.title || "Untitled event");
      return `<span class="admin-event-bar category-${categoryClass}" title="${title}">${title}</span>`;
    }).join("");
    const overflow = dayEvents.length > 2
      ? `<button class="admin-day-more" type="button" aria-label="Show ${dayEvents.length - 2} more events">+${dayEvents.length - 2} more</button>`
      : "";
    return `<div class="admin-day ${klass}" ${iso ? `data-date="${iso}" data-iso="${iso}"` : ""}><button type="button" ${iso ? `aria-label="${iso}, ${dayEvents.length ? `${dayEvents.length} events` : "no events"}"` : "disabled"}>${day}</button>${dayEvents.length ? `<div class="admin-day-event-list">${visibleBars}${overflow}</div>` : ""}</div>`;
  }
  function renderUpcoming(events) {
    const [year, month] = today.split("-").map(Number);
    const monthEnd = `${today.slice(0, 7)}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
    const allUpcoming = events
      .filter((event) => dateOf(event) >= today)
      .sort((first, second) =>
        dateOf(first).localeCompare(dateOf(second)) ||
        String(first.title || "").localeCompare(String(second.title || "")),
      );
    const upcoming = allUpcoming.filter((event) => dateOf(event) <= monthEnd).slice(0, 5);
    const moreLink = allUpcoming.length > 5
      ? '<button class="admin-upcoming-more" type="button" data-upcoming-more>See All Upcoming Events</button>'
      : "";
    upcomingItems.innerHTML = upcoming.length
      ? upcoming
          .map((event) => {
            const date = new Date(`${dateOf(event)}T00:00:00`);
            const category = eventCategory(event);
            const categoryClass = {
              "PUP Official": "pup-official",
              Organizational: "organizational",
              "Others/External": "others-external",
              Holiday: "holiday",
            }[category] || "others-external";
            const id = esc(event.eventId || event.id);
            const holiday = isHolidayEvent(event);
            return `<div class="admin-upcoming-item${holiday ? " admin-upcoming-item--holiday" : ""}" ${holiday ? 'aria-disabled="true"' : `data-iso="${dateOf(event)}" data-event-id="${id}" role="button" tabindex="0"}`}><span class="admin-upcoming-date category-${categoryClass}"><strong>${date.getDate()}</strong><small>${date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</small></span><span class="admin-upcoming-copy"><strong title="${esc(event.title || "Untitled event")}">${esc(event.title || "Untitled event")}</strong><small>${esc(category)}</small></span></div>`;
          })
          .join("") + moreLink
      : '<p class="admin-upcoming-empty">No upcoming events.</p>';
    if (!upcoming.length && moreLink) upcomingItems.insertAdjacentHTML("beforeend", moreLink);
  }
  function renderYearOptions() {
    const selectedYear = viewed.getFullYear();
    const lastYear = Math.max(2045, selectedYear + 10);
    const years = Array.from({ length: lastYear - 2025 + 1 }, (_, index) => 2025 + index);
    yearSelect.innerHTML = years
      .map((year) => `<option value="${year}">${year}</option>`)
      .join("");
  }
  async function loadMonthData(year, month) {
    const monthKey = `${year}-${month}`;
    if (loadedMonthDataKey === monthKey) return true;
    const sequence = ++monthDataSequence;
    try {
      const { events, holidays: monthHolidays } = await loadCalendarData(
        allEvents(),
        year,
        month,
      );
      if (sequence !== monthDataSequence) return false;
      firestoreEvents = events;
      holidays = monthHolidays;
      loadedMonthDataKey = monthKey;
      render();
      renderHolidayBadges();
      return true;
    } catch (error) {
      console.error("Unable to load admin calendar data:", error);
      if (sequence !== monthDataSequence) return false;
      upcomingItems.innerHTML = '<div class="admin-error" role="alert">Could not load calendar events. <button class="admin-row-action" type="button" id="retryCalendarData">Try again</button></div>';
      upcomingItems.querySelector("#retryCalendarData").addEventListener("click", () => {
        loadedMonthDataKey = "";
        void loadMonthData(year, month);
      });
      return false;
    }
  }
  function renderHolidayBadges() {
    const cellsByDate = new Map();
    root.querySelectorAll(".admin-day[data-date]").forEach((day) => {
      cellsByDate.set(day.dataset.date, day);
      day.classList.remove("is-holiday");
      day.querySelectorAll(".calendar-badge.badge-holiday").forEach((badge) =>
        badge.remove(),
      );
    });

    try {
      if (
        new URLSearchParams(location.search).get("debugHolidays") === "1" ||
        localStorage.getItem("recovibeDebugHolidays") === "true"
      ) {
        holidays.forEach((holiday) => {
          if (!cellsByDate.has(holiday.date)) {
            console.log("[AdminCalendar] Holiday date has no matching cell", {
              holiday,
              renderedDates: [...cellsByDate.keys()],
            });
          }
        });
        console.log("[AdminCalendar] Holiday-to-cell mapping", {
          holidayCount: holidays.length,
          matchedCount: holidays.filter((holiday) =>
            cellsByDate.has(holiday.date),
          ).length,
          renderedCellCount: cellsByDate.size,
        });
      }
    } catch (error) {
      console.warn("Unable to read holiday diagnostic setting:", error);
    }
  }
  function move(amount) {
    viewed = new Date(viewed.getFullYear(), viewed.getMonth() + amount, 1);
    render();
  }
  function openDay(iso, showMoreUpcoming = false) {
    const listedEvents = showMoreUpcoming
      ? visibleEvents()
          .filter((event) => dateOf(event) >= today)
          .sort((first, second) => dateOf(first).localeCompare(dateOf(second)))
          .slice(5)
      : visibleEvents().filter((event) => dateOf(event) === iso);
    const events = listedEvents.filter((event) => !isHolidayEvent(event));
    const listedHolidays = listedEvents.filter(isHolidayEvent);
    if ((!events.length && !showMoreUpcoming) || (!events.length && !listedHolidays.length)) {
      // Day only has holidays: holiday is shown on calendar cell, not clickable
      return;
    }
    const holidayName = !showMoreUpcoming && selectedCategories.has("Holiday")
      ? holidays.find((holiday) => holiday.date === iso)?.title
      : "";
    const date = new Date(`${iso}T00:00:00`);
    const dialogTitle = showMoreUpcoming
      ? "More upcoming events"
      : date.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" });
    const overlay = document.createElement("div");
    overlay.className = "admin-day-overlay";
    overlay.innerHTML = `<section class="admin-day-dialog" role="dialog" aria-modal="true" aria-labelledby="adminDayTitle" tabindex="-1"><button type="button" class="admin-close" aria-label="Close day details">×</button><h2 id="adminDayTitle">${dialogTitle}</h2>${holidayName ? `<p class="admin-holiday-note">${esc(holidayName)} · Holiday</p>` : ""}<div class="admin-day-list">${events
      .map((event) => {
        const source = sourceName(event),
          time =
            event.time || `${event.startTime || ""} - ${event.endTime || ""}`,
          id = event.eventId || event.id,
          count = participants(id),
          eventDate = new Date(`${dateOf(event)}T00:00:00`);
        return `<article class="admin-day-card" style="--event-source:${color(source)}"><strong>${esc(event.title || "Untitled event")}</strong><small>${esc(source)} · ${esc(eventDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }))}</small><p>${esc(time)}</p><p>${esc(event.venueOther || event.location || event.venue || "Venue to be announced")}</p><span class="admin-chip">${esc(source)}</span><p class="day-desc">${esc(event.description || event.desc || "")}</p><hr><small>${count} Students Participating</small><button type="button" data-details="${esc(id)}">View Details</button></article>`;
      })
      .join("")}</div></section>`;
    if (showMoreUpcoming && listedHolidays.length) {
      overlay.querySelector(".admin-day-list").insertAdjacentHTML(
        "afterbegin",
        listedHolidays.map((event) => `<article class="admin-day-card" style="--event-source:${color(event)}"><strong>${esc(event.title || "Holiday")}</strong><small>Holiday · ${esc(dateOf(event))}</small></article>`).join(""),
      );
    }
    host.append(overlay);
    activePopup = overlay;
    document.body.style.overflow = "hidden";
    overlay.querySelector(".admin-close").onclick = closePopup;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePopup();
    });
    overlay.querySelectorAll("[data-details]").forEach(
      (button) =>
        (button.onclick = () => {
          const event = events.find(
            (item) =>
              String(item.eventId || item.id) === button.dataset.details,
          );
          closePopup();
          window.RecovibeEventDetails?.open(event);
        }),
    );
    overlay.querySelector(".admin-day-dialog").focus();
  }
  function color(event) {
    const category = typeof event === "string" ? event : eventCategory(event);
    return {
      "PUP Official": "#8f2536",
      Organizational: "#7c5cc4",
      "Others/External": "#64748b",
      Holiday: "#d97706",
    }[category] || "#64748b";
  }
  function participants(id) {
    const event = allEvents().find(
      (item) => String(item.eventId || item.id) === String(id),
    );
    if (!event || event.capacityMode === "N/A") return 0;
    return Math.max(0, Number(event.registeredCount) || 0);
  }
  function closePopup() {
    if (!activePopup) return;
    activePopup.remove();
    activePopup = null;
    document.body.style.overflow = "";
  }
  monthSelect.addEventListener("change", () => {
    viewed = new Date(viewed.getFullYear(), Number(monthSelect.value), 1);
    render();
  });
  yearSelect.addEventListener("change", () => {
    viewed = new Date(Number(yearSelect.value), viewed.getMonth(), 1);
    render();
  });
  document.getElementById("previousMonth").addEventListener("click", () => {
    move(-1);
  });
  document.getElementById("nextMonth").addEventListener("click", () => {
    move(1);
  });
  document.getElementById("goToday").addEventListener("click", () => {
    viewed = new Date();
    render();
  });
  document
    .getElementById("resetCalendarFilters")
    .addEventListener("click", () => {
      categoryFilters.forEach((filter) => {
        filter.checked = true;
        selectedCategories.add(filter.dataset.calendarCategory);
      });
      render();
    });
  categoryFilters.forEach((filter) => {
    filter.addEventListener("change", () => {
      if (filter.checked) {
        selectedCategories.add(filter.dataset.calendarCategory);
      } else {
        selectedCategories.delete(filter.dataset.calendarCategory);
      }
      render();
    });
  });
  calendarGrid.addEventListener("click", (event) => {
    const day = event.target.closest("[data-iso]");
    if (day) openDay(day.dataset.iso);
  });
  calendarGrid.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const day = event.target.closest("[data-iso]");
    if (!day) return;
    event.preventDefault();
    openDay(day.dataset.iso);
  });
  upcomingItems.addEventListener("click", (event) => {
    if (event.target.closest("[data-upcoming-more]")) {
      openDay(today, true);
      return;
    }
    const item = event.target.closest("[data-iso]");
    if (item) openDay(item.dataset.iso);
  });
  upcomingItems.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const item = event.target.closest("[data-iso]");
    if (!item) return;
    event.preventDefault();
    openDay(item.dataset.iso);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activePopup) closePopup();
  });
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key.includes("Events")) render();
  });
  window.addEventListener("focus", render);
  window.addEventListener("offline", () => {
    showStartError(new Error("Network connection lost."));
  });
  window.addEventListener("online", () => {
    loadedMonthDataKey = "";
    start();
  });
  window.addEventListener("pagehide", () => {
    startupAttempt += 1;
    stopAuthWait();
  }, { once: true });
  start();
})();
