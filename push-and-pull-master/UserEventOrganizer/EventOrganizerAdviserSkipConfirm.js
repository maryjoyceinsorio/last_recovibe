let confirmedCheckbox = null;

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

function confirmAdviserSkip(checkbox, event) {
  if (checkbox.disabled) return false;
  if (!window.confirm("Are you sure you want to skip Organization Adviser Review?")) {
    event.stopImmediatePropagation();
    event.preventDefault();
    checkbox.checked = true;
    return false;
  }
  return true;
}

document.addEventListener(
  "click",
  (event) => {
    const checkbox = getAdviserCheckbox(event.target);
    if (!checkbox || !checkbox.checked) return;
    if (confirmedCheckbox === checkbox) {
      if (event.target === checkbox) event.stopPropagation();
      return;
    }
    if (!confirmAdviserSkip(checkbox, event)) return;

    confirmedCheckbox = checkbox;
    window.setTimeout(() => {
      if (confirmedCheckbox === checkbox) confirmedCheckbox = null;
    }, 0);

    if (event.target === checkbox) event.stopPropagation();
  },
  true,
);

document.addEventListener(
  "change",
  (event) => {
    const checkbox = getAdviserCheckbox(event.target);
    if (!checkbox || checkbox.disabled || checkbox.checked) return;
    if (confirmedCheckbox === checkbox) {
      confirmedCheckbox = null;
      return;
    }
    confirmAdviserSkip(checkbox, event);
  },
  true,
);
