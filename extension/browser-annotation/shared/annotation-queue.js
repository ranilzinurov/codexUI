(function attachBrowserAnnotationQueue(globalScope) {
  "use strict";

  const constants = globalScope.BrowserAnnotationConstants;

  function trimAnnotationQueue(queue, options = {}) {
    const maxItems = positiveInteger(
      options.maxItems,
      constants.MAX_ANNOTATION_QUEUE_ITEMS
    );
    const maxStorageBytes = positiveInteger(
      options.maxStorageBytes,
      constants.MAX_ANNOTATION_QUEUE_STORAGE_BYTES
    );
    const cappedByCount = Array.isArray(queue) ? queue.slice(-maxItems) : [];

    while (
      cappedByCount.length > 0 &&
      estimateJsonBytes(cappedByCount) > maxStorageBytes
    ) {
      cappedByCount.shift();
    }

    return cappedByCount;
  }

  function estimateJsonBytes(value) {
    const json = JSON.stringify(value);
    if (typeof globalScope.TextEncoder === "function") {
      return new globalScope.TextEncoder().encode(json).byteLength;
    }
    return json.length;
  }

  function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }

  globalScope.BrowserAnnotationQueue = {
    estimateJsonBytes,
    trimAnnotationQueue
  };
})(globalThis);
