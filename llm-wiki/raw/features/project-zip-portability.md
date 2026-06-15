# Project ZIP portability source

Date: 2026-06-14

Project portability adds local project export/import flows to Codex UI.

Implementation facts:
- Project and thread context menus expose `Export Project`, opening an export modal that prepares the selected project folder as a ZIP file and then offers explicit `Download` and `Share` actions.
- The new-thread home actions expose `Import Project` next to `Create Project`.
- Export uses `GET /codex-api/project-zip?cwd=...`; import uses `POST /codex-api/project-import?parent=...`.
- Exported archives include project files plus matching Codex chat JSONL history under `.codex-project/chats/`.
- Exported session files are split by source home folder under `.codex-project/chats/sessions/` and `.codex-project/chats/archived_sessions/`.
- The export manifest is `.codex-project/manifest.json`; it records `version`, `exportedAt`, and `projectName`.
- The manifest does not include the source machine's absolute project path.
- Exported archives include matching thread title and update-time metadata under `.codex-project/chats/thread-titles.json`.
- Project ZIP export skips `.codex-project/manifest.json` from project files so the generated portable manifest wins.
- Project ZIP export skips generated dependency/cache/build folders such as `.git`, `node_modules`, common Python virtualenv/cache folders, JS framework caches, Gradle/Rust/.NET outputs, coverage folders, `build`, `dist`, and `target`.
- Project ZIP export also skips Git-ignored files when the source folder is inside a Git repository.
- Project ZIP writing streams stored ZIP entries to the response and handles response backpressure and client disconnects.
- Project ZIP import currently supports stored ZIP entries created by the app exporter.
- Imported paths are normalized and rejected when they contain unsafe empty, `.`, or `..` path segments.
- Imported project folders use the manifest `projectName`; if the target exists, import creates a unique `name-2`, `name-3`, and so on.
- Imported chat JSONL files are rewritten into the active `CODEX_HOME` under `sessions/imported/`.
- Imported chat session IDs are replaced with new UUIDs and `cwd` is rewritten to the imported project path.
- Imported chat `session_meta` is marked with `source: "cli"` and `imported: true`.
- When free/custom/OpenCode Zen provider mode is active, imported session provider/model metadata is rewritten to the current local provider/model defaults.
- Imported chat titles are restored from `.codex-project/chats/thread-titles.json` when available; otherwise title fallback uses first user message metadata.
- Imported sessions are registered in `state_5.sqlite` in one transaction and are merged into `thread/list` results so they appear in the sidebar.
- Existing non-chat files under `.codex-project/` round-trip as normal project files; `.codex-project/chats/` remains the reserved chat-import namespace.
- The browser client invalidates workspace-root cache after import, selects the imported folder, refreshes workspace roots, and reloads the thread list.

Local-only security posture:
- The app server is local-user facing and is not designed as a public internet service.
- Local project import/export intentionally trusts user-selected local paths.
- Any hardening suggestion that assumes a hostile remote caller needs a concrete remote-reachability or authentication-bypass path before it should change this feature.

Verification facts for the upstream-sync branch:
- `pnpm run test:unit -- src/api/codexGateway.test.ts src/server/codexAppServerBridge.archive.test.ts` passed.
- `pnpm run build` passed.
- `pnpm run test:unit` passed.
- Browser startup profiling against `http://127.0.0.1:4173/` completed with no warnings.
- Manual coverage is documented in root `tests.md` and the supplemental `tests/projects-sidebar-new-chat/project-menu-save-project-zip.md`.
