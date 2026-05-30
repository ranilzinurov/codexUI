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
  const DRAG_THRESHOLD_PX = 6;
  const MIN_AREA_SIZE_PX = 8;
  const NOTE_SAVE_DELAY_MS = 350;
  let overlay = null;
  let active = false;
  let hoveredElement = null;
  let selectedSelection = null;
  let selectedQueueItemId = "";
  let currentSelectionToken = 0;
  const canceledSelectionTokens = new Set();
  let pendingHoverRect = false;
  let dragState = null;
  let ignoreClickUntil = 0;
  let noteUpdateTimer = 0;
  let pendingNoteText = "";
  let noteUpdateSequence = 0;
  let noteUpdateQueue = Promise.resolve();

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
    if (selectedSelection) {
      updateSelectedOverlay();
      showSelectionPanel(selectedSelection.label || "Selection", selectedQueueItemId ? "Saved" : "Saving...");
    } else {
      setIdlePanel("Click an element or drag an area");
    }

    if (active) {
      return;
    }

    active = true;
    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("mouseup", handleMouseUp, true);
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
    dragState = null;
    document.removeEventListener("mousedown", handleMouseDown, true);
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("mouseup", handleMouseUp, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("scroll", scheduleOverlayUpdate, true);
    window.removeEventListener("resize", scheduleOverlayUpdate);

    if (overlay) {
      overlay.hoverBox.hidden = true;
      overlay.dragBox.hidden = true;
      setIdlePanel("Annotation mode paused");
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
    const dragBox = document.createElement("div");
    dragBox.className = "box box-drag";
    dragBox.hidden = true;
    const selectedBox = document.createElement("div");
    selectedBox.className = "box box-selected";
    selectedBox.hidden = true;
    const panel = createPanel();
    shadow.append(style, hoverBox, dragBox, selectedBox, panel.container);

    host.__codexBrowserAnnotationOverlay = {
      host,
      hoverBox,
      dragBox,
      selectedBox,
      panel: panel.container,
      panelLabel: panel.label,
      panelMeta: panel.meta,
      actions: panel.actions,
      cancelButton: panel.cancelButton,
      noteButton: panel.noteButton,
      micButton: panel.micButton,
      noteWrap: panel.noteWrap,
      noteInput: panel.noteInput
    };
    document.documentElement.append(host);
    return host.__codexBrowserAnnotationOverlay;
  }

  function handleMouseDown(event) {
    if (!active || event.button !== 0) {
      return;
    }

    const target = selectableTargetFromEvent(event);
    if (!target) {
      return;
    }

    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      target,
      dragging: false
    };
    event.preventDefault();
    event.stopPropagation();
  }

  function handleMouseMove(event) {
    if (dragState) {
      dragState.lastX = event.clientX;
      dragState.lastY = event.clientY;
      if (!dragState.dragging && distanceFromDragStart(dragState) >= DRAG_THRESHOLD_PX) {
        dragState.dragging = true;
        hoveredElement = null;
        overlay.hoverBox.hidden = true;
      }
      if (dragState.dragging) {
        const rect = rectFromPoints(
          dragState.startX,
          dragState.startY,
          dragState.lastX,
          dragState.lastY
        );
        updateBoxFromRect(overlay.dragBox, rect);
        overlay.dragBox.hidden = false;
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = selectableTargetFromEvent(event);
    if (!target || target === hoveredElement) {
      return;
    }

    hoveredElement = target;
    scheduleOverlayUpdate();
  }

  function handleMouseUp(event) {
    if (!dragState) {
      return;
    }

    const completedDrag = dragState;
    dragState = null;
    ignoreClickUntil = Date.now() + 400;
    overlay.dragBox.hidden = true;
    event.preventDefault();
    event.stopPropagation();

    if (completedDrag.dragging) {
      const rect = rectFromPoints(
        completedDrag.startX,
        completedDrag.startY,
        completedDrag.lastX,
        completedDrag.lastY
      );
      if (rect.width >= MIN_AREA_SIZE_PX && rect.height >= MIN_AREA_SIZE_PX) {
        selectArea(rect);
        return;
      }
    }

    selectElement(completedDrag.target);
  }

  function handleClick(event) {
    const target = selectableTargetFromEvent(event);
    if (!target) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (Date.now() < ignoreClickUntil) {
      return;
    }

    selectElement(target);
  }

  function selectElement(target) {
    if (!target || !overlay) {
      return;
    }

    const context = selectionContext.createElementContext(target, {
      document,
      window,
      location: window.location
    });
    const label = describeElement(target);
    selectedSelection = {
      kind: "element",
      element: target,
      label
    };
    beginQueuedSelection(context, label, "Element selected");
  }

  function selectArea(rect) {
    if (!overlay) {
      return;
    }

    const safeRect = normalizeViewportRect(rect);
    const context = createAreaContext(safeRect);
    selectedSelection = {
      kind: "area",
      rect: {
        ...safeRect,
        pageX: safeRect.left + windowScrollX(),
        pageY: safeRect.top + windowScrollY()
      },
      label: "Selected area"
    };
    beginQueuedSelection(context, "Selected area", "Area selected");
  }

  function beginQueuedSelection(context, label, savedLabel) {
    selectedQueueItemId = "";
    pendingNoteText = "";
    clearTimeout(noteUpdateTimer);
    overlay.noteInput.value = "";
    overlay.noteWrap.hidden = true;
    overlay.noteButton.setAttribute("aria-expanded", "false");

    const selectionToken = currentSelectionToken + 1;
    currentSelectionToken = selectionToken;
    canceledSelectionTokens.delete(selectionToken);

    updateSelectedOverlay();
    showSelectionPanel(label, "Saving...");

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
        showSelectionPanel(savedLabel, "Saved");
        if (pendingNoteText) {
          void saveNoteUpdate();
        }
      })
      .catch((error) => {
        if (selectionToken !== currentSelectionToken || canceledSelectionTokens.has(selectionToken)) {
          canceledSelectionTokens.delete(selectionToken);
          return;
        }
        console.warn("Unable to queue selected annotation.", error);
        showSelectionPanel("Could not save selection", "Try again");
      });
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (selectedSelection || selectedQueueItemId) {
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
    selectedSelection = null;
    pendingNoteText = "";
    clearTimeout(noteUpdateTimer);
    if (overlay) {
      overlay.selectedBox.hidden = true;
      overlay.noteInput.value = "";
      overlay.noteWrap.hidden = true;
      overlay.noteButton.setAttribute("aria-expanded", "false");
      setIdlePanel(shouldPause ? "Selection canceled" : "Click an element or drag an area");
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
      console.warn("Unable to delete selected annotation.", error);
      if (overlay) {
        overlay.panelMeta.textContent = "Could not close";
      }
    }
  }

  function scheduleNoteUpdate() {
    pendingNoteText = overlay.noteInput.value;
    clearTimeout(noteUpdateTimer);
    if (!selectedQueueItemId) {
      overlay.panelMeta.textContent = "Saving...";
      return;
    }
    overlay.panelMeta.textContent = "Saving note...";
    noteUpdateTimer = window.setTimeout(() => {
      void saveNoteUpdate();
    }, NOTE_SAVE_DELAY_MS);
  }

  async function saveNoteUpdate() {
    const queueItemId = selectedQueueItemId;
    const noteText = pendingNoteText;
    if (!queueItemId) {
      return;
    }

    const updateId = noteUpdateSequence + 1;
    noteUpdateSequence = updateId;
    try {
      const response = await enqueueNoteUpdate({
        type: MESSAGE_TYPES.UPDATE_ANNOTATION_QUEUE_ITEM,
        id: queueItemId,
        patch: { noteText }
      });
      if (!response || response.ok !== true) {
        throw new Error(
          response && response.error
            ? response.error
            : "Note was not saved by the extension."
        );
      }
      if (updateId === noteUpdateSequence && queueItemId === selectedQueueItemId) {
        overlay.panelMeta.textContent = noteText ? "Note saved" : "Saved";
      }
    } catch (error) {
      console.warn("Unable to save annotation note.", error);
      if (queueItemId === selectedQueueItemId) {
        overlay.panelMeta.textContent = "Could not save note";
      }
    }
  }

  function enqueueNoteUpdate(message) {
    const task = () => chrome.runtime.sendMessage(message);
    const next = noteUpdateQueue.then(task, task);
    noteUpdateQueue = next.catch(() => {});
    return next;
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
        updateBoxFromElement(overlay.hoverBox, hoveredElement);
        overlay.hoverBox.hidden = false;
      } else {
        overlay.hoverBox.hidden = true;
      }
      updateSelectedOverlay();
    });
  }

  function updateSelectedOverlay() {
    if (!overlay || !selectedSelection) {
      return;
    }
    const rect = readSelectedRect(selectedSelection);
    if (!rect) {
      overlay.selectedBox.hidden = true;
      return;
    }
    updateBoxFromRect(overlay.selectedBox, rect);
    overlay.selectedBox.hidden = false;
    positionPanelForRect(rect);
  }

  function updateBoxFromElement(box, element) {
    updateBoxFromRect(box, rectFromDomRect(element.getBoundingClientRect()));
  }

  function updateBoxFromRect(box, rect) {
    box.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`;
    box.style.width = `${Math.max(0, Math.round(rect.width))}px`;
    box.style.height = `${Math.max(0, Math.round(rect.height))}px`;
  }

  function readSelectedRect(selection) {
    if (!selection) {
      return null;
    }
    if (selection.kind === "element") {
      if (!selection.element || !document.documentElement.contains(selection.element)) {
        return null;
      }
      return rectFromDomRect(selection.element.getBoundingClientRect());
    }
    if (!selection.rect) {
      return null;
    }
    if (typeof selection.rect.pageX === "number" && typeof selection.rect.pageY === "number") {
      return normalizeViewportRect({
        left: selection.rect.pageX - windowScrollX(),
        top: selection.rect.pageY - windowScrollY(),
        width: selection.rect.width,
        height: selection.rect.height
      });
    }
    return normalizeViewportRect(selection.rect);
  }

  function setIdlePanel(label) {
    if (!overlay) {
      return;
    }
    overlay.panel.hidden = false;
    overlay.panel.classList.add("is-idle");
    overlay.panelLabel.textContent = label;
    overlay.panelMeta.textContent = "Esc to exit";
    overlay.actions.hidden = true;
    overlay.noteWrap.hidden = true;
    overlay.panel.style.left = "";
    overlay.panel.style.top = "";
    overlay.panel.style.right = "16px";
    overlay.panel.style.bottom = "16px";
  }

  function showSelectionPanel(label, meta) {
    if (!overlay) {
      return;
    }
    overlay.panel.hidden = false;
    overlay.panel.classList.remove("is-idle");
    overlay.panelLabel.textContent = label;
    overlay.panelMeta.textContent = meta;
    overlay.actions.hidden = false;
    const rect = readSelectedRect(selectedSelection);
    if (rect) {
      positionPanelForRect(rect);
    }
  }

  function positionPanelForRect(rect) {
    if (!overlay || !rect) {
      return;
    }
    overlay.panel.style.right = "auto";
    overlay.panel.style.bottom = "auto";
    const gap = 8;
    const margin = 8;
    const panelWidth = overlay.panel.offsetWidth || 240;
    const panelHeight = overlay.panel.offsetHeight || 44;
    const left = clamp(rect.left, margin, window.innerWidth - panelWidth - margin);
    let top = rect.bottom + gap;
    if (top + panelHeight > window.innerHeight - margin) {
      top = rect.top - panelHeight - gap;
    }
    if (top < margin) {
      top = margin;
    }
    overlay.panel.style.left = `${Math.round(left)}px`;
    overlay.panel.style.top = `${Math.round(top)}px`;
  }

  function createAreaContext(rect) {
    const safeRect = normalizeViewportRect(rect);
    return {
      schemaVersion: 1,
      selectionMode: "area",
      tagName: "area",
      text: "Selected page area",
      rect: {
        x: round(safeRect.left),
        y: round(safeRect.top),
        width: round(safeRect.width),
        height: round(safeRect.height),
        top: round(safeRect.top),
        right: round(safeRect.right),
        bottom: round(safeRect.bottom),
        left: round(safeRect.left),
        pageX: round(safeRect.left + windowScrollX()),
        pageY: round(safeRect.top + windowScrollY())
      },
      viewport: {
        width: round(window.innerWidth),
        height: round(window.innerHeight),
        scrollX: round(windowScrollX()),
        scrollY: round(windowScrollY()),
        devicePixelRatio: round(window.devicePixelRatio || 1)
      },
      page: {
        url: String(window.location.href || ""),
        title: String(document.title || "")
      },
      nearby: {
        headings: [],
        labels: []
      },
      selectedAtIso: new Date().toISOString()
    };
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
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        width: max-content;
        max-width: min(360px, calc(100vw - 16px));
        color: #f8fafc;
        background: #111827;
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: 8px;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
        padding: 8px;
        pointer-events: auto;
      }

      .panel.is-idle {
        grid-template-columns: minmax(0, 1fr);
        width: min(280px, calc(100vw - 32px));
      }

      .copy {
        min-width: 0;
      }

      .label {
        overflow: hidden;
        color: #f8fafc;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.2;
        margin: 0;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .meta {
        color: #cbd5e1;
        font-size: 11px;
        line-height: 1.25;
        margin: 2px 0 0;
      }

      .actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .action {
        display: grid;
        place-items: center;
        min-width: 30px;
        height: 30px;
        color: #f8fafc;
        background: #1f2937;
        border: 1px solid rgba(248, 250, 252, 0.18);
        border-radius: 6px;
        cursor: pointer;
        font: 700 12px/1 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 0 8px;
      }

      .action.icon {
        width: 30px;
        min-width: 30px;
        padding: 0;
        font-size: 16px;
      }

      .action:hover:not(:disabled) {
        background: #374151;
      }

      .action:disabled {
        color: #94a3b8;
        cursor: not-allowed;
        opacity: 0.65;
      }

      .action:focus-visible,
      .note-input:focus-visible {
        outline: 2px solid #93c5fd;
        outline-offset: 2px;
      }

      .note-wrap {
        grid-column: 1 / -1;
      }

      .note-input {
        box-sizing: border-box;
        display: block;
        width: min(320px, calc(100vw - 32px));
        min-height: 72px;
        resize: vertical;
        color: #0f172a;
        background: #f8fafc;
        border: 1px solid rgba(148, 163, 184, 0.7);
        border-radius: 6px;
        font: 13px/1.35 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 8px;
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

      .box-drag,
      .box-selected {
        border: 2px solid #22c55e;
        background: rgba(34, 197, 94, 0.16);
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.28);
      }

      .box-drag {
        border-style: dashed;
      }
    `;
    return style;
  }

  function createPanel() {
    const panel = document.createElement("div");
    panel.className = "panel is-idle";

    const copy = document.createElement("div");
    copy.className = "copy";

    const label = document.createElement("p");
    label.className = "label";
    label.textContent = "Click an element or drag an area";

    const meta = document.createElement("p");
    meta.className = "meta";
    meta.textContent = "Esc to exit";

    const actions = document.createElement("div");
    actions.className = "actions";
    actions.hidden = true;

    const cancelButton = document.createElement("button");
    cancelButton.className = "action icon";
    cancelButton.type = "button";
    cancelButton.title = "Close annotation";
    cancelButton.setAttribute("aria-label", "Close annotation");
    cancelButton.textContent = "x";
    cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      cancelSelectedAnnotation({ pause: false });
    });

    const noteButton = document.createElement("button");
    noteButton.className = "action";
    noteButton.type = "button";
    noteButton.title = "Add comment";
    noteButton.setAttribute("aria-label", "Add comment");
    noteButton.setAttribute("aria-expanded", "false");
    noteButton.textContent = "Note";

    const micButton = document.createElement("button");
    micButton.className = "action";
    micButton.type = "button";
    micButton.title = "Voice comments are pending side panel wiring.";
    micButton.setAttribute("aria-label", "Voice comment unavailable");
    micButton.disabled = true;
    micButton.textContent = "Mic";

    const noteWrap = document.createElement("div");
    noteWrap.className = "note-wrap";
    noteWrap.hidden = true;

    const noteInput = document.createElement("textarea");
    noteInput.className = "note-input";
    noteInput.placeholder = "Add a comment";
    noteInput.maxLength = constants.MAX_ANNOTATION_NOTE_CHARS || 2000;
    noteInput.addEventListener("input", scheduleNoteUpdate);

    noteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const nextHidden = !noteWrap.hidden ? true : false;
      noteWrap.hidden = nextHidden;
      noteButton.setAttribute("aria-expanded", String(!nextHidden));
      updateSelectedOverlay();
      if (!nextHidden) {
        window.setTimeout(() => noteInput.focus(), 0);
      }
    });

    actions.append(cancelButton, noteButton, micButton);
    noteWrap.append(noteInput);
    copy.append(label, meta);
    panel.append(copy, actions, noteWrap);
    return {
      container: panel,
      label,
      meta,
      actions,
      cancelButton,
      noteButton,
      micButton,
      noteWrap,
      noteInput
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

  function distanceFromDragStart(state) {
    return Math.hypot(state.lastX - state.startX, state.lastY - state.startY);
  }

  function rectFromPoints(startX, startY, endX, endY) {
    const left = clamp(Math.min(startX, endX), 0, window.innerWidth);
    const top = clamp(Math.min(startY, endY), 0, window.innerHeight);
    const right = clamp(Math.max(startX, endX), 0, window.innerWidth);
    const bottom = clamp(Math.max(startY, endY), 0, window.innerHeight);
    return normalizeViewportRect({
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    });
  }

  function rectFromDomRect(rect) {
    return normalizeViewportRect({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    });
  }

  function normalizeViewportRect(rect) {
    const left = round(rect.left);
    const top = round(rect.top);
    const width = round(Math.max(0, rect.width !== undefined ? rect.width : rect.right - rect.left));
    const height = round(Math.max(0, rect.height !== undefined ? rect.height : rect.bottom - rect.top));
    return {
      left,
      top,
      right: round(left + width),
      bottom: round(top + height),
      width,
      height
    };
  }

  function clamp(value, min, max) {
    if (max < min) {
      return min;
    }
    return Math.min(max, Math.max(min, value));
  }

  function round(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.round(number * 100) / 100;
  }

  function windowScrollX() {
    return Number(window.scrollX || window.pageXOffset || 0);
  }

  function windowScrollY() {
    return Number(window.scrollY || window.pageYOffset || 0);
  }
})();
