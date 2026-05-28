(function attachBrowserAnnotationQueue(globalScope) {
  "use strict";

  const constants = globalScope.BrowserAnnotationConstants;
  const DEFAULT_PRIVACY_RULES = Object.freeze({
    redactPasswordsTokensCookiesByDefault: true,
    sensitiveHeaderNames: Object.freeze([
      "authorization",
      "cookie",
      "proxy-authorization",
      "set-cookie",
      "x-api-key",
      "x-auth-token",
      "x-csrf-token"
    ]),
    sensitiveFieldNames: Object.freeze([
      "access_token",
      "api_key",
      "auth",
      "client_secret",
      "cookie",
      "csrf",
      "id_token",
      "password",
      "refresh_token",
      "secret",
      "session",
      "token"
    ]),
    bodyCaptureMode: "metadata-only",
    bodyCapBytes: 16384
  });

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

  function updateAnnotationQueueItem(queue, id, patch) {
    const safeId = String(id || "");
    return normalizeQueue(queue).map((item) => {
      if (item.id !== safeId) {
        return item;
      }
      return {
        ...item,
        noteText: sanitizeNoteText(patch && patch.noteText)
      };
    });
  }

  function deleteAnnotationQueueItem(queue, id) {
    const safeId = String(id || "");
    return normalizeQueue(queue).filter((item) => item.id !== safeId);
  }

  function moveAnnotationQueueItem(queue, id, direction) {
    const items = normalizeQueue(queue);
    const fromIndex = items.findIndex((item) => item.id === String(id || ""));
    if (fromIndex < 0) {
      return items;
    }
    const step = Number(direction) < 0 ? -1 : 1;
    const toIndex = fromIndex + step;
    if (toIndex < 0 || toIndex >= items.length) {
      return items;
    }
    const moved = items.slice();
    const [item] = moved.splice(fromIndex, 1);
    moved.splice(toIndex, 0, item);
    return moved;
  }

  function buildAnnotationBatchPayload(queue, options = {}) {
    const items = normalizeQueue(queue);
    if (items.length === 0) {
      throw new Error("Annotation queue is empty.");
    }

    const createdAtIso = options.createdAtIso || new Date().toISOString();
    const batchItems = items.map((item) => buildBatchItem(item));
    return {
      schemaVersion: 1,
      batchId: options.batchId || createId("annotation-batch"),
      createdAtIso,
      source: {
        kind: "chrome-extension",
        extensionVersion: options.extensionVersion || "",
        browserName: options.browserName || "Chrome"
      },
      targetThreadId: options.targetThreadId || undefined,
      page: readBatchPage(items),
      privacy: DEFAULT_PRIVACY_RULES,
      assets: [],
      items: batchItems
    };
  }

  function normalizeQueue(queue) {
    return Array.isArray(queue) ? queue.filter(isRecord) : [];
  }

  function buildBatchItem(item) {
    const context = isRecord(item.context) ? item.context : {};
    const page = readItemPage(item);
    const noteText = sanitizeNoteText(item.noteText);
    const batchItem = {
      id: item.id || createId("annotation"),
      kind: noteText ? "mixed" : "screenshot",
      createdAtIso: item.createdAtIso || new Date().toISOString(),
      page
    };

    const viewport = readViewport(context.viewport);
    if (viewport) {
      batchItem.viewport = viewport;
    }

    const target = readTarget(context);
    if (target) {
      batchItem.target = target;
    }

    batchItem.noteText = noteText;

    const selectedText = sanitizeText(context.text, 1000);
    if (selectedText) {
      batchItem.selectedText = selectedText;
    }

    return batchItem;
  }

  function readBatchPage(items) {
    for (const item of items) {
      const page = readItemPage(item);
      if (page.url) {
        return page;
      }
    }
    return { url: "about:blank" };
  }

  function readItemPage(item) {
    const context = isRecord(item.context) ? item.context : {};
    const contextPage = isRecord(context.page) ? context.page : {};
    const tab = isRecord(item.tab) ? item.tab : {};
    const url = sanitizeText(contextPage.url || tab.url, 2048);
    const title = sanitizeText(contextPage.title || tab.title, 300);
    const page = {
      url: url || "about:blank"
    };
    if (title) {
      page.title = title;
    }
    const origin = readOrigin(url);
    if (origin) {
      page.origin = origin;
    }
    if (typeof tab.id === "number" && Number.isFinite(tab.id)) {
      page.tabId = tab.id;
    }
    return page;
  }

  function readViewport(value) {
    if (!isRecord(value)) {
      return null;
    }
    return {
      width: finiteNumber(value.width),
      height: finiteNumber(value.height),
      devicePixelRatio: finiteNumber(value.devicePixelRatio || 1),
      scrollX: finiteNumber(value.scrollX),
      scrollY: finiteNumber(value.scrollY)
    };
  }

  function readTarget(context) {
    const target = {};
    const selector = sanitizeText(context.selector, 1000);
    const xpath = sanitizeText(context.xpath, 1000);
    const tagName = sanitizeText(context.tagName, 80);
    const aria = isRecord(context.aria) ? context.aria : {};
    const ariaLabel = sanitizeText(aria.label || aria.labelledByText, 300);
    const textSnippet = sanitizeText(context.text, 500);
    if (selector) {
      target.selector = selector;
    }
    if (xpath) {
      target.xpath = xpath;
    }
    if (tagName) {
      target.tagName = tagName;
    }
    if (ariaLabel) {
      target.ariaLabel = ariaLabel;
    }
    if (textSnippet) {
      target.textSnippet = textSnippet;
    }
    if (isRecord(context.rect)) {
      target.rect = {
        x: finiteNumber(context.rect.x),
        y: finiteNumber(context.rect.y),
        width: finiteNumber(context.rect.width),
        height: finiteNumber(context.rect.height)
      };
    }
    return Object.keys(target).length > 0 ? target : null;
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

  function sanitizeNoteText(value) {
    return sanitizeText(value, constants.MAX_ANNOTATION_NOTE_CHARS);
  }

  function sanitizeText(value, maxChars) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxChars) {
      return text;
    }
    return text.slice(0, Math.max(0, maxChars - 16)).trimEnd() + "... [truncated]";
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function readOrigin(url) {
    if (!url) {
      return "";
    }
    try {
      return new URL(url).origin;
    } catch (_error) {
      return "";
    }
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  globalScope.BrowserAnnotationQueue = {
    buildAnnotationBatchPayload,
    deleteAnnotationQueueItem,
    estimateJsonBytes,
    moveAnnotationQueueItem,
    sanitizeNoteText,
    updateAnnotationQueueItem,
    trimAnnotationQueue
  };
})(globalThis);
