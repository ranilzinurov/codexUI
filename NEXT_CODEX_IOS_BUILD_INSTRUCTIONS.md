# Next Codex: Build And Sideload Codex UI For iPhone

This repository already contains the Capacitor iOS shell and the assistant voice-mode code. Your job on the Mac is to prepare the iOS build, open it in Xcode, fix any local Mac/Xcode signing issues, and get the app onto the connected iPhone.

## Important Context

- The iOS app is a UI shell only. It does not run the Codex backend, Codex CLI, or app-server on the iPhone.
- Backend work stays on the remote server. The iPhone app should connect to:

  ```text
  https://codex-ui.todo-tg-app.ru
  ```

- Voice controls are intentionally visible only inside the native iOS Capacitor app. They should not appear in desktop browser/PWA mode.
- The voice mode flow is:
  1. user records dictation while the phone is unlocked;
  2. transcript is sent to the remote Codex UI backend;
  3. user locks the phone;
  4. backend waits for the Codex answer;
  5. backend summarizes the answer in simple Russian;
  6. backend generates temporary TTS audio;
  7. iOS app tries to play it through AirPods;
  8. Telegram fallback alerts the user if needed.

## Prerequisites On The Mac

Install or confirm:

- macOS with Xcode installed.
- Apple ID signed into Xcode.
- iPhone connected by cable and trusted by the Mac.
- Node.js 18 or newer.
- pnpm.
- CocoaPods, if Capacitor reports that pods are missing.

Useful checks:

```bash
node -v
pnpm -v
xcodebuild -version
```

If pnpm is missing:

```bash
corepack enable
corepack prepare pnpm@latest --activate
```

If CocoaPods is missing:

```bash
sudo gem install cocoapods
```

## First Commands

From the unzipped repository root:

```bash
git status --short --branch
pnpm install
pnpm run build:frontend
npx cap sync ios
npx cap open ios
```

Notes:

- `pnpm run build:frontend` creates `dist/`, which Capacitor copies into the iOS app.
- `npx cap sync ios` copies the web build into `ios/` and updates native iOS dependencies.
- `npx cap open ios` should open `ios/App/App.xcworkspace`.
- Open the `.xcworkspace`, not only the `.xcodeproj`.

## Optional Command-Line Build Check

Before using a physical device, this can catch obvious native compile errors:

```bash
xcodebuild \
  -workspace ios/App/App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -destination 'generic/platform=iOS' \
  build
```

Signing for a real iPhone may still need Xcode UI setup after this.

## Xcode Setup

In Xcode:

1. Open `ios/App/App.xcworkspace`.
2. Select the `App` project.
3. Select the `App` target.
4. Open `Signing & Capabilities`.
5. Enable `Automatically manage signing`.
6. Select the user's Apple ID Personal Team.
7. If Xcode says the bundle identifier is unavailable, change it from:

   ```text
   dev.rnl1.codexui
   ```

   to a unique value, for example:

   ```text
   dev.<user-name>.codexui
   ```

8. Select the connected iPhone as the run destination.
9. Press Run.

Free Apple ID installs expire after about 7 days. Reopen this project in Xcode and press Run again when the app expires.

## iPhone Trust / Developer Mode

If the app installs but iOS blocks launch:

1. Unlock the iPhone.
2. Trust the Mac if iOS asks.
3. If prompted, enable Developer Mode.
4. Open iOS Settings and trust the developer profile for the Apple ID.
5. Run from Xcode again.

## First App Configuration On iPhone

After the app opens:

1. Open the Codex UI sidebar settings.
2. Set `Remote backend` to:

   ```text
   https://codex-ui.todo-tg-app.ru
   ```

3. Press `Set`.
4. In the `Remote login` field that appears under the backend URL, enter the Codex Web password for that server.
5. Press `Login`.
6. The app should reload automatically after successful login.
7. Confirm the thread list loads from the remote server.

## Voice Mode Test On The Physical iPhone

Use a real iPhone and AirPods. This cannot be fully validated in desktop browser mode.

1. Connect AirPods.
2. Open the native Codex UI app, not Safari/PWA.
3. Open Settings and confirm voice settings are visible.
4. Enable `Voice mode`.
5. Set `Voice summary` to `Medium`.
6. Set `Voice speed` to `1.0x`.
7. Keep `Voice Telegram fallback` enabled.
8. Open a thread.
9. Record dictation using the microphone button.
10. Stop recording and let auto-send submit the transcript.
11. Lock the iPhone after the transcript is sent.
12. Wait for Codex to finish.
13. Expected result: the app keeps/uses the iOS audio session and plays the Russian spoken summary in AirPods.
14. If autoplay fails, expected fallback: Telegram sends an alert that the voice answer is ready or failed.

Also test manual playback in the native iOS app:

1. Open a completed assistant answer.
2. Open the thread feature menu.
3. Use `Play latest`, `Pause`, `Resume`, and `Stop voice`.

## What To Verify In Code Before Finishing

Run:

```bash
pnpm exec vue-tsc --noEmit
pnpm run build:frontend
pnpm run test:unit
```

If time permits, run the focused voice tests:

```bash
pnpm exec vitest run \
  src/server/voiceMode.test.ts \
  src/api/voiceMode.test.ts \
  src/composables/useVoicePlayback.test.ts \
  --reporter=verbose
```

## Troubleshooting

### `No such module 'Capacitor'`

Usually means Xcode opened the wrong file or pods are not synced.

Fix:

```bash
npx cap sync ios
npx cap open ios
```

Make sure Xcode has `ios/App/App.xcworkspace` open.

### Xcode signing fails

Use `Automatically manage signing`, select the Personal Team, and change the bundle identifier to a unique value if needed.

### The app opens but backend calls fail

Check on the iPhone:

- Safari can open `https://codex-ui.todo-tg-app.ru`.
- The app's `Remote backend` value includes `https://`.
- The app's `Remote login` action succeeds after entering the Codex Web password.
- The reverse proxy forwards `/codex-api/ws` WebSocket upgrades.
- Cookies and CORS headers are not stripped by the proxy.
- The server allows `capacitor://localhost` origin for credentialed requests.
- Native login responses include `Set-Cookie: portal_session=...; SameSite=None; Secure`.

### Voice controls are missing

That is correct in desktop browser/PWA mode. They should appear only in the native iOS app.

If they are missing inside the native iOS app:

```bash
pnpm run build:frontend
npx cap sync ios
```

Then rebuild/run from Xcode.

### Voice answer does not play after lock screen

Check:

- the app is the native Capacitor app, not Safari/PWA;
- `Voice mode` was enabled before sending dictation;
- `ios/App/App/Info.plist` contains `UIBackgroundModes` with `audio`;
- AirPods are connected before the test;
- Telegram fallback is enabled and the bot has remembered the user's chat.

If iOS still suspends playback, collect Xcode device logs around:

- `CodexAudioSessionPlugin`;
- audio route diagnostics;
- WebView lifecycle/background events.

This feature is best-effort until it is tested on the physical user's iPhone/AirPods route.

## Documentation References

- Project docs:
  - `docs/ios-sideload.md`
  - `docs/ios-capacitor-shell-plan.md`
  - `docs/assistant-voice-mode-sprint-plan.md`
- Capacitor workflow:
  - build web assets;
  - run `npx cap sync ios`;
  - open with `npx cap open ios`;
  - use Xcode for physical device signing/run.
- Apple/Xcode notes:
  - use `Automatically manage signing` in `Signing & Capabilities`;
  - assign an Apple ID Personal Team;
  - background audio is configured through `UIBackgroundModes` = `audio`.
