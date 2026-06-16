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
