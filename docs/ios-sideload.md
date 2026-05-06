# iOS Sideload Workflow

This project includes a Capacitor iOS shell for Codex UI. The iOS app is a UI wrapper only. It does not run the Codex UI backend, Codex CLI, or local app-server bridge on the iPhone. A reachable remote Codex UI server must be running separately.

## Prerequisites

- macOS with Xcode installed.
- Node.js 18 or newer and pnpm.
- iPhone connected by cable.
- Apple ID signed into Xcode.
- Remote Codex UI backend URL, preferably HTTPS.

Free Apple ID installs use Xcode's Personal Team signing and expire after seven days. Reopen the project in Xcode and press Run again when the app expires.

## Backend

Start Codex UI on the server before opening the iOS app. The server must expose the normal Codex UI backend routes:

- `/codex-api/*`
- `/codex-api/ws`
- `/codex-local-image`
- `/codex-local-file`
- `/codex-local-directories`
- `/codex-local-browse/*`
- `/codex-local-edit/*`

Use HTTPS for internet-facing deployments. HTTP is reasonable only for private network, localhost, or VPN/Tailscale testing.

The production server allows Capacitor's `capacitor://localhost` origin for backend routes. If a reverse proxy sits in front of Codex UI, make sure it forwards `OPTIONS`, `Origin`, cookies, and WebSocket upgrade requests.

## Build and Sync

From the repository root:

```bash
pnpm install
pnpm run build:frontend
npx cap sync ios
npx cap open ios
```

`npx cap open ios` opens `ios/App/App.xcworkspace`. Open the workspace, not only the `.xcodeproj`, because Capacitor uses CocoaPods.

## Xcode Setup

1. Select the `App` project.
2. Select the `App` target.
3. Open `Signing & Capabilities`.
4. Enable `Automatically manage signing`.
5. Pick your Apple ID Personal Team.
6. Keep the bundle identifier as `dev.rnl1.codexui`, or change it to a unique identifier if Xcode reports a signing conflict.
7. Select the connected iPhone as the run destination.
8. Press Run.

If the iPhone blocks launch, open iOS Settings and trust the developer profile for your Apple ID, then run the app again.

## Configure the App

1. Open Codex UI on the iPhone.
2. Open Settings from the sidebar.
3. Set `Remote backend` to the externally reachable server URL, for example:

   ```text
   https://codex.example.com
   http://100.127.77.25:4173
   ```

4. Press `Set`.
5. Reload the app after changing the backend URL so active EventSource/WebSocket streams reconnect to the new server.

Leave `Remote backend` empty for normal browser/PWA same-origin mode.

## Microphone

The iOS target includes `NSMicrophoneUsageDescription`. iOS should ask for microphone access the first time dictation starts.

If dictation permission was denied:

1. Open iOS Settings.
2. Find Codex UI.
3. Enable Microphone.
4. Relaunch Codex UI.

The app also includes a native audio session bridge that prepares `AVAudioSession` before web dictation starts and deactivates it after recording ends. This is intended to reduce music interruption compared with the PWA path, but final behavior must be checked on a physical iPhone with the user's actual music app and audio route.

## Troubleshooting

### Xcode says the app cannot be signed

Use a unique bundle identifier in the `App` target. Personal Team signing cannot use an identifier already reserved by another developer account.

### `pod install` is missing

Install CocoaPods on the Mac:

```bash
sudo gem install cocoapods
```

Then rerun:

```bash
npx cap sync ios
```

### The app opens but backend calls fail

Check:

- the backend URL includes `http://` or `https://`;
- the iPhone can reach the URL in Safari;
- reverse proxy forwards `/codex-api/ws` WebSocket upgrades;
- reverse proxy allows `OPTIONS` preflight;
- cookies are not stripped by the proxy;
- HTTPS pages are not trying to call an HTTP backend.

### Login/password cookie does not stick

For cross-origin Capacitor requests, the frontend sends credentials and the built-in server allows `capacitor://localhost` with credentials. If a proxy is used, it must preserve `Set-Cookie`, `Cookie`, and CORS credential headers.

### Music still pauses during dictation

The first pass keeps the existing WebView recorder and changes native audio session behavior around it. If iOS still pauses music and does not resume it, the next implementation step is to replace Web `MediaRecorder` on iOS with native Swift recording through `AVAudioRecorder`.
