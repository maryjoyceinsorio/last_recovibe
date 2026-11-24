(() => {
  "use strict";

  const tableBody = document.getElementById("eventTableBody");
  const tracker = document.getElementById("trackerModalOverlay");
  const actionStatus = document.getElementById("myEventsActionStatus");
  let activeTrackerEventId = "";

  tableBody?.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest("tr[data-event-id]");
    if (row && tableBody.contains(row)) {
      activeTrackerEventId = row.dataset.eventId || "";
    }
  }, true);

  function showInternalActionFailure() {
    const message = activeTrackerEventId
      ? `The server couldn't complete this action for event ${activeTrackerEventId}. Refresh My Events and retry; if it continues, contact support.`
      : "The server couldn't complete this action. Refresh My Events and retry; if it continues, contact support.";
    const content = tracker?.querySelector(".tracker-content-scroll");
    if (content && !tracker.hidden) {
      let status = tracker.querySelector("#trackerActionError");
      if (!status) {
        status = document.createElement("p");
        status.id = "trackerActionError";
        status.tabIndex = -1;
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        status.style.cssText = "margin:0 0 16px;padding:12px 14px;border:1px solid #e4a6a6;border-radius:10px;background:#fff2f2;color:#8a1f1f;font-weight:600";
        content.prepend(status);
      }
      status.textContent = message;
      status.hidden = false;
      status.focus();
      return;
    }
    if (actionStatus) {
      actionStatus.textContent = message;
      actionStatus.classList.add("is-error");
      actionStatus.hidden = false;
    }
  }

  const originalAlert = window.alert.bind(window);
  const guardedAlert = (message) => {
    const text = String(message ?? "").trim().toLowerCase()
      .replace(/^firebase:\s*/, "")
      .replace(/^error:?\s*/, "")
      .replace(/[().]/g, "")
      .trim();
    if (["internal", "internal error", "functions/internal", "functions/internal error"]
      .includes(text)) {
      showInternalActionFailure();
      return;
    }
    originalAlert(message);
  };
  window.alert = guardedAlert;

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const button = target?.closest("#btnTrackerEdit");
    if (!button || button.hidden || !tracker || tracker.hidden) return;

    const row = Array.from(tableBody?.querySelectorAll("tr[data-event-id]") || [])
      .find((candidate) => candidate.dataset.eventId === activeTrackerEventId);
    if (!row || row.dataset.draft !== "true") return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const url = new URL("EventOrganizerCreateEvent.html", window.location.href);
    url.searchParams.set("draft", activeTrackerEventId);
    window.location.assign(url.href);
  }, true);

  window.addEventListener("pagehide", () => {
    if (window.alert === guardedAlert) window.alert = originalAlert;
  }, { once: true });
})();
