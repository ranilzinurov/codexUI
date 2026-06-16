---
name: chatgpt-pro-consult
description: Consult the user's paired ChatGPT Pro browser session through Codex UI Pro-control, usually with a repository bundle attached, then assess the advisory answer before using it.
---

# ChatGPT Pro Consult

Use this skill when a task needs a second-pass ChatGPT Pro Extended consultation through the paired browser extension.

## Workflow

1. Confirm Codex UI is running and the browser annotation extension is paired with browser binding.
2. In the extension sidepanel, enable `ChatGPT Pro`.
3. Run from the repository root:

```sh
pnpm run pro:consult -- "<user task or review question>"
```

The helper:

- creates a repository bundle under `.codex/pro-control/bundles/`;
- falls back to a reduced bundle when policy limits are exceeded;
- submits a Pro-control task through `/codex-api/extension/pro-control/*`;
- follows `requestedFiles` JSON requests up to three times;
- writes `prompt.md`, `raw-pro-answer.md`, `codex-assessment.md`, `metadata.json`, and attachments under `.codex/pro-control/consultations/`.

## Policy

ChatGPT Pro output is advisory. Before using it:

- compare recommendations against the current worktree;
- reject stale, unrelated, unsafe, or unverifiable advice;
- apply only locally verified changes;
- run focused tests in the main Codex workflow;
- keep `.codex/pro-control/` uncommitted.
