import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename } from 'node:path'
import {
  BrowserAnnotationBindingStore,
  readBrowserAnnotationBearerToken,
  sharedBrowserAnnotationBindingStore,
} from './browserAnnotationBinding.js'

export const BROWSER_ANNOTATION_THREADS_PATH = '/codex-api/extension/threads'
const BROWSER_ANNOTATION_THREAD_LIST_LIMIT = 100

export type BrowserAnnotationThreadTarget = {
  id: string
  title: string
  preview: string
  updatedAtIso: string
  cwd: string
}

export type BrowserAnnotationThreadGroup = {
  projectName: string
  cwd: string
  threads: BrowserAnnotationThreadTarget[]
}

export type BrowserAnnotationThreadRoutesOptions = {
  bindingStore?: BrowserAnnotationBindingStore
  listThreadGroups?: () => Promise<BrowserAnnotationThreadGroup[]>
}

type RpcExecutor = {
  rpc: (method: string, params: unknown) => Promise<unknown>
}

export async function handleBrowserAnnotationThreadRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: BrowserAnnotationThreadRoutesOptions = {},
): Promise<boolean> {
  if (url.pathname !== BROWSER_ANNOTATION_THREADS_PATH) return false

  if (req.method !== 'GET') {
    setJson(res, 405, { error: 'Browser annotation thread targets require GET' })
    return true
  }

  const token = readBrowserAnnotationBearerToken(req)
  if (!token) {
    setJson(res, 401, { error: 'Missing browser binding bearer token' })
    return true
  }

  const bindingStore = options.bindingStore ?? sharedBrowserAnnotationBindingStore
  const binding = bindingStore.getAuthorizedBinding(token)
  if (!binding) {
    setJson(res, 401, { error: 'Invalid or expired browser binding token' })
    return true
  }

  if (!options.listThreadGroups) {
    setJson(res, 503, { error: 'Browser annotation thread targets are not available' })
    return true
  }

  try {
    const groups = sanitizeThreadGroups(await options.listThreadGroups())
    setJson(res, 200, { ok: true, groups })
  } catch (error) {
    setJson(res, 500, { error: getErrorMessage(error, 'Failed to list browser annotation thread targets') })
  }
  return true
}

export async function listBrowserAnnotationThreadGroupsFromRpc(appServer: RpcExecutor): Promise<BrowserAnnotationThreadGroup[]> {
  const payload = await appServer.rpc('thread/list', {
    archived: false,
    limit: BROWSER_ANNOTATION_THREAD_LIST_LIMIT,
    sortKey: 'updated_at',
    modelProviders: [],
  })
  return buildBrowserAnnotationThreadGroups(payload)
}

export function buildBrowserAnnotationThreadGroups(payload: unknown): BrowserAnnotationThreadGroup[] {
  const record = isRecord(payload) ? payload : {}
  const rows = Array.isArray(record.data) ? record.data : []
  const grouped = new Map<string, BrowserAnnotationThreadGroup>()

  for (const row of rows) {
    const thread = toThreadTarget(row)
    if (!thread) continue
    const projectName = projectNameForCwd(thread.cwd)
    const key = `${projectName}\n${thread.cwd}`
    const group = grouped.get(key) ?? {
      projectName,
      cwd: thread.cwd,
      threads: [],
    }
    group.threads.push(thread)
    grouped.set(key, group)
  }

  return Array.from(grouped.values())
    .map((group) => ({
      ...group,
      threads: group.threads.sort((left, right) => Date.parse(right.updatedAtIso) - Date.parse(left.updatedAtIso)),
    }))
    .sort((left, right) => {
      const leftUpdatedAt = Date.parse(left.threads[0]?.updatedAtIso ?? '')
      const rightUpdatedAt = Date.parse(right.threads[0]?.updatedAtIso ?? '')
      return (Number.isFinite(rightUpdatedAt) ? rightUpdatedAt : 0) - (Number.isFinite(leftUpdatedAt) ? leftUpdatedAt : 0)
    })
}

function sanitizeThreadGroups(groups: BrowserAnnotationThreadGroup[]): BrowserAnnotationThreadGroup[] {
  if (!Array.isArray(groups)) return []
  return groups
    .map((group) => ({
      projectName: readTrimmedString(group.projectName) || projectNameForCwd(group.cwd),
      cwd: readTrimmedString(group.cwd),
      threads: Array.isArray(group.threads)
        ? group.threads.map(sanitizeThreadTarget).filter((thread): thread is BrowserAnnotationThreadTarget => Boolean(thread))
        : [],
    }))
    .filter((group) => group.projectName || group.threads.length > 0)
}

function sanitizeThreadTarget(thread: BrowserAnnotationThreadTarget): BrowserAnnotationThreadTarget | null {
  const id = readTrimmedString(thread.id)
  if (!id) return null
  return {
    id,
    title: readTrimmedString(thread.title) || readTrimmedString(thread.preview) || id,
    preview: readTrimmedString(thread.preview),
    updatedAtIso: readIsoString(thread.updatedAtIso),
    cwd: readTrimmedString(thread.cwd),
  }
}

function toThreadTarget(value: unknown): BrowserAnnotationThreadTarget | null {
  if (!isRecord(value)) return null
  const id = readTrimmedString(value.id)
  if (!id) return null
  const cwd = readTrimmedString(value.cwd)
  const preview = readTrimmedString(value.preview)
  return {
    id,
    title: readFirstString(value.name, value.title, preview, id),
    preview,
    updatedAtIso: readThreadUpdatedAtIso(value),
    cwd,
  }
}

function readThreadUpdatedAtIso(value: Record<string, unknown>): string {
  const direct = readIsoString(value.updatedAtIso)
  if (direct) return direct
  const seconds = readNumber(value.updatedAt ?? value.updated_at)
  if (seconds !== null) {
    return new Date(seconds * 1000).toISOString()
  }
  return ''
}

function readFirstString(...values: unknown[]): string {
  for (const value of values) {
    const text = readTrimmedString(value)
    if (text) return text
  }
  return ''
}

function readIsoString(value: unknown): string {
  const text = readTrimmedString(value)
  if (!text) return ''
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : ''
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function projectNameForCwd(cwd: unknown): string {
  const text = readTrimmedString(cwd)
  return text ? basename(text) : 'Projectless'
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function setJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', Buffer.byteLength(body))
  res.end(body)
}
