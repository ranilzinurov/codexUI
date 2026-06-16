# Browser Annotation Panel UX Design

## Scope

Implement the agreed browser annotation UX language and the first complete behavior slice for the extension:
Pick on Page, Draft Annotation, explicit screenshot state, richer queue rows/detail, persistent destination refresh language, and Diagnostics naming. Floating/Docked panel mode is included as a visible preference and UI state foundation; a true in-page Floating Panel can be delivered in a follow-up implementation slice if Chrome side-panel constraints require it.

## User Model

The extension is controlled through the Annotation Panel. Users start target selection with Pick on Page, edit a Draft Annotation beside the selected target, and only create a saved queue item with Save to Queue. Screenshots are on by default and captured when saving. Queue rows are compact summaries; Queue Item Detail is the review/edit surface.

Browser Binding, Annotation Destination, and Catalog Freshness are separate UI concepts. Closing and reopening the panel must not erase the saved destination or queue. Destination Refresh can update the catalog in the background, but transient failure must not clear local state.

## Components

- `content/content-script.js`: replace immediate queue creation with Draft Annotation controls and Save to Queue/Cancel behavior.
- `service-worker/service-worker.js`: accept saved draft requests, capture screenshots during save, normalize screenshot states, keep destination catalog cache/freshness, and preserve selected destination.
- `shared/annotation-queue.js`: normalize queue item screenshot state and block sending when screenshots require user action.
- `sidepanel/sidepanel.html/js/css`: rename Inject Overlay to Pick on Page, add Panel Mode control, split Binding/Destination/Freshness status, rename DevTools UI to Diagnostics, render compact Queue Rows and Queue Item Detail.
- `tests.md`: add manual light/dark verification steps for the new flow.

## Data Flow

1. User clicks Pick on Page.
2. Content script lets the user choose an element or area and creates a Draft Annotation locally in the page overlay.
3. User edits comment/voice/screenshot toggle.
4. Save to Queue sends the draft context to the service worker.
5. Service worker captures/crops/uploads or records Screenshot Failed/Off state, then writes the queue item.
6. Side panel renders the row and lets the user open Queue Item Detail.
7. Send Queue is blocked by any Blocked Screenshot until retry or explicit send-without-screenshot.

## Error Handling

Screenshot capture failures must keep the annotation editable and visible. The UI must show Screenshot Failed with retry/send-without-screenshot actions instead of No preview. Destination refresh failures must leave the Saved Destination visible and mark catalog freshness as failed/stale.

## Testing

Use TDD for each behavior slice. Focused gates are extension static checks, existing smoke scripts, Vitest static sidepanel assertions, and browser-extension smokes. Since Codex.app is unavailable in this Linux environment and the extension has no direct desktop-app equivalent, parity verification uses the documented fallback and local UI screenshots/smokes.
