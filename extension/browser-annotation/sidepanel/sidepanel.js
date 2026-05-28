(function bootBrowserAnnotationSidePanel() {
  "use strict";

  const { MESSAGE_TYPES, STORAGE_KEYS } = globalThis.BrowserAnnotationConstants;

  const elements = {
    connectionBadge: document.getElementById("connectionBadge"),
    serverUrl: document.getElementById("serverUrl"),
    pairingToken: document.getElementById("pairingToken"),
    saveSettings: document.getElementById("saveSettings"),
    connectionStatus: document.getElementById("connectionStatus"),
    connectionDetail: document.getElementById("connectionDetail"),
    injectOverlay: document.getElementById("injectOverlay"),
    tabStatus: document.getElementById("tabStatus"),
    tabDetail: document.getElementById("tabDetail"),
    queueStatus: document.getElementById("queueStatus"),
    queueDetail: document.getElementById("queueDetail"),
    batchMeta: document.getElementById("batchMeta"),
    queueList: document.getElementById("queueList"),
    sendBatch: document.getElementById("sendBatch"),
    message: document.getElementById("message")
  };
  let lastState = null;

  elements.saveSettings.addEventListener("click", saveSettings);
  elements.injectOverlay.addEventListener("click", injectOverlay);
  elements.sendBatch.addEventListener("click", sendBatch);
  elements.queueList.addEventListener("click", handleQueueClick);
  elements.queueList.addEventListener("change", handleQueueChange);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshState();
    }
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEYS.annotationQueue]) {
      return;
    }
    renderQueue(changes[STORAGE_KEYS.annotationQueue].newValue || []);
  });

  refreshState();

  async function refreshState() {
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.GET_STATE });
      renderState(response.state);
      setMessage("", "neutral");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.SAVE_SETTINGS,
        settings: {
          serverUrl: elements.serverUrl.value,
          pairingToken: elements.pairingToken.value
        }
      });
      renderState(response.state);
      setMessage(connectionMessage(response.state.connection), response.state.connection.status);
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function injectOverlay() {
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.INJECT_OVERLAY
      });
      renderState(response.state);
      setMessage(
        response.injected
          ? "Overlay injected into the active tab."
          : "Overlay request completed, but no content-script response was received.",
        response.injected ? "ok" : "error"
      );
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function sendRuntimeMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || response.ok !== true) {
      throw new Error(
        response && response.error
          ? response.error
          : "The extension service worker did not return a valid response."
      );
    }
    return response;
  }

  function renderState(state) {
    lastState = state;
    elements.serverUrl.value = state.settings.serverUrl || "";
    elements.pairingToken.value = state.settings.pairingToken || "";

    const connected = state.connection.status === "connected";
    const error = state.connection.status === "error";
    elements.connectionBadge.textContent = connectionLabel(state.connection.status);
    elements.connectionBadge.classList.toggle("badge-ready", connected);
    elements.connectionBadge.classList.toggle("badge-error", error);
    elements.connectionBadge.classList.toggle("badge-muted", !connected && !error);
    elements.connectionStatus.textContent = connectionLabel(state.connection.status);
    elements.connectionDetail.textContent = connectionDetail(state.connection);
    renderQueue(state.queue);
    updateSendButton(false);

    if (!state.activeTab) {
      elements.tabStatus.textContent = "Unavailable";
      elements.tabDetail.textContent = "No active browser tab is available.";
      elements.injectOverlay.disabled = true;
      return;
    }

    elements.tabStatus.textContent = state.activeTab.restricted ? "Restricted" : "Ready";
    elements.tabDetail.textContent = state.activeTab.restricted
      ? state.activeTab.restrictionReason
      : state.activeTab.title || state.activeTab.url || "This page can receive the annotation overlay.";
    elements.injectOverlay.disabled = state.activeTab.restricted;
  }

  function setBusy(isBusy) {
    elements.saveSettings.disabled = isBusy;
    elements.injectOverlay.disabled =
      isBusy || !lastState || !lastState.activeTab || lastState.activeTab.restricted;
    updateSendButton(isBusy);
  }

  function setMessage(text, tone) {
    elements.message.textContent = text;
    elements.message.classList.toggle("message-error", tone === "error");
    elements.message.classList.toggle("message-ok", tone === "ok" || tone === "connected");
  }

  function connectionLabel(status) {
    if (status === "connected") {
      return "Connected";
    }
    if (status === "error") {
      return "Error";
    }
    return "Disconnected";
  }

  function connectionDetail(connection) {
    if (!connection) {
      return "Connection state is unavailable.";
    }

    if (connection.status === "connected" && connection.session) {
      const expiry = formatDateTime(connection.session.expiresAtIso);
      return expiry
        ? `Validated for thread ${connection.session.threadId}. Expires ${expiry}.`
        : `Validated for thread ${connection.session.threadId}.`;
    }

    return connection.detail || "Paste a pairing token from Codex UI.";
  }

  function connectionMessage(connection) {
    if (!connection) {
      return "Settings saved locally in the extension.";
    }
    if (connection.status === "connected") {
      return "Pairing token validated.";
    }
    if (connection.status === "error") {
      return connection.detail || "Pairing token could not be validated.";
    }
    return "Settings saved locally in the extension.";
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString();
  }

  function renderQueue(queue) {
    const items = Array.isArray(queue) ? queue : [];
    elements.queueStatus.textContent =
      items.length === 0 ? "Empty" : `${items.length} item${items.length === 1 ? "" : "s"}`;
    elements.queueDetail.textContent =
      items.length === 0
        ? "Select elements on the page to queue annotation context for later stages."
        : "Add notes, adjust order, then send one batch to Codex UI.";
    renderBatchMeta(items);
    elements.queueList.replaceChildren(
      ...items.map((item, index) => {
        const row = document.createElement("li");
        row.dataset.annotationId = item.id || "";
        const header = document.createElement("div");
        header.className = "queue-row-header";
        const heading = document.createElement("div");
        const name = document.createElement("strong");
        const context = item.context || {};
        name.textContent = queueItemName(context);
        const meta = document.createElement("span");
        meta.textContent = context.selector || context.xpath || "No selector";
        heading.append(name, meta);
        header.append(heading, createQueueActions(item, index, items.length));
        row.append(createPreview(item.preview), header, createNoteField(item));
        return row;
      })
    );
    updateSendButton(false);
  }

  function renderBatchMeta(items) {
    if (items.length === 0) {
      elements.batchMeta.hidden = true;
      elements.batchMeta.replaceChildren();
      return;
    }
    const page = readQueueItemPage(items[0]);
    const title = document.createElement("strong");
    title.textContent = "Batch page";
    const detail = document.createElement("span");
    detail.textContent = page.title ? `${page.title} - ${page.url}` : page.url;
    elements.batchMeta.replaceChildren(title, detail);
    elements.batchMeta.hidden = false;
  }

  function createQueueActions(item, index, itemCount) {
    const actions = document.createElement("div");
    actions.className = "queue-actions";
    actions.append(
      createActionButton("Move up", "up", "↑", index === 0),
      createActionButton("Move down", "down", "↓", index === itemCount - 1),
      createActionButton("Delete", "delete", "×", false)
    );
    actions.dataset.annotationId = item.id || "";
    return actions;
  }

  function createActionButton(label, action, text, disabled) {
    const button = document.createElement("button");
    button.className = "icon-button";
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.queueAction = action;
    button.textContent = text;
    button.disabled = disabled;
    return button;
  }

  function createNoteField(item) {
    const label = document.createElement("label");
    label.className = "queue-note-label";
    const text = document.createElement("span");
    text.textContent = "Note";
    const textarea = document.createElement("textarea");
    textarea.dataset.annotationId = item.id || "";
    textarea.maxLength = 2000;
    textarea.placeholder = "What should Codex inspect here?";
    textarea.value = item.noteText || "";
    label.append(text, textarea);
    return label;
  }

  async function handleQueueClick(event) {
    const button = event.target.closest("[data-queue-action]");
    if (!button || button.disabled) {
      return;
    }
    const row = button.closest("[data-annotation-id]");
    const id = row ? row.dataset.annotationId : "";
    if (!id) {
      return;
    }

    const action = button.dataset.queueAction;
    setBusy(true);
    try {
      if (action === "delete") {
        const response = await sendRuntimeMessage({
          type: MESSAGE_TYPES.DELETE_ANNOTATION_QUEUE_ITEM,
          id
        });
        applyQueueResponse(response);
        setMessage("Annotation removed from the queue.", "ok");
      } else {
        const response = await sendRuntimeMessage({
          type: MESSAGE_TYPES.MOVE_ANNOTATION_QUEUE_ITEM,
          id,
          direction: action === "up" ? -1 : 1
        });
        applyQueueResponse(response);
        setMessage("Queue order updated.", "ok");
      }
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleQueueChange(event) {
    if (!event.target.matches("textarea[data-annotation-id]")) {
      return;
    }
    await saveQueueNote(event.target.dataset.annotationId, event.target.value);
  }

  async function saveQueueNote(id, noteText) {
    if (!id) {
      return;
    }
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.UPDATE_ANNOTATION_QUEUE_ITEM,
      id,
      patch: { noteText }
    });
    applyQueueResponse(response);
  }

  async function persistVisibleNotes() {
    const fields = Array.from(elements.queueList.querySelectorAll("textarea[data-annotation-id]"));
    for (const field of fields) {
      await saveQueueNote(field.dataset.annotationId, field.value);
    }
  }

  async function sendBatch() {
    setBusy(true);
    try {
      await persistVisibleNotes();
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.SEND_ANNOTATION_BATCH
      });
      renderState(response.state);
      const count = response.result && response.result.annotationCount
        ? response.result.annotationCount
        : "queued";
      setMessage(`Sent ${count} annotation${count === 1 ? "" : "s"} to Codex UI.`, "ok");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function updateSendButton(isBusy) {
    const itemCount = lastState && Array.isArray(lastState.queue) ? lastState.queue.length : 0;
    const connected = lastState && lastState.connection.status === "connected";
    elements.sendBatch.disabled = isBusy || itemCount === 0 || !connected;
  }

  function applyQueueResponse(response) {
    if (response.state) {
      renderState(response.state);
      return;
    }
    if (lastState && Array.isArray(response.queue)) {
      lastState = {
        ...lastState,
        queue: response.queue
      };
      renderQueue(response.queue);
    }
  }

  function readQueueItemPage(item) {
    const context = item && item.context ? item.context : {};
    const page = context.page || {};
    const tab = item && item.tab ? item.tab : {};
    return {
      title: page.title || tab.title || "",
      url: page.url || tab.url || "Unknown page"
    };
  }

  function createPreview(preview) {
    const frame = document.createElement("div");
    frame.className = "queue-preview";
    if (!preview || !preview.dataUrl) {
      frame.textContent = "No preview";
      return frame;
    }

    const image = document.createElement("img");
    image.src = preview.dataUrl;
    image.alt = "Selected element preview";
    image.loading = "lazy";
    image.width = preview.width || 1;
    image.height = preview.height || 1;
    frame.append(image);
    return frame;
  }

  function queueItemName(context) {
    const tag = context.tagName || "element";
    const role = context.role ? ` role=${context.role}` : "";
    const text = context.text ? ` "${context.text}"` : "";
    return `${tag}${role}${text}`;
  }
})();
