# Codex UI Browser Annotation Extension

Manifest V3 MVP scaffold for browser annotation. This stage includes extension structure, locally stored server URL and pairing token, bearer-token validation against the Codex UI listen status endpoint, connected/disconnected/error side-panel state, restricted-page guards, user-requested overlay injection, element hover/selection overlays, and a local annotation queue.

No build step is required. The folder is designed to be loaded directly with Chrome's **Load unpacked** flow.

## Files

- `manifest.json` declares MV3, the service worker, side panel, `activeTab`/`scripting`/`tabs`/`sidePanel` permissions, target host access for `https://annotate.todo-tg-app.ru/*`, and narrow local development host access for `http://127.0.0.1/*` plus `http://localhost/*`.
- `service-worker/service-worker.js` owns side-panel messages, local settings, pairing-token validation, active-tab checks, action-click side-panel behavior, user-gesture content-script injection, and local selected-element queue storage.
- `sidepanel/` contains the load-unpacked side panel UI.
- `content/content-script.js` installs a Shadow DOM overlay, tracks hover/selected element boxes while annotation mode is active, and sends selected element context back to the service worker.
- `shared/` contains small globals, JSDoc contract typedefs, message names, storage keys, URL rules, pairing status helpers, selection-context helpers, and defaults used by the service worker, content script, and side panel.
- `dev/test-page.html` is a static page for manual overlay checks when served over local http.
- `dev/validate-extension.mjs` validates the manifest and required scaffold files with Node.

## Static Smoke Test

```sh
node --check extension/browser-annotation/shared/constants.js
node --check extension/browser-annotation/shared/url-utils.js
node --check extension/browser-annotation/shared/pairing-client.js
node --check extension/browser-annotation/shared/selection-context.js
node --check extension/browser-annotation/service-worker/service-worker.js
node --check extension/browser-annotation/content/content-script.js
node --check extension/browser-annotation/sidepanel/sidepanel.js
node --check extension/browser-annotation/dev/validate-extension.mjs
node --check extension/browser-annotation/dev/pairing-client-smoke.mjs
node --check extension/browser-annotation/dev/selection-context-smoke.mjs
node extension/browser-annotation/dev/validate-extension.mjs
node extension/browser-annotation/dev/pairing-client-smoke.mjs
node extension/browser-annotation/dev/selection-context-smoke.mjs
```

## Manual Load-Unpacked Smoke Test

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this folder.
4. Open any normal `http(s)` page. For the included test page, serve the repository locally first, for example `python3 -m http.server 8899`, then open `http://127.0.0.1:8899/extension/browser-annotation/dev/test-page.html`.
5. Click the extension action to open the side panel.
6. Keep the default server URL (`https://annotate.todo-tg-app.ru`) or enter `http://127.0.0.1:<port>` / `http://localhost:<port>` for local Codex UI testing.
7. Paste a Codex UI browser annotation pairing token. The token stays in extension local storage and is only sent as `Authorization: Bearer <token>` to `/codex-api/extension/listen/status`.
8. Click **Save and validate**.
9. Confirm the side panel shows **Connected** for an active token, **Disconnected** when no token is stored, and **Error** for invalid, expired, unreachable, or malformed status responses.
10. Click **Inject overlay**.
11. Confirm the page shows the "Codex annotation mode" panel and a blue hover box follows the button, input, and sample card.
12. Click the sample button, sample input, and sample card.
13. Confirm the selected element gets a green box, the overlay reports that the element was queued, and the side panel queue count/list updates.
14. Press Esc and confirm hover tracking stops until **Inject overlay** is clicked again.

Restricted pages such as `chrome://extensions`, `chrome-extension://...`, `file://...`, `devtools://...`, and `about:` pages should show a clear side-panel error instead of attempting injection.
