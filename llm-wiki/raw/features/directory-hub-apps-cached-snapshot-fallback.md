# Directory Hub Apps Cached Snapshot Fallback Source

Date captured: 2026-05-28

## Scope

This source records the Directory Hub Apps tab cached snapshot fallback behavior for failed `app/list` requests.

## Facts

- The bridge first attempts the real `app/list` RPC.
- If that RPC fails and the request is not `forceRefetch` or thread-scoped, the bridge returns a normal `{ data, nextCursor }` page from the latest `app/list/updated` snapshot.
- If no notification snapshot exists, the bridge reads the newest valid local cache file under `CODEX_HOME/cache/codex_app_directory`.
- Fallback pagination uses bridge-owned cursors prefixed with `codexui-app-list:` so opaque app-server cursors are not decoded as offsets.
- If no cached fallback page is available, the gateway propagates the final rejection so the UI can show the concise unavailable state.
- Gateway normalization ignores unknown top-level fields while preserving normalized app rows.
- Unit coverage lives in `src/server/codexAppServerBridge.appListFallback.test.ts` and `src/api/codexGateway.test.ts`.
- Manual coverage is documented in `tests.md` under `Directory Hub Apps Cached Snapshot Fallback`.

## Verification Notes

- Server tests cover notification snapshots, disk cache fallback, prefixed fallback cursors, force-refetch/thread-scoped rejection, and malformed cache handling.
- Gateway tests cover normal app rows, unknown top-level metadata, and final rejection propagation.
- Manual UI testing should confirm cached snapshot app rows remain visible in both light theme and dark theme when the upstream app directory request fails.
