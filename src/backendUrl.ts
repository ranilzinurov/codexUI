const BACKEND_URL_STORAGE_KEY = 'codex-web-local.backend-url.v1'
const BACKEND_URL_CHANGED_EVENT = 'codex-backend-url-changed'

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
  return safeReadStorage(BACKEND_URL_STORAGE_KEY) || readEnvBackendUrl()
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
