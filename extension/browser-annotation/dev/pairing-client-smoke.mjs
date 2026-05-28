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
const defaultStatusUrl = BrowserAnnotationPairingClient.buildListenStatusUrl(
  "https://annotate.todo-tg-app.ru/"
);
assert.equal(
  defaultStatusUrl,
  "https://annotate.todo-tg-app.ru/codex-api/extension/listen/status"
);

const localStatusUrl = BrowserAnnotationPairingClient.buildListenStatusUrl(
  "http://127.0.0.1:4173/local/path?ignored=true#hash"
);
assert.equal(
  localStatusUrl,
  "http://127.0.0.1:4173/codex-api/extension/listen/status"
);

const uploadUrl = BrowserAnnotationPairingClient.buildAssetUploadUrl(
  "http://127.0.0.1:4173/local/path?ignored=true#hash",
  { sessionId: "session-1", threadId: "thread-1" }
);
assert.equal(
  uploadUrl,
  "http://127.0.0.1:4173/codex-api/extension/assets?sessionId=session-1&threadId=thread-1"
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
  createdAtIso: "2026-05-28T00:00:00.000Z"
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
