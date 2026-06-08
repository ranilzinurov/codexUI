# Assistant Voice Mode Web Audio Session Source Notes

Date: 2026-06-08

Source facts:
- The HTML audio-element keep-alive path can still appear as paused in Chrome/iOS UI and does not reliably behave like a continuous voice-call session.
- The primary playback path now uses Web Audio API: a user gesture opens/resumes an `AudioContext`, starts a very low-gain oscillator keep-alive, decodes TTS blobs, and plays them as `AudioBufferSourceNode`s.
- The HTML audio element remains only as a fallback when Web Audio is unavailable or decoding fails.
- While `Mode` is enabled, the keep-alive Web Audio session is restored after each spoken response.
- The blocked status copy is browser-generic (`Audio paused by browser`) rather than iOS-specific.
- End-to-end coverage instruments `AudioContext`, verifies Web Audio buffer playback, verifies `Mode` keep-alive oscillator starts, and verifies no TTS request is made merely by toggling `Mode`.

Implementation files:
- `src/composables/useVoicePlayback.ts`
- `src/components/content/ThreadConversation.vue`
- `scripts/e2e-voice-mode.cjs`
- `tests.md`
