import { describe, expect, it, vi, afterEach } from 'vitest'
import { ref } from 'vue'
import { useBrowserAnnotationListener } from './useBrowserAnnotationListener'

describe('useBrowserAnnotationListener', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a browser binding pairing without requiring a selected thread', async () => {
    const requests: Array<{ input: string; init?: RequestInit }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ input: String(input), init })
      return new Response(JSON.stringify({
        ok: true,
        pairing: {
          pairingId: 'pairing-1',
          serverUrl: 'https://codex-ui.todo-tg-app.ru',
          serverPath: '/codex-api/extension/binding',
          expiresAtIso: '2026-06-16T13:44:00.000Z',
          createdAtIso: '2026-06-16T13:34:00.000Z',
          status: 'active',
          pairingCode: 'browser-binding-code-1',
        },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }))

    const controller = useBrowserAnnotationListener(ref(''), ref(''))

    await controller.start()

    expect(requests).toHaveLength(1)
    expect(requests[0].input).toBe('/codex-api/extension/binding/start')
    expect(controller.isActive.value).toBe(true)
    expect(controller.pairingToken.value).toBe('browser-binding-code-1')
    expect(controller.listenerUrl.value).toBe('https://codex-ui.todo-tg-app.ru')
    expect(controller.targetThreadTitle.value).toBe('Browser binding')
  })
})
