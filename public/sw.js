const CACHE_NAME = 'codexweb-shell-v2'
const APP_SHELL_PATHS = ['/', '/manifest.webmanifest']
const STATIC_DESTINATIONS = new Set(['document', 'script', 'style', 'image', 'font'])
const BYPASS_PREFIXES = ['/codex-api/', '/codex-local-image', '/codex-local-file', '/codex-local-browse/', '/codex-local-edit/']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME)
    await cache.addAll(APP_SHELL_PATHS)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (BYPASS_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request))
    return
  }

  if (request.destination === 'script' || request.destination === 'style') {
    event.respondWith(networkFirstStatic(request))
    return
  }

  if (STATIC_DESTINATIONS.has(request.destination) || url.pathname === '/manifest.webmanifest') {
    event.respondWith(staleWhileRevalidate(request))
  }
})

self.addEventListener('push', (event) => {
  const payload = (() => {
    if (!event.data) {
      return {
        title: 'Codex notification',
        body: 'A task finished.',
        data: { url: '/#/' },
      }
    }

    try {
      return event.data.json()
    } catch {
      return {
        title: 'Codex notification',
        body: event.data.text(),
        data: { url: '/#/' },
      }
    }
  })()

  event.waitUntil(self.registration.showNotification(payload.title || 'Codex notification', {
    body: payload.body || 'A task finished.',
    icon: payload.icon || '/icons/pwa-192x192.png',
    badge: payload.badge || '/icons/pwa-192x192.png',
    tag: payload.tag || undefined,
    renotify: payload.renotify === true,
    data: payload.data || { url: '/#/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  event.waitUntil((async () => {
    const targetUrl = new URL(event.notification.data?.url || '/#/', self.location.origin).toString()
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

    for (const client of windowClients) {
      if (!('focus' in client)) continue
      if ('navigate' in client && client.url !== targetUrl) {
        await client.navigate(targetUrl)
      }
      await client.focus()
      return
    }

    if ('openWindow' in self.clients) {
      await self.clients.openWindow(targetUrl)
    }
  })())
})

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put('/', response.clone())
    }
    return response
  } catch {
    return (await cache.match('/')) || Response.error()
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME)
  const cached = await cache.match(request)
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => null)

  if (cached) {
    return cached
  }

  const response = await networkPromise
  return response || Response.error()
}

async function networkFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME)
  try {
    const response = await fetch(request)
    if (response.ok) {
      cache.put(request, response.clone())
      return response
    }
    return (await cache.match(request)) || response
  } catch {
    return (await cache.match(request)) || Response.error()
  }
}
