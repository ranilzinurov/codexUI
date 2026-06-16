# Codex UI

Codex UI includes browser annotation workflows for collecting page context and sending it to a selected Codex conversation.

## Language

**Annotation Panel**:
The extension surface used to control browser annotation, manage selected context, and send annotations to Codex.
_Avoid_: Extension window, sidepanel UI

**Floating Panel**:
A compact Annotation Panel mode that appears over the current web page without taking over browser side-panel space.
_Avoid_: Pop-over, popup, overlay panel

**Docked Panel**:
A pinned Annotation Panel mode that uses the browser side-panel area for longer queue and destination management.
_Avoid_: Sidebar, site-bar

**Panel Mode**:
The user's chosen Annotation Panel placement: Floating Panel for page-first annotation or Docked Panel for longer queue and destination work.
_Avoid_: Layout, view type

**Pick on Page**:
The user action that starts selecting page elements or areas for annotation.
_Avoid_: Inject Overlay, inject, pick

**Draft Annotation**:
An in-progress page annotation created after picking a page target and before saving it to the Annotation Queue.
_Avoid_: Selected item, unsaved queue item

**Save to Queue**:
The user action that turns a Draft Annotation into a saved annotation in the Annotation Queue.
_Avoid_: Add item, queue automatically

**Screenshot Ready**:
The state of an annotation item whose selected page target has a captured visual screenshot available for review.
_Avoid_: Preview available, image ready

**Screenshot Failed**:
The state of an annotation item whose selected page target was saved, but its screenshot could not be captured or prepared and needs retry or explicit user action.
_Avoid_: No preview, empty preview

**Screenshot Off**:
The state of an annotation item where the user intentionally disabled screenshot capture before saving.
_Avoid_: No preview, missing image

**Screenshot Capture**:
The act of creating a visual screenshot for a Draft Annotation when the user saves it to the Annotation Queue.
_Avoid_: Preview capture, automatic capture on select

**Annotation Destination**:
The Codex project and thread that will receive queued browser annotations.
_Avoid_: Target thread, selected thread, thread target

**Browser Binding**:
The persistent relationship between the browser extension and Codex UI that authorizes browser annotation actions.
_Avoid_: Connection, listen session, pairing session

**Saved Destination**:
The last Annotation Destination chosen by the user, retained across closing and reopening the Annotation Panel.
_Avoid_: Cached thread, remembered thread

**Destination Refresh**:
A background update that refreshes available projects and threads without clearing the Saved Destination or current queue.
_Avoid_: Reload threads, reconnect

**Catalog Freshness**:
The user-visible recency and success state of the available Annotation Destination list.
_Avoid_: Connection status, thread status

**Queue Row**:
A compact representation of one saved annotation in the Annotation Queue.
_Avoid_: Queue card, preview row

**Queue Item Detail**:
The expanded view of one saved annotation, including full comment, screenshot review, target metadata, retry actions, and editable fields.
_Avoid_: Preview modal, item editor

**Screenshot Review**:
The user review of a saved annotation screenshot from Queue Item Detail before sending the queue.
_Avoid_: Image preview, thumbnail click

**Blocked Screenshot**:
An annotation screenshot state that prevents sending until the user retries capture or explicitly sends the annotation without a screenshot.
_Avoid_: Optional failure, missing preview

**Batch Diagnostic Context**:
Optional diagnostic context attached to an annotation batch, such as console and network metadata gathered only after explicit user opt-in.
_Avoid_: DevTools, debug data
