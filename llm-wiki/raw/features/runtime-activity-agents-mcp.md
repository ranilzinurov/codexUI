# Runtime Activity Agents and MCP

Source date: 2026-05-25

This source records the implementation facts for the composer runtime activity panel that groups sub-agent status rows with active MCP work.

- `src/types/codex.ts` extends `UiLiveOverlay` with `mcpActivities: UiMcpActivity[]`.
- `UiMcpActivity` is a compact UI row shape: `id`, display `name`, `detail`, and status.
- `src/composables/useDesktopState.ts` builds MCP activity rows from pending `mcpServer/elicitation/request` and MCP-shaped `item/tool/call` server requests.
- `src/composables/useDesktopState.ts` also tracks live `mcpToolCall` events from `item/started`, `item/mcpToolCall/progress`, and `item/completed`.
- Live MCP activity is scoped by thread and cleared with other completed-turn live state.
- `src/components/content/ThreadComposer.vue` renders runtime activity above the composer input, with agent rows first and MCP rows second.
- The composer activity panel can collapse to a one-line summary that includes grouped counts for agents and MCP.
- `src/api/normalizers/v2.ts` normalizes persisted `mcpToolCall` items as renderable system messages with raw payloads, so collapsed-summary fixtures can assert MCP activity visibility.
- `tests.md` includes manual light-theme and dark-theme verification steps for the collapsible activity panel.
