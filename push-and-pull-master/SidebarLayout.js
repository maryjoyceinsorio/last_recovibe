(() => {
  const script = document.currentScript;
  if (!script) return;

  const scriptUrl = script.src || new URL("../SidebarLayout.js", document.baseURI).href;
  const stylesheetUrl = new URL("./SidebarLayout.css", scriptUrl).href;
  const stylesheetExists = Array.from(
    document.querySelectorAll('link[rel="stylesheet"]'),
  ).some((link) => link.href === stylesheetUrl);
  if (!stylesheetExists) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = stylesheetUrl;
    document.head.appendChild(stylesheet);
  }

  if (document.querySelector(".date-range-panel")) {
    const dateRangeStylesheet = document.createElement("link");
    dateRangeStylesheet.rel = "stylesheet";
    dateRangeStylesheet.href = new URL("./DateRangeModal.css", scriptUrl).href;
    document.head.appendChild(dateRangeStylesheet);
  }

  const initializeSidebars = () => {
    const sidebars = document.querySelectorAll(
      ".sidebar, .admin-sidebar, .organizer-sidebar, .teacher-sidebar",
    );

    sidebars.forEach((sidebar, index) => {
      const nav = Array.from(sidebar.children).find((child) => child.tagName === "NAV") ||
        sidebar.querySelector("nav");
      if (!nav || sidebar.dataset.rvMobileNavReady === "true") return;

      sidebar.dataset.rvMobileNavReady = "true";
      sidebar.classList.add("rv-sidebar-mobile-drawer");
      if (!sidebar.id) sidebar.id = `rv-sidebar-${index + 1}`;

      const app = sidebar.closest(
        ".app, .admin-app, .organizer-app, .superadmin-app, .teacher-app",
      );
      const main = app ? app.querySelector("main") : document.querySelector("main");
      if (!main) return;

      const existingToggle = main.querySelector("#sidebarToggle");
      const toggle = existingToggle || document.createElement("button");
      toggle.classList.add("rv-mobile-nav-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-controls", sidebar.id);
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation");
      if (!existingToggle) {
        toggle.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><span>Menu</span>';
        main.parentNode.insertBefore(toggle, main);
      }

      const existingClose = sidebar.querySelector("#sidebarClose");
      const existingScrim = document.getElementById("sidebarScrim");
      let header = Array.from(sidebar.children).find((child) => child !== nav);
      const closeButton = document.createElement("button");
      closeButton.className = "rv-mobile-nav-close";
      closeButton.type = "button";
      closeButton.setAttribute("aria-label", "Close menu");
      closeButton.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      if (header) {
        if (header.tagName === "A") {
          const headerWrapper = document.createElement("div");
          headerWrapper.className = "rv-mobile-nav-header-wrapper";
          sidebar.insertBefore(headerWrapper, header);
          headerWrapper.appendChild(header);
          header = headerWrapper;
        }
        header.classList.add("rv-mobile-nav-header");
        header.appendChild(closeButton);
      } else {
        nav.parentNode.insertBefore(closeButton, nav);
      }

      const backdrop = document.createElement("div");
      backdrop.className = "rv-mobile-nav-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.hidden = true;
      document.body.appendChild(backdrop);

      const mobile = window.matchMedia("(max-width: 860px)");
      let savedBodyStyles = null;

      const isOpen = () => sidebar.classList.contains("rv-mobile-open");

      const open = () => {
        if (!mobile.matches || isOpen()) return;

        savedBodyStyles = {
          overflow: document.body.style.overflow,
          position: document.body.style.position,
          top: document.body.style.top,
          width: document.body.style.width,
          scrollY: window.scrollY,
        };
        document.body.style.position = "fixed";
        document.body.style.top = `-${savedBodyStyles.scrollY}px`;
        document.body.style.width = "100%";
        document.body.style.overflow = "hidden";
        sidebar.classList.add("rv-mobile-open");
        if (existingToggle) {
          sidebar.classList.add("is-open");
          if (existingScrim) existingScrim.hidden = false;
          document.body.classList.add("sidebar-open");
        }
        backdrop.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        toggle.setAttribute("aria-label", "Close navigation");
        closeButton.focus({ preventScroll: true });
      };

      const close = (restoreFocus) => {
        if (!isOpen()) return;

        if (sidebar.classList.contains("is-open") && existingClose) {
          existingClose.click();
        }
        sidebar.classList.remove("rv-mobile-open");
        sidebar.classList.remove("is-open");
        if (existingScrim) existingScrim.hidden = true;
        backdrop.hidden = true;
        document.body.classList.remove("sidebar-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open navigation");
        if (savedBodyStyles) {
          document.body.style.overflow = savedBodyStyles.overflow;
          document.body.style.position = savedBodyStyles.position;
          document.body.style.top = savedBodyStyles.top;
          document.body.style.width = savedBodyStyles.width;
          window.scrollTo(0, savedBodyStyles.scrollY);
          savedBodyStyles = null;
        }
        if (restoreFocus) toggle.focus({ preventScroll: true });
      };

      toggle.addEventListener("click", () => {
        if (isOpen()) close(false);
        else open();
      });
      closeButton.addEventListener("click", () => close(true));
      backdrop.addEventListener("click", () => close(true));
      nav.addEventListener("click", (event) => {
        if (event.target.closest("a")) close(false);
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") close(true);
      });

      const handleViewportChange = (event) => {
        if (!event.matches) close(false);
      };
      if (typeof mobile.addEventListener === "function") {
        mobile.addEventListener("change", handleViewportChange);
      } else {
        mobile.addListener(handleViewportChange);
      }
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeSidebars, { once: true });
  } else {
    initializeSidebars();
  }
})();
