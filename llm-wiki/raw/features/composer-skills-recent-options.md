# Composer Skills Recent Options Source Notes

Date: 2026-06-16

## Source Facts

- The composer control row uses `ComposerSearchDropdown` for a combined `Skills` menu that contains installed skills, installed enabled plugin references, and saved prompts.
- `ThreadComposer.vue` now stores recently selected dropdown option values in browser `localStorage` under `codex-composer-recent-skill-options`.
- Recent option storage is local browser state only; it does not change the app-server skill list, plugin list, saved prompt files, draft payload shape, or submit payload shape.
- Recent values are normalized by trimming strings, removing duplicates, and keeping only the latest eight values.
- `orderComposerOptionsByRecent()` moves matching recent options above non-recent options while preserving the existing relative order for all other rows.
- Selecting through the combined `Skills` dropdown records skills/plugins when they are selected and records saved prompts when their content is inserted.
- Selecting through the older `$` skill picker also records the selected skill path so both selection paths share the same recent ordering behavior.
- Stale recent values are harmless because the sort only affects option values that still exist in the current option list.

## Verification Notes

- Focused regression test: `pnpm exec vitest run src/components/content/composerRecentOptions.test.ts`
- Manual verification steps are documented in `tests.md` under "Composer Skills Dropdown Recent Selections".
