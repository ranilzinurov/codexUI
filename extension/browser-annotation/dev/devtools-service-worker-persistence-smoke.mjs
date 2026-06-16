import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const storage = new Map();
const detachedTabs = [];
const executedScripts = [];
const tabRemovedListeners = [];
const tabUpdatedListeners = [];
const activeTabs = [];
let pendingBodyResponse = null;

const context = vm.createContext({
  AbortController,
  Blob,
  Date,
  FormData,
  Math,
  Promise,
  Response,
  Set,
  Symbol,
  TextEncoder,
  URL,
  atob,
  clearTimeout,
  console,
  fetch,
  setTimeout,
  globalThis: {},
  importScripts: (...paths) => {
    for (const scriptPath of paths) {
      const source = readFileSync(resolve(extensionRoot, "service-worker", scriptPath), "utf8");
      vm.runInContext(source, context, { filename: scriptPath });
    }
  }
});
context.globalThis = context;
context.chrome = createChromeStub(
  storage,
  detachedTabs,
  executedScripts,
  activeTabs,
  () => pendingBodyResponse
);

const serviceWorkerSource = readFileSync(
  resolve(extensionRoot, "service-worker/service-worker.js"),
  "utf8"
);
vm.runInContext(serviceWorkerSource, context, {
  filename: "service-worker/service-worker.js"
});

const { BrowserAnnotationConstants, BrowserAnnotationDevtoolsCapture } = context;
const storageKey = BrowserAnnotationConstants.STORAGE_KEYS.devtoolsCapture;
const nowMs = Date.now();
const initialState = BrowserAnnotationDevtoolsCapture.createDevtoolsCaptureState(
  {
    id: 42,
    title: "Persistence smoke",
    url: "https://app.example.test/persistence"
  },
  {
    nowMs,
    timeoutMs: 60000
  }
);
storage.set(storageKey, initialState);

const source = { tabId: 42 };
const burst = [];
for (let index = 0; index < 12; index += 1) {
  burst.push(
    context.handleDebuggerEvent(source, "Runtime.consoleAPICalled", {
      type: "log",
      timestamp: nowMs + index,
      args: [{ value: `burst-console-${index}` }]
    })
  );
  burst.push(
    context.handleDebuggerEvent(source, "Network.requestWillBeSent", {
      requestId: `burst-request-${index}`,
      type: "Fetch",
      wallTime: (nowMs + 1000 + index) / 1000,
      request: {
        method: "GET",
        url: `https://app.example.test/api/${index}`,
        headers: {}
      }
    })
  );
}

await Promise.all(burst);

const finalState = storage.get(storageKey);
assert.equal(finalState.active, true);
assert.equal(finalState.consoleRows.length, 12);
assert.equal(finalState.networkRows.length, 12);
assert.deepEqual(
  finalState.consoleRows.map((row) => row.text).sort(),
  Array.from({ length: 12 }, (_value, index) => `burst-console-${index}`).sort()
);
assert.deepEqual(
  finalState.networkRows.map((row) => row.requestId).sort(),
  Array.from({ length: 12 }, (_value, index) => `burst-request-${index}`).sort()
);

storage.set(storageKey, BrowserAnnotationDevtoolsCapture.createDevtoolsCaptureState(
  {
    id: 42,
    title: "Stop race smoke",
    url: "https://app.example.test/stop-race"
  },
  {
    nowMs,
    timeoutMs: 60000
  }
));
context.devtoolsCaptureTabId = 42;
await Promise.all([
  context.handleDebuggerEvent(source, "Runtime.consoleAPICalled", {
    type: "log",
    timestamp: nowMs + 2000,
    args: [{ value: "queued-before-stop" }]
  }),
  context.stopDevtoolsCapture("smoke-stop")
]);

const stoppedState = storage.get(storageKey);
assert.equal(stoppedState.active, false);
assert.equal(stoppedState.detachReason, "smoke-stop");
assert.equal(detachedTabs.includes(42), true);

let firstCapture = BrowserAnnotationDevtoolsCapture.createDevtoolsCaptureState(
  {
    id: 42,
    title: "Body stale capture",
    url: "https://app.example.test/body-stale"
  },
  {
    nowMs,
    timeoutMs: 60000,
    captureResponseBodies: true
  }
);
firstCapture = BrowserAnnotationDevtoolsCapture.upsertNetworkEvent(
  firstCapture,
  "Network.requestWillBeSent",
  {
    requestId: "stale-body-request",
    type: "Fetch",
    wallTime: nowMs / 1000,
    request: {
      method: "GET",
      url: "https://app.example.test/error",
      headers: {}
    }
  },
  firstCapture.captureOptions
);
firstCapture = BrowserAnnotationDevtoolsCapture.upsertNetworkEvent(
  firstCapture,
  "Network.responseReceived",
  {
    requestId: "stale-body-request",
    type: "Fetch",
    response: {
      url: "https://app.example.test/error",
      status: 500,
      mimeType: "application/json",
      encodedDataLength: 16,
      headers: {}
    }
  },
  firstCapture.captureOptions
);
firstCapture = BrowserAnnotationDevtoolsCapture.upsertNetworkEvent(
  firstCapture,
  "Network.loadingFinished",
  {
    requestId: "stale-body-request",
    encodedDataLength: 16
  },
  firstCapture.captureOptions
);
storage.set(storageKey, firstCapture);
context.devtoolsCaptureTabId = 42;

pendingBodyResponse = deferred();
const staleBodyCapture = context.captureResponseBodyIfAllowed(source, {
  requestId: "stale-body-request"
});
await delay(0);
const secondCapture = BrowserAnnotationDevtoolsCapture.createDevtoolsCaptureState(
  {
    id: 42,
    title: "Restarted same tab",
    url: "https://app.example.test/restarted"
  },
  {
    nowMs: nowMs + 5000,
    timeoutMs: 60000,
    captureResponseBodies: true
  }
);
storage.set(storageKey, secondCapture);
pendingBodyResponse.resolve({ body: "{\"error\":true}", base64Encoded: false });
await staleBodyCapture;

const restartedState = storage.get(storageKey);
assert.equal(restartedState.active, true);
assert.equal(restartedState.startedAtIso, secondCapture.startedAtIso);
assert.equal(restartedState.networkRows.some((row) => row.requestId === "stale-body-request"), false);

storage.set(storageKey, BrowserAnnotationDevtoolsCapture.createDevtoolsCaptureState(
  {
    id: 42,
    title: "Closed after restart",
    url: "https://app.example.test/closed"
  },
  {
    nowMs: nowMs + 6000,
    timeoutMs: 60000
  }
));
context.devtoolsCaptureTabId = null;
tabRemovedListeners[0](42);
await waitForStoredState(storageKey, (state) => state && state.active === false);
const closedState = storage.get(storageKey);
assert.equal(closedState.active, false);
assert.equal(closedState.detachReason, "tab-closed");

storage.set(storageKey, BrowserAnnotationDevtoolsCapture.createDevtoolsCaptureState(
  {
    id: 42,
    title: "Navigated after restart",
    url: "https://app.example.test/before-navigation"
  },
  {
    nowMs: nowMs + 7000,
    timeoutMs: 60000
  }
));
context.devtoolsCaptureTabId = null;
tabUpdatedListeners[0](42, { status: "loading", url: "https://app.example.test/after-navigation" });
await waitForStoredState(storageKey, (state) => state && state.active === false);
const navigatedState = storage.get(storageKey);
assert.equal(navigatedState.active, false);
assert.equal(navigatedState.detachReason, "tab-navigated");

const annotationQueueKey = BrowserAnnotationConstants.STORAGE_KEYS.annotationQueue;
storage.set(annotationQueueKey, []);
await Promise.all([
  context.saveDraftAnnotation(
    {
      context: { selector: "#alpha", text: "alpha", rect: { x: 0, y: 0, width: 10, height: 10 }, viewport: { width: 100, height: 100, devicePixelRatio: 1 } },
      screenshotEnabled: false
    },
    { tab: { id: 42, windowId: 7, title: "Queue race", url: "https://app.example.test/queue" } }
  ),
  context.saveDraftAnnotation(
    {
      context: { selector: "#bravo", text: "bravo", rect: { x: 10, y: 10, width: 10, height: 10 }, viewport: { width: 100, height: 100, devicePixelRatio: 1 } },
      screenshotEnabled: false
    },
    { tab: { id: 42, windowId: 7, title: "Queue race", url: "https://app.example.test/queue" } }
  )
]);
const concurrentQueue = storage.get(annotationQueueKey);
assert.equal(concurrentQueue.length, 2);
assert.deepEqual(concurrentQueue.map((item) => item.context.selector).sort(), ["#alpha", "#bravo"]);

activeTabs.splice(0, activeTabs.length, {
  id: 99,
  windowId: 7,
  active: true,
  title: "Arbitrary host",
  url: "https://arbitrary.example.test/feature"
});
const stateBeforePermission = await context.getPanelState();
assert.equal(stateBeforePermission.activeTab.hostPermissionPattern, "https://arbitrary.example.test/*");
assert.equal(stateBeforePermission.activeTab.hasHostAccess, false);
assert.equal(stateBeforePermission.activeTab.needsHostPermission, true);
assert.equal(stateBeforePermission.activeTab.hostAccessStatus, "needs_permission");

await assert.rejects(
  () => context.injectOverlayIntoActiveTab(),
  /Grant site access for https:\/\/arbitrary\.example\.test\/\*/
);
assert.equal(executedScripts.length, 0);

context.chrome.permissions.grantTestOrigin("https://arbitrary.example.test/*");
const injectResult = await context.injectOverlayIntoActiveTab();
assert.equal(injectResult.ok, true);
assert.equal(injectResult.injected, true);
assert.equal(executedScripts.length, 1);
const stateAfterPermission = await context.getPanelState();
assert.equal(stateAfterPermission.activeTab.hasHostAccess, true);
assert.equal(stateAfterPermission.activeTab.needsHostPermission, false);
assert.equal(stateAfterPermission.activeTab.hostAccessStatus, "granted");

storage.set(BrowserAnnotationConstants.STORAGE_KEYS.pairingToken, "revoked-token");
context.fetch = async () => new Response(JSON.stringify({
  ok: true,
  session: {
    sessionId: "revoked-session",
    threadId: "thread-revoked",
    status: "revoked",
    serverUrl: "https://codex-ui.todo-tg-app.ru",
    serverPath: "/codex-api/extension/listen",
    expiresAtIso: "2026-05-28T12:10:00.000Z",
    createdAtIso: "2026-05-28T12:00:00.000Z"
  }
}), {
  status: 200,
  headers: { "Content-Type": "application/json" }
});
const revokedState = await context.getPanelState();
assert.equal(revokedState.connection.status, "disconnected");
assert.equal(revokedState.connection.session.status, "revoked");
assert.equal(revokedState.settings.pairingToken, "");
assert.equal(storage.has(BrowserAnnotationConstants.STORAGE_KEYS.pairingToken), false);

const persistentFetchCalls = [];
context.fetch = async (input, init = {}) => {
  const url = String(input);
  const authorization = init.headers && init.headers.Authorization;
  persistentFetchCalls.push({ url, method: init.method || "GET", authorization, body: init.body ? String(init.body) : "" });
  if (url.includes("/binding/revoke")) {
    assert.equal(authorization, "Bearer binding-token-smoke");
    return jsonResponse({
      ok: true,
      binding: {
        ...persistentBindingPayload(),
        status: "revoked"
      }
    });
  }
  if (url.includes("/binding/complete")) {
    assert.equal(authorization, "Bearer pairing-token-smoke");
    return jsonResponse({
      ok: true,
      binding: {
        bindingId: "browser-binding-smoke",
        status: "active",
        tokenType: "browser-binding",
        serverUrl: "https://codex-ui.todo-tg-app.ru",
        serverPath: "/codex-api/extension/binding",
        expiresAtIso: "2027-05-30T12:00:00.000Z",
        createdAtIso: "2026-05-30T12:00:00.000Z",
        lastUsedAtIso: "2026-05-30T12:00:00.000Z",
        bindingToken: "binding-token-smoke"
      }
    });
  }
  if (url.includes("/binding/status")) {
    assert.equal(authorization, "Bearer binding-token-smoke");
    return jsonResponse({
      ok: true,
      binding: persistentBindingPayload()
    });
  }
  if (url.includes("/extension/threads")) {
    assert.equal(authorization, "Bearer binding-token-smoke");
    return jsonResponse({
      ok: true,
      groups: [
        {
          projectName: "codexUI",
          cwd: "/home/rnl1/prog/codexUI",
          threads: [
            {
              id: "thread-selector-1",
              title: "Ресерч browser remote extension",
              preview: "ок, законнектился",
              updatedAtIso: "2026-06-16T14:30:00.000Z",
              cwd: "/home/rnl1/prog/codexUI"
            }
          ]
        }
      ]
    });
  }
  if (url.includes("/listen/bind-thread")) {
    assert.equal(authorization, "Bearer binding-token-smoke");
    const body = JSON.parse(init.body);
    assert.equal(body.threadId, "thread-selector-1");
    return jsonResponse({
      ok: true,
      session: {
        sessionId: "scoped-session-selector-1",
        threadId: "thread-selector-1",
        status: "active",
        tokenType: "extension",
        serverUrl: "https://codex-ui.todo-tg-app.ru",
        serverPath: "/codex-api/extension/listen",
        expiresAtIso: "2026-07-16T14:30:00.000Z",
        createdAtIso: "2026-06-16T14:30:00.000Z",
        lastUsedAtIso: "2026-06-16T14:30:00.000Z",
        extensionToken: "scoped-thread-token"
      }
    });
  }
  if (url.includes("/annotation-batch")) {
    assert.equal(authorization, "Bearer scoped-thread-token");
    assert.equal(url.includes("sessionId=scoped-session-selector-1"), true);
    assert.equal(url.includes("threadId=thread-selector-1"), true);
    const body = JSON.parse(init.body);
    assert.equal(body.targetThreadId, "thread-selector-1");
    return jsonResponse({
      ok: true,
      result: {
        status: "queued",
        threadId: "thread-selector-1",
        batchId: body.batchId,
        annotationCount: body.items.length,
        imageCount: 0,
        consoleCount: 0,
        networkCount: 0,
        queuedMessageId: "queued-selector-batch"
      }
    });
  }
  throw new Error(`Unexpected persistent smoke fetch: ${url}`);
};

const savedPersistentState = await context.handleMessage({
  type: BrowserAnnotationConstants.MESSAGE_TYPES.SAVE_SETTINGS,
  settings: {
    serverUrl: "https://codex-ui.todo-tg-app.ru",
    pairingToken: "pairing-token-smoke"
  }
});
const binding = storage.get(BrowserAnnotationConstants.STORAGE_KEYS.binding);
assert.equal(binding.token, "binding-token-smoke");
assert.equal(binding.bindingId, "browser-binding-smoke");
assert.equal(binding.tokenType, "browser-binding");
assert.equal(binding.threadId, undefined);
assert.equal(binding.sessionId, undefined);
assert.equal(storage.has(BrowserAnnotationConstants.STORAGE_KEYS.pairingToken), false);
assert.equal(savedPersistentState.state.connection.status, "connected");
assert.equal(savedPersistentState.state.connection.binding.tokenType, "browser-binding");
assert.equal(savedPersistentState.state.connection.authToken, undefined);
assert.equal(savedPersistentState.state.persistentBinding.status, "active");
assert.equal(savedPersistentState.state.persistentBinding.bindingId, "browser-binding-smoke");
assert.equal(savedPersistentState.state.persistentBinding.token, undefined);
assert.equal(savedPersistentState.state.threadTargets.status, "ready");
assert.equal(savedPersistentState.state.threadTargets.groups[0].projectName, "codexUI");
assert.equal(savedPersistentState.state.threadTargets.groups[0].threads[0].id, "thread-selector-1");
assert.equal(JSON.stringify(savedPersistentState.state).includes("binding-token-smoke"), false);

const selectedTargetState = await context.handleMessage({
  type: BrowserAnnotationConstants.MESSAGE_TYPES.SELECT_THREAD_TARGET,
  threadId: "thread-selector-1"
});
assert.equal(selectedTargetState.ok, true);
assert.equal(storage.get(BrowserAnnotationConstants.STORAGE_KEYS.threadTarget).selectedThreadId, "thread-selector-1");
assert.equal(selectedTargetState.state.threadTargets.selectedThreadId, "thread-selector-1");
assert.equal(selectedTargetState.state.threadTargets.selectedThread.title, "Ресерч browser remote extension");

activeTabs.splice(0, activeTabs.length, {
  id: 101,
  windowId: 7,
  active: true,
  title: "Page state auth",
  url: "https://app.example.test/page-state"
});
storage.set(annotationQueueKey, []);
storage.set(storageKey, BrowserAnnotationDevtoolsCapture.createDevtoolsCaptureState(
  {
    id: 101,
    title: "Page state auth",
    url: "https://app.example.test/page-state"
  },
  {
    nowMs,
    timeoutMs: 60000
  }
));
await context.handleMessage({
  type: BrowserAnnotationConstants.MESSAGE_TYPES.ADD_PAGE_STATE_ANNOTATION,
  noteText: "Capture current page behavior"
});
const pageStateQueue = storage.get(annotationQueueKey);
assert.equal(pageStateQueue.length, 1);
assert.equal(pageStateQueue[0].kind, "devtools/page-state");
assert.equal(pageStateQueue[0].noteText, "Capture current page behavior");
assert.equal(storage.get(BrowserAnnotationConstants.STORAGE_KEYS.binding).token, "binding-token-smoke");
assert.equal(persistentFetchCalls.some((call) => call.url.includes("/listen/stop")), false);

const sentScopedBatch = await context.handleMessage({
  type: BrowserAnnotationConstants.MESSAGE_TYPES.SEND_ANNOTATION_BATCH
});
assert.equal(sentScopedBatch.ok, true);
assert.equal(sentScopedBatch.result.threadId, "thread-selector-1");
assert.equal(JSON.stringify(sentScopedBatch.state).includes("scoped-thread-token"), false);
assert.equal(storage.get(annotationQueueKey).length, 0);
assert.equal(persistentFetchCalls.some((call) => call.url.includes("/listen/bind-thread")), true);
assert.equal(persistentFetchCalls.some((call) => call.url.includes("/annotation-batch")), true);

const disconnectedPersistent = await context.handleMessage({
  type: BrowserAnnotationConstants.MESSAGE_TYPES.DISCONNECT_BINDING
});
assert.equal(disconnectedPersistent.ok, true);
assert.equal(storage.has(BrowserAnnotationConstants.STORAGE_KEYS.binding), false);
assert.equal(disconnectedPersistent.state.connection.status, "disconnected");

console.log("Extension DevTools service worker persistence smoke passed.");

function persistentBindingPayload() {
  return {
    bindingId: "browser-binding-smoke",
    status: "active",
    tokenType: "browser-binding",
    serverUrl: "https://codex-ui.todo-tg-app.ru",
    serverPath: "/codex-api/extension/binding",
    expiresAtIso: "2027-05-30T12:00:01.000Z",
    createdAtIso: "2026-05-30T12:00:00.000Z",
    lastUsedAtIso: "2026-05-30T12:00:01.000Z"
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function createChromeStub(
  localStorage,
  detachLog,
  executeScriptLog,
  activeTabList,
  getPendingBodyResponse
) {
  const addListener = () => {};
  const grantedOrigins = new Set();
  return {
    action: {
      onClicked: { addListener }
    },
    alarms: {
      clear: async () => {},
      create: () => {},
      onAlarm: { addListener }
    },
    debugger: {
      attach: async () => {},
      detach: async (debuggee) => {
        detachLog.push(debuggee.tabId);
      },
      sendCommand: async () => {
        const pending = getPendingBodyResponse();
        if (pending) {
          return pending.promise;
        }
        return { body: "", base64Encoded: false };
      },
      onDetach: { addListener },
      onEvent: { addListener }
    },
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getManifest: () => ({ version: "0.1.0" }),
      onInstalled: { addListener },
      onMessage: { addListener },
      onStartup: { addListener }
    },
    permissions: {
      contains: async (request) => {
        const origins = Array.isArray(request?.origins) ? request.origins : [];
        return origins.every((origin) => grantedOrigins.has(origin));
      },
      grantTestOrigin: (origin) => {
        grantedOrigins.add(origin);
      },
      request: async () => {
        throw new Error("service worker must not request optional host permissions");
      }
    },
    scripting: {
      executeScript: async (options) => {
        executeScriptLog.push(clone(options));
      }
    },
    sidePanel: {
      setPanelBehavior: async () => {}
    },
    storage: {
      local: {
        get: async (key) => {
          await delay(0);
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.map((item) => [item, clone(localStorage.get(item))]));
        },
        set: async (value) => {
          await delay(0);
          for (const [key, item] of Object.entries(value)) {
            localStorage.set(key, clone(item));
          }
        },
        remove: async (key) => {
          await delay(0);
          localStorage.delete(key);
        }
      },
      session: {
        get: async (key) => {
          await delay(0);
          const keys = Array.isArray(key) ? key : [key];
          return Object.fromEntries(keys.map((item) => [item, clone(localStorage.get(item))]));
        },
        set: async (value) => {
          await delay(0);
          for (const [key, item] of Object.entries(value)) {
            localStorage.set(key, clone(item));
          }
        },
        remove: async (key) => {
          await delay(0);
          localStorage.delete(key);
        }
      }
    },
    tabs: {
      captureVisibleTab: async () => "",
      get: async (tabId) => activeTabList.find((tab) => tab.id === tabId) || { active: true },
      onRemoved: { addListener: (listener) => tabRemovedListeners.push(listener) },
      onUpdated: { addListener: (listener) => tabUpdatedListeners.push(listener) },
      query: async () => activeTabList,
      sendMessage: async () => ({ ok: true })
    }
  };
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function waitForStoredState(key, predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = storage.get(key);
    if (predicate(value)) {
      return value;
    }
    await delay(10);
  }
  return storage.get(key);
}

function deferred() {
  let resolveDeferred;
  let rejectDeferred;
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  return {
    promise,
    resolve: resolveDeferred,
    reject: rejectDeferred
  };
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
