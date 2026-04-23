self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
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
