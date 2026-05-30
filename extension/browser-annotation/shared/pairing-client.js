(function attachBrowserAnnotationPairingClient(globalScope) {
  "use strict";

  const constants = globalScope.BrowserAnnotationConstants;
  const urlUtils = globalScope.BrowserAnnotationUrlUtils;

  function buildListenStatusUrl(serverUrl) {
    const normalizedServerUrl = urlUtils.normalizeServerUrl(serverUrl);
    return new URL(constants.LISTEN_STATUS_PATH, `${normalizedServerUrl}/`).toString();
  }

  function buildListenBindUrl(serverUrl) {
    const normalizedServerUrl = urlUtils.normalizeServerUrl(serverUrl);
    return new URL(constants.LISTEN_BIND_PATH, `${normalizedServerUrl}/`).toString();
  }

  function buildListenStopUrl(serverUrl) {
    const normalizedServerUrl = urlUtils.normalizeServerUrl(serverUrl);
    return new URL(constants.LISTEN_STOP_PATH, `${normalizedServerUrl}/`).toString();
  }

  function buildBindingRevokeUrl(serverUrl) {
    const normalizedServerUrl = urlUtils.normalizeServerUrl(serverUrl);
    return new URL(constants.LISTEN_BINDING_REVOKE_PATH, `${normalizedServerUrl}/`).toString();
  }

  function buildAnnotationBatchUrl(serverUrl, session) {
    const normalizedServerUrl = urlUtils.normalizeServerUrl(serverUrl);
    const url = new URL(constants.ANNOTATION_BATCH_PATH, `${normalizedServerUrl}/`);
    appendSessionParams(url, session);
    return url.toString();
  }

  function buildAssetUploadUrl(serverUrl, session) {
    const normalizedServerUrl = urlUtils.normalizeServerUrl(serverUrl);
    const url = new URL(constants.ASSET_UPLOAD_PATH, `${normalizedServerUrl}/`);
    appendSessionParams(url, session);
    return url.toString();
  }

  function buildTranscribeUrl(serverUrl, session) {
    const normalizedServerUrl = urlUtils.normalizeServerUrl(serverUrl);
    const url = new URL(constants.TRANSCRIBE_PATH, `${normalizedServerUrl}/`);
    appendSessionParams(url, session);
    return url.toString();
  }

  function appendSessionParams(url, session) {
    if (session && session.sessionId) {
      url.searchParams.set("sessionId", session.sessionId);
    }
    if (session && session.threadId) {
      url.searchParams.set("threadId", session.threadId);
    }
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

    const parsed = {
      sessionId,
      threadId,
      status,
      serverUrl: readNullableString(session.serverUrl),
      serverPath: readString(session.serverPath),
      expiresAtIso: readString(session.expiresAtIso),
      createdAtIso: readString(session.createdAtIso)
    };

    const tokenType = readString(session.tokenType);
    const lastUsedAtIso = readString(session.lastUsedAtIso);
    const extensionToken = readString(session.extensionToken);
    if (tokenType) {
      parsed.tokenType = tokenType;
    }
    if (lastUsedAtIso) {
      parsed.lastUsedAtIso = lastUsedAtIso;
    }
    if (extensionToken) {
      parsed.extensionToken = extensionToken;
    }
    return parsed;
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
    buildAssetUploadUrl,
    buildBindingRevokeUrl,
    buildListenBindUrl,
    buildListenStopUrl,
    buildListenStatusUrl,
    buildTranscribeUrl,
    readJsonSafely,
    readStatusError,
    readSessionFromStatusPayload
  };
})(globalThis);
