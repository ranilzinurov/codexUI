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

console.log("Extension annotation queue smoke passed.");
