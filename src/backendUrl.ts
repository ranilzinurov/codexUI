import { Capacitor, CapacitorHttp, type HttpHeaders, type HttpResponse } from '@capacitor/core'

const BACKEND_URL_STORAGE_KEY = 'codex-web-local.backend-url.v1'
const BACKEND_URL_CHANGED_EVENT = 'codex-backend-url-changed'
const NATIVE_IOS_DEFAULT_BACKEND_URL = 'https://codex-ui.todo-tg-app.ru'
const MOBILE_SHELL_ORIGIN = 'capacitor://localhost'

type WindowWithCapacitor = Window & {
  Capacitor?: {
    isNativePlatform?: () => boolean
    getPlatform?: () => string
  }
}

function readEnvBackendUrl(): string {
  const env = import.meta.env as ImportMetaEnv & { VITE_CODEXUI_BACKEND_URL?: string }
  return normalizeBackendBaseUrl(env.VITE_CODEXUI_BACKEND_URL ?? '').value
}

function readNativeDefaultBackendUrl(): string {
  if (!isNativeIosApp()) return ''
  return NATIVE_IOS_DEFAULT_BACKEND_URL
}

function safeReadStorage(key: string): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function safeWriteStorage(key: string, value: string): void {
  if (typeof window === 'undefined') return
  try {
    if (value) {
      window.localStorage.setItem(key, value)
    } else {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Keep the in-memory browser flow working if storage is unavailable.
  }
}

function readRawConfiguredBackendUrl(): string {
  return safeReadStorage(BACKEND_URL_STORAGE_KEY) || readEnvBackendUrl() || readNativeDefaultBackendUrl()
}

function isRoutedBackendPath(pathname: string): boolean {
  return (
    pathname === '/auth/login' ||
    pathname === '/codex-api' ||
    pathname.startsWith('/codex-api/') ||
    pathname === '/codex-local-image' ||
    pathname === '/codex-local-file' ||
    pathname === '/codex-local-directories' ||
    pathname.startsWith('/codex-local-browse/') ||
    pathname.startsWith('/codex-local-edit/')
  )
}

function parseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base)
  } catch {
    return null
  }
}

export function normalizeBackendBaseUrl(value: string): { value: string; error: string } {
  const trimmed = value.trim()
  if (!trimmed) return { value: '', error: '' }

  const parsed = parseUrl(trimmed)
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return { value: '', error: 'Use a valid http:// or https:// backend URL.' }
  }

  parsed.username = ''
  parsed.password = ''
  parsed.hash = ''
  parsed.search = ''
  const normalized = parsed.toString().replace(/\/$/u, '')
  return { value: normalized, error: '' }
}

export function getConfiguredBackendUrl(): string {
  return normalizeBackendBaseUrl(readRawConfiguredBackendUrl()).value
}

export function getBackendUrlStorageKey(): string {
  return BACKEND_URL_STORAGE_KEY
}

export function setConfiguredBackendUrl(value: string): { value: string; error: string } {
  const result = normalizeBackendBaseUrl(value)
  if (result.error) return result

  safeWriteStorage(BACKEND_URL_STORAGE_KEY, result.value)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BACKEND_URL_CHANGED_EVENT, { detail: { value: result.value } }))
  }
  return result
}

export function subscribeBackendUrlChanges(callback: (value: string) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = () => callback(getConfiguredBackendUrl())
  window.addEventListener(BACKEND_URL_CHANGED_EVENT, listener)
  window.addEventListener('storage', listener)
  return () => {
    window.removeEventListener(BACKEND_URL_CHANGED_EVENT, listener)
    window.removeEventListener('storage', listener)
  }
}

export function isCapacitorNativeApp(): boolean {
  if (typeof window === 'undefined') return false
  const capacitor = (window as WindowWithCapacitor).Capacitor
  if (!capacitor) return false
  if (typeof capacitor.isNativePlatform === 'function') return capacitor.isNativePlatform()
  return typeof capacitor.getPlatform === 'function' && capacitor.getPlatform() !== 'web'
}

function isNativeIosApp(): boolean {
  if (typeof window === 'undefined') return false
  const capacitor = (window as WindowWithCapacitor).Capacitor
  if (!capacitor) return false
  const platform = typeof capacitor.getPlatform === 'function' ? capacitor.getPlatform() : ''
  if (platform !== 'ios') return false
  if (typeof capacitor.isNativePlatform === 'function') return capacitor.isNativePlatform()
  return true
}

export function resolveBackendHttpUrl(input: string): string {
  const backendBaseUrl = getConfiguredBackendUrl()
  if (!backendBaseUrl || typeof window === 'undefined') return input

  const parsed = parseUrl(input, window.location.href)
  if (!parsed || !isRoutedBackendPath(parsed.pathname)) return input

  const backend = parseUrl(backendBaseUrl)
  if (!backend) return input
  backend.pathname = parsed.pathname
  backend.search = parsed.search
  backend.hash = parsed.hash
  return backend.toString()
}

function isConfiguredBackendRoutedUrl(input: string): boolean {
  const backendBaseUrl = getConfiguredBackendUrl()
  if (!backendBaseUrl || typeof window === 'undefined') return false
  const parsed = parseUrl(input, window.location.href)
  return Boolean(parsed && isRoutedBackendPath(parsed.pathname))
}

export function resolveBackendWebSocketUrl(input: string): string {
  const backendBaseUrl = getConfiguredBackendUrl()
  if (!backendBaseUrl || typeof window === 'undefined') return input

  const parsed = parseUrl(input, window.location.href)
  if (!parsed || !isRoutedBackendPath(parsed.pathname)) return input

  const backend = parseUrl(backendBaseUrl)
  if (!backend) return input
  backend.protocol = backend.protocol === 'https:' ? 'wss:' : 'ws:'
  backend.pathname = parsed.pathname
  backend.search = parsed.search
  backend.hash = parsed.hash
  return backend.toString()
}

function resolveFetchInput(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input === 'string') return resolveBackendHttpUrl(input)
  if (input instanceof URL) return new URL(resolveBackendHttpUrl(input.toString()))
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const routedUrl = resolveBackendHttpUrl(input.url)
    return routedUrl === input.url ? input : new Request(routedUrl, input)
  }
  return input
}

function shouldUseNativeBackendHttp(input: string): boolean {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'ios' &&
    isConfiguredBackendRoutedUrl(input)
  )
}

function shouldUseNativeBinaryResponse(input: string): boolean {
  const parsed = parseUrl(input, typeof window === 'undefined' ? undefined : window.location.href)
  if (!parsed) return false
  return (
    parsed.pathname === '/codex-api/voice/speech' ||
    /^\/codex-api\/voice\/jobs\/[^/]+\/audio$/u.test(parsed.pathname) ||
    parsed.pathname === '/codex-local-image' ||
    parsed.pathname === '/codex-local-file'
  )
}

function resolveNativeAcceptHeader(input: string): string | undefined {
  const parsed = parseUrl(input, typeof window === 'undefined' ? undefined : window.location.href)
  if (!parsed) return undefined
  if (
    parsed.pathname === '/codex-api/voice/speech' ||
    /^\/codex-api\/voice\/jobs\/[^/]+\/audio$/u.test(parsed.pathname)
  ) {
    return 'audio/*, application/json;q=0.9, */*;q=0.1'
  }
  if (
    parsed.pathname === '/auth/login' ||
    parsed.pathname === '/codex-api' ||
    parsed.pathname.startsWith('/codex-api/')
  ) {
    return 'application/json, text/plain;q=0.9, */*;q=0.1'
  }
  return undefined
}

function headersToObject(headers: Headers): HttpHeaders {
  const result: HttpHeaders = {}
  headers.forEach((value, key) => {
    result[key] = value
  })
  return result
}

function mergeFetchHeaders(
  input: RequestInfo | URL,
  init?: RequestInit,
  contentType?: string,
  accept?: string,
): HttpHeaders {
  const headers = new Headers(typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined)
  if (init?.headers) {
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value)
    })
  }
  if (!headers.has('origin')) headers.set('Origin', MOBILE_SHELL_ORIGIN)
  if (contentType) headers.set('Content-Type', contentType)
  if (accept && !headers.has('accept')) headers.set('Accept', accept)
  return headersToObject(headers)
}

function resolveFetchMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method
  return 'GET'
}

type NativeFetchBody = {
  data?: string | Array<Record<string, string>>
  dataType?: 'formData'
  contentType?: string
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function readFileName(value: Blob, fallback: string): string {
  const maybeFile = value as Blob & { name?: unknown }
  return typeof maybeFile.name === 'string' && maybeFile.name.trim() ? maybeFile.name.trim() : fallback
}

async function formDataToNativeData(formData: FormData): Promise<NativeFetchBody> {
  const data: Array<Record<string, string>> = []
  for (const [key, value] of formData.entries()) {
    if (typeof value === 'string') {
      data.push({ type: 'string', key, value })
      continue
    }

    const fileName = readFileName(value, 'upload')
    data.push({
      type: 'base64File',
      key,
      value: arrayBufferToBase64(await value.arrayBuffer()),
      fileName,
      contentType: value.type || 'application/octet-stream',
    })
  }

  return {
    data,
    dataType: 'formData',
    contentType: 'multipart/form-data',
  }
}

async function readNativeFetchBody(input: RequestInfo | URL, init?: RequestInit): Promise<NativeFetchBody> {
  const body = init?.body
  if (body instanceof FormData) return formDataToNativeData(body)
  if (typeof body === 'string') return body ? { data: body } : {}
  if (body instanceof URLSearchParams) {
    return { data: body.toString(), contentType: 'application/x-www-form-urlencoded;charset=UTF-8' }
  }
  if (body instanceof Blob) return { data: await body.text(), contentType: body.type }
  if (body instanceof ArrayBuffer) return { data: new TextDecoder().decode(body) }
  if (ArrayBuffer.isView(body)) return { data: new TextDecoder().decode(body) }
  if (body !== undefined && body !== null) return { data: String(body) }

  if (typeof Request !== 'undefined' && input instanceof Request && input.method !== 'GET' && input.method !== 'HEAD') {
    const cloned = input.clone()
    const contentType = cloned.headers.get('content-type') ?? ''
    if (contentType.toLowerCase().startsWith('multipart/form-data')) {
      return formDataToNativeData(await cloned.formData())
    }
    return { data: await cloned.text(), contentType }
  }
  return {}
}

function base64ToBlob(value: string, contentType: string): Blob {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: contentType })
}

function readResponseContentType(response: HttpResponse): string {
  for (const [key, value] of Object.entries(response.headers)) {
    if (key.toLowerCase() === 'content-type') return value
  }
  return ''
}

function nativeHttpResponseBody(response: HttpResponse, responseType: 'text' | 'blob'): BodyInit | null {
  const data = response.data
  if (data === undefined || data === null) return null
  if (responseType === 'blob' && typeof data === 'string') {
    return base64ToBlob(data, readResponseContentType(response) || 'application/octet-stream')
  }
  if (typeof data === 'string') return data
  return JSON.stringify(data)
}

function nativeHttpResponseHeaders(response: HttpResponse): HeadersInit {
  const headers = new Headers()
  for (const [key, value] of Object.entries(response.headers)) {
    headers.set(key, value)
  }
  return headers
}

async function fetchWithNativeBackendHttp(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const inputUrl = typeof input === 'string' || input instanceof URL
    ? input.toString()
    : typeof Request !== 'undefined' && input instanceof Request
      ? input.url
      : ''
  const method = resolveFetchMethod(input, init).toUpperCase()
  const body = method === 'GET' || method === 'HEAD' ? {} : await readNativeFetchBody(input, init)
  const responseType = shouldUseNativeBinaryResponse(inputUrl) ? 'blob' : 'text'
  const response = await CapacitorHttp.request({
    url: resolveBackendHttpUrl(inputUrl),
    method,
    headers: mergeFetchHeaders(input, init, body.contentType, resolveNativeAcceptHeader(inputUrl)),
    ...(body.data === undefined ? {} : { data: body.data }),
    ...(body.dataType === undefined ? {} : { dataType: body.dataType }),
    responseType,
    connectTimeout: 30000,
    readTimeout: 30000,
  })
  return new Response(nativeHttpResponseBody(response, responseType), {
    status: response.status,
    headers: nativeHttpResponseHeaders(response),
  })
}

export function installBackendRequestRouting(): void {
  if (typeof window === 'undefined') return
  const patchState = window as typeof window & { __codexBackendRoutingInstalled?: boolean }
  if (patchState.__codexBackendRoutingInstalled) return
  patchState.__codexBackendRoutingInstalled = true

  const originalFetch = window.fetch.bind(window)
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const inputUrl = typeof input === 'string' || input instanceof URL
      ? input.toString()
      : typeof Request !== 'undefined' && input instanceof Request
        ? input.url
        : ''
    if (shouldUseNativeBackendHttp(inputUrl)) {
      return fetchWithNativeBackendHttp(input, init)
    }
    const routedInit = isConfiguredBackendRoutedUrl(inputUrl)
      ? { ...init, credentials: init?.credentials ?? 'include' }
      : init
    return originalFetch(resolveFetchInput(input), routedInit)
  }) as typeof window.fetch

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    const originalSendBeacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = ((url: string | URL, data?: BodyInit | null) => {
      const routedUrl = typeof url === 'string' ? resolveBackendHttpUrl(url) : new URL(resolveBackendHttpUrl(url.toString()))
      return originalSendBeacon(routedUrl, data)
    }) as typeof navigator.sendBeacon
  }

  if (typeof window.EventSource === 'function') {
    const NativeEventSource = window.EventSource
    window.EventSource = class CodexBackendEventSource extends NativeEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        const rawUrl = String(url)
        const routedInit = isConfiguredBackendRoutedUrl(rawUrl)
          ? { ...eventSourceInitDict, withCredentials: eventSourceInitDict?.withCredentials ?? true }
          : eventSourceInitDict
        super(resolveBackendHttpUrl(rawUrl), routedInit)
      }
    } as typeof window.EventSource
  }

  if (typeof window.WebSocket === 'function') {
    const NativeWebSocket = window.WebSocket
    window.WebSocket = class CodexBackendWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        if (protocols === undefined) {
          super(resolveBackendWebSocketUrl(String(url)))
        } else {
          super(resolveBackendWebSocketUrl(String(url)), protocols)
        }
      }
    } as typeof window.WebSocket
  }
}
