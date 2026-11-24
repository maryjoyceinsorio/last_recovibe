(() => {
  "use strict";

  function initializeCalendarPatch() {
    const calendarContainer = document.getElementById("calendarRoot");
    if (!calendarContainer) return;

    const normalize = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    let settleTimer = 0;
    let observerTimeout = 0;
    let updateTimer = 0;
    let pageReady = false;
    let stopped = false;
    let updating = false;
    let observer;

    function updateCalendarUi() {
      if (updating) return false;
      updating = true;
      try {
        const activeRole = normalize(document.querySelector("[data-role]")?.textContent);
        const manageButton = calendarContainer.querySelector("#manageAcademicCalendar");
        const shouldHideManageButton = activeRole !== "osas";
        if (manageButton && manageButton.hidden !== shouldHideManageButton) {
          manageButton.hidden = shouldHideManageButton;
        }

        const categoryPanel = calendarContainer.querySelector(".admin-filter-panel");
        categoryPanel?.querySelectorAll(".admin-filter-option").forEach((row) => {
          const category = row.querySelector("[data-calendar-category]")?.dataset.calendarCategory
            || row.querySelector("span")?.textContent;
          if (normalize(category) === "officialdate" && !row.hidden) row.hidden = true;
        });

        return Boolean(
          activeRole
          && calendarContainer.querySelector("#goToday")
          && calendarContainer.querySelector("#previousMonth")
          && calendarContainer.querySelector("#nextMonth")
          && categoryPanel,
        );
      } finally {
        updating = false;
      }
    }

    function stopObserving() {
      if (stopped) return;
      stopped = true;
      observer?.disconnect();
      window.clearTimeout(settleTimer);
      window.clearTimeout(observerTimeout);
      window.clearTimeout(updateTimer);
      window.removeEventListener("page-data-ready", handlePageReady);
    }

    function scheduleStopIfSettled() {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        if (updateCalendarUi()) stopObserving();
      }, 250);
    }

    function handlePageReady() {
      pageReady = true;
      updateCalendarUi();
      observeCurrentUiContainers();
      scheduleStopIfSettled();
    }

    function observeCurrentUiContainers() {
      observer.disconnect();
      [
        calendarContainer.querySelector(".admin-calendar-navigation"),
        calendarContainer.querySelector(".admin-filter-panel"),
      ].filter(Boolean).forEach((container) => {
        observer.observe(container, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
    }

    observer = new MutationObserver(() => {
      window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(() => {
        updateTimer = 0;
        updateCalendarUi();
        if (pageReady) scheduleStopIfSettled();
      }, 50);
    });
    observeCurrentUiContainers();

    updateCalendarUi();
    const layout = calendarContainer.querySelector("#calendarLayout");
    if (layout && !layout.hidden && document.querySelector("[data-role]")?.textContent.trim()) {
      pageReady = true;
      scheduleStopIfSettled();
    }
    window.addEventListener("page-data-ready", handlePageReady, { once: true });
    observerTimeout = window.setTimeout(stopObserving, 10000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeCalendarPatch, { once: true });
  } else {
    initializeCalendarPatch();
  }
})();
