(function attachBrowserAnnotationUrlUtils(globalScope) {
  "use strict";

  const constants = globalScope.BrowserAnnotationConstants;

  function normalizeServerUrl(value) {
    const rawValue = String(value || "").trim();
    if (!rawValue) {
      return constants.DEFAULT_SETTINGS.serverUrl;
    }

    let parsed;
    try {
      parsed = new URL(rawValue);
    } catch (_error) {
      throw new Error("Server URL must be a valid http(s) URL.");
    }

    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("Server URL must use http or https.");
    }

    if (parsed.protocol === "http:" && !isLocalDevelopmentHost(parsed.hostname)) {
      throw new Error("Server URL must use HTTPS unless it is localhost, 127.0.0.1, or ::1.");
    }

    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/$/, "");
  }

  function isRestrictedTabUrl(url) {
    const parsed = parseUrl(url);
    if (!parsed) {
      return true;
    }

    const normalized = parsed.href.toLowerCase();
    return (
      !constants.ALLOWED_TAB_PROTOCOLS.includes(parsed.protocol) ||
      constants.RESTRICTED_URL_ORIGINS.includes(parsed.origin.toLowerCase()) ||
      constants.RESTRICTED_URL_PREFIXES.some((prefix) =>
        normalized.startsWith(prefix)
      )
    );
  }

  function describeRestrictedUrl(url) {
    const parsed = parseUrl(url);
    if (!parsed) {
      return "The active tab has no accessible URL yet.";
    }

    if (!constants.ALLOWED_TAB_PROTOCOLS.includes(parsed.protocol)) {
      return `Annotation overlay injection is limited to http(s) pages. The active page uses ${parsed.protocol || "an unsupported protocol"}.`;
    }

    if (constants.RESTRICTED_URL_ORIGINS.includes(parsed.origin.toLowerCase())) {
      return "Chrome does not allow extension scripts on Chrome Web Store pages. Open a normal http(s) page and try again.";
    }

    return `Chrome does not allow annotation scripts on this page (${parsed.href}). Open a normal http(s) page and try again.`;
  }

  function getTabOriginPattern(url) {
    const parsed = parseUrl(url);
    if (!parsed || isRestrictedTabUrl(url)) {
      return "";
    }

    return `${parsed.protocol}//${parsed.hostname}/*`;
  }

  function parseUrl(url) {
    if (!url || typeof url !== "string") {
      return null;
    }

    try {
      return new URL(url);
    } catch (_error) {
      return null;
    }
  }

  function isLocalDevelopmentHost(hostname) {
    const normalized = String(hostname || "").toLowerCase();
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
  }

  globalScope.BrowserAnnotationUrlUtils = {
    normalizeServerUrl,
    isRestrictedTabUrl,
    describeRestrictedUrl,
    getTabOriginPattern
  };
})(globalThis);
