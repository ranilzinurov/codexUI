(function attachBrowserAnnotationSelectionContext(globalScope) {
  "use strict";

  const MAX_TEXT_LENGTH = 280;
  const MAX_SELECTOR_PARTS = 7;
  const MAX_CONTEXT_ITEMS = 5;

  function createElementContext(element, options = {}) {
    if (!element || element.nodeType !== 1) {
      throw new Error("A selectable element is required.");
    }

    const doc = options.document || element.ownerDocument || globalScope.document;
    const win = options.window || doc.defaultView || globalScope.window || globalScope;
    const location = options.location || win.location || doc.location || {};
    const rect = readRect(element, win);
    const labels = collectLabels(element, doc);
    const headings = collectNearestHeadings(element, doc);

    return {
      schemaVersion: 1,
      selector: buildCssSelector(element, doc),
      xpath: buildXPath(element, doc),
      role: readRole(element),
      aria: readAria(element, doc),
      text: normalizeText(
        element.innerText || element.textContent || element.value || "",
        MAX_TEXT_LENGTH
      ),
      tagName: String(element.tagName || "").toLowerCase(),
      attributes: readStableAttributes(element),
      rect,
      viewport: {
        width: toFiniteNumber(win.innerWidth),
        height: toFiniteNumber(win.innerHeight),
        scrollX: toFiniteNumber(win.scrollX || win.pageXOffset),
        scrollY: toFiniteNumber(win.scrollY || win.pageYOffset),
        devicePixelRatio: toFiniteNumber(win.devicePixelRatio || 1)
      },
      page: {
        url: String(location.href || ""),
        title: String(doc.title || "")
      },
      nearby: {
        headings,
        labels
      },
      selectedAtIso: new Date().toISOString()
    };
  }

  function buildCssSelector(element, doc = element.ownerDocument) {
    if (element.id) {
      return `#${cssEscape(element.id)}`;
    }

    const parts = [];
    let current = element;
    while (
      current &&
      current.nodeType === 1 &&
      current !== doc.documentElement &&
      parts.length < MAX_SELECTOR_PARTS
    ) {
      const part = selectorPart(current);
      parts.unshift(part);
      if (part.includes("[data-testid=") || part.includes("[name=")) {
        break;
      }
      current = current.parentElement;
    }

    if (current === doc.documentElement) {
      parts.unshift(String(current.tagName || "html").toLowerCase());
    }

    return parts.join(" > ");
  }

  function buildXPath(element, doc = element.ownerDocument) {
    if (element.id) {
      return `//*[@id=${xpathLiteral(element.id)}]`;
    }

    const parts = [];
    let current = element;
    while (current && current.nodeType === 1 && current !== doc) {
      const name = String(current.tagName || "").toLowerCase();
      if (!name) {
        break;
      }
      parts.unshift(`${name}[${elementIndex(current)}]`);
      current = current.parentNode;
    }
    return `/${parts.join("/")}`;
  }

  function readRole(element) {
    const explicit = trimAttribute(element, "role");
    if (explicit) {
      return explicit;
    }

    const tagName = String(element.tagName || "").toLowerCase();
    const type = trimAttribute(element, "type").toLowerCase();
    const roleByTag = {
      a: trimAttribute(element, "href") ? "link" : "",
      button: "button",
      form: "form",
      h1: "heading",
      h2: "heading",
      h3: "heading",
      h4: "heading",
      h5: "heading",
      h6: "heading",
      img: "img",
      nav: "navigation",
      main: "main",
      textarea: "textbox",
      select: "combobox"
    };

    if (tagName === "input") {
      if (type === "checkbox") {
        return "checkbox";
      }
      if (type === "radio") {
        return "radio";
      }
      if (type === "range") {
        return "slider";
      }
      if (["button", "submit", "reset"].includes(type)) {
        return "button";
      }
      return "textbox";
    }

    return roleByTag[tagName] || "";
  }

  function readAria(element, doc) {
    const labelledBy = trimAttribute(element, "aria-labelledby");
    return {
      label: trimAttribute(element, "aria-label"),
      labelledBy,
      labelledByText: labelledBy
        ? labelledBy
            .split(/\s+/)
            .map((id) => doc.getElementById(id))
            .filter(Boolean)
            .map((node) => normalizeText(node.textContent || "", 120))
            .filter(Boolean)
            .join(" ")
        : "",
      describedBy: trimAttribute(element, "aria-describedby")
    };
  }

  function collectLabels(element, doc) {
    const labels = [];
    const id = trimAttribute(element, "id");
    const parentLabel = element.closest ? element.closest("label") : null;
    if (parentLabel) {
      labels.push({
        source: "ancestor-label",
        text: normalizeText(parentLabel.textContent || "", 160)
      });
    }

    if (id && doc.querySelectorAll) {
      const escapedId = cssEscape(id);
      const labelNodes = doc.querySelectorAll(`label[for="${escapedId}"]`);
      for (const label of Array.from(labelNodes).slice(0, MAX_CONTEXT_ITEMS)) {
        labels.push({
          source: "for-label",
          text: normalizeText(label.textContent || "", 160)
        });
      }
    }

    const aria = readAria(element, doc);
    if (aria.label) {
      labels.push({ source: "aria-label", text: aria.label });
    }
    if (aria.labelledByText) {
      labels.push({ source: "aria-labelledby", text: aria.labelledByText });
    }

    return dedupeContextItems(labels).slice(0, MAX_CONTEXT_ITEMS);
  }

  function collectNearestHeadings(element, doc) {
    const headings = [];
    if (element.querySelector) {
      const ownHeading = element.querySelector("h1,h2,h3,h4,h5,h6,[role='heading']");
      if (ownHeading) {
        headings.push({
          source: "selected-heading",
          level: headingLevel(ownHeading),
          text: normalizeText(ownHeading.textContent || "", 160)
        });
      }
    }

    let ancestor = element.parentElement;
    while (ancestor && headings.length < MAX_CONTEXT_ITEMS) {
      if (isHeading(ancestor)) {
        headings.push({
          source: "ancestor-heading",
          level: headingLevel(ancestor),
          text: normalizeText(ancestor.textContent || "", 160)
        });
      }

      if (ancestor.querySelector) {
        const heading = ancestor.querySelector("h1,h2,h3,h4,h5,h6,[role='heading']");
        if (heading && heading !== element && !element.contains(heading)) {
          headings.push({
            source: "section-heading",
            level: headingLevel(heading),
            text: normalizeText(heading.textContent || "", 160)
          });
        }
      }
      ancestor = ancestor.parentElement;
    }

    const previous = findPreviousHeading(element, doc);
    if (previous) {
      headings.push({
        source: "previous-heading",
        level: headingLevel(previous),
        text: normalizeText(previous.textContent || "", 160)
      });
    }

    return dedupeContextItems(headings).slice(0, MAX_CONTEXT_ITEMS);
  }

  function findPreviousHeading(element, doc) {
    let current = element;
    while (current && current !== doc.body && current !== doc.documentElement) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (isHeading(sibling)) {
          return sibling;
        }
        const nested = lastHeadingIn(sibling);
        if (nested) {
          return nested;
        }
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
    }
    return null;
  }

  function lastHeadingIn(element) {
    if (!element.querySelectorAll) {
      return null;
    }
    const headings = element.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']");
    return headings.length > 0 ? headings[headings.length - 1] : null;
  }

  function readStableAttributes(element) {
    const names = [
      "id",
      "class",
      "name",
      "type",
      "href",
      "placeholder",
      "title",
      "data-testid",
      "data-test",
      "data-cy"
    ];
    const attributes = {};
    for (const name of names) {
      const value = trimAttribute(element, name);
      if (value) {
        attributes[name] = normalizeText(value, 160);
      }
    }
    return attributes;
  }

  function selectorPart(element) {
    const tagName = String(element.tagName || "").toLowerCase() || "*";
    for (const name of ["data-testid", "data-test", "data-cy", "name"]) {
      const value = trimAttribute(element, name);
      if (value) {
        return `${tagName}[${name}="${cssEscape(value)}"]`;
      }
    }

    const className = String(element.className || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((name) => `.${cssEscape(name)}`)
      .join("");

    const index = elementIndex(element);
    return `${tagName}${className}:nth-of-type(${index})`;
  }

  function elementIndex(element) {
    let index = 1;
    let sibling = element.previousElementSibling;
    const tagName = element.tagName;
    while (sibling) {
      if (sibling.tagName === tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    return index;
  }

  function readRect(element, win) {
    const rect = element.getBoundingClientRect();
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
      top: round(rect.top),
      right: round(rect.right),
      bottom: round(rect.bottom),
      left: round(rect.left),
      pageX: round(rect.left + toFiniteNumber(win.scrollX || win.pageXOffset)),
      pageY: round(rect.top + toFiniteNumber(win.scrollY || win.pageYOffset))
    };
  }

  function isHeading(element) {
    const tagName = String(element.tagName || "").toLowerCase();
    return /^h[1-6]$/.test(tagName) || trimAttribute(element, "role") === "heading";
  }

  function headingLevel(element) {
    const tagName = String(element.tagName || "").toLowerCase();
    if (/^h[1-6]$/.test(tagName)) {
      return Number(tagName.slice(1));
    }
    const level = Number(trimAttribute(element, "aria-level"));
    return Number.isFinite(level) ? level : null;
  }

  function trimAttribute(element, name) {
    if (!element || !element.getAttribute) {
      return "";
    }
    return String(element.getAttribute(name) || "").trim();
  }

  function normalizeText(value, maxLength = MAX_TEXT_LENGTH) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
  }

  function dedupeContextItems(items) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
      if (!item.text) {
        continue;
      }
      const key = `${item.source}:${item.text}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push(item);
      }
    }
    return result;
  }

  function xpathLiteral(value) {
    const text = String(value);
    if (!text.includes("'")) {
      return `'${text}'`;
    }
    if (!text.includes('"')) {
      return `"${text}"`;
    }
    return `concat('${text.replace(/'/g, "',\"'\",'")}')`;
  }

  function cssEscape(value) {
    const text = String(value);
    const css = globalScope.CSS;
    if (css && typeof css.escape === "function") {
      return css.escape(text);
    }
    return text.replace(/[^a-zA-Z0-9_-]/g, (character) =>
      `\\${character.charCodeAt(0).toString(16)} `
    );
  }

  function round(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return 0;
    }
    return Math.round(number * 100) / 100;
  }

  function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  globalScope.BrowserAnnotationSelectionContext = {
    buildCssSelector,
    buildXPath,
    createElementContext,
    normalizeText,
    readRole
  };
})(globalThis);
