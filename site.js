(() => {
  "use strict";

  const bootstrap = document.currentScript;
  const analyticsId = bootstrap?.dataset.gaId || "";
  let analyticsLoaded = false;

  function loadAnalytics() {
    if (!analyticsId || analyticsLoaded) return;
    analyticsLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag() {
      window.dataLayer.push(arguments);
    };

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${analyticsId}`;
    document.head.appendChild(script);

    window.gtag("js", new Date());
    window.gtag("config", analyticsId, { anonymize_ip: true });
  }

  function bindDeferredMaps() {
    document.querySelectorAll("iframe[data-map-src]").forEach((frame) => {
      const button = frame.parentElement?.querySelector(".map-load-button");
      if (!button) return;

      button.addEventListener("click", () => {
        if (!frame.dataset.mapSrc) return;
        button.disabled = true;
        button.textContent = "地図を読み込み中…";
        frame.addEventListener(
          "load",
          () => {
            button.hidden = true;
          },
          { once: true }
        );
        frame.src = frame.dataset.mapSrc;
        frame.removeAttribute("data-map-src");
      });
    });
  }

  function closeMenu() {
    document.body.classList.remove("menu-open");
    document.querySelector(".menu-btn")?.setAttribute("aria-expanded", "false");
  }

  if (analyticsId) {
    ["pointerdown", "keydown", "touchstart"].forEach((eventName) => {
      window.addEventListener(eventName, loadAnalytics, { once: true, passive: true });
    });
    window.addEventListener(
      "load",
      () => window.setTimeout(loadAnalytics, 8000),
      { once: true }
    );
  }

  bindDeferredMaps();
  document.querySelectorAll("header nav a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 769px)").matches) closeMenu();
  });
})();
