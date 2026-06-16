# Tests

This file tracks manual regression and feature verification steps.

## Supplemental Domain Test Docs

Root `tests.md` remains the canonical manual-test log required by this repository. Supplemental domain docs live under [`tests/`](tests/index.md) to make imported upstream checks easier to browse without replacing or deleting existing root coverage.

## Template

### Feature: <name>

#### Prerequisites
- <required setup>

#### Steps
1. <action>
2. <action>

#### Expected Results
- <result>

#### Rollback/Cleanup
- <cleanup action, if any>

### Feature: Browser annotation DevTools smoke fixture

#### Prerequisites
- Chrome extension Phase 3 DevTools mode is being implemented or reviewed.
- Run `node extension/browser-annotation/dev/devtools-fixture-server.mjs` from the repository root.
- Load the browser annotation extension unpacked in Chrome.

#### Steps
1. Open `http://127.0.0.1:8899/`.
2. Enable the extension's explicit DevTools capture mode for the tab.
3. Click `Console info`, `Console warn`, `Console error`, and `Console burst`.
4. Click `Network success`, `Network 404`, `Network slow`, `Network fail`, and `Network burst`.
5. Make an annotation on the page after the trigger clicks.
6. Repeat the page check with the browser or operating system in light and dark color scheme.

#### Expected Results
- Console capture records info, warn, and error entries prefixed with `codex-devtools-smoke:`.
- Network capture records a 200 JSON request, a 404 JSON request, a delayed 200 JSON request, and a failed request.
- The annotation made after the trigger clicks can be correlated with the recent console and network fixture events.
- The fixture page remains readable in light and dark color schemes.

#### Rollback/Cleanup
- Stop the fixture server with `Ctrl+C`.

### Feature: Browser annotation voice metadata contract

#### Prerequisites
- Work from the repository root on `main`.
- No extension UI recording flow is required; this covers shared extension-side metadata only.

#### Steps
1. Run `node --check extension/browser-annotation/shared/constants.js`.
2. Run `node --check extension/browser-annotation/shared/pairing-client.js`.
3. Run `node --check extension/browser-annotation/shared/annotation-queue.js`.
4. Run `node --check extension/browser-annotation/dev/pairing-client-smoke.mjs`.
5. Run `node --check extension/browser-annotation/dev/annotation-queue-smoke.mjs`.
6. Run `node extension/browser-annotation/dev/pairing-client-smoke.mjs`.
7. Run `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`.
8. For light-theme regression, load the extension side panel and confirm the existing annotation queue UI is unchanged.
9. For dark-theme regression, repeat the side panel check with dark theme enabled.

#### Expected Results
- Pairing URL builders return listen status, annotation batch, asset upload, and transcribe URLs with `sessionId` and `threadId` query parameters where required.
- Voice-only queue metadata produces an item with `kind: "voice"`, a `voiceNote`, and one `assets[]` record with `kind: "voice-note-audio"`.
- Note plus voice metadata produces an item with `kind: "mixed"` while preserving the note text.
- Failed and pending transcript metadata is preserved as sanitized status/error metadata.
- Asset references are preserved without including raw audio, data URLs, or base64 payloads in the annotation batch JSON.
- Light and dark side panel surfaces remain unchanged because no UI recording controls were added.

#### Rollback/Cleanup
- No cleanup is required.

### Feature: Project recency sort, pins, and mobile move mode

#### Prerequisites
- App is running from this repository on `feature/project-recency-sort-upstream`.
- At least two visible projects exist with threads updated at different times.
- Light and dark themes are both available from Settings.

#### Steps
1. Open the sidebar in light theme.
2. Open Projects -> Organize and confirm `Recent projects` is selected by default.
3. Confirm projects appear in descending recent thread activity order.
4. Tap the Projects header reorder icon and confirm move mode starts, all current project thread lists collapse, and drag handles are visible.
5. Drag a non-top project above the first project while still in recent mode.
6. Confirm the moved project appears in the pinned prefix, recent mode remains selected, and project threads do not expand from the drag release.
7. Tap `Done`, open the moved project's menu, choose `Unpin project`, and confirm it returns to its recency-derived position.
8. Switch to `Manual project order`, drag a project, and confirm the manual order sticks independently of recent-mode pins.
9. Enter sidebar search text and confirm project move mode/dragging cannot start while the project list is filtered.
10. Repeat steps 1-9 in dark theme.

#### Expected Results
- Recent mode ignores saved manual `projectOrder` except for explicit pinned project overrides.
- Recent-mode drags pin the moved project without switching the persisted sort mode to manual.
- Recent-mode drag and pin actions update only the pinned project override list and do not rewrite saved manual order.
- Unpinning removes the override and restores the project to recency order.
- Manual project order remains a separate full-list ordering mode.
- Move mode collapses project thread lists, restores prior expansion state on exit, and is blocked while search filters the sidebar.
- Reorder icon, `Done`, drag handles, pin labels, and menus remain readable in light and dark themes.

#### Rollback/Cleanup
- Tap `Done` to leave move mode.
- Reset the sidebar Organize menu to the preferred project sort mode.
- Remove any temporary chats or workspace roots created for verification.

### Feature: Thread heartbeat automations

#### Prerequisites
- App is running from this repository.
- At least one local thread exists in the sidebar.
- Local Codex home is writable (`$CODEX_HOME` or `~/.codex`).
- Light and dark themes are both available from Settings.

#### Steps
1. In light theme, open the sidebar thread menu for a thread without an attached automation.
2. Confirm the menu shows `Add automation…`.
3. Click `Add automation…`.
4. Fill name, prompt, RRULE schedule, and set status to `Paused`.
5. Save the automation and reopen the same thread menu.
6. Confirm the menu now shows `Manage automations…` and the thread row shows an automation chip.
7. Open `Manage automations…`, confirm the saved values are prefilled, then click `Add another automation`.
8. Fill a second automation with a different name and RRULE, save it, and confirm both automations appear in the dialog list.
9. Select each automation from the list and confirm its own prompt, RRULE, and status load independently.
10. Click `Run now` for one saved automation while the thread is idle and confirm the automation run is queued or starts in the selected thread.
11. Start a normal thread turn, reopen `Manage automations…`, click `Run now` for another saved automation, and confirm it waits in the queue until the active turn can finish.
12. Remove one automation and confirm the other remains attached to the same thread.
13. Switch to dark theme, reopen `Manage automations…`, and confirm the list, inputs, textarea, status select, `Run now`, and queued-run notice remain readable.
14. Select a thread that already contains automation runs and confirm both the automation prompt card and the assistant reply are visible.
15. Remove the final automation and confirm the thread menu returns to `Add automation…`.

#### Expected Results
- Multiple thread-scoped heartbeat automations can be created under the Codex automations store with the same `target_thread_id`.
- The automation manager is hosted from the thread menu and supports adding, selecting, editing, and removing individual automations.
- `Run now` enqueues the selected automation immediately using a Codex.app-style heartbeat payload with `automation_id`, `current_time_iso`, and `instructions`, without requiring a schedule tick.
- Automation heartbeat prompts render as visible user-side cards labeled `Sent via automation`; raw heartbeat XML is not shown.
- Manual runs use the existing thread queue, so they do not interrupt an active turn and run in order when the thread is available.
- Removing one automation does not remove other automations attached to the same thread.
- Removing the final automation removes the thread row automation chip and returns the menu to `Add automation…`.
- Light and dark theme automation manager surfaces remain readable.

#### Rollback/Cleanup
- Remove any test automations from the thread automation dialog or delete their folders under `$CODEX_HOME/automations/<automation-id>/`.

### Feature: Project automations and `/automations` panel

#### Prerequisites
- App is running from this repository.
- At least two sidebar projects have absolute workspace paths.
- Local Codex home is writable (`$CODEX_HOME` or `~/.codex`).
- Light and dark themes are both available from Settings.

#### Steps
1. In light theme, open a project overflow menu for a project without an attached automation.
2. Confirm the menu shows `Add automation…`, then create a project automation with a name, prompt, RRULE schedule, and status.
3. Confirm the project row shows an automation chip and the same menu changes to `Manage automations…`.
4. Open `/automations` from the sidebar and confirm the new project automation appears with the visible project display name.
5. Edit the automation from `/automations`, change its name and status, save, and confirm the project row chip count and tooltip update without a full page refresh.
6. Seed or keep a cron automation record whose `cwds` contains two project paths, then edit it from one project and confirm both project rows show the updated name/status.
7. Seed a cron automation record with a TOML-style single-quoted `cwds` array such as `cwds = ['/tmp/project-one', '/tmp/project,two']`, refresh `/automations`, and confirm it is still listed.
8. Inspect `/codex-api/project-automations` for the seeded record and confirm the response includes public automation fields but not `extraTomlLines`.
9. Remove one project that has an attached automation while `/automations` is open and confirm the panel removes the deleted project row after the cleanup completes.
10. Switch to dark theme and repeat opening the project menu and `/automations`; confirm rows, chips, buttons, inputs, and empty states remain readable.

#### Expected Results
- Project-scoped cron automations are listed under every associated `cwd`.
- Editing a multi-`cwd` project automation refreshes all affected sidebar chips/tooltips, not only the currently edited project.
- Existing TOML cron records with valid non-JSON string arrays remain visible and manageable.
- Automation API responses do not include internal preserved TOML metadata such as `extraTomlLines`.
- Removing a project deletes or detaches that project's automation association and refreshes the `/automations` panel.
- Preserved TOML metadata and table sections remain intact after saving or deleting a project automation.
- Light and dark theme project automation surfaces remain readable.

#### Rollback/Cleanup
- Remove any test project automations from the project automation dialog or delete their folders under `$CODEX_HOME/automations/<automation-id>/`.
- Remove temporary test projects or workspace roots created for verification.

### Feature: Projectless new chat folders

#### Prerequisites
- App server is running from this repository.
- Home directory is writable.
- Light and dark themes are both available from Settings.

#### Steps
1. Open the app in light theme and click the sidebar `New chat` action while an existing thread is selected.
2. Confirm the home composer does not inherit the selected thread folder.
3. Send a first message with a unique prompt such as `Projectless folder smoke test`.
4. Confirm the new thread starts in `~/Documents/Codex/<YYYY-MM-DD>/projectless-folder-smoke-test`.
5. Start another new chat with the same prompt and confirm the folder receives a numeric suffix.
6. Switch to dark theme and repeat steps 1-3 with a different unique prompt.

#### Expected Results
- `New chat` starts as a projectless chat instead of reusing the current thread cwd.
- Sending the first message creates a real directory under `~/Documents/Codex/<YYYY-MM-DD>/`.
- Folder names are derived from the prompt using lowercase alphanumeric tokens, with suffixes for duplicates.
- Projectless chat rows appear in the `Chats` section and do not create a separate project group from the generated folder name.
- Short projectless prompts such as `hi` remain visible in `Chats` after the thread list refreshes and workspace-root filtering runs.
- If the selected model returns `requires a newer version of Codex`, the turn retries with `gpt-5.4-mini` instead of leaving the new chat failed on 5.5.
- Light and dark theme composer surfaces remain readable and unchanged apart from the folder behavior.

#### Rollback/Cleanup
- Delete only the test folders created under `~/Documents/Codex/<YYYY-MM-DD>/`.

## New chat project setup modal

### Feature: Unified create project and GitHub clone modal

Prerequisites/setup:
- Run the app with access to `git` and network access to `github.com`.
- Have a small public GitHub repository URL available for testing.

Steps:
1. Open the app in light theme and navigate to the new chat screen.
2. Confirm the folder actions show `Select folder` and `Create Project`.
3. Click `Create Project` and confirm a modal opens with `New project` and `Clone from GitHub` modes.
4. In `New project`, keep or edit the destination folder, enter a single folder name, and submit.
5. Confirm the created project folder is selected in the new chat folder selector and appears as a project root.
6. Reopen the modal, switch to `Clone from GitHub`, paste a valid `https://github.com/<owner>/<repo>` URL, and submit.
7. Confirm the cloned repository folder is selected in the new chat folder selector and appears as a project root.
8. Switch the app to dark theme and repeat opening the modal.
9. Confirm the modal, tabs, inputs, error message, and buttons have readable contrast and stable spacing.

Expected results:
- New project creation and GitHub cloning share one modal and destination folder field.
- Created and cloned folders are registered as project roots and selected for the new chat.
- After cloning, the folder selector immediately includes the cloned project without a full page refresh.
- Invalid project names or non-GitHub URLs show an inline modal error without changing the selected folder.
- A stalled clone eventually fails with an error instead of keeping the request open indefinitely.
- Light and dark themes render the unified modal consistently with the existing new-chat controls.

Rollback/cleanup:
- Remove the created project folder from the filesystem if it was only used for testing.
- Remove the cloned repository folder from the filesystem if it was only used for testing.
- Remove the test projects from the app project list if they are no longer needed.

### Feature: Empty project new thread action

#### Prerequisites
- App server is running from this repository.
- At least one workspace root is registered that has no threads.
- Light and dark themes are both available from Settings.

#### Steps
1. Open the app in light theme.
2. Find the empty project row in the sidebar that shows `No threads`.
3. Click that project's new thread icon.
4. Confirm the home composer opens and the folder dropdown is set to the empty project's workspace root.
5. Switch to dark theme and repeat steps 2-4.

#### Expected Results
- The new thread icon works for projects with zero threads.
- The new thread screen uses the clicked project's registered workspace root instead of leaving the folder blank or reusing another project.
- Light and dark theme sidebar and composer surfaces remain readable.

#### Rollback/Cleanup
- No cleanup is required unless a test message is sent; delete that test thread if created.

### Feature: Start new thread header Git branch dropdown

#### Prerequisites
- App server is running from this repository.
- At least one Git-backed workspace folder is available in the Start new thread folder dropdown.
- Light and dark themes are both available from Settings.

#### Steps
1. Open the app in light theme.
2. Click the sidebar or header new thread icon to open Start new thread.
3. Select a Git-backed folder.
4. Confirm the header actions next to the terminal control show the Git checkout branch dropdown.
5. Open the branch dropdown and confirm branch search/options are available.
6. Switch to dark theme and repeat steps 2-5.

#### Expected Results
- Start new thread shows the same header Git checkout dropdown used by existing thread pages when the selected folder is a Git repository.
- Switching the selected folder updates the dropdown branch state for that folder.
- Non-Git folders do not show the Git checkout dropdown.
- Light and dark theme header controls remain readable and aligned.

#### Rollback/Cleanup
- If a branch was switched during testing, switch back to the original branch before continuing.

### Feature: Telegram bot token stored in dedicated global file

#### Prerequisites
- App server is running from this repository.
- A valid Telegram bot token is available.
- At least one Telegram user ID is available for allowlisting.
- Access to `~/.codex/` on the host machine.

#### Steps
1. In the app UI, open Telegram connection and submit a bot token plus one or more allowed Telegram user IDs.
2. Verify file `~/.codex/telegram-bridge.json` exists.
3. Open `~/.codex/telegram-bridge.json` and confirm it contains `botToken` and `allowedUserIds` fields.
4. Restart the app server and call Telegram status endpoint from UI to confirm it still reports configured.

#### Expected Results
- Telegram token is persisted in `~/.codex/telegram-bridge.json`.
- Telegram allowlisted user IDs are persisted in `~/.codex/telegram-bridge.json`.
- Telegram bridge remains configured after restart.

#### Rollback/Cleanup
- Remove `~/.codex/telegram-bridge.json` to clear saved Telegram token.

### Feature: Telegram chatIds persisted for bot DM sending

#### Prerequisites
- App server is running from this repository.
- Telegram bot already configured in the app.
- Access to `~/.codex/telegram-bridge.json`.

#### Steps
1. Send `/start` to the Telegram bot from your DM.
2. Wait for the app to process the update, then open `~/.codex/telegram-bridge.json`.
3. Confirm `chatIds` contains your DM chat id as the first element.
4. In the app, reconnect Telegram bot with the same token.
5. Re-open `~/.codex/telegram-bridge.json` and confirm `chatIds` remains present.

#### Expected Results
- `chatIds` is written after Telegram DM activity.
- `chatIds` persists across bot reconfiguration.
- `botToken`, `chatIds`, and `allowedUserIds` are all present in `~/.codex/telegram-bridge.json`.

#### Rollback/Cleanup
- Remove `chatIds` or delete `~/.codex/telegram-bridge.json` to clear persisted chat targets.

### Feature: Telegram bridge rejects unauthorized senders

#### Prerequisites
- App server is running from this repository.
- Telegram bot is configured with a known `allowedUserIds` entry.
- One Telegram account is allowlisted and one separate Telegram account is not.

#### Steps
1. From the allowlisted Telegram account, send `/start` to the bot.
2. Confirm the bot responds normally.
3. From the non-allowlisted Telegram account, send `/start` to the same bot.
4. From the non-allowlisted account, send a normal text prompt.

#### Expected Results
- The allowlisted account can use the Telegram bridge normally.
- The non-allowlisted account receives an unauthorized response.
- No thread is created or updated for the non-allowlisted account.

#### Rollback/Cleanup
- Remove test chat mappings from `~/.codex/telegram-bridge.json` if needed.

### Feature: Skills dropdown closes after selection in composer

#### Prerequisites
- App is running from this repository.
- At least one thread exists and can be selected.
- At least one installed skill is available.

#### Steps
1. Open an existing thread so the message composer is enabled.
2. Click the `Skills` dropdown in the composer footer.
3. Click any skill option in the dropdown list.
4. Re-open the `Skills` dropdown and click the same skill again to unselect it.

#### Expected Results
- The skills dropdown closes immediately after each selection click.
- Selected skill appears as a chip above the composer input when checked.
- Skill chip is removed when the skill is unchecked on the next selection.

#### Rollback/Cleanup
- Remove the selected skill chip(s) before leaving the thread, if needed.

### Feature: Skills Hub local-only installed skills

#### Prerequisites
- App is running from this repository.
- Open the `Skills Hub` view.

#### Steps
1. Open `Skills Hub`.
2. Confirm the page shows only locally installed skills.
3. Confirm there is no remote skill count such as `6818 skills`.
4. Confirm there are no remote browse cards from the OpenClaw catalog.

#### Expected Results
- Skills Hub does not fetch or display the OpenClaw remote skills catalog.
- Only locally installed skills are shown.
- No remote total-count badge is rendered.

#### Rollback/Cleanup
- None.

---

### Background dictation transcription continues after thread navigation

#### Feature/Change Name
Background dictation transcription and target-thread auto-send.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`).
2. Microphone permission granted for the browser.
3. Voice transcription configured and working for `/codex-api/transcribe`.
4. At least two existing threads are available in the sidebar.
5. Light theme and dark theme are available from the appearance setting.

#### Steps
1. In light theme, open an existing thread and start dictation from the composer.
2. Speak a short unique phrase, then stop dictation.
3. Immediately switch to another existing thread or project folder while the composer shows background transcription status.
4. Wait for transcription to complete.
5. Return to the original thread.
6. Confirm the transcribed phrase was sent to the original thread, not the currently selected thread.
7. Attach an image or screenshot, type a short prefix such as `text and screenshot`, start dictation, speak a second unique phrase, stop dictation, and immediately switch to another thread.
8. Return to the original thread after transcription completes and confirm one sent message contains the typed prefix, the transcribed phrase, and the image attachment.
9. Confirm the source draft is cleared only when it still matches the captured snapshot; if text or attachments were changed after stopping dictation, confirm those later edits remain in the draft.
10. Repeat with the original thread busy and the composer send mode set to Queue; confirm the combined text/image message appears as a queued turn or starts when the thread becomes idle.
11. Repeat with the original thread busy and the composer send mode set to Steer; confirm the combined text/image message is sent as an immediate steer turn for the original thread.
12. Use the "Transcribe dictation into draft" action and navigate away; return to the original thread and confirm the transcript is appended to that thread draft without auto-sending.
13. Switch to dark theme and repeat steps 1-12.
14. From the new-thread/home composer, record dictation and confirm the original inline flow still creates or fills the new-thread draft instead of trying to target `__new-thread__`.

#### Expected Results
- Stopping dictation hands the saved recording to a background job before thread navigation changes the target.
- The background job transcribes independently of the active selected thread.
- Auto-send dispatches one combined message to the original existing thread, starting an idle thread or queueing a busy thread without changing the selected thread.
- A composer snapshot captured at dictation stop carries typed text, images, file attachments, and selected skills into the sent message with the transcript appended.
- Background transcription status clears promptly after completion and does not require switching away and back to update the composer.
- Source draft cleanup is snapshot-safe and does not delete edits made after recording stopped.
- Draft-only dictation appends to the original thread draft when the user returns.
- Light theme and dark theme status text remains readable and does not overlap composer controls.
- New-thread dictation keeps the pre-existing inline transcription behavior.

#### Rollback/Cleanup
- Delete any test messages or queued turns created during verification if they are not needed.

---

### Compact sidebar Skills and Automations links

#### Feature/Change Name
Compact sidebar entries for Skills and Automations.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`).
2. Sidebar is expanded.
3. Light theme and dark theme are available from the appearance switcher.

#### Steps
1. In light theme, open the main app route with the sidebar visible.
2. Confirm the Skills row shows a small bolt icon and the `Skills` label only.
3. Confirm the Automations row shows a small bolt icon and the `Automations` label only.
4. Confirm neither row shows secondary description text such as `Plugins, apps, MCPs` or `Scheduled work`.
5. Confirm the rows align visually with nearby compact sidebar rows such as Projects and thread entries.
6. Click Skills, then Automations, and confirm the active state remains compact.
7. Switch to dark theme and repeat steps 2-6.

#### Expected Results
- Skills and Automations render as compact one-line sidebar rows.
- Icons are the same small visual scale as the surrounding sidebar icons.
- Removed subtitle text does not leave extra vertical spacing.
- Hover and active states remain readable in light theme and dark theme.

#### Rollback/Cleanup
- None.

---

### Codex thread deep links render as local web thread URLs

#### Feature/Change Name
Codex thread link conversion in chat messages.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`).
2. A `TestChat` project/thread is available.
3. Light theme and dark theme are both available.
4. Note the current app origin from the browser address bar, for example `http://127.0.0.1:4173`.

#### Steps
1. In light theme, open `TestChat`.
2. Send or inspect a message containing a bare Codex thread link, for example `codex://threads/019e04cb-9670-7d91-be85-3ba35312170c`.
3. Send or inspect a message containing a Markdown Codex thread link, for example `[Open thread](codex://threads/019e04cb-9670-7d91-be85-3ba35312170c)`.
4. Confirm each rendered row contains a clickable `a.message-file-link`.
5. Confirm the bare link href and visible text both equal `<current app origin>/#/thread/019e04cb-9670-7d91-be85-3ba35312170c`, for example `http://127.0.0.1:4173/#/thread/019e04cb-9670-7d91-be85-3ba35312170c`.
6. Confirm the Markdown link href equals `<current app origin>/#/thread/019e04cb-9670-7d91-be85-3ba35312170c` and visible text equals `Open thread`.
7. Switch to dark theme and repeat steps 2 through 6.

#### Expected Results
- Bare `codex://threads/<id>` links render as local web thread URLs.
- Markdown links targeting `codex://threads/<id>` keep their Markdown label while linking to the local web thread URL.
- Link color and contrast remain usable in light theme and dark theme.

#### Rollback/Cleanup
- Revert the thread-link conversion in `src/components/content/ThreadConversation.vue` if `codex://threads/<id>` should render literally again.

---

### Bold-wrapped Markdown links render without literal markers

#### Feature/Change Name
Bold-wrapped Markdown link marker cleanup in chat messages.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`).
2. A `TestChat` project/thread is available.
3. Light theme and dark theme are both available.

#### Steps
1. In light theme, open `TestChat`.
2. Send or inspect a message containing a bold-wrapped Markdown link, for example `**https://anyclaw.store/claim/a7m2z7**` or `**[claim link](https://anyclaw.store/claim/a7m2z7)**`.
3. Repeat with triple-asterisk wrapping: `***https://anyclaw.store/claim/a7m2z7***` and `***[claim link](https://anyclaw.store/claim/a7m2z7)***`.
4. Confirm the rendered row contains one clickable `a.message-file-link` for the URL.
5. Confirm no literal `**`, `***`, or stray `*` characters appear before or after the link.
6. Switch to dark theme and repeat steps 2 through 5.

#### Expected Results
- Bold-wrapped and triple-asterisk-wrapped bare URLs and Markdown links render as clickable links without visible Markdown emphasis markers.
- Existing URL/file-link href, title, and visible link text behavior is unchanged.
- Link color and contrast remain usable in light theme and dark theme.

#### Rollback/Cleanup
- Revert the parser change in `src/components/content/ThreadConversation.vue` if bold-wrapped links need to show raw Markdown markers again.

---

### Qodo feedback diagnostics reliability fixes

#### Feature/Change Name
Feedback diagnostics startup hardening, project automation delete failure handling, and coalesced composer overflow measurement.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. At least one sidebar project with a configured project automation
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, temporarily make `DELETE /codex-api/project-automation` fail, for example by stopping the local API bridge or forcing a 500 response in a development proxy.
2. Open the project menu for a project with an automation and click Remove.
3. Confirm the sidebar does not trigger an unhandled promise rejection and shows a small project automation error message.
4. Restore the API bridge and refresh project automations.
5. Confirm the automation chip/server state is reloaded instead of staying optimistically removed.
6. Open the app in an environment where `window.fetch` is missing or read-only and confirm the app still mounts.
7. Trigger a chat send failure and click Send feedback next to the chat error.
8. Confirm Chrome or the OS opens the configured `mailto:` handler with `brutalstrikedevs@gmail.com`, diagnostics, bounded visible page text, and summarized browser/app state prefilled.
9. Type a long draft in the composer and confirm the expand control still appears when the textarea overflows.
10. Switch to dark theme and repeat steps 2-9.

#### Expected Results
- Project automation delete failures are caught, recorded in feedback diagnostics, and surfaced as a visible sidebar error.
- Automation state is restored or reloaded after a failed delete.
- Feedback diagnostics never prevent app startup when fetch cannot be patched.
- Chat and Skills Hub error feedback links use native `mailto:` anchor handling so Chrome can open the configured email handler, while static link `href` values stay minimal until click.
- Feedback email bodies include bounded visible page text alongside diagnostics.
- Feedback email bodies include localStorage/sessionStorage state, route/hash, online state, language, and platform, with sensitive-looking storage values omitted and oversized values summarized.
- Composer overflow checks remain functional without scheduling duplicate same-tick measurements.
- The sidebar error message remains readable in light theme and dark theme.

#### Rollback/Cleanup
- Restore any temporary API failure/proxy change.

---

### Composer expands long drafts to full screen

#### Feature/Change Name
Thread composer full-screen expand control for multi-line drafts.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. Any existing thread is open and send controls are enabled
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, type or paste at least six lines into the composer.
2. Confirm the expand button appears in the composer input area.
3. Click the expand button.
4. Confirm the composer fills the viewport, keeps the draft text, and leaves model/skill/thinking/send controls usable at the bottom.
5. Click the collapse button.
6. Confirm the composer returns to its normal inline size with the draft still intact.
7. Switch to dark theme and repeat steps 1-6.

#### Expected Results
- Short drafts do not show the expand control.
- Long or overflowing drafts show an icon-only expand control.
- Full-screen mode uses the same draft state and submit controls as inline mode.
- Full-screen and inline states are readable in light theme and dark theme.

#### Rollback/Cleanup
- Clear the draft from the composer.

---

### Error-triggered feedback button

#### Feature/Change Name
Feedback action appears in Settings and on visible error banners after captured UI/runtime/API failures, then opens prefilled email diagnostics.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173` or an alternate free port).
2. Browser devtools available to inject a test error or failed fetch.
3. Light theme and dark theme both available from the appearance switcher.

#### Steps
1. In light theme, load the home screen, open Settings, and confirm no `Send feedback` row is visible during a clean state.
2. Trigger a failure, for example run `fetch('/codex-api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })` in the browser console or open a folder path that produces a visible load error.
3. Reopen Settings and confirm a `Send feedback` row with `Issue detected` appears after the failed request is recorded.
4. Trigger or view a visible error banner, such as the missing Codex CLI composer banner, a chat send/connection error in the live conversation overlay, a settings provider error, a folder picker error, a Skills Hub error, or a branch dropdown error, and confirm that error state includes a compact `Send feedback` action.
5. Confirm no feedback action appears in the content header during normal use.
6. Click `Send feedback` and confirm the mail client opens a draft to `brutalstrikedevs@gmail.com`.
7. Confirm the draft body includes current URL, user agent, viewport, app/worktree version info, and recent diagnostics including the failed request or visible error.
8. Switch to dark theme and repeat steps 1-7.

#### Expected Results
- The settings feedback action is absent during normal operation.
- Runtime errors, unhandled rejections, failed fetches/API responses, and visible load failures make the Settings feedback action visible.
- Visible error states, including chat send/connection failures, include a local `Send feedback` action so the user can report the error from the same context.
- The generated `mailto:` draft is prefilled with useful diagnostics and does not submit anything automatically.
- No feedback action is shown in the app header during normal use.
- The Settings feedback row and visible-error feedback actions remain readable in light and dark themes.

#### Rollback/Cleanup
- Close the generated email draft without sending if this was only a test.

---

### Missing Codex CLI chat error

#### Feature/Change Name
Fresh installs without a runnable Codex CLI show a visible chat runtime error.

#### Prerequisites/Setup
1. Start the app in an isolated environment without `codex` in `PATH` and without `CODEXUI_CODEX_COMMAND`.
2. Use a mobile viewport such as `390x844`.
3. Light theme and dark theme both available from the appearance switcher when the app can reach settings.

#### Steps
1. In light theme, open the app home/new chat screen.
2. Confirm the composer area shows `Codex CLI not found. Install @openai/codex or set CODEXUI_CODEX_COMMAND.`
3. Confirm the model dropdown no longer fails silently as the only visible symptom.
4. Switch to dark theme and repeat steps 1-3.

#### Expected Results
- The missing CLI condition is visible in the chat/composer area.
- The banner remains readable and does not overlap the mobile composer controls.
- Dark theme uses a dark error surface, not a light-theme panel.

#### Rollback/Cleanup
- Stop and remove the isolated container or test server.

---

### Composio logged-out connector preview

#### Feature/Change Name
Logged-out Composio tab shows a promotional connector preview with example integrations and clear login/dashboard actions.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. Composio CLI installed
3. Composio CLI logged out (`~/.composio/composio logout`)
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open the Directory page and switch to the Composio tab.
2. Confirm the logged-out state shows the connector catalog preview hero instead of a plain empty message.
3. Confirm example connector cards are visible for Gmail, Google Calendar, Reddit, YouTube, Google Drive, and X.
4. Type `reddit` in the Composio search box and confirm the preview cards filter to matching example content.
5. Confirm `Login to Composio` starts the CLI login flow and `Open dashboard` opens the Composio dashboard URL.
6. Switch to dark theme and repeat steps 1-4.

#### Expected Results
- Logged-out users see a richer preview of likely Composio connector value without requiring live catalog data.
- The preview does not claim the example cards are connected; cards are labeled `Preview`.
- Search filters the preview cards while logged out.
- Login and dashboard actions remain available.
- The hero, cards, text, badges, and buttons remain readable in light and dark themes.

#### Rollback/Cleanup
- Re-login to Composio if needed with `~/.composio/composio login --no-browser -y`.

---

### Pinned threads remain visible during background pagination

#### Feature/Change Name
Pinned threads are no longer removed from the Pinned section while the sidebar is still loading older thread-list pages.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. More than 50 total unarchived threads exist
3. At least one older thread outside the initial recent page is pinned
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, reload the app.
2. Immediately open the sidebar Pinned section.
3. Confirm pinned rows from older history remain in the Pinned section after the initial thread list appears.
4. Wait for background thread pagination to finish.
5. Confirm the same pinned rows remain visible and can still be selected.
6. Switch to dark theme and repeat steps 1-5.

#### Expected Results
- Saved pinned thread IDs are preserved while only the initial thread-list page is loaded.
- Missing pinned IDs are pruned only after the full thread list has loaded.
- Pinned rows remain readable and selectable in both light and dark themes.

#### Rollback/Cleanup
- Unpin any disposable threads created only for this test.

---

### Startup avoids duplicate setup probes

#### Feature/Change Name
Startup loads Git repository status only for the active thread/new-thread cwd or an opened project menu, shares workspace-root state reads, and returns free-mode status without waiting on OpenRouter model discovery.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. Browser runtime profiler available (`pnpm run profile:browser`)
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, run `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_WAIT_MS=7000 pnpm run profile:browser`.
2. Inspect the generated `output/playwright/browser-runtime-profile-*.json`.
3. Confirm startup does not call `/codex-api/git/repository-status` once per visible project.
4. Confirm startup performs at most one `/codex-api/workspace-roots-state` GET before user actions.
5. Confirm `/codex-api/free-mode/status` completes without waiting for a live `https://openrouter.ai/api/v1/models` request.
6. Open a thread and confirm at most the selected thread cwd is checked with `/codex-api/git/repository-status`.
7. Open the project action menu for several projects and confirm Git-backed actions still appear only for Git repositories after each menu-specific status check.
8. Switch to dark theme and repeat steps 1-7.

#### Expected Results
- Initial sidebar Git status hydration does not scan every visible project.
- The `/codex-api/git/repository-status/batch` endpoint is not used.
- Git status checks are lazy and scoped to the active thread/new-thread cwd or the project menu being opened.
- App startup and initial thread loading share workspace-root state loading instead of issuing duplicate startup reads.
- Free-mode status returns cached or fallback model options immediately and refreshes model discovery in the background.
- Git-backed project menu actions remain correct in light theme and dark theme.
- Free-mode controls remain readable and functional in light theme and dark theme.

#### Rollback/Cleanup
- Remove generated `output/playwright/browser-runtime-profile-*` artifacts if they are not needed for comparison evidence.

---

### Revert PR 131 project recency and mobile move mode

#### Feature/Change Name
PR #131 revert: remove project recency ordering and mobile project move mode while preserving later sidebar actions.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Sidebar has at least two projects and projectless chats
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open the sidebar Projects section.
2. Open the Projects organize menu.
3. Confirm the menu still exposes thread organization and chat sort controls, but does not expose project recency/manual sort controls.
4. Open a project action menu and confirm browse, rename, remove, worktree, and git status actions still behave normally.
5. On a mobile-sized viewport, confirm there is no project move mode affordance or drag handle from PR #131.
6. Switch to dark theme and repeat steps 1-5.

#### Expected Results
- Project recency/manual sort controls from PR #131 are absent.
- Project pinning/move mode controls from PR #131 are absent.
- Existing sidebar project actions and git-status menu behavior remain available.
- Sidebar rows, menus, and actions remain readable in light and dark themes.

#### Rollback/Cleanup
- None.

---

### Qodo review fixes for PR 130 and PR 131 reverts

#### Feature/Change Name
Fix review regressions from reverting PR #130 and PR #131.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Sidebar has multiple projects, including duplicate folder leaf names when available
3. Sidebar has at least one projectless chat
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, search the sidebar so the project list is filtered.
2. Try to drag a project row while search is active.
3. Confirm no project drag or reorder starts during the filtered search view.
4. Clear search and drag a project row, then release it and confirm the follow-up click does not collapse or expand the dragged project unexpectedly.
5. Open a project menu near the bottom of the scrollable sidebar and confirm the menu opens upward only when needed and stays within the visible sidebar boundary.
6. Open or create a project whose folder leaf name collides with another root and confirm the intended full-path-disambiguated project moves to the top.
7. Confirm projectless chats with empty cwd remain visible when workspace roots are configured.
8. Switch to dark theme and repeat steps 1-7.

#### Expected Results
- Project dragging is disabled during sidebar search.
- Drag completion does not trigger an accidental project collapse or expansion.
- Project menu direction uses the rendered menu height and avoids viewport/sidebar overflow.
- Duplicate folder leaf names use the disambiguated project order name.
- Empty-cwd projectless chats remain visible.
- Sidebar rows, menus, and drag states remain readable in light and dark themes.

#### Rollback/Cleanup
- None.

---

### Composer mode scoping and Fast mode support

#### Feature/Change Name
Plan mode is scoped to the current chat instead of becoming the default for every chat, and Fast mode is available for supported GPT 5.4 and GPT 5.5 model IDs.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. At least two existing threads are available
3. Model list includes `gpt-5.4` or a `gpt-5.4-*` variant and `gpt-5.5` or a `gpt-5.5-*` variant
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open thread A, open the composer add menu, and enable Plan mode.
2. Open thread B and confirm Plan mode is off by default.
3. Return to thread A and confirm Plan mode remains on for that thread.
4. Open Start new thread, enable Plan mode, send a first message, and confirm the created thread starts in Plan mode.
5. Return to Start new thread again and confirm Plan mode is off for the next new chat.
6. Select `gpt-5.4` or a `gpt-5.4-*` model and confirm the Fast mode switch is visible.
7. Select `gpt-5.5` or a `gpt-5.5-*` model and confirm the Fast mode switch is visible.
8. Select an unsupported model family and confirm the Fast mode switch is hidden.
9. Switch to dark theme and repeat steps 1-8.

#### Expected Results
- Enabling Plan mode in one existing thread does not enable it in other existing threads.
- A new-chat Plan mode selection applies to the created chat but does not persist as the default for later new chats.
- Fast mode is visible for GPT 5.4 and GPT 5.5 model IDs, including dashed variants.
- Fast mode remains hidden for unsupported model families.
- Composer controls and menus remain readable in light and dark themes.

#### Rollback/Cleanup
- Turn Plan mode off in any test threads if desired.

---

### Lazy project Git status checks

#### Feature/Change Name
Project Git repository status is loaded lazily from project menus instead of scanning every visible project during startup.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. Sidebar contains multiple projects, including at least one Git-backed project and one non-Git project
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, load the home route and confirm the Projects section renders normally.
2. Open browser devtools or runtime profile output and confirm startup does not issue one `/codex-api/git/repository-status` request per visible project.
3. Open the action menu for a Git-backed project.
4. Confirm the menu remains readable and the `New worktree` item appears after the Git status check completes.
5. Right-click the header row for the same Git-backed project.
6. Confirm the context menu remains readable and the `New worktree` item appears after the Git status check completes.
7. Open the action menu for a non-Git project.
8. Confirm the menu remains readable and `New worktree` is not shown.
9. Switch to dark theme and repeat steps 3 through 8.

#### Expected Results
- Startup avoids eager Git status scans for all project rows.
- Opening a project menu through click or right-click still loads that project's Git status on demand.
- Menus re-measure placement after async Git status updates add the `New worktree` row.
- `New worktree` remains available for Git-backed projects and hidden for non-Git projects.
- Project menus remain usable and visually consistent in both light and dark themes.

#### Rollback/Cleanup
- None.

---

### Thread archive recovery and sidebar pruning

#### Feature/Change Name
Deleting a thread recovers from Codex `no rollout found` archive failures and removes successfully archived threads from the sidebar immediately.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Codex CLI available on `PATH`
3. At least one normal thread and one newly-created thread that has not yet produced a rollout
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, create a new empty thread from the sidebar.
2. Open that thread's menu and choose `Delete thread`.
3. Confirm the thread disappears from the sidebar without a `no rollout found` error.
4. Rename another visible thread, then delete it.
5. Confirm the renamed thread disappears immediately and does not reappear after sidebar refresh/background pagination.
6. Call `thread/list` with `archived:false` through `/codex-api/rpc` and confirm the deleted thread ids are absent.
7. Call `thread/list` with `archived:true` and confirm the deleted thread ids are present.
8. Switch to dark theme and repeat steps 1-5.

#### Expected Results
- Empty or not-yet-materialized threads are archived after CodexUI sets a fallback name and retries.
- Already archived threads are treated as archived instead of surfacing a stale `no rollout found` error.
- The sidebar prunes archived ids from its accumulated paginated list before refreshing.
- Older unarchived threads may appear as the list refills, but archived threads do not remain visible.
- Behavior is consistent in light and dark themes.

#### Rollback/Cleanup
- None.
### Unread thread cutoff state

#### Feature/Change Name
Unread thread state uses a local cutoff timestamp so existing threads are not all marked unread after first load.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`).
2. Browser localStorage is available for the app origin.
3. At least two existing threads are present.
4. Light theme and dark theme are available from the appearance switcher.

#### Steps
1. Clear only `codex-web-local.thread-unread-cutoff.v1` from localStorage for the app origin.
2. Load the app in light theme.
3. Confirm existing threads are not all marked unread on first load.
4. Create or receive an update in a different thread after the app has loaded.
5. Confirm that updated thread can show unread when it is not selected or in progress.
6. Create or receive an update in a second unselected thread.
7. Open the first updated thread and confirm only that thread's unread indicator clears.
8. Confirm the second updated thread remains unread until it is opened.
9. Switch to dark theme and repeat steps 4 through 8.

#### Expected Results
- Missing cutoff state initializes to the current time instead of treating every thread as unread.
- Threads updated after the cutoff can still become unread.
- Opening a thread updates only that thread's read state and clears only that thread's unread indicator.
- Unread indicators remain readable in both light theme and dark theme.

#### Rollback/Cleanup
- Remove any disposable test threads created for this validation.

---

### CLI password output redaction

#### Feature/Change Name
CLI startup output no longer prints the configured password or embeds it in the tunnel URL.

#### Prerequisites/Setup
1. Project dependencies are installed.
2. CLI build is available from the current branch.

#### Steps
1. Run `pnpm run build:cli`.
2. Start the CLI with a disposable password: `node dist-cli/index.js --no-tunnel --no-open --port 5998 --password TEST_SECRET_SHOULD_NOT_PRINT`.
3. Confirm startup output includes the local and network URLs.
4. Confirm startup output does not include `Password:` or `TEST_SECRET_SHOULD_NOT_PRINT`.
5. Start the CLI without an explicit password and confirm startup output prints `Generated password file:` with a path under `$CODEX_HOME`.
6. Confirm the generated password file exists, is readable by the current user, and has `0600` permissions.
7. If tunnel testing is available, start with tunnel enabled and confirm the printed tunnel URL and QR code do not include `/password=`.

#### Expected Results
- Password-protected startup still works.
- The password is not printed as a standalone line.
- Auto-generated passwords remain discoverable through the generated password file path.
- Tunnel output does not include an autologin URL containing the password.

#### Rollback/Cleanup
- Stop the disposable CLI process.

---

### Composer skill chip opens SKILL.md

#### Feature/Change Name
Selected skill labels in the thread composer open that skill's `SKILL.md` in the web file browser.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. At least one installed skill is available in the composer skill picker
3. Browser pop-ups from the local dev origin are allowed
4. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, open any thread with the composer enabled.
2. Open the `Skills` picker and select an installed skill.
3. Confirm the selected skill appears as a green chip above the input field.
4. Click the skill name on the green chip.
5. Confirm a new tab opens to `/codex-local-browse.../SKILL.md` for that skill.
6. Return to the composer and click the chip `x`.
7. Confirm the skill is removed and no file-browser tab is opened by the remove action.
8. Switch to dark theme and repeat steps 2 through 7.

#### Expected Results
- The skill chip label is clickable and opens the selected skill's `SKILL.md` in the web file browser.
- Skill paths that point at a skill directory are normalized to the nested `SKILL.md` file.
- The remove button still only removes the skill from the composer.
- The chip and focus/hover states remain readable in light theme and dark theme.

#### Rollback/Cleanup
- Close any file-browser tabs opened during validation.

---

### npx run dev compatibility shim

#### Feature/Change Name
The accidental `npx run dev` command starts the repository dev wrapper instead of failing with a missing `dev` module.

#### Prerequisites/Setup
1. Run from the repository root.
2. Local dependencies are available, or the dev wrapper can install them with `pnpm install`.
3. Port 5173 is free, or Vite can select the next available port.

#### Steps
1. Run `npx run dev`.
2. Confirm the command reaches the existing `scripts/dev.cjs` wrapper and starts Vite.
3. Stop the dev server with Ctrl-C.
4. Repeat with `npx run dev --host 127.0.0.1 --port 4173`.

#### Expected Results
- `npx run dev` no longer fails with `Cannot find module '<repo>/dev'`.
- The command starts the same dev server path as `npm run dev` / `pnpm run dev`.
- Host and port arguments are passed through to Vite.

#### Rollback/Cleanup
- Stop any dev server process started for validation.

---

### Selected skills visible on sent chat messages

#### Feature/Change Name
Selected composer skills are shown as skill chips on the user message after send/history load.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. At least one installed skill is available in the composer `Skills` dropdown
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open an existing thread or start a new thread.
2. Open the composer `Skills` dropdown and select one skill.
3. Type and send a short message.
4. Confirm the sent user message shows a `Skill` chip with the selected skill name.
5. Click the skill chip and confirm the current browser tab opens the skill `SKILL.md` file through the local browse view.
6. Refresh or reopen the thread and confirm the same skill chip remains visible and clickable in history.
7. Switch to dark theme and repeat steps 2-6 with another message.

#### Expected Results
- Selected skills are visible on the user message, not only in the composer before send.
- Skill chips show the skill name and expose the skill path in the tooltip.
- Skill chips link to the selected skill file using the local browse route in the current tab.
- Skill chips remain visible after thread history reload.
- Skill chips are readable in both light and dark themes.

#### Rollback/Cleanup
- Remove disposable test messages/threads if needed.

---

### Session skill recovery cache and multi-message placement

#### Feature/Change Name
Recovered selected-skill metadata is cached per session log and attached to the latest user message in the turn.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. At least one installed skill is available in the composer `Skills` dropdown
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open an existing thread or start a new thread.
2. Select one skill from the composer `Skills` dropdown.
3. Type and send a short message.
4. Refresh or reopen the same thread twice.
5. Confirm the sent user message still shows one skill chip and does not accumulate duplicate chips.
6. Switch to dark theme and repeat steps 2-5 with another message.
7. Run `pnpm vitest run src/server/codexAppServerBridge.inlinePayload.test.ts`.

#### Expected Results
- Skill metadata recovered from session JSONL remains visible after repeated history loads.
- Repeated loads reuse the unchanged session recovery parse instead of reparsing the same log for every turn-bearing RPC.
- In turns with multiple user-message items, recovered skill chips are attached to the latest user message in that turn.
- Skill chips remain readable in both light and dark themes.

#### Rollback/Cleanup
- Remove disposable test messages/threads if needed.

---

### Skills sync idempotent commits and nested shared skills handling

#### Feature/Change Name
Skills Sync skips unchanged manifest writes and does not fail parent commits when only nested `shared_skills` content is dirty.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 5173`)
2. GitHub Skills Sync is connected to a private skills sync repo
3. `/Users/igor/.codex/skills/shared_skills` exists as a nested Git repository
4. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, open `#/skills`.
2. Click `Startup Sync` when no installed skills manifest content has changed.
3. Confirm the sync completes without adding a new `Update synced skills manifest` commit to the GitHub repo.
4. Modify a file inside `/Users/igor/.codex/skills/shared_skills` without committing it inside that nested repository.
5. Click `Push` or `Startup Sync` again.
6. Confirm the sync does not show `Command failed (git commit -m Sync installed skills folder and manifest)` for the parent `/Users/igor/.codex/skills` repository.
7. Confirm the startup auto-push path skips when the only local status is dirty nested `shared_skills` content and local `HEAD` equals `origin/main`.
8. Switch to dark theme and repeat steps 1, 2, and 5.

#### Expected Results
- Unchanged `installed-skills.json` content is not written back to GitHub, so repeated empty-looking manifest commits are not created.
- A dirty nested `shared_skills` repository does not make the parent skills sync fail with `no changes added to commit`.
- Dirty nested `shared_skills` content alone does not keep triggering no-op startup push work.
- Skills Sync status, errors, and action buttons remain readable in light theme and dark theme.

#### Rollback/Cleanup
- Revert or commit the intentional test edit inside `/Users/igor/.codex/skills/shared_skills`.

---

### Header Git branch dropdown with commit reset

#### Feature/Change Name
Thread header Git dropdown replaces the simple review action with branch search, Review access, safe branch switching, branch reset-to-commit, and reset-history commit preservation.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open a thread whose `cwd` is inside a Git repository with at least two branches and several commits
3. Use a disposable local branch with at least two commits ahead of its reset target.
4. Ensure the repository has no tracked uncommitted changes for successful branch switch/reset paths: `git -C <thread-cwd> status --porcelain`
5. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, open the Git dropdown in the thread header.
2. Confirm the trigger shows the current branch, or the detached commit subject if the repository is already detached.
3. Click `Review` and confirm the review pane opens; click it again and confirm the pane toggles.
4. Type part of a branch name in search and confirm the branch list filters.
5. Select a different branch with a clean worktree and confirm the header updates to that branch.
6. Expand a branch row and confirm recent commits load with short SHA, subject, and date.
7. Expand a remote branch row and confirm its commit rows are disabled with a tooltip explaining remote branches cannot be reset.
8. Select an older commit on the disposable local branch and confirm the header stays on that branch instead of entering detached HEAD.
9. Confirm `git -C <thread-cwd> rev-parse --abbrev-ref HEAD` still prints the branch name and `git -C <thread-cwd> rev-parse --short HEAD` matches the selected commit.
10. Reopen/expand the same branch and confirm commits that were ahead of the reset target still appear, with the selected branch HEAD marked `current`.
11. Repeat reset on the same branch several times and confirm the dropdown still opens quickly and shows recent reset-history commits.
12. Create a tracked uncommitted change, try to switch branch or reset to a commit, and confirm the dropdown shows a dirty-worktree error instead of switching or resetting.
13. Create only an untracked file, try to reset to a commit, and confirm the reset proceeds unless Git reports the untracked file would be overwritten.
14. Switch to dark theme and repeat steps 1, 2, 4, 6, 7, 10, 12, and 13.

#### Expected Results
- The header dropdown exposes Review, current checkout state, searchable branches, and inline commits.
- Branch switching and branch reset-to-commit are blocked by tracked uncommitted changes, but untracked-only changes are allowed unless Git would overwrite them.
- Commit selection resets the local branch to that commit instead of detaching HEAD.
- Remote branch commit rows are inspectable but cannot trigger local branch reset.
- The branch commit list still shows commits that were ahead of the reset target by reading saved internal reset-history refs.
- Reset-history refs are bounded so repeated resets do not grow commit-list inputs without limit.
- The selected branch HEAD commit is marked `current` in expanded commit lists.
- Loading and error messages remain visible in the dropdown without using browser alerts.
- Dropdown surfaces, text, badges, and errors are readable in both light theme and dark theme.

#### Rollback/Cleanup
- Restore any dirty-worktree file changed for validation.
- Restore or delete the disposable branch used for reset validation.

---

### Termux install without native PTY build

#### Feature/Change Name
Android Termux installs can complete when `node-pty` has no compatible native build.

#### Prerequisites/Setup
1. Android device or emulator with Termux installed.
2. Node.js and npm available in Termux.
3. Network access to npm and GitHub.
4. A macOS or Linux desktop remains available for supported-host integrated terminal checks.
5. Light theme and dark theme are available from the appearance switcher on the desktop check.

#### Steps
1. In Termux, run `npm i -g codexapp@latest` after the fixed version is published.
2. Confirm installation does not fail if npm cannot build `node-pty` for `android-arm64`.
3. Run `codexapp --no-login` in Termux.
4. Open the printed URL and confirm the app loads.
5. Open a thread and confirm the integrated terminal reports unavailable instead of crashing the server if native PTY support is missing.
6. On macOS or Linux, run `npm i -g codexapp@latest`, then start `codexapp --no-login`.
7. Open a thread in light theme and confirm the integrated terminal still opens on the supported host.
8. Switch to dark theme and confirm the integrated terminal remains readable.

#### Expected Results
- Termux install completes even when `node-pty` cannot build on Android.
- The Termux app server starts and the browser UI loads.
- Missing native PTY support disables only the integrated terminal, not the whole app.
- Supported hosts still install `node-pty` and keep integrated terminal behavior in light theme and dark theme.

#### Rollback/Cleanup
- Remove test global installs with `npm rm -g codexapp`.

---

### Composer controls stay editable during responses

#### Feature/Change Name
Model, skill, thinking, and plan controls remain usable while a thread turn is in progress.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. A thread that can produce a long enough response to interact with the composer while the assistant is responding
3. At least one installed skill or saved prompt
4. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, send a message that starts an assistant response.
2. While the response is still streaming, type a follow-up draft in the composer.
3. Open the model dropdown and select a different model.
4. Open the skills dropdown and select a skill or saved prompt.
5. Open the thinking dropdown and select a different value.
6. Open the attachment menu and toggle plan mode.
7. Verify the stop button and send/queue behavior still match the in-progress turn state.
8. Switch to dark theme and repeat steps 1 through 7.

#### Expected Results
- The message textarea remains editable while the assistant is responding.
- Model, skills, thinking, and plan controls are not disabled during the in-progress response.
- Selected controls update the composer state for the next submitted or queued message.
- Stop remains available while no draft content is present, and the submit button switches to the configured steer/queue behavior when draft content exists.
- Light-theme and dark-theme controls remain readable and do not overlap.

#### Rollback/Cleanup
- Remove any disposable queued messages or test skill selections from the thread.

### Feature: Remove GitHub trending projects from the new-thread screen

#### Prerequisites
- App is running from this repository.
- Home/new-thread screen is open.
- Any previously saved local storage value for `codex-web-local.github-trending-projects.v1` may still exist from older builds.

#### Steps
1. Open Settings and inspect the available rows.
2. Confirm there is no `GitHub trending projects` toggle.
3. Return to the home/new-thread screen and confirm no trending cards or scope dropdown are shown.
4. Refresh the page and confirm the UI stays unchanged even if the old local storage key exists.

#### Expected Results
- Settings no longer offers any GitHub trending projects preference.
- The home/new-thread screen no longer renders a trending projects section.
- Refreshing does not restore the removed feature from stale local storage.

#### Rollback/Cleanup
- None.

### Feature: Dark theme for worktree runtime selector and Skills Hub

#### Prerequisites
- App is running from this repository.
- Appearance is set to `Dark` in Settings.
- Skills Hub route is accessible.

#### Steps
1. Open the home/new-thread screen and inspect the `Local project / New worktree` runtime selector trigger.
2. Open the runtime selector and verify menu title, options, selected state, and checkmark visibility in dark mode.
3. Trigger a worktree action that shows worktree status and verify running/error status blocks remain readable in dark mode.
4. Open `Skills Hub` and verify header/subtitle, search bar, search/sort buttons, sync panel, badges, and status text.
5. Verify at least one skill card surface (title, owner, description, date, browse icon) in dark mode.
6. Open a skill detail modal and verify panel, title/owner, close button, README/body text, and footer actions in dark mode.

#### Expected Results
- Runtime dropdown trigger and menu use dark backgrounds, borders, and readable text/icons.
- Worktree status blocks use dark-friendly contrast for both running and error states.
- Skills Hub controls and sync panel are fully dark-themed with consistent hover/active states.
- Skill cards and the skill detail modal render with dark theme colors and accessible contrast.

#### Rollback/Cleanup
- Reset appearance to the previous user preference.

### Feature: Markdown file links with backticked filename labels render correctly

#### Prerequisites
- App is running from this repository.
- An active thread is open.
- Light and dark themes are both available.
- Local file exists at `/home/ubuntu/andClaw-srcmatch/app/src/main/java/com/coderred/andclaw/ui/util/TrustedBrowserLauncher.kt`.

#### Steps
1. In light theme, send a message containing: `Added [`TrustedBrowserLauncher.kt`](/home/ubuntu/andClaw-srcmatch/app/src/main/java/com/coderred/andclaw/ui/util/TrustedBrowserLauncher.kt)`.
2. Confirm the rendered message shows one clickable file link with visible text `TrustedBrowserLauncher.kt`.
3. Click the link and confirm it opens local browse for `/home/ubuntu/andClaw-srcmatch/app/src/main/java/com/coderred/andclaw/ui/util/TrustedBrowserLauncher.kt`.
4. Right-click the same link and choose `Copy link`, then paste it into a text field and inspect it.
5. Switch to dark theme and repeat steps 1-4.

#### Expected Results
- The markdown link renders as one clickable file link instead of splitting around backticks.
- The visible link text is the markdown label `TrustedBrowserLauncher.kt`, without backtick glyphs.
- Clicking opens the local browse route for the full file path.
- Copied link includes the full encoded path and still resolves to the same file.
- Light and dark theme message surfaces keep the link readable and styled consistently.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Deferred ancillary startup refreshes

#### Prerequisites
- App is running from this repository.
- At least one large existing thread is available in the sidebar.
- Browser runtime profiler can run with Playwright from this repository.

#### Steps
1. Open a large thread route directly, for example `#/thread/<thread-id>`.
2. Confirm the thread message history appears before non-critical metadata finishes refreshing.
3. Run `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_ROUTE="#/thread/<thread-id>" PROFILE_WAIT_MS=7000 node scripts/profile-browser-runtime.cjs`.
4. Open the generated JSON report under `output/playwright/`.
5. Inspect `slowestApiRows` and `duplicateCounts`.

#### Expected Results
- The selected thread uses exactly one `thread/resume` and zero `thread/read` calls during initial load.
- Direct thread route hydration has one owner and does not trigger duplicate selected-thread message loads from route watchers.
- Thread history loading is not blocked by waiting for `skills/list`, `account/rateLimits/read`, or `collaborationMode/list`.
- Skills, model metadata, rate limits, and collaboration modes still populate shortly after the thread is visible.
- The profiler report has no duplicate-load warnings.

#### Rollback/Cleanup
- Remove generated `output/playwright/browser-runtime-profile-*` artifacts if they are not needed for comparison evidence.

### Feature: Runtime selector uses a toggle-style control

#### Prerequisites
- App is running from this repository.
- Home/new-thread screen is open.

#### Steps
1. On the home/new-thread screen, locate the runtime control below `Choose folder`.
2. Verify both options (`Local project` and `New worktree`) are visible at once without opening a menu.
3. Click `New worktree` and confirm it becomes the selected option style.
4. Click `Local project` and confirm selection returns.
5. Set Appearance to `Dark` in Settings and verify selected/unselected contrast remains readable.

#### Expected Results
- Runtime mode is presented as a two-option toggle (segmented control), not a dropdown menu.
- Clicking each option immediately switches the selected state.
- Selected option has a distinct active background/border in both light and dark themes.

#### Rollback/Cleanup
- Leave runtime mode and appearance at the previous user preference.

### Feature: Dark theme states for runtime mode toggle

#### Prerequisites
- App is running from this repository.
- Home/new-thread screen is open.
- Appearance is set to `Dark` in Settings.

#### Steps
1. Locate the runtime mode toggle (`Local project` and `New worktree`) under `Choose folder`.
2. Hover each option and verify hover state is visible against dark backgrounds.
3. Select `New worktree`, then select `Local project` and compare active/inactive contrast.
4. Tab to the toggle options with keyboard navigation and verify the focus ring is visible.
5. Confirm icon color remains readable for selected and unselected options.

#### Expected Results
- Toggle container, options, and text/icons use dark-friendly colors.
- Hover and selected states are clearly distinguishable in dark mode.
- Keyboard focus ring is visible and does not blend into the background.

#### Rollback/Cleanup
- Return appearance and runtime selection to the previous user preference.

### Feature: Per-thread model selection

#### Prerequisites
- App is running from this repository against a Codex app-server that supports thread-scoped model persistence.
- At least two selectable models are available in the composer model picker.
- At least one existing thread is available, or you can create one during the test.

#### Steps
1. On the new-thread screen, choose model `A` in the composer.
2. Send a message to create a new thread.
3. In that thread, switch the composer model to model `B`.
4. Send another message in the same thread so the thread persists model `B`.
5. Create or open a different thread and set its model to model `A`.
6. Switch back and forth between the two threads.
7. Refresh the browser while one of the threads is selected.
8. Re-open both threads again after the refresh.
9. While thread `A` is selected, use the sidebar thread menu to fork thread `B`.
10. Open the forked thread and confirm the composer model matches thread `B`, not the currently selected thread.
11. Restart the app-server or otherwise force a model-list refresh that does not include one thread’s persisted model, then switch back to that thread.
12. Delete one of the test threads you changed, refresh the thread list, and continue switching between the remaining thread and the new-thread screen.

#### Expected Results
- Each thread restores its own last selected model when you switch threads.
- The new-thread screen keeps its own draft model selection instead of inheriting the last opened thread.
- After browser refresh, reopening a thread restores the model persisted for that thread.
- Forked or newly created threads keep the resolved model returned by Codex, including fallback to the supported default model when needed.
- Forking a nonselected thread from the sidebar uses that source thread’s persisted model.
- If the selected thread’s persisted model is not returned in the latest model list, the composer still shows that model as the active selection instead of falling back to the placeholder label.
- Removing a thread prunes its saved per-thread model state, and model selection continues to update normally for the remaining threads without runtime errors.

#### Rollback/Cleanup
- Reset each tested thread back to its original model selection if you changed an existing conversation for the test.

### Feature: Sandbox approval requests recognize newer Codex payloads

#### Prerequisites
- App is running from this repository with a Codex CLI/app-server version that can request approvals.
- `bubblewrap` is installed so sandboxed command approvals can be triggered.
- Approval policy is set to request approval on sandbox escalation.

#### Steps
1. Start a thread and ask Codex to run a command that requires approval outside the current sandbox.
2. Wait for the pending request panel to appear.
3. Confirm the request is shown as an approval prompt, not the generic fallback with `Return Empty Result` and `Reject Request`.
4. Verify the panel offers approval choices (`Yes`, `Yes for Session`, decline text field, `Skip`).
5. If the approval payload includes a command preview or writable root, verify that preview text is shown in the panel.

#### Expected Results
- Sandbox-related approval requests are classified as approvals even when Codex sends newer method or payload variants.
- The approval UI offers normal approval actions instead of the unknown-request fallback buttons.
- The request stays attached to the correct thread rather than only appearing as a global pending request.

#### Rollback/Cleanup
- Decline or skip the pending approval request after verification.

### Feature: MCP elicitation requests and thread status labels

#### Prerequisites
- App is running from this repository with a recent Codex CLI/app-server build.
- At least one configured MCP server can trigger `mcpServer/elicitation/request` or `item/permissions/requestApproval`.

#### Steps
1. Start a thread and trigger an MCP flow that asks for user input or permission approval.
2. Confirm the thread row status chip in the sidebar appears in English (`Awaiting approval` or `Awaiting response`).
3. Open the pending request panel for `mcpServer/elicitation/request`.
4. Confirm only the black pending-request panel is shown for the request; no duplicate yellow in-conversation request card should appear.
5. If the elicitation is `form` mode, verify the requested fields are rendered as inputs/selects/checkboxes based on the schema.
6. For a required form field that has no schema default, click `Continue` without answering it and verify the request stays open with a validation error instead of submitting a fabricated answer.
7. For an optional boolean or enum field that has no schema default, verify the control starts unselected rather than prefilled with `False` or the first enum option.
8. If the elicitation is `url` mode, verify an authorization link is shown only when the URL uses `http` or `https`.
9. Submit `Continue`, then repeat and verify `Decline` and `Cancel` are also available.
10. Trigger an `item/permissions/requestApproval` request and verify `Accept` and `Accept for Session` are shown instead of the generic fallback buttons.

#### Expected Results
- MCP elicitation requests no longer fall back to `Return Empty Result` / `Reject Request`.
- Pending requests are shown only once, in the dedicated black pending-request panel.
- Form-mode elicitation requests submit structured `{ action, content }` responses.
- Required MCP form fields without defaults must be answered explicitly before the request can be accepted.
- Optional MCP boolean/enum fields without defaults remain unset until the user chooses a value.
- URL-mode elicitation requests show an authorization link and submit a valid `{ action }` response.
- Non-HTTP(S) authorization URLs are not rendered as clickable links.
- Permissions approval requests submit proper permission grants with turn/session scope.
- Sidebar pending-request chips are displayed in English.

#### Rollback/Cleanup
- Decline or cancel the MCP request after verification, and close any opened authorization URL if it was only used for testing.

### Feature: pnpm dev script installs dependencies and starts Vite

### Feature: Tailscale CIDRs bypass password and Cloudflare tunnel is opt-in

#### Prerequisites
- App is running from this repository via CLI.
- A Tailscale client can reach the host over Tailscale IPv4 (`100.64.0.0/10`) or IPv6 (`fd7a:115c:a1e0::/48`).
- `cloudflared` is installed only if testing `--tunnel`.

#### Steps
1. Start CLI without tunnel flag: `npx codexapp --port 5900`.
2. From a Tailscale client, open `http://100.x.x.x:5900` using a host address in `100.64.0.0/10` (replace with host tailnet IP).
3. Confirm the app opens directly without the password login page.
4. (Optional IPv6 check) Open the same service using the host Tailscale IPv6 address in `fd7a:115c:a1e0::/48` and confirm it also bypasses password.
5. Stop the server and start again with tunnel enabled: `npx codexapp --port 5900 --tunnel`.
6. Confirm startup output now includes a `Tunnel:` URL only when `--tunnel` is provided.
7. Stop and restart once more without `--tunnel`, and verify no tunnel URL is printed.

#### Expected Results
- Requests from Tailscale IPv4 `100.64.0.0/10` are treated as trusted and do not require password sign-in.
- Requests from Tailscale IPv6 `fd7a:115c:a1e0::/48` are treated as trusted and do not require password sign-in.
- Cloudflare tunnel does not start by default.
- Cloudflare tunnel starts only when `--tunnel` is explicitly passed.

#### Rollback/Cleanup
- Stop the CLI process.
- If a cloudflared tunnel was started, ensure the tunnel child process has exited.

### Feature: Tunnel auto mode follows Tailscale IP detection

#### Prerequisites
- App is running from this repository via CLI.
- One environment with detected Tailscale IP (`100.64.0.0/10` or `fd7a:115c:a1e0::/48`) and one without (or simulated by disabling Tailscale).

#### Steps
1. Start server without explicit tunnel flags: `npx codexapp --port 5900`.
2. In a host where Tailscale IP is detected, verify startup output includes `Tunnel:`.
3. In a host where Tailscale IP is not detected, verify startup output does not include `Tunnel:`.
4. Start server with explicit override `--no-tunnel` and verify no `Tunnel:` output even when Tailscale IP is present.
5. Start server with explicit override `--tunnel` and verify `Tunnel:` output even when Tailscale IP is not present.

#### Expected Results
- Without explicit flags, tunnel enablement follows Tailscale IP detection.
- `--no-tunnel` always disables tunnel startup.
- `--tunnel` always enables tunnel startup.

#### Rollback/Cleanup
- Stop the CLI process after each verification run.
- Ensure cloudflared child process exits after shutdown.

### Feature: Reverse tunnel login is required unless request is trusted local or Tailscale

#### Prerequisites
- App is running with password enabled.
- One direct local browser session (`localhost`).
- One reverse tunnel path (for example SSH/Cloudflare forwarding) that reaches the same server.
- Optional Tailscale client in `100.64.0.0/10` or `fd7a:115c:a1e0::/48`.

#### Steps
1. Open app via `http://localhost:<port>` and confirm it opens without login when request is true local loopback.
2. Open app via reverse-tunnel URL and confirm login page is shown.
3. Enter correct password in reverse-tunnel URL and confirm session cookie allows access.
4. (Optional) Open app via Tailscale IP and confirm login is bypassed.

#### Expected Results
- Local loopback access is allowed without login prompt.
- Reverse-tunnel access does not bypass auth and requires password.
- Valid login on reverse-tunnel path creates session and grants access.
- Tailscale CIDR requests remain trusted.

#### Rollback/Cleanup
- Clear browser cookies for the app origin(s).
- Stop the CLI process.

### Feature: Cloudflare tunnel QR omits password auto-login path

#### Prerequisites
- App is running from this repository with password enabled.
- Cloudflare tunnel startup is enabled (`--tunnel` or auto-enabled path).

#### Steps
1. Start CLI and wait for tunnel output.
2. Verify the printed `Tunnel:` URL does not include a `/password=` suffix.
3. Scan the terminal QR code from a phone/browser.
4. Confirm first page load shows the password form when no trusted bypass applies.
5. Use the generated password file path from startup output to retrieve the password and sign in.

#### Expected Results
- Tunnel URL shown in startup output does not expose the password.
- QR code encodes the base tunnel URL without a password-bearing path.
- The generated password remains available from the local password file.
- Base tunnel URL requires login when no trusted bypass applies.

#### Rollback/Cleanup
- Stop the CLI process.
- Clear cookies for the tunnel origin if needed.

### Feature: No automatic restore of last active thread on startup

#### Prerequisites
- App is running from this repository.
- At least one existing thread is available.
- Browser local storage is enabled.

#### Steps
1. Open the app in a regular browser tab (`http://localhost:<port>/`), select any thread, then navigate back to home route (`#/`).
2. Refresh the browser tab.
3. Confirm the app remains on home route and does not auto-switch to `#/thread/:threadId`.
4. Install/open the app in PWA standalone mode, select any thread, navigate to `#/`, and relaunch the PWA.

#### Expected Results
- In regular browser-tab mode, startup does not restore and redirect to the last active thread.
- In PWA standalone mode, startup also does not restore and redirect to the last active thread.
- Existing `openProjectPath` startup behavior still opens the requested project on home.

#### Rollback/Cleanup
- Clear app local storage state if you need to reset startup behavior for retesting.

#### Prerequisites
- `pnpm` is installed globally (`npm i -g pnpm` or via corepack).
- Repository is cloned and `node_modules/` does not exist (or may be stale).

#### Steps
1. Remove `node_modules/` if present: `rm -rf node_modules`.
2. Run `pnpm run dev`.
3. Wait for Vite dev server to start and display the local URL.
4. Open the displayed URL in a browser.

#### Expected Results
- `pnpm install` runs automatically before Vite starts (dependencies are installed).
- Vite dev server starts successfully and serves the app.
- No `npm` commands are invoked.

#### Rollback/Cleanup
- None.

### Feature: Stop button interrupts active turn without missing turnId

### Feature: Default runtime uses workspace-write sandbox with on-request approvals

#### Prerequisites
- App server is running from this repository.
- No `CODEXUI_SANDBOX_MODE` or `CODEXUI_APPROVAL_POLICY` environment overrides are set for the launch shell.

#### Steps
1. Start the app normally from this repository without passing `--sandbox-mode` or `--approval-policy`.
2. Open the startup logs or terminal output and find the runtime summary.
3. Confirm the reported sandbox mode is `workspace-write`.
4. Confirm the reported approval policy is `on-request`.
5. Restart the app with explicit overrides, for example `--sandbox-mode danger-full-access --approval-policy never`, and confirm those override the defaults.
6. With those overrides still active, trigger an account flow that uses the temporary app-server path (for example a quota/account inspection request).
7. Confirm the temporary app-server request succeeds under the active override settings and does not behave as if it were still using the original startup defaults.

#### Expected Results
- Default launch uses `workspace-write` sandbox mode.
- Default launch uses `on-request` approval policy.
- Explicit CLI flags still override the defaults when provided.
- Temporary app-server spawns in account routes use the current env-derived runtime args, including CLI overrides.

#### Rollback/Cleanup
- Remove any temporary CLI overrides before leaving the environment.

### Feature: Backticked HTTP(S) URL renders as clickable link

#### Prerequisites
- App is running from this repository.
- An active thread is open.

#### Steps
1. Send a message containing exactly: `` `https://github.com/marmeladema` ``.
2. Find the rendered message row and inspect the backticked URL token.
3. Click the rendered URL.

#### Expected Results
- The backticked URL is rendered as a clickable link, not plain inline code text.
- Clicking opens `https://github.com/marmeladema` in a new tab.

#### Rollback/Cleanup
- None.

### Feature: Stop button interrupts active turn without missing turnId

### Feature: Windows npx install no longer depends on legacy PTY package

#### Prerequisites
- A Windows machine with Node.js and npm installed.
- No globally installed `codexapp` package.
- Clear any previous temporary npm cache for `codexapp` if needed.

#### Steps
1. Run `npx codexapp --no-login` on Windows.
2. Confirm npm does not print deprecation warnings for `prebuild-install`, `npmlog`, `are-we-there-yet`, or `gauge` during package install.
3. Exit the app, then run `npx codexapp --no-login` again.
4. Run `npm i -g codexapp` on Windows.
5. Start the globally installed CLI with `codexapp --no-login`.
6. On macOS or Linux, start the app normally and confirm the integrated terminal still opens in a thread.
7. Repeat the integrated terminal check in both light theme and dark theme.

#### Expected Results
- Windows `npx` install no longer pulls `node-pty-prebuilt-multiarch` as a required install dependency.
- The deprecated `prebuild-install` dependency chain warnings no longer appear for `codexapp` installation.
- Re-running `npx codexapp --no-login` works without getting stuck in the same failed temporary install loop.
- Global installation succeeds on Windows.
- Integrated terminal continues to work through `node-pty` on supported hosts.
- Light theme and dark theme terminal surfaces remain readable and unchanged.

#### Rollback/Cleanup
- Remove the global package with `npm rm -g codexapp` if it was installed only for verification.

#### Prerequisites
- App is running from this repository.
- At least one thread can run a long response (for example, request a large code explanation).

#### Steps
1. Send a prompt that keeps the assistant generating for several seconds.
2. Immediately click the `Stop` button before the first assistant chunk fully completes.
3. Confirm generation halts.
4. Repeat with a resumed/existing in-progress thread (reload app while a turn is running, then click `Stop`).

#### Expected Results
- No error appears saying `turn/interrupt requires turnId`.
- Turn is interrupted successfully in both immediate-stop and resumed-thread scenarios.
- Thread state exits in-progress and the stop control returns to idle.

#### Rollback/Cleanup
- None.

### Feature: Revert PR #16 mobile viewport and chat scroll behavior changes

### Feature: Revert new-project folder-browser flow to inline add flow

#### Prerequisites
- App is running from this repository.
- Home/new-thread screen is open.
- At least one writable parent directory exists for creating a test project folder.

#### Steps
1. On the home/new-thread screen, open the `Choose folder` dropdown.
2. Click `+ Add new project`.
3. Enter a new folder name (for example `New Project Inline Test`) and click `Open`.
4. Confirm the app selects the newly created/opened project folder.
5. Repeat step 2, but enter an absolute path to an existing folder and click `Open`.

#### Expected Results
- Clicking `+ Add new project` opens inline input inside the dropdown instead of navigating to `/codex-local-browse...`.
- Entering a folder name creates/selects that project under the current base directory.
- Entering an absolute path opens that existing folder without creating a nested directory.

#### Rollback/Cleanup
- Delete the test folder created in step 3 if it was created only for verification.

### Feature: Disable auto-restore to last thread when opening home URL

#### Prerequisites
- App is running from this repository.
- At least one existing thread is available.
- Browser local storage may contain previous app state.

#### Steps
1. Open an existing thread route and confirm messages are visible.
2. Open `http://localhost:<port>/` (home route) in the same browser profile.
3. Refresh the home route once.
4. Close and re-open the app/tab at the home URL again.

#### Expected Results
- The app remains on the home/new-thread screen and does not auto-navigate to `/thread/<id>`.
- Refreshing home still keeps the user on home.

#### Rollback/Cleanup
- None.

#### Prerequisites
- App is running from this repository.
- A thread exists with enough messages to scroll.
- Test on a mobile-sized viewport (for example 375x812).

#### Steps
1. Open an existing thread and scroll up to the middle of the chat history.
2. Wait for an assistant response to stream while staying at the same scroll position.
3. Send a follow-up message and observe chat positioning when completion finishes.
4. Open the composer on mobile and drag within the composer area.
5. Open/close the on-screen keyboard on mobile and verify the page layout remains usable.

#### Expected Results
- Chat behavior matches pre-PR #16 baseline (no PR #16 scroll-preservation logic active).
- No regressions from reverting PR #16 changes in conversation rendering and composer behavior.
- Mobile layout no longer includes PR #16 visual-viewport sync changes.

#### Rollback/Cleanup
- Re-apply PR #16 commits if the reverted behavior is not desired.

### Feature: Thread load capped to latest 10 turns

#### Prerequisites
- App is running from this repository.
- At least one thread exists with more than 10 turns/messages.

#### Steps
1. Open a long thread that previously caused UI lag during initial load.
2. While the thread is loading, immediately click another thread in the sidebar.
3. Return to the long thread.
4. Count visible loaded history blocks and confirm only the newest portion is shown.
5. Call `/codex-api/rpc` with method `thread/read` for the same thread and inspect `result.thread.turns.length`.
6. Call `/codex-api/rpc` with method `thread/resume` for the same thread and inspect `result.thread.turns.length`.

#### Expected Results
- Initial thread load renders only the most recent 10 turns.
- UI remains responsive during thread load.
- You can switch to another thread without the UI freezing.
- `thread/read` and `thread/resume` RPC responses contain at most 10 turns.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Skills list request scoped to active thread cwd

#### Prerequisites
- App is running from this repository.
- Browser DevTools Network tab is open.
- At least two threads exist with different `cwd` values.

#### Steps
1. Reload the app and wait for initial data load.
2. In Network tab, inspect `/codex-api/rpc` requests with method `skills/list`.
3. Verify request params contain `cwds` with only the currently selected thread cwd.
4. Switch to another thread with a different cwd.
5. Inspect the next `skills/list` request and verify `cwds` now contains only the new selected thread cwd.

#### Expected Results

### Feature: Pinned threads persist across reload and prune removed threads

#### Prerequisites
- App is running from this repository.
- At least two threads exist in the sidebar.

#### Steps
1. Pin two threads from the sidebar using the pin button.
2. Refresh the app page.
3. Confirm the same threads are still shown in the `Pinned` section and in the same order.
4. Archive one of the pinned threads from the thread menu.
5. Refresh the app page again.

#### Expected Results
- Pinned threads are restored after reload from Codex app global state (`~/.codex/.codex-global-state.json` key `thread-pinned-ids`).
- Pin order is preserved between reloads.
- Archived/removed pinned thread is automatically pruned and no stale pinned row remains.

#### Rollback/Cleanup
- Unpin test threads if needed.
- `skills/list` no longer sends every thread cwd in one request.
- Each `skills/list` call includes at most one cwd for the active thread context.
- Skills list still updates when changing selected thread.

#### Rollback/Cleanup
- No cleanup required.

---

### Feature: GitHub Website Redesign — OpenClaw-Inspired Design + Web Demo Link

#### Prerequisites
- The `docs/index.html` file has been updated with the new design.
- A browser is available to view the page locally or via GitHub Pages.

#### Steps
1. Open `docs/index.html` in a browser (local file or via GitHub Pages).
2. Verify the fixed **navigation bar** at top with brand logo, section links, and "Get the App" CTA.
3. Verify the **announcement banner** below nav shows the XCodex WASM link.
4. Verify **hero section** displays lobster emoji, "AnyClaw" title with gradient, tagline, and four CTA buttons: "Try Web Demo", "Google Play", "Download APK", "GitHub".
5. Click **"Try Web Demo"** button — confirm it navigates to `https://xcodex.slrv.md/#/`.
6. Verify the **stats bar** shows key metrics (2 AI Agents, 1 APK, 0 Root Required, 73MB, infinity).
7. Scroll to **Live Demo** section — verify embedded iframe loads `https://xcodex.slrv.md/#/` with mock browser chrome.
8. Scroll to **Screenshots** section — verify four images render (2 desktop, 2 mobile).
9. Scroll to **Features** section — verify 6 feature cards in a 3-column grid.
10. Scroll to **Testimonials** section — verify two rows of auto-scrolling marquee cards (row 2 scrolls reverse). Hover to pause.
11. Scroll through **Architecture**, **Boot Sequence**, **Quick Start**, and **Tech Stack** sections — verify content renders.
12. Verify the **footer** includes a "Web Demo" link to `https://xcodex.slrv.md/#/`.
13. Test responsive at 768px and 480px — nav links collapse, grids single-column, buttons stack vertically.

#### Expected Results
- Page has a dark, premium feel with gradient accents, grain overlay, and smooth animations.
- All links to `https://xcodex.slrv.md/#/` work (announcement, hero CTA, demo section, quick start text, footer).
- Marquee testimonials scroll continuously and pause on hover.
- Embedded iframe demo loads successfully.
- Mobile responsive layout works at all breakpoints.

#### Rollback/Cleanup
- Revert `docs/index.html` to previous commit if needed.

### Feature: Keep manual chat scroll position during streaming

#### Prerequisites
- App is running from this repository.
- A thread exists with enough history to allow scrolling away from bottom.

#### Steps
1. Open the thread and scroll upward so latest messages are not visible.
2. Send a new message that produces a streaming assistant response.
3. During streaming, do not scroll and observe viewport position.
4. After streaming completes, verify the viewport remains at the same manual position.

#### Expected Results
- Streaming updates do not force auto-scroll to the bottom when user has manually scrolled away.
- User can continue reading older history while the response streams.
- If the thread is already at the bottom when streaming starts, the latest streaming overlay remains visible.

#### Rollback/Cleanup
- Revert the scroll-preservation change in `src/components/content/ThreadConversation.vue` if manual scroll locking needs to be removed.

### Feature: Rollback API/UI no longer requires turn index in rollback payload

#### Prerequisites
- App is running from this repository.
- A thread exists with at least 2 completed turns.
- Rollback control is visible in the thread conversation message actions.

#### Steps
1. Open any existing thread with multiple turns.
2. In DevTools Network tab, keep `/codex-api/rpc` requests visible.
3. Click rollback on a user or assistant message that is not the newest one.
4. Confirm rollback succeeds and the thread is truncated to the selected turn.
5. Inspect the UI event flow by repeating rollback from a different turn and confirm the selected message can rollback without relying on a numeric turn index.
6. Use dictation resend flow (or "rollback latest user turn" flow) and confirm the latest user turn is rolled back correctly.

#### Expected Results
- Rollback works when triggered from message actions using `turnId` as the identifier.
- No UI path depends on `turnIndex` in rollback event payloads.
- Latest-user-turn rollback flow still works and targets the latest user `turnId`.
- No TypeScript/runtime errors are introduced in rollback interaction.

#### Rollback/Cleanup
- Revert the updated files if this behavior is not desired:
  - `src/types/codex.ts`
  - `src/api/normalizers/v2.ts`
  - `src/components/content/ThreadConversation.vue`
  - `src/App.vue`
  - `src/composables/useDesktopState.ts`

### Feature: Rollback init commit includes `.codex/.gitignore`

#### Prerequisites
- App server is running from this repository.
- Use a fresh temporary project directory with no existing `.codex/rollbacks/.git` history.

#### Steps
1. In a fresh test project folder, trigger rollback automation init by calling `/codex-api/worktree/auto-commit` with a valid commit message.
2. Verify rollback repo exists at `.codex/rollbacks/.git`.
3. In that rollback repo, run `git --git-dir .codex/rollbacks/.git --work-tree . show --name-only --pretty=format: HEAD`.
4. Confirm `.codex/.gitignore` appears in the file list for the init commit.
5. Open `.codex/.gitignore` and verify `rollbacks/` exists.

#### Expected Results
- First rollback-history commit is `Initialize rollback history`.
- That commit includes `.codex/.gitignore`.
- `.codex/.gitignore` contains `rollbacks/`.

#### Rollback/Cleanup
- Remove the temporary test folder after verification.

### Feature: Deterministic rollback commit + exact lookup with debug logs

#### Prerequisites
- App server is running from this repository.
- `worktree git automation` is enabled in UI settings.
- Test thread available where you can send at least 3 user turns.

#### Steps
1. Send a user turn that changes files and completes.
2. Send a user turn that produces no file edits and completes.
3. Send a third user turn and complete it.
4. In rollback git history (`.codex/rollbacks/.git`), verify each completed turn created a commit, including the no-edit turn.
5. Inspect one rollback commit body and confirm it contains the user message text plus `Rollback-User-Message-SHA256: <hash>`.
6. Trigger rollback to the second turn message via UI rollback action.
7. Verify server logs contain `[rollback-debug]` entries for lookup, stash (if dirty), reset, and completion.
8. Temporarily test missing-commit path by calling `/codex-api/worktree/rollback-to-message` with a non-existent message text.

#### Expected Results
- Auto-commit creates a rollback commit for every completed turn (`--allow-empty` behavior).
- Commit body includes the user message and stable hash trailer.
- Rollback uses exact hash-based commit lookup only.
- If exact commit is missing, rollback returns error and does not continue.
- Server logs include `[rollback-debug]` records for commit creation, lookup, stash, reset, and error paths.
- Browser console includes `[rollback-debug]` client-side start/success/error logs for auto-commit and rollback API calls.
- Rollback init no longer fails when `.codex` is ignored globally; init force-adds `.codex/.gitignore`.

#### Rollback/Cleanup
- Revert the changed files if you want previous non-deterministic behavior back.

### Feature: Per-turn changed files panel with lazy diff loading

#### Prerequisites
- App server running from this repository.
- Worktree git automation enabled.
- A thread with at least one completed turn that touched files.

#### Steps
1. Open a thread and locate a `Worked for ...` separator message.
2. Expand the worked separator.
3. Verify a changed-files panel appears above command details.
4. Confirm file list entries show file path and `+/-` counts.
5. Click one changed file row to expand it.
6. Verify diff content loads only after expansion (lazy load behavior).
7. Collapse and re-expand the same file row; verify diff reuses loaded content.
8. Switch to another thread and back; verify panel reloads for the active thread context.

#### Expected Results
- Each worked message can show changed files for its turn.
- Diff for a file is fetched only on expand, not for all files upfront.
- Errors (missing commit/diff load failure) are shown inline in the panel.
- Existing command output expand/collapse behavior remains unchanged.
- Changed-files panel still resolves after page refresh or app-server restart.
- Changed-files panel appears at the end of the worked message block (after command rows).

#### Rollback/Cleanup
- No cleanup required.

### Feature: Worked separator is non-expandable

#### Prerequisites
- App server running from this repository.
- A thread with at least one `Worked for ...` separator.

#### Steps
1. Open a thread and locate a `Worked for ...` message.
2. Click the separator line/text area.
3. Verify no expand/collapse behavior is triggered on the separator itself.
4. Verify changed-files panel still appears below the separator when data exists.

#### Expected Results
- `Worked for ...` acts as a visual separator only (non-interactive).
- Changed-files and command sections are not gated by a worked-separator expand toggle.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Changed-files lookup fallback when turnId metadata is missing

#### Prerequisites
- App server running from this repository.
- Playwright CLI available.

#### Steps
1. Create/prepare a test workspace (example: `/tmp/rollback-pw`).
2. Call `/codex-api/worktree/auto-commit` with:
   - `cwd=/tmp/rollback-pw`
   - `message='pw-msg-turn-1'`
   - `turnId='turn-real-1'`
3. Call `/codex-api/worktree/message-changes` with:
   - same `cwd`
   - same `message`
   - mismatched `turnId='turn-wrong'`
4. Verify response is still `200` and returns the matching commit data (message-hash fallback).
5. Capture Playwright artifact screenshot.

#### Expected Results
- `message-changes` first attempts turnId lookup.
- If turnId lookup misses, it falls back to exact message-hash lookup.
- API returns commit data instead of `No matching commit found for this user message` when message matches.

#### Rollback/Cleanup
- Remove temporary test workspace if created.

### Feature: Changed-files panel persists across refresh (assistant message level)

#### Prerequisites
- App server running from this repository.
- Existing thread in `TestChat` project with completed assistant messages.
- Worktree rollback auto-commit enabled.

#### Steps
1. Open a `TestChat` thread and confirm assistant message cards render.
2. Verify changed-files panel is shown at the end of assistant messages that have rollback commit data.
3. Hard refresh the page.
4. Re-open the same `TestChat` thread.
5. Verify changed-files panel is still shown for the same assistant message(s).
6. Expand one file diff and verify diff content loads.

#### Expected Results
- Changed-files panel is attached to assistant messages (not transient worked separators).
- Changed-files panel appears only once per turn (on the last assistant message in that turn).
- Changed-files panel is hidden while a turn is still in progress.
- Panels remain available after refresh/restart because lookup is turnId/message-hash based.
- File diff expansion still lazy-loads and displays content.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Rollback debug logs controlled by `.env`

#### Prerequisites
- App server stopped.
- Edit `.env` directly, and use `.env.local` for private local overrides.

#### Steps
1. Set `ROLLBACK_DEBUG=0` and `VITE_ROLLBACK_DEBUG=0` in `.env`.
2. Start app and trigger rollback auto-commit/message-changes flow.
3. Verify `[rollback-debug]` logs are not emitted in terminal/browser console.
4. Set `ROLLBACK_DEBUG=1` and `VITE_ROLLBACK_DEBUG=1` in `.env`.
5. Restart app and trigger the same flow again.
6. Verify `[rollback-debug]` logs appear in terminal/browser console.

#### Expected Results
- Debug logs are disabled when env flags are `0`.
- Debug logs are enabled when env flags are `1`.

#### Rollback/Cleanup
- Restore `.env` values to preferred defaults.

### Feature: Auto-commit default is disabled for new preference state

#### Prerequisites
- App server running from this repository.
- Browser local storage key `codex-web-local.worktree-git-automation.v1` is absent (new user state).

#### Steps
1. Open the app in a fresh browser profile (or clear only `codex-web-local.worktree-git-automation.v1`).
2. Open Settings and inspect the `Rollback commits` toggle state.
3. Confirm it starts in the disabled/off state.
4. Enable the toggle manually.
5. Reload the page and confirm the toggle remains enabled.
6. Disable it again, reload, and confirm it remains disabled.

#### Expected Results
- Default state is disabled when no prior preference exists.
- User-selected state persists via local storage across reloads.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Skills sync pull live-reloads installed skills list

#### Prerequisites
- App running from this repository with Skills Hub available.
- GitHub skills sync configured and connected.
- At least one skill update available in the sync source (new or edited skill metadata).

#### Steps
1. Open the app and note the currently visible installed skills for the active thread cwd.
2. In Skills Hub, trigger `Pull` from GitHub sync.
3. Wait for the pull success toast.
4. Without restarting the app/server, navigate to thread composer skill picker and verify the installed skills list.
5. Switch to another thread and back to force a normal UI refresh path.

#### Expected Results
- Pull completes successfully.
- Installed skills list reflects pulled changes immediately without app/server restart.
- Thread switch keeps showing the updated skills list (no stale cache rollback).

#### Rollback/Cleanup
- If needed, run another sync pull/push to restore previous skill state in the sync repo.

### Feature: Public shared skills pull overwrites only shared skills

#### Prerequisites
- App running from this repository with Skills Hub available.
- GitHub skills sync is not configured/logged in.
- Local shared skills directory exists at `~/.codex/skills/shared_skills`.

#### Steps
1. Create a temporary local-only skill folder under `~/.codex/skills/shared_skills`, or edit a tracked shared skill file in that directory.
2. Note the parent `~/.codex/skills` status, including any unrelated local edits outside `shared_skills`.
3. Open `Skills Hub`.
4. Trigger `Pull` from the `Skills Sync (GitHub)` panel.
5. Wait for the pull success toast.
6. Inspect `~/.codex/skills/shared_skills` and compare it with the public `OpenClawAndroid/skills` `android` branch.
7. Inspect `~/.codex/skills` and verify unrelated parent-level files were not reset or cleaned by the unauthenticated pull.
8. If `~/.codex/skills/shared_skills/.git` is a git file or worktree/submodule-style pointer, repeat the pull and verify the nested repo is not reinitialized.
9. Inspect the `/codex-api/skills-sync/pull` response and verify `data.synced` matches the number of direct shared skill folders with `SKILL.md`.
10. In light theme, verify the Skills Hub list reloads and does not show stale local-only skills.
11. Switch to dark theme and verify the same Skills Hub state remains readable and current.

#### Expected Results
- Public unauthenticated pull resets only the nested `shared_skills` repo to the public upstream `android` branch.
- Local uncommitted edits and local-only untracked skill folders inside `shared_skills` are removed by the pull.
- Parent-level `~/.codex/skills` files outside `shared_skills` are not reset or cleaned.
- Existing git-file/worktree/submodule-style shared skills repos are reused, not reinitialized.
- The pull response reports the shared skills count from `~/.codex/skills/shared_skills`, not the parent skills directory.
- The installed skills list reloads immediately after the pull in both light and dark theme.
- Private GitHub sync repos still preserve local edits through the bidirectional sync path.

#### Rollback/Cleanup
- Recreate any intentionally removed local-only shared skill if it should be kept.
- Use private sync `Push` only after confirming the public pull result should be mirrored elsewhere.

### Feature: Force Refresh Skills button in Skills Sync panel

#### Prerequisites
- App running from this repository with Skills Hub route accessible.
- At least one installed skill is available for the current thread cwd.

#### Steps
1. Open `Skills Hub`.
2. In `Skills Sync (GitHub)`, click `Force Refresh Skills`.
3. Verify button text changes to `Refreshing...` during the request and returns after completion.
4. Verify success toast appears.
5. Open the thread composer skills picker and confirm installed skills list is present and current.
6. Switch to another thread and back to ensure refreshed list remains consistent.

#### Expected Results
- `Force Refresh Skills` triggers a manual refresh without requiring pull/push.
- Loading state prevents duplicate clicks while refresh is in progress.
- Installed skills list updates immediately and remains updated across thread switches.

#### Rollback/Cleanup
- No cleanup required.

### Feature: SkillHub shows detailed skill load errors

#### Prerequisites
- App running from this repository.
- At least one invalid installed skill file exists (for example unresolved merge markers in `SKILL.md`).

#### Steps
1. Open `Skills Hub`.
2. Trigger `Force Refresh Skills`.
3. Locate the `Some skills failed to load` panel above the skills sections.
4. Verify each row shows:
   - the failing `SKILL.md` path
   - the exact parser error message from app server (for example invalid YAML line/column details).
5. Fix the invalid skill file and trigger `Force Refresh Skills` again.

#### Expected Results
- SkillHub surfaces app-server load failures with detailed path and message.
- Messages are specific enough to identify the broken file and parser failure reason.
- Error panel disappears after invalid skills are fixed and refreshed.

#### Rollback/Cleanup
- Restore any intentionally broken local skill files used for testing.

### Feature: Startup sync preserves local skill edits when remote is ahead

#### Prerequisites
- Skills sync configured to a private GitHub fork.
- Local skills repo has a tracked edit in an existing skill file.
- Remote `main` has at least one newer commit than local (simulate from another machine or commit directly on GitHub).

#### Steps
1. Edit a local skill file (for example update description text in `SKILL.md`) and keep the change.
2. Trigger `Startup Sync` in Skills Hub.
3. If a non-fast-forward condition exists, allow startup sync to complete retry path.
4. Re-open the same local skill file and verify your edit remains.
5. Trigger `Force Refresh Skills` and verify no unexpected skill removals occurred.

#### Expected Results
- Startup sync no longer fails with non-fast-forward push due to missing remote integration.
- Local tracked skill edits remain after sync (not overwritten by remote state).
- Sync path rebases/pulls with autostash and auto-resolves conflicts by mtime policy:
  - choose remote (`theirs`) when remote file commit time is newer than local file mtime.
  - choose local (`ours`) otherwise.
- No manual conflict intervention is required during startup sync retries.

#### Rollback/Cleanup
- Revert test-only skill text changes if they were not intended to keep.

### Feature: Startup sync conflict fallback when one side is missing

#### Prerequisites
- Skills sync repo contains a conflict candidate where only one side exists for a path (for example delete/modify scenario).
- Skills Hub is accessible.

#### Steps
1. Open `Skills Hub`.
2. Click `Startup Sync`.
3. Wait for sync completion or error toast.
4. Verify no toast/error contains `does not have our version`.

#### Expected Results
- Sync conflict resolver handles missing `--ours`/`--theirs` versions safely.
- Startup sync does not fail with `git checkout --ours/--theirs` missing-version errors.

#### Rollback/Cleanup
- None.

### Feature: Remote changes win when no local uncommitted skill edits exist

#### Prerequisites
- Skills sync configured with GitHub.
- Local skills repo working tree is clean (`git status --porcelain` empty under skills dir).
- Remote skills repo has newer commits touching existing skill files.

#### Steps
1. Confirm no local uncommitted changes in skills directory.
2. Trigger `Startup Sync` in Skills Hub.
3. After sync, inspect the skill file changed remotely.
4. Trigger `Force Refresh Skills` and confirm loaded skill content matches remote update.

#### Expected Results
- Sync pull/reconcile does not preserve stale local file content when local tree is clean.
- Remote updates are applied locally and remain after startup sync completes.

#### Rollback/Cleanup
- None.

### Feature: Startup sync does not delete remote AGENTS.md

#### Prerequisites
- Skills sync configured to `friuns2/codexskills`.
- Remote `main` contains `AGENTS.md`.
- Local skills repo is clean before startup sync.

#### Steps
1. Confirm remote `AGENTS.md` exists on `main`.
2. Confirm local `~/.codex/skills` is clean.
3. Trigger `Startup Sync`.
4. After completion, inspect latest commit created by sync (if any).
5. Verify `AGENTS.md` still exists locally and in remote `origin/main`.

#### Expected Results
- Startup sync may update manifest, but must not delete `AGENTS.md`.
- If sync creates a commit, changed files do not include `D AGENTS.md`.
- Local and remote `AGENTS.md` hashes remain equal after sync.

#### Rollback/Cleanup
- None.

### Feature: Bidirectional AGENTS.md sync via Startup Sync

#### Prerequisites
- Skills sync configured to `friuns2/codexskills`.
- `~/.codex/skills` is a clean git working tree before each sub-test.
- Skills Hub startup sync endpoint is reachable.

#### Steps
1. Remote -> Local:
2. Add a unique marker to remote `AGENTS.md` on `main`.
3. Confirm local `HEAD` is behind `origin/main`.
4. Trigger `Startup Sync`.
5. Verify local `AGENTS.md` contains the remote marker and local `HEAD == origin/main`.
6. Local -> Remote:
7. Add a different unique marker to local `~/.codex/skills/AGENTS.md`.
8. Confirm local working tree shows `M AGENTS.md`.
9. Trigger `Startup Sync`.
10. Verify remote `origin/main:AGENTS.md` contains the local marker and local `HEAD == origin/main`.

#### Expected Results
- Remote-only AGENTS edits are pulled into local without deletion.
- Local AGENTS edits are pushed to remote after startup sync.
- After each sync direction, local and remote commit SHAs match.

#### Rollback/Cleanup
- Remove temporary test markers from `AGENTS.md` if required.

### Feature: Mixed local+remote AGENTS edits do not stall Startup Sync

#### Prerequisites
- Skills sync configured and working.
- Local skills repo clean before test start.

#### Steps
1. Add marker `A` to remote `AGENTS.md`.
2. Add marker `B` to local `AGENTS.md` before syncing.
3. Trigger `Startup Sync`.
4. Wait for startup status to finish (`inProgress=false`).
5. Verify sync outcome explicitly:
6. If sync succeeds, local/remote SHAs match and expected merged marker result is present.
7. If sync fails, status includes a concrete error message (not silent success).

#### Expected Results
- Startup sync must not report success while local remains behind remote.
- No stale stash side-effects are introduced (no unexpected conflict from old stash entries).
- Final state is either a valid synchronized result or an explicit failure status with actionable error.

#### Rollback/Cleanup
- Reset local skills repo to `origin/main` after test if needed.

### Feature: Startup sync uses deterministic pull reconcile (`fetch + reset --hard`) before local replay

#### Prerequisites
- Skills sync is logged in and targets `friuns2/codexskills`.
- Local repo path is `~/.codex/skills`.
- Startup Sync endpoint is reachable at `/codex-api/skills-sync/startup-sync`.

#### Steps
1. Remote-only case:
2. Commit a unique marker to remote `AGENTS.md` on `main`.
3. Ensure local repo is clean and reset to `origin/main`, then trigger `Startup Sync`.
4. Confirm marker appears locally and `HEAD == origin/main`.
5. Local-only case:
6. Add a unique local marker to `~/.codex/skills/AGENTS.md` (uncommitted), trigger `Startup Sync`.
7. Confirm marker is pushed and `HEAD == origin/main` with clean worktree.
8. Mixed case:
9. Add local marker first, then commit a newer remote marker.
10. Trigger `Startup Sync` and verify mtime policy result (newer remote marker wins, older local marker dropped).
11. Confirm final state is clean with `HEAD == origin/main`.

#### Expected Results
- Startup sync does not fail with missing merge refs (`MERGE_HEAD`/`REBASE_HEAD`) in this path.
- Remote-only changes are always pulled first and visible locally.
- Local-only changes are preserved and pushed during the same startup sync run.
- Mixed local+remote edits converge automatically with no manual conflict handling.

#### Rollback/Cleanup
- Remove temporary test markers from `AGENTS.md` if not needed.

### Feature: Revert Renat scrolling/input-layout behavior (without Fast mode changes)

#### Prerequisites
- App builds successfully (`pnpm run build`).
- Open a thread with enough messages to scroll.
- Composer is visible in the main chat view.

#### Steps
1. Open a long thread and scroll upward away from bottom.
2. Trigger live overlay updates (for example by sending a new prompt) and observe scroll behavior.
3. Confirm message list horizontal overflow behavior in conversation and desktop main area.
4. In composer, verify there is no drag/drop overlay UI when dragging files over the input.
5. In composer, paste an image from clipboard and verify it is not auto-attached through paste handler.
6. Use file picker/camera attach buttons and confirm attachments still work.
7. Confirm Fast mode UI/toggle remains present and unchanged.

#### Expected Results
- Scroll behavior follows reverted layout logic for conversation/desktop containers.
- Composer drag-active overlay is removed from the input field layout.
- Clipboard image paste no longer triggers drag/paste attachment flow.
- Standard picker-based attachments still work.
- Fast mode button and related controls are unchanged.

#### Rollback/Cleanup
- `git restore src/components/content/ThreadComposer.vue src/components/content/ThreadConversation.vue src/components/layout/DesktopLayout.vue src/style.css tests.md`

### Feature: Chat file-link context menu (open/copy/edit)

#### Prerequisites
- App server is running from this repository.
- Open a thread that contains rendered `.message-file-link` anchors (for example Markdown file links).

#### Steps
1. In a message with a file link, right-click the file link text.
2. Verify the custom context menu appears near the pointer.
3. Click `Open link` and confirm the link opens in a new tab.
4. Right-click the same file link again and click `Copy link`, then paste into a text input to verify copied value.
5. For links under `/codex-local-browse...`, right-click and click `Edit file`.
6. Click outside the menu and press `Escape` while the menu is open.

#### Expected Results
- Right-clicking any `.message-file-link` opens the custom context menu.
- Menu includes `Open link` and `Copy link` for all links.
- Menu includes `Edit file` only for browseable local file links.
- Pointer-down outside, blur, and `Escape` close the menu.

#### Rollback/Cleanup
- Close any tabs opened during the test.

### Feature: Dark theme command rows in chat remain readable

#### Prerequisites
- App is running from this repository.
- Open any thread that contains command execution entries.
- Appearance is set to `Dark` in Settings.

#### Steps
1. Open a thread with one or more command execution rows in the conversation.
2. Verify command label text, grouped command label text, and status text in collapsed rows.
3. Locate a file-change summary row (for example: `▶ 2 files changed · 2 edited`) and verify the chevron and summary text are readable.
4. Expand a command row to show output and inspect the output panel border contrast.
5. Confirm status colors for running/success/error command rows are distinguishable in dark mode.
6. Toggle back to `Light` theme and confirm command rows still use the existing light styling.

#### Expected Results
- Command labels and grouped command labels are readable against dark row backgrounds.
- File-change summary rows keep readable chevron and summary text in dark mode.
- Default status text is readable in dark mode.
- Running/success/error status colors remain visible in dark mode.
- Expanded command output border is visible without using a bright light-theme border.
- Light theme command row styling is unchanged.

#### Rollback/Cleanup
- Return appearance setting to the previous user preference.

### Feature: Home composer vertical alignment matches reference layout

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Open the `New thread` (home) screen with a selected folder/project.
- Ensure desktop viewport width (for example >= 1280px).

#### Steps
1. Open the home screen and observe the hero block (`Let's build`) and composer placement.
2. Confirm the hero/settings block is vertically centered within the available content area.
3. Confirm the message composer sits in the lower area of the content column (not immediately below top content).
4. Resize window height taller/shorter and re-check vertical placement.
5. Open any thread route and verify thread composer layout remains unchanged.

#### Expected Results
- Home hero block is centered again (not top-anchored).
- Home composer aligns toward the bottom region similar to the reference screenshot.
- Resizing preserves the intended centered-hero + lower-composer structure.
- Thread route composer behavior is unchanged.

#### Rollback/Cleanup
- Revert the `.new-thread-empty` style in [src/App.vue](/Users/igor/.codex/worktrees/eaf8/codex-web-local/src/App.vue).

### Feature: Restore composer drag-and-drop file attach on input field

#### Prerequisites
- App is running with a selected thread and active composer.
- At least one local file is available to drag from Finder/File Explorer.

#### Steps
1. Drag a file over the composer input area.
2. Confirm drag highlight/overlay appears above the input.
3. Drop the file on the composer input field.
4. Verify the file is attached in composer chips.
5. Repeat with an image file and verify image preview appears.
6. In dark mode, repeat steps 1-2 and verify overlay remains readable.

#### Expected Results
- Composer shows drag-active visual state while file is hovering.
- Dropped files are attached through the same attachment pipeline as regular uploads.
- Image drops create image preview attachments.
- Dark mode drag overlay uses dark-theme colors and remains legible.

#### Rollback/Cleanup
- Remove attached files/images from the composer before closing the test thread.

### Feature: Restore clipboard image paste attachments in composer

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Open any thread where the composer is enabled.
- Have an image copied to system clipboard (for example screenshot copy).

#### Steps
1. Focus the composer textarea.
2. Paste clipboard content that contains only an image file payload.
3. Confirm an image chip/preview is added to composer attachments.
4. Copy plain text only and paste into composer.
5. Copy mixed content (plain text + image, if source provides both) and paste once.
6. Copy long plain text (at least 2000 characters) and paste into composer.
7. Confirm the long text is attached as a `.txt` file instead of being inserted into the textarea.
8. Send the message with the pasted image/text attachment.

#### Expected Results
- Image-only clipboard paste adds an image attachment to composer.
- Plain-text paste still inserts text into the composer and does not create an attachment.
- Mixed payload paste attaches the image while preserving text paste behavior.
- Long plain-text paste (>= 2000 chars) creates a `.txt` attachment and does not insert raw text into the textarea.
- Sending proceeds with the attached pasted image.

#### Rollback/Cleanup
- Remove the attached image chip from composer if not needed.

### Feature: Show user file attachments as visible chips in chat

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Open any thread with an active composer.
- Have at least one local file available to attach.

#### Steps
1. Attach one or more files via composer (file picker, paste long text as `.txt`, or other file attachment flow).
2. Send the message.
3. Locate the sent user message in conversation.
4. Verify file attachment chips are rendered above message text.
5. Click a file chip and confirm it opens the browse URL in a new tab/window.
6. Right-click the chip link and verify file-link context actions still appear (`Open link`, `Copy link`, and `Edit file` when applicable).

#### Expected Results
- Sent user messages with `fileAttachments` show visible file chips in chat.
- Chip labels match attachment labels from composer payload.
- Chip links resolve through browse URLs and remain clickable.
- Existing file-link context menu behavior works on the chip links.

#### Rollback/Cleanup
- Close any opened file tabs and remove temporary test messages if needed.

### Feature: Frontend missing-entry 404 page auto-redirects to chat

#### Prerequisites
- Build or runtime state where frontend entry cannot be served (for example missing `dist/index.html`).
- Start server and open the failing route in a browser.

#### Steps
1. Trigger the frontend missing-entry error page.
2. Confirm the page shows an error headline and a `Back to chat` link.
3. Wait 3 seconds without clicking the link.
4. Repeat and click `Back to chat` immediately.

#### Expected Results
- Error page still renders with the manual `Back to chat` link.
- Page automatically redirects to `/` after about 3 seconds.
- Manual link works instantly and is not blocked by the timer.

#### Rollback/Cleanup
- Restore frontend assets (`pnpm run build:frontend`) if they were intentionally removed for testing.

### Feature: Import 10 working DB accounts and keep Accounts section collapsed by default

#### Prerequisites
- Have a SQLite DB with `account_tokens.refresh_token` rows (default path: `/Users/igor/Git-projects/any-auto-register/account_manager.db`).
- Network access available for token exchange against OpenAI OAuth endpoint.
- Codex home available at `~/.codex` (or set `CODEX_HOME`).
- Start the app from this repository (`pnpm run dev`).

#### Steps
1. Run `scripts/import-working-accounts-from-db.sh`.
2. Verify script reports `imported` rows and ends with `done imported=<n>` where `n <= 10`.
3. Open `~/.codex/accounts.json` and verify new account entries were appended/updated.
4. Verify snapshot files exist under `~/.codex/accounts/<sha256(account_id)>/auth.json`.
5. Open app settings and check the `Accounts` section is collapsed on first load.
6. Click the chevron toggle in Accounts header to expand.
7. Confirm account list/error/empty state renders correctly after expanding.
8. Reload the page and confirm collapsed/expanded state persists.

#### Expected Results
- Script imports up to 10 valid (token-exchange-successful) accounts and skips invalid tokens.
- `accounts.json` and per-account snapshot `auth.json` files are created with secure file modes.
- Accounts panel in settings is collapsed by default when no saved preference exists.
- User can expand/collapse Accounts via header toggle, and the state persists in localStorage.

#### Rollback/Cleanup
- Remove imported snapshots from `~/.codex/accounts/` and corresponding rows in `~/.codex/accounts.json` if needed.
- Delete localStorage key `codex-web-local.accounts-section-collapsed.v1` to reset UI preference.

### Feature: Copy Codex accounts to Android via ssh helper script

#### Prerequisites
- Local Codex state exists at `~/.codex/accounts` and `~/.codex/accounts.json`.
- Android helper exists and is executable: `/Users/igor/Git-projects/codex-web-local-android/andclaw/ssh.sh`.
- Android target is reachable through helper SSH path.

#### Steps
1. Run `scripts/copy-accounts-to-android.sh`.
2. Confirm script prints local account count and upload/extract progress.
3. Confirm script prints remote account count.
4. Verify script exits successfully with `Copy complete: local and remote counts match.`
5. On Android host, verify `~/.codex/accounts.json` exists and snapshots under `~/.codex/accounts/*/auth.json` are present.

#### Expected Results
- Script packs `accounts/` and `accounts.json`, uploads and extracts on Android.
- Local and remote `auth.json` snapshot counts match.
- Script exits non-zero on mismatch or missing prerequisites.

#### Rollback/Cleanup
- Remove remote copied data if needed: delete `~/.codex/accounts` and `~/.codex/accounts.json` on Android host.

### Feature: Accounts no longer stuck on "Fetching account details…"

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Have at least one imported account in the Accounts section.

#### Steps
1. Open Settings and expand `Accounts`.
2. Ensure at least one account has no immediately available quota snapshot (for example right after import/refresh, or by waiting for quota read failure).
3. Observe the quota/status line for that account after the initial fetch completes.
4. Trigger `Reload` in the Accounts header and wait for account list update.
5. Re-check accounts that are not in `Loading quota…` state.

#### Expected Results
- `Fetching account details…` appears only while the entry is truly in transient loading.
- Accounts that are not loading and still have no quota snapshot show `Quota unavailable` instead of a perpetual fetching label.
- Existing `Loading quota…` and explicit error messages continue to render correctly.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Account quota background refresh recovers from stale loading and inspection hangs

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Have multiple imported accounts in `~/.codex/accounts.json`.
- At least one account previously left with `quotaStatus: "loading"` for longer than 2 minutes, or one account that causes quota inspection to hang.

#### Steps
1. Open Settings and expand `Accounts`.
2. Trigger account list refresh by loading the page or clicking `Reload`.
3. Monitor `~/.codex/accounts.json` and confirm stale `loading` accounts are re-picked for refresh (not ignored indefinitely).
4. Wait at least 30 seconds when one account is slow/hanging.
5. Verify other accounts continue progressing instead of all remaining blocked.
6. Re-open the Accounts section and inspect final status labels for previously stuck accounts.

#### Expected Results
- `loading` states older than 2 minutes are retried automatically.
- A single hanging account inspection times out (about 25 seconds) and transitions to `error` rather than blocking the whole queue forever.
- Remaining accounts continue refreshing to `ready` as data becomes available.
- UI no longer stays indefinitely stuck waiting on one blocked account refresh.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Account quota label uses primary snapshot when windowMinutes is missing

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Have accounts where `quotaSnapshot.primary` exists but `windowMinutes` can be null.

#### Steps
1. Open Settings and expand `Accounts`.
2. Click `Reload` and wait for account statuses to settle to `ready`.
3. Inspect account rows that previously showed `Quota unavailable` while backend had `quotaSnapshot.primary.usedPercent`.
4. Verify displayed quota labels in UI and account card titles.

#### Expected Results
- Accounts with `quotaSnapshot.primary` show a remaining-percent quota label.
- `Quota unavailable` appears only when there is truly no usable quota snapshot data.
- Team/free accounts both render quota labels consistently when primary snapshot is present.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Default runtime uses unrestricted sandbox and no approvals

#### Prerequisites
- Build artifacts are available (or run directly from source in this repo).
- No `CODEXUI_SANDBOX_MODE` or `CODEXUI_APPROVAL_POLICY` environment variables are exported in the shell.

#### Steps
1. Start the app from this repository without passing `--sandbox-mode` or `--approval-policy`.
2. Observe startup logs for the printed runtime config lines.
3. Confirm the logs show `Codex sandbox: danger-full-access` and `Approval policy: never`.
4. Stop the app and restart with explicit overrides, for example `--sandbox-mode workspace-write --approval-policy on-request`.
5. Confirm startup logs now show the override values.

#### Expected Results
- Default startup (no flags/env) uses `danger-full-access` sandbox and `never` approval policy.
- Explicit CLI overrides still take precedence and are applied correctly.

#### Rollback/Cleanup
- Unset any temporary env vars used for override checks.

### Feature: npm run dev exports unrestricted runtime defaults

#### Prerequisites
- Node and pnpm are installed.
- No shell-level `CODEXUI_SANDBOX_MODE` or `CODEXUI_APPROVAL_POLICY` overrides are set.

#### Steps
1. Run `npm run dev` from the repository root.
2. In a second terminal, run `ps eww -p $(pgrep -f "vite" | head -n 1)`.
3. Confirm the process environment contains `CODEXUI_SANDBOX_MODE=danger-full-access` and `CODEXUI_APPROVAL_POLICY=never`.
4. Stop dev server and run `CODEXUI_SANDBOX_MODE=workspace-write CODEXUI_APPROVAL_POLICY=on-request npm run dev`.
5. Re-check the Vite process environment values.

#### Expected Results
- Default `npm run dev` includes `CODEXUI_SANDBOX_MODE=danger-full-access` and `CODEXUI_APPROVAL_POLICY=never`.
- Explicit shell overrides still take precedence when provided.

#### Rollback/Cleanup
- Stop running dev servers and unset temporary env overrides.

### Feature: npm run dev uses CLI server on Android

#### Prerequisites
- Android SSH helper exists and is executable: `/Users/igor/Git-projects/codex-web-local-android/andClaw/ssh.sh`.
- Dependencies are installed on the Android clone.

#### Steps
1. On Android, run `npm run dev -- --port 4173`.
2. Confirm startup logs show `Codex Web Local is running!`.
3. In a second Android shell, run `curl -fsS http://127.0.0.1:4173/ | head -5`.
4. Stop the dev server.

#### Expected Results
- Android starts `node dist-cli/index.js`, not raw Vite.
- The server binds successfully and returns the app HTML.
- The Vite `uv_interface_addresses` Android error does not occur.

#### Rollback/Cleanup
- Stop the Android dev server.

### Feature: Approval request uses legacy in-conversation request card only

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Open a thread where Codex can trigger an approval request (for example a command or file-change approval).

#### Steps
1. Trigger an approval request in an existing thread.
2. Observe the conversation timeline where server requests are rendered.
3. Observe the composer area at the bottom of the thread.
4. Confirm the approval controls are shown in the in-conversation request card.
5. Confirm no separate composer waiting-state approval panel is rendered.

#### Expected Results
- Exactly one approval UI is visible for the active pending request.
- The approval UI appears in the conversation request card.
- Composer continues to show the standard composer UI without a separate approval panel.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Rollback appends rolled-back user text into composer input

#### Prerequisites
- App is running from this repository.
- Open any non-home thread with at least one completed user/assistant turn.
- Composer input is visible in the thread view.

#### Steps
1. In the selected thread, locate a message row with a visible rollback action.
2. Click rollback for a specific turn whose user prompt text is known.
3. Observe the composer input immediately after clicking rollback.
4. If composer already had text, verify the rolled-back user text is appended on a new line.
5. Confirm the thread rollback still completes and the turn is removed from the conversation.

#### Expected Results
- Before rollback completes, the original user message text from that turn is inserted into the composer input.
- Existing composer draft text is preserved and the restored text is appended.
- Rollback behavior still removes the selected turn(s) as before.

#### Rollback/Cleanup
- Clear composer input if restored text is no longer needed.

### Feature: New thread worktree creation supports searchable base-branch selector

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Use a folder that is inside a Git repository with at least two branches (for example `main` and a feature branch).

#### Steps
1. Open the `New thread` screen.
2. Select a project folder that points to a Git repository.
3. Change runtime to `New worktree`.
4. Verify a `Base branch` dropdown appears.
5. Open the dropdown and type part of a branch name in search.
6. Select a non-default branch from the filtered list.
7. Submit the first message to trigger worktree creation.
8. In the opened thread, confirm `cwd` points to a new worktree path under `~/.codex/worktrees/`.
9. In terminal, run `git -C <new-worktree-path> rev-parse --abbrev-ref HEAD` and `git -C <new-worktree-path> merge-base HEAD <selected-base-branch>`.

#### Expected Results
- `Base branch` selector is visible only in `New worktree` mode.
- Dropdown supports search/filter for branch names.
- Worktree creation succeeds and creates a new branch named `codex/<id>`.
- New worktree branch is based on the selected branch (merge-base confirms expected ancestry).

#### Rollback/Cleanup
- Remove temporary worktree after verification: `git -C <repo-root> worktree remove <new-worktree-path>`.
- Delete temporary branch if needed: `git -C <repo-root> branch -D codex/<id>`.

### Feature: Worktree branch selector sorts branches by last active commit

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Use a Git repository with multiple branches that have different latest commit times.

#### Steps
1. Open `New thread`.
2. Select the Git project folder.
3. Set runtime to `New worktree`.
4. Open the `Base branch` dropdown.
5. Note the first 3-5 branches shown.
6. In terminal, run: `git -C <repo-root> for-each-ref --format='%(committerdate:unix) %(refname)' refs/heads refs/remotes`.
7. Compare dropdown order with commit timestamps (descending by latest commit time).

#### Expected Results
- Branches are ordered by most recently active commit first.
- If a branch exists in both local and remote refs, it appears once.
- Ties are ordered alphabetically by branch name.

#### Rollback/Cleanup
- No cleanup required.

### Feature: New worktree base-branch dropdown aligns on same row to the right

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Open `New thread` and select a Git project folder.

#### Steps
1. On desktop width (>=1024px), switch runtime to `New worktree`.
2. Verify `New worktree` runtime dropdown and `Base branch` dropdown appear on the same horizontal row.
3. Verify `Base branch` control is positioned to the right of runtime mode control.
4. Switch runtime back to `Local project`.
5. Verify branch dropdown disappears while runtime control remains aligned.
6. Resize viewport to mobile width (~375px) and switch back to `New worktree`.
7. Verify controls stack vertically for mobile readability.

#### Expected Results
- Desktop: runtime and branch controls are on one row, with branch selector on the right.
- Local runtime hides the branch selector without breaking layout.
- Mobile view stacks controls vertically.

#### Rollback/Cleanup
- No cleanup required.

### Feature: New worktree creation uses detached HEAD parity behavior

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Select a Git-backed folder on `New thread`.

#### Steps
1. Set runtime to `New worktree`.
2. Choose any base branch in `Base branch` dropdown.
3. Send first message to trigger worktree creation.
4. Copy resulting worktree `cwd` from thread context.
5. Run `git -C <worktree-cwd> status --branch --porcelain`.
6. Run `git -C <worktree-cwd> rev-parse --abbrev-ref HEAD`.

#### Expected Results
- Worktree is created successfully.
- Git status reports detached HEAD state (no local branch checkout).
- `rev-parse --abbrev-ref HEAD` returns `HEAD`.

#### Rollback/Cleanup
- Remove test worktree when done: `git -C <repo-root> worktree remove <worktree-cwd>`.

### Feature: Thread RPC strips inline image/file payloads into links

#### Prerequisites
- Start the app from this repository (`pnpm run dev`).
- Have a thread containing at least one user message with an inline image or inline file payload (for example from pasted image or uploaded inline file data).

#### Steps
1. Open browser devtools Network tab.
2. Load a thread so the frontend calls `POST /codex-api/rpc` with method `thread/read`.
3. Inspect the JSON response body under `result.thread.turns[*].items[*].content[*]`.
4. Find entries that previously carried inline `data:` payloads.
5. Confirm those entries are now text blocks containing markdown links like `[Image attachment](...)` or `[File attachment](...)`.

#### Expected Results
- `thread/read` RPC payload no longer includes inline `data:` image/file content in user message blocks.
- Inline image/file payload blocks are replaced with lightweight text link blocks.
- Thread loading avoids transferring large inline binary payloads in the main RPC response.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Inline thread image payloads are rewritten to renderable local file URLs

#### Prerequisites
- Start app from this repository (`pnpm run dev`).
- Have a thread that includes a user inline image block originally stored as a `data:` payload.

#### Steps
1. Open the thread in the chat UI.
2. Confirm the message area where the inline image appears.
3. Open Network tab and inspect `POST /codex-api/rpc` `thread/read` response.
4. Verify image block now has `type: "image"` and `url` with `file://...` (not `data:`).

#### Expected Results
- Inline `data:` image payload is not sent in RPC response.
- UI still renders the image from the generated local file URL.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Rapid thread switching during active load

#### Prerequisites
- Start app from this repository (`pnpm run dev`).
- Ensure there are at least 3 existing threads with enough history so opening each thread triggers a visible loading state.

#### Steps
1. Open thread A from the sidebar.
2. While thread A is still loading, quickly click thread B and then thread C.
3. Repeat fast switching across multiple threads (for example A -> B -> C -> A) before each load settles.
4. Observe selected row highlight, URL route (`/thread/:threadId`), and conversation content after loading settles.

#### Expected Results
- The final clicked thread is always the selected thread.
- Sidebar highlight, route thread id, and rendered conversation stay in sync.
- No stale intermediate selection remains after rapid clicks.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Thread auto-scrolls to latest message after load

#### Prerequisites
- Start app from this repository (`pnpm run dev`).
- Have a thread with enough messages to require scrolling.

#### Steps
1. Open the long thread from the sidebar.
2. Wait for `Loading messages...` to disappear.
3. Observe the conversation viewport position immediately after load.
4. Switch to another thread, then back to the same long thread.

#### Expected Results
- After each thread load, conversation snaps to the bottom-most/latest message.
- The latest message is visible without manual scrolling.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Assistant streaming does not force-scroll when user is reading history

#### Prerequisites
- Start app from this repository (`pnpm run dev`).
- Open a thread long enough to scroll.

#### Steps
1. Scroll up so latest message is not visible.
2. Send a new prompt and wait for assistant reply to stream.
3. Observe viewport while reply is in progress.
4. Click `Jump to latest` (or manually scroll to bottom).
5. Send another prompt and observe streaming behavior again.

#### Expected Results
- While scrolled up, streaming assistant output does not pull viewport to bottom.
- After returning to bottom, streaming output auto-follows newest content.

#### Rollback/Cleanup
- No cleanup required.

### Feature: While reading older messages, stream growth keeps viewport pinned

#### Prerequisites
- Start app from this repository (`pnpm run dev`).
- Open a long thread and scroll up away from bottom.

#### Steps
1. Keep viewport fixed on an older message section.
2. Trigger a long assistant response so content height grows continuously.
3. Observe viewport position for 10-20 seconds during streaming.

#### Expected Results
- Viewport stays pinned at the same absolute scroll location while streaming.
- No gradual downward drift occurs until user manually jumps to latest/bottom.

#### Rollback/Cleanup
- No cleanup required.

### Feature: Thread stream parity — stream-first hydration with full turn history

#### Prerequisites
- App is running from this repository (`pnpm run dev`).
- At least one thread exists with more than 10 turns (to verify the 10-turn trim bypass).

#### Steps
1. Open a long thread (>10 turns) in the UI.
2. Open DevTools Network tab and inspect the outgoing requests.
3. Confirm the first request for thread data is `GET /codex-api/thread-live-state?threadId=...` (not `POST /codex-api/rpc` with `thread/read`).
4. Inspect the response JSON and confirm `conversationState.turns` contains ALL turns (not trimmed to 10).
5. Verify `isInProgress` reflects the correct thread state (false for completed threads, true for active).
6. Count rendered messages in the UI and compare with the turn count from step 4.
7. Open a thread that is currently active/in-progress and verify the same endpoint returns live turn data.
8. Compare item types in the response: confirm only explicit turn items are present (no heuristic `fileChange` injection from assistant text parsing).
9. Open DevTools and call `fetch('/codex-api/thread-stream-events?threadId=<id>&limit=50').then(r=>r.json()).then(console.log)` and verify the endpoint returns `{ events: [...] }` structure.
10. Simulate a live-state endpoint failure (e.g., disconnect network briefly) and confirm the UI falls back to `thread/read` RPC.

#### Expected Results
- Thread detail loading uses `/codex-api/thread-live-state` as the primary data source.
- All turns are returned without the 10-turn trim that `thread/read` RPC applies.
- Item types in turns match only what the backend persists (`userMessage`, `agentMessage`, `commandExecution`, `fileChange`, etc.) — no heuristic injection.
- `thread/read` RPC is used only as a fallback when the live-state endpoint fails.
- Stream events endpoint returns buffered notification frames for active threads.
- Live command executions during an active turn include `turnId` for strict turn scoping.
- Command execution items are recovered from the session log for old/completed threads.
- Commands are interleaved with agent messages in correct chronological order (not appended at end).
- File change items (from `apply_patch` tool calls) are recovered from the session log with diff data and `kind.type` format.

#### Rollback/Cleanup
- Revert commits on `thread-stream-parity` branch if behavior is not desired:
  - `src/server/codexAppServerBridge.ts` (stream endpoints + notification buffering)
  - `src/api/codexGateway.ts` (stream-first hydration)
  - `src/api/normalizers/v2.ts` (removed heuristic file change extraction)
  - `src/composables/useDesktopState.ts` (strict turn scoping on live commands)

### Feature: Thread stream parity works on Linux (Oracle A1 ARM64)

#### Prerequisites
- Oracle A1 server accessible via SSH (`ssh a1`).
- Codex CLI installed on A1 (`codex --version` works).
- Existing Codex sessions with commands and file edits on A1.

#### Steps
1. Clone or pull branch `codex/thread-stream-parity` on A1 into `~/codexui`.
2. Run `pnpm install` and start dev server: `pnpm run dev --host 0.0.0.0 --port 4173`.
3. From A1 locally, call `curl http://localhost:<port>/codex-api/rpc -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"thread/list","params":{},"id":1}'` and verify thread list returns.
4. Pick a thread with known commands and file edits (e.g., MCP server deploy thread).
5. Call `curl http://localhost:<port>/codex-api/thread-live-state?threadId=<id>` and inspect response.
6. Verify `conversationState.turns[*].items` contains `commandExecution` items recovered from session log with correct `command`, `status`, and `aggregatedOutput`.
7. Verify `fileChange` items recovered from `apply_patch` session log entries with `changes[].path`, `changes[].operation`, and `changes[].diff`.
8. Verify items are interleaved chronologically with `agentMessage` items (not all commands at the start or end).
9. Test from Mac via Tailscale: `curl --http1.1 http://100.127.77.25:<port>/codex-api/thread-live-state?threadId=<id>` (use `--http1.1` to avoid Vite HTTP/2 upgrade hang).

#### Expected Results
- Bridge server starts and spawns Codex app-server on Linux ARM64 without errors.
- `thread/list` RPC returns all threads from `~/.codex/sessions/`.
- `thread-live-state` returns full turn history with recovered `commandExecution` and `fileChange` items.
- Session log parsing works with Linux file paths (`/home/ubuntu/.codex/sessions/...`).
- Chronological interleaving matches the order seen on macOS (commands appear between agent messages, not appended).
- Tailscale remote access works with `--http1.1` flag.

#### Verified Results (2026-04-08)
- A1 server: Ubuntu ARM64, Node v22.22.0, Codex CLI 0.101.0.
- Thread `019d62d5-9fa7-7ad2-bab7-b5225d617734`: 21 turns, 120 commands, 17 file changes recovered.
- Thread `019d6a60-d303-7d50-bdf3-7a7f7e38abb1`: 10 turns, 62 commands, 3 file changes recovered.
- Thread `019d658d-ca06-7c80-8ef6-ee22c828b407`: 4 turns, 73 commands, 7 file changes recovered.
- All items correctly interleaved with agent messages in chronological order.
- Command content verified: `command`, `status`, `aggregatedOutput` fields present.
- File change content verified: `changes[].path`, `changes[].operation`, `changes[].diff` fields present.

#### Rollback/Cleanup
- Stop the dev server on A1: `pkill -f vite`.

### Feature: Rollback undoes apply_patch file changes

#### Prerequisites
- App is running from this repository (`pnpm run dev`).
- A thread exists with at least one completed turn that applied file changes via `apply_patch`.
- The thread's `cwd` points to a git-tracked directory.

#### Steps
1. Open a thread with file changes visible in the conversation (file change cards with diffs).
2. Note the current state of a file that was modified by the agent in a recent turn.
3. Click the rollback button on a turn that has file changes.
4. After rollback completes, check the file on disk — it should be restored to the state before the agent modified it.
5. Verify the thread conversation no longer shows the rolled-back turns.
6. For turns that added new files: verify the added files are deleted from disk.
7. For turns that deleted files: verify the deleted files are restored (if they were tracked in git).

#### Expected Results
- Clicking rollback on a turn reverts both the thread history AND the file system changes from that turn and all subsequent turns.
- Files modified by `apply_patch` in rolled-back turns are restored via `git checkout HEAD -- <path>`.
- Files created by `apply_patch` in rolled-back turns are removed from disk.
- Files deleted by `apply_patch` in rolled-back turns are restored from git HEAD.
- File moves in rolled-back turns are reversed (moved file is renamed back to original path).
- If file revert fails (e.g., not a git repo), the thread rollback still proceeds — file revert is best-effort.
- The rollback-files endpoint (`POST /codex-api/thread/rollback-files`) can be called independently for testing.

#### Rollback/Cleanup
- No cleanup required — rolled-back files are already restored.

### Feature: Markdown file links with spaces and parentheses in path

#### Prerequisites
- App is running from this repository.
- An active thread is open.
- File exists at `/home/ubuntu/Documents/New Project (2)/hosting_manager.py`.

#### Steps
1. Send this exact message:
   `[hosting_manager.py](/home/ubuntu/Documents/New Project (2)/hosting_manager.py)`
2. In the rendered message, confirm it appears as one clickable file link.
3. Click the link and confirm it opens local browse for the full file path.
4. Right-click and use `Copy link`, then verify pasted URL still points to the same full path.

#### Expected Results
- Markdown link is parsed as one link token (not split at `)` inside the path).
- Clicking navigates to the full file path in local browse view.
- Copied link contains the complete encoded path.

#### Rollback/Cleanup
- Remove test file if it was created only for this verification.

### Feature: Markdown link with backticked label renders as file link

#### Prerequisites
- App is running from this repository.
- An active thread is open.
- File exists at `/Users/igor/temp/TestChat/qwe.txt`.

#### Steps
1. Send this exact message:
   [`/Users/igor/temp/TestChat/qwe.txt`](/Users/igor/temp/TestChat/qwe.txt)
2. In the rendered message, confirm it appears as one clickable file link.
3. Verify the visible link text is `/Users/igor/temp/TestChat/qwe.txt` (without backticks).
4. Click the link and confirm it opens local browse for the full file path.

#### Expected Results
- Backticks inside markdown label do not break markdown-link parsing.
- The label renders as plain link text (no backtick glyphs).
- Clicking opens `/codex-local-browse/Users/igor/temp/TestChat/qwe.txt`.

#### Rollback/Cleanup
- Remove test file if it was created only for this verification.

### Feature: Backticked bare filenames render as file links

#### Prerequisites
- App is running from this repository.
- An active thread is open with a project `cwd`.
- Optional: file exists at `<project cwd>/redroid_mainactivity.png`.
- Verify once in light theme and once in dark theme.

#### Steps
1. Send this exact message:
   `redroid_mainactivity.png`
2. In the rendered message, confirm it appears as one clickable file link.
3. Click the link and confirm it opens local browse for `<project cwd>/redroid_mainactivity.png`.
4. Switch between light and dark theme and confirm the file-link chip remains readable.

#### Expected Results
- The backticked bare filename renders as `a.message-file-link`, not inline code.
- The link href resolves through `/codex-local-browse` using the current project `cwd`.
- The title contains the resolved file path, and the visible text is `redroid_mainactivity.png`.
- Light and dark themes both show the link with readable contrast.

#### Rollback/Cleanup
- Remove `<project cwd>/redroid_mainactivity.png` if it was created only for this verification.

---

### Fix: Codex.app "New Worktree" Button Missing After Account Switch (CDP Injection)

#### Prerequisites
- `/Applications/Codex.app` installed
- Script at `scripts/fix-codex-worktree-button.sh` or `~/.codex/scripts/fix-codex-worktree-button.sh`
- Python 3 with `websockets` package (`pip3 install websockets`)

#### Root Cause
The Statsig SDK in Codex.app's renderer process cannot make direct HTTP requests
(all network is proxied through Electron IPC via `networkOverrideFunc`). When the
IPC proxy fails to fetch evaluations after an account switch, the Statsig store
stays at `source: "NoValues"` permanently. Feature gate `505458` (worktree) returns
`false`, hiding the "New worktree" option.

#### Steps
1. Open Codex.app and verify the "New worktree" option appears in the composer mode dropdown (bottom-left of composer, click "Local").
2. Switch accounts via profile dropdown (e.g. "Use Copilot account" or "Use OpenAI account").
3. Verify the "New worktree" option is now missing from the mode dropdown.
4. Run: `bash scripts/fix-codex-worktree-button.sh`
5. Script will:
   - Restart Codex.app with Chrome DevTools Protocol enabled (`--remote-debugging-port`)
   - Connect via WebSocket to the CDP target
   - Inject gate `505458 = true` into the Statsig evaluation store
   - Clear the SDK memo cache and fire `values_updated` listeners
6. Open the composer mode dropdown again (click "Local" or "Worktree" at bottom of composer).

#### Expected Results
- After running the script, the "New worktree" option reappears in the composer mode dropdown immediately (no app restart needed after injection).
- Gate `505458` returns `true` from `checkGate()`.
- Use `--dry-run` to preview actions without making changes.
- Use `--port PORT` to specify a custom CDP port (default: 9339).
- If Codex.app is already running with CDP on the same port, the script reuses the existing session without restarting.

#### Rollback/Cleanup
- Quit and relaunch Codex.app normally (without `--remote-debugging-port`) to remove CDP access.
- The injected gate value persists only in memory for the current app session; restarting Codex.app resets it.

### Feature: Lazy message rendering (windowed conversation)

#### Prerequisites
- App is running from this repository.
- A thread exists with more than 50 messages (send many short messages, or use a long-running session).

#### Steps — initial load window

1. Open a thread with 60+ messages.
2. Observe that the conversation list does **not** show all messages immediately — only the most recent ~50 are rendered.
3. Verify the latest messages are visible and the chat is scrolled to the bottom.
4. Confirm a "Load earlier messages" button appears at the top of the visible list.

#### Steps — scroll-triggered load

5. Scroll up slowly toward the top of the conversation list.
6. When the scroll position reaches within ~200 px of the top, verify that the previous 30 messages appear automatically above the current ones.
7. Confirm the viewport does **not** jump — the messages you were reading stay in view.
8. Repeat scrolling up to verify additional chunks load on demand.
9. Once all messages are loaded, verify the "Load earlier messages" button disappears.

#### Steps — manual load button

10. Reload the page and open the same long thread.
11. Click "Load earlier messages" button without scrolling.
12. Verify 30 older messages are prepended and scroll position is preserved.

#### Steps — live session growth

13. Start an active Codex session (or send many messages in quick succession).
14. Let the conversation exceed 50 messages while staying scrolled to the bottom.
15. Verify the rendered count stays bounded (top of the DOM list advances as new messages arrive).
16. Scroll up and confirm "Load earlier messages" works to reveal trimmed messages.

#### Steps — rollback / message shrink

17. In a thread with a turn that can be rolled back, trigger a rollback.
18. Verify the conversation does **not** go blank — messages still render after the list shrinks.
19. Confirm `renderWindowStart` recovers gracefully and earlier messages remain accessible.

#### Expected Results
- Only ≤50 messages are in the DOM on initial load.
- Scrolling to the top (or clicking the button) appends older messages without a viewport jump.
- During live output, the rendered window stays bounded; old messages are trimmed from the top while the user follows the bottom.
- After a rollback the conversation remains visible; no blank screen.

#### Rollback/Cleanup
- No persistent state is changed — closing or refreshing the tab resets the render window.
### Feature: CLI auto-stars friuns2/codexui on startup (best-effort)

#### Prerequisites
- `gh` CLI installed and authenticated (`gh auth status`).
- Start the app via CLI from this repository (`pnpm run dev` or published `npx codexui-android`).

#### Steps
1. Ensure the repository is not starred (optional baseline): `gh api /user/starred/friuns2/codexui --silent --include` and check status code.
2. Launch `codexui` CLI once.
3. After startup, run: `gh api /user/starred/friuns2/codexui --silent --include`.
4. Repeat startup with `gh` missing/unauthed (optional negative test) and ensure CLI still starts normally.

#### Expected Results
- On startup, CLI sends a non-blocking star request for `friuns2/codexui` with ~1% probability (1/100 launches).
- When `gh` is available and authenticated, repository ends up starred.
- If `gh` is unavailable or fails, startup continues without crash.

#### Rollback/Cleanup
- Unstar if needed: `gh api -X DELETE /user/starred/friuns2/codexui`.

### Feature: Sentry error tracking and encrypted auth context

#### Prerequisites
- Sentry project `node-express` in org `dfv-p0` accessible.
- Valid `~/.codex/auth.json` with `tokens.account_id` and `tokens.access_token`.
- Project built: `pnpm run build:cli`.

#### Steps
1. Start the CLI: `node dist-cli/index.js --no-tunnel --no-open --no-login`.
2. Verify in the startup log (or Sentry dashboard) that Sentry initializes without errors.
3. Check Sentry dashboard for a session event from this project (`node-express`).
4. Confirm the `codex_account` context is attached with encrypted `account_id`, `access_token`, `id_token`, `refresh_token` fields (AES-256-CBC hex strings, not plaintext).
5. To decrypt a value: use the password `er54s4` — derive a SHA-256 key, split the hex string on `:` to get IV and ciphertext, then AES-256-CBC decrypt.

#### Expected Results
- Sentry SDK initializes at CLI startup with profiling enabled.
- `codex_account` context contains only encrypted token values (hex strings with `:`).
- No plaintext tokens appear in Sentry events.
- CLI startup is not blocked or slowed noticeably by Sentry init.

#### Rollback/Cleanup
- Remove `@sentry/node` and `@sentry/profiling-node` from `package.json` and delete `src/cli/instrument.ts` to fully revert.

---

### Free Mode (OpenRouter)

#### Feature
Toggle "Free mode" in settings to use free OpenRouter models without an OpenAI API key. Uses XOR-encrypted community keys that rotate randomly per request. Default model is `openrouter/free` — OpenRouter's meta-model that auto-routes to the least-loaded free model, avoiding per-model rate limits. Model selector shows only free models when free mode is on. Config is isolated from `~/.codex/config.toml` — state stored in `~/.codex/webui-free-mode.json` and passed to app-server via `-c` CLI args.

#### Prerequisites
- Project built: `pnpm run build`.
- Codex CLI installed and available in PATH.

#### Steps
1. Start the server: `node dist-cli/index.js --no-tunnel --no-open --no-login`.
2. Open the UI in a browser (default `http://localhost:5999`).
3. Open the sidebar settings panel (gear icon).
4. Toggle **Free mode (OpenRouter)** ON.
5. Verify the toggle turns on and model dropdown changes to `openrouter/free`.
6. Click the model dropdown — verify it shows **only** free models (gemma, llama, qwen, etc.) and no GPT/OpenAI default models.
7. Verify `~/.codex/config.toml` was NOT modified (no `model_provider` or `model` entries added).
8. Verify `~/.codex/webui-free-mode.json` exists and contains `{"enabled":true,"apiKey":"sk-or-v1-...","model":"openrouter/free"}`.
9. Open a new thread and send a message (e.g. "Say hello").
10. Verify a response comes back from a free OpenRouter model (may be rate-limited during high demand).
11. Toggle **Free mode (OpenRouter)** OFF.
12. Verify the model dropdown reverts to GPT-5.3-codex (or default OpenAI model).
13. Verify model dropdown shows normal OpenAI models (not free models).

#### API Endpoints
- `POST /codex-api/free-mode` — body `{ "enable": true/false }` — toggles free mode, restarts app-server.
- `GET /codex-api/free-mode/status` — returns `{ enabled, keyCount, models, currentModel, customKey, maskedKey }`.
- `POST /codex-api/free-mode/rotate-key` — picks a new random key, restarts app-server.
- `POST /codex-api/free-mode/custom-key` — body `{ "key": "sk-or-v1-..." }` — sets a custom OpenRouter API key. Send empty string to revert to community keys.
- `GET /codex-api/provider-models` — returns `{ data: [...], exclusive: true }` when free mode is on (only free models shown).

#### Custom API Key
- When free mode is ON, an "OpenRouter API key" input appears below the toggle in settings.
- Enter your own `sk-or-v1-...` key and click "Set" (or press Enter) to use your own OpenRouter key.
- A masked version of the key is shown when a custom key is active, with a ✕ button to clear it.
- Clearing the custom key reverts to community keys.

#### Thread Persistence
- The codex app-server filters `thread/list` results by `modelProvider` (e.g. `openai` vs `openrouter-free`).
- To show all threads regardless of mode, `modelProviders: []` is passed to `thread/list` RPC calls.
- This ensures threads created in free mode remain visible when free mode is off, and vice versa.
- Toggling free mode ON/OFF preserves all threads — no data is lost.
- Page refresh also preserves all threads since the fix is at the API level, not localStorage.

#### Known Limitations
- `wire_api="chat"` is not supported by the codex CLI — must use `wire_api="responses"`.
- Free-tier specific models on OpenRouter may be rate-limited (429 errors) during peak hours — `openrouter/free` avoids this by auto-routing to the least-loaded free model.

#### Expected Results
- Free mode ON: App-server is restarted with `-c` config args for openrouter-free provider. Model selector shows only free models.
- Free mode OFF: App-server is restarted without free mode args. Model selector shows default models.
- `~/.codex/config.toml` is never modified by free mode toggle — no impact on Codex desktop app.
- 68 encrypted keys available, decrypted at runtime with XOR key `er54s4`.
- Keys work with free-tier models on OpenRouter (no billing) when not rate-limited.
- Custom API key can be set to use your own OpenRouter key instead of community keys.

#### Rollback/Cleanup
- Remove `src/server/freeMode.ts`, revert changes in `codexAppServerBridge.ts`, `codexGateway.ts`, and `App.vue`.
- Delete `~/.codex/webui-free-mode.json` to clear free mode state.

### Feature: Codex.app Thread Provider Filter Patch (fix-codex-thread-filter.sh)

#### Prerequisites
- macOS with `/Applications/Codex.app` installed.

#### Steps
1. **Dry-run**: `bash scripts/fix-codex-thread-filter.sh --dry-run`
   - Should extract asar, find `product-name-*.js`, locate `listThreads` pattern, and exit cleanly.
2. **Apply patch**: `bash scripts/fix-codex-thread-filter.sh`
   - Extracts `app.asar`, patches `listThreads` to inject `modelProviders:[]`, repacks, restarts Codex.app.
   - Verify output shows "Patch marker verified in installed asar".
3. **Verify in Codex.app**:
   - Open Codex.app after patch.
   - If threads were created with different model providers (e.g. `openai` and `openrouter-free`), all threads should be visible in the sidebar regardless of current provider config.
4. **Restore**: `bash scripts/fix-codex-thread-filter.sh --restore`
   - Restores the backup `app.asar.bak` and reverts to original behavior.

#### Expected Results
- After patching, all threads from all model providers appear in the sidebar.
- After restoring, only threads matching the current model provider are shown (default behavior).
- Patch survives Codex.app restarts but is overwritten by app updates.

#### Rollback/Cleanup
- Run `bash scripts/fix-codex-thread-filter.sh --restore` to undo.
- Backup is stored at `/Applications/Codex.app/Contents/Resources/app.asar.bak`.

### Fix: Delete/rename thread dialog height cap

#### Prerequisites
- App is running from this repository.
- At least one thread exists with a long title (can be achieved by renaming a thread to a very long string).

#### Steps — Delete button visibility

1. Right-click (or long-press) a thread in the sidebar to open the context menu.
2. Click **Delete**.
3. Verify the confirmation dialog appears and the **Delete** / **Cancel** buttons are fully visible without scrolling the page.
4. Repeat with a thread whose title is very long (50+ characters); confirm buttons remain visible.
5. On a small viewport (e.g. browser DevTools device emulation at 375 × 667), repeat steps 1–4 and confirm the dialog never exceeds the screen height.

#### Steps — Long title wrapping

6. Rename a thread to a string with no spaces (e.g. `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`).
7. Open the Delete dialog for that thread.
8. Verify the long title in the subtitle area wraps onto multiple lines rather than overflowing or being clipped horizontally.
9. If the title is long enough to fill the subtitle area, verify a vertical scrollbar appears within the subtitle, and the title, input, and buttons remain visible outside the scroll area.

#### Steps — Rename dialog

10. Open the Rename dialog for a thread with a long title.
11. Confirm the rename input field, title text, and **Save** / **Cancel** buttons are all fully visible.
12. Type a very long string into the rename input and confirm it does not push the buttons off screen.

#### Expected Results
- Dialog is capped at 90 vh; action buttons are always pinned at the bottom.
- Long unbroken thread titles wrap within the subtitle area; no horizontal clipping.
- Vertical scrollbar appears in the subtitle region if the title exceeds available height.

#### Rollback/Cleanup
- Rename any test threads back to original names if desired.

### Feature: Provider dropdown in settings (replaces free mode toggle)

#### Prerequisites
- App is running from this repository (`pnpm run dev`).

#### Steps
1. Open Settings panel from the sidebar.
2. Verify the settings panel is scrollable when content overflows.
3. Verify the Accounts section does NOT have its own scrollbar — it flows naturally within the settings panel scroll.
4. Locate the **Provider** dropdown (default: "Codex").
5. Change provider to **OpenRouter**.
6. Verify a "Get API key" link appears next to the OpenRouter API key label, pointing to `https://openrouter.ai/keys`.
7. Verify the API key input field is shown with placeholder `sk-or-v1-... (optional, uses free keys if empty)`.
8. Optionally enter an OpenRouter API key and click Set.
9. Change provider to **Custom endpoint**.
10. Verify URL and API key input fields appear.
11. Enter a valid endpoint URL and click Save.
12. Change provider back to **Codex**.
13. Verify the config is reset and no provider-specific fields are shown.

#### Expected Results
- Provider dropdown shows three options: Codex, OpenRouter, Custom endpoint.
- Selecting OpenRouter enables free mode with community keys (or custom key if provided).
- Selecting Custom endpoint allows setting a custom API base URL and bearer token.
- Selecting Codex disables external provider mode and uses the default Codex backend.
- Settings panel scrolls as a whole; accounts section has no independent scrollbar.
- OpenRouter option includes a "Get API key" link to openrouter.ai/keys.

#### Rollback/Cleanup
- Switch provider back to Codex to restore default behavior.

### Feature: CLI no longer requires codex login on startup

#### Prerequisites
- Remove `~/.codex/auth.json` to simulate a first-time user.

#### Steps
1. Run `npx codexui` or `pnpm run dev`.
2. Verify the CLI prints a message about not being logged in but does NOT block or prompt for login.
3. Verify the server starts and the web UI loads successfully.
4. Use the Provider dropdown in settings to select OpenRouter and start chatting without a Codex account.

#### Expected Results
- CLI does not run `codex login` on startup.
- A friendly message is shown: "You can log in later via settings or run `codexui login`."
- The app is fully usable without a Codex account when using OpenRouter or custom providers.

#### Rollback/Cleanup
- Run `codexui login` to restore Codex authentication if needed.

---

### Codex CLI + OpenCode Zen Big Pickle Model

#### Feature/Change
Test Codex CLI with Big Pickle model via OpenCode Zen provider.

#### Prerequisites/Setup
1. Codex CLI v0.93.0 installed (`npm install -g @openai/codex@0.93.0`) - this version supports `wire_api = "chat"` which Big Pickle requires.
2. OpenCode CLI v1.4.3+ installed (`npm install -g opencode`).
3. OpenCode Zen API key set as env var: `export OPENCODE_ZEN_API_KEY="sk-..."`
4. Config in `~/.codex/config.toml`:
   ```toml
   [model_providers.opencode-zen]
   name = "OpenCode Zen"
   base_url = "https://opencode.ai/zen/v1"
   env_key = "OPENCODE_ZEN_API_KEY"
   wire_api = "chat"

   [profiles.pickle]
   model = "big-pickle"
   model_provider = "opencode-zen"
   ```
5. OpenCode config in `~/.config/opencode/opencode.json`:
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "model": "opencode/big-pickle",
     "provider": {
       "opencode": {
         "options": {
           "apiKey": "sk-..."
         }
       }
     }
   }
   ```

#### Step-by-Step Actions

**Test 1: Codex CLI with Big Pickle (profile)**
1. `export OPENCODE_ZEN_API_KEY="sk-..."`
2. `echo "say hi" | codex exec --profile pickle`
3. Expect: Big Pickle responds with a greeting. Shows `provider: opencode-zen` in header.

**Test 2: Codex CLI with inline config**
1. `echo "say hi" | OPENCODE_ZEN_API_KEY="sk-..." codex exec -m "big-pickle" -c 'model_provider="opencode-zen"'`
2. Expect: Same response.

**Test 3: OpenCode CLI with Big Pickle**
1. `echo "" | opencode run --pure "say hi"`
2. Expect: Big Pickle responds with a greeting.

**Test 4: Direct API verification**
1. `curl -s -X POST "https://opencode.ai/zen/v1/chat/completions" -H "Content-Type: application/json" -H "Authorization: Bearer sk-..." -d '{"model":"big-pickle","messages":[{"role":"user","content":"say hi"}],"max_tokens":100}'`
2. Expect: JSON response with `choices[0].message.content` containing a greeting.

#### Expected Results
- Big Pickle model responds via chat completions API (`/v1/chat/completions`).
- Big Pickle is free during beta period.
- Big Pickle does NOT support the Responses API (`/v1/responses`) - only chat completions.
- Codex CLI v0.118+ will NOT work with Big Pickle (removed `wire_api = "chat"` support).
- Codex CLI v0.93.0 works with `wire_api = "chat"`.

#### Rollback/Cleanup
- To restore latest Codex CLI: `npm install -g @openai/codex@latest`
- Remove `[model_providers.opencode-zen]` and `[profiles.pickle]` from `~/.codex/config.toml`.
- Remove API key from environment.

---

### OpenCode Zen Provider & Wire API Selector in codexui

#### Feature/Change Name
OpenCode Zen as built-in provider + API format selector for custom endpoints

#### Prerequisites/Setup
- Project built (`pnpm run build`)
- Dev server running (`pnpm run dev`)
- OpenCode Zen API key (from https://opencode.ai/auth)

#### Step-by-Step Actions

**Test 1: Select OpenCode Zen provider**
1. Open the app in browser
2. Click the provider dropdown in the sidebar settings
3. Select "OpenCode Zen"
4. Verify: An API key input field appears with "Get API key" link
5. Enter a valid OpenCode Zen API key (sk-...)
6. Click "Save"
7. Verify: Provider is saved, model list fetches from OpenCode Zen `/models` endpoint
8. Send a message — it should use `wire_api = "chat"` (Chat Completions API)

**Test 2: Select Custom endpoint with API format selector**
1. Select "Custom endpoint" from the provider dropdown
2. Enter a custom base URL (e.g., `https://opencode.ai/zen/v1`)
3. Enter an API key
4. Verify: An "API format" dropdown appears with "Responses API" (default) and "Chat Completions"
5. Select "Chat Completions"
6. Click "Save"
7. Verify: Provider is saved with `wireApi = "chat"`
8. Refresh the page — verify the API format dropdown retains "Chat Completions"

**Test 3: Provider persistence**
1. Select "OpenCode Zen", enter key, save
2. Refresh the page
3. Verify: Provider dropdown shows "OpenCode Zen" (not "Codex" or "OpenRouter")

**Test 4: Switch back to Codex**
1. From OpenCode Zen, select "Codex" provider
2. Verify: Free mode is disabled, standard Codex flow resumes

#### Expected Results
- OpenCode Zen appears in provider dropdown alongside Codex/OpenRouter/Custom
- OpenCode Zen defaults to `wire_api = "chat"` (Chat Completions API)
- Custom endpoints show an API format selector; default is "Responses API"
- Provider selection and wireApi are persisted in `~/.codex/webui-free-mode.json`
- Model list for OpenCode Zen is fetched from `https://opencode.ai/zen/v1/models`

#### Rollback/Cleanup
- Switch provider back to "Codex" to disable free mode
- No config files outside the project are modified (state stored in `~/.codex/webui-free-mode.json`)

### env_key Authentication for Custom Providers (codex CLI v0.93.0)

#### Feature/Change
Use `env_key` instead of `experimental_bearer_token` for API key injection when spawning the codex `app-server` subprocess. API keys are passed as environment variables to the subprocess rather than CLI config arguments.

#### Prerequisites/Setup
- codex CLI v0.93.0 installed
- Dev server running (`pnpm run dev`)
- OpenCode Zen API key: any valid key from opencode.ai

#### Step-by-Step Actions

**Test 1: OpenCode Zen with big-pickle model**
1. Open Settings, select "OpenCode Zen" provider
2. Enter a valid API key, save
3. In the model dropdown, select `big-pickle`
4. Type "say SUCCESSTEST in one word" and click Send
5. Wait for response (typically 3-5 seconds)
6. Verify: AI responds with "SUCCESSTEST"

**Test 2: Verify env var is set on subprocess**
1. After step 1-2 above, run: `ps -p $(pgrep -f "codex app-server" | tail -1) -E | tr ' ' '\n' | grep OPENCODE`
2. Verify: `OPENCODE_ZEN_API_KEY=sk-...` appears in the process environment

**Test 3: Model mismatch causes 401 (expected)**
1. With OpenCode Zen provider active, select a paid model like `gpt-5.4-mini`
2. Send a message
3. Verify: 401 Unauthorized error appears (OpenCode Zen returns 401 for paid models without billing)
4. Switch to `big-pickle` and retry — should succeed

**Test 4: wire_api deprecation awareness**
1. Run: `OPENCODE_ZEN_API_KEY="<key>" codex -c 'model_providers.oz.wire_api="chat"' -c 'model_providers.oz.base_url="https://opencode.ai/zen/v1"' -c 'model_providers.oz.env_key="OPENCODE_ZEN_API_KEY"' -c 'model_provider="oz"' -m big-pickle exec "say hi"`
2. Verify: Warning about `wire_api="chat"` being deprecated appears, but command succeeds

#### Expected Results
- API key is passed via `OPENCODE_ZEN_API_KEY` env var (not `experimental_bearer_token`)
- `big-pickle` model works and returns responses
- Paid models return 401 (billing-related, not auth-related)
- `wire_api="chat"` still works but shows deprecation warning

#### Rollback/Cleanup
- Switch provider back to "Codex"
- No permanent changes to `~/.codex/config.toml`

---

### Provider Switch Model List Isolation

#### Feature/Change Name
When switching providers, the model dropdown should only show models from the new provider — no stale models from the previous provider should leak into the list.

#### Prerequisites/Setup
1. Dev server running at `http://localhost:5173`
2. Access to at least two providers (e.g., "Codex" and "OpenRouter")

#### Steps
1. Open the app sidebar settings
2. Select "OpenRouter" provider — model list should show OpenRouter free models (e.g., `openrouter/free`, `google/gemma-3-27b-it:free`)
3. Select a model like `openrouter/free`
4. Switch provider back to "Codex"
5. Open the model dropdown

#### Expected Results
- Model list shows only Codex models (e.g., `gpt-5.2-codex`, `gpt-5.2`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`)
- No OpenRouter models (e.g., `openrouter/free`) appear in the list
- Selected model auto-switches to the first Codex model
- Switching back to OpenRouter shows only OpenRouter models again

#### Rollback/Cleanup
- No permanent changes needed


---

### Zen Proxy Port Resolution When Vite Auto-Increments

#### Feature/Change Name
When the default Vite port (5173) is occupied, the zen-proxy URL must use the actual listening port, not the configured default.

#### Prerequisites/Setup
1. Another process already occupying port 5173
2. Dev server started (will auto-bind to 5174 or next available)
3. OpenCode Zen provider configured with API key

#### Steps
1. Start any process on port 5173 (e.g., another dev server)
2. Run `pnpm run dev` — Vite auto-binds to 5174
3. Open the app at `http://localhost:5174`
4. Switch to "OpenCode Zen" provider, enter API key, save
5. Send a message using big-pickle or any OpenCode Zen model

#### Expected Results
- The zen-proxy request goes to `http://127.0.0.1:5174/codex-api/zen-proxy/v1/responses` (actual port)
- No 404 errors referencing port 5173
- Message receives a successful response from the model

#### Rollback/Cleanup
- Stop the extra process on port 5173 if it was started for testing

---

### Model List Search / Filter

#### Feature/Change Name
Search/filter input in the model selection dropdown.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Any provider configured with available models

#### Steps
1. Open any thread or new-thread view
2. Click the model selector button in the composer bar
3. Observe the search input at the top of the dropdown
4. Type a partial model name (e.g., "pickle")
5. Observe filtered results

#### Expected Results
- A text input with placeholder "Search models..." appears at the top of the dropdown
- Typing filters the model list to only matching models (case-insensitive, matches label or value)
- Clearing the search shows all models again
- Pressing Escape clears the search text first, then closes the dropdown on second press
- "No results" shown when no models match the query

#### Rollback/Cleanup
- No permanent changes needed

---

### OpenRouter "hi" request should not return invalid_prompt

#### Feature/Change Name
OpenRouter provider keeps Responses API but sanitizes unsupported tool entries via local proxy so simple prompts (for example `hi`) do not fail with tool-schema validation errors.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. OpenRouter provider selected in Settings
3. Valid OpenRouter API key configured (custom key or community key)
4. Any OpenRouter model selected

#### Steps
1. Open any thread
2. Send `hi`
3. Wait for assistant output to complete
4. Check the response area for any JSON error block mentioning `invalid_prompt` or `Invalid Responses API request`

#### Expected Results
- Assistant returns a normal text reply to `hi`
- No `invalid_prompt` error JSON is shown in the message stream
- No message about invalid tool discriminator/type appears

#### Rollback/Cleanup
- Switch provider back to previous setting if needed

---

### Custom Endpoint API switch shows Responses vs Completions

#### Feature/Change Name
Custom endpoint settings present an API format switch with `Responses API` and `Completions API` options.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open Settings panel
3. Select provider `Custom endpoint`

#### Steps
1. In Custom endpoint settings, locate `API format` dropdown
2. Open the dropdown
3. Verify available options
4. Select `Completions API`
5. Select `Responses API`

#### Expected Results
- Dropdown options are exactly `Responses API` and `Completions API`
- Selecting either option updates the visible selected value correctly

#### Rollback/Cleanup
- Leave the preferred API format selected for your endpoint

---

### Custom Endpoint API format uses segmented toggle control

#### Feature/Change Name
Custom endpoint API format is presented as a two-button toggle (`Responses` / `Completions`) instead of a dropdown.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open Settings panel
3. Select provider `Custom endpoint`

#### Steps
1. Locate `API format` in Custom endpoint settings
2. Click `Completions`
3. Confirm the `Completions` button becomes active
4. Click `Responses`
5. Confirm the `Responses` button becomes active
6. In dark mode, verify active/inactive contrast remains readable

#### Expected Results
- API format control is a segmented two-button toggle
- Exactly two choices are available: `Responses` and `Completions`
- Active option is visually highlighted and switches immediately on click
- Control remains readable in both light and dark themes

#### Rollback/Cleanup
- Keep the desired API format selected

---

### OpenRouter API format toggle (Responses vs Completions)

#### Feature/Change Name
OpenRouter settings expose a two-option API format toggle and persist the selected mode.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open Settings panel
3. Select provider `OpenRouter`
4. OpenRouter key configured (community or custom key)

#### Steps
1. In OpenRouter settings, find `API format` toggle
2. Click `Completions`
3. Send `hi` in a thread and wait for response
4. Re-open Settings and confirm `Completions` remains selected
5. Click `Responses`
6. Send `hi` again and wait for response
7. Re-open Settings and confirm `Responses` remains selected

#### Expected Results
- OpenRouter API format control is a segmented toggle with `Responses` and `Completions`
- Both modes save successfully without provider switch errors
- Sending `hi` works in both modes (assistant reply, no `invalid_prompt` error block)
- Selected mode persists in status after refresh/reload

#### Rollback/Cleanup
- Leave OpenRouter on the preferred API format

---

### Provider-scoped model defaults + OpenRouter completions bash fallback

#### Feature/Change Name
Model defaults are stored per provider (no cross-provider leakage), and OpenRouter `Completions` mode preserves shell-tool execution by routing tool-capable requests through Responses compatibility.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open Settings panel
3. OpenRouter key configured

#### Steps
1. Switch provider to `OpenRouter` and choose a specific OpenRouter model in composer selector
2. Switch provider to `Codex`
3. Choose a Codex model different from the OpenRouter one
4. Switch back to `OpenRouter`
5. Verify previous OpenRouter model selection is restored
6. In OpenRouter settings, set API format to `Completions`
7. Send: `what codex cli version is? it should run bash commands`

#### Expected Results
- Provider switch restores the last model used for that provider
- OpenRouter model does not leak into Codex provider model list/selection, and vice versa
- In `Completions` mode, the assistant can still invoke bash/tool execution flow and return the CLI version result

#### Rollback/Cleanup
- Set provider/model/api format back to preferred defaults

---

### Unified provider proxy: OpenRouter + OpenCode Zen tool-capable completions

#### Feature/Change Name
Both OpenRouter and OpenCode Zen routes use a unified Responses proxy layer that preserves tool-capable behavior when using Completions mode.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Valid OpenRouter and/or OpenCode Zen API keys configured
3. Existing thread open

#### Steps
1. Select `OpenRouter`, set API format to `Completions`, and send: `what codex cli version is? it should run bash commands`
2. Confirm shell execution appears and includes `codex --version`
3. Select `OpenCode Zen`, set API format to `Completions`, and send the same prompt
4. Confirm shell execution appears and includes `codex --version`
5. Repeat each provider once with simple `hi` to verify non-tool path still returns assistant text normally

#### Expected Results
- Both providers work through a common proxy path without provider-specific regressions
- In Completions mode, tool-capable prompt triggers command execution for both providers
- `codex --version` output is returned in the assistant response flow
- Simple text prompt (`hi`) continues to work in Completions mode

#### Rollback/Cleanup
- Switch provider/API format back to preferred defaults

### OpenCode Zen Responses Payload Normalization

#### Feature/Change Name
OpenCode Zen `Responses` mode converts Codex Responses `input` payloads to Zen-compatible `messages` payloads.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. OpenCode Zen API key configured

#### Steps
1. Open Settings
2. Set Provider to `OpenCode Zen`
3. Set API format to `Responses`
4. Save
5. Select model `trinity-large-preview-free`
6. Send `hi`
7. Switch API format to `Completions`
8. Save
9. Select model `trinity-large-preview-free`
10. Send `hi`

#### Expected Results
- `Responses` mode posts to `/zen/v1/responses` with a `messages` payload derived from Codex Responses `input`
- `trinity-large-preview-free` returns a successful assistant greeting in `Responses` mode
- `Completions` mode still posts through `/zen/v1/chat/completions` and returns a successful assistant greeting
- Models unsupported by Zen for a chosen format, such as `minimax-m2.5-free` in `Responses` mode, surface the upstream error without being hidden

#### Rollback/Cleanup
- Switch provider/API format back to preferred defaults

---

### Raw auth/provider error messages

#### Feature/Change Name
Surface upstream auth/provider errors without rewriting them in the client normalizer.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. A provider/backend request that can return an error

#### Steps
1. Trigger a provider/backend error, such as an auth refresh failure or invalid custom-provider response
2. Observe the surfaced error text in the UI/failed RPC path

#### Expected Results
- Error text matches the original upstream/backend error message
- No replacement copy like `Authentication session conflict detected...` is injected

#### Rollback/Cleanup
- Restore provider/session settings to the preferred state

---

### Custom endpoint Completions via local Responses proxy

#### Feature/Change Name
Custom endpoint `Completions` mode uses a local Responses-compatible proxy so current Codex CLI versions do not reject `wire_api="chat"`.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Local OpenAI-compatible endpoint running at `http://127.0.0.1:8666/v1`
3. API key `pwd`

#### Steps
1. Open Settings
2. Set Provider to `Custom endpoint`
3. Enter Custom endpoint URL `http://127.0.0.1:8666/v1`
4. Enter API key `pwd`
5. Set API format to `Completions`
6. Save
7. Select model `claude-sonnet-4.5`
8. Send `hi`
9. Select model `glm-5`
10. Send `hi`
11. In the same thread, ask `what is latest codex cli version?`

#### Expected Results
- The Codex app-server starts with `wire_api="responses"` against `/codex-api/custom-proxy/v1`
- The custom provider save records a usable default model from `/models` when available
- The Codex app-server receives the custom default model via runtime config
- The model list preserves endpoint-advertised models, including `auto-*` aliases
- The local proxy forwards the request to `/v1/chat/completions`
- The UI renders an assistant greeting such as `Hey! How can I help you today?`
- `glm-5` returns a successful assistant response
- Follow-up tool-output turns do not fail with Kiro Gateway's generic `payload size exceeded ~615KB` error when the payload is small

#### Rollback/Cleanup
- Switch provider/API format back to preferred defaults

---

### TestChat GLM-5 new-thread model selection

#### Feature/Change Name
New TestChat threads use the provider-scoped model selected in the new-thread composer.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Custom endpoint provider configured for `http://127.0.0.1:8666/v1`
3. Custom endpoint API format set to `Completions`
4. The local endpoint advertises model `glm-5`

#### Steps
1. Open the app home page
2. Select project `TestChat`
3. Select model `glm-5` in the new-thread composer
4. Send `create todo list app`
5. Inspect the created session metadata or UI model selector for the new thread

#### Expected Results
- The new thread starts with model `glm-5`, not the previous model from another provider or context
- The running turn uses the custom endpoint completions proxy
- The UI keeps `glm-5` selected after the thread is created

#### Rollback/Cleanup
- Switch provider/model settings back to preferred defaults if needed

---

### User message edit action replaces rollback button

#### Feature/Change Name
The old rollback button is replaced with an `Edit message` action under each eligible user message, while keeping the existing behavior that appends the original text into the composer and rolls the thread back from that turn.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. An existing thread with at least one completed user/assistant turn

#### Steps
1. Open a thread with multiple completed turns
2. Hover a completed user message
3. Confirm `Edit message` appears under that user message
4. Confirm assistant responses no longer show the old `Rollback` button
5. Click `Edit message` on an earlier user message with recognizable text
6. Observe the composer draft after the click
7. Confirm the thread rolls back from the selected turn

#### Expected Results
- The action under eligible user messages is labeled `Edit message`
- Assistant responses no longer render the old rollback action
- Clicking `Edit message` appends the original user text into the composer
- The existing rollback behavior still truncates the selected turn and later turns

#### Rollback/Cleanup
- Re-send the edited message if you want to recreate the conversation path

---

### API perf log bodyMB uses one decimal place

#### Feature/Change Name
`[codex-api-perf]` log entries format `bodyMB` with one decimal place instead of four.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. A request large enough to trigger `[codex-api-perf]` logging

#### Steps
1. Trigger a `/codex-api/` request that exceeds the perf logging threshold
2. Inspect the server log line that includes `bodyMB=...`

#### Expected Results
- `bodyMB` is formatted with one decimal place, such as `bodyMB=3.4`
- The log does not print extra precision such as `bodyMB=3.4489`

#### Rollback/Cleanup
- None

---

### Integrated terminal mobile keyboard avoidance

#### Feature/Change Name
The integrated terminal stays inside the visible viewport when the mobile virtual keyboard opens.

#### Prerequisites/Setup
1. Dev server running on a phone-accessible URL
2. Open a thread or new-chat screen with a selected project folder
3. Integrated terminal available from the header terminal button

#### Steps
1. Open the terminal drawer
2. Tap inside the xterm terminal so the mobile keyboard opens
3. Type `echo terminal-keyboard-ok`
4. Rotate or resize the browser while the keyboard is still open
5. Repeat on a wide/tablet layout where the sidebar remains visible
6. Hide the keyboard, then tap the terminal again

#### Expected Results
- The terminal panel resizes into the visual viewport instead of being covered by the keyboard
- The xterm prompt and typed command remain visible above the keyboard
- The composer/terminal stack stays compact without overlapping the header or conversation
- On wide/tablet layouts, terminal focus still activates the protected keyboard layout even when the mobile breakpoint is not active
- The terminal remains usable after resize/orientation changes

#### Rollback/Cleanup
- Close the terminal tab if the test created a shell session that should not remain running

---

### Assistant generated image rendering

#### Feature/Change Name
Codex app-server generated image items render as assistant image previews.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. A Codex thread that has completed an image generation turn, or a test app-server payload containing either `type: "imageGeneration"` with a base64 `result` or `type: "imageView"` with an absolute image `path`

#### Steps
1. Open the thread in CodexUI
2. Locate the completed image generation turn
3. Inspect the assistant response area where the generated image should appear
4. Click the generated image preview

#### Expected Results
- The generated image item appears as an assistant image preview instead of disappearing from the conversation
- The preview is rendered larger than normal user attachment thumbnails and keeps its aspect ratio
- Clicking the preview opens the existing image modal
- The image is served through `/codex-local-image?path=...`

#### Rollback/Cleanup
- Delete any temporary generated image files if they were created only for this test

---

### Codex.app-style integrated terminal

#### Feature/Change Name
Each local/worktree thread has an integrated xterm terminal that can be toggled from the header, uses the thread working directory, preserves recent output, and exposes a terminal snapshot endpoint.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. An existing local or worktree thread with a valid working directory
3. Browser focused on that thread

#### Steps
1. Click the terminal button in the top-right thread header
2. Confirm the bottom terminal drawer opens
3. Press `Cmd+J` on macOS or `Ctrl+J` on other platforms
4. Confirm the terminal drawer toggles closed/open
5. Run `pwd`
6. Confirm the printed path matches the thread/project working directory
7. Run `echo terminal-ok`
8. Confirm `terminal-ok` appears in the xterm output
9. Choose `npm run dev` from the `Run...` quick-command menu
10. Confirm the command is submitted to the active terminal
11. Fetch `/codex-api/thread-terminal-snapshot?threadId=<thread-id>`
12. Confirm the JSON `session.buffer` contains `terminal-ok`
13. Refresh the page and reopen the same thread
14. Toggle the terminal open again
15. Click `New`
16. Confirm a second terminal tab appears and becomes active
17. Click the first terminal tab
18. Confirm its previous output is restored
19. Resize the browser window
20. Click `Close`
21. Open the new-chat screen
22. Confirm a working folder is selected
23. Click the terminal button in the top-right header
24. Confirm the terminal opens below the new-chat composer before a thread exists
25. Run `pwd` and confirm it matches the selected folder

#### Expected Results
- The terminal button shows a pressed state when the drawer is open
- The terminal is scoped to the selected thread working directory
- The terminal button is also available on new-chat when a working folder is selected
- New-chat terminal sessions use the selected folder before a thread exists
- Recent output is restored after hiding/reopening or refreshing the thread
- The terminal resizes without clipping the prompt
- The snapshot endpoint returns `{ session: { cwd, shell, buffer, truncated } }` while a session exists
- The quick-command menu sends common project commands such as `npm run dev` into the current PTY
- The terminal open/hide action is the first item in the `Run...` menu
- The `Run...` menu shows discovered project commands in usage order and scrolls when the list is longer than the visible menu
- `New` adds another tab without killing the previous PTY
- `Close` terminates the active PTY and hides the drawer only after the last tab is closed

#### Rollback/Cleanup
- Close the terminal session with the `Close` button
- Stop any processes started inside the terminal before leaving the thread

---

### Integrated terminal manager edge cases

#### Feature/Change Name
Automated unit coverage for terminal manager edge cases that do not require a browser or real shell.

#### Prerequisites/Setup
1. Dependencies installed with `pnpm install`

#### Steps
1. Run `pnpm run test:unit`
2. Optionally run the focused test file with `pnpm run test:unit -- src/server/terminalManager.test.ts`

#### Expected Results
- Missing thread ids are rejected before spawning a PTY
- Invalid cwd falls back to home and then process cwd
- Initial and resize dimensions are clamped
- PTY env normalizes `TERM`, locale, and strips `TERMINFO` variables
- Output snapshots truncate to the last 16 KiB and set `truncated`
- Existing session reattach emits init/attached events and safely syncs changed cwd
- `New` adds a new tab without killing the previous session, and close/exit removes snapshots for the active session

#### Rollback/Cleanup
- None

---

### Startup welcome log uses repository GitHub URL

#### Feature/Change Name
Remove the legacy npm package reference from the startup welcome log and point users to the upstream GitHub repository.

#### Prerequisites/Setup
1. Run the app from this repository.

#### Steps
1. Start the app (for example via `pnpm run dev`).
2. Open the browser devtools console.
3. Locate the startup welcome message.

#### Expected Results
- The welcome log points to `https://github.com/friuns2/codexUI`.
- The welcome log does not contain the legacy npm package URL.

#### Rollback/Cleanup
- None

---

### Home route no longer crashes on dev startup

#### Feature/Change Name
Keep the home route mount path working in dev mode.

#### Prerequisites/Setup
1. Run the app from this repository with `npm run dev`.

#### Steps
1. Open `http://localhost:5173/#/`.
2. Wait for the app shell to finish loading.
3. Open the browser devtools console.

#### Expected Results
- The home screen renders instead of a black screen.
- The console does not show an app setup `ReferenceError` during initial mount.

#### Rollback/Cleanup
- None

---

### Thread list startup pagination and direct older-thread links

#### Feature/Change Name
Thread loading uses a smaller initial list page, hydrates later pages in the background, and direct thread URLs are not rejected just because the thread is outside the first page.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Browser dev tools Network panel open
3. More than 50 existing threads, including a valid older thread outside the first updated page

#### Steps
1. Open the app home route
2. Inspect the first `thread/list` RPC request
3. Keep the app open and watch subsequent `thread/list` RPC requests
4. Open `/thread/<older-thread-id>` directly for a valid thread outside the first page

#### Expected Results
- The first `thread/list` request uses a smaller initial limit instead of 100
- Later thread pages load in the background using `nextCursor`
- The sidebar gains older threads as background pages complete
- The direct older thread URL stays on the thread route and loads messages instead of redirecting home

#### Rollback/Cleanup
- None

---

### Thread detail load avoids duplicate live-state history fetch

#### Feature/Change Name
Normal thread detail loading calls `thread/read` directly instead of first calling `/codex-api/thread-live-state`, whose server path also reads full thread history.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Browser dev tools Network panel open
3. An existing thread with a large history

#### Steps
1. Open the existing thread
2. Inspect network/RPC calls during the message load

#### Expected Results
- The message load performs `thread/read` or `thread/resume` for the thread
- It does not first call `/codex-api/thread-live-state` for the same normal message load
- Messages and active/in-progress state still render correctly

#### Rollback/Cleanup
- None

---

### Thread message cache skips unchanged refetches

#### Feature/Change Name
Loaded thread messages are reused when the thread list version has not changed and the thread is not in progress.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Browser dev tools Network panel open
3. An existing completed thread

#### Steps
1. Open the completed thread and wait for messages to render
2. Switch to another thread or home
3. Return to the same completed thread without new turn or thread update events
4. Inspect network/RPC calls during the return

#### Expected Results
- The first open loads messages normally
- Returning to the unchanged completed thread reuses cached messages
- No additional `thread/read` or `thread/resume` call is made for that unchanged return
- If the thread version changes or the thread is in progress, messages still refresh from the server

#### Rollback/Cleanup
- None

---

### Thread selection keeps sidebar list stable during refresh

#### Feature/Change Name
Selecting a thread does not briefly hide older/sidebar threads while thread list refresh and background pagination run.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. More than one page of threads available in the sidebar
3. Background pagination has loaded older threads

#### Steps
1. Open the app and wait until older thread pages appear in the sidebar
2. Select a different thread
3. Watch the sidebar while the selected thread loads and any thread list refresh occurs
4. Repeat selection between recent and older threads

#### Expected Results
- The sidebar does not collapse to only the first page of recent threads
- Previously loaded older threads remain visible during refresh
- The selected thread stays highlighted and messages load normally
- Background pagination can still add newly loaded older threads without hiding existing ones

#### Rollback/Cleanup
- None

---

### Browser runtime profiling with Playwright

#### Feature/Change Name
Playwright browser runtime profiler captures route timing, Codex API network counts, screenshots, and trace files.

#### Prerequisites/Setup
1. Dev server running at `http://localhost:5173`
2. Dependencies installed (`pnpm install`)
3. Target route available, such as `#/thread/019da7c0-4e12-7a91-837c-f7c11cc8ab6c`

#### Steps
1. Run `pnpm run profile:browser`
2. Run `PROFILE_ROUTE='#/thread/019da7c0-4e12-7a91-837c-f7c11cc8ab6c' pnpm run profile:browser`
3. Inspect console output for duplicate counts and slowest API rows
4. Open the generated `output/playwright/browser-runtime-profile-*.json`
5. Open the generated `output/playwright/browser-runtime-profile-*-trace.zip` with `npx playwright show-trace`

#### Expected Results
- The profiler prints final URL, title, total observed time, duplicate request counts, and slowest Codex API calls
- JSON report includes raw API rows, grouped summaries, Performance API data, and artifact paths
- JSON report includes `pageState.stillLoadingThreads`; the profiler exits non-zero if the page still contains `Loading threads...` after the thread-loading timeout
- Screenshot is saved under `output/playwright/browser-runtime-profile-*.png`
- Trace is saved under `output/playwright/browser-runtime-profile-*-trace.zip`

#### Rollback/Cleanup
- Delete generated files under `output/playwright/` if local artifacts are no longer needed

---

### Codex.app-style Plugins Directory

#### Feature/Change Name
The `#/skills` route shows a full Skills & Apps directory with Plugins, Apps, Composio, and a Skills tab where an `MCPs(count)` section appears just before `Installed skills (count)`.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. Codex CLI available in `PATH`
3. Optional: a Codex CLI version with `plugin/list`, `app/list`, and `mcpServerStatus/list` app-server APIs

#### Steps
1. Open `http://127.0.0.1:4173/#/skills`
2. Verify the page title is `Skills & Apps` and the tab row contains `Plugins`, `Apps`, `Composio`, and `Skills`
3. On `Plugins`, verify plugin cards load, the default sort is `Popular`, and `A-Z`, `Date`, and search controls work
4. Open a plugin card when one is available and verify description, capabilities, included apps/skills/MCPs, and install/uninstall or enable/disable actions are visible
5. For an installed plugin with bundled MCP servers, such as Cloudflare, verify each MCP row shows auth status (`Logged in`, `Bearer token`, `Login required`, `Auth unsupported`, or `Status unknown`)
6. If a bundled MCP server shows `Login required`, click `Authenticate` and verify the browser opens the returned MCP OAuth authorization URL
7. Switch to `Apps` and verify app cards load, or the unavailable/empty state appears without breaking the page
8. On `Apps`, verify the default sort control is `Popular`, app icons render, connected apps show `Manage`, and disconnected apps show `Login`
9. Click a disconnected app `Login` button and verify it opens the app login/manage URL
10. Click `Try it!` for a connected and enabled app and verify a new thread opens with an auto-submitted prompt asking what the app can do
11. While the app `Try it!` request is starting, click the button repeatedly and verify only one new thread is created
12. Open an installed/enabled plugin detail, click `Try it!`, and verify a new thread opens with an auto-submitted plugin test prompt
13. Open an installed/enabled skill detail, click `Try it!`, and verify a new thread opens with an auto-submitted skill test prompt and the skill attached
14. Install a plugin whose install response includes `appsNeedingAuth`, and verify the first required app login/manage URL opens automatically
15. Open a plugin whose detail lists a required app that is absent from the Apps catalog for the current account, such as Gmail on an account without Gmail app access, and verify the footer shows a disabled `ChatGPT Plus` action instead of `Install`
16. Switch Apps sorting to `A-Z` and verify apps reorder alphabetically; switch to `Date` and verify app-server catalog order is restored; switch back to `Popular` and verify casual-user relevant apps are prioritized and capped to 100 when no search is active
17. Search Apps and verify matching results are not capped to the Popular top 100 list
18. Switch to `Composio` and verify the workspace summary card shows the current installed Composio CLI login state, or a clear not-installed / not-authenticated message appears
19. If Composio CLI is not installed, click `Install Composio` and verify the app installs the CLI to `~/.composio/composio` using the official Composio installer
20. If Composio is available but not authenticated, click `Login` and verify the app opens a new tab, starts the installed `composio login --no-browser -y`, captures the returned auth URL, and navigates the new tab to that URL
21. Verify Composio connector cards show real connector details such as tool counts, trigger counts, auth mode, and connection state instead of only aggregate totals
22. In Composio search, type `instagram` and verify the Instagram connector appears first when it is returned by the connector source, ahead of description-only matches such as Meta Ads
23. Open a disconnected Composio connector and click `Connect` or `Reconnect`; verify the returned `connect.composio.dev` authorization URL opens
24. Open a connected Composio connector and verify connection rows show account identifiers and statuses such as `Active` or `Expired`
25. Click `Try it!` on a connected or no-auth Composio connector and verify a new thread opens with a Composio-specific prompt and the `composio-cli` skill attached
26. On Composio, verify that if more than one page exists, `Load more` appears and appends additional connectors while keeping prior results visible
27. In Composio search, verify the page state resets (the list returns to the first result page and stale pagination is cleared)
28. Switch to `Skills` and verify the view shows an `MCPs(count)` collapsible section immediately before the `Installed skills (count)` section
29. Expand `MCPs(count)` and verify server cards show auth status and tool/resource counts, or the unavailable/empty state appears without breaking the page
30. Click header `Refresh` while on `Skills` and verify MCP state reloads (it should perform MCP reload behavior on this tab instead of using a separate `Reload MCPs` button)
31. Verify no separate `Reload MCPs` button is shown in the header or inside the MCP section body
32. Verify the `MCPs(count)` section does not show its own search or sort controls
33. Verify MCP cards use the same visual card/grid layout pattern as Installed skills cards (avatar circle, title row, badge, secondary text)
34. Verify the `Installed skills (count)` section below MCPs still supports the existing Skills Hub behavior
35. Verify both light and dark themes render Composio cards and status/detail actions with readable contrast
36. In dark mode, verify MCP cards use the same dark card surface styling as Installed skills cards (not a light/white card)

#### Expected Results
- The directory tabs render without a full-page error
- Plugin/app/Composio API failures are isolated to their tab
- Existing Skills Hub behavior remains available under the `Skills` tab, with MCPs presented just before Installed skills
- App and plugin enable/disable actions update their local card state after a successful config write
- Plugin detail shows bundled MCP login state and can launch MCP OAuth for `notLoggedIn` servers
- Disconnected apps are labeled `Login`; connected apps are labeled `Manage`
- The Composio tab uses the installed Composio CLI, preferring `CODEXUI_COMPOSIO_COMMAND` when set and otherwise `~/.composio/composio` or `composio` on `PATH`
- The Composio install action uses the official installer and produces a working `~/.composio/composio` binary
- The Composio login action opens a new tab from the click, starts the installed `composio login --no-browser -y`, then navigates that tab to the returned auth URL
- Composio connector cards and detail views show concrete connector details, connection rows, and useful tool samples
- Composio search prioritizes exact slug/name matches above connectors that only mention the query in their description
- Unit coverage verifies that Composio exact query matches outrank description-only matches and that gateway connector search sends `query`, `cursor`, and `limit` params expected by the server
- Connected or no-auth Composio connectors expose `Try it!`, creating a new chat with the `composio-cli` skill attached
- Composio pagination supports page-by-page loading with a clear `Load more` path and cursor-based page continuation
- Plugin install opens the first required app login/manage page before falling back to bundled MCP OAuth login
- Plugin install is blocked with `ChatGPT Plus` when the plugin requires an app that is absent from the Apps catalog for the current account
- Connected and enabled apps, plus installed/enabled plugins/skills, expose `Try it!`, creating a new chat with an auto-submitted test prompt
- Repeated `Try it!` clicks during startup are ignored until the first request resolves, so duplicate threads are not created
- Plugins, Apps, and the Skills-tab MCP section default to local popularity-style ordering because app-server does not expose numeric popularity fields
- The Skills tab presents MCPs in the same section style as Installed skills, just above Installed skills, instead of using a separate top-level MCP tab
- `Date` uses the app-server/catalog order as the available freshness proxy because app/plugin/MCP APIs do not expose created or published timestamps
- Popular views show only the top 100 when no search is active; search results can show all matches

#### Rollback/Cleanup
- Re-enable any app or plugin disabled during testing
- Uninstall any plugin installed only for this test

---

### Skills tab npx skills search

#### Feature/Change Name
The Skills tab includes a registry search panel backed by `npx skills find`, shows matching skill cards, and installs selected registry results with `npx skills add`.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. Network access available for `npx skills find`
3. `npx` can run the published `skills` package
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. Open `http://127.0.0.1:4173/#/skills`
2. Verify the `Skills` tab is selected by default; open `http://127.0.0.1:4173/#/skills?tab=plugins`, then click `Skills` and verify the URL updates to `?tab=skills`
3. Verify the `Find skills` header shows a `Skills directory` link on the right that opens `https://skills.anyclaw.store/` in a new tab
4. In `Find skills`, type a query such as `browser`
5. Click `Search`
6. Verify the app calls `/codex-api/skills-hub/search?q=browser`, which runs `npx --yes skills find browser`
7. Verify `Search results (count)` appears above `Installed skills (count)`
8. Verify each registry result card shows its install count metadata, such as `1.2K installs`, even when a GitHub `SKILL.md` description is shown
9. Open one GitHub-backed result and verify the detail modal shows the skill name, owner/repository, parsed `SKILL.md` description, GitHub-backed icon/avatar, and external link
10. Click `Install` for a result and verify the backend runs `npx --yes skills add <owner/repo@skill> --yes --global`
11. After install, verify the result becomes installed and the installed skills list refreshes from local installed skill data rather than appending the remote registry card
12. Switch to dark theme and repeat the search visibility check
13. Search for an already-installed skill and verify its search result shows `Installed`
14. Verify installed matches in search results keep their remote registry owner/details while showing the `Installed` badge
15. Open the installed search result and verify the modal reads the local installed `SKILL.md`, exposes `Uninstall`, and does not show the registry install flow
16. Open a local-only installed skill and verify the modal does not show a dead `View on GitHub` link when no external URL is available
17. Verify cards in the `Installed skills (count)` section do not show `Installed`, `Disabled`, or repeated `local` owner labels, while search result cards can still show installed state and registry owner details
18. Verify installed cards show local `SKILL.md` descriptions when the installed skill has frontmatter or readable markdown content
19. Verify Find skills result cards do not show the local folder browse icon; Browse files remains available inside the installed local modal

#### Expected Results
- Search results are parsed from the real `npx skills find` output, not a static catalog
- Skills search/install commands use the repo command invocation wrapper so `npx` starts reliably on Windows
- Skills search/install commands include outer `npx --yes` so first-run package prompts cannot hang with ignored stdin
- The Skills directory link is visible beside Find skills in light and dark theme and opens the public directory in a new tab
- Registry installs run noninteractively with `--yes --global`, so the process cannot stop at the agent-selection prompt and falsely report success
- Registry install responses only return `ok: true` when the local installed `SKILL.md` path is found and validates successfully
- The UI treats a missing returned path or missing post-refresh local skill as an install failure instead of showing the remote registry card as installed
- GitHub-backed results fetch the repository `SKILL.md` and show its `description` frontmatter when available, falling back to the install count when unavailable
- GitHub metadata enrichment is bounded to the first 20 results with limited concurrency, so broad searches still return without unbounded raw GitHub fetch fanout
- Search result cards keep the registry install count visible as card metadata even when GitHub enrichment replaces the fallback description
- GitHub-backed results show an explicit frontmatter `icon` when provided, otherwise they show the GitHub repository owner avatar instead of a generic letter fallback
- The search UI does not replace or hide local installed skills
- Installed matching results show the existing `Installed` badge and can be opened like local skills
- Installed detection uses the same installed skills source as the Skills Hub list, including RPC/plugin/shared skills and not only the base skills directory
- Installed search result cards keep remote registry ownership/content but include local installed state and path for actions
- Newly installed registry results are reloaded from the local installed skills source before appearing in the Installed skills section
- Opening an installed search result uses the local installed skill record/path, so local content, uninstall, enable/disable, browse, and try actions behave the same as the Installed skills section
- Local-only installed skills hide the external GitHub link when no URL is available
- Installed skills section cards hide redundant installed/disabled status labels
- Installed skills section cards hide the repeated local owner label; registry search cards keep owner/repository labels to distinguish remote results
- Installed skill descriptions come from the local installed `SKILL.md`, so installed cards are useful without opening each modal
- Installed entries are assembled concurrently so reading local `SKILL.md` descriptions does not add one file-read round trip per installed skill
- Opening or switching to the Skills tab lists MCP servers without forcing an MCP reload; the top-level Refresh button remains the explicit reload action
- The top-level Refresh button only shows `Refreshing...` for explicit user-triggered refreshes, not for ordinary initial tab loading
- Find skills cards hide local folder browse actions to avoid mixing remote registry cards with local-only card controls
- Light theme and dark theme keep the search panel, cards, and modal readable

#### Rollback/Cleanup
- Uninstall any skill installed only for this test

---

### Installed skills plugin tree

#### Feature/Change Name
Installed Skills Hub entries now show plugin/package roots as expandable list folders with nested skills underneath.

#### Prerequisites/Setup
1. Dev server running with `pnpm run dev --host 127.0.0.1 --port 4173`
2. At least one installed plugin that exposes multiple skills, plus at least one standalone installed skill
3. Open `#/skills` and switch to the `Skills` tab if needed

#### Steps
1. In light theme, scroll to `Installed skills ({count})`
2. Verify installed entries render as a compact list, not as a three-column card grid
3. Find a plugin/package row and click its chevron
4. Verify nested skills appear as an indented sublist below that plugin row
5. Click the plugin row name and verify it toggles the same nested sublist instead of opening a skill modal
6. Click a nested skill row and verify the detail modal opens for that nested skill
7. Use the folder icon on a plugin row and a nested row, if present, and verify local browse opens the plugin root or child skill folder
8. Switch to dark theme and repeat steps 2 through 6

#### Expected Results
- Plugin/package roots are visually distinct from standalone skills with a folder-style icon and child count
- Installed plugin roots match the plugin cache structure under `.codex/plugins/cache/<marketplace>/<plugin>/<version>/skills`
- Nested plugin skills stay grouped under their owning plugin and do not appear as unrelated top-level cards
- Standalone skills still appear as single rows
- Existing detail, try, enable/disable, uninstall, and browse behaviors remain available for standalone and nested skills
- In dark theme, the installed list, child sublist, row hover states, text, dividers, and badges use dark surfaces and remain legible

#### Rollback/Cleanup
- None

---

### Sidebar thread row edge click selects thread

#### Feature/Change Name
Thread rows now select when clicking anywhere on the highlighted row area (including left/right edge/time area), while pin/menu buttons keep their own actions.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Sidebar contains multiple threads
3. At least one thread has visible time text on the right

#### Steps
1. Hover a thread row and confirm the row highlight appears
2. Click near the left edge (outside the title text and not on pin icon)
3. Click near the right edge/time area (outside the menu button)
4. Click the thread title/body area
5. Click the pin button and menu button to verify their behavior

#### Expected Results
- Steps 2, 3, and 4 all select/open the clicked thread
- Hover highlight and click target area now match user expectations
- Pin button toggles pin state without selecting due to event bubbling
- Menu button opens thread menu without selecting due to event bubbling

#### Rollback/Cleanup
- None

---

### Content header actions remain right aligned

#### Feature/Change Name
Thread and new-chat header action buttons stay pinned to the right edge while long titles remain constrained and truncated.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. Sidebar collapsed or viewport wide enough to show content header actions
3. Terminal toggle available in the header

#### Steps
1. Open `http://127.0.0.1:4173/#/`
2. Inspect the header row containing `Start new thread`
3. Verify the terminal toggle is aligned to the far right of the content header, not immediately after the title
4. Open a thread with a long title and repeat the alignment check
5. Confirm the title truncates with a tooltip and does not overlap the terminal or branch controls

#### Expected Results
- Header actions use the available right edge of the content header
- Long title truncation does not pull action buttons toward the center
- Terminal and branch controls remain visible and clickable

#### Rollback/Cleanup
- Remove generated screenshots under `output/playwright/` if they are not needed

---

### Stop button activates promptly for new threads

#### Feature/Change Name
The composer stop control switches from the temporary saving spinner to a real stop button as soon as the active turn id is available for a newly created thread.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. Home route available with a writable project/folder selected
3. Codex can start a normal assistant turn

#### Steps
1. Open `http://127.0.0.1:4173/#/`
2. Send a short prompt from the new-thread composer
3. Immediately watch the right-side composer control after routing into the new thread
4. Before the full response finishes, verify the temporary saving spinner transitions into the stop icon/button
5. Click `Stop` while the turn is still running

#### Expected Results
- A new thread may briefly show the saving spinner while the turn starts
- The control becomes an actual stop button as soon as the active turn id is known, without waiting for thread-list persistence
- Clicking stop interrupts the running turn

#### Rollback/Cleanup
- Archive or delete the test thread if it was created only for this check

---

### New-thread plan mode persists and toggles correctly

#### Feature/Change Name
New threads started from the home composer honor the selected plan mode for the first turn, and turning plan mode off on the created thread switches later turns back to default mode.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. Home route available with a writable project/folder selected
3. At least one model is available for plan mode

#### Steps
1. Open `http://127.0.0.1:4173/#/`
2. Enable `Plan mode` in the new-thread composer
3. Send a prompt that produces a visible plan response
4. After routing into the new thread, confirm the composer still shows `Plan mode` enabled
5. Toggle `Plan mode` off in that thread
6. Send another prompt in the same thread
7. Confirm the next turn runs in default mode rather than generating another plan-first response

#### Expected Results
- The very first turn of a newly created thread uses the plan-mode setting chosen on the home composer
- The newly created thread retains that plan-mode selection after route transition
- Turning plan mode off updates the thread-scoped mode, and later turns in that thread no longer use plan mode

#### Rollback/Cleanup
- Archive or delete any test thread created only for this check

---

### Completed plan cards expose implement action

#### Feature/Change Name
Completed plan cards show an `Implement plan` button that turns plan mode off and sends an implementation prompt built from the plan content.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. An existing thread contains a completed persisted plan card
3. The thread composer is available for follow-up messages

#### Steps
1. Open a thread containing a completed plan card
2. Verify the plan card shows `Implement plan` at the bottom
3. Click `Implement plan`
4. Confirm the composer thread switches back to default mode
5. Inspect the next `turn/start` request or the resulting assistant behavior

#### Expected Results
- Completed plan cards render the `Implement plan` action even when the plan body is structured as headings/lists instead of checkbox steps
- Clicking the button sends a simple implementation follow-up message instead of copying the whole plan body into chat
- The next turn runs in default mode rather than plan mode

#### Rollback/Cleanup
- Archive or delete any test thread created only for this check

---

### Dark theme plan card contrast

#### Feature/Change Name
Plan cards in dark mode keep readable contrast and a lighter surface than the surrounding page background, including the `Implement plan` action.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. A thread contains a visible plan card
3. Appearance is set to `Dark`

#### Steps
1. Open a thread containing a plan card in dark mode
2. Inspect the card background, title, explanation text, headings, lists, inline code, and blockquote styling
3. Verify the `Implement plan` button is readable and visually distinct
4. Hover the `Implement plan` button and confirm the hover state remains visible

#### Expected Results
- The plan card surface is distinguishable from the page background without looking crushed into near-black
- Plan text and headings stay readable in dark mode
- Inline code, file links, and blockquotes keep enough contrast to scan comfortably
- The `Implement plan` button remains readable and clickable in dark mode

#### Rollback/Cleanup
- Reset appearance to the previous user preference

---

### Terminal focus does not fullscreen panel

#### Feature/Change Name
Terminal focus on mobile keeps the terminal as a bottom panel instead of expanding it to full screen.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. A thread or new-chat project with the terminal toggle available
3. Mobile viewport or Android device browser

#### Steps
1. Open a thread or new chat with a valid project path
2. Tap the terminal toggle
3. Tap inside the terminal area
4. If the virtual keyboard appears, keep focus in the terminal
5. Hide and reopen the terminal

#### Expected Results
- Terminal remains a bottom panel and does not take over the full viewport
- Conversation/new-chat content is not forcibly hidden by terminal focus
- Composer keeps its normal compact placement instead of stretching above the terminal
- Terminal can still fit within the available viewport when the keyboard changes size

#### Rollback/Cleanup
- Close the terminal panel

---

### Feature: Nested skill bundles are grouped in discovery

#### Feature/Change Name
Composer skill discovery collapses nested `skills/<subskill>/SKILL.md` entries under their top-level bundle skill when the bundle root skill is also present, including curated plugin skill packs such as `cloudflare:*`.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open a thread whose cwd can access installed skills
3. At least one installed skill bundle or curated plugin pack contains a top-level/root `SKILL.md` plus additional subskills

#### Steps
1. Open the thread composer skill picker
2. Search for a grouped bundle or plugin root such as `cloudflare`
3. Confirm the grouped root appears once in the picker
4. Search for one nested subskill or prefixed plugin skill name such as `agents-sdk` or `cloudflare:workers-best-practices`
5. Refresh the page or switch threads and reopen the skill picker

#### Expected Results
- The picker shows a single top-level entry for the bundled skill or plugin root
- Nested subskill folder names and plugin-prefixed variants do not appear as separate skill discovery entries when the parent/root entry exists
- Grouped plugin roots render a clean label such as `cloudflare` instead of `cloudflare:cloudflare`
- The grouped result remains stable after refresh or thread switching

#### Rollback/Cleanup
- None

---

### Default mode can follow plan mode in the same thread

#### Feature/Change Name
Composer collaboration mode changes send `default` explicitly so a thread can leave plan mode without opening a new chat.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. A Codex account/session with both Default and Plan collaboration modes available
3. A project folder selected for a new or existing thread

#### Steps
1. Select Plan mode in the composer
2. Send a prompt asking Codex to create a plan
3. After the turn completes, switch the composer back to Default mode
4. Send a follow-up prompt asking Codex to implement the plan in the same thread
5. Repeat the Default follow-up once more in the same thread

#### Expected Results
- The implementation prompts run in Default mode instead of staying in Plan mode
- The thread remains usable without opening a new chat
- The composer selection and the backend turn mode stay aligned across consecutive turns

#### Rollback/Cleanup
- Archive the test thread if it was created only for verification

---

### First-launch home card for Plugins and Apps

#### Feature/Change Name
The home route shows a dismissible first-launch card that introduces Plugins and Apps and opens the existing Skills & Apps directory on the Plugins tab.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. Codex global-state preference `first-launch-plugins-card-dismissed` removed or set to `false` before the first check
3. App loaded on the home/new-thread route

#### Steps
1. Open the app on the home route with the local storage key removed
2. Verify the home screen shows a card with the heading `Plugins are here`
3. Verify the body copy mentions app examples such as Gmail and Calendar
4. Click `Explore Plugins & Apps`
5. Verify the app navigates to the `#/skills` route and the `Plugins` tab is active
6. Return to the home route and verify the card does not reappear
7. Remove the local storage key again, reload the home route, and click `Dismiss`
8. Reload the home route once more

#### Expected Results
- The card appears only when the server-backed dismissal preference is unset or `false`
- The primary CTA hides the card and opens the Skills & Apps directory
- The directory opens with `Plugins` selected by default
- Dismissing the card hides it immediately and keeps it hidden after reload

#### Rollback/Cleanup
- Remove or set `first-launch-plugins-card-dismissed` to `false` in Codex global state if you want to see the card again

---

### Composer prompts inside Skills dropdown

#### Feature/Change Name
The composer control row uses one `Skills` dropdown for both skills and saved prompts. The `+` action creates a prompt, prompt rows can be inserted or removed from the same menu, and there is no separate `Prompt` control.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:4173`
2. Open any existing thread so the composer controls are enabled
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open the composer controls and confirm `Skills` appears and no separate `Prompt` control is present
2. Open `Skills` and verify the popup matches the wider card-like layout with large stacked label/description rows
3. Confirm skill rows have compact source markers, such as `R` for repo, `U` for user, `S` for system, or `P` for plugin
4. Click the `+` action in the `Skills` dropdown, enter a unique prompt name such as `ui-test-prompt`, and enter sample content such as `Prompt dropdown smoke test`
5. Reopen `Skills` and confirm the new prompt appears with a `Prompt` marker and an inline `×` remove action
6. Click the prompt row and confirm the prompt text is inserted into the composer draft without toggling a skill
7. Reopen `Skills`, click the `×` button for `ui-test-prompt`, and confirm the removal dialog
8. Confirm the prompt disappears from the dropdown while skill rows remain available
9. Type `/` into the composer and verify no slash skill picker appears
10. Switch to dark theme and repeat the visibility check for the combined `Skills` dropdown contents

#### Expected Results
- The composer shows one `Skills` dropdown for skills and prompts; no standalone `Prompt` dropdown is rendered
- The combined `Skills` popup uses the wider rounded layout with vertically stacked label/description rows
- Skill rows show readable source markers that distinguish repo, user, system, and plugin-provided skills
- Prompt rows show a readable `Prompt` marker and are the only rows with an inline remove action
- Typing `/` in the composer does not open a skill picker
- The `+` action creates a markdown file in the Codex prompt store and adds it to the `Skills` dropdown immediately
- Selecting a saved prompt appends its content into the draft without sending the message
- Clicking `×` removes only the targeted prompt and updates the dropdown immediately
- Light theme and dark theme both keep the new control, menu, and remove action readable and usable

#### Rollback/Cleanup
- Delete any temporary verification prompt created during the test

---

### Editable current folder path in the folder picker

#### Feature/Change Name
The `Select folder` dialog now lets the user edit the current folder path directly, reload that folder on `Enter` or blur, and open the typed path without first clicking a child row.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open the home/new-thread route
3. Have at least two accessible local directories available for navigation
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open the `Select folder` dialog from the new-thread folder chooser
2. Confirm the `Current folder` field is an editable text input instead of static text
3. Type a different absolute path and press `Enter`
4. Confirm the folder list reloads for the typed path
5. Edit the path again, click outside the input, and confirm blur also reloads the listing
6. Type a valid absolute path and click `Open`
7. Reopen the dialog, switch to dark theme, and confirm the editable current-folder input remains readable and focusable

#### Expected Results
- The current-folder path can be typed into directly
- Pressing `Enter` on a changed path reloads the folder listing for that path
- Blurring a changed path also reloads the folder listing for that path
- Clicking `Open` uses the typed path when it is valid
- The input remains readable and has visible focus treatment in both light theme and dark theme

#### Rollback/Cleanup
- Return the chooser to the original folder if the test changed the selected project path

---

### Expandable Projects, Pinned, and Chats sidebar sections

#### Feature/Change Name
The sidebar labels the grouped thread area as `Projects`, makes `Projects`, `Pinned`, and `Chats` independently expandable, and places `Chats` after `Projects` in the same scrollable sidebar area.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:5174` or the active Vite dev URL
2. At least one existing thread is available in the sidebar
3. At least one pinned thread exists to verify the `Pinned` section
4. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, open the app with the sidebar expanded
2. Verify the grouped thread header reads `Projects` instead of `Threads`
3. Verify `Pinned`, `Projects`, and `Chats` each show a chevron when present
4. Collapse and expand `Pinned`, confirming pinned rows hide and return
5. Collapse and expand `Projects`, confirming project groups hide and return
6. Confirm `Chats` appears after `Projects` and scrolls with the same sidebar content, not as a fixed bottom shelf
7. Collapse and expand `Chats`, confirming recent chat rows hide and return
8. Click the `Chats` filter icon and verify the existing sidebar search field opens and the filter button shows active state
9. Click the `Chats` compose icon and verify the app navigates to the new-chat/home composer
10. Open the Projects organize menu, enable `Chats first`, and verify `Chats` moves above `Projects`
11. In the same menu, switch `Sort by` between `Created` and `Updated`, then verify the active checkmark moves and the chat rows reorder by the selected timestamp
12. Refresh the page and verify `Chats first` and the selected sort mode persist
13. Switch to dark theme and repeat the visibility checks for section headers, chevrons, active filter state, sort menu state, and row text

#### Expected Results
- The sidebar uses `Projects` for the grouped project/thread area
- `Pinned`, `Projects`, and `Chats` expansion state changes immediately and persists across reload
- `Chats` is appended after `Projects` in the same scroll space
- `Chats first` moves the `Chats` section before `Projects` and persists across reload
- `Created` and `Updated` sort options update only the `Chats` ordering and persist across reload
- The filter icon toggles the sidebar search without losing the `Chats` section
- The compose icon starts a new chat using the existing new-thread flow
- Light theme and dark theme both keep section headers, controls, and rows readable

#### Rollback/Cleanup
- Clear the sidebar search query if the filter step left it open

---

### Thread menu copy path action

#### Feature/Change Name
The thread overflow menu includes a `Copy path` item that copies the selected thread's working directory path.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:5174` or the active Vite dev URL
2. Open any existing thread with a known project path
3. Browser clipboard access is available
4. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, hover a thread row in the sidebar and open its overflow menu
2. Verify `Copy path` appears after `Browse files`
3. Click `Copy path`
4. Paste the clipboard contents into a text field or clipboard inspector
5. Reopen the same menu in dark theme and verify the item remains readable and in the same position

#### Expected Results
- The menu order is `Add automation...` or `Manage automations...`, `Browse files`, `Copy path`, `Export chat`, `Create chat fork`, `Rename thread`, `Delete thread`
- Clicking `Copy path` closes the menu
- Clipboard contents equal the thread's `cwd` path
- Light theme and dark theme both keep the menu item readable

#### Rollback/Cleanup
- Restore any previous clipboard contents manually if needed

---

### Terminal quick commands from project files

#### Feature/Change Name
Terminal quick commands are discovered from the current project instead of using a static built-in npm list.

#### Prerequisites/Setup
1. Dev server running at `http://127.0.0.1:5174` or the active Vite dev URL
2. Open a thread or new chat whose working directory has a `package.json` with scripts
3. Optionally create executable candidates under the project root and `scripts/`, such as `check.sh`, `scripts/check.sh`, or `scripts/build.cmd`
4. Optionally add `pnpm-lock.yaml`, `yarn.lock`, `bun.lock`, or `bun.lockb` to verify package-manager detection
5. Optionally add a `Makefile` with simple targets such as `test:` or `build:`

#### Steps
1. Open the terminal panel for that project
2. Open the `Run...` dropdown
3. Verify each `package.json` script appears with the detected package manager, such as `pnpm run <script>`, `yarn <script>`, `bun run <script>`, or `npm run <script>`
4. Verify simple `Makefile` targets appear as `make <target>`
5. Verify root-level `*.sh` / `*.cmd` files appear as `./<file>`
6. Verify `scripts/*.sh` and `scripts/*.cmd` files appear as `./scripts/<file>`
7. Select one discovered command and confirm it is sent to the terminal
8. Reopen the dropdown after running commands multiple times
9. If the project has more commands than fit in the menu, scroll the dropdown and verify lower-priority entries such as `./scripts/<file>.sh` remain reachable
10. From a closed terminal state on a remote server, select a command immediately after opening the `Run...` menu and confirm it runs after the terminal attaches

#### Expected Results
- The dropdown is based on the current project `cwd`
- Static defaults like `npm run dev` do not appear unless they exist in that project's `package.json`
- Package script commands use the lockfile-preferred package manager
- Make targets are listed after package scripts
- Root and `scripts/` script-file commands are listed after Make targets
- Commands are sorted by most-used and then most-recent usage, and the dropdown scrolls instead of hiding entries beyond the first five
- Selecting a command while the terminal is still mounting waits for the attach flow instead of dropping the command

#### Rollback/Cleanup
- Remove any temporary files created under the project root or `scripts/`

---

### Queue mode is default for in-progress messages

#### Feature/Change Name
When a turn is already running, the in-progress message path defaults to `Queue` for new sessions and existing users without a saved preference.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open any existing thread with message composer enabled
3. Start from a clean setting state by clearing localStorage key `codex-web-local.in-progress-send-mode` if present
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. Open a thread and ensure no previous turn is running
2. Confirm settings shows `When busy` line labeled as `Queue`
3. Send a message that triggers an in-progress response
4. While the response is running, submit a second message and observe submit mode label / destination behavior
5. Open the queue list and confirm the second message is queued
6. Switch to dark theme and repeat step 4 using another thread

#### Expected Results
- The in-progress setting defaults to `Queue` when no saved preference exists
- A second message sent during an active turn is queued, not used as steer
- Queue order and queued item actions remain functional in both light theme and dark theme

#### Rollback/Cleanup
- Clear the queue by sending/steering queued items or deleting queued rows

---

### Backend-persisted queued messages and drag reorder

#### Feature/Change Name
Queued messages are saved through the backend, survive page refresh, and can be reordered by dragging a queued row before another queued row.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open a thread where a turn is actively running
3. Queue at least three messages while the turn is running
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, confirm each queued row has a drag handle at the start of the row
2. Refresh the page and reopen the same thread
3. Confirm all queued rows are still visible in the same order
4. Drag the third queued message onto the first queued message
5. Confirm the third message moves to the first position and the remaining queued messages keep their relative order
6. Refresh again and confirm the reordered queue order is preserved
7. Let the active turn finish and confirm the next sent queued message is the first reordered item
8. Queue at least two more messages, switch to dark theme, and repeat the drag reorder check

#### Expected Results
- Queued rows survive a page refresh because they are restored from backend state
- Dragging a queued row onto another queued row immediately reorders the queue
- The reordered queue order survives page refresh
- The reordered queue order controls which message sends next after the active turn finishes
- Edit, Steer, and Delete actions still operate on the correct queued row after reordering
- Drag handle, hover/drop target, and row text remain readable in both light theme and dark theme

#### Rollback/Cleanup
- Delete any queued test messages that should not be sent

---

### Backend-drained queue UI refresh

#### Feature/Change Name
The queue panel refreshes when the backend starts and drains persisted queued messages.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Open a `TestChat` thread
3. Queue at least three short messages while a turn is running
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, confirm queued rows are visible above the composer
2. Let the backend drain each queued message
3. Confirm the queue panel removes each row as its queued turn starts
4. Confirm the queue panel disappears when the final queued message is submitted
5. Refresh the thread after all queued turns complete
6. Switch to dark theme and repeat the visibility check after queue drain

#### Expected Results
- Queued messages execute in order after the active turn completes
- The queue panel reflects backend queue state after `turn/started` and `turn/completed`
- No already-executed queued rows remain visible after the queue is empty
- Queue row text, actions, and composer spacing remain readable in both light theme and dark theme

#### Rollback/Cleanup
- Delete any remaining queued test messages or let the queue drain

---

### Persisted idle queue recovery

#### Feature/Change Name
Backend queued messages are retried and drained for idle threads even if the original `turn/completed` notification was missed or the server starts with persisted queue state already present.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. A thread exists with queued messages persisted in `/codex-api/thread-queue-state`
3. The thread's latest turn is completed/idle
4. Light theme and dark theme are both available

#### Steps
1. In light theme, open the thread with persisted queued rows
2. Confirm the queued rows are visible above the composer
3. Wait for backend queue recovery to start the first queued message
4. Confirm the first queued row is removed and a new turn starts
5. Wait for the queued turn to complete
6. Confirm the next queued row starts automatically
7. Repeat until `/codex-api/thread-queue-state` no longer includes the thread
8. Refresh the thread and confirm all queued messages completed in order
9. Switch to dark theme and confirm the completed conversation and empty queue state remain readable

#### Expected Results
- Idle persisted queues recover without requiring a new manual message
- Queued messages do not start while the thread has an in-progress turn
- Multiple queued messages drain one at a time and complete in order
- The queue panel disappears after the final queued message is started
- The recovered turns and empty queue state are visible in both light theme and dark theme

#### Rollback/Cleanup
- Delete any remaining queued test rows or let recovery drain them
- Remove temporary test projects/threads if they are no longer needed

---

### ChatGPT auth tokens refresh for external auth

#### Feature/Change Name
Codex app-server `account/chatgptAuthTokens/refresh` requests are handled automatically from `auth.json` so expired ChatGPT access tokens can be refreshed without a manual relogin.

#### Prerequisites/Setup
1. App server is running from this repository
2. `$CODEX_HOME/auth.json` contains ChatGPT auth with a valid `refresh_token`
3. The current ChatGPT `access_token` is expired or close enough to expiry that Codex app-server asks for token refresh

#### Steps
1. Open the app with the ChatGPT-authenticated account selected
2. Trigger an account operation such as loading account rate limits or starting a normal Codex turn
3. Watch the server logs for an `account/chatgptAuthTokens/refresh` server request
4. Reopen `$CODEX_HOME/auth.json`
5. Repeat the same account operation after the refresh completes

#### Expected Results
- The refresh request is answered automatically and does not appear as a manual pending request in the UI
- `auth.json` is updated with the fresh `access_token` and any rotated `refresh_token` or `id_token`
- The account operation succeeds without showing `token_expired`
- If no refresh token is available, the operation fails with a sign-in-again message instead of silently looping

#### Rollback/Cleanup
- None, unless a test-only `$CODEX_HOME` was used

---

### Project menu permanent worktree action

#### Feature/Change Name
Project rows open the same action menu from right-click and the dots button, and can create a permanent sibling Git worktree as a new project.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Sidebar has at least one Git-backed project
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, click the project row dots button.
2. Verify the menu shows `Browse files`, `New worktree`, `Rename project`, and `Remove`.
3. Close the menu, then right-click the same project row.
4. Verify the same menu opens.
5. Click `Browse files` and confirm the local file browser opens for the project cwd.
6. Reopen the project menu, click `Rename project`, and confirm the inline project name input still works.
7. Reopen the project menu, click `New worktree`, and confirm the prompt is prefilled with `<project name>-`.
8. Enter a unique folder name such as `<project name>-manual-test`.
9. Confirm a Git worktree is created at `../<worktree name>` relative to the source repo root.
10. Run `git -C ../<worktree name> branch --show-current` and confirm it prints a branch based on the worktree folder name.
11. Confirm the new worktree is added as a project and the app opens the new-chat composer with that cwd selected.
12. Rename the project to include a slash, reopen `New worktree`, and confirm the suggested folder name replaces the slash with `-`.
13. Switch to dark theme and repeat steps 1-4, verifying menu contrast and danger styling remain readable.

#### Expected Results
- Right-click and dots button expose the same project action menu.
- `Browse files`, `Rename project`, and `Remove` remain available from that menu.
- `New worktree` creates a permanent sibling worktree folder on its own branch, registers it as a project, and opens a new chat for it.
- Invalid path separator characters are not used in the default worktree folder suggestion.
- Menu text, hover states, and the remove action remain readable in light and dark themes.

#### Rollback/Cleanup
- Remove the test worktree with `git -C <source-repo-root> worktree remove ../<worktree name>`.
- Delete the test branch with `git -C <source-repo-root> branch -D <branch name>`.
- Remove the temporary project from the sidebar if it remains listed.

---

### Sidebar thread inline delete confirmation and menu pin action

#### Feature/Change Name
Thread rows show an inline delete button that morphs to `Confirm`, while pin/unpin moves to the thread context menu.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Sidebar contains at least two disposable test threads
3. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, hover a disposable thread row and verify the left-side action shows a delete icon instead of a pin icon
2. Click the delete icon once and verify it changes to a `Confirm` button without selecting the row
3. Click a different thread row and verify the pending `Confirm` state clears
4. Hover the disposable thread row again, click delete, then click `Confirm`
5. Verify the thread is removed from the sidebar immediately and, if it was pinned, removed from the `Pinned` section too
6. Open another thread row context menu and verify it contains `Pin thread` for an unpinned thread
7. Click `Pin thread`, reopen the same thread menu, and verify it now shows `Unpin thread`
8. Switch to dark theme and repeat steps 1 through 7 with another disposable thread

#### Expected Results
- The inline row action is delete, not pin
- Delete requires two clicks: delete icon, then `Confirm`
- Confirming archives/removes the correct thread immediately from the sidebar and clears any pinned state for that thread
- Pin/unpin is available from the thread context menu and updates the `Pinned` section immediately
- Delete icon, `Confirm` button, and context menu items are readable in both light theme and dark theme

#### Rollback/Cleanup
- Delete or unpin any disposable threads created only for this test

---

### Accounts panel Codex login callback modal

#### Feature/Change Name
Accounts settings includes an always-available `Login` button that starts `codex login`, opens the returned authorization URL, shows an in-app callback modal, requests the pasted localhost callback URL from the server, and imports the completed Codex account.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. `codex` CLI available in the server process `PATH`
3. Browser can open the authorization URL returned by the server
4. Light theme and dark theme are available from the appearance switcher

#### Steps
1. Open settings and expand `Accounts`.
2. In light theme, verify `Login` appears even when an active account is already listed.
3. Click `Login`.
4. Verify a new tab opens to the OpenAI authorization URL and an in-app `Complete Codex login` modal asks for the localhost callback URL.
5. Complete authorization in the browser until it redirects to a `http://localhost:<port>/auth/callback?...` URL.
6. Paste that full localhost callback URL into the modal input and click `Complete`.
7. Verify the account list refreshes, the new or refreshed account is active, and normal thread/account data reloads.
8. Click `Login` again, close the modal, and verify the Accounts panel keeps the `Open login URL` fallback link available.
9. Switch to dark theme and repeat steps 1-4, verifying the Login button, link, modal, input, and buttons have readable contrast.

#### Expected Results
- `Login` is available regardless of current login state.
- Starting login runs `codex login` on the server and exposes the generated OpenAI authorization URL.
- Completing login uses the modal input value, only accepts local callback URLs, and uses the server to request the pasted callback.
- After completion, `$CODEX_HOME/auth.json` is imported into the Accounts list and selected as the active account.
- Completion does not remain stuck waiting for the `codex login` process after the callback has updated `auth.json`.
- Light-theme and dark-theme controls are readable and do not overlap.

#### Rollback/Cleanup
- Remove any test-only account from the Accounts panel if needed.
- If a login is abandoned, restart the dev server to clear any in-memory pending login process.

---

### Active thread switches after delete

#### Feature/Change Name
Deleting the currently open thread immediately selects the next available thread.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Sidebar contains at least three disposable test threads
3. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, open the middle disposable thread
2. Click that thread's delete icon, then click `Confirm`
3. Verify the content area immediately switches to the next thread in the sidebar list
4. Open the last disposable thread
5. Delete and confirm it
6. Verify the content area immediately switches to the previous thread
7. Repeat steps 1 through 6 in dark theme

#### Expected Results
- Deleting the active thread does not leave the deleted thread selected
- The next thread is selected immediately; when there is no next thread, the previous thread is selected
- The browser route updates to the newly selected thread without waiting for a manual click
- A stale deleted-thread URL does not switch the UI back to the archived thread
- Light-theme and dark-theme sidebar selection states remain readable after the automatic switch

#### Rollback/Cleanup
- Delete any disposable threads created only for this test

---

### Thread open always autoscrolls to latest

#### Feature/Change Name
Opening a thread always scrolls the conversation to the latest messages, with no per-thread scroll restore.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. At least one thread with enough messages to require scrolling
3. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, open a thread and scroll to the middle of its history
2. Switch to another thread
3. Open the first thread again
4. Verify the viewport opens at the bottom (latest messages), not the previous middle position
5. Refresh the browser tab, open the same thread again, and verify it still opens at the bottom
6. Repeat steps 1 through 5 in dark theme

#### Expected Results
- Opening a thread always lands on the latest messages
- Previously viewed scroll positions are not restored when revisiting a thread
- Browser refresh does not restore a previously viewed conversation scroll position
- Behavior is the same in light theme and dark theme

#### Rollback/Cleanup
- None

---

### Hide worktree controls for non-Git folders

#### Feature/Change Name
Composer runtime options and project menu worktree actions are hidden when the selected folder is not a Git repository.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. One Git-backed project and one plain local folder without a `.git` directory are available in the folder picker/sidebar
3. Light theme and dark theme are available from the appearance switcher

#### Steps
1. In light theme, select the plain local folder in the new-thread composer.
2. Confirm the `Local project` / `New worktree` runtime toggle is not shown.
3. Confirm the first message can still be sent as a normal local-folder chat.
4. Select a Git-backed folder and confirm the runtime toggle appears again.
5. Open the project action menu for a non-Git project and confirm `New worktree` is not shown.
6. Open the project action menu for a Git-backed project and confirm `New worktree` is shown.
7. Switch to dark theme and repeat steps 1, 2, 4, 5, and 6.

#### Expected Results
- Non-Git folders do not show `Local project` or `New worktree` runtime options.
- Non-Git project menus do not show `New worktree`.
- Git-backed folders continue to expose the runtime toggle and worktree action.
- The hidden/visible states are consistent and readable in both light and dark themes.

#### Rollback/Cleanup
- Remove any disposable plain folder or test chats created for this validation.

---

### Project worktree threads under canonical project

#### Feature/Change Name
Managed worktree threads remain visible under their matching canonical workspace-root project, and path-like project tooltips expose the full path.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Codex global workspace roots include `/Users/igor/Git-projects/codex-web-local`
3. Thread history contains at least one thread whose cwd is under `/Users/igor/.codex/worktrees/*/codex-web-local`
4. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open the sidebar Projects section.
2. Scroll to the `codex-web-local` project.
3. Confirm the project includes the main-root thread and managed worktree threads.
4. Confirm worktree rows still show the worktree icon.
5. Confirm unrelated `.git/worktrees` rows with the same leaf folder name are not grouped into this project.
6. Hover any shortened path-like duplicate project title and confirm the tooltip shows the full project path, not only the friendly label.
7. Switch to dark theme and repeat steps 1-6.

#### Expected Results
- Managed worktree threads with the same leaf folder name are not split into hidden path-like project groups.
- Generic `.git/worktrees` rows are not treated as managed Codex worktrees for project-root grouping.
- The canonical `codex-web-local` project shows both main-root and worktree threads.
- Path-like project tooltips expose the full project path.
- Project rows and worktree icons remain readable in light and dark themes.

#### Rollback/Cleanup
- None.

---

### Worktree creation persists across refresh

#### Feature/Change Name
Newly created temporary and permanent worktrees are persisted in workspace roots so their threads remain visible after a full browser refresh.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. A Git-backed workspace root is registered and selected in the Start new thread screen
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open Start new thread for the Git-backed workspace root.
2. Select `New worktree`, send a unique first prompt, and wait for the thread page to open.
3. Note the created worktree path from the selected folder or thread metadata.
4. Refresh the browser tab.
5. Confirm the new worktree-backed project/thread remains visible in the sidebar and can be opened.
6. Open the project action menu for the original Git-backed project and create a permanent named worktree.
7. Confirm the permanent worktree appears in the folder/project list, then refresh the browser tab.
8. Confirm the permanent worktree remains visible after refresh.
9. Switch to dark theme and repeat steps 1 through 5 with a second unique temporary worktree prompt.

#### Expected Results
- Temporary worktree creation writes the new worktree cwd to persisted workspace roots.
- Permanent worktree creation writes the new worktree cwd to persisted workspace roots.
- Full page refresh does not hide the newly created worktree project or its thread.
- The same behavior works in light theme and dark theme.
- If workspace-root persistence fails after `git worktree add`, the request fails cleanly and best-effort rollback removes the created worktree instead of leaving retry-prone orphaned worktrees.

#### Rollback/Cleanup
- Remove temporary test worktrees with `git worktree remove --force <worktree-path>`.
- Delete any empty temporary parent directory left under `$CODEX_HOME/worktrees/<id>`.
- Remove permanent test worktrees with `git worktree remove --force <worktree-path>` and delete their test branch if needed.

---

### Sidebar chats show more projectless chats

#### Feature/Change Name
The sidebar Chats section lists the first 10 projectless chats, offers Show more for the rest, and no longer shows the per-section filter button.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev`)
2. Thread history contains more than 10 projectless chats
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open the sidebar Chats section.
2. Count the visible projectless chat rows and confirm only 10 rows are shown initially.
3. Click Show more and confirm older projectless chat rows beyond the first 10 appear.
4. Click Show less and confirm the Chats section returns to 10 visible rows.
5. Confirm the Chats section header only shows the New chat action and does not show a filter button.
6. Use the main sidebar search button and confirm global thread search still opens and filters chats/projects without the 10-row browsing limit.
7. Switch to dark theme and repeat steps 1-6.

#### Expected Results
- The Chats section shows 10 projectless chats by default according to the selected chat sort mode.
- Show more expands the section to all projectless chats, and Show less restores the 10-row default.
- The Chats header does not include a filter action.
- The New chat action remains available.
- The main sidebar search remains functional.
- Rows and header actions remain readable in light and dark themes.

#### Rollback/Cleanup
- None.

---

### Fresh Docker mobile install does not show rate-limit request failures

#### Feature/Change Name
Fresh unauthenticated install mobile home screen rate-limit handling.

#### Prerequisites/Setup
1. Docker is available.
2. A clean container has this project installed under `/workspace`.
3. `@openai/codex` is installed in the container.
4. Container dev server is running with a fresh Codex home:
   `CODEX_HOME=/tmp/codex-home CODEXUI_CODEX_COMMAND=$(command -v codex) pnpm run dev --host 0.0.0.0 --port 4173`
5. The container port is mapped to the host, for example `127.0.0.1:4174 -> 4173`.

#### Steps
1. Open `http://127.0.0.1:4174/` in a mobile viewport such as iPhone 13 `390x664`.
2. In light theme, wait for the Start new thread home screen to render.
3. Capture network responses and confirm no `/codex-api/rpc` response fails with `502` for `account/rateLimits/read`.
4. Confirm the composer renders and the quota UI is simply absent when the fresh `CODEX_HOME` has no authenticated Codex account.
5. Switch to dark theme and reload the same mobile viewport.
6. Repeat steps 2 through 4 in dark theme.
7. Add an `auth.json` containing only `tokens.access_token` and confirm `account/rateLimits/read` is not short-circuited as unauthenticated.
8. Replace `auth.json` with malformed JSON and confirm the server logs a `[codex-auth] Unable to read Codex auth state` warning while the home screen still renders.

#### Expected Results
- The fresh mobile home screen renders without a blank page.
- `account/rateLimits/read` returns an empty result instead of a `502` when no Codex account is authenticated.
- An access-token-only auth file is treated as authenticated enough to ask Codex for rate limits.
- Malformed auth files are visible in server logs instead of being silently treated as a normal fresh install.
- The UI remains usable in light theme and dark theme.
- No login or account import is required just to load the home screen.

#### Rollback/Cleanup
- Stop and remove the temporary Docker container, for example `docker rm -f <container-name>`.

---

### Android published CLI loads Codex app-server models through local proxy

#### Feature/Change Name
Android `codexui-android` startup passes the bound server port to app-server free-mode config.

#### Prerequisites/Setup
1. Android proot access works through `/Users/igor/Git-projects/codex-web-local-android/andClaw-codex/ssh.sh`.
2. The published `codexui-android` package version under test is available from npm.
3. ADB forward maps device port `17923` to local port `17923`.

#### Steps
1. Start the package in Android proot:
   `pnpm dlx codexui-android@<version> --port 17923 --no-open --no-tunnel --no-login`
2. Open `http://127.0.0.1:17923/#/` in the browser.
3. Call `POST /codex-api/rpc` with `{"method":"config/read","params":{}}`.
4. Call `POST /codex-api/rpc` with `{"method":"model/list","params":{}}`.
5. Confirm `/codex-api/provider-models` still returns OpenCode Zen model ids.
6. Verify the model selector is enabled in light theme and dark theme.
7. Send `hi` from the home composer and wait for the first assistant reply.
8. Confirm browser/network logs do not show a `502` for `generate-thread-title` or an empty-rollout `thread/read` during startup.

#### Expected Results
- `config/read` returns `200` and includes `model_providers.opencode-zen.base_url` pointing at `http://127.0.0.1:17923/codex-api/zen-proxy/v1`.
- `config/read` includes `model_providers.opencode-zen.wire_api` as `responses`, not `chat`.
- `model/list` returns `200` with model data instead of `502 codex app-server exited unexpectedly`.
- The model selector is usable in both light theme and dark theme.
- A first home-composer message creates a thread and receives a response without visible startup RPC errors.

#### Rollback/Cleanup
- Stop the temporary Android proot process with `pkill -f codexui-android` if needed.

---

### OpenCode Zen status returns current provider models

#### Feature/Change Name
OpenCode Zen free-mode status and model discovery consistency.

#### Prerequisites/Setup
1. Dev server or published CLI server running with no Codex auth so free mode defaults to OpenCode Zen.
2. Browser can open the home route in light theme and dark theme.

#### Steps
1. In light theme, open the home route.
2. Call `GET /codex-api/free-mode/status`.
3. Call `GET /codex-api/provider-models`.
4. Confirm both responses report OpenCode Zen data, including `big-pickle` and current Zen model ids such as `deepseek-v4-flash-free` when upstream returns it.
5. Confirm `/codex-api/free-mode/status` reports `wireApi` as `responses`.
6. Open the model selector immediately after initial page load and confirm the Zen models are available without first switching providers or refreshing settings.
7. In Chrome with a previously loaded app version, reload the page and confirm the service worker fetches the new script/style bundle instead of keeping stale cached selector behavior.
8. With a script/style bundle already cached by the service worker, temporarily make the same script/style request return HTTP 404 or 500 and reload.
9. Switch to dark theme and repeat steps 1 through 8.

#### Expected Results
- Free-mode status does not expose stale OpenRouter cached model ids when `provider` is `opencode-zen`.
- OpenCode Zen uses `responses`, not `chat`, in saved/default UI state.
- Provider model discovery and status agree on the model list source.
- Initial startup model loading uses the active provider context and does not leave GPT-only `model/list` entries as the visible selector list for OpenCode Zen.
- Selected model ids persist to localStorage by thread/provider context; legacy/global selected-model keys cannot choose a model for OpenCode Zen, while a valid provider-scoped OpenCode Zen saved choice is restored.
- Service-worker script/style cache invalidation does not keep Chrome on an older model-selector bundle after a new local build is served.
- Service-worker script/style fetches still use a cached bundle if the network request resolves with a non-OK HTTP status.
- Model selector content remains usable in light theme and dark theme.

#### Rollback/Cleanup
- None.

---

### Sub-agent live names and reasoning summaries

#### Feature/Change Name
Sub-agent status rows use unique names, spawned-agent nicknames, and reasoning summaries.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`).
2. A Codex turn can spawn at least two delegated agents.
3. Light theme and dark theme are both available from the appearance switcher.

#### Steps
1. In light theme, start a turn that delegates work to two sub-agents.
2. Confirm the composer status rows show unique agent labels while the agents are active.
3. If the spawned threads include nicknames such as `Hilbert` or `Goodall`, confirm those names replace technical `agent <id>` labels.
4. Wait for delegated agents to emit reasoning summaries and confirm the status text updates from `waiting for delegated result` to the latest summary.
5. Confirm long summary text stays in the existing small status style and is visually clamped to at most two lines.
6. Switch to dark theme and repeat steps 1-5.

#### Expected Results
- Multiple agents with shared thread-id prefixes do not render with duplicate fallback names.
- Agent nicknames from app-server thread metadata appear when available.
- Reasoning summary text updates dynamically without exposing raw chain-of-thought text.
- The composer remains aligned and readable in both light theme and dark theme.

#### Rollback/Cleanup
- Close or archive any disposable delegated-agent test threads if they were created only for verification.

---

### Thread conversation loads earlier turns on demand

#### Feature/Change Name
Thread conversation incremental older-turn loading.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`)
2. A thread with more than 10 turns is available
3. Light theme and dark theme both available from the appearance switcher

#### Steps
1. In light theme, open a thread that has more than 10 turns.
2. Confirm the newest messages render first and the conversation shows the Load earlier messages control at the top.
3. Click Load earlier messages once.
4. Confirm an older batch is prepended above the previously first visible turn and the scroll position stays near the same content.
5. Continue clicking Load earlier messages until the control disappears.
6. Confirm the oldest messages in the thread are visible and no duplicate message rows are introduced.
7. Switch to dark theme and repeat steps 1-6 on the same thread or another long thread.

#### Expected Results
- Initial thread open remains bounded to the latest turn page.
- Load earlier messages fetches older persisted turns from the local bridge instead of only revealing already-loaded messages.
- The control remains available while older persisted turns exist and disappears after the first turn is loaded.
- Message ordering, turn actions, and scroll restoration remain stable in light and dark themes.

#### Rollback/Cleanup
- None.

---

### Collapsed project folder shows hidden thread attention badge

#### Feature/Change Name
Sidebar project folder attention badge for collapsed projects.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`).
2. A project folder contains at least one thread with a visible thread attention dot, for example an unread completed task.
3. Light theme and dark theme are available from the appearance setting.

#### Steps
1. In light theme, expand the project folder and confirm the attention dot is visible beside the affected thread.
2. Collapse the same project folder.
3. Confirm a small status badge appears on the folder icon while the child thread row is hidden.
4. Expand the folder again and confirm the folder badge disappears while the child thread dot remains visible.
5. Activate sidebar search so the matching child thread is shown, even if the project is saved as collapsed.
6. Confirm the folder badge is not shown while search is revealing the child thread.
7. Switch to dark theme and repeat steps 1 through 6.

#### Expected Results
- Collapsed project folders surface hidden child-thread attention with the same status color priority as thread rows.
- Expanded project folders do not duplicate the child thread dot on the folder row.
- Search results do not add an extra folder badge when the child thread is already visible.
- The badge has enough contrast against the sidebar in both light theme and dark theme.

#### Rollback/Cleanup
- Mark the test thread as read, or expand the project folder again if desired.

---

### Sidebar project folders show recent threads before Show more

#### Feature/Change Name
Expanded project folders initially show only threads whose sidebar relative updated label is 0d, 1d, 2d, or 3d; threads shown as 4d or older are hidden behind Show more.

#### Prerequisites/Setup
1. Dev server running (`pnpm run dev --host 127.0.0.1 --port 4173`).
2. A project folder has threads last updated today, 1-3 days ago, and 4+ days ago.
3. Light theme and dark theme both available from the appearance switcher.

#### Steps
1. In light theme, open the sidebar Projects section and expand the test project folder.
2. Confirm rows labeled 0d/now/hours/minutes, 1d, 2d, and 3d are visible before clicking Show more.
3. Confirm rows labeled 4d or older are hidden while Show more is visible.
4. Click Show more and confirm the 4d+ rows appear, then click Show less and confirm they are hidden again.
5. Select a 4d+ thread, return to the project folder, and confirm the selected old thread remains visible before Show more is clicked.
6. Use sidebar search for a 4d+ thread and confirm search results still show matching old threads without requiring Show more.
7. Collapse the project folder and confirm thread rows stay hidden regardless of age.
8. Switch to dark theme and repeat steps 1-7.

#### Expected Results
- Expanded project folders show recent threads through the same updatedAtIso-with-createdAtIso-fallback basis as the right-side relative label.
- Threads shown as 4d or older are hidden until Show more is clicked.
- Show less restores the age-limited view.
- The active selected thread remains visible even when it is 4d or older.
- Search and collapsed project behavior are unchanged.
- Rows and Show more/Show less controls remain readable in light theme and dark theme.

#### Rollback/Cleanup
- None.

---

### Thread auto-title routes through local Codex load balancer

#### Feature/Change Name
Thread auto-title LLM routing documentation and manual configuration check.

#### Prerequisites/Setup
1. Local Codex load balancer is running and reachable from the CodexUI server environment.
2. `CODEXUI_THREAD_TITLE_*` variables are configured with placeholder-safe documented values, not real secrets in committed files.
3. Dev server running if performing an end-to-end title generation check.

#### Steps
1. Inspect the deployment environment or local `.env` override used outside version control.
2. Confirm `CODEXUI_THREAD_TITLE_BASE_URL` points to `http://127.0.0.1:2455/v1`, not the official OpenAI API host.
3. Confirm `CODEXUI_THREAD_TITLE_MODEL` uses `gpt-5.4-mini` or the expected local load-balancer alias.
4. Start a new thread and send a message that should trigger automatic title generation.
5. Check local load-balancer logs and confirm the title-generation request was received there.
6. Confirm no committed documentation or test fixture contains a real API key, bearer token, or provider secret.

#### Expected Results
- Thread auto-title generation calls are routed through the local Codex load balancer via `CODEXUI_THREAD_TITLE_*`.
- The official OpenAI API is not contacted for this path unless a deployment intentionally overrides the local routing.
- Documentation examples remain placeholder-only and contain no real secrets.

#### Rollback/Cleanup
- Remove or restore any local, uncommitted environment overrides used for the manual check.

---

### Collapsible Agents and MCP Runtime Activity

#### Feature/Change Name
Composer runtime activity panel groups sub-agent rows and MCP activity rows, with a one-line collapsed summary.

#### Prerequisites/Setup
1. Dev server running: `pnpm run dev --host 127.0.0.1 --port 4173`.
2. A thread is actively running with multiple sub-agents, or a visual fixture injects representative activity rows.
3. At least one MCP tool call or MCP elicitation request is active or represented in the fixture.
4. Light theme and dark theme are available.

#### Steps
1. In light theme, open the active thread and confirm the composer activity panel appears above the message input.
2. Confirm agent rows are grouped first and MCP rows are grouped below under an `MCP` section.
3. Click `Collapse` and confirm the activity panel becomes a single summary row showing total, active, done, and failed counts where applicable.
4. Click `Expand` and confirm all agent and MCP rows return without shifting the composer width.
5. Confirm completed or resolved MCP work disappears once the active request/turn is no longer in progress.
6. Switch to dark theme and repeat steps 1 through 5.

#### Expected Results
- Many agents no longer force a tall activity block when collapsed.
- The collapsed row remains one line, truncates safely, and does not overflow horizontally.
- MCP activity uses the same compact status vocabulary as agent activity while staying visually grouped below agents.
- Light and dark themes both keep the panel readable without light surfaces leaking into dark mode.

#### Rollback/Cleanup
- Stop the test turn or resolve pending MCP/server requests used for the fixture.

---

### Directory Hub Apps Directory Failure

#### Feature/Change Name
Apps tab concise error state when the app directory cannot load.

#### Prerequisites/Setup
1. Dev server running: `pnpm run dev --host 127.0.0.1 --port 4173`.
2. Ability to force or simulate an `app/list` failure, for example by running against a Codex CLI/app-server build that returns an app-list error.
3. Light theme and dark theme are available from the appearance setting.

#### Steps
1. In light theme, open `http://127.0.0.1:4173/#/skills?tab=apps`.
2. Trigger or confirm the `app/list` failure state.
3. Confirm the Apps tab error text is concise and says the Apps directory is temporarily unavailable.
4. Confirm the visible error does not expose raw RPC method names, JSON payloads, stack traces, HTML, or long server error details.
5. Click `Refresh` and confirm the same concise error is shown if the failure persists.
6. Switch to dark theme and repeat steps 1-5.

#### Expected Results
- The Apps tab displays `Apps directory temporarily unavailable. Refresh or try again later.` for app-list failures.
- Raw backend/RPC/HTML details are not visible in the Apps tab error surface.
- The error block remains readable and visually consistent in both light theme and dark theme.

#### Rollback/Cleanup
- Restore the normal app-server/Codex CLI behavior if a local failure stub or downgraded server was used.

---

### Directory Hub Apps Cached Snapshot Fallback

#### Feature/Change Name
Apps tab cached snapshot fallback app-list loading.

#### Prerequisites/Setup
1. Dev server running: `pnpm run dev --host 127.0.0.1 --port 4173`.
2. A usable cached app directory exists, either from a prior `app/list/updated` snapshot or a seeded `CODEX_HOME/cache/codex_app_directory/<hash>.json` file containing `{ "connectors": [...] }`.
3. Ability to force or observe an upstream `app/list` failure, such as the `chatgpt.com` connector directory returning 403 while the local cache exists.
4. Light theme and dark theme are available from the appearance setting.

#### Steps
1. In light theme, open `http://127.0.0.1:4173/#/skills?tab=apps`.
2. Trigger or confirm an upstream `app/list` failure while the cached app snapshot is available.
3. Confirm the bridge returns a successful Apps list response with normal `data` rows from the cached snapshot.
4. Confirm the returned app rows render as normal app cards.
5. Confirm the page does not show the Apps directory unavailable message while cached rows are available.
6. Click `Refresh` and confirm app rows still render if the upstream request keeps failing and the cache remains available.
7. Remove or invalidate the cached snapshot, repeat the failing load, and confirm the concise unavailable message appears.
8. Switch to dark theme and repeat steps 1-7.

#### Expected Results
- Upstream `app/list` failure renders cached app rows when a bridge snapshot or valid local cache exists.
- Cached fallback rows render as ordinary app cards with search and sort behavior intact.
- Cached fallback implementation details do not leak as raw JSON or debug text in the Apps tab.
- The unavailable message appears only when the upstream request fails and no cached fallback page is available.
- App cards and empty/loading states remain readable in both light theme and dark theme.

#### Rollback/Cleanup
- Remove any local response stub or restore the normal app-server/Codex CLI behavior after verification.

---

### Unified Responses Proxy Stale Previous Response Recovery

#### Feature/Change Name
Unified Responses proxy recovers from stale `previous_response_id` without touching auth/accounts.

#### Prerequisites/Setup
1. Dev server running: `pnpm run dev --host 127.0.0.1 --port 4173`.
2. A provider route that uses the unified Responses proxy raw Responses path is configured, such as Custom endpoint or OpenRouter `Responses API` mode through the local proxy.
3. A test thread exists with at least one successful assistant response so a follow-up request can carry a `previous_response_id`.
4. Ability to simulate a stale upstream previous-response reference, for example by using an endpoint/proxy fixture that rejects the next request because the referenced previous response is unknown or expired.

#### Steps
1. Open the test thread and send a normal prompt that succeeds through the unified Responses proxy.
2. In the same thread, configure the endpoint/proxy fixture so the next follow-up rejects the existing `previous_response_id` as stale, unknown, expired, or missing.
3. Send a follow-up prompt in the same thread.
4. Confirm the proxy retries or recovers by omitting/resetting the stale previous-response reference for that request.
5. Confirm the recovered request completes with a normal assistant response.
6. Inspect local auth/account state before and after the recovery, such as configured account selection, provider settings, and auth token files used by the test environment.
7. Trigger the same stale previous-response failure again with recovery disabled or forced to fail, if available, and observe the visible error state.
8. Light and dark theme UI is not changed by this behavior; if checking themes manually, verify only that no new UI surface appears and any ordinary failure/error text remains visible in both themes.

#### Expected Results
- Stale `previous_response_id` failures are handled within the unified Responses proxy recovery path.
- The follow-up turn succeeds after recovery instead of permanently failing on the stale previous-response reference.
- Recovery does not refresh, replace, remove, or switch auth/account state.
- Existing provider configuration and selected account remain unchanged.
- No light-theme or dark-theme UI behavior changes are introduced; theme verification is limited to unchanged UI and ordinary error visibility during manual failure checks.

#### Rollback/Cleanup
- Remove any endpoint/proxy fixture used to force stale `previous_response_id` failures.
- Restore provider/API format, selected model, and test thread state to preferred defaults.
- Restore any local auth/account files from the pre-test backup if the manual environment was inspected or copied for comparison.

---

### Browser Annotation Transcription Env Smoke

#### Feature/Change Name
Browser annotation server-side transcription environment validation.

#### Prerequisites/Setup
1. Run from the repository root.
2. Do not paste, print, or commit any real OpenAI API key value.
3. Optional: set `CODEXUI_ANNOTATION_TRANSCRIBE_MODEL` and `CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL` to local placeholder values.

#### Steps
1. Run `node scripts/test-codexui-annotation-transcription-env.mjs`.
2. Confirm the command exits successfully.
3. Inspect the output and confirm it reports only whether `OPENAI_API_KEY` is `present` or `missing`.
4. Confirm the output reports model env status without printing secret values.
5. Light and dark theme verification is not applicable because this change has no UI surface.

#### Expected Results
- The smoke script exits 0.
- Output includes `OPENAI_API_KEY=present` or `OPENAI_API_KEY=missing`.
- The actual API key value is never printed.
- Annotation transcription model env vars are trimmed and reported as configured or unset.

#### Rollback/Cleanup
- Unset any local placeholder `CODEXUI_ANNOTATION_TRANSCRIBE_MODEL` and `CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL` values that were added only for testing.

---

### Browser Annotation Data Contracts

#### Feature/Change Name
Browser annotation batch contract, examples, and privacy validation.

#### Prerequisites/Setup
1. Run from the repository root.
2. No browser or dev server is required.

#### Steps
1. Run `pnpm exec vitest run src/api/browserAnnotationContracts.test.ts`.
2. Confirm representative text-only, screenshot-only, voice, and DevTools-heavy examples validate.
3. Confirm sensitive headers and body fields are rejected unless their values are exactly `[REDACTED]`.
4. Confirm captured body text requires user opt-in and respects the byte cap.
5. Confirm malformed `assets` and `items` arrays return validation errors instead of throwing.
6. Light and dark theme verification is not applicable because this change has no UI surface.

#### Expected Results
- The focused Vitest file passes.
- DevTools payload examples enforce redaction for passwords, tokens, cookies, API keys, and common camelCase/kebab-case variants.
- `redacted` and `not-captured` body states cannot carry raw text.
- Multibyte body trimming does not exceed the configured byte cap.

#### Rollback/Cleanup
- None.

---

### Browser Annotation Phase 0 Quality Gates

#### Feature/Change Name
Phase 0 unit, build, lint-substitute, and coverage baseline gates.

#### Prerequisites/Setup
1. Run from the repository root.
2. Dependencies are installed with `pnpm install`.

#### Steps
1. Run `pnpm run test:unit`.
2. Run `pnpm run build`.
3. Run `pnpm exec tsc --noEmit -p tsconfig.server.json` as the server typecheck/lint substitute.
4. Run `pnpm run test:coverage`.
5. Inspect the coverage summary and record the current baseline.
6. Light and dark theme verification is not applicable because this change has no UI surface.

#### Expected Results
- `pnpm run test:unit` passes all unit tests.
- `pnpm run build` passes frontend and CLI builds.
- The server typecheck/lint substitute passes.
- `pnpm run test:coverage` passes and reports the TypeScript coverage baseline.
- Current baseline: statements 18.34%, branches 15.46%, functions 21.23%, lines 19.12%.

#### Rollback/Cleanup
- Remove generated `coverage/` output if it is not needed locally.

---

### Previous Response Error Diagnostics

#### Feature/Change Name
`previous_response_id` / `previous_response_not_found` diagnostic JSONL logging.

#### Prerequisites/Setup
1. Run from the repository root.
2. Dependencies are installed.
3. Optional: set `CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG=/tmp/codexui-previous-response-errors.jsonl` to choose a custom log path. By default the log is written to `output/previous-response-errors.jsonl`.

#### Steps
1. Run `pnpm vitest run src/server/unifiedResponsesProxy.test.ts`.
2. Run `pnpm exec tsc --noEmit -p tsconfig.server.json`.
3. During normal app usage, leave the app running and wait for any error containing `previous_response_not_found`, `previous_response_id`, or `Previous response ... not found`.
4. Inspect the JSONL log path and confirm each row contains diagnostic metadata such as `source`, `phase`, `method` or `requestPath`, `threadId` when known, `model`, `wireApi`, `status`, `previousResponseId`, and summarized error text.
5. Confirm log rows do not include bearer tokens, authorization headers, or full prompt/input payloads.
6. Light and dark theme verification is not applicable because this change has no UI surface.

#### Expected Results
- The focused Vitest file passes and verifies retry diagnostics are written for stale previous-response recovery.
- The server typecheck passes.
- Runtime failures of this specific class are captured in JSONL without requiring auto-continue behavior.
- Normal UI rendering is unchanged in both light and dark themes.

#### Rollback/Cleanup
- Delete any temporary diagnostic log used for testing, or unset `CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG` to return to the default path.

---

### Browser Annotation Server Pairing Endpoints

#### Feature/Change Name
Browser annotation short-lived listen session API.

#### Prerequisites/Setup
1. Run from the repository root.
2. Dependencies are installed.
3. No browser or dev server is required for the focused endpoint tests.

#### Steps
1. Run `pnpm vitest run src/server/browserAnnotationListen.test.ts --reporter=verbose`.
2. Confirm `/codex-api/extension/listen/start` returns a session with a one-time `pairingToken`.
3. Confirm `/codex-api/extension/listen/status` accepts the returned bearer token and never echoes `pairingToken`.
4. Confirm expired, revoked, and wrong tokens are rejected.
5. Confirm malformed JSON returns `400` and oversized JSON returns `413`.
6. Confirm starting a new session for the same thread revokes the older active session and the global session cap removes oldest records.
7. Run `pnpm exec vue-tsc --noEmit`.
8. Light and dark theme verification is not applicable because this stage adds server endpoints only and no UI surface.

#### Expected Results
- The focused Vitest file passes all endpoint cases.
- The server typecheck passes.
- Tokens are stored server-side only as hashes and are returned only from the start endpoint.
- Status/stop requests require a bearer token and can be scoped by `sessionId`.

#### Rollback/Cleanup
- None. Sessions are in-memory and expire or disappear when the server process exits.

---

### Browser Annotation Listening Session UI

#### Feature/Change Name
Active-thread `Listen for browser annotations` panel.

#### Prerequisites/Setup
1. Run the app locally and open an existing thread.
2. Keep DevTools Network open if you want to inspect endpoint calls.
3. No Chrome extension is required for this UI smoke check.

#### Steps
1. In light theme, open a thread and click the three-dot thread feature menu in the content header.
2. Click `Listen`.
3. Open sidebar `Settings` > `Listen settings` and confirm the panel shows active status, the selected thread title, expiry time, copyable server URL, and a pairing token.
4. Click `Copy` for the server URL and pairing token and confirm the copied-state label appears briefly.
5. Click `Stop` and confirm the token disappears and status changes away from active.
6. Start listening again, switch to a different thread before the request completes if possible, and confirm the old thread token is not shown on the new thread.
7. Repeat steps 1-5 in dark theme and confirm the feature menu, settings surfaces, text, inputs, and buttons use dark colors without light-theme panels.
8. Run `pnpm vitest run src/api/codexGateway.test.ts --reporter=verbose`.
9. Run `pnpm exec vue-tsc --noEmit`.

#### Expected Results
- The settings panel is idle until the user clicks `Listen` from the feature menu; no startup request is made.
- A start request creates one short-lived session for the active thread.
- While active, status polling runs at a 15-second cadence and includes `sessionId` and `threadId`.
- Pairing token is visible only while the listener is active and is cleared on stop, expiry/status failure, thread change, and unmount.
- Light and dark theme panels are readable and visually consistent with the header/settings surfaces.
- Phase 1 verification captured `output/playwright/browser-annotation-listener-light.png` and `output/playwright/browser-annotation-listener-dark.png`; dark mode shell background was `rgb(24, 24, 27)` and the token disappeared after Stop.

#### Rollback/Cleanup
- Click `Stop` for any active listener session. Sessions also expire automatically or disappear when the server process exits.

---

### Browser Annotation Asset Upload Endpoint

#### Feature/Change Name
Paired extension screenshot, crop, and audio upload API.

#### Prerequisites/Setup
1. Run from the repository root.
2. Dependencies are installed.
3. No browser or extension is required for the focused endpoint tests.

#### Steps
1. Run `pnpm vitest run src/server/browserAnnotationAssets.test.ts src/server/browserAnnotationListen.test.ts --reporter=verbose`.
2. Confirm PNG screenshot uploads return an `asset.localImageUrl`.
3. Confirm WebP crop uploads return an image-compatible local reference.
4. Confirm WebM audio uploads succeed without `localImageUrl`.
5. Confirm unsupported mime types and oversized uploads are rejected.
6. Confirm missing/wrong bearer tokens, missing query selector, revoked sessions, malformed multipart bodies, and very long filenames are handled without persisting unsafe assets.
7. Run `pnpm exec vue-tsc --noEmit`.
8. Light and dark theme verification is not applicable because this stage adds a server endpoint only and no UI surface.

#### Expected Results
- The focused Vitest files pass all listen and asset upload cases.
- The server typecheck passes.
- Upload requests require an active listen session selected by query `sessionId` or `threadId` plus an extension bearer token.
- Unauthorized upload requests are rejected before multipart body buffering.
- Accepted image assets are written under the temp upload root and expose `/codex-local-image?path=...` references.

#### Rollback/Cleanup
- Test-uploaded files are removed by the focused test cleanup. Manual temp files can be removed from the system temp `codex-web-uploads` directory if needed.

---

### Browser Annotation Audio Transcription Endpoint

#### Feature/Change Name
Server-only paired extension audio transcription API.

#### Prerequisites/Setup
1. Run from the repository root.
2. Dependencies are installed.
3. Do not use a real OpenAI API key unless the pasted key has been externally revoked/replaced.
4. For local mocked verification, no real `OPENAI_API_KEY` is required.

#### Steps
1. Run `pnpm exec vitest run src/server/browserAnnotationTranscribe.test.ts src/server/browserAnnotationListen.test.ts src/server/browserAnnotationAssets.test.ts --reporter=verbose`.
2. Confirm mocked OpenAI success uses `CODEXUI_ANNOTATION_TRANSCRIBE_MODEL`.
3. Confirm mocked retryable provider failure falls back to `CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL`.
4. Confirm missing key/model config returns setup errors without calling OpenAI.
5. Confirm missing/wrong/revoked/expired extension sessions are rejected before transcription.
6. Confirm invalid mime types, oversized uploads, and malformed multipart bodies are rejected.
7. Confirm provider and network errors containing key-like text are sanitized before being returned to the extension.
8. Run `pnpm exec vue-tsc --noEmit`.
9. Light and dark theme verification is not applicable because this stage adds a server endpoint only and no UI surface.

#### Expected Results
- The focused Vitest files pass.
- The server typecheck passes.
- The endpoint requires a paired listen session selected by query `sessionId` or `threadId`.
- The OpenAI API key is read only on the server and is never returned to the browser/extension.
- Provider fallback is bounded to one configured fallback attempt for retryable failures.

#### Rollback/Cleanup
- None for mocked tests. If a manual real-provider test is later run with a rotated key, unset temporary env vars after testing.

---

### Browser Annotation Batch Queueing Endpoint

#### Feature/Change Name
Paired extension annotation batch to Codex thread queue.

#### Prerequisites/Setup
1. Run from the repository root.
2. Dependencies are installed.
3. No browser or extension is required for the focused endpoint tests.

#### Steps
1. Run `pnpm run test:browser-annotation` for the full CommonJS browser annotation endpoint smoke suite.
2. Run `pnpm exec vitest run src/server/browserAnnotationBatch.test.ts src/server/browserAnnotationAssets.test.ts src/server/codexAppServerBridge.inlinePayload.test.ts --reporter=verbose` for the focused queue/image integration subset.
3. Confirm a valid two-annotation batch returns `status: queued` and schedules immediate backend queue drain.
4. Confirm note text, selected element details, voice transcript text, and DevTools console/network summaries are included in the queued prompt.
5. Confirm sensitive URL query params are redacted and redacted/not-captured body states do not expose raw body text.
6. Confirm uploaded screenshot refs become queue `imageUrls` only when the ref was issued by the upload endpoint for the same session/thread.
7. Confirm arbitrary local image paths and upload-root refs from another session are rejected from queue image attachments.
8. Confirm missing/wrong bearer tokens, missing selector, malformed JSON, and invalid batch payloads do not queue messages.
9. Run `pnpm exec vue-tsc --noEmit`.
10. Light and dark theme verification is not applicable because this stage adds a server endpoint only and no UI surface.

#### Expected Results
- Focused endpoint and queue integration tests pass.
- Server typecheck passes.
- Annotation batches are queued through the existing backend queue path and scheduled for draining.
- The response includes batch/thread/count metadata and queued message id.
- Image attachments cannot point to arbitrary local files.

#### Rollback/Cleanup
- Remove any manual queued test messages from the thread queue state if you exercise the endpoint outside the focused tests.

---

### Browser Annotation Extension Scaffold

#### Feature/Change Name
Manifest V3 load-unpacked extension scaffold.

#### Prerequisites/Setup
1. Run from the repository root.
2. Chrome is installed for the manual smoke test.
3. No Codex UI dev server is required for the scaffold-only static checks.

#### Steps
1. Run `node --check extension/browser-annotation/shared/constants.js`.
2. Run `node --check extension/browser-annotation/shared/url-utils.js`.
3. Run `node --check extension/browser-annotation/service-worker/service-worker.js`.
4. Run `node --check extension/browser-annotation/content/content-script.js`.
5. Run `node --check extension/browser-annotation/sidepanel/sidepanel.js`.
6. Run `node --check extension/browser-annotation/dev/validate-extension.mjs`.
7. Run `node extension/browser-annotation/dev/validate-extension.mjs`.
8. For the manual smoke test, open `chrome://extensions`, enable Developer mode, click `Load unpacked`, and select `extension/browser-annotation`.
9. Serve the repository with `python3 -m http.server 8899` and open `http://127.0.0.1:8899/extension/browser-annotation/dev/test-page.html`.
10. Click the extension action or press `Ctrl+Shift+Y`, confirm the side panel opens and annotation mode starts; if it is not active, click `Inject overlay`.
11. Confirm the overlay placeholder appears on the page.
12. In a light OS/browser color scheme, confirm the side panel text, fields, badge, and buttons are readable.
13. In a dark OS/browser color scheme, repeat the side panel check and confirm it uses dark surfaces via `prefers-color-scheme`.
14. Open `chrome://extensions` or a Chrome Web Store page and confirm the side panel reports a restricted-page error instead of injecting.

#### Expected Results
- All static Node checks pass.
- The validator confirms Manifest V3, service worker path, side panel path, required permissions, production host permission, narrow local development host permissions, and required scaffold files.
- The extension loads without a build step.
- Overlay injection happens only after the user clicks the extension action, uses the extension action shortcut, or clicks `Inject overlay`.
- Restricted browser pages and Chrome Web Store pages are not offered as injectable targets.
- Light and dark side panel color schemes are readable.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions`.
- Stop the temporary `python3 -m http.server 8899` process if used.

---

### Browser Annotation Extension Pairing Flow

#### Feature/Change Name
Extension server URL and pairing-token validation.

#### Prerequisites/Setup
1. Run from the repository root.
2. Chrome is installed for the manual smoke test.
3. For a valid-token manual check, start Codex UI locally and create an active browser annotation listener token from a thread.

#### Steps
1. Run `node --check extension/browser-annotation/shared/constants.js`.
2. Run `node --check extension/browser-annotation/shared/url-utils.js`.
3. Run `node --check extension/browser-annotation/shared/pairing-client.js`.
4. Run `node --check extension/browser-annotation/service-worker/service-worker.js`.
5. Run `node --check extension/browser-annotation/content/content-script.js`.
6. Run `node --check extension/browser-annotation/sidepanel/sidepanel.js`.
7. Run `node --check extension/browser-annotation/dev/validate-extension.mjs`.
8. Run `node --check extension/browser-annotation/dev/pairing-client-smoke.mjs`.
9. Run `node extension/browser-annotation/dev/validate-extension.mjs`.
10. Run `node extension/browser-annotation/dev/pairing-client-smoke.mjs`.
11. Load `extension/browser-annotation` as an unpacked Chrome extension.
12. Open the side panel with the extension action or `Ctrl+Shift+Y`, with no token saved, and confirm it shows `Disconnected`.
13. Enter `http://127.0.0.1:<port>` or `http://localhost:<port>` and an invalid token, then click `Save and validate`.
14. Confirm the side panel shows `Error` and does not expose the token outside the password field.
15. Paste a valid listener token from Codex UI and click `Save and validate`.
16. Confirm the side panel shows `Connected`, thread id, and expiry metadata.
17. Repeat the disconnected, error, and connected visual checks in light and dark OS/browser color schemes.

#### Expected Results
- All static Node checks pass.
- The validator confirms permanent host permissions are limited to Codex UI/annotation server origins plus local development origins, and arbitrary page access is declared only through optional runtime host permissions.
- The pairing client smoke confirms status URL construction, malformed JSON handling, error parsing, and omission of any returned `pairingToken`.
- Extension local storage contains only the user-configured server URL; the pasted pairing token is kept in extension session storage while needed and no provider API key is present.
- Status validation sends the token only as `Authorization: Bearer <token>` to `/codex-api/extension/listen/status`.
- Light and dark side panel states are readable for disconnected, error, and connected states.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions`.
- Stop any local Codex UI dev server started solely for this check.
- Revoke or stop any active listener session created for testing.

---

### Browser Annotation Extension Element Selection

#### Feature/Change Name
Page overlay, selected element context, and local annotation queue.

#### Prerequisites/Setup
1. Run from the repository root.
2. Chrome is installed for the manual smoke test.
3. Load `extension/browser-annotation` as an unpacked extension.
4. Serve the repository with Codex UI dev server or `python3 -m http.server 8899`.

#### Steps
1. Run `for file in $(rg --files extension/browser-annotation -g '*.js' -g '*.mjs' | sort); do node --check "$file" || exit 1; done`.
2. Run `node extension/browser-annotation/dev/validate-extension.mjs`.
3. Run `node extension/browser-annotation/dev/pairing-client-smoke.mjs`.
4. Run `node extension/browser-annotation/dev/selection-context-smoke.mjs`.
5. Run `git diff --check -- extension/browser-annotation`.
6. Open `http://127.0.0.1:4173/browser-annotation-test.html` when using Codex UI dev server, or `http://127.0.0.1:8899/extension/browser-annotation/dev/test-page.html` when using `python3 -m http.server`.
7. Click the extension action or press `Ctrl+Shift+Y` to open the side panel and start annotation mode.
8. If annotation mode is not active, click `Inject overlay`.
9. Hover the sample button, input, and card, and confirm the hover outline tracks each element.
10. Click the sample button and confirm a selected outline remains and the side panel queue count increments.
11. Repeat selection for the sample input and sample card.
12. Confirm the queue entries show element type, text/label, selector, and page title or URL.
13. Press `Esc` and confirm annotation mode pauses and page clicks work normally again.
14. Repeat the side panel queue visual check in light and dark OS/browser color schemes.

#### Expected Results
- All static and smoke commands pass.
- The overlay is injected only after the side-panel user action.
- Hover and selected outlines appear above the page without affecting normal layout.
- Button, input, and card selections queue context with selector, XPath, role, aria/text, rect, viewport, headings, and labels.
- The queue is bounded in extension local storage and updates in the side panel without polling.
- Light and dark side panel queue states remain readable.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions`.
- Stop the temporary `python3 -m http.server 8899` process or Codex UI dev server used for the test.
- Clear extension storage from the extension details page if you want to remove queued test selections.

---

### Browser Annotation Extension Screenshot Crop Preview

#### Feature/Change Name
Visible-tab capture, device-pixel-ratio crop, and bounded preview storage.

#### Prerequisites/Setup
1. Run from the repository root.
2. Chrome is installed for the manual smoke test.
3. Load `extension/browser-annotation` as an unpacked extension.
4. Serve the repository with Codex UI dev server or `python3 -m http.server 8899`.

#### Steps
1. Run `find extension/browser-annotation -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check`.
2. Run `node extension/browser-annotation/dev/validate-extension.mjs`.
3. Run `node extension/browser-annotation/dev/pairing-client-smoke.mjs`.
4. Run `node extension/browser-annotation/dev/selection-context-smoke.mjs`.
5. Run `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`.
6. Run `node extension/browser-annotation/dev/screenshot-crop-smoke.mjs`.
7. Run `git diff --check -- extension/browser-annotation`.
8. Open `http://127.0.0.1:4173/browser-annotation-test.html` when using Codex UI dev server, or `http://127.0.0.1:8899/extension/browser-annotation/dev/test-page.html` when using `python3 -m http.server`.
9. Click the extension action or press `Ctrl+Shift+Y`; if annotation mode is not active, click `Inject overlay`.
10. Select the sample button and confirm the queue row shows either a crop preview matching the button or a `No preview` placeholder if Chrome denies visible-tab capture.
11. Select the sample input and card and confirm each element is queued even when preview capture is unavailable.
12. Confirm no full visible-tab screenshot appears in extension storage; only cropped previews or a short `previewError` are stored.
13. Repeat the preview/placeholder rendering check in light and dark OS/browser color schemes.

#### Expected Results
- All static and smoke commands pass.
- `chrome.tabs.captureVisibleTab` is used only after the user-driven selection flow.
- Crop math uses `devicePixelRatio` and clips to screenshot bounds.
- Queue previews are best-effort; a `captureVisibleTab` failure does not block element queueing.
- Queue previews are capped per item and the queue is trimmed under the aggregate storage budget before `chrome.storage.local.set`.
- The side panel renders the newest preview rows or `No preview` placeholders without polling.
- Light and dark side panel preview rows are readable.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions`.
- Stop the temporary `python3 -m http.server 8899` process or Codex UI dev server used for the test.
- Clear extension storage from the extension details page to remove preview test data.

---

### Browser Annotation Extension Multi-Annotation Batch Send

#### Feature/Change Name
Queue notes, edit/delete/reorder, and send one annotation batch.

#### Prerequisites/Setup
1. Run from the repository root.
2. Chrome is installed for the manual smoke test.
3. Load `extension/browser-annotation` as an unpacked extension.
4. Start Codex UI locally and create an active browser annotation listener token from a thread.
5. Serve the repository with Codex UI dev server or `python3 -m http.server 8899`.

#### Steps
1. Run `find extension/browser-annotation -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check`.
2. Run `node extension/browser-annotation/dev/validate-extension.mjs`.
3. Run `node extension/browser-annotation/dev/pairing-client-smoke.mjs`.
4. Run `node extension/browser-annotation/dev/selection-context-smoke.mjs`.
5. Run `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`.
6. Run `node extension/browser-annotation/dev/screenshot-crop-smoke.mjs`.
7. Run `pnpm exec vitest run src/server/browserAnnotationBatch.test.ts --reporter=verbose`.
8. Open `http://127.0.0.1:4173/browser-annotation-test.html` when using Codex UI dev server, or `http://127.0.0.1:8899/extension/browser-annotation/dev/test-page.html` when using `python3 -m http.server`.
9. Pair the extension with the local Codex UI listener token.
10. Inject the overlay and select the sample button, input, and card.
11. Add notes to at least two annotations.
12. Move one annotation up or down.
13. Delete one annotation so two remain.
14. Click `Send batch`.
15. Confirm the side panel reports success and the queue clears.
16. Confirm the Codex UI thread receives one queued browser annotation batch containing two items.
17. Repeat the queue controls and send-button readability check in light and dark OS/browser color schemes.

#### Expected Results
- All static, extension smoke, and server batch tests pass.
- Queue changes update the side panel immediately and the Send button enables when connected with queued items.
- Every batch item includes `noteText`, even when the note is blank.
- The batch request includes `sessionId` and `threadId` query params and sends the pairing token only as a bearer token.
- Local preview data URLs are not included in the batch body.
- On successful send, the extension queue is cleared.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions`.
- Stop the temporary `python3 -m http.server 8899` process or Codex UI dev server used for the test.
- Revoke or stop the active browser annotation listener session.
- Clear extension storage from the extension details page if test annotations remain.

---

### Browser Annotation Voice Notes

#### Feature/Change Name
Record, upload, transcribe, and send per-annotation voice notes without storing raw audio in queue JSON.

#### Prerequisites/Setup
1. Run from the repository root.
2. Chrome is installed and `extension/browser-annotation` is loaded unpacked.
3. Start Codex UI and create an active browser annotation listener token from a thread.
4. The server has browser annotation transcription configured, or be ready to verify the failed-transcription path.
5. Serve a normal `http(s)` test page and pair the extension with the listener token.

#### Steps
1. Run `find extension/browser-annotation -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check`.
2. Run `node extension/browser-annotation/dev/validate-extension.mjs`.
3. Run `node extension/browser-annotation/dev/pairing-client-smoke.mjs`.
4. Run `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`.
5. Run `pnpm run test:browser-annotation`.
6. Queue an annotation on the test page.
7. Click `Record`, speak briefly, then click `Cancel`; confirm no voice note remains.
8. Click `Record` again, speak briefly, then click `Stop`.
9. Confirm the row shows upload and transcription progress, then either a ready voice note or a transcription error while preserving the uploaded audio metadata.
10. Type a note in the same row and confirm voice upload/transcription does not clear the note text.
11. Delete the voice note while upload/transcription is active and confirm the row returns to no voice note, in-flight requests are aborted, and Send is not left disabled.
12. Record another voice note, wait for upload/transcription to settle, then click `Send queued annotations`.
13. Confirm the batch contains a `voice-note-audio` asset record, item `voiceNote`, no raw audio/base64/data URL, and the Codex UI prompt includes typed note plus voice transcript or voice error.
14. Repeat the queue row voice controls and status readability check in light and dark OS/browser color schemes.

#### Expected Results
- Static, extension smoke, and browser annotation endpoint tests pass.
- Asset upload uses `/codex-api/extension/assets/upload?sessionId=...&threadId=...` with bearer auth and multipart `kind=audio` plus `file`.
- Transcription uses `/codex-api/extension/transcribe?sessionId=...&threadId=...` with bearer auth and multipart `file`.
- Queue storage contains only voice metadata: asset id, mime type, byte length, duration, uploaded timestamp, transcript status/text/error/language.
- Raw `Blob`, chunks, base64, and data URLs never appear in queue storage or batch JSON.
- `voiceNote.transcriptStatus` is `complete` or `failed`, and failed transcription does not drop the annotation.
- Send is disabled while recording/uploading/transcribing and re-enabled after completion or cancellation.
- Light and dark side-panel voice controls remain readable.

#### Rollback/Cleanup
- Delete test voice notes from the queue or clear extension storage from `chrome://extensions`.
- Remove the unpacked extension if it was loaded only for this test.
- Stop or revoke the browser annotation listener session.

---

### Browser Annotation HTTPS Production Ingress And Extension Artifact

#### Feature/Change Name
Expose the browser annotation ingress at `https://annotate.todo-tg-app.ru` and package a production-only Chrome extension zip.

#### Prerequisites/Setup
1. Run from the repository root.
2. DNS zone `todo-tg-app-ru` exists in Yandex Cloud.
3. Nginx can proxy `annotate.todo-tg-app.ru` to the Codex UI backend.
4. A valid certificate exists at `/etc/letsencrypt/live/annotate.todo-tg-app.ru/`.
5. Chrome is available for manual extension installation.

#### Steps
1. Run `yc dns zone list-records --name todo-tg-app-ru --format json` and confirm `annotate.todo-tg-app.ru. 300 A 46.62.215.111`.
2. Run `dig +short annotate.todo-tg-app.ru A @8.8.8.8` and `dig +short annotate.todo-tg-app.ru A @1.1.1.1`.
3. Install `ops/nginx/annotate.todo-tg-app.ru.conf` into `/etc/nginx/sites-available/annotate.todo-tg-app.ru`, enable it, run `sudo nginx -t`, then reload nginx.
4. Run `curl -I https://annotate.todo-tg-app.ru/browser-annotation-test.html`.
5. Run `curl -I https://annotate.todo-tg-app.ru/codex-api/extension/listen/status`.
6. Run `pnpm run pack:browser-annotation`.
7. Inspect `dist/browser-annotation-extension/unpacked/manifest.json`.
8. Install `dist/browser-annotation-extension/unpacked` or the zip in Chrome and pair with `Server URL: https://annotate.todo-tg-app.ru`.
9. Queue and send at least two annotations from a normal HTTPS page.
10. Repeat pairing and side-panel readability checks in light and dark browser color schemes.

#### Expected Results
- Public DNS resolves `annotate.todo-tg-app.ru` to `46.62.215.111`.
- HTTPS returns a valid certificate for `annotate.todo-tg-app.ru`.
- `/browser-annotation-test.html` returns `200` and contains `Codex annotation extension test page`.
- `/codex-api/extension/listen/status` reaches the Codex UI backend and returns an auth-shaped JSON response rather than an nginx/default-site HTML page.
- Production manifest permanent host permissions are limited to Codex UI/annotation server origins, with `http://*/*` and `https://*/*` available only as optional runtime page permissions.
- The zip has `manifest.json` at archive root and does not include `dev/`.
- The extension can pair, queue annotations, and send over HTTPS.
- Light and dark side-panel states remain readable.

#### Rollback/Cleanup
- Remove or disable `/etc/nginx/sites-enabled/annotate.todo-tg-app.ru` and reload nginx.
- Remove the explicit DNS record if rolling back to wildcard behavior.
- Delete `dist/browser-annotation-extension/` if the artifact was only for a smoke test.
- Revoke the browser annotation listener session.

---

### Browser Annotation Prompt Composer Tuning

#### Feature/Change Name
Browser annotation batches include an explicit Codex action request that correlates annotations, screenshots, voice, DOM, and DevTools context.

#### Prerequisites/Setup
1. Run from the repository root.
2. Use Node.js 18 or newer.

#### Steps
1. Run `pnpm exec vitest run src/server/browserAnnotationBatch.test.ts --reporter=verbose`.
2. Inspect the queued message text assembled by `buildBrowserAnnotationQueuedMessage`.
3. Confirm the prompt contains a `## Request for Codex` section.
4. Confirm the request tells Codex to correlate DOM target, selector, note, voice transcript, attached screenshot image, and DevTools console/network evidence when present.
5. Confirm the request asks Codex to implement the appropriate repository fix and run focused verification.
6. If checking manually in Codex UI, send a browser annotation batch and verify the rendered user message remains readable in light and dark themes.

#### Expected Results
- The focused Vitest file passes.
- The prompt remains structured as metadata, request, annotation notes, and optional DevTools summary.
- Sensitive URLs and body fields remain redacted by existing privacy assertions.
- No UI style changes are required; any manual light/dark check should show the same readable message rendering as other user messages.

#### Rollback/Cleanup
- No cleanup is required for the focused unit test.
- Delete any manually sent browser annotation batch thread messages if they were created only for smoke testing.

---

### Browser Annotation MCP/Plugin Design Decision

#### Feature/Change Name
Document the browser annotation MCP/plugin path as a future agent-driven architecture instead of an MVP blocker.

#### Prerequisites/Setup
1. Run from the repository root.
2. Read `docs/browser-annotation-mcp-plugin-design.md`.

#### Steps
1. Confirm the decision says no separate browser annotation MCP server or plugin is required for the current MVP.
2. Confirm the document keeps current capture extension-driven through `/codex-api/extension/*`.
3. Confirm future tool names are listed: `snapshot_dom`, `screenshot`, `inspect_console`, `inspect_network`, and `select_element`.
4. Confirm the boundaries keep Chrome debugger, screenshot, audio, and token handling inside the explicit extension/user-consent flow.
5. Confirm the risks section calls out duplicate ingress, permission complexity, user-gesture conflicts, and security review needs.

#### Expected Results
- The design decision is understandable without reading implementation code.
- No runtime MCP/plugin code is required for this stage.
- No UI styling changed; light/dark verification is not applicable to this design-only stage.

#### Rollback/Cleanup
- Remove or revise the design document if a future implementation phase chooses to build a browser annotation MCP server.

---

### Browser Annotation Troubleshooting Guide

#### Feature/Change Name
Document troubleshooting for pairing, DNS/nginx/HTTPS, active-tab permissions, queue previews, DevTools capture, and voice transcription.

#### Prerequisites/Setup
1. Run from the repository root.
2. Read `docs/browser-annotation-troubleshooting.md`.
3. Optionally keep Chrome with the unpacked extension available for spot checks.

#### Steps
1. Confirm the guide lists local, temporary public HTTP, and production HTTPS server URL options.
2. Confirm the pairing section explains expired/revoked tokens and wrong server URLs.
3. Confirm the blank page / `403` / `404` section covers DNS wildcard, Vite `allowedHosts`, and nginx default-server issues.
4. Confirm the selected-element queueing section explains the `activeTab` user gesture and restricted page limitations.
5. Confirm the DevTools section documents debugger warnings, detach causes, and body-capture opt-in.
6. Confirm the voice section documents microphone permission, busy send state, failed transcription behavior, and raw-audio exclusion.
7. Confirm the public HTTPS section references the YC zone, explicit A record, nginx template, Let's Encrypt path, and root-required deployment actions.
8. Open `extension/browser-annotation/README.md` and confirm it links to the troubleshooting guide.

#### Expected Results
- A user can map common observed failures to a concrete check or fix.
- No runtime code changes are required for this documentation-only stage.
- No UI styling changed; light/dark verification is not applicable to this documentation-only stage.

#### Rollback/Cleanup
- Revise or remove the guide if the deployment or extension architecture changes.

---

### Browser Annotation Listener Last Batch Metadata

#### Feature/Change Name
Show safe last-received browser annotation batch metadata in the active listener panel.

#### Prerequisites/Setup
1. Run from the repository root.
2. Start or reuse a Codex UI browser annotation listener session.

#### Steps
1. Run `pnpm exec vitest run src/server/browserAnnotationListen.test.ts src/server/browserAnnotationBatch.test.ts src/api/codexGateway.test.ts --reporter=verbose`.
2. Run `pnpm exec vue-tsc --noEmit`.
3. Run `pnpm run test:browser-annotation`.
4. Start a listener from a thread and pair the extension.
5. Send an annotation batch.
6. Wait for the listener panel status refresh, or trigger a status refresh by reopening the selected thread.
7. Confirm the panel shows `Last batch` with annotation count and received time.
8. Confirm the context line shows image, console, and network counts only.
9. Repeat the panel readability check in light and dark themes.

#### Expected Results
- Focused Vitest, typecheck, and browser annotation endpoint suites pass.
- The listen status response includes only safe metadata: batch id, queued message id, timestamp, and counts.
- Raw annotation text, DOM snippets, tokens, screenshots, audio, and DevTools bodies are not exposed in listener status.
- The listener panel keeps the same light/dark styling and remains readable.

#### Rollback/Cleanup
- Stop or revoke the listener session.
- Clear extension storage if manual test data remains.

---

### Browser Annotation Batch Compact Thread Rendering

#### Feature/Change Name
Render incoming browser annotation batch prompts as compact thread cards with parsed annotation summaries, screenshots, and expandable raw context.

#### Prerequisites/Setup
1. Run from the repository root.
2. Have a thread containing a `# Browser annotation batch` user message, or send one from the browser annotation extension.
3. For manual checks, keep the extension paired and able to send annotations with at least one screenshot.

#### Steps
1. Run `pnpm exec vitest run src/components/content/browserAnnotationBatchMessage.test.ts --reporter=verbose`.
2. Run `pnpm exec vue-tsc --noEmit`.
3. Run `pnpm run test:browser-annotation`.
4. Open a thread that contains a browser annotation batch message.
5. Confirm the user message renders as a compact `Browser annotation` card instead of raw full prompt text.
6. Confirm the card shows the primary page, batch id, annotation count, screenshot count, and `DevTools included` when present.
7. Confirm each annotation row shows kind/id plus the best available note, transcript, voice error, selected text, or DevTools context.
8. Confirm attached screenshots are shown inside the card and still open in the image modal.
9. Open `Raw context` and confirm the original markdown prompt remains available.
10. Repeat the thread readability check in light and dark themes.

#### Expected Results
- The focused parser test, Vue typecheck, and browser annotation suite pass.
- Browser annotation batch messages are scannable without losing raw prompt detail.
- Screenshot previews are grouped with the batch card rather than floating above it.
- Light and dark themes keep readable text, borders, backgrounds, and raw-context surfaces.

#### Rollback/Cleanup
- Remove any manual test batch messages if they were created only for this check.
- Stop or revoke the listener session and clear extension storage if needed.

---

### Browser Annotation DevTools Persistence Serialization

#### Feature/Change Name
Serialize DevTools debugger event persistence to preserve bursty console and network rows.

#### Prerequisites/Setup
1. Run from the repository root.
2. Use Node.js 18 or newer.

#### Steps
1. Run `node --check extension/browser-annotation/service-worker/service-worker.js`.
2. Run `node --check extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`.
3. Run `node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`.
4. Optional manual check: load `extension/browser-annotation` as an unpacked extension, start DevTools capture, trigger many console logs and fetches quickly from a test page, then confirm the side panel keeps all expected DevTools rows.

#### Expected Results
- Static checks pass.
- The persistence smoke prints `Extension DevTools service worker persistence smoke passed.`
- Bursty debugger events are applied sequentially, so later writes do not overwrite rows captured by earlier events.
- No UI styling changed; existing DevTools capture rows remain readable in both light and dark side panel themes.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions` if the optional manual check was performed.
- Clear extension storage from the extension details page if manual DevTools capture data remains.

---

### Browser Annotation DevTools Console Secret Redaction

#### Feature/Change Name
DevTools console capture redacts secrets before console rows are stored.

#### Prerequisites/Setup
1. Run from the repository root.
2. Use Node.js with extension smoke-test dependencies available from the repository checkout.

#### Steps
1. Run `node extension/browser-annotation/dev/devtools-capture-smoke.mjs`.
2. Run `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`.
3. Manually start a DevTools capture in the unpacked extension against a test page.
4. In the page console, emit `password=supersecret token=abc123 cookie=sid=sekret Authorization: Bearer abc`.
5. Emit JSON- and Basic-auth-shaped examples such as `{"token":"json-token-abc","password":"json-secret"}` and `Authorization: Basic basic-secret-abc`.
6. Send or inspect the captured annotation batch payload.
7. Repeat the side-panel capture status readability check in light and dark OS/browser color schemes.

#### Expected Results
- The smoke tests pass.
- `consoleRows` and the batch DevTools console payload do not contain `password=supersecret`, `token=abc123`, `cookie=sid=sekret`, `Authorization: Bearer abc`, or the raw secret values.
- JSON-style secret values and Basic auth credentials are redacted before they appear in `consoleRows`.
- Redacted console text uses `[REDACTED]`.
- Light and dark side-panel capture status remains readable.

#### Rollback/Cleanup
- Stop DevTools capture.
- Remove the unpacked extension from `chrome://extensions` if it was loaded only for this test.

---

### Browser Annotation DevTools Failed Body Capture Timeout

#### Feature/Change Name
DevTools response body capture is limited to small textual failures and timeout uses MV3 alarms.

#### Prerequisites/Setup
1. Run from the repository root.
2. Chrome is installed for the manual alarm/capture smoke test.
3. Load `extension/browser-annotation` as an unpacked extension.
4. Serve a test page that can issue successful, `>=400`, large, binary, and failed network requests.

#### Steps
1. Run `node --check extension/browser-annotation/service-worker/service-worker.js`.
2. Run `node --check extension/browser-annotation/shared/devtools-capture.js`.
3. Run `node --check extension/browser-annotation/dev/validate-extension.mjs`.
4. Run `node extension/browser-annotation/dev/validate-extension.mjs`.
5. Run `node extension/browser-annotation/dev/devtools-capture-smoke.mjs`.
6. Enable DevTools capture with body capture opt-in.
7. Trigger a successful small textual request, a small textual `404` or `500`, a large textual error over the cap, a response with unknown `encodedDataLength`, and a binary error response.
8. Confirm only the small textual HTTP error attempts response body capture; successful, large, unknown-size, and binary responses remain metadata-only.
9. Close and reopen the side panel while DevTools capture is still active.
10. Confirm the body-capture checkbox is still checked, disabled, and accompanied by status/help text explaining that body capture is active for the current capture session.
11. Stop DevTools capture, start it again without body opt-in, close and reopen the side panel, and confirm the checkbox is unchecked, disabled while active, and the status/help text says bodies are excluded for that active session.
12. Let the capture timeout expire or shorten `DEVTOOLS_CAPTURE_TIMEOUT_MS` in a temporary local build and confirm the debugger detaches after the service worker has been allowed to go idle.
13. Repeat the side-panel capture status readability check in light and dark OS/browser color schemes.

#### Expected Results
- Static checks, manifest validation, and DevTools capture smoke pass.
- The manifest includes the `alarms` permission required for MV3 wakeup-backed timeout handling.
- `Network.getResponseBody` is not requested for successful, large, unknown-size, or non-textual responses.
- Request bodies from successful `Network.requestWillBeSent` events remain metadata-only even when body capture is opted in.
- Failed HTTP responses with status `>=400` and failed network rows are eligible only when `encodedDataLength` is numeric and at or below the body cap.
- Reopening the side panel during active capture preserves the checked/disabled body-capture state and explanatory text for the active session.
- The alarm reconciliation stops expired DevTools capture and detaches the debugger even if the in-memory `setTimeout` was lost when the service worker suspended.
- Light and dark side-panel capture status remains readable.

#### Rollback/Cleanup
- Stop DevTools capture.
- Remove the unpacked extension from `chrome://extensions` if it was loaded only for this test.
- Revert any temporary local timeout constant used for the manual alarm smoke test.

---

### Browser Annotation Security Hardening

#### Feature/Change Name
Harden public browser annotation ingress, pairing-token storage, extension URL policy, and uploaded asset validation.

#### Prerequisites/Setup
1. Run from the repository root.
2. Use the checked-in extension source or the packaged artifact from `pnpm run pack:browser-annotation`.
3. For manual Chrome checks, load the unpacked extension from `extension/browser-annotation` or the generated production artifact.

#### Steps
1. Run `node --check extension/browser-annotation/service-worker/service-worker.js`.
2. Run `node --check extension/browser-annotation/sidepanel/sidepanel.js`.
3. Run `node extension/browser-annotation/dev/validate-extension.mjs`.
4. Run `node extension/browser-annotation/dev/pairing-client-smoke.mjs`.
5. Run `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`.
6. Run `node extension/browser-annotation/dev/devtools-capture-smoke.mjs`.
7. Run `pnpm exec vitest run src/server/browserAnnotationAssets.test.ts --reporter=verbose`.
8. Run `pnpm run test:browser-annotation`.
9. Run `pnpm run pack:browser-annotation`.
10. Inspect `dist/browser-annotation-extension/unpacked/manifest.json` and confirm `host_permissions` contains only Codex UI/annotation server origins while `optional_host_permissions` contains normal `http(s)` page access.
11. Confirm the side panel rejects `http://46.62.215.111` and other non-local `http://` values as the Server URL, while still allowing overlay injection into normal `http(s)` pages after Chrome grants site access.
12. Pair with a fresh token, send a queued annotation batch, and confirm the pairing token is no longer present in `chrome.storage.local` after save/send.
13. Reuse the same token against `/codex-api/extension/listen/status` after send and confirm the server returns revoked status for that same session without echoing the token.
14. Repeat the side-panel connection and queue readability checks in light and dark OS/browser color schemes.
15. On a deployed public nginx host, request `/codex-api/extension/listen/start` through the public annotation ingress and confirm it is not exposed.

#### Expected Results
- Static checks, extension smoke tests, focused asset tests, and the browser annotation suite pass.
- The production package does not include temporary public-IP host permissions.
- Non-local plain HTTP server URLs are rejected by the extension.
- Pairing tokens are stored only in extension session storage while needed, the server listen session is revoked after a successful send, and the local token is cleared.
- Uploads whose bytes do not match the declared image/audio MIME type are rejected with `415`.
- Public ingress does not allow anonymous pairing-token minting.
- Light and dark side-panel states remain readable.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions` if it was loaded only for this test.
- Clear extension storage and revoke/expire any listener token used for manual checks.
- Remove generated `dist/browser-annotation-extension/` artifacts if they are not needed locally.

---

### Browser Annotation Reliability Hardening

#### Feature/Change Name
Harden extension queue/lifecycle behavior and reject stale in-flight server requests.

#### Prerequisites/Setup
1. Run from the repository root.
2. Use Node.js 18 or newer.
3. For manual checks, load the browser annotation extension in Chrome and use a disposable listener thread.

#### Steps
1. Run `node --check extension/browser-annotation/service-worker/service-worker.js`.
2. Run `node --check extension/browser-annotation/sidepanel/sidepanel.js`.
3. Run `node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`.
4. Run `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`.
5. Run `node extension/browser-annotation/dev/devtools-capture-smoke.mjs`.
6. Run `pnpm exec vitest run src/server/browserAnnotationBatch.test.ts src/server/browserAnnotationAssets.test.ts --reporter=verbose`.
7. Run `pnpm run test:browser-annotation`.
8. Run `pnpm exec vue-tsc --noEmit`.
9. Manually start DevTools capture, reload or navigate the captured tab, and confirm capture stops with a navigation/closed status instead of mixing rows from multiple pages.
10. Manually queue two selections quickly and confirm both remain in the side-panel queue.
11. Manually disconnect the server or use an unroutable server URL and confirm status/send/upload/transcribe requests fail with an error instead of leaving the panel busy indefinitely.
12. Repeat side-panel queue and status readability checks in light and dark OS/browser color schemes.

#### Expected Results
- Static checks and extension smoke tests pass.
- The service-worker persistence smoke verifies serialized queue mutations and tab close/navigation cleanup after an MV3-style restart.
- Focused server tests reject batch and asset upload requests if the listener is revoked while the request body is still in flight.
- Browser annotation endpoint smoke passes.
- A successful batch send removes sent queue items without deleting annotations added concurrently during the send.
- Light and dark side-panel states remain readable.

#### Rollback/Cleanup
- Stop DevTools capture if it remains active.
- Remove the unpacked extension from `chrome://extensions` if loaded only for this test.
- Revoke any listener token and clear extension storage used during manual checks.

---

### Browser Annotation Any-Site Injection, Cancel, And Compact Listener

#### Feature/Change Name
Allow the browser annotation extension to request access for normal `http(s)` sites at runtime, cancel selected annotations from the overlay, and keep the Codex UI listener compact.

#### Prerequisites/Setup
1. Run from the repository root on `main`.
2. Build or use the packaged extension from `pnpm run pack:browser-annotation`.
3. Install the fresh extension artifact in Chrome.
4. Open Codex UI on `main` and start a listener from the target thread through the header feature menu.

#### Steps
1. Run `node extension/browser-annotation/dev/validate-extension.mjs`.
2. Run `node extension/browser-annotation/dev/pairing-client-smoke.mjs`.
3. Run `node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`.
4. Run `node extension/browser-annotation/dev/sidepanel-host-permission-smoke.cjs`.
5. Run `node extension/browser-annotation/dev/content-overlay-cancel-smoke.cjs`.
6. Run `pnpm exec vitest run src/server/browserAnnotationListen.test.ts --reporter=verbose`.
7. Run `pnpm exec vue-tsc --noEmit`.
8. Run `pnpm run pack:browser-annotation`.
9. Inspect `dist/browser-annotation-extension/unpacked/manifest.json` and confirm `host_permissions` is limited to the Codex UI/annotation origins while `optional_host_permissions` contains `http://*/*` and `https://*/*`.
10. In Chrome, open a normal page outside the pairing host, for example `http://46.62.215.111/browser-annotation-test.html`, `https://crm-dev.todo-tg-app.ru/admin/crm?section=pricing`, or `https://example.com`.
11. Click `Inject overlay` in the extension side panel and approve the host access prompt.
12. Select at least one element and confirm it appears in the annotation queue.
13. Click the selected overlay `×` and confirm the highlighted selection disappears and the queued item is removed while annotation mode stays ready for another selection.
14. Select another element, press Esc, and confirm the selected annotation is removed and annotation mode pauses until `Inject overlay` is clicked again.
15. Send the queued annotations and wait for the Codex UI listener status to update.
16. Repeat the side panel, overlay cancel button, and compact listener visual checks in light and dark themes: idle, active with setup collapsed, setup expanded, selected, canceled, and stopped/revoked after send.

#### Expected Results
- Static extension validation and focused listen tests pass.
- The side panel requests host permission for the fresh active tab, not a stale Codex UI tab, before sending the inject message.
- The production package keeps narrow permanent pairing host permissions while allowing runtime access requests for normal `http(s)` sites.
- Chrome asks for access to the current site once; after approval, overlay injection works without adding that host to the manifest or rebuilding the extension.
- The selected overlay includes a visible cancel `×`; clicking it removes the current queued annotation and leaves annotation mode active.
- Pressing Esc removes the current queued annotation and pauses annotation mode.
- Restricted pages such as `chrome://`, `chrome-extension://`, Chrome Web Store, `about:`, `view-source:`, and `devtools://` remain blocked.
- The Codex UI listener is a compact row by default, with server URL and pairing token hidden behind setup details.
- After the extension sends a batch and revokes the listen session, Codex UI can observe `status: revoked` for that session and stop showing an active listener.
- Light and dark compact listener states remain readable.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions` if loaded only for this test.
- Clear site permissions granted to the extension from Chrome extension details if needed.
- Revoke or let expire any listener token used during manual checks.

---

### Thread Not Found Turn Start Recovery

#### Feature/Change Name
Recover from stale selected/resumed thread state before starting a turn.

#### Prerequisites/Setup
1. Run from the repository root.
2. Use a browser profile where Codex UI may have an older `codex-web-local.selected-thread-id.v1` value, or simulate it in localStorage.
3. Have at least one valid thread available in the refreshed thread list.

#### Steps
1. Run `pnpm exec vitest run src/composables/useDesktopState.test.ts --testNamePattern "target thread message sender|thread selection refresh"`.
2. Open Codex UI in light theme, refresh the thread list with localStorage pointing at a missing thread ID, and confirm the app selects an available thread instead of keeping the missing ID.
3. Send a message to an existing thread after an app-server restart or reconnect, where the web UI may still think the thread was already resumed.
4. Confirm the first `turn/start` `thread not found` failure is recovered by a `thread/resume` and one retry.
5. Repeat steps 2-4 in dark theme and confirm the error banner does not appear for the recovered path.

#### Expected Results
- The focused regression tests pass.
- Missing persisted selected thread IDs are replaced with the first available refreshed thread.
- A stale resumed-thread cache does not surface `RPC turn/start failed with HTTP 502: thread not found` when `thread/resume` can reload the thread.
- Light and dark theme views remain readable and do not show the recovered error state.

#### Rollback/Cleanup
- Clear any test-only localStorage values, especially `codex-web-local.selected-thread-id.v1`.
- No generated artifacts are required for this test.

---

### Browser Annotation Test Page Green Sample Action

#### Feature/Change Name
Render the browser annotation test page `Sample action` button as a green action button.

#### Prerequisites/Setup
1. Run from the repository root.
2. Start Codex UI with `pnpm run dev --host 127.0.0.1 --port 4173`, or serve the extension dev directory with `python3 -m http.server`.

#### Steps
1. Open `http://127.0.0.1:4173/browser-annotation-test.html`.
2. Confirm the `Sample action` button inside the sample card has a green background, darker green border, and white label.
3. Hover and press the button to confirm it darkens without resizing or shifting the sample card.
4. Switch the browser or OS to dark theme and reload the same page.
5. Repeat steps 2-3 in dark theme.
6. For the extension dev copy, open `extension/browser-annotation/dev/test-page.html` through the local static server and repeat the light and dark theme checks.

#### Expected Results
- The annotated `Sample action` button is visibly green in both public and extension dev test pages.
- The label remains readable in light and dark themes.
- Hover and active states stay green and do not alter layout.
- Other controls, including `Sample input`, keep their existing neutral styling.

#### Rollback/Cleanup
- Stop any temporary dev or static server started for this check.

---

### Previous Response Diagnostics Noise Filtering

#### Feature/Change Name
Cleaner `previous_response_not_found` diagnostics with structured app-server context.

#### Prerequisites/Setup
1. Run from the repository root.
2. Dependencies are installed.
3. Optional: set `CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG=/tmp/codexui-prev-response.jsonl` to write the diagnostic log outside `output/`.

#### Steps
1. Run `pnpm vitest run src/server/previousResponseDiagnostics.test.ts src/server/unifiedResponsesProxy.test.ts`.
2. Run `pnpm exec tsc --noEmit -p tsconfig.server.json`.
3. Start Codex UI normally and continue using threads until another `previous_response_not_found` failure appears.
4. Inspect `output/previous-response-errors.jsonl` or the configured log path.
5. Confirm new app-server entries are limited to real `method: "error"` and failed `method: "turn/completed"` events.
6. Confirm entries include structured `responseId`, `status`, `threadId`, `turnId`, cached `config`, cached `thread`, and recent RPC context when available.
7. Confirm user messages and command output that merely contain the error text do not create new app-server diagnostic rows.
8. Light and dark theme verification is not applicable because this change has no UI surface.

#### Expected Results
- The focused Vitest files pass.
- The server typecheck passes.
- Diagnostic rows are quieter and more useful for root-cause analysis of stale `previous_response_id` failures.
- Normal UI rendering is unchanged in both light and dark themes.

#### Rollback/Cleanup
- Delete any temporary diagnostic log used for testing, or unset `CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG` to return to the default path.

---

### Turn Start Thread Not Found Diagnostics

#### Feature/Change Name
`turn/start` `thread not found` diagnostic JSONL logging.

#### Prerequisites/Setup
1. Run from the repository root.
2. Dependencies are installed.
3. Optional: set `CODEXUI_THREAD_ERROR_LOG=/tmp/codexui-thread-errors.jsonl` to choose a custom log path. By default the log is written to `output/thread-errors.jsonl`.

#### Steps
1. Run `pnpm vitest run src/server/threadErrorDiagnostics.test.ts src/server/previousResponseDiagnostics.test.ts`.
2. Run `pnpm exec tsc --noEmit -p tsconfig.server.json`.
3. Start Codex UI normally and continue using threads until an error like `RPC turn/start failed with HTTP 502: thread not found: <thread-id>` appears.
4. Inspect `output/thread-errors.jsonl` or the configured log path.
5. Confirm a row with `kind: "turn-start-thread-not-found"` is written and includes `threadId`, `method`, `config`, cached `thread`, recent RPC context, request shape flags, and summarized error text.
6. Confirm this diagnostic does not write prompt text, attachment paths, bearer tokens, or authorization headers.
7. Light and dark theme verification is not applicable because this change has no UI surface.

#### Expected Results
- The focused Vitest files pass.
- The server typecheck passes.
- Future stale-thread `turn/start` failures are captured separately from `previous_response_id` failures.
- Normal UI rendering is unchanged in both light and dark themes.

#### Rollback/Cleanup
- Delete any temporary diagnostic log used for testing, or unset `CODEXUI_THREAD_ERROR_LOG` to return to the default path.

---

### Browser Annotation Test Page Sample Card Heading Font

#### Feature/Change Name
Render the browser annotation test page `Sample card` heading with a more decorative readable font.

#### Prerequisites/Setup
1. Run from the repository root.
2. Start Codex UI with `pnpm run dev --host 127.0.0.1 --port 4173`, or serve the extension dev directory with `python3 -m http.server`.

#### Steps
1. Open `http://127.0.0.1:4173/browser-annotation-test.html`.
2. Confirm the `Sample card` heading inside the sample card uses a serif display-style font, larger size, and tighter spacing than the body text.
3. Confirm the heading does not overlap the paragraph below it or change the selected annotation target.
4. Switch the browser or OS to dark theme and reload the same page.
5. Repeat steps 2-3 in dark theme.
6. For the extension dev copy, open `extension/browser-annotation/dev/test-page.html` through the local static server and repeat the light and dark theme checks.

#### Expected Results
- The annotated `Sample card` heading is visually distinct and more decorative in both public and extension dev test pages.
- The heading remains readable in light and dark themes.
- The sample card layout remains stable, with the paragraph and green action button still visible and aligned.

#### Rollback/Cleanup
- Stop any temporary dev or static server started for this check.

---

### Compact Browser Annotation Listen Control

#### Feature/Change Name
Move browser annotation listening from the composer row into the shared thread feature menu and sidebar settings.

#### Prerequisites/Setup
1. Run from the repository root.
2. Start Codex UI with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Open an existing thread that can receive browser annotation batches.

#### Steps
1. Open the selected thread in light theme.
2. Confirm the previous wide `Listen for browser annotations` banner is not shown above the composer.
3. Confirm there is no standalone `Listen` button in the composer action row.
4. Click the top header thread feature menu button with the three-dot icon.
5. Confirm the dropdown contains `Side` and `Listen`.
6. Click `Listen` and confirm it starts a listener for the selected thread without resizing the composer.
7. Reopen the feature menu and confirm the listener row shows an active/busy state while appropriate.
8. Open the sidebar `Settings` popup, click `Listen settings`, and confirm the listener status, thread, expiry, setup disclosure, server URL, and pairing token controls are available.
9. Use the setup disclosure and copy controls, then click `Stop` from `Listen settings`.
10. Switch to dark theme and repeat steps 2-9.

#### Expected Results
- The thread no longer loses vertical space to a persistent listen banner.
- Thread features are grouped under one top header menu instead of separate header/composer buttons.
- The composer microphone and send controls keep their alignment after the standalone `Listen` button is removed.
- Active, busy, stopped, expired, and error states are reflected in the sidebar `Listen settings` section.
- The feature menu trigger, dropdown, statuses, and menu items remain readable in light and dark themes.
- Server URL and pairing token copy controls remain readable and usable in both themes.

#### Rollback/Cleanup
- Stop any active browser annotation listener before leaving the test thread.
- No generated artifacts are required for this test.

---

### Thread Feature Menu For Side And Listen

#### Feature/Change Name
Group thread-level feature actions under a single three-dot header menu.

#### Prerequisites/Setup
1. Run from the repository root.
2. Start Codex UI with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Open an existing thread in light theme.

#### Steps
1. Confirm the content header shows one circular three-dot feature menu button.
2. Confirm there is no standalone `Side` button in the header and no standalone `Listen` button in the composer.
3. Open the feature menu and confirm it lists `Side` and `Listen`.
4. Click outside the menu and confirm it closes.
5. Reopen the menu, press Escape, and confirm it closes.
6. Reopen the menu and click `Side`; confirm the Side panel opens and the feature menu trigger indicates an active feature.
7. Close Side, reopen the feature menu, click `Listen`, and confirm listener state is visible in `Settings` > `Listen settings`.
8. Stop the listener from `Listen settings`.
9. Repeat steps 1-8 in dark theme.
10. Repeat steps 1-5 at mobile width and confirm the menu fits without clipping or overlapping the branch/terminal controls.

#### Expected Results
- Thread features are discoverable from a single header menu.
- Side Chat and browser annotation listener behavior remain unchanged after moving their entry points.
- The menu closes on outside click, Escape, and after selecting an action.
- Light and dark theme menu surfaces, active states, disabled states, and status pills are readable.
- The composer action row remains stable after removing the standalone `Listen` button.

#### Rollback/Cleanup
- Stop any active browser annotation listener.
- Close the Side panel before leaving the thread.

---

### Side Chat Ephemeral Thread Panel

#### Feature/Change Name
One-off Side Chat opened from the active thread with `/side` or the shared thread feature menu.

#### Prerequisites/Setup
1. Run the app from the repository root with a Codex CLI/app-server version that supports `thread/fork` with `ephemeral: true`.
2. Open an existing thread with enough context to ask a follow-up question.
3. Keep the main thread visible so message pollution can be checked.

#### Steps
1. In light theme, open an existing thread, click the three-dot thread feature menu in the content header, then click `Side`.
2. Confirm a right-side panel appears on desktop, or a stacked bottom panel appears on narrow/mobile layout.
3. Type a short question in the Side composer and send it.
4. Confirm the side question and response render inside the Side panel while the main transcript does not receive the side question or side answer.
5. Send `/side quick context question` from the main composer.
6. Confirm the Side panel opens, the argument text is sent to Side Chat, and the selected main thread remains selected.
7. Trigger or mock a side-thread request that uses `item/tool/requestUserInput` or an approval method.
8. Confirm the pending request appears inside the Side panel and that responding continues the side thread.
9. Close the Side panel and confirm the main thread selection, main messages, terminal panel state, and review mode state remain unchanged.
10. Repeat steps 1-9 in dark theme and confirm the feature menu, Side panel, messages, pending request panel, input, and send/close buttons use dark-theme surfaces without light panels.
11. With an older backend that rejects `ephemeral` fork parameters, choose `Side` from the feature menu and confirm the UI shows a clear error instead of sending the question to the main thread.

#### Expected Results
- Opening Side Chat calls the side fork path and does not navigate to another thread.
- Side messages, live status, reasoning text, and server requests are isolated to the side panel.
- Main-thread sending, queueing, terminal controls, review mode, and pending requests continue to behave as before.
- Closing Side Chat clears the temporary side UI only.
- Unsupported ephemeral fork behavior is explicit and safe.
- Light and dark theme layouts are readable and intentional on desktop and mobile widths.

#### Rollback/Cleanup
- Close the Side panel. Ephemeral side thread UI state is temporary and should not appear in the sidebar as a normal persisted thread.

---

### Side Chat One-Off Thread Panel

#### Feature/Change Name
Temporary `/side` chat panel for questions against the active thread context.

#### Prerequisites/Setup
1. Run the app locally and open an existing thread.
2. Use a Codex app-server build that supports ephemeral `thread/fork` requests.
3. Keep a second ordinary thread available for checking that main-thread selection is unchanged.

#### Steps
1. In light theme, open an existing thread, click the three-dot thread feature menu in the content header, then click `Side`.
2. Confirm a right-side Side panel opens beside the main conversation, with the main composer still below the main thread.
3. Type a short question in the Side panel and send it.
4. Confirm the side message and live answer appear only in the Side panel and do not append to the main transcript.
5. Trigger `/side <question>` from the main composer and confirm the Side panel opens and sends the text there.
6. If Codex requests approval or input from the side turn, confirm the request appears inside the Side panel and responses continue the side turn.
7. Close the Side panel and confirm the selected main thread, its messages, and its composer draft remain intact.
8. Repeat steps 1-7 in dark theme and confirm the feature menu, side panel, messages, request panel, and composer all use dark colors without light-theme surfaces.
9. On a narrow viewport, confirm the Side panel stacks below the main conversation instead of overlapping the composer.
10. Run `pnpm exec vitest run src/codexSlashCommands.test.ts src/api/codexGateway.test.ts src/composables/useDesktopState.test.ts --reporter=verbose`.
11. Run `pnpm run build`.

#### Expected Results
- Side Chat opens from the shared thread feature menu or `/side`.
- Side turns use an ephemeral fork and main-thread messages remain unpolluted.
- Unsupported ephemeral fork behavior surfaces as a visible error instead of falling back to the main thread.
- Closing Side Chat clears the temporary side surface without changing the selected main thread.
- Light and dark theme surfaces are readable and consistent.

#### Rollback/Cleanup
- Close the Side panel. The first release treats Side Chat as temporary one-off state, so no side thread is intentionally persisted in the UI.

---

### Side Chat Real Answer Regression

#### Feature/Change Name
Side Chat keeps the side answer visible after the ephemeral side turn completes.

#### Prerequisites/Setup
1. Run the merged main worktree on a non-production port:
   `pnpm run dev --host 127.0.0.1 --port 4174`
2. Open a real existing thread with enough context for a follow-up question.
3. Keep the main thread selected while the Side panel is open.

#### Steps
1. In light theme, run:
   `BASE_URL=http://127.0.0.1:4174 SIDE_CHAT_TIMEOUT_MS=180000 node scripts/side-chat-real-behavior.cjs`
2. Confirm the script opens the configured real thread, clicks `Side`, sends a side-only question, and waits for both a non-empty Codex answer and a completed `Worked for ...` side-turn summary.
3. Confirm the screenshot at `output/playwright/side-chat-real-behavior-pass.png` shows the assistant answer in the Side panel and no side question/answer appended to the main transcript.
4. Confirm `output/playwright/side-chat-real-behavior-log.json` reports `fetchErrors: []` and at least one `turn/completed` websocket notification.
5. In dark theme, run:
   `BASE_URL=http://127.0.0.1:4174 SIDE_CHAT_TIMEOUT_MS=180000 SIDE_CHAT_DARK=1 node scripts/side-chat-real-behavior.cjs`
6. Confirm the dark screenshot at `output/playwright/side-chat-real-behavior-dark.png` shows the answer and completed summary without light-theme surfaces.
7. Confirm the dev-server log does not emit `[thread-title] Automatic title generation failed` for the ephemeral side thread after the side turn completes.
8. Run the focused unit regression:
   `pnpm exec vitest run src/server/threadAutoTitle.test.ts src/composables/useDesktopState.test.ts src/api/codexGateway.test.ts src/codexSlashCommands.test.ts --reporter=verbose`

#### Expected Results
- The Playwright script exits successfully and prints the side answer, `Worked for ...`, and screenshot path.
- The Playwright log reports no `/codex-api` 4xx/5xx responses.
- The Side panel shows the assistant answer from the main thread context after `turn/completed`.
- The Side panel no longer stays stuck on `Thinking` after side-thread notification sync or completed live deltas.
- Ephemeral side turns do not trigger automatic title-generation retries or warnings.
- Main-thread selection and transcript remain unchanged by the side turn.
- Light and dark theme side surfaces remain readable while the answer is visible.

#### Rollback/Cleanup
- Stop the temporary `4174` dev server after verification.
- Close the Side panel. Ephemeral side thread UI state remains temporary.

---

### Side Chat Voice Dictation Regression

#### Feature/Change Name
Mic/stop dictation in the Side Chat composer transcribes speech and auto-sends it only to the side thread.

#### Prerequisites/Setup
1. Run the merged main worktree on a non-production port:
   `pnpm run dev --host 127.0.0.1 --port 4174`
2. Open a real existing thread with enough context for a follow-up question.
3. Use a browser profile that allows microphone access, or run the mocked Playwright script below.

#### Steps
1. In light theme, open Side Chat from the header feature menu.
2. Confirm a microphone button appears beside the Side composer send button.
3. Click the microphone button and confirm it changes to a stop control with a compact recording status.
4. Speak a short side-only question.
5. Click stop and confirm the recording transcribes, auto-sends, and produces a Side Chat response.
6. Confirm the main transcript and main composer do not receive the dictated side question.
7. Repeat steps 1-6 in dark theme and confirm the mic, stop, spinner, status text, input, and send button use dark-theme surfaces.
8. Run the mocked light Playwright regression:
   `BASE_URL=http://127.0.0.1:4174 SIDE_CHAT_MOCK_TURN=1 node scripts/side-chat-voice-dictation.cjs`
9. Run the mocked dark Playwright regression:
   `BASE_URL=http://127.0.0.1:4174 SIDE_CHAT_MOCK_TURN=1 SIDE_CHAT_DARK=1 node scripts/side-chat-voice-dictation.cjs`

#### Expected Results
- Stop triggers `/codex-api/transcribe` and the returned transcript is submitted through the existing Side Chat send path.
- The voice transcript starts a turn against the ephemeral side thread, not the selected main thread.
- The side turn payload contains the dictated user message, and the Side panel renders that question as a right-aligned user bubble while the main transcript remains unchanged.
- The completed `Worked for ...` side summary renders as a compact separator row, not a separate Codex message card.
- The send button stays disabled while recording/transcribing, preventing duplicate sends.
- Screenshots are written to `output/playwright/side-chat-voice-dictation-light.png` and `output/playwright/side-chat-voice-dictation-dark.png`.

#### Rollback/Cleanup
- Close the Side panel after testing.
- Stop the temporary `4174` dev server.

---

### Side Chat Layout and Feature Menu Toggle Regression

#### Feature/Change Name
Side Chat feature menu toggle, stable thread layout width, and compact side transcript rendering.

#### Prerequisites/Setup
1. Run the app on a non-production port:
   `pnpm run dev --host 127.0.0.1 --port 4174`
2. Open a real thread with long plan, command, or reasoning output.

#### Steps
1. In light theme, open a thread and let a live response render plan, command, or reasoning blocks.
2. Confirm the main conversation remains pinned within the content column and no horizontal page shift appears.
3. Open the header feature menu and click `Side`.
4. Confirm the Side panel opens and the main conversation shrinks without horizontal overflow.
5. Open the header feature menu again and click `Side`.
6. Confirm the Side panel closes.
7. Re-open Side, send a typed or dictated side question, and wait for completion.
8. Confirm the side question is visible as a user bubble and the `Worked for ...` summary is a compact row.
9. Repeat the same checks in dark theme.

#### Expected Results
- Long live blocks cannot expand the thread beyond the viewport.
- The Side menu item toggles the panel open and closed.
- Side Chat user messages remain visible until the panel is closed or the side thread is replaced.
- Side `Worked for ...` appears as a compact separator row in light and dark theme.

#### Rollback/Cleanup
- Close the Side panel.
- Stop the temporary `4174` dev server.

---

### Codex LB Previous Response Recovery Regression

#### Feature/Change Name
Codex LB local Responses proxy is opt-in and recovers once from stale previous-response errors when enabled.

#### Prerequisites/Setup
1. `~/.codex/config.toml` has active `model_provider = "codex-lb"` with `wire_api = "responses"`.
2. `CODEX_LB_API_KEY` is available if the configured provider uses `env_key = "CODEX_LB_API_KEY"`.
3. Optional: set `CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG` to a temporary JSONL path when manually inspecting diagnostics.

#### Steps
1. Start Codex UI normally and open an existing long/tool-heavy thread.
2. Start Codex UI without `CODEXUI_CODEX_LB_PROXY` and confirm the spawned app-server keeps the configured `codex-lb` base URL instead of receiving a local proxy override.
3. Optionally set `CODEXUI_CODEX_LB_PROXY=1`, restart Codex UI, and confirm the spawned app-server receives the runtime override:
   `model_providers.codex-lb.base_url="http://127.0.0.1:<port>/codex-api/codex-lb-proxy/v1"`.
4. Trigger a normal turn and confirm it completes through the `codex-lb` provider.
5. With `CODEXUI_CODEX_LB_PROXY=1`, in light theme keep working in the thread until a provider stale-response condition would previously have surfaced as `previous_response_not_found`.
6. Confirm the turn continues after a single local proxy retry instead of surfacing the raw provider error in chat.
7. In dark theme, repeat a normal `codex-lb` turn and confirm no light-theme UI regression appears around the composer, activity row, or error surface.
8. Run the focused server regression:
   `pnpm exec vitest run src/server/codexLbProxy.test.ts src/server/unifiedResponsesProxy.test.ts src/server/previousResponseDiagnostics.test.ts --reporter=verbose`

#### Expected Results
- Codex UI does not rewrite `~/.codex/config.toml`; the local proxy override is app-server runtime only and only appears when `CODEXUI_CODEX_LB_PROXY=1`.
- By default, `codex-lb` turns keep the configured upstream path and do not route through the local proxy.
- When enabled, the local route `/codex-api/codex-lb-proxy/v1/responses` forwards bearer auth to the configured upstream `base_url`.
- A matching upstream `previous_response_not_found` response is retried once without `previous_response_id` when `input` is present.
- Retry diagnostics are written with `phase: "retry-started"` and `phase: "retry-finished"` rows.
- Light and dark themes remain unchanged because the fix is server-side and does not introduce new UI.

#### Rollback/Cleanup
- Unset `CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG` if it was used.
- Unset `CODEXUI_CODEX_LB_PROXY` and restart Codex UI to return to the default direct `codex-lb` route.

---

### Browser Annotation Inline Area Comments And Compact Sidepanel

#### Feature/Change Name
Arbitrary area annotation, inline comment/dictation controls, and compact tabbed extension side panel.

#### Prerequisites/Setup
1. Run from the repository root.
2. Chrome/Playwright dependencies are installed through the repository `node_modules`.
3. For manual extension checks, load `extension/browser-annotation` or `dist/browser-annotation-extension/unpacked` in Chrome.
4. For a connected send check, create a fresh browser annotation pairing token in Codex UI.

#### Steps
1. Run `node --check extension/browser-annotation/content/content-script.js`.
2. Run `node --check extension/browser-annotation/sidepanel/sidepanel.js`.
3. Run `node extension/browser-annotation/dev/content-overlay-cancel-smoke.cjs`.
4. Run `node extension/browser-annotation/dev/sidepanel-host-permission-smoke.cjs`.
5. Run `node extension/browser-annotation/dev/selection-context-smoke.mjs`.
6. Run `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`.
7. Run `node extension/browser-annotation/dev/screenshot-crop-smoke.mjs`.
8. Run `pnpm run pack:browser-annotation`.
9. In light theme, open an http(s) test page, click `Inject Overlay`, click a specific element, and confirm the green selection plus compact inline `close`, `Chat`, and `Mic` controls appear beside the selection.
10. Click `Chat`, type a short comment, and confirm the side-panel queue item keeps a short visual label without selector/xpath text.
11. Drag across a blank/custom part of the page and confirm a freeform rectangular area is queued.
12. Press `Esc` after a selection and confirm the selected queue item is removed and page interaction resumes.
13. In dark theme, repeat steps 9-12 and confirm the overlay, side panel tabs, compact queue, DevTools controls, and help/settings panels remain readable.
14. In the side panel, confirm `Server URL` and `Pairing token` live under `Settings`, and the Russian help copy lives under `Help`.

#### Expected Results
- Static checks and Playwright smokes pass.
- Element click selection still queues a normal element context.
- Drag selection queues an area context with bounded viewport `rect` and continues to use the existing crop/queue pipeline.
- Inline comment text saves through `browserAnnotation.updateAnnotationQueueItem`.
- `Mic` records inline audio and sends it to the Codex UI server transcription endpoint; unsupported browsers show a compact inline status.
- The queue no longer renders long CSS selector/xpath/div-path text, note textareas, or old record/stop/cancel voice controls.
- Light and dark side-panel surfaces do not wrap words letter-by-letter or overflow the narrow panel.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions`.
- Clear extension local/session storage if test queue items or pairing tokens should be removed.
- Stop any temporary dev server used for manual checks.

---

### Composer Dictation Active Recording Cancel

#### Feature/Change Name
Main composer active dictation cancel button.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Start the dev server with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Open an existing thread and allow microphone access.
4. Keep browser DevTools Network visible if you want to confirm no transcription request is made on cancel.

#### Steps
1. In light theme, type a short prefix in the composer and optionally attach an image or select a skill.
2. Start dictation and confirm the active recording controls show the cancel `X` on the far left, then waveform, timer, pause, draft-transcribe, and stop buttons.
3. Click the cancel `X` button while recording.
4. Confirm the composer returns to the normal idle controls.
5. Confirm the typed draft, attachments, and selected skills remain unchanged.
6. Confirm no message is sent, no transcribing status appears, and no `/codex-api/transcribe` request or background dictation job is created.
7. Start dictation again, click pause, then click cancel, and confirm the same idle/no-transcription result.
8. Start dictation once more and click the red stop button; confirm the existing transcription or background auto-send behavior still works.
9. Switch to dark theme and repeat steps 2-7, confirming the cancel button, timer, waveform, pause, draft-transcribe, and stop controls are readable and do not overlap.

#### Expected Results
- Cancel discards only the active recording and returns the composer to idle without storing or transcribing audio.
- Hold-to-dictate cleanup does not trigger a late stop/transcription after cancel.
- Existing stop and draft-transcribe controls still submit recordings for transcription.
- A stale failed background dictation status is hidden after a newer successful dictation job completes for the same thread.
- Light and dark theme active recording controls remain aligned and readable.

#### Rollback/Cleanup
- Delete any test messages produced by the final stop/transcription check.
- Remove any temporary attachments or draft text left in the composer.

---

### OpenAI Mini Transcription Provider For Composer Dictation

#### Feature/Change Name
Composer dictation uses the OpenAI API-key transcription path with `gpt-4o-mini-transcribe`.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Configure server-side transcription env with `CODEXUI_TRANSCRIBE_PROVIDER=openai`, `CODEXUI_TRANSCRIBE_API_KEY` or `OPENAI_API_KEY`, and `CODEXUI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe`.
3. Restart the Codex UI server after env changes.
4. Open an existing thread and allow microphone access.

#### Steps
1. Run `node scripts/test-codexui-transcription-override.mjs`.
2. In light theme, start composer dictation, speak a short phrase, and click the red stop button.
3. Confirm the phrase transcribes and sends or inserts according to the current dictation setting.
4. Confirm server/network logs show `/codex-api/transcribe` using the API-key provider path rather than a ChatGPT auth-token failure.
5. Switch to dark theme and repeat the dictation stop/transcription check.

#### Expected Results
- The override smoke test passes and asserts the OpenAI provider sends `gpt-4o-mini-transcribe`.
- Composer dictation no longer fails with an expired ChatGPT authentication token when OpenAI API-key transcription is configured.
- Light and dark theme dictation controls remain readable while recording, transcribing, and returning to idle.

#### Rollback/Cleanup
- Restore `CODEXUI_TRANSCRIBE_PROVIDER=standard` to return to the built-in Codex/ChatGPT transcription path.
- Delete any test messages created during manual dictation checks.

---

### Composer Dictation Waveform Responds To Quiet Mobile Input

#### Feature/Change Name
Main composer dictation waveform level normalization for quiet PWA microphone input.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Start the dev server with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Open the app from a browser or installed PWA with microphone permission allowed.
4. Use a project/thread where composer dictation is available.

#### Steps
1. Run `pnpm exec vitest run src/composables/useDictation.test.ts`.
2. In light theme, start dictation from the main composer.
3. Speak at a normal phone/PWA distance and confirm the waveform bars change height instead of staying as a flat dotted line.
4. Stop speaking briefly and confirm the waveform returns to the low muted baseline.
5. Pause dictation and confirm the last waveform remains dimmed and the timer stops increasing.
6. Resume dictation, speak again, and confirm the bars animate again.
7. Stop dictation and confirm transcription or background auto-send still follows the existing configured behavior.
8. Switch to dark theme and repeat steps 2-7, confirming the waveform, timer, pause, draft-transcribe, stop, and reasoning-effort controls remain readable and aligned.

#### Expected Results
- The focused unit test passes and covers silence, quiet microphone levels, and loud input capping.
- Quiet but valid microphone input produces visible waveform variation while near-silence remains visually subdued.
- Dictation recording, pause/resume, draft transcription, stop/transcription, and background auto-send behavior remain unchanged.
- Light and dark theme active recording controls remain aligned, readable, and free of overlap.

#### Rollback/Cleanup
- Delete any test messages produced by the final stop/transcription check.
- Remove any temporary draft text or attachments left in the composer.

---

### Browser Annotation Persistent Binding, Server Transcription, And Page-State Queue

#### Feature/Change Name
Long-lived extension binding, inline OpenAI transcription through the server, full Escape cleanup, and DevTools-only page-state annotations.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. For manual transcription checks, configure server-side `OPENAI_API_KEY` and `CODEXUI_ANNOTATION_TRANSCRIBE_MODEL`; do not put an OpenAI API key into the extension.
3. Load `extension/browser-annotation` or `dist/browser-annotation-extension/unpacked` in Chrome.
4. Open a Codex UI thread and create a browser annotation pairing token once.

#### Steps
1. Run `node extension/browser-annotation/dev/pairing-client-smoke.mjs`.
2. Run `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`.
3. Run `node extension/browser-annotation/dev/content-overlay-cancel-smoke.cjs`.
4. Run `node extension/browser-annotation/dev/sidepanel-host-permission-smoke.cjs`.
5. Run `node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`.
6. Run `pnpm exec vitest run src/server/browserAnnotationListen.test.ts src/api/codexGateway.test.ts --reporter=verbose`.
7. Run `pnpm exec vitest run src/server/browserAnnotationBatch.test.ts src/server/browserAnnotationAssets.test.ts src/server/browserAnnotationTranscribe.test.ts --reporter=verbose`.
8. In light theme, paste the pairing token in extension Settings, click save, and confirm Settings shows a persistent binding while the pairing input clears.
9. Select an element, click the inline mic button, speak Russian, stop recording, and confirm the transcript is inserted into that selected item's inline comment.
10. Add two selected comments with separate mic recordings and confirm each transcript lands on its own selected item.
11. Press `Esc` while the idle overlay or a selection toolbar is visible and confirm the overlay host disappears and the next page click does not queue anything until `Inject Overlay` is clicked again.
12. Enable DevTools capture without injecting overlay, type a Page note, click `Add page note`, and send the queue.
13. In dark theme, repeat steps 8-12 and confirm the Settings binding state, page-note queue item, inline toolbar, and Russian help tab stay readable.

#### Expected Results
- The extension stores only a scoped persistent Codex UI binding token; OpenAI credentials remain server-side.
- `/listen/bind` exchanges a short pairing token for a revocable long-lived extension token, and `Send Queue` no longer disconnects that binding.
- Inline mic transcription uses `/codex-api/extension/transcribe` with `itemId` plus `recordingToken`, so multiple queued recordings do not cross-apply.
- Page-state queue items can be sent with DevTools console/network context and without selecting a DOM element or injecting overlay.
- Playwright screenshots are written under `output/playwright/` for light and dark overlay/page-state checks.

#### Rollback/Cleanup
- Click `Disconnect` in extension Settings to revoke the persistent binding.
- Clear extension local/session storage if test queue items remain.
- Unset temporary transcription environment variables after testing.

---

### Browser Annotation Voice Codec Transcription And Renewing Binding

#### Feature/Change Name
Inline mic transcription for `audio/webm;codecs=opus`, default server transcription model, and sliding long-lived extension binding.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. For manual transcription checks, configure server-side `OPENAI_API_KEY`; `CODEXUI_ANNOTATION_TRANSCRIBE_MODEL` is optional and defaults to `gpt-4o-mini-transcribe`.
3. Load `extension/browser-annotation` or `dist/browser-annotation-extension/unpacked` in Chrome.
4. Create one browser annotation pairing token in Codex UI and bind the extension once.

#### Steps
1. Run `node --check extension/browser-annotation/service-worker/service-worker.js`.
2. Run `node --check extension/browser-annotation/content/content-script.js`.
3. Run `node --check scripts/test-codexui-annotation-transcription-env.mjs`.
4. Run `node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`.
5. Run `node extension/browser-annotation/dev/content-overlay-cancel-smoke.cjs`.
6. Run `node scripts/test-codexui-annotation-transcription-env.mjs`.
7. Run `pnpm exec vitest run src/server/browserAnnotationListen.test.ts src/server/browserAnnotationTranscribe.test.ts --reporter=verbose`.
8. In light theme, select an element, click the inline mic button, speak Russian, stop recording, and confirm the transcript is inserted into that selected item's inline comment.
9. Add a second selected item, record a second voice comment, and confirm the transcript is applied only to the second item.
10. In extension Settings, refresh status after sending the queue and confirm the binding remains connected without pasting a new token.
11. In dark theme, repeat steps 8-10 and confirm recording, transcribing, transcript-added, and transcription-error statuses remain readable beside the selection.

#### Expected Results
- `data:audio/webm;codecs=opus;base64,...` is accepted by the service worker and uploaded to `/codex-api/extension/transcribe` as `audio/webm`.
- A failed transcription shows a visible inline error beside the selected annotation instead of failing silently.
- The OpenAI API key remains server-side; the extension never stores it.
- The extension binding token remains the same token and its expiry slides forward on authorized requests.
- Light and dark overlay states stay compact and readable while recording and after transcript insertion.

#### Rollback/Cleanup
- Click `Disconnect` in extension Settings to revoke the persistent binding if the manual token should be retired.
- Clear extension local/session storage if test queue items remain.
- Unset temporary transcription environment variables after testing.

---

### Codex LB Web Reply Recovery And Side Chat E2E

#### Feature/Change Name
Web replies recover after disabling automatic `codex-lb` local proxy routing and updating the Side Chat E2E completion selector.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Start the app on the test port without `CODEXUI_CODEX_LB_PROXY`:
   `pnpm run dev --host 127.0.0.1 --port 4173`
3. Use an existing `codex-lb` thread that can start a Side Chat turn.

#### Steps
1. Run the focused unit tests:
   `pnpm exec vitest run src/server/codexLbProxy.test.ts src/server/unifiedResponsesProxy.test.ts`
2. In light theme, run:
   `BASE_URL=http://127.0.0.1:4173 SIDE_CHAT_TIMEOUT_MS=240000 node scripts/side-chat-real-behavior.cjs`
3. Confirm the JSON output reports `ok: true`, a non-empty `answer`, a `workedSummary` beginning with `Worked for`, a non-empty `sentSideThreadId`, and `turnCompletedStatus: "completed"`.
4. In dark theme, run:
   `BASE_URL=http://127.0.0.1:4173 SIDE_CHAT_DARK=1 SIDE_CHAT_TIMEOUT_MS=240000 node scripts/side-chat-real-behavior.cjs`
5. Confirm the dark run also reports `ok: true`, a non-empty `answer`, a `Worked for` summary, a non-empty `sentSideThreadId`, and `turnCompletedStatus: "completed"`.
6. Inspect the screenshots:
   `output/playwright/side-chat-real-behavior-pass.png` and `output/playwright/side-chat-real-behavior-dark.png`.

#### Expected Results
- `codex-lb` direct routing remains the default, so web replies stream and complete without `CODEXUI_CODEX_LB_PROXY`.
- The optional local proxy is only enabled with `CODEXUI_CODEX_LB_PROXY=1`.
- Side Chat renders assistant text and recognizes the compact `.side-chat-worked-text` completion row in both light and dark themes.
- The E2E output contains `fetchErrors: []`, a completed side thread turn, and fails if a websocket `error` or `systemError` appears after send.

#### Rollback/Cleanup
- Stop the temporary `4173` dev server when testing is complete.
- Remove `CODEXUI_CODEX_LB_PROXY` from the environment unless explicitly testing the opt-in proxy path.

---

### Assistant Voice/TTS Removal

#### Feature/Change Name
Assistant voice/TTS playback mode has been removed from the thread UI and server API.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Start or confirm the app server on `http://127.0.0.1:4173`:
   `pnpm run dev --host 127.0.0.1 --port 4173`
3. Have at least one completed assistant response visible in a thread.

#### Steps
1. Run the frontend type/build check:
   `pnpm run build:frontend`
2. Search the repository for removed voice/TTS code:
   `rg -n "voice/speech|gpt-4o-mini-tts|useVoicePlayback|Play voice|Voice mode|Resume audio" src scripts tests.md llm-wiki || true`
3. In light theme, open a thread and open the header kebab menu.
4. Confirm the menu only shows the non-TTS thread features such as `Side` and `Listen`; there is no `Play`, `Mode`, `Resume`, `Stop`, or speed slider for TTS playback.
5. Confirm completed assistant messages do not show any voice playback toolbar action.
6. Switch to dark theme and repeat steps 3-5.
7. Optionally call `POST /codex-api/voice/speech` and confirm there is no dedicated TTS route.

#### Expected Results
- No assistant TTS playback UI is visible in light or dark theme.
- No OpenAI TTS request path, server route, playback composable, or E2E voice script remains.
- Existing dictation/listen behavior and unrelated realtime slash-command text are unchanged.

#### Rollback/Cleanup
- Stop the temporary `4173` dev server when testing is complete.

---

### Previous Response Auto-Continue Watcher

#### Feature/Change Name
The chat UI automatically sends a guarded continuation message after a surfaced `previous_response_not_found` error.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Use a thread that can reproduce or simulate a provider stale-response error.
3. Light and dark themes are available from Settings.

#### Steps
1. Run the focused unit tests:
   `pnpm exec vitest run src/api/previousResponseErrors.test.ts src/api/codexErrors.test.ts src/composables/useDesktopState.test.ts --reporter=verbose`
2. In light theme, trigger a `previous_response_not_found` failure in an active thread.
3. Confirm the UI sends one ordinary user message to the same thread with text beginning `У нас была ошибка`.
4. Confirm the message asks Codex to continue from where it stopped and includes the surfaced provider error text.
5. Trigger or replay the same `resp_*` error signature again and confirm no duplicate auto-continue message is sent.
6. Trigger an unrelated error such as `thread not found` or `rate_limit_exceeded` and confirm no auto-continue message is sent.
7. Repeat steps 2-6 in dark theme and confirm the existing error/composer surfaces remain readable.

#### Expected Results
- Only `previous_response_not_found` and equivalent nested/stringified provider payloads trigger the watcher.
- The auto-continue message is sent through the normal thread message path, so Codex sees it as a regular user instruction.
- The watcher dedupes by `resp_*` when available and keeps a per-thread attempt guard to avoid loops.
- A successful later turn clears the per-thread attempt guard so future independent stale-response failures can be resurrected.
- Light and dark themes are unchanged because the patch adds behavior, not new visual components.

#### Rollback/Cleanup
- Reload the page to clear in-memory watcher dedupe state.

---

### MCP Runtime Activity And Server Metadata

#### Feature/Change Name
MCP runtime rows show active work instead of completed clutter, MCP history rows are compact and expandable, Directory Hub reads richer `serverInfo`, and app-server launches with `--stdio` when supported.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Start or confirm the app server on `http://127.0.0.1:4173`:
   `pnpm run dev --host 127.0.0.1 --port 4173`
3. Use a Codex CLI version that supports MCP tool calls. To verify richer metadata, prefer Codex CLI `0.136.0` or newer.
4. Configure at least one MCP server with multiple tools. For fallback testing, optionally test once with an older Codex CLI that does not accept `codex app-server --stdio`.

#### Steps
1. Run the focused tests:
   `pnpm exec vitest run src/composables/useDesktopState.test.ts src/api/codexGateway.test.ts src/api/normalizers/v2.test.ts src/server/codexAppServerBridge.stdioFallback.test.ts src/server/freeMode.test.ts src/server/codexLbProxy.test.ts`
2. Run the frontend type/build check:
   `pnpm run build:frontend`
3. In light theme, start a turn that performs several MCP tool calls, including at least one still-running or waiting request.
4. Confirm the composer runtime panel shows only active MCP rows (`failed`, `waiting`, `running`) and aggregates completed calls as a done count instead of rendering each completed row.
5. Confirm failed MCP rows sort above waiting/running rows and remain visible while the turn is active.
6. After the turn completes, inspect the thread history and expand an MCP row. Confirm it shows server, tool, status/duration, error text when present, and raw JSON only inside the expanded area.
7. Open Directory Hub > MCP in light theme and confirm servers with `serverInfo` show title/description/version/website/icon metadata when available, while older servers still show the config name and tool/resource counts.
8. Repeat steps 3-7 in dark theme and confirm the composer panel, MCP history row, expanded raw payload, and Directory Hub MCP metadata remain readable without light surfaces on dark backgrounds.
9. Restart the dev server with a Codex CLI that supports `--stdio` and confirm app-server starts normally. If testing an older CLI, confirm startup retries without `--stdio` and still initializes.

#### Expected Results
- Composer MCP activity reads as current operational state, not an event log: completed calls are counted, not listed.
- MCP history rows preserve diagnostic access without flooding the conversation.
- Directory Hub gracefully consumes `serverInfo`/`server_info` when present and remains compatible with older app-server responses.
- `codex app-server --stdio` is preferred for new CLI versions, with one fallback retry for older CLI versions.
- Light and dark themes both keep MCP runtime, history, and Directory Hub metadata legible.

#### Rollback/Cleanup
- Stop the temporary `4173` dev server when testing is complete.
- Revert to the previous Codex CLI binary if you temporarily swapped versions for fallback testing.

---

### Sub-Agent Runtime Rows And Detail Drawer

#### Feature/Change Name
Sub-agent runtime rows remain visible for the active turn, restore after parent-thread realtime gaps, and open an inline detail drawer with compact agent history.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Start or confirm the app server on `http://127.0.0.1:4173`:
   `pnpm run dev --host 127.0.0.1 --port 4173`
3. Use a Codex CLI/app-server version with collaboration mode and sub-agent events enabled.

#### Steps
1. Run the focused tests:
   `pnpm exec vitest run src/composables/useDesktopState.test.ts src/api/normalizers/v2.test.ts`
2. Run the frontend type/build check:
   `pnpm run build:frontend`
3. Run the end-to-end Playwright check:
   `node scripts/e2e-agent-runtime-panel.cjs`
4. In light theme, start a new thread from a project and send a prompt in Plan mode that asks Codex to launch sub-agents.
5. Confirm the runtime panel stays on the newly created thread, shows at least one sub-agent row with name and current task/status, and does not jump back to the previously selected thread.
6. Click a sub-agent row and confirm the inline detail drawer opens with Status, Latest, and Reasoning sections. If commands or changed paths were observed, confirm they appear as compact lists.
7. Switch to dark theme and repeat the click/open check. Confirm the row, drawer, code chips, and focus outline remain readable without light-theme surfaces.

#### Expected Results
- New-thread sends do not lose the selected thread while the route and sidebar list catch up.
- Sub-agent rows render from both camelCase and snake_case app-server payloads.
- Agent rows can restore when child-agent realtime events arrive after the parent thread's live state has been cleared.
- Clicking an agent row opens one inline detail drawer; pressing Escape or collapsing runtime activity closes it.
- The Playwright script saves passing screenshots to:
  - `output/playwright/agent-runtime-panel-light.png`
  - `output/playwright/agent-runtime-panel-dark.png`

#### Rollback/Cleanup
- Stop the temporary `4173` dev server when testing is complete.
- Delete `output/playwright/agent-runtime-panel-*.png` and `output/playwright/agent-runtime-panel-diagnostics.json` if you want to remove local evidence artifacts.

---

### Composer Plugin Mentions

#### Feature/Change Name
The `$` composer picker can select installed enabled plugins, visually distinguish them from skills, and send them as plugin mentions.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Start or confirm the app server on `http://127.0.0.1:4173`:
   `pnpm run dev --host 127.0.0.1 --port 4173`
3. Use a Codex CLI/app-server version that supports `plugin/list`.
4. Install and enable at least one plugin such as Product Design.

#### Steps
1. Run the focused regression test:
   `pnpm exec vitest run src/api/normalizers/v2.test.ts`
2. Run the frontend type/build check:
   `pnpm run build:frontend`
3. In light theme, open an existing thread and type `$` in an empty composer.
4. In the picker search field, search for the installed plugin name, for example `product`.
5. Confirm plugin rows appear with a visible `Plugin` badge and skills still appear with a `Skill` badge.
6. Select the plugin and confirm the composer shows a violet plugin chip rather than a green skill chip.
7. Add ordinary task text and send the message.
8. Confirm the sent user message history shows a `Plugin` chip for the selected plugin and does not try to browse it as a local `SKILL.md` file.
9. Queue a message while a turn is in progress with the same plugin selected, then send/steer it and confirm the plugin remains attached.
10. Switch to dark theme and repeat steps 3-8. Confirm the picker, plugin badge, composer chip, and history chip remain readable without light surfaces on the dark page.

#### Expected Results
- `$` autocomplete lists installed enabled plugins alongside skills.
- Plugin options are visibly labeled as `Plugin`; skill options remain labeled as `Skill`.
- Selected plugins render as plugin-colored chips and are sent as `mention` input items with `plugin://...` paths.
- Existing skill selection, prompt selection, file attachments, and slash commands keep their previous behavior.
- Light and dark themes both keep the new picker rows and chips legible.

#### Rollback/Cleanup
- Remove queued test messages if any were created.
- Stop the temporary `4173` dev server when testing is complete.

---

### Sidebar Thread Link Copy

#### Feature/Change Name
Thread overflow menus can copy a shareable local thread link.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Start or confirm the app server on `http://127.0.0.1:4173`:
   `pnpm run dev --host 127.0.0.1 --port 4173`
3. Have at least one existing thread visible in the sidebar.

#### Steps
1. Run the focused regression test:
   `pnpm exec vitest run src/threadLinks.test.ts`
2. Run the frontend type/build check:
   `pnpm run build:frontend`
3. In light theme, open a thread row overflow menu.
4. Confirm `Copy thread link` appears after `Copy path`.
5. Click `Copy thread link`.
6. Paste the clipboard value into a text field and confirm it is an absolute URL ending with `#/thread/<thread-id>`.
7. Open the pasted URL in another browser tab or chat context and confirm it loads the same thread.
8. Switch to dark theme and repeat steps 3-6. Confirm the new menu row uses the same readable dark-menu styling as the other actions.

#### Expected Results
- The menu order is `Add automation...` or `Manage automations...`, `Browse files`, `Copy path`, `Copy thread link`, `Export chat`, `Create chat fork`, `Pin thread` or `Unpin thread`, `Rename thread`, `Mark as unread` or `Mark as read`, `Delete thread`.
- The copied value includes the current app origin/base path and an encoded hash route for the selected thread.
- Clicking `Copy thread link` closes the menu.
- Light and dark themes both keep the menu item readable and aligned with existing menu rows.

#### Rollback/Cleanup
- Stop the temporary `4173` dev server when testing is complete.

---

### Assistant Voice Mode For iOS Shell

#### Feature/Change Name
Assistant voice mode prepares a Russian spoken summary after background dictation, caches temporary TTS audio on the server, starts an iOS background audio session while waiting, plays the answer through the app, and can send a Telegram fallback alert.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Configure server-side OpenAI credentials with `CODEXUI_VOICE_TTS_API_KEY`, `CODEXUI_TRANSCRIBE_API_KEY`, or `OPENAI_API_KEY`.
3. For Telegram fallback, configure the Telegram bot token and allowed user ID in the existing Telegram settings panel, then send `/whoami` to the bot once so the chat is remembered.
4. Start or confirm the app server on `http://127.0.0.1:4173`:
   `pnpm run dev --host 127.0.0.1 --port 4173`
5. For real background playback validation, build/run the Capacitor iOS app from Xcode on a physical iPhone with AirPods connected.

#### Steps
1. Run the focused regression tests:
   `pnpm exec vitest run src/server/voiceMode.test.ts src/api/voiceMode.test.ts src/composables/useVoicePlayback.test.ts --reporter=verbose`
2. Run the frontend type/build check:
   `pnpm exec vue-tsc --noEmit`
   `pnpm run build:frontend`
3. In a normal desktop browser/PWA session, open settings and the thread feature menu in light theme. Confirm `Voice mode`, `Voice summary`, `Voice speed`, `Telegram fallback`, `Play latest`, `Pause`, `Resume`, and `Stop voice` are not shown.
4. Switch to dark theme in the normal desktop browser/PWA session and repeat step 3. Confirm the ordinary settings and feature-menu rows remain readable and the hidden voice-only rows do not leave visual gaps.
5. In the native iOS Capacitor build, open an existing thread, open the thread feature menu, enable `Voice mode`, set `Voice summary` to `Medium`, set `Voice speed` to `1.0x`, and keep `Telegram fallback` enabled.
6. Press the dictation microphone, record a prompt, stop recording, and let auto-send submit the transcript.
7. Lock the iPhone after the transcript is sent. Wait for the Codex answer to finish.
8. Expected iOS result: the app keeps an audio session while waiting, summarizes the answer in Russian, and autoplays the TTS response through the selected audio output. If iOS suspends playback, a Telegram alert should arrive and the app should resume with `Play latest` or `Resume`.
9. In the native iOS build, use `Play latest`, `Pause`, `Resume`, and `Stop voice` from the thread feature menu on a completed assistant message.
10. In Xcode/device testing, confirm `Info.plist` includes `UIBackgroundModes` with `audio`, AirPods media controls trigger pause/resume when iOS exposes them, and dictation route diagnostics prefer the built-in iPhone microphone when iOS allows that route.

#### Expected Results
- `/codex-api/voice/speech` returns binary TTS audio and strips code/log-heavy content from spoken text.
- `/codex-api/voice/jobs` creates a temporary voice job, waits for an assistant answer when only `threadId` is supplied, returns both `data` and legacy `job` envelopes, and expires cached audio after the TTL.
- The frontend accepts both `state` and `status` job fields, understands direct, `data`, `job`, gateway-wrapped `result`, stringified JSON, and `content[].text` envelopes, and caches audio blobs only in memory.
- Voice controls and settings are hidden outside the native iOS Capacitor shell; normal desktop browser/PWA sessions do not start automatic voice jobs.
- Voice mode uses the `medium` Russian summary profile by default, voice `nova`, speed `1.0x`, and no permanent audio storage.
- iOS native code uses background audio mode, playback/waiting audio sessions, Now Playing remote commands, and best-effort built-in microphone selection.
- Light and dark themes both keep the normal browser/PWA menu clean, and the native iOS shell keeps voice controls and settings legible.

#### Rollback/Cleanup
- Disable `Voice mode` in settings or the thread feature menu to stop automatic voice jobs.
- Stop any local `4173` dev server used for testing.
- Remove temporary server credentials from the shell if they were exported only for manual testing.

---

### Native iOS Remote Backend Login

#### Feature/Change Name
Native iOS shell can authenticate to a password-protected remote Codex UI backend.

#### Prerequisites/Setup
1. Run from the repository root with dependencies installed.
2. Start or confirm the app server on `http://127.0.0.1:4173`:
   `pnpm run dev --host 127.0.0.1 --port 4173`
3. For device validation, build/run the Capacitor iOS app on a physical iPhone.
4. Have a password-protected remote backend available, for example `https://codex-ui.todo-tg-app.ru`.

#### Steps
1. Run the focused frontend helper test:
   `pnpm exec vitest run src/api/remoteBackendAuth.test.ts`
2. Run the auth shell smoke test after a build:
   `pnpm run build && node scripts/test-codexui-auth-shell-cache.mjs`
3. In light theme, open sidebar settings and set `Remote backend` to the HTTPS remote server URL.
4. Confirm the `Remote login` password field appears under the remote backend setting.
5. Enter the backend password and press `Login`.
6. Confirm the app reloads and the server thread list appears.
7. Switch to dark theme and repeat steps 3-5. Confirm the remote login field, status label, and any error message remain readable with dark surfaces.
8. On iPhone, repeat steps 3-6 in the native Capacitor app, not Safari/PWA.

#### Expected Results
- Native-origin `/auth/login` preflight requests receive credentialed CORS headers for `capacitor://localhost`.
- Native-origin HTTPS login responses set `portal_session` with `HttpOnly`, `SameSite=None`, and `Secure`.
- Same-origin browser login continues to use `SameSite=Strict`.
- The app shows `Login required` when the remote backend returns 401 and `Signed in` after login succeeds.
- After reload, `/codex-api/*` calls use the authenticated remote session and threads load from the remote server.
- Light and dark themes both keep the remote backend URL and login controls aligned and readable.

#### Rollback/Cleanup
- Clear `Remote backend` to return to same-origin mode.
- Stop any local `4173` dev server used for testing.

---

### Native iOS Full-Screen Viewport And Remote Login Build

#### Feature/Change Name
Fresh main iOS sideload build keeps native iPhone viewport sizing, safe-area spacing, and remote backend login support.

#### Prerequisites/Setup
1. Use a Mac with Xcode, pnpm, and CocoaPods installed.
2. Connect and unlock the physical iPhone.
3. Use the fresh repository root with dependencies installed.
4. Ensure the remote backend is available at `https://codex-ui.todo-tg-app.ru`.

#### Steps
1. Run `pnpm install`.
2. Run `pnpm run build:frontend`.
3. Run `npx cap sync ios`.
4. Run `npx cap open ios`.
5. Build for the connected iPhone from Xcode or with:
   `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -destination 'id=<device-udid>' -derivedDataPath /tmp/codexui-ios-main-derived -allowProvisioningUpdates -allowProvisioningDeviceRegistration build`
6. Install and launch the app on the iPhone.
7. Use Xcode Devices `Take Screenshot` and confirm the screenshot is the native device size with no black letterbox bars.
8. In light theme, confirm the header is below the iOS status bar, the composer fits the viewport, and Settings shows `Remote backend` plus `Remote login`.
9. Switch to dark theme and repeat the viewport/header/composer/settings checks.
10. Enter the remote backend password in `Remote login`, press `Login`, and confirm threads load from the remote server.

#### Expected Results
- The built app contains `UILaunchStoryboardName = LaunchScreen`, `Assets.car`, `UIRequiresFullScreen`, and `WKAppBoundDomains` for `codex-ui.todo-tg-app.ru`.
- The bundled web app contains `viewport-fit=cover`, `capacitor-ios-shell` CSS, and `/auth/login` backend routing.
- Xcode device screenshots are `828x1792` on iPhone 11 with zero full-width black rows at the top or bottom.
- The native shell content does not overlap the iOS status bar.
- Light and dark themes both keep the remote login controls readable.

#### Rollback/Cleanup
- Delete the sideloaded `Codex UI` app from the iPhone if iOS caches an older launch snapshot.
- Stop any temporary build or test processes after validation.

---

### Native iOS Remote Login CORS Fallback And Focus Zoom

#### Feature/Change Name
Native iOS Remote login uses Capacitor HTTP/Cookies when `/auth/login` CORS is unavailable, and settings inputs no longer trigger iOS focus zoom.

#### Prerequisites/Setup
1. Use the fresh iOS build root with dependencies installed.
2. Connect and unlock the physical iPhone.
3. Ensure the remote backend URL is `https://codex-ui.todo-tg-app.ru`.
4. Have the Codex Web password for the remote backend.

#### Steps
1. Run `pnpm exec vitest run src/api/remoteBackendAuth.test.ts src/backendUrl.test.ts`.
2. Run `pnpm run build:frontend`.
3. Run `npx cap sync ios`.
4. Build, install, and launch the app on the physical iPhone.
5. In light theme, open Settings and scroll to `Remote backend`.
6. Tap the `Remote backend` URL field and then the `Remote login` password field.
7. Enter the password and press `Login`.
8. Confirm the app reloads and remote threads load.
9. Switch to dark theme and repeat steps 5-7, including tapping both input fields.

#### Expected Results
- Tapping settings input fields does not zoom the native iOS WebView, and the screen returns to the same scale after keyboard dismissal.
- The iOS app can log in even when the deployed server does not answer `OPTIONS /auth/login` with CORS headers.
- The native login path stores the `portal_session` cookie in the iOS WebView cookie store.
- After reload, `/codex-api/*` HTTP requests authenticate through native `CapacitorHttp` on iOS and the thread list appears.
- Light and dark themes keep the login controls readable and aligned while the keyboard is open and after it closes.

#### Rollback/Cleanup
- Clear `Remote backend` to return to same-origin mode.
- Delete the sideloaded app from the iPhone if iOS keeps an older WebView snapshot.
- Stop any temporary build or test processes after validation.

---

### Native iOS Sidebar Safe Area And Dictation Upload

#### Feature/Change Name
Native iOS drawer/sidebar stays below the visible status bar and dictation transcription uploads multipart audio through Capacitor HTTP.

#### Prerequisites/Setup
1. Use the fresh iOS build root with dependencies installed.
2. Connect and unlock the physical iPhone.
3. Configure `Remote backend` to `https://codex-ui.todo-tg-app.ru` and log in.
4. Confirm microphone permission is granted for the sideloaded app.

#### Steps
1. Run `pnpm exec vitest run src/backendUrl.test.ts src/api/remoteBackendAuth.test.ts src/composables/useDictation.test.ts`.
2. Run `pnpm run build:frontend`.
3. Run `npx cap sync ios`.
4. Build, install, and launch the app on the physical iPhone.
5. In light theme, open the left sidebar drawer and confirm the top action buttons start below the iOS clock/status bar.
6. Close the drawer, tap the composer microphone, record a short phrase, and stop recording.
7. Confirm transcription completes without `Malformed transcription upload payload`.
8. Switch to dark theme and repeat steps 5-7.

#### Expected Results
- The native app keeps the iOS status bar visible, and mobile drawer/settings content is padded below the clock, signal, Wi-Fi, and battery area.
- The iOS native HTTP routing preserves multipart `FormData` by sending Capacitor `formData` entries, including the audio file as `base64File`.
- `/codex-api/transcribe` receives a valid multipart upload and returns transcript text instead of the malformed payload error.
- `/codex-api/voice/speech` and `/codex-api/voice/jobs/<id>/audio` return binary audio blobs on iOS native routing, not corrupted text bodies.
- Light and dark themes keep the drawer and dictation status text readable.

#### Rollback/Cleanup
- Stop any temporary build or test processes after validation.
- Delete the sideloaded app if iOS caches an older WebView snapshot.

---

### Native iOS Voice Playback Status And New Thread Autoplay

#### Feature/Change Name
Native iOS voice playback surfaces TTS failures, starts voice jobs after a first-message new thread send, shows the feature menu on the new-thread screen, and renders optimistic user messages before the assistant response.

#### Prerequisites/Setup
1. Use the fresh iOS build root with dependencies installed.
2. Connect and unlock the physical iPhone.
3. Configure `Remote backend` to `https://codex-ui.todo-tg-app.ru` and log in.
4. Enable `Voice mode` in Settings or the thread feature menu.
5. Confirm the remote server has OpenAI TTS credentials configured.

#### Steps
1. Run `pnpm exec vitest run src/api/voiceMode.test.ts src/composables/useVoicePlayback.test.ts src/composables/useDesktopState.test.ts --reporter=verbose`.
2. Run `pnpm run build:frontend`.
3. Run `npx cap sync ios`.
4. Build, install, and launch the app on the physical iPhone.
5. In light theme, open an existing completed thread, open the header feature menu, and tap `Play latest`.
6. Confirm either audio plays or a visible voice status/error appears above the composer.
7. Confirm repeated `Play latest` taps either reuse cached audio or show a visible status explaining the backend/auth/TTS failure.
8. On a fresh iPhone Simulator without Remote login, confirm `Play latest` sends `/codex-api/voice/speech` to the configured remote backend and shows `Authentication required` instead of failing silently.
9. Open `Start new thread`, confirm the header feature menu is present, and confirm Side/Listen are unavailable until a thread exists while Voice controls remain accessible.
10. Record a first prompt with the mic, stop recording, and let auto-send create the new thread.
11. Confirm the transcribed user message appears immediately in the chat before the assistant response finishes.
12. Confirm the app starts a voice job for the newly created thread and either autoplays the assistant response or shows the voice status/error.
13. Switch to dark theme and repeat steps 5-12.

#### Expected Results
- `Play latest` no longer fails silently; blocked playback, failed TTS, waiting, summarizing, synthesizing, and fetching states are visible through composer status text.
- `Play latest` directly exercises `/codex-api/voice/speech` for a completed assistant response, so remote auth/TTS/audio-output problems are visible without waiting for a new thread job.
- If the remote endpoint returns HTML or JSON instead of `audio/*`, the app reports the unexpected content type instead of passing the payload to iOS audio playback.
- Successful non-JSON `/codex-api/voice/jobs` responses report their payload shape, including HTML error pages, instead of only saying `malformed JSON`.
- First-message new-thread sends call the same voice-job flow as background dictation in existing threads when Voice mode is enabled.
- The new-thread screen exposes the kebab feature menu, while thread-only actions remain disabled until an actual thread id exists.
- User messages sent from dictation or text appear optimistically with `user.optimistic` before assistant output streams.
- Persisted user messages de-duplicate the optimistic row once the server history catches up.
- Light and dark themes keep the voice status text, feature menu, and optimistic message readable.

#### Rollback/Cleanup
- Disable `Voice mode` to stop automatic voice jobs.
- Stop any temporary build or test processes after validation.
- Delete the sideloaded app if iOS caches an older WebView snapshot.

---

### Native iOS Remote Backend API Contract Hardening

#### Feature/Change Name
Native iOS remote backend login and voice requests no longer misclassify HTML shell/login pages as authenticated API responses.

#### Prerequisites/Setup
1. Use the iOS build root with dependencies installed.
2. Have a password-protected remote backend such as `https://codex-ui.todo-tg-app.ru`.
3. For device validation, connect and unlock the physical iPhone.

#### Steps
1. Run the focused regression tests:
   `pnpm exec vitest run src/backendUrl.test.ts src/api/remoteBackendAuth.test.ts src/server/httpServer.mobileShell.test.ts --reporter=verbose`
2. Run the voice regression tests:
   `pnpm exec vitest run src/api/voiceMode.test.ts src/server/voiceMode.test.ts src/composables/useVoicePlayback.test.ts --reporter=verbose`
3. Run `pnpm run build:frontend`.
4. Run `npx cap sync ios`.
5. Build, install, and launch the app on the physical iPhone.
6. In light theme, set `Remote backend` to `https://codex-ui.todo-tg-app.ru`, log in, open an existing thread, and tap `Play latest`.
7. Switch to dark theme and repeat step 6.
8. Optionally call `OPTIONS /auth/login` with `Origin: capacitor://localhost` and confirm it returns credentialed CORS headers.

#### Expected Results
- Native iOS routed `/codex-api/*` JSON requests go through `CapacitorHttp` with an explicit JSON `Accept` header.
- Native iOS voice audio endpoints request `audio/*` and preserve binary blob response handling.
- `readRemoteBackendAuthStatus()` returns `unknown` for `200 text/html` instead of showing a false signed-in state.
- `OPTIONS /auth/login` for `capacitor://localhost` returns `204` with credentialed CORS headers.
- Native HTTPS `/auth/login` responses set `portal_session` with `HttpOnly`, `SameSite=None`, and `Secure`; same-origin browser logins stay `SameSite=Strict`.
- Unknown `/codex-api/*` routes return JSON 404 instead of the SPA HTML shell.
- Light and dark themes both keep the visible remote-login and voice status readable.

#### Rollback/Cleanup
- Clear `Remote backend` in settings to return to same-origin mode.
- Stop temporary test/build processes after validation.

---

### Native iOS Audio Session Plugin Registration

#### Feature/Change Name
Native iOS app explicitly registers `CodexAudioSessionPlugin` before the WebView loads so assistant voice playback can use the compiled Swift audio session bridge.

#### Prerequisites/Setup
1. Use the iOS build root with dependencies installed.
2. Connect and unlock the physical iPhone.
3. Configure `Remote backend` to `https://codex-ui.todo-tg-app.ru` and sign in.
4. Open a thread that has a completed assistant response.

#### Steps
1. Run `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug -destination 'id=<device-id>' build`.
2. Install and launch the app on the physical iPhone.
3. In light theme, open an existing thread and tap `Play latest`.
4. Confirm the app either plays generated speech for the latest assistant response or shows a backend/TTS error; it must not show `"CodexAudioSession" plugin is not implemented on ios`.
5. Tap `Play latest` on a completed assistant response and confirm the same behavior.
6. Switch to dark theme and repeat steps 3-5.

#### Expected Results
- `CodexAudioSessionPlugin` is registered through the custom Capacitor bridge controller before app JavaScript calls `registerPlugin('CodexAudioSession')`.
- Successful `/codex-api/voice/speech` and `/codex-api/voice/jobs/<id>/audio` responses with `audio/mpeg` are passed to native `playVoiceAudioBase64`.
- Voice playback failures now come from real audio/session/backend state, not from a missing Capacitor plugin header.
- Light and dark themes keep the visible voice status readable.

#### Rollback/Cleanup
- Revert the custom bridge controller in `ios/App/App/AppDelegate.swift` if the native plugin is later packaged as a normal Capacitor plugin and appears in `packageClassList`.
- Stop temporary build/test processes after validation.

---

### Native iOS Voice Audio MP3 Playback Fallback

#### Feature/Change Name
Native iOS voice playback decodes remote `audio/mpeg` responses with an explicit MP3 file type hint and a temporary-file fallback.

#### Prerequisites/Setup
1. Use the iOS build root with dependencies installed.
2. Connect and unlock the physical iPhone.
3. Configure `Remote backend` to `https://codex-ui.todo-tg-app.ru` and sign in.
4. Open a thread with at least one assistant response.

#### Steps
1. Run `pnpm exec vitest run src/composables/useVoicePlayback.test.ts --reporter=verbose`.
2. Run `pnpm run build:frontend`.
3. Run `npx cap sync ios`.
4. Build, install, and launch the app on the physical iPhone.
5. In light theme, open a completed assistant response and tap `Play latest`.
6. Confirm the generated `audio/mpeg` phrase plays, or that any failure message includes a native phase/domain/code instead of only `OSStatus error -50`.
7. Tap `Play latest` on a completed assistant response and confirm the same behavior.
8. Switch to dark theme and repeat steps 5-7.
9. Optional: play another app's audio in the background and repeat `Play latest` to confirm the voice playback session still starts.

#### Expected Results
- The iOS bridge receives `contentType: audio/mpeg` for native voice playback.
- Swift maps `audio/mpeg` or MP3 frame-sync bytes to `AVFileType.mp3.rawValue` before creating `AVAudioPlayer`.
- If in-memory decode fails, Swift writes the bytes to a temporary `.mp3` file and retries with `AVAudioPlayer(contentsOf:fileTypeHint:)`.
- If the preferred audio session options fail, Swift retries with simpler playback-session options before returning an error.
- Light and dark themes both keep the visible voice status/error readable.

#### Rollback/Cleanup
- Delete and reinstall the app if iOS appears to be launching an older sideloaded build.
- Stop temporary build/test processes after validation.

---

### iOS Remote Project Sync And Voice Speech Cache

#### Feature/Change Name
Remote iOS app shows child projects under a configured workspace container root and reuses cached `Play latest` speech audio.

#### Prerequisites/Setup
1. Use a backend whose workspace roots state contains a parent folder such as `/home/rnl1/prog`.
2. Ensure that remote threads exist under child folders, for example `/home/rnl1/prog/codexUI` and `/home/rnl1/prog/todo_tg_app`.
3. Connect and unlock the physical iPhone.
4. Configure `Remote backend` to `https://codex-ui.todo-tg-app.ru` and sign in.
5. Open a thread with at least one completed assistant response.

#### Steps
1. Run `pnpm exec vitest run src/composables/useDesktopState.test.ts`.
2. Run `pnpm exec vitest run src/server/voiceMode.test.ts src/api/voiceMode.test.ts src/composables/useVoicePlayback.test.ts`.
3. Run `pnpm run build:frontend`.
4. Run `npx cap sync ios`.
5. Build, install, and launch the app on the physical iPhone.
6. In light theme, open the sidebar and confirm child projects under `/home/rnl1/prog` are visible, not only the `prog` container row.
7. Open a completed assistant response, tap `Play latest`, wait for audio playback, then tap `Play latest` again.
8. Confirm the second playback starts from cached speech audio without showing a long `creating audio` delay.
9. Switch to dark theme and repeat steps 6-8.

#### Expected Results
- A workspace root that is a folder container allows thread groups whose `cwd` is equal to or nested under that root.
- Projectless chats remain visible.
- `/codex-api/voice/speech` returns `X-Codex-Voice-Cache: miss` for the first identical request and `X-Codex-Voice-Cache: hit` for a repeated request.
- Repeated `Play latest` does not call the OpenAI TTS provider again while the server speech cache entry is alive.
- Light and dark themes both keep the sidebar project list and voice status readable.

#### Rollback/Cleanup
- Clear `Remote backend` in settings to return to same-origin mode.
- Restart the backend only if you need to clear the in-memory speech cache immediately.
- Stop temporary build/test processes after validation.

---

### Mobile iOS Voice Toolbar And Conversational Voice Summaries

#### Feature/Change Name
Native iOS threads use a compact mobile voice toolbar above the composer, default Voice Mode to off for old installs, and summarize answers in a friendlier spoken style without mandatory risk callouts.

#### Prerequisites/Setup
1. Use the iOS build root with dependencies installed.
2. Connect and unlock the physical iPhone.
3. Configure `Remote backend` to `https://codex-ui.todo-tg-app.ru` and sign in.
4. Open an existing thread with at least one completed assistant response.

#### Steps
1. Run `pnpm exec vue-tsc --noEmit --pretty false`.
2. Run `pnpm exec vitest run src/server/voiceMode.test.ts src/composables/useVoicePlayback.test.ts`.
3. Run `pnpm run build:frontend`.
4. Run `npx cap sync ios`.
5. Build, install, and launch the app on the physical iPhone.
6. In light theme, open a thread on the iPhone and confirm a five-button voice toolbar appears above the composer: voice on/off, latest, `-5`, play/pause, and `+5`.
7. Confirm the toolbar moves up with the composer when the message input grows or the virtual keyboard opens.
8. Open the thread feature menu and confirm `Test voice` is absent on mobile; summary, speed, and Telegram fallback remain available.
9. Tap `Latest`, pause during playback, seek back and forward by 5 seconds, and resume.
10. Switch to dark theme and repeat steps 6-9.
11. After a fresh install or storage reset, confirm Voice Mode starts off by default.

#### Expected Results
- Mobile iOS playback controls are not stacked inside the header feature menu.
- The toolbar stays visually attached to the composer and does not cover the assistant response.
- Native pause, resume, and seek buttons control the Swift `AVAudioPlayer` session.
- `Play latest` can reuse cached speech audio instead of synthesizing a new file every time the cache entry is alive.
- Voice summary instructions ask for a conversational Russian phone-call style and do not add risks or errors unless the source answer actually contains them.
- Light and dark themes both keep the toolbar buttons and status text readable.

#### Rollback/Cleanup
- Clear `codex-web-local.voice-mode.enabled.v2` from WebView storage to retest the default-off migration.
- Delete and reinstall the app if iOS appears to launch an older sideloaded build.
- Stop temporary build/test processes after validation.

---

### Native iOS TTS Model Selection And Background Waiting Session

#### Feature/Change Name
Native iOS voice mode exposes TTS model selection in Settings, keeps background dictation jobs inside a native waiting audio session, and re-prefers the built-in iPhone microphone if iOS switches dictation input to Bluetooth.

#### Prerequisites/Setup
1. Use the iOS build root with dependencies installed.
2. Connect and unlock the physical iPhone.
3. Configure `Remote backend` to `https://codex-ui.todo-tg-app.ru` and sign in.
4. Grant microphone permission to the sideloaded app.
5. For route validation, connect AirPods before starting dictation.

#### Steps
1. Run the focused regression tests:
   `pnpm exec vitest run src/server/voiceMode.test.ts src/api/voiceMode.test.ts src/composables/useVoicePlayback.test.ts src/composables/useDictation.test.ts src/composables/dictationBackgroundJobs.test.ts --reporter=verbose`
2. Run the frontend type/build check:
   `pnpm exec vue-tsc --noEmit`
   `pnpm run build:frontend`
3. Run `npx cap sync ios`.
4. Build, install, and launch the app on the physical iPhone.
5. In light theme, open Settings > Voice and confirm `TTS model` offers `GPT-4o mini TTS`, `TTS-1`, and `TTS-1 HD`.
6. Select each TTS model, tap `Play latest` in a completed thread, and confirm voice generation starts without replaying cached audio from the previously selected model.
7. Enable `Voice mode`, record dictation in an existing thread, stop recording, and lock the iPhone after the transcript is submitted.
8. Confirm the app keeps the native waiting audio session active while background transcription and voice-job polling run, then plays the generated answer or shows a visible voice error/fallback status.
9. With AirPods connected, start dictation and confirm Settings > Voice > `Last mic` reports a built-in iPhone/internal route when iOS exposes it.
10. Switch to dark theme and repeat steps 5-9.

#### Expected Results
- TTS model selection is stored in local settings and sent with `/codex-api/voice/speech` and `/codex-api/voice/jobs` requests.
- The voice server includes the TTS model in job fingerprints, speech cache keys, serialized job payloads, and `X-Codex-Voice-Tts-Model`.
- Background dictation jobs call the native waiting-session bridge while transcription/completion callbacks run.
- The Swift bridge ref-counts overlapping waiting sessions, so one completed operation cannot stop another operation's keepalive.
- Waiting mode plays a very low-volume looping tone instead of a zero-volume silent player.
- Dictation uses best-effort built-in mic selection at prepare time and after audio route changes.
- Light and dark themes both keep the Settings row, toolbar buttons, and voice status readable.

#### Rollback/Cleanup
- Set `TTS model` back to `GPT-4o mini TTS` in Settings.
- Disable `Voice mode` to stop automatic background voice jobs.
- Stop temporary build or profiling processes after validation.

---

### Native iOS Voice Mode Latest Replay Toolbar And Persistent Waiting Audio

#### Feature/Change Name
Native iOS Voice mode keeps its enable/disable control in the thread kebab menu, shows the composer voice toolbar only while Voice mode is enabled, replays the latest generated assistant audio from the message cache, and keeps a native waiting audio session active while Voice mode is on.

#### Prerequisites/Setup
1. Use the iOS build root with dependencies installed.
2. Connect and unlock the physical iPhone.
3. Configure `Remote backend` to `https://codex-ui.todo-tg-app.ru` and sign in.
4. Confirm server-side TTS credentials are configured.
5. Open an existing thread with at least one completed assistant response.

#### Steps
1. Run the focused regression tests:
   `pnpm exec vitest run src/server/voiceMode.test.ts src/composables/useVoicePlayback.test.ts --reporter=verbose`
2. Run the frontend type/build check:
   `pnpm exec vue-tsc --noEmit`
   `pnpm run build:frontend`
3. Run `npx cap sync ios`.
4. Build, install, and launch the app on the physical iPhone.
5. In light theme, open a thread with Voice mode disabled and confirm the composer voice toolbar is hidden.
6. Open the thread kebab menu and confirm `Voice off` is visible there; enable it from the kebab menu.
7. Confirm the composer toolbar appears above the text input with `Latest`, `-5`, play/pause, `+5`, and the speed toggle, and that it does not include a Voice on/off button.
8. Send a prompt with Voice mode enabled, wait for the automatic voice answer to play, then tap `Latest`.
9. Confirm `Latest` replays immediately from the existing message audio cache instead of starting a new `/codex-api/voice/speech` synthesis.
10. Open the kebab menu again, disable Voice mode, and confirm the toolbar disappears and playback/waiting audio stops.
11. Repeat steps 5-10 in dark theme.
12. For background validation, enable Voice mode, send a prompt, lock the iPhone while the answer is pending, and confirm the waiting audio session remains active until generated speech starts or a visible error appears.

#### Expected Results
- The kebab menu always keeps the Voice mode enable/disable control in native iOS threads.
- The composer voice toolbar is conditional on `Voice mode = on`.
- The toolbar contains playback controls only: latest replay, rewind, play/pause, forward, and speed.
- Automatic voice jobs serialize the resolved assistant `messageId`/`turnId` after the answer completes.
- `playJob()` caches fetched job audio under both the job id and the stable message key, and `playSpeech()` checks the message key before calling `/codex-api/voice/speech`.
- Thread-based voice jobs without explicit text do not reuse a stale `latest` fingerprint from an older assistant response.
- Light and dark themes both keep the kebab rows, toolbar buttons, and composer status readable.

#### Rollback/Cleanup
- Disable `Voice mode` in the kebab menu or Settings to stop the persistent native waiting session.
- Delete and reinstall the app if iOS appears to launch an older sideloaded build.
- Stop temporary test/build/profiling processes after validation.

---

### Native iOS Voice Mode Follow-Up Answer Selection

#### Feature/Change Name
Native iOS Voice mode starts a fresh voice job for each follow-up message and waits for the assistant answer after the previous spoken response instead of replaying the first answer.

#### Prerequisites/Setup
1. Use the iOS build root with dependencies installed.
2. Connect and unlock the physical iPhone.
3. Configure `Remote backend` to `https://codex-ui.todo-tg-app.ru` and sign in.
4. Confirm server-side TTS credentials are configured.
5. Open or create a thread with Voice mode enabled.

#### Steps
1. Run the focused regression tests:
   `pnpm exec vitest run src/api/voiceMode.test.ts src/server/voiceMode.test.ts src/composables/useVoicePlayback.test.ts --reporter=verbose`
2. Run the frontend type/build check:
   `pnpm exec vue-tsc --noEmit`
   `pnpm run build:frontend`
3. Run `npx cap sync ios`.
4. Build, install, and launch the app on the physical iPhone.
5. In light theme, send a first prompt and confirm the first assistant answer is voiced.
6. Send a second follow-up prompt in the same thread and confirm a new voice job waits for the second assistant answer.
7. Confirm the app does not replay the first assistant answer after the second response completes.
8. Send a third follow-up prompt and confirm the same behavior with the third assistant answer.
9. Tap `Latest` after each generated answer and confirm it replays the matching latest answer from cache.
10. Switch to dark theme and repeat steps 5-9.

#### Expected Results
- Follow-up voice job requests include `afterMessageId` for the latest assistant message that existed before the new user prompt.
- The server skips an assistant answer whose `messageId` matches `afterMessageId` and continues polling until a newer assistant message is available.
- Normal selected-thread sends and background dictation auto-sends both start voice jobs for the newly requested answer.
- `Latest` still uses the message-level cache for the current newest assistant answer.
- Light and dark themes both keep the voice toolbar, kebab menu, and composer status readable.

#### Rollback/Cleanup
- Disable `Voice mode` in the kebab menu or Settings to stop automatic voice jobs.
- Delete and reinstall the app if iOS appears to launch an older sideloaded build.
- Stop temporary test/build/profiling processes after validation.

---

### GitHub Actions CI And Hetzner Deploy

#### Feature/Change Name
GitHub-backed source of truth with parallel CI jobs and a Hetzner deploy workflow that skips duplicate verification when the selected commit already passed CI.

#### Prerequisites/Setup
1. Use the git checkout at `/Users/rnl1/prog/codexUI`.
2. Confirm GitHub repository access for `ranilzinurov/codexUI`.
3. Confirm `pnpm-lock.yaml` is committed and `package.json` has `packageManager`.
4. For deploy verification, configure GitHub secrets from `docs/deploy/github-actions-hetzner.md`.
5. For hosted UI verification, confirm the Hetzner nginx static directory is writable by the deploy user.

#### Steps
1. Run local dependency verification:
   `pnpm install --frozen-lockfile`
2. Run local unit tests:
   `pnpm run test:unit`
3. Run the build and smoke test gate:
   `pnpm run test`
4. Push the branch and confirm the `CI` workflow starts for the pushed branch or PR.
5. Confirm the `CI` workflow starts `Secret scan`, `Unit tests`, and `Build and smoke tests` as separate jobs.
6. Confirm the final `Typecheck, build, and tests` job succeeds only after all three required jobs succeed.
7. Confirm the `Unit tests` job uses Node 22, pnpm 10.6.2, `pnpm install --frozen-lockfile`, and `pnpm run test:unit` without installing Playwright browsers.
8. Confirm the `Build and smoke tests` job uses Node 22, pnpm 10.6.2, installs Playwright WebKit, and runs `pnpm run test`.
9. Merge or push to `main` and confirm a successful `CI` run automatically triggers `Deploy Hetzner`.
10. Confirm the automatic deploy resolves the triggering CI `head_sha`, reports `needs_full=false`, and skips dependency installation, Playwright installation, unit tests, and build/smoke tests.
11. Run `Deploy Hetzner` manually with `verification=require-ci` against a commit that already passed CI and confirm it also reports `needs_full=false`.
12. Run `Deploy Hetzner` manually with `verification=full` on a disposable ref and confirm it performs secret scan, dependency installation, Playwright WebKit installation, unit tests, and build/smoke tests before deploy.
13. Confirm only one deploy can run at a time through the `deploy-hetzner` concurrency group.
14. Confirm the server deploy log fetches `origin/main`, validates the requested SHA, installs with `--frozen-lockfile --force`, rebuilds, syncs `dist/` to `/var/www/codexui-dist`, restarts `codexui`, and passes the healthcheck.
15. Open the hosted app in light theme and confirm the main thread UI loads current assets without missing hashed CSS/JS.
16. Switch to dark theme and confirm the main thread UI loads current assets without light-theme surfaces caused by stale static files.

#### Expected Results
- CI fails if dependencies drift from `pnpm-lock.yaml`.
- CI keeps the existing required check name `Typecheck, build, and tests` while running secret scan, unit tests, and build/smoke checks in parallel.
- Deploy no longer repeats the full CI gate after the same commit already passed CI.
- Successful `main` CI automatically starts the Hetzner deploy workflow for the exact CI `head_sha`.
- Manual deploy defaults to `verification=require-ci`; use `verification=full` only when the selected commit needs fresh verification, or `verification=skip` only for emergency rollback.
- `.env` is no longer tracked; `.env.example` documents safe non-secret keys.
- The deploy workflow requires a dedicated SSH key and deploy secrets before it can reach Hetzner.
- The deploy key can only trigger `scripts/deploy-from-github.sh` when installed with the forced-command `authorized_keys` entry.
- Hetzner deploys the exact selected commit, not an implicit or stale branch state.
- Hosted light and dark themes both load current frontend assets after the static sync.

#### Rollback/Cleanup
- Re-run `Deploy Hetzner` with a previous known-good commit SHA or manually run `scripts/deploy-from-github.sh <sha>` on Hetzner.
- Remove or rotate the dedicated GitHub Actions deploy key if it is exposed.
- Stop any temporary local dev servers or SSH test sessions after verification.

---

### Gitleaks Secret Scanning In CI

#### Feature/Change Name
Gitleaks-backed secret scanning for local checks and GitHub Actions.

#### Prerequisites/Setup
1. Use the git checkout at `/Users/rnl1/prog/codexUI`.
2. Install Gitleaks locally with `scripts/install-gitleaks.sh` or through a package manager.
3. Confirm `.gitleaks.toml` and `.gitleaks-baseline.json` are present.
4. Confirm Firebase GitHub OAuth frontend settings are supplied through ignored `VITE_FIREBASE_*` environment values when that login path is needed.

#### Steps
1. Run the local secret scan:
   `pnpm run secret:scan`
2. Confirm the scan uses `.gitleaks-baseline.json` and reports no new findings.
3. Push a branch or `main` commit and confirm the `CI` workflow runs `Install Gitleaks` and `Run secret scan` before dependency installation.
4. Manually run `Deploy Hetzner` and confirm it runs the same secret scan before SSH deploy steps.
5. Manually run `Build APK` when an Android project is present and confirm it runs the same secret scan before dependency installation.
6. In light theme, open the app and confirm the normal UI still loads after the Firebase config moved out of source.
7. In dark theme, repeat the same load check and confirm no theme regressions.

#### Expected Results
- `pnpm run secret:scan` exits successfully with the existing redacted baseline.
- New committed secrets produce new fingerprints and fail the scan.
- GitHub Actions use Node 24-compatible checkout/setup actions and do not show the old Node 20 action deprecation warning.
- The Firebase web config is no longer hardcoded in `src/`, and `.env.example` documents the required `VITE_FIREBASE_*` keys.

#### Rollback/Cleanup
- Remove generated reports under `output/gitleaks/` after manual scans if desired.
- If a baseline entry is confirmed to be a real credential, rotate that credential; deleting the baseline does not remove leaked git history.
- Stop any temporary workflow watchers or local test processes after verification.

---

### Dictation Reasoning Effort Buttons

#### Feature/Change Name
Active dictation replaces the red stop button with `m`, `h`, and `xh` reasoning-effort send buttons.

#### Prerequisites/Setup
1. Run the app from this repository with microphone access enabled.
2. Enable `Auto send dictation` in Settings.
3. Prefer `Click to toggle dictation` for this manual check so the active recording controls remain visible.
4. Open an existing thread that can start a Codex turn.

#### Steps
1. In light theme, start dictation from the thread composer.
2. Confirm the active recording controls show cancel, waveform, timer, pause, draft insert, and a vertical `m`/`h`/`xh` button stack instead of the red stop button.
3. Confirm the `m`/`h`/`xh` buttons use the same circular action-button background, color, size, and borderless treatment as the neighboring cancel, pause, and draft buttons.
4. Confirm the composer input shell stays at the normal height and does not expand just because the effort buttons are visible.
5. Speak a short unique phrase and click `m`.
6. Confirm the recording stops, transcribes, and auto-sends the message with medium reasoning.
7. Repeat with `h` and confirm the turn starts with high reasoning.
8. Repeat with `xh` and confirm the turn starts with extra-high reasoning.
9. Start dictation again, click the draft/pencil action, and confirm the transcript is inserted into the draft without auto-sending.
10. Stop recording with one of the effort buttons while a turn is already in progress and queue mode is selected, then confirm the queued message preserves the selected effort when it later runs.
11. Switch to dark theme and repeat steps 1-9.
12. Stop dictation, leave voice mode, and confirm the normal model/reasoning dropdown selectors are still shown in the idle composer.

#### Expected Results
- Only active dictation shows the compact `m`, `h`, and `xh` controls.
- The effort buttons are the same size and visual treatment as the neighboring circular dictation action buttons, with no custom outline.
- The effort button stack does not increase the composer shell height.
- Normal non-dictation composer selectors remain unchanged.
- Clicking `m`, `h`, or `xh` stops recording and uses the selected reasoning effort for the transcribed auto-send.
- Background dictation jobs and queued dictation messages keep the chosen reasoning effort across navigation and queue drain.
- Light and dark themes both render the effort buttons with readable text and no light-theme surfaces in dark mode.

#### Rollback/Cleanup
- Turn off `Auto send dictation` or reset it to the tester's preferred setting.
- Remove any test messages or queued turns created during verification.
- Stop temporary dev servers or profiling runs started for this check.

---

### Upstream Sync Preflight Baseline

#### Feature/Change Name
Protected upstream-sync baseline and GitHub issue tracking.

#### Prerequisites/Setup
1. Use the isolated upstream-sync worktree branch.
2. Confirm GitHub issues #1-#13 exist in `ranilzinurov/codexUI`.
3. Confirm the disposable dev server port `4173` is free before profiling.

#### Steps
1. Run `git status --short` and confirm no unrelated tracked changes exist.
2. Run `pnpm run build`.
3. Run `pnpm run test:unit`.
4. Start the disposable server with `pnpm run dev --host 127.0.0.1 --port 4173`.
5. Run `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_WAIT_MS=7000 pnpm run profile:browser`.
6. Open the generated `output/playwright/browser-runtime-profile-*.json`.
7. Inspect `duplicateCounts`, `warnings`, `totalApiKB`, `topApiSummary`, and `slowestApiRows`.

#### Expected Results
- Build completes successfully.
- Unit tests pass.
- The profile report has no warnings.
- Duplicate startup request counts remain bounded and are recorded as the baseline for later upstream-sync issues.
- No `main` push or direct upstream merge occurs during preflight.

#### Rollback/Cleanup
- Stop only the disposable server on port `4173`; do not stop any persistent `5173` tmux server.
- Remove temporary profiling artifacts only after their numbers have been copied into the baseline notes or PR body.

---

### Upstream Dev2 And Fast Docker Helpers

#### Feature/Change Name
Isolated `dev2` Codex home and fast Docker verification helpers.

#### Prerequisites/Setup
1. Use the upstream-sync branch.
2. Confirm Docker is installed only if running the optional Docker helper check.
3. Confirm ports `4174` and `4191` are free before starting helper servers.

#### Steps
1. Run `node --check scripts/dev-random-home.cjs`.
2. Run `bash -n scripts/run-docker-fast-test.sh`.
3. Run `pnpm run dev2 --host 127.0.0.1 --port 4174`.
4. Confirm the process prints `Using temporary CODEX_HOME:` with a temp directory path.
5. Open `http://127.0.0.1:4174/` in light theme and confirm the app loads.
6. Switch to dark theme and confirm the app still renders without light-theme surfaces.
7. Stop the `4174` helper server.
8. If Docker is available, run `docker build -t codexapp-fast-test-base:latest -f scripts/docker-fast-test-base.Dockerfile .`.
9. If Docker is available, run `PORT=4191 scripts/run-docker-fast-test.sh`.
10. Open `http://127.0.0.1:4191/` and confirm the Docker-served app loads.

#### Expected Results
- `dev2` starts the existing dev wrapper with an isolated random `CODEX_HOME`.
- Existing `package.json` scripts such as `secret:scan`, `test`, `test:coverage`, `test:browser-annotation`, and `pack:browser-annotation` remain present.
- Fast Docker helper scripts are syntax-valid and can build/run when Docker is available.
- Light and dark themes both load without regressions.
- No `.env`, certificate, or generated Playwright artifacts are imported.

#### Rollback/Cleanup
- Stop helper servers on ports `4174` and `4191`.
- If Docker was used, remove the `codexapp-fast-test` container and `codexapp-fast-test-home` volume when no longer needed.

---

### Project ZIP Export Import And Share

#### Feature/Change Name
Project ZIP export, browser download/share, and ZIP import into the current projects list.

#### Prerequisites/Setup
1. Use the upstream-sync branch.
2. Start the app with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Open `http://127.0.0.1:4173/`.
4. Have at least one existing project with a thread, or create a small temporary project from the home screen.
5. For metadata checks, use an isolated `CODEX_HOME` with one or more session JSONL files whose `session_meta.payload.cwd` points at the project folder.
6. Optionally enable free/custom/OpenCode Zen provider mode before import to verify imported provider/model rewriting.

#### Steps
1. In light theme, open a project menu in the sidebar.
2. Click `Export Project`.
3. Confirm the `Export Project` modal opens, shows progress, then shows `Ready` with a ZIP filename.
4. Click `Download` and confirm the browser downloads a `.zip` file.
5. Click `Share` if the browser supports file sharing; otherwise confirm the modal shows a clear fallback message and `Download` still works.
6. Inspect the ZIP contents.
7. Confirm `.codex-project/manifest.json` exists and does not contain the source machine's absolute project path.
8. Confirm project files use relative paths and generated folders such as `.git`, `node_modules`, `.venv`, `.cache`, `.next`, `.gradle`, `target`, `build`, `dist`, and coverage folders are absent.
9. Confirm matching session JSONL files, when present, live under `.codex-project/chats/sessions/` or `.codex-project/chats/archived_sessions/`.
10. Confirm `.codex-project/chats/thread-titles.json` exists when exported chats have title or update-time metadata.
11. Open a thread menu in the same project and click `Export Project`.
12. Confirm it exports the same project folder rather than only the chat transcript.
13. Return to the home screen and click `Import Project`.
14. Pick the exported `.zip` file.
15. Confirm the imported project becomes the selected new-thread folder and appears in the sidebar after refresh.
16. Confirm imported sessions appear as normal threads when the ZIP contains stored session JSON.
17. Inspect one imported JSONL under the destination `CODEX_HOME/sessions/imported/` and confirm its thread ID is new and its `cwd` points at the imported project path.
18. If provider mode was enabled before import, confirm imported session `model` and `model_provider` match the destination app's active provider/model defaults.
19. Switch to dark theme and repeat steps 1-4 and 13-15.

#### Expected Results
- Project and thread menu export actions both create a project ZIP through `/codex-api/project-zip`.
- The export modal reports progress, blocks close while exporting, and keeps buttons disabled until a ZIP blob is ready.
- Download preserves the server-provided filename when present.
- Share uses browser file sharing only when supported and falls back to an in-modal message otherwise.
- Import posts the selected ZIP to `/codex-api/project-import`, selects the imported folder, refreshes workspace roots, and reloads the thread list.
- `.codex-project/manifest.json` records portable metadata: `version`, `exportedAt`, and `projectName`.
- `.codex-project/chats/**` is reserved for Codex session import; other non-chat `.codex-project/` files round-trip as normal project files.
- Imported project folders get unique suffixes when the destination already has a folder with the exported project name.
- Imported chats are written to `CODEX_HOME/sessions/imported/`, get new thread IDs, and have `cwd` rewritten to the imported project path.
- Imported title and update-time metadata come from `.codex-project/chats/thread-titles.json` when available.
- Imported provider/model metadata is rewritten to the current local free/custom/OpenCode Zen provider defaults when that provider mode is active.
- Light and dark themes both render the modal, progress bar, buttons, and home-screen import action without light-theme surfaces in dark mode.

#### Rollback/Cleanup
- Delete temporary imported project folders created during manual testing.
- Remove downloaded ZIP files after verification.
- Remove imported test sessions from the isolated `CODEX_HOME` if one was used.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Startup Request Dedupe And Workspace Root Canonicalization

#### Feature/Change Name
Startup route selection, recent thread-list request reuse, and canonical workspace-root paths.

#### Prerequisites/Setup
1. Use the upstream-sync branch.
2. Start the app with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Have at least one existing thread and one project path that can also be reached through a symlink or worktree path.
4. Keep the persistent `5173` server untouched if it exists.

#### Steps
1. Open `http://127.0.0.1:4173/` in light theme.
2. Confirm the home screen loads without automatically opening or highlighting the last saved thread.
3. Navigate to `#/skills` and `#/automations`.
4. Confirm neither route restores the last saved thread into the active conversation pane.
5. Open a direct thread route, for example `#/thread/<thread-id>`.
6. Confirm that thread is selected and messages load for that route.
7. Import or add a project through a symlinked/worktree path, then refresh the app.
8. Confirm the project list shows the canonical real path once, not duplicate symlink and realpath entries.
9. Switch to dark theme and repeat steps 1-6.
10. Run `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_WAIT_MS=7000 pnpm run profile:browser`.
11. If a thread id is available, run `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_ROUTE='#/thread/<thread-id>' PROFILE_WAIT_MS=7000 pnpm run profile:browser`.
12. Open the generated profile JSON files and inspect `duplicateCounts`, `warnings`, `totalApiKB`, `topApiSummary`, and `slowestApiRows`.

#### Expected Results
- Home, skills, and automations start with an empty selected-thread state while still loading the thread list.
- Direct thread routes prime and load the requested thread without an extra startup thread read.
- A stale persisted thread id is still replaced by the first available thread during normal refreshes.
- Recent repeated thread-list refreshes reuse the in-flight or recent result instead of issuing a duplicate request.
- Workspace-root state and thread-list `cwd` values are canonicalized so symlink and worktree aliases do not produce duplicate projects.
- Profile reports have no warnings for duplicate startup thread-list or duplicate thread-read-with-turns requests.
- Light and dark themes both render the home, skills, automations, and thread routes without light-theme surfaces in dark mode.

#### Rollback/Cleanup
- Delete temporary symlink/worktree projects created for verification.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.
- Keep profile artifacts until their summary numbers have been copied into the PR or issue comment.

---

### Provider Model Locking For Existing Threads

#### Feature/Change Name
Thread-level provider/model retention for OpenCode Zen, OpenRouter, custom providers, and Codex auth transitions.

#### Prerequisites/Setup
1. Use the upstream-sync branch.
2. Start the app with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Configure or simulate one provider-backed mode such as OpenCode Zen or OpenRouter free mode.
4. Have one existing provider-backed thread and one normal Codex/OpenAI thread.

#### Steps
1. In light theme, open the provider-backed thread.
2. Confirm the model picker lists provider-specific models and does not fall back to Codex-only models.
3. Sign in or switch back to Codex/OpenAI auth.
4. Reopen the same provider-backed thread.
5. Confirm the model picker still lists that thread's provider models.
6. Start a new Codex/OpenAI thread and send one short message.
7. Confirm the new thread uses the active Codex/OpenAI provider and model list.
8. Fork the provider-backed thread and confirm the fork keeps the provider-backed model context.
9. Open a side chat from the provider-backed thread and confirm the side chat starts with the same provider context.
10. Switch to dark theme and repeat steps 1-7.

#### Expected Results
- `thread/read`, `thread/resume`, `thread/start`, and provider-backed `thread/fork` preserve `modelProvider` metadata when present.
- Existing OpenCode Zen/OpenRouter/custom-provider threads request provider models with the thread provider id, even if the global active auth has changed to Codex/OpenAI.
- Provider ids with underscores, such as `opencode_zen`, are treated the same as dash ids, such as `opencode-zen`.
- Codex/OpenAI provider ids normalize back to the standard Codex model context.
- New threads remember the provider returned by `thread/start`.
- Light and dark themes both render the model picker and conversation controls without light-theme surfaces in dark mode.

#### Rollback/Cleanup
- Archive or delete temporary provider test threads.
- Reset provider/auth configuration to the preferred local default after verification.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Account Auth Snapshot And Quota Recovery

#### Feature/Change Name
Codex account snapshot migration, active account detection, stale quota recovery, and raw auth error visibility.

#### Prerequisites/Setup
1. Use the upstream-sync branch.
2. Start the app with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Use an isolated `CODEX_HOME` when testing imported or malformed `auth.json` files.
4. Have at least one valid Codex/ChatGPT auth snapshot available for account switching.

#### Steps
1. In light theme, open settings and expand `Accounts`.
2. Click reload/refresh accounts with a valid `auth.json`.
3. Confirm the active account matches the currently active `CODEX_HOME/auth.json`, even when multiple accounts share the same account id but have different user ids.
4. Switch to another stored account and confirm the account card becomes active only after validation succeeds.
5. Simulate a stale `quotaStatus: "loading"` entry older than two minutes in `accounts.json`, then refresh accounts.
6. Confirm the account leaves `Loading quota...` and becomes either `ready` with quota data or `error` with a visible message.
7. Simulate a newer unknown ChatGPT plan type in a rate-limit response, such as `prolite`, and confirm quota recovery still produces usable limit data.
8. Try a malformed or missing-account-id `auth.json` in the isolated home and click refresh.
9. Confirm the UI shows a visible account error instead of staying stuck on fetching account details.
10. Switch to dark theme and repeat steps 1-4 and 8-9.

#### Expected Results
- Account state stores and resolves `activeStorageId` in addition to `activeAccountId`.
- Existing snapshot directories are migrated to user-aware storage ids without losing prior account metadata.
- The active account follows the actual active `auth.json` when possible.
- Stale loading quota rows are retried instead of staying permanently in `Fetching account details`.
- Unknown plan-type decode failures recover quota payloads through the rate-limit recovery helper.
- Invalid or malformed auth produces visible account/action errors.
- Light and dark themes both render account rows, quota messages, error banners, and action buttons without light-theme surfaces in dark mode.

#### Rollback/Cleanup
- Restore or delete isolated `CODEX_HOME` directories used for malformed-auth testing.
- If testing with real account snapshots, back up `accounts.json` and `accounts/` before migration checks.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Thread Loading Stability

#### Feature/Change Name
Thread selection error states, active-thread completion refresh, optimistic user-message dedupe, and cached message loading.

#### Prerequisites/Setup
1. Use the upstream-sync branch.
2. Start the app with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Have at least one normal thread, one long thread with older turns available, and one thread id that no longer exists.
4. Keep the persistent `5173` server untouched if it exists.

#### Steps
1. In light theme, open a normal existing thread and confirm the latest messages render.
2. Send a new message in an existing thread and confirm the user text remains visible while the turn is running.
3. Wait for completion and confirm the active thread refreshes to the persisted final answer without duplicating the user message.
4. Open a missing/deleted direct thread route, for example `#/thread/<missing-thread-id>`.
5. Confirm the conversation area shows an in-chat error instead of an indefinite loading state.
6. Open a long thread and confirm the initial load shows the latest messages first.
7. Click the load-earlier control and confirm older turns prepend without losing the latest messages.
8. Rapidly switch between two threads while one is loading and confirm messages from the previous thread do not remain visible in the selected thread.
9. Switch to dark theme and repeat steps 1-7.
10. Run `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_ROUTE='#/thread/<thread-id>' PROFILE_WAIT_MS=7000 pnpm run profile:browser`.
11. Open the generated profile JSON and inspect `duplicateCounts`, `warnings`, `totalApiKB`, `topApiSummary`, and `slowestApiRows`.

#### Expected Results
- `selectThread` distinguishes successful loads, missing threads, and generic errors.
- Missing thread routes surface a transient live-overlay error in the selected conversation.
- Active completion events refresh already loaded threads after the message-load reuse window expires.
- Equivalent persisted user messages replace optimistic user messages instead of rendering duplicates.
- Silent refreshes preserve non-persisted in-flight messages until equivalent persisted content arrives.
- Long threads can load older turns on demand while keeping the current message cache stable.
- Light and dark themes both render loading states, live overlay errors, load-earlier controls, and stop controls without light-theme surfaces in dark mode.

#### Rollback/Cleanup
- Archive or delete temporary test threads created for the manual checks.
- Keep profile artifacts until their summary numbers have been copied into the PR or issue comment.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Git Dropdown And Commit Review Workflows

#### Feature/Change Name
Header Git branch dropdown commit search/detail panel, lazy commit file loading, copyable commit refs, and commit-scoped review pane.

#### Prerequisites/Setup
1. Use the upstream-sync branch.
2. Start the app with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Open a thread whose `cwd` is a Git repository with at least several local commits.
4. Have a disposable repository or branch available before testing reset-to-commit actions.

#### Steps
1. In light theme, open the header Git branch dropdown.
2. Confirm the review row shows worktree changed-line counts and toggles the review pane.
3. Select the current branch in the dropdown and confirm commits load without opening file details for every commit.
4. Search commits by short sha, full sha fragment, subject text, and date text.
5. Select one commit and confirm a commit detail panel opens.
6. Confirm the commit detail panel lazily loads only that commit's changed files and shows added/removed line counts.
7. Click the commit ref and paste into a text field to confirm the full commit sha was copied.
8. Click a changed file in the commit detail panel and confirm ReviewPane opens in commit scope with that file selected.
9. Switch ReviewPane back to normal worktree review from the dropdown review row and confirm staged/unstaged actions remain available.
10. On a disposable local branch, verify reset-to-commit is available for local branches and unavailable for remote branches.
11. Switch to dark theme and repeat steps 1-8.
12. At 375x812 and 768x1024 viewport sizes, confirm the dropdown, commit detail panel, and ReviewPane mobile file sheet remain usable.

#### Expected Results
- Branch search and commit search filter the correct lists independently.
- Commit lists use `/codex-api/git/branch-commits` and commit file lists use `/codex-api/git/commit-files` only after a commit is selected.
- Commit file rows show status labels, paths, rename previous paths when present, and added/removed line counts.
- Copy commit ref uses clipboard when available and falls back to text selection copy.
- ReviewPane commit scope loads `/codex-api/review/snapshot?scope=commit&commitSha=<sha>` and is read-only for bulk workspace actions.
- Workspace/base-branch ReviewPane behavior still supports staged/unstaged actions and normal review findings.
- Dark theme renders dropdown panels, commit details, file rows, and ReviewPane without light strips or unreadable text.

#### Rollback/Cleanup
- Reset or delete disposable branches used for reset-to-commit testing.
- Revert any temporary staged/unstaged file changes in test repositories.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### File Change Undo And Redo

#### Feature/Change Name
Assistant file-change summary undo/redo actions for a single turn.

#### Prerequisites/Setup
1. Use the upstream-sync branch.
2. Start the app with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Open a thread whose `cwd` is a disposable Git repository.
4. Create and commit a small baseline file, for example `notes.txt`, before asking the assistant to edit it.

#### Steps
1. In light theme, ask the assistant to update `notes.txt` with a small text change.
2. Wait for the assistant turn to complete and expand the file-change summary.
3. Confirm the summary shows an `Undo` action.
4. Click `Undo` and confirm the file content returns to the baseline content for that turn.
5. Confirm the same summary now shows `Redo`.
6. Click `Redo` and confirm the assistant change is applied again.
7. Ask the assistant to add a new disposable file and repeat Undo/Redo.
8. Ask the assistant to move or rename a disposable file and repeat Undo/Redo.
9. For a partial-failure check, manually edit the changed file between Undo and Redo, then click `Redo`.
10. Confirm a per-summary error message appears if the patch cannot be applied cleanly.
11. Switch to another thread and back, then confirm stale pending/error/action state does not bleed into the other thread.
12. Switch to dark theme and repeat steps 2-6.

#### Expected Results
- File-change summaries with a turn id show `Undo`.
- Undo calls the file-change rollback endpoint for the active thread and selected turn only.
- Successful Undo returns patch ids and changes the action to `Redo`.
- Redo reuses the stored patch ids and reapplies the same turn changes.
- Partial failures show a visible error on the affected summary without crashing the app.
- Thread switching clears local undo/redo/error state.
- Light and dark themes both render the action button, pending labels, error text, file list, and diff viewer without unreadable text or light-theme button surfaces in dark mode.

#### Rollback/Cleanup
- Restore or delete the disposable Git repository used for file-change testing.
- Revert temporary assistant-created files with Git or manual cleanup.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Chat Markdown Links And Composer Attachments

#### Feature/Change Name
Chat markdown/file-link rendering, inline code marker isolation, composer attachment paste/drop, and viewport-clamped composer dropdowns.

#### Prerequisites/Setup
1. Use the upstream-sync branch.
2. Start the app with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Use the `TestChat` project/thread context or a disposable project with at least one thread.
4. Have a small image and a small text file available for paste/drop attachment checks.

#### Steps
1. In light theme, send or load a message containing a unique marker plus `**[Example](https://example.com/path?x=1).**`.
2. Confirm the rendered link text is `Example`, the literal `**` markers are not shown around the link, and the final period is outside the clickable link.
3. Send or load `https://example.com/path?x=1.` and confirm the period is not part of the link href.
4. Send or load `` `https://example.com/code?q=1` `` and confirm it renders as a clickable URL.
5. Send or load `` `src/App.vue` `` and confirm it renders as a file link resolved relative to the thread `cwd`.
6. Send or load `[\`hosting_manager.py\`](/home/ubuntu/Documents/New Project (2)/hosting_manager.py)` and confirm the title/href preserve spaces and parentheses correctly.
7. Send or load inline code such as `` `**not bold** and *not italic*` `` and confirm it stays a single inline-code segment.
8. Paste an image into the composer and confirm an image attachment chip appears.
9. Drag and drop a file onto the composer input and confirm a file attachment chip appears.
10. Send a message with file attachments and confirm the sent user message shows visible file chips.
11. Open provider/model/skills/project dropdowns near the left and right viewport edges and confirm menus stay inside the viewport.
12. Repeat steps 1-7 and 11 in dark theme.

#### Expected Results
- Markdown URL labels, trailing punctuation, backticked URLs, and markdown file links render without leaking raw markdown markers.
- Backticked bare filenames become file links when resolvable relative to `cwd`.
- Inline code containing asterisks does not create nested bold/italic segments.
- File-link `href`, `title`, and visible text remain correct for spaces and parentheses.
- Clipboard image paste and file drag/drop produce composer attachment chips.
- Sent user file attachments remain visible in chat.
- Composer dropdowns use app menus, clamp inside the viewport, and keep resize/scroll listeners only while open.
- Light and dark themes both render links, inline code, file chips, dropdown menus, and hover states with readable colors.

#### Rollback/Cleanup
- Delete any disposable files or images created for attachment checks.
- Remove temporary TestChat threads if real threads were used instead of mocked Playwright data.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Automation Editor Dropdowns And Small Viewports

#### Feature/Change Name
Automation editor small-viewport scrolling, sticky actions, app dropdown controls, and dark-theme action row styling.

#### Prerequisites/Setup
1. Use the upstream-sync branch.
2. Start the app with `pnpm run dev --host 127.0.0.1 --port 4173`.
3. Open a project with at least one existing chat so the automation target picker has a thread target.
4. Set the browser viewport to a short mobile-like size, for example `390x520`.

#### Steps
1. In light theme, open the `Automations` route.
2. Click `New automation`.
3. Confirm the automation editor opens with a target picker, name, prompt, schedule, status, and action buttons.
4. Confirm the editor panel scrolls vertically instead of overflowing the viewport.
5. Scroll to the bottom and confirm the Cancel/Save action row stays reachable and sticky.
6. Open the target dropdown and confirm it uses the app dropdown with search, not a native select.
7. Switch schedule mode to `Interval`, open the unit dropdown, and confirm the menu stays inside the viewport.
8. Open the status dropdown and confirm it uses the app dropdown.
9. Switch to dark theme and repeat steps 2-8.

#### Expected Results
- The automation editor panel stays inside the viewport and scrolls when content is taller than the screen.
- The action row remains visible/reachable at the bottom of the scrolling panel.
- Target, interval unit, and status controls use `ComposerDropdown`; no native `select` elements remain inside the automation editor.
- Dropdown menus clamp inside the viewport on short screens.
- In dark theme, the sticky action row, dropdown triggers, text inputs, schedule row, target picker, and buttons use dark surfaces with readable text.
- Existing create/edit/pause/resume/delete automation behavior remains unchanged.

#### Rollback/Cleanup
- Delete any disposable automation created during manual testing.
- Remove temporary TestChat threads if mocked data was not used.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Browser Annotation Browser Binding

#### Feature/Change Name
Extension-level Browser Binding for browser annotation pairing.

#### Prerequisites/Setup
1. Use a branch containing the browser binding endpoint and extension updates.
2. Run the focused checks from the repository root:
   - `pnpm exec vitest run src/server/browserAnnotationBinding.test.ts src/server/browserAnnotationListen.test.ts`
   - `node extension/browser-annotation/dev/pairing-client-smoke.mjs`
   - `node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`
3. For manual UI verification, load `extension/browser-annotation` as an unpacked Chrome extension.
4. Start Codex UI locally with `pnpm run dev --host 127.0.0.1 --port 4173`.

#### Steps
1. In Codex UI, create or obtain a browser binding pairing code from the authenticated app surface.
2. Open the extension side panel on an ordinary `http(s)` page.
3. In light theme, set `Server URL` to the local or HTTPS Codex UI server and paste the browser binding pairing code.
4. Click `Save and validate`.
5. Confirm the extension reports a connected browser binding without showing a thread id or session id.
6. Confirm the side panel does not expose the binding bearer token in visible UI state.
7. Seed or simulate a legacy thread-level listen binding in extension local storage and refresh the side panel.
8. Confirm the extension shows a reconnect-required state instead of silently using the legacy listen token.
9. Click disconnect and confirm the browser binding is cleared locally.
10. Repeat the visible side panel checks in dark theme.

#### Expected Results
- Browser Binding pairing succeeds without selecting or creating a thread-level listen session.
- Binding status uses `/codex-api/extension/binding/status` and does not return the bearer token in public state.
- Legacy listen-session bindings are treated as obsolete and require reconnect.
- `Send Queue` is not enabled by the new browser binding alone until a later Annotation Destination flow is implemented.
- Light and dark themes both show connected, reconnect-required, and disconnected states with readable text.

#### Rollback/Cleanup
- Remove the unpacked extension if it was loaded only for this test.
- Clear extension storage for `browserAnnotation.binding`, `browserAnnotation.settings`, and `browserAnnotation.pairingToken` if manual test data remains.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Browser Annotation Binding Code UI

#### Feature/Change Name
Codex UI Browser Binding code generation for the annotation extension.

#### Prerequisites/Setup
1. Use a branch containing the Browser Binding UI fix.
2. Run the focused checks from the repository root:
   - `pnpm exec vitest run src/api/codexGateway.test.ts src/composables/useBrowserAnnotationListener.test.ts`
   - `pnpm exec vitest run src/server/browserAnnotationBinding.test.ts src/server/browserAnnotationListen.test.ts src/api/codexGateway.test.ts src/composables/useBrowserAnnotationListener.test.ts`
   - `pnpm run test:browser-annotation`
   - `pnpm run build:frontend`
   - `node extension/browser-annotation/dev/sidepanel-host-permission-smoke.cjs`
3. For manual UI verification, start Codex UI with `pnpm run dev --host 127.0.0.1 --port 4173`.
4. Load `extension/browser-annotation` as an unpacked Chrome extension.

#### Steps
1. Open Codex UI in light theme.
2. Open `Settings` > `Advanced`.
3. Confirm the row is labeled `Browser binding`, not `Listen settings`.
4. Open the Browser Binding panel and click `Create code`.
5. Confirm the panel shows `Status`, `Scope Browser binding`, `Expires`, an origin-only `Server URL`, and a `Browser binding code`.
6. Copy the Server URL and Browser Binding code into the extension `Settings` tab.
7. Click `Save and validate`.
8. Confirm the extension connects and does not show `Invalid or expired browser binding pairing code`.
9. Confirm creating the code does not require a selected thread and does not show a thread id in the Browser Binding panel.
10. Switch Codex UI and the extension side panel to dark theme and repeat the visible checks.

#### Expected Results
- Codex UI calls `/codex-api/extension/binding/start`, not `/codex-api/extension/listen/start`, when creating the code.
- The copied Server URL is the app origin, for example `https://codex-ui.todo-tg-app.ru`, not a `/codex-api/extension/listen` endpoint.
- A new extension build accepts the Browser Binding code and stores only the long-lived binding token after validation.
- Old thread-level listen tokens are not presented as the new Browser Binding code.
- Light and dark theme text, buttons, chips, and copy fields remain readable.

#### Rollback/Cleanup
- Click `Clear` in the Browser Binding panel if a temporary code is visible.
- Disconnect the extension binding if manual validation created one.
- Clear extension storage for `browserAnnotation.binding`, `browserAnnotation.settings`, and `browserAnnotation.pairingToken` if needed.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Browser Annotation Feature Menu Cleanup

#### Feature/Change Name
Remove obsolete thread-menu `Listen` browser annotation action.

#### Prerequisites/Setup
1. Use a branch containing the feature-menu cleanup.
2. Run the focused checks from the repository root:
   - `pnpm exec vitest run src/App.browserAnnotationMenu.test.ts`
   - `pnpm run build:frontend`
3. For manual UI verification, start Codex UI with `pnpm run dev --host 127.0.0.1 --port 4173`.

#### Steps
1. Open Codex UI in light theme.
2. Open any thread or the new-thread screen where the top-right `...` thread feature menu is visible.
3. Click the `...` menu.
4. Confirm the menu contains `Side` and any available voice actions, but does not contain `Listen`, `Stop Listen`, or an annotation lightning-row action.
5. Open `Settings` > `Advanced` and confirm `Browser binding` remains available there.
6. Switch to dark theme and repeat steps 3-5.

#### Expected Results
- The old thread-level browser annotation `Listen` action is absent from the top-right feature menu.
- Browser annotation setup remains available only through `Settings` > `Advanced` > `Browser binding`.
- The feature menu trigger no longer shows active state solely because a Browser Binding code is active.
- Light and dark theme menu text remains readable.

#### Rollback/Cleanup
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Browser Annotation Extension Thread Selector

#### Feature/Change Name
Choose the Codex project/thread destination inside the Browser Annotation extension.

#### Prerequisites/Setup
1. Use a branch containing the extension thread selector change.
2. Run the focused checks from the repository root:
   - `pnpm exec vitest run src/server/browserAnnotationListen.test.ts src/server/browserAnnotationThreads.test.ts src/App.browserAnnotationExtensionSidepanel.test.ts`
   - `node extension/browser-annotation/dev/pairing-client-smoke.mjs`
   - `node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`
   - `pnpm run pack:browser-annotation`
   - `pnpm run build:frontend`
3. For manual UI verification, start Codex UI with `pnpm run dev --host 127.0.0.1 --port 4173`.
4. Load `extension/browser-annotation` or the packaged unpacked extension as an unpacked Chrome extension.

#### Steps
1. Open Codex UI in light theme.
2. In Codex UI, open `Settings` > `Advanced` > `Browser binding`, create a Browser Binding code, and copy the Server URL and code.
3. In the extension side panel, open `Settings`, paste the Server URL and Browser Binding code, then click `Save and validate`.
4. Return to `Main` and confirm the `Destination` section appears with `Project`, `Thread`, and `Refresh`.
5. Select the `codexUI` project and the active browser annotation thread.
6. Add one annotation or page note to the queue.
7. Confirm `Send Queue` is disabled until a thread is selected, then enabled after selecting a thread.
8. Click `Send Queue` and confirm the batch appears in the selected Codex UI thread.
9. Switch Codex UI and the extension side panel to dark theme and repeat steps 4-8.

#### Expected Results
- The extension lists recent Codex projects and threads after persistent Browser Binding validation.
- The user selects the destination in the extension; no old Codex UI `Listen` action is required.
- Sending the queue creates a scoped listen session for the selected thread and leaves the persistent Browser Binding connected.
- Light and dark theme dropdowns, status text, buttons, and queue controls remain readable.

#### Rollback/Cleanup
- Disconnect the extension binding if manual validation created one.
- Clear extension storage for `browserAnnotation.binding`, `browserAnnotation.threadTarget`, `browserAnnotation.settings`, and `browserAnnotation.pairingToken` if needed.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### Browser Annotation Draft, Screenshot State, And Queue Detail

#### Feature/Change Name
Browser annotation Pick on Page, Draft Annotation save flow, screenshot states, queue row/detail review, panel mode control, and Diagnostics wording.

#### Prerequisites/Setup
1. Use a branch containing the browser annotation panel UX update.
2. Run the focused checks from the repository root:
   - `pnpm exec vitest run src/App.browserAnnotationExtensionSidepanel.test.ts --reporter=verbose`
   - `node extension/browser-annotation/dev/content-draft-annotation-smoke.cjs`
   - `node extension/browser-annotation/dev/content-overlay-cancel-smoke.cjs`
   - `node extension/browser-annotation/dev/sidepanel-host-permission-smoke.cjs`
   - `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`
3. For manual UI verification, load `extension/browser-annotation` or the packaged unpacked extension as an unpacked Chrome extension.
4. Open a normal `http(s)` page and connect Browser Binding if sending to Codex UI will be tested.

#### Steps
1. In light theme, open the Annotation Panel and confirm the primary action says `Pick on Page`, not `Inject Overlay`.
2. Confirm the panel shows separate Binding, Destination, Catalog, Queue, and Diagnostics concepts.
3. Change Panel mode between `Float` and `Dock`, close/reopen the panel, and confirm the selected mode remains.
4. Click `Pick on Page`, select an element, and confirm an inline Draft Annotation appears with comment, mic, screenshot toggle, `Save to Queue`, and cancel controls.
5. Type a comment and confirm the queue remains unchanged until `Save to Queue`.
6. Click `Save to Queue` and confirm a Queue Row appears with a comment preview, screenshot state, clickable thumbnail/detail action, and reorder/delete controls.
7. Click the thumbnail/detail action and confirm Queue Item Detail opens inside the panel with full comment, screenshot state, metadata, and Back control.
8. Simulate or inspect a failed screenshot item and confirm `Screenshot Failed` is shown; `Send Queue` remains blocked until `Send without screenshot` is chosen.
9. Switch to dark theme and repeat steps 1-7, confirming text, buttons, queue rows, detail, and Diagnostics controls remain readable.

#### Expected Results
- Picking a page target creates a Draft Annotation, not an immediate queue item.
- `Save to Queue` is the only action that turns a Draft Annotation into a queue item.
- Ordinary selected page annotations never show `No preview`; they show Screenshot Ready, Screenshot Failed, Screenshot Off, or pending/uploading state.
- Failed screenshots block sending until the user explicitly retries or chooses to send without screenshot.
- Queue Item Detail opens inside the Annotation Panel and does not require a new browser tab.
- Light and dark theme surfaces remain readable.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions` if loaded only for this test.
- Clear extension storage for `browserAnnotation.annotationQueue`, `browserAnnotation.threadTarget`, `browserAnnotation.binding`, and `browserAnnotation.panelMode` if manual test state should be removed.

---

### Browser Annotation Page-Side Floating Panel

#### Feature/Change Name
Page-side floating mini panel for active browser annotation mode.

#### Prerequisites/Setup
1. Use a branch containing the floating panel content-script change.
2. Run the focused checks from the repository root:
   - `node --check extension/browser-annotation/content/content-script.js`
   - `node --check extension/browser-annotation/dev/content-floating-panel-smoke.cjs`
   - `node extension/browser-annotation/dev/content-floating-panel-smoke.cjs`
3. For manual UI verification, load `extension/browser-annotation` as an unpacked Chrome extension.
4. Open a normal `http(s)` page and connect Browser Binding if queue save behavior will be tested.

#### Steps
1. In light theme, open the Annotation Panel and click `Pick on Page`.
2. Confirm a compact `Codex annotation` floating panel appears at the page side while annotation mode is active.
3. Confirm the panel shows Pick on Page state and a Pause control before selecting anything.
4. Select an element and confirm the page-side panel stays fixed while exposing draft controls for comment, voice, screenshot, and save.
5. Cancel the draft from the inline annotation controls and confirm the page-side panel remains visible with Pick on Page active state.
6. Save a draft to the queue and confirm the panel shows the saved state and queue count when the content script already receives that count.
7. Click Pause and confirm annotation mode exits and the page-side panel hides.
8. Switch the browser/page to a dark background or dark theme test page and repeat steps 1-5.

#### Expected Results
- The floating panel is created inside the content-script Shadow DOM and does not require the Chrome side panel to remain open.
- The panel does not poll storage or background state; queue count appears only after local draft/queue responses include it.
- Existing inline draft controls and save behavior continue to work.
- Light and dark theme page states keep the floating panel readable.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions` if loaded only for this test.
- Clear extension storage for `browserAnnotation.annotationQueue` if manual queue saves should be removed.

---

### Browser Annotation Destination Catalog Cache

#### Feature/Change Name
Saved Destination and stale Destination Refresh catalog cache.

#### Prerequisites/Setup
1. Use a branch containing the service-worker destination catalog cache change.
2. Run the focused checks from the repository root:
   - `node --check extension/browser-annotation/shared/constants.js`
   - `node --check extension/browser-annotation/service-worker/service-worker.js`
   - `node --check extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`
   - `node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`
3. For manual UI verification, load `extension/browser-annotation` as an unpacked Chrome extension and connect Browser Binding to a Codex UI server with at least one available destination thread.

#### Steps
1. In light theme, open the Annotation Panel, refresh Destination Catalog, and select a destination thread.
2. Close and reopen the panel and confirm the selected destination is still shown.
3. Temporarily make the destination catalog endpoint fail, such as by stopping the backing server or blocking `/codex-api/extension/threads`.
4. Reopen the panel or trigger the existing refresh path and confirm the prior project/thread catalog still appears with the saved destination selected.
5. Switch to dark theme and repeat steps 1-4, confirming Destination and Catalog text remains readable.

#### Expected Results
- A successful catalog refresh persists sanitized destination groups under `browserAnnotation.threadTargetCatalog`.
- A transient thread catalog refresh failure does not clear `browserAnnotation.threadTarget`.
- The panel state returns the cached groups and selected thread with stale catalog metadata instead of an empty hard-unavailable catalog.
- Light and dark theme Destination/Catalog surfaces remain readable.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions` if loaded only for this test.
- Clear extension storage for `browserAnnotation.threadTargetCatalog`, `browserAnnotation.threadTarget`, and `browserAnnotation.binding` if manual test state should be removed.

---

### Browser Annotation Screenshot Asset Send

#### Feature/Change Name
Upload ready annotation screenshots as server assets before sending the queue.

#### Prerequisites/Setup
1. Use a branch containing the screenshot asset upload/send change.
2. Run the focused checks from the repository root:
   - `node --check extension/browser-annotation/shared/annotation-queue.js`
   - `node --check extension/browser-annotation/service-worker/service-worker.js`
   - `node --check extension/browser-annotation/dev/annotation-queue-smoke.mjs`
   - `node --check extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`
   - `node extension/browser-annotation/dev/annotation-queue-smoke.mjs`
   - `node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs`
3. For manual UI verification, start Codex UI with `pnpm run dev --host 127.0.0.1 --port 4173`.
4. Load `extension/browser-annotation` as an unpacked Chrome extension and connect Browser Binding to a destination thread.

#### Steps
1. In light theme, click `Pick on Page`, select a visible element, leave screenshot enabled, and click `Save to Queue`.
2. Confirm the queue row shows a ready screenshot thumbnail/detail, not `No preview`.
3. Click `Send Queue` and inspect network/service-worker logs.
4. Confirm the extension first POSTs the cropped screenshot to `/codex-api/extension/assets/upload` as multipart `kind=screenshot`.
5. Confirm the later `/codex-api/extension/annotation-batch` body includes an `annotation-screenshot` asset and the item references it with `screenshotAssetId`.
6. Confirm the batch body does not include `preview.dataUrl` or any `data:image` string.
7. Confirm the selected Codex thread receives the batch with the screenshot attached.
8. Switch Codex UI and the extension side panel to dark theme and repeat steps 1-7.

#### Expected Results
- Ready screenshots are uploaded before the annotation batch is sent.
- The annotation batch carries only asset metadata and the server-issued `/codex-local-image` reference.
- If screenshot upload fails, the local queue remains available for retry instead of being cleared.
- Light and dark theme queue rows, details, send controls, and received batch rendering remain readable.

#### Rollback/Cleanup
- Remove the unpacked extension from `chrome://extensions` if loaded only for this test.
- Clear extension storage for `browserAnnotation.annotationQueue`, `browserAnnotation.threadTarget`, and `browserAnnotation.binding` if manual test state should be removed.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.

---

### ChatGPT Pro-Control Consultation Workflow

#### Feature/Change Name
ChatGPT Pro-control worker, task queue, repo bundle helper, requested-files follow-up, attachments, audit log, and failure surfacing.

#### Prerequisites/Setup
1. Use a branch containing the Pro-control backend, extension, and helper changes.
2. For automated contract checks, run from the repository root:
   - `pnpm exec vitest run src/server/proControl.test.ts`
   - `node --check extension/browser-annotation/service-worker/service-worker.js`
   - `node --check extension/browser-annotation/sidepanel/sidepanel.js`
   - `node extension/browser-annotation/dev/validate-extension.mjs`
   - `node extension/browser-annotation/dev/pairing-client-smoke.mjs`
   - `pnpm run pro:bundle -- "bundle smoke"`
   - `pnpm run pack:browser-annotation`
3. For manual UI verification, start Codex UI with `pnpm run dev --host 127.0.0.1 --port 4173`.
4. Load the browser annotation extension in a Chrome profile that is logged into ChatGPT Pro.
5. Pair Browser Binding from Codex UI.

#### Steps
1. In light theme, open the extension sidepanel and confirm the `ChatGPT Pro` section is visible.
2. Click `Enable`, approve `https://chatgpt.com/*`, and confirm the Pro-control state becomes online or idle.
3. Disable Pro-control, enable it again, deny the permission prompt if Chrome offers it, and confirm `Permission missing` is shown without starting polling.
4. Re-enable with permission granted.
5. Run `pnpm run pro:consult -- "Проверь текущую задачу и верни короткий ответ"`.
6. Confirm the extension opens or focuses `chatgpt.com`, sends a prompt with `[Codex Pro task: <taskId>]`, waits for a final answer, and returns copied text or DOM fallback text.
7. Confirm `.codex/pro-control/consultations/<timestamp>/` contains `prompt.md`, `raw-pro-answer.md`, `codex-assessment.md`, `metadata.json`, `bundle/`, and attachment folders when ChatGPT produced files.
8. If ChatGPT requests additional files using a final `requestedFiles` JSON block, confirm the helper uploads allowed files, blocks denied paths, and stops after at most three follow-ups.
9. If ChatGPT returns downloadable attachments, confirm allowed files are saved under audit attachments and patches are applied only after `git apply --check`.
10. Switch the extension sidepanel and ChatGPT/Codex browser environment to dark theme and repeat steps 1-4.

#### Expected Results
- Internal Pro-control task creation requires the server token; browser binding tokens cannot create tasks.
- Extension polling requires a browser binding token; the internal token cannot poll as a worker.
- A worker claims one task at a time, posts running heartbeats, and returns completed or failed states.
- Per-thread session keys use `projectId:codexThreadId`, and follow-up tasks reuse saved conversation URLs.
- Repo bundles exclude `.git/`, `node_modules/`, generated artifacts, `.env*`, credentials, browser profiles, and over-limit files.
- Over-limit full bundles fall back to reduced bundles with warnings in prompt and metadata.
- Audit metadata records task id, session key, bundle mode, warnings, read method, execution mode, attachments, and failure details.
- Light and dark theme Pro-control status surfaces remain readable.

#### Rollback/Cleanup
- Disable Pro-control in the sidepanel.
- Remove the unpacked extension from `chrome://extensions` if loaded only for this test.
- Clear extension storage keys `browserAnnotation.proControl` and `browserAnnotation.binding` if manual test state should be removed.
- Remove `.codex/pro-control/consultations/` and `.codex/pro-control/bundles/` if local audit artifacts are no longer needed.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.
