# GitHub Actions Hetzner Deploy

This repo deploys to Hetzner through a dedicated SSH key stored in GitHub
Actions secrets. Do not reuse a personal SSH key for this workflow.

## Required GitHub Secrets

- `CODEXUI_HETZNER_HOST`: Hetzner host or IP address.
- `CODEXUI_HETZNER_USER`: deploy user, currently `rnl1`.
- `CODEXUI_HETZNER_PORT`: optional SSH port. Omit to use `22`.
- `CODEXUI_HETZNER_SSH_KEY`: private key for the dedicated deploy key.

## Server Setup

Create a dedicated deploy key, store the private key in
`CODEXUI_HETZNER_SSH_KEY`, and install the public key on Hetzner with a forced
command:

```text
command="/home/rnl1/prog/codexUI/scripts/deploy-from-github.sh",no-agent-forwarding,no-X11-forwarding,no-port-forwarding,no-pty ssh-ed25519 <public-key> github-actions-codexui-deploy
```

The forced command means the key can trigger only the deploy script. The
workflow sends the exact commit SHA as the SSH command; the server validates
that this commit is reachable from `origin/main` before resetting the checkout.

If nginx serves static files from `/var/www/codexui-dist`, make that directory
writable by the deploy user instead of granting broad sudo:

```bash
sudo mkdir -p /var/www/codexui-dist
sudo chown -R rnl1:www-data /var/www/codexui-dist
sudo chmod -R u+rwX,g+rX /var/www/codexui-dist
```

## Deploy Flow

1. Run `CI` on the target branch or commit.
2. Run `Deploy Hetzner` manually from GitHub Actions.
3. The workflow installs dependencies with `pnpm install --frozen-lockfile`,
   runs tests, and SSHes to Hetzner with the selected commit SHA.
4. Hetzner runs `scripts/deploy-from-github.sh`, fetches `origin/main`, resets
   to the requested SHA, installs locked dependencies, rebuilds, syncs `dist/`
   when `CODEXUI_STATIC_DIST_DIR` is set, restarts `codexui`, and waits for a
   healthcheck.
