(function () {
  "use strict";

  const months = [
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
  const legendSets = {
    student: [
      ["official", "PUP Official"],
      ["binan", "PUP Biñan"],
      ["csc", "CSC"],
      ["organizational", "Organizational"],
      ["external", "Others/External"],
      ["holiday", "Holiday"],
    ],
    teacher: [
      ["pup", "PUP Official"],
      ["csc", "CSC"],
      ["faculty", "Teachers/Faculty"],
      ["org", "Organizational"],
      ["other", "Others/External"],
      ["holiday", "Holiday"],
    ],
    organizer: [
      ["pup", "PUP Official"],
      ["csc", "CSC"],
      ["faculty", "Teachers/Faculty"],
      ["org", "Organizational"],
      ["other", "Others/External"],
      ["holiday", "Holiday"],
    ],
  };

  let holidays = [];
  let holidayRequestKey = "";
  let holidayRequestSequence = 0;
  let academicEntries = [];
  let academicByDate = new Map();
  const academicEntriesByRange = new Map();
  let academicRangeKey = "";
  let academicUnsubscribe = null;
  let academicSequence = 0;
  let academicLookupBuilder = null;
  let academicMutationObserver = null;
  let academicFilterObserver = null;
  let academicLegendObserver = null;
  let academicUpcomingObserver = null;
  let academicStopped = false;
  let calendarInitialized = false;

  const academicCategories = {
    holiday: { label: "Holiday", color: "var(--cal-holiday)", tint: "#fef3e2" },
    exam: { label: "Exam", color: "var(--cal-exam)", tint: "#fdecec" },
    enrollment: { label: "Enrollment", color: "var(--cal-enrollment)", tint: "#e8f0fe" },
    deadline: { label: "Deadline", color: "var(--cal-deadline)", tint: "#f1ebfd" },
    break: { label: "Break", color: "var(--cal-break)", tint: "#e6f4ea" },
    graduation: { label: "Graduation", color: "var(--cal-graduation)", tint: "#fbf3d4" },
    classes: { label: "Classes", color: "var(--cal-classes)", tint: "#e0f5f2" },
    other: { label: "Other", color: "var(--cal-other)", tint: "#edf1f5" },
  };
  const academicLegendOrder = [
    "exam",
    "enrollment",
    "deadline",
    "break",
    "classes",
    "graduation",
    "other",
  ];
  const academicUpcomingColors = {
    holiday: "#d97706",
    exam: "#b91c1c",
    enrollment: "#2563eb",
    deadline: "#7c3aed",
    break: "#15803d",
    graduation: "#a16207",
    classes: "#0f766e",
    other: "#475569",
  };

  function academicCategory(entry) {
    const category = String(entry?.category || "").trim().toLowerCase();
    return academicCategories[category] ? category : "other";
  }

  function isStudentCalendar() {
    return Boolean(
      document.querySelector('#calendarLegend[data-calendar-legend="student"]'),
    );
  }

  function syncStudentOfficialColor() {
    if (!isStudentCalendar()) return;
    const swatch = document.querySelector(
      '#calendarLegend .legend-item .dot-official',
    );
    if (!swatch) {
      console.error("[Calendar] PUP Official legend swatch is missing.");
      return;
    }

    const color = getComputedStyle(swatch).backgroundColor;
    if (!color || color === "rgba(0, 0, 0, 0)") {
      console.error("[Calendar] PUP Official legend swatch has no visible color.");
      return;
    }
    document.documentElement.style.setProperty(
      "--pup-official-calendar-color",
      color,
    );
  }

  function displayTitle(title) {
    const original = String(title || "");
    const cleaned = original
      .replace(/^\s*(?:(?:\d+\s*[-.)]\s*)|[*✱]+\s*)+/, "")
      .trim();
    return cleaned || original;
  }

  function normalizedTitle(title) {
    return String(title || "")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "");
  }

  function similarTitles(first, second) {
    const a = normalizedTitle(first);
    const b = normalizedTitle(second);
    return Boolean(a && b && (a.includes(b) || b.includes(a)));
  }

  function formatAcademicDate(ymd) {
    const [year, month, day] = ymd.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
      "en-US",
      { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" },
    );
  }

  function academicDateRange(entry) {
    return entry.startDate === entry.endDate
      ? formatAcademicDate(entry.startDate)
      : `${formatAcademicDate(entry.startDate)} to ${formatAcademicDate(entry.endDate)}`;
  }

  function academicDayNumber(startDate, date) {
    return Math.floor(
      (Date.parse(`${date}T00:00:00Z`) -
        Date.parse(`${startDate}T00:00:00Z`)) /
        86400000,
    ) + 1;
  }

  function calendarParts() {
    const isAdmin = document.getElementById("adminMonthGrid");
    const monthSelect =
      document.getElementById("calMonthSelect") ||
      document.getElementById("adminMonthSelect");
    const yearSelect =
      document.getElementById("calYearSelect") ||
      document.getElementById("adminYearSelect");
    const grid =
      document.getElementById("calFullDays") ||
      document.getElementById("adminMonthGrid");
    return { isAdmin: Boolean(isAdmin), monthSelect, yearSelect, grid };
  }

  function visibleMonthRange() {
    const { monthSelect, yearSelect } = calendarParts();
    if (!monthSelect || !yearSelect) return null;
    const year = Number(yearSelect.value);
    const month = Number(monthSelect.value);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 0 || month > 11) {
      return null;
    }
    return {
      fromYmd: `${year}-${String(month + 1).padStart(2, "0")}-01`,
      toYmd: `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`,
    };
  }

  function addAcademicStyles() {
    if (document.getElementById("academicCalendarStyles")) return;
    const style = document.createElement("style");
    style.id = "academicCalendarStyles";
    style.textContent = `
      :root {
        --cal-holiday: #d97706;
        --cal-exam: #db2777;
        --cal-enrollment: #2563eb;
        --cal-deadline: #0e7490;
        --cal-break: #15803d;
        --cal-graduation: #4f46e5;
        --cal-classes: #4d7c0f;
        --cal-other: #475569;
      }
      .academic-calendar-entry { cursor: pointer; }
      .academic-official-date {
        background: var(--cal-other) !important;
        color: #fff !important;
        font-weight: 700;
      }
      ${Object.keys(academicCategories).map((category) => `
        .academic-calendar-entry.academic-category-${category} {
          background: var(--cal-${category}) !important;
          color: #fff !important;
          font-weight: 700;
        }
      `).join("")}
      #calendarMain .calendar-day-event.academic-official-date::before { display: none; }
      #calendarMain .calendar-day-event.academic-calendar-entry {
        background-color: var(--pup-official-calendar-color, var(--cat-official, #8f2536)) !important;
        color: #fff !important;
      }
      #calendarMain .dot-official {
        background-color: var(--pup-official-calendar-color, var(--cat-official, #8f2536)) !important;
      }
      ${Object.keys(academicCategories).map((category) => `
        .event-dots .dot-academic-${category},
        .legend-item .dot-academic-${category},
        .legend-swatch.swatch-academic-${category},
        .admin-legend-swatch.category-academic-${category} {
          background: var(--cal-${category});
        }
      `).join("")}
      .academic-calendar-popup { margin-top: 16px; }
      .academic-calendar-popup h3 { margin: 0 0 10px; color: #7a1f2e; font-size: 15px; }
      .academic-calendar-popup-list { display: grid; gap: 8px; }
      .academic-calendar-popup-item {
        display: grid;
        grid-template-columns: 10px minmax(0, 1fr);
        align-items: start;
        gap: 8px;
        border-left: 3px solid var(--academic-color);
        border-radius: 6px;
        padding: 9px 11px;
        background: var(--academic-tint);
        color: #392d2d;
      }
      .academic-calendar-popup-indicator {
        width: 10px;
        height: 10px;
        margin-top: 3px;
        border-radius: 50%;
        background: var(--academic-color);
      }
      .academic-calendar-popup-copy { min-width: 0; }
      .academic-calendar-popup-item strong,
      .academic-calendar-popup-item small { display: block; }
      .academic-calendar-popup-item small { margin-top: 4px; color: #6b5b58; }
      .academic-calendar-overlay {
        position: fixed;
        z-index: 10000;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgb(28 20 20 / 55%);
      }
      .academic-calendar-dialog {
        width: min(520px, 100%);
        max-height: min(80vh, 680px);
        overflow: auto;
        border-radius: 12px;
        padding: 22px;
        background: #fffaf2;
        box-shadow: 0 18px 55px rgb(0 0 0 / 24%);
      }
      .academic-calendar-dialog h2 { margin: 0 36px 14px 0; color: #7a1f2e; font-size: 20px; }
      .academic-calendar-close { float: right; border: 0; background: transparent; color: #7a1f2e; font-size: 24px; cursor: pointer; }
      .academic-upcoming-list { display: grid; gap: 8px; margin-top: 10px; }
      .academic-upcoming-item {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        border-left: 3px solid var(--academic-color);
        border-radius: 8px;
        padding: 8px 10px;
        background: var(--academic-tint);
        color: #392d2d;
        cursor: pointer;
      }
      .academic-upcoming-date { flex: 0 0 42px; text-align: center; color: var(--academic-color); font-weight: 700; }
      .academic-upcoming-date small { display: block; font-size: 10px; text-transform: uppercase; }
      .academic-upcoming-copy { display: grid; min-width: 0; gap: 2px; }
      .academic-upcoming-copy strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
      .academic-upcoming-copy small { color: #6b5b58; font-size: 11px; }
    `;
    document.head.appendChild(style);
  }

  function academicLegendCategories() {
    const present = new Set(academicEntries.map(academicCategory));
    return academicLegendOrder.filter((category) => present.has(category));
  }

  function makeAcademicLegendItem(category, admin, grid) {
    const item = document.createElement("span");
    item.className = admin
      ? "admin-legend-item admin-academic-legend"
      : "legend-item academic-date-legend";
    item.dataset.academicCategory = category;

    const swatch = document.createElement(admin || grid ? "i" : "span");
    swatch.className = admin
      ? `admin-legend-swatch category-academic-${category}`
      : grid
        ? `legend-swatch swatch-academic-${category}`
        : `dot dot-academic-${category}`;
    swatch.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.textContent =
      category === "other" ? "Other date" : academicCategories[category].label;
    item.append(swatch, label);
    return item;
  }

  function syncAcademicLegendItems() {
    const legend = document.getElementById("calendarLegend");
    if (!legend) return;
    if (isStudentCalendar()) return;

    const categories = academicLegendCategories();
    const existing = [
      ...legend.querySelectorAll(".academic-date-legend, .admin-academic-legend"),
    ].map((item) => item.dataset.academicCategory || "");
    if (existing.length === categories.length &&
        existing.every((category, index) => category === categories[index])) {
      return;
    }

    legend
      .querySelectorAll(".academic-date-legend, .admin-academic-legend")
      .forEach((item) => item.remove());
    const admin = legend.classList.contains("admin-calendar-legend");
    const grid = Boolean(legend.dataset.calendarLegend) &&
      legend.dataset.calendarLegend !== "student";
    const target = legend.querySelector(".legend-grid") || legend;
    categories.forEach((category) => {
      target.appendChild(makeAcademicLegendItem(category, admin, grid));
    });
  }

  function holidayDiagnosticsEnabled() {
    try {
      return (
        new URLSearchParams(location.search).get("debugHolidays") === "1" ||
        localStorage.getItem("recovibeDebugHolidays") === "true"
      );
    } catch {
      return new URLSearchParams(location.search).get("debugHolidays") === "1";
    }
  }

  function renderLegends() {
    const calendar = document.querySelector(".calendar-page");
    const side = document.querySelector(".calendar-side");
    if (!calendar || !side) {
      syncAcademicLegendItems();
      return;
    }

    let legend = document.getElementById("calendarLegend");
    if (!legend) {
      legend = document.createElement("section");
      legend.id = "calendarLegend";
      legend.className = "calendar-side-panel cal-legend";
      side.appendChild(legend);
    }

    const kind = legend.dataset.calendarLegend || "student";
    if (kind === "student" && legend.querySelector(".legend-item")) return;
    const entries = legendSets[kind] || legendSets.student;
    if (kind === "organizer" || kind === "teacher") {
      legend.innerHTML = [
        '<h3 class="legend-title">Calendar legend</h3>',
        '<div class="legend-grid">',
        ...entries.map(([type, label]) =>
          `<span class="legend-item"><span class="legend-swatch swatch-${type}" aria-hidden="true"></span>${label}</span>`,
        ),
        '</div>',
      ].join("");
    } else {
      legend.innerHTML = [
        '<span class="legend-title">Calendar legend</span>',
        ...entries.map(([type, label]) =>
          `<span class="legend-item"><span class="dot dot-${type}" aria-hidden="true"></span>${label}</span>`,
        ),
      ].join("");
    }
    syncAcademicLegendItems();
  }

  function renderGrid() {
    const monthSelect = document.getElementById("calMonthSelect");
    const yearSelect = document.getElementById("calYearSelect");
    const grid = document.getElementById("calFullDays");
    const list = document.getElementById("calendarListView");
    if (!monthSelect || !yearSelect || !grid) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    if (!monthSelect.options.length) {
      monthSelect.innerHTML = months
        .map((name, index) => `<option value="${index}">${name}</option>`)
        .join("");
    }
    if (!yearSelect.options.length) {
      yearSelect.innerHTML = Array.from(
        { length: 21 },
        (_, index) => year - 10 + index,
      )
        .map((optionYear) => `<option value="${optionYear}">${optionYear}</option>`)
        .join("");
    }
    monthSelect.value = String(month);
    yearSelect.value = String(year);

    const first = new Date(Date.UTC(year, month, 1));
    const start = new Date(first);
    start.setUTCDate(1 - first.getUTCDay());
    const cells = [];
    for (let index = 0; index < 42; index += 1) {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const iso = date.toISOString().slice(0, 10);
      const day = date.getUTCDate();
      const isCurrentMonth = date.getUTCMonth() === month;
      cells.push(
        `<div class="cal-day-full${isCurrentMonth ? "" : " is-muted"}" data-date="${iso}" data-iso="${iso}" tabindex="0" aria-label="${months[date.getUTCMonth()]} ${day}, ${date.getUTCFullYear()}: no events"><span class="day-num">${day}</span>${isCurrentMonth ? '<span class="calendar-day-empty">No events</span>' : ""}</div>`,
      );
    }

    grid.innerHTML = cells.join("");
    if (list) {
      list.innerHTML =
        '<div class="calendar-list-empty">No events for this month.</div>';
    }
  }

  function holidayEntriesFor(date) {
    return holidays.filter((holiday) => holiday.date === date);
  }

  function isAcademicCategoryVisible(entry) {
    if (isStudentCalendar()) {
      const officialFilter = document.querySelector(
        'input[type="checkbox"][data-source="PUP Official"]',
      );
      return !officialFilter || officialFilter.checked;
    }

    const holidayFilter = document.querySelector(
      '[data-source="Holiday"], [data-category-key="holiday"], [data-calendar-category="Holiday"]',
    );
    const officialFilter = document.querySelector(
      '[data-source="Official Date"], [data-category-key="official-date"], [data-category-key="academic"], [data-calendar-category="Official Date"]',
    );
    const isHoliday = academicCategory(entry) === "holiday";
    return isHoliday
      ? !holidayFilter || holidayFilter.checked
      : !officialFilter || officialFilter.checked;
  }

  function visibleAcademicEntries(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return [];
    const mappedEntries = academicByDate.get(date) || [];
    const rangedEntries = academicEntries.filter((entry) =>
      /^\d{4}-\d{2}-\d{2}$/.test(entry.startDate || "") &&
      /^\d{4}-\d{2}-\d{2}$/.test(entry.endDate || "") &&
      entry.startDate <= date &&
      date <= entry.endDate,
    );
    const seen = new Set();
    return [...mappedEntries, ...rangedEntries]
      .filter(isAcademicCategoryVisible)
      .filter((entry) => {
        const key = String(
          entry.id || `${entry.title || ""}:${entry.startDate}:${entry.endDate}`,
        );
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((first, second) => {
        const firstHoliday = academicCategory(first) === "holiday";
        const secondHoliday = academicCategory(second) === "holiday";
        return (
          Number(secondHoliday) - Number(firstHoliday) ||
          first.startDate.localeCompare(second.startDate) ||
          String(first.title || "").localeCompare(String(second.title || ""))
        );
      });
  }

  function ensureOfficialDateFilter() {
    if (isStudentCalendar()) return;
    const adminFilter = document.querySelector(".admin-filter-panel");
    const panel = adminFilter || document.querySelector(".filter-panel");
    if (!panel) return;
    if (
      panel.querySelector(
        '[data-source="Official Date"], [data-category-key="official-date"], [data-calendar-category="Official Date"]',
      )
    ) return;

    const label = document.createElement("label");
    label.className = adminFilter ? "admin-filter-option" : "filter-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    if (adminFilter) input.dataset.calendarCategory = "Official Date";
    else if (panel.querySelector("[data-category-key]")) {
      input.dataset.categoryKey = "official-date";
    } else {
      input.dataset.source = "Official Date";
    }
    const text = document.createElement("span");
    text.textContent = "Official Date";
    label.append(input, text);
    panel.appendChild(label);
  }

  function removeDuplicateHolidayChips(cell, date, entries) {
    const duplicates = entries.filter((entry) =>
      academicCategory(entry) === "holiday" &&
      holidayEntriesFor(date).some((holiday) => similarTitles(entry.title, holiday.title || holiday.name)),
    );
    if (!duplicates.length) return;
    cell.querySelectorAll(
      ".calendar-badge.badge-holiday, .calendar-day-event.dot-holiday, .cal-day-bar.is-holiday-bar, .admin-event-bar.category-holiday",
    ).forEach((node) => {
      const title = node.title || node.querySelector(".bar-title")?.textContent || node.textContent;
      if (duplicates.some((entry) => similarTitles(entry.title, title))) {
        node.remove();
      }
    });
  }

  function dayEventList(cell, kind) {
    const listClass = {
      student: "calendar-day-event-list",
      admin: "admin-day-event-list",
      shared: "cal-day-events",
    }[kind];
    let list = cell.querySelector(`:scope > .${listClass}`);
    if (!list) {
      list = document.createElement(kind === "student" ? "span" : "div");
      list.className = listClass;
      cell.appendChild(list);
    }
    return list;
  }

  function dayMoreControl(list, kind) {
    const selector = {
      student: ".calendar-day-more",
      admin: ".admin-day-more",
      shared: ".cal-more-chip",
    }[kind];
    let more = list.querySelector(selector);
    if (!more) {
      more = document.createElement(kind === "shared" ? "span" : "button");
      more.className = selector.slice(1);
      if (kind !== "shared") more.type = "button";
    }
    return more;
  }

  function baseOverflowCount(more, kind) {
    if (kind === "student") return 0;
    if (more.dataset.academicBaseOverflow !== undefined) {
      return Number(more.dataset.academicBaseOverflow) || 0;
    }
    const match = `${more.textContent} ${more.getAttribute("aria-label") || ""}`
      .match(/(\d+)\s+more/i);
    const count = match ? Number(match[1]) : 0;
    more.dataset.academicBaseOverflow = String(count);
    return count;
  }

  function makeAcademicBar(entry, date, kind) {
    const category = academicCategory(entry);
    const holiday = category === "holiday";
    const studentCalendar = isStudentCalendar();
    const title = displayTitle(entry.title);
    let bar;
    if (kind === "student") {
      bar = document.createElement("span");
      bar.className = "calendar-day-event dot-official academic-official-date";
    } else if (kind === "admin") {
      bar = document.createElement("span");
      bar.className = `admin-event-bar ${holiday ? "category-holiday" : "academic-official-date"}`;
    } else {
      bar = document.createElement("div");
      bar.className = `cal-day-bar ${holiday ? "bar-holiday is-holiday-bar" : "academic-official-date"}`;
      const barTitle = document.createElement("span");
      barTitle.className = "bar-title";
      barTitle.textContent = title;
      bar.appendChild(barTitle);
    }
    bar.classList.add(
      "academic-calendar-entry",
      holiday ? "academic-holiday" : "academic-official-date",
    );
    if (!studentCalendar) bar.classList.add(`academic-category-${category}`);
    if (kind !== "shared") bar.textContent = title;
    bar.title = title;
    bar.dataset.academicDate = date;
    bar.dataset.academicCategory = category;
    if (studentCalendar) bar.dataset.source = "PUP Official";
    if (studentCalendar) {
      bar.style.setProperty(
        "background-color",
        "var(--pup-official-calendar-color, var(--cat-official, #8f2536))",
        "important",
      );
    }
    bar.tabIndex = 0;
    bar.setAttribute("role", "button");
    bar.setAttribute(
      "aria-label",
      `${studentCalendar ? "PUP Official" : holiday ? "Holiday" : "Official Date"}: ${title}`,
    );
    bar.style.pointerEvents = "auto";
    return bar;
  }

  function isHolidayBar(bar, kind) {
    if (kind === "student") {
      return bar.dataset.academicCategory === "holiday" ||
        bar.classList.contains("dot-holiday");
    }
    if (kind === "admin") return bar.classList.contains("category-holiday");
    return bar.classList.contains("bar-holiday") || bar.classList.contains("is-holiday-bar");
  }

  function updateStudentEventDots(cell, bars) {
    let dots = cell.querySelector(".event-dots");
    if (!bars.length) {
      dots?.remove();
      return;
    }
    if (!dots) {
      dots = document.createElement("span");
      dots.className = "event-dots";
      dots.setAttribute("aria-hidden", "true");
      const dayNumber = cell.querySelector(".day-num");
      if (dayNumber) dayNumber.after(dots);
      else cell.prepend(dots);
    }
    dots.replaceChildren();
    bars.slice(0, 3).forEach((bar) => {
      const categoryClass = bar.classList.contains("academic-calendar-entry")
        ? isStudentCalendar()
          ? "dot-official"
          : bar.dataset.academicCategory === "holiday"
            ? "dot-holiday"
            : `dot-academic-${bar.dataset.academicCategory || "other"}`
        : [...bar.classList].find((className) => className.startsWith("dot-")) || "dot-external";
      const dot = document.createElement("span");
      dot.className = `dot ${categoryClass}`;
      dot.title = bar.title || bar.textContent;
      if (bar.dataset.academicDate) dot.dataset.academicDate = bar.dataset.academicDate;
      dots.appendChild(dot);
    });
    if (bars.length > 3) {
      const overflow = document.createElement("span");
      overflow.className = "event-dot-overflow";
      overflow.textContent = `+${bars.length - 3}`;
      dots.appendChild(overflow);
    }
  }

  function fitStudentEventBars(list, bars, more) {
    bars.forEach((bar) => {
      bar.hidden = false;
      bar.style.display = "";
    });
    more.hidden = true;
    more.style.display = "none";
    if (!window.matchMedia("(min-width: 1100px)").matches || !bars.length) return bars.length;

    const chipHeight = bars[0].getBoundingClientRect().height;
    const availableHeight = list.clientHeight;
    if (!chipHeight || !availableHeight) return bars.length;
    const gap = Number.parseFloat(getComputedStyle(list).rowGap) || 2;
    const moreHeight = Number.parseFloat(getComputedStyle(more).lineHeight) || 13;
    const maxVisible = Math.floor((availableHeight + gap) / (chipHeight + gap));
    const visibleCount = bars.length > maxVisible
      ? Math.max(0, Math.floor((availableHeight - moreHeight + gap) / (chipHeight + gap)))
      : bars.length;
    bars.forEach((bar, index) => {
      const hidden = index >= visibleCount;
      bar.hidden = hidden;
      bar.style.display = hidden ? "none" : "";
    });
    return visibleCount;
  }

  function updateMoreControl(more, kind, date, count) {
    more.dataset.academicMore = date;
    more.textContent = `+${count} more`;
    more.hidden = count === 0;
    more.style.display = count === 0 ? "none" : "";
    more.setAttribute(
      "aria-label",
      `Show ${count} more ${kind === "student" ? "events" : "events and official dates"}`,
    );
  }

  function renderAcademicGrid() {
    const { grid, isAdmin } = calendarParts();
    if (!grid || !academicLookupBuilder) return;
    const range = visibleMonthRange();
    if (!range) return;
    const kind = isAdmin
      ? "admin"
      : document.querySelector('#calendarLegend[data-calendar-legend="student"]')
        ? "student"
        : "shared";
    const barSelector = {
      student: ".calendar-day-event",
      admin: ".admin-event-bar",
      shared: ".cal-day-bar",
    }[kind];
    const maxVisible = kind === "admin" ? 2 : 3;
    grid.querySelectorAll(isAdmin ? ".admin-day[data-date]" : ".cal-day-full[data-date]")
      .forEach((cell) => {
        const date = cell.dataset.date;
        cell.querySelector(":scope > .academic-calendar-labels")?.remove();
        cell.querySelectorAll(".academic-calendar-entry").forEach((bar) => bar.remove());
        const entries = visibleAcademicEntries(date);
        removeDuplicateHolidayChips(cell, date, entries);
        let list = cell.querySelector({
          student: ":scope > .calendar-day-event-list",
          admin: ":scope > .admin-day-event-list",
          shared: ":scope > .cal-day-events",
        }[kind]);
        const eventBars = list ? [...list.querySelectorAll(barSelector)] : [];
        const academicBars = entries.map((entry) => makeAcademicBar(entry, date, kind));
        if (!eventBars.length && !academicBars.length) {
          list?.querySelectorAll(".calendar-day-more, .admin-day-more, .cal-more-chip")
            .forEach((more) => more.remove());
          if (kind !== "shared") list?.remove();
          if (kind === "student") {
            updateStudentEventDots(cell, []);
            cell.classList.remove("has-event");
          }
          return;
        }
        if (!list) list = dayEventList(cell, kind);
        const more = dayMoreControl(list, kind);
        const hiddenEventCount = baseOverflowCount(more, kind);
        const bars = [...eventBars, ...academicBars].sort((first, second) => {
          const priority = (bar) =>
            isHolidayBar(bar, kind) ? 0 :
              bar.classList.contains("academic-official-date") ? 2 : 1;
          return priority(first) - priority(second);
        });
        list.replaceChildren(...bars, more);

        let hiddenCount;
        if (kind === "student") {
          const visibleCount = fitStudentEventBars(list, bars, more);
          hiddenCount = bars.length - visibleCount;
          updateStudentEventDots(cell, bars);
          cell.classList.toggle("has-event", bars.length > 0);
        } else {
          const visibleCount = Math.min(maxVisible, bars.length);
          bars.forEach((bar, index) => {
            const hidden = index >= visibleCount;
            bar.hidden = hidden;
            bar.style.display = hidden ? "none" : "";
          });
          hiddenCount = hiddenEventCount + bars.length - visibleCount;
        }
        updateMoreControl(more, kind, date, hiddenCount);
      });
    renderAcademicUpcoming();
  }

  function todayManilaString() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }

  function academicUpcomingEntries() {
    const today = todayManilaString();
    const seen = new Set();
    return academicEntries
      .filter((entry) => {
        if (
          !entry ||
          !/^\d{4}-\d{2}-\d{2}$/.test(entry.startDate || "") ||
          !/^\d{4}-\d{2}-\d{2}$/.test(entry.endDate || "") ||
          entry.endDate < today
        ) return false;
        const visible = isAcademicCategoryVisible(entry);
        const key = String(entry.id || `${entry.startDate}:${entry.title}`);
        if (!visible || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((first, second) =>
        (first.startDate < today ? today : first.startDate).localeCompare(
          second.startDate < today ? today : second.startDate,
        ) ||
        Number(academicCategory(second) === "holiday") -
          Number(academicCategory(first) === "holiday"),
      )
      .slice(0, 5);
  }

  function removeDuplicateHolidayCards(container) {
    if (!container) return;
    const duplicateTitles = new Set();
    academicEntries.forEach((entry) => {
      if (academicCategory(entry) !== "holiday") return;
      const cursor = new Date(`${entry.startDate}T00:00:00.000Z`);
      const end = new Date(`${entry.endDate}T00:00:00.000Z`);
      if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(end.getTime())) return;
      while (cursor <= end) {
        const date = cursor.toISOString().slice(0, 10);
        holidayEntriesFor(date).forEach((holiday) => {
          if (similarTitles(entry.title, holiday.title || holiday.name)) {
            duplicateTitles.add(normalizedTitle(holiday.title || holiday.name));
          }
        });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    });
    if (!duplicateTitles.size) return;
    container.querySelectorAll(
      ".upcoming-item--holiday, .admin-upcoming-item--holiday",
    ).forEach((card) => {
      const title = normalizedTitle(
        card.querySelector(".upcoming-copy strong, .admin-upcoming-copy strong")?.textContent ||
          card.textContent,
      );
      if ([...duplicateTitles].some((duplicate) => title.includes(duplicate) || duplicate.includes(title))) {
        card.remove();
      }
    });
  }

  function renderAcademicUpcoming() {
    const host =
      document.getElementById("adminUpcomingItems") ||
      document.getElementById("upcomingList") ||
      document.querySelector(".upcoming-panel");
    if (!host) return;
    let list = host.querySelector(":scope > .academic-upcoming-list");
    if (!list) {
      list = document.createElement("div");
      list.className = "academic-upcoming-list";
      list.setAttribute("aria-label", "Upcoming official dates");
      host.appendChild(list);
    }
    list.replaceChildren();
    const entries = academicUpcomingEntries();
    entries.forEach((entry) => {
      const date = entry.startDate < todayManilaString()
        ? todayManilaString()
        : entry.startDate;
      const category = academicCategories[academicCategory(entry)];
      const studentCalendar = isStudentCalendar();
      const card = document.createElement("article");
      card.className = "academic-upcoming-item";
      card.dataset.academicDate = date;
      if (studentCalendar) card.dataset.source = "PUP Official";
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.style.setProperty(
        "--academic-color",
        studentCalendar
          ? "var(--pup-official-calendar-color, var(--cat-official, #8f2536))"
          : academicUpcomingColors[academicCategory(entry)],
      );
      card.style.setProperty(
        "--academic-tint",
        studentCalendar
          ? "#f7e9eb"
          : category.tint,
      );
      const datePart = document.createElement("span");
      datePart.className = "academic-upcoming-date";
      const [year, month, day] = date.split("-").map(Number);
      const dayText = document.createElement("span");
      dayText.textContent = String(day);
      const monthText = document.createElement("small");
      monthText.textContent = new Date(Date.UTC(year, month - 1, day))
        .toLocaleDateString("en-US", { timeZone: "UTC", month: "short" })
        .toUpperCase();
      datePart.append(dayText, monthText);
      const copy = document.createElement("span");
      copy.className = "academic-upcoming-copy";
      const title = document.createElement("strong");
      title.textContent = displayTitle(entry.title);
      const label = document.createElement("small");
      label.textContent =
        studentCalendar
          ? "PUP Official"
          : category.label;
      copy.append(title, label);
      card.append(datePart, copy);
      list.appendChild(card);
    });
    removeDuplicateHolidayCards(host);
  }

  function popupTarget() {
    const overlay = [
      document.getElementById("organizerDayOverlay"),
      ...document.querySelectorAll(".admin-day-overlay"),
    ].find((candidate) =>
      candidate?.classList.contains("is-open") ||
      candidate?.classList.contains("admin-day-overlay") && candidate.isConnected,
    );
    if (!overlay) return null;
    return overlay.querySelector(
      "#organizerDayList, .admin-day-list, .day-modal-list",
    );
  }

  function popupLegendCategory(entry) {
    const category = academicCategory(entry);
    if (isStudentCalendar()) {
      return {
        label: "PUP Official",
        color: "var(--pup-official-calendar-color, var(--cat-official, #8f2536))",
      };
    }
    return {
      label: category === "holiday" ? "Holiday" : "Official Date",
      color: academicCategories[category].color,
    };
  }

  function makeAcademicPopupSection(date) {
    const entries = visibleAcademicEntries(date);
    if (!entries.length) return null;
    const section = document.createElement("section");
    section.className = "academic-calendar-popup";
    const heading = document.createElement("h3");
    heading.textContent = "Academic calendar";
    const list = document.createElement("div");
    list.className = "academic-calendar-popup-list";
    entries.forEach((entry) => {
      const category = academicCategories[academicCategory(entry)];
      const legendCategory = popupLegendCategory(entry);
      const item = document.createElement("article");
      item.className = "academic-calendar-popup-item";
      item.style.setProperty("--academic-color", legendCategory.color);
      item.style.setProperty(
        "--academic-tint",
        isStudentCalendar() ? "#f7e9eb" : category.tint,
      );
      const indicator = document.createElement("span");
      indicator.className = "academic-calendar-popup-indicator";
      indicator.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span");
      copy.className = "academic-calendar-popup-copy";
      const title = document.createElement("strong");
      title.textContent = displayTitle(entry.title);
      const details = document.createElement("small");
      const dayCount =
        Math.floor(
          (Date.parse(`${entry.endDate}T00:00:00Z`) -
            Date.parse(`${entry.startDate}T00:00:00Z`)) /
            86400000,
        ) + 1;
      const range = document.createElement("span");
        const rawCategory = String(entry?.category || entry?.type || "").trim().toLowerCase();
        const showSubtype =
          (category.label !== "Other" && category.label !== legendCategory.label) ||
          (legendCategory.label === "Official Date" && rawCategory === "other");
        const subtype = showSubtype ? ` · ${category.label}` : "";
      range.textContent = `${legendCategory.label}${subtype} · ${academicDateRange(entry)}`;
      details.appendChild(range);
      if (dayCount > 1) {
        const position = document.createElement("span");
        position.textContent = ` · Day ${academicDayNumber(entry.startDate, date)} of ${dayCount}`;
        details.appendChild(position);
      }
      copy.append(title, details);
      item.append(indicator, copy);
      list.appendChild(item);
    });
    section.append(heading, list);
    return section;
  }

  function showAcademicPopup(date) {
    const section = makeAcademicPopupSection(date);
    if (!section) return;
    const content = popupTarget();
    if (content) {
      content.querySelector(".academic-calendar-popup")?.remove();
      content.appendChild(section);
      return;
    }

    document.querySelector(".academic-calendar-overlay")?.remove();
    const overlay = document.createElement("div");
    overlay.className = "academic-calendar-overlay";
    const dialog = document.createElement("section");
    dialog.className = "academic-calendar-dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const close = document.createElement("button");
    close.type = "button";
    close.className = "academic-calendar-close";
    close.setAttribute("aria-label", "Close academic calendar");
    close.textContent = "×";
    const heading = document.createElement("h2");
    heading.textContent = formatAcademicDate(date);
    dialog.append(close, heading, section);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    const closePopup = () => overlay.remove();
    close.addEventListener("click", closePopup, { once: true });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePopup();
    });
    dialog.focus();
  }

  function handleAcademicClick(event) {
    if (isStudentCalendar()) return;
    const more = event.target.closest("[data-academic-more]");
    const card = event.target.closest("[data-academic-date]");
    const cell = event.target.closest("#calFullDays [data-date], #adminMonthGrid [data-date]");
    const date = more?.dataset.academicMore || card?.dataset.academicDate || cell?.dataset.date;
    if (!date || !visibleAcademicEntries(date).length) return;
    window.setTimeout(() => showAcademicPopup(date), 0);
  }

  function handleAcademicKeydown(event) {
    if (isStudentCalendar()) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-academic-date]");
    if (!card) return;
    event.preventDefault();
    showAcademicPopup(card.dataset.academicDate);
  }

  function subscribeAcademicCalendar() {
    const range = visibleMonthRange();
    const { grid } = calendarParts();
    if (!range || !grid || !grid.querySelector("[data-date]")) return;
    const rangeKey = `${range.fromYmd}:${range.toYmd}`;
    if (rangeKey === academicRangeKey) return;
    academicRangeKey = rangeKey;
    academicSequence += 1;
    const sequence = academicSequence;
    academicUnsubscribe?.();
    academicUnsubscribe = null;
    if (academicEntriesByRange.has(rangeKey)) {
      academicEntries = academicEntriesByRange.get(rangeKey);
    }
    if (academicLookupBuilder) {
      academicByDate = academicLookupBuilder(
        academicEntries,
        range.fromYmd,
        range.toYmd,
      );
    }
    syncAcademicLegendItems();
    renderAcademicGrid();

    Promise.all([
      import("./UserStudent/firebaseConfig.js"),
      import("./academicCalendarStore.js"),
      import("./calendarDataService.js"),
    ]).then(([firebase, store, service]) => {
      if (academicStopped || sequence !== academicSequence) return;
      academicLookupBuilder = service.buildAcademicCalendarLookup;
      if (!firebase.db) {
        throw Object.assign(new Error("Firestore is not configured."), {
          code: "unavailable",
        });
      }
      const unsubscribe = store.subscribeCalendarRange(
        firebase.db,
        range.fromYmd,
        range.toYmd,
        (entries) => {
          if (academicStopped || sequence !== academicSequence) return;
          academicEntriesByRange.set(rangeKey, entries);
          academicEntries = entries;
          academicByDate = academicLookupBuilder(
            entries,
            range.fromYmd,
            range.toYmd,
          );
          console.info("[Calendar] academicCalendar entries loaded:", entries.length);
          syncAcademicLegendItems();
          renderAcademicGrid();
        },
        (error) => {
          if (academicStopped || sequence !== academicSequence) return;
          academicByDate = academicLookupBuilder(
            academicEntries,
            range.fromYmd,
            range.toYmd,
          );
          syncAcademicLegendItems();
          console.error(
            "[Calendar] academicCalendar failed:",
            error?.code || "unknown",
            error?.message || String(error),
          );
          renderAcademicGrid();
        },
      );
      if (academicStopped || sequence !== academicSequence) {
        unsubscribe();
        return;
      }
      academicUnsubscribe = unsubscribe;
    }).catch((error) => {
      if (academicStopped || sequence !== academicSequence) return;
      console.error(
        "[Calendar] academicCalendar failed:",
        error?.code || "unknown",
        error?.message || String(error),
      );
      renderAcademicGrid();
    });
  }

  function syncAcademicCalendar() {
    ensureOfficialDateFilter();
    syncAcademicLegendItems();
    subscribeAcademicCalendar();
    renderAcademicGrid();
  }

  function applyHolidayMarkers() {
    const holidaysByDate = new Map();
    holidays.forEach((holiday) => {
      const names = holidaysByDate.get(holiday.date) || [];
      names.push(holiday.title || holiday.name);
      holidaysByDate.set(holiday.date, names);
    });
    const cellsByDate = new Map();
    document.querySelectorAll("#calFullDays [data-date]").forEach((cell) => {
      cellsByDate.set(cell.dataset.date, cell);
      const names = holidaysByDate.get(cell.dataset.date) || [];
      const hasHoliday = names.length > 0;
      cell.classList.toggle("is-holiday", hasHoliday);
      cell.classList.toggle("only-holiday", hasHoliday);
      if (hasHoliday) {
        cell.setAttribute("tabindex", "-1");
        cell.setAttribute("role", "gridcell");
        cell.setAttribute("aria-disabled", "true");
        cell.classList.remove("is-selected");
      }
      cell.querySelectorAll(".calendar-badge.badge-holiday").forEach((badge) =>
        badge.remove(),
      );
      const visibleEventCount = cell.querySelectorAll(".event-dots .dot").length;
      const overflowCount = Number(
        cell.querySelector(".event-dot-overflow")?.textContent.replace("+", ""),
      );
      const eventCount = visibleEventCount + (overflowCount || 0);
      const hasHolidayEvent = Boolean(cell.querySelector(".dot-holiday"));
      const day = cell.querySelector(".day-num")?.textContent || "";
      const labels = [
        `${months[Number(cell.dataset.date.slice(5, 7)) - 1]} ${day}`,
        eventCount
          ? `${eventCount} event${eventCount === 1 ? "" : "s"}`
          : "no events",
        ...names,
      ];
      cell.setAttribute("aria-label", labels.join("; "));
      names.filter(() => !hasHolidayEvent).forEach((name) => {
        const badge = document.createElement("span");
        badge.className = "calendar-badge badge-holiday";
        badge.setAttribute("role", "note");
        badge.style.pointerEvents = "none";
        badge.style.cursor = "default";
        badge.textContent = name;
        badge.title = name;
        cell.appendChild(badge);
      });
    });
    renderAcademicGrid();

    if (holidayDiagnosticsEnabled()) {
      holidays.forEach((holiday) => {
        if (!cellsByDate.has(holiday.date)) {
          console.log("[CalendarShell] Holiday date has no matching cell", {
            holiday,
            renderedDates: [...cellsByDate.keys()],
          });
        }
      });
      console.log("[CalendarShell] Holiday-to-cell mapping", {
        holidayCount: holidays.length,
        matchedCount: holidays.filter((holiday) =>
          cellsByDate.has(holiday.date),
        ).length,
        renderedCellCount: cellsByDate.size,
      });
    }
  }

  async function loadHolidays() {
    const { monthSelect, yearSelect } = calendarParts();
    if (!monthSelect || !yearSelect) return;

    const month = Number(monthSelect.value);
    const year = Number(yearSelect.value);
    const requestKey = `${year}-${month}`;
    if (requestKey === holidayRequestKey) return;
    holidayRequestKey = requestKey;
    const requestSequence = ++holidayRequestSequence;
    holidays = [];
    applyHolidayMarkers();

    try {
      const { getPhilippineHolidaysForMonth } = await import("./holidayService.js");
      const result = await getPhilippineHolidaysForMonth(year, month);
      if (requestSequence !== holidayRequestSequence) return;
      holidays = result;
      applyHolidayMarkers();
      renderAcademicUpcoming();
    } catch (error) {
      if (requestSequence !== holidayRequestSequence) return;
      holidayRequestKey = "";
      holidays = [];
      console.warn("Calendar holiday markers are unavailable:", error);
    }
  }

  function initCalendar() {
    if (calendarInitialized) return;
    calendarInitialized = true;
    academicStopped = false;
    addAcademicStyles();
    renderLegends();
    syncStudentOfficialColor();
    renderGrid();

    const { grid, monthSelect, yearSelect } = calendarParts();
    if (grid) {
      academicMutationObserver = new MutationObserver(() => {
        applyHolidayMarkers();
        syncAcademicCalendar();
      });
      academicMutationObserver.observe(grid, { childList: true });
    }

    monthSelect?.addEventListener("change", () => {
      holidayRequestKey = "";
      loadHolidays();
      syncAcademicCalendar();
    });
    yearSelect?.addEventListener("change", () => {
      holidayRequestKey = "";
      loadHolidays();
      syncAcademicCalendar();
    });
    ["calFullPrev", "calFullNext"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", () => {
        window.setTimeout(() => {
          holidayRequestKey = "";
          loadHolidays();
          syncAcademicCalendar();
        }, 0);
      });
    });
    ["previousMonth", "nextMonth", "goToday"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", () => {
        window.setTimeout(() => {
          holidayRequestKey = "";
          loadHolidays();
          syncAcademicCalendar();
        }, 0);
      });
    });
    document.querySelector(".cal-toggle")?.addEventListener("click", () => {
      window.setTimeout(() => {
        holidayRequestKey = "";
        loadHolidays();
        syncAcademicCalendar();
      }, 0);
    });
    document.addEventListener("change", (event) => {
      if (
        event.target.matches(
          '[data-source="Holiday"], [data-source="Official Date"], [data-category-key="holiday"], [data-category-key="official-date"], [data-calendar-category="Holiday"], [data-calendar-category="Official Date"]',
        ) ||
        isStudentCalendar() &&
          event.target.matches('[data-source="PUP Official"]')
      ) {
        renderAcademicGrid();
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".filter-reset, #resetCalendarFilters")) return;
      const officialDateFilter = document.querySelector(
        '[data-source="Official Date"], [data-category-key="official-date"], [data-calendar-category="Official Date"]',
      );
      if (officialDateFilter) officialDateFilter.checked = true;
      renderAcademicGrid();
    });
    document.addEventListener("click", handleAcademicClick);
    document.addEventListener("keydown", handleAcademicKeydown);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        document.querySelector(".academic-calendar-overlay")?.remove();
      }
    });
    const filterPanel =
      document.querySelector(".filter-panel") ||
      document.querySelector(".admin-filter-panel");
    if (filterPanel) {
      academicFilterObserver = new MutationObserver(() => {
        ensureOfficialDateFilter();
        renderAcademicGrid();
      });
      academicFilterObserver.observe(filterPanel, { childList: true });
    }
    const legend = document.getElementById("calendarLegend");
    if (legend) {
      academicLegendObserver = new MutationObserver(syncAcademicLegendItems);
      academicLegendObserver.observe(legend, { childList: true, subtree: true });
    }
    const upcomingHost =
      document.getElementById("adminUpcomingItems") ||
      document.getElementById("upcomingList") ||
      document.querySelector(".upcoming-panel");
    if (upcomingHost) {
      academicUpcomingObserver = new MutationObserver(() => {
        if (!upcomingHost.querySelector(".academic-upcoming-list")) {
          renderAcademicUpcoming();
        }
      });
      academicUpcomingObserver.observe(upcomingHost, { childList: true });
    }
    window.addEventListener("online", () => {
      holidayRequestKey = "";
      loadHolidays();
      academicRangeKey = "";
      syncAcademicCalendar();
    });
    window.addEventListener("pagehide", () => {
      academicStopped = true;
      academicSequence += 1;
      academicUnsubscribe?.();
      academicUnsubscribe = null;
      academicMutationObserver?.disconnect();
      academicFilterObserver?.disconnect();
      academicLegendObserver?.disconnect();
      academicUpcomingObserver?.disconnect();
    }, { once: true });
    loadHolidays();
    syncAcademicCalendar();
  }

  window.RecoVibeCalendarShell = {
    initCalendar,
    loadHolidays,
    renderGrid,
    renderLegends,
    getAcademicEntriesForDate(date) {
      return [...visibleAcademicEntries(date)];
    },
    renderAcademicCalendar: renderAcademicGrid,
    setHolidays(nextHolidays) {
      holidayRequestSequence += 1;
      holidays = Array.isArray(nextHolidays) ? nextHolidays : [];
      applyHolidayMarkers();
    },
  };

  if (
    document.getElementById("calFullDays") ||
    document.getElementById("adminMonthGrid")
  ) {
    initCalendar();
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initCalendar, { once: true });
  }
})();
