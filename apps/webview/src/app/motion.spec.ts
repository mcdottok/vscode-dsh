// @vitest-environment jsdom

import { expect, it, vi } from 'vitest'
import { initializeMotion, motionScale, subscribeToMotion } from './motion.js'

it('uses the fixed relaxed timing for CSS and JavaScript and follows system reduced motion', () => {
  const media = Object.assign(new EventTarget(), { matches: false })
  vi.stubGlobal('matchMedia', () => media)
  window.localStorage.setItem('dsh-webview-motion', '{"preset":"quick","durations":{"scroll":0}}')
  initializeMotion()
  const listener = vi.fn()
  const unsubscribe = subscribeToMotion(listener)
  const style = document.documentElement.style
  try {
    expect(motionScale()).toBe(1.35)
    expect(style.getPropertyValue('--dsh-motion-duration-factor')).toBe('1.35')
    media.matches = true
    media.dispatchEvent(new Event('change'))
    expect(motionScale()).toBe(0)
    expect(listener).toHaveBeenCalledOnce()
  } finally {
    unsubscribe()
    style.removeProperty('--dsh-motion-duration-factor')
    window.localStorage.removeItem('dsh-webview-motion')
    vi.unstubAllGlobals()
  }
})
