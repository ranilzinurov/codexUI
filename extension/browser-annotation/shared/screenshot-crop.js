(function attachBrowserAnnotationScreenshotCrop(globalScope) {
  "use strict";

  const DEFAULT_MAX_PREVIEW_EDGE_PX = 640;
  const DEFAULT_MAX_PREVIEW_DATA_URL_CHARS = 750000;
  const DEFAULT_MIME_TYPE = "image/png";

  function buildCropPlan(rect, viewport, imageSize, options = {}) {
    const dpr = positiveNumber(viewport && viewport.devicePixelRatio, 1);
    const imageWidth = Math.max(0, Math.round(positiveNumber(imageSize && imageSize.width, 0)));
    const imageHeight = Math.max(0, Math.round(positiveNumber(imageSize && imageSize.height, 0)));
    const source = {
      x: Math.round(positiveNumber(rect && rect.left, 0) * dpr),
      y: Math.round(positiveNumber(rect && rect.top, 0) * dpr),
      width: Math.round(positiveNumber(rect && rect.width, 0) * dpr),
      height: Math.round(positiveNumber(rect && rect.height, 0) * dpr)
    };

    const crop = clampRect(source, imageWidth, imageHeight);
    const maxPreviewEdgePx = positiveNumber(
      options.maxPreviewEdgePx,
      DEFAULT_MAX_PREVIEW_EDGE_PX
    );
    const scale = Math.min(
      1,
      crop.width > 0 ? maxPreviewEdgePx / crop.width : 1,
      crop.height > 0 ? maxPreviewEdgePx / crop.height : 1
    );
    const output = {
      width: Math.max(1, Math.round(crop.width * scale)),
      height: Math.max(1, Math.round(crop.height * scale))
    };

    if (crop.width === 0 || crop.height === 0) {
      output.width = 0;
      output.height = 0;
    }

    return {
      sourceRect: source,
      cropRect: crop,
      outputSize: output,
      devicePixelRatio: dpr,
      scaled: scale < 1
    };
  }

  async function cropScreenshotDataUrl(dataUrl, rect, viewport, options = {}) {
    if (!isDataUrl(dataUrl)) {
      throw new Error("Screenshot capture did not return a data URL.");
    }
    if (typeof globalScope.fetch !== "function") {
      throw new Error("Screenshot crop requires fetch support for data URLs.");
    }
    if (typeof globalScope.createImageBitmap !== "function") {
      throw new Error("Screenshot crop requires createImageBitmap support.");
    }
    if (typeof globalScope.OffscreenCanvas !== "function") {
      throw new Error("Screenshot crop requires OffscreenCanvas support.");
    }

    const blob = await (await globalScope.fetch(dataUrl)).blob();
    const image = await globalScope.createImageBitmap(blob);
    try {
      const plan = buildCropPlan(rect, viewport, image, options);
      if (plan.cropRect.width <= 0 || plan.cropRect.height <= 0) {
        throw new Error("Selected element is outside the captured viewport.");
      }
      const preview = await renderCrop(image, plan, options);
      return {
        schemaVersion: 1,
        mimeType: preview.mimeType,
        dataUrl: preview.dataUrl,
        width: plan.outputSize.width,
        height: plan.outputSize.height,
        sourceImage: {
          width: image.width,
          height: image.height
        },
        cropRect: plan.cropRect,
        sourceRect: plan.sourceRect,
        devicePixelRatio: plan.devicePixelRatio,
        scaled: plan.scaled || preview.reencodedForSize,
        byteLength: dataUrlByteLength(preview.dataUrl)
      };
    } finally {
      if (typeof image.close === "function") {
        image.close();
      }
    }
  }

  async function renderCrop(image, plan, options) {
    const mimeType = options.mimeType || DEFAULT_MIME_TYPE;
    const maxChars = positiveNumber(
      options.maxPreviewDataUrlChars,
      DEFAULT_MAX_PREVIEW_DATA_URL_CHARS
    );
    let outputSize = plan.outputSize;
    let reencodedForSize = false;

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const rendered = await renderCropOnce(image, plan.cropRect, outputSize, mimeType);
      if (rendered.dataUrl.length <= maxChars) {
        plan.outputSize = outputSize;
        return {
          ...rendered,
          reencodedForSize
        };
      }
      if (outputSize.width === 1 && outputSize.height === 1) {
        break;
      }
      outputSize = {
        width: Math.max(1, Math.floor(outputSize.width * 0.7)),
        height: Math.max(1, Math.floor(outputSize.height * 0.7))
      };
      reencodedForSize = true;
    }

    throw new Error("Cropped screenshot preview exceeded the configured size cap.");
  }

  async function renderCropOnce(image, cropRect, outputSize, mimeType) {
    const canvas = new globalScope.OffscreenCanvas(
      outputSize.width,
      outputSize.height
    );
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      throw new Error("Unable to create a 2D crop canvas.");
    }
    context.drawImage(
      image,
      cropRect.x,
      cropRect.y,
      cropRect.width,
      cropRect.height,
      0,
      0,
      outputSize.width,
      outputSize.height
    );

    const blob = await canvas.convertToBlob({ type: mimeType });
    const dataUrl = await blobToDataUrl(blob, globalScope);
    return {
      dataUrl,
      mimeType: blob.type || mimeType
    };
  }

  function clampRect(rect, imageWidth, imageHeight) {
    const x = clamp(rect.x, 0, imageWidth);
    const y = clamp(rect.y, 0, imageHeight);
    const right = clamp(rect.x + Math.max(0, rect.width), 0, imageWidth);
    const bottom = clamp(rect.y + Math.max(0, rect.height), 0, imageHeight);
    return {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y)
    };
  }

  function isDataUrl(value) {
    return typeof value === "string" && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
  }

  function dataUrlByteLength(value) {
    if (!isDataUrl(value)) {
      return 0;
    }
    const comma = value.indexOf(",");
    const base64 = comma >= 0 ? value.slice(comma + 1) : "";
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
  }

  async function blobToDataUrl(blob, scope) {
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    const base64 = scope.btoa
      ? scope.btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");
    return `data:${blob.type || DEFAULT_MIME_TYPE};base64,${base64}`;
  }

  function positiveNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, Math.round(value)));
  }

  globalScope.BrowserAnnotationScreenshotCrop = {
    buildCropPlan,
    cropScreenshotDataUrl,
    dataUrlByteLength,
    isDataUrl
  };
})(globalThis);
