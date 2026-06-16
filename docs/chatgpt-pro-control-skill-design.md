# ChatGPT Pro Control Skill Design

## Goal

Build a Codex skill and browser-extension capability that lets Codex consult the user's logged-in ChatGPT Pro session from a remote server, wait for the final answer, copy the result back, and continue working automatically.

Primary scenario:

- Codex runs on a server.
- The browser extension runs on the user's MacBook Chrome profile.
- ChatGPT is logged in in the user's browser.
- Codex asks ChatGPT Pro Extended for advice, usually with a repository zip attached.
- The extension drives `chatgpt.com`, waits for the completed response, copies the answer, downloads any generated attachments, and returns structured results to Codex.
- Codex treats the Pro answer as advisory, verifies it against the local repository, applies only relevant changes, runs checks, and records an audit trail.

## Non-Goals

- Do not automate ChatGPT login, account switching, 2FA, or CAPTCHA flows.
- Do not call private ChatGPT backend APIs as the primary implementation path.
- Do not blindly apply code or files returned by ChatGPT.
- Do not require per-task user confirmation after the capability is enabled.
- Do not create a second browser extension for the MVP.

## Existing Foundation

The current browser annotation extension already solves the remote connectivity problem:

- Codex UI/server exposes `/codex-api/extension/*`.
- The extension pairs once through `/codex-api/extension/binding/start` and `/codex-api/extension/binding/complete`.
- The extension stores a long-lived `browser-binding` token.
- Public ingress for extension traffic already proxies `/codex-api/extension/*` to the Codex UI server.

Pro-control should reuse this binding model and add a new route namespace instead of introducing localhost transport.

## Architecture

```text
Codex skill on server
  -> helper script
    -> Codex UI backend /codex-api/extension/pro-control/*
      -> in-memory Pro task queue
        <- extension long-polls with browser binding token
      -> extension controls chatgpt.com tab
      <- extension posts result and attachments
  <- helper script receives raw Pro answer
Codex validates answer, applies relevant changes, runs checks, writes audit log
```

The skill is thin. Most logic lives in helper scripts and server/extension modules.

Recommended skill layout:

```text
~/.codex/skills/chatgpt-pro-consult/
  SKILL.md
  scripts/pro_consult.mjs
  scripts/build_repo_bundle.mjs
```

Recommended repository implementation layout:

```text
src/server/proControl.ts
src/server/proControl.test.ts
extension/browser-annotation/pro-control/task-client.js
extension/browser-annotation/pro-control/pro-control-worker.js
extension/browser-annotation/pro-control/chatgpt-adapter.js
```

## Auth Model

Use two auth scopes:

- Internal skill token: authorizes Codex/server-side task creation and status polling.
- Browser binding token: authorizes the extension to poll, claim, run, and complete tasks.

Internal token behavior:

- Prefer `CODEXUI_PRO_CONTROL_TOKEN` when set.
- Otherwise generate a random token at server startup and write it to ignored runtime state:

```text
.codex/pro-control/server-token
```

Extension auth:

- Reuse the existing persistent browser binding token.
- Extension polling identifies the active worker by the authorized binding.

## Backend Endpoints

Namespace:

```text
/codex-api/extension/pro-control/*
```

Skill/internal endpoints:

```text
POST /codex-api/extension/pro-control/files
POST /codex-api/extension/pro-control/tasks
GET  /codex-api/extension/pro-control/tasks/:taskId
GET  /codex-api/extension/pro-control/tasks/:taskId/result-files/:fileId
```

Extension endpoints:

```text
GET  /codex-api/extension/pro-control/poll?timeoutMs=25000
GET  /codex-api/extension/pro-control/files/:fileId
POST /codex-api/extension/pro-control/tasks/:taskId/status
POST /codex-api/extension/pro-control/tasks/:taskId/result-files
POST /codex-api/extension/pro-control/tasks/:taskId/result
```

Use HTTPS long-polling for MVP. WebSocket can be added later, but long-polling is more tolerant of Manifest V3 service-worker suspension.

Task status shape:

```ts
type ProControlTaskStatus =
  | "queued"
  | "claimed"
  | "running"
  | "completed"
  | "failed"
  | "expired";
```

Task model:

```ts
type ProControlTask = {
  id: string;
  targetBindingId: string | null;
  projectId: string;
  codexThreadId: string;
  proSessionKey: string;
  mode: "new-chat" | "continue-current-chat";
  prompt: string;
  promptMarker: string;
  files: ProControlFileRef[];
  status: ProControlTaskStatus;
  statusDetail?: string;
  createdAtMs: number;
  claimedAtMs?: number;
  heartbeatAtMs?: number;
  completedAtMs?: number;
  result?: ProControlResult;
  error?: string;
};
```

TTL recommendations:

- Queued: 2 minutes.
- Running: 90 minutes.
- Completed result in memory: 30 minutes.
- Audit log on disk: retained until explicit cleanup.

## Worker And Queue Semantics

Most users have one extension binding. Support multiple bindings internally, but keep MVP UX automatic:

- If one active binding exists, use it.
- If a new binding appears, it may become default.
- If the default binding is offline, tasks wait briefly and then fail with `pro_worker_offline`.

One browser worker runs one ChatGPT task at a time. Use a global FIFO queue per extension/browser.

Each Codex thread gets its own logical Pro session:

```text
Pro session key = projectId + ":" + codexThreadId
```

Each Pro session maps to a separate ChatGPT conversation URL:

```ts
type ProSession = {
  sessionKey: string;
  projectId: string;
  codexThreadId: string;
  conversationUrl?: string;
  createdAtMs: number;
  lastUsedAtMs: number;
  model: "pro";
  reasoning: "extended";
};
```

Store session URLs on the Codex UI server in ignored state:

```text
.codex/pro-control/sessions.json
```

The extension may cache session data, but the server is the source of truth.

## Extension Capability

Add Pro-control to the existing `browser-annotation` extension as a separate module/capability.

Sidepanel MVP UI:

- Pro remote control enabled/disabled toggle.
- Worker status: online, idle, running, error.
- Current task status.
- Last completion/error timestamp.

When enabling Pro-control, request host permission:

```js
chrome.permissions.request({
  origins: ["https://chatgpt.com/*"]
});
```

The capability should long-poll only when enabled and connected.

## Execution Mode

Support both modes:

```ts
type ExecutionMode = "background" | "foreground";
```

Default behavior:

- Prefer background execution.
- Automatically fall back to foreground without confirmation.
- Record requested mode, actual mode, and fallback reason in result metadata.

Foreground mode may activate the ChatGPT tab/window and should try to restore the previous active tab after completion.

## ChatGPT Adapter

Use a site-specific `ChatGPTAdapter`, not a generic DOM clicker.

Adapter interface:

```ts
interface ChatGPTAdapter {
  canHandle(url: string): boolean;
  openOrCreateSession(task: ProControlTask, session: ProSession): Promise<ProSession>;
  ensureProExtended(): Promise<AdapterWarning[]>;
  attachFiles(files: File[]): Promise<AdapterWarning[]>;
  sendPrompt(prompt: string): Promise<void>;
  waitForFinalResponse(task: ProControlTask): Promise<void>;
  copyFinalResponse(task: ProControlTask): Promise<CopiedResponse>;
  collectAttachments(task: ProControlTask): Promise<DownloadedAttachment[]>;
}
```

New Pro session flow:

1. Open or find `chatgpt.com`.
2. Click New chat.
3. Select Pro model.
4. Select Pro Extended reasoning.
5. Assert visible composer/model state when possible.
6. Attach files.
7. Send prompt.
8. Capture and persist conversation URL.

Follow-up flow:

1. Open saved conversation URL.
2. Verify or repair Pro Extended state if the UI allows it.
3. Attach files.
4. Send prompt.

Selector strategy:

- Prefer stable `data-testid`.
- Use RU and EN aria/text fallbacks.
- Do not rely on dynamic Radix ids as primary selectors.

Examples:

```ts
const selectors = {
  newChat: [
    '[data-testid="create-new-chat-button"]',
    'aria/Новый чат',
    'aria/New chat',
  ],
  composer: [
    '#prompt-textarea',
    'aria/Чат с ChatGPT',
    'aria/Message ChatGPT',
  ],
  send: [
    '[data-testid="send-button"]',
  ],
  proExtended: [
    'aria/Pro расширенный',
    'aria/Pro extended',
    'text/Pro расширенный',
    'text/Pro extended',
  ],
  copyResponse: [
    'aria/Копировать ответ',
    'aria/Copy response',
  ],
};
```

## Prompt Marker

Every task prompt includes a visible marker:

```text
[Codex Pro task: <taskId>]
```

Use it to match the user turn and final assistant response. If the page state no longer matches the marker, fail the task with `chatgpt_tab_interrupted`.

## Final Response Detection

Do not treat intermediate reasoning/status text as final.

Primary ready signal:

- The last assistant turn after the task marker exposes "Копировать ответ" / "Copy response".

Additional required checks:

- No stop button or active generation indicator.
- No "Pro думает" / "Pro is thinking".
- No "Завершение ответа" / "Finishing response".
- Assistant text is stable for 5-10 seconds.

Timeouts:

```ts
maxWaitMs: 90 * 60 * 1000;
stableTextMs: 8000;
heartbeatEveryMs: 15000;
```

## Result Extraction

Primary read method:

1. Find the final assistant turn.
2. Click "Copy response".
3. Read clipboard text.
4. Validate non-empty result.
5. Try to restore previous clipboard value.
6. Return copied markdown/text.

Fallback:

- Extract structured DOM text from the final assistant turn.
- Mark result with `readMethod: "dom-fallback"`.

Clipboard restoration failure should not fail the task. Return metadata:

```json
{
  "readMethod": "copy-response",
  "clipboardRestored": false
}
```

## Downloads And Attachments

The extension should automatically download all allowed attachments found in the final assistant turn.

Use Chrome downloads API for MVP.

Recommended permission:

```json
"downloads"
```

Result attachment model:

```ts
type ProControlAttachment = {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
};
```

Suggested policy:

- Maximum attachment size: 50 MB.
- Allow: zip, txt, md, json, patch, diff, png, jpg, pdf.
- Block path traversal, absolute paths, executable payloads, browser profile data, cookies, sessions, credentials, and secrets.

Blocked attachments should not fail the task. Return the text result plus warnings.

Codex should automatically save, inspect, and use attachments:

- Patches/diffs: run `git apply --check`, then apply only relevant hunks.
- Zip archives: extract to a temp/audit directory, inspect file list and paths, compare with current worktree, apply only relevant changes.
- Text/markdown/json: use as additional context.

Downloaded attachments are advisory. Do not blindly overwrite repository files.

## Repository Bundle Policy

Default skill mode for code tasks:

```ts
mode: "repo-bundle";
```

Also support:

```ts
mode: "question-only";
```

Repository bundle contents:

```text
CODEx_PRO_BUNDLE_MANIFEST.md
CODEx_PRO_FILE_TREE.txt
CODEx_PRO_GIT_STATUS.txt
CODEx_PRO_GIT_DIFF.patch
CODEx_PRO_GIT_RECENT_COMMITS.txt
CODEx_PRO_GIT_RECENT_PATCHES.patch
CODEx_PRO_TEST_OUTPUT.txt
CODEx_PRO_BUILD_OUTPUT.txt
<repo files>
```

Include:

- Git-tracked files.
- Relevant untracked files.
- Current uncommitted diff.
- 25 recent commit summaries.
- 10 recent full commit patches.
- Fresh relevant test/build/error logs, bounded by size.

Exclude:

- `.git/`
- `node_modules/`
- `dist/`, `build/`, generated artifacts
- `output/` unless explicitly relevant
- `.env*`
- private keys, credentials, tokens
- browser profiles, cookies, session storage
- large binaries and unsupported binary assets

Limits:

```ts
maxZipBytes: 25 * 1024 * 1024;
maxSingleFileBytes: 2 * 1024 * 1024;
maxTotalFiles: 2000;
maxLogBytes: 300 * 1024;
maxTotalLogBytes: 1024 * 1024;
```

If the full bundle exceeds 25 MB, automatically create a reduced bundle and mention this in the prompt. Reduced bundle should include manifest, file tree, git status, git diff, recent commit context, configs, changed files, files mentioned by the user, and discoverable related tests.

## Prompt Format

Use Russian by default.

Template:

````md
Ты консультируешь Codex по задаче в репозитории.

Репозиторий: <path>
Проект: <projectId>
Тред Codex: <threadId>

Цель пользователя:
<user request>

Что уже известно:
<context summary>

Приложенные файлы:
- <path>

Ответь строго в формате:
1. Выводы
2. Рекомендуемые изменения
3. Риски и предположения
4. Какие проверки/тесты запустить
5. Какие дополнительные файлы нужны, если контекста недостаточно

Если нужны дополнительные файлы, добавь в конец machine-readable JSON-блок:

```json
{
  "requestedFiles": []
}
```

Не выдумывай содержимое файлов, которых нет в сообщении или вложениях. Если нужен файл, попроси его по точному пути.

[Codex Pro task: <taskId>]
````

If Pro requests additional files, the skill automatically follows up in the same ChatGPT conversation when files are inside the workspace and pass policy. Maximum automatic follow-ups: 3.

## Audit Log

Store audit artifacts near the project, ignored by git:

```text
.codex/pro-control/
  server-token
  sessions.json
  consultations/
    2026-06-16T12-30-10Z-task-abc/
      prompt.md
      raw-pro-answer.md
      codex-assessment.md
      metadata.json
      bundle/
      attachments/
        original/
        extracted/
```

Metadata should include:

- task id
- project id
- Codex thread id
- Pro session key
- ChatGPT conversation URL
- files sent
- bundle mode
- read method
- clipboard restoration status
- execution mode requested/used
- fallback reason
- downloaded attachments
- blocked attachment warnings
- accepted/rejected Pro recommendations
- applied attachment hunks
- tests run by skill
- tests recommended for main workflow

## Codex Assessment Policy

Pro answers are advisory, not authoritative.

Codex must:

1. Compare Pro's answer against the local worktree.
2. Reject stale, incorrect, unrelated, or risky assumptions.
3. Apply only verified and relevant changes.
4. Run relevant tests.
5. Record accepted and rejected points in `codex-assessment.md`.

The skill may run safe narrow tests automatically. Broad, slow, or environment-sensitive checks should be returned to the main Codex workflow as recommendations.

The Pro skill does not make git commits. It leaves verified worktree changes for the main task workflow to commit.

## Failure Modes

Expected task failures:

- `login_required`: ChatGPT opened but user is not logged in.
- `chatgpt_permission_missing`: extension lacks `https://chatgpt.com/*`.
- `pro_worker_offline`: no active extension worker polled in time.
- `chatgpt_tab_interrupted`: marker/session validation failed during task.
- `copy_response_unavailable`: final copy button did not appear before timeout.
- `clipboard_read_failed`: copy was clicked but clipboard could not be read.
- `bundle_too_large`: reduced bundle could not be created within policy.
- `file_blocked_by_policy`: requested file cannot be sent.
- `attachment_blocked`: attachment too large or disallowed.

Prefer returning partial text results with warnings when safe.

## Implementation Checklist

1. Backend store and auth
   - Add `src/server/proControl.ts`.
   - Add internal token generation and ignored `.codex/pro-control/server-token`.
   - Add in-memory task/file/result stores with TTL cleanup.
   - Add route tests for task creation, polling, status, result, and auth separation.

2. Extension Pro-control client
   - Add isolated `extension/browser-annotation/pro-control/` modules.
   - Add sidepanel toggle/status.
   - Request `https://chatgpt.com/*` permission when enabling.
   - Long-poll `/pro-control/poll` with browser binding token.
   - Claim one task at a time and post status heartbeats.

3. ChatGPT foreground adapter
   - Open/find ChatGPT tab.
   - New-chat flow for new sessions.
   - Conversation URL flow for follow-ups.
   - Select/check Pro Extended.
   - Upload files.
   - Send marker prompt.
   - Wait for final copy-response state.
   - Copy final answer and return result.

4. Background mode
   - Try background DOM operations first.
   - Automatically fallback to foreground when blocked.
   - Record fallback metadata.

5. Repository bundle helper
   - Build full and reduced zip bundles.
   - Include git status, diff, recent commit summaries, recent patches, file tree, and relevant logs.
   - Enforce denylist and size limits.

6. Skill helper
   - Upload bundle/files.
   - Create task with project/thread session key.
   - Poll result.
   - Parse requested-files JSON.
   - Perform up to 3 automatic follow-ups.
   - Write audit log.

7. Downloads and attachment handling
   - Add downloads permission and implementation.
   - Upload downloaded result files back to server.
   - Save, extract, inspect, and use attachments automatically.
   - Apply only relevant hunks after validation.

8. Verification
   - Backend unit tests for auth, queue ordering, TTLs, result upload/download.
   - Extension smoke tests for permission/toggle/polling.
   - Adapter manual test against logged-in ChatGPT Pro.
   - Bundle builder tests for denylist, reduced mode, and manifest contents.
   - End-to-end manual test: Codex skill sends repo bundle, extension asks Pro, copies answer, downloads attachments, Codex writes audit log.

## Acceptance Criteria

- A paired extension can be enabled as a Pro-control worker without per-task confirmation.
- Codex can create a Pro task from the server and receive a result through the user's Mac browser.
- New Codex threads create isolated ChatGPT conversations.
- Follow-ups reuse the correct saved ChatGPT conversation URL.
- The extension waits for the final "Copy response" state and returns copied text.
- Repository zip bundle is attached by default for code tasks and reduced automatically when over limit.
- Downloaded attachments are returned to Codex and handled automatically within policy.
- Pro recommendations are assessed before use, with accepted/rejected decisions logged.
- Audit artifacts are written under `.codex/pro-control/` and are not committed.
- The MVP works without relying on private ChatGPT backend APIs.
