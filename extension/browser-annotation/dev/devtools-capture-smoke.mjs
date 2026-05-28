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

const rawConsoleSecret = "password=supersecret token=abc123 cookie=sid=sekret Authorization: Bearer abc";
state = BrowserAnnotationDevtoolsCapture.appendConsoleEvent(
  state,
  "Runtime.consoleAPICalled",
  {
    type: "log",
    timestamp: Date.parse("2026-05-28T10:00:01.250Z"),
    args: [
      { value: `runtime string ${rawConsoleSecret}` },
      { description: `runtime description ${rawConsoleSecret}` },
      {
        type: "object",
        description: "Object",
        preview: {
          properties: [
            { name: "password", type: "string", value: "supersecret" },
            { name: "token", type: "string", value: "abc123" },
            { name: "cookie", type: "string", value: "sid=sekret" },
            { name: "Authorization", type: "string", value: "Bearer abc" }
          ]
        }
      }
    ],
    stackTrace: {
      callFrames: [
        {
          functionName: "emitSecret",
          url: "https://app.example.test/smoke",
          lineNumber: 14,
          columnNumber: 6
        }
      ]
    }
  },
  { nowMs: Date.parse("2026-05-28T10:00:01.250Z") }
);

state = BrowserAnnotationDevtoolsCapture.appendConsoleEvent(
  state,
  "Log.entryAdded",
  {
    entry: {
      level: "error",
      text: `log entry ${rawConsoleSecret}`,
      timestamp: Date.parse("2026-05-28T10:00:01.500Z"),
      url: "https://app.example.test/smoke"
    }
  },
  { nowMs: Date.parse("2026-05-28T10:00:01.500Z") }
);

state = BrowserAnnotationDevtoolsCapture.appendConsoleEvent(
  state,
  "Runtime.exceptionThrown",
  {
    exceptionDetails: {
      text: `exception ${rawConsoleSecret}`,
      exception: {
        description: `exception description ${rawConsoleSecret}`
      },
      url: "https://app.example.test/smoke",
      lineNumber: 16,
      columnNumber: 8
    }
  },
  { nowMs: Date.parse("2026-05-28T10:00:01.750Z") }
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
      url: "https://app.example.test/api?token=secret",
      headers: {
        Authorization: "Bearer secret",
        Cookie: "sid=secret",
        "Content-Type": "application/json",
        "X-Api-Key": "secret",
        "X-Codex-Trace": "trace-1"
      },
      postData: "{\"safe\":true}"
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
      mimeType: "application/json",
      encodedDataLength: 128,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "sid=secret",
        "X-Request-Id": "request-1"
      }
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
assert.equal(status.consoleCount, 4);
assert.equal(status.networkCount, 1);
assert.equal(status.lastConsoleRow.level, "error");
assert.equal(state.consoleRows[0].level, "warn");
assert.equal(status.lastNetworkRow.status, 404);
const serializedConsoleRows = JSON.stringify(status.detail) + JSON.stringify(state.consoleRows);
for (const rawSecretPart of [
  "password=supersecret",
  "token=abc123",
  "cookie=sid=sekret",
  "Authorization: Bearer abc",
  "Bearer abc",
  "supersecret",
  "abc123",
  "sid=sekret"
]) {
  assert.ok(
    !serializedConsoleRows.includes(rawSecretPart),
    `consoleRows should redact ${rawSecretPart}`
  );
}
assert.ok(serializedConsoleRows.includes("[REDACTED]"));
assert.equal(status.lastNetworkRow.url, "https://app.example.test/api?token=%5Bredacted%5D");
assert.deepEqual(toPlainJson(status.lastNetworkRow.requestHeaders.slice(0, 5)), [
  { name: "authorization", value: "[REDACTED]", redacted: true },
  { name: "cookie", value: "[REDACTED]", redacted: true },
  { name: "content-type", value: "application/json" },
  { name: "x-api-key", value: "[REDACTED]", redacted: true },
  { name: "x-codex-trace", value: "trace-1" }
]);
assert.deepEqual(toPlainJson(status.lastNetworkRow.responseHeaders.slice(0, 3)), [
  { name: "content-type", value: "application/json" },
  { name: "set-cookie", value: "[REDACTED]", redacted: true },
  { name: "x-request-id", value: "request-1" }
]);
assert.equal(status.lastNetworkRow.requestBody.state, "not-captured");
assert.equal(status.lastNetworkRow.requestBody.reason, "default-privacy");
assert.equal(status.lastNetworkRow.requestBody.userOptIn, false);
assert.equal(status.lastNetworkRow.requestBody.byteLength, 13);
assert.equal(status.lastNetworkRow.responseBody.state, "not-captured");
assert.equal(status.lastNetworkRow.responseBody.byteLength, 128);

state = BrowserAnnotationDevtoolsCapture.upsertNetworkEvent(
  state,
  "BrowserAnnotation.responseBodyCaptured",
  {
    requestId: "request-1",
    bodyText: "abcdef",
    mimeType: "application/json"
  },
  {
    nowMs: Date.parse("2026-05-28T10:00:04.500Z"),
    captureBodies: true,
    bodyCapBytes: 4
  }
);
assert.equal(state.networkRows[0].responseBody.state, "trimmed");
assert.equal(state.networkRows[0].responseBody.text, "abcd");
assert.equal(state.networkRows[0].responseBody.byteLength, 4);
assert.equal(state.networkRows[0].responseBody.originalByteLength, 6);

state = BrowserAnnotationDevtoolsCapture.upsertNetworkEvent(
  state,
  "BrowserAnnotation.requestBodyCaptured",
  {
    requestId: "request-1",
    bodyText: "{\"password\":\"secret\"}",
    mimeType: "application/json"
  },
  {
    nowMs: Date.parse("2026-05-28T10:00:04.750Z"),
    captureBodies: true,
    bodyCapBytes: 1024
  }
);
assert.equal(state.networkRows[0].requestBody.state, "redacted");
assert.equal(state.networkRows[0].requestBody.reason, "sensitive");
assert.equal(state.networkRows[0].requestBody.userOptIn, true);

const stopped = BrowserAnnotationDevtoolsCapture.stopDevtoolsCaptureState(state, "smoke-stop", {
  stoppedAtIso: "2026-05-28T10:00:05.000Z"
});
assert.equal(stopped.active, false);
assert.equal(stopped.detachReason, "smoke-stop");

console.log("Extension DevTools capture smoke passed.");

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}
