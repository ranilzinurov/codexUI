(function attachBrowserAnnotationConstants(globalScope) {
  "use strict";

  /**
   * Shared extension contract for load-unpacked MV3 scripts.
   *
   * @typedef {Object} BrowserAnnotationSettings
   * @property {string} serverUrl Pairing server base URL.
   * @property {string} pairingToken Thread listener token pasted from Codex UI.
   *
   * @typedef {Object} BrowserAnnotationRuntimeMessage
   * @property {string} type One of MESSAGE_TYPES.
   * @property {BrowserAnnotationSettings=} settings Optional settings payload.
   */
  const constants = {
    CONTRACT_VERSION: 1,
    MESSAGE_TYPES: Object.freeze({
      GET_STATE: "browserAnnotation.getState",
      SAVE_SETTINGS: "browserAnnotation.saveSettings",
      INJECT_OVERLAY: "browserAnnotation.injectOverlay",
      CONTENT_PING: "browserAnnotation.contentPing",
      CONTENT_START_OVERLAY: "browserAnnotation.contentStartOverlay"
    }),
    DEFAULT_SETTINGS: Object.freeze({
      serverUrl: "https://annotate.todo-tg-app.ru",
      pairingToken: ""
    }),
    LISTEN_STATUS_PATH: "/codex-api/extension/listen/status",
    TARGET_HOST_PATTERN: "https://annotate.todo-tg-app.ru/*",
    ALLOWED_TAB_PROTOCOLS: Object.freeze([
      "http:",
      "https:"
    ]),
    STORAGE_KEYS: Object.freeze({
      settings: "browserAnnotation.settings"
    }),
    RESTRICTED_URL_PREFIXES: Object.freeze([
      "chrome://",
      "chrome-extension://",
      "edge://",
      "about:",
      "view-source:",
      "devtools://"
    ]),
    RESTRICTED_URL_ORIGINS: Object.freeze([
      "https://chrome.google.com",
      "https://chromewebstore.google.com"
    ])
  };

  globalScope.BrowserAnnotationConstants = constants;
})(globalThis);
