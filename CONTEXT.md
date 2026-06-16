# Codex UI

Codex UI is a local and remote workspace interface for running Codex conversations against project folders and sending contextual input into those conversations.

## Language

**Browser Annotation**:
A user-captured note about a browser page, including the selected page target, a visual crop by default, and optional diagnostic context, intended to be sent into a Codex thread.
_Avoid_: Browser control, remote browser control

**Screenshot Asset**:
The uploaded visual crop attached to a saved browser annotation so Codex can inspect the selected page target. It is distinct from local thumbnail previews used only by the extension UI.
_Avoid_: Preview, thumbnail

**Browser Binding**:
A persistent authorization relationship between a user's browser extension and the Codex UI backend. It is created through extension-level pairing, allows destination metadata lookup and annotation sending, and replaces thread-level listen sessions for browser annotations.
_Avoid_: Listen token, thread token, listener session

**Reconnect**:
The user action of replacing an obsolete or invalid browser binding with a new extension-level browser binding. Old thread-level listen tokens are not treated as browser bindings.
_Avoid_: Token migration

**Annotation Destination**:
The selected project and thread that will receive a batch of browser annotations from the extension.
_Avoid_: Listener, pairing session

**Annotation Thread**:
A Codex thread selected or created by the extension for receiving browser annotation batches. Creating one from the extension is part of choosing an annotation destination, not general-purpose Codex control.
_Avoid_: Generic new chat, listener thread

**Destination Catalog**:
The limited project and thread metadata exposed to a browser binding so the extension can choose an annotation destination. It does not include full transcripts, project files, or Codex action access.
_Avoid_: App state, sidebar state

**Draft Annotation**:
An in-progress browser annotation for a selected page target that has not yet been saved to the annotation queue. It is edited inline beside the selected page target; cancelling a draft should discard it without changing queued annotations.
_Avoid_: Pending queue item, auto-saved annotation

**Stop Overlay**:
The command that turns off page annotation mode and hides annotation UI on the page without deleting saved annotation queue items.
_Avoid_: Cancel annotation

**Annotation Queue Item**:
A saved browser annotation waiting to be sent as part of an annotation batch. Selecting it in the extension should reveal its details and identify the corresponding page target when the target is available.
_Avoid_: Draft, comment

**Annotation Batch**:
A group of saved annotation queue items sent together to an annotation destination. After a successful send, the sent items leave the active queue and their page badges are removed.
_Avoid_: Queue, draft group

**Batch Diagnostic Context**:
Optional browser diagnostic evidence, such as DevTools console and network capture, attached to an annotation batch rather than to a single annotation.
_Avoid_: Per-annotation DevTools

**Annotation Badge**:
A small numbered marker shown on the page for a saved annotation queue item. It links the page target to the matching queue item without drawing full outlines around every saved annotation.
_Avoid_: Permanent selection box, comment marker

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
