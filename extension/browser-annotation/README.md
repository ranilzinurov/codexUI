# Codex UI Browser Annotation Extension

Manifest V3 MVP scaffold for browser annotation. This stage includes extension structure, locally stored server URL and pairing token, bearer-token validation against the Codex UI listen status endpoint, connected/disconnected/error side-panel state, restricted-page guards, user-requested overlay injection, element hover/selection overlays, visible-tab screenshot capture, selected-element crop previews, explicit DevTools console/network capture, a local annotation queue with per-item notes/edit/delete/reorder, and batch send to Codex UI.

No build step is required for local development. The folder is designed to be loaded directly with Chrome's **Load unpacked** flow.

For a production install artifact, run:

```sh
pnpm run pack:browser-annotation
```

The command writes an unpacked production copy and zip archive under `dist/browser-annotation-extension/`. The production manifest keeps only `https://annotate.todo-tg-app.ru/*` in `host_permissions`, excludes `dev/` fixtures, keeps the default server URL at `https://annotate.todo-tg-app.ru`, and validates the artifact with `dev/validate-extension.mjs --production`.

## Files

- `manifest.json` declares MV3, the service worker, side panel, action keyboard shortcut, `activeTab`/`alarms`/`debugger`/`scripting`/`tabs`/`sidePanel` permissions, target host access for `https://annotate.todo-tg-app.ru/*`, the current manual-test host `http://46.62.215.111/*`, and narrow local development host access for `http://127.0.0.1/*` plus `http://localhost/*`.
- `service-worker/service-worker.js` owns side-panel messages, local settings, pairing-token validation, active-tab checks, action-click side-panel behavior, user-gesture content-script injection, visible-tab capture, best-effort crop preview creation, explicit `chrome.debugger` attach/detach, bounded DevTools console/network capture, local selected-element queue storage, queue mutation, and annotation-batch POSTs.
- `sidepanel/` contains the load-unpacked side panel UI.
- `content/content-script.js` installs a Shadow DOM overlay, tracks hover/selected element boxes while annotation mode is active, and sends selected element context back to the service worker.
- `shared/` contains small globals, JSDoc contract typedefs, message names, storage keys, URL rules, pairing status helpers, selection-context helpers, screenshot crop helpers, and defaults used by the service worker, content script, and side panel.
- `dev/test-page.html` is a static page for manual overlay checks when served over local http.
- `dev/devtools-fixture-server.mjs` serves a local page that emits predictable console and network events for DevTools capture smoke testing.
- `dev/validate-extension.mjs` validates the manifest and required scaffold files with Node.

## Static Smoke Test

```sh
node --check extension/browser-annotation/shared/constants.js
node --check extension/browser-annotation/shared/url-utils.js
node --check extension/browser-annotation/shared/pairing-client.js
node --check extension/browser-annotation/shared/selection-context.js
node --check extension/browser-annotation/shared/annotation-queue.js
node --check extension/browser-annotation/shared/devtools-capture.js
node --check extension/browser-annotation/shared/screenshot-crop.js
node --check extension/browser-annotation/service-worker/service-worker.js
node --check extension/browser-annotation/content/content-script.js
node --check extension/browser-annotation/sidepanel/sidepanel.js
node --check extension/browser-annotation/dev/validate-extension.mjs
node --check extension/browser-annotation/dev/pairing-client-smoke.mjs
node --check extension/browser-annotation/dev/selection-context-smoke.mjs
node --check extension/browser-annotation/dev/annotation-queue-smoke.mjs
node --check extension/browser-annotation/dev/screenshot-crop-smoke.mjs
node --check extension/browser-annotation/dev/devtools-capture-smoke.mjs
node --check extension/browser-annotation/dev/devtools-fixture-smoke.mjs
node --check extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs
node extension/browser-annotation/dev/validate-extension.mjs
node extension/browser-annotation/dev/pairing-client-smoke.mjs
node extension/browser-annotation/dev/selection-context-smoke.mjs
node extension/browser-annotation/dev/annotation-queue-smoke.mjs
node extension/browser-annotation/dev/screenshot-crop-smoke.mjs
node extension/browser-annotation/dev/devtools-capture-smoke.mjs
node extension/browser-annotation/dev/devtools-fixture-smoke.mjs
node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs
```

## Manual Load-Unpacked Smoke Test

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open any normal `http(s)` page. For the included test page, serve the repository locally first, for example `python3 -m http.server 8899`, then open `http://127.0.0.1:8899/extension/browser-annotation/dev/test-page.html`.
5. Click the extension action, or press `Ctrl+Shift+Y`, to open the side panel and start annotation mode on the active page.
6. Keep the default server URL (`https://annotate.todo-tg-app.ru`) or enter `http://46.62.215.111:4173`, `http://127.0.0.1:<port>`, or `http://localhost:<port>` for testing.
7. Paste a Codex UI browser annotation pairing token. The token stays in extension local storage and is only sent as `Authorization: Bearer <token>` to `/codex-api/extension/listen/status`.
8. Click **Save and validate**.
9. Confirm the side panel shows **Connected** for an active token, **Disconnected** when no token is stored, and **Error** for invalid, expired, unreachable, or malformed status responses.
10. If annotation mode is not already active, click **Inject overlay**.
11. Confirm the page shows the "Codex annotation mode" panel and a blue hover box follows the button, input, and sample card.
12. Click the sample button, sample input, and sample card.
13. Confirm the selected element gets a green box, the overlay reports that the element was queued, and the side panel queue count/list updates.
14. Confirm each queue row includes a visible preview cropped to the selected element when Chrome grants visible-tab capture. On a DPR 2 display, a 120 CSS-pixel wide selected element should produce a 240 pixel wide stored preview unless it exceeds the preview cap.
15. If Chrome denies visible-tab capture, confirm the element still queues and the row shows `No preview` instead of failing the selection.
16. Open the extension service worker console and inspect `chrome.storage.local.get("browserAnnotation.annotationQueue")`. Confirm queued items either store `preview.dataUrl`, `preview.cropRect`, and `preview.devicePixelRatio`, or store a short `previewError`; no full-tab screenshot is stored.
17. Create three queued annotations, type a distinct note into each queue row, move the second row up, and delete the remaining third row.
18. Optional DevTools smoke: run `node extension/browser-annotation/dev/devtools-fixture-server.mjs`, open `http://127.0.0.1:8899/`, enable **DevTools capture mode**, click console/network fixture buttons, and make an annotation.
19. Click **Send queued annotations** with a valid connected pairing token and confirm the queue clears after the server accepts the batch. The batch request should be a POST to `/codex-api/extension/annotation-batch` with the pairing token as `Authorization: Bearer <token>`.
20. Inspect the annotation-batch request body if available. Confirm it contains one top-level `page`, queued `items`, each item note, selector/rect/viewport context, `assets: []`, no `preview.dataUrl` or other screenshot data URL, and `devTools` only when DevTools capture mode was explicitly enabled.
21. Press Esc and confirm hover tracking stops until **Inject overlay** is clicked again.

Restricted pages such as `chrome://extensions`, `chrome-extension://...`, `file://...`, `devtools://...`, and `about:` pages should show a clear side-panel error instead of attempting injection.

Preview payloads are bounded by `MAX_SCREENSHOT_PREVIEW_EDGE_PX` and `MAX_SCREENSHOT_PREVIEW_DATA_URL_CHARS`. The service worker keeps the full visible-tab screenshot only in memory long enough to crop it, then stores only the cropped preview with the queue item. Preview capture is best-effort: if Chrome denies `captureVisibleTab`, the selected element context is still queued without a preview.

Annotation-batch payloads are capped before send by `MAX_ANNOTATION_BATCH_BYTES`. Local crop previews remain extension-only in this stage because uploaded screenshot asset references are produced by a later stage.

DevTools capture uses Chrome's debugger permission only after the user enables **DevTools capture mode** in the side panel. Capture stops on explicit disable, successful send, tab close, timeout, or debugger detach. Console and network rows are count- and byte-bounded; request and response bodies are metadata-only by default. The side panel includes an explicit opt-in control for request/response bodies; captured text bodies are byte-capped and sensitive headers/body fields are redacted before they are stored or sent.

For pairing, DNS, nginx, active-tab permission, queue, DevTools, and voice recording problems, see `../../docs/browser-annotation-troubleshooting.md`.
