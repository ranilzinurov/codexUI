export const ANNOTATION_BATCH_SCHEMA_VERSION = 1 as const
export const ANNOTATION_DEFAULT_BODY_CAP_BYTES = 16_384
export const ANNOTATION_MAX_BODY_CAP_BYTES = 64 * 1024
export const ANNOTATION_REDACTED_VALUE = '[REDACTED]' as const

export const ANNOTATION_SENSITIVE_HEADER_NAMES = [
  'authorization',
  'cookie',
  'proxy-authorization',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
] as const

export const ANNOTATION_SENSITIVE_FIELD_NAMES = [
  'access_token',
  'api_key',
  'auth',
  'client_secret',
  'cookie',
  'csrf',
  'id_token',
  'password',
  'refresh_token',
  'secret',
  'session',
  'token',
] as const

export type AnnotationAssetKind =
  | 'page-screenshot'
  | 'annotation-screenshot'
  | 'voice-note-audio'
  | 'devtools-export'

export type AnnotationUploadedAssetRecord = {
  id: string
  kind: AnnotationAssetKind
  mimeType: string
  byteLength: number
  uploadedAtIso: string
  storageKey?: string
  sha256?: string
  width?: number
  height?: number
  durationMs?: number
}

export type AnnotationBodyCaptureMode = 'metadata-only' | 'full-body-opt-in'

export type AnnotationPrivacyRules = {
  redactPasswordsTokensCookiesByDefault: true
  sensitiveHeaderNames: readonly string[]
  sensitiveFieldNames: readonly string[]
  bodyCaptureMode: AnnotationBodyCaptureMode
  bodyCapBytes: number
}

export const DEFAULT_ANNOTATION_PRIVACY_RULES: AnnotationPrivacyRules = {
  redactPasswordsTokensCookiesByDefault: true,
  sensitiveHeaderNames: ANNOTATION_SENSITIVE_HEADER_NAMES,
  sensitiveFieldNames: ANNOTATION_SENSITIVE_FIELD_NAMES,
  bodyCaptureMode: 'metadata-only',
  bodyCapBytes: ANNOTATION_DEFAULT_BODY_CAP_BYTES,
}

export type AnnotationPageContext = {
  url: string
  title?: string
  origin?: string
  tabId?: number
  windowId?: number
}

export type AnnotationViewport = {
  width: number
  height: number
  devicePixelRatio: number
  scrollX: number
  scrollY: number
}

export type AnnotationDomRect = {
  x: number
  y: number
  width: number
  height: number
}

export type AnnotationElementTarget = {
  selector?: string
  xpath?: string
  tagName?: string
  ariaLabel?: string
  textSnippet?: string
  rect?: AnnotationDomRect
}

export type VoiceNoteTranscriptStatus = 'not-started' | 'pending' | 'complete' | 'failed' | 'uncertain'

export type VoiceNote = {
  id: string
  assetId: string
  mimeType: string
  durationMs: number
  transcriptStatus: VoiceNoteTranscriptStatus
  transcriptText?: string
  language?: string
  errorMessage?: string
}

export type AnnotationItemKind = 'text' | 'screenshot' | 'voice' | 'mixed'

export type AnnotationItem = {
  id: string
  kind: AnnotationItemKind
  createdAtIso: string
  page: AnnotationPageContext
  viewport?: AnnotationViewport
  target?: AnnotationElementTarget
  noteText?: string
  selectedText?: string
  screenshotAssetId?: string
  voiceNote?: VoiceNote
  devToolsContext?: {
    snapshotId: string
    startedAtIso: string
    endedAtIso: string
    requestIds: string[]
    consoleEntryIds: string[]
  }
}

export type DevToolsConsoleLevel = 'log' | 'info' | 'warning' | 'error' | 'debug'

export type DevToolsConsoleEntry = {
  id: string
  level: DevToolsConsoleLevel
  timestampIso: string
  text: string
  source?: string
  url?: string
  lineNumber?: number
  columnNumber?: number
}

export type DevToolsHeaderRecord = {
  name: string
  value: string
  redacted?: boolean
}

export type DevToolsCapturedTextBody = {
  state: 'captured' | 'trimmed'
  userOptIn: true
  capBytes: number
  text: string
  byteLength: number
  originalByteLength?: number
  redactionApplied: boolean
}

export type DevToolsCapturedBody =
  | {
      state: 'not-captured'
      reason: 'default-privacy' | 'binary' | 'too-large' | 'user-disabled'
      userOptIn: false
      capBytes: number
      byteLength?: number
    }
  | DevToolsCapturedTextBody
  | {
      state: 'redacted'
      reason: 'sensitive' | 'policy'
      userOptIn: boolean
      capBytes: number
      byteLength?: number
    }

export type DevToolsNetworkRecord = {
  id: string
  startedAtIso: string
  finishedAtIso?: string
  method: string
  url: string
  status?: number
  statusText?: string
  resourceType?: string
  requestHeaders: DevToolsHeaderRecord[]
  responseHeaders: DevToolsHeaderRecord[]
  requestBody?: DevToolsCapturedBody
  responseBody?: DevToolsCapturedBody
  errorText?: string
  fromCache?: boolean
}

export type DevToolsSnapshot = {
  id: string
  capturedAtIso: string
  attachMode: 'explicit-user-enabled'
  captureStartedAtIso: string
  captureEndedAtIso: string
  privacy: AnnotationPrivacyRules
  summary: {
    consoleCount: number
    networkCount: number
    errorCount: number
    redactedHeaderCount: number
    capturedBodyCount: number
    trimmedBodyCount: number
    omittedBodyCount: number
  }
  console: DevToolsConsoleEntry[]
  network: DevToolsNetworkRecord[]
}

export type AnnotationBatch = {
  schemaVersion: typeof ANNOTATION_BATCH_SCHEMA_VERSION
  batchId: string
  createdAtIso: string
  source: {
    kind: 'chrome-extension'
    extensionVersion?: string
    browserName?: string
  }
  targetThreadId?: string
  page: AnnotationPageContext
  privacy: AnnotationPrivacyRules
  assets: AnnotationUploadedAssetRecord[]
  items: AnnotationItem[]
  devTools?: DevToolsSnapshot
}

export type AnnotationBatchValidationResult = {
  ok: boolean
  errors: string[]
}

type BodyTrimOptions = {
  capBytes?: number
  redactionApplied?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function normalizeBodyCapBytes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), ANNOTATION_MAX_BODY_CAP_BYTES)
    : ANNOTATION_DEFAULT_BODY_CAP_BYTES
}

function bodyTextByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function trimTextByBytes(value: string, capBytes: number): string {
  if (bodyTextByteLength(value) <= capBytes) return value

  let output = ''
  let outputBytes = 0
  for (const char of value) {
    const charBytes = bodyTextByteLength(char)
    if (outputBytes + charBytes > capBytes) break
    output += char
    outputBytes += charBytes
  }
  return output
}

function validateHeaders(headers: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(headers)) {
    errors.push(`${path} must be an array`)
    return
  }

  headers.forEach((header, index) => {
    if (!isRecord(header)) {
      errors.push(`${path}[${index}] must be an object`)
      return
    }

    if (!isNonEmptyString(header.name)) errors.push(`${path}[${index}].name must be a non-empty string`)
    if (typeof header.value !== 'string') errors.push(`${path}[${index}].value must be a string`)
    if (isNonEmptyString(header.name) && isSensitiveAnnotationHeaderName(header.name)) {
      if (header.redacted !== true || header.value !== ANNOTATION_REDACTED_VALUE) {
        errors.push(`${path}[${index}] sensitive header must be redacted`)
      }
    }
  })
}

function validateCapturedBody(body: unknown, path: string, errors: string[]): void {
  if (body === undefined) return
  if (!isRecord(body)) {
    errors.push(`${path} must be an object`)
    return
  }

  const capBytes = body.capBytes
  if (!isFiniteNonNegativeNumber(capBytes) || capBytes <= 0 || capBytes > ANNOTATION_MAX_BODY_CAP_BYTES) {
    errors.push(`${path}.capBytes must be between 1 and ${ANNOTATION_MAX_BODY_CAP_BYTES}`)
  }

  const allowedStates = ['not-captured', 'captured', 'trimmed', 'redacted']
  if (typeof body.state !== 'string' || !allowedStates.includes(body.state)) {
    errors.push(`${path}.state is unsupported`)
    return
  }

  if (body.state === 'captured' || body.state === 'trimmed') {
    if (body.userOptIn !== true) errors.push(`${path} captured body text requires user opt-in`)
    if (typeof body.text !== 'string') {
      errors.push(`${path}.text must be a string`)
      return
    }

    const normalizedCap = normalizeBodyCapBytes(capBytes)
    const actualByteLength = bodyTextByteLength(body.text)
    if (actualByteLength > normalizedCap) {
      errors.push(`${path}.text exceeds capBytes`)
    }
    if (!isFiniteNonNegativeNumber(body.byteLength)) errors.push(`${path}.byteLength must be a non-negative number`)
    if (containsUnredactedSensitiveAnnotationField(body.text)) {
      errors.push(`${path}.text includes sensitive fields and must be redacted`)
    }
    return
  }

  if ('text' in body) errors.push(`${path}.text must be omitted unless body text is captured`)
}

function validateAssetReferences(batch: AnnotationBatch, errors: string[]): void {
  const assetIds = new Set<string>()
  batch.assets.forEach((asset, index) => {
    if (!isRecord(asset)) {
      errors.push(`assets[${index}] must be an object`)
      return
    }
    if (!isNonEmptyString(asset.id)) errors.push(`assets[${index}].id must be a non-empty string`)
    if (assetIds.has(asset.id)) errors.push(`assets[${index}].id must be unique`)
    assetIds.add(asset.id)
    if (!isNonEmptyString(asset.mimeType)) errors.push(`assets[${index}].mimeType must be a non-empty string`)
    if (!isFiniteNonNegativeNumber(asset.byteLength)) errors.push(`assets[${index}].byteLength must be a non-negative number`)
  })

  batch.items.forEach((item, index) => {
    if (!isRecord(item)) {
      errors.push(`items[${index}] must be an object`)
      return
    }
    if (item.screenshotAssetId && !assetIds.has(item.screenshotAssetId)) {
      errors.push(`items[${index}].screenshotAssetId must reference an uploaded asset`)
    }
    const voiceNote = isRecord(item.voiceNote) ? item.voiceNote : undefined
    if (typeof voiceNote?.assetId === 'string' && !assetIds.has(voiceNote.assetId)) {
      errors.push(`items[${index}].voiceNote.assetId must reference an uploaded asset`)
    }
  })
}

export function isSensitiveAnnotationHeaderName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return ANNOTATION_SENSITIVE_HEADER_NAMES.includes(normalized as (typeof ANNOTATION_SENSITIVE_HEADER_NAMES)[number])
}

function normalizeSensitiveFieldName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

const SENSITIVE_FIELD_NAME_SET = new Set([
  ...ANNOTATION_SENSITIVE_FIELD_NAMES.map(normalizeSensitiveFieldName),
  'accesstoken',
  'apikey',
  'authtoken',
  'clientsecret',
  'csrftoken',
  'idtoken',
  'refreshtoken',
  'sessionid',
  'sessiontoken',
  'xapikey',
  'xauthtoken',
  'xcsrftoken',
])

function isSensitiveAnnotationFieldName(name: string): boolean {
  return SENSITIVE_FIELD_NAME_SET.has(normalizeSensitiveFieldName(name))
}

export function containsSensitiveAnnotationFieldName(value: string): boolean {
  const fieldPattern = /["']?([A-Za-z][A-Za-z0-9_-]*)["']?\s*[:=]/g
  return Array.from(value.matchAll(fieldPattern)).some((match) => isSensitiveAnnotationFieldName(match[1] ?? ''))
}

function normalizeCapturedBodyFieldValue(value: string): string {
  const trimmed = value.trim()
  const first = trimmed.at(0)
  const last = trimmed.at(-1)
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

export function containsUnredactedSensitiveAnnotationField(value: string): boolean {
  const fieldValuePattern = /["']?([A-Za-z][A-Za-z0-9_-]*)["']?\s*[:=]\s*("[^"]*"|'[^']*'|[^,&}\s]+)/g
  return Array.from(value.matchAll(fieldValuePattern)).some((match) => {
    const fieldName = match[1] ?? ''
    const fieldValue = normalizeCapturedBodyFieldValue(match[2] ?? '')
    return isSensitiveAnnotationFieldName(fieldName) && fieldValue !== ANNOTATION_REDACTED_VALUE
  })
}

export function trimAnnotationBodyText(value: string, options: BodyTrimOptions = {}): DevToolsCapturedTextBody {
  const capBytes = normalizeBodyCapBytes(options.capBytes)
  const byteLength = bodyTextByteLength(value)
  const text = trimTextByBytes(value, capBytes)
  const trimmedByteLength = bodyTextByteLength(text)
  return {
    state: byteLength > capBytes ? 'trimmed' : 'captured',
    userOptIn: true,
    capBytes,
    text,
    byteLength: trimmedByteLength,
    originalByteLength: byteLength > capBytes ? byteLength : undefined,
    redactionApplied: options.redactionApplied ?? false,
  }
}

export function validateAnnotationBatchPayload(value: unknown): AnnotationBatchValidationResult {
  const errors: string[] = []
  if (!isRecord(value)) return { ok: false, errors: ['payload must be an object'] }

  const batch = value as AnnotationBatch
  if (batch.schemaVersion !== ANNOTATION_BATCH_SCHEMA_VERSION) errors.push('schemaVersion is unsupported')
  if (!isNonEmptyString(batch.batchId)) errors.push('batchId must be a non-empty string')
  if (!isNonEmptyString(batch.createdAtIso)) errors.push('createdAtIso must be a non-empty string')
  if (!isRecord(batch.source) || batch.source.kind !== 'chrome-extension') {
    errors.push('source.kind must be chrome-extension')
  }
  if (!isRecord(batch.page) || !isNonEmptyString(batch.page.url)) errors.push('page.url must be a non-empty string')
  if (!Array.isArray(batch.assets)) errors.push('assets must be an array')
  if (!Array.isArray(batch.items) || batch.items.length === 0) errors.push('items must contain at least one annotation')

  if (Array.isArray(batch.assets) && Array.isArray(batch.items)) validateAssetReferences(batch, errors)

  if (Array.isArray(batch.items)) {
    batch.items.forEach((item, index) => {
      if (!isRecord(item)) {
        errors.push(`items[${index}] must be an object`)
        return
      }
      if (!isNonEmptyString(item.id)) errors.push(`items[${index}].id must be a non-empty string`)
      if (!isNonEmptyString(item.createdAtIso)) errors.push(`items[${index}].createdAtIso must be a non-empty string`)
      if (!isRecord(item.page) || !isNonEmptyString(item.page.url)) {
        errors.push(`items[${index}].page.url must be a non-empty string`)
      }
    })
  }

  const devTools = batch.devTools
  if (devTools !== undefined) {
    if (!isRecord(devTools)) {
      errors.push('devTools must be an object')
    } else {
      if (devTools.attachMode !== 'explicit-user-enabled') errors.push('devTools.attachMode must be explicit-user-enabled')
      const network = Array.isArray(devTools.network) ? devTools.network : []
      if (!Array.isArray(devTools.network)) errors.push('devTools.network must be an array')
      network.forEach((request, index) => {
        if (!isRecord(request)) {
          errors.push(`devTools.network[${index}] must be an object`)
          return
        }
        validateHeaders(request.requestHeaders, `devTools.network[${index}].requestHeaders`, errors)
        validateHeaders(request.responseHeaders, `devTools.network[${index}].responseHeaders`, errors)
        validateCapturedBody(request.requestBody, `devTools.network[${index}].requestBody`, errors)
        validateCapturedBody(request.responseBody, `devTools.network[${index}].responseBody`, errors)
      })
    }
  }

  return { ok: errors.length === 0, errors }
}

export const TEXT_ONLY_ANNOTATION_BATCH_EXAMPLE = {
  schemaVersion: ANNOTATION_BATCH_SCHEMA_VERSION,
  batchId: 'batch-text-only',
  createdAtIso: '2026-05-28T10:00:00.000Z',
  source: {
    kind: 'chrome-extension',
    extensionVersion: '0.0.1',
    browserName: 'Chrome',
  },
  page: {
    url: 'https://app.example.test/settings',
    title: 'Settings',
    origin: 'https://app.example.test',
  },
  privacy: DEFAULT_ANNOTATION_PRIVACY_RULES,
  assets: [],
  items: [
    {
      id: 'annotation-text-1',
      kind: 'text',
      createdAtIso: '2026-05-28T10:00:01.000Z',
      page: {
        url: 'https://app.example.test/settings',
        title: 'Settings',
      },
      noteText: 'The save button looks disabled after changing the email field.',
      selectedText: 'Email notifications',
    },
  ],
} satisfies AnnotationBatch

export const SCREENSHOT_ONLY_ANNOTATION_BATCH_EXAMPLE = {
  schemaVersion: ANNOTATION_BATCH_SCHEMA_VERSION,
  batchId: 'batch-screenshot-only',
  createdAtIso: '2026-05-28T10:05:00.000Z',
  source: {
    kind: 'chrome-extension',
    extensionVersion: '0.0.1',
    browserName: 'Chrome',
  },
  page: {
    url: 'https://app.example.test/dashboard',
    title: 'Dashboard',
    origin: 'https://app.example.test',
  },
  privacy: DEFAULT_ANNOTATION_PRIVACY_RULES,
  assets: [
    {
      id: 'asset-dashboard-shot',
      kind: 'annotation-screenshot',
      mimeType: 'image/png',
      byteLength: 148_320,
      uploadedAtIso: '2026-05-28T10:05:02.000Z',
      storageKey: 'annotation-assets/batch-screenshot-only/dashboard.png',
      width: 1280,
      height: 720,
    },
  ],
  items: [
    {
      id: 'annotation-screenshot-1',
      kind: 'screenshot',
      createdAtIso: '2026-05-28T10:05:01.000Z',
      page: {
        url: 'https://app.example.test/dashboard',
        title: 'Dashboard',
      },
      viewport: {
        width: 1280,
        height: 720,
        devicePixelRatio: 1,
        scrollX: 0,
        scrollY: 180,
      },
      target: {
        selector: '[data-testid="revenue-chart"]',
        tagName: 'canvas',
        rect: {
          x: 48,
          y: 220,
          width: 780,
          height: 320,
        },
      },
      screenshotAssetId: 'asset-dashboard-shot',
    },
  ],
} satisfies AnnotationBatch

export const VOICE_ANNOTATION_BATCH_EXAMPLE = {
  schemaVersion: ANNOTATION_BATCH_SCHEMA_VERSION,
  batchId: 'batch-voice',
  createdAtIso: '2026-05-28T10:10:00.000Z',
  source: {
    kind: 'chrome-extension',
    extensionVersion: '0.0.1',
    browserName: 'Chrome',
  },
  page: {
    url: 'https://app.example.test/orders/123',
    title: 'Order 123',
    origin: 'https://app.example.test',
  },
  privacy: DEFAULT_ANNOTATION_PRIVACY_RULES,
  assets: [
    {
      id: 'asset-voice-note',
      kind: 'voice-note-audio',
      mimeType: 'audio/webm',
      byteLength: 88_214,
      uploadedAtIso: '2026-05-28T10:10:05.000Z',
      storageKey: 'annotation-assets/batch-voice/voice.webm',
      durationMs: 12_400,
    },
  ],
  items: [
    {
      id: 'annotation-voice-1',
      kind: 'voice',
      createdAtIso: '2026-05-28T10:10:03.000Z',
      page: {
        url: 'https://app.example.test/orders/123',
        title: 'Order 123',
      },
      voiceNote: {
        id: 'voice-note-1',
        assetId: 'asset-voice-note',
        mimeType: 'audio/webm',
        durationMs: 12_400,
        transcriptStatus: 'complete',
        transcriptText: 'This order total changed after refresh, please inspect the tax calculation.',
        language: 'en',
      },
    },
  ],
} satisfies AnnotationBatch

const DEVTOOLS_RESPONSE_BODY_EXAMPLE = trimAnnotationBodyText(
  JSON.stringify({
    error: 'Validation failed',
    field: 'email',
    message: 'Email is already registered for this workspace.',
  }),
  { capBytes: 96, redactionApplied: false },
)

export const DEVTOOLS_HEAVY_ANNOTATION_BATCH_EXAMPLE = {
  schemaVersion: ANNOTATION_BATCH_SCHEMA_VERSION,
  batchId: 'batch-devtools-heavy',
  createdAtIso: '2026-05-28T10:15:00.000Z',
  source: {
    kind: 'chrome-extension',
    extensionVersion: '0.0.1',
    browserName: 'Chrome',
  },
  page: {
    url: 'https://app.example.test/signup',
    title: 'Signup',
    origin: 'https://app.example.test',
  },
  privacy: {
    ...DEFAULT_ANNOTATION_PRIVACY_RULES,
    bodyCaptureMode: 'full-body-opt-in',
    bodyCapBytes: 96,
  },
  assets: [
    {
      id: 'asset-signup-shot',
      kind: 'annotation-screenshot',
      mimeType: 'image/png',
      byteLength: 96_400,
      uploadedAtIso: '2026-05-28T10:15:04.000Z',
      storageKey: 'annotation-assets/batch-devtools-heavy/signup.png',
      width: 1440,
      height: 900,
    },
  ],
  items: [
    {
      id: 'annotation-devtools-1',
      kind: 'mixed',
      createdAtIso: '2026-05-28T10:15:03.000Z',
      page: {
        url: 'https://app.example.test/signup',
        title: 'Signup',
      },
      noteText: 'Signup fails after submit.',
      screenshotAssetId: 'asset-signup-shot',
      devToolsContext: {
        snapshotId: 'devtools-snapshot-1',
        startedAtIso: '2026-05-28T10:14:45.000Z',
        endedAtIso: '2026-05-28T10:15:05.000Z',
        requestIds: ['request-signup-post'],
        consoleEntryIds: ['console-error-1'],
      },
    },
  ],
  devTools: {
    id: 'devtools-snapshot-1',
    capturedAtIso: '2026-05-28T10:15:05.000Z',
    attachMode: 'explicit-user-enabled',
    captureStartedAtIso: '2026-05-28T10:14:45.000Z',
    captureEndedAtIso: '2026-05-28T10:15:05.000Z',
    privacy: {
      ...DEFAULT_ANNOTATION_PRIVACY_RULES,
      bodyCaptureMode: 'full-body-opt-in',
      bodyCapBytes: 96,
    },
    summary: {
      consoleCount: 1,
      networkCount: 1,
      errorCount: 2,
      redactedHeaderCount: 2,
      capturedBodyCount: 1,
      trimmedBodyCount: DEVTOOLS_RESPONSE_BODY_EXAMPLE.state === 'trimmed' ? 1 : 0,
      omittedBodyCount: 1,
    },
    console: [
      {
        id: 'console-error-1',
        level: 'error',
        timestampIso: '2026-05-28T10:15:02.500Z',
        text: 'POST /api/signup returned 409',
        source: 'console-api',
        url: 'https://app.example.test/signup',
        lineNumber: 42,
        columnNumber: 15,
      },
    ],
    network: [
      {
        id: 'request-signup-post',
        startedAtIso: '2026-05-28T10:15:02.000Z',
        finishedAtIso: '2026-05-28T10:15:02.450Z',
        method: 'POST',
        url: 'https://app.example.test/api/signup',
        status: 409,
        statusText: 'Conflict',
        resourceType: 'fetch',
        requestHeaders: [
          {
            name: 'authorization',
            value: ANNOTATION_REDACTED_VALUE,
            redacted: true,
          },
          {
            name: 'cookie',
            value: ANNOTATION_REDACTED_VALUE,
            redacted: true,
          },
          {
            name: 'content-type',
            value: 'application/json',
          },
        ],
        responseHeaders: [
          {
            name: 'content-type',
            value: 'application/json',
          },
        ],
        requestBody: {
          state: 'not-captured',
          reason: 'default-privacy',
          userOptIn: false,
          capBytes: 96,
          byteLength: 128,
        },
        responseBody: DEVTOOLS_RESPONSE_BODY_EXAMPLE,
      },
    ],
  },
} satisfies AnnotationBatch

export const ANNOTATION_BATCH_EXAMPLES = [
  TEXT_ONLY_ANNOTATION_BATCH_EXAMPLE,
  SCREENSHOT_ONLY_ANNOTATION_BATCH_EXAMPLE,
  VOICE_ANNOTATION_BATCH_EXAMPLE,
  DEVTOOLS_HEAVY_ANNOTATION_BATCH_EXAMPLE,
] as const satisfies readonly AnnotationBatch[]
