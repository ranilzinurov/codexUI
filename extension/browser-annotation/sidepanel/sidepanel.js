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
    queueList: document.getElementById("queueList"),
    message: document.getElementById("message")
  };
  let lastState = null;

  elements.saveSettings.addEventListener("click", saveSettings);
  elements.injectOverlay.addEventListener("click", injectOverlay);
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
        : "Stored locally in the extension. Batch send is added in a later stage.";
    elements.queueList.replaceChildren(
      ...items.slice(-5).reverse().map((item) => {
        const row = document.createElement("li");
        const name = document.createElement("strong");
        const context = item.context || {};
        name.textContent = queueItemName(context);
        const meta = document.createElement("span");
        meta.textContent = context.selector || context.xpath || "No selector";
        row.append(createPreview(item.preview), name, meta);
        return row;
      })
    );
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
