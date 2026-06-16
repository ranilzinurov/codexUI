(function attachBrowserAnnotationConstants(globalScope) {
  "use strict";

  /**
   * Shared extension contract for load-unpacked MV3 scripts.
   *
   * @typedef {Object} BrowserAnnotationSettings
   * @property {string} serverUrl Pairing server base URL.
   * @property {string} pairingToken Ephemeral browser binding pairing code pasted from Codex UI.
   * @property {string=} extensionToken Legacy long-lived scoped token issued after thread-level pairing.
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
      DISCONNECT_BINDING: "browserAnnotation.disconnectBinding",
      SELECT_THREAD_TARGET: "browserAnnotation.selectThreadTarget",
      INJECT_OVERLAY: "browserAnnotation.injectOverlay",
      ADD_PAGE_STATE_ANNOTATION: "browserAnnotation.addPageStateAnnotation",
      UPDATE_ANNOTATION_QUEUE_ITEM: "browserAnnotation.updateAnnotationQueueItem",
      DELETE_ANNOTATION_QUEUE_ITEM: "browserAnnotation.deleteAnnotationQueueItem",
      MOVE_ANNOTATION_QUEUE_ITEM: "browserAnnotation.moveAnnotationQueueItem",
      SEND_ANNOTATION_BATCH: "browserAnnotation.sendAnnotationBatch",
      TRANSCRIBE_INLINE_AUDIO: "browserAnnotation.transcribeInlineAudio",
      START_DEVTOOLS_CAPTURE: "browserAnnotation.devtools.enable",
      STOP_DEVTOOLS_CAPTURE: "browserAnnotation.devtools.disable",
      GET_DEVTOOLS_CAPTURE_STATUS: "browserAnnotation.devtools.getStatus",
      CONTENT_PING: "browserAnnotation.contentPing",
      CONTENT_START_OVERLAY: "browserAnnotation.contentStartOverlay",
      CONTENT_ELEMENT_SELECTED: "browserAnnotation.contentElementSelected",
      CONTENT_TRANSCRIBE_AUDIO: "browserAnnotation.contentTranscribeAudio",
      CONTENT_TRANSCRIPTION_RESULT: "browserAnnotation.contentTranscriptionResult"
    }),
    DEFAULT_SETTINGS: Object.freeze({
      serverUrl: "https://codex-ui.todo-tg-app.ru",
      pairingToken: ""
    }),
    BINDING_START_PATH: "/codex-api/extension/binding/start",
    BINDING_COMPLETE_PATH: "/codex-api/extension/binding/complete",
    BINDING_STATUS_PATH: "/codex-api/extension/binding/status",
    BINDING_REVOKE_PATH: "/codex-api/extension/binding/revoke",
    THREAD_TARGETS_PATH: "/codex-api/extension/threads",
    LISTEN_BIND_THREAD_PATH: "/codex-api/extension/listen/bind-thread",
    LISTEN_BIND_PATH: "/codex-api/extension/listen/bind",
    LISTEN_STATUS_PATH: "/codex-api/extension/listen/status",
    LISTEN_STOP_PATH: "/codex-api/extension/listen/stop",
    LISTEN_BINDING_REVOKE_PATH: "/codex-api/extension/listen/binding/revoke",
    ANNOTATION_BATCH_PATH: "/codex-api/extension/annotation-batch",
    ASSET_UPLOAD_PATH: "/codex-api/extension/assets/upload",
    TRANSCRIBE_PATH: "/codex-api/extension/transcribe",
    TARGET_HOST_PATTERN: "https://codex-ui.todo-tg-app.ru/*",
    OPTIONAL_HOST_PERMISSION_PATTERNS: Object.freeze([
      "http://*/*",
      "https://*/*"
    ]),
    ALLOWED_TAB_PROTOCOLS: Object.freeze([
      "http:",
      "https:"
    ]),
    STORAGE_KEYS: Object.freeze({
      settings: "browserAnnotation.settings",
      pairingToken: "browserAnnotation.pairingToken",
      binding: "browserAnnotation.binding",
      threadTarget: "browserAnnotation.threadTarget",
      annotationQueue: "browserAnnotation.annotationQueue",
      devtoolsCapture: "browserAnnotation.devtoolsCapture"
    }),
    MAX_ANNOTATION_QUEUE_ITEMS: 25,
    MAX_SCREENSHOT_PREVIEW_EDGE_PX: 640,
    MAX_SCREENSHOT_PREVIEW_DATA_URL_CHARS: 250000,
    MAX_ANNOTATION_QUEUE_STORAGE_BYTES: 5500000,
    MAX_ANNOTATION_NOTE_CHARS: 2000,
    MAX_ANNOTATION_BATCH_BYTES: 1024 * 1024,
    MAX_DEVTOOLS_CONSOLE_ROWS: 200,
    MAX_DEVTOOLS_NETWORK_ROWS: 250,
    MAX_DEVTOOLS_CAPTURE_STORAGE_BYTES: 1500000,
    DEVTOOLS_CAPTURE_TIMEOUT_MS: 15 * 60 * 1000,
    DEVTOOLS_SLOW_REQUEST_MS: 3000,
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
