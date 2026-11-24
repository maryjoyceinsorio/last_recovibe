(() => {
  "use strict";

  const root = document.getElementById("createEventRoot");
  if (!root) return;

  const compositeSeparator = " + ";
  const originalVenueDescriptors = new Map();
  const activeCompositeValues = new Set();
  let selectedVenues = [];
  let currentForm = null;
  let currentSelect = null;
  let picker = null;
  let refreshQueued = false;
  let isApplyingSelection = false;
  let isDisposed = false;
  let autoCapacityValue = "";
  let observer = null;
  let submissionVenueBaseValue = "";
  let submissionVenueDisplayValue = "";
  let confirmationModalObserver = null;

  const venueCapacities = new Map([
    ["Open Field | PUP Biñan", 1000],
    ["AVR1 | PUP Biñan", 50],
    ["AVR2 | PUP Biñan", 50],
    ["AVR2-1Room | PUP Biñan", 60],
    ["AVR2-2Room | PUP Biñan", 60],
    ["AVR2-3Room | PUP Biñan", 60],
    ["Kiosk | PUP Biñan", 50],
    ["Open Field | PUP CITE", 500],
    ["4th Floor | PUP CITE", 200],
    ["Others | Outside PUP", 200],
    ["Online / Virtual", 1000],
  ]);
  const venueTypes = new Map([
    ["Open Field | PUP Biñan", "outdoor"],
    ["AVR1 | PUP Biñan", "indoor"],
    ["AVR2 | PUP Biñan", "indoor"],
    ["AVR2-1Room | PUP Biñan", "indoor"],
    ["AVR2-2Room | PUP Biñan", "indoor"],
    ["AVR2-3Room | PUP Biñan", "indoor"],
    ["Kiosk | PUP Biñan", "outdoor"],
    ["Open Field | PUP CITE", "outdoor"],
    ["4th Floor | PUP CITE", "indoor"],
    ["Others | Inside PUP", "indoor"],
    ["Others | Outside PUP", "outdoor"],
    ["Online / Virtual", "online"],
  ]);

  const style = document.createElement("style");
  style.textContent = `
    .ce-native-venue-select {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: -1px !important;
      overflow: hidden !important;
      clip: rect(0, 0, 0, 0) !important;
      white-space: nowrap !important;
      border: 0 !important;
    }
    .ce-multi-venue-picker {
      position: relative;
      display: block;
      min-width: 0;
      min-inline-size: 0;
      width: 100%;
      margin: 0 0 12px;
    }
    .ce-multi-venue-trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      width: 100%;
      min-width: 0;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid #b9aaa5;
      border-radius: 8px;
      background: #fff;
      color: #241a17;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .ce-multi-venue-trigger:focus-visible {
      outline: 2px solid #7a1d32;
      outline-offset: 2px;
    }
    .ce-multi-venue-trigger::after {
      flex: 0 0 auto;
      width: 8px;
      height: 8px;
      border-right: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      content: "";
      transform: rotate(45deg) translateY(-2px);
      transition: transform 120ms ease;
    }
    .ce-multi-venue-trigger[aria-expanded="true"]::after {
      transform: rotate(225deg) translate(-2px, -1px);
    }
    .ce-multi-venue-summary {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ce-multi-venue-menu {
      position: absolute;
      z-index: 1000;
      top: calc(100% + 6px);
      right: 0;
      left: 0;
      display: grid;
      gap: 14px;
      max-height: 280px;
      min-width: 0;
      padding: 8px;
      overflow-y: auto;
      overscroll-behavior: contain;
      border: 1px solid #d4cabb;
      border-radius: 10px;
      background: #fff;
      box-shadow: 0 10px 25px rgb(0 0 0 / 14%);
      box-sizing: border-box;
    }
    .ce-multi-venue-menu[hidden] {
      display: none !important;
    }
    #wrap-venue {
      grid-column: 1 / -1;
      width: 100%;
      min-width: 0;
    }
    .ce-multi-venue-group {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 2px;
      min-width: 0;
      padding-bottom: 8px;
      border-bottom: 1px solid #eee8e5;
    }
    .ce-multi-venue-group:last-child {
      padding-bottom: 0;
      border-bottom: 0;
    }
    .ce-multi-venue-group-title {
      grid-column: 1 / -1;
      padding: 3px 12px 4px;
      color: #675b57;
      font-size: .78rem;
      font-weight: 700;
      letter-spacing: .02em;
    }
    .ce-multi-venue-option {
      display: flex !important;
      align-items: center;
      gap: 10px;
      width: 100%;
      max-width: 100%;
      min-width: 0;
      box-sizing: border-box;
      padding: 10px 12px !important;
      border: 0 !important;
      border-radius: 8px;
      background: transparent;
      color: #241a17;
      font-size: 13.5px;
      user-select: none;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .ce-multi-venue-option:hover,
    .ce-multi-venue-option:focus-within,
    .ce-multi-venue-option.is-selected {
      background: #fdf5e6;
    }
    .ce-multi-venue-option span {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .ce-multi-venue-option input {
      flex: 0 0 17px;
      margin: 0;
      width: 17px;
      height: 17px;
      accent-color: #701219;
    }
  `;
  document.head.append(style);

  function getRoomNumbers() {
    const stored = document.getElementById("insidePupRoomNumbersState")?.value || "";
    const chips = Array.from(root.querySelectorAll(
      "#wrap-customVenueAddress .ce-chips-list .ce-chip-name",
    ), (chip) => chip.textContent.trim());
    const pending = document.getElementById("insidePupRoomInput")?.value || "";
    return [...new Set(`${stored},${chips.join(",")},${pending}`
      .split(/[,\s]+/)
      .map((room) => room.trim())
      .filter((room) => /^\d{1,3}$/.test(room)))];
  }

  function limitForVenue(venue) {
    if (venue === "Others | Inside PUP") {
      return Math.max(1, getRoomNumbers().length) * 60;
    }
    if (venueCapacities.has(venue)) return venueCapacities.get(venue);
    if (/Room\b/i.test(venue)) return 60;
    return 0;
  }

  function capacityLimit(venues = selectedVenues) {
    return venues.reduce((total, venue) => total + limitForVenue(venue), 0);
  }

  function combinedType(venues = selectedVenues) {
    const types = new Set(venues.map((venue) => venueTypes.get(venue)).filter(Boolean));
    if (types.size === 1) return [...types][0];
    return types.size > 1 ? "mixed" : "";
  }

  function combinedTypeDisplay() {
    const types = new Set(selectedVenues.map((venue) => venueTypes.get(venue)).filter(Boolean));
    if (types.size < 2) return "";
    return [
      types.has("indoor") ? "Inside" : "",
      types.has("outdoor") ? "Outside" : "",
      types.has("online") ? "Online" : "",
    ].filter(Boolean).join(" & ");
  }

  function exposeCompositeVenue(value) {
    if (!value || activeCompositeValues.has(value)) return;
    if (!originalVenueDescriptors.has(value)) {
      originalVenueDescriptors.set(value, Object.getOwnPropertyDescriptor(Object.prototype, value));
    }
    Object.defineProperty(Object.prototype, value, {
      configurable: true,
      get() {
        return {
          maxCapacity: capacityLimit(selectedVenues),
          type: combinedType(selectedVenues),
        };
      },
    });
    activeCompositeValues.add(value);
  }

  function releaseCompositeVenue(value) {
    if (!activeCompositeValues.has(value)) return;
    const previous = originalVenueDescriptors.get(value);
    if (previous) Object.defineProperty(Object.prototype, value, previous);
    else delete Object.prototype[value];
    activeCompositeValues.delete(value);
    originalVenueDescriptors.delete(value);
  }

  function removeCompositeVenues() {
    [...activeCompositeValues].forEach(releaseCompositeVenue);
  }

  function restoreSubmissionVenueValue() {
    if (!submissionVenueDisplayValue) return;
    if (currentSelect?.value === submissionVenueDisplayValue) {
      currentSelect.value = submissionVenueBaseValue;
    }
    releaseCompositeVenue(submissionVenueDisplayValue);
    Array.from(currentSelect?.options || [])
      .find((option) => option.value === submissionVenueDisplayValue &&
        option.dataset.multiVenueComposite === "true")
      ?.remove();
    submissionVenueBaseValue = "";
    submissionVenueDisplayValue = "";
  }

  function observeConfirmationModal() {
    confirmationModalObserver?.disconnect();
    const modal = root.querySelector("#ceConfirmModal");
    if (!modal) return;
    confirmationModalObserver = new MutationObserver(() => {
      if (modal.hidden) restoreSubmissionVenueValue();
    });
    confirmationModalObserver.observe(modal, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  }

  function venueOptions(select) {
    return Array.from(select.options)
      .filter((option) => option.value && option.dataset.multiVenueComposite !== "true")
      .map((option) => ({
        value: option.value,
        label: `${option.value} (Max: ${limitForVenue(option.value)})`,
        group: option.parentElement instanceof HTMLOptGroupElement
          ? option.parentElement.label
          : "Venues",
      }));
  }

  function hasOutsideLocationVenue() {
    return selectedVenues.some((venue) =>
      venue === "Others | Outside PUP" || venue === "Online / Virtual",
    );
  }

  function hasInsideRoomVenue() {
    return selectedVenues.includes("Others | Inside PUP");
  }

  function renderOutsideLocationControl(form) {
    const addressWrap = form.querySelector("#wrap-customVenueAddress");
    if (!addressWrap || form.querySelector("#outsideVenueLocation")) return;
    const wrapper = document.createElement("div");
    wrapper.id = "wrap-outsideVenueLocation";
    wrapper.className = "ce-field ce-field--full";
    wrapper.hidden = true;

    const label = document.createElement("label");
    label.htmlFor = "outsideVenueLocation";
    const requiredMark = document.createElement("span");
    requiredMark.className = "ce-req";
    requiredMark.textContent = "*";
    label.append(document.createTextNode("Outside Venue / Location "), requiredMark);

    const input = document.createElement("input");
    input.id = "outsideVenueLocation";
    input.name = "outsideVenueLocation";
    input.type = "text";
    input.autocomplete = "off";
    input.setAttribute("aria-describedby", "error-outsideVenueLocation");

    const error = document.createElement("p");
    error.id = "error-outsideVenueLocation";
    error.className = "ce-error";
    error.hidden = true;
    wrapper.append(label, input, error);
    addressWrap.insertAdjacentElement("afterend", wrapper);
  }

  function updateOutsideLocationControl() {
    const wrapper = currentForm?.querySelector("#wrap-outsideVenueLocation");
    const input = currentForm?.querySelector("#outsideVenueLocation");
    if (!wrapper || !input) return;
    const hasOutsideVenue = selectedVenues.includes("Others | Outside PUP");
    const hasOnlineVenue = selectedVenues.includes("Online / Virtual");
    const isRequired = hasOutsideVenue || hasOnlineVenue;
    const label = wrapper.querySelector("label");
    const requiredMark = label?.querySelector(".ce-req");
    if (label && requiredMark) {
      const labelText = hasOutsideVenue && hasOnlineVenue
        ? "Outside Venue / Location or Online Link"
        : hasOutsideVenue
          ? "Outside Venue / Location"
          : "Online Venue / Link";
      if (label.firstChild?.textContent !== `${labelText} `) {
        label.replaceChildren(document.createTextNode(`${labelText} `), requiredMark);
      }
    }
    if (wrapper.hidden === isRequired) wrapper.hidden = !isRequired;
    if (input.required !== isRequired) input.required = isRequired;
    const placeholder = hasOutsideVenue && hasOnlineVenue
      ? "Enter the outside location or online meeting link"
      : hasOutsideVenue
        ? "Enter the outside venue name or address"
        : "Paste the online meeting link";
    if (input.placeholder !== placeholder) input.placeholder = placeholder;
    if (isRequired && !input.value && input.dataset.userEdited !== "true") {
      const reusedValue = hasOnlineVenue
        ? currentForm.querySelector("#onlineMeetingLink")?.value.trim()
        : !hasInsideRoomVenue()
          ? currentForm.querySelector("#customVenueAddress")?.value.trim() ||
            currentForm.querySelector("#customVenueName")?.value.trim()
          : "";
      if (reusedValue) input.value = reusedValue;
    }

    const customNameWrap = currentForm.querySelector("#wrap-customVenueName");
    const customAddressWrap = currentForm.querySelector("#wrap-customVenueAddress");
    if (hasOutsideVenue && !hasInsideRoomVenue()) {
      [customNameWrap, customAddressWrap].forEach((field) => {
        if (field) {
          if (!field.hidden) field.hidden = true;
          if (field.style.display !== "none") field.style.display = "none";
        }
      });
    }
    if (hasOnlineVenue) {
      const onlineLinkWrap = currentForm.querySelector("#wrap-onlineMeetingLink");
      if (onlineLinkWrap) {
        if (!onlineLinkWrap.hidden) onlineLinkWrap.hidden = true;
        if (onlineLinkWrap.style.display !== "none") onlineLinkWrap.style.display = "none";
      }
    }

    if (!isRequired) {
      const error = currentForm.querySelector("#error-outsideVenueLocation");
      if (error) {
        if (error.textContent) error.textContent = "";
        if (!error.hidden) error.hidden = true;
      }
      input.setAttribute("aria-invalid", "false");
    }
  }

  function validateOutsideLocation() {
    updateOutsideLocationControl();
    const input = currentForm?.querySelector("#outsideVenueLocation");
    const error = currentForm?.querySelector("#error-outsideVenueLocation");
    if (!hasOutsideLocationVenue()) return true;
    if (input?.value.trim()) {
      if (error) {
        error.textContent = "";
        error.hidden = true;
      }
      input.setAttribute("aria-invalid", "false");
      return true;
    }
    if (error) {
      error.textContent = "Enter the outside venue location or online link.";
      error.hidden = false;
    }
    input?.setAttribute("aria-invalid", "true");
    input?.focus();
    return false;
  }

  function prepareLegacyOutsideFields() {
    const location = currentForm?.querySelector("#outsideVenueLocation")?.value.trim() || "";
    if (!location) return;
    if (selectedVenues.includes("Others | Outside PUP") && !hasInsideRoomVenue()) {
      const name = currentForm.querySelector("#customVenueName");
      const address = currentForm.querySelector("#customVenueAddress");
      if (name) name.value = location;
      if (address) address.value = location;
    }
    if (selectedVenues.includes("Online / Virtual")) {
      const link = currentForm.querySelector("#onlineMeetingLink");
      if (link) link.value = location;
    }
  }

  function prepareSubmissionVenueValue() {
    if (!hasOutsideLocationVenue() || !currentSelect) return;
    const display = getVenueDisplay();
    if (!display || display === currentSelect.value) return;
    submissionVenueBaseValue = currentSelect.value;
    submissionVenueDisplayValue = display;
    let option = Array.from(currentSelect.options).find(
      (candidate) => candidate.value === display,
    );
    if (!option) {
      option = document.createElement("option");
      option.value = display;
      option.dataset.multiVenueComposite = "true";
      option.textContent = display;
      currentSelect.append(option);
    }
    exposeCompositeVenue(display);
    currentSelect.value = display;
    queueMicrotask(() => {
      const modal = root.querySelector("#ceConfirmModal");
      if (!modal || modal.hidden) restoreSubmissionVenueValue();
    });
  }

  function renderPicker(select) {
    const wrap = select.closest("#wrap-venue");
    if (!wrap) return;
    picker?.remove();

    picker = document.createElement("div");
    picker.className = "ce-multi-venue-picker";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.id = "createEventVenueTrigger";
    trigger.className = "ce-multi-venue-trigger";
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-controls", "createEventVenueOptions");
    trigger.setAttribute("aria-describedby", "error-venue");
    const summary = document.createElement("span");
    summary.className = "ce-multi-venue-summary";
    trigger.append(summary);
    const venueLabel = wrap.querySelector('label[for="venue"]');
    if (venueLabel) venueLabel.htmlFor = trigger.id;

    const menu = document.createElement("div");
    menu.id = "createEventVenueOptions";
    menu.className = "ce-multi-venue-menu";
    menu.setAttribute("role", "group");
    menu.setAttribute("aria-label", "Venue options");
    menu.hidden = true;
    trigger.addEventListener("click", () => {
      const isOpening = menu.hidden;
      menu.hidden = !isOpening;
      trigger.setAttribute("aria-expanded", String(isOpening));
    });

    const grouped = new Map();
    venueOptions(select).forEach((option) => {
      if (!grouped.has(option.group)) grouped.set(option.group, []);
      grouped.get(option.group).push(option);
    });
    grouped.forEach((options, groupName) => {
      const group = document.createElement("div");
      group.className = "ce-multi-venue-group";
      const heading = document.createElement("span");
      heading.className = "ce-multi-venue-group-title";
      heading.textContent = /^others?$/i.test(groupName.trim()) ? "Other" : groupName;
      group.append(heading);
      options.forEach((option) => {
        const label = document.createElement("label");
        label.className = "ce-cat-item ce-multi-venue-option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = option.value;
        checkbox.checked = selectedVenues.includes(option.value);
        checkbox.dataset.multiVenue = "true";
        const text = document.createElement("span");
        text.textContent = option.label;
        label.append(checkbox, text);
        group.append(label);
      });
      menu.append(group);
    });

    picker.append(trigger, menu);
    select.classList.add("ce-native-venue-select");
    select.setAttribute("aria-hidden", "true");
    select.tabIndex = -1;
    wrap.insertBefore(picker, select);
    syncPickerState();
  }

  function originalVenue(value) {
    if (!value) return "";
    const options = Array.from(currentSelect?.options || []);
    const option = options.find((candidate) => candidate.value === value);
    if (option && option.dataset.multiVenueComposite !== "true") return value;
    return options.find((candidate) =>
      candidate.dataset.multiVenueComposite !== "true" &&
      value.startsWith(`${candidate.value} (`),
    )?.value || "";
  }

  function parseCombinedValue(value) {
    if (!value) return [];
    return value.split(compositeSeparator)
      .map((venue) => venue.trim())
      .filter((venue) => Boolean(originalVenue(venue)));
  }

  function syncPickerState() {
    if (!picker) return;
    picker.querySelectorAll("input[data-multi-venue]").forEach((checkbox) => {
      checkbox.checked = selectedVenues.includes(checkbox.value);
      const option = checkbox.closest(".ce-multi-venue-option");
      option?.classList.toggle("is-selected", checkbox.checked);
    });
    const trigger = picker.querySelector(".ce-multi-venue-trigger");
    const summary = picker.querySelector(".ce-multi-venue-summary");
    if (!trigger || !summary) return;
    const selectedNames = selectedVenues.join(", ");
    summary.textContent = selectedVenues.length > 1
      ? `${selectedVenues.length} venues selected`
      : selectedNames || "Select one or more venues";
    trigger.title = selectedNames || "Select one or more venues";
    trigger.setAttribute(
      "aria-label",
      selectedNames ? `Selected venues: ${selectedNames}` : "Select one or more venues",
    );
  }

  function syncSelect() {
    if (!currentSelect || !currentForm) return;
    isApplyingSelection = true;
    try {
      const selected = [...new Set(selectedVenues)];
      selectedVenues = selected;
      let nextValue = selected[0] || "";
      if (selected.length > 1) {
        nextValue = selected.join(compositeSeparator);
        let option = Array.from(currentSelect.options).find(
          (candidate) => candidate.value === nextValue,
        );
        if (!option) {
          option = document.createElement("option");
          option.value = nextValue;
          option.dataset.multiVenueComposite = "true";
          option.textContent = nextValue;
          currentSelect.append(option);
        }
        exposeCompositeVenue(nextValue);
      }
      [...activeCompositeValues]
        .filter((value) => value !== nextValue)
        .forEach(releaseCompositeVenue);

      Array.from(currentSelect.options)
        .filter((option) => option.dataset.multiVenueComposite === "true" &&
          option.value !== nextValue)
        .forEach((option) => option.remove());
      if (currentSelect.value !== nextValue) {
        currentSelect.value = nextValue;
        currentSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      syncPickerState();
      refreshUi();
      window.dispatchEvent(new Event("create-event-multivenue-changed"));
    } finally {
      isApplyingSelection = false;
    }
  }

  function restoreSelectedVenues(draft = {}) {
    const saved = Array.isArray(draft.selectedVenues)
      ? draft.selectedVenues.map(String)
      : parseCombinedValue(String(draft.venue || draft.location || ""));
    if (!saved.length) return false;
    const valid = new Set(venueOptions(currentSelect).map((option) => option.value));
    selectedVenues = saved.filter((venue) => valid.has(venue));
    window.__createEventRestoringDraftVenues = true;
    try {
      syncSelect();
    } finally {
      window.__createEventRestoringDraftVenues = false;
    }
    return selectedVenues.length > 0;
  }

  function getVenueDisplay() {
    if (!selectedVenues.length) return "";
    const descriptions = [...selectedVenues];
    if (selectedVenues.includes("Others | Inside PUP")) {
      const customName = currentForm?.querySelector("#customVenueName")?.value.trim();
      const rooms = getRoomNumbers();
      if (customName && !descriptions.includes(customName)) {
        descriptions[descriptions.indexOf("Others | Inside PUP")] += ` (${customName})`;
      } else if (rooms.length) {
        descriptions[descriptions.indexOf("Others | Inside PUP")] +=
          ` (Rooms: ${rooms.join(", ")})`;
      }
    }
    const outsideLocation = currentForm?.querySelector("#outsideVenueLocation")?.value.trim();
    if (outsideLocation) {
      const outsideIndex = descriptions.findIndex((venue) => venue === "Others | Outside PUP");
      const onlineIndex = descriptions.findIndex((venue) => venue === "Online / Virtual");
      if (outsideIndex >= 0) {
        descriptions[outsideIndex] += ` (Location: ${outsideLocation})`;
      }
      if (onlineIndex >= 0) {
        descriptions[onlineIndex] += ` (Link: ${outsideLocation})`;
      }
    }
    return descriptions.join(compositeSeparator);
  }

  function refreshUi() {
    if (!currentForm || !currentSelect) return;
    updateOutsideLocationControl();
    const limit = capacityLimit();
    const capacity = currentForm.querySelector("#maxCapacity");
    const hint = currentForm.querySelector("#venueCapacityHint");
    const currentValue = capacity?.value || "";
    if (capacity && limit > 0) {
      const shouldUpdateAutomatically = !currentValue ||
        currentValue === capacity.dataset.multiVenueAutoValue ||
        currentValue === autoCapacityValue;
      capacity.disabled = false;
      capacity.max = String(limit);
      if (shouldUpdateAutomatically) {
        capacity.value = String(limit);
        autoCapacityValue = String(limit);
        capacity.dataset.multiVenueAutoValue = autoCapacityValue;
      }
      if (hint) {
        const nextHint = selectedVenues.length > 1
          ? `Combined venue capacity limit: ${limit} attendees.`
          : `Venue maximum capacity: ${limit} attendees.`;
        if (hint.textContent !== nextHint) hint.textContent = nextHint;
      }
    } else if (capacity && !selectedVenues.length) {
      capacity.disabled = true;
      capacity.removeAttribute("max");
      if (capacity.value === capacity.dataset.multiVenueAutoValue ||
          capacity.value === autoCapacityValue) {
        capacity.value = "";
      }
      capacity.dataset.multiVenueAutoValue = "";
      autoCapacityValue = "";
      if (hint && hint.textContent !== "Select one or more venues to view capacity limit.") {
        hint.textContent = "Select one or more venues to view capacity limit.";
      }
    }

    const venueTypeInput = currentForm.querySelector("#weatherContingency");
    const combinedTypeLabel = combinedTypeDisplay();
    if (venueTypeInput && combinedTypeLabel && venueTypeInput.value !== combinedTypeLabel) {
      venueTypeInput.value = combinedTypeLabel;
      venueTypeInput.dispatchEvent(new Event("input", { bubbles: true }));
    }

    const previewVenue = currentForm.querySelector("#previewVenue");
    const venueDisplay = getVenueDisplay();
    if (previewVenue && venueDisplay) {
      if (previewVenue.textContent !== venueDisplay) previewVenue.textContent = venueDisplay;
      if (previewVenue.classList.contains("is-muted")) previewVenue.classList.remove("is-muted");
    }
    const previewCapacity = currentForm.querySelector("#previewCapacity");
    if (previewCapacity) {
      const entered = capacity?.value || "";
      const nextPreview = entered
        ? `Capacity: ${entered} attendees (Combined max: ${limit})`
        : `Capacity not specified (Combined max: ${limit})`;
      if (previewCapacity.textContent !== nextPreview) {
        previewCapacity.textContent = nextPreview;
      }
      previewCapacity.classList.toggle("is-muted", !entered);
    }
    const venueError = currentForm.querySelector("#error-venue");
    if (venueError && selectedVenues.length > 0 &&
        !venueError.textContent.startsWith("Venue conflict")) {
      venueError.textContent = "";
      venueError.hidden = true;
    }
  }

  function savedEvents() {
    const events = [];
    for (const key of ["recovibeOrganizerEvents", "recovibeTeacherEvents"]) {
      try {
        const stored = JSON.parse(localStorage.getItem(key) || "[]");
        if (Array.isArray(stored)) events.push(...stored);
      } catch (error) {
        console.warn(`[CreateEventMultiVenue] Could not read cached events from ${key}:`, error);
      }
    }
    return events;
  }

  function venueTokens(event) {
    const values = Array.isArray(event?.selectedVenues)
      ? event.selectedVenues
      : String(event?.venue || event?.location || "").split(compositeSeparator);
    const venueNames = venueOptions(currentSelect).map((option) => option.value);
    const normalized = values.map((value) => {
      const venue = String(value).trim();
      if (venueNames.includes(venue)) return venue;
      return venueNames.find((name) => venue.startsWith(`${name} (`)) || venue;
    });
    return [...new Set(normalized.filter(Boolean))];
  }

  function eventRooms(event) {
    const structured = event?.venueDetails?.rooms;
    if (Array.isArray(structured) && structured.length) return structured.map(String);
    const name = String(event?.customVenueName || event?.venueName || event?.building || "");
    const match = name.match(/\(Rooms?:\s*([^)]+)\)/i);
    const firstRoom = event?.customVenueAddress || event?.roomNumber || event?.venueAddress || "";
    return [...new Set([
      ...(match ? match[1].split(/[,\s]+/) : []),
      ...(firstRoom ? [String(firstRoom)] : []),
    ].map((room) => room.trim()).filter((room) => /^\d{1,3}$/.test(room)))];
  }

  function minutes(value) {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(value || "").trim());
    if (!match) return null;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    const period = match[3]?.toUpperCase();
    if (minute > 59) return null;
    if (period) {
      if (hour < 1 || hour > 12) return null;
      if (period === "PM" && hour < 12) hour += 12;
      if (period === "AM" && hour === 12) hour = 0;
    } else if (hour > 23) {
      return null;
    }
    return hour * 60 + minute;
  }

  function datesBetween(start, end) {
    if (!start) return [];
    const from = new Date(`${start}T00:00:00Z`);
    const to = new Date(`${end || start}T00:00:00Z`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
    const dates = [];
    while (from <= to && dates.length <= 740) {
      dates.push(from.toISOString().slice(0, 10));
      from.setDate(from.getDate() + 1);
    }
    return dates;
  }

  function eventTimeForDate(event, date) {
    const daily = Array.isArray(event?.dailySchedules)
      ? event.dailySchedules.find((schedule) => String(schedule.date || "").slice(0, 10) === date)
      : null;
    let start = daily?.timeStart || event?.timeStart || event?.startTime || "";
    let end = daily?.timeEnd || event?.timeEnd || event?.endTime || "";
    if ((!start || !end) && event?.time) {
      const parts = String(event.time).split(/\s*[-–]\s*/);
      start ||= parts[0] || "";
      end ||= parts[1] || "";
    }
    return [minutes(start), minutes(end)];
  }

  function overlapConflict(newVenue, date, start, end, roomSet, event) {
    const status = String(event?.status || event?.publicationStatus || "").toLowerCase();
    if (!["approved", "published", "pending", "pending approval", "pending_approval"].includes(status)) {
      return false;
    }
    const eventDate = String(event?.date || event?.dateISO || event?.dateStart || "").slice(0, 10);
    const endDate = String(event?.dateEnd || event?.endDate || eventDate).slice(0, 10);
    if (date < eventDate || date > endDate) return false;
    const [existingStart, existingEnd] = eventTimeForDate(event, date);
    if (start === null || end === null || existingStart === null || existingEnd === null ||
        start >= existingEnd || end <= existingStart) return false;

    const eventVenues = venueTokens(event);
    if (!eventVenues.includes(newVenue)) return false;
    if (newVenue === "Others | Inside PUP") {
      const existingRooms = eventRooms(event);
      if (roomSet.length && existingRooms.length &&
          !roomSet.some((room) => existingRooms.includes(room))) return false;
    }
    return true;
  }

  function findConflict() {
    const form = currentForm;
    if (!form || !selectedVenues.length) return null;
    const rows = form.querySelectorAll("#dailyScheduleList .ce-daily-schedule-row");
    const newSchedules = form.querySelector("#dailySchedule")?.value === "Different time by day"
      ? Array.from(rows, (row) => ({
          date: row.dataset.date,
          start: minutes(row.querySelector(".ce-daily-start-input")?.value),
          end: minutes(row.querySelector(".ce-daily-end-input")?.value),
        }))
      : datesBetween(
          form.querySelector("#eventDate")?.value || "",
          form.querySelector("#eventDateEnd")?.value || form.querySelector("#eventDate")?.value || "",
        ).map((date) => ({
          date,
          start: minutes(form.querySelector("#timeStart")?.value),
          end: minutes(form.querySelector("#timeEnd")?.value),
        }));
    const rooms = getRoomNumbers();
    for (const event of savedEvents()) {
      for (const venue of selectedVenues) {
        if (venue === "Online / Virtual" || venue === "Others | Outside PUP") continue;
        for (const schedule of newSchedules) {
          if (overlapConflict(
            venue,
            schedule.date,
            schedule.start,
            schedule.end,
            venue === "Others | Inside PUP" ? rooms : [],
            event,
          )) return event;
        }
      }
    }
    return null;
  }

  function showConflict(conflict) {
    const error = currentForm?.querySelector("#error-venue");
    if (!error) return;
    error.textContent = conflict
      ? `Venue conflict with "${conflict.title || conflict.eventName || "another event"}" at the selected date and time.`
      : "";
    error.hidden = !conflict;
  }

  function handleSubmission(event) {
    if (!event.target?.closest?.("#btnSubmitApproval")) return;
    refreshUi();
    if (!validateOutsideLocation()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const capacity = currentForm?.querySelector("#maxCapacity");
    const limit = capacityLimit();
    const entered = Number(capacity?.value);
    const conflict = findConflict();
    if (conflict) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showConflict(conflict);
      currentForm?.querySelector("#error-venue")?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
    if (!Number.isInteger(entered) || entered < 1 || entered > limit) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const error = currentForm?.querySelector("#error-maxCapacity");
      if (error) {
        error.textContent = `Capacity must be a whole number from 1 to the combined venue limit of ${limit}.`;
        error.hidden = false;
      }
      capacity?.focus();
      return;
    }
    prepareLegacyOutsideFields();
    prepareSubmissionVenueValue();
  }

  function bindForm(form) {
    if (!form || form === currentForm) return;
    currentForm = form;
    currentSelect = form.querySelector("#venue");
    if (!currentSelect) return;

    selectedVenues = parseCombinedValue(currentSelect.value);
    if (!selectedVenues.length && currentSelect.value) {
      selectedVenues = [currentSelect.value];
    }
    renderOutsideLocationControl(form);
    renderPicker(currentSelect);
    observeConfirmationModal();
    const options = venueOptions(currentSelect);
    const singleValue = currentSelect.value;
    if (selectedVenues.length && !options.some((option) => option.value === singleValue)) {
      syncSelect();
    } else {
      refreshUi();
    }
  }

  function closeVenueMenu() {
    const menu = picker?.querySelector(".ce-multi-venue-menu");
    const trigger = picker?.querySelector(".ce-multi-venue-trigger");
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
  }

  function handleOutsideClick(event) {
    if (picker && !picker.contains(event.target)) closeVenueMenu();
  }

  function handleVenueMenuKeydown(event) {
    if (event.key !== "Escape") return;
    const menu = picker?.querySelector(".ce-multi-venue-menu");
    if (!menu || menu.hidden) return;
    event.preventDefault();
    closeVenueMenu();
    picker?.querySelector(".ce-multi-venue-trigger")?.focus();
  }

  document.addEventListener("click", handleOutsideClick, true);
  document.addEventListener("keydown", handleVenueMenuKeydown, true);

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.matches("[data-multi-venue]") ||
        !picker?.contains(target)) return;
    selectedVenues = target.checked
      ? [...selectedVenues, target.value]
      : selectedVenues.filter((venue) => venue !== target.value);
    syncSelect();
  });

  document.addEventListener("change", (event) => {
    if (isApplyingSelection || !(event.target instanceof HTMLSelectElement) ||
        event.target.id !== "venue" || event.target !== currentSelect) return;
    const parsed = parseCombinedValue(currentSelect.value);
    selectedVenues = parsed.length ? parsed : currentSelect.value ? [currentSelect.value] : [];
    syncSelect();
  });

  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("#createEventMainForm")) return;
    if (target.id === "outsideVenueLocation") {
      if (event.isTrusted) target.dataset.userEdited = "true";
      if (target.value.trim()) {
        const error = currentForm?.querySelector("#error-outsideVenueLocation");
        if (error) {
          error.textContent = "";
          error.hidden = true;
        }
        target.setAttribute("aria-invalid", "false");
      }
    }
    const capacity = currentForm?.querySelector("#maxCapacity");
    if (target.id === "maxCapacity" && capacity &&
        capacity.value !== capacity.dataset.multiVenueAutoValue) {
      capacity.dataset.multiVenueAutoValue = "";
      autoCapacityValue = "";
    }
    queueRefresh();
  }, true);

  document.addEventListener("change", (event) => {
    if (event.target instanceof Element &&
        event.target.closest("#createEventMainForm")) queueRefresh();
  }, true);

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("#createEventMainForm [data-room-index]")) queueRefresh();
  }, true);

  document.addEventListener("click", handleSubmission, true);
  document.addEventListener("submit", (event) => {
    if (event.target instanceof HTMLFormElement &&
        event.target.id === "createEventMainForm") {
      if (!validateOutsideLocation()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      prepareLegacyOutsideFields();
      prepareSubmissionVenueValue();
      const conflict = findConflict();
      if (conflict) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showConflict(conflict);
      }
    }
  }, true);

  function queueRefresh() {
    if (refreshQueued || isDisposed) return;
    refreshQueued = true;
    window.queueMicrotask(() => {
      refreshQueued = false;
      refreshUi();
      window.dispatchEvent(new Event("create-event-multivenue-changed"));
    });
  }

  window.createEventMultiVenue = {
    getSelectedVenues: () => [...selectedVenues],
    getCapacityLimit: () => capacityLimit(),
    getVenueDisplay,
    restore: restoreSelectedVenues,
    refresh: refreshUi,
    validateConflict: findConflict,
    getRoomNumbers,
  };

  window.addEventListener("create-event-draft-hydrated", (event) => {
    if (!currentSelect) return;
    const detail = event instanceof CustomEvent ? event.detail : null;
    restoreSelectedVenues(detail?.draft || {});
    queueRefresh();
  });

  observer = new MutationObserver(() => {
    if (isDisposed) return;
    const form = root.querySelector("#createEventMainForm");
    if (form && form !== currentForm) bindForm(form);
  });
  observer.observe(root, { childList: true });
  bindForm(root.querySelector("#createEventMainForm"));

  window.addEventListener("pagehide", () => {
    isDisposed = true;
    observer?.disconnect();
    confirmationModalObserver?.disconnect();
    restoreSubmissionVenueValue();
    document.removeEventListener("click", handleOutsideClick, true);
    document.removeEventListener("keydown", handleVenueMenuKeydown, true);
    removeCompositeVenues();
    style.remove();
  }, { once: true });
})();
