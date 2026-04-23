# Fix hosted mobile access without VPN

## Problem summary

Hosted `codex-webui` intermittently showed a white screen or endless loading on iPhone/Safari over mobile data when opened directly, while the same site worked through VPN/Tailscale.

The archive points to a **two-layer failure**:

1. **Reverse proxy regression on mobile networks**
   - the nginx setup removed or weakened the normal fast-path for mobile delivery (`http2`, sane keep-alive, gzip, efficient static handling),
   - logs show mobile `408` responses on `POST /codex-api/rpc` and repeated partial asset transfers,
   - the browser kept retrying startup and thread-loading requests.

2. **Wrong fallback semantics for hashed frontend assets**
   - `/assets/*` was being proxied through the Node SPA server,
   - when the asset path was wrong, stale, interrupted, or otherwise unresolved, the SPA fallback could return HTML instead of failing as a real static asset request,
   - on mobile Safari that easily degrades into a white screen because a `<script type="module">` request must never receive HTML.

## What this patch changes

### App-side resilience

This patch includes the following source changes:

- `src/api/codexRpcClient.ts`
  - retries `thread/list`, `thread/read`, and `thread/resume` on transient network failures,
  - retries on `408`, `425`, `429`, `500`, `502`, `503`, `504`,
  - retries malformed envelopes when the transport likely failed mid-flight.

- `src/server/codexAppServerBridge.ts`
  - sets an explicit `Content-Length` for JSON responses.

- `src/cli/index.ts`
  - adds explicit `--host` binding so reverse-proxied installs can stay on `127.0.0.1` while direct LAN/mobile installs still use `0.0.0.0`.
- `src/App.vue`
  - on mobile startup, expands the thread list drawer instead of force-navigating into a thread.

- `scripts/test-codexui-browser-startup-hardening.mjs`
  - updates the browser regression test to match the new mobile startup behavior.

### Hosted deployment fix

This patch also adds a deployable nginx vhost template under:
- `ops/nginx/codex.todo-tg-app.ru.conf`

This file is a concrete production example. Replace the `listen` address, `server_name`, log file paths, and certificate paths for your own environment.

Key deployment changes:

- serve `/assets/`, `/icons/`, `manifest.webmanifest`, `sw.js`, and Apple touch icons **directly from nginx**,
- keep only `/`, `/codex-api/`, and `/codex-api/ws` proxied to Node,
- restore a mobile-friendly transport profile:
  - `listen ... http2`
  - `keepalive_timeout 65`
  - `keepalive_requests 1000`
  - `gzip on`
  - `sendfile on`
- keep WebSocket proxying unbuffered,
- keep RPC proxying buffered and long-lived.

## Why the nginx change matters even if the app patch is merged

The source changes improve startup resilience, but they do **not** fix the critical hosted deployment problem by themselves.

If `/assets/*` still flows through the SPA server, any bad asset lookup can degrade into HTML fallback instead of a hard static-file response. The correct production behavior is:

- valid asset path -> `200` with JS/CSS content type,
- invalid asset path -> `404`,
- never HTML fallback for hashed asset URLs.

That is why nginx must terminate static asset URLs before they reach Node.

## Deploy steps

1. Merge this patch.
2. Build the frontend and CLI bundles.
3. Sync `dist/` into the nginx static root.
4. Install the nginx config.
5. Reload nginx.
6. Restart the service.

Example flow:

```bash
pnpm run build
sudo rsync -a --delete dist/ /var/www/codexui-dist/
sudo cp ops/nginx/codex.todo-tg-app.ru.conf /etc/nginx/sites-available/codex.todo-tg-app.ru
sudo ln -sfn /etc/nginx/sites-available/codex.todo-tg-app.ru /etc/nginx/sites-enabled/codex.todo-tg-app.ru
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl restart codexui
```

## Post-deploy verification

From the server or any machine that can reach the host:

```bash
curl -I https://codex.todo-tg-app.ru/
curl -I https://codex.todo-tg-app.ru/manifest.webmanifest
curl -I https://codex.todo-tg-app.ru/assets/<current-build-js-file>
curl -I https://codex.todo-tg-app.ru/assets/<current-build-css-file>
```

Expected:

- main shell: `200`
- manifest: `200` with manifest content type
- JS asset: `200` with JavaScript content type
- CSS asset: `200` with CSS content type

WebSocket probe (unauthenticated is fine):

```bash
curl -I https://codex.todo-tg-app.ru/codex-api/ws
```

Expected:

- `401` or `426`-style upgrade/auth response is acceptable,
- anything showing the route is alive is fine.

## Operational note

Keep the service behavior that syncs `dist/` into `/var/www/codexui-dist/` before startup. Without that sync, nginx may serve stale or missing hashed assets after a rebuild.
