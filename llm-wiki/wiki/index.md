# Index

## Overviews
- [overview.md](./overview.md): top-level scope and navigation for this wiki.

## Entities
- [entities/codex-web-local.md](./entities/codex-web-local.md): project identity, stack, and operational profile.

## Concepts
- [concepts/integrated-terminal.md](./concepts/integrated-terminal.md): Codex.app-style integrated xterm/PTY terminal architecture, edge cases, and verification.
- [concepts/directory-hub-composio-skills.md](./concepts/directory-hub-composio-skills.md): Directory Hub tab routing, Composio connector behavior, Skills search/install semantics, and edge-case testing.
- [concepts/composer-plugin-mentions.md](./concepts/composer-plugin-mentions.md): Composer `$` picker support for installed plugin mentions alongside skills.
- [concepts/browser-annotation-panel.md](./concepts/browser-annotation-panel.md): Browser Annotation Panel language, Draft Annotation flow, screenshot states, queue detail, destination freshness, and Diagnostics wording.
- [concepts/merge-to-main-workflow.md](./concepts/merge-to-main-workflow.md): branch integration and conflict-resolution workflow.
- [concepts/opencode-zen-big-pickle.md](./concepts/opencode-zen-big-pickle.md): OpenCode Zen Big Pickle model configuration for Codex CLI and OpenCode CLI.
- [concepts/provider-auth-models.md](./concepts/provider-auth-models.md): copied Codex auth promotion, provider model discovery, app-server config restart, and thread-locked provider behavior.
- [concepts/realtime-chat-rendering.md](./concepts/realtime-chat-rendering.md): realtime chat rendering, sync-churn reduction, and inline media sanitization.
- [concepts/runtime-activity-panel.md](./concepts/runtime-activity-panel.md): composer runtime activity model for grouped agents, MCP rows, and collapsed summaries.
- [concepts/skills-route-ui.md](./concepts/skills-route-ui.md): Skills route naming, first-launch Plugins card persistence, dark-theme fixes, and verification lessons.
- [concepts/manual-test-domain-docs.md](./concepts/manual-test-domain-docs.md): supplemental `tests/<domain>/` docs and the fork policy that root `tests.md` remains canonical.
- [concepts/thread-heartbeat-automations.md](./concepts/thread-heartbeat-automations.md): thread-scoped heartbeat automation storage, multi-automation management, and manual run behavior.
- [concepts/project-cron-automations.md](./concepts/project-cron-automations.md): project-scoped cron automation storage and sidebar management UI.
- [concepts/previous-response-recovery.md](./concepts/previous-response-recovery.md): provider stale-response retry and UI auto-continue behavior for `previous_response_not_found`.
- [concepts/project-zip-portability.md](./concepts/project-zip-portability.md): project ZIP export/import metadata, chat session rewriting, and manual verification.

## Sources
- [../raw/features/integrated-terminal.md](../raw/features/integrated-terminal.md): source facts for the integrated terminal implementation and follow-up tests.
- [../raw/features/directory-hub-composio-skills-search.md](../raw/features/directory-hub-composio-skills-search.md): source facts for Directory Hub, Composio connectors, Skills search/install, and edge-case tests.
- [../raw/features/installed-plugin-skill-tree.md](../raw/features/installed-plugin-skill-tree.md): source facts for grouping installed plugin skills by plugin cache ownership in the Skills Hub list.
- [../raw/features/composer-plugin-mentions.md](../raw/features/composer-plugin-mentions.md): source facts for composer plugin mentions, plugin catalog source, and mention payload format.
- [../raw/features/browser-annotation-panel-ux.md](../raw/features/browser-annotation-panel-ux.md): source facts for Browser Annotation Panel UX language, draft save flow, screenshot states, queue detail, and Diagnostics naming.
- [../raw/features/directory-hub-apps-failure-message.md](../raw/features/directory-hub-apps-failure-message.md): source facts for the Directory Hub Apps tab concise app-list failure message.
- [../raw/features/realtime-chat-rendering-inline-media.md](../raw/features/realtime-chat-rendering-inline-media.md): source facts for realtime chat rendering and inline media sanitization.
- [../raw/features/runtime-activity-agents-mcp.md](../raw/features/runtime-activity-agents-mcp.md): source facts for grouped agents/MCP runtime activity and collapsed summaries.
- [../raw/features/mcp-runtime-status-stdio.md](../raw/features/mcp-runtime-status-stdio.md): source facts for MCP runtime status compaction, persisted MCP history rows, richer server metadata, and `app-server --stdio` fallback.
- [../raw/features/skills-route-ui-and-first-launch-card.md](../raw/features/skills-route-ui-and-first-launch-card.md): source facts for the Skills route rename, first-launch Plugins card, dark-theme fix, and dev-server workflow adjustment.
- [../raw/features/manual-test-domain-folders.md](../raw/features/manual-test-domain-folders.md): upstream source facts for domain-based manual test documentation.
- [../raw/features/thread-heartbeat-automations.md](../raw/features/thread-heartbeat-automations.md): source facts for thread heartbeat automations, multiple automations per thread, and Run now queue behavior.
- [../raw/features/project-cron-automations.md](../raw/features/project-cron-automations.md): source facts for project cron automations in the sidebar.
- [../raw/projects/codex-web-local.md](../raw/projects/codex-web-local.md): immutable source snapshot for project facts.
- [../raw/fixes/codex-thread-link-pr174.md](../raw/fixes/codex-thread-link-pr174.md): source facts for PR #174 chat link parsing fixes, review-bot findings, and dynamic-origin thread URLs.
- [../raw/fixes/opencode-zen-big-pickle-codex-cli.md](../raw/fixes/opencode-zen-big-pickle-codex-cli.md): Big Pickle + Codex CLI fix details.
- [../raw/fixes/opencode-zen-reasoning-content-proxy.md](../raw/fixes/opencode-zen-reasoning-content-proxy.md): Codex Web Local Zen proxy reasoning_content round-trip fix and Docker verification.
- [../raw/fixes/copied-auth-provider-promotion.md](../raw/fixes/copied-auth-provider-promotion.md): copied `auth.json` promotion from community fallback provider state to Codex.
- [../raw/fixes/opencode-zen-docker-auth-provider-models.md](../raw/fixes/opencode-zen-docker-auth-provider-models.md): Docker auth/no-auth provider switching, first-turn live-state materialization, and provider-model loading fixes.
- [../raw/fixes/provider-config-restart-and-review-followups.md](../raw/fixes/provider-config-restart-and-review-followups.md): provider config restart behavior and follow-up provider-lock review findings.
- [../raw/fixes/thread-locked-provider-models.md](../raw/fixes/thread-locked-provider-models.md): thread provider locking across Zen, Codex, and OpenRouter model menus and sends.
- [../raw/fixes/previous-response-auto-continue.md](../raw/fixes/previous-response-auto-continue.md): source facts for the `previous_response_not_found` UI auto-continue watcher.
- [../raw/features/project-zip-portability.md](../raw/features/project-zip-portability.md): source facts for project ZIP export/import metadata, imported session rewriting, and verification.
