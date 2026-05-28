import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const drawCalls = [];

class FakeBlob {
  constructor(parts = [], options = {}) {
    this.parts = parts;
    this.type = options.type || "image/png";
  }

  async arrayBuffer() {
    return Buffer.from(this.parts.join(""));
  }
}

class FakeOffscreenCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  getContext(type) {
    assert.equal(type, "2d");
    return {
      drawImage: (...args) => {
        drawCalls.push({
          canvas: { width: this.width, height: this.height },
          args
        });
      }
    };
  }

  async convertToBlob(options = {}) {
    return new FakeBlob([`crop:${this.width}x${this.height}`], {
      type: options.type || "image/png"
    });
  }
}

const context = vm.createContext({
  Buffer,
  Date,
  TextEncoder,
  Uint8Array,
  console,
  OffscreenCanvas: FakeOffscreenCanvas,
  btoa(value) {
    return Buffer.from(value, "binary").toString("base64");
  },
  async fetch(value) {
    assert.match(value, /^data:image\/png;base64,/);
    return {
      async blob() {
        return new FakeBlob(["source"], { type: "image/png" });
      }
    };
  },
  async createImageBitmap() {
    return {
      width: 800,
      height: 600,
      close() {
        this.closed = true;
      }
    };
  },
  globalThis: {}
});
context.globalThis = context;

const source = await readFile(
  resolve(extensionRoot, "shared/screenshot-crop.js"),
  "utf8"
);
vm.runInContext(source, context, { filename: "shared/screenshot-crop.js" });

const { BrowserAnnotationScreenshotCrop } = context;
assert.equal(
  context.BrowserAnnotationScreenshotCrop.isDataUrl("data:image/png;base64,c291cmNl"),
  true
);
const rect = {
  left: 10.4,
  top: 20.2,
  width: 120,
  height: 45
};
const viewport = {
  width: 400,
  height: 300,
  devicePixelRatio: 2
};
const plan = BrowserAnnotationScreenshotCrop.buildCropPlan(rect, viewport, {
  width: 800,
  height: 600
});
assert.deepEqual(JSON.parse(JSON.stringify(plan.cropRect)), {
  x: 21,
  y: 40,
  width: 240,
  height: 90
});
assert.deepEqual(JSON.parse(JSON.stringify(plan.outputSize)), {
  width: 240,
  height: 90
});
assert.equal(plan.scaled, false);

const clipped = BrowserAnnotationScreenshotCrop.buildCropPlan(
  { left: 390, top: 290, width: 30, height: 30 },
  viewport,
  { width: 800, height: 600 }
);
assert.deepEqual(JSON.parse(JSON.stringify(clipped.cropRect)), {
  x: 780,
  y: 580,
  width: 20,
  height: 20
});

const preview = await BrowserAnnotationScreenshotCrop.cropScreenshotDataUrl(
  "data:image/png;base64,c291cmNl",
  rect,
  viewport,
  {
    maxPreviewEdgePx: 640,
    maxPreviewDataUrlChars: 250000
  }
);
assert.equal(preview.width, 240);
assert.equal(preview.height, 90);
assert.equal(preview.mimeType, "image/png");
assert.equal(preview.dataUrl, "data:image/png;base64,Y3JvcDoyNDB4OTA=");
assert.equal(preview.byteLength, Buffer.byteLength("crop:240x90"));
assert.equal(BrowserAnnotationScreenshotCrop.isDataUrl(preview.dataUrl), true);
assert.equal(
  BrowserAnnotationScreenshotCrop.dataUrlByteLength("data:image/png;base64,YQ=="),
  1
);
assert.equal(drawCalls.length, 1);
assert.deepEqual(drawCalls[0].args.slice(1), [21, 40, 240, 90, 0, 0, 240, 90]);

console.log("Extension screenshot crop smoke passed.");
