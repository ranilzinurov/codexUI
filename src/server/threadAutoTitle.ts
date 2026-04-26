type AppServerRpc = {
  rpc: (method: string, params: unknown) => Promise<unknown>
}

type RpcNotification = {
  method: string
  params: unknown
}

type TitleSource = {
  userText: string
  assistantText: string
}

type Candidate = {
  text: string
  source: 'assistant' | 'user'
}

const RETRY_DELAYS_MS = [1_000, 3_000, 8_000]
const MAX_SOURCE_TEXT_LENGTH = 4_000
const MAX_TITLE_LENGTH = 72
const MAX_TITLE_WORDS = 10

const GENERIC_LINE_PATTERNS = [
  /^(yes|yeah|sure|done|ready|ok|okay|got it)[.!:,\s-]*$/iu,
  /^(да|ок|окей|готово|понял|можно)[.!:,\s-]*$/iu,
  /^(what changed|changes|summary|result|итог|что изменил|что сделано)\s*:?\s*$/iu,
]

const ACTION_WORDS = [
  'add',
  'added',
  'auto',
  'automatic',
  'build',
  'change',
  'create',
  'fix',
  'generate',
  'implement',
  'implemented',
  'rename',
  'renamed',
  'suppress',
  'title',
  'update',
  'updated',
  'авто',
  'автомат',
  'добавил',
  'добавить',
  'изменил',
  'исправил',
  'название',
  'переимен',
  'реализовал',
  'сделал',
  'сгенер',
  'тред',
]

const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'because',
  'before',
  'from',
  'have',
  'into',
  'just',
  'make',
  'need',
  'that',
  'this',
  'thread',
  'with',
  'without',
  'would',
  'а',
  'будет',
  'в',
  'вот',
  'для',
  'если',
  'как',
  'когда',
  'короче',
  'мне',
  'можно',
  'надо',
  'нужно',
  'после',
  'просто',
  'с',
  'сейчас',
  'смотри',
  'так',
  'там',
  'то',
  'тут',
  'это',
  'этот',
  'чтобы',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function stripMarkdown(value: string): string {
  return normalizeSpaces(value
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/https?:\/\/\S+/giu, ' ')
    .replace(/^[\s>*#-]+/gmu, '')
    .replace(/[*_~]/gu, ' '))
}

function compactSourceText(value: string): string {
  const stripped = stripMarkdown(value)
  return stripped.length > MAX_SOURCE_TEXT_LENGTH
    ? stripped.slice(0, MAX_SOURCE_TEXT_LENGTH)
    : stripped
}

function splitCandidateSentences(text: string): string[] {
  const lines = text
    .split(/\n+/u)
    .map((line) => stripMarkdown(line))
    .filter(Boolean)

  const sentences: string[] = []
  for (const line of lines) {
    const parts = line
      .split(/(?<=[.!?])\s+|[;•]\s*/u)
      .map((part) => normalizeSpaces(part))
      .filter(Boolean)
    sentences.push(...(parts.length > 0 ? parts : [line]))
  }

  return sentences
}

function stripIntentPrefix(value: string): string {
  return normalizeSpaces(value
    .replace(/^(please|can you|could you|i need to|we need to|need to|let'?s|make it so that)\s+/iu, '')
    .replace(/^(смотри|слушай|короче|так|итак|мне нужно|нужно|надо|давай|сделай|можно ли|разве нельзя)\s+/iu, '')
    .replace(/^(i implemented|implemented|i added|added|i fixed|fixed|i updated|updated)\s+/iu, '')
    .replace(/^(я реализовал|реализовал|я добавил|добавил|я исправил|исправил|я обновил|обновил|сделал)\s+/iu, ''))
}

function isGenericLine(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 8) return true
  return GENERIC_LINE_PATTERNS.some((pattern) => pattern.test(trimmed))
}

function extractCandidates(text: string, source: Candidate['source']): Candidate[] {
  return splitCandidateSentences(text)
    .map(stripIntentPrefix)
    .filter((line) => !isGenericLine(line))
    .filter((line) => line.length >= 12 && line.length <= 260)
    .map((line) => ({ text: line, source }))
}

function extractKeywords(value: string): Set<string> {
  const words = stripMarkdown(value)
    .toLowerCase()
    .match(/[\p{L}\p{N}][\p{L}\p{N}#+-]{2,}/gu) ?? []
  return new Set(words.filter((word) => word.length > 3 && !STOP_WORDS.has(word)))
}

function scoreCandidate(candidate: Candidate, userKeywords: Set<string>): number {
  const lower = candidate.text.toLowerCase()
  let score = candidate.source === 'assistant' ? 20 : 10
  for (const action of ACTION_WORDS) {
    if (lower.includes(action)) score += 8
  }
  for (const keyword of userKeywords) {
    if (lower.includes(keyword)) score += 5
  }
  if (/[`/._-]/u.test(candidate.text)) score += 2
  if (candidate.text.length > 35 && candidate.text.length < 140) score += 4
  if (/^(the|this|that|it|это|этот|эта)\b/iu.test(candidate.text)) score -= 6
  return score
}

function maybeBuildKnownIntentTitle(userText: string, assistantText: string): string {
  const combined = `${userText}\n${assistantText}`.toLowerCase()
  if (
    /(iphone|айфон|push|пуш)/iu.test(combined) &&
    /(active|focus|focused|tab|window|desktop|активн|фокус|вкладк|окн|комп)/iu.test(combined)
  ) {
    return /[а-яё]/iu.test(combined)
      ? 'Не отправлять iPhone push при активной вкладке'
      : 'Suppress iPhone push when desktop thread is active'
  }

  if (
    /(thread|тред|сесси)/iu.test(combined) &&
    /(rename|renamed|title|name|назван|переимен)/iu.test(combined) &&
    /(first|перв|user|assistant|ответ|сообщени)/iu.test(combined)
  ) {
    return /[а-яё]/iu.test(combined)
      ? 'Автопереименование тредов по первой переписке'
      : 'Auto rename threads from the first exchange'
  }

  return ''
}

function limitTitle(value: string): string {
  const words = value.split(/\s+/u).filter(Boolean)
  let limited = words.slice(0, MAX_TITLE_WORDS).join(' ')
  if (limited.length > MAX_TITLE_LENGTH) {
    limited = limited.slice(0, MAX_TITLE_LENGTH)
  }
  return limited
    .replace(/[,:;.!?\s-]+$/u, '')
    .replace(/^["'“”]+|["'“”]+$/gu, '')
    .trim()
}

function finalizeTitle(value: string): string {
  const limited = limitTitle(stripIntentPrefix(stripMarkdown(value)))
  if (!limited) return ''
  return `${limited.charAt(0).toLocaleUpperCase()}${limited.slice(1)}`
}

export function generateThreadTitleFromConversation(userText: string, assistantText: string): string {
  const user = compactSourceText(userText)
  const assistant = compactSourceText(assistantText)
  const knownIntentTitle = maybeBuildKnownIntentTitle(user, assistant)
  if (knownIntentTitle) return knownIntentTitle

  const userKeywords = extractKeywords(user)
  const candidates = [
    ...extractCandidates(assistant, 'assistant'),
    ...extractCandidates(user, 'user'),
  ]

  const best = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, userKeywords),
    }))
    .sort((first, second) => second.score - first.score)[0]?.candidate

  return finalizeTitle(best?.text || user || assistant || 'Untitled thread') || 'Untitled thread'
}

function readContentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return entry
        const record = asRecord(entry)
        return readString(record?.text) || readString(record?.content)
      })
      .filter(Boolean)
      .join('\n')
  }

  const record = asRecord(value)
  if (!record) return ''
  return readString(record.text) || readString(record.content)
}

function readItemText(item: Record<string, unknown>): string {
  return readString(item.text) || readContentText(item.content)
}

function readFirstExchange(thread: Record<string, unknown>): TitleSource | null {
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  let userText = ''
  let assistantText = ''

  for (const turn of turns) {
    const turnRecord = asRecord(turn)
    const items = Array.isArray(turnRecord?.items) ? turnRecord.items : []
    for (const itemValue of items) {
      const item = asRecord(itemValue)
      if (!item) continue
      const itemType = readString(item.type)
      if (!userText && itemType === 'userMessage') {
        userText = readItemText(item)
      }
      if (userText && !assistantText && itemType === 'agentMessage') {
        assistantText = readItemText(item)
      }
      if (userText && assistantText) {
        return { userText, assistantText }
      }
    }
  }

  return userText && assistantText ? { userText, assistantText } : null
}

function extractThreadId(notification: RpcNotification): string {
  const params = asRecord(notification.params)
  return readString(params?.threadId)
}

export class ThreadAutoTitleManager {
  private readonly inFlightThreadIds = new Set<string>()
  private readonly completedThreadIds = new Set<string>()
  private readonly retryTimersByThreadId = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly appServer: AppServerRpc) {}

  handleNotification(notification: RpcNotification): void {
    if (notification.method !== 'turn/completed') return
    const threadId = extractThreadId(notification)
    if (!threadId || this.completedThreadIds.has(threadId)) return
    this.schedule(threadId, 0)
  }

  private schedule(threadId: string, attempt: number): void {
    if (this.inFlightThreadIds.has(threadId)) return
    const existing = this.retryTimersByThreadId.get(threadId)
    if (existing) clearTimeout(existing)

    const delayMs = RETRY_DELAYS_MS[attempt] ?? 0
    const timer = setTimeout(() => {
      this.retryTimersByThreadId.delete(threadId)
      void this.generateAndApply(threadId, attempt)
    }, delayMs)
    this.retryTimersByThreadId.set(threadId, timer)
  }

  private async generateAndApply(threadId: string, attempt: number): Promise<void> {
    if (this.completedThreadIds.has(threadId) || this.inFlightThreadIds.has(threadId)) return
    this.inFlightThreadIds.add(threadId)
    let nextAttempt: number | null = null

    try {
      const payload = asRecord(await this.appServer.rpc('thread/read', {
        threadId,
        includeTurns: true,
      }))
      const thread = asRecord(payload?.thread)
      if (!thread) return

      const existingName = readString(thread.name)
      if (existingName) {
        this.completedThreadIds.add(threadId)
        return
      }

      const source = readFirstExchange(thread)
      if (!source) {
        if (attempt + 1 < RETRY_DELAYS_MS.length) nextAttempt = attempt + 1
        return
      }

      const title = generateThreadTitleFromConversation(source.userText, source.assistantText)
      if (!title) return

      await this.appServer.rpc('thread/name/set', {
        threadId,
        name: title,
      })
      this.completedThreadIds.add(threadId)
    } catch (error) {
      if (attempt + 1 < RETRY_DELAYS_MS.length) {
        nextAttempt = attempt + 1
        return
      }
      console.warn('[thread-title]', 'Automatic title generation failed', {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      this.inFlightThreadIds.delete(threadId)
      if (nextAttempt !== null) {
        this.schedule(threadId, nextAttempt)
      }
    }
  }

  dispose(): void {
    for (const timer of this.retryTimersByThreadId.values()) {
      clearTimeout(timer)
    }
    this.retryTimersByThreadId.clear()
    this.inFlightThreadIds.clear()
    this.completedThreadIds.clear()
  }
}
