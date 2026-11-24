(() => {
  "use strict";

  const capacityOverrides = new Map([
    ["Open Field | PUP Biñan", { original: 500, capacity: 1000 }],
    ["AVR1 | PUP Biñan", { original: 150, capacity: 50 }],
    ["AVR2 | PUP Biñan", { original: 100, capacity: 50 }],
    ["AVR2-1Room | PUP Biñan", { original: 40, capacity: 60 }],
    ["AVR2-2Room | PUP Biñan", { original: 40, capacity: 60 }],
    ["AVR2-3Room | PUP Biñan", { original: 40, capacity: 60 }],
    ["Others | Inside PUP", { original: 100, dynamicRooms: true }],
  ]);
  const unchangedCapacities = new Map([
    ["Kiosk | PUP Biñan", 50],
    ["Open Field | PUP CITE", 500],
    ["4th Floor | PUP CITE", 200],
    ["Others | Outside PUP", 200],
    ["Online / Virtual", 1000],
  ]);
  const defaultHint = "Select a venue to view capacity limit.";
  const root = document.getElementById("createEventRoot");
  let isPatching = false;
  let refreshQueued = false;
  let isDisposed = false;
  let observer = null;

  function roomCount() {
    const storedRooms = document.getElementById("insidePupRoomNumbersState")?.value || "";
    const pendingRoom = document.getElementById("insidePupRoomInput")?.value || "";
    const rooms = new Set(
      `${storedRooms},${pendingRoom}`
        .split(/[,\s]+/)
        .filter((room) => /^\d{1,3}$/.test(room)),
    );
    return Math.max(1, rooms.size);
  }

  function capacityFor(venue) {
    const override = capacityOverrides.get(venue);
    if (override?.dynamicRooms) return roomCount() * 60;
    if (override) return override.capacity;
    if (unchangedCapacities.has(venue)) return unchangedCapacities.get(venue);
    if (/Room\b/i.test(venue)) return 60;
    return null;
  }

  function installCapacityMapOverrides() {
    capacityOverrides.forEach((override, venue) => {
      if (Object.prototype.hasOwnProperty.call(Object.prototype, venue)) return;
      Object.defineProperty(Object.prototype, venue, {
        configurable: true,
        set(value) {
          const current = value && Number(value.maxCapacity);
          const adjusted = value && current === override.original
            ? { ...value }
            : value;
          if (adjusted && current === override.original) {
            if (override.dynamicRooms) {
              Object.defineProperty(adjusted, "maxCapacity", {
                configurable: true,
                enumerable: true,
                get: () => roomCount() * 60,
              });
            } else {
              adjusted.maxCapacity = override.capacity;
            }
          }
          Object.defineProperty(this, venue, {
            configurable: true,
            enumerable: true,
            writable: true,
            value: adjusted,
          });
          delete Object.prototype[venue];
        },
      });
    });
  }

  function refreshCapacityUi() {
    if (!root || isPatching || isDisposed) return;
    isPatching = true;
    try {
      const select = root.querySelector("#venue");
      const capacityInput = root.querySelector("#maxCapacity");
      const hint = root.querySelector("#venueCapacityHint");
      const venue = select?.value || "";

      root.querySelectorAll("#venue option").forEach((option) => {
        const limit = capacityFor(option.value);
        if (!limit) return;
        const capacity = String(limit);
        if (option.dataset.capacity !== capacity) option.dataset.capacity = capacity;
        const label = `${option.value} (Max: ${limit})`;
        if (option.textContent.trim() !== label) option.textContent = label;
      });

      const limit = capacityFor(venue);
      if (limit) {
        if (capacityInput) {
          capacityInput.disabled = false;
          if (capacityInput.max !== String(limit)) capacityInput.max = String(limit);
        }
        const nextHint = `Venue maximum capacity: ${limit} attendees.`;
        if (hint && hint.textContent !== nextHint) hint.textContent = nextHint;
      } else {
        if (capacityInput && !venue) {
          capacityInput.disabled = true;
          if (capacityInput.hasAttribute("max")) capacityInput.removeAttribute("max");
        }
        if (hint && !venue && hint.textContent !== defaultHint) {
          hint.textContent = defaultHint;
        }
      }

      const preview = root.querySelector("#previewCapacity");
      if (preview) {
        const enteredCapacity = capacityInput?.value || "";
        const nextPreview = enteredCapacity
          ? `Capacity: ${enteredCapacity} attendees${limit ? ` (Max: ${limit})` : ""}`
          : limit
            ? `Capacity not specified (Max: ${limit})`
            : "Capacity not specified";
        if (preview.textContent !== nextPreview) preview.textContent = nextPreview;
        const isMuted = !enteredCapacity;
        if (preview.classList.contains("is-muted") !== isMuted) {
          preview.classList.toggle("is-muted", isMuted);
        }
      }
    } finally {
      isPatching = false;
    }
  }

  function scheduleRefresh() {
    if (isPatching || refreshQueued || isDisposed) return;
    refreshQueued = true;
    window.queueMicrotask(() => {
      refreshQueued = false;
      refreshCapacityUi();
    });
  }

  installCapacityMapOverrides();
  if (!root) return;

  const handleFormChange = (event) => {
    if (isPatching || isDisposed) return;
    if (event.target instanceof Element &&
        event.target.closest("#createEventMainForm")) {
      scheduleRefresh();
    }
  };

  document.addEventListener("input", handleFormChange);
  document.addEventListener("change", handleFormChange);
  observer = new MutationObserver(() => {
    if (isPatching || isDisposed) return;
    scheduleRefresh();
  });
  observer.observe(root, {
    childList: true,
  });
  refreshCapacityUi();

  window.addEventListener("pagehide", () => {
    isDisposed = true;
    observer?.disconnect();
    document.removeEventListener("input", handleFormChange);
    document.removeEventListener("change", handleFormChange);
  }, { once: true });
})();
