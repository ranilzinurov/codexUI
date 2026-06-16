# Codex UI Browser Annotation Extension

Manifest V3 MVP scaffold for browser annotation. This stage includes extension structure, locally stored server URL plus scoped persistent binding token, bearer-token validation against the Codex UI binding endpoint, connected/disconnected/error panel state, restricted-page guards, user-requested Pick on Page selection, element and freeform area overlays, Draft Annotation controls, visible-tab screenshot capture with explicit screenshot states, server-side OpenAI transcription controls, Diagnostics console/network capture, page-state notes, a compact local annotation queue with detail review/delete/reorder, batch send to Codex UI, and an optional ChatGPT Pro-control worker that can poll Codex UI tasks and return copied ChatGPT answers.

No build step is required for local development. The folder is designed to be loaded directly with Chrome's **Load unpacked** flow.

For a production install artifact, run:

```sh
pnpm run pack:browser-annotation
```

The command writes an unpacked production copy and zip archive under `dist/browser-annotation-extension/`. The production manifest keeps only the Codex UI/annotation server origins in `host_permissions`, requests normal page and ChatGPT access at runtime through `optional_host_permissions`, excludes `dev/` fixtures, keeps the default server URL at `https://codex-ui.todo-tg-app.ru`, and validates the artifact with `dev/validate-extension.mjs --production`.

Production extension link after packaging:

```text
https://codex-ui.todo-tg-app.ru/codex-ui-browser-annotation-0.1.1.zip
```

## Files

- `manifest.json` declares MV3, the service worker, side panel, action keyboard shortcut, `activeTab`/`alarms`/`clipboardRead`/`clipboardWrite`/`debugger`/`downloads`/`scripting`/`tabs`/`sidePanel` permissions, target host access for Codex UI/annotation server origins, narrow local development host access for `http://127.0.0.1/*` plus `http://localhost/*`, and optional runtime page access for normal `http(s)` sites plus `https://chatgpt.com/*`.
- `service-worker/service-worker.js` owns Annotation Panel messages, local settings, pairing-token to persistent-token binding, active-tab checks, action-click panel behavior, user-gesture Pick on Page injection, visible-tab capture, screenshot state creation, explicit `chrome.debugger` attach/detach for Diagnostics, local selected-element/page-state queue storage, inline audio transcription POSTs, queue mutation, annotation-batch POSTs, Pro-control polling, and foreground ChatGPT task execution.
- `sidepanel/` contains the load-unpacked tabbed side panel UI.
- `content/content-script.js` installs a Shadow DOM overlay, tracks hover/selected element boxes, lets the user drag a freeform rectangular area, records inline comments or short mic audio, and sends selected context plus audio transcription requests back to the service worker.
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
node --check extension/browser-annotation/dev/sidepanel-host-permission-smoke.cjs
node --check extension/browser-annotation/dev/content-draft-annotation-smoke.cjs
node --check extension/browser-annotation/dev/content-floating-panel-smoke.cjs
node --check extension/browser-annotation/dev/content-overlay-cancel-smoke.cjs
node extension/browser-annotation/dev/validate-extension.mjs
node extension/browser-annotation/dev/pairing-client-smoke.mjs
node extension/browser-annotation/dev/selection-context-smoke.mjs
node extension/browser-annotation/dev/annotation-queue-smoke.mjs
node extension/browser-annotation/dev/screenshot-crop-smoke.mjs
node extension/browser-annotation/dev/devtools-capture-smoke.mjs
node extension/browser-annotation/dev/devtools-fixture-smoke.mjs
node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs
node extension/browser-annotation/dev/sidepanel-host-permission-smoke.cjs
node extension/browser-annotation/dev/content-draft-annotation-smoke.cjs
node extension/browser-annotation/dev/content-floating-panel-smoke.cjs
node extension/browser-annotation/dev/content-overlay-cancel-smoke.cjs
```

## Manual Load-Unpacked Smoke Test

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open any normal `http(s)` page. For the included test page, serve the repository locally first, for example `python3 -m http.server 8899`, then open `http://127.0.0.1:8899/extension/browser-annotation/dev/test-page.html`.
5. Click the extension action, or press `Ctrl+Shift+Y`, to open the side panel and start annotation mode on the active page.
6. Keep the default server URL (`https://codex-ui.todo-tg-app.ru`) or enter `http://127.0.0.1:<port>` / `http://localhost:<port>` for local testing. Non-local `http://` server URLs are rejected so bearer tokens are not sent in cleartext.
7. Paste a Codex UI browser binding code from `Settings` > `Browser binding`. The extension exchanges it for a scoped persistent binding token, clears the pasted code, and keeps only the revocable extension token in local storage.
8. Click **Save and validate**.
9. Confirm the side panel shows **Connected** for an active token, **Disconnected** when no token is stored, and **Error** for invalid, expired, unreachable, or malformed status responses.
10. If annotation mode is not already active, click **Pick on Page** and approve Chrome's host access prompt for the current site when it appears.
11. Confirm the page shows a compact annotation panel and a blue hover box follows the button, input, and sample card.
12. Click the sample button, sample input, and sample card.
13. Confirm the selected element gets a green box with compact icon-only comment, mic, and close controls, and the side panel queue count/list updates.
14. Confirm each queue row includes a visible preview cropped to the selected element when Chrome grants visible-tab capture. On a DPR 2 display, a 120 CSS-pixel wide selected element should produce a 240 pixel wide stored preview unless it exceeds the preview cap.
15. If Chrome denies visible-tab capture, confirm the element remains recoverable and the row shows `Screenshot Failed` with an explicit recovery path instead of a neutral missing-preview state.
16. Open the extension service worker console and inspect `chrome.storage.local.get("browserAnnotation.annotationQueue")`. Confirm queued items either store `preview.dataUrl`, `preview.cropRect`, and `preview.devicePixelRatio`, or store a short `previewError`; no full-tab screenshot is stored.
17. Click the comment icon, type a distinct inline comment, and confirm the queue item is updated without a side-panel note textarea.
18. Drag a rectangle across an arbitrary page area and confirm it queues as a freeform selected area with a cropped preview.
19. Create three queued annotations, move the second row up, and delete the remaining third row from the compact queue.
20. Click the mic icon, speak a short Russian comment, stop recording, and confirm the transcript appears in that selected item's inline comment after the server transcription response returns.
21. Optional Diagnostics smoke: run `node extension/browser-annotation/dev/devtools-fixture-server.mjs`, open `http://127.0.0.1:8899/`, enable **Diagnostics**, click console/network fixture buttons, add a Page note without Pick on Page, and send it.
22. Click **Send Queue** with a valid connected binding and confirm the queue clears after the server accepts the batch. The batch request should be a POST to `/codex-api/extension/annotation-batch` with the persistent extension token as `Authorization: Bearer <token>`.
23. Inspect the upload and annotation-batch requests if available. Confirm ready screenshots are first uploaded to `/codex-api/extension/assets/upload` as multipart `kind=screenshot`, then the batch contains one top-level `page`, queued `items`, each item note, selector/rect/viewport context when an element or area was selected, uploaded screenshot assets referenced by `screenshotAssetId`, no `preview.dataUrl` or other screenshot data URL, and `devTools` only when Diagnostics capture was explicitly enabled.
24. Click the selected element close control and confirm the selected box disappears, the queued item is removed, and annotation mode remains ready for another selection.
25. Select another element, press Esc, and confirm the Draft Annotation is discarded, the overlay host disappears, and hover/click tracking stops until **Pick on Page** is clicked again.

## ChatGPT Pro-Control Manual Smoke Test

1. Start Codex UI with `pnpm run dev --host 127.0.0.1 --port 4173`.
2. Load `extension/browser-annotation` or the packaged zip in the Mac Chrome profile that is logged into ChatGPT Pro.
3. Pair Browser Binding from Codex UI, then open the sidepanel `ChatGPT Pro` section and click **Enable**.
4. Approve the `https://chatgpt.com/*` permission prompt. If denied, the section must show `Permission missing` and the worker must stay disabled.
5. Run `pnpm run pro:consult -- "Проверь текущую задачу и верни короткий ответ"` from the repository root.
6. Confirm the extension opens or focuses `chatgpt.com`, sends a prompt containing `[Codex Pro task: <taskId>]`, waits for the final answer, uses Copy response when possible, and posts the copied answer back to Codex UI.
7. Confirm `.codex/pro-control/consultations/<timestamp>/` contains `prompt.md`, `raw-pro-answer.md`, `codex-assessment.md`, `metadata.json`, and bundle/attachment directories when present.

## Packaging And Release Notes

- Development install: use Chrome **Load unpacked** with `extension/browser-annotation/`.
- Production artifact: run `pnpm run pack:browser-annotation` and distribute `dist/browser-annotation-extension/codex-ui-browser-annotation-0.1.1.zip`.
- Production server URL: `https://codex-ui.todo-tg-app.ru`.
- Public ingress: deploy `ops/nginx/annotate.todo-tg-app.ru.conf`, issue a TLS certificate for `annotate.todo-tg-app.ru`, and keep `/codex-api/extension/listen/start` blocked on the public annotation-only vhost.
- Future Chrome Web Store path: keep permanent production host permissions limited to Codex UI/annotation server origins, disclose runtime site access requests plus the `debugger`, `activeTab`, `tabs`, `scripting`, `sidePanel`, `storage`, and `alarms` permissions, and publish the zip contents after final manual acceptance.

Restricted pages such as `chrome://extensions`, `chrome-extension://...`, `file://...`, `devtools://...`, and `about:` pages should show a clear side-panel error instead of attempting injection.

Preview payloads are bounded by `MAX_SCREENSHOT_PREVIEW_EDGE_PX` and `MAX_SCREENSHOT_PREVIEW_DATA_URL_CHARS`. The service worker keeps the full visible-tab screenshot only in memory long enough to crop it, then stores only the cropped preview with the queue item. Preview capture is best-effort: if Chrome denies `captureVisibleTab`, the selected element context is still queued without a preview.

Annotation-batch payloads are capped before send by `MAX_ANNOTATION_BATCH_BYTES`. Ready local crop previews are uploaded as server-issued screenshot assets before send; the batch payload carries only asset metadata and the server-issued `/codex-local-image` reference, never the local `data:image` preview.

Diagnostics capture uses Chrome's debugger permission only after the user enables **Diagnostics** in the Annotation Panel. Capture stops on explicit disable, successful send, tab close, timeout, or debugger detach. Console and network rows are count- and byte-bounded; request and response bodies are metadata-only by default. The panel includes an explicit opt-in control for request/response bodies; captured text bodies are byte-capped and sensitive headers/body fields are redacted before they are stored or sent.

For pairing, DNS, nginx, active-tab permission, queue, Diagnostics, and voice recording problems, see `../../docs/browser-annotation-troubleshooting.md`.
