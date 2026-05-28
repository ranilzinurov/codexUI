export type BrowserAnnotationBatchAnnotationSummary = {
  title: string
  kind: string
  id: string
  note: string
  selectedText: string
  selector: string
  voiceTranscript: string
  voiceError: string
  devToolsContext: string
}

export type BrowserAnnotationBatchMessageSummary = {
  batchId: string
  primaryPage: string
  annotationCount: number | null
  imageCount: number | null
  hasDevTools: boolean
  annotations: BrowserAnnotationBatchAnnotationSummary[]
}

const BROWSER_ANNOTATION_HEADING = '# Browser annotation batch'

export function isBrowserAnnotationBatchText(text: string): boolean {
  const firstLine = text.trimStart().split(/\r?\n/u, 1)[0]?.trimEnd() ?? ''
  return firstLine === BROWSER_ANNOTATION_HEADING
}

export function parseBrowserAnnotationBatchMessage(text: string): BrowserAnnotationBatchMessageSummary | null {
  if (!isBrowserAnnotationBatchText(text)) return null
  const lines = text.split(/\r?\n/u)
  const summary: BrowserAnnotationBatchMessageSummary = {
    batchId: readLineValue(lines, 'Batch ID'),
    primaryPage: readLineValue(lines, 'Primary page'),
    annotationCount: readNullableInteger(readLineValue(lines, 'Annotations')),
    imageCount: readNullableInteger(readLineValue(lines, 'Uploaded images attached')),
    hasDevTools: lines.some((line) => line.trim() === '## DevTools summary'),
    annotations: [],
  }

  let current: BrowserAnnotationBatchAnnotationSummary | null = null
  for (const rawLine of lines) {
    const line = rawLine.trim()
    const heading = /^###\s+\d+\.\s+(.+?)\s+annotation\s+\((.+)\)$/u.exec(line)
    if (heading) {
      current = {
        title: line.replace(/^###\s+/u, ''),
        kind: heading[1]?.trim() ?? '',
        id: heading[2]?.trim() ?? '',
        note: '',
        selectedText: '',
        selector: '',
        voiceTranscript: '',
        voiceError: '',
        devToolsContext: '',
      }
      summary.annotations.push(current)
      continue
    }
    if (!current) continue
    assignAnnotationValue(current, line, 'Note', 'note')
    assignAnnotationValue(current, line, 'Selected text', 'selectedText')
    assignAnnotationValue(current, line, '- Selector', 'selector')
    assignAnnotationValue(current, line, 'Voice transcript', 'voiceTranscript')
    assignAnnotationValue(current, line, 'Voice error', 'voiceError')
    assignAnnotationValue(current, line, 'DevTools context', 'devToolsContext')
  }

  return summary
}

function assignAnnotationValue(
  annotation: BrowserAnnotationBatchAnnotationSummary,
  line: string,
  label: string,
  key: keyof BrowserAnnotationBatchAnnotationSummary,
): void {
  if (annotation[key]) return
  const prefix = `${label}:`
  if (!line.startsWith(prefix)) return
  annotation[key] = line.slice(prefix.length).trim()
}

function readLineValue(lines: string[], label: string): string {
  const prefix = `${label}:`
  const line = lines.find((candidate) => candidate.trimStart().startsWith(prefix))
  return line ? line.trim().slice(prefix.length).trim() : ''
}

function readNullableInteger(value: string): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}
