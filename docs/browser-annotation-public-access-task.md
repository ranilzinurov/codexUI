# Browser Annotation Public Access Task

## Goal

Make the browser annotation manual test page and extension API reachable from an external computer.

The user is trying to open the test page from their local Mac/Chrome, not from this server. The current symptom is a blank/new-tab page or no visible response when opening URLs with non-standard ports.

## Current Repository/Branch

- Repository: `/home/rnl1/prog/codexUI`
- Branch: `browser-annotation-devtools`
- Relevant plan: `docs/browser-annotation-devtools-plan.md`
- Static test page added in commit `ad67a26`:
  - `public/browser-annotation-test.html`

## Current Running Services

On the server:

- Codex UI/Vite dev server:
  - URL inside host: `http://127.0.0.1:4173`
  - Bound externally: `0.0.0.0:4173`
  - Command that was used: `pnpm run dev --host 0.0.0.0 --port 4173`
  - Do not stop the persistent tmux-managed server on port `5173`.

- Temporary Python static server:
  - URL inside host: `http://127.0.0.1:8899`
  - Bound externally: `0.0.0.0:8899`
  - Command that was used: `python3 -m http.server 8899 --bind 0.0.0.0`
  - Can be stopped after public access is solved through Nginx or security group.

- Nginx:
  - Active on ports `80` and `443`.
  - `http://46.62.215.111/` is reachable externally but returns `404`.
  - Existing default server serves `/var/www/html` and does not proxy to Codex UI.

## Evidence Collected

Local checks from the server succeed:

```bash
curl -I http://127.0.0.1:4173/browser-annotation-test.html
curl -I http://46.62.215.111:4173/browser-annotation-test.html
curl -I http://46.62.215.111:8899/public/browser-annotation-test.html
```

The page body contains:

```html
<h1>Codex annotation extension test page</h1>
```

External checks via `check-host.net` show:

- `46.62.215.111:4173` times out from multiple external nodes.
- `46.62.215.111:8899` times out from most external nodes.
- `46.62.215.111:80` connects externally and returns Nginx `404`.

Conclusion: the app works locally, but external access to non-standard ports is blocked or unreliable. Port `80` is the best public path.

## Desired Public URLs

Make these work from the user's local computer after HTTPS deployment:

```text
https://annotate.todo-tg-app.ru/browser-annotation-test.html
https://annotate.todo-tg-app.ru/codex-api/extension/listen/status
```

The extension side panel should use:

```text
Server URL: https://annotate.todo-tg-app.ru
```

`/codex-api/extension/listen/start` must remain blocked on the public annotation-only ingress; pairing tokens are minted from authenticated Codex UI, then pasted into the extension.

The test page should display the heading:

```text
Codex annotation extension test page
```

## Preferred Fix: Nginx Reverse Proxy On Port 80

Create an Nginx config that proxies only the manual test page and extension API to the existing Vite server on `127.0.0.1:4173`. For production-style pairing, use the checked-in HTTPS template at `ops/nginx/annotate.todo-tg-app.ru.conf`; the plain HTTP snippet below is only a temporary reachability diagnostic and must not be used for sending pairing tokens.

Suggested config:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name 46.62.215.111 annotate.todo-tg-app.ru;

    client_max_body_size 50m;

    location /browser-annotation-test.html {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }

    location /codex-api/extension/ {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }

    location / {
        return 404;
    }
}
```

Example commands:

```bash
sudo tee /etc/nginx/conf.d/codex-annotation-dev.conf >/dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name 46.62.215.111 annotate.todo-tg-app.ru;

    client_max_body_size 50m;

    location /browser-annotation-test.html {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }

    location /codex-api/extension/ {
        proxy_pass http://127.0.0.1:4173;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }

    location / {
        return 404;
    }
}
EOF

sudo nginx -t
sudo systemctl reload nginx
```

If another default server captures `46.62.215.111`, inspect:

```bash
sudo nginx -T | less
ls -la /etc/nginx/sites-enabled /etc/nginx/conf.d
```

Then either make this server block the `default_server` for port `80`, or add the proxy locations to the currently active default server.

## Alternative Fix: Open Cloud Firewall/Security Group

If you prefer opening non-standard ports instead of Nginx proxying:

- Allow inbound TCP `4173` from the user's IP or from `0.0.0.0/0` temporarily.
- Allow inbound TCP `8899` only if the Python static server path is still needed.

The `yc` CLI exists at `/usr/local/bin/yc`, but the currently configured folder did not list compute instances/security groups from this shell. It may be using the wrong cloud/folder context or insufficient credentials.

Useful commands:

```bash
yc config list
yc resource-manager folder list
yc compute instance list --format json
yc vpc security-group list --format json
yc vpc network list --format json
```

Yandex Cloud docs command pattern for attaching security groups:

```bash
yc compute instance update-network-interface \
  --id <instance-id> \
  --network-interface-index 0 \
  --security-group-id <security-group-id>
```

But for this task, Nginx on port `80` is preferred because port `80` is already reachable externally.

## Verification

Run these from the server first:

```bash
curl -I http://127.0.0.1:4173/browser-annotation-test.html
curl -I http://46.62.215.111/browser-annotation-test.html
curl -s http://46.62.215.111/browser-annotation-test.html | grep 'Codex annotation extension test page'
```

Then verify from an external network. For example:

```bash
curl -sS -H 'Accept: application/json' \
  'https://check-host.net/check-http?host=http://46.62.215.111/browser-annotation-test.html&max_nodes=6'
```

Fetch the `request_id` from the response and then:

```bash
curl -sS -H 'Accept: application/json' \
  'https://check-host.net/check-result/<request_id>'
```

Expected external result:

- HTTP status `200`.
- Body includes `Codex annotation extension test page`.

## Pairing Token After Access Works

After the public URL works, generate a fresh token:

```bash
curl -s -X POST http://127.0.0.1:4173/codex-api/extension/listen/start \
  -H 'Content-Type: application/json' \
  --data '{"threadId":"phase2-manual-extension-smoke"}'
```

Give the user:

```text
Test page: http://46.62.215.111/browser-annotation-test.html
Server URL: https://annotate.todo-tg-app.ru
Pairing token: <pairingToken from response>
```

## Notes

- The extension rejects non-local `http://` server URLs so pairing tokens are not sent in cleartext. Use the IP URL only to verify public page reachability, not as the extension server URL.
- If the user installed an older zip, they may need to reload or reinstall the unpacked extension.
- The current server shell lacks passwordless sudo, so previous automated Nginx config attempt failed with:

```text
sudo: a terminal is required to read the password
sudo: a password is required
```
