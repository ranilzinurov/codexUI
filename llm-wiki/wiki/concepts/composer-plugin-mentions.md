# Composer Skills And Plugin Mentions

Composer plugin mentions let users select an entire installed plugin from the `$` picker when they know the plugin domain but do not know which specific skill should run. The composer `Skills` dropdown also keeps local recent selection order so users can quickly reselect the skills, plugins, or prompts they used last.

## Behavior

- The `$` picker combines installed skills with installed enabled plugins.
- Skill options are labeled `Skill`; plugin options are labeled `Plugin` and use a distinct plugin color.
- Selected plugins render as plugin chips in the composer and in sent-message history.
- Selected skills keep the existing `type: 'skill'` app-server input format.
- Selected plugins use app-server `type: 'mention'` input items with `plugin://<plugin-name>@<marketplace-name>` paths.
- The combined composer `Skills` dropdown records selected skills/plugins and inserted saved prompts as recent option values in local browser storage.
- Recent dropdown values are capped at eight, deduplicated newest-first, and only affect rows that still exist in the current option list.
- Recent sorting moves matching rows above non-recent rows while preserving the prior relative order for everything else.

## Data Flow

- Plugin rows come from `listDirectoryPlugins()` / RPC `plugin/list`.
- Composer plugin references use `DirectoryPluginSummary.name`, `displayName`, `description`, `installed`, `enabled`, and marketplace fields.
- Drafts and queued messages preserve optional `kind: 'skill' | 'plugin'` on the existing `skills` array so older saved entries remain compatible.
- History normalization treats `mention` as a plugin chip only when its path starts with `plugin://`; unknown mention types stay raw.
- Recent composer option order is stored under `localStorage` key `codex-composer-recent-skill-options`; it does not alter submit payloads, saved prompt files, or app-server lists.
- `composerRecentOptions.ts` owns normalization and sorting so recent ordering can be unit-tested separately from the full chat composer.

## Sources

- [composer-plugin-mentions.md](../../raw/features/composer-plugin-mentions.md)
- [composer-skills-recent-options.md](../../raw/features/composer-skills-recent-options.md)
