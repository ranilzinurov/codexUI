(function attachBrowserAnnotationPairingClient(globalScope) {
  "use strict";

  const constants = globalScope.BrowserAnnotationConstants;
  const urlUtils = globalScope.BrowserAnnotationUrlUtils;

  function buildListenStatusUrl(serverUrl) {
    const normalizedServerUrl = urlUtils.normalizeServerUrl(serverUrl);
    return new URL(constants.LISTEN_STATUS_PATH, `${normalizedServerUrl}/`).toString();
  }

  function buildAnnotationBatchUrl(serverUrl, session) {
    const normalizedServerUrl = urlUtils.normalizeServerUrl(serverUrl);
    const url = new URL(constants.ANNOTATION_BATCH_PATH, `${normalizedServerUrl}/`);
    if (session && session.sessionId) {
      url.searchParams.set("sessionId", session.sessionId);
    }
    if (session && session.threadId) {
      url.searchParams.set("threadId", session.threadId);
    }
    return url.toString();
  }

  async function readJsonSafely(response) {
    const text = await response.text();
    if (!text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  function readStatusError(payload, fallback) {
    if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
    return fallback;
  }

  function readSessionFromStatusPayload(payload) {
    if (!isRecord(payload) || payload.ok !== true || !isRecord(payload.session)) {
      return null;
    }

    const session = payload.session;
    const sessionId = readString(session.sessionId);
    const threadId = readString(session.threadId);
    const status = readString(session.status);
    if (!sessionId || !threadId || !status) {
      return null;
    }

    return {
      sessionId,
      threadId,
      status,
      serverUrl: readNullableString(session.serverUrl),
      serverPath: readString(session.serverPath),
      expiresAtIso: readString(session.expiresAtIso),
      createdAtIso: readString(session.createdAtIso)
    };
  }

  function readString(value) {
    return typeof value === "string" ? value : "";
  }

  function readNullableString(value) {
    return typeof value === "string" ? value : null;
  }

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  globalScope.BrowserAnnotationPairingClient = {
    buildAnnotationBatchUrl,
    buildListenStatusUrl,
    readJsonSafely,
    readStatusError,
    readSessionFromStatusPayload
  };
})(globalThis);
