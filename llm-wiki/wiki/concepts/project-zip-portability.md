# Project ZIP Portability

Project ZIP portability lets a user move a local project and its matching Codex chat history between Codex homes.

Source: [project-zip-portability.md](../../raw/features/project-zip-portability.md)

## Export

Project and thread menus expose `Export Project`. The export modal prepares a ZIP for the selected project folder and then offers explicit `Download` and `Share` actions.

The archive contains regular project files plus generated portability metadata:

- `.codex-project/manifest.json` records `version`, `exportedAt`, and `projectName`.
- `.codex-project/chats/sessions/` contains matching active session JSONL files.
- `.codex-project/chats/archived_sessions/` contains matching archived session JSONL files.
- `.codex-project/chats/thread-titles.json` stores exported title and update-time metadata when available.

The manifest is portable: it does not store the source machine's absolute project path. The exporter also skips generated or heavyweight directories such as `.git`, `node_modules`, virtualenv/cache folders, framework caches, build outputs, coverage folders, `dist`, `build`, and `target`. When Git is available for the source folder, Git-ignored files are skipped too.

Source: [project-zip-portability.md](../../raw/features/project-zip-portability.md)

## Import

The new-thread home screen exposes `Import Project` next to `Create Project`. The selected ZIP is posted to `/codex-api/project-import?parent=...`.

Import creates a new project folder under the selected parent directory. The folder name comes from `.codex-project/manifest.json`; if that name already exists, the importer creates a unique suffix such as `name-2`.

Chat JSONL files under `.codex-project/chats/` are not restored as project files. They are rewritten into the active `CODEX_HOME` under `sessions/imported/` with new thread IDs and the imported project path as `cwd`. Imported `session_meta` entries are marked as `source: "cli"` and `imported: true`.

When a free/custom/OpenCode Zen provider mode is active, imported session provider/model metadata is rewritten to the destination app's current provider/model defaults. This keeps resumed imported threads aligned with the destination configuration.

Imported titles and update times are restored from `.codex-project/chats/thread-titles.json` when present. Imported sessions are registered in `state_5.sqlite`, then merged into `thread/list` results so the sidebar can show imported chats immediately after refresh.

Source: [project-zip-portability.md](../../raw/features/project-zip-portability.md)

## Boundaries

`.codex-project/chats/` is the reserved namespace for Codex session import. Other non-chat files under `.codex-project/` round-trip as regular project files.

The local app server is not designed as a public internet service. The project ZIP feature trusts local user-selected paths and ZIPs. Hardening changes that assume hostile remote callers should be accepted only when they identify a concrete remote-reachability or authentication-bypass path.

Source: [project-zip-portability.md](../../raw/features/project-zip-portability.md)

## Verification

The upstream-sync branch added automated coverage for unsafe ZIP paths, unique import folder creation, session metadata rewriting, gateway download progress, import POST shape, and workspace-root cache invalidation. Root `tests.md` remains the authoritative manual test checklist; the supplemental domain test lives at [tests/projects-sidebar-new-chat/project-menu-save-project-zip.md](../../../tests/projects-sidebar-new-chat/project-menu-save-project-zip.md).

Source: [project-zip-portability.md](../../raw/features/project-zip-portability.md)
