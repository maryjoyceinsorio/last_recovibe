(() => {
  "use strict";

  const dashboardRoot = document.getElementById("dashboardRoot");
  const roleElement = document.querySelector("[data-role]");
  if (!dashboardRoot || !roleElement) return;

  let enabled = false;
  let defaultsApplied = false;
  let sortingRows = false;
  let selectedStatus = "pending_approval";

  function normalizedRole(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function enableForAllowedRole() {
    const role = normalizedRole(roleElement.textContent);
    if (!["organizationadviser", "organizationadvisor", "orgadviser", "orgadvisor", "osas"].includes(role)) {
      return false;
    }

    enabled = true;
    document.body.dataset.dashboardUiPatch = "adviser-osas";
    applyDashboardEnhancements();
    return true;
  }

  function applyDashboardEnhancements() {
    if (!enabled) return;

    const heading = [...dashboardRoot.querySelectorAll(".admin-section-heading h2")]
      .find((element) => element.textContent.trim().toLowerCase() === "event submissions");
    const section = heading?.closest(".admin-section");
    section?.querySelector(".admin-section-description")?.remove();

    if (!defaultsApplied) applyDefaultFilters();
    sortScheduleRows();
  }

  function applyDefaultFilters() {
    const status = dashboardRoot.querySelector("#dashboardStatusFilter");
    const organization = dashboardRoot.querySelector("#dashboardOrganizationFilter");
    const schedule = dashboardRoot.querySelector("#dashboardScheduleSort");
    if (!status || !organization || !schedule) return;

    const pendingOption = ensurePendingOption(status);
    if (defaultsApplied) {
      status.value = selectedStatus;
      return;
    }

    defaultsApplied = true;
    selectedStatus = pendingOption.value;
    status.value = selectedStatus;
    organization.value = "";
    schedule.value = "asc";
    [status, organization, schedule].forEach((select) => {
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function ensurePendingOption(status) {
    const pendingOption = [...status.options].find((option) => {
      const optionValue = normalizedRole(option.value);
      const optionLabel = normalizedRole(option.textContent);
      return optionValue === "pendingapproval" || optionLabel === "pendingapproval";
    });
    if (pendingOption) return pendingOption;

    const option = new Option("Pending Approval", "pending_approval");
    status.add(option);
    return option;
  }

  function scheduleDateValue(value) {
    const text = String(value || "").trim();
    if (!text) return null;

    const isoDate = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
    if (isoDate) {
      const year = Number(isoDate[1]);
      const month = Number(isoDate[2]);
      const day = Number(isoDate[3]);
      const value = Date.UTC(year, month - 1, day);
      const parsed = new Date(value);
      return parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
        ? value
        : null;
    }

    const parsedTime = Date.parse(text);
    if (!Number.isFinite(parsedTime)) return null;
    const parsedDate = new Date(parsedTime);
    return Date.UTC(
      parsedDate.getFullYear(),
      parsedDate.getMonth(),
      parsedDate.getDate(),
    );
  }

  function scheduleStartMinutes(value) {
    const match = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i.exec(String(value || ""));
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2] || 0);
    const period = match[3]?.toUpperCase();
    if (minute > 59) return null;
    if (period) {
      if (hour < 1 || hour > 12) return null;
      return ((hour % 12) + (period === "PM" ? 12 : 0)) * 60 + minute;
    }
    return hour <= 23 ? hour * 60 + minute : null;
  }

  function scheduleValue(row) {
    const schedule = row.querySelector('td[data-label="Schedule"]');
    if (!schedule) return null;

    const dateText =
      schedule.dataset.scheduleDate ||
      row.dataset.scheduleDate ||
      [...schedule.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .filter(Boolean)
        .join(" ");
    const date = scheduleDateValue(dateText);
    if (date === null) return null;

    const timeText =
      schedule.dataset.startTime ||
      row.dataset.startTime ||
      schedule.querySelector("small")?.textContent?.trim() ||
      "";
    const minutes = scheduleStartMinutes(timeText);
    return date + (minutes ?? 0) * 60000;
  }

  function sortScheduleRows() {
    if (sortingRows) return;
    const rows = dashboardRoot.querySelector("#eventRows");
    if (!rows || rows.children.length < 2) return;

    const direction =
      dashboardRoot.querySelector("#dashboardScheduleSort")?.value === "desc" ? -1 : 1;
    const currentRows = [...rows.children];
    const sortedRows = currentRows
      .map((row, index) => ({ row, index, value: scheduleValue(row) }))
      .sort((first, second) => {
        const firstValid = Number.isFinite(first.value);
        const secondValid = Number.isFinite(second.value);
        if (firstValid !== secondValid) return firstValid ? -1 : 1;
        if (!firstValid) return first.index - second.index;
        return (first.value - second.value) * direction || first.index - second.index;
      })
      .map(({ row }) => row);
    if (sortedRows.every((row, index) => row === currentRows[index])) return;

    sortingRows = true;
    try {
      rows.append(...sortedRows);
    } finally {
      sortingRows = false;
    }
  }

  const observer = new MutationObserver(() => {
    if (!enabled) {
      enableForAllowedRole();
      return;
    }
    applyDashboardEnhancements();
  });
  observer.observe(roleElement, { childList: true, characterData: true, subtree: true });
  observer.observe(dashboardRoot, { childList: true, subtree: true });
  dashboardRoot.addEventListener("change", (event) => {
    if (event.target instanceof HTMLSelectElement && event.target.id === "dashboardStatusFilter") {
      selectedStatus = event.target.value;
    }
  });
  enableForAllowedRole();
})();
