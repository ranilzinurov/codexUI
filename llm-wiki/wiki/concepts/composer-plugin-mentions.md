# Composer Plugin Mentions

Composer plugin mentions let users select an entire installed plugin from the `$` picker when they know the plugin domain but do not know which specific skill should run.

## Behavior

- The `$` picker combines installed skills with installed enabled plugins.
- Skill options are labeled `Skill`; plugin options are labeled `Plugin` and use a distinct plugin color.
- Selected plugins render as plugin chips in the composer and in sent-message history.
- Selected skills keep the existing `type: 'skill'` app-server input format.
- Selected plugins use app-server `type: 'mention'` input items with `plugin://<plugin-name>@<marketplace-name>` paths.

## Data Flow

- Plugin rows come from `listDirectoryPlugins()` / RPC `plugin/list`.
- Composer plugin references use `DirectoryPluginSummary.name`, `displayName`, `description`, `installed`, `enabled`, and marketplace fields.
- Drafts and queued messages preserve optional `kind: 'skill' | 'plugin'` on the existing `skills` array so older saved entries remain compatible.
- History normalization treats `mention` as a plugin chip only when its path starts with `plugin://`; unknown mention types stay raw.

## Sources

- [composer-plugin-mentions.md](../../raw/features/composer-plugin-mentions.md)
