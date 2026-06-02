# Runtime Activity Panel

Sources:
- [runtime-activity-agents-mcp.md](../raw/features/runtime-activity-agents-mcp.md)
- [mcp-runtime-status-stdio.md](../raw/features/mcp-runtime-status-stdio.md)

The runtime activity panel is the compact status area above the thread composer. It keeps active work visible without letting many delegated agents cover the input area.

## Data Model

`UiLiveOverlay` carries two grouped activity collections:

- `collabAgents`: sub-agent rows with name, task, and status.
- `mcpActivities`: MCP rows with server name, detail text, status, and optional server/tool/duration/error metadata.

The MCP row model is intentionally small. Raw MCP arguments, results, and structured content stay out of the composer UI; the panel only needs the current server/tool label and a short progress or waiting message.

## Runtime Sources

`useDesktopState` derives MCP activity from two sources:

- Pending server requests, including `mcpServer/elicitation/request` and MCP-shaped `item/tool/call`.
- Realtime MCP tool-call notifications: `item/started`, `item/mcpToolCall/progress`, and `item/completed`.

Thread-scoped live MCP rows are cleared with other completed-turn live state, so inactive MCP work does not remain pinned in the composer.

## UI Behavior

`ThreadComposer` renders agents first and MCP rows below them. The MCP section represents the current operational state, not the full event log: completed MCP calls are aggregated into a done count, while visible rows are limited to active `failed`, `waiting`, and `running` work. Failed rows sort first, then waiting rows, then running rows, with an overflow count for additional active calls.

Persisted MCP calls in thread history are represented separately as compact expandable conversation rows. `normalizeThreadMessagesV2` preserves a structured `mcpToolCall` summary and the raw payload; `ThreadConversation` shows server, tool, status/duration, error text when present, and raw JSON only after expansion.

Directory Hub also consumes richer MCP server status metadata. When `mcpServerStatus/list` returns `serverInfo`/`server_info`, the UI can show title, description, version, website, and icon metadata while still falling back to the configured server name for older app-server versions.

App-server startup now prefers the explicit `codex app-server --stdio` transport and retries once without that flag when an older CLI rejects it.

Dark-theme overrides for the shared composer activity surface live in `src/style.css`, matching the repository convention for large route surfaces.
