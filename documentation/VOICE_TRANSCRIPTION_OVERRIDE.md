# Voice Transcription Setup

`codexui` normally tries to use the Codex/ChatGPT auth token for `/codex-api/transcribe`.
If that token is unavailable, the server can optionally use a separate STT provider without changing the main Codex model provider.

Use this file when voice input stops working after changing Codex auth mode, API keys, or server deployment settings.

## Which Mode To Use

### Standard Codex/ChatGPT transcription

Use this when Codex on the server is logged in with ChatGPT account auth:

```bash
codex login
```

The important signal is that `~/.codex/auth.json` contains `tokens.access_token`. You can check the shape without printing secrets:

```bash
node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(process.env.HOME+"/.codex/auth.json","utf8")); console.log({auth_mode:j.auth_mode, hasTokens:Boolean(j.tokens), hasAccessToken:Boolean(j.tokens&&j.tokens.access_token)})'
```

For this mode, set:

```bash
CODEXUI_TRANSCRIBE_PROVIDER=standard
```

`standard` bypasses the API-key transcription override even if `OPENAI_API_KEY`, `GROQ_API_KEY`, or `CODEXUI_TRANSCRIBE_API_KEY` are still present in the environment.

On headless servers, `chatgpt.com/backend-api/transcribe` may reject plain Node HTTP requests with a Cloudflare challenge. `codexui` falls back to `curl-impersonate-chrome` for that case. Make sure the service can find it:

```bash
command -v curl-impersonate-chrome
```

On the current Hetzner deployment, it is installed for the `rnl1` user at:

```bash
/home/rnl1/.local/bin/curl-impersonate-chrome
```

and the service env includes:

```bash
PATH=/home/rnl1/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/snap/bin
```

### API-key STT override

Use this when Codex is logged in with API-key auth only, or when you deliberately want voice transcription to use a separate OpenAI/Groq STT key. API-key auth usually creates an `auth.json` without `tokens.access_token`, which means the standard ChatGPT transcription path cannot authenticate.

## What It Does

- leaves the main Codex app-server provider unchanged
- uses either the standard ChatGPT transcription path or a separate server-side transcription provider only for voice input
- keeps secrets on the server side only

## Supported Env Vars

- `CODEXUI_TRANSCRIBE_API_KEY`
- `CODEXUI_TRANSCRIBE_PROVIDER` (`standard`, `auto`, `openai`, or `groq`; `chatgpt` is accepted as an alias for `standard`)
- `CODEXUI_TRANSCRIBE_BASE_URL`
- `CODEXUI_TRANSCRIBE_MODEL`
- `CODEXUI_TRANSCRIBE_LANGUAGE`

If `CODEXUI_TRANSCRIBE_API_KEY` is not set, `codexui` falls back to `OPENAI_API_KEY`.
In that fallback mode, `CODEXUI_TRANSCRIBE_BASE_URL` and `CODEXUI_TRANSCRIBE_LANGUAGE` are ignored, so they cannot accidentally override the default OpenAI transcription path.

`CODEXUI_TRANSCRIBE_PROVIDER` defaults to `auto`.
In `auto` mode, an existing `GROQ_API_KEY` keeps the Groq STT path active unless `CODEXUI_TRANSCRIBE_API_KEY` is set.
Set `CODEXUI_TRANSCRIBE_PROVIDER=openai` to force OpenAI transcription while leaving Groq environment variables in place.
Set `CODEXUI_TRANSCRIBE_PROVIDER=standard` to force the built-in Codex/ChatGPT transcription path and ignore STT provider keys.

For OpenAI transcription, the default model is `whisper-1`.
Override with `CODEXUI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe` if you want the lower-priced OpenAI transcription model later.

## Current Hetzner Deployment

Server:

```bash
rnl1@46.62.215.111
```

Project:

```bash
/home/rnl1/prog/codexUI
```

Service:

```bash
codexui.service
```

Service environment file:

```bash
/home/rnl1/.config/codexui/env
```

Current voice-input mode:

```bash
CODEXUI_TRANSCRIBE_PROVIDER=standard
```

Codex auth file:

```bash
/home/rnl1/.codex/auth.json
```

Installed `curl-impersonate-chrome` helper:

```bash
/home/rnl1/.local/bin/curl-impersonate-chrome
```

Restart after changing auth/env:

```bash
cd ~/prog/codexUI
bash scripts/restart-codexui-service.sh --follow
```

Smoke-test transcription from the server:

```bash
cd ~/prog/codexUI
curl -sS --max-time 60 \
  -F "file=@test/fixtures/hello.wav;type=audio/wav" \
  http://127.0.0.1:5900/codex-api/transcribe
```

## Example: OpenAI STT while keeping Groq env vars

```bash
export OPENAI_API_KEY="..."
export CODEXUI_TRANSCRIBE_PROVIDER="openai"

node dist-cli/index.js --port 5900 --no-open --no-tunnel --no-login
```

Optional explicit model:

```bash
export CODEXUI_TRANSCRIBE_MODEL="gpt-4o-mini-transcribe"
```

## Example: Groq STT

If you already have a Groq STT env file from another setup, map it into the `CODEXUI_TRANSCRIBE_*` variables when starting `codexui`.

Example:

```bash
set -a
. ~/.config/opencode/voice.env
set +a

export CODEXUI_TRANSCRIBE_API_KEY="$GROQ_API_KEY"
export CODEXUI_TRANSCRIBE_PROVIDER="groq"
export CODEXUI_TRANSCRIBE_BASE_URL="https://api.groq.com/openai/v1"
export CODEXUI_TRANSCRIBE_MODEL="${GROQ_STT_MODEL:-whisper-large-v3-turbo}"
export CODEXUI_TRANSCRIBE_LANGUAGE="${GROQ_STT_LANGUAGE:-ru}"

node dist-cli/index.js --port 5900 --no-open --no-tunnel --no-login
```

This keeps the Groq key out of the repo and out of browser code.

## Disable / Revert

For the standard path, set:

```bash
CODEXUI_TRANSCRIBE_PROVIDER=standard
```

For API-key STT, set `CODEXUI_TRANSCRIBE_PROVIDER=openai` or `CODEXUI_TRANSCRIBE_PROVIDER=groq` and provide the matching key.

Restart `codexui` after changing the environment.

## Safety Notes

- Do not commit `.env` or `voice.env` files with real secrets.
- Do not put provider keys into frontend code.
- Prefer loading secrets from a local env file or systemd `EnvironmentFile=`.
- Back up `/home/rnl1/.codex/auth.json` before switching between API-key auth and ChatGPT login.
