import { afterEach, describe, expect, it } from 'vitest'
import { getBackendUrlStorageKey, resolveBackendHttpUrl } from './backendUrl'

function installWindowWithBackendUrl(backendUrl: string): void {
  const store = new Map<string, string>([[getBackendUrlStorageKey(), backendUrl]])
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: { href: 'capacitor://localhost/' },
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value)
        },
        removeItem: (key: string) => {
          store.delete(key)
        },
      },
      dispatchEvent: () => true,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  })
}

describe('backend URL routing', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  })

  it('routes remote auth login requests to the configured backend', () => {
    installWindowWithBackendUrl('https://codex-ui.todo-tg-app.ru')

    expect(resolveBackendHttpUrl('/auth/login')).toBe('https://codex-ui.todo-tg-app.ru/auth/login')
  })

  it('does not route unrelated app-shell paths', () => {
    installWindowWithBackendUrl('https://codex-ui.todo-tg-app.ru')

    expect(resolveBackendHttpUrl('/assets/index.js')).toBe('/assets/index.js')
  })
})
