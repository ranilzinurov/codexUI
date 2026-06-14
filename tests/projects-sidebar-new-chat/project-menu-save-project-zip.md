# Feature: Project Menu Export Project ZIP

## Prerequisites / Setup

- Start the app from this checkout with `pnpm run dev --host 127.0.0.1 --port 4173`.
- Use a project folder containing a small known file.
- For exclusion checks, the project may also contain generated folders such as `.git`, `node_modules`, `.venv`, `.cache`, `.next`, `.gradle`, `target`, `build`, `dist`, `coverage`, or `__pycache__`.
- For chat import coverage, use an isolated `CODEX_HOME` containing session JSONL files whose `session_meta.payload.cwd` points at the project folder.

## Actions

1. Open the app in light theme.
2. Open the sidebar project action menu.
3. Click `Export Project`.
4. Confirm the export modal shows progress, then shows `Ready` with `Download` and `Share`.
5. Click `Download` and inspect the downloaded ZIP.
6. Open a thread menu for a thread inside the same project and click `Export Project`.
7. Confirm the thread menu exports the same project folder, not only a chat transcript.
8. Go to the new-thread home screen.
9. Click `Import Project` next to `Create Project`.
10. Choose the downloaded ZIP.
11. Confirm the imported folder is selected and appears in the sidebar after refresh.
12. Switch to dark theme and repeat steps 2-4 and 8-11.

## Expected Results

- The project menu contains `Export Project` after `Browse files`.
- The thread menu contains `Export Project` after `Browse files`.
- Export uses `/codex-api/project-zip?cwd=...`.
- Import uses `/codex-api/project-import?parent=...`.
- The ZIP contains project files under relative paths.
- `.codex-project/manifest.json` exists and includes portable project metadata without the source absolute path.
- Matching session JSONL files appear under `.codex-project/chats/sessions/` or `.codex-project/chats/archived_sessions/`.
- Matching thread metadata appears under `.codex-project/chats/thread-titles.json` when titles or update times are available.
- Generated folders, cache folders, dependency folders, build outputs, coverage folders, OS metadata, and Git-ignored files are not included.
- Existing non-chat files under `.codex-project/` round-trip as normal project files.
- Import creates a unique project folder when the original project name already exists.
- Imported chat sessions are written into the destination `CODEX_HOME` under `sessions/imported/`.
- Imported chat session IDs are new, `cwd` points at the imported project path, and imported threads appear in the sidebar.
- Imported provider/model metadata matches the destination app's active free/custom/OpenCode Zen provider mode when that mode is enabled.
- The export modal, progress bar, buttons, and import action are readable in both light and dark themes.

## Rollback / Cleanup

- Delete downloaded ZIP files.
- Delete temporary imported project folders.
- Remove any imported test sessions from the isolated `CODEX_HOME`.
- Stop only the disposable dev server on port `4173`; do not stop any persistent `5173` tmux server.
