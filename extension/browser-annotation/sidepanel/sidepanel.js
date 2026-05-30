(function bootBrowserAnnotationSidePanel() {
  "use strict";

  const { MESSAGE_TYPES, STORAGE_KEYS } = globalThis.BrowserAnnotationConstants;
  const {
    buildAssetUploadUrl,
    buildTranscribeUrl,
    readJsonSafely,
    readStatusError
  } = globalThis.BrowserAnnotationPairingClient;
  const {
    describeRestrictedUrl,
    getTabOriginPattern,
    isRestrictedTabUrl
  } = globalThis.BrowserAnnotationUrlUtils;

  const VOICE_UPLOAD_TIMEOUT_MS = 60000;
  const VOICE_TRANSCRIBE_TIMEOUT_MS = 60000;

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
  const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
  const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));
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
  for (const button of tabButtons) {
    button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
  }
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
      await requestActiveTabHostPermission();
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

    elements.tabStatus.textContent = state.activeTab.restricted
      ? "Restricted"
      : state.activeTab.needsHostPermission
        ? "Needs access"
        : "Ready";
    elements.tabDetail.textContent = activeTabDetail(state.activeTab);
    elements.injectOverlay.disabled = state.activeTab.restricted;
  }

  function activateTab(targetId) {
    if (!targetId) {
      return;
    }
    for (const button of tabButtons) {
      const selected = button.dataset.tabTarget === targetId;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    }
    for (const panel of tabPanels) {
      const selected = panel.id === targetId;
      panel.hidden = !selected;
      panel.classList.toggle("is-active", selected);
    }
  }

  async function requestActiveTabHostPermission() {
    const freshTab = await getFreshActiveTab();
    const activeTab = freshTab || (lastState && lastState.activeTab ? lastState.activeTab : null);
    const tabUrl = activeTab && activeTab.url ? activeTab.url : "";
    if (!activeTab) {
      return;
    }
    if (isRestrictedTabUrl(tabUrl)) {
      throw new Error(describeRestrictedUrl(tabUrl));
    }

    const originPattern = getTabOriginPattern(tabUrl) || activeTab.hostPermissionPattern || "";
    if (!originPattern) {
      return;
    }

    if (!chrome.permissions || !chrome.permissions.request) {
      throw new Error("Chrome host permissions API is unavailable; cannot inject the annotation overlay.");
    }

    const hasAccess = chrome.permissions.contains
      ? await chrome.permissions.contains({ origins: [originPattern] })
      : activeTab.hasHostAccess === true;
    if (hasAccess) {
      return;
    }

    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) {
      throw new Error(`Permission denied. Allow Codex UI Browser Annotation to access ${originPattern} before injecting the overlay.`);
    }
  }

  async function getFreshActiveTab() {
    if (!chrome.tabs || !chrome.tabs.query) {
      return null;
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function activeTabDetail(activeTab) {
    if (activeTab.restricted) {
      return activeTab.restrictionReason;
    }
    const label = activeTab.title || activeTab.url || "This page can receive the annotation overlay.";
    if (activeTab.needsHostPermission) {
      return `${label} Grant access when Chrome asks, then the overlay can be injected.`;
    }
    return label;
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
        ? "Select elements on the page, then send them as one batch."
        : "Adjust order or remove items before sending.";
    renderBatchMeta(items);
    pruneVoiceRecordings(items);
    elements.queueList.replaceChildren(
      ...items.map((item, index) => {
        const row = document.createElement("li");
        row.dataset.annotationId = item.id || "";
        const content = document.createElement("div");
        content.className = "queue-content";
        const header = document.createElement("div");
        header.className = "queue-row-header";
        const heading = document.createElement("div");
        heading.className = "queue-heading";
        const name = document.createElement("strong");
        const context = item.context || {};
        name.textContent = queueItemName(context);
        const meta = document.createElement("span");
        meta.textContent = queueItemMeta(item);
        heading.append(name, meta);
        header.append(heading, createQueueActions(item, index, items.length));
        content.append(header);
        const voiceStatus = createVoiceRecorder(item);
        if (voiceStatus) {
          content.append(voiceStatus);
        }
        row.append(createPreview(item.preview), content);
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
    if (!voice || voice.status === "empty") {
      return null;
    }
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

    const duration = document.createElement("span");
    duration.className = "queue-voice-duration";
    duration.dataset.voiceDuration = id;
    duration.textContent = formatDuration(voiceDurationMs(voice));

    wrapper.append(status, duration);
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
      await cancelVoiceRecording(id);
      return;
    }
    if (action === "voice-delete") {
      await deleteVoiceRecording(id);
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
      const mimeType = chooseVoiceMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const chunks = [];
      const startedAt = Date.now();
      const voice = {
        status: "recording",
        startedAt,
        durationMs: 0,
        blob: null,
        mimeType: recorder.mimeType || mimeType || "audio/webm",
        recorder,
        stream,
        chunks,
        timerId: null,
        abortController: null,
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

  async function cancelVoiceRecording(id) {
    const voice = voiceRecordings.get(id);
    if (!voice) {
      return;
    }
    cleanupVoiceRecording(voice);
    voiceRecordings.delete(id);
    updateVoiceRow(id);
    updateSendButton(false);
    setMessage("Voice recording canceled.", "neutral");
  }

  async function deleteVoiceRecording(id) {
    const voice = voiceRecordings.get(id);
    if (voice) {
      cleanupVoiceRecording(voice);
      voiceRecordings.delete(id);
    }
    try {
      await patchQueueVoice(id, null);
      updateVoiceRow(id);
      updateSendButton(false);
      setMessage("Voice note deleted.", "neutral");
    } catch (error) {
      setVoiceError(id, error.message || "Unable to delete voice note.");
    }
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
    setMessage("Voice note recorded. Uploading audio for transcription...", "neutral");
    uploadAndTranscribeVoice(id, voice, token).catch((error) => {
      if (!voiceRecordings.has(id) || voiceRecordings.get(id).token !== token) {
        return;
      }
      setVoiceError(id, error.message || "Unable to upload voice note.");
    });
  }

  async function uploadAndTranscribeVoice(id, voice, token) {
    if (!lastState || !lastState.connection || lastState.connection.status !== "connected" || !lastState.connection.session) {
      throw new Error("Connect the extension before uploading voice notes.");
    }
    if (!voice || voice.token !== token || !voice.blob) {
      return;
    }

    voice.status = "uploading";
    voice.error = "";
    voice.abortController = new AbortController();
    updateVoiceRow(id);

    const settings = lastState.settings || {};
    const session = lastState.connection.session;
    const uploadPayload = await uploadVoiceBlob(settings, session, voice.blob, voice.abortController.signal);
    if (!voiceRecordings.has(id) || voiceRecordings.get(id).token !== token) {
      return;
    }

    voice.status = "transcribing";
    updateVoiceRow(id);
    const transcript = await transcribeVoiceBlob(settings, session, voice.blob, voice.abortController.signal);
    if (!voiceRecordings.has(id) || voiceRecordings.get(id).token !== token) {
      return;
    }

    const voicePatch = buildVoicePatch(uploadPayload.asset, voice, transcript);
    voice.status = transcript.ok ? "uploaded" : "error";
    voice.error = transcript.ok ? "" : voicePatch.transcriptError;
    voice.abortController = null;
    await patchQueueVoice(id, voicePatch);
    updateVoiceRow(id);
    updateSendButton(false);
    setMessage(
      transcript.ok
        ? "Voice note uploaded and transcribed."
        : "Voice note uploaded, but transcription failed. It will be sent with the error.",
      transcript.ok ? "ok" : "error"
    );
  }

  async function uploadVoiceBlob(settings, session, blob, signal) {
    const form = new FormData();
    form.append("kind", "audio");
    form.append("file", blob, voiceFileName(blob.type));
    const response = await fetchWithTimeout(buildAssetUploadUrl(settings.serverUrl, session), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${settings.pairingToken || ""}`
      },
      body: form,
      cache: "no-store",
      signal
    }, VOICE_UPLOAD_TIMEOUT_MS);
    const payload = await readJsonSafely(response);
    if (!response.ok || !payload || !payload.asset) {
      throw new Error(readStatusError(payload, `Voice upload failed (${response.status}).`));
    }
    return payload;
  }

  async function transcribeVoiceBlob(settings, session, blob, signal) {
    const form = new FormData();
    form.append("file", blob, voiceFileName(blob.type));
    try {
      const response = await fetchWithTimeout(buildTranscribeUrl(settings.serverUrl, session), {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${settings.pairingToken || ""}`
        },
        body: form,
        cache: "no-store",
        signal
      }, VOICE_TRANSCRIBE_TIMEOUT_MS);
      const payload = await readJsonSafely(response);
      if (!response.ok || !payload || payload.ok !== true) {
        return {
          ok: false,
          error: readStatusError(payload, `Voice transcription failed (${response.status}).`)
        };
      }
      return {
        ok: true,
        text: typeof payload.text === "string" ? payload.text : "",
        language: typeof payload.language === "string" ? payload.language : ""
      };
    } catch (error) {
      return {
        ok: false,
        error: error.message || "Voice transcription request failed."
      };
    }
  }

  function buildVoicePatch(asset, voice, transcript) {
    return {
      id: `voice-note-${asset.id}`,
      assetId: asset.id,
      mimeType: asset.mimeType || voice.blob.type || "audio/webm",
      byteLength: asset.sizeBytes || voice.blob.size,
      durationMs: voice.durationMs,
      uploadedAtIso: new Date().toISOString(),
      storageKey: asset.absolutePath || "",
      transcriptStatus: transcript.ok ? "complete" : "failed",
      transcriptText: transcript.ok ? transcript.text : "",
      transcriptError: transcript.ok ? "" : transcript.error,
      language: transcript.ok ? transcript.language : ""
    };
  }

  async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: init && init.signal ? anySignal([init.signal, controller.signal]) : controller.signal
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Request timed out after ${timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function anySignal(signals) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    for (const signal of signals) {
      if (signal.aborted) {
        abort();
        break;
      }
      signal.addEventListener("abort", abort, { once: true });
    }
    return controller.signal;
  }

  async function patchQueueVoice(id, voice) {
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.UPDATE_ANNOTATION_QUEUE_ITEM,
      id,
      patch: { voice }
    });
    applyQueueResponse(response);
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
      abortController: null,
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
    if (voice.abortController) {
      voice.abortController.abort();
      voice.abortController = null;
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
    const active = voiceRecordings.get(id);
    if (active && active.status !== "empty") {
      return active;
    }
    const persisted = readPersistedVoice(readQueueItem(id));
    if (persisted) {
      return {
        status: persisted.transcriptStatus === "failed" ? "error" : "uploaded",
        startedAt: 0,
        durationMs: persisted.durationMs || 0,
        blob: null,
        mimeType: persisted.mimeType || "",
        error: persisted.transcriptError || ""
      };
    }
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
        (action === "voice-record" && isVoiceBusy(voice)) ||
        (action === "voice-stop" && voice.status !== "recording") ||
        (action === "voice-cancel" && voice.status !== "recording") ||
        (action === "voice-delete" && !voice.blob && !readPersistedVoice(readQueueItem(id)));
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
      return `Recorded${size}. Waiting to upload.`;
    }
    if (voice.status === "uploading") {
      return "Uploading audio...";
    }
    if (voice.status === "transcribing") {
      return "Transcribing audio...";
    }
    if (voice.status === "uploaded") {
      return "Voice note ready to send.";
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

  function isVoiceBusy(voice) {
    return voice.status === "recording" ||
      voice.status === "stopping" ||
      voice.status === "uploading" ||
      voice.status === "transcribing";
  }

  function chooseVoiceMimeType() {
    if (!globalThis.MediaRecorder || typeof MediaRecorder.isTypeSupported !== "function") {
      return "";
    }
    for (const mimeType of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        return mimeType;
      }
    }
    return "";
  }

  function voiceFileName(mimeType) {
    const normalized = String(mimeType || "").toLowerCase();
    if (normalized.includes("mp4")) {
      return "voice.mp4";
    }
    if (normalized.includes("wav")) {
      return "voice.wav";
    }
    if (normalized.includes("mpeg") || normalized.includes("mp3")) {
      return "voice.mp3";
    }
    return "voice.webm";
  }

  function readQueueItem(id) {
    const queue = lastState && Array.isArray(lastState.queue) ? lastState.queue : [];
    return queue.find((item) => item && item.id === id) || null;
  }

  function readPersistedVoice(item) {
    return item && item.voice && typeof item.voice === "object" ? item.voice : null;
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
    const voiceBusy = Array.from(voiceRecordings.values()).some(isVoiceBusy);
    elements.sendBatch.disabled = isBusy || voiceBusy || itemCount === 0 || !connected;
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
    const aria = context.aria && typeof context.aria === "object" ? context.aria : {};
    const nearby = context.nearby && typeof context.nearby === "object" ? context.nearby : {};
    const labels = Array.isArray(nearby.labels) ? nearby.labels : [];
    const labelSource = [
      aria.label,
      aria.labelledByText,
      labels.length > 0 && labels[0] ? labels[0].text : "",
      context.text
    ].find((value) => typeof value === "string" && value.trim());
    const shortLabel = truncateText(labelSource || readableElementType(context), 72);
    return shortLabel || "Selected element";
  }

  function queueItemMeta(item) {
    const context = item && item.context ? item.context : {};
    const role = context.role ? context.role : readableElementType(context);
    const rect = context.rect && typeof context.rect === "object" ? context.rect : {};
    const size = Number.isFinite(rect.width) && Number.isFinite(rect.height)
      ? `${Math.round(rect.width)}x${Math.round(rect.height)}`
      : "";
    const page = readQueueItemPage(item);
    const pageTitle = page.title ? truncateText(page.title, 42) : "";
    return [role, size, pageTitle].filter(Boolean).join(" - ") || "Selected element";
  }

  function readableElementType(context) {
    const tag = String(context && context.tagName ? context.tagName : "element").toLowerCase();
    const role = context && context.role ? String(context.role) : "";
    if (role) {
      return role;
    }
    if (tag === "img") {
      return "Image";
    }
    if (/^h[1-6]$/.test(tag)) {
      return "Heading";
    }
    if (tag === "a") {
      return "Link";
    }
    if (tag === "button") {
      return "Button";
    }
    if (tag === "input" || tag === "textarea") {
      return "Input";
    }
    return tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : "Element";
  }

  function truncateText(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
  }
})();
