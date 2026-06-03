# Composer Plugin Mentions Source Notes

Date: 2026-06-03

## Source Facts

- The composer `$` picker previously used only installed skills from `skills/list`.
- The plugin catalog is available through `listDirectoryPlugins()` in `src/api/codexGateway.ts`, which wraps RPC `plugin/list`.
- `DirectoryPluginSummary` includes plugin `id`, `name`, `displayName`, `description`, `installed`, `enabled`, marketplace metadata, icon metadata, and default prompt metadata.
- The composer now loads installed enabled plugins through `listDirectoryPlugins(cwd ? [cwd] : undefined)`.
- Plugin picker entries are represented as composer references with `kind: 'plugin'` and a `plugin://<plugin-name>@<marketplace-name>` path.
- Selected plugins are sent to app-server as `UserInput` items with `type: 'mention'`; selected skills still use `type: 'skill'`.
- Persisted drafts and queued messages preserve optional `kind: 'skill' | 'plugin'` on the existing `skills` array for backward compatibility.
- History normalization renders `mention` items as plugin chips only when the path starts with `plugin://`.

## Verification Notes

- Focused regression test: `pnpm exec vitest run src/api/normalizers/v2.test.ts`
- Type check: `pnpm exec vue-tsc --noEmit`
- Manual verification steps are documented in `tests.md` under "Composer Plugin Mentions".
