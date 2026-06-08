# Assistant Voice Mode

Assistant voice mode makes completed assistant responses playable as short spoken audio while preserving the full written answer in the thread. Source notes: [assistant-voice-mode.md](../../raw/features/assistant-voice-mode.md), [assistant-voice-mode-menu-controls.md](../../raw/features/assistant-voice-mode-menu-controls.md), [assistant-voice-mode-audio-prime.md](../../raw/features/assistant-voice-mode-audio-prime.md).

## Behavior

- Only assistant responses are voice-playable in v1.
- `Play` in the thread feature menu replays the latest completed assistant response.
- `Mode` enables autoplay for future completed assistant responses after a user tap.
- Autoplay waits until the assistant turn is complete; live/streaming responses are not spoken early.
- `Stop` disables autoplay and stops current playback.
- The speed slider lives in the same feature menu, defaults to `1`, and uses snap marks at `1`, `1.25`, `1.5`, and `2`.
- Voice controls are intentionally hidden in the kebab menu so they do not cover the composer or thread content.

## Server Path

`POST /codex-api/voice/speech` receives assistant text, thread id, speed, and voice. The route creates a conversational summary through an ephemeral app-server fork when possible, falls back to deterministic markdown/code cleanup if summary generation fails, then sends the summary to OpenAI TTS.

TTS is server-side only so browser clients never receive an OpenAI API key. The default model is `gpt-4o-mini-tts`, fixed voice is `nova`, and output defaults to MP3.

## PWA Edge Cases

iOS PWA audio playback can reject asynchronous autoplay even after voice mode was enabled. Explicit `Play` primes the audio element before the TTS fetch, while blocked autoplay shows `Resume` in the feature menu. Tapping it retries the queued audio with a fresh user gesture.

## Persistence

Voice mode enabled state and speed are stored in localStorage:

- `codex-web-local.voice-mode-enabled.v1`
- `codex-web-local.voice-speed.v1`

The conversational summary is not persisted in the thread.
