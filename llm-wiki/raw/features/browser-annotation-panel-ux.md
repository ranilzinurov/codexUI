# Browser Annotation Panel UX Source Notes

Date: 2026-06-16

Source files:
- `CONTEXT.md`
- `docs/superpowers/specs/2026-06-16-browser-annotation-panel-ux-design.md`
- `extension/browser-annotation/content/content-script.js`
- `extension/browser-annotation/service-worker/service-worker.js`
- `extension/browser-annotation/sidepanel/sidepanel.html`
- `extension/browser-annotation/sidepanel/sidepanel.js`
- `extension/browser-annotation/shared/annotation-queue.js`
- `tests.md`

Facts:
- The browser annotation extension uses Annotation Panel language instead of generic side-panel or injection language.
- `Pick on Page` is the user-facing action for starting page target selection.
- Selecting a page target creates a local Draft Annotation. The queue item is created only after `Save to Queue`.
- Draft Annotation controls include comment, voice, screenshot toggle, save, and cancel.
- Screenshot capture is tied to `Save to Queue`. Queue items expose screenshot states such as ready, failed, and off.
- Ordinary selected page annotations should not use `No preview` as a neutral state.
- Failed screenshots block sending until the user explicitly retries or chooses to send without screenshot.
- Queue rows are compact summaries; Queue Item Detail is the in-panel review/edit surface.
- Browser Binding, Annotation Destination, and Catalog Freshness are separate concepts in the UI.
- Diagnostics is the user-facing label for optional batch diagnostic capture; protocol/internal names may still use DevTools.
