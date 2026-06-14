# Source: manual test domain folders

Date: 2026-05-19
Source type: local repository documentation update
Path: upstream local worktree path omitted

## Upstream Facts
- `tests.md` is now the root manual test index, not the append-only body for all manual regression steps.
- Detailed manual regression and feature verification steps live under domain folders in `tests/`.
- Each domain folder has an `index.md` that lists the individual test-section files for that domain.
- Each manual test section is stored as its own markdown file under the narrowest matching domain folder.
- New feature implementations should update the closest matching `tests/<domain>/...` file.
- `tests.md` should be updated only when the domain folder index itself changes, such as adding, renaming, or removing a domain.

## Fork Import Note

This source describes the upstream documentation convention. This fork adopted supplemental domain folders but did not adopt the upstream rule that root `tests.md` is only an index. Root `tests.md` remains canonical in this fork; see `llm-wiki/wiki/concepts/manual-test-domain-docs.md`.
