# Provider Auth And Model Recovery

Provider/auth recovery keeps no-auth fallback providers, copied Codex auth, provider model discovery, and per-thread provider state from drifting apart.

Sources:
- [copied-auth-provider-promotion.md](../../raw/fixes/copied-auth-provider-promotion.md)
- [opencode-zen-docker-auth-provider-models.md](../../raw/fixes/opencode-zen-docker-auth-provider-models.md)
- [provider-config-restart-and-review-followups.md](../../raw/fixes/provider-config-restart-and-review-followups.md)
- [thread-locked-provider-models.md](../../raw/fixes/thread-locked-provider-models.md)

## Copied Auth Promotion

When a valid Codex `auth.json` appears after the app started in no-auth community fallback mode, Codex auth should suppress fallback provider state unless the user explicitly configured a custom provider key or endpoint. This prevents stale OpenRouter or OpenCode Zen fallback settings from keeping the UI on a community provider after Codex auth becomes usable.

The recovery path also imports the active auth file into Accounts, refreshes model metadata, avoids stale generic `Model` labels, and hides feedback rows when there is no current visible error.

## Provider Model Loading

Provider-backed model discovery should not depend on Codex `model/list`. In OpenCode Zen fallback or custom provider modes, `/codex-api/provider-models` is the authoritative model source and should be queried before falling back to Codex catalog data.

This avoids empty or stale model menus in no-auth Zen startup, and it keeps provider-specific menus populated even when Codex model-list reads are slow or unavailable.

## App-Server Config Restarts

The bridge tracks the app-server startup config signature. Before RPCs, it can compare the desired provider/auth config with the running app-server process and restart the child process when stale no-auth or provider flags no longer match current state.

This matters when auth files or provider settings change while Vite remains running. The UI provider label, composer model, and backend `config/read` response should converge without requiring a full server restart.

## Thread-Locked Providers

Threads capture their provider at creation time. Existing Zen, Codex, and OpenRouter threads should keep provider-scoped model menus and sends even after the global provider changes. New chats use the current global provider at creation time.

This allows one project to contain old Zen fallback threads, newer Codex-auth threads, and OpenRouter threads without leaking stale models or send routes across thread contexts.

## Verification

Relevant supplemental manual checks live under:
- [Auth and Docker Runtime tests](../../../tests/auth-docker-runtime/index.md)
- [Providers and Models tests](../../../tests/providers-models/index.md)
- [Thread Loading and State tests](../../../tests/thread-loading-state/index.md)

Root [tests.md](../../../tests.md) remains the canonical manual-test log for this fork.
