# iOS Capacitor Shell Plan

## Goal

Build an iOS app wrapper for Codex UI that can be opened in Xcode and sideloaded to a physical iPhone with a free Apple ID. The iOS app is UI-only: it does not run the Codex UI backend, Codex CLI, app-server bridge, or terminal/runtime services locally on iOS. All backend work continues to run on an external server reachable over the internet.

The target result is:

- a committed Capacitor iOS project in this repository;
- a build flow where the user runs the web build, syncs Capacitor, opens Xcode, selects their iPhone, and presses Run;
- a configurable remote backend URL used by HTTP APIs and WebSocket calls;
- iOS microphone permission configured correctly;
- a first pass at reducing music interruption during dictation through native iOS audio session handling;
- documentation that explains sideloading with a free Apple ID and the seven-day reinstall cycle.

## Architecture

Use Capacitor as a native iOS shell around the existing Vue/Vite frontend.

The app should not use Capacitor `server.url` as the primary long-term architecture unless a short temporary proof of concept is needed. Prefer bundling the built frontend into the iOS app and routing API/WebSocket traffic to a configured remote backend.

Runtime shape:

```text
iPhone iOS app
  Capacitor WKWebView
  bundled Vite frontend assets
  configurable backend base URL
        |
        | HTTPS/WSS over internet
        v
Remote Codex UI server
  Node app-server bridge
  Codex CLI integration
  transcription proxy
  local browse routes
  WebSocket notifications
```

The remote backend is expected to expose the same HTTP and WebSocket routes the browser PWA currently uses, including routes under `/codex-api`, local browse/file/image routes, and transcription routes.

## Non-Goals

- Do not port the Node backend to iOS.
- Do not run Codex CLI on iPhone.
- Do not require a paid Apple Developer account.
- Do not publish to the App Store.
- Do not replace the existing PWA flow for browser users.
- Do not redesign the UI unless required for iOS-specific usability.

## Key Decisions

### Backend URL

The iOS shell must support a remote backend URL. Implement this as an app setting, not only as a compile-time environment variable.

Recommended behavior:

- first launch asks for or shows a backend URL setting;
- setting persists in local storage or Capacitor Preferences;
- default may come from `VITE_CODEXUI_BACKEND_URL`;
- all existing relative backend calls are routed through a shared URL helper;
- WebSocket URLs are derived from the same base URL by converting `http` to `ws` and `https` to `wss`.

Examples:

```text
https://codex.example.com
https://codex-ui.example.net
http://100.127.77.25:4173
```

Prefer HTTPS in real internet use. Use HTTP only for private networks, VPN/Tailscale, or local testing.

### Capacitor Mode

Use bundled frontend assets:

```text
webDir: dist
```

Avoid depending on a remote web app URL for rendering the whole UI. The remote server should provide backend APIs, not the app shell itself. This gives the iOS wrapper more predictable startup behavior and allows native plugins for microphone/audio session fixes.

### Microphone

The app must include `NSMicrophoneUsageDescription` in `ios/App/App/Info.plist`.

The current web dictation code uses:

- `navigator.mediaDevices.getUserMedia`;
- `MediaRecorder`;
- `AudioContext`;
- `/codex-api/transcribe`.

Keep the web recorder initially, but add an iOS audio session bridge if needed to reduce music interruption.

### Music Playback During Dictation

Progressive Web Apps on iOS have limited control over `AVAudioSession`. A Capacitor shell can add native Swift code to set audio session category/options before dictation begins.

Recommended first native pass:

- add a small Capacitor plugin, for example `CodexAudioSessionPlugin`;
- expose `prepareDictationAudioSession()` and `finishDictationAudioSession()`;
- before recording, call prepare from `useDictation`;
- after recording/cancel/error, call finish;
- in Swift, configure `AVAudioSession` with a category such as `.playAndRecord` and options such as `.mixWithOthers`, possibly `.allowBluetooth` and `.defaultToSpeaker` depending on test results.

This must be validated on a physical iPhone with the user's actual music app. iOS may still pause or duck audio depending on route, app, and OS behavior.

If WebView recording remains unreliable, add a second implementation phase: native Swift recording through `AVAudioRecorder`, then hand the recorded file back to JS for transcription upload.

## Implementation Plan

### Phase 1: Prepare Mobile Runtime Abstractions

1. Add a frontend backend URL resolver.
2. Replace direct relative API path construction with the resolver.
3. Cover at least:
   - `/codex-api/*`;
   - `/codex-api/ws`;
   - `/codex-local-browse/*`;
   - `/codex-local-file`;
   - `/codex-local-image`;
   - transcription upload.
4. Add a settings UI field for the backend URL, or extend the existing settings panel if one exists.
5. Persist the backend URL.
6. Add validation:
   - trim whitespace;
   - require `http://` or `https://`;
   - remove trailing slash for stored base URL;
   - show a clear error for invalid URL.

### Phase 2: Add Capacitor

1. Add Capacitor dependencies:

   ```bash
   pnpm add @capacitor/core
   pnpm add -D @capacitor/cli @capacitor/ios
   ```

2. Add `capacitor.config.ts` with:

   ```ts
   import type { CapacitorConfig } from '@capacitor/cli'

   const config: CapacitorConfig = {
     appId: 'dev.rnl1.codexui',
     appName: 'Codex UI',
     webDir: 'dist',
     bundledWebRuntime: false,
   }

   export default config
   ```

3. Build frontend:

   ```bash
   pnpm run build:frontend
   ```

4. Add iOS platform:

   ```bash
   npx cap add ios
   ```

5. Sync:

   ```bash
   npx cap sync ios
   ```

6. Ensure generated iOS files are committed, except for build artifacts and user-specific Xcode state.

### Phase 3: iOS Permissions and App Metadata

1. Add `NSMicrophoneUsageDescription` to `ios/App/App/Info.plist`.
2. Set app display name to `Codex UI`.
3. Set bundle ID to the agreed ID, default `dev.rnl1.codexui`.
4. Reuse existing app icons from `public/icons` or generate a complete iOS AppIcon set.
5. Confirm Xcode project opens with:

   ```bash
   npx cap open ios
   ```

### Phase 4: iOS Audio Session Bridge

1. Add a Capacitor Swift plugin for dictation audio session.
2. Add a small TypeScript wrapper so web code can safely call it only under Capacitor/iOS.
3. Wire the wrapper into `src/composables/useDictation.ts`:
   - call prepare immediately before `getUserMedia`;
   - call finish when cleanup is complete;
   - do not break browser/PWA behavior if Capacitor is unavailable.
4. Keep failure non-fatal. If native audio session setup fails, dictation should still attempt to record.

### Phase 5: Documentation

Add `docs/ios-sideload.md` with:

1. prerequisites:
   - macOS;
   - Xcode;
   - Node/pnpm;
   - iPhone connected by cable;
   - Apple ID signed into Xcode;
   - remote Codex UI backend URL;
2. build steps:

   ```bash
   pnpm install
   pnpm run build:frontend
   npx cap sync ios
   npx cap open ios
   ```

3. Xcode steps:
   - select `App` target;
   - set Team to Personal Team;
   - enable automatic signing;
   - select physical iPhone;
   - press Run;
4. iPhone trust steps if prompted;
5. how to configure backend URL in the app;
6. note that free Apple ID installs expire after seven days and must be re-run from Xcode;
7. troubleshooting:
   - signing errors;
   - backend not reachable;
   - CORS/CSP issues;
   - microphone permission denied;
   - WebSocket blocked;
   - mixed content when app uses HTTPS but backend uses HTTP.

## Commit Plan

Create small commits. Do not batch unrelated changes.

1. `Add mobile backend URL resolution`
   - shared frontend URL helper;
   - API/WebSocket call sites moved to helper;
   - no Capacitor yet.

2. `Add backend URL setting for mobile shell`
   - settings UI;
   - persistence;
   - validation.

3. `Add Capacitor iOS shell`
   - Capacitor dependencies;
   - `capacitor.config.ts`;
   - generated `ios/` project;
   - ignore user-specific Xcode artifacts if needed.

4. `Configure iOS microphone permission and metadata`
   - `Info.plist`;
   - app name;
   - bundle identifier;
   - icons if included.

5. `Add iOS dictation audio session bridge`
   - Swift Capacitor plugin;
   - TypeScript wrapper;
   - `useDictation` integration.

6. `Document iOS sideload workflow`
   - `docs/ios-sideload.md`;
   - troubleshooting;
   - seven-day free Apple ID note.

7. `Document manual tests for iOS shell`
   - update `tests.md` with the manual test section required by this repository.

## Test Plan

### Static and Build Checks

Run:

```bash
pnpm run build:frontend
npx cap sync ios
```

Expected:

- Vite frontend builds successfully;
- Capacitor copies `dist/` into the iOS project;
- no TypeScript errors;
- no missing Capacitor plugin errors.

### Browser Regression Check

Run the normal web app locally:

```bash
pnpm run dev -- --host 0.0.0.0 --port 4173
```

Manual checks:

1. Open the app in a desktop browser.
2. Confirm default relative backend behavior still works when no remote backend URL is configured.
3. Send a normal chat message.
4. Open an existing thread.
5. Confirm WebSocket notifications still connect.
6. Use dictation in the browser if microphone is available.

Expected:

- existing PWA/browser workflow is not broken;
- backend URL setting does not force desktop users to configure anything;
- dictation still records and transcribes.

### Remote Backend URL Check

Prerequisite:

- a reachable Codex UI backend server, ideally HTTPS.

Manual checks:

1. Configure backend URL in the app settings.
2. Reload the app.
3. Confirm the setting persisted.
4. Send a message.
5. Confirm API requests go to the configured backend.
6. Confirm WebSocket connects to the matching `ws` or `wss` URL.
7. Confirm local file/image/browse links route through the configured backend.

Expected:

- no calls accidentally go to the Capacitor local origin for backend routes;
- API and WebSocket use the same configured backend base;
- invalid backend URL is rejected with a clear UI error.

### Xcode Build Check

Run:

```bash
npx cap open ios
```

In Xcode:

1. Select the `App` target.
2. Select the user's Personal Team.
3. Enable automatic signing.
4. Select a physical iPhone.
5. Press Run.

Expected:

- Xcode builds without project configuration errors;
- app installs on the iPhone;
- first launch shows Codex UI;
- app is not blank.

### iPhone Remote Backend Check

On the installed iPhone app:

1. Set the remote backend URL.
2. Open or create a thread.
3. Send a message.
4. Wait for response streaming/updates.
5. Background and foreground the app.
6. Reopen the same thread.

Expected:

- app can talk to the remote backend over internet/VPN;
- chat updates render correctly;
- settings survive app restart;
- app recovers after foregrounding.

### iPhone Microphone Permission Check

On a physical iPhone:

1. Ensure the app is freshly installed or microphone permission has been reset.
2. Tap the dictation microphone button.
3. Accept the iOS microphone prompt.
4. Record a short phrase.
5. Stop recording.
6. Confirm transcription appears and can be sent.
7. Close and reopen the app.
8. Try dictation again.

Expected:

- iOS asks for microphone access with the configured usage description;
- permission is not requested repeatedly after acceptance;
- recording works after relaunch;
- transcription reaches the remote backend.

### Music Interruption Check

On a physical iPhone:

1. Start music playback in the user's normal music app.
2. Open Codex UI iOS app.
3. Start dictation.
4. Speak for several seconds.
5. Stop dictation.
6. Observe whether music pauses, ducks, mixes, or resumes.
7. Repeat with AirPods/Bluetooth if that is part of the user's normal setup.

Expected target:

- best case: music continues while dictation records;
- acceptable first pass: music resumes automatically after dictation;
- failure: music pauses and does not resume, matching the current PWA problem.

If the failure case remains, implement the native recorder fallback as the next task.

### Free Apple ID Reinstall Check

Manual documentation check:

1. Confirm docs state that free Apple ID sideloaded apps expire after seven days.
2. Confirm docs explain that the user must rebuild/re-run from Xcode after expiration.
3. Confirm no paid Apple Developer account is listed as required.

Expected:

- instructions match the intended no-paid-account workflow.

## Risks and Follow-Up Tasks

### CORS and Origin

Capacitor apps run from a special local origin such as `capacitor://localhost`. The remote backend may need CORS updates to allow this origin.

Follow-up if blocked:

- update backend CORS/allowed origin handling;
- allow `capacitor://localhost`;
- ensure credentials/auth headers still work as intended.

### Cookies and Auth

If the app relies on browser cookies for backend auth, WKWebView behavior may differ from Safari/PWA behavior.

Follow-up if blocked:

- prefer token/header-based auth for the mobile shell;
- document required backend auth mode.

### WebSocket Transport

WebSocket URLs must be generated explicitly. Relative WebSocket paths may fail in the bundled shell.

Follow-up if blocked:

- centralize all WebSocket construction;
- log the resolved WebSocket URL in debug mode.

### MediaRecorder on iOS

`MediaRecorder` support and audio behavior can vary across iOS versions.

Follow-up if blocked:

- implement native Swift recording;
- return recorded audio to JS;
- reuse existing transcription upload code.

### App Store Review

This plan is for sideloading only. App Store distribution would need a separate review of policies, permissions, backend auth, user-generated content, and privacy text.

## Handoff Checklist for the Implementing LLM

Before starting:

- read this file;
- read `AGENTS.md`;
- inspect current API/WebSocket call sites with `rg`;
- verify whether a backend URL abstraction already exists;
- keep browser/PWA behavior working.

Before reporting completion:

- commit each discrete task;
- update `tests.md` with iOS shell manual tests;
- run `pnpm run build:frontend`;
- run `npx cap sync ios`;
- confirm Xcode project opens if macOS/Xcode is available;
- clearly report any checks that could not be run in the current environment;
- include the exact commands run and their results.
