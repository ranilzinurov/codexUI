self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheKeys = await caches.keys()
      await Promise.all(cacheKeys.map((key) => caches.delete(key)))
      await self.registration.unregister()

      const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
      await Promise.all(
        clients
          .filter((client) => 'navigate' in client)
          .map((client) => client.navigate(client.url)),
      )
    })(),
  )
})
