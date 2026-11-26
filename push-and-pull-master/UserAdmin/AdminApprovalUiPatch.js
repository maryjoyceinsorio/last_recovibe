(() => {
  "use strict";

  const root = document.getElementById("approvalRoot");
  if (!root) return;

  const pageSize = 6;
  let visibleReviewedCount = pageSize;
  let reviewedQuery = "";
  let syncingReviewedControls = false;
  let allowDisapproveClick = false;
  let acceptDisapproveConfirm = false;
  let previouslyFocusedElement = null;

  const replacements = [
    [/\brejections\b/gi, "disapprovals"],
    [/\brejection\b/gi, "disapproval"],
    [/\brejecting\b/gi, "disapproving"],
    [/\brejected\b/gi, "disapproved"],
    [/\breject\b/gi, "disapprove"],
  ];

  function replaceTerminology(value) {
    let result = value;
    replacements.forEach(([pattern, replacement]) => {
      result = result.replace(pattern, (match) => {
        if (match === match.toUpperCase()) return replacement.toUpperCase();
        if (match[0] === match[0].toUpperCase()) {
          return replacement[0].toUpperCase() + replacement.slice(1);
        }
        return replacement;
      });
    });
    return result;
  }

  function updateVisibleTerminology(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest("script, style, textarea, input, select, option")) continue;
      const updated = replaceTerminology(node.nodeValue);
      if (updated !== node.nodeValue) node.nodeValue = updated;
    }

    container.querySelectorAll("[aria-label], [title], [placeholder]").forEach((element) => {
      ["aria-label", "title", "placeholder"].forEach((attribute) => {
        const value = element.getAttribute(attribute);
        if (value) element.setAttribute(attribute, replaceTerminology(value));
      });
    });
  }

  function cleanupReviewScreen() {
    root.querySelectorAll(".review-header-card > small, .queue-card small").forEach((element) => {
      if (/adviser step skipped by organizer/i.test(element.textContent)) element.remove();
    });

    root.querySelectorAll(".not-waiting-notice").forEach((element) => {
      if (/^approval tracker\b/i.test(element.textContent.trim())) {
        element.dataset.approvalTrackerHelper = "true";
        element.remove();
      }
    });

    root.querySelector(".review-docs-card")?.remove();

    const tracker = root.querySelector(".review-tracker-card");
    if (tracker) {
      tracker.querySelector(".admin-notes-wrap")?.remove();
      tracker.querySelectorAll(".admin-tracker-step").forEach((step) => {
        step.querySelector(".admin-step-num")?.remove();
        step.querySelector(".admin-step-status")?.remove();
      });
    }
  }

  function reviewedCards() {
    return [...root.querySelectorAll(
      ".approval-pipeline-group--reviewed .queue-cards-grid > .queue-card",
    )];
  }

  function applyReviewedControls() {
    if (syncingReviewedControls) return;
    const group = root.querySelector(".approval-pipeline-group--reviewed");
    const cardsGrid = group?.querySelector(".queue-cards-grid");
    if (!group || !cardsGrid) return;

    syncingReviewedControls = true;
    try {
      let controls = group.querySelector(".reviewed-by-you-controls");
      if (!controls) {
        controls = document.createElement("div");
        controls.className = "reviewed-by-you-controls";
        controls.innerHTML = `
          <input class="reviewed-by-you-search" type="search" aria-label="Search reviewed proposals" placeholder="Search reviewed proposals" />`;
        group.insertBefore(controls, cardsGrid);
      }

      const search = controls.querySelector(".reviewed-by-you-search");
      let more = group.querySelector(".reviewed-by-you-more");
      if (!more) {
        more = document.createElement("button");
        more.className = "reviewed-by-you-more";
        more.type = "button";
        more.textContent = "Load More";
      }
      if (more.parentElement !== group || more.previousElementSibling !== cardsGrid) {
        cardsGrid.after(more);
      }
      if (search && search.value !== reviewedQuery) search.value = reviewedQuery;
      const query = reviewedQuery.trim().toLocaleLowerCase();
      const allCards = reviewedCards();
      const visibleCards = allCards.filter((card) =>
        !query || card.textContent.toLocaleLowerCase().includes(query),
      );
      const visibleLimit = query ? visibleCards.length : visibleReviewedCount;
      const displayedCards = new Set(visibleCards.slice(0, visibleLimit));
      allCards.forEach((card) => {
        card.hidden = !displayedCards.has(card);
      });
      const countBadge = group.querySelector(".approval-pipeline-count");
      const countText = String(query ? visibleCards.length : allCards.length);
      if (countBadge && countBadge.textContent !== countText) countBadge.textContent = countText;

      let empty = group.querySelector(".reviewed-by-you-empty");
      if (visibleCards.length === 0 && allCards.length) {
        if (!empty) {
          empty = document.createElement("div");
          empty.className = "reviewed-by-you-empty";
          empty.setAttribute("role", "status");
          empty.textContent = "No reviewed proposals match your search.";
          controls.after(empty);
        }
      } else {
        empty?.remove();
      }

      more.hidden = Boolean(query) || visibleCards.length <= visibleReviewedCount;
      more.disabled = false;
    } finally {
      syncingReviewedControls = false;
    }
  }

  function createDisapproveConfirmation() {
    let overlay = document.getElementById("reviewDisapproveConfirm");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "reviewDisapproveConfirm";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="review-disapprove-backdrop" data-cancel-disapprove></div>
      <section class="review-disapprove-dialog" role="dialog" aria-modal="true" aria-labelledby="reviewDisapproveTitle" aria-describedby="reviewDisapproveMessage" tabindex="-1">
        <h2 id="reviewDisapproveTitle">Disapprove proposal?</h2>
        <p id="reviewDisapproveMessage">This will record your disapproval of this proposal. Add a note explaining your decision before continuing.</p>
        <div class="review-disapprove-actions">
          <button type="button" data-cancel-disapprove>Cancel</button>
          <button type="button" data-confirm-disapprove>Disapprove</button>
        </div>
      </section>`;
    document.body.appendChild(overlay);

    const close = () => {
      overlay.hidden = true;
      previouslyFocusedElement?.focus({ preventScroll: true });
    };
    const cancelButtons = overlay.querySelectorAll("[data-cancel-disapprove]");
    cancelButtons.forEach((button) => button.addEventListener("click", close));
    overlay.querySelector("[data-confirm-disapprove]").addEventListener("click", () => {
      const button = root.querySelector("#btnReject");
      if (!button) {
        close();
        return;
      }
      close();
      allowDisapproveClick = true;
      acceptDisapproveConfirm = true;
      button.click();
      allowDisapproveClick = false;
      window.setTimeout(() => {
        acceptDisapproveConfirm = false;
      }, 0);
    });
    document.addEventListener("keydown", (event) => {
      if (overlay.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") {
        const buttons = [...overlay.querySelectorAll("button:not(:disabled)")];
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault();
          buttons[buttons.length - 1]?.focus();
        } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
          event.preventDefault();
          buttons[0]?.focus();
        }
      }
    });
    return overlay;
  }

  const nativeConfirm = window.confirm.bind(window);
  window.confirm = (message) => {
    if (acceptDisapproveConfirm && /\b(reject|disapprove)\b/i.test(String(message))) {
      acceptDisapproveConfirm = false;
      return true;
    }
    return nativeConfirm(message);
  };

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element
      ? event.target.closest("#btnReject")
      : null;
    if (!target || !root.contains(target) || allowDisapproveClick) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const note = root.querySelector("#decisionNote");
    if ((note?.value || "").trim().length < 3) {
      const error = root.querySelector("#decisionError");
      if (error) {
        error.textContent = "Please enter a note of at least 3 characters explaining your decision to the organizer.";
        error.hidden = false;
      }
      note?.focus();
      return;
    }

    previouslyFocusedElement = target;
    const overlay = createDisapproveConfirmation();
    overlay.hidden = false;
    overlay.querySelector("[data-confirm-disapprove]")?.focus();
  }, true);

  root.addEventListener("input", (event) => {
    if (!event.target.matches(".reviewed-by-you-search")) return;
    reviewedQuery = event.target.value;
    applyReviewedControls();
  });

  root.addEventListener("click", (event) => {
    const button = event.target instanceof Element
      ? event.target.closest(".reviewed-by-you-more")
      : null;
    if (!button) return;

    const before = window.scrollY;
    visibleReviewedCount += pageSize;
    applyReviewedControls();
    window.requestAnimationFrame(() => window.scrollTo({ top: before, behavior: "auto" }));
  });

  const observer = new MutationObserver(() => {
    updateVisibleTerminology(root);
    cleanupReviewScreen();
    applyReviewedControls();
  });
  observer.observe(root, { childList: true, subtree: true });
  updateVisibleTerminology(root);
  cleanupReviewScreen();
  applyReviewedControls();
})();
