import { safeLocalStorageGetItem, safeLocalStorageRemoveItem, safeLocalStorageSetItem } from '../browserCompat'

const DRAFT_STORAGE_PREFIX = 'codex-web-local.thread-draft.v1.'

export type ComposerDraftPayload = {
  text: string
  imageUrls: string[]
  fileAttachments: Array<{ label: string; path: string; fsPath: string }>
  skills: Array<{ name: string; path: string }>
}

export function createEmptyComposerDraftPayload(): ComposerDraftPayload {
  return {
    text: '',
    imageUrls: [],
    fileAttachments: [],
    skills: [],
  }
}

function getDraftStorageKey(threadId: string): string {
  return `${DRAFT_STORAGE_PREFIX}${threadId}`
}

export function loadPersistedDraftForThread(threadId: string): ComposerDraftPayload | null {
  if (typeof window === 'undefined') return null
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return null
  try {
    const raw = safeLocalStorageGetItem(getDraftStorageKey(normalizedThreadId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ComposerDraftPayload> | string
    if (typeof parsed === 'string') {
      return {
        text: parsed,
        imageUrls: [],
        fileAttachments: [],
        skills: [],
      }
    }
    return {
      text: typeof parsed.text === 'string' ? parsed.text : '',
      imageUrls: Array.isArray(parsed.imageUrls)
        ? parsed.imageUrls.filter((url): url is string => typeof url === 'string')
        : [],
      fileAttachments: Array.isArray(parsed.fileAttachments)
        ? parsed.fileAttachments.filter((attachment): attachment is ComposerDraftPayload['fileAttachments'][number] => (
          Boolean(attachment)
          && typeof attachment.label === 'string'
          && typeof attachment.path === 'string'
          && typeof attachment.fsPath === 'string'
        ))
        : [],
      skills: Array.isArray(parsed.skills)
        ? parsed.skills.filter((skill): skill is { name: string; path: string } => (
          Boolean(skill)
          && typeof skill.name === 'string'
          && typeof skill.path === 'string'
        ))
        : [],
    }
  } catch {
    return null
  }
}

export function persistDraftForThread(threadId: string, payload: ComposerDraftPayload): void {
  if (typeof window === 'undefined') return
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) return
  try {
    const hasContent = payload.text.trim().length > 0
      || payload.imageUrls.length > 0
      || payload.fileAttachments.length > 0
      || payload.skills.length > 0
    if (hasContent) {
      safeLocalStorageSetItem(getDraftStorageKey(normalizedThreadId), JSON.stringify(payload))
      return
    }
    safeLocalStorageRemoveItem(getDraftStorageKey(normalizedThreadId))
  } catch {
    // Ignore localStorage failures (quota/private mode).
  }
}

export function clearPersistedDraftForThread(threadId: string): void {
  persistDraftForThread(threadId, createEmptyComposerDraftPayload())
}

export function appendTextToPersistedDraftForThread(threadId: string, text: string): void {
  const normalizedText = text.trim()
  if (!normalizedText) return

  const existing = loadPersistedDraftForThread(threadId) ?? createEmptyComposerDraftPayload()
  persistDraftForThread(threadId, {
    ...existing,
    text: existing.text.trim().length > 0
      ? `${existing.text.trimEnd()}\n${normalizedText}`
      : normalizedText,
  })
}
