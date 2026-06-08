# Assistant Voice Mode Audio Prime Source Notes

Date: 2026-06-08

Source facts:
- Follow-up feedback reported that voice controls rendered but playback stayed blocked with `Audio paused by iOS`.
- Browser user activation can be lost while waiting for the asynchronous TTS request to return audio.
- Explicit `Play` now primes the shared audio element immediately with a silent looping WAV source, then replaces it with the TTS blob when the request completes.
- Autoplay after a completed assistant turn can still be blocked by browser policy and then exposes `Resume` for a fresh user gesture.
- The thread feature menu now uses compact labels: `Play`, `Mode`, `Resume`, and `Stop`.
- The light-theme open/active kebab trigger uses a subtle gray state instead of a black filled button.
- End-to-end coverage verifies compact labels, absence of old long voice labels, default speed `1`, speed snapping, pre-TTS audio priming, `nova` request payloads, and light/dark rendering.

Implementation files:
- `src/composables/useVoicePlayback.ts`
- `src/App.vue`
- `src/components/content/ThreadConversation.vue`
- `src/style.css`
- `scripts/e2e-voice-mode.cjs`
- `tests.md`
