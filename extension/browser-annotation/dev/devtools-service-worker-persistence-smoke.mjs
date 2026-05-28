import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const storage = new Map();
const detachedTabs = [];
const permissionRequests = [];
const executedScripts = [];
const tabRemovedListeners = [];
const tabUpdatedListeners = [];
const activeTabs = [];
let pendingBodyResponse = null;
let grantNextPermissionRequest = true;

const context = vm.createContext({
  AbortController,
  Date,
  Math,
  Promise,
  Set,
  Symbol,
  TextEncoder,
  URL,
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
  permissionRequests,
  executedScripts,
  activeTabs,
  () => pendingBodyResponse,
  () => grantNextPermissionRequest
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
await delay(10);
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
await delay(10);
const navigatedState = storage.get(storageKey);
assert.equal(navigatedState.active, false);
assert.equal(navigatedState.detachReason, "tab-navigated");

const annotationQueueKey = BrowserAnnotationConstants.STORAGE_KEYS.annotationQueue;
storage.set(annotationQueueKey, []);
await Promise.all([
  context.saveSelectedElementContext(
    { selector: "#alpha", text: "alpha", rect: { x: 0, y: 0, width: 10, height: 10 }, viewport: { width: 100, height: 100, devicePixelRatio: 1 } },
    { tab: { id: 42, windowId: 7, title: "Queue race", url: "https://app.example.test/queue" } }
  ),
  context.saveSelectedElementContext(
    { selector: "#bravo", text: "bravo", rect: { x: 10, y: 10, width: 10, height: 10 }, viewport: { width: 100, height: 100, devicePixelRatio: 1 } },
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

grantNextPermissionRequest = false;
await assert.rejects(
  context.injectOverlayIntoActiveTab(),
  /Permission denied\. Allow Codex UI Browser Annotation to access https:\/\/arbitrary\.example\.test\/\* before injecting the overlay\./u
);
assert.deepEqual(permissionRequests.at(-1), ["https://arbitrary.example.test/*"]);
assert.equal(executedScripts.length, 0);

grantNextPermissionRequest = true;
const injectResult = await context.injectOverlayIntoActiveTab();
assert.equal(injectResult.ok, true);
assert.equal(injectResult.injected, true);
assert.deepEqual(permissionRequests.at(-1), ["https://arbitrary.example.test/*"]);
assert.equal(executedScripts.length, 1);
const stateAfterPermission = await context.getPanelState();
assert.equal(stateAfterPermission.activeTab.hasHostAccess, true);
assert.equal(stateAfterPermission.activeTab.needsHostPermission, false);
assert.equal(stateAfterPermission.activeTab.hostAccessStatus, "granted");

console.log("Extension DevTools service worker persistence smoke passed.");

function createChromeStub(
  localStorage,
  detachLog,
  permissionRequestLog,
  executeScriptLog,
  activeTabList,
  getPendingBodyResponse,
  shouldGrantPermissionRequest
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
      request: async (request) => {
        const origins = Array.isArray(request?.origins) ? request.origins : [];
        permissionRequestLog.push([...origins]);
        if (!shouldGrantPermissionRequest()) {
          return false;
        }
        for (const origin of origins) {
          grantedOrigins.add(origin);
        }
        return true;
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
