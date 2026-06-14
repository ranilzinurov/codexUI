# Installed Plugin Skill Tree Source

Date: 2026-06-14

## Scope

This source records the Skills tab change that turns installed plugin skills into a plugin-owned tree in the `Installed skills` section.

## Behavior

- `/codex-api/skills-hub` now builds the installed Skills Hub list from two sources:
  - ordinary installed skills from the app-server `skills/list` and local skills directory,
  - installed plugin skill groups discovered under `.codex/plugins/cache/<marketplace>/<plugin>/<version>/`.
- Plugin groups are discovered from each plugin's `.codex-plugin/plugin.json`.
- Child skills are discovered from the plugin's configured `skills` directory, normally `skills/<skill>/SKILL.md`.
- A plugin root appears as one expandable folder row with the plugin display name, developer/owner, description, and child count.
- The child rows are the individual skills that belong to that plugin.
- Child plugin skills are removed from the installed top level when their paths are already represented under a plugin group, so the list does not duplicate plugin-owned skills as standalone skills.
- Clicking a plugin row toggles its nested list; clicking a child skill row opens that specific skill detail.
- Plugin root browse opens the plugin root folder. Child browse opens the child skill folder.

## Performance Notes

- Plugin child `SKILL.md` descriptions are read concurrently.
- Plugin skill groups are cached for a short TTL to avoid repeated filesystem scans during normal Skills tab navigation.
- The verified profile for `#/skills` showed one `/codex-api/skills-hub` request with no duplicate request warning.

## Verification Notes

- A local `/codex-api/skills-hub` response showed eight plugin groups, including Build Web Apps, Build Web Data Visualization, Codex Security, Creative Production, GitHub, Notion, Product Design, and Superpowers.
- The response had no duplicate child/top-level paths.
- Manual test documentation in `tests.md` covers light and dark theme checks.
