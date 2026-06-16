(function bootBrowserAnnotationSidePanel() {
  "use strict";

  const { MESSAGE_TYPES, STORAGE_KEYS, PRO_CONTROL_CHATGPT_ORIGIN } = globalThis.BrowserAnnotationConstants;
  const {
    describeRestrictedUrl,
    getTabOriginPattern,
    isRestrictedTabUrl
  } = globalThis.BrowserAnnotationUrlUtils;

  const elements = {
    connectionBadge: document.getElementById("connectionBadge"),
    serverUrl: document.getElementById("serverUrl"),
    pairingToken: document.getElementById("pairingToken"),
    saveSettings: document.getElementById("saveSettings"),
    connectionStatus: document.getElementById("connectionStatus"),
    connectionDetail: document.getElementById("connectionDetail"),
    panelMode: document.getElementById("panelMode"),
    injectOverlay: document.getElementById("injectOverlay"),
    targetStatus: document.getElementById("targetStatus"),
    targetDetail: document.getElementById("targetDetail"),
    catalogStatus: document.getElementById("catalogStatus"),
    targetProject: document.getElementById("targetProject"),
    targetThread: document.getElementById("targetThread"),
    refreshThreadTargets: document.getElementById("refreshThreadTargets"),
    proControlStatus: document.getElementById("proControlStatus"),
    proControlDetail: document.getElementById("proControlDetail"),
    proControlTask: document.getElementById("proControlTask"),
    enableProControl: document.getElementById("enableProControl"),
    disableProControl: document.getElementById("disableProControl"),
    tabStatus: document.getElementById("tabStatus"),
    tabDetail: document.getElementById("tabDetail"),
    devtoolsStatus: document.getElementById("devtoolsStatus"),
    devtoolsDetail: document.getElementById("devtoolsDetail"),
    captureDevtoolsBodies: document.getElementById("captureDevtoolsBodies"),
    captureDevtoolsBodiesHelp: document.getElementById("captureDevtoolsBodiesHelp"),
    enableDevtools: document.getElementById("enableDevtools"),
    disableDevtools: document.getElementById("disableDevtools"),
    pageStateNote: document.getElementById("pageStateNote"),
    addPageStateNote: document.getElementById("addPageStateNote"),
    queueStatus: document.getElementById("queueStatus"),
    queueDetail: document.getElementById("queueDetail"),
    batchMeta: document.getElementById("batchMeta"),
    queueList: document.getElementById("queueList"),
    queueItemDetail: document.getElementById("queueItemDetail"),
    sendBatch: document.getElementById("sendBatch"),
    persistentBinding: document.getElementById("persistentBinding"),
    persistentBindingStatus: document.getElementById("persistentBindingStatus"),
    persistentBindingDetail: document.getElementById("persistentBindingDetail"),
    disconnectPersistentBinding: document.getElementById("disconnectPersistentBinding"),
    message: document.getElementById("message")
  };
  const tabButtons = Array.from(document.querySelectorAll("[data-tab-target]"));
  const tabPanels = Array.from(document.querySelectorAll("[data-tab-panel]"));
  let lastState = null;
  let lastDevtoolsStatus = {
    status: "inactive",
    detail: "Diagnostics capture is off."
  };
  let selectedQueueDetailId = "";

  elements.saveSettings.addEventListener("click", saveSettings);
  elements.panelMode.addEventListener("change", persistPanelMode);
  elements.injectOverlay.addEventListener("click", injectOverlay);
  elements.targetProject.addEventListener("change", handleTargetProjectChange);
  elements.targetThread.addEventListener("change", selectThreadTarget);
  elements.refreshThreadTargets.addEventListener("click", refreshState);
  elements.enableProControl.addEventListener("click", enableProControl);
  elements.disableProControl.addEventListener("click", disableProControl);
  elements.enableDevtools.addEventListener("click", enableDevtoolsCapture);
  elements.disableDevtools.addEventListener("click", disableDevtoolsCapture);
  elements.pageStateNote.addEventListener("input", () => updatePageStateButton(false));
  elements.addPageStateNote.addEventListener("click", addPageStateNote);
  elements.disconnectPersistentBinding.addEventListener("click", disconnectPersistentBinding);
  elements.sendBatch.addEventListener("click", sendBatch);
  elements.queueList.addEventListener("click", handleQueueClick);
  elements.queueList.addEventListener("change", handleQueueChange);
  for (const button of tabButtons) {
    button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
  }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshState();
    }
  });
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEYS.annotationQueue]) {
      return;
    }
    const queue = changes[STORAGE_KEYS.annotationQueue].newValue || [];
    if (lastState) {
      lastState = {
        ...lastState,
        queue
      };
    }
    renderQueue(queue);
  });

  restorePanelMode();
  refreshState();

  async function refreshState() {
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.GET_STATE });
      renderState(response.state);
      await refreshDevtoolsStatus();
      setMessage("", "neutral");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.SAVE_SETTINGS,
        settings: {
          serverUrl: elements.serverUrl.value,
          pairingToken: elements.pairingToken.value
        }
      });
      renderState(response.state);
      setMessage(connectionMessage(response.state.connection), response.state.connection.status);
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function injectOverlay() {
    setBusy(true);
    try {
      await requestActiveTabHostPermission();
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.INJECT_OVERLAY
      });
      renderState(response.state);
      setMessage(
        response.injected
          ? "Pick on Page is active in the current tab."
          : "Overlay request completed, but no content-script response was received.",
        response.injected ? "ok" : "error"
      );
      if (response.injected && elements.panelMode.value === "floating") {
        await closeSidePanelForFloatingMode();
      }
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function closeSidePanelForFloatingMode() {
    if (!chrome.sidePanel || typeof chrome.sidePanel.close !== "function") {
      return;
    }
    try {
      const tabs = chrome.tabs && chrome.tabs.query
        ? await chrome.tabs.query({ active: true, currentWindow: true })
        : [];
      const activeTab = tabs[0] || null;
      if (activeTab && typeof activeTab.windowId === "number") {
        await chrome.sidePanel.close({ windowId: activeTab.windowId });
        return;
      }
      await chrome.sidePanel.close({});
    } catch (error) {
      console.warn("Unable to close side panel after starting floating annotation mode.", error);
    }
  }

  async function refreshDevtoolsStatus() {
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.GET_DEVTOOLS_CAPTURE_STATUS });
      renderDevtoolsStatus(readDevtoolsStatus(response));
    } catch (error) {
      renderDevtoolsStatus({
        status: "error",
        detail: error.message
      });
    }
  }

  async function enableDevtoolsCapture() {
    setBusy(true);
    const captureOptions = readDevtoolsCaptureOptions();
    renderDevtoolsStatus({
      status: "pending",
      detail: "Requesting debugger attachment for the active tab..."
    });
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.START_DEVTOOLS_CAPTURE,
        options: captureOptions
      });
      renderDevtoolsStatus(readDevtoolsStatus(response, "active"));
      setMessage("Diagnostics capture mode enabled for the active tab.", "ok");
    } catch (error) {
      renderDevtoolsStatus({
        status: "error",
        detail: error.message
      });
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function disableDevtoolsCapture(options = {}) {
    setBusy(true);
    renderDevtoolsStatus({
      status: "pending",
      detail: "Stopping Diagnostics capture mode..."
    });
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.STOP_DEVTOOLS_CAPTURE });
      renderDevtoolsStatus(readDevtoolsStatus(response, "inactive"));
      if (!options.silent) {
        setMessage("Diagnostics capture mode disabled.", "ok");
      }
    } catch (error) {
      renderDevtoolsStatus({
        status: "error",
        detail: error.message
      });
      if (!options.silent) {
        setMessage(error.message, "error");
      }
    } finally {
      setBusy(false);
    }
  }

  async function addPageStateNote() {
    const noteText = elements.pageStateNote.value.trim();
    if (!noteText) {
      setMessage("Add a short page note first.", "error");
      return;
    }
    if (!isDevtoolsCaptureActive()) {
      setMessage("Enable Diagnostics capture before adding a page note.", "error");
      return;
    }

    setBusy(true);
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.ADD_PAGE_STATE_ANNOTATION,
        noteText
      });
      elements.pageStateNote.value = "";
      renderState(response.state);
      setMessage("Page state note added to the queue.", "ok");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function disconnectPersistentBinding() {
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.DISCONNECT_BINDING
      });
      if (response.state) {
        renderState(response.state);
      } else {
        await refreshState();
      }
      setMessage("Persistent binding disconnected.", "ok");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function enableProControl() {
    setBusy(true);
    try {
      const permissionGranted = await requestProControlPermissionFromPanel();
      if (!permissionGranted) {
        await refreshState();
        setMessage("ChatGPT permission was denied.", "error");
        return;
      }
      const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.ENABLE_PRO_CONTROL });
      renderState(response.state);
      setMessage(proControlMessage(response.state.proControl), response.state.proControl.status === "permission_missing" ? "error" : "ok");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function requestProControlPermissionFromPanel() {
    if (!chrome.permissions || typeof chrome.permissions.contains !== "function" || typeof chrome.permissions.request !== "function") {
      return true;
    }
    const request = { origins: [PRO_CONTROL_CHATGPT_ORIGIN] };
    if (await chrome.permissions.contains(request)) {
      return true;
    }
    return chrome.permissions.request(request);
  }

  async function disableProControl() {
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({ type: MESSAGE_TYPES.DISABLE_PRO_CONTROL });
      renderState(response.state);
      setMessage("Pro-control worker disabled.", "ok");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function sendRuntimeMessage(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (!response || response.ok !== true) {
      throw new Error(
        response && response.error
          ? response.error
          : "The extension service worker did not return a valid response."
      );
    }
    return response;
  }

  function renderState(state) {
    lastState = state;
    elements.serverUrl.value = state.settings.serverUrl || "";
    elements.pairingToken.value = state.settings.pairingToken || "";

    const connected = state.connection.status === "connected";
    const error = state.connection.status === "error";
    elements.connectionBadge.textContent = connectionLabel(state.connection.status);
    elements.connectionBadge.classList.toggle("badge-ready", connected);
    elements.connectionBadge.classList.toggle("badge-error", error);
    elements.connectionBadge.classList.toggle("badge-muted", !connected && !error);
    elements.connectionStatus.textContent = connectionLabel(state.connection.status);
    elements.connectionDetail.textContent = connectionDetail(state.connection);
    renderPersistentBinding(state);
    renderThreadTargets(state.threadTargets);
    renderProControl(state.proControl);
    renderQueue(state.queue);
    renderDevtoolsStatus(state.devtoolsCapture || lastDevtoolsStatus);
    updateSendButton(false);

    if (!state.activeTab) {
      elements.tabStatus.textContent = "Unavailable";
      elements.tabDetail.textContent = "No active browser tab is available.";
      elements.injectOverlay.disabled = true;
      return;
    }

    elements.tabStatus.textContent = state.activeTab.restricted
      ? "Restricted"
      : state.activeTab.needsHostPermission
        ? "Needs access"
        : "Ready";
    elements.tabDetail.textContent = activeTabDetail(state.activeTab);
    elements.injectOverlay.disabled = state.activeTab.restricted;
  }

  function activateTab(targetId) {
    if (!targetId) {
      return;
    }
    for (const button of tabButtons) {
      const selected = button.dataset.tabTarget === targetId;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    }
    for (const panel of tabPanels) {
      const selected = panel.id === targetId;
      panel.hidden = !selected;
      panel.classList.toggle("is-active", selected);
    }
  }

  function restorePanelMode() {
    const saved = localStorage.getItem("browserAnnotation.panelMode") || "floating";
    elements.panelMode.value = saved === "docked" ? "docked" : "floating";
    document.body.dataset.panelMode = elements.panelMode.value;
  }

  function persistPanelMode() {
    const mode = elements.panelMode.value === "docked" ? "docked" : "floating";
    localStorage.setItem("browserAnnotation.panelMode", mode);
    document.body.dataset.panelMode = mode;
  }

  async function requestActiveTabHostPermission() {
    const freshTab = await getFreshActiveTab();
    const activeTab = freshTab || (lastState && lastState.activeTab ? lastState.activeTab : null);
    const tabUrl = activeTab && activeTab.url ? activeTab.url : "";
    if (!activeTab) {
      return;
    }
    if (isRestrictedTabUrl(tabUrl)) {
      throw new Error(describeRestrictedUrl(tabUrl));
    }

    const originPattern = getTabOriginPattern(tabUrl) || activeTab.hostPermissionPattern || "";
    if (!originPattern) {
      return;
    }

    if (!chrome.permissions || !chrome.permissions.request) {
      throw new Error("Chrome host permissions API is unavailable; cannot inject the annotation overlay.");
    }

    const hasAccess = chrome.permissions.contains
      ? await chrome.permissions.contains({ origins: [originPattern] })
      : activeTab.hasHostAccess === true;
    if (hasAccess) {
      return;
    }

    const granted = await chrome.permissions.request({ origins: [originPattern] });
    if (!granted) {
      throw new Error(`Permission denied. Allow Codex UI Browser Annotation to access ${originPattern} before injecting the overlay.`);
    }
  }

  async function getFreshActiveTab() {
    if (!chrome.tabs || !chrome.tabs.query) {
      return null;
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
  }

  function activeTabDetail(activeTab) {
    if (activeTab.restricted) {
      return activeTab.restrictionReason;
    }
    const label = activeTab.title || activeTab.url || "This page can receive the annotation overlay.";
    if (activeTab.needsHostPermission) {
      return `${label} Grant access when Chrome asks, then the overlay can be injected.`;
    }
    return label;
  }

  function setBusy(isBusy) {
    elements.saveSettings.disabled = isBusy;
    elements.injectOverlay.disabled =
      isBusy || !lastState || !lastState.activeTab || lastState.activeTab.restricted;
    elements.targetProject.disabled = isBusy || !canUseThreadTargets(lastState && lastState.threadTargets);
    elements.targetThread.disabled = isBusy || !canUseThreadTargets(lastState && lastState.threadTargets) || !elements.targetProject.value;
    elements.refreshThreadTargets.disabled = isBusy || !hasBrowserBindingConnection(lastState);
    elements.enableProControl.disabled = isBusy || !hasBrowserBindingConnection(lastState) || Boolean(lastState && lastState.proControl && lastState.proControl.enabled);
    elements.disableProControl.disabled = isBusy || !(lastState && lastState.proControl && lastState.proControl.enabled);
    if (!elements.disconnectPersistentBinding.hidden) {
      elements.disconnectPersistentBinding.disabled = isBusy;
    }
    updateDevtoolsButtons(isBusy);
    updatePageStateButton(isBusy);
    updateSendButton(isBusy);
  }

  function setMessage(text, tone) {
    elements.message.textContent = text;
    elements.message.classList.toggle("message-error", tone === "error");
    elements.message.classList.toggle("message-ok", tone === "ok" || tone === "connected");
  }

  function connectionLabel(status) {
    if (status === "connected") {
      return "Connected";
    }
    if (status === "error") {
      return "Error";
    }
    return "Disconnected";
  }

  function connectionDetail(connection) {
    if (!connection) {
      return "Connection state is unavailable.";
    }

    if (connection.status === "connected" && connection.binding) {
      const expiry = formatDateTime(connection.binding.expiresAtIso);
      return expiry
        ? `Browser binding validated. Expires ${expiry}.`
        : "Browser binding validated.";
    }

    if (connection.status === "connected" && connection.session) {
      const expiry = formatDateTime(connection.session.expiresAtIso);
      return expiry
        ? `Validated for thread ${connection.session.threadId}. Expires ${expiry}.`
        : `Validated for thread ${connection.session.threadId}.`;
    }

    return connection.detail || "Paste a browser binding code from Codex UI.";
  }

  function connectionMessage(connection) {
    if (!connection) {
      return "Settings saved locally in the extension.";
    }
    if (connection.status === "connected") {
      return connection.binding && connection.binding.tokenType === "browser-binding"
        ? "Browser binding connected."
        : connection.session && connection.session.tokenType === "extension"
        ? "Persistent binding connected."
        : "Browser binding code validated.";
    }
    if (connection.status === "error") {
      return connection.detail || "Browser binding code could not be validated.";
    }
    return "Settings saved locally in the extension.";
  }

  function renderProControl(proControl) {
    const state = proControl || {};
    const status = String(state.status || (state.enabled ? "online" : "disabled"));
    elements.proControlStatus.textContent = proControlStatusLabel(status);
    elements.proControlStatus.classList.toggle("status-active", state.enabled === true && status !== "error" && status !== "permission_missing");
    elements.proControlStatus.classList.toggle("status-error", status === "error" || status === "permission_missing");
    elements.proControlDetail.textContent = state.detail || "Connect browser binding, then enable Pro-control.";
    const parts = [];
    if (state.currentTaskId) parts.push(`Task ${state.currentTaskId}`);
    if (state.lastTaskStatus) parts.push(`Last ${state.lastTaskStatus}`);
    if (state.lastErrorCode) parts.push(`Error ${state.lastErrorCode}`);
    if (state.lastUpdatedIso) parts.push(formatDateTime(state.lastUpdatedIso));
    elements.proControlTask.textContent = parts.filter(Boolean).join(" · ");
    elements.enableProControl.disabled = !hasBrowserBindingConnection(lastState) || state.enabled === true;
    elements.disableProControl.disabled = state.enabled !== true;
  }

  function proControlStatusLabel(status) {
    if (status === "idle") return "Online/idle";
    if (status === "online") return "Online";
    if (status === "running") return "Running";
    if (status === "permission_missing") return "Permission missing";
    if (status === "error") return "Error";
    return "Disabled";
  }

  function proControlMessage(proControl) {
    if (!proControl) return "Pro-control state unavailable.";
    if (proControl.status === "permission_missing") return proControl.detail || "ChatGPT permission missing.";
    if (proControl.enabled) return "Pro-control worker enabled.";
    return proControl.detail || "Pro-control worker disabled.";
  }

  function renderPersistentBinding(state) {
    const binding = readPersistentBinding(state);
    if (!binding) {
      elements.persistentBinding.hidden = true;
      elements.disconnectPersistentBinding.hidden = true;
      elements.disconnectPersistentBinding.disabled = true;
      return;
    }

    const status = String(binding.status || (binding.connected ? "connected" : "configured"));
    elements.persistentBindingStatus.textContent = `Persistent: ${persistentBindingLabel(status)}`;
    elements.persistentBindingDetail.textContent = persistentBindingDetail(binding);
    elements.persistentBinding.hidden = false;
    const canDisconnect = binding.revocable === true ||
      Boolean(binding.token || binding.persistentToken || binding.session || binding.sessionId || binding.bindingId);
    elements.disconnectPersistentBinding.hidden = !canDisconnect;
    elements.disconnectPersistentBinding.disabled = !canDisconnect;
  }

  function renderThreadTargets(threadTargets) {
    const normalized = normalizeThreadTargets(threadTargets);
    const groups = normalized.groups;
    const selectedThreadId = normalized.selectedThreadId;
    const selectedThread = normalized.selectedThread;
    const selectedProjectKey = selectedThread
      ? projectKeyForTarget(selectedThread)
      : readProjectSelectValue(groups, elements.targetProject.value);

    elements.targetStatus.textContent = threadTargetStatusLabel(normalized, selectedThread);
    elements.targetStatus.classList.toggle("status-active", Boolean(selectedThread));
    elements.targetStatus.classList.toggle("status-error", normalized.status === "error");
    elements.targetDetail.textContent = threadTargetDetail(normalized, selectedThread);
    elements.catalogStatus.textContent = catalogFreshnessLabel(normalized);

    replaceSelectOptions(elements.targetProject, [
      { value: "", label: "Choose project..." },
      ...groups.map((group) => ({
        value: projectKey(group),
        label: group.projectName || group.cwd || "Projectless"
      }))
    ], selectedProjectKey);

    const activeGroup = groups.find((group) => projectKey(group) === elements.targetProject.value) || null;
    replaceSelectOptions(elements.targetThread, [
      { value: "", label: "Choose thread..." },
      ...(activeGroup ? activeGroup.threads.map((thread) => ({
        value: thread.id,
        label: thread.title || thread.preview || thread.id
      })) : [])
    ], selectedThreadId && activeGroup && activeGroup.threads.some((thread) => thread.id === selectedThreadId)
      ? selectedThreadId
      : "");

    const usable = canUseThreadTargets(normalized);
    elements.targetProject.disabled = !usable;
    elements.targetThread.disabled = !usable || !elements.targetProject.value;
    elements.refreshThreadTargets.disabled = !hasBrowserBindingConnection(lastState);
  }

  function catalogFreshnessLabel(threadTargets) {
    if (threadTargets.status === "ready") {
      return "Updated now";
    }
    if (threadTargets.status === "stale" || threadTargets.catalogStale === true) {
      return threadTargets.catalogFetchedAtIso ? "Using saved catalog" : "Refresh stale";
    }
    if (threadTargets.status === "error") {
      return "Refresh failed";
    }
    return "Not loaded";
  }

  function normalizeThreadTargets(threadTargets) {
    const source = threadTargets && typeof threadTargets === "object" ? threadTargets : {};
    const groups = Array.isArray(source.groups)
      ? source.groups.map((group) => ({
        projectName: String(group.projectName || "").trim(),
        cwd: String(group.cwd || "").trim(),
        threads: Array.isArray(group.threads)
          ? group.threads.map((thread) => ({
            id: String(thread.id || "").trim(),
            title: String(thread.title || thread.preview || thread.id || "").trim(),
            preview: String(thread.preview || "").trim(),
            updatedAtIso: String(thread.updatedAtIso || "").trim(),
            cwd: String(thread.cwd || "").trim()
          })).filter((thread) => thread.id)
          : []
      })).filter((group) => group.projectName || group.threads.length > 0)
      : [];
    const selectedThreadId = String(source.selectedThreadId || "").trim();
    const selectedThread = source.selectedThread && typeof source.selectedThread === "object"
      ? source.selectedThread
      : findThreadTarget(groups, selectedThreadId);
    return {
      status: String(source.status || "unavailable"),
      detail: String(source.detail || ""),
      groups,
      selectedThreadId,
      selectedThread
    };
  }

  function threadTargetStatusLabel(threadTargets, selectedThread) {
    if (selectedThread) return "Selected";
    if (threadTargets.status === "error") return "Error";
    if (threadTargets.status === "ready") return "Choose thread";
    return "Unavailable";
  }

  function threadTargetDetail(threadTargets, selectedThread) {
    if (selectedThread) {
      const projectName = selectedThread.projectName || projectNameForSelectedThread(threadTargets.groups, selectedThread.id);
      const title = selectedThread.title || selectedThread.preview || selectedThread.id;
      return projectName ? `${projectName} / ${title}` : title;
    }
    if (threadTargets.status === "ready") {
      return "Choose a destination thread before sending the queue.";
    }
    return threadTargets.detail || "Connect browser binding, then choose the thread that receives queued annotations.";
  }

  function canUseThreadTargets(threadTargets) {
    return Boolean(threadTargets && threadTargets.status === "ready" && Array.isArray(threadTargets.groups) && threadTargets.groups.length > 0);
  }

  function hasBrowserBindingConnection(state) {
    return Boolean(
      state &&
      state.connection &&
      state.connection.status === "connected" &&
      state.connection.binding
    );
  }

  function hasSelectedThreadTarget(state) {
    if (!state || !state.connection || state.connection.status !== "connected") return false;
    if (state.connection.session) return true;
    const targets = normalizeThreadTargets(state.threadTargets);
    return Boolean(state.connection.binding && targets.selectedThreadId && targets.selectedThread);
  }

  function projectKey(group) {
    return `${group.projectName || ""}\n${group.cwd || ""}`;
  }

  function projectKeyForTarget(target) {
    return `${target.projectName || ""}\n${target.projectCwd || target.cwd || ""}`;
  }

  function readProjectSelectValue(groups, currentValue) {
    if (groups.some((group) => projectKey(group) === currentValue)) {
      return currentValue;
    }
    return "";
  }

  function projectNameForSelectedThread(groups, threadId) {
    for (const group of groups) {
      if (group.threads.some((thread) => thread.id === threadId)) {
        return group.projectName;
      }
    }
    return "";
  }

  function findThreadTarget(groups, threadId) {
    if (!threadId) return null;
    for (const group of groups) {
      const match = group.threads.find((thread) => thread.id === threadId);
      if (match) {
        return {
          ...match,
          projectName: group.projectName,
          projectCwd: group.cwd
        };
      }
    }
    return null;
  }

  function replaceSelectOptions(select, options, selectedValue) {
    select.replaceChildren(...options.map((option) => {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      return element;
    }));
    select.value = options.some((option) => option.value === selectedValue) ? selectedValue : "";
  }

  async function handleTargetProjectChange() {
    const projectValue = elements.targetProject.value;
    const targets = normalizeThreadTargets(lastState && lastState.threadTargets);
    if (!targets.selectedThreadId) {
      renderThreadTargets(lastState && lastState.threadTargets);
      return;
    }
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.SELECT_THREAD_TARGET,
        threadId: ""
      });
      renderState(response.state);
      elements.targetProject.value = projectValue;
      renderThreadTargets({
        ...response.state.threadTargets,
        selectedThreadId: "",
        selectedThread: null
      });
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function selectThreadTarget() {
    const threadId = elements.targetThread.value;
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.SELECT_THREAD_TARGET,
        threadId
      });
      renderState(response.state);
      setMessage(
        threadId ? "Destination thread selected." : "Choose a destination thread before sending the queue.",
        threadId ? "ok" : "neutral"
      );
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function readPersistentBinding(state) {
    if (!state || typeof state !== "object") {
      return null;
    }
    const candidates = [
      state.persistentBinding,
      state.persistent,
      state.connection && state.connection.persistentBinding,
      state.connection && state.connection.persistent,
      state.settings && state.settings.persistentBinding
    ];
    return candidates.find((candidate) => candidate && typeof candidate === "object") || null;
  }

  function persistentBindingLabel(status) {
    if (status === "connected" || status === "active") {
      return "Connected";
    }
    if (status === "revocable" || status === "disconnectable") {
      return "Revocable";
    }
    if (status === "revoked" || status === "disconnected") {
      return "Disconnected";
    }
    if (status === "error") {
      return "Error";
    }
    return "Configured";
  }

  function persistentBindingDetail(binding) {
    if (binding.detail) {
      return String(binding.detail);
    }
    const session = binding.session && typeof binding.session === "object" ? binding.session : {};
    if (binding.reconnectRequired) {
      return binding.detail || "Reconnect required.";
    }
    const bindingId = binding.bindingId || (binding.binding && binding.binding.bindingId);
    const threadId = binding.threadId || session.threadId;
    const expiresAtIso = binding.expiresAtIso || session.expiresAtIso;
    const expiry = formatDateTime(expiresAtIso);
    if (bindingId && expiry) {
      return `Browser binding ${truncateText(bindingId, 12)}. Expires ${expiry}.`;
    }
    if (bindingId) {
      return `Browser binding ${truncateText(bindingId, 12)}.`;
    }
    if (threadId && expiry) {
      return `Thread ${threadId}. Expires ${expiry}.`;
    }
    if (threadId) {
      return `Thread ${threadId}.`;
    }
    if (expiry) {
      return `Expires ${expiry}.`;
    }
    return "Persistent session is available.";
  }

  function formatDateTime(value) {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return date.toLocaleString();
  }

  function renderQueue(queue) {
    const items = Array.isArray(queue) ? queue : [];
    if (selectedQueueDetailId && !items.some((item) => item && item.id === selectedQueueDetailId)) {
      selectedQueueDetailId = "";
    }
    elements.queueStatus.textContent =
      items.length === 0 ? "Empty" : `${items.length} item${items.length === 1 ? "" : "s"}`;
    elements.queueDetail.textContent =
      items.length === 0
        ? "Select elements or add a page note, then send one batch."
        : "Adjust order or remove items before sending.";
    renderBatchMeta(items);
    elements.queueList.replaceChildren(
      ...items.map((item, index) => {
        const row = document.createElement("li");
        row.dataset.annotationId = item.id || "";
        const content = document.createElement("div");
        content.className = "queue-content";
        const header = document.createElement("div");
        header.className = "queue-row-header";
        const heading = document.createElement("div");
        heading.className = "queue-heading";
        const name = document.createElement("strong");
        const context = item.context || {};
        name.textContent = queueItemName(context);
        const meta = document.createElement("span");
        meta.textContent = queueItemMeta(item);
        heading.append(name, meta);
        header.append(heading, createQueueActions(item, index, items.length));
        content.append(header, createScreenshotState(item), createCommentPreview(item));
        row.append(createPreview(item.preview, item), content);
        return row;
      })
    );
    renderQueueItemDetail(items.find((item) => item && item.id === selectedQueueDetailId) || null);
    updateSendButton(false);
  }

  function renderBatchMeta(items) {
    if (items.length === 0) {
      elements.batchMeta.hidden = true;
      elements.batchMeta.replaceChildren();
      return;
    }
    const page = readQueueItemPage(items[0]);
    const title = document.createElement("strong");
    title.textContent = "Batch page";
    const detail = document.createElement("span");
    detail.textContent = page.title ? `${page.title} - ${page.url}` : page.url;
    elements.batchMeta.replaceChildren(title, detail);
    elements.batchMeta.hidden = false;
  }

  function createQueueActions(item, index, itemCount) {
    const actions = document.createElement("div");
    actions.className = "queue-actions";
    actions.append(
      createActionButton("Open detail", "detail", "↗", false),
      createActionButton("Move up", "up", "↑", index === 0),
      createActionButton("Move down", "down", "↓", index === itemCount - 1),
      createActionButton("Delete", "delete", "×", false)
    );
    actions.dataset.annotationId = item.id || "";
    return actions;
  }

  function createActionButton(label, action, text, disabled) {
    const button = document.createElement("button");
    button.className = "icon-button";
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.queueAction = action;
    button.textContent = text;
    button.disabled = disabled;
    return button;
  }

  async function handleQueueClick(event) {
    const button = event.target.closest("[data-queue-action]");
    if (!button || button.disabled) {
      return;
    }
    const row = button.closest("[data-annotation-id]");
    const id = row ? row.dataset.annotationId : "";
    if (!id) {
      return;
    }

    const action = button.dataset.queueAction;
    setBusy(true);
    try {
      if (action === "delete") {
        const response = await sendRuntimeMessage({
          type: MESSAGE_TYPES.DELETE_ANNOTATION_QUEUE_ITEM,
          id
        });
        applyQueueResponse(response);
        setMessage("Annotation removed from the queue.", "ok");
      } else if (action === "detail") {
        selectedQueueDetailId = id;
        renderQueueItemDetail((lastState && Array.isArray(lastState.queue) ? lastState.queue : []).find((item) => item && item.id === id) || null);
        setMessage("Queue Item Detail opened.", "ok");
      } else {
        const response = await sendRuntimeMessage({
          type: MESSAGE_TYPES.MOVE_ANNOTATION_QUEUE_ITEM,
          id,
          direction: action === "up" ? -1 : 1
        });
        applyQueueResponse(response);
        setMessage("Queue order updated.", "ok");
      }
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleQueueChange(event) {
    if (!event.target.matches("textarea[data-annotation-id]")) {
      return;
    }
    await saveQueueNote(event.target.dataset.annotationId, event.target.value);
  }

  async function saveQueueNote(id, noteText) {
    if (!id) {
      return;
    }
    const response = await sendRuntimeMessage({
      type: MESSAGE_TYPES.UPDATE_ANNOTATION_QUEUE_ITEM,
      id,
      patch: { noteText }
    });
    applyQueueResponse(response);
  }

  async function sendBatch() {
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.SEND_ANNOTATION_BATCH
      });
      await disableDevtoolsCapture({ silent: true });
      renderState(response.state);
      const count = response.result && response.result.annotationCount
        ? response.result.annotationCount
        : "queued";
      setMessage(`Sent ${count} annotation${count === 1 ? "" : "s"} to Codex UI.`, "ok");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function updateSendButton(isBusy) {
    const itemCount = lastState && Array.isArray(lastState.queue) ? lastState.queue.length : 0;
    const hasBlockedScreenshot = lastState && Array.isArray(lastState.queue)
      ? lastState.queue.some((item) => screenshotState(item) === "failed")
      : false;
    elements.sendBatch.disabled = isBusy || itemCount === 0 || hasBlockedScreenshot || !hasSelectedThreadTarget(lastState);
  }

  function applyQueueResponse(response) {
    if (response.state) {
      renderState(response.state);
      return;
    }
    if (lastState && Array.isArray(response.queue)) {
      lastState = {
        ...lastState,
        queue: response.queue
      };
      renderQueue(response.queue);
    }
  }

  function readDevtoolsStatus(response, fallbackStatus) {
    if (response && response.state && response.state.devtoolsCapture) {
      return response.state.devtoolsCapture;
    }
    if (response && response.devtoolsCapture) {
      return response.devtoolsCapture;
    }
    return {
      status: fallbackStatus || "inactive",
      detail: fallbackStatus === "active"
        ? "Diagnostics capture is active for the current tab."
        : "Diagnostics capture is off."
    };
  }

  function renderDevtoolsStatus(devtools) {
    const normalized = normalizeDevtoolsStatus(devtools);
    lastDevtoolsStatus = normalized;
    elements.devtoolsStatus.textContent = devtoolsStatusLabel(normalized.status);
    elements.devtoolsStatus.classList.toggle("status-active", normalized.status === "active");
    elements.devtoolsStatus.classList.toggle("status-error", normalized.status === "error");
    elements.devtoolsStatus.classList.toggle("status-pending", normalized.status === "pending");
    elements.devtoolsDetail.textContent = normalized.detail;
    updateDevtoolsButtons(false);
  }

  function normalizeDevtoolsStatus(devtools) {
    const status = devtools && typeof devtools.status === "string"
      ? devtools.status
      : "inactive";
    const captureOptions = normalizeDevtoolsCaptureOptions(devtools && devtools.captureOptions);
    const activeTabId = devtools && typeof devtools.tabId === "number"
      ? ` Attached to tab ${devtools.tabId}.`
      : "";
    if (status === "active") {
      return {
        status,
        detail: (devtools.detail || "Diagnostics capture is active for the current tab.") +
          activeTabId +
          ` ${devtoolsBodyCaptureDetail(captureOptions)}`,
        captureOptions
      };
    }
    if (status === "pending" || status === "error") {
      return {
        status,
        detail: devtools.detail || (status === "pending" ? "Updating Diagnostics capture mode..." : "Diagnostics capture status is unavailable."),
        captureOptions
      };
    }
    return {
      status: "inactive",
      detail: devtools && devtools.detail ? devtools.detail : "Diagnostics capture is off.",
      captureOptions
    };
  }

  function devtoolsStatusLabel(status) {
    if (status === "active") {
      return "Active";
    }
    if (status === "pending") {
      return "Updating";
    }
    if (status === "error") {
      return "Error";
    }
    return "Inactive";
  }

  function updateDevtoolsButtons(isBusy) {
    const state = lastDevtoolsStatus ? lastDevtoolsStatus.status : "inactive";
    const activeTabUnavailable = !lastState || !lastState.activeTab || lastState.activeTab.restricted;
    const activeOptions = lastDevtoolsStatus && state === "active"
      ? lastDevtoolsStatus.captureOptions
      : null;
    const activeBodyCapture = activeOptions
      ? activeOptions.captureRequestBodies === true && activeOptions.captureResponseBodies === true
      : false;
    if (state === "active") {
      elements.captureDevtoolsBodies.checked = activeBodyCapture;
      elements.captureDevtoolsBodiesHelp.textContent = activeBodyCapture
        ? "Active for this capture. Disable Diagnostics capture to change body collection."
        : "Metadata-only for this capture. Disable Diagnostics capture to opt in to body collection.";
    } else {
      elements.captureDevtoolsBodiesHelp.textContent =
        "Off by default. Enable only for pages where body contents are safe to share with Codex.";
    }
    elements.captureDevtoolsBodies.disabled = isBusy || state === "active" || state === "pending";
    elements.enableDevtools.disabled = isBusy || activeTabUnavailable || state === "active" || state === "pending";
    elements.disableDevtools.disabled = isBusy || state !== "active";
    updatePageStateButton(isBusy);
  }

  function updatePageStateButton(isBusy) {
    const noteText = elements.pageStateNote.value.trim();
    const activeTabUnavailable = !lastState || !lastState.activeTab || lastState.activeTab.restricted;
    elements.addPageStateNote.disabled = isBusy || activeTabUnavailable || !isDevtoolsCaptureActive() || !noteText;
  }

  function isDevtoolsCaptureActive() {
    return lastDevtoolsStatus && lastDevtoolsStatus.status === "active";
  }

  function readDevtoolsCaptureOptions() {
    const captureBodies = elements.captureDevtoolsBodies.checked === true;
    return {
      bodyCaptureMode: captureBodies ? "request-response" : "metadata-only",
      captureRequestBodies: captureBodies,
      captureResponseBodies: captureBodies
    };
  }

  function normalizeDevtoolsCaptureOptions(options) {
    const source = options && typeof options === "object" ? options : {};
    const captureRequestBodies = source.captureBodies === true ||
      source.captureRequestBodies === true ||
      source.bodyCaptureMode === "full-body-opt-in" ||
      source.bodyCaptureMode === "request-response";
    const captureResponseBodies = source.captureBodies === true ||
      source.captureResponseBodies === true ||
      source.bodyCaptureMode === "full-body-opt-in" ||
      source.bodyCaptureMode === "request-response";
    return {
      bodyCaptureMode: captureRequestBodies || captureResponseBodies
        ? "full-body-opt-in"
        : "metadata-only",
      captureRequestBodies,
      captureResponseBodies
    };
  }

  function devtoolsBodyCaptureDetail(options) {
    const captureBodies = options &&
      options.captureRequestBodies === true &&
      options.captureResponseBodies === true;
    return captureBodies
      ? "Request and response body capture is enabled for this active session."
      : "Request and response bodies are excluded for this active session.";
  }

  function readQueueItemPage(item) {
    const context = item && item.context ? item.context : {};
    const page = context.page || {};
    const tab = item && item.tab ? item.tab : {};
    return {
      title: page.title || tab.title || "",
      url: page.url || tab.url || "Unknown page"
    };
  }

  function createPreview(preview, item) {
    const frame = document.createElement("button");
    frame.className = "queue-preview";
    frame.type = "button";
    frame.dataset.queueAction = "detail";
    frame.title = "Open Queue Item Detail";
    frame.setAttribute("aria-label", "Open Queue Item Detail");
    const state = screenshotState(item);
    if (!preview || !preview.dataUrl) {
      if (isPageStateItem(item)) {
        frame.dataset.previewKind = "page-state";
        frame.textContent = "Page";
      } else if (state === "failed") {
        frame.textContent = "Screenshot Failed";
      } else if (state === "off") {
        frame.textContent = "Screenshot Off";
      } else {
        frame.textContent = "Screenshot Pending";
      }
      return frame;
    }

    const image = document.createElement("img");
    image.src = preview.dataUrl;
    image.alt = "Selected element preview";
    image.loading = "lazy";
    image.width = preview.width || 1;
    image.height = preview.height || 1;
    frame.append(image);
    return frame;
  }

  function createScreenshotState(item) {
    const state = document.createElement("span");
    state.className = "queue-screenshot-state";
    const value = screenshotState(item);
    state.dataset.state = value;
    state.textContent = screenshotStateLabel(value);
    return state;
  }

  function createCommentPreview(item) {
    const note = document.createElement("span");
    note.className = "queue-comment-preview";
    const text = String(item && item.noteText ? item.noteText : "").trim();
    note.textContent = text ? truncateText(text, 96) : "No comment";
    return note;
  }

  function renderQueueItemDetail(item) {
    if (!item) {
      elements.queueItemDetail.hidden = true;
      elements.queueItemDetail.replaceChildren();
      return;
    }
    const title = document.createElement("strong");
    title.textContent = "Queue Item Detail";
    const state = document.createElement("span");
    state.className = "queue-screenshot-state";
    state.textContent = screenshotStateLabel(screenshotState(item));
    const comment = document.createElement("textarea");
    comment.className = "queue-detail-comment";
    comment.dataset.annotationId = item.id || "";
    comment.value = String(item.noteText || "");
    comment.rows = 4;
    const page = readQueueItemPage(item);
    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = page.title ? `${page.title} - ${page.url}` : page.url;
    const back = document.createElement("button");
    back.className = "button button-secondary button-compact";
    back.type = "button";
    back.textContent = "Back to queue";
    back.addEventListener("click", () => {
      selectedQueueDetailId = "";
      renderQueueItemDetail(null);
    });
    const actions = [back];
    if (screenshotState(item) === "failed") {
      const withoutScreenshot = document.createElement("button");
      withoutScreenshot.className = "button button-secondary button-compact";
      withoutScreenshot.type = "button";
      withoutScreenshot.textContent = "Send without screenshot";
      withoutScreenshot.addEventListener("click", async () => {
        await saveQueueScreenshotChoice(item.id || "");
      });
      actions.unshift(withoutScreenshot);
    }
    elements.queueItemDetail.replaceChildren(title, createPreview(item.preview, item), state, comment, meta, ...actions);
    elements.queueItemDetail.hidden = false;
  }

  async function saveQueueScreenshotChoice(id) {
    if (!id) return;
    setBusy(true);
    try {
      const response = await sendRuntimeMessage({
        type: MESSAGE_TYPES.UPDATE_ANNOTATION_QUEUE_ITEM,
        id,
        patch: {
          screenshot: {
            state: "off",
            sendWithoutScreenshot: true
          }
        }
      });
      applyQueueResponse(response);
      setMessage("Annotation will send without screenshot.", "ok");
    } catch (error) {
      setMessage(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function screenshotState(item) {
    const screenshot = item && item.screenshot && typeof item.screenshot === "object" ? item.screenshot : null;
    if (screenshot && screenshot.sendWithoutScreenshot === true) return "off";
    if (screenshot && screenshot.state === "failed") return "failed";
    if (screenshot && screenshot.state === "off") return "off";
    if ((screenshot && screenshot.state === "ready") || (item && item.preview && item.preview.dataUrl)) return "ready";
    return "pending";
  }

  function screenshotStateLabel(state) {
    if (state === "ready") return "Screenshot Ready";
    if (state === "failed") return "Screenshot Failed";
    if (state === "off") return "Screenshot Off";
    return "Screenshot Pending";
  }

  function isPageStateItem(item) {
    const context = item && item.context && typeof item.context === "object" ? item.context : {};
    return item && (item.kind === "devtools/page-state" || context.kind === "devtools/page-state");
  }

  function queueItemName(context) {
    if (context && context.kind === "devtools/page-state") {
      return "Page state";
    }
    const aria = context.aria && typeof context.aria === "object" ? context.aria : {};
    const nearby = context.nearby && typeof context.nearby === "object" ? context.nearby : {};
    const labels = Array.isArray(nearby.labels) ? nearby.labels : [];
    const labelSource = [
      aria.label,
      aria.labelledByText,
      labels.length > 0 && labels[0] ? labels[0].text : "",
      context.text
    ].find((value) => typeof value === "string" && value.trim());
    const shortLabel = truncateText(labelSource || readableElementType(context), 72);
    return shortLabel || "Selected element";
  }

  function queueItemMeta(item) {
    if (isPageStateItem(item)) {
      const page = readQueueItemPage(item);
      const pageTitle = page.title ? truncateText(page.title, 42) : "";
      return ["devtools/page-state", pageTitle].filter(Boolean).join(" - ");
    }
    const context = item && item.context ? item.context : {};
    const role = context.role ? context.role : readableElementType(context);
    const rect = context.rect && typeof context.rect === "object" ? context.rect : {};
    const size = Number.isFinite(rect.width) && Number.isFinite(rect.height)
      ? `${Math.round(rect.width)}x${Math.round(rect.height)}`
      : "";
    const page = readQueueItemPage(item);
    const pageTitle = page.title ? truncateText(page.title, 42) : "";
    return [role, size, pageTitle].filter(Boolean).join(" - ") || "Selected element";
  }

  function readableElementType(context) {
    const tag = String(context && context.tagName ? context.tagName : "element").toLowerCase();
    const role = context && context.role ? String(context.role) : "";
    if (role) {
      return role;
    }
    if (tag === "img") {
      return "Image";
    }
    if (/^h[1-6]$/.test(tag)) {
      return "Heading";
    }
    if (tag === "a") {
      return "Link";
    }
    if (tag === "button") {
      return "Button";
    }
    if (tag === "input" || tag === "textarea") {
      return "Input";
    }
    return tag ? tag.charAt(0).toUpperCase() + tag.slice(1) : "Element";
  }

  function truncateText(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
  }
})();
