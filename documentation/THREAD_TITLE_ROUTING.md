# Thread Auto-Title Routing

Thread auto-title generation is intentionally configured with `CODEXUI_THREAD_TITLE_*` environment variables.

These variables route the title-generation LLM call through the local Codex load balancer used by CodexUI. They are not intended to point at the official OpenAI API unless the deployment explicitly chooses to replace that local routing.

Use placeholder values in examples and documentation. Do not commit real API keys, bearer tokens, or provider secrets.

Operators should verify:

- `CODEXUI_THREAD_TITLE_BASE_URL` targets the local Codex load balancer endpoint.
- `CODEXUI_THREAD_TITLE_MODEL` names the local title model or load-balancer model alias.
- Any title-specific auth variable uses a non-secret placeholder in committed docs and examples.
