let pendingSkipCheckbox = null;
let approvedSkipCheckbox = null;
let skipDialog = null;
let skipButton = null;
let keepButton = null;

function getAdviserCheckbox(target) {
  if (!(target instanceof Element)) return null;
  const row = target.closest(".ce-approver-item");
  const checkbox = target.closest(".ce-approver-checkbox") ||
    row?.querySelector(".ce-approver-checkbox");
  if (!(checkbox instanceof HTMLInputElement)) return null;

  const key = (checkbox.dataset.key || checkbox.id.replace(/^approver-/, ""))
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const label = row?.querySelector(".ce-approver-name")?.textContent || "";
  return key === "orgadv" || /organization\s+adviser(?:\s+review)?/i.test(label)
    ? checkbox
    : null;
}

function closeSkipDialog(restoreFocus = true) {
  if (!skipDialog || !pendingSkipCheckbox) return;
  const checkbox = pendingSkipCheckbox;
  pendingSkipCheckbox = null;
  skipDialog.hidden = true;
  document.body.classList.remove("ce-skip-confirm-open");
  if (restoreFocus && checkbox.isConnected) checkbox.focus();
}

function confirmSkip() {
  const checkbox = pendingSkipCheckbox;
  closeSkipDialog(false);
  if (!checkbox?.isConnected || checkbox.disabled || !checkbox.checked) return;

  approvedSkipCheckbox = checkbox;
  checkbox.checked = false;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  checkbox.focus();
}

function cancelSkip() {
  if (pendingSkipCheckbox?.isConnected) pendingSkipCheckbox.checked = true;
  closeSkipDialog();
}

function ensureSkipDialog() {
  if (skipDialog) return;

  skipDialog = document.createElement("div");
  skipDialog.className = "ce-dialog-layer ce-skip-confirm-layer";
  skipDialog.hidden = true;
  skipDialog.innerHTML = `
    <section
      class="ce-confirm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="ceSkipConfirmTitle"
      aria-describedby="ceSkipConfirmMessage"
      tabindex="-1"
    >
      <h2 id="ceSkipConfirmTitle">Skip approval step?</h2>
      <p id="ceSkipConfirmMessage">Are you sure you want to skip Organization Adviser Review?</p>
      <div class="ce-confirm-actions">
        <button type="button" class="ce-btn-primary" data-skip-action="confirm">Skip step</button>
        <button type="button" class="ce-btn-secondary" data-skip-action="cancel">Keep step</button>
      </div>
    </section>
  `;
  document.body.appendChild(skipDialog);

  skipButton = skipDialog.querySelector('[data-skip-action="confirm"]');
  keepButton = skipDialog.querySelector('[data-skip-action="cancel"]');

  skipDialog.addEventListener("click", (event) => {
    if (event.target === skipDialog) {
      cancelSkip();
      return;
    }

    const action = event.target.closest("[data-skip-action]")?.dataset.skipAction;
    if (action === "confirm") confirmSkip();
    if (action === "cancel") cancelSkip();
  });

  skipDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelSkip();
      return;
    }
    if (event.key !== "Tab" || !skipButton || !keepButton) return;

    if (event.shiftKey && document.activeElement === skipButton) {
      event.preventDefault();
      keepButton.focus();
    } else if (!event.shiftKey && document.activeElement === keepButton) {
      event.preventDefault();
      skipButton.focus();
    }
  });
}

function requestSkipConfirmation(checkbox) {
  ensureSkipDialog();
  checkbox.checked = true;
  if (pendingSkipCheckbox) return;

  pendingSkipCheckbox = checkbox;
  skipDialog.hidden = false;
  document.body.classList.add("ce-skip-confirm-open");
  keepButton.focus();
}

document.addEventListener(
  "click",
  (event) => {
    const checkbox = getAdviserCheckbox(event.target);
    if (!checkbox || !checkbox.checked) return;

    event.stopImmediatePropagation();
    event.preventDefault();
    requestSkipConfirmation(checkbox);
  },
  true,
);

document.addEventListener(
  "change",
  (event) => {
    const checkbox = getAdviserCheckbox(event.target);
    if (!checkbox || checkbox.disabled || checkbox.checked) return;
    if (approvedSkipCheckbox === checkbox) {
      approvedSkipCheckbox = null;
      return;
    }

    event.stopImmediatePropagation();
    event.preventDefault();
    requestSkipConfirmation(checkbox);
  },
  true,
);
