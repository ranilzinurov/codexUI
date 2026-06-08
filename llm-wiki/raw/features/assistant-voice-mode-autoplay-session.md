# Assistant Voice Mode Autoplay Session Source Notes

Date: 2026-06-08

Source facts:
- Chrome desktop can still block future voice-mode autoplay even when the user previously clicked `Mode`, because the actual audible `play()` happens after the assistant turn and TTS request complete.
- Site permissions for microphone or sound do not grant arbitrary audible autoplay; the relevant constraint is browser user activation.
- `Mode` should not speak the current assistant response. It should only enable future assistant-answer autoplay.
- Enabling `Mode` now starts a silent autoplay session immediately from the user click.
- After audible TTS playback ends, the playback composable returns to the silent primed source while voice mode remains enabled.
- `Stop` ends the autoplay session and clears pending playback.
- End-to-end coverage verifies that `Mode` does not request TTS for the current response, and that silent playback calls are present after enabling mode.

Implementation files:
- `src/composables/useVoicePlayback.ts`
- `src/components/content/ThreadConversation.vue`
- `scripts/e2e-voice-mode.cjs`
- `tests.md`
