# Browser Annotation Troubleshooting

## Quick Checks

1. Confirm the extension is loaded from `extension/browser-annotation` or from the production artifact under `dist/browser-annotation-extension/`.
2. Confirm the side panel server URL matches the deployment:
   - local/dev: `http://127.0.0.1:4173`
   - temporary public HTTP smoke: `http://46.62.215.111` for page reachability only; do not pair or send tokens over non-local HTTP
   - production target: `https://codex-ui.todo-tg-app.ru`
3. Confirm the pairing token is fresh and belongs to the thread you want to receive annotations.
4. Open a normal `http(s)` page. Chrome blocks extension injection on `chrome://`, `chrome-extension://`, `file://`, `devtools://`, `about:`, and Chrome Web Store pages.

## Pairing Fails

- `Disconnected` with no detail usually means no token is saved yet.
- `Invalid or expired extension bearer token` means the token expired, was revoked, or belongs to another active listener session. Start a new listener from Codex UI and paste the new token.
- A network error usually means the server URL is wrong, DNS is not propagated, nginx is not proxying `/codex-api/extension/`, or HTTPS is not configured.
- For production, verify:
  - `dig +short annotate.todo-tg-app.ru A @8.8.8.8`
  - `curl -I https://annotate.todo-tg-app.ru/codex-api/extension/listen/status`

## Page Opens Blank Or Returns 403/404

- If `annotate.todo-tg-app.ru` resolves to `45.155.204.47`, DNS is still using the wildcard. Add or wait for the explicit `A 46.62.215.111` record.
- If HTTP by IP works but hostname returns Vite `403 Forbidden`, add the hostname to `server.allowedHosts` or make nginx pass `Host: 127.0.0.1:4173` to the Vite upstream.
- If nginx returns a default `404`, the `server_name` block is not enabled, DNS points at the wrong machine, or another default server is catching the request.
- If HTTPS returns `404` or certificate errors, certbot/nginx HTTPS setup for `annotate.todo-tg-app.ru` is not complete.

## Unable To Queue Selected Element

The toast `Unable to queue selected element. Either the '<all_urls>' or 'activeTab' permission is required.` usually means Chrome did not grant the current tab capture/script permission.

Try:

1. Click `Inject overlay` from the side panel after the tab is active.
2. Approve Chrome's site access prompt for the current `http(s)` site if it appears.
3. Test on a normal `http(s)` page, not a restricted Chrome/internal page.
4. Reload the extension from `chrome://extensions` if permissions changed after installing a new build.

The production artifact intentionally keeps only Codex UI/annotation server origins as permanent host permissions for server calls. Page access for arbitrary sites comes from runtime optional host permissions after the user clicks `Inject overlay` and approves Chrome's prompt. Non-local `http://` server URLs are rejected; use HTTPS for public ingress or `http://127.0.0.1` / `http://localhost` for local development only.

## Queue Is Empty Or Preview Is Missing

- The overlay only queues after you click a highlighted element while annotation mode is active.
- Pressing `Esc` pauses annotation mode; click `Inject overlay` again.
- Screenshot previews are best-effort. If Chrome denies visible-tab capture, the element context still queues with `No preview`.
- Queue storage is capped. Very large previews may be dropped or older items trimmed to keep extension storage bounded.

## DevTools Capture Issues

- DevTools capture starts only after clicking `Enable DevTools capture`.
- Chrome may show a warning that the extension is debugging the page; this is expected while capture is active.
- Capture stops on explicit disable, successful send, tab close, timeout, or debugger detach.
- Request/response bodies are not captured unless `Capture request and response bodies` is enabled. Even then, only bounded textual failed/error responses are captured.
- If another debugger is attached to the tab, Chrome may detach this extension. Disable the other debugger and re-enable capture.

## Voice And Transcription Issues

- Chrome must grant microphone permission to the extension side panel.
- Send is disabled while recording, uploading, or transcribing so a batch cannot be sent with half-written voice metadata.
- If transcription is not configured on the server, the voice note can still be sent with a failed transcription status and uploaded audio metadata.
- Raw audio blobs, chunks, base64, and data URLs should never appear in queue storage or batch JSON.

## Public HTTPS Deployment

- DNS is managed in the YC zone `todo-tg-app-ru`.
- `annotate.todo-tg-app.ru` should have an explicit `A 46.62.215.111` record; do not rely on the wildcard.
- The repo template is `ops/nginx/annotate.todo-tg-app.ru.conf`.
- The current server pattern uses filesystem Let's Encrypt certificates under `/etc/letsencrypt/live/<host>/`.
- Final HTTPS setup requires root access for certbot, nginx config install, `nginx -t`, and reload.
