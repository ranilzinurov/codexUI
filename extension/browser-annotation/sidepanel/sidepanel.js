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
    devtoolsStatus: document.getElementById("devtoolsStatus"),
    devtoolsDetail: document.getElementById("devtoolsDetail"),
    captureDevtoolsBodies: document.getElementById("captureDevtoolsBodies"),
    captureDevtoolsBodiesHelp: document.getElementById("captureDevtoolsBodiesHelp"),
    enableDevtools: document.getElementById("enableDevtools"),
    disableDevtools: document.getElementById("disableDevtools"),
    queueStatus: document.getElementById("queueStatus"),
    queueDetail: document.getElementById("queueDetail"),
    batchMeta: document.getElementById("batchMeta"),
    queueList: document.getElementById("queueList"),
    sendBatch: document.getElementById("sendBatch"),
    message: document.getElementById("message")
  };
  let lastState = null;
  let lastDevtoolsStatus = {
    status: "inactive",
    detail: "DevTools capture is off."
  };
  const voiceRecordings = new Map();

  elements.saveSettings.addEventListener("click", saveSettings);
  elements.injectOverlay.addEventListener("click", injectOverlay);
  elements.enableDevtools.addEventListener("click", enableDevtoolsCapture);
  elements.disableDevtools.addEventListener("click", disableDevtoolsCapture);
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
    const queue = changes[STORAGE_KEYS.annotationQueue].newValue || [];
    if (lastState) {
      lastState = {
        ...lastState,
        queue
      };
    }
    renderQueue(queue);
  });

  refreshState();

  async function refreshState() {
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.GET_STATE });
      renderState(response.state);
      await refreshDevtoolsStatus();
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

  async function refreshDevtoolsStatus() {
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.GET_DEVTOOLS_CAPTURE_STATUS });
      renderDevtoolsStatus(readDevtoolsStatus(response));
    } catch (error) {
      renderDevtoolsStatus({
        status: "error",
        detail: error.message
      });
    }
  }

  async function enableDevtoolsCapture() {
    setBusy(true);
    const captureOptions = readDevtoolsCaptureOptions();
    renderDevtoolsStatus({
      status: "pending",
      detail: "Requesting debugger attachment for the active tab..."
    });
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.START_DEVTOOLS_CAPTURE,
        options: captureOptions
      });
      renderDevtoolsStatus(readDevtoolsStatus(response, "active"));
      setMessage("DevTools capture mode enabled for the active tab.", "ok");
    } catch (error) {
      renderDevtoolsStatus({
        status: "error",
        detail: error.message
      });
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function disableDevtoolsCapture(options = {}) {
    setBusy(true);
    renderDevtoolsStatus({
      status: "pending",
      detail: "Stopping DevTools capture mode..."
    });
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.STOP_DEVTOOLS_CAPTURE });
      renderDevtoolsStatus(readDevtoolsStatus(response, "inactive"));
      if (!options.silent) {
        setMessage("DevTools capture mode disabled.", "ok");
      }
    } catch (error) {
      renderDevtoolsStatus({
        status: "error",
        detail: error.message
      });
      if (!options.silent) {
        setMessage(error.message, "error");
      }
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
    renderDevtoolsStatus(state.devtoolsCapture || lastDevtoolsStatus);
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
    updateDevtoolsButtons(isBusy);
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
    pruneVoiceRecordings(items);
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
        row.append(createPreview(item.preview), header, createVoiceRecorder(item), createNoteField(item));
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

  function createVoiceRecorder(item) {
    const id = item.id || "";
    const voice = getVoiceState(id);
    const wrapper = document.createElement("div");
    wrapper.className = "queue-voice";
    wrapper.dataset.annotationId = id;
    wrapper.dataset.voiceStatus = voice.status;

    const status = document.createElement("div");
    status.className = "queue-voice-status";

    const label = document.createElement("strong");
    label.textContent = "Voice note";
    const detail = document.createElement("span");
    detail.dataset.voiceStatusText = id;
    detail.textContent = voiceStatusText(voice);
    status.append(label, detail);

    const controls = document.createElement("div");
    controls.className = "queue-voice-controls";
    controls.append(
      createVoiceButton("Record voice note", "voice-record", "Record", voice.status === "recording" || voice.status === "stopping"),
      createVoiceButton("Stop recording", "voice-stop", "Stop", voice.status !== "recording"),
      createVoiceButton("Cancel recording", "voice-cancel", "Cancel", voice.status !== "recording"),
      createVoiceButton("Delete recorded voice note", "voice-delete", "Delete", !voice.blob)
    );

    const duration = document.createElement("span");
    duration.className = "queue-voice-duration";
    duration.dataset.voiceDuration = id;
    duration.textContent = formatDuration(voiceDurationMs(voice));

    wrapper.append(status, controls, duration);
    return wrapper;
  }

  function createVoiceButton(label, action, text, disabled) {
    const button = document.createElement("button");
    button.className = "button button-secondary queue-voice-button";
    button.type = "button";
    button.title = label;
    button.dataset.queueAction = action;
    button.textContent = text;
    button.disabled = disabled;
    return button;
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
    if (action.startsWith("voice-")) {
      await handleVoiceAction(action, id);
      return;
    }

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

  async function handleVoiceAction(action, id) {
    if (action === "voice-record") {
      await startVoiceRecording(id);
      return;
    }
    if (action === "voice-stop") {
      stopVoiceRecording(id);
      return;
    }
    if (action === "voice-cancel") {
      cancelVoiceRecording(id);
      return;
    }
    if (action === "voice-delete") {
      deleteVoiceRecording(id);
    }
  }

  async function startVoiceRecording(id) {
    if (!id) {
      return;
    }
    if (!globalThis.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setVoiceError(id, "Voice recording is not available in this browser context.");
      return;
    }

    const existing = voiceRecordings.get(id);
    if (existing && (existing.status === "recording" || existing.status === "stopping")) {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks = [];
      const startedAt = Date.now();
      const voice = {
        status: "recording",
        startedAt,
        durationMs: 0,
        blob: null,
        mimeType: recorder.mimeType || "",
        recorder,
        stream,
        chunks,
        timerId: null,
        error: "",
        token: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
      };
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      });
      recorder.addEventListener("stop", () => {
        finishVoiceRecording(id, voice.token);
      }, { once: true });
      voiceRecordings.set(id, voice);
      recorder.start();
      voice.timerId = setInterval(() => updateVoiceRow(id), 500);
      updateVoiceRow(id);
      setMessage("Recording voice note.", "neutral");
    } catch (error) {
      setVoiceError(id, error.message || "Unable to start voice recording.");
    }
  }

  function stopVoiceRecording(id) {
    const voice = voiceRecordings.get(id);
    if (!voice || voice.status !== "recording" || !voice.recorder) {
      return;
    }
    voice.status = "stopping";
    voice.durationMs = Math.max(0, Date.now() - voice.startedAt);
    updateVoiceRow(id);
    voice.recorder.stop();
  }

  function cancelVoiceRecording(id) {
    const voice = voiceRecordings.get(id);
    if (!voice) {
      return;
    }
    cleanupVoiceRecording(voice);
    voiceRecordings.delete(id);
    updateVoiceRow(id);
    setMessage("Voice recording canceled.", "neutral");
  }

  function deleteVoiceRecording(id) {
    const voice = voiceRecordings.get(id);
    if (voice) {
      cleanupVoiceRecording(voice);
      voiceRecordings.delete(id);
    }
    updateVoiceRow(id);
    setMessage("Voice note deleted.", "neutral");
  }

  function finishVoiceRecording(id, token) {
    const voice = voiceRecordings.get(id);
    if (!voice || voice.token !== token) {
      return;
    }
    cleanupVoiceRecording(voice);
    const durationMs = voice.startedAt ? Math.max(0, Date.now() - voice.startedAt) : voice.durationMs;
    voice.status = "recorded";
    voice.durationMs = durationMs;
    voice.blob = new Blob(voice.chunks, { type: voice.mimeType || "audio/webm" });
    voice.recorder = null;
    voice.stream = null;
    voice.chunks = [];
    voice.error = "";
    updateVoiceRow(id);
    // TODO: Persist minimal voice metadata via UPDATE_ANNOTATION_QUEUE_ITEM when
    // the queue item schema supports it. Raw audio Blob data must stay transient.
    setMessage("Voice note recorded in side panel memory.", "ok");
  }

  function setVoiceError(id, message) {
    const voice = voiceRecordings.get(id);
    if (voice) {
      cleanupVoiceRecording(voice);
    }
    voiceRecordings.set(id, {
      status: "error",
      startedAt: 0,
      durationMs: 0,
      blob: null,
      mimeType: "",
      recorder: null,
      stream: null,
      chunks: [],
      timerId: null,
      error: message
    });
    updateVoiceRow(id);
    setMessage(message, "error");
  }

  function cleanupVoiceRecording(voice) {
    if (voice.timerId) {
      clearInterval(voice.timerId);
      voice.timerId = null;
    }
    if (voice.stream) {
      for (const track of voice.stream.getTracks()) {
        track.stop();
      }
    }
  }

  function pruneVoiceRecordings(items) {
    const liveIds = new Set(items.map((item) => item && item.id).filter(Boolean));
    for (const [id, voice] of voiceRecordings) {
      if (!liveIds.has(id)) {
        cleanupVoiceRecording(voice);
        voiceRecordings.delete(id);
      }
    }
  }

  function getVoiceState(id) {
    return voiceRecordings.get(id) || {
      status: "empty",
      startedAt: 0,
      durationMs: 0,
      blob: null,
      error: ""
    };
  }

  function voiceDurationMs(voice) {
    if (voice.status === "recording" && voice.startedAt) {
      return Math.max(0, Date.now() - voice.startedAt);
    }
    return voice.durationMs || 0;
  }

  function updateVoiceRow(id) {
    const voice = getVoiceState(id);
    const wrapper = Array.from(elements.queueList.querySelectorAll(".queue-voice"))
      .find((element) => element.dataset.annotationId === id);
    if (!wrapper) {
      return;
    }
    wrapper.dataset.voiceStatus = voice.status;
    const status = wrapper.querySelector("[data-voice-status-text]");
    const duration = wrapper.querySelector("[data-voice-duration]");
    if (status) {
      status.textContent = voiceStatusText(voice);
    }
    if (duration) {
      duration.textContent = formatDuration(voiceDurationMs(voice));
    }
    for (const button of wrapper.querySelectorAll("[data-queue-action]")) {
      const action = button.dataset.queueAction;
      button.disabled =
        (action === "voice-record" && (voice.status === "recording" || voice.status === "stopping")) ||
        (action === "voice-stop" && voice.status !== "recording") ||
        (action === "voice-cancel" && voice.status !== "recording") ||
        (action === "voice-delete" && !voice.blob);
    }
  }

  function voiceStatusText(voice) {
    if (voice.status === "recording") {
      return "Recording...";
    }
    if (voice.status === "stopping") {
      return "Finalizing recording...";
    }
    if (voice.status === "recorded") {
      const size = voice.blob ? `, ${formatBytes(voice.blob.size)}` : "";
      return `Recorded${size}. Not uploaded yet.`;
    }
    if (voice.status === "error") {
      return voice.error || "Recording failed.";
    }
    return "No voice note.";
  }

  function formatDuration(durationMs) {
    const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatBytes(size) {
    if (!Number.isFinite(size) || size <= 0) {
      return "0 B";
    }
    if (size < 1024) {
      return `${size} B`;
    }
    return `${(size / 1024).toFixed(1)} KB`;
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
      await disableDevtoolsCapture({ silent: true });
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

  function readDevtoolsStatus(response, fallbackStatus) {
    if (response && response.state && response.state.devtoolsCapture) {
      return response.state.devtoolsCapture;
    }
    if (response && response.devtoolsCapture) {
      return response.devtoolsCapture;
    }
    return {
      status: fallbackStatus || "inactive",
      detail: fallbackStatus === "active"
        ? "DevTools capture is active for the current tab."
        : "DevTools capture is off."
    };
  }

  function renderDevtoolsStatus(devtools) {
    const normalized = normalizeDevtoolsStatus(devtools);
    lastDevtoolsStatus = normalized;
    elements.devtoolsStatus.textContent = devtoolsStatusLabel(normalized.status);
    elements.devtoolsStatus.classList.toggle("status-active", normalized.status === "active");
    elements.devtoolsStatus.classList.toggle("status-error", normalized.status === "error");
    elements.devtoolsStatus.classList.toggle("status-pending", normalized.status === "pending");
    elements.devtoolsDetail.textContent = normalized.detail;
    updateDevtoolsButtons(false);
  }

  function normalizeDevtoolsStatus(devtools) {
    const status = devtools && typeof devtools.status === "string"
      ? devtools.status
      : "inactive";
    const captureOptions = normalizeDevtoolsCaptureOptions(devtools && devtools.captureOptions);
    const activeTabId = devtools && typeof devtools.tabId === "number"
      ? ` Attached to tab ${devtools.tabId}.`
      : "";
    if (status === "active") {
      return {
        status,
        detail: (devtools.detail || "DevTools capture is active for the current tab.") +
          activeTabId +
          ` ${devtoolsBodyCaptureDetail(captureOptions)}`,
        captureOptions
      };
    }
    if (status === "pending" || status === "error") {
      return {
        status,
        detail: devtools.detail || (status === "pending" ? "Updating DevTools capture mode..." : "DevTools capture status is unavailable."),
        captureOptions
      };
    }
    return {
      status: "inactive",
      detail: devtools && devtools.detail ? devtools.detail : "DevTools capture is off.",
      captureOptions
    };
  }

  function devtoolsStatusLabel(status) {
    if (status === "active") {
      return "Active";
    }
    if (status === "pending") {
      return "Updating";
    }
    if (status === "error") {
      return "Error";
    }
    return "Inactive";
  }

  function updateDevtoolsButtons(isBusy) {
    const state = lastDevtoolsStatus ? lastDevtoolsStatus.status : "inactive";
    const activeTabUnavailable = !lastState || !lastState.activeTab || lastState.activeTab.restricted;
    const activeOptions = lastDevtoolsStatus && state === "active"
      ? lastDevtoolsStatus.captureOptions
      : null;
    const activeBodyCapture = activeOptions
      ? activeOptions.captureRequestBodies === true && activeOptions.captureResponseBodies === true
      : false;
    if (state === "active") {
      elements.captureDevtoolsBodies.checked = activeBodyCapture;
      elements.captureDevtoolsBodiesHelp.textContent = activeBodyCapture
        ? "Active for this capture. Disable DevTools capture to change body collection."
        : "Metadata-only for this capture. Disable DevTools capture to opt in to body collection.";
    } else {
      elements.captureDevtoolsBodiesHelp.textContent =
        "Off by default. Enable only for pages where body contents are safe to share with Codex.";
    }
    elements.captureDevtoolsBodies.disabled = isBusy || state === "active" || state === "pending";
    elements.enableDevtools.disabled = isBusy || activeTabUnavailable || state === "active" || state === "pending";
    elements.disableDevtools.disabled = isBusy || state !== "active";
  }

  function readDevtoolsCaptureOptions() {
    const captureBodies = elements.captureDevtoolsBodies.checked === true;
    return {
      bodyCaptureMode: captureBodies ? "request-response" : "metadata-only",
      captureRequestBodies: captureBodies,
      captureResponseBodies: captureBodies
    };
  }

  function normalizeDevtoolsCaptureOptions(options) {
    const source = options && typeof options === "object" ? options : {};
    const captureRequestBodies = source.captureBodies === true ||
      source.captureRequestBodies === true ||
      source.bodyCaptureMode === "full-body-opt-in" ||
      source.bodyCaptureMode === "request-response";
    const captureResponseBodies = source.captureBodies === true ||
      source.captureResponseBodies === true ||
      source.bodyCaptureMode === "full-body-opt-in" ||
      source.bodyCaptureMode === "request-response";
    return {
      bodyCaptureMode: captureRequestBodies || captureResponseBodies
        ? "full-body-opt-in"
        : "metadata-only",
      captureRequestBodies,
      captureResponseBodies
    };
  }

  function devtoolsBodyCaptureDetail(options) {
    const captureBodies = options &&
      options.captureRequestBodies === true &&
      options.captureResponseBodies === true;
    return captureBodies
      ? "Request and response body capture is enabled for this active session."
      : "Request and response bodies are excluded for this active session.";
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
