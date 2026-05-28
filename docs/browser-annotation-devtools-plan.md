# Browser Annotation + DevTools Integration Plan

Target domain: `annotate.todo-tg-app.ru`

Goal: implement all phases for a Chrome extension and Codex UI integration that lets the user collect multiple browser annotations, DevTools Network/Console context, screenshots, and voice notes, then send the batch into the active Codex UI thread.

## Operating Rules

- Treat the OpenAI key pasted in chat as compromised. Do not use it, store it, commit it, or echo it. First implementation phase must require key rotation and server-side env storage.
- Extension must never contain provider API keys. Voice transcription runs through Codex UI server endpoints.
- DevTools access uses explicit user action and clear attach/detach state. Prefer least-privilege extension permissions outside DevTools mode.
- Keep each stage independently smoke-testable.
- Update this document's work log and checkboxes after every completed stage and phase.
- Update [tests.md](../tests.md) after every implemented feature or changed UI.
- Follow repository instructions in [AGENTS.md](../AGENTS.md), especially performance audits, dark-theme verification, Playwright evidence when requested, and post-task commits.

## Sub-Agent Execution Protocol

Every implementation stage in this plan must use a worker-then-reviewer loop before the stage can be marked complete. The default execution mode is controlled parallelism: up to 3 worker sub-agents may implement independent stages at the same time, and up to 3 reviewer sub-agents may review completed worker outputs at the same time.

Required sequence for each stage:

1. Main agent selects one unchecked stage from the current phase and assigns it a stage owner.
2. Main agent declares the intended write scope for that stage before spawning the worker.
3. Main agent spawns one worker sub-agent for that stage.
4. Worker immediately inspects the current worktree and reports its intended write set before making edits when the stage may touch shared files.
5. Main agent confirms the write set is disjoint from active workers before the worker proceeds.
6. Worker owns the stage implementation and must:
   - inspect the current worktree before editing;
   - avoid reverting unrelated changes;
   - make only stage-scoped edits inside the approved write set;
   - stop and ask the main agent before editing any file outside the approved write set;
   - stop and ask the main agent if another active worker has changed or may change the same file;
   - run the stage smoke test when feasible;
   - report checklist/work-log updates needed for this plan;
   - report changed files, commands run, test results, and any unresolved risks back in chat.
7. Main agent waits for the worker result and reviews the worker's changed files.
8. Main agent spawns a separate reviewer sub-agent for the same stage.
9. Reviewer must:
   - inspect the worker changes from a review stance;
   - verify the stage checklist and smoke-test evidence;
   - look for correctness, security, performance, regression, and missing-test risks;
   - report findings in chat with file/line references where applicable;
   - not make unrelated edits.
10. If reviewer finds issues, main agent sends fixes to the worker or applies a narrowly scoped fix, then repeats review as needed.
11. When review passes, main agent closes both worker and reviewer sub-agents.
12. Main agent updates this plan if the worker did not already do so, then commits that completed stage.
13. Move to the next dependent stage only after the prior stage is reviewed, checked off, and committed.

Parallel execution rules:

1. Main agent may keep at most 3 worker sub-agents active at once.
2. Main agent may keep at most 3 reviewer sub-agents active at once.
3. Parallel stages must have disjoint write scopes. If write scopes overlap, the main agent serializes those stages.
4. Shared coordination files are main-agent-owned by default:
   - `docs/browser-annotation-devtools-plan.md`
   - `tests.md`
   - `package.json`
   - lockfiles
   - deployment files under `ops/`
5. A worker may edit a shared coordination file only when the main agent explicitly grants that file in the worker's write scope.
6. In parallel mode, workers should usually report plan/test-doc updates instead of editing shared coordination files directly; the main agent applies those shared-file updates after merging worker results.
7. If a worker discovers it needs a file owned by another active worker, it must stop and request main-agent coordination instead of editing the file.
8. If two completed workers produce conflicting changes, the main agent resolves the conflict intentionally and may request a follow-up review before committing.
9. Reviewers may run in parallel only when they review distinct completed stages or explicitly separated file sets.
10. No worker may start implementation for a stage that depends on an unreviewed or uncommitted prior stage.

Legacy single-stage sequence:

When the main agent intentionally runs only one worker, the same worker-reviewer loop still applies:

1. Main agent selects exactly one unchecked stage from the current phase.
2. Main agent spawns one worker sub-agent for that stage.
3. Worker owns the stage implementation and must:
   - inspect the current worktree before editing;
   - avoid reverting unrelated changes;
   - make only stage-scoped edits;
   - run the stage smoke test when feasible;
   - update this plan's Work Log and the stage checklist items it completed;
   - report changed files, commands run, test results, and any unresolved risks back in chat.
4. Main agent waits for the worker result and reviews the worker's changed files.
5. Main agent spawns a separate reviewer sub-agent for the same stage.
6. Reviewer must:
   - inspect the worker changes from a review stance;
   - verify the stage checklist and smoke-test evidence;
   - look for correctness, security, performance, regression, and missing-test risks;
   - report findings in chat with file/line references where applicable;
   - not make unrelated edits.
7. If reviewer finds issues, main agent sends fixes to the worker or applies a narrowly scoped fix, then repeats review as needed.
8. When review passes, main agent closes both worker and reviewer sub-agents.
9. Main agent updates this plan if the worker did not already do so, then commits that completed stage.
10. Move to the next stage only after the prior stage is reviewed, checked off, and committed.

Required sequence for each phase:

1. After all stages in a phase are complete, main agent runs the phase full regression, linter gate, coverage gate, and performance audit listed for that phase.
2. Main agent records all results in the Work Log.
3. Main agent spawns a reviewer sub-agent for the whole phase before marking the phase complete.
4. If phase review passes, main agent closes the reviewer, checks off the phase regression items, and commits the phase completion/doc updates.

Sub-agent lifecycle rule:

- Do not leave worker or reviewer agents open after their stage or phase review is complete.
- Do not run multiple implementation workers on the same stage at the same time.
- If a worker is blocked, record the blocker in the Work Log and do not advance that stage until the blocker is resolved or the plan is intentionally revised.

## External Security Prerequisites

Some requirements depend on external account state that cannot be proven from this repository alone.

- The OpenAI key pasted in chat must be revoked and replaced before any real OpenAI transcription call, public deployment, or production extension test.
- Until revocation/replacement is externally confirmed, Stage 0.1 remains partial and the project may continue only through safe preparatory work that does not use a real OpenAI key.
- Safe preparatory work may include local config readers, payload schemas, mock tests, extension UI scaffolding, DevTools capture using local fixtures, and deployment discovery.
- Unsafe work blocked by this prerequisite includes real transcription requests, storing production secrets, production traffic through `annotate.todo-tg-app.ru`, and final phase acceptance.
- When the user confirms rotation/replacement, record the evidence in the Work Log, check the Stage 0.1 revocation item, and run the Stage 0.1 smoke test again without printing the new key.

## Reference Instructions

- Repository workflow and verification rules: [AGENTS.md](../AGENTS.md)
- Manual test documentation format: [tests.md](../tests.md)
- Existing voice/transcription deployment notes: [documentation/VOICE_TRANSCRIPTION_OVERRIDE.md](../documentation/VOICE_TRANSCRIPTION_OVERRIDE.md)
- App-server RPC/MCP surface: [documentation/APP_SERVER_DOCUMENTATION.md](../documentation/APP_SERVER_DOCUMENTATION.md)
- Chrome extension APIs:
  - https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
  - https://developer.chrome.com/docs/extensions/reference/api/debugger
  - https://developer.chrome.com/docs/extensions/reference/api/scripting
  - https://developer.chrome.com/docs/extensions/reference/api/tabs
  - https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/
- Chrome DevTools MCP: https://github.com/ChromeDevTools/chrome-devtools-mcp
- OpenAI Codex MCP: https://developers.openai.com/codex/mcp
- OpenAI Codex browser app docs: https://developers.openai.com/codex/app/browser
- OpenAI Codex Chrome extension docs: https://developers.openai.com/codex/app/chrome-extension
- OpenAI audio docs: https://platform.openai.com/docs/guides/audio

## Test Commands And Gates

Use these gates unless a phase explicitly narrows or expands them.

- Stage smoke tests:
  - Focused unit/script test for the changed module.
  - Focused manual check of the changed UI or endpoint.
  - For UI changes, verify light and dark themes.
- Phase regression:
  - `pnpm run test:unit`
  - `pnpm run build`
  - Relevant endpoint smoke script or CJS smoke test.
  - Browser/manual regression for the whole phase flow.
  - Performance audit per [AGENTS.md](../AGENTS.md): profile with `pnpm run profile:browser` when browser/startup/thread paths change.
- Linter gate:
  - This repo does not currently expose a dedicated `lint` script. Phase 0 must either add one or record the explicit substitute gate. Until then, use `pnpm run build:frontend` and `pnpm run test:unit` as the type/lint substitute.
- Coverage gate:
  - Phase 0 must establish the coverage command/baseline. Proposed command: `pnpm run test:unit -- --coverage` if supported by the current Vitest setup; otherwise add the minimal coverage provider/config and document the threshold.
  - No phase is complete until its coverage gate is run or a blocking reason is recorded here.

## Work Log

| Date | Phase | Stage | Status | Notes |
| --- | --- | --- | --- | --- |
| 2026-05-28 | Planning | Plan document | Completed | Initial implementation plan created. |
| 2026-05-28 | Planning | Sub-agent protocol | Completed | Added mandatory worker-then-reviewer loop for every stage and phase. |
| 2026-05-28 | Phase 0 | Stage 0.1 | Partial | Added server-only annotation transcription env config and a local smoke script that reports OpenAI key presence without printing the key. Key revocation/replacement remains unconfirmed outside the repo. |
| 2026-05-28 | Planning | Parallel sub-agent protocol | Completed | Added controlled parallelism: up to 3 workers and 3 reviewers, with main-agent ownership of shared files and explicit write-scope conflict handling. |
| 2026-05-28 | Planning | External security prerequisite | Completed | Recorded that safe prep may continue, but real transcription/deploy/final acceptance remain blocked until the pasted OpenAI key is externally revoked/replaced. |
| 2026-05-28 | Phase 0 | Stage 0.1 review | Partial | Reviewer found no code/security findings for commit `a41c264`; `node scripts/test-codexui-annotation-transcription-env.mjs` and `pnpm exec vue-tsc --noEmit --pretty false` passed. External key revocation remains unconfirmed. |
| 2026-05-28 | Phase 0 | Stage 0.2 | Partial | Read-only discovery only. YC CLI reads found cloud `b1g2shga5sgnm7655pla`, folder `b1g9u1oitf2qnll9c2sa`, default zone `ru-central1-a`, DNS zone `dnsdvkis94l119fqhagt` / `todo-tg-app-ru` / `todo-tg-app.ru.`. `annotate.todo-tg-app.ru` resolves via wildcard `*.todo-tg-app.ru -> 45.155.204.47`, has no explicit DNS record, no valid TLS SAN/cert, and no repo nginx vhost. Existing repo nginx example uses filesystem Let's Encrypt paths for `codex.todo-tg-app.ru`; YC Certificate Manager has no `annotate` cert. `nginx -t` was inconclusive as non-root due cert file permissions. |
| 2026-05-28 | Phase 0 | Stage 0.3 | Completed | Fixed the fake-timer queue scheduling test timeout by stubbing constructor queue recovery inside the scheduler test and cleaning fake timers in `finally`. Added `test:coverage` with Vitest Istanbul coverage over TypeScript files, zero baseline thresholds, and explicit optional Tailwind Oxide Linux binding for reliable local builds. `pnpm run test:unit` passed 19 files / 142 tests; `pnpm run build` passed; `pnpm run test:coverage` passed with baseline Statements 18.34%, Branches 15.46%, Functions 21.23%, Lines 19.12%. |
| 2026-05-28 | Phase 0 | Stage 0.4 | Completed | Added `src/api/browserAnnotationContracts.ts` with `AnnotationBatch`, `AnnotationItem`, `DevToolsSnapshot`, `VoiceNote`, uploaded asset records, privacy redaction/body cap helpers, and representative examples. Focused Vitest passed 11 tests; reviewer accepted after privacy fixes for raw redacted/not-captured text, sensitive body fields, UTF-8 caps, and malformed arrays. |
| 2026-05-28 | Phase 0 | Stage 0.2 decision | Completed | Repo-side routing decision recorded: `annotate.todo-tg-app.ru` should be a narrow annotation ingress to the existing Codex UI backend, not a full alternate UI mirror. Public DNS, certificate, and nginx deployment remain Phase 5 tasks because the current hostname resolves via wildcard and lacks a valid TLS SAN. |
| 2026-05-28 | Phase 1 | Stage 1.2 | Completed | Added server pairing endpoints under `/codex-api/extension/listen` with TTL-bound in-memory sessions, SHA-256 token hashes, same-thread replacement, global session cap, route-local malformed JSON handling, and a 16 KiB request body limit. Worker smoke tests passed, reviewer findings were fixed, and re-review found no remaining issues. Verification: `pnpm vitest run src/server/browserAnnotationListen.test.ts --reporter=verbose` passed 8 tests; `pnpm exec vue-tsc --noEmit` passed. Performance audit: code-path analysis only; status/stop are direct lookup when `sessionId` is supplied, token-only fallback scans at most 100 retained sessions. |
| 2026-05-28 | Phase 1 | Stage 1.1 | Completed | Added compact active-thread listener UI, typed gateway helpers, copyable server URL/token, expiry/status display, stop/revoke, active-only token handling, and lifecycle guards for thread changes/unmount during in-flight requests. Codex.app parity pre-check was blocked because `/Applications/Codex.app` is unavailable and no CDP endpoint was exposed in this Linux environment; UI followed local composer/pending-panel patterns. Verification: `pnpm vitest run src/api/codexGateway.test.ts --reporter=verbose` passed 7 tests; `pnpm exec vue-tsc --noEmit` passed. Reviewer race findings were fixed and final re-review found no remaining issues. Performance audit: no startup requests; one start request on click and one 15s status poll only while active. |
| 2026-05-28 | Phase 1 | Stage 1.3 | Completed | Added `POST /codex-api/extension/assets/upload` for paired extension screenshot/crop/audio multipart uploads. Uploads require query `sessionId`/`threadId` plus bearer token and authorize before body buffering, cap request bodies at 15 MiB, allow PNG/WebP/JPEG and WebM/WAV/MP4/MPEG, sanitize/cap filenames, persist under `tmpdir()/codex-web-uploads`, and return local image URLs for image assets. Reviewer findings around early auth and filename length were fixed. Verification: `pnpm vitest run src/server/browserAnnotationAssets.test.ts src/server/browserAnnotationListen.test.ts --reporter=verbose` passed 18 tests; `pnpm exec vue-tsc --noEmit` passed. Performance audit: code-path analysis; one bounded multipart parse and temp-file write per accepted upload, no token/body logging. |
| 2026-05-28 | Phase 1 | Stage 1.4 | Completed | Added server-only `/codex-api/extension/transcribe` endpoint for paired extension audio transcription. The route authorizes the extension bearer/session selector before buffering, validates/caps multipart audio, reads only server env config, calls OpenAI `/v1/audio/transcriptions` with primary model and retryable fallback model, and returns sanitized UI-facing provider errors without exposing keys or provider details. OpenAI docs were checked via Context7 official API reference before implementation. Verification: `pnpm exec vitest run src/server/browserAnnotationTranscribe.test.ts src/server/browserAnnotationListen.test.ts src/server/browserAnnotationAssets.test.ts --reporter=verbose` passed 26 tests; `pnpm exec vue-tsc --noEmit` passed. Reviewer privacy finding was fixed and final re-review found no remaining issues. Performance audit: code-path analysis; at most two sequential provider calls, no disk writes, no browser/startup/thread path changed. |
| 2026-05-28 | Phase 1 | Stage 1.5 | Completed | Added `POST /codex-api/extension/annotation-batch` to validate an `AnnotationBatch`, build one structured prompt with page, annotation, voice, and DevTools context, append it to the existing backend queue, and schedule immediate drain. The route authorizes before JSON body reads, caps batch payloads at 1 MiB, bounds prompt assembly, redacts sensitive URL query values, omits body text for redacted/not-captured states, and accepts image refs only when they were issued by the upload endpoint for the same session/thread. Reviewer found an arbitrary-local-image risk; fixed with session-bound uploaded-image registry. Verification: `pnpm exec vitest run src/server/browserAnnotationBatch.test.ts src/server/browserAnnotationAssets.test.ts src/server/codexAppServerBridge.inlinePayload.test.ts --reporter=verbose` passed 30 tests; `pnpm exec vue-tsc --noEmit` passed. Performance audit: one bounded validation/prompt/queue append path and no direct browser/startup load. |
| 2026-05-28 | Phase 1 | Full regression | Completed | `pnpm run test:unit` passed 23 files / 178 tests. `pnpm run build` passed after fixing the listener panel scoped CSS and dark selector. `pnpm exec vue-tsc --noEmit` passed. `pnpm run test:coverage` passed with Statements 21.14%, Branches 17.8%, Functions 23.47%, Lines 22.02%. Added and ran `pnpm run test:browser-annotation`, passing 6 files / 52 tests. Light/dark listener verification passed on `http://127.0.0.1:4173/` with screenshots `output/playwright/browser-annotation-listener-light.png` and `output/playwright/browser-annotation-listener-dark.png`; dark shell rendered `rgb(24, 24, 27)` and token was hidden after Stop. Performance profile passed with `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_WAIT_MS=7000 pnpm run profile:browser`; report `output/playwright/browser-runtime-profile-home-2026-05-28T08-54-33-849Z.json`, warnings `[]`, duplicateCounts threadList/skills/rateLimits/providerModels all 1, totalApiKB 215. Phase reviewer findings were addressed. |
| 2026-05-28 | Phase 2 | Stage 2.1 | Completed | Added a no-build Manifest V3 extension scaffold under `extension/browser-annotation/` with manifest, service worker, side panel, content script, shared constants/JSDoc contracts, URL guards, local test page, README, and `dev/validate-extension.mjs`. Host permissions are limited to `https://annotate.todo-tg-app.ru/*`; overlay injection is user-triggered via the side panel and blocked for restricted schemes plus Chrome Web Store origins. Verification: `node --check` passed for all extension JS files and `node extension/browser-annotation/dev/validate-extension.mjs` passed. Manual Chrome load-unpacked smoke was documented but not run in this environment. Performance audit: explicit user action performs one active-tab lookup, one bounded `executeScript`, and one content-script message; no Codex UI runtime startup path changed. |
| 2026-05-28 | Phase 2 | Stage 2.2 | Completed | Added extension pairing settings and validation flow. The side panel stores server URL plus the pasted pairing token in extension local storage, validates via `GET /codex-api/extension/listen/status` with `Authorization: Bearer <token>`, and renders connected/disconnected/error states without displaying the raw token outside the password field. Added shared pairing helpers and `dev/pairing-client-smoke.mjs`. Reviewer found local URLs would fail MV3 cross-origin fetch without host permissions; fixed by limiting host permissions to the production origin plus `http://127.0.0.1/*` and `http://localhost/*`. Verification: `node --check` passed for all extension JS/MJS files; `node extension/browser-annotation/dev/validate-extension.mjs` and `node extension/browser-annotation/dev/pairing-client-smoke.mjs` passed. Performance audit: one status fetch only when a token is present, no polling/fanout/large payloads. Manual Chrome pairing remains for Phase 2 regression. |
| 2026-05-28 | Phase 2 | Stage 2.3 | Completed | Added the page annotation overlay and selected-element context capture. The content script still injects only after a side-panel user gesture, creates a Shadow DOM/high-z-index hover and selected overlay, and queues selected element context into bounded extension local storage. Captured context includes selector, XPath fallback, inferred/explicit role, aria labels, text, stable attributes, rect, viewport, page metadata, nearby headings, and labels. Side panel renders queue state from `chrome.storage.onChanged` without polling. Verification: `node --check` passed for all extension JS/MJS files; `node extension/browser-annotation/dev/validate-extension.mjs`, `node extension/browser-annotation/dev/pairing-client-smoke.mjs`, and `node extension/browser-annotation/dev/selection-context-smoke.mjs` passed; `git diff --check -- extension/browser-annotation` passed. Performance audit: listeners are active only during annotation mode, hover rect updates are `requestAnimationFrame`-throttled, no full DOM scan runs on mousemove, context collection happens on click, and queue length is capped at 25. |
| 2026-05-28 | Phase 2 | Stage 2.4 | Completed | Added visible-tab screenshot capture and cropped previews for selected elements. After a selection, the service worker calls `chrome.tabs.captureVisibleTab`, crops the selected rect with `devicePixelRatio`, stores only the cropped preview in the local annotation queue, and renders previews in the side panel. Reviewer found queue previews could exceed Chrome `storage.local` quota; fixed with a 250k data URL per-preview cap and aggregate queue trimming under a 5.5 MB JSON budget via `shared/annotation-queue.js`. Verification: `node --check` passed for all extension JS/MJS files; validator, pairing, selection, annotation-queue, and screenshot-crop smokes passed; `git diff --check -- extension/browser-annotation` passed. Performance audit: no polling, full screenshot is transient, preview queue is count- and byte-bounded. |
| 2026-05-28 | Phase 2 | Stage 2.5 | Completed | Added multi-annotation queue UX: per-annotation notes, edit/delete/reorder controls, page-level batch metadata, and one-click batch send to `/codex-api/extension/annotation-batch` with the stored bearer token. Queue payload builder maps selected element context into `AnnotationBatch` items, includes `sessionId` and `threadId` query selectors, omits local preview data URLs, caps the send body, and clears the queue after success. Reviewer found stale side-panel queue state could keep Send disabled and blank notes omitted `noteText`; fixed both and added smoke assertions. Verification: all extension JS/MJS `node --check` passed; validator, pairing, selection, annotation-queue, and screenshot-crop smokes passed; `pnpm exec vitest run src/server/browserAnnotationBatch.test.ts --reporter=verbose` passed 8 tests; `git diff --check -- extension/browser-annotation` passed. Performance audit: no polling, user-triggered queue mutations only, one status validation plus one bounded POST on send. |
| 2026-05-28 | Phase 2 | Full regression | Completed | Extension static gate passed: `node --check` for all extension JS/MJS files plus validator, pairing, selection, annotation-queue, and screenshot-crop smokes. Server batch gate passed: `pnpm exec vitest run src/server/browserAnnotationBatch.test.ts --reporter=verbose` passed 8 tests and `pnpm run test:browser-annotation` passed 6 files / 52 tests. Repo gates passed: `pnpm run test:unit` passed 23 files / 178 tests, `pnpm run build` passed, `pnpm exec vue-tsc --noEmit` passed, and `pnpm run test:coverage` passed with Statements 21.14%, Branches 17.8%, Functions 23.47%, Lines 22.02%. Performance profile passed with `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_WAIT_MS=7000 pnpm run profile:browser`; report `output/playwright/browser-runtime-profile-home-2026-05-28T10-05-35-117Z.json`, warnings `[]`, duplicateCounts threadList/skills/rateLimits/providerModels all 1, totalApiKB 212.4. Xvfb load-unpacked smoke loaded the extension service worker and overlay; real Chrome toolbar-action manual test then passed via `http://46.62.215.111/browser-annotation-test.html` through Nginx, pairing with public `Server URL: http://46.62.215.111`, selecting three elements, queueing them despite best-effort preview capture, and sending all 3 annotations to Codex UI. The backend queue drained the submitted `Browser annotation batch` into thread `019e6d66-d035-7641-912b-463c22c7e921`. |
| 2026-05-28 | Phase 3 | Stages 3.1-3.3 | Completed | Added explicit DevTools capture mode to the extension. The manifest now requests `debugger`; the side panel shows enable/disable controls and active/error counts; the service worker attaches to the active tab on user request, enables Runtime/Log/Network domains, captures bounded console and network metadata, and detaches on stop, send, tab close, timeout, or debugger detach. Added `shared/devtools-capture.js`, DevTools fixture server/smokes, and batch payload wiring so captured rows are included as `devTools` with per-annotation `devToolsContext`. Verification: all extension JS/MJS `node --check` passed; validator, pairing, selection, annotation-queue, screenshot-crop, DevTools capture, and DevTools fixture smokes passed; `pnpm exec vitest run src/server/browserAnnotationBatch.test.ts --reporter=verbose` passed 8 tests. Performance audit: capture is explicit, no polling or body storage, console/network rows and serialized storage are bounded; storage writes happen per captured event and may be batched later if real pages produce high event volume. |
| 2026-05-28 | Phase 3 | Stages 3.4-3.5 | Completed | Added safe DevTools header/body shaping and prompt correlation. Network rows now carry contract-compatible request/response headers with sensitive values redacted, metadata-only request/response body records by default, and explicit body-capture opt-in from the side panel. Opt-in response bodies are fetched through `Network.getResponseBody` only for textual bounded responses; request bodies from CDP events and response bodies are byte-capped, UTF-8 safe, and redacted when sensitive field names appear. Batch payloads now include headers/body privacy summary counts and per-annotation `devToolsContext` windows. Verification: annotation-queue and DevTools capture smokes passed; server batch regression passed 8 tests. Performance audit: no body capture unless explicitly enabled, body text is capped at 16 KiB by default / 64 KiB max, headers are capped to 80 rows with 600-char values, and network/body payloads remain under the existing batch size cap. |
| 2026-05-28 | Phase 3 | Reviewer hardening | Completed | Closed reviewer findings for DevTools privacy and lifecycle: console redaction now covers JSON-style secrets and Basic/Bearer authorization strings, response body capture is limited to opt-in small textual failed/error responses with known encoded size, request bodies stay metadata-only from `requestWillBeSent`, DevTools state mutations are serialized, timeout detach is backed by `chrome.alarms`, side-panel body opt-in state reflects active capture options after reopen, and stale async response-body reads are dropped after stop/restart on the same tab. Verification: extension static/smoke suite passed, `pnpm run test:unit` passed 23 files / 178 tests, `pnpm run build` passed, `pnpm run test:coverage` passed at the current baseline, `pnpm run test:browser-annotation` passed 6 files / 52 tests, and performance profile `output/playwright/browser-runtime-profile-home-2026-05-28T13-54-41-828Z.json` reported warnings `[]`, duplicateCounts threadList/skills/rateLimits/providerModels all 1, totalApiKB 212.4. Manual DevTools extension smoke on a real Chrome page remains the next acceptance step. |
| 2026-05-28 | Phase 4 | Stages 4.1-4.3 | Completed | Added per-annotation voice recording controls in the extension side panel, transient MediaRecorder blob handling, upload to `/codex-api/extension/assets/upload`, transcription through `/codex-api/extension/transcribe`, queue voice metadata sanitization, and batch `voice-note-audio`/`voiceNote` payload generation. Reviewer findings were fixed so voice metadata patches preserve typed notes, active recording state overrides persisted voice state, in-flight upload/transcription is aborted on delete, assets require `uploadedAtIso`, and raw `base64`/`audioBase64` voice fields are stripped from queue storage. Verification: extension static/smoke suite passed, `pnpm run test:browser-annotation` passed 6 files / 52 tests, `src/server/browserAnnotationBatch.test.ts` verifies the voice-only prompt includes `Voice note` metadata plus transcript text, and mocked transcription provider coverage lives in `src/server/browserAnnotationTranscribe.test.ts`. Full regression passed except manual light/dark voice smoke, which remains an acceptance step. Performance profile `output/playwright/browser-runtime-profile-home-2026-05-28T14-33-16-893Z.json` reported warnings `[]`, duplicateCounts threadList/skills/rateLimits/providerModels all 1, totalApiKB 214.4. |
| 2026-05-28 | Phase 5 | DNS and repo deployment prep | Partial | Added explicit YC DNS record `annotate.todo-tg-app.ru. 300 A 46.62.215.111` in zone `todo-tg-app-ru`; public resolvers `8.8.8.8` and `1.1.1.1` returned `46.62.215.111`. Added `ops/nginx/annotate.todo-tg-app.ru.conf` narrow HTTPS ingress template for `/browser-annotation-test.html` and `/codex-api/extension/`, added production extension packaging via `pnpm run pack:browser-annotation`, tightened production artifact validation to require only `https://annotate.todo-tg-app.ru/*`, and allowed `annotate.todo-tg-app.ru` in Vite dev-server `allowedHosts`. Verification: `pnpm run pack:browser-annotation` produced `dist/browser-annotation-extension/codex-ui-browser-annotation-0.1.0.zip` with prod-only host permissions, `pnpm exec vue-tsc --noEmit` passed, `pnpm run test:browser-annotation` passed 6 files / 52 tests, `http://46.62.215.111/browser-annotation-test.html` returned `200` with the test-page heading, and check-host returned `200` from 6/6 nodes for `http://annotate.todo-tg-app.ru/browser-annotation-test.html`. Performance profile `output/playwright/browser-runtime-profile-home-2026-05-28T14-50-57-150Z.json` reported warnings `[]`, duplicateCounts threadList/skills/rateLimits/providerModels all 1, totalApiKB 214.3. HTTPS certbot/live nginx deployment and manual public-domain extension smoke remain blocked on root access to write `/etc/nginx`/issue certificate. |
| 2026-05-28 | Phase 6 | Stage 6.1 prompt composer tuning | Completed | Added an explicit `## Request for Codex` section to browser annotation batch prompts. The request tells Codex to correlate DOM target, selector, note, voice transcript, attached screenshot image, and DevTools console/network evidence, then implement the appropriate repository fix and run focused verification. Verification: `pnpm exec vitest run src/server/browserAnnotationBatch.test.ts --reporter=verbose` passed 8 tests and now asserts the action request text is present. Manual rendered-message light/dark review remains part of Phase 6 UI/full workflow checks. |
| 2026-05-28 | Phase 6 | Stage 6.2 listener metadata | Partial | Added safe last-received batch metadata to the listener session status. After a batch is successfully queued, the listen store records only `batchId`, `queuedMessageId`, received timestamp, and image/annotation/console/network counts; no notes, DOM, tokens, audio, screenshots, or DevTools bodies are exposed through status. The listener panel now shows a compact `Last batch` summary after polling refresh. Verification: focused listen/batch/gateway Vitest run passed 3 files / 23 tests, `pnpm exec vue-tsc --noEmit` passed, `pnpm run test:browser-annotation` passed 6 files / 52 tests, and reviewer found no issues. Compact browser-annotation message rendering and manual light/dark thread view remain open in Stage 6.2. |
| 2026-05-28 | Phase 6 | Stage 6.2 compact renderer | Completed | Added compact thread rendering for `# Browser annotation batch` user messages. The renderer parses safe batch metadata, annotation previews, DevTools presence, and screenshot counts; groups screenshots inside the batch card; keeps raw markdown context behind a lazy-rendered `details` block; and uses global dark-theme overrides for the batch surface. Verification: `pnpm exec vitest run src/components/content/browserAnnotationBatchMessage.test.ts --reporter=verbose` passed 2 tests, `pnpm exec vue-tsc --noEmit` passed, `pnpm run test:browser-annotation` passed 6 files / 52 tests, Playwright route-interception smoke passed in light and dark themes with screenshots `output/playwright/browser-annotation-batch-light.png` and `output/playwright/browser-annotation-batch-dark.png`, and performance profile `output/playwright/browser-runtime-profile-home-2026-05-28T15-26-57-221Z.json` reported warnings `[]`, duplicateCounts threadList/skills/rateLimits/providerModels all 1, totalApiKB 215. Reviewer findings around eager raw markdown rendering and broad heading detection were fixed. |
| 2026-05-28 | Phase 6 | Stage 6.3 MCP/plugin design spike | Completed | Documented the MCP/plugin path in `docs/browser-annotation-mcp-plugin-design.md`. Decision: do not create a separate browser annotation MCP server/plugin for the MVP; keep capture extension-driven through `/codex-api/extension/*` and reserve future MCP tools (`snapshot_dom`, `screenshot`, `inspect_console`, `inspect_network`, `select_element`) for agent-driven browser inspection after a dedicated security review. Runtime test not required for this design-only stage; `tests.md` contains a review checklist. |
| 2026-05-28 | Phase 6 | Stage 6.4 troubleshooting documentation | Completed | Added `docs/browser-annotation-troubleshooting.md` and linked it from the extension README. The guide covers pairing tokens, server URL choices, DNS wildcard/propagation, nginx/default-server and Vite `allowedHosts` failures, active-tab permission errors, empty queue/missing preview behavior, DevTools debugger/body-capture issues, voice/microphone/transcription states, and public HTTPS deployment checks. Runtime test not required for this documentation-only stage; `tests.md` contains a review checklist. |
| 2026-05-28 | Phase 6 | Full regression | Partial | Automated regression passed: `pnpm run test:unit` passed 24 files / 180 tests, `pnpm run build` passed, `pnpm run test:coverage` passed with Statements 21.33%, Branches 17.92%, Functions 23.71%, Lines 22.21%, and `PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_WAIT_MS=7000 pnpm run profile:browser` produced `output/playwright/browser-runtime-profile-home-2026-05-28T15-41-57-765Z.json` with warnings `[]`, duplicateCounts threadList/skills/rateLimits/providerModels all 1, totalApiKB 217. Light/dark compact renderer verification passed via Playwright route-interception smoke. Full real Chrome workflow with pairing, multiple annotations, DevTools capture, voice recording, and send remains a manual acceptance item because it requires user/browser interaction and should run on a disposable or user-approved thread. |
| 2026-05-28 | Phase 7 | Stage 7.1 security hardening | Partial | Hardened public ingress and extension/server data handling after security review. The public nginx template now blocks `/codex-api/extension/listen/start`; the production extension rejects non-local `http://` server URLs and removes the temporary public-IP host permission; pairing tokens move from `chrome.storage.local` to session storage, the listen session is revoked after successful send, and the local token is cleared; uploads now sniff declared MIME content before writing; uploaded image refs expire from the in-memory registry; docs now point production pairing at `https://annotate.todo-tg-app.ru`. Verification: extension static/smoke scripts passed, `pnpm run pack:browser-annotation` produced a prod artifact with only `https://annotate.todo-tg-app.ru/*`, `pnpm run test:browser-annotation` passed 6 files / 53 tests, and `pnpm exec vue-tsc --noEmit` passed. External browser-network-log and screenshot secret review remains part of final manual acceptance. |
| 2026-05-28 | Phase 7 | Stage 7.2 reliability hardening | Partial | Hardened extension and server reliability after parallel review. Extension annotation queue read-modify-write operations are serialized; successful send removes only the sent queue snapshot so concurrently added items survive; DevTools capture stops on tab close/navigation even after MV3 service worker restart; status/send/revoke/upload/transcribe fetches now have bounded timeouts; batch and asset upload endpoints re-authorize after body parsing and before side effects so revoked/replaced sessions cannot enqueue or persist after slow in-flight requests. Verification: `node extension/browser-annotation/dev/devtools-service-worker-persistence-smoke.mjs` covers queue races plus tab-close/navigation restart cases, focused batch/assets Vitest covers revoked-in-flight requests, `pnpm run test:browser-annotation` passed 6 files / 55 tests, `pnpm exec vue-tsc --noEmit` passed, and the production package rebuilt. Remaining partial risk: the existing generic `/codex-api/thread-queue-state` full-state PUT can still clobber queue messages from a stale UI snapshot; fixing that needs a broader queue revision/CAS design outside the extension-specific endpoints. |
| 2026-05-28 | Phase 7 | Stage 7.3 packaging | Partial | Rebuilt the production extension artifact at `dist/browser-annotation-extension/codex-ui-browser-annotation-0.1.0.zip` with SHA-256 `816e71ea6c487da89eac88a4af7c4b3ff3169da4c20d3cd82cf7d18838d4e14d`; production validation passed and the unpacked manifest contains only `https://annotate.todo-tg-app.ru/*` in `host_permissions`. The extension README now documents development load-unpacked install, production zip distribution, HTTPS server URL, nginx ingress, and future Chrome Web Store notes. Clean Chrome profile install remains manual because browser automation was not requested for this stage. |

## Phase 0: Foundations, Secrets, And Deployment Discovery

Objective: make the project safe to implement by resolving secrets, local scripts, YC/Nginx deployment shape, and quality gates.

Checklist:

- [ ] Stage 0.1: Secret rotation requirement
  - [ ] Confirm pasted OpenAI key was revoked/replaced outside the repo.
  - [x] Define env names: `OPENAI_API_KEY`, `CODEXUI_ANNOTATION_TRANSCRIBE_MODEL`, `CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL`.
  - [x] Add server-side config reads with no client exposure.
  - [x] Smoke test: run a local env validation script that reports key presence without printing the key.

- [x] Stage 0.2: Existing deployment discovery
  - [x] Inspect existing `ops/nginx/`, YC CLI config, certificate manager usage, and current todo-tg-app subdomains.
  - [x] Record the exact DNS zone, folder/cloud IDs, and certificate strategy in this file without secrets.
  - [x] Decide whether `annotate.todo-tg-app.ru` points to the existing Codex UI service or a narrow annotation ingress route.
  - Smoke test: read-only `yc` checks passed; nginx config check remains inconclusive as non-root due certificate file permissions.

- [x] Stage 0.3: Quality gates baseline
  - [x] Run `pnpm run test:unit`.
  - [x] Run `pnpm run build`.
  - [x] Establish lint substitute or add a lint script.
  - [x] Establish coverage command and threshold.
  - [x] Record baseline results in this work log.

- [x] Stage 0.4: Data contract draft
  - [x] Define `AnnotationBatch`, `AnnotationItem`, `DevToolsSnapshot`, `VoiceNote`, and uploaded asset records.
  - [x] Include privacy trimming rules: redact passwords/tokens/cookies by default, cap request/response bodies, allow user opt-in for body capture.
  - [x] Write examples for text-only, screenshot-only, voice, and DevTools-heavy payloads.
  - Smoke test: `pnpm exec vitest run src/api/browserAnnotationContracts.test.ts` passed.

Phase 0 full regression:

- [ ] `pnpm run test:unit`
- [ ] `pnpm run build`
- [ ] Linter gate or documented substitute
- [ ] Coverage gate
- [ ] Performance audit: code-path analysis only if no runtime feature changed
- [ ] Update [tests.md](../tests.md) if any user-visible behavior was added
- [ ] Commit Phase 0 changes

## Phase 1: Codex UI Annotation Ingress

Objective: add server and UI plumbing so an authenticated extension can pair with the current thread, upload assets, transcribe audio, and queue a batch.

Checklist:

- [x] Stage 1.1: Listening session UI
  - [x] Add a `Listen for browser annotations` control on the active thread surface.
  - [x] Generate a short-lived pairing token/session bound to `threadId`.
  - [x] Show listener status, target thread title, expiry, and copyable server URL.
  - [x] Add revoke/stop listening.
  - Smoke test: API helper test/typecheck passed; light/dark manual UI verification documented in [tests.md](../tests.md) and remains part of Phase 1 regression.

- [x] Stage 1.2: Server pairing endpoints
  - [x] Add `POST /codex-api/extension/listen/start`.
  - [x] Add `POST /codex-api/extension/listen/stop`.
  - [x] Add `GET /codex-api/extension/listen/status`.
  - [x] Store sessions server-side with TTL and hashed token.
  - [x] Enforce existing Codex UI auth and extension bearer token.
  - Smoke test: `pnpm vitest run src/server/browserAnnotationListen.test.ts --reporter=verbose` covers success, expiry, wrong token, revoked token, malformed JSON, oversized body, same-thread replacement, and session cap.

- [x] Stage 1.3: Asset upload endpoint
  - [x] Accept screenshot/crop/audio uploads from paired extension.
  - [x] Reuse existing temp upload conventions where possible.
  - [x] Return local asset references compatible with `localImage` or server-side prompt assembly.
  - [x] Cap file size and mime types.
  - Smoke test: `pnpm vitest run src/server/browserAnnotationAssets.test.ts src/server/browserAnnotationListen.test.ts --reporter=verbose` covers PNG/WebP/WebM success and invalid type/oversize/auth/selector/revoked/malformed/long-name rejection paths.

- [x] Stage 1.4: OpenAI transcription endpoint
  - [x] Add server-only transcription for annotation audio.
  - [x] Primary model: configured `CODEXUI_ANNOTATION_TRANSCRIBE_MODEL`.
  - [x] Fallback model: configured `CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL`.
  - [x] Do not expose OpenAI key to browser/extension.
  - [x] Include retry/error messages suitable for UI.
  - Smoke test: mocked OpenAI success/fallback/config/auth/mime/oversize/malformed/expired/error-sanitization coverage; no real call made because key rotation remains externally unconfirmed.

- [x] Stage 1.5: Batch-to-thread queueing
  - [x] Add `POST /codex-api/extension/annotation-batch`.
  - [x] Build a single structured prompt from all annotations.
  - [x] Include uploaded screenshots as `localImage` inputs.
  - [x] If thread is busy, use existing backend queue; otherwise start `turn/start`.
  - Smoke test: focused endpoint tests send two annotations into a test thread queue and verify queued result/scheduled drain. Direct start is delegated to the existing backend queue processor.

Phase 1 full regression:

- [x] `pnpm run test:unit`
- [x] `pnpm run build`
- [x] Linter gate
- [x] Coverage gate
- [x] CJS endpoint smoke suite
- [x] Manual UI check in light and dark themes
- [x] Performance audit for new endpoints and thread queue path
- [x] Update [tests.md](../tests.md)
- [x] Commit Phase 1 changes

## Phase 2: Chrome Extension MVP Shell And Annotation Queue

Objective: create a Manifest V3 extension that pairs with Codex UI, overlays the page, collects multiple annotations, and sends the batch.

Checklist:

- [x] Stage 2.1: Extension scaffold
  - [x] Create extension package/workspace or documented local extension folder.
  - [x] Add `manifest.json`, service worker, side panel, content script, and shared types.
  - [x] Permissions: start with `activeTab`, `scripting`, `tabs`, `sidePanel`, and target host permissions for `https://annotate.todo-tg-app.ru/*`.
  - Smoke test: load unpacked extension and open side panel.

- [x] Stage 2.2: Pairing flow
  - [x] Extension stores server URL and pairing token in extension storage.
  - [x] Validate token with Codex UI status endpoint.
  - [x] Show connected/disconnected state.
  - Smoke test: valid token connects; invalid token shows clear error.

- [x] Stage 2.3: Page overlay and element selection
  - [x] Inject content script on user gesture.
  - [x] Draw hover/selected overlay using Shadow DOM or isolated high-z-index container.
  - [x] Collect selector, XPath fallback, role/aria/text, rect, viewport, and nearest headings/labels.
  - Smoke test: select button/input/card on a simple local page.

- [x] Stage 2.4: Screenshot and crop capture
  - [x] Use `chrome.tabs.captureVisibleTab`.
  - [x] Crop selected rect with `devicePixelRatio`.
  - [x] Store preview in extension queue.
  - Smoke test: crop dimensions and visible preview match selected element.

- [x] Stage 2.5: Multi-annotation queue UX
  - [x] Add text note per annotation.
  - [x] Allow edit/delete/reorder before send.
  - [x] Add page-level metadata once per batch.
  - [x] Send all queued annotations in one batch.
  - Smoke test: create three annotations, delete one, send two.

Phase 2 full regression:

- [x] Extension build/typecheck
- [x] `pnpm run test:unit`
- [x] `pnpm run build`
- [x] Linter gate
- [x] Coverage gate
- [ ] Manual extension test against local Codex UI in light and dark Codex UI themes
- [x] Performance audit for upload payload size and duplicate requests
- [x] Update [tests.md](../tests.md)
- [ ] Commit Phase 2 changes

## Phase 3: DevTools Network And Console Capture

Objective: add the killer feature: explicit DevTools capture through `chrome.debugger`, attached only while annotation mode is active.

Checklist:

- [x] Stage 3.1: Debugger permission and attach lifecycle
  - [x] Add `debugger` permission with clear UI copy.
  - [x] Attach on explicit DevTools mode enable.
  - [x] Detach on stop, tab close, send, or timeout.
  - [x] Show active debugger warning/state in extension UI.
  - Smoke test: attach/detach succeeds and tab is released after mode stops.

- [x] Stage 3.2: Console capture
  - [x] Subscribe to `Runtime`, `Log`, and console events supported by `chrome.debugger`.
  - [x] Capture level, text, stack trace, URL, line/column, timestamp.
  - [x] Filter noise and cap stored messages.
  - Smoke test: local page logs info/warn/error and extension captures them.

- [x] Stage 3.3: Network capture
  - [x] Subscribe to `Network.requestWillBeSent`, `responseReceived`, `loadingFinished`, `loadingFailed`.
  - [x] Capture URL, method, status, resource type, timings, initiator, failure reason.
  - [x] Mark failed/slow requests.
  - Smoke test: local page issues success, 404, failed, and slow requests.

- [x] Stage 3.4: Safe body/header capture
  - [x] Redact sensitive headers and query params by default.
  - [x] Capture response body only for selected failed/small text requests.
  - [x] Add explicit user opt-in for request/response body capture.
  - Smoke test: Authorization/Cookie are redacted; small JSON body captured only when allowed.

- [x] Stage 3.5: Correlate DevTools context to annotations
  - [x] Attach the relevant console/network window around each annotation timestamp.
  - [x] Add batch-level full summary.
  - [x] Include DevTools summary in prompt sent to Codex.
  - Smoke test: annotation made after failing request includes that request in its context.

Phase 3 full regression:

- [x] Extension DevTools test page suite
- [x] `pnpm run test:unit`
- [x] `pnpm run build`
- [x] Linter gate
- [x] Coverage gate
- [ ] Manual extension test on a real dev page
- [x] Verify debugger always detaches
- [x] Performance audit for request volume, body limits, and memory caps
- [x] Update [tests.md](../tests.md)
- [x] Commit Phase 3 changes

## Phase 4: Voice Annotation

Objective: support voice notes per annotation with server-side transcription.

Checklist:

- [x] Stage 4.1: Extension recording UI
  - [x] Add microphone recording to annotation editor.
  - [x] Show duration, pause/cancel/delete, and upload status.
  - [x] Keep the recorded audio blob transiently with the queue item while upload/transcription runs.
  - Smoke test: record, cancel, record again.

- [x] Stage 4.2: Audio upload and transcription
  - [x] Upload audio to Codex UI server.
  - [x] Transcribe through server endpoint.
  - [x] Attach transcript to annotation.
  - [x] Keep original audio path for debugging only if configured.
  - Smoke test: mocked transcription returns text and appears in queued annotation.

- [x] Stage 4.3: Prompt integration
  - [x] Merge typed note and transcript clearly.
  - [x] Mark uncertain/failed transcription without dropping the annotation.
  - [x] Add language auto-detect unless user config overrides it.
  - Smoke test: annotation with voice only sends meaningful prompt.

Phase 4 full regression:

- [x] Extension audio smoke suite
- [x] Server transcription tests with mocked provider
- [x] `pnpm run test:unit`
- [x] `pnpm run build`
- [x] Linter gate
- [x] Coverage gate
- [ ] Manual light/dark UI check
- [x] Performance audit for audio payload sizes and transcription latency
- [x] Update [tests.md](../tests.md)
- [x] Commit Phase 4 changes

## Phase 5: Public HTTPS Deployment For `annotate.todo-tg-app.ru`

Objective: expose the extension ingress safely over HTTPS using the existing YC/Nginx pattern.

Checklist:

- [x] Stage 5.1: DNS
  - [x] Use YC CLI to identify the DNS zone for `todo-tg-app.ru`.
  - [x] Create or update `annotate.todo-tg-app.ru` record.
  - [x] Verify propagation.
  - Smoke test: `dig annotate.todo-tg-app.ru`.

- [ ] Stage 5.2: Certificate
  - [ ] Issue or attach certificate for `annotate.todo-tg-app.ru`.
  - [ ] Document certificate ID/path/renewal behavior.
  - Smoke test: certificate status active and chain valid.

- [ ] Stage 5.3: Reverse proxy
  - [x] Add Nginx route for annotation endpoints and Codex UI websocket needs if shared.
  - [ ] Enforce HTTPS.
  - [x] Ensure upload size/timeouts support screenshots/audio but reject oversized payloads.
  - Smoke test: `nginx -t`, HTTPS status endpoint, websocket unaffected.

- [ ] Stage 5.4: Extension production config
  - [x] Set host permissions for `https://annotate.todo-tg-app.ru/*`.
  - [x] Add build artifact instructions.
  - [ ] Verify pairing and batch send over public HTTPS.
  - Smoke test: real extension sends two annotations to server.

Phase 5 full regression:

- [ ] `pnpm run test:unit`
- [x] `pnpm run build`
- [x] Linter gate
- [ ] Coverage gate
- [ ] HTTPS endpoint smoke suite
- [ ] Extension manual test over public domain
- [x] Performance audit for public endpoint request counts and payload sizes
- [x] Update [tests.md](../tests.md)
- [x] Commit Phase 5 changes

## Phase 6: Codex Prompt Quality, UI Polish, And MCP Path

Objective: make the feature pleasant and align the long-term shape with OpenAI's app/plugin/MCP architecture.

Checklist:

- [x] Stage 6.1: Prompt composer tuning
  - [x] Ensure generated prompt is concise but complete.
  - [x] Include per-annotation screenshots, DOM, selector, user note, transcript, console, and network.
  - [x] Add clear instruction that Codex should implement fixes and verify.
  - Smoke test: inspect generated prompt snapshot.

- [x] Stage 6.2: Codex UI presentation
  - [x] Render incoming browser annotation batches as readable user messages.
  - [x] Show attached screenshots consistently.
  - [x] Add listener status and last received batch metadata.
  - Smoke test: batch appears correctly in thread in light and dark themes.

- [x] Stage 6.3: MCP/plugin design spike
  - [x] Document whether to create a `browser-annotation` MCP server/plugin.
  - [x] Define tools: `snapshot_dom`, `screenshot`, `inspect_console`, `inspect_network`, `select_element`.
  - [x] Decide what remains extension-driven versus agent-driven.
  - Smoke test: no runtime test required; design review and acceptance checklist.

- [x] Stage 6.4: Documentation
  - [x] User setup guide for extension.
  - [x] Server deployment guide.
  - [x] Troubleshooting guide for debugger permission, pairing, audio, and DNS/cert issues.
  - [x] Update [tests.md](../tests.md).
  - Smoke test: setup/troubleshooting guide review passed; clean browser profile workflow is deferred to the full manual workflow acceptance item.

Phase 6 full regression:

- [x] `pnpm run test:unit`
- [x] `pnpm run build`
- [x] Linter gate
- [x] Coverage gate
- [ ] Full manual workflow: pair, make multiple annotations, capture DevTools, record voice, send, Codex receives
- [x] Light/dark verification
- [x] Performance audit with `pnpm run profile:browser`
- [x] Update [tests.md](../tests.md)
- [ ] Commit Phase 6 changes

## Phase 7: Final Hardening And Release Readiness

Objective: complete security hardening, documentation, rollback paths, and release packaging.

Checklist:

- [ ] Stage 7.1: Security review
  - [ ] Verify no secrets in repo, browser storage, network logs, screenshots, or generated docs.
  - [x] Review token TTL/revocation.
  - [x] Review CORS, auth, upload limits, mime validation, and path handling.
  - [x] Review DevTools capture redaction.
  - Smoke test: attempt invalid token, CORS abuse, oversize upload, unsupported mime.

- [ ] Stage 7.2: Reliability review
  - [x] Extension handles tab close, navigation, reload, debugger detach, offline server.
  - [x] Server handles concurrent annotation sessions.
  - [ ] Queue behavior is deterministic for busy threads.
  - Smoke test: send while thread busy and confirm eventual delivery.

- [ ] Stage 7.3: Packaging
  - [x] Produce extension build artifact.
  - [x] Document load-unpacked install and future Chrome Web Store path.
  - [x] Document server env/deploy commands.
  - Smoke test: install artifact in clean Chrome profile.

- [ ] Stage 7.4: Final docs and acceptance
  - [ ] Finalize user docs.
  - [ ] Finalize admin/deployment docs.
  - [ ] Finalize [tests.md](../tests.md).
  - [ ] Mark all completed checklist items in this plan.

Phase 7 full regression:

- [ ] `pnpm run test:unit`
- [ ] `pnpm run build`
- [ ] Linter gate
- [ ] Coverage gate
- [ ] Full end-to-end regression on `https://annotate.todo-tg-app.ru`
- [ ] Full light/dark verification
- [ ] Performance audit with profile output inspected for duplicates, warnings, API KB, slow rows
- [ ] Security smoke suite
- [ ] Update [tests.md](../tests.md)
- [ ] Commit Phase 7 changes

## Final Acceptance Criteria

- [ ] Extension can pair with a selected Codex UI thread over `https://annotate.todo-tg-app.ru`.
- [ ] User can create multiple annotations before sending.
- [ ] Each annotation can include selected element context, screenshot crop, typed note, and voice transcript.
- [ ] DevTools Console and Network context is captured safely and included in the sent batch.
- [ ] Codex receives the batch in the intended thread and can act on it.
- [ ] Busy threads queue annotation batches rather than losing or interrupting work.
- [ ] Public HTTPS deployment is documented and reproducible.
- [ ] No OpenAI key or sensitive browser data is exposed to the extension bundle or committed files.
- [ ] All phase smoke tests, regressions, lint gates, coverage gates, and performance audits are complete.
