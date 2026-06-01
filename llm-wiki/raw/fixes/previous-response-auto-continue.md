# Previous Response Auto-Continue Watcher

Date: 2026-06-01

## Problem

Provider-side `previous_response_not_found` failures can still surface in the chat UI even after server-side retry work. The visible failure shows a raw JSON error while the composer remains usable. Manually sending a message such as "continue from where you stopped" usually lets Codex resume from the local transcript.

## Fix

Add a frontend watcher for realtime `error` and failed `turn/completed` notifications:

- classify only `previous_response_not_found`-style errors;
- ignore `thread not found`, rate limits, generic 400s, and transient app-server errors with `willRetry: true`;
- schedule a normal user message to the same thread:
  `У нас была ошибка "<provider error>". Продолжи с того места, где остановился.`;
- dedupe by extracted `resp_*` response id when available;
- allow at most one auto-continue attempt per thread until a later successful turn clears the guard.

The browser-safe classifier lives in `src/api/previousResponseErrors.ts`; the watcher lives in `src/composables/useDesktopState.ts`.

## Verification

Focused tests:

```bash
pnpm exec vitest run src/api/previousResponseErrors.test.ts src/api/codexErrors.test.ts src/composables/useDesktopState.test.ts --reporter=verbose
```

The tests cover nested/stringified provider errors, stable no-id signatures, dedupe for repeated `resp_*` failures, and non-matches for `thread not found` and unrelated errors.
