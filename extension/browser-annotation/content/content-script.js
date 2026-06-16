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
  const CONTENT_TRANSCRIBE_AUDIO_MESSAGE =
    MESSAGE_TYPES.CONTENT_TRANSCRIBE_AUDIO || "browserAnnotation.contentTranscribeAudio";
  const CONTENT_TRANSCRIPTION_RESULT_MESSAGE =
    MESSAGE_TYPES.CONTENT_TRANSCRIPTION_RESULT || "browserAnnotation.contentTranscriptionResult";
  let overlay = null;
  let active = false;
  let hoveredElement = null;
  let selectedSelection = null;
  let selectedDraftContext = null;
  let selectedDraftId = "";
  let selectedDraftScreenshotEnabled = true;
  let selectedQueueItemId = "";
  let currentSelectionToken = 0;
  const canceledSelectionTokens = new Set();
  let pendingHoverRect = false;
  let dragState = null;
  let ignoreClickUntil = 0;
  let noteUpdateTimer = 0;
  let pendingNoteText = "";
  let noteUpdateSequence = 0;
  let voiceRecorder = null;
  let voiceStream = null;
  let voiceChunks = [];
  let voiceRecordingToken = "";
  let voiceRecordingStartedAt = 0;
  let voiceRecordingSequence = 0;
  let activeTranscription = null;
  let noteUpdateQueue = Promise.resolve();
  let lastKnownQueueCount = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message) {
      return false;
    }

    if (message.type === CONTENT_TRANSCRIPTION_RESULT_MESSAGE) {
      applyTranscriptionResult(message);
      sendResponse({ ok: true });
      return true;
    }

    if (message.type !== MESSAGE_TYPES.CONTENT_START_OVERLAY) {
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
    const wasActive = active;
    active = true;
    if (selectedSelection) {
      updateSelectedOverlay();
      showSelectionPanel(selectedSelection.label || "Selection", selectedQueueItemId ? "Saved" : "Saving...");
    } else {
      setIdlePanel("Click an element or drag an area");
    }

    if (wasActive) {
      return;
    }

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
      hideOverlayVisuals({ hideHost: true });
    }
  }

  function hideOverlayVisuals(options = {}) {
    if (!overlay) {
      return;
    }
    overlay.hoverBox.hidden = true;
    overlay.dragBox.hidden = true;
    overlay.selectedBox.hidden = true;
    overlay.panel.hidden = true;
    overlay.floatingPanel.hidden = true;
    overlay.noteWrap.hidden = true;
    overlay.noteButton.setAttribute("aria-expanded", "false");
    overlay.panel.classList.remove("has-note", "is-selection");
    if (options.hideHost === true) {
      overlay.host.hidden = true;
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
    const floatingPanel = createFloatingPanel();
    shadow.append(style, hoverBox, dragBox, selectedBox, panel.container, floatingPanel.container);

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
      screenshotButton: panel.screenshotButton,
      saveButton: panel.saveButton,
      noteWrap: panel.noteWrap,
      noteInput: panel.noteInput,
      floatingPanel: floatingPanel.container,
      floatingStatus: floatingPanel.status,
      floatingPickState: floatingPanel.pickState,
      floatingQueueCount: floatingPanel.queueCount,
      floatingDraftActions: floatingPanel.draftActions,
      floatingNoteButton: floatingPanel.noteButton,
      floatingMicButton: floatingPanel.micButton,
      floatingScreenshotButton: floatingPanel.screenshotButton,
      floatingSaveButton: floatingPanel.saveButton,
      floatingPauseButton: floatingPanel.pauseButton
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
    beginDraftSelection(context, label);
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
    beginDraftSelection(context, "Selected area");
  }

  function beginDraftSelection(context, label) {
    selectedQueueItemId = "";
    selectedDraftContext = context;
    selectedDraftId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    selectedDraftScreenshotEnabled = true;
    activeTranscription = null;
    pendingNoteText = "";
    clearTimeout(noteUpdateTimer);
    stopVoiceInput({ discard: true, silent: true });
    overlay.noteInput.value = "";
    overlay.noteWrap.hidden = true;
    overlay.noteButton.setAttribute("aria-expanded", "false");

    const selectionToken = currentSelectionToken + 1;
    currentSelectionToken = selectionToken;
    canceledSelectionTokens.delete(selectionToken);

    updateSelectedOverlay();
    showSelectionPanel(label, "Draft");
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (selectedSelection || selectedQueueItemId) {
        cancelSelectedAnnotation({ pause: true, hideHost: true });
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
    selectedDraftContext = null;
    selectedDraftId = "";
    selectedSelection = null;
    pendingNoteText = "";
    clearTimeout(noteUpdateTimer);
    activeTranscription = null;
    stopVoiceInput({ discard: true, silent: true });
    if (overlay) {
      overlay.selectedBox.hidden = true;
      overlay.noteInput.value = "";
      overlay.noteWrap.hidden = true;
      overlay.noteButton.setAttribute("aria-expanded", "false");
      overlay.panel.classList.remove("has-note");
      if (shouldPause && options.hideHost === true) {
        hideOverlayVisuals({ hideHost: true });
      } else {
        setIdlePanel("Click an element or drag an area");
      }
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
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.DELETE_ANNOTATION_QUEUE_ITEM,
        id
      });
      rememberQueueCount(response);
      updateFloatingPanel();
    } catch (error) {
      console.warn("Unable to delete selected annotation.", error);
      if (overlay) {
        overlay.panelMeta.textContent = "Could not close";
        updateFloatingPanel();
      }
    }
  }

  function scheduleNoteUpdate() {
    pendingNoteText = overlay.noteInput.value;
    clearTimeout(noteUpdateTimer);
    if (!selectedQueueItemId) {
      overlay.panelMeta.textContent = "Draft";
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
        rememberQueueCount(response);
        updateFloatingPanel();
      }
    } catch (error) {
      console.warn("Unable to save annotation note.", error);
      if (queueItemId === selectedQueueItemId) {
        overlay.panelMeta.textContent = "Could not save note";
      }
    }
  }

  function toggleNoteInput() {
    if (!overlay) {
      return;
    }
    const nextHidden = !overlay.noteWrap.hidden;
    overlay.noteWrap.hidden = nextHidden;
    overlay.noteButton.setAttribute("aria-expanded", String(!nextHidden));
    if (overlay.floatingNoteButton) {
      overlay.floatingNoteButton.setAttribute("aria-expanded", String(!nextHidden));
    }
    overlay.panel.classList.toggle("has-note", !nextHidden);
    updateFloatingPanel();
    updateSelectedOverlay();
    if (!nextHidden) {
      window.setTimeout(() => overlay.noteInput.focus(), 0);
    }
  }

  function toggleVoiceInput() {
    if (voiceRecorder) {
      stopVoiceInput();
      return;
    }
    startVoiceInput();
  }

  async function startVoiceInput() {
    if (!overlay) {
      return;
    }

    const activeItemId = selectedQueueItemId || selectedDraftId;
    if (!activeItemId) {
      overlay.panelMeta.textContent = "Select a target first";
      return;
    }
    if (!globalThis.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      overlay.panelMeta.textContent = "Voice recording is not available";
      return;
    }

    stopVoiceInput({ discard: true, silent: true });
    const recordingToken = createRecordingToken();
    const queueItemId = activeItemId;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isActiveDraftOrQueueItem(queueItemId) || recordingToken !== voiceRecordingToken) {
        stopStream(stream);
        return;
      }
      const mimeType = chooseRecordingMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      voiceRecorder = recorder;
      voiceStream = stream;
      voiceChunks = [];
      voiceRecordingStartedAt = performance.now();
      activeTranscription = null;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          voiceChunks.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        const chunks = voiceChunks.slice();
        const stoppedToken = recordingToken;
        const stoppedQueueItemId = queueItemId;
        const stoppedMimeType = recorder.mimeType || mimeType || "";
        const durationMs = Math.max(0, Math.round(performance.now() - voiceRecordingStartedAt));
        voiceRecorder = null;
        voiceChunks = [];
        stopStream(stream);
        if (voiceStream === stream) {
          voiceStream = null;
        }
        resetVoiceButton();
        if (stoppedToken !== voiceRecordingToken) {
          return;
        }
        if (!isActiveDraftOrQueueItem(stoppedQueueItemId)) {
          return;
        }
        if (chunks.length === 0) {
          overlay.panelMeta.textContent = "No audio captured";
          return;
        }
        const blob = new Blob(chunks, { type: stoppedMimeType || "audio/webm" });
        void sendVoiceRecordingForTranscription({
          itemId: stoppedQueueItemId,
          recordingToken: stoppedToken,
          mimeType: blob.type || stoppedMimeType,
          durationMs,
          blob
        });
      });

      recorder.start();
    } catch (error) {
      voiceRecorder = null;
      voiceChunks = [];
      if (voiceStream) {
        stopStream(voiceStream);
        voiceStream = null;
      }
      console.warn("Unable to start voice recording.", error);
      resetVoiceButton();
      overlay.panelMeta.textContent = readVoiceErrorMessage(error && error.name);
      return;
    }

    overlay.micButton.textContent = "■";
    overlay.micButton.classList.add("is-recording");
    overlay.micButton.setAttribute("aria-label", "Stop voice recording");
    overlay.micButton.title = "Stop voice recording";
    if (overlay.floatingMicButton) {
      overlay.floatingMicButton.textContent = "■";
      overlay.floatingMicButton.classList.add("is-recording");
      overlay.floatingMicButton.setAttribute("aria-label", "Stop voice recording");
      overlay.floatingMicButton.title = "Stop voice recording";
    }
    overlay.panelMeta.textContent = "Recording...";
    updateFloatingPanel();
  }

  function stopVoiceInput(options = {}) {
    const recorder = voiceRecorder;
    if (!recorder) {
      resetVoiceButton();
      if (options.discard === true) {
        voiceRecordingToken = "";
      }
      return;
    }
    if (options.discard === true) {
      voiceRecordingToken = "";
      voiceChunks = [];
    }
    try {
      recorder.stop();
    } catch (_error) {
      // MediaRecorder can already be inactive when the user cancels quickly.
    }
    if (overlay && options.silent !== true) {
      resetVoiceButton();
      overlay.panelMeta.textContent = options.discard === true ? "Recording canceled" : "Transcribing...";
    } else {
      resetVoiceButton();
    }
  }

  function createRecordingToken() {
    voiceRecordingSequence += 1;
    voiceRecordingToken = `${Date.now()}-${voiceRecordingSequence}`;
    return voiceRecordingToken;
  }

  async function sendVoiceRecordingForTranscription(recording) {
    if (!overlay) {
      return;
    }
    activeTranscription = {
      itemId: recording.itemId,
      recordingToken: recording.recordingToken
    };
    overlay.panelMeta.textContent = "Transcribing...";
    try {
      const audioDataUrl = await readBlobDataUrl(recording.blob);
      const response = await chrome.runtime.sendMessage({
        type: CONTENT_TRANSCRIBE_AUDIO_MESSAGE,
        itemId: recording.itemId,
        recordingToken: recording.recordingToken,
        mimeType: recording.mimeType,
        durationMs: recording.durationMs,
        byteLength: recording.blob.size,
        audioDataUrl
      });
      if (response && response.ok === false) {
        throw new Error(response.error || "Voice transcription was not accepted.");
      }
      if (response && readTranscriptText(response)) {
        applyTranscriptionResult({
          itemId: recording.itemId,
          recordingToken: recording.recordingToken,
          transcriptText: readTranscriptText(response)
        });
        return;
      }
      if (isCurrentTranscription(recording.itemId, recording.recordingToken)) {
        overlay.panelMeta.textContent = "Transcription pending";
      }
    } catch (error) {
      console.warn("Unable to send voice recording for transcription.", error);
      if (isCurrentTranscription(recording.itemId, recording.recordingToken)) {
        overlay.panelMeta.textContent = readTranscriptionErrorMessage(error);
      }
    }
  }

  function readBlobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        resolve(typeof reader.result === "string" ? reader.result : "");
      }, { once: true });
      reader.addEventListener("error", () => {
        reject(reader.error || new Error("Unable to read recorded audio."));
      }, { once: true });
      reader.readAsDataURL(blob);
    });
  }

  function applyTranscriptionResult(message) {
    const itemId = message && message.itemId ? String(message.itemId) : "";
    const recordingToken = message && message.recordingToken ? String(message.recordingToken) : "";
    if (!isCurrentTranscription(itemId, recordingToken)) {
      return;
    }
    const transcript = readTranscriptText(message);
    if (transcript) {
      if (overlay && overlay.noteWrap.hidden) {
        toggleNoteInput();
      }
      appendNoteText(transcript);
      if (overlay) {
        overlay.panelMeta.textContent = "Transcript added";
      }
    } else if (overlay) {
      overlay.panelMeta.textContent = message && message.error ? "Transcription failed" : "Transcription complete";
    }
    activeTranscription = null;
  }

  function isCurrentTranscription(itemId, recordingToken) {
    return Boolean(
      itemId &&
        recordingToken &&
        activeTranscription &&
        activeTranscription.itemId === itemId &&
        activeTranscription.recordingToken === recordingToken &&
        isActiveDraftOrQueueItem(itemId)
    );
  }

  function isActiveDraftOrQueueItem(itemId) {
    return Boolean(itemId && (selectedQueueItemId === itemId || selectedDraftId === itemId));
  }

  function readTranscriptText(value) {
    if (!value || typeof value !== "object") {
      return "";
    }
    if (typeof value.transcriptText === "string") {
      return selectionContext.normalizeText(value.transcriptText, constants.MAX_ANNOTATION_NOTE_CHARS || 2000);
    }
    if (typeof value.text === "string") {
      return selectionContext.normalizeText(value.text, constants.MAX_ANNOTATION_NOTE_CHARS || 2000);
    }
    if (value.transcript && typeof value.transcript.text === "string") {
      return selectionContext.normalizeText(value.transcript.text, constants.MAX_ANNOTATION_NOTE_CHARS || 2000);
    }
    return "";
  }

  function chooseRecordingMimeType() {
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

  function stopStream(stream) {
    if (!stream || typeof stream.getTracks !== "function") {
      return;
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch (_error) {
        // Ignore track shutdown races.
      }
    }
  }

  function appendNoteText(text) {
    const normalized = selectionContext.normalizeText(text, 1000);
    if (!normalized || !overlay) {
      return;
    }
    const current = overlay.noteInput.value.trim();
    overlay.noteInput.value = current ? `${current} ${normalized}` : normalized;
    scheduleNoteUpdate();
  }

  async function saveDraftAnnotation() {
    if (!overlay || !selectedDraftContext || selectedQueueItemId) {
      return;
    }
    const draftToken = currentSelectionToken;
    const context = selectedDraftContext;
    const noteText = overlay.noteInput.value.trim();
    overlay.panelMeta.textContent = selectedDraftScreenshotEnabled ? "Saving screenshot..." : "Saving...";
    overlay.saveButton.disabled = true;
    updateFloatingPanel();
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.CONTENT_SAVE_DRAFT_ANNOTATION,
        context,
        noteText,
        screenshotEnabled: selectedDraftScreenshotEnabled
      });
      if (!response || response.ok !== true) {
        throw new Error(
          response && response.error
            ? response.error
            : "Draft was not saved by the extension."
        );
      }
      if (draftToken !== currentSelectionToken || canceledSelectionTokens.has(draftToken)) {
        const queuedItemId = response.item && response.item.id ? String(response.item.id) : "";
        if (queuedItemId) {
          void deleteQueuedAnnotation(queuedItemId);
        }
        canceledSelectionTokens.delete(draftToken);
        return;
      }
      selectedQueueItemId = response.item && response.item.id ? String(response.item.id) : "";
      selectedDraftContext = null;
      selectedDraftId = "";
      rememberQueueCount(response);
      overlay.panelMeta.textContent = "Saved";
      overlay.saveButton.hidden = true;
      overlay.screenshotButton.disabled = true;
      updateFloatingPanel();
    } catch (error) {
      console.warn("Unable to save draft annotation.", error);
      overlay.panelMeta.textContent = "Could not save";
      overlay.saveButton.disabled = false;
      updateFloatingPanel();
    }
  }

  function toggleScreenshotCapture() {
    selectedDraftScreenshotEnabled = !selectedDraftScreenshotEnabled;
    updateScreenshotButton();
    if (overlay && !selectedQueueItemId) {
      overlay.panelMeta.textContent = selectedDraftScreenshotEnabled ? "Draft" : "Draft - screenshot off";
    }
  }

  function updateScreenshotButton() {
    if (!overlay || !overlay.screenshotButton) {
      return;
    }
    overlay.screenshotButton.textContent = selectedDraftScreenshotEnabled ? "▣" : "□";
    overlay.screenshotButton.title = selectedDraftScreenshotEnabled ? "Screenshot on" : "Screenshot off";
    overlay.screenshotButton.setAttribute("aria-pressed", String(selectedDraftScreenshotEnabled));
    if (overlay.floatingScreenshotButton) {
      overlay.floatingScreenshotButton.textContent = selectedDraftScreenshotEnabled ? "▣" : "□";
      overlay.floatingScreenshotButton.title = selectedDraftScreenshotEnabled ? "Screenshot on" : "Screenshot off";
      overlay.floatingScreenshotButton.setAttribute("aria-pressed", String(selectedDraftScreenshotEnabled));
    }
  }

  function resetVoiceButton() {
    if (!overlay) {
      return;
    }
    overlay.micButton.textContent = "●";
    overlay.micButton.classList.remove("is-recording");
    overlay.micButton.setAttribute("aria-label", "Start voice recording");
    overlay.micButton.title = "Record voice comment";
    if (overlay.floatingMicButton) {
      overlay.floatingMicButton.textContent = "●";
      overlay.floatingMicButton.classList.remove("is-recording");
      overlay.floatingMicButton.setAttribute("aria-label", "Start voice recording");
      overlay.floatingMicButton.title = "Record voice comment";
    }
  }

  function readVoiceErrorMessage(errorName) {
    if (errorName === "NotAllowedError" || errorName === "SecurityError") {
      return "Microphone permission needed";
    }
    if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
      return "Microphone unavailable";
    }
    return "Voice recording failed";
  }

  function readTranscriptionErrorMessage(error) {
    const message = error && typeof error.message === "string"
      ? selectionContext.normalizeText(error.message, 96)
      : "";
    if (/no audio/i.test(message)) {
      return "No audio captured";
    }
    if (!message) {
      return "Voice transcription unavailable";
    }
    return `Voice transcription unavailable: ${message}`;
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
    overlay.panel.classList.remove("is-selection", "has-note");
    overlay.panelLabel.textContent = label;
    overlay.panelMeta.textContent = "Esc to exit";
    overlay.actions.hidden = true;
    overlay.noteWrap.hidden = true;
    overlay.panel.style.left = "";
    overlay.panel.style.top = "";
    overlay.panel.style.right = "16px";
    overlay.panel.style.bottom = "16px";
    updateFloatingPanel();
  }

  function showSelectionPanel(label, meta) {
    if (!overlay) {
      return;
    }
    overlay.panel.hidden = false;
    overlay.panel.classList.remove("is-idle");
    overlay.panel.classList.add("is-selection");
    overlay.panel.classList.toggle("has-note", !overlay.noteWrap.hidden);
    overlay.panelLabel.textContent = label;
    overlay.panelMeta.textContent = meta;
    overlay.actions.hidden = false;
    overlay.saveButton.hidden = Boolean(selectedQueueItemId);
    overlay.saveButton.disabled = false;
    overlay.screenshotButton.hidden = false;
    overlay.screenshotButton.disabled = Boolean(selectedQueueItemId);
    updateScreenshotButton();
    updateFloatingPanel();
    const rect = readSelectedRect(selectedSelection);
    if (rect) {
      positionPanelForRect(rect);
    }
  }

  function rememberQueueCount(response) {
    if (response && Number.isFinite(response.queueCount)) {
      lastKnownQueueCount = Math.max(0, Math.round(response.queueCount));
    }
  }

  function updateFloatingPanel() {
    if (!overlay || !overlay.floatingPanel) {
      return;
    }
    overlay.floatingPanel.hidden = !active;
    if (!active) {
      return;
    }
    const hasSelection = Boolean(selectedSelection);
    const hasSavedDraft = Boolean(selectedQueueItemId);
    const hasUnsavedDraft = Boolean(selectedDraftContext || selectedDraftId);
    overlay.floatingStatus.textContent = "Codex annotation";
    overlay.floatingPickState.textContent = hasSelection
      ? hasSavedDraft
        ? "Pick saved"
        : "Draft selected"
      : "Pick on Page active";
    overlay.floatingQueueCount.textContent = lastKnownQueueCount === null
      ? ""
      : `${lastKnownQueueCount} queued`;
    overlay.floatingQueueCount.hidden = lastKnownQueueCount === null;
    overlay.floatingDraftActions.hidden = !hasSelection;
    overlay.floatingNoteButton.disabled = !hasSelection;
    overlay.floatingMicButton.disabled = !hasSelection;
    overlay.floatingScreenshotButton.disabled = !hasUnsavedDraft;
    overlay.floatingSaveButton.hidden = !hasUnsavedDraft;
    overlay.floatingSaveButton.disabled = !hasUnsavedDraft || overlay.saveButton.disabled;
    overlay.floatingNoteButton.setAttribute("aria-expanded", overlay.noteButton.getAttribute("aria-expanded") || "false");
    updateScreenshotButton();
  }

  function positionPanelForRect(rect) {
    if (!overlay || !rect) {
      return;
    }
    overlay.panel.style.right = "auto";
    overlay.panel.style.bottom = "auto";
    const gap = 8;
    const margin = 8;
    const panelWidth = overlay.panel.offsetWidth || 132;
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

      .floating-panel {
        position: fixed;
        top: 16px;
        right: 16px;
        display: grid;
        gap: 8px;
        width: min(260px, calc(100vw - 32px));
        box-sizing: border-box;
        color: #f8fafc;
        background: #111827;
        border: 1px solid rgba(148, 163, 184, 0.45);
        border-radius: 8px;
        box-shadow: 0 18px 45px rgba(15, 23, 42, 0.35);
        padding: 10px;
        pointer-events: auto;
      }

      .floating-header {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: 8px;
      }

      .floating-copy {
        min-width: 0;
      }

      .floating-status {
        overflow: hidden;
        color: #f8fafc;
        font-size: 12px;
        font-weight: 700;
        line-height: 1.2;
        margin: 0;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .floating-pick-state,
      .floating-queue-count {
        color: #cbd5e1;
        font-size: 11px;
        line-height: 1.25;
        margin: 2px 0 0;
      }

      .floating-actions,
      .floating-draft-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .floating-draft-actions {
        border-top: 1px solid rgba(148, 163, 184, 0.22);
        padding-top: 8px;
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

      .panel.is-selection {
        grid-template-columns: auto;
        gap: 0;
        max-width: min(320px, calc(100vw - 16px));
        color: #172033;
        background: #f8fafc;
        border-color: rgba(15, 23, 42, 0.18);
        border-radius: 999px;
        box-shadow: 0 10px 28px rgba(15, 23, 42, 0.22);
        padding: 4px;
      }

      .panel.is-selection.has-note {
        border-radius: 8px;
        gap: 6px;
      }

      .copy {
        min-width: 0;
      }

      .panel.is-selection .copy {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        clip-path: inset(50%);
        white-space: nowrap;
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

      .panel.is-selection .action {
        width: 30px;
        min-width: 30px;
        color: #172033;
        background: transparent;
        border-color: transparent;
        border-radius: 6px;
        font-size: 15px;
        padding: 0;
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

      .panel.is-selection .action:hover:not(:disabled) {
        background: #e2e8f0;
      }

      .floating-panel .action:hover:not(:disabled) {
        background: #374151;
      }

      .action:disabled {
        color: #94a3b8;
        cursor: not-allowed;
        opacity: 0.65;
      }

      .action.is-recording {
        color: #fee2e2;
        background: #991b1b;
        border-color: rgba(254, 202, 202, 0.45);
      }

      .panel.is-selection .action.is-recording {
        color: #fef2f2;
        background: #b91c1c;
      }

      .action:focus-visible,
      .note-input:focus-visible {
        outline: 2px solid #93c5fd;
        outline-offset: 2px;
      }

      .note-wrap {
        grid-column: 1 / -1;
      }

      .panel.is-selection .note-wrap {
        padding: 0 2px 2px;
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

      .panel.is-selection .note-input {
        width: min(280px, calc(100vw - 32px));
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
    cancelButton.textContent = "×";
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
    noteButton.textContent = "✎";

    const micButton = document.createElement("button");
    micButton.className = "action";
    micButton.type = "button";
    micButton.title = "Record voice comment";
    micButton.setAttribute("aria-label", "Start voice recording");
    micButton.textContent = "●";

    const screenshotButton = document.createElement("button");
    screenshotButton.className = "action";
    screenshotButton.type = "button";
    screenshotButton.title = "Screenshot on";
    screenshotButton.setAttribute("aria-label", "Toggle screenshot");
    screenshotButton.setAttribute("aria-pressed", "true");
    screenshotButton.textContent = "▣";

    const saveButton = document.createElement("button");
    saveButton.className = "action action-save";
    saveButton.type = "button";
    saveButton.title = "Save to Queue";
    saveButton.setAttribute("aria-label", "Save to Queue");
    saveButton.textContent = "Save";

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
      toggleNoteInput();
    });

    micButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleVoiceInput();
    });

    screenshotButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleScreenshotCapture();
    });

    saveButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void saveDraftAnnotation();
    });

    actions.append(noteButton, micButton, screenshotButton, saveButton, cancelButton);
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
      screenshotButton,
      saveButton,
      noteWrap,
      noteInput
    };
  }

  function createFloatingPanel() {
    const panel = document.createElement("div");
    panel.className = "floating-panel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Codex annotation floating panel");

    const header = document.createElement("div");
    header.className = "floating-header";

    const copy = document.createElement("div");
    copy.className = "floating-copy";

    const status = document.createElement("p");
    status.className = "floating-status";
    status.textContent = "Codex annotation";

    const pickState = document.createElement("p");
    pickState.className = "floating-pick-state";
    pickState.textContent = "Pick on Page active";

    const queueCount = document.createElement("p");
    queueCount.className = "floating-queue-count";
    queueCount.hidden = true;

    const floatingActions = document.createElement("div");
    floatingActions.className = "floating-actions";

    const pauseButton = document.createElement("button");
    pauseButton.className = "action";
    pauseButton.type = "button";
    pauseButton.title = "Pause annotation mode";
    pauseButton.setAttribute("aria-label", "Pause annotation mode");
    pauseButton.textContent = "Pause";
    pauseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      stopAnnotationMode();
    });

    const draftActions = document.createElement("div");
    draftActions.className = "floating-draft-actions";
    draftActions.hidden = true;

    const noteButton = document.createElement("button");
    noteButton.className = "action";
    noteButton.type = "button";
    noteButton.title = "Add comment";
    noteButton.setAttribute("aria-label", "Floating add comment");
    noteButton.setAttribute("aria-expanded", "false");
    noteButton.textContent = "✎";
    noteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleNoteInput();
    });

    const micButton = document.createElement("button");
    micButton.className = "action";
    micButton.type = "button";
    micButton.title = "Record voice comment";
    micButton.setAttribute("aria-label", "Start voice recording");
    micButton.textContent = "●";
    micButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleVoiceInput();
    });

    const screenshotButton = document.createElement("button");
    screenshotButton.className = "action";
    screenshotButton.type = "button";
    screenshotButton.title = "Screenshot on";
    screenshotButton.setAttribute("aria-label", "Floating toggle screenshot");
    screenshotButton.setAttribute("aria-pressed", "true");
    screenshotButton.textContent = "▣";
    screenshotButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleScreenshotCapture();
    });

    const saveButton = document.createElement("button");
    saveButton.className = "action action-save";
    saveButton.type = "button";
    saveButton.title = "Save to Queue";
    saveButton.setAttribute("aria-label", "Floating save to Queue");
    saveButton.textContent = "Save";
    saveButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void saveDraftAnnotation();
    });

    copy.append(status, pickState, queueCount);
    floatingActions.append(pauseButton);
    header.append(copy, floatingActions);
    draftActions.append(noteButton, micButton, screenshotButton, saveButton);
    panel.append(header, draftActions);

    return {
      container: panel,
      status,
      pickState,
      queueCount,
      draftActions,
      noteButton,
      micButton,
      screenshotButton,
      saveButton,
      pauseButton
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
