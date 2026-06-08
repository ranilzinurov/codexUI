# Assistant Voice Mode Menu Controls Source Notes

Date: 2026-06-08

Source facts:
- Follow-up feedback rejected persistent/floating voice controls because they covered the chat/composer design.
- Voice controls should live inside the existing thread feature kebab menu alongside `Side` and `Listen`.
- The feature menu contains `Play voice`, `Voice mode`, `Stop voice`, a speed slider, status text, and `Resume audio` when browser/PWA playback is blocked.
- `Play voice` replays the latest completed assistant response.
- Default speech speed is `1`; stale persisted values below the OpenAI-supported minimum are treated as `1`.
- End-to-end coverage uses `scripts/e2e-voice-mode.cjs` to verify the menu controls, absence of old floating controls, default speed, speed snapping, `nova` voice request payloads, and light/dark rendering.
- Server regression coverage verifies TTS receives the shortened conversational summary instead of the full assistant response.

Implementation files:
- `src/App.vue`
- `src/components/content/ThreadConversation.vue`
- `src/server/voiceMode.test.ts`
- `src/style.css`
- `scripts/e2e-voice-mode.cjs`
- `tests.md`
