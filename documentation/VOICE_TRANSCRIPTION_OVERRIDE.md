# Voice Transcription Override

`codexui` normally tries to use the Codex/ChatGPT auth token for `/codex-api/transcribe`.
If that token is unavailable, the server can optionally use a separate STT provider without changing the main Codex model provider.

This is intended as a temporary, easy-to-revert patch.

## What It Does

- leaves the main Codex app-server provider unchanged
- uses a separate server-side transcription provider only for voice input
- keeps secrets on the server side only

## Supported Env Vars

- `CODEXUI_TRANSCRIBE_API_KEY`
- `CODEXUI_TRANSCRIBE_BASE_URL`
- `CODEXUI_TRANSCRIBE_MODEL`
- `CODEXUI_TRANSCRIBE_LANGUAGE`

If `CODEXUI_TRANSCRIBE_API_KEY` is not set, `codexui` falls back to `OPENAI_API_KEY`.

## Example: Groq STT

If you already have a Groq STT env file from another setup, map it into the `CODEXUI_TRANSCRIBE_*` variables when starting `codexui`.

Example:

```bash
set -a
. ~/.config/opencode/voice.env
set +a

export CODEXUI_TRANSCRIBE_API_KEY="$GROQ_API_KEY"
export CODEXUI_TRANSCRIBE_BASE_URL="https://api.groq.com/openai/v1"
export CODEXUI_TRANSCRIBE_MODEL="${GROQ_STT_MODEL:-whisper-large-v3-turbo}"
export CODEXUI_TRANSCRIBE_LANGUAGE="${GROQ_STT_LANGUAGE:-ru}"

node dist-cli/index.js --port 5900 --no-open --no-tunnel --no-login
```

This keeps the Groq key out of the repo and out of browser code.

## Disable / Revert

Restart `codexui` without the `CODEXUI_TRANSCRIBE_*` environment variables.

That returns voice transcription to the default behavior immediately.

## Safety Notes

- Do not commit `.env` or `voice.env` files with real secrets.
- Do not put provider keys into frontend code.
- Prefer loading secrets from a local env file or systemd `EnvironmentFile=`.
