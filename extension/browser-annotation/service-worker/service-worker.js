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
  describeRestrictedUrl,
  getTabOriginPattern
} = globalThis.BrowserAnnotationUrlUtils;
const {
  buildAnnotationBatchUrl,
  buildBindingCompleteUrl,
  buildBindingStatusUrl,
  buildBrowserBindingRevokeUrl,
  buildListenBindThreadUrl,
  buildListenStatusUrl,
  buildListenStopUrl,
  buildThreadTargetsUrl,
  buildTranscribeUrl,
  readJsonSafely,
  readBindingFromStatusPayload,
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
  sanitizeNoteText,
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
const DEVTOOLS_CAPTURE_TIMEOUT_ALARM = "browserAnnotation.devtoolsCaptureTimeout";
const STATUS_FETCH_TIMEOUT_MS = 8000;
const BATCH_SEND_TIMEOUT_MS = 30000;
const REVOKE_FETCH_TIMEOUT_MS = 8000;
const TRANSCRIBE_FETCH_TIMEOUT_MS = 60000;

let devtoolsCaptureTimer = null;
let devtoolsCaptureTabId = null;
let devtoolsCapturePersistenceQueue = Promise.resolve();
let annotationQueueMutationQueue = Promise.resolve();
const DEVTOOLS_CAPTURE_NO_WRITE = Symbol("devtoolsCaptureNoWrite");

enableActionSidePanelBehavior();

chrome.runtime.onInstalled.addListener(() => {
  enableActionSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  enableActionSidePanelBehavior();
  reconcileDevtoolsCaptureTimeout("startup").catch((error) => {
    console.warn("Unable to reconcile DevTools capture timeout on startup.", error);
  });
});

chrome.action.onClicked.addListener((tab) => {
  enableActionSidePanelBehavior();
  if (tab && tab.url && isRestrictedTabUrl(tab.url)) {
    console.warn("Browser annotation side panel opened on a restricted page.", describeRestrictedUrl(tab.url));
  }
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

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== DEVTOOLS_CAPTURE_TIMEOUT_ALARM) {
      return;
    }
    reconcileDevtoolsCaptureTimeout("alarm").catch((error) => {
      console.warn("Unable to reconcile DevTools capture timeout alarm.", error);
    });
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  stopDevtoolsCaptureForClosedTab(tabId).catch((error) => {
    console.warn("Unable to stop DevTools capture after tab close.", error);
  });
});

if (chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    stopDevtoolsCaptureForNavigation(tabId, changeInfo).catch((error) => {
      console.warn("Unable to stop DevTools capture after tab navigation.", error);
    });
  });
}

async function stopDevtoolsCaptureForClosedTab(tabId) {
  if (devtoolsCaptureTabId === tabId) {
    await stopDevtoolsCapture("tab-closed");
    return;
  }
  const state = await readDevtoolsCaptureState();
  if (state.active && state.tabId === tabId) {
    await stopDevtoolsCapture("tab-closed");
  }
}

async function stopDevtoolsCaptureForNavigation(tabId, changeInfo) {
  const isNavigation = Boolean(changeInfo && (changeInfo.url || changeInfo.status === "loading"));
  if (!isNavigation) {
    return;
  }
  if (devtoolsCaptureTabId === tabId) {
    await stopDevtoolsCapture("tab-navigated");
    return;
  }
  const state = await readDevtoolsCaptureState();
  if (state.active && state.tabId === tabId) {
    await stopDevtoolsCapture("tab-navigated");
  }
}

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
    return saveSettings(message.settings || {});
  }

  if (message.type === MESSAGE_TYPES.DISCONNECT_BINDING) {
    return disconnectBinding();
  }

  if (message.type === MESSAGE_TYPES.SELECT_THREAD_TARGET) {
    return selectThreadTarget(message.threadId);
  }

  if (message.type === MESSAGE_TYPES.INJECT_OVERLAY) {
    return injectOverlayIntoActiveTab();
  }

  if (message.type === MESSAGE_TYPES.ADD_PAGE_STATE_ANNOTATION) {
    return addPageStateAnnotation(message.noteText);
  }

  if (message.type === MESSAGE_TYPES.CONTENT_SAVE_DRAFT_ANNOTATION) {
    return saveDraftAnnotation(message, sender);
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

  if (
    message.type === MESSAGE_TYPES.CONTENT_TRANSCRIBE_AUDIO ||
    message.type === MESSAGE_TYPES.TRANSCRIBE_INLINE_AUDIO
  ) {
    return transcribeInlineAudio(message);
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
  const binding = await readBinding();

  const visibleSettings = connection.clearPairingToken
    ? { ...settings, pairingToken: "" }
    : settings;
  const threadTargets = await readThreadTargetsState(settings, connection, binding);
  return buildPanelState(visibleSettings, toPublicConnection(connection), activeTab, queue, devtoolsCapture, binding, threadTargets);
}

async function buildPanelState(settings, connection, activeTab, queue, devtoolsCapture, binding = null, threadTargets = null) {
  const tabUrl = activeTab && activeTab.url ? activeTab.url : "";
  const restricted = isRestrictedTabUrl(tabUrl);
  const hostPermissionPattern = restricted ? "" : getTabOriginPattern(tabUrl);
  const hasHostAccess = hostPermissionPattern
    ? await hasHostPermission(hostPermissionPattern)
    : false;
  const captureState = normalizeDevtoolsCaptureState(devtoolsCapture);

  return {
    settings,
    connection,
    persistentBinding: buildPersistentBindingState(binding, connection),
    threadTargets: threadTargets || emptyThreadTargetsState("Connect browser binding to choose a destination thread."),
    queue,
    devtoolsCapture: buildDevtoolsCaptureStatus(captureState),
    activeTab: activeTab
      ? {
          id: activeTab.id,
          title: activeTab.title || "",
          url: tabUrl,
          restricted,
          restrictionReason: restricted ? describeRestrictedUrl(tabUrl) : "",
          hostPermissionPattern,
          hasHostAccess,
          needsHostPermission: Boolean(hostPermissionPattern && !hasHostAccess),
          hostAccessStatus: restricted
            ? "restricted"
            : hasHostAccess
              ? "granted"
              : "needs_permission"
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

async function saveSettings(rawSettings) {
  const settings = sanitizeSettings(rawSettings);
  const previousBinding = await readBinding();
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: { serverUrl: settings.serverUrl } });

  if (settings.pairingToken) {
    await bindPairingToken(settings);
  } else {
    await clearPairingToken();
    if (previousBinding && previousBinding.serverUrl && previousBinding.serverUrl !== settings.serverUrl) {
      await clearBinding();
    }
  }

  return { ok: true, state: await getPanelState() };
}

async function selectThreadTarget(threadId) {
  const next = await writeThreadTargetSelection(threadId);
  return {
    ok: true,
    selectedThreadId: next.selectedThreadId,
    state: await getPanelState()
  };
}

async function readSettings() {
  const [stored, pairingToken] = await Promise.all([
    chrome.storage.local.get(STORAGE_KEYS.settings),
    readPairingToken()
  ]);
  const storedSettings = stored[STORAGE_KEYS.settings] || {};
  const { pairingToken: legacyPairingToken, ...safeStoredSettings } = storedSettings;
  if (legacyPairingToken !== undefined) {
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: safeStoredSettings });
  }
  return {
    ...DEFAULT_SETTINGS,
    ...safeStoredSettings,
    pairingToken
  };
}

async function readBinding() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.binding);
  return sanitizeBinding(stored[STORAGE_KEYS.binding]);
}

async function writeBinding(binding) {
  const safeBinding = sanitizeBinding(binding);
  if (!safeBinding) {
    await clearBinding();
    return null;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.binding]: safeBinding });
  return safeBinding;
}

async function clearBinding() {
  if (chrome.storage.local.remove) {
    await chrome.storage.local.remove(STORAGE_KEYS.binding);
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.binding]: null });
}

async function readThreadTargetSelection() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.threadTarget);
  const value = stored[STORAGE_KEYS.threadTarget];
  const selectedThreadId = value && typeof value === "object"
    ? String(value.selectedThreadId || "").trim()
    : "";
  return { selectedThreadId };
}

async function writeThreadTargetSelection(threadId) {
  const selectedThreadId = String(threadId || "").trim();
  if (!selectedThreadId) {
    if (chrome.storage.local.remove) {
      await chrome.storage.local.remove(STORAGE_KEYS.threadTarget);
    } else {
      await chrome.storage.local.set({ [STORAGE_KEYS.threadTarget]: null });
    }
    return { selectedThreadId: "" };
  }
  const next = { selectedThreadId };
  await chrome.storage.local.set({ [STORAGE_KEYS.threadTarget]: next });
  return next;
}

async function readThreadTargetCatalogCache() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.threadTargetCatalog);
  return sanitizeThreadTargetCatalogCache(stored[STORAGE_KEYS.threadTargetCatalog]);
}

async function writeThreadTargetCatalogCache(groups, settings) {
  const next = sanitizeThreadTargetCatalogCache({
    groups,
    serverUrl: settings && settings.serverUrl ? settings.serverUrl : "",
    fetchedAtIso: new Date().toISOString()
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.threadTargetCatalog]: next });
  return next;
}

async function readThreadTargetsState(settings, connection, binding) {
  const selection = await readThreadTargetSelection();
  if (!binding || !binding.token || binding.reconnectRequired) {
    return emptyThreadTargetsState("Connect browser binding to choose a destination thread.", selection.selectedThreadId);
  }
  if (!connection || connection.status !== "connected" || !connection.binding) {
    return emptyThreadTargetsState("Browser binding must be connected before loading threads.", selection.selectedThreadId);
  }

  let url;
  try {
    url = buildThreadTargetsUrl(settings.serverUrl);
  } catch (error) {
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Invalid server URL.",
      groups: [],
      selectedThreadId: selection.selectedThreadId,
      selectedThread: null
    };
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${binding.token}`
      },
      cache: "no-store"
    }, STATUS_FETCH_TIMEOUT_MS);
    const payload = await readJsonSafely(response);
    if (!response.ok) {
      throw new Error(readStatusError(payload, `Thread targets request failed (${response.status}).`));
    }
    const groups = sanitizeThreadTargetGroups(payload && payload.groups);
    const catalogCache = await writeThreadTargetCatalogCache(groups, settings);
    const selectedThread = findThreadTarget(groups, selection.selectedThreadId);
    return {
      status: "ready",
      detail: groups.length > 0
        ? "Choose the Codex thread that will receive queued annotations."
        : "No Codex threads are available yet.",
      groups,
      selectedThreadId: selection.selectedThreadId,
      selectedThread,
      catalogFetchedAtIso: catalogCache.fetchedAtIso,
      catalogStale: false
    };
  } catch (error) {
    const cached = await readThreadTargetCatalogCache();
    if (cached && cached.groups.length > 0) {
      const selectedThread = findThreadTarget(cached.groups, selection.selectedThreadId);
      const detail = error instanceof Error ? error.message : "Unable to load destination threads.";
      return {
        status: "stale",
        detail: `Showing saved destination catalog. Refresh failed: ${detail}`,
        groups: cached.groups,
        selectedThreadId: selection.selectedThreadId,
        selectedThread,
        catalogFetchedAtIso: cached.fetchedAtIso,
        catalogStale: true
      };
    }
    return {
      status: "error",
      detail: error instanceof Error ? error.message : "Unable to load destination threads.",
      groups: [],
      selectedThreadId: selection.selectedThreadId,
      selectedThread: null
    };
  }
}

function emptyThreadTargetsState(detail, selectedThreadId = "") {
  return {
    status: "unavailable",
    detail,
    groups: [],
    selectedThreadId,
    selectedThread: null,
    catalogFetchedAtIso: "",
    catalogStale: false
  };
}

function sanitizeThreadTargetCatalogCache(value) {
  if (!value || typeof value !== "object") {
    return {
      groups: [],
      serverUrl: "",
      fetchedAtIso: ""
    };
  }
  return {
    groups: sanitizeThreadTargetGroups(value.groups),
    serverUrl: String(value.serverUrl || "").trim(),
    fetchedAtIso: String(value.fetchedAtIso || "").trim()
  };
}

function sanitizeThreadTargetGroups(value) {
  if (!Array.isArray(value)) return [];
  return value.map((group) => {
    const source = group && typeof group === "object" ? group : {};
    return {
      projectName: String(source.projectName || "").trim(),
      cwd: String(source.cwd || "").trim(),
      threads: Array.isArray(source.threads)
        ? source.threads.map(sanitizeThreadTarget).filter(Boolean)
        : []
    };
  }).filter((group) => group.projectName || group.threads.length > 0);
}

function sanitizeThreadTarget(value) {
  if (!value || typeof value !== "object") return null;
  const id = String(value.id || "").trim();
  if (!id) return null;
  return {
    id,
    title: String(value.title || value.preview || id).trim(),
    preview: String(value.preview || "").trim(),
    updatedAtIso: String(value.updatedAtIso || "").trim(),
    cwd: String(value.cwd || "").trim()
  };
}

function findThreadTarget(groups, threadId) {
  const targetId = String(threadId || "").trim();
  if (!targetId) return null;
  for (const group of groups) {
    const match = group.threads.find((thread) => thread.id === targetId);
    if (match) {
      return {
        ...match,
        projectName: group.projectName,
        projectCwd: group.cwd
      };
    }
  }
  return null;
}

function sanitizeBinding(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const token = String(value.token || value.extensionToken || "").trim();
  const bindingId = String(value.bindingId || (value.binding && value.binding.bindingId) || "").trim();
  const sessionId = String(value.sessionId || (value.session && value.session.sessionId) || "").trim();
  const threadId = String(value.threadId || (value.session && value.session.threadId) || "").trim();
  if (!token) {
    return null;
  }
  const tokenType = String(value.tokenType || "").trim();
  let serverUrl = "";
  try {
    serverUrl = value.serverUrl ? normalizeServerUrl(value.serverUrl) : "";
  } catch (_error) {
    serverUrl = "";
  }
  if (!bindingId || tokenType === "extension" || sessionId || threadId) {
    return {
      token,
      sessionId,
      threadId,
      tokenType: "legacy-listen",
      legacy: true,
      reconnectRequired: true,
      serverUrl,
      serverPath: String(value.serverPath || "").trim(),
      createdAtIso: String(value.createdAtIso || "").trim(),
      expiresAtIso: String(value.expiresAtIso || "").trim(),
      lastUsedAtIso: String(value.lastUsedAtIso || "").trim()
    };
  }
  return {
    token,
    bindingId,
    tokenType: "browser-binding",
    serverUrl,
    serverPath: String(value.serverPath || "").trim(),
    createdAtIso: String(value.createdAtIso || "").trim(),
    expiresAtIso: String(value.expiresAtIso || "").trim(),
    lastUsedAtIso: String(value.lastUsedAtIso || "").trim()
  };
}

async function readPairingToken() {
  if (!chrome.storage.session) {
    return "";
  }
  const stored = await chrome.storage.session.get(STORAGE_KEYS.pairingToken);
  return String(stored[STORAGE_KEYS.pairingToken] || "").trim();
}

async function writePairingToken(pairingToken) {
  if (!chrome.storage.session) {
    return;
  }
  const token = String(pairingToken || "").trim();
  if (token) {
    await chrome.storage.session.set({ [STORAGE_KEYS.pairingToken]: token });
  } else {
    await chrome.storage.session.remove(STORAGE_KEYS.pairingToken);
  }
}

async function clearPairingToken() {
  await writePairingToken("");
}

function sanitizeSettings(settings) {
  return {
    serverUrl: normalizeServerUrl(settings.serverUrl),
    pairingToken: String(settings.pairingToken || "").trim()
  };
}

async function bindPairingToken(settings) {
  let bindUrl;
  try {
    bindUrl = buildBindingCompleteUrl(settings.serverUrl);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid server URL.");
  }

  const response = await fetchWithTimeout(bindUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${settings.pairingToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({}),
    cache: "no-store"
  }, STATUS_FETCH_TIMEOUT_MS);
  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(readStatusError(payload, `Persistent binding failed (${response.status}).`));
  }

  const binding = readBindingFromStatusPayload(payload);
  if (!binding || !binding.bindingToken) {
    throw new Error("Browser binding response did not include a valid binding token.");
  }

  await writeBinding({
    token: binding.bindingToken,
    bindingId: binding.bindingId,
    tokenType: "browser-binding",
    serverUrl: settings.serverUrl,
    serverPath: binding.serverPath || "",
    createdAtIso: binding.createdAtIso || "",
    expiresAtIso: binding.expiresAtIso || "",
    lastUsedAtIso: binding.lastUsedAtIso || ""
  });
  await clearPairingToken();
}

async function validateConnection(settings, options = {}) {
  const binding = await readBinding();
  const bindingAuth = buildBindingAuth(settings, binding);
  if (bindingAuth) {
    const result = await validateAuthToken(settings, bindingAuth, options);
    if (result.status === "connected" || result.status === "error" || !settings.pairingToken) {
      return result;
    }
  }

  if (!settings.pairingToken) {
    return {
      status: "disconnected",
      checkedAtIso: null,
      session: null,
      detail: binding && binding.reconnectRequired
        ? "Reconnect required. Paste a browser binding pairing code from Codex UI."
        : "Paste a browser binding pairing code from Codex UI to connect.",
      persistentBinding: binding ? buildPersistentBindingState(binding, null) : null
    };
  }

  return validateAuthToken(settings, {
    token: settings.pairingToken,
    tokenType: "pairing"
  }, options);
}

function buildBindingAuth(settings, binding) {
  if (!binding || !binding.token) {
    return null;
  }
  if (binding.reconnectRequired || binding.legacy) {
    return null;
  }
  if (binding.serverUrl && binding.serverUrl !== settings.serverUrl) {
    return null;
  }
  return {
    token: binding.token,
    tokenType: "browser-binding",
    binding
  };
}

async function validateAuthToken(settings, auth, options = {}) {
  const checkedAtIso = new Date().toISOString();
  let statusUrl;
  try {
    statusUrl = auth.tokenType === "browser-binding"
      ? buildBindingStatusUrl(settings.serverUrl)
      : buildListenStatusUrl(settings.serverUrl);
  } catch (error) {
    return {
      status: "error",
      checkedAtIso,
      session: null,
      detail: error instanceof Error ? error.message : "Invalid server URL."
    };
  }

  try {
    const response = await fetchWithTimeout(statusUrl, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${auth.token}`
      },
      cache: "no-store"
    }, STATUS_FETCH_TIMEOUT_MS);
    const payload = await readJsonSafely(response);
    if (!response.ok) {
      throw new Error(
        readStatusError(payload, `Connection status check failed (${response.status}).`)
      );
    }

    const credential = auth.tokenType === "browser-binding"
      ? readBindingFromStatusPayload(payload)
      : readSessionFromStatusPayload(payload);
    if (!credential) {
      throw new Error("Connection status response did not include a valid credential.");
    }

    if (credential.status !== "active") {
      if (auth.tokenType === "browser-binding") {
        await clearBinding();
      } else {
        await clearPairingToken();
      }
      return {
        status: "disconnected",
        checkedAtIso,
        session: auth.tokenType === "browser-binding" ? null : credential,
        binding: auth.tokenType === "browser-binding" ? credential : null,
        ...(auth.tokenType === "pairing" ? { clearPairingToken: true } : {}),
        tokenType: auth.tokenType,
        detail: credential.status === "revoked"
          ? "Listener stopped in Codex UI. Create a fresh binding to connect again."
          : "Listener expired. Create a fresh binding to connect again."
      };
    }

    return {
      status: "connected",
      checkedAtIso,
      session: auth.tokenType === "browser-binding" ? null : credential,
      binding: auth.tokenType === "browser-binding" ? credential : null,
      tokenType: auth.tokenType,
      ...(options.includeAuth ? { authToken: auth.token } : {}),
      detail: auth.tokenType === "browser-binding"
        ? "Browser binding connected. Choose a destination thread before sending annotations."
        : `Connected to thread ${credential.threadId}.`
    };
  } catch (error) {
    if (auth.tokenType === "browser-binding" && isInvalidTokenError(error)) {
      await clearBinding();
      return {
        status: "disconnected",
        checkedAtIso,
        session: null,
        tokenType: auth.tokenType,
        detail: "Browser binding is no longer valid. Paste a fresh pairing code to bind again."
      };
    }
    return {
      status: "error",
      checkedAtIso,
      session: null,
      tokenType: auth.tokenType,
      detail: error instanceof Error ? error.message : "Unable to validate pairing token."
    };
  }
}

function isInvalidTokenError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /invalid|expired|revoked/i.test(message);
}

function toPublicConnection(connection) {
  if (!connection || typeof connection !== "object") {
    return connection;
  }
  const { authToken: _authToken, ...publicConnection } = connection;
  if (publicConnection.session && typeof publicConnection.session === "object") {
    const {
      extensionToken: _extensionToken,
      pairingToken: _pairingToken,
      ...publicSession
    } = publicConnection.session;
    publicConnection.session = publicSession;
  }
  return publicConnection;
}

function buildPersistentBindingState(binding, connection) {
  if (!binding) {
    return null;
  }
  if (binding.reconnectRequired) {
    return {
      status: "error",
      revocable: false,
      reconnectRequired: true,
      detail: "Reconnect required. This saved binding came from the old thread listener flow."
    };
  }
  const browserBinding = connection && connection.binding && connection.binding.tokenType === "browser-binding"
    ? connection.binding
    : null;
  const status = browserBinding ? browserBinding.status : "configured";
  return {
    status,
    revocable: true,
    bindingId: binding.bindingId,
    expiresAtIso: browserBinding && browserBinding.expiresAtIso ? browserBinding.expiresAtIso : binding.expiresAtIso,
    lastUsedAtIso: browserBinding && browserBinding.lastUsedAtIso ? browserBinding.lastUsedAtIso : binding.lastUsedAtIso,
    detail: status === "active"
      ? "Browser binding is connected."
      : "Browser binding is configured."
  };
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

  await ensureTabHostAccess(tab);

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

async function ensureTabHostAccess(tab) {
  const originPattern = getTabOriginPattern(tab && tab.url);
  if (!originPattern) {
    throw new Error("The active tab has no accessible http(s) origin for annotation.");
  }

  if (await hasHostPermission(originPattern)) {
    return;
  }

  throw new Error(
    `Grant site access for ${originPattern} before using Pick on Page. Open the Annotation Panel on that tab, click Pick on Page, and approve Chrome's access prompt.`
  );
}

async function hasHostPermission(originPattern) {
  if (!originPattern || !chrome.permissions || !chrome.permissions.contains) {
    return false;
  }

  return chrome.permissions.contains({ origins: [originPattern] });
}

async function saveDraftAnnotation(message, sender) {
  const context = message && message.context;
  if (!context || typeof context !== "object") {
    throw new Error("Selected element context is missing.");
  }

  const screenshotEnabled = message.screenshotEnabled !== false;
  const noteText = sanitizeNoteText(message.noteText);
  const previewResult = screenshotEnabled
    ? await captureSelectedElementPreviewSafely(context, sender)
    : { preview: null, error: "" };
  const screenshot = screenshotEnabled
    ? previewResult.preview
      ? {
          state: "ready",
          capturedAtIso: new Date().toISOString(),
          thumbnail: previewResult.preview
        }
      : {
          state: "failed",
          error: previewResult.error || "Screenshot capture failed."
        }
    : { state: "off" };
  return enqueueAnnotationQueueMutation(async () => {
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
      noteText,
      screenshot,
      preview: previewResult.preview,
      previewError: previewResult.error
    };
    const nextQueue = await writeAnnotationQueue([...queue, item]);
    return {
      ok: true,
      queueCount: nextQueue.length,
      item
    };
  });
}

async function saveSelectedElementContext(context, sender) {
  return saveDraftAnnotation({ context, noteText: "", screenshotEnabled: true }, sender);
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
  return enqueueAnnotationQueueMutation(async () => {
    const queue = await readAnnotationQueue();
    const nextQueue = await writeAnnotationQueue(updateAnnotationQueueItem(queue, id, patch));
    return {
      ok: true,
      queue: nextQueue,
      queueCount: nextQueue.length
    };
  });
}

async function deleteQueuedAnnotation(id) {
  return enqueueAnnotationQueueMutation(async () => {
    const queue = await readAnnotationQueue();
    const nextQueue = await writeAnnotationQueue(deleteAnnotationQueueItem(queue, id));
    return {
      ok: true,
      queue: nextQueue,
      queueCount: nextQueue.length
    };
  });
}

async function moveQueuedAnnotation(id, direction) {
  return enqueueAnnotationQueueMutation(async () => {
    const queue = await readAnnotationQueue();
    const nextQueue = await writeAnnotationQueue(moveAnnotationQueueItem(queue, id, direction));
    return {
      ok: true,
      queue: nextQueue,
      queueCount: nextQueue.length
    };
  });
}

async function addPageStateAnnotation(noteText) {
  const text = String(noteText || "").trim();
  if (!text) {
    throw new Error("Add a short page note first.");
  }

  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    throw new Error("No active browser tab is available.");
  }
  if (isRestrictedTabUrl(tab.url)) {
    throw new Error(describeRestrictedUrl(tab.url));
  }
  const devtoolsCapture = await readDevtoolsCaptureState();
  if (!devtoolsCapture || devtoolsCapture.active !== true) {
    throw new Error("Enable Diagnostics before adding a page note.");
  }

  return enqueueAnnotationQueueMutation(async () => {
    const queue = await readAnnotationQueue();
    const page = {
      title: tab.title || "",
      url: tab.url || ""
    };
    const item = {
      id: `page-state-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      kind: "devtools/page-state",
      createdAtIso: new Date().toISOString(),
      tab: {
        id: tab.id,
        title: page.title,
        url: page.url
      },
      context: {
        kind: "devtools/page-state",
        page
      },
      noteText: text,
      preview: null
    };
    const nextQueue = await writeAnnotationQueue([...queue, item]);
    return {
      ok: true,
      queue: nextQueue,
      queueCount: nextQueue.length,
      item,
      state: await getPanelState()
    };
  });
}

async function resolveAuthContext() {
  const settings = await readSettings();
  const connection = await validateConnection(settings, { includeAuth: true });
  if (connection.status !== "connected" || !connection.authToken) {
    throw new Error(connection.detail || "Connect the extension before sending annotations.");
  }
  if (connection.session) {
    return {
      settings,
      connection,
      token: connection.authToken,
      tokenType: connection.session.tokenType || connection.tokenType || "pairing"
    };
  }
  if (connection.binding && connection.binding.tokenType === "browser-binding") {
    const selection = await readThreadTargetSelection();
    if (!selection.selectedThreadId) {
      throw new Error("Choose a destination thread in the extension before sending annotations.");
    }
    const session = await bindBrowserBindingToThread(settings, connection.authToken, selection.selectedThreadId);
    return {
      settings,
      connection: {
        ...connection,
        session,
        detail: `Connected to thread ${session.threadId}.`
      },
      token: session.extensionToken,
      tokenType: session.tokenType || "extension"
    };
  }
  throw new Error(connection.detail || "Choose a destination thread before sending annotations.");
}

async function bindBrowserBindingToThread(settings, bindingToken, threadId) {
  let bindUrl;
  try {
    bindUrl = buildListenBindThreadUrl(settings.serverUrl);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid server URL.");
  }

  const response = await fetchWithTimeout(bindUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${bindingToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ threadId }),
    cache: "no-store"
  }, STATUS_FETCH_TIMEOUT_MS);
  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(readStatusError(payload, `Thread binding failed (${response.status}).`));
  }
  const session = readSessionFromStatusPayload(payload);
  if (!session || !session.extensionToken) {
    throw new Error("Thread binding response did not include a scoped extension token.");
  }
  return session;
}

async function sendAnnotationBatch() {
  const auth = await resolveAuthContext();
  const { settings, connection } = auth;

  const queue = await readSettledAnnotationQueue();
  if (queue.length === 0) {
    throw new Error("Annotation queue is empty.");
  }
  if (queue.some(hasBlockedScreenshot)) {
    throw new Error("Retry failed screenshots or choose send without screenshot before sending the queue.");
  }
  const sentQueueItemIds = new Set(queue.map((item) => item && item.id).filter(Boolean));

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

  const response = await fetchWithTimeout(buildAnnotationBatchUrl(settings.serverUrl, connection.session), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(batch),
    cache: "no-store"
  }, BATCH_SEND_TIMEOUT_MS);
  const payload = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(readStatusError(payload, `Annotation batch send failed (${response.status}).`));
  }

  await removeSentAnnotationQueueItems(sentQueueItemIds);
  const devtoolsStop = await stopDevtoolsCaptureIfActive("send-complete");
  const activeTab = await getActiveTab();
  const stoppedDevtoolsCapture = await readDevtoolsCaptureState();
  let nextConnection;
  if (auth.tokenType === "extension") {
    await clearPairingToken();
    nextConnection = {
      ...toPublicConnection(connection),
      detail: "Annotation batch sent. Persistent binding remains connected."
    };
  } else {
    const revokeResult = await revokeListenSessionAfterSuccessfulSend(settings, connection.session, auth.token);
    await clearPairingToken();
    nextConnection = {
      status: "disconnected",
      checkedAtIso: null,
      session: null,
      detail: revokeResult.ok
        ? "Annotation batch sent and pairing token revoked. Paste a fresh pairing token to connect again."
        : "Annotation batch sent. Pairing token was cleared locally and will expire on the server."
    };
  }
  const binding = await readBinding();
  const threadTargets = await readThreadTargetsState(settings, nextConnection, binding);
  return {
    ok: true,
    result: payload && payload.result ? payload.result : null,
    devtoolsStop,
    state: await buildPanelState({ ...settings, pairingToken: "" }, nextConnection, activeTab, [], stoppedDevtoolsCapture, binding, threadTargets)
  };
}

function hasBlockedScreenshot(item) {
  const screenshot = item && item.screenshot && typeof item.screenshot === "object"
    ? item.screenshot
    : null;
  return Boolean(screenshot && screenshot.state === "failed" && screenshot.sendWithoutScreenshot !== true);
}

async function readSettledAnnotationQueue() {
  return enqueueAnnotationQueueMutation(async () => readAnnotationQueue());
}

async function removeSentAnnotationQueueItems(sentQueueItemIds) {
  await enqueueAnnotationQueueMutation(async () => {
    const queue = await readAnnotationQueue();
    if (!sentQueueItemIds || sentQueueItemIds.size === 0) {
      return writeAnnotationQueue(queue);
    }
    return writeAnnotationQueue(queue.filter((item) => !sentQueueItemIds.has(item && item.id)));
  });
}

function enqueueAnnotationQueueMutation(task) {
  const next = annotationQueueMutationQueue.then(task, task);
  annotationQueueMutationQueue = next.catch(() => {});
  return next;
}

async function revokeListenSessionAfterSuccessfulSend(settings, session, token) {
  try {
    const response = await fetchWithTimeout(buildListenStopUrl(settings.serverUrl), {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sessionId: session.sessionId,
        threadId: session.threadId
      }),
      cache: "no-store"
    }, REVOKE_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      const payload = await readJsonSafely(response);
      console.warn("Browser annotation listen session revoke failed.", readStatusError(payload, `HTTP ${response.status}`));
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    console.warn("Browser annotation listen session revoke failed.", error);
    return { ok: false };
  }
}

async function disconnectBinding() {
  const settings = await readSettings();
  const binding = await readBinding();
  if (binding && binding.token && !binding.reconnectRequired) {
    try {
      await fetchWithTimeout(buildBrowserBindingRevokeUrl(binding.serverUrl || settings.serverUrl), {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${binding.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({}),
        cache: "no-store"
      }, REVOKE_FETCH_TIMEOUT_MS);
    } catch (error) {
      console.warn("Browser annotation persistent binding revoke failed.", error);
    }
  }
  await clearBinding();
  await clearPairingToken();
  await writeThreadTargetSelection("");
  return { ok: true, state: await getPanelState() };
}

async function transcribeInlineAudio(message) {
  const auth = await resolveAuthContext();
  const recording = readInlineAudioPayload(message);
  if (!recording.blob || recording.blob.size === 0) {
    throw new Error("No audio was captured for transcription.");
  }

  const form = new FormData();
  form.append("file", recording.blob, voiceFileName(recording.mimeType || recording.blob.type));
  if (recording.durationMs > 0) {
    form.append("durationMs", String(recording.durationMs));
  }
  if (recording.itemId) {
    form.append("itemId", recording.itemId);
  }

  const response = await fetchWithTimeout(buildTranscribeUrl(auth.settings.serverUrl, auth.connection.session), {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${auth.token}`
    },
    body: form,
    cache: "no-store"
  }, TRANSCRIBE_FETCH_TIMEOUT_MS);
  const payload = await readJsonSafely(response);
  if (!response.ok || !payload || payload.ok !== true) {
    throw new Error(readStatusError(payload, `Voice transcription failed (${response.status}).`));
  }

  return {
    ok: true,
    itemId: recording.itemId,
    recordingToken: recording.recordingToken,
    transcriptText: typeof payload.text === "string" ? payload.text : "",
    text: typeof payload.text === "string" ? payload.text : "",
    language: typeof payload.language === "string" ? payload.language : "",
    model: typeof payload.model === "string" ? payload.model : ""
  };
}

function readInlineAudioPayload(message) {
  const mimeType = normalizeVoiceMimeType(message.mimeType);
  const itemId = String(message.itemId || "").trim();
  const recordingToken = String(message.recordingToken || "").trim();
  const durationMs = Number.isFinite(Number(message.durationMs))
    ? Math.max(0, Math.round(Number(message.durationMs)))
    : 0;

  if (typeof Blob !== "undefined" && message.blob instanceof Blob) {
    const blobMimeType = normalizeVoiceMimeType(message.blob.type || mimeType);
    const blob = message.blob.type === blobMimeType
      ? message.blob
      : message.blob.slice(0, message.blob.size, blobMimeType);
    return { blob, mimeType: blobMimeType, itemId, recordingToken, durationMs };
  }

  const dataUrl = String(message.audioDataUrl || message.dataUrl || "").trim();
  if (!dataUrl) {
    return { blob: null, mimeType, itemId, recordingToken, durationMs };
  }
  const parsed = parseDataUrl(dataUrl, mimeType);
  return {
    blob: parsed ? parsed.blob : null,
    mimeType: parsed ? parsed.mimeType : mimeType,
    itemId,
    recordingToken,
    durationMs
  };
}

function parseDataUrl(dataUrl, fallbackMimeType) {
  if (!dataUrl.toLowerCase().startsWith("data:")) {
    return null;
  }
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    return null;
  }

  const metadata = dataUrl.slice(5, commaIndex);
  const metadataParts = metadata.split(";").map((part) => part.trim()).filter(Boolean);
  const mediaType = metadataParts.length > 0 && metadataParts[0].includes("/")
    ? metadataParts[0]
    : "";
  const mimeType = normalizeVoiceMimeType(mediaType || fallbackMimeType);
  const isBase64 = metadataParts.some((part) => part.toLowerCase() === "base64");
  const raw = dataUrl.slice(commaIndex + 1);
  const bytes = isBase64
    ? decodeBase64Bytes(raw)
    : new TextEncoder().encode(decodeURIComponent(raw));
  return {
    mimeType,
    blob: new Blob([bytes], { type: mimeType })
  };
}

function normalizeVoiceMimeType(value) {
  const raw = String(value || "").trim();
  const mediaType = raw.split(";")[0].trim().toLowerCase();
  return mediaType || "audio/webm";
}

function decodeBase64Bytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
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

async function startDevtoolsCapture(options = {}) {
  assertDebuggerApiAvailable();
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    throw new Error("No active tab is available for Diagnostics capture.");
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
    await replaceDevtoolsCaptureState(failedState);
    throw new Error(`Unable to start Diagnostics capture: ${message}`);
  }

  devtoolsCaptureTabId = tab.id;
  await replaceDevtoolsCaptureState(state);
  await scheduleDevtoolsCaptureTimeout(tab.id, state.expiresAtIso);
  return {
    ok: true,
    devtoolsCapture: buildDevtoolsCaptureStatus(state),
    state: await getPanelState()
  };
}

async function stopDevtoolsCapture(reason) {
  let detachTabId = null;
  const stoppedState = await updateDevtoolsCaptureState((state) => {
    const tabId = devtoolsCaptureTabId || state.tabId;
    if (state.active && typeof tabId === "number") {
      detachTabId = tabId;
    }
    return stopDevtoolsCaptureState(state, reason || "stopped");
  });
  await clearDevtoolsCaptureTimeout();
  devtoolsCaptureTabId = null;

  if (typeof detachTabId === "number") {
    await safeDetachDebuggee({ tabId: detachTabId });
  }

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
    await scheduleDevtoolsCaptureTimeout(state.tabId, state.expiresAtIso);
  }
  return {
    ok: true,
    devtoolsCapture: buildDevtoolsCaptureStatus(state)
  };
}

async function handleDebuggerEvent(source, method, params) {
  let captureResponseBody = false;
  let expiredTabId = null;

  await updateDevtoolsCaptureState((state) => {
    if (!state.active || !source || source.tabId !== state.tabId) {
      return DEVTOOLS_CAPTURE_NO_WRITE;
    }
    if (isDevtoolsCaptureExpired(state)) {
      expiredTabId = state.tabId;
      return stopDevtoolsCaptureState(state, "timeout");
    }

    if (DEVTOOLS_CONSOLE_EVENT_METHODS.has(method)) {
      return appendConsoleEvent(state, method, params);
    }

    if (DEVTOOLS_NETWORK_EVENT_METHODS.has(method)) {
      captureResponseBody =
        method === "Network.loadingFinished" || method === "Network.loadingFailed";
      return upsertNetworkEvent(state, method, params, state.captureOptions);
    }

    return DEVTOOLS_CAPTURE_NO_WRITE;
  });

  if (expiredTabId !== null) {
    await clearDevtoolsCaptureTimeout();
    devtoolsCaptureTabId = null;
    await safeDetachDebuggee({ tabId: expiredTabId });
    return;
  }

  if (captureResponseBody) {
    await captureResponseBodyIfAllowed(source, params);
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
  if (!shouldCaptureDevtoolsResponseBody(row, options)) {
    return;
  }
  const captureStartedAtIso = state.startedAtIso;
  const byteLength = row.encodedDataLength;
  try {
    const result = await chrome.debugger.sendCommand(
      { tabId: state.tabId },
      "Network.getResponseBody",
      { requestId }
    );
    if (!result || result.base64Encoded === true || typeof result.body !== "string") {
      return;
    }
    await updateDevtoolsCaptureState((latestState) => {
      if (
        !latestState.active ||
        !source ||
        source.tabId !== latestState.tabId ||
        latestState.startedAtIso !== captureStartedAtIso
      ) {
        return DEVTOOLS_CAPTURE_NO_WRITE;
      }
      const latestRow = latestState.networkRows.find((item) => item.requestId === requestId);
      if (!shouldCaptureDevtoolsResponseBody(latestRow, latestState.captureOptions || options)) {
        return DEVTOOLS_CAPTURE_NO_WRITE;
      }
      return upsertNetworkEvent(
        latestState,
        "BrowserAnnotation.responseBodyCaptured",
        {
          requestId,
          bodyText: result.body,
          byteLength,
          mimeType: row.mimeType
        },
        latestState.captureOptions || options
      );
    });
  } catch (error) {
    console.warn("Unable to capture DevTools response body.", error);
  }
}

async function handleDebuggerDetach(source, reason) {
  let detached = false;
  await updateDevtoolsCaptureState((state) => {
    if (!state.active || !source || source.tabId !== state.tabId) {
      return DEVTOOLS_CAPTURE_NO_WRITE;
    }
    detached = true;
    return stopDevtoolsCaptureState(state, reason || "detached");
  });
  if (!detached) {
    return;
  }
  await clearDevtoolsCaptureTimeout();
  devtoolsCaptureTabId = null;
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

async function updateDevtoolsCaptureState(mutator) {
  return enqueueDevtoolsCapturePersistence(async () => {
    const state = await readDevtoolsCaptureState();
    const nextState = await mutator(state);
    if (nextState === DEVTOOLS_CAPTURE_NO_WRITE) {
      return state;
    }
    return writeDevtoolsCaptureState(nextState);
  });
}

async function replaceDevtoolsCaptureState(nextState) {
  return enqueueDevtoolsCapturePersistence(async () => writeDevtoolsCaptureState(nextState));
}

function enqueueDevtoolsCapturePersistence(task) {
  const result = devtoolsCapturePersistenceQueue.then(task, task);
  devtoolsCapturePersistenceQueue = result.catch(() => {});
  return result;
}

async function scheduleDevtoolsCaptureTimeout(tabId, expiresAtIso) {
  await clearDevtoolsCaptureTimeout();
  const expiresAtMs = Date.parse(expiresAtIso);
  const dueAtMs = Number.isFinite(expiresAtMs)
    ? expiresAtMs
    : Date.now() + DEVTOOLS_CAPTURE_TIMEOUT_MS;
  const delayMs = Math.max(0, dueAtMs - Date.now());
  devtoolsCaptureTimer = setTimeout(() => {
    if (devtoolsCaptureTabId !== tabId) {
      return;
    }
    stopDevtoolsCapture("timeout").catch((error) => {
      console.warn("Unable to stop timed-out DevTools capture.", error);
    });
  }, Math.min(delayMs, DEVTOOLS_CAPTURE_TIMEOUT_MS));
  await createDevtoolsCaptureTimeoutAlarm(dueAtMs);
}

async function clearDevtoolsCaptureTimeout() {
  if (devtoolsCaptureTimer) {
    clearTimeout(devtoolsCaptureTimer);
    devtoolsCaptureTimer = null;
  }
  await clearDevtoolsCaptureTimeoutAlarm();
}

async function createDevtoolsCaptureTimeoutAlarm(whenMs) {
  if (!chrome.alarms || !chrome.alarms.create) {
    return;
  }
  try {
    await chrome.alarms.create(DEVTOOLS_CAPTURE_TIMEOUT_ALARM, {
      when: Math.max(Date.now(), whenMs)
    });
  } catch (error) {
    console.warn("Unable to create DevTools capture timeout alarm.", error);
  }
}

async function clearDevtoolsCaptureTimeoutAlarm() {
  if (!chrome.alarms || !chrome.alarms.clear) {
    return;
  }
  try {
    await chrome.alarms.clear(DEVTOOLS_CAPTURE_TIMEOUT_ALARM);
  } catch (error) {
    console.warn("Unable to clear DevTools capture timeout alarm.", error);
  }
}

async function reconcileDevtoolsCaptureTimeout(_trigger) {
  const state = await readDevtoolsCaptureState();
  if (!state.active) {
    await clearDevtoolsCaptureTimeout();
    devtoolsCaptureTabId = null;
    return;
  }
  if (isDevtoolsCaptureExpired(state)) {
    await stopDevtoolsCapture("timeout");
    return;
  }
  if (typeof state.tabId === "number") {
    devtoolsCaptureTabId = state.tabId;
    await scheduleDevtoolsCaptureTimeout(state.tabId, state.expiresAtIso);
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
      "Diagnostics capture requires the chrome.debugger permission in the extension manifest."
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

function shouldCaptureDevtoolsResponseBody(row, options) {
  if (!row || options.captureResponseBodies !== true) {
    return false;
  }
  const status = typeof row.status === "number" ? row.status : null;
  const isHttpError = typeof status === "number" && status >= 400;
  if (!row.failed && !isHttpError) {
    return false;
  }
  if (!isKnownTextualDevtoolsMimeType(row.mimeType)) {
    return false;
  }
  const byteLength = row.encodedDataLength;
  const capBytes = typeof options.bodyCapBytes === "number" ? options.bodyCapBytes : 16 * 1024;
  return typeof byteLength === "number" &&
    Number.isFinite(byteLength) &&
    byteLength >= 0 &&
    byteLength <= capBytes;
}

function isKnownTextualDevtoolsMimeType(value) {
  const mimeType = String(value || "").toLowerCase();
  return Boolean(mimeType) && isTextualDevtoolsMimeType(mimeType);
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
