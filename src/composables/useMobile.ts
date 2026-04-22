import { onMounted, onUnmounted, ref } from 'vue'
import { subscribeMediaQueryChange } from '../browserCompat'

const MOBILE_BREAKPOINT = 768

export function useMobile() {
  const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false)

  let mql: MediaQueryList | null = null
  let stopMediaQuerySubscription: (() => void) | null = null

  function onChange(e: MediaQueryListEvent) {
    isMobile.value = e.matches
  }

  onMounted(() => {
    mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    isMobile.value = mql.matches
    stopMediaQuerySubscription = subscribeMediaQueryChange(mql, onChange)
  })

  onUnmounted(() => {
    stopMediaQuerySubscription?.()
    stopMediaQuerySubscription = null
  })

  return { isMobile }
}
