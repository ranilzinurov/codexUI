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

const devtoolsBatch = BrowserAnnotationQueue.buildAnnotationBatchPayload(
  [
    {
      ...stageQueue[0],
      createdAtIso: "2026-05-28T10:03:00.000Z"
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
          failureReason: ""
        }
      ]
    }
  }
);
assert.equal(devtoolsBatch.devTools.attachMode, "explicit-user-enabled");
assert.equal(devtoolsBatch.devTools.console[0].level, "warning");
assert.equal(devtoolsBatch.devTools.network[0].requestHeaders.length, 0);
assert.equal(devtoolsBatch.devTools.summary.consoleCount, 1);
assert.equal(devtoolsBatch.devTools.summary.networkCount, 1);
assert.equal(devtoolsBatch.devTools.summary.errorCount, 1);
assert.deepEqual(devtoolsBatch.items[0].devToolsContext.consoleEntryIds, ["console-smoke"]);
assert.deepEqual(devtoolsBatch.items[0].devToolsContext.requestIds, ["network-smoke"]);
assert.ok(!JSON.stringify(devtoolsBatch).includes("request-smoke"));

console.log("Extension annotation queue smoke passed.");
