# Directory Hub Apps Failure Message Source

Date: 2026-05-27

## Scope

This source records the Directory Hub Apps tab error-state behavior for app-list failures.

## Behavior

- `DirectoryHub.vue` treats `app/list` failures as a user-facing availability state.
- The visible Apps tab message is `Apps directory temporarily unavailable. Refresh or try again later.`
- Raw backend details such as RPC method names, JSON payloads, stack traces, or HTML error bodies are not rendered in the Apps tab error block.
- Refreshing the Apps tab repeats the same concise message while the directory remains unavailable.

## Manual Verification

- Manual coverage is documented in `tests.md` under `Directory Hub Apps Directory Failure`.
- The manual check covers both light theme and dark theme.
