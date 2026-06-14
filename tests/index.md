# Supplemental Manual Test Docs

Root [`../tests.md`](../tests.md) remains the canonical manual-test log for this repository. These domain files are supplemental upstream-derived checks for features that have been selectively imported into this fork.

## Domains

| Domain | Scope |
| --- | --- |
| [Accounts, Feedback, and Observability](accounts-feedback-observability/index.md) | Browser profiling and startup request dedupe checks. |
| [Auth and Docker Runtime](auth-docker-runtime/index.md) | Auth promotion and provider recovery checks. |
| [Automations](automations/index.md) | Automation editor layout and dark-theme checks. |
| [Chat Composer and Rendering](chat-composer-rendering/index.md) | Markdown/file-link parsing and composer attachment checks. |
| [CLI, Network, and Platform](cli-network-platform/index.md) | Isolated dev helper and startup probe checks. |
| [Git, Worktrees, and Rollback](git-worktrees-rollback/index.md) | Git dropdown, file-change panels, and rollback/undo checks. |
| [Projects, Sidebar, and New Chat](projects-sidebar-new-chat/index.md) | Project ZIP import/export checks. |
| [Providers and Models](providers-models/index.md) | Provider-backed model loading and scheduled refresh checks. |
| [Thread Loading and State](thread-loading-state/index.md) | Startup priming, capped loads, duplicate reads, and message cache checks. |

## Template

Use [`template.md`](template.md) when adding a new supplemental domain test.
