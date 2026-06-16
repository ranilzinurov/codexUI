# Skills Hub inline switches

Date: 2026-06-16

Source: implementation update in `src/components/content/SkillsHub.vue`, `src/components/content/skillsHubUtils.ts`, and `src/style.css`.

Facts:

- The installed Skills Hub list now exposes inline on/off switches on the right side of rows that have a local `path`.
- Top-level installed skill/plugin-folder rows send `skills/config/write` for the top-level row path.
- Child skill rows send `skills/config/write` for the child `SKILL.md` path, so individual skills can be disabled without disabling the full folder.
- The inline switches reuse the same RPC method as the existing Skill Detail modal enable/disable action.
- Switch clicks stop event propagation so they do not open the detail modal or expand/collapse a folder row.
- The switch is disabled while its own path is being updated.
- Dark-theme switch colors are defined in the global stylesheet alongside other Skills route dark overrides.
