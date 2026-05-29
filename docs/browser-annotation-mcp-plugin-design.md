# Browser Annotation MCP/Plugin Design Decision

## Decision

Do not create a separate `browser-annotation` MCP server or plugin for the current MVP.

The current implementation remains extension-driven:

- The Chrome extension collects element selection, DOM context, screenshots, optional DevTools console/network rows, and voice notes after explicit user action.
- The extension sends the bounded batch to Codex UI through `/codex-api/extension/*`.
- Codex UI turns the batch into one queued user message for the selected thread.

This keeps Chrome permissions, tab access, debugger attachment, screenshot capture, audio capture, and pairing tokens inside the already-consented browser extension flow.

## Future MCP Shape

If browser inspection becomes agent-driven later, add a browser annotation MCP server or plugin with tools such as:

- `snapshot_dom`: return bounded DOM context for the active/selected page.
- `screenshot`: capture a viewport or element screenshot with explicit user approval.
- `inspect_console`: return bounded console rows with redaction.
- `inspect_network`: return bounded request metadata and opt-in body previews.
- `select_element`: request or replay an explicit element selection.

That future path should integrate with Codex MCP/tool policy rather than replacing the extension permission model. The extension can remain the broker for privileged Chrome APIs, while MCP tools provide an agent-facing contract.

## Boundaries

- Keep MVP annotations user-triggered, not agent-triggered.
- Keep raw screenshots, audio, DevTools bodies, and tokens out of MCP/tool logs unless an explicit future privacy review approves them.
- Do not duplicate the existing `/codex-api/extension/*` routes in an MCP server until there is a concrete agent-driven workflow.
- Treat Chrome debugger access as extension-owned because Chrome surfaces debugger warnings and permission prompts to the user.

## Risks Of Building MCP Now

- It would duplicate the extension ingress before there is an agent-driven use case.
- Browser permissions would become harder to explain and audit.
- Agent-driven page inspection can conflict with the current user gesture and active-tab model.
- DevTools and screenshot data would need another security review for cross-origin access, redaction, retention, and session binding.

## Acceptance Checklist

- The MVP continues to work through the Chrome extension and Codex UI HTTP extension routes.
- The future tool names and boundaries are documented.
- No runtime MCP/plugin code is added for this stage.
- Security review for any future MCP implementation is explicitly deferred to a later design and implementation phase.
