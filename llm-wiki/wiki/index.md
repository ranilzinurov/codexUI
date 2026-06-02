# Index

## Overviews
- [overview.md](./overview.md): top-level scope and navigation for this wiki.

## Entities
- [entities/codex-web-local.md](./entities/codex-web-local.md): project identity, stack, and operational profile.

## Concepts
- [concepts/integrated-terminal.md](./concepts/integrated-terminal.md): Codex.app-style integrated xterm/PTY terminal architecture, edge cases, and verification.
- [concepts/directory-hub-composio-skills.md](./concepts/directory-hub-composio-skills.md): Directory Hub tab routing, Composio connector behavior, Skills search/install semantics, and edge-case testing.
- [concepts/merge-to-main-workflow.md](./concepts/merge-to-main-workflow.md): branch integration and conflict-resolution workflow.
- [concepts/opencode-zen-big-pickle.md](./concepts/opencode-zen-big-pickle.md): OpenCode Zen Big Pickle model configuration for Codex CLI and OpenCode CLI.
- [concepts/realtime-chat-rendering.md](./concepts/realtime-chat-rendering.md): realtime chat rendering, sync-churn reduction, and inline media sanitization.
- [concepts/runtime-activity-panel.md](./concepts/runtime-activity-panel.md): composer runtime activity model for grouped agents, MCP rows, and collapsed summaries.
- [concepts/skills-route-ui.md](./concepts/skills-route-ui.md): Skills route naming, first-launch Plugins card persistence, dark-theme fixes, and verification lessons.
- [concepts/thread-heartbeat-automations.md](./concepts/thread-heartbeat-automations.md): thread-scoped heartbeat automation storage, multi-automation management, and manual run behavior.
- [concepts/project-cron-automations.md](./concepts/project-cron-automations.md): project-scoped cron automation storage and sidebar management UI.
- [concepts/previous-response-recovery.md](./concepts/previous-response-recovery.md): provider stale-response retry and UI auto-continue behavior for `previous_response_not_found`.

## Sources
- [../raw/features/integrated-terminal.md](../raw/features/integrated-terminal.md): source facts for the integrated terminal implementation and follow-up tests.
- [../raw/features/directory-hub-composio-skills-search.md](../raw/features/directory-hub-composio-skills-search.md): source facts for Directory Hub, Composio connectors, Skills search/install, and edge-case tests.
- [../raw/features/directory-hub-apps-failure-message.md](../raw/features/directory-hub-apps-failure-message.md): source facts for the Directory Hub Apps tab concise app-list failure message.
- [../raw/features/realtime-chat-rendering-inline-media.md](../raw/features/realtime-chat-rendering-inline-media.md): source facts for realtime chat rendering and inline media sanitization.
- [../raw/features/runtime-activity-agents-mcp.md](../raw/features/runtime-activity-agents-mcp.md): source facts for grouped agents/MCP runtime activity and collapsed summaries.
- [../raw/features/mcp-runtime-status-stdio.md](../raw/features/mcp-runtime-status-stdio.md): source facts for MCP runtime status compaction, persisted MCP history rows, richer server metadata, and `app-server --stdio` fallback.
- [../raw/features/skills-route-ui-and-first-launch-card.md](../raw/features/skills-route-ui-and-first-launch-card.md): source facts for the Skills route rename, first-launch Plugins card, dark-theme fix, and dev-server workflow adjustment.
- [../raw/features/thread-heartbeat-automations.md](../raw/features/thread-heartbeat-automations.md): source facts for thread heartbeat automations, multiple automations per thread, and Run now queue behavior.
- [../raw/features/project-cron-automations.md](../raw/features/project-cron-automations.md): source facts for project cron automations in the sidebar.
- [../raw/projects/codex-web-local.md](../raw/projects/codex-web-local.md): immutable source snapshot for project facts.
- [../raw/fixes/codex-thread-link-pr174.md](../raw/fixes/codex-thread-link-pr174.md): source facts for PR #174 chat link parsing fixes, review-bot findings, and dynamic-origin thread URLs.
- [../raw/fixes/opencode-zen-big-pickle-codex-cli.md](../raw/fixes/opencode-zen-big-pickle-codex-cli.md): Big Pickle + Codex CLI fix details.
- [../raw/fixes/opencode-zen-reasoning-content-proxy.md](../raw/fixes/opencode-zen-reasoning-content-proxy.md): Codex Web Local Zen proxy reasoning_content round-trip fix and Docker verification.
- [../raw/fixes/previous-response-auto-continue.md](../raw/fixes/previous-response-auto-continue.md): source facts for the `previous_response_not_found` UI auto-continue watcher.
