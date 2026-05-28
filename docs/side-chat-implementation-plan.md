# Side Chat Implementation Plan

Goal: ship a seamless one-off Side Chat for Codex UI that can answer questions from the current thread/project context without polluting the main conversation or destabilizing existing chat behavior.

Status: TDD preparation only. Do not start implementation until explicitly approved.

## Current Contract

- `/side <question>` must be a web-supported command.
- Opening Side Chat must create an ephemeral fork of the selected thread through app-server `thread/fork`.
- The selected main thread must remain selected while the side panel is open.
- Side messages, live deltas, reasoning, errors, and pending requests must route to the side thread only.
- Closing Side Chat must clear side UI state without changing or mutating the main thread.
- Side Chat is temporary for now; it should not be promoted into normal thread history or sidebar navigation.

## Instruction Links

- Testing and verification rules: [AGENTS.md](../AGENTS.md)
- Test documentation rule and required manual-test structure: [AGENTS.md](../AGENTS.md)
- Performance audit workflow and profiler commands: [AGENTS.md](../AGENTS.md)
- Browser/Playwright evidence rules when explicitly requested: [AGENTS.md](../AGENTS.md)
- Manual test catalog to update during implementation: [tests.md](../tests.md)
- App-server RPC catalog: [documentation/APP_SERVER_DOCUMENTATION.md](../documentation/APP_SERVER_DOCUMENTATION.md)
- Current slash command registry: [src/codexSlashCommands.ts](../src/codexSlashCommands.ts)
- Current gateway layer: [src/api/codexGateway.ts](../src/api/codexGateway.ts)
- Current desktop state layer: [src/composables/useDesktopState.ts](../src/composables/useDesktopState.ts)

## Red Test Baseline

Targeted command:

```bash
pnpm exec vitest run src/codexSlashCommands.test.ts src/api/codexGateway.test.ts src/composables/useDesktopState.test.ts
```

Current result: `3 failed` files, `8 failed | 35 passed` tests.

Expected red failures:

- `sideCommand.webSupported` is currently `false`.
- `forkSideThread` and `startSideThread` are not exported by `codexGateway`.
- `openSideChatForSelectedThread`, `sendMessageToSideChat`, `closeSideChat`, `sideThreadId`, `sideMessages`, and `sideLiveOverlay` are not returned by `useDesktopState`.

## Phase Checklist

- [x] Phase 0: TDD branch and red tests
- [ ] Phase 1: Gateway contract
- [ ] Phase 2: Desktop state and notification routing
- [ ] Phase 3: Slash command integration
- [ ] Phase 4: Side panel UI
- [ ] Phase 5: Requests, approvals, and error handling
- [ ] Phase 6: Documentation, regression, and performance audit

## Phase 0: TDD Branch and Red Tests

Purpose: define behavior before implementation.

Atomic steps:

- [x] Create isolated branch/worktree: `side-chat-tdd-tests` at `/home/rnl1/prog/codexUI-side-chat-tdd`.
- [x] Add slash-command expectation tests in [src/codexSlashCommands.test.ts](../src/codexSlashCommands.test.ts).
- [x] Add gateway expectation tests in [src/api/codexGateway.test.ts](../src/api/codexGateway.test.ts).
- [x] Add desktop-state expectation tests in [src/composables/useDesktopState.test.ts](../src/composables/useDesktopState.test.ts).
- [x] Run targeted Vitest baseline and record expected failures.

Smoke test:

```bash
pnpm exec vitest run src/codexSlashCommands.test.ts src/api/codexGateway.test.ts src/composables/useDesktopState.test.ts
```

Phase gate:

- [x] Red tests fail only because side-chat APIs are missing.
- [x] No production code changed.

## Phase 1: Gateway Contract

Purpose: add the safe app-server RPC layer for ephemeral side forks.

Atomic steps:

- [ ] Export `forkSideThread(parentThreadId)` from `codexGateway`.
- [ ] Send `thread/fork` with `{ threadId, ephemeral: true, persistExtendedHistory: true }`.
- [ ] Normalize returned `threadId`, `cwd`, and `model`.
- [ ] Export `startSideThread(parentThreadId)` as the UI-facing gateway helper.
- [ ] Keep unsupported-ephemeral failures explicit; do not silently start a normal turn in the main thread.
- [ ] Keep existing `forkThread` behavior unchanged.

Smoke tests:

```bash
pnpm exec vitest run src/api/codexGateway.test.ts
```

Phase regression:

```bash
pnpm exec vitest run src/codexSlashCommands.test.ts src/api/codexGateway.test.ts src/composables/useDesktopState.test.ts
pnpm run build:frontend
pnpm run test:coverage
```

Phase performance audit:

- Code-path audit for duplicate RPCs, fallback loops, payload size, and unsupported-backend behavior.
- No browser profiler required unless this phase changes startup/thread loading.

## Phase 2: Desktop State and Notification Routing

Purpose: let the UI keep main and side threads visible at the same time.

Atomic steps:

- [ ] Add `sideThreadId`, `sideMessages`, and `sideLiveOverlay` state.
- [ ] Add `openSideChatForSelectedThread()`.
- [ ] Ensure opening Side Chat does not call `setSelectedThreadId`.
- [ ] Add `sendMessageToSideChat(...)` and route turns to `sideThreadId`.
- [ ] Keep `sendMessageToSelectedThread(...)` bound to the main selected thread.
- [ ] Generalize message/live-overlay helpers so selected and side threads can stream independently.
- [ ] Route side-thread deltas into side state only.
- [ ] Add `closeSideChat()` cleanup.
- [ ] Prune/cleanup side state without affecting persisted main thread state.

Smoke tests:

```bash
pnpm exec vitest run src/composables/useDesktopState.test.ts
```

Phase regression:

```bash
pnpm exec vitest run src/codexSlashCommands.test.ts src/api/codexGateway.test.ts src/composables/useDesktopState.test.ts
pnpm run build:frontend
pnpm run test:coverage
```

Phase performance audit:

- Inspect notification handling for duplicate work, unbounded fanout, and unnecessary main-thread refreshes.
- If thread loading or realtime rendering changes broadly, run:

```bash
pnpm run dev --host 127.0.0.1 --port 4173
PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_WAIT_MS=7000 pnpm run profile:browser
```

## Phase 3: Slash Command Integration

Purpose: make `/side` open Side Chat from the composer.

Atomic steps:

- [ ] Add `side` to `WEB_SUPPORTED_COMMANDS`.
- [ ] Handle `/side` in `App.vue`.
- [ ] If `/side` has args, open Side Chat and send the args as the first side message.
- [ ] If `/side` has no args, open an empty Side Chat panel.
- [ ] Keep unsupported commands falling through to the existing message.
- [ ] Do not change `/fork`, `/new`, `/plan`, or `/review` behavior.

Smoke tests:

```bash
pnpm exec vitest run src/codexSlashCommands.test.ts
```

Phase regression:

```bash
pnpm exec vitest run src/codexSlashCommands.test.ts src/api/codexGateway.test.ts src/composables/useDesktopState.test.ts
pnpm run build:frontend
pnpm run test:coverage
```

## Phase 4: Side Panel UI

Purpose: provide the friendly in-page window without disrupting main chat.

Atomic steps:

- [ ] Add `SideChatPanel.vue`.
- [ ] Mount it beside the current thread route in `App.vue`.
- [ ] Add a `Side` button in the `ContentHeader` action area for active thread routes.
- [ ] Render side messages and side live overlay.
- [ ] Add side composer input with send/disabled/loading states.
- [ ] Add close action.
- [ ] Desktop layout: right-side panel.
- [ ] Mobile layout: drawer or bottom sheet.
- [ ] Ensure light and dark themes are both intentional.
- [ ] Ensure review mode and terminal panel interactions have a deterministic priority.

Smoke tests:

```bash
pnpm run build:frontend
```

Manual smoke:

- Open a thread.
- Open Side Chat.
- Ask a one-off question.
- Confirm the main transcript does not receive the side question or side answer.
- Close Side Chat and confirm the main thread remains selected.

Phase regression:

```bash
pnpm exec vitest run src/codexSlashCommands.test.ts src/api/codexGateway.test.ts src/composables/useDesktopState.test.ts
pnpm run build:frontend
pnpm run test:coverage
```

Phase performance audit:

```bash
pnpm run dev --host 127.0.0.1 --port 4173
PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_WAIT_MS=7000 pnpm run profile:browser
```

Inspect `output/playwright/browser-runtime-profile-*.json` for duplicate counts, warnings, total API KB, top API rows, and slow API rows.

## Phase 5: Requests, Approvals, and Error Handling

Purpose: keep side conversations safe when tools or user input are involved.

Atomic steps:

- [ ] Add side-thread server request accessors.
- [ ] Surface side-thread `item/tool/requestUserInput` in the side panel or a shared request panel.
- [ ] Surface approval requests clearly as side requests.
- [ ] Reject or disable side mutation paths if the backend cannot enforce ephemeral fork behavior.
- [ ] Show a clear error if current Codex CLI/app-server does not support ephemeral side forks.
- [ ] Ensure closing a side chat with pending side requests is handled intentionally.

Smoke tests:

```bash
pnpm exec vitest run src/composables/useDesktopState.test.ts
pnpm run build:frontend
```

Phase regression:

```bash
pnpm exec vitest run src/codexSlashCommands.test.ts src/api/codexGateway.test.ts src/composables/useDesktopState.test.ts
pnpm run build:frontend
pnpm run test:coverage
```

## Phase 6: Documentation, Regression, and Release Readiness

Purpose: finish the feature with durable testing notes and measured risk.

Atomic steps:

- [ ] Update [tests.md](../tests.md) with manual Side Chat test cases.
- [ ] Include light-theme and dark-theme manual verification.
- [ ] Document fallback behavior for unsupported ephemeral forks.
- [ ] Document that Side Chat is temporary/one-off in the first release.
- [ ] Run full targeted and project-level tests.
- [ ] Run required lint/build/coverage gates.
- [ ] Run performance audit and record results.
- [ ] Commit each completed phase separately.
- [ ] Before merging to local main, diff-compare branch against main.

Final regression:

```bash
pnpm exec vitest run src/codexSlashCommands.test.ts src/api/codexGateway.test.ts src/composables/useDesktopState.test.ts
pnpm run build:frontend
pnpm run test:coverage
pnpm run test
```

Final browser/performance audit:

```bash
pnpm run dev --host 127.0.0.1 --port 4173
PROFILE_BASE_URL=http://127.0.0.1:4173 PROFILE_WAIT_MS=7000 pnpm run profile:browser
```

Completion criteria:

- [ ] Main thread remains selected and unpolluted while Side Chat is open.
- [ ] Side messages stream into the side panel.
- [ ] `/side <question>` opens Side Chat and sends the question there.
- [ ] Closing Side Chat leaves the main thread intact.
- [ ] Unsupported backend behavior is explicit and safe.
- [ ] Light and dark theme verification is documented.
- [ ] Performance audit shows no changed-path duplicate requests or unacceptable payload growth.

## Work Log

- [x] 2026-05-28: Created isolated branch/worktree `side-chat-tdd-tests`.
- [x] 2026-05-28: Added slash-command red tests.
- [x] 2026-05-28: Added gateway red tests.
- [x] 2026-05-28: Added desktop-state red tests.
- [x] 2026-05-28: Refined state test contract to use `startSideThread`.
- [x] 2026-05-28: Ran targeted red baseline: `8 failed | 35 passed`.
- [ ] Implementation paused until explicit user approval.
