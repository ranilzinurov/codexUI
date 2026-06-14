# Manual Test Domain Docs

Supplemental manual test docs live under `tests/<domain>/` while root [tests.md](../../../tests.md) remains the canonical manual-test log required by this fork.

Source:
- [manual-test-domain-folders.md](../../raw/features/manual-test-domain-folders.md)

## Adopted Structure

The upstream source split manual tests into domain folders under `tests/`, with one `index.md` per folder and one focused markdown file per manual test. This fork adopted the useful browsing structure without replacing the root `tests.md` file.

The current supplemental entry point is [tests/index.md](../../../tests/index.md). It links domain indexes for projects, providers, thread loading, Git/rollback, chat rendering, automations, startup profiling, and related imported upstream-sync areas.

## Fork Policy Difference

The upstream source says root `tests.md` becomes only a root index. This fork did not adopt that policy. Repository instructions still require updating root `tests.md` after feature implementation, including setup, steps, expected results, cleanup, and light/dark checks for UI changes.

Therefore, domain docs are supplemental browsing aids. They should not be treated as a reason to stop maintaining root `tests.md`.

## Import Boundary

Only manual docs for behavior already present in this fork should be imported into `tests/<domain>/`. Upstream-only feature docs should be deferred until their behavior is implemented or explicitly marked as a deferred candidate.

## Verification

Issue 12 added link and structure checks for the supplemental docs:
- relative markdown links resolve;
- imported domain docs include prerequisites, steps or actions, expected results, and cleanup;
- docs avoid machine-local paths and stale upstream-only claims.
