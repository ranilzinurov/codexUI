importScripts(
  "../shared/constants.js",
  "../shared/url-utils.js",
  "../shared/pairing-client.js",
  "../shared/annotation-queue.js",
  "../shared/screenshot-crop.js"
);

const {
  MESSAGE_TYPES,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
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
  const [connection, activeTab, queue] = await Promise.all([
    validateConnection(settings),
    getActiveTab(),
    readAnnotationQueue()
  ]);

  return buildPanelState(settings, connection, activeTab, queue);
}

function buildPanelState(settings, connection, activeTab, queue) {
  const tabUrl = activeTab && activeTab.url ? activeTab.url : "";
  const restricted = isRestrictedTabUrl(tabUrl);

  return {
    settings,
    connection,
    queue,
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

  const preview = await captureSelectedElementPreview(context, sender);
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
    preview
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

  const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : {};
  const batch = buildAnnotationBatchPayload(queue, {
    targetThreadId: connection.session.threadId,
    extensionVersion: manifest.version || "",
    browserName: "Chrome"
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
  const activeTab = await getActiveTab();
  return {
    ok: true,
    result: payload && payload.result ? payload.result : null,
    state: buildPanelState(settings, connection, activeTab, [])
  };
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
