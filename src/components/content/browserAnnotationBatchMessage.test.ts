import { describe, expect, it } from 'vitest'
import { isBrowserAnnotationBatchText, parseBrowserAnnotationBatchMessage } from './browserAnnotationBatchMessage'

const samplePrompt = `# Browser annotation batch

Batch ID: batch-1
Queued at: 2026-05-28T12:00:00.000Z
Created at: 2026-05-28T11:59:00.000Z
Source: chrome-extension 0.1.0 on Chrome
Primary page: Dashboard (https://app.example.test/dashboard?token=%5BREDACTED%5D)
Annotations: 2
Uploaded images attached: 1

## Request for Codex
Use the annotated browser context below.

## Annotation notes

### 1. mixed annotation (annotation-1)
Created: 2026-05-28T11:59:01.000Z
Page: Dashboard (https://app.example.test/dashboard)
Note: Save button is disabled.
Selected text: Save
Target element:
- Tag: button
- Selector: button[data-testid="save"]
- Text snippet: Save
Voice transcript: Please inspect the failed save request.
DevTools context: 1 request(s), 1 console entr(y/ies) from 2026-05-28T11:58:30.000Z to 2026-05-28T11:59:03.000Z

### 2. voice annotation (annotation-2)
Created: 2026-05-28T11:59:02.000Z
Page: Dashboard (https://app.example.test/dashboard)
Voice error: Speech was not recognized.

## DevTools summary
Captured: 2026-05-28T11:58:30.000Z to 2026-05-28T11:59:03.000Z`

describe('browser annotation batch message parsing', () => {
  it('detects browser annotation batch prompts', () => {
    expect(isBrowserAnnotationBatchText(samplePrompt)).toBe(true)
    expect(isBrowserAnnotationBatchText('hello')).toBe(false)
    expect(isBrowserAnnotationBatchText('# Browser annotation batch notes')).toBe(false)
  })

  it('extracts compact summary fields and annotation previews', () => {
    const summary = parseBrowserAnnotationBatchMessage(samplePrompt)

    expect(summary).toMatchObject({
      batchId: 'batch-1',
      primaryPage: 'Dashboard (https://app.example.test/dashboard?token=%5BREDACTED%5D)',
      annotationCount: 2,
      imageCount: 1,
      hasDevTools: true,
    })
    expect(summary?.annotations).toHaveLength(2)
    expect(summary?.annotations[0]).toMatchObject({
      kind: 'mixed',
      id: 'annotation-1',
      note: 'Save button is disabled.',
      selectedText: 'Save',
      selector: 'button[data-testid="save"]',
      voiceTranscript: 'Please inspect the failed save request.',
      devToolsContext: '1 request(s), 1 console entr(y/ies) from 2026-05-28T11:58:30.000Z to 2026-05-28T11:59:03.000Z',
    })
    expect(summary?.annotations[1]).toMatchObject({
      kind: 'voice',
      id: 'annotation-2',
      voiceError: 'Speech was not recognized.',
    })
  })
})
