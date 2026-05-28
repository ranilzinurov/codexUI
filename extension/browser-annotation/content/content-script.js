(function installBrowserAnnotationContentScript() {
  "use strict";

  if (globalThis.__codexBrowserAnnotationContentLoaded) {
    return;
  }
  globalThis.__codexBrowserAnnotationContentLoaded = true;

  const constants = globalThis.BrowserAnnotationConstants;
  if (!constants) {
    console.warn("Codex annotation constants were not loaded.");
    return;
  }

  const { MESSAGE_TYPES } = constants;
  const ROOT_ID = "codex-browser-annotation-overlay-root";

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_TYPES.CONTENT_START_OVERLAY) {
      return false;
    }

    const root = ensureOverlayRoot();
    root.hidden = false;
    sendResponse({ ok: true });
    return true;
  });

  chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CONTENT_PING }).catch(() => {
    // The service worker may be asleep; the side panel initiates the real flow.
  });

  function ensureOverlayRoot() {
    let host = document.getElementById(ROOT_ID);
    if (host) {
      return host;
    }

    host = document.createElement("div");
    host.id = ROOT_ID;
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");

    const shadow = host.attachShadow({ mode: "open" });
    shadow.append(createStyle(), createPanel());
    document.documentElement.append(host);
    return host;
  }

  function createStyle() {
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        inset: auto 16px 16px auto;
        z-index: 2147483647;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .panel {
        max-width: min(320px, calc(100vw - 32px));
        color: #f8fafc;
        background: #111827;
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: 8px;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
        padding: 12px;
      }

      .title {
        font-size: 13px;
        font-weight: 700;
        margin: 0 0 4px;
      }

      .body {
        font-size: 12px;
        line-height: 1.45;
        margin: 0;
      }
    `;
    return style;
  }

  function createPanel() {
    const panel = document.createElement("div");
    panel.className = "panel";

    const title = document.createElement("p");
    title.className = "title";
    title.textContent = "Codex annotation mode";

    const body = document.createElement("p");
    body.className = "body";
    body.textContent =
      "Overlay injection is working. Element selection and annotation queue arrive in later stages.";

    panel.append(title, body);
    return panel;
  }
})();
