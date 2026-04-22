import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './style.css'

function reportDiag(tag: string, extra?: unknown) {
  if (typeof window === 'undefined') return
  const ping = (window as typeof window & { __codexDiagPing?: (tag: string, extra?: unknown) => void }).__codexDiagPing
  if (typeof ping === 'function') ping(tag, extra)
}

if (typeof window !== 'undefined') {
  ;(window as typeof window & { __codexMainStarted?: boolean }).__codexMainStarted = true

  const url = new URL(window.location.href)
  if (url.searchParams.has('shell')) {
    url.searchParams.delete('shell')
    window.history.replaceState({}, '', url.toString())
  }
}

console.log('Welcome to codexui. npm: https://www.npmjs.com/package/@nervmor/codexui [diag-cache-bust-20260422-1945]')

reportDiag('main-entry')

createApp(App).use(router).mount('#app')
reportDiag('app-mounted')
requestAnimationFrame(() => reportDiag('raf-after-mount'))
setTimeout(() => reportDiag('timeout-1000ms'), 1000)

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
