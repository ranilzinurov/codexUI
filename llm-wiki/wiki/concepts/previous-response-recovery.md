# Previous Response Recovery

Codex Web Local handles provider-side `previous_response_not_found` failures in two layers.

## Server Proxy Retry

The local Responses proxy can retry raw Responses requests once without `previous_response_id` when the payload still contains safe `input`. This is useful when Codex UI controls the provider route and can intercept the upstream HTTP response.

## UI Auto-Continue

Some failures still reach the browser after the provider turn stops. The UI watcher in `useDesktopState` catches realtime `error` and failed `turn/completed` notifications that classify as `previous_response_not_found`.

When matched, it sends one ordinary user message to the same thread:

```text
У нас была ошибка "<provider error>". Продолжи с того места, где остановился.
```

Safety behavior:

- browser-safe classifier: `src/api/previousResponseErrors.ts`;
- no match for `thread not found`, rate limits, or generic HTTP failures;
- no race with app-server retries when `willRetry: true`;
- dedupe by `resp_*` when available;
- one attempt per thread until a successful later turn clears the guard.

## Source

- [previous-response-auto-continue.md](../../raw/fixes/previous-response-auto-continue.md)
