(function attachBrowserAnnotationDevtoolsCapture(globalScope) {
  "use strict";

  const constants = globalScope.BrowserAnnotationConstants;
  const SENSITIVE_QUERY_NAMES = new Set([
    "access_token",
    "api_key",
    "auth",
    "client_secret",
    "code",
    "key",
    "password",
    "refresh_token",
    "secret",
    "session",
    "token"
  ]);

  function createDevtoolsCaptureState(tab, options = {}) {
    const nowMs = Number(options.nowMs) || Date.now();
    const timeoutMs = positiveInteger(
      options.timeoutMs,
      constants.DEVTOOLS_CAPTURE_TIMEOUT_MS
    );
    return trimDevtoolsCaptureState({
      active: true,
      tabId: tab && typeof tab.id === "number" ? tab.id : null,
      tabTitle: sanitizeText(tab && tab.title, 300),
      tabUrl: sanitizeUrl(tab && tab.url),
      startedAtIso: new Date(nowMs).toISOString(),
      expiresAtIso: new Date(nowMs + timeoutMs).toISOString(),
      stoppedAtIso: null,
      detachReason: "",
      error: "",
      consoleRows: [],
      networkRows: []
    });
  }

  function normalizeDevtoolsCaptureState(value) {
    if (!isRecord(value)) {
      return emptyDevtoolsCaptureState();
    }
    return trimDevtoolsCaptureState({
      active: value.active === true,
      tabId: typeof value.tabId === "number" ? value.tabId : null,
      tabTitle: sanitizeText(value.tabTitle, 300),
      tabUrl: sanitizeUrl(value.tabUrl),
      startedAtIso: sanitizeText(value.startedAtIso, 80),
      expiresAtIso: sanitizeText(value.expiresAtIso, 80),
      stoppedAtIso: sanitizeText(value.stoppedAtIso, 80) || null,
      detachReason: sanitizeText(value.detachReason, 300),
      error: sanitizeText(value.error, 500),
      consoleRows: Array.isArray(value.consoleRows)
        ? value.consoleRows.map(normalizeConsoleRow).filter(Boolean)
        : [],
      networkRows: Array.isArray(value.networkRows)
        ? value.networkRows.map(normalizeNetworkRow).filter(Boolean)
        : []
    });
  }

  function emptyDevtoolsCaptureState() {
    return {
      active: false,
      tabId: null,
      tabTitle: "",
      tabUrl: "",
      startedAtIso: "",
      expiresAtIso: "",
      stoppedAtIso: null,
      detachReason: "",
      error: "",
      consoleRows: [],
      networkRows: []
    };
  }

  function stopDevtoolsCaptureState(state, reason, options = {}) {
    const normalized = normalizeDevtoolsCaptureState(state);
    normalized.active = false;
    normalized.stoppedAtIso = options.stoppedAtIso || new Date().toISOString();
    normalized.detachReason = sanitizeText(reason, 300);
    if (options.error) {
      normalized.error = sanitizeText(options.error, 500);
    }
    return trimDevtoolsCaptureState(normalized);
  }

  function appendConsoleEvent(state, method, params, options = {}) {
    const row = buildConsoleRow(method, params, options);
    if (!row || isNoisyConsoleRow(row)) {
      return normalizeDevtoolsCaptureState(state);
    }
    const normalized = normalizeDevtoolsCaptureState(state);
    normalized.consoleRows.push(row);
    return trimDevtoolsCaptureState(normalized);
  }

  function upsertNetworkEvent(state, method, params, options = {}) {
    const normalized = normalizeDevtoolsCaptureState(state);
    const requestId = sanitizeText(params && params.requestId, 180);
    if (!requestId) {
      return normalized;
    }

    const index = normalized.networkRows.findIndex((row) => row.requestId === requestId);
    const existing = index >= 0 ? normalized.networkRows[index] : null;
    const next = buildNetworkRow(existing, method, params, options);
    if (!next) {
      return normalized;
    }
    if (index >= 0) {
      normalized.networkRows[index] = next;
    } else {
      normalized.networkRows.push(next);
    }
    return trimDevtoolsCaptureState(normalized);
  }

  function buildDevtoolsCaptureStatus(state) {
    const normalized = normalizeDevtoolsCaptureState(state);
    const status = normalized.active ? "active" : normalized.error ? "error" : "inactive";
    return {
      status,
      active: normalized.active,
      tabId: normalized.tabId,
      tabTitle: normalized.tabTitle,
      tabUrl: normalized.tabUrl,
      startedAtIso: normalized.startedAtIso,
      expiresAtIso: normalized.expiresAtIso,
      stoppedAtIso: normalized.stoppedAtIso,
      detachReason: normalized.detachReason,
      error: normalized.error,
      consoleCount: normalized.consoleRows.length,
      networkCount: normalized.networkRows.length,
      lastConsoleRow: normalized.consoleRows[normalized.consoleRows.length - 1] || null,
      lastNetworkRow: normalized.networkRows[normalized.networkRows.length - 1] || null,
      detail: buildDevtoolsCaptureDetail(normalized, status)
    };
  }

  function buildDevtoolsCaptureDetail(state, status) {
    if (status === "active") {
      const title = state.tabTitle || state.tabUrl || "current tab";
      return `Capturing ${state.consoleRows.length} console event(s) and ${state.networkRows.length} network request(s) for ${title}.`;
    }
    if (status === "error") {
      return state.error || "DevTools capture is unavailable.";
    }
    if (state.detachReason) {
      return `DevTools capture stopped: ${state.detachReason}.`;
    }
    return "DevTools capture is off.";
  }

  function buildConsoleRow(method, params, options) {
    if (method === "Runtime.consoleAPICalled") {
      const firstFrame = readFirstCallFrame(params && params.stackTrace);
      return normalizeConsoleRow({
        id: createId("console", options.nowMs),
        source: "Runtime.consoleAPICalled",
        level: normalizeConsoleLevel(params && params.type),
        text: summarizeRemoteObjects(params && params.args),
        url: sanitizeUrl(firstFrame.url),
        lineNumber: finiteNumber(firstFrame.lineNumber),
        columnNumber: finiteNumber(firstFrame.columnNumber),
        stackTrace: summarizeStackTrace(params && params.stackTrace),
        timestampIso: timestampToIso(params && params.timestamp, options.nowMs)
      });
    }

    if (method === "Runtime.exceptionThrown") {
      const exceptionDetails = params && params.exceptionDetails;
      const firstFrame = readFirstCallFrame(exceptionDetails && exceptionDetails.stackTrace);
      return normalizeConsoleRow({
        id: createId("console", options.nowMs),
        source: "Runtime.exceptionThrown",
        level: "error",
        text: sanitizeText(
          exceptionDetails && (exceptionDetails.text || exceptionDetails.exception && exceptionDetails.exception.description),
          2000
        ),
        url: sanitizeUrl((exceptionDetails && exceptionDetails.url) || firstFrame.url),
        lineNumber: finiteNumber((exceptionDetails && exceptionDetails.lineNumber) || firstFrame.lineNumber),
        columnNumber: finiteNumber((exceptionDetails && exceptionDetails.columnNumber) || firstFrame.columnNumber),
        stackTrace: summarizeStackTrace(exceptionDetails && exceptionDetails.stackTrace),
        timestampIso: new Date(Number(options.nowMs) || Date.now()).toISOString()
      });
    }

    if (method === "Log.entryAdded") {
      const entry = params && params.entry ? params.entry : {};
      return normalizeConsoleRow({
        id: createId("console", options.nowMs),
        source: "Log.entryAdded",
        level: normalizeConsoleLevel(entry.level),
        text: sanitizeText(entry.text, 2000),
        url: sanitizeUrl(entry.url),
        lineNumber: finiteNumber(entry.lineNumber),
        columnNumber: 0,
        stackTrace: summarizeStackTrace(entry.stackTrace),
        timestampIso: timestampToIso(entry.timestamp, options.nowMs)
      });
    }

    return null;
  }

  function buildNetworkRow(existing, method, params, options) {
    const nowMs = Number(options.nowMs) || Date.now();
    const row = existing ? { ...existing } : {
      id: createId("network", nowMs),
      requestId: sanitizeText(params.requestId, 180),
      url: "",
      method: "",
      status: null,
      statusText: "",
      resourceType: "",
      startedAtIso: "",
      finishedAtIso: "",
      durationMs: null,
      encodedDataLength: null,
      initiator: null,
      failed: false,
      failureReason: "",
      slow: false,
      fromDiskCache: false,
      mimeType: "",
      bodyCapture: {
        state: "metadata-only",
        reason: "Stage 3.1-3.3 captures metadata only."
      }
    };

    if (method === "Network.requestWillBeSent") {
      const request = params.request || {};
      row.url = sanitizeUrl(request.url || params.documentURL);
      row.method = sanitizeText(request.method, 20);
      row.resourceType = sanitizeText(params.type, 80);
      row.startedAtIso = timestampToIso(params.wallTime ? params.wallTime * 1000 : null, nowMs);
      row.initiator = summarizeInitiator(params.initiator);
      row.failed = false;
      row.failureReason = "";
      return normalizeNetworkRow(row);
    }

    if (method === "Network.responseReceived") {
      const response = params.response || {};
      row.url = row.url || sanitizeUrl(response.url);
      row.status = finiteNumber(response.status);
      row.statusText = sanitizeText(response.statusText, 120);
      row.resourceType = row.resourceType || sanitizeText(params.type, 80);
      row.fromDiskCache = response.fromDiskCache === true;
      row.mimeType = sanitizeText(response.mimeType, 160);
      return normalizeNetworkRow(row);
    }

    if (method === "Network.loadingFinished") {
      row.finishedAtIso = new Date(nowMs).toISOString();
      row.durationMs = estimateDurationMs(row.startedAtIso, row.finishedAtIso);
      row.encodedDataLength = finiteNumber(params.encodedDataLength);
      row.slow = Boolean(row.durationMs && row.durationMs >= constants.DEVTOOLS_SLOW_REQUEST_MS);
      return normalizeNetworkRow(row);
    }

    if (method === "Network.loadingFailed") {
      row.finishedAtIso = new Date(nowMs).toISOString();
      row.durationMs = estimateDurationMs(row.startedAtIso, row.finishedAtIso);
      row.resourceType = row.resourceType || sanitizeText(params.type, 80);
      row.failed = true;
      row.failureReason = sanitizeText(params.errorText, 300);
      row.slow = Boolean(row.durationMs && row.durationMs >= constants.DEVTOOLS_SLOW_REQUEST_MS);
      return normalizeNetworkRow(row);
    }

    return null;
  }

  function trimDevtoolsCaptureState(state) {
    const normalized = { ...state };
    normalized.consoleRows = (normalized.consoleRows || [])
      .map(normalizeConsoleRow)
      .filter(Boolean)
      .slice(-positiveInteger(constants.MAX_DEVTOOLS_CONSOLE_ROWS, 200));
    normalized.networkRows = (normalized.networkRows || [])
      .map(normalizeNetworkRow)
      .filter(Boolean)
      .slice(-positiveInteger(constants.MAX_DEVTOOLS_NETWORK_ROWS, 250));

    while (
      estimateJsonBytes(normalized) > constants.MAX_DEVTOOLS_CAPTURE_STORAGE_BYTES &&
      (normalized.consoleRows.length > 0 || normalized.networkRows.length > 0)
    ) {
      if (normalized.networkRows.length >= normalized.consoleRows.length) {
        normalized.networkRows.shift();
      } else {
        normalized.consoleRows.shift();
      }
    }
    return normalized;
  }

  function normalizeConsoleRow(row) {
    if (!isRecord(row)) {
      return null;
    }
    const text = sanitizeText(row.text, 2000);
    if (!text) {
      return null;
    }
    return {
      id: sanitizeText(row.id, 120) || createId("console"),
      source: sanitizeText(row.source, 80),
      level: normalizeConsoleLevel(row.level),
      text,
      url: sanitizeUrl(row.url),
      lineNumber: finiteNumber(row.lineNumber),
      columnNumber: finiteNumber(row.columnNumber),
      stackTrace: sanitizeText(row.stackTrace, 2000),
      timestampIso: sanitizeText(row.timestampIso, 80) || new Date().toISOString()
    };
  }

  function normalizeNetworkRow(row) {
    if (!isRecord(row)) {
      return null;
    }
    const requestId = sanitizeText(row.requestId, 180);
    if (!requestId) {
      return null;
    }
    return {
      id: sanitizeText(row.id, 120) || createId("network"),
      requestId,
      url: sanitizeUrl(row.url),
      method: sanitizeText(row.method, 20),
      status: typeof row.status === "number" ? row.status : null,
      statusText: sanitizeText(row.statusText, 120),
      resourceType: sanitizeText(row.resourceType, 80),
      startedAtIso: sanitizeText(row.startedAtIso, 80),
      finishedAtIso: sanitizeText(row.finishedAtIso, 80),
      durationMs: typeof row.durationMs === "number" ? row.durationMs : null,
      encodedDataLength: typeof row.encodedDataLength === "number" ? row.encodedDataLength : null,
      initiator: isRecord(row.initiator) ? row.initiator : null,
      failed: row.failed === true,
      failureReason: sanitizeText(row.failureReason, 300),
      slow: row.slow === true,
      fromDiskCache: row.fromDiskCache === true,
      mimeType: sanitizeText(row.mimeType, 160),
      bodyCapture: {
        state: "metadata-only",
        reason: "Stage 3.1-3.3 captures metadata only."
      }
    };
  }

  function summarizeRemoteObjects(args) {
    if (!Array.isArray(args)) {
      return "";
    }
    return sanitizeText(args.map(summarizeRemoteObject).filter(Boolean).join(" "), 2000);
  }

  function summarizeRemoteObject(value) {
    if (!isRecord(value)) {
      return "";
    }
    if (typeof value.value === "string") {
      return value.value;
    }
    if (value.value !== undefined && value.value !== null) {
      return String(value.value);
    }
    return value.description || value.className || value.type || "";
  }

  function summarizeStackTrace(stackTrace) {
    if (!isRecord(stackTrace) || !Array.isArray(stackTrace.callFrames)) {
      return "";
    }
    return sanitizeText(
      stackTrace.callFrames
        .slice(0, 5)
        .map((frame) => {
          const functionName = sanitizeText(frame.functionName || "(anonymous)", 120);
          const url = sanitizeUrl(frame.url);
          return `${functionName} ${url}:${finiteNumber(frame.lineNumber)}:${finiteNumber(frame.columnNumber)}`;
        })
        .join("\n"),
      2000
    );
  }

  function readFirstCallFrame(stackTrace) {
    if (!isRecord(stackTrace) || !Array.isArray(stackTrace.callFrames)) {
      return {};
    }
    return stackTrace.callFrames[0] || {};
  }

  function summarizeInitiator(initiator) {
    if (!isRecord(initiator)) {
      return null;
    }
    const summary = {
      type: sanitizeText(initiator.type, 80),
      url: sanitizeUrl(initiator.url),
      lineNumber: finiteNumber(initiator.lineNumber)
    };
    const stackFrame = readFirstCallFrame(initiator.stack);
    if (stackFrame.url) {
      summary.stackTop = {
        functionName: sanitizeText(stackFrame.functionName || "(anonymous)", 120),
        url: sanitizeUrl(stackFrame.url),
        lineNumber: finiteNumber(stackFrame.lineNumber),
        columnNumber: finiteNumber(stackFrame.columnNumber)
      };
    }
    return summary;
  }

  function isNoisyConsoleRow(row) {
    if (!row.text) {
      return true;
    }
    return row.url.startsWith("chrome-extension://");
  }

  function normalizeConsoleLevel(level) {
    const value = sanitizeText(level, 40).toLowerCase();
    if (value === "warning") {
      return "warn";
    }
    if (value === "debug" || value === "info" || value === "warn" || value === "error") {
      return value;
    }
    if (value === "assert" || value === "trace") {
      return "error";
    }
    return "log";
  }

  function sanitizeUrl(value) {
    const raw = sanitizeText(value, 2048);
    if (!raw) {
      return "";
    }
    try {
      const url = new URL(raw);
      for (const key of Array.from(url.searchParams.keys())) {
        if (SENSITIVE_QUERY_NAMES.has(key.toLowerCase())) {
          url.searchParams.set(key, "[redacted]");
        }
      }
      url.hash = "";
      return url.toString();
    } catch (_error) {
      return raw;
    }
  }

  function timestampToIso(timestamp, fallbackMs) {
    const number = Number(timestamp);
    if (Number.isFinite(number) && number > 0) {
      return new Date(number).toISOString();
    }
    return new Date(Number(fallbackMs) || Date.now()).toISOString();
  }

  function estimateDurationMs(startedAtIso, finishedAtIso) {
    const started = Date.parse(startedAtIso);
    const finished = Date.parse(finishedAtIso);
    if (!Number.isFinite(started) || !Number.isFinite(finished)) {
      return null;
    }
    return Math.max(0, finished - started);
  }

  function estimateJsonBytes(value) {
    const json = JSON.stringify(value);
    if (typeof globalScope.TextEncoder === "function") {
      return new globalScope.TextEncoder().encode(json).byteLength;
    }
    return json.length;
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

  function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function createId(prefix, nowMs) {
    return `${prefix}-${Number(nowMs) || Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  globalScope.BrowserAnnotationDevtoolsCapture = {
    appendConsoleEvent,
    buildDevtoolsCaptureStatus,
    createDevtoolsCaptureState,
    emptyDevtoolsCaptureState,
    normalizeDevtoolsCaptureState,
    stopDevtoolsCaptureState,
    upsertNetworkEvent
  };
})(globalThis);
