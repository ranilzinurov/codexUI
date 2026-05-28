importScripts(
  "../shared/constants.js",
  "../shared/url-utils.js",
  "../shared/pairing-client.js"
);

const {
  MESSAGE_TYPES,
  DEFAULT_SETTINGS,
  STORAGE_KEYS
} = globalThis.BrowserAnnotationConstants;
const {
  normalizeServerUrl,
  isRestrictedTabUrl,
  describeRestrictedUrl
} = globalThis.BrowserAnnotationUrlUtils;
const {
  buildListenStatusUrl,
  readJsonSafely,
  readStatusError,
  readSessionFromStatusPayload
} = globalThis.BrowserAnnotationPairingClient;

enableActionSidePanelBehavior();

chrome.runtime.onInstalled.addListener(() => {
  enableActionSidePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  enableActionSidePanelBehavior();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  return true;
});

async function handleMessage(message) {
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

  if (message.type === MESSAGE_TYPES.CONTENT_PING) {
    return { ok: true };
  }

  throw new Error(`Unsupported extension message type: ${message.type}`);
}

async function getPanelState() {
  const settings = await readSettings();
  const [connection, activeTab] = await Promise.all([
    validateConnection(settings),
    getActiveTab()
  ]);

  const tabUrl = activeTab && activeTab.url ? activeTab.url : "";
  const restricted = isRestrictedTabUrl(tabUrl);

  return {
    settings,
    connection,
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
