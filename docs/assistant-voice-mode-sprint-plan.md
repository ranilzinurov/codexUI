# Assistant Voice Mode Sprint Plan

## Goal

Deliver the next stable increment for assistant voice mode: restore the removed TTS foundation, reshape it for the user's iOS walking workflow, add server-side voice answer jobs with temporary caching and Telegram fallback, and prepare the Capacitor/iOS native audio layer needed for locked-screen playback.

Target user flow:

1. User records dictation while the iPhone is unlocked.
2. Existing STT flow transcribes and sends text to the Codex thread.
3. User locks the phone and puts it away.
4. Backend waits for the Codex answer.
5. Backend rewrites the answer into short Russian spoken language.
6. Backend generates TTS audio.
7. iOS app tries to autoplay the audio in AirPods.
8. If autoplay/background playback fails, Telegram fallback tells the user that the answer is ready.

## Current Context

- The repo already has a Vue/Vite frontend, Node/Express backend bridge, `codex app-server` integration, Telegram bridge, web push support, dictation, and a Capacitor iOS shell.
- iOS shell documentation lives in `docs/ios-sideload.md` and `docs/ios-capacitor-shell-plan.md`.
- The existing iOS native plugin `CodexAudioSessionPlugin` prepares `AVAudioSession` for dictation, but it is not yet a full background voice session.
- Composer dictation already stores recordings and background transcription jobs in IndexedDB.
- Telegram bridge already supports bot token configuration, allowlisted user IDs, remembered chat IDs, and outbound assistant replies.
- Assistant voice/TTS code was previously implemented and then intentionally reverted:
  - `2f6320c Add assistant voice mode playback`
  - `c318162 Move voice controls into thread feature menu`
  - `09c958c Fix voice menu playback activation`
  - `90a35f9 Keep voice mode autoplay session primed`
  - `ad21b49 Use Web Audio session for voice mode`
  - reverted by `754d1ed`, `b414172`, `d8213fe`, `c8cb6c8`, `af56c74`
- `tests.md` currently contains `Assistant Voice/TTS Removal`; this sprint must replace or supersede that test section once TTS is restored.

## Scope

- Restore useful parts of the old TTS implementation from git history, but do not blindly revert the removal.
- Add a server-side voice-answer pipeline:
  - observe or request the latest completed assistant answer;
  - summarize/rewrite for spoken Russian;
  - generate TTS audio;
  - cache audio temporarily;
  - expose status/audio endpoints.
- Add voice mode settings:
  - enable/disable voice mode;
  - autoplay mode;
  - voice profile: Economy, Medium, Forte;
  - TTS voice selection with default `nova`;
  - playback speed;
  - Telegram fallback toggle/status.
- Reuse existing server secrets only from env/config:
  - prefer `CODEXUI_VOICE_TTS_API_KEY`;
  - fall back to `CODEXUI_TRANSCRIBE_API_KEY`;
  - fall back to `OPENAI_API_KEY`;
  - never commit real tokens or env values.
- Add Telegram fallback for "voice answer ready" when iOS autoplay cannot be trusted.
- Prepare iOS native APIs for:
  - background voice wait session;
  - silent keepalive while waiting;
  - playback session;
  - built-in iPhone microphone preference;
  - AirPods media command mapping for playback pause/resume first, recording control later as experimental.
- Update docs and manual tests for web, backend, iOS, and Telegram behavior.

## Explicit Non-Scope

- Full Swift rewrite of Codex UI.
- App Store/TestFlight distribution.
- Paid Apple Developer Program/APNs setup.
- True always-listening realtime voice assistant.
- Recording while the screen is locked.
- Reliable Volume Down push-to-talk; public iOS APIs do not make this a safe primary control.
- Guaranteed locked-screen autoplay on every iOS route/device without physical iPhone validation.
- Permanent storage of generated TTS audio.

## Assumptions

- Backend remains hosted remotely and reachable from the iOS shell through the configured remote backend URL.
- User will compile and sideload on a Mac with Xcode after repository changes are ready.
- Physical iPhone/AirPods validation is not available in this Linux workspace.
- Telegram fallback can use the existing Telegram bridge after the user has sent `/start` or `/whoami` to the bot.
- TTS and summary model access are available through existing server OpenAI-compatible credentials.

## Main Risks

- iOS may suspend the WebView while the phone is locked unless native background audio is active.
- A silent keepalive may be needed, but it has battery and App Review tradeoffs.
- AirPods media commands are media remote commands, not arbitrary hardware button events.
- `setPreferredInput(.builtInMic)` is a request to iOS, not an absolute guarantee when AirPods are connected.
- Voice-answer polling can duplicate work or generate stale audio if thread state changes during long Codex runs.
- TTS/audio endpoints can leak sensitive assistant output if auth/caching boundaries are weak.
- Secrets were discussed out of band; this sprint must keep all real tokens outside git.

## Phase 0: Baseline, Recovery, And Design Lock

### Goal

Recover the old voice implementation as reference material and lock the new implementation shape before editing runtime code.

### Key Tasks

- Inspect old voice commits and identify reusable files/functions.
- Compare old UI placement with current `App.vue`/thread menu patterns.
- Map server insertion points in `codexAppServerBridge.ts` and `httpServer.ts`.
- Map dictation completion paths so voice jobs can attach to sent voice-input turns without disrupting existing dictation.
- Confirm Telegram bridge functions needed for fallback.
- Write a short work log entry with chosen implementation path.

### Atomic Steps

1. Diff old commits against current `main`.
2. List candidate files to restore or rewrite.
3. Decide endpoint shape:
   - `POST /codex-api/voice/jobs`
   - `GET /codex-api/voice/jobs/:id`
   - `GET /codex-api/voice/jobs/:id/audio`
   - optional `POST /codex-api/voice/speech` compatibility endpoint.
4. Decide cache location and TTL.
5. Decide summary profile defaults.

### Acceptance Criteria

- The implementation path is documented in this file's work log.
- No runtime code has been changed without a clear phase target.
- Old TTS code is treated as reference, not blindly restored.

### Verification

- `git diff --stat`
- `git show --stat` for old voice commits
- Confirm no secrets in staged changes.

## Phase 1: Restore Server TTS Foundation

### Goal

Reintroduce a safe, tested server-side TTS route based on the old implementation, with improved secret handling and bounded input/output behavior.

### Key Tasks

- Add `src/server/voiceMode.ts` or split into smaller server modules if cleaner.
- Add request validation, text caps, format caps, and error sanitization.
- Support TTS key resolution order:
  1. `CODEXUI_VOICE_TTS_API_KEY`
  2. `CODEXUI_TRANSCRIBE_API_KEY`
  3. `OPENAI_API_KEY`
- Default TTS model to the current configured lightweight OpenAI TTS model, initially `gpt-4o-mini-tts` unless docs/runtime access requires a different model.
- Default voice to `nova`.
- Preserve local deterministic markdown/code stripping fallback for tests.

### Atomic Steps

1. Restore a minimal `POST /codex-api/voice/speech` handler.
2. Wire the route into the existing backend route dispatcher.
3. Add focused Vitest coverage for:
   - valid TTS request;
   - missing text;
   - unsupported voice/format;
   - missing API key;
   - provider error sanitization;
   - fallback key resolution.
4. Run focused tests.

### Acceptance Criteria

- Server can return binary TTS audio for sanitized text.
- No raw API key or provider error details are returned to the browser.
- The route is authenticated by the existing Codex UI auth boundary.
- Tests cover validation and provider call shape.

### Verification

- `pnpm exec vitest run src/server/voiceMode.test.ts --reporter=verbose`
- `pnpm exec vue-tsc --noEmit`
- Manual `curl` against local dev server with a mocked or configured provider when safe.

## Phase 2: Voice Answer Job Pipeline

### Goal

Move from "play this message now" to an asynchronous voice answer job that can wait for a Codex response, summarize it, generate audio, cache it, and report status.

### Key Tasks

- Add a voice job manager on the server.
- Track job state:
  - `queued`
  - `waiting_for_answer`
  - `summarizing`
  - `synthesizing`
  - `ready`
  - `failed`
  - `expired`
- Poll or subscribe to thread updates through existing app-server bridge notification paths.
- Extract latest completed assistant text for the target thread.
- Summarize in Russian using profile-specific model settings.
- Generate TTS audio and store it in a bounded temporary cache.
- Avoid duplicate jobs for the same thread/turn/profile unless explicitly requested.

### Atomic Steps

1. Define `VoiceAnswerJob` types and normalizers.
2. Implement an in-memory job store with TTL and bounded max jobs.
3. Add temporary audio storage under OS temp or existing upload temp conventions.
4. Add create/status/audio endpoints.
5. Implement latest-assistant extraction tests using realistic thread payloads.
6. Implement job state transition tests with mocked app-server and mocked TTS provider.

### Acceptance Criteria

- A job created while Codex is still running waits until a completed assistant answer exists.
- A job created after completion immediately summarizes/synthesizes.
- Audio cache expires and cannot be read indefinitely.
- Duplicate request behavior is deterministic.
- Failures are visible without leaking secrets.

### Verification

- Focused server tests for job manager and route.
- `pnpm run test:unit` once the phase is integrated.
- Code-path performance audit:
  - bounded polling;
  - bounded payload sizes;
  - no unbounded fanout;
  - cache cleanup behavior.

## Phase 3: Frontend Voice Mode UI And Playback

### Goal

Restore voice controls in the current UI using existing menu/composer patterns, without reintroducing the old brittle Web Audio-only UX.

### Key Tasks

- Add frontend API client for voice job endpoints.
- Add composable for voice answer state and playback.
- Add thread/menu settings:
  - Voice Mode toggle;
  - background autoplay mode;
  - profile Economy/Medium/Forte;
  - voice selector default `nova`;
  - speed control;
  - stop/pause/resume playback.
- Add per-thread "voice answer waiting/ready/failed" UI.
- Trigger voice answer job after voice-input auto-send when Voice Mode is enabled.
- Keep manual "play latest answer" available for completed assistant messages.
- Cache pending input recording locally until send/transcription succeeds, reusing existing dictation storage where possible.

### Atomic Steps

1. Restore/adapt `src/api/voiceMode.ts`.
2. Restore/adapt `useVoicePlayback` but route through the job endpoints.
3. Add settings state with stable localStorage keys.
4. Wire job creation after dictation auto-send in the least invasive place.
5. Add UI states for waiting, generating, ready, playing, failed.
6. Add light/dark CSS.
7. Add unit tests for client helpers and composable behavior where feasible.

### Acceptance Criteria

- Voice controls appear only when relevant and do not disturb existing thread controls.
- Existing dictation behavior remains unchanged when Voice Mode is disabled.
- User can manually play a completed answer.
- When Voice Mode is enabled, a dictated/sent message creates a voice job for the eventual assistant answer.
- Light and dark themes are readable.

### Verification

- `pnpm exec vitest run src/api/codexGateway.test.ts src/composables/useDictation.test.ts --reporter=verbose`
- New focused tests for voice API/composable.
- `pnpm run build:frontend`
- Manual browser smoke without Playwright unless browser automation is explicitly requested.

## Phase 4: Telegram Fallback

### Goal

Send a Telegram fallback alert when a voice job is ready or failed and background autoplay is not guaranteed.

### Key Tasks

- Reuse the existing Telegram bridge/config.
- Add a server-side helper that sends a short "voice answer ready" message to remembered allowlisted chats.
- Keep token and allowlist configuration outside git.
- Avoid sending full assistant text by default; send a concise status and thread reference.
- Add explicit behavior when Telegram is not configured or no chat has been seen.

### Atomic Steps

1. Expose a narrow internal Telegram send helper if one does not exist.
2. Add voice-job notification hook on `ready` and `failed`.
3. Add config/toggle for Telegram fallback.
4. Add tests with mocked Telegram fetch.
5. Document `/start` and `/whoami` setup.

### Acceptance Criteria

- Only configured allowlisted Telegram chats can receive fallback alerts.
- No bot token is logged, returned, or committed.
- Missing Telegram config does not fail voice job generation.
- Fallback message is short and does not include large/sensitive code output.

### Verification

- Focused Telegram/voice tests.
- Manual Telegram smoke on the server after user confirms bot DM setup.
- Secret scan check before commit.

## Phase 5: iOS Native Voice Session Layer

### Goal

Add the native hooks needed for locked-screen playback experiments while preserving browser/PWA behavior.

### Key Tasks

- Extend or replace `CodexAudioSessionPlugin` with a broader voice session API:
  - `prepareVoiceInputSession`
  - `finishVoiceInputSession`
  - `beginVoiceWaitingSession`
  - `endVoiceWaitingSession`
  - `beginVoicePlaybackSession`
  - `endVoicePlaybackSession`
  - `getAudioRouteDiagnostics`
- Prefer built-in iPhone microphone during input.
- Allow AirPods/Bluetooth output for playback.
- Configure audio category/options for input, waiting, and playback phases.
- Add optional silent keepalive for "aggressive while waiting".
- Register remote media commands for pause/resume playback first.
- Keep AirPods start/stop recording as experimental and off by default.

### Atomic Steps

1. Update Swift plugin methods and Objective-C bridge if needed.
2. Update TypeScript native wrapper.
3. Call native methods only when `Capacitor.isNativePlatform()` and platform is iOS.
4. Add route diagnostics returned to UI/logging.
5. Add docs for expected iPhone/AirPods manual validation.

### Acceptance Criteria

- Web/PWA builds still work if native plugin is unavailable.
- iOS build compiles after `npx cap sync ios` on Mac.
- Dictation still records with existing web path.
- Native methods fail non-fatally and report diagnostics.
- Physical-device validation checklist is documented.

### Verification

- `pnpm run build:frontend`
- `npx cap sync ios` on Mac during final device pass.
- Xcode build on Mac.
- Manual iPhone/AirPods tests:
  - unlocked recording uses iPhone mic when possible;
  - locked waiting session survives long enough to play ready audio;
  - AirPods receive playback;
  - music ducks/mixes acceptably;
  - AirPods media button pauses/resumes playback.

## Phase 6: Documentation, Security, And Regression

### Goal

Finish the sprint with clear docs, manual test coverage, security checks, and an honest final report.

### Key Tasks

- Update `README.md` only if the feature is user-facing enough for setup docs.
- Update `docs/ios-sideload.md` with voice mode limitations and iPhone validation steps.
- Update `tests.md`:
  - replace `Assistant Voice/TTS Removal`;
  - add web/backend voice job tests;
  - add Telegram fallback tests;
  - add iOS light/dark/manual checks.
- Add this file's work log entries as work proceeds.
- Run focused tests, broader tests, build, and coverage where feasible.
- Run performance audit using code-path analysis and profiler where applicable.
- Run secret checks.

### Atomic Steps

1. Update docs/tests.
2. Run focused tests for changed modules.
3. Run `pnpm run test:unit`.
4. Run `pnpm run build`.
5. Run `pnpm run test:coverage`.
6. Run profile workflow if browser/startup/thread path changed:
   - `pnpm run dev --host 127.0.0.1 --port 4173`
   - `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_WAIT_MS=7000 pnpm run profile:browser`
7. Inspect profile JSON for duplicates, warnings, API KB, and slow API rows.
8. Run secret checks:
   - `git diff --cached`
   - `git diff`
   - scan the diff for API keys, bot tokens, passwords, private keys, and real env values.
   - use a scanner such as `gitleaks` if available.

### Acceptance Criteria

- Tests/docs match the restored feature.
- No secrets are committed.
- The final report clearly separates:
  - completed server/web work;
  - iOS code prepared but not physically validated;
  - device-only follow-ups.
- The repo is ready for the user to clone/download on Mac and build through Xcode.

### Verification

- Final local checks as listed above.
- Physical iOS/Xcode checks are documented as pending if not run in this workspace.

## Commit Plan

Use small commits, one task at a time:

1. `Plan assistant voice mode sprint`
2. `Restore voice TTS server route`
3. `Add voice answer job cache`
4. `Add voice mode frontend controls`
5. `Add Telegram voice fallback`
6. `Extend iOS voice audio session`
7. `Document assistant voice mode validation`

If a phase proves too large, split commits by server/client/native/docs.

## Work Log

### 2026-06-10 - Sprint Plan Created

- Read the user-supplied sprint planning brief.
- Reviewed project docs, scripts, iOS shell docs, Telegram bridge references, dictation code, native audio session plugin, and old voice/TTS commit history.
- Decision: do not blindly revert old TTS commits. Recover the useful server/client pieces and reshape them around asynchronous voice answer jobs plus iOS-native background audio readiness.
- Decision: keep real Telegram/OpenAI tokens out of repo; use existing server-side env/config only.
- Decision: use Telegram as fallback for free Apple account constraints; APNs is out of scope for this sprint.

## Final Report

Not started. This section must be completed when the sprint implementation is done.

Expected final report fields:

- Completed:
- Not completed:
- Checks passed:
- Checks not run and why:
- Performance audit:
- Security checks:
- Remaining risks:
- Follow-up tasks:
- Ready for PR / merge / deploy:
