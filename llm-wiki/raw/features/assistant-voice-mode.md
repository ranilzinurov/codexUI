# Assistant Voice Mode Source Notes

Date: 2026-06-08

Source facts:
- User wanted a walking-friendly voice mode for Codex UI where full assistant text remains in the thread, but spoken audio uses a shorter conversational version.
- Voice mode initially speaks assistant responses only; system/status messages are excluded.
- A per-response `Play` action should replay the voice response. A voice mode toggle should autoplay future assistant answers after the user taps to enable it.
- iOS PWA autoplay can be blocked after asynchronous work, so the UI needs a large `Tap to resume audio` recovery button.
- Speed control should be a button that opens a slider. Slider marks are `1`, `1.25`, `1.5`, and `2`, with magnetic snapping near marks and intermediate values allowed.
- Code, diffs, logs, and command output should be summarized conversationally rather than read verbatim.
- TTS uses OpenAI `gpt-4o-mini-tts` with fixed `nova` voice for v1. The UI/data shape should remain ready for future voice selection.
- The implementation adds server-side `/codex-api/voice/speech`, client voice playback helpers, assistant toolbar `Play`, a conversation voice strip, local speed/mode persistence, and `tests.md` manual verification.

Implementation files:
- `src/server/voiceMode.ts`
- `src/server/codexAppServerBridge.ts`
- `src/server/voiceMode.test.ts`
- `src/api/voiceMode.ts`
- `src/composables/useVoicePlayback.ts`
- `src/components/content/ThreadConversation.vue`
- `src/components/icons/IconTablerPlayerPlayFilled.vue`
- `src/style.css`
- `tests.md`
