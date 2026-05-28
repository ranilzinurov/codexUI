import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({
  console,
  Date,
  URL,
  globalThis: {}
});
context.globalThis = context;

const source = await readFile(
  resolve(extensionRoot, "shared/selection-context.js"),
  "utf8"
);
vm.runInContext(source, context, { filename: "shared/selection-context.js" });

const { BrowserAnnotationSelectionContext } = context;

function createFixturePage() {
  const doc = {
    title: "Codex Annotation Extension Test Page",
    location: { href: "http://127.0.0.1:8899/test-page.html" },
    getElementById(id) {
      return nodes.find((node) => node.getAttribute("id") === id) || null;
    },
    querySelectorAll(selector) {
      const match = selector.match(/^label\[for="(.+)"\]$/);
      if (!match) {
        return [];
      }
      const expected = match[1].replace(/\\([0-9a-f]+) /gi, (_all, hex) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      );
      return nodes.filter(
        (node) =>
          node.tagName === "LABEL" && String(node.getAttribute("for") || "") === expected
      );
    }
  };

  const html = new TestElement("html", {}, "");
  const body = new TestElement("body", {}, "");
  const h1 = new TestElement("h1", {}, "Codex annotation extension test page");
  const label = new TestElement("label", {}, "Sample input");
  const input = new TestElement("input", {
    id: "sample-input",
    value: "Annotate me"
  });
  const card = new TestElement("div", { class: "sample-card" }, "");
  const h2 = new TestElement("h2", {}, "Sample card");
  const paragraph = new TestElement("p", {}, "Card body");
  const button = new TestElement("button", { type: "button" }, "Sample action");
  const nodes = [html, body, h1, label, input, card, h2, paragraph, button];

  doc.documentElement = html;
  doc.body = body;
  for (const node of nodes) {
    node.ownerDocument = doc;
  }

  html.append(body);
  body.append(h1, label, card);
  label.append(input);
  card.append(h2, paragraph, button);

  input.setRect({ x: 20, y: 90, width: 220, height: 36 });
  card.setRect({ x: 20, y: 150, width: 360, height: 180 });
  button.setRect({ x: 38, y: 250, width: 128, height: 36 });

  return {
    button,
    input,
    card,
    options: {
      document: doc,
      window: {
        innerWidth: 1024,
        innerHeight: 768,
        scrollX: 0,
        scrollY: 10,
        devicePixelRatio: 2,
        location: doc.location
      },
      location: doc.location
    }
  };
}

class TestElement {
  constructor(tagName, attributes = {}, textContent = "") {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.children = [];
    this.parentElement = null;
    this.parentNode = null;
    this.textContent = textContent;
    this.innerText = textContent;
    this.value = attributes.value || "";
    this.className = attributes.class || "";
    this.rect = { x: 0, y: 0, width: 0, height: 0 };
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  getAttribute(name) {
    return this.attributes[name] || "";
  }

  setRect(rect) {
    this.rect = rect;
  }

  getBoundingClientRect() {
    return {
      ...this.rect,
      top: this.rect.y,
      left: this.rect.x,
      right: this.rect.x + this.rect.width,
      bottom: this.rect.y + this.rect.height
    };
  }

  get previousElementSibling() {
    if (!this.parentElement) {
      return null;
    }
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (selector === "label" && current.tagName === "LABEL") {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  contains(node) {
    if (node === this) {
      return true;
    }
    return this.children.some((child) => child.contains(node));
  }

  querySelector(selector) {
    const tags = selector
      .split(",")
      .map((part) => part.trim().toUpperCase())
      .filter((part) => /^H[1-6]$/.test(part));
    return findFirst(this, (node) => tags.includes(node.tagName));
  }
}

function findFirst(node, predicate) {
  for (const child of node.children) {
    if (predicate(child)) {
      return child;
    }
    const nested = findFirst(child, predicate);
    if (nested) {
      return nested;
    }
  }
  return null;
}

const page = createFixturePage();

const buttonContext = BrowserAnnotationSelectionContext.createElementContext(
  page.button,
  page.options
);
assert.equal(buttonContext.tagName, "button");
assert.equal(buttonContext.role, "button");
assert.match(buttonContext.selector, /button/);
assert.match(buttonContext.xpath, /button\[1\]$/);
assert.equal(buttonContext.text, "Sample action");
assert.equal(buttonContext.rect.width, 128);
assert.equal(buttonContext.viewport.width, 1024);
assert.equal(buttonContext.nearby.headings[0].text, "Sample card");

const inputContext = BrowserAnnotationSelectionContext.createElementContext(
  page.input,
  page.options
);
assert.equal(inputContext.tagName, "input");
assert.equal(inputContext.role, "textbox");
assert.equal(inputContext.attributes.id, "sample-input");
assert.equal(inputContext.nearby.labels[0].source, "ancestor-label");
assert.equal(inputContext.nearby.labels[0].text, "Sample input");

const cardContext = BrowserAnnotationSelectionContext.createElementContext(
  page.card,
  page.options
);
assert.equal(cardContext.tagName, "div");
assert.match(cardContext.selector, /sample-card/);
assert.equal(cardContext.nearby.headings[0].text, "Sample card");

console.log("Extension selection-context smoke passed.");
