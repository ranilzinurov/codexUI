# Previous Response Recovery

Codex UI can recover from provider-side `previous_response_not_found` failures when the active provider is routed through the local Responses proxy.

## What Fails

The OpenAI Responses API can accept `previous_response_id` so a provider can continue from a previous provider response. Some local or proxied providers may lose that provider-side response state during a long tool-heavy turn. When that happens, the upstream error usually looks like:

```json
{
  "error": {
    "code": "previous_response_not_found",
    "param": "previous_response_id"
  }
}
```

In captured sessions, the missing `resp_*` value usually referred to an earlier provider response inside the same active turn, not to the previous completed Codex UI thread turn.

## Recovery Path

`handleUnifiedResponsesProxyRequest` retries exactly once when all of these are true:

- the upstream status is an error status;
- the upstream body matches `previous_response_not_found`, including nested or stringified error payloads;
- the outgoing raw Responses payload contains `previous_response_id`;
- the outgoing raw Responses payload still has a safe `input` value.

The retry sends the same raw Responses payload after removing only `previous_response_id`.

## UI Auto-Continue Watcher

Some stale previous-response failures can still surface to the browser after the provider turn has already stopped. For those cases, the frontend watches realtime `error` and failed `turn/completed` notifications with a browser-safe classifier in `src/api/previousResponseErrors.ts`.

When the watcher sees `previous_response_not_found`, it schedules one normal user message to the same thread:

```text
У нас была ошибка "<provider error>". Продолжи с того места, где остановился.
```

Safety rules:

- only `previous_response_not_found`-style errors match;
- `thread not found`, rate limits, and generic HTTP failures do not match;
- each `resp_*` signature is sent once per browser session;
- each thread gets at most one auto-continue attempt until a later successful turn clears the attempt guard;
- transient `error` notifications with `willRetry: true` are ignored so the UI does not race an app-server retry.

## Codex LB Routing

The user-level Codex config remains the source of truth:

```toml
model_provider = "codex-lb"

[model_providers.codex-lb]
base_url = "http://127.0.0.1:2455/backend-api/codex"
wire_api = "responses"
env_key = "CODEX_LB_API_KEY"
```

When Codex UI starts the child app-server and free mode is not already routing through a local proxy, it passes a runtime-only override:

```toml
model_providers.codex-lb.base_url = "http://127.0.0.1:<codex-ui-port>/codex-api/codex-lb-proxy/v1"
model_providers.codex-lb.wire_api = "responses"
```

The local route reads the original `codex-lb` upstream from `~/.codex/config.toml`, forwards bearer auth, and reuses the unified proxy retry. Set `CODEXUI_CODEX_LB_PROXY=0` to disable this wrapper for troubleshooting.

## Diagnostics

Retry diagnostics are written to `output/previous-response-errors.jsonl`, or to `CODEXUI_PREVIOUS_RESPONSE_ERROR_LOG` when that environment variable is set. Useful phases:

- `retry-started`: the upstream stale-response error matched and a retry was attempted;
- `retry-finished`: the retry returned from upstream, with `retryStatus`;
- `retry-error`: the retry request failed before an upstream response.

If `forwarded-without-retry` appears, inspect `canRecoverWithoutPreviousResponseId`; it is usually false when the payload lacked `previous_response_id` or a safe `input`.
