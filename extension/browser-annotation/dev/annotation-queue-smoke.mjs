import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({
  TextEncoder,
  console,
  globalThis: {}
});
context.globalThis = context;

for (const relativePath of [
  "shared/constants.js",
  "shared/annotation-queue.js"
]) {
  const source = await readFile(resolve(extensionRoot, relativePath), "utf8");
  vm.runInContext(source, context, { filename: relativePath });
}

const { BrowserAnnotationConstants, BrowserAnnotationQueue } = context;
const oversizedPreview = "data:image/png;base64," + "a".repeat(250000);
const queue = Array.from({ length: 25 }, (_value, index) => ({
  id: `item-${index}`,
  context: {
    selector: `#item-${index}`,
    text: `Item ${index}`
  },
  preview: {
    dataUrl: oversizedPreview,
    width: 640,
    height: 320
  }
}));

const trimmed = BrowserAnnotationQueue.trimAnnotationQueue(queue);
const bytes = BrowserAnnotationQueue.estimateJsonBytes(trimmed);
assert.ok(trimmed.length < queue.length);
assert.ok(bytes <= BrowserAnnotationConstants.MAX_ANNOTATION_QUEUE_STORAGE_BYTES);
assert.equal(trimmed.at(-1).id, "item-24");

const countTrimmed = BrowserAnnotationQueue.trimAnnotationQueue(
  Array.from({ length: 40 }, (_value, index) => ({ id: `small-${index}` }))
);
assert.equal(countTrimmed.length, 25);
assert.equal(countTrimmed[0].id, "small-15");

const stageQueue = ["alpha", "bravo", "charlie"].map((name, index) => ({
  id: `annotation-${name}`,
  createdAtIso: `2026-05-28T10:00:0${index}.000Z`,
  tab: {
    id: 7,
    title: "Queue smoke",
    url: "https://app.example.test/settings"
  },
  context: {
    selector: `#${name}`,
    xpath: `/html/body/button[${index + 1}]`,
    tagName: "button",
    text: name,
    aria: {
      label: `${name} action`
    },
    rect: {
      x: index * 10,
      y: index * 20,
      width: 120,
      height: 36
    },
    viewport: {
      width: 1280,
      height: 720,
      scrollX: 0,
      scrollY: 64,
      devicePixelRatio: 1
    },
    page: {
      title: "Queue smoke",
      url: "https://app.example.test/settings"
    }
  },
  preview: {
    dataUrl: `data:image/png;base64,${name}`,
    width: 120,
    height: 36
  }
}));

let edited = BrowserAnnotationQueue.updateAnnotationQueueItem(stageQueue, "annotation-alpha", {
  noteText: "First note"
});
edited = BrowserAnnotationQueue.updateAnnotationQueueItem(edited, "annotation-bravo", {
  noteText: "Second note"
});
edited = BrowserAnnotationQueue.moveAnnotationQueueItem(edited, "annotation-bravo", -1);
edited = BrowserAnnotationQueue.deleteAnnotationQueueItem(edited, "annotation-charlie");

assert.deepEqual(
  edited.map((item) => item.id),
  ["annotation-bravo", "annotation-alpha"]
);

const batch = BrowserAnnotationQueue.buildAnnotationBatchPayload(edited, {
  batchId: "annotation-batch-smoke",
  createdAtIso: "2026-05-28T10:01:00.000Z",
  targetThreadId: "thread-smoke",
  extensionVersion: "0.1.0"
});
assert.equal(batch.schemaVersion, 1);
assert.equal(batch.targetThreadId, "thread-smoke");
assert.equal(batch.page.url, "https://app.example.test/settings");
assert.equal(batch.assets.length, 0);
assert.equal(batch.items.length, 2);
assert.equal(batch.items[0].id, "annotation-bravo");
assert.equal(batch.items[0].noteText, "Second note");
assert.equal(batch.items[0].target.selector, "#bravo");
assert.equal(batch.items[0].viewport.width, 1280);
assert.equal(batch.items[1].noteText, "First note");
assert.ok(!JSON.stringify(batch).includes("data:image/png"));
assert.ok(
  BrowserAnnotationQueue.estimateJsonBytes(batch) <
    BrowserAnnotationConstants.MAX_ANNOTATION_BATCH_BYTES
);

const blankNoteBatch = BrowserAnnotationQueue.buildAnnotationBatchPayload(
  [
    {
      ...stageQueue[0],
      noteText: ""
    }
  ],
  {
    batchId: "annotation-batch-blank-note",
    createdAtIso: "2026-05-28T10:02:00.000Z"
  }
);
assert.equal(blankNoteBatch.items[0].noteText, "");

const pageStateBatch = BrowserAnnotationQueue.buildAnnotationBatchPayload(
  [
    {
      id: "page-state-note",
      kind: "devtools/page-state",
      createdAtIso: "2026-05-28T10:02:30.000Z",
      tab: {
        id: 7,
        title: "Queue smoke",
        url: "https://app.example.test/settings"
      },
      context: {
        kind: "devtools/page-state",
        page: {
          title: "Queue smoke",
          url: "https://app.example.test/settings"
        }
      },
      noteText: "The page is stuck after clicking save.",
      preview: null
    }
  ],
  {
    batchId: "annotation-batch-page-state",
    createdAtIso: "2026-05-28T10:02:31.000Z",
    devtoolsCapture: {
      active: true,
      startedAtIso: "2026-05-28T10:02:00.000Z",
      consoleRows: [
        {
          id: "console-page-state",
          level: "error",
          text: "save failed",
          timestampIso: "2026-05-28T10:02:29.000Z"
        }
      ],
      networkRows: []
    }
  }
);
assert.equal(pageStateBatch.items[0].kind, "mixed");
assert.equal(pageStateBatch.items[0].noteText, "The page is stuck after clicking save.");
assert.equal(pageStateBatch.items[0].target, undefined);
assert.deepEqual(pageStateBatch.items[0].devToolsContext.consoleEntryIds, ["console-page-state"]);

const devtoolsBatch = BrowserAnnotationQueue.buildAnnotationBatchPayload(
  [
    {
      ...stageQueue[0],
      createdAtIso: "2026-05-28T10:03:00.000Z"
    },
    {
      ...stageQueue[1],
      id: "annotation-devtools-outside-window",
      createdAtIso: "2026-05-28T10:10:00.000Z"
    }
  ],
  {
    batchId: "annotation-batch-devtools",
    createdAtIso: "2026-05-28T10:03:01.000Z",
    devtoolsCapture: {
      active: true,
      startedAtIso: "2026-05-28T10:02:00.000Z",
      consoleRows: [
        {
          id: "console-smoke",
          level: "warn",
          text: "codex-devtools-smoke:warning",
          timestampIso: "2026-05-28T10:02:58.000Z",
          source: "Runtime.consoleAPICalled",
          url: "https://app.example.test/settings",
          lineNumber: 12,
          columnNumber: 4
        }
      ],
      networkRows: [
        {
          id: "network-smoke",
          requestId: "request-smoke",
          startedAtIso: "2026-05-28T10:02:57.000Z",
          finishedAtIso: "2026-05-28T10:02:59.000Z",
          method: "GET",
          url: "https://app.example.test/api/smoke?token=[redacted]",
          status: 404,
          statusText: "Not Found",
          resourceType: "fetch",
          failureReason: "",
          requestHeaders: [
            { name: "authorization", value: "[REDACTED]", redacted: true },
            { name: "content-type", value: "application/json" }
          ],
          responseHeaders: [
            { name: "set-cookie", value: "[REDACTED]", redacted: true }
          ],
          requestBody: {
            state: "redacted",
            reason: "sensitive",
            userOptIn: true,
            capBytes: 16384,
            byteLength: 21
          },
          responseBody: {
            state: "trimmed",
            userOptIn: true,
            capBytes: 4,
            text: "abcd",
            byteLength: 4,
            originalByteLength: 6,
            redactionApplied: false
          }
        }
      ]
    }
  }
);
assert.equal(devtoolsBatch.devTools.attachMode, "explicit-user-enabled");
assert.equal(devtoolsBatch.devTools.id, devtoolsBatch.items[0].devToolsContext.snapshotId);
assert.equal(devtoolsBatch.devTools.captureStartedAtIso, "2026-05-28T10:02:00.000Z");
assert.equal(devtoolsBatch.devTools.captureEndedAtIso, "2026-05-28T10:03:01.000Z");
assert.equal(devtoolsBatch.devTools.privacy.bodyCaptureMode, "full-body-opt-in");
assert.equal(devtoolsBatch.devTools.privacy.bodyCapBytes, 16384);
assert.equal(devtoolsBatch.devTools.console[0].level, "warning");
assert.equal(devtoolsBatch.devTools.console[0].text, "codex-devtools-smoke:warning");
assert.equal(devtoolsBatch.devTools.console[0].url, "https://app.example.test/settings");
assert.equal(devtoolsBatch.devTools.console[0].lineNumber, 12);
assert.deepEqual(toPlainJson(devtoolsBatch.devTools.network[0].requestHeaders), [
  { name: "authorization", value: "[REDACTED]", redacted: true },
  { name: "content-type", value: "application/json" }
]);
assert.deepEqual(toPlainJson(devtoolsBatch.devTools.network[0].responseHeaders), [
  { name: "set-cookie", value: "[REDACTED]", redacted: true }
]);
assert.equal(devtoolsBatch.devTools.network[0].requestBody.state, "redacted");
assert.equal(devtoolsBatch.devTools.network[0].responseBody.state, "trimmed");
assert.equal(devtoolsBatch.devTools.network[0].responseBody.text, "abcd");
assert.equal(devtoolsBatch.devTools.network[0].id, "network-smoke");
assert.equal(devtoolsBatch.devTools.network[0].method, "GET");
assert.equal(devtoolsBatch.devTools.network[0].url, "https://app.example.test/api/smoke?token=[redacted]");
assert.equal(devtoolsBatch.devTools.network[0].status, 404);
assert.equal(devtoolsBatch.devTools.network[0].statusText, "Not Found");
assert.equal(devtoolsBatch.devTools.network[0].resourceType, "fetch");
assert.equal(devtoolsBatch.devTools.summary.consoleCount, 1);
assert.equal(devtoolsBatch.devTools.summary.networkCount, 1);
assert.equal(devtoolsBatch.devTools.summary.errorCount, 1);
assert.equal(devtoolsBatch.devTools.summary.redactedHeaderCount, 2);
assert.equal(devtoolsBatch.devTools.summary.capturedBodyCount, 0);
assert.equal(devtoolsBatch.devTools.summary.trimmedBodyCount, 1);
assert.equal(devtoolsBatch.devTools.summary.omittedBodyCount, 1);
assert.equal(devtoolsBatch.items[0].target.ariaLabel, "alpha action");
assert.equal(devtoolsBatch.items[0].target.textSnippet, "alpha");
assert.deepEqual(devtoolsBatch.items[0].devToolsContext.consoleEntryIds, ["console-smoke"]);
assert.deepEqual(devtoolsBatch.items[0].devToolsContext.requestIds, ["network-smoke"]);
assert.equal(devtoolsBatch.items[0].devToolsContext.startedAtIso, "2026-05-28T10:01:00.000Z");
assert.equal(devtoolsBatch.items[0].devToolsContext.endedAtIso, "2026-05-28T10:03:30.000Z");
assert.equal(devtoolsBatch.items[1].devToolsContext, undefined);
assert.ok(devtoolsBatch.devTools.console.every((entry) => entry.id && entry.timestampIso && entry.text));
assert.ok(devtoolsBatch.devTools.network.every((request) => (
  request.id &&
  request.startedAtIso &&
  request.method &&
  request.url &&
  Array.isArray(request.requestHeaders) &&
  Array.isArray(request.responseHeaders)
)));
assert.ok(!JSON.stringify(devtoolsBatch).includes("request-smoke"));
assert.ok(!JSON.stringify(devtoolsBatch).includes("data:image/png"));

const voiceOnlyBatch = BrowserAnnotationQueue.buildAnnotationBatchPayload(
  [
    {
      ...stageQueue[0],
      id: "annotation-voice-only",
      noteText: "",
      voice: {
        assetId: "voice-asset-1",
        mimeType: "audio/webm",
        byteLength: 2048,
        durationMs: 3400,
        recordedAtIso: "2026-05-28T10:04:00.000Z",
        transcript: {
          status: "completed",
          text: "Open the advanced settings panel.",
          language: "en"
        },
        dataUrl: "data:audio/webm;base64,must-not-ship",
        rawAudio: "must-not-ship"
      }
    }
  ],
  {
    batchId: "annotation-batch-voice-only",
    createdAtIso: "2026-05-28T10:04:05.000Z"
  }
);
assert.equal(voiceOnlyBatch.items[0].kind, "voice");
assert.equal(voiceOnlyBatch.items[0].noteText, "");
assert.equal(voiceOnlyBatch.items[0].voiceNote.assetId, "voice-asset-1");
assert.equal(voiceOnlyBatch.items[0].voiceNote.durationMs, 3400);
assert.equal(voiceOnlyBatch.items[0].voiceNote.mimeType, "audio/webm");
assert.equal(voiceOnlyBatch.items[0].voiceNote.transcriptStatus, "complete");
assert.equal(voiceOnlyBatch.items[0].voiceNote.transcriptText, "Open the advanced settings panel.");
assert.equal(voiceOnlyBatch.items[0].voiceNote.language, "en");
assert.deepEqual(toPlainJson(voiceOnlyBatch.assets), [
  {
    id: "voice-asset-1",
    kind: "voice-note-audio",
    mimeType: "audio/webm",
    byteLength: 2048,
    durationMs: 3400,
    uploadedAtIso: "2026-05-28T10:04:00.000Z"
  }
]);
assert.ok(!JSON.stringify(voiceOnlyBatch).includes("data:audio"));
assert.ok(!JSON.stringify(voiceOnlyBatch).includes("must-not-ship"));

const noteAndVoiceBatch = BrowserAnnotationQueue.buildAnnotationBatchPayload(
  [
    {
      ...stageQueue[1],
      id: "annotation-note-voice",
      noteText: "User typed note",
      voice: {
        asset: {
          id: "voice-asset-2",
          mimeType: "audio/mp4",
          byteLength: 4096,
          durationMs: 1200,
          uploadedAtIso: "2026-05-28T10:05:01.000Z",
          sha256: "abc123"
        },
        transcriptText: "Voice transcript text"
      }
    }
  ],
  {
    batchId: "annotation-batch-note-voice",
    createdAtIso: "2026-05-28T10:05:00.000Z"
  }
);
assert.equal(noteAndVoiceBatch.items[0].kind, "mixed");
assert.equal(noteAndVoiceBatch.items[0].noteText, "User typed note");
assert.equal(noteAndVoiceBatch.items[0].voiceNote.assetId, "voice-asset-2");
assert.equal(noteAndVoiceBatch.items[0].voiceNote.transcriptStatus, "complete");
assert.equal(noteAndVoiceBatch.items[0].voiceNote.transcriptText, "Voice transcript text");
assert.equal(noteAndVoiceBatch.assets[0].sha256, "abc123");

const patchedNoteAndVoiceQueue = BrowserAnnotationQueue.updateAnnotationQueueItem(
  [
    {
      ...stageQueue[1],
      id: "annotation-note-preserve",
      noteText: "Keep this note"
    }
  ],
  "annotation-note-preserve",
  {
    voice: {
      assetId: "voice-asset-preserve",
      mimeType: "audio/webm",
      byteLength: 200,
      durationMs: 900,
      uploadedAtIso: "2026-05-28T10:05:02.000Z",
      transcriptText: "Only voice changed",
      base64: "raw-audio-base64",
      audioBase64: "raw-audio-base64",
      dataUrl: "data:audio/webm;base64,raw-audio-base64"
    }
  }
);
assert.equal(patchedNoteAndVoiceQueue[0].noteText, "Keep this note");
assert.equal(patchedNoteAndVoiceQueue[0].voice.assetId, "voice-asset-preserve");
assert.equal(Object.prototype.hasOwnProperty.call(patchedNoteAndVoiceQueue[0].voice, "base64"), false);
assert.equal(Object.prototype.hasOwnProperty.call(patchedNoteAndVoiceQueue[0].voice, "audioBase64"), false);
assert.equal(Object.prototype.hasOwnProperty.call(patchedNoteAndVoiceQueue[0].voice, "dataUrl"), false);

const failedTranscriptBatch = BrowserAnnotationQueue.buildAnnotationBatchPayload(
  [
    {
      ...stageQueue[0],
      id: "annotation-failed-transcript",
      voice: {
        assetId: "voice-asset-3",
        mimeType: "audio/webm",
        byteLength: 1024,
        durationMs: 1500,
        uploadedAtIso: "2026-05-28T10:06:01.000Z",
        transcript: {
          status: "failed",
          error: "Speech was not recognized."
        }
      }
    }
  ],
  {
    batchId: "annotation-batch-failed-transcript",
    createdAtIso: "2026-05-28T10:06:00.000Z"
  }
);
assert.equal(failedTranscriptBatch.items[0].kind, "voice");
assert.equal(failedTranscriptBatch.items[0].voiceNote.transcriptStatus, "failed");
assert.equal(failedTranscriptBatch.items[0].voiceNote.errorMessage, "Speech was not recognized.");

const assetReferenceBatch = BrowserAnnotationQueue.buildAnnotationBatchPayload(
  [
    {
      ...stageQueue[0],
      id: "annotation-asset-reference",
      voice: {
        audio: {
          assetRef: "voice-asset-ref",
          type: "audio/ogg",
          size: 512,
          durationMs: 900,
          uploadedAtIso: "2026-05-28T10:07:01.000Z"
        },
        transcriptStatus: "pending"
      }
    }
  ],
  {
    batchId: "annotation-batch-asset-reference",
    createdAtIso: "2026-05-28T10:07:00.000Z"
  }
);
assert.equal(assetReferenceBatch.items[0].voiceNote.assetId, "voice-asset-ref");
assert.equal(assetReferenceBatch.items[0].voiceNote.transcriptStatus, "pending");
assert.deepEqual(toPlainJson(assetReferenceBatch.assets), [
  {
    id: "voice-asset-ref",
    kind: "voice-note-audio",
    mimeType: "audio/ogg",
    byteLength: 512,
    durationMs: 900,
    uploadedAtIso: "2026-05-28T10:07:01.000Z"
  }
]);

console.log("Extension annotation queue smoke passed.");

function toPlainJson(value) {
  return JSON.parse(JSON.stringify(value));
}
