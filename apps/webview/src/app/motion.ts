import { useSyncExternalStore } from 'react'

const RELAXED_DURATION_SCALE = 1.35
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
let systemMotion: MediaQueryList | undefined

function systemPreference(): MediaQueryList | undefined {
  return systemMotion ?? (typeof window === 'undefined' ? undefined : window.matchMedia?.(REDUCED_MOTION))
}

/** Give CSS and JavaScript the same motion timing before the Webview paints. */
export function initializeMotion(): void {
  systemMotion = systemPreference()
  document.documentElement.style.setProperty('--dsh-motion-duration-factor', String(RELAXED_DURATION_SCALE))
}

export function motionScale(): number {
  return systemPreference()?.matches === true ? 0 : RELAXED_DURATION_SCALE
}

export function subscribeToMotion(listener: () => void): () => void {
  const media = systemPreference()
  media?.addEventListener?.('change', listener)
  return () => media?.removeEventListener?.('change', listener)
}

export function useMotionScale(): number {
  return useSyncExternalStore(subscribeToMotion, motionScale, () => RELAXED_DURATION_SCALE)
}
