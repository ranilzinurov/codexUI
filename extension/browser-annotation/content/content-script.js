(function installBrowserAnnotationContentScript() {
  "use strict";

  if (globalThis.__codexBrowserAnnotationContentLoaded) {
    return;
  }
  globalThis.__codexBrowserAnnotationContentLoaded = true;

  const constants = globalThis.BrowserAnnotationConstants;
  const selectionContext = globalThis.BrowserAnnotationSelectionContext;
  if (!constants || !selectionContext) {
    console.warn("Codex annotation extension dependencies were not loaded.");
    return;
  }

  const { MESSAGE_TYPES } = constants;
  const ROOT_ID = "codex-browser-annotation-overlay-root";
  let overlay = null;
  let active = false;
  let hoveredElement = null;
  let selectedElement = null;
  let selectedQueueItemId = "";
  let currentSelectionToken = 0;
  const canceledSelectionTokens = new Set();
  let pendingHoverRect = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== MESSAGE_TYPES.CONTENT_START_OVERLAY) {
      return false;
    }

    startAnnotationMode();
    sendResponse({ ok: true, active });
    return true;
  });

  chrome.runtime.sendMessage({ type: MESSAGE_TYPES.CONTENT_PING }).catch(() => {
    // The service worker may be asleep; the side panel initiates the real flow.
  });

  function startAnnotationMode() {
    overlay = ensureOverlayRoot();
    overlay.host.hidden = false;
    overlay.status.textContent = "Annotation mode active. Click an element to queue it, or press Esc to exit.";

    if (active) {
      return;
    }

    active = true;
    document.addEventListener("mousemove", handleMouseMove, {
      capture: true,
      passive: true
    });
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", scheduleOverlayUpdate, {
      capture: true,
      passive: true
    });
    window.addEventListener("resize", scheduleOverlayUpdate, { passive: true });
  }

  function stopAnnotationMode() {
    active = false;
    hoveredElement = null;
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scroll", scheduleOverlayUpdate, true);
    window.removeEventListener("resize", scheduleOverlayUpdate);

    if (overlay) {
      overlay.hoverBox.hidden = true;
      overlay.status.textContent = selectedElement
        ? "Annotation mode paused. Inject again to select another element."
        : "Annotation mode paused.";
    }
  }

  function ensureOverlayRoot() {
    let host = document.getElementById(ROOT_ID);
    if (host) {
      return host.__codexBrowserAnnotationOverlay;
    }

    host = document.createElement("div");
    host.id = ROOT_ID;
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");

    const shadow = host.attachShadow({ mode: "open" });
    const style = createStyle();
    const hoverBox = document.createElement("div");
    hoverBox.className = "box box-hover";
    hoverBox.hidden = true;
    const selectedBox = document.createElement("div");
    selectedBox.className = "box box-selected";
    selectedBox.hidden = true;
    const cancelButton = document.createElement("button");
    cancelButton.className = "selection-cancel";
    cancelButton.type = "button";
    cancelButton.title = "Cancel selected annotation";
    cancelButton.setAttribute("aria-label", "Cancel selected annotation");
    cancelButton.textContent = "×";
    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelSelectedAnnotation({ pause: false });
    });
    selectedBox.append(cancelButton);
    const panel = createPanel();
    shadow.append(style, hoverBox, selectedBox, panel.container);

    host.__codexBrowserAnnotationOverlay = {
      host,
      hoverBox,
      selectedBox,
      cancelButton,
      panel: panel.container,
      status: panel.status,
      detail: panel.detail
    };
    document.documentElement.append(host);
    return host.__codexBrowserAnnotationOverlay;
  }

  function handleMouseMove(event) {
    const target = selectableTargetFromEvent(event);
    if (!target || target === hoveredElement) {
      return;
    }

    hoveredElement = target;
    scheduleOverlayUpdate();
  }

  function handleClick(event) {
    const target = selectableTargetFromEvent(event);
    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    selectedElement = target;
    selectedQueueItemId = "";
    const selectionToken = currentSelectionToken + 1;
    currentSelectionToken = selectionToken;
    canceledSelectionTokens.delete(selectionToken);
    hoveredElement = target;
    updateBox(overlay.selectedBox, target);
    overlay.selectedBox.hidden = false;
    overlay.detail.textContent = "Collecting selected element context…";

    const context = selectionContext.createElementContext(target, {
      document,
      window,
      location: window.location
    });

    chrome.runtime
      .sendMessage({
        type: MESSAGE_TYPES.CONTENT_ELEMENT_SELECTED,
        context
      })
      .then((response) => {
        if (!response || response.ok !== true) {
          throw new Error(
            response && response.error
              ? response.error
              : "Selection was not accepted by the extension."
          );
        }
        const queuedItemId = response.item && response.item.id ? String(response.item.id) : "";
        if (selectionToken !== currentSelectionToken || canceledSelectionTokens.has(selectionToken)) {
          if (queuedItemId) {
            void deleteQueuedAnnotation(queuedItemId);
          }
          canceledSelectionTokens.delete(selectionToken);
          return;
        }
        selectedQueueItemId = queuedItemId;
        const count = response.queueCount || 1;
        overlay.status.textContent = "Element queued.";
        overlay.detail.textContent = `${describeElement(target)} saved. Queue contains ${count} item${count === 1 ? "" : "s"}.`;
      })
      .catch((error) => {
        overlay.status.textContent = "Unable to queue selected element.";
        overlay.detail.textContent =
          error instanceof Error ? error.message : String(error);
      });
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (selectedElement || selectedQueueItemId) {
        cancelSelectedAnnotation({ pause: true });
      } else {
        stopAnnotationMode();
      }
    }
  }

  function cancelSelectedAnnotation(options = {}) {
    const shouldPause = options.pause === true;
    const canceledToken = currentSelectionToken;
    if (canceledToken > 0) {
      canceledSelectionTokens.add(canceledToken);
    }

    const queuedItemId = selectedQueueItemId;
    selectedQueueItemId = "";
    selectedElement = null;
    if (overlay) {
      overlay.selectedBox.hidden = true;
      overlay.status.textContent = shouldPause
        ? "Selected annotation canceled. Annotation mode paused."
        : "Selected annotation canceled. Click another element to queue it.";
      overlay.detail.textContent = shouldPause
        ? "Inject again to select another element."
        : "Choose a page element, or press Esc to exit.";
    }
    if (queuedItemId) {
      void deleteQueuedAnnotation(queuedItemId);
      canceledSelectionTokens.delete(canceledToken);
    }
    if (shouldPause) {
      stopAnnotationMode();
    }
  }

  async function deleteQueuedAnnotation(id) {
    try {
      await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.DELETE_ANNOTATION_QUEUE_ITEM,
        id
      });
    } catch (error) {
      if (overlay) {
        overlay.detail.textContent = error instanceof Error
          ? error.message
          : String(error);
      }
    }
  }

  function selectableTargetFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const target = path[0] || event.target;
    if (overlay && path.includes(overlay.host)) {
      return null;
    }
    if (!target || target.nodeType !== 1) {
      return null;
    }
    if (target.id === ROOT_ID || (target.closest && target.closest(`#${ROOT_ID}`))) {
      return null;
    }
    return target;
  }

  function scheduleOverlayUpdate() {
    if (pendingHoverRect) {
      return;
    }
    pendingHoverRect = true;
    window.requestAnimationFrame(() => {
      pendingHoverRect = false;
      if (!active || !overlay) {
        return;
      }
      if (hoveredElement && document.documentElement.contains(hoveredElement)) {
        updateBox(overlay.hoverBox, hoveredElement);
        overlay.hoverBox.hidden = false;
      } else {
        overlay.hoverBox.hidden = true;
      }
      if (selectedElement && document.documentElement.contains(selectedElement)) {
        updateBox(overlay.selectedBox, selectedElement);
        overlay.selectedBox.hidden = false;
      }
    });
  }

  function updateBox(box, element) {
    const rect = element.getBoundingClientRect();
    box.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
    box.style.width = `${Math.max(0, Math.round(rect.width))}px`;
    box.style.height = `${Math.max(0, Math.round(rect.height))}px`;
  }

  function createStyle() {
    const style = document.createElement("style");
    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: none;
      }

      .panel {
        position: fixed;
        right: 16px;
        bottom: 16px;
        max-width: min(320px, calc(100vw - 32px));
        color: #f8fafc;
        background: #111827;
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: 8px;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
        padding: 12px;
      }

      .box {
        position: fixed;
        top: 0;
        left: 0;
        box-sizing: border-box;
        border-radius: 4px;
        pointer-events: none;
        transition: transform 80ms linear, width 80ms linear, height 80ms linear;
      }

      .box-hover {
        border: 2px solid #60a5fa;
        background: rgba(96, 165, 250, 0.14);
        box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.35);
      }

      .box-selected {
        border: 2px solid #22c55e;
        background: rgba(34, 197, 94, 0.16);
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.28);
      }

      .selection-cancel {
        position: absolute;
        top: -14px;
        right: -14px;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        color: #f8fafc;
        background: #111827;
        border: 1px solid rgba(248, 250, 252, 0.75);
        border-radius: 999px;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.35);
        cursor: pointer;
        font: 700 18px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
      }

      .selection-cancel:hover {
        background: #1f2937;
      }

      .selection-cancel:focus-visible {
        outline: 2px solid #93c5fd;
        outline-offset: 2px;
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
    body.textContent = "Click a page element to collect its selector, role, text, rect, viewport, headings, and labels.";

    panel.append(title, body);
    return {
      container: panel,
      status: title,
      detail: body
    };
  }

  function describeElement(element) {
    const tagName = String(element.tagName || "element").toLowerCase();
    const text = selectionContext.normalizeText(
      element.getAttribute("aria-label") ||
        element.innerText ||
        element.textContent ||
        element.value ||
        "",
      48
    );
    return text ? `${tagName} "${text}"` : tagName;
  }
})();
