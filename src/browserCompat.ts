type MediaQueryChangeListener = (event: MediaQueryListEvent) => void

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function safeLocalStorageGetItem(key: string): string | null {
  const storage = getLocalStorage()
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

export function safeLocalStorageSetItem(key: string, value: string): boolean {
  const storage = getLocalStorage()
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function safeLocalStorageRemoveItem(key: string): boolean {
  const storage = getLocalStorage()
  if (!storage) return false
  try {
    storage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export function safeSessionStorageGetItem(key: string): string | null {
  const storage = getSessionStorage()
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

export function safeSessionStorageSetItem(key: string, value: string): boolean {
  const storage = getSessionStorage()
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: MediaQueryChangeListener) => void
  removeListener?: (listener: MediaQueryChangeListener) => void
}

export function subscribeMediaQueryChange(
  mediaQueryList: MediaQueryList,
  listener: MediaQueryChangeListener,
): () => void {
  if (typeof mediaQueryList.addEventListener === 'function') {
    mediaQueryList.addEventListener('change', listener)
    return () => mediaQueryList.removeEventListener('change', listener)
  }

  const legacyMediaQueryList = mediaQueryList as LegacyMediaQueryList
  if (typeof legacyMediaQueryList.addListener === 'function') {
    legacyMediaQueryList.addListener(listener)
    return () => legacyMediaQueryList.removeListener?.(listener)
  }

  return () => {}
}
