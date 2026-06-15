# Upstream Sync Baseline

Created for GitHub issue #1 in `ranilzinurov/codexUI`.

## Scope

This sync keeps the local fork as the base implementation and imports upstream
changes from `friuns2/codexUI` only by feature/theme. A full upstream merge is
not the default path.

## Current Branch State

- Working branch: `upstream-sync-issues-20260614-182225`
- Base commit: `3d6673f` (`Group installed skills by plugin cache`)
- Local `main` was 3 commits ahead of `origin/main` when the worktree was
  created.
- `main` must not be pushed until the upstream-sync branch has been reviewed
  and tested.

## GitHub Tracking

Created issues in `ranilzinurov/codexUI`:

- #1 Preflight baseline and diff map
- #2 CLI/Docker/dev helper scripts
- #3 Project ZIP export/import/share core
- #4 Project portability metadata, docs, and manual tests
- #5 Startup/performance and workspace-root canonicalization
- #6 Providers/models/auth fixes
- #7 Thread loading/chat loading stability
- #8 Git dropdown, review pane, and commit detail UI
- #9 File-change undo/redo and rollback improvements
- #10 Composer/chat rendering fixes
- #11 Automations panel/editor UI fixes
- #12 Manual test documentation structure
- #13 Docs/wiki updates

## Protected Fork Areas

Do not overwrite these areas wholesale when importing upstream changes:

- Browser annotation extension, assets, routes, contracts, listener panel, and
  transcription flow.
- iOS/Capacitor shell, native audio session plugin, voice mode, dictation, and
  transcription override behavior.
- Web push/task notification support.
- Previous-response recovery, thread auto-title routing, previous-response
  diagnostics, and thread error diagnostics.
- Codex LB proxy, remote backend auth helpers, backend URL/browser
  compatibility helpers, deployment scripts, gitleaks scanning, and workspace
  package metadata.
- Side chat, slash command picker, thread tree indicators/show-more behavior,
  and composer draft storage.
- Root `AGENTS.md`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`,
  and root `tests.md`.

## High Conflict Files

Use manual transplant for these files. Do not replace them with upstream
versions:

- `src/App.vue`
- `src/composables/useDesktopState.ts`
- `src/server/codexAppServerBridge.ts`
- `src/server/accountRoutes.ts`
- `src/api/codexGateway.ts`
- `src/components/content/ThreadConversation.vue`
- `src/components/content/ThreadComposer.vue`
- `src/components/sidebar/SidebarThreadTree.vue`
- `src/style.css`
- `package.json`
- `tests.md`

## Baseline Verification

The isolated worktree passed:

- `pnpm run build`
- `pnpm run test:unit`

Browser runtime profile:

- URL: `http://127.0.0.1:4173/`
- Report:
  `output/playwright/browser-runtime-profile-home-2026-06-14T18-24-50-307Z.json`
- `duplicateCounts`: `threadList=1`, `threadListFirstPage=1`,
  `threadListCursor=0`, `threadResume=0`, `threadRead=0`, `skillsList=0`,
  `rateLimitsRead=1`, `providerModels=0`
- `warnings`: none
- `totalApiKB`: `446.4`
- Slowest API rows: `thread/list` at `12658.6ms`, `plugin/list` at
  `11044.6ms`

These numbers are the baseline for later startup, thread loading, and provider
changes. Later issues should compare their profile output against this report
when they touch startup, routing, API fanout, thread loading, or provider model
loading.

## Integration Rule

For each issue:

1. Import only one feature/theme.
2. Keep OUR implementation on ambiguous conflicts.
3. Add or update focused tests where feasible.
4. Update `tests.md` for user-visible or behavior changes.
5. Run the narrow verification for the touched area plus the relevant build or
   unit command.
6. Commit the issue separately.
