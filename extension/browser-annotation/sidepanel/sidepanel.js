(function bootBrowserAnnotationSidePanel() {
  "use strict";

  const { MESSAGE_TYPES } = globalThis.BrowserAnnotationConstants;

  const elements = {
    connectionBadge: document.getElementById("connectionBadge"),
    serverUrl: document.getElementById("serverUrl"),
    pairingToken: document.getElementById("pairingToken"),
    saveSettings: document.getElementById("saveSettings"),
    injectOverlay: document.getElementById("injectOverlay"),
    tabStatus: document.getElementById("tabStatus"),
    tabDetail: document.getElementById("tabDetail"),
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
      setMessage("Settings saved locally in the extension.", "ok");
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

    const configured = state.connection === "configured";
    elements.connectionBadge.textContent = configured ? "Configured" : "Disconnected";
    elements.connectionBadge.classList.toggle("badge-ready", configured);
    elements.connectionBadge.classList.toggle("badge-muted", !configured);

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
    elements.message.classList.toggle("message-ok", tone === "ok");
  }
})();
