# Runtime Activity Panel

Source: [runtime-activity-agents-mcp.md](../raw/features/runtime-activity-agents-mcp.md)

The runtime activity panel is the compact status area above the thread composer. It keeps active work visible without letting many delegated agents cover the input area.

## Data Model

`UiLiveOverlay` carries two grouped activity collections:

- `collabAgents`: sub-agent rows with name, task, and status.
- `mcpActivities`: MCP rows with server name, detail text, and status.

The MCP row model is intentionally small. Raw MCP arguments, results, and structured content stay out of the composer UI; the panel only needs the current server/tool label and a short progress or waiting message.

## Runtime Sources

`useDesktopState` derives MCP activity from two sources:

- Pending server requests, including `mcpServer/elicitation/request` and MCP-shaped `item/tool/call`.
- Realtime MCP tool-call notifications: `item/started`, `item/mcpToolCall/progress`, and `item/completed`.

Thread-scoped live MCP rows are cleared with other completed-turn live state, so inactive MCP work does not remain pinned in the composer.

## UI Behavior

`ThreadComposer` renders agents first and MCP rows below them. When more than one activity row is present, the user can collapse the panel to a single summary line with grouped counts such as total, active, done, and failed.

Dark-theme overrides for the shared composer activity surface live in `src/style.css`, matching the repository convention for large route surfaces.
