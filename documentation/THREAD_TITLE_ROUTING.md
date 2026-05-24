# Thread Auto-Title Routing

Thread auto-title generation is intentionally configured with `CODEXUI_THREAD_TITLE_*` environment variables.

These variables route the title-generation LLM call through the local Codex load balancer used by CodexUI. They are not intended to point at the official OpenAI API unless the deployment explicitly chooses to replace that local routing.

The current temporary production routing is:

```bash
CODEXUI_THREAD_TITLE_LLM=on
CODEXUI_THREAD_TITLE_BASE_URL=http://127.0.0.1:2455/v1
CODEXUI_THREAD_TITLE_MODEL=gpt-5.4-mini
CODEXUI_THREAD_TITLE_REASONING_EFFORT=low
CODEXUI_THREAD_TITLE_API_KEY=<codex-lb-api-key>
```

`threadAutoTitle` appends `/responses`, so the full local Responses API URL is `http://127.0.0.1:2455/v1/responses`.

The request flow is captured in [thread-title-routing.mmd](thread-title-routing.mmd) and rendered as [thread-title-routing.svg](thread-title-routing.svg) plus [thread-title-routing.png](thread-title-routing.png).

Use placeholder values in examples and documentation. Do not commit real API keys, bearer tokens, or provider secrets.

Operators should verify:

- `CODEXUI_THREAD_TITLE_BASE_URL` targets the local Codex load balancer endpoint.
- `CODEXUI_THREAD_TITLE_MODEL` names the local title model or load-balancer model alias.
- Any title-specific auth variable uses a non-secret placeholder in committed docs and examples.
