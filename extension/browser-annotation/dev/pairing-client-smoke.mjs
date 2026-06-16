import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({
  URL,
  globalThis: {}
});
context.globalThis = context;

for (const relativePath of [
  "shared/constants.js",
  "shared/url-utils.js",
  "shared/pairing-client.js"
]) {
  const source = await readFile(resolve(extensionRoot, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

const { BrowserAnnotationPairingClient } = context;
const { BrowserAnnotationUrlUtils } = context;

assert.equal(
  BrowserAnnotationUrlUtils.getTabOriginPattern("https://docs.example.test/path?q=1#section"),
  "https://docs.example.test/*"
);
assert.equal(
  BrowserAnnotationUrlUtils.getTabOriginPattern("http://127.0.0.1:4173/test-page.html"),
  "http://127.0.0.1/*"
);
assert.equal(BrowserAnnotationUrlUtils.getTabOriginPattern("chrome://extensions"), "");
assert.equal(BrowserAnnotationUrlUtils.isRestrictedTabUrl("https://chromewebstore.google.com/detail/test"), true);
assert.equal(BrowserAnnotationUrlUtils.isRestrictedTabUrl("https://news.example.test/article"), false);

const defaultStatusUrl = BrowserAnnotationPairingClient.buildListenStatusUrl(
  "https://annotate.todo-tg-app.ru/"
);
assert.equal(
  defaultStatusUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/listen/status"
);

const defaultBindingCompleteUrl = BrowserAnnotationPairingClient.buildBindingCompleteUrl(
  "https://annotate.todo-tg-app.ru/"
);
assert.equal(
  defaultBindingCompleteUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/binding/complete"
);

const defaultBindingStatusUrl = BrowserAnnotationPairingClient.buildBindingStatusUrl(
  "https://annotate.todo-tg-app.ru/"
);
assert.equal(
  defaultBindingStatusUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/binding/status"
);

const defaultProControlPollUrl = BrowserAnnotationPairingClient.buildProControlPollUrl(
  "https://annotate.todo-tg-app.ru/"
);
assert.equal(
  defaultProControlPollUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/pro-control/poll"
);

const defaultProControlTaskStatusUrl = BrowserAnnotationPairingClient.buildProControlTaskStatusUrl(
  "https://annotate.todo-tg-app.ru/",
  "task/with slash"
);
assert.equal(
  defaultProControlTaskStatusUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/pro-control/tasks/task%2Fwith%20slash/status"
);

const defaultProControlTaskResultUrl = BrowserAnnotationPairingClient.buildProControlTaskResultUrl(
  "https://annotate.todo-tg-app.ru/",
  "task-1"
);
assert.equal(
  defaultProControlTaskResultUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/pro-control/tasks/task-1/result"
);

const defaultBindingRevokeUrl = BrowserAnnotationPairingClient.buildBrowserBindingRevokeUrl(
  "https://annotate.todo-tg-app.ru/"
);
assert.equal(
  defaultBindingRevokeUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/binding/revoke"
);

const defaultThreadTargetsUrl = BrowserAnnotationPairingClient.buildThreadTargetsUrl(
  "https://annotate.todo-tg-app.ru/"
);
assert.equal(
  defaultThreadTargetsUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/threads"
);

const defaultBindThreadUrl = BrowserAnnotationPairingClient.buildListenBindThreadUrl(
  "https://annotate.todo-tg-app.ru/"
);
assert.equal(
  defaultBindThreadUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/listen/bind-thread"
);

const defaultStopUrl = BrowserAnnotationPairingClient.buildListenStopUrl(
  "https://annotate.todo-tg-app.ru/"
);
assert.equal(
  defaultStopUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/listen/stop"
);

const localStatusUrl = BrowserAnnotationPairingClient.buildListenStatusUrl(
  "http://127.0.0.1:4173/local/path?ignored=true#hash"
);
assert.equal(
  localStatusUrl,
  "http://127.0.0.1:4173/codex-api/extension/listen/status"
);

const localIpv6StatusUrl = BrowserAnnotationPairingClient.buildListenStatusUrl(
  "http://[::1]:4173/local/path?ignored=true#hash"
);
assert.equal(
  localIpv6StatusUrl,
  "http://[::1]:4173/codex-api/extension/listen/status"
);

assert.throws(
  () => BrowserAnnotationPairingClient.buildListenStatusUrl("http://46.62.215.111"),
  /must use HTTPS unless it is localhost, 127\.0\.0\.1, or ::1/u
);

const uploadUrl = BrowserAnnotationPairingClient.buildAssetUploadUrl(
  "http://127.0.0.1:4173/local/path?ignored=true#hash",
  { sessionId: "session-1", threadId: "thread-1" }
);
assert.equal(
  uploadUrl,
  "http://127.0.0.1:4173/codex-api/extension/assets/upload?sessionId=session-1&threadId=thread-1"
);

const transcribeUrl = BrowserAnnotationPairingClient.buildTranscribeUrl(
  "https://annotate.todo-tg-app.ru/",
  { sessionId: "session-1", threadId: "thread-1" }
);
assert.equal(
  transcribeUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/transcribe?sessionId=session-1&threadId=thread-1"
);

const session = BrowserAnnotationPairingClient.readSessionFromStatusPayload({
  ok: true,
  session: {
    sessionId: "session-1",
    threadId: "thread-1",
    status: "active",
    serverUrl: null,
    serverPath: "/codex-api/extension/listen",
    expiresAtIso: "2026-05-28T00:10:00.000Z",
    createdAtIso: "2026-05-28T00:00:00.000Z",
    tokenType: "extension",
    lastUsedAtIso: "2026-05-28T00:03:00.000Z",
    extensionToken: "extension-token-1",
    pairingToken: "must-not-be-used"
  }
});
assert.deepEqual(JSON.parse(JSON.stringify(session)), {
  sessionId: "session-1",
  threadId: "thread-1",
  status: "active",
  serverUrl: null,
  serverPath: "/codex-api/extension/listen",
  expiresAtIso: "2026-05-28T00:10:00.000Z",
  createdAtIso: "2026-05-28T00:00:00.000Z",
  tokenType: "extension",
  lastUsedAtIso: "2026-05-28T00:03:00.000Z",
  extensionToken: "extension-token-1"
});

const binding = BrowserAnnotationPairingClient.readBindingFromStatusPayload({
  ok: true,
  binding: {
    bindingId: "binding-1",
    status: "active",
    serverUrl: null,
    serverPath: "/codex-api/extension/binding",
    expiresAtIso: "2027-05-28T00:10:00.000Z",
    createdAtIso: "2026-05-28T00:00:00.000Z",
    tokenType: "browser-binding",
    lastUsedAtIso: "2026-05-28T00:03:00.000Z",
    bindingToken: "binding-token-1",
    threadId: "must-not-be-used",
    sessionId: "must-not-be-used"
  }
});
assert.deepEqual(JSON.parse(JSON.stringify(binding)), {
  bindingId: "binding-1",
  status: "active",
  tokenType: "browser-binding",
  serverUrl: null,
  serverPath: "/codex-api/extension/binding",
  expiresAtIso: "2027-05-28T00:10:00.000Z",
  createdAtIso: "2026-05-28T00:00:00.000Z",
  lastUsedAtIso: "2026-05-28T00:03:00.000Z",
  bindingToken: "binding-token-1"
});

const error = BrowserAnnotationPairingClient.readStatusError(
  { error: "Invalid or expired extension bearer token" },
  "fallback"
);
assert.equal(error, "Invalid or expired extension bearer token");

const parsed = await BrowserAnnotationPairingClient.readJsonSafely({
  text: async () => "{\"ok\":true}"
});
assert.deepEqual(JSON.parse(JSON.stringify(parsed)), { ok: true });

const malformed = await BrowserAnnotationPairingClient.readJsonSafely({
  text: async () => "{"
});
assert.equal(malformed, null);

console.log("Extension pairing client smoke passed.");
