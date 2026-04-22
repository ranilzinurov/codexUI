import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

console.log('Welcome to codexui. npm: https://www.npmjs.com/package/@nervmor/codexui')

createApp(App).use(router).mount('#app')

if (import.meta.env.PROD) {
  void cleanupHostedServiceWorkers()
}

async function cleanupHostedServiceWorkers() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.allSettled(registrations.map((registration) => registration.unregister()))
  } catch (error) {
    console.warn('Service worker cleanup failed.', error)
  }

  if (!('caches' in window)) {
    return
  }

  try {
    const cacheKeys = await caches.keys()
    await Promise.allSettled(
      cacheKeys
        .filter((key) => key.startsWith('codexweb-shell-'))
        .map((key) => caches.delete(key)),
    )
  } catch (error) {
    console.warn('Cache cleanup failed.', error)
  }
}
