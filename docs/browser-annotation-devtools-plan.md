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

## Phase 0: Foundations, Secrets, And Deployment Discovery

Objective: make the project safe to implement by resolving secrets, local scripts, YC/Nginx deployment shape, and quality gates.

Checklist:

- [ ] Stage 0.1: Secret rotation requirement
  - [ ] Confirm pasted OpenAI key was revoked/replaced outside the repo.
  - [x] Define env names: `OPENAI_API_KEY`, `CODEXUI_ANNOTATION_TRANSCRIBE_MODEL`, `CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL`.
  - [x] Add server-side config reads with no client exposure.
  - [x] Smoke test: run a local env validation script that reports key presence without printing the key.

- [ ] Stage 0.2: Existing deployment discovery
  - [ ] Inspect existing `ops/nginx/`, YC CLI config, certificate manager usage, and current todo-tg-app subdomains.
  - [ ] Record the exact DNS zone, folder/cloud IDs, and certificate strategy in this file without secrets.
  - [ ] Decide whether `annotate.todo-tg-app.ru` points to the existing Codex UI service or a narrow annotation ingress route.
  - Smoke test: read-only `yc` and nginx config checks.

- [ ] Stage 0.3: Quality gates baseline
  - [ ] Run `pnpm run test:unit`.
  - [ ] Run `pnpm run build`.
  - [ ] Establish lint substitute or add a lint script.
  - [ ] Establish coverage command and threshold.
  - [ ] Record baseline results in this work log.

- [ ] Stage 0.4: Data contract draft
  - [ ] Define `AnnotationBatch`, `AnnotationItem`, `DevToolsSnapshot`, `VoiceNote`, and uploaded asset records.
  - [ ] Include privacy trimming rules: redact passwords/tokens/cookies by default, cap request/response bodies, allow user opt-in for body capture.
  - [ ] Write examples for text-only, screenshot-only, voice, and DevTools-heavy payloads.
  - Smoke test: schema/type test validates representative payloads.

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

- [ ] Stage 1.1: Listening session UI
  - [ ] Add a `Listen for browser annotations` control on the active thread surface.
  - [ ] Generate a short-lived pairing token/session bound to `threadId`.
  - [ ] Show listener status, target thread title, expiry, and copyable server URL.
  - [ ] Add revoke/stop listening.
  - Smoke test: create/revoke session in light and dark themes.

- [ ] Stage 1.2: Server pairing endpoints
  - [ ] Add `POST /codex-api/extension/listen/start`.
  - [ ] Add `POST /codex-api/extension/listen/stop`.
  - [ ] Add `GET /codex-api/extension/listen/status`.
  - [ ] Store sessions server-side with TTL and hashed token.
  - [ ] Enforce existing Codex UI auth and extension bearer token.
  - Smoke test: endpoint CJS script covers success, expiry, wrong token, revoked token.

- [ ] Stage 1.3: Asset upload endpoint
  - [ ] Accept screenshot/crop/audio uploads from paired extension.
  - [ ] Reuse existing temp upload conventions where possible.
  - [ ] Return local asset references compatible with `localImage` or server-side prompt assembly.
  - [ ] Cap file size and mime types.
  - Smoke test: upload PNG/WebP/WebM fixture and reject invalid type/oversize.

- [ ] Stage 1.4: OpenAI transcription endpoint
  - [ ] Add server-only transcription for annotation audio.
  - [ ] Primary model: configured `CODEXUI_ANNOTATION_TRANSCRIBE_MODEL`.
  - [ ] Fallback model: configured `CODEXUI_ANNOTATION_TRANSCRIBE_FALLBACK_MODEL`.
  - [ ] Do not expose OpenAI key to browser/extension.
  - [ ] Include retry/error messages suitable for UI.
  - Smoke test: mock OpenAI response; optional real call only with rotated env key.

- [ ] Stage 1.5: Batch-to-thread queueing
  - [ ] Add `POST /codex-api/extension/annotation-batch`.
  - [ ] Build a single structured prompt from all annotations.
  - [ ] Include uploaded screenshots as `localImage` inputs.
  - [ ] If thread is busy, use existing backend queue; otherwise start `turn/start`.
  - Smoke test: send two annotations into a test thread and verify queued/started result.

Phase 1 full regression:

- [ ] `pnpm run test:unit`
- [ ] `pnpm run build`
- [ ] Linter gate
- [ ] Coverage gate
- [ ] CJS endpoint smoke suite
- [ ] Manual UI check in light and dark themes
- [ ] Performance audit for new endpoints and thread queue path
- [ ] Update [tests.md](../tests.md)
- [ ] Commit Phase 1 changes

## Phase 2: Chrome Extension MVP Shell And Annotation Queue

Objective: create a Manifest V3 extension that pairs with Codex UI, overlays the page, collects multiple annotations, and sends the batch.

Checklist:

- [ ] Stage 2.1: Extension scaffold
  - [ ] Create extension package/workspace or documented local extension folder.
  - [ ] Add `manifest.json`, service worker, side panel, content script, and shared types.
  - [ ] Permissions: start with `activeTab`, `scripting`, `tabs`, `sidePanel`, and target host permissions for `https://annotate.todo-tg-app.ru/*`.
  - Smoke test: load unpacked extension and open side panel.

- [ ] Stage 2.2: Pairing flow
  - [ ] Extension stores server URL and pairing token in extension storage.
  - [ ] Validate token with Codex UI status endpoint.
  - [ ] Show connected/disconnected state.
  - Smoke test: valid token connects; invalid token shows clear error.

- [ ] Stage 2.3: Page overlay and element selection
  - [ ] Inject content script on user gesture.
  - [ ] Draw hover/selected overlay using Shadow DOM or isolated high-z-index container.
  - [ ] Collect selector, XPath fallback, role/aria/text, rect, viewport, and nearest headings/labels.
  - Smoke test: select button/input/card on a simple local page.

- [ ] Stage 2.4: Screenshot and crop capture
  - [ ] Use `chrome.tabs.captureVisibleTab`.
  - [ ] Crop selected rect with `devicePixelRatio`.
  - [ ] Store preview in extension queue.
  - Smoke test: crop dimensions and visible preview match selected element.

- [ ] Stage 2.5: Multi-annotation queue UX
  - [ ] Add text note per annotation.
  - [ ] Allow edit/delete/reorder before send.
  - [ ] Add page-level metadata once per batch.
  - [ ] Send all queued annotations in one batch.
  - Smoke test: create three annotations, delete one, send two.

Phase 2 full regression:

- [ ] Extension build/typecheck
- [ ] `pnpm run test:unit`
- [ ] `pnpm run build`
- [ ] Linter gate
- [ ] Coverage gate
- [ ] Manual extension test against local Codex UI in light and dark Codex UI themes
- [ ] Performance audit for upload payload size and duplicate requests
- [ ] Update [tests.md](../tests.md)
- [ ] Commit Phase 2 changes

## Phase 3: DevTools Network And Console Capture

Objective: add the killer feature: explicit DevTools capture through `chrome.debugger`, attached only while annotation mode is active.

Checklist:

- [ ] Stage 3.1: Debugger permission and attach lifecycle
  - [ ] Add `debugger` permission with clear UI copy.
  - [ ] Attach on explicit DevTools mode enable.
  - [ ] Detach on stop, tab close, send, or timeout.
  - [ ] Show active debugger warning/state in extension UI.
  - Smoke test: attach/detach succeeds and tab is released after mode stops.

- [ ] Stage 3.2: Console capture
  - [ ] Subscribe to `Runtime`, `Log`, and console events supported by `chrome.debugger`.
  - [ ] Capture level, text, stack trace, URL, line/column, timestamp.
  - [ ] Filter noise and cap stored messages.
  - Smoke test: local page logs info/warn/error and extension captures them.

- [ ] Stage 3.3: Network capture
  - [ ] Subscribe to `Network.requestWillBeSent`, `responseReceived`, `loadingFinished`, `loadingFailed`.
  - [ ] Capture URL, method, status, resource type, timings, initiator, failure reason.
  - [ ] Mark failed/slow requests.
  - Smoke test: local page issues success, 404, failed, and slow requests.

- [ ] Stage 3.4: Safe body/header capture
  - [ ] Redact sensitive headers and query params by default.
  - [ ] Capture response body only for selected failed/small text requests.
  - [ ] Add explicit user opt-in for request/response body capture.
  - Smoke test: Authorization/Cookie are redacted; small JSON body captured only when allowed.

- [ ] Stage 3.5: Correlate DevTools context to annotations
  - [ ] Attach the relevant console/network window around each annotation timestamp.
  - [ ] Add batch-level full summary.
  - [ ] Include DevTools summary in prompt sent to Codex.
  - Smoke test: annotation made after failing request includes that request in its context.

Phase 3 full regression:

- [ ] Extension DevTools test page suite
- [ ] `pnpm run test:unit`
- [ ] `pnpm run build`
- [ ] Linter gate
- [ ] Coverage gate
- [ ] Manual extension test on a real dev page
- [ ] Verify debugger always detaches
- [ ] Performance audit for request volume, body limits, and memory caps
- [ ] Update [tests.md](../tests.md)
- [ ] Commit Phase 3 changes

## Phase 4: Voice Annotation

Objective: support voice notes per annotation with server-side transcription.

Checklist:

- [ ] Stage 4.1: Extension recording UI
  - [ ] Add microphone recording to annotation editor.
  - [ ] Show duration, pause/cancel/delete, and upload status.
  - [ ] Store audio blob with annotation until send.
  - Smoke test: record, cancel, record again.

- [ ] Stage 4.2: Audio upload and transcription
  - [ ] Upload audio to Codex UI server.
  - [ ] Transcribe through server endpoint.
  - [ ] Attach transcript to annotation.
  - [ ] Keep original audio path for debugging only if configured.
  - Smoke test: mocked transcription returns text and appears in queued annotation.

- [ ] Stage 4.3: Prompt integration
  - [ ] Merge typed note and transcript clearly.
  - [ ] Mark uncertain/failed transcription without dropping the annotation.
  - [ ] Add language auto-detect unless user config overrides it.
  - Smoke test: annotation with voice only sends meaningful prompt.

Phase 4 full regression:

- [ ] Extension audio smoke suite
- [ ] Server transcription tests with mocked provider
- [ ] `pnpm run test:unit`
- [ ] `pnpm run build`
- [ ] Linter gate
- [ ] Coverage gate
- [ ] Manual light/dark UI check
- [ ] Performance audit for audio payload sizes and transcription latency
- [ ] Update [tests.md](../tests.md)
- [ ] Commit Phase 4 changes

## Phase 5: Public HTTPS Deployment For `annotate.todo-tg-app.ru`

Objective: expose the extension ingress safely over HTTPS using the existing YC/Nginx pattern.

Checklist:

- [ ] Stage 5.1: DNS
  - [ ] Use YC CLI to identify the DNS zone for `todo-tg-app.ru`.
  - [ ] Create or update `annotate.todo-tg-app.ru` record.
  - [ ] Verify propagation.
  - Smoke test: `dig annotate.todo-tg-app.ru`.

- [ ] Stage 5.2: Certificate
  - [ ] Issue or attach certificate for `annotate.todo-tg-app.ru`.
  - [ ] Document certificate ID/path/renewal behavior.
  - Smoke test: certificate status active and chain valid.

- [ ] Stage 5.3: Reverse proxy
  - [ ] Add Nginx route for annotation endpoints and Codex UI websocket needs if shared.
  - [ ] Enforce HTTPS.
  - [ ] Ensure upload size/timeouts support screenshots/audio but reject oversized payloads.
  - Smoke test: `nginx -t`, HTTPS status endpoint, websocket unaffected.

- [ ] Stage 5.4: Extension production config
  - [ ] Set host permissions for `https://annotate.todo-tg-app.ru/*`.
  - [ ] Add build artifact instructions.
  - [ ] Verify pairing and batch send over public HTTPS.
  - Smoke test: real extension sends two annotations to server.

Phase 5 full regression:

- [ ] `pnpm run test:unit`
- [ ] `pnpm run build`
- [ ] Linter gate
- [ ] Coverage gate
- [ ] HTTPS endpoint smoke suite
- [ ] Extension manual test over public domain
- [ ] Performance audit for public endpoint request counts and payload sizes
- [ ] Update [tests.md](../tests.md)
- [ ] Commit Phase 5 changes

## Phase 6: Codex Prompt Quality, UI Polish, And MCP Path

Objective: make the feature pleasant and align the long-term shape with OpenAI's app/plugin/MCP architecture.

Checklist:

- [ ] Stage 6.1: Prompt composer tuning
  - [ ] Ensure generated prompt is concise but complete.
  - [ ] Include per-annotation screenshots, DOM, selector, user note, transcript, console, and network.
  - [ ] Add clear instruction that Codex should implement fixes and verify.
  - Smoke test: inspect generated prompt snapshot.

- [ ] Stage 6.2: Codex UI presentation
  - [ ] Render incoming browser annotation batches as readable user messages.
  - [ ] Show attached screenshots consistently.
  - [ ] Add listener status and last received batch metadata.
  - Smoke test: batch appears correctly in thread in light and dark themes.

- [ ] Stage 6.3: MCP/plugin design spike
  - [ ] Document whether to create a `browser-annotation` MCP server/plugin.
  - [ ] Define tools: `snapshot_dom`, `screenshot`, `inspect_console`, `inspect_network`, `select_element`.
  - [ ] Decide what remains extension-driven versus agent-driven.
  - Smoke test: no runtime test required; design review and acceptance checklist.

- [ ] Stage 6.4: Documentation
  - [ ] User setup guide for extension.
  - [ ] Server deployment guide.
  - [ ] Troubleshooting guide for debugger permission, pairing, audio, and DNS/cert issues.
  - [ ] Update [tests.md](../tests.md).
  - Smoke test: follow setup guide from clean browser profile.

Phase 6 full regression:

- [ ] `pnpm run test:unit`
- [ ] `pnpm run build`
- [ ] Linter gate
- [ ] Coverage gate
- [ ] Full manual workflow: pair, make multiple annotations, capture DevTools, record voice, send, Codex receives
- [ ] Light/dark verification
- [ ] Performance audit with `pnpm run profile:browser`
- [ ] Update [tests.md](../tests.md)
- [ ] Commit Phase 6 changes

## Phase 7: Final Hardening And Release Readiness

Objective: complete security hardening, documentation, rollback paths, and release packaging.

Checklist:

- [ ] Stage 7.1: Security review
  - [ ] Verify no secrets in repo, browser storage, network logs, screenshots, or generated docs.
  - [ ] Review token TTL/revocation.
  - [ ] Review CORS, auth, upload limits, mime validation, and path handling.
  - [ ] Review DevTools capture redaction.
  - Smoke test: attempt invalid token, CORS abuse, oversize upload, unsupported mime.

- [ ] Stage 7.2: Reliability review
  - [ ] Extension handles tab close, navigation, reload, debugger detach, offline server.
  - [ ] Server handles concurrent annotation sessions.
  - [ ] Queue behavior is deterministic for busy threads.
  - Smoke test: send while thread busy and confirm eventual delivery.

- [ ] Stage 7.3: Packaging
  - [ ] Produce extension build artifact.
  - [ ] Document load-unpacked install and future Chrome Web Store path.
  - [ ] Document server env/deploy commands.
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
