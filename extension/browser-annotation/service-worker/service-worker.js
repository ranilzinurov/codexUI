importScripts(
  "../shared/constants.js",
  "../shared/url-utils.js",
  "../shared/pairing-client.js",
  "../shared/annotation-queue.js",
  "../shared/devtools-capture.js",
  "../shared/screenshot-crop.js"
);

const {
  MESSAGE_TYPES,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  DEVTOOLS_CAPTURE_TIMEOUT_MS,
  MAX_SCREENSHOT_PREVIEW_EDGE_PX,
  MAX_SCREENSHOT_PREVIEW_DATA_URL_CHARS,
  MAX_ANNOTATION_BATCH_BYTES
} = globalThis.BrowserAnnotationConstants;
const {
  normalizeServerUrl,
  isRestrictedTabUrl,
  describeRestrictedUrl
} = globalThis.BrowserAnnotationUrlUtils;
const {
  buildAnnotationBatchUrl,
  buildListenStatusUrl,
  readJsonSafely,
  readStatusError,
  readSessionFromStatusPayload
} = globalThis.BrowserAnnotationPairingClient;
const {
  cropScreenshotDataUrl
} = globalThis.BrowserAnnotationScreenshotCrop;
const {
  buildAnnotationBatchPayload,
  deleteAnnotationQueueItem,
  estimateJsonBytes,
  moveAnnotationQueueItem,
  trimAnnotationQueue,
  updateAnnotationQueueItem
} = globalThis.BrowserAnnotationQueue;
const {
  appendConsoleEvent,
  buildDevtoolsCaptureStatus,
  createDevtoolsCaptureState,
  emptyDevtoolsCaptureState,
  normalizeDevtoolsCaptureState,
  stopDevtoolsCaptureState,
  upsertNetworkEvent
} = globalThis.BrowserAnnotationDevtoolsCapture;

const DEVTOOLS_PROTOCOL_VERSION = "1.3";
const DEVTOOLS_CONSOLE_EVENT_METHODS = new Set([
  "Runtime.consoleAPICalled",
  "Runtime.exceptionThrown",
  "Log.entryAdded"
]);
const DEVTOOLS_NETWORK_EVENT_METHODS = new Set([
  "Network.requestWillBeSent",
  "Network.requestWillBeSentExtraInfo",
  "Network.responseReceived",
  "Network.responseReceivedExtraInfo",
  "Network.loadingFinished",
  "Network.loadingFailed"
]);

let devtoolsCaptureTimer = null;
let devtoolsCaptureTabId = null;

enableActionSidePanelBehavior();

chrome.runtime.onInstalled.addListener(() => {
  enableActionSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  enableActionSidePanelBehavior();
});

chrome.action.onClicked.addListener((tab) => {
  injectOverlayIntoTab(tab).catch((error) => {
    console.warn("Unable to start browser annotation from the extension action.", error);
  });
});

if (chrome.debugger && chrome.debugger.onEvent && chrome.debugger.onDetach) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    handleDebuggerEvent(source, method, params).catch((error) => {
      console.warn("Unable to process debugger event.", error);
    });
  });

  chrome.debugger.onDetach.addListener((source, reason) => {
    handleDebuggerDetach(source, reason).catch((error) => {
      console.warn("Unable to process debugger detach.", error);
    });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (devtoolsCaptureTabId === tabId) {
    stopDevtoolsCapture("tab-closed").catch((error) => {
      console.warn("Unable to stop DevTools capture after tab close.", error);
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message, _sender)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") {
    throw new Error("Unsupported extension message.");
  }

  if (message.type === MESSAGE_TYPES.GET_STATE) {
    return { ok: true, state: await getPanelState() };
  }

  if (message.type === MESSAGE_TYPES.SAVE_SETTINGS) {
    const settings = sanitizeSettings(message.settings || {});
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
    return { ok: true, state: await getPanelState() };
  }

  if (message.type === MESSAGE_TYPES.INJECT_OVERLAY) {
    return injectOverlayIntoActiveTab();
  }

  if (message.type === MESSAGE_TYPES.UPDATE_ANNOTATION_QUEUE_ITEM) {
    return updateQueuedAnnotation(message.id, message.patch);
  }

  if (message.type === MESSAGE_TYPES.DELETE_ANNOTATION_QUEUE_ITEM) {
    return deleteQueuedAnnotation(message.id);
  }

  if (message.type === MESSAGE_TYPES.MOVE_ANNOTATION_QUEUE_ITEM) {
    return moveQueuedAnnotation(message.id, message.direction);
  }

  if (message.type === MESSAGE_TYPES.SEND_ANNOTATION_BATCH) {
    return sendAnnotationBatch();
  }

  if (message.type === MESSAGE_TYPES.START_DEVTOOLS_CAPTURE) {
    return startDevtoolsCapture(message.options || {});
  }

  if (message.type === MESSAGE_TYPES.STOP_DEVTOOLS_CAPTURE) {
    return stopDevtoolsCapture("user-stop");
  }

  if (message.type === MESSAGE_TYPES.GET_DEVTOOLS_CAPTURE_STATUS) {
    return getDevtoolsCaptureStatus();
  }

  if (message.type === MESSAGE_TYPES.CONTENT_PING) {
    return { ok: true };
  }

  if (message.type === MESSAGE_TYPES.CONTENT_ELEMENT_SELECTED) {
    return saveSelectedElementContext(message.context, sender);
  }

  throw new Error(`Unsupported extension message type: ${message.type}`);
}

async function getPanelState() {
  const settings = await readSettings();
  const [connection, activeTab, queue, devtoolsCapture] = await Promise.all([
    validateConnection(settings),
    getActiveTab(),
    readAnnotationQueue(),
    readDevtoolsCaptureState()
  ]);

  return buildPanelState(settings, connection, activeTab, queue, devtoolsCapture);
}

function buildPanelState(settings, connection, activeTab, queue, devtoolsCapture) {
  const tabUrl = activeTab && activeTab.url ? activeTab.url : "";
  const restricted = isRestrictedTabUrl(tabUrl);
  const captureState = normalizeDevtoolsCaptureState(devtoolsCapture);

  return {
    settings,
    connection,
    queue,
    devtoolsCapture: buildDevtoolsCaptureStatus(captureState),
    activeTab: activeTab
      ? {
          id: activeTab.id,
          title: activeTab.title || "",
          url: tabUrl,
          restricted,
          restrictionReason: restricted ? describeRestrictedUrl(tabUrl) : ""
        }
      : null
  };
}

function enableActionSidePanelBehavior() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => {
      console.warn("Unable to enable action-click side panel behavior.", error);
    });
}

async function readSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return {
    ...DEFAULT_SETTINGS,
    ...(stored[STORAGE_KEYS.settings] || {})
  };
}

function sanitizeSettings(settings) {
  return {
    serverUrl: normalizeServerUrl(settings.serverUrl),
    pairingToken: String(settings.pairingToken || "").trim()
  };
}

async function validateConnection(settings) {
  if (!settings.pairingToken) {
    return {
      status: "disconnected",
      checkedAtIso: null,
      session: null,
      detail: "Paste a pairing token from Codex UI to connect."
    };
  }

  const checkedAtIso = new Date().toISOString();
  let statusUrl;
  try {
    statusUrl = buildListenStatusUrl(settings.serverUrl);
  } catch (error) {
    return {
      status: "error",
      checkedAtIso,
      session: null,
      detail: error instanceof Error ? error.message : "Invalid server URL."
    };
  }

  try {
    const response = await fetch(statusUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${settings.pairingToken}`
      },
      cache: "no-store"
    });
    const payload = await readJsonSafely(response);
    if (!response.ok) {
      throw new Error(
        readStatusError(payload, `Pairing status check failed (${response.status}).`)
      );
    }

    const session = readSessionFromStatusPayload(payload);
    if (!session) {
      throw new Error("Pairing status response did not include a valid session.");
    }

    return {
      status: "connected",
      checkedAtIso,
      session,
      detail: `Connected to thread ${session.threadId}.`
    };
  } catch (error) {
    return {
      status: "error",
      checkedAtIso,
      session: null,
      detail: error instanceof Error ? error.message : "Unable to validate pairing token."
    };
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function injectOverlayIntoActiveTab() {
  const tab = await getActiveTab();
  return injectOverlayIntoTab(tab);
}

async function injectOverlayIntoTab(tab) {
  if (!tab || typeof tab.id !== "number") {
    throw new Error("No active tab is available for annotation.");
  }

  if (isRestrictedTabUrl(tab.url)) {
    throw new Error(describeRestrictedUrl(tab.url));
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: [
      "shared/constants.js",
      "shared/selection-context.js",
      "content/content-script.js"
    ]
  });

  const response = await chrome.tabs.sendMessage(tab.id, {
    type: MESSAGE_TYPES.CONTENT_START_OVERLAY
  });

  return {
    ok: true,
    injected: Boolean(response && response.ok),
    state: await getPanelState()
  };
}

async function saveSelectedElementContext(context, sender) {
  if (!context || typeof context !== "object") {
    throw new Error("Selected element context is missing.");
  }

  const previewResult = await captureSelectedElementPreviewSafely(context, sender);
  const queue = await readAnnotationQueue();
  const item = {
    id: `annotation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    kind: "element-selection",
    createdAtIso: new Date().toISOString(),
    tab: sender && sender.tab
      ? {
          id: sender.tab.id,
          title: sender.tab.title || "",
          url: sender.tab.url || ""
        }
      : null,
    context,
    preview: previewResult.preview,
    previewError: previewResult.error
  };
  const nextQueue = trimAnnotationQueue([...queue, item]);
  await writeAnnotationQueue(nextQueue);
  return {
    ok: true,
    queueCount: nextQueue.length,
    item
  };
}

async function readAnnotationQueue() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.annotationQueue);
  const queue = stored[STORAGE_KEYS.annotationQueue];
  return Array.isArray(queue) ? queue : [];
}

async function writeAnnotationQueue(queue) {
  const nextQueue = trimAnnotationQueue(queue);
  await chrome.storage.local.set({
    [STORAGE_KEYS.annotationQueue]: nextQueue
  });
  return nextQueue;
}

async function updateQueuedAnnotation(id, patch) {
  const queue = await readAnnotationQueue();
  const nextQueue = await writeAnnotationQueue(updateAnnotationQueueItem(queue, id, patch));
  return {
    ok: true,
    queue: nextQueue,
    queueCount: nextQueue.length
  };
}

async function deleteQueuedAnnotation(id) {
  const queue = await readAnnotationQueue();
  const nextQueue = await writeAnnotationQueue(deleteAnnotationQueueItem(queue, id));
  return {
    ok: true,
    queue: nextQueue,
    queueCount: nextQueue.length
  };
}

async function moveQueuedAnnotation(id, direction) {
  const queue = await readAnnotationQueue();
  const nextQueue = await writeAnnotationQueue(moveAnnotationQueueItem(queue, id, direction));
  return {
    ok: true,
    queue: nextQueue,
    queueCount: nextQueue.length
  };
}

async function sendAnnotationBatch() {
  const settings = await readSettings();
  const connection = await validateConnection(settings);
  if (connection.status !== "connected" || !connection.session) {
    throw new Error(connection.detail || "Connect the extension before sending annotations.");
  }

  const queue = await readAnnotationQueue();
  if (queue.length === 0) {
    throw new Error("Annotation queue is empty.");
  }

  const devtoolsCapture = await readDevtoolsCaptureState();
  const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : {};
  const batch = buildAnnotationBatchPayload(queue, {
    targetThreadId: connection.session.threadId,
    extensionVersion: manifest.version || "",
    browserName: "Chrome",
    devtoolsCapture
  });
  const payloadBytes = estimateJsonBytes(batch);
  if (payloadBytes > MAX_ANNOTATION_BATCH_BYTES) {
    throw new Error("Annotation batch is too large to send. Delete a few annotations and try again.");
  }

  const response = await fetch(buildAnnotationBatchUrl(settings.serverUrl, connection.session), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${settings.pairingToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(batch),
    cache: "no-store"
  });
  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(readStatusError(payload, `Annotation batch send failed (${response.status}).`));
  }

  await writeAnnotationQueue([]);
  const devtoolsStop = await stopDevtoolsCaptureIfActive("send-complete");
  const activeTab = await getActiveTab();
  const stoppedDevtoolsCapture = await readDevtoolsCaptureState();
  return {
    ok: true,
    result: payload && payload.result ? payload.result : null,
    devtoolsStop,
    state: buildPanelState(settings, connection, activeTab, [], stoppedDevtoolsCapture)
  };
}

async function startDevtoolsCapture(options = {}) {
  assertDebuggerApiAvailable();
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    throw new Error("No active tab is available for DevTools capture.");
  }
  if (isRestrictedTabUrl(tab.url)) {
    throw new Error(describeRestrictedUrl(tab.url));
  }

  await stopDevtoolsCaptureIfActive("replaced");

  const debuggee = { tabId: tab.id };
  const state = createDevtoolsCaptureState(tab, sanitizeDevtoolsCaptureOptions(options));
  try {
    await chrome.debugger.attach(debuggee, DEVTOOLS_PROTOCOL_VERSION);
    await chrome.debugger.sendCommand(debuggee, "Runtime.enable");
    await chrome.debugger.sendCommand(debuggee, "Log.enable");
    await chrome.debugger.sendCommand(debuggee, "Network.enable");
  } catch (error) {
    await safeDetachDebuggee(debuggee);
    const message = error instanceof Error ? error.message : String(error);
    const failedState = stopDevtoolsCaptureState(state, "attach-failed", { error: message });
    await writeDevtoolsCaptureState(failedState);
    throw new Error(`Unable to start DevTools capture: ${message}`);
  }

  devtoolsCaptureTabId = tab.id;
  scheduleDevtoolsCaptureTimeout(tab.id, state.expiresAtIso);
  await writeDevtoolsCaptureState(state);
  return {
    ok: true,
    devtoolsCapture: buildDevtoolsCaptureStatus(state),
    state: await getPanelState()
  };
}

async function stopDevtoolsCapture(reason) {
  const state = await readDevtoolsCaptureState();
  clearDevtoolsCaptureTimeout();
  const tabId = devtoolsCaptureTabId || state.tabId;
  devtoolsCaptureTabId = null;

  if (state.active && typeof tabId === "number") {
    await safeDetachDebuggee({ tabId });
  }

  const stoppedState = stopDevtoolsCaptureState(state, reason || "stopped");
  await writeDevtoolsCaptureState(stoppedState);
  return {
    ok: true,
    devtoolsCapture: buildDevtoolsCaptureStatus(stoppedState),
    state: await getPanelState()
  };
}

async function stopDevtoolsCaptureIfActive(reason) {
  const state = await readDevtoolsCaptureState();
  if (!state.active) {
    return { stopped: false, reason: "" };
  }
  const result = await stopDevtoolsCapture(reason);
  return {
    stopped: true,
    reason,
    devtoolsCapture: result.devtoolsCapture
  };
}

async function getDevtoolsCaptureStatus() {
  const state = await readDevtoolsCaptureState();
  if (state.active && isDevtoolsCaptureExpired(state)) {
    return stopDevtoolsCapture("timeout");
  }
  if (state.active && typeof state.tabId === "number" && !devtoolsCaptureTimer) {
    devtoolsCaptureTabId = state.tabId;
    scheduleDevtoolsCaptureTimeout(state.tabId, state.expiresAtIso);
  }
  return {
    ok: true,
    devtoolsCapture: buildDevtoolsCaptureStatus(state)
  };
}

async function handleDebuggerEvent(source, method, params) {
  const state = await readDevtoolsCaptureState();
  if (!state.active || !source || source.tabId !== state.tabId) {
    return;
  }
  if (isDevtoolsCaptureExpired(state)) {
    await stopDevtoolsCapture("timeout");
    return;
  }

  if (DEVTOOLS_CONSOLE_EVENT_METHODS.has(method)) {
    await writeDevtoolsCaptureState(appendConsoleEvent(state, method, params));
    return;
  }

  if (DEVTOOLS_NETWORK_EVENT_METHODS.has(method)) {
    const nextState = upsertNetworkEvent(state, method, params, state.captureOptions);
    await writeDevtoolsCaptureState(nextState);
    if (method === "Network.loadingFinished") {
      await captureResponseBodyIfAllowed(source, params);
    }
  }
}

async function captureResponseBodyIfAllowed(source, params) {
  const state = await readDevtoolsCaptureState();
  const options = state.captureOptions || {};
  if (!state.active || !options.captureResponseBodies || !source || source.tabId !== state.tabId) {
    return;
  }
  const requestId = params && params.requestId;
  if (!requestId) {
    return;
  }
  const row = state.networkRows.find((item) => item.requestId === requestId);
  if (!row || row.failed || !isTextualDevtoolsMimeType(row.mimeType)) {
    return;
  }
  const byteLength = typeof row.encodedDataLength === "number" ? row.encodedDataLength : undefined;
  if (typeof byteLength === "number" && byteLength > options.bodyCapBytes) {
    return;
  }
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId: state.tabId },
      "Network.getResponseBody",
      { requestId }
    );
    if (!result || result.base64Encoded === true || typeof result.body !== "string") {
      return;
    }
    const nextState = upsertNetworkEvent(
      await readDevtoolsCaptureState(),
      "BrowserAnnotation.responseBodyCaptured",
      {
        requestId,
        bodyText: result.body,
        byteLength,
        mimeType: row.mimeType
      },
      options
    );
    await writeDevtoolsCaptureState(nextState);
  } catch (error) {
    console.warn("Unable to capture DevTools response body.", error);
  }
}

async function handleDebuggerDetach(source, reason) {
  const state = await readDevtoolsCaptureState();
  if (!state.active || !source || source.tabId !== state.tabId) {
    return;
  }
  clearDevtoolsCaptureTimeout();
  devtoolsCaptureTabId = null;
  const stoppedState = stopDevtoolsCaptureState(state, reason || "detached");
  await writeDevtoolsCaptureState(stoppedState);
}

async function readDevtoolsCaptureState() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.devtoolsCapture);
  return normalizeDevtoolsCaptureState(
    stored[STORAGE_KEYS.devtoolsCapture] || emptyDevtoolsCaptureState()
  );
}

async function writeDevtoolsCaptureState(state) {
  const nextState = normalizeDevtoolsCaptureState(state);
  await chrome.storage.local.set({
    [STORAGE_KEYS.devtoolsCapture]: nextState
  });
  return nextState;
}

function scheduleDevtoolsCaptureTimeout(tabId, expiresAtIso) {
  clearDevtoolsCaptureTimeout();
  const delayMs = Math.max(0, Date.parse(expiresAtIso) - Date.now());
  devtoolsCaptureTimer = setTimeout(() => {
    if (devtoolsCaptureTabId !== tabId) {
      return;
    }
    stopDevtoolsCapture("timeout").catch((error) => {
      console.warn("Unable to stop timed-out DevTools capture.", error);
    });
  }, Math.min(delayMs || DEVTOOLS_CAPTURE_TIMEOUT_MS, DEVTOOLS_CAPTURE_TIMEOUT_MS));
}

function clearDevtoolsCaptureTimeout() {
  if (devtoolsCaptureTimer) {
    clearTimeout(devtoolsCaptureTimer);
    devtoolsCaptureTimer = null;
  }
}

function isDevtoolsCaptureExpired(state) {
  const expiresAtMs = Date.parse(state.expiresAtIso);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
}

async function safeDetachDebuggee(debuggee) {
  if (!chrome.debugger || !chrome.debugger.detach) {
    return;
  }
  try {
    await chrome.debugger.detach(debuggee);
  } catch (error) {
    console.warn("Unable to detach debugger target.", error);
  }
}

function assertDebuggerApiAvailable() {
  if (!chrome.debugger || !chrome.debugger.attach || !chrome.debugger.sendCommand) {
    throw new Error(
      "DevTools capture requires the chrome.debugger permission in the extension manifest."
    );
  }
}

function sanitizeDevtoolsCaptureOptions(options) {
  const captureBodies = options.captureBodies === true ||
    options.captureRequestBodies === true ||
    options.captureResponseBodies === true ||
    options.bodyCaptureMode === "request-response" ||
    options.bodyCaptureMode === "full-body-opt-in";
  return {
    bodyCaptureMode: captureBodies ? "full-body-opt-in" : "metadata-only",
    captureRequestBodies: captureBodies,
    captureResponseBodies: captureBodies,
    bodyCapBytes: 16 * 1024
  };
}

function isTextualDevtoolsMimeType(value) {
  const mimeType = String(value || "").toLowerCase();
  return !mimeType ||
    mimeType.startsWith("text/") ||
    mimeType.includes("json") ||
    mimeType.includes("javascript") ||
    mimeType.includes("xml") ||
    mimeType.includes("graphql") ||
    mimeType.includes("form-urlencoded");
}

async function captureSelectedElementPreviewSafely(context, sender) {
  try {
    return {
      preview: await captureSelectedElementPreview(context, sender),
      error: ""
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Unable to capture selected element preview.", error);
    return {
      preview: null,
      error: message
    };
  }
}

async function captureSelectedElementPreview(context, sender) {
  if (!sender || !sender.tab || typeof sender.tab.windowId !== "number") {
    throw new Error("Selected tab information is unavailable for screenshot capture.");
  }
  if (typeof sender.tab.id !== "number") {
    throw new Error("Selected tab id is unavailable for screenshot capture.");
  }
  if (!context.rect || !context.viewport) {
    throw new Error("Selected element context does not include crop geometry.");
  }

  const selectedTab = await chrome.tabs.get(sender.tab.id);
  if (!selectedTab.active) {
    throw new Error("Selected tab is no longer active for visible-tab capture.");
  }

  const dataUrl = await chrome.tabs.captureVisibleTab(sender.tab.windowId, {
    format: "png"
  });
  return cropScreenshotDataUrl(dataUrl, context.rect, context.viewport, {
    maxPreviewEdgePx: MAX_SCREENSHOT_PREVIEW_EDGE_PX,
    maxPreviewDataUrlChars: MAX_SCREENSHOT_PREVIEW_DATA_URL_CHARS,
    mimeType: "image/png"
  });
}
