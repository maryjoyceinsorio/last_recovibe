(() => {
  "use strict";

  const root = document.getElementById("createEventRoot");
  if (!root) return;

  let baselineForm = null;
  let baselineSnapshot = "";
  let userEditedSinceBaseline = false;
  let confirmedDiscard = false;
  let venueUiForm = null;
  let venueUiState = null;
  let isUpdatingVenueControls = false;
  let autoDismissedCleanModal = null;

  function formSnapshot(form) {
    const controls = [...form.querySelectorAll(
      "input, select, textarea, [contenteditable='true'], [aria-pressed], [aria-checked], [data-selected]",
    )];
    return JSON.stringify(controls.map((control) => {
      const files = control instanceof HTMLInputElement && control.type === "file"
        ? [...control.files].map(({ name, size, lastModified }) => [name, size, lastModified])
        : undefined;
      const selectedOptions = control instanceof HTMLSelectElement && control.multiple
        ? [...control.selectedOptions].map((option) => option.value)
        : undefined;
      return {
        id: control.id || "",
        name: control.getAttribute("name") || "",
        type: control.getAttribute("type") || "",
        value: control.isContentEditable ? control.textContent : control.value,
        checked: "checked" in control ? control.checked : undefined,
        files,
        selectedOptions,
        pressed: control.getAttribute("aria-pressed"),
        checkedState: control.getAttribute("aria-checked"),
        selected: control.getAttribute("data-selected"),
        className: control.matches("[aria-pressed], [aria-checked], [data-selected]")
          ? control.className
          : "",
      };
    }));
  }

  function hasChanges() {
    const form = root.querySelector("#createEventMainForm");
    if (!form || form !== baselineForm) return false;
    return formSnapshot(form) !== baselineSnapshot;
  }

  function captureBaseline(form) {
    baselineForm = form;
    baselineSnapshot = formSnapshot(form);
    userEditedSinceBaseline = false;
    confirmedDiscard = false;
  }

  function updateExistingEventsLabels() {
    root.querySelectorAll(".ce-existing-col-title").forEach((heading) => {
      if (heading.textContent.startsWith("Recently Events")) {
        heading.textContent = heading.textContent.replace(
          /^Recently Events/,
          "Recently Created Events",
        );
      }
    });
    const search = root.querySelector("#searchPastEvents");
    if (search) search.placeholder = "Search existing events by name...";
  }

  function mutationTouches(record, selector) {
    const target = record.target instanceof Element
      ? record.target
      : record.target.parentElement;
    if (target && (target.matches(selector) || target.closest(selector))) return true;
    if (record.type !== "childList") return false;
    return [...record.addedNodes, ...record.removedNodes].some((node) => {
      if (node instanceof Element && node.matches(selector)) return true;
      return typeof node.querySelector === "function" && Boolean(node.querySelector(selector));
    });
  }

  function isInsidePup(form) {
    return (form.querySelector("#venue")?.value || "").trim().toLowerCase() === "others | inside pup";
  }

  function createVenueControl(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function addVenueLabel(parent, text, control) {
    const label = createVenueControl("label", "", text);
    label.htmlFor = control.id;
    label.append(" ", createVenueControl("span", "ce-req", "*"));
    parent.append(label);
  }

  function parseRoomNumbers(name, address) {
    const match = name.match(/\(Rooms:\s*([^)]+)\)/i);
    const rooms = match ? match[1].split(/[,\s]+/) : [];
    if (/^\d{1,3}$/.test(address) && !rooms.includes(address)) rooms.unshift(address);
    return [...new Set(rooms.filter((room) => /^\d{1,3}$/.test(room)))];
  }

  function renderRoomTags(state) {
    const renderedRooms = [...state.roomList.children]
      .map((chip) => chip.querySelector(".ce-chip-name")?.textContent || "");
    if (renderedRooms.length === state.rooms.length &&
        renderedRooms.every((room, index) => room === state.rooms[index])) {
      state.roomNumbersState.value = state.rooms.join(",");
      return;
    }
    state.roomList.replaceChildren();
    state.rooms.forEach((room, index) => {
      const chip = createVenueControl("span", "ce-chip");
      chip.append(createVenueControl("span", "ce-chip-name", room));
      const remove = createVenueControl("button", "ce-chip-remove", "×");
      remove.type = "button";
      remove.dataset.roomIndex = String(index);
      remove.setAttribute("aria-label", `Remove room ${room}`);
      chip.append(remove);
      state.roomList.append(chip);
    });
    state.roomNumbersState.value = state.rooms.join(",");
  }

  function readVenueDetails(state) {
    const name = state.legacyName.value.trim();
    const strippedName = name.replace(/\s*\(Rooms:[^)]+\)/i, "").trim();
    state.rooms = parseRoomNumbers(name, state.legacyAddress.value.trim());
    state.legacyBuildingName = "";

    if (/^CITE$/i.test(strippedName) || /^PUP CITE$/i.test(strippedName)) {
      state.campus.value = "CITE";
      state.building.value = "";
    } else {
      state.campus.value = name || state.legacyAddress.value ? "PUP Biñan" : "";
      const building = strippedName.match(/(?:PUP Biñan\s*[—-]\s*)?(Old Building|New Building)$/i);
      if (building) {
        state.building.value = building[1];
      } else {
        state.building.value = "";
        if (strippedName && !/^PUP Biñan$/i.test(strippedName)) {
          state.legacyBuildingName = strippedName;
        }
      }
    }
    renderRoomTags(state);
  }

  function writeLegacyVenueFields(state) {
    if (!isInsidePup(state.form) || state.isSyncingLegacyFields) return;
    state.isSyncingLegacyFields = true;
    try {
      const campus = state.campus.value;
      const building = state.building.value || state.legacyBuildingName;
      const location = campus === "CITE"
        ? "CITE"
        : campus === "PUP Biñan"
          ? ["PUP Biñan", building].filter(Boolean).join(" — ")
          : "";
      const roomDetails = state.rooms.length ? ` (Rooms: ${state.rooms.join(", ")})` : "";
      const nextName = location ? `${location}${roomDetails}` : "";
      const nextAddress = state.rooms[0] || "";

      if (state.legacyName.value !== nextName) {
        state.legacyName.value = nextName;
        state.legacyName.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (state.legacyAddress.value !== nextAddress) {
        state.legacyAddress.value = nextAddress;
        state.legacyAddress.dispatchEvent(new Event("input", { bubbles: true }));
      }
      state.roomNumbersState.value = state.rooms.join(",");
    } finally {
      state.isSyncingLegacyFields = false;
    }
  }

  function updateVenuePreview(state) {
    if (!state || !isInsidePup(state.form)) return;
    const preview = root.querySelector("#previewVenue");
    if (!preview) return;
    const details = [];
    if (state.campus.value) details.push(state.campus.value);
    if (state.campus.value === "PUP Biñan") {
      const building = state.building.value || state.legacyBuildingName;
      if (building) details.push(building);
    }
    if (state.rooms.length) {
      details.push(`Room${state.rooms.length === 1 ? "" : "s"}: ${state.rooms.join(", ")}`);
    }
    const text = details.length
      ? `Others | Inside PUP (${details.join(", ")})`
      : "Others | Inside PUP";
    if (preview.textContent !== text) preview.textContent = text;
    preview.classList.remove("is-muted");
  }

  function showVenueValidation(state) {
    if (!isInsidePup(state.form)) {
      state.validationError.hidden = true;
      return true;
    }
    let message = "";
    let validationTarget = state.roomWrap;
    if (!state.campus.value) message = "Choose PUP Biñan or CITE.";
    else if (state.campus.value === "PUP Biñan" &&
             !state.building.value && !state.legacyBuildingName) {
      message = "Choose Old Building or New Building.";
      validationTarget = state.buildingWrap;
    } else if (!state.rooms.length) {
      message = "Add at least one room number.";
    }
    if (!state.campus.value) validationTarget = state.campusWrap;
    if (state.validationError.parentElement !== validationTarget) {
      validationTarget.append(state.validationError);
    }
    if (state.validationError.textContent !== message) {
      state.validationError.textContent = message;
    }
    state.validationError.hidden = !message;
    return !message;
  }

  function addRoom(state, value) {
    const room = String(value || "").replace(/\D/g, "").slice(0, 3);
    state.roomInput.value = "";
    if (!/^\d{1,3}$/.test(room) || state.rooms.includes(room)) return;
    state.hasInsideState = true;
    state.rooms.push(room);
    renderRoomTags(state);
    writeLegacyVenueFields(state);
    showVenueValidation(state);
    updateVenuePreview(state);
  }

  function createVenueControls(form) {
    const nameWrap = form.querySelector("#wrap-customVenueName");
    const addressWrap = form.querySelector("#wrap-customVenueAddress");
    const legacyName = form.querySelector("#customVenueName");
    const legacyAddress = form.querySelector("#customVenueAddress");
    if (!nameWrap || !addressWrap || !legacyName || !legacyAddress) return null;

    const campusWrap = createVenueControl("div", "ce-field ce-field--full");
    const campus = createVenueControl("select", "");
    campus.id = "insidePupCampus";
    campus.innerHTML = '<option value="">Choose location...</option><option value="PUP Biñan">PUP Biñan</option><option value="CITE">CITE</option>';
    addVenueLabel(campusWrap, "Campus / Location", campus);
    campusWrap.append(campus);

    const buildingWrap = createVenueControl("div", "ce-field ce-field--full");
    const building = createVenueControl("select", "");
    building.id = "insidePupBuilding";
    building.innerHTML = '<option value="">Choose building...</option><option value="Old Building">Old Building</option><option value="New Building">New Building</option>';
    addVenueLabel(buildingWrap, "Building", building);
    buildingWrap.append(building);

    const roomWrap = createVenueControl("div", "ce-field ce-field--full");
    const roomInput = createVenueControl("input", "ce-chip-input");
    roomInput.id = "insidePupRoomInput";
    roomInput.type = "text";
    roomInput.inputMode = "numeric";
    roomInput.autocomplete = "off";
    roomInput.maxLength = 3;
    roomInput.placeholder = "Type a room number and press Enter";
    roomInput.setAttribute("aria-label", "Add room number");
    addVenueLabel(roomWrap, "Room Numbers", roomInput);
    const chipContainer = createVenueControl("div", "ce-chips-container");
    const roomList = createVenueControl("div", "ce-chips-list");
    chipContainer.append(roomList, roomInput);
    roomWrap.append(chipContainer);
    roomWrap.append(createVenueControl(
      "small",
      "ce-hint",
      "Enter each 1–3 digit room number, then press Enter or comma.",
    ));

    const validationError = createVenueControl("p", "ce-error");
    validationError.id = "insidePupVenueError";
    validationError.hidden = true;

    const roomNumbersState = createVenueControl("input");
    roomNumbersState.type = "hidden";
    roomNumbersState.id = "insidePupRoomNumbersState";
    form.append(roomNumbersState);

    const nameLabel = nameWrap.querySelector('label[for="customVenueName"]');
    const addressLabel = addressWrap.querySelector('label[for="customVenueAddress"]');
    nameWrap.insertBefore(campusWrap, nameLabel);
    nameWrap.insertBefore(buildingWrap, nameLabel);
    addressWrap.insertBefore(roomWrap, addressLabel);

    const state = {
      form,
      campus,
      campusWrap,
      building,
      buildingWrap,
      roomWrap,
      roomInput,
      roomList,
      roomNumbersState,
      validationError,
      nameWrap,
      addressWrap,
      nameLabel,
      addressLabel,
      legacyName,
      legacyAddress,
      rooms: [],
      legacyBuildingName: "",
      outsideName: "",
      outsideAddress: "",
      wasInside: false,
      lastVenue: null,
      hasInsideState: false,
      isSyncingLegacyFields: false,
    };

    campus.addEventListener("change", () => {
      state.hasInsideState = true;
      if (state.campus.value !== "PUP Biñan") {
        state.building.value = "";
        state.legacyBuildingName = "";
      } else {
        state.legacyBuildingName = "";
      }
      state.rooms = [];
      state.buildingWrap.hidden = state.campus.value !== "PUP Biñan";
      state.roomWrap.hidden = !state.campus.value;
      renderRoomTags(state);
      writeLegacyVenueFields(state);
      showVenueValidation(state);
      updateVenuePreview(state);
    });

    building.addEventListener("change", () => {
      state.hasInsideState = true;
      state.legacyBuildingName = "";
      writeLegacyVenueFields(state);
      showVenueValidation(state);
      updateVenuePreview(state);
    });

    roomInput.addEventListener("input", () => {
      const cleaned = roomInput.value.replace(/\D/g, "").slice(0, 3);
      if (roomInput.value !== cleaned) roomInput.value = cleaned;
    });
    roomInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === ",") {
        event.preventDefault();
        addRoom(state, roomInput.value);
      }
    });
    roomInput.addEventListener("paste", (event) => {
      event.preventDefault();
      if (event.isTrusted) userEditedSinceBaseline = true;
      (event.clipboardData?.getData("text") || "")
        .split(/[,\s]+/)
        .forEach((value) => addRoom(state, value));
    });
    roomInput.addEventListener("blur", () => {
      if (roomInput.value) addRoom(state, roomInput.value);
    });
    roomList.addEventListener("click", (event) => {
      const remove = event.target instanceof Element
        ? event.target.closest("[data-room-index]")
        : null;
      if (!remove) return;
      state.rooms.splice(Number(remove.dataset.roomIndex), 1);
      state.hasInsideState = true;
      renderRoomTags(state);
      writeLegacyVenueFields(state);
      showVenueValidation(state);
      updateVenuePreview(state);
    });
    return state;
  }

  function updateVenueControls(form, initialize) {
    if (!form || isUpdatingVenueControls) return;
    isUpdatingVenueControls = true;
    try {
      updateVenueControlsState(form, initialize);
    } finally {
      isUpdatingVenueControls = false;
    }
  }

  function updateVenueControlsState(form, initialize) {
    if (!form) return;
    if (venueUiForm !== form) {
      venueUiState = createVenueControls(form);
      if (!venueUiState) return;
      venueUiForm = form;
    }

    const state = venueUiState;
    const inside = isInsidePup(form);
    const firstRead = state.lastVenue === null;
    if (initialize || firstRead) {
      state.wasInside = inside;
      state.lastVenue = form.querySelector("#venue")?.value || "";
      if (inside) {
        state.outsideName = "";
        state.outsideAddress = "";
        readVenueDetails(state);
        state.hasInsideState = true;
      }
    } else {
      const currentVenue = form.querySelector("#venue")?.value || "";
      if (currentVenue !== state.lastVenue) {
        if (!state.wasInside && inside) {
          state.outsideName = state.legacyName.value;
          state.outsideAddress = state.legacyAddress.value;
          if (!state.hasInsideState) {
            state.campus.value = "";
            state.building.value = "";
            state.legacyBuildingName = "";
            state.rooms = [];
          }
        } else if (state.wasInside && !inside) {
          state.legacyName.value = state.outsideName;
          state.legacyAddress.value = state.outsideAddress;
          state.legacyName.dispatchEvent(new Event("input", { bubbles: true }));
          state.legacyAddress.dispatchEvent(new Event("input", { bubbles: true }));
        }
        state.wasInside = inside;
        state.lastVenue = currentVenue;
      }
    }

    [state.nameLabel, state.addressLabel, state.legacyName, state.legacyAddress]
      .forEach((element) => {
        if (element) {
          element.hidden = inside;
          element.style.display = inside ? "none" : "";
        }
      });
    state.campus.parentElement.hidden = !inside;
    state.buildingWrap.hidden = !inside || state.campus.value !== "PUP Biñan";
    state.roomWrap.hidden = !inside || !state.campus.value;

    if (inside) {
      state.nameWrap.hidden = false;
      state.nameWrap.style.display = "";
      state.addressWrap.hidden = false;
      state.addressWrap.style.display = "";
      if (initialize && state.hasInsideState) readVenueDetails(state);
      renderRoomTags(state);
      writeLegacyVenueFields(state);
      showVenueValidation(state);
      updateVenuePreview(state);
    } else {
      state.validationError.hidden = true;
    }
  }

  function dismissCleanConfirmation() {
    const modal = root.querySelector("#ceConfirmModal");
    if (!modal || modal.hidden) {
      if (autoDismissedCleanModal === modal) autoDismissedCleanModal = null;
      return;
    }
    const title = modal.querySelector("#confirmModalTitle")?.textContent.trim();
    if (title !== "Discard Changes?" || hasChanges()) {
      if (autoDismissedCleanModal === modal) autoDismissedCleanModal = null;
      return;
    }
    if (autoDismissedCleanModal === modal) return;
    const confirmButton = modal.querySelector("#confirmModalPrimaryBtn");
    if (confirmButton instanceof HTMLButtonElement) {
      autoDismissedCleanModal = modal;
      confirmButton.click();
    }
  }

  document.addEventListener("input", (event) => {
    if (event.isTrusted && event.target instanceof Element &&
        event.target.closest("#createEventMainForm")) {
      userEditedSinceBaseline = true;
    }
  }, true);

  document.addEventListener("change", (event) => {
    if (event.isTrusted && event.target instanceof Element &&
        event.target.closest("#createEventMainForm")) {
      userEditedSinceBaseline = true;
    }
  }, true);

  document.addEventListener("change", (event) => {
    if (!(event.target instanceof Element) || !event.target.matches("#venue")) return;
    updateVenueControls(root.querySelector("#createEventMainForm"), false);
  });

  document.addEventListener("input", (event) => {
    if (!(event.target instanceof Element) ||
        !event.target.matches("#customVenueName, #customVenueAddress")) return;
    updateVenuePreview(venueUiState);
  });

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.isTrusted && event.target.closest("#createEventMainForm [data-room-index]")) {
      userEditedSinceBaseline = true;
    }

    if (!event.target.closest("#btnSubmitApproval") ||
        venueUiState?.form !== root.querySelector("#createEventMainForm") ||
        !isInsidePup(venueUiState.form) ||
        showVenueValidation(venueUiState)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!venueUiState.campus.value) venueUiState.campus.focus();
    else if (venueUiState.campus.value === "PUP Biñan" &&
             !venueUiState.building.value && !venueUiState.legacyBuildingName) {
      venueUiState.building.focus();
    } else {
      venueUiState.roomInput.focus();
    }
  }, true);

  document.addEventListener("reset", (event) => {
    if (!(event.target instanceof HTMLFormElement) ||
        event.target.id !== "createEventMainForm") return;
    const form = event.target;
    window.setTimeout(() => captureBaseline(form), 0);
  }, true);

  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) return;
    const cancelButton = event.target.closest("#btnCancelEvent");
    if (cancelButton && !hasChanges()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign("EventOrganizerMyEvents.html");
      return;
    }

    const link = event.target.closest("a[href]");
    if (!link || hasChanges() ||
        link.matches(".logout, .logout-link, .admin-logout") ||
        /(?:^|\/)EventOrganizerLogin\.html(?:[?#]|$)/i.test(link.getAttribute("href") || "")) {
      return;
    }
    const href = link.getAttribute("href") || "";
    if (!href || href.startsWith("#") || /^(?:javascript:|mailto:|tel:)/i.test(href)) return;
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener("beforeunload", (event) => {
    if (!hasChanges()) event.stopImmediatePropagation();
  }, true);

  root.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) ||
        !event.target.closest("#confirmModalPrimaryBtn")) return;
    const title = root.querySelector("#confirmModalTitle")?.textContent.trim();
    if (title === "Discard Changes?") confirmedDiscard = true;
  }, true);

  const observer = new MutationObserver((records) => {
    if (records.some((record) =>
      mutationTouches(record, ".ce-existing-col-title, #searchPastEvents"))) {
      updateExistingEventsLabels();
    }
    const form = root.querySelector("#createEventMainForm");
    if (form && form !== venueUiForm) {
      updateVenueControls(form, false);
      dismissCleanConfirmation();
    } else if (records.some((record) => mutationTouches(record, "#ceConfirmModal"))) {
      dismissCleanConfirmation();
    }
    if (form && form !== baselineForm) {
      if (userEditedSinceBaseline && !confirmedDiscard) return;
      captureBaseline(form);
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });

  window.addEventListener("page-data-ready", () => {
    const form = root.querySelector("#createEventMainForm");
    updateVenueControls(form, true);
    if (form && form === baselineForm && !userEditedSinceBaseline) {
      captureBaseline(form);
    }
  });
})();
