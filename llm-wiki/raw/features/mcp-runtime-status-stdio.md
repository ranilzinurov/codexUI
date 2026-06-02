# MCP Runtime Status And Stdio Launch Source Notes

Date: 2026-06-02

Source context:
- User requested improvements inspired by OpenAI Codex `rust-v0.136.0`.
- Relevant upstream changes: app-server MCP status now includes `serverInfo` metadata; `codex app-server --stdio` is an explicit stdio alias; `thread/resume` initial turns pagination was analyzed but intentionally deferred.

Implemented facts:
- `src/types/codex.ts` extends live MCP activity with optional server/tool/duration/error fields and persisted `UiMessage.mcpToolCall` structured data.
- `src/composables/useDesktopState.ts` fills live MCP activity metadata from pending requests and realtime MCP item payloads.
- `src/components/content/ThreadComposer.vue` treats the runtime panel as operational state: completed MCP calls are counted, active rows are sorted failed/waiting/running, and only a small active set is rendered.
- `src/api/normalizers/v2.ts` converts persisted `mcpToolCall` thread items into structured UI messages while retaining `rawPayload`.
- `src/components/content/ThreadConversation.vue` renders persisted MCP tool calls as compact expandable rows with server, tool, status/duration, error text, and raw JSON.
- `src/api/codexGateway.ts` tolerantly normalizes `mcpServerStatus/list` `serverInfo`/`server_info` metadata.
- `src/components/content/DirectoryHub.vue` surfaces MCP server title, description, version, website, and icon metadata when available.
- `src/server/appServerRuntimeConfig.ts` and `src/server/codexAppServerBridge.ts` prefer launching `codex app-server --stdio` and retry once without `--stdio` for older CLI versions.

Verification notes:
- Focused Vitest coverage was added for live MCP activity, Directory MCP server metadata normalization, persisted MCP message normalization, and stdio fallback behavior.
- Manual verification is documented in `tests.md` under "MCP Runtime Activity And Server Metadata".

Deferred:
- `thread/resume.initialTurnsPage` / cursor-based `thread/turns/list` migration remains a follow-up feature because local generated app-server schemas lag the upstream release and compatibility fallback needs a broader pagination refactor.
