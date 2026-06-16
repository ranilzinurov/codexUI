# Browser Annotation Panel

Browser Annotation Panel is the extension workflow for collecting page context and sending it to Codex. Source: [browser-annotation-panel-ux.md](../../raw/features/browser-annotation-panel-ux.md).

The canonical user action is `Pick on Page`, not injection terminology. A page target selection creates a Draft Annotation beside the selected element or area. The Draft Annotation becomes a saved queue item only after `Save to Queue`, which keeps accidental selections and cancelled drafts out of the Annotation Queue.

Screenshot handling is explicit. Screenshot capture happens during `Save to Queue`; saved annotations expose screenshot states such as ready, failed, and off. A failed screenshot is not a neutral missing preview: it blocks sending until the user retries or explicitly sends without a screenshot.

The queue uses two surfaces. Queue Row is the compact scanning surface with comment preview, screenshot state, thumbnail/detail affordance, and small actions. Queue Item Detail is the in-panel review/edit surface for full comment, screenshot review, metadata, and recovery actions.

Browser Binding, Annotation Destination, and Catalog Freshness are separate user concepts. Closing and reopening the Annotation Panel should preserve local queue and destination state while destination catalog refresh happens separately.

Diagnostics is the user-facing term for optional batch diagnostic capture. Some protocol and internal helper names still use DevTools because they map to Chrome debugger and batch payload contracts.
