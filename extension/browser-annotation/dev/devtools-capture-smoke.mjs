import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({
  Date,
  Math,
  TextEncoder,
  URL,
  console,
  globalThis: {}
});
context.globalThis = context;

for (const relativePath of [
  "shared/constants.js",
  "shared/devtools-capture.js"
]) {
  const source = await readFile(resolve(extensionRoot, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

const { BrowserAnnotationDevtoolsCapture } = context;
let state = BrowserAnnotationDevtoolsCapture.createDevtoolsCaptureState(
  {
    id: 9,
    title: "DevTools smoke",
    url: "https://app.example.test/smoke?token=secret"
  },
  {
    nowMs: Date.parse("2026-05-28T10:00:00.000Z"),
    timeoutMs: 60000
  }
);

assert.equal(state.active, true);
assert.equal(state.tabId, 9);
assert.equal(state.tabUrl, "https://app.example.test/smoke?token=%5Bredacted%5D");

state = BrowserAnnotationDevtoolsCapture.appendConsoleEvent(
  state,
  "Runtime.consoleAPICalled",
  {
    type: "warning",
    timestamp: Date.parse("2026-05-28T10:00:01.000Z"),
    args: [{ value: "codex-devtools-smoke:warn" }],
    stackTrace: {
      callFrames: [
        {
          functionName: "emitWarning",
          url: "https://app.example.test/smoke",
          lineNumber: 12,
          columnNumber: 4
        }
      ]
    }
  },
  { nowMs: Date.parse("2026-05-28T10:00:01.000Z") }
);

state = BrowserAnnotationDevtoolsCapture.upsertNetworkEvent(
  state,
  "Network.requestWillBeSent",
  {
    requestId: "request-1",
    type: "Fetch",
    wallTime: Date.parse("2026-05-28T10:00:02.000Z") / 1000,
    request: {
      method: "GET",
      url: "https://app.example.test/api?token=secret"
    }
  },
  { nowMs: Date.parse("2026-05-28T10:00:02.000Z") }
);
state = BrowserAnnotationDevtoolsCapture.upsertNetworkEvent(
  state,
  "Network.responseReceived",
  {
    requestId: "request-1",
    type: "Fetch",
    response: {
      url: "https://app.example.test/api?token=secret",
      status: 404,
      statusText: "Not Found",
      mimeType: "application/json"
    }
  },
  { nowMs: Date.parse("2026-05-28T10:00:03.000Z") }
);
state = BrowserAnnotationDevtoolsCapture.upsertNetworkEvent(
  state,
  "Network.loadingFinished",
  {
    requestId: "request-1",
    encodedDataLength: 42
  },
  { nowMs: Date.parse("2026-05-28T10:00:04.000Z") }
);

const status = BrowserAnnotationDevtoolsCapture.buildDevtoolsCaptureStatus(state);
assert.equal(status.status, "active");
assert.equal(status.consoleCount, 1);
assert.equal(status.networkCount, 1);
assert.equal(status.lastConsoleRow.level, "warn");
assert.equal(status.lastNetworkRow.status, 404);
assert.equal(status.lastNetworkRow.url, "https://app.example.test/api?token=%5Bredacted%5D");
assert.equal(status.lastNetworkRow.bodyCapture.state, "metadata-only");

const stopped = BrowserAnnotationDevtoolsCapture.stopDevtoolsCaptureState(state, "smoke-stop", {
  stoppedAtIso: "2026-05-28T10:00:05.000Z"
});
assert.equal(stopped.active, false);
assert.equal(stopped.detachReason, "smoke-stop");

console.log("Extension DevTools capture smoke passed.");
