(() => {
  "use strict";

  const root = document.getElementById("allEventsRoot");
  if (!root) return;

  const pageUrl = new URL(window.location.href);
  if (pageUrl.searchParams.has("availability")) {
    pageUrl.searchParams.delete("availability");
    history.replaceState(history.state, "", pageUrl);
  }

  let searchHadFocus = false;
  let selectionStart = null;
  let selectionEnd = null;

  function statusFilterLabel() {
    return root.querySelector('[data-filter="status"] > button')?.textContent.trim() || "";
  }

  function ensureDefaultSections() {
    const selectedStatus = statusFilterLabel();
    const toolbar = root.querySelector(".events-toolbar");
    if (!toolbar) return;

    const findSection = (title) => [...root.children].find((element) =>
      element.tagName === "SECTION" &&
      element.querySelector(".admin-group-title")?.textContent.trim() === title,
    );
    let happening = findSection("Happening Now");
    if (!happening) {
      happening = document.createElement("section");
      happening.innerHTML = '<h2 class="admin-group-title">Happening Now</h2><div class="admin-empty">No events happening now.</div>';
    }
    if (toolbar.nextElementSibling !== happening) toolbar.after(happening);
    if (selectedStatus !== "Event Status") return;

    const anchor = happening;
    let upcoming = findSection("Upcoming");
    if (!upcoming) {
      upcoming = document.createElement("section");
      upcoming.innerHTML = '<h2 class="admin-group-title">Upcoming</h2><div class="admin-empty">No upcoming events.</div>';
    } else if (!upcoming.querySelector(".admin-event-grid")?.children.length &&
        !upcoming.querySelector(".admin-empty")) {
      const empty = document.createElement("div");
      empty.className = "admin-empty";
      empty.textContent = "No upcoming events.";
      upcoming.append(empty);
    }
    if (anchor.nextElementSibling !== upcoming) anchor.after(upcoming);

    [...root.children].forEach((section) => {
      if (
        section.tagName === "SECTION" &&
        ["Completed", "Cancelled"].includes(
          section.querySelector(".admin-group-title")?.textContent.trim(),
        )
      ) section.remove();
    });
  }

  function restoreSearchFocus() {
    if (!searchHadFocus) return;
    const search = root.querySelector("#eventSearch");
    if (!search || document.activeElement === search) return;

    search.focus({ preventScroll: true });
    if (selectionStart !== null && selectionEnd !== null) {
      search.setSelectionRange(selectionStart, selectionEnd);
    }
  }

  root.addEventListener("focusin", (event) => {
    if (event.target.matches("#eventSearch")) searchHadFocus = true;
  });
  root.addEventListener("focusout", (event) => {
    if (event.target.matches("#eventSearch") && event.target.isConnected) {
      searchHadFocus = Boolean(event.relatedTarget?.matches("#eventSearch"));
    }
  });
  root.addEventListener("input", (event) => {
    if (!event.target.matches("#eventSearch")) return;
    searchHadFocus = true;
    selectionStart = event.target.selectionStart;
    selectionEnd = event.target.selectionEnd;
  });

  const observer = new MutationObserver(() => {
    root.querySelector('[data-filter="availability"]')?.remove();
    ensureDefaultSections();
    restoreSearchFocus();
  });
  observer.observe(root, { childList: true, subtree: true });
})();
