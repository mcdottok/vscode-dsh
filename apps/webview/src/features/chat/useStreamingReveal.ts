import { useLayoutEffect, useRef, useState } from 'react'
import { useMotionScale } from '../../app/motion.js'

const DEFAULT_FRAME_MS = 1000 / 60
const MAX_REVEAL_MS = 36
const MAX_PENDING_LENGTH = 256
const FRAME_SAMPLE_COUNT = 12
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

interface RevealPlayback {
  enabled: boolean
  text: string
  target: string
  arrivedAt: number | undefined
  deadline: number | undefined
  readonly frameIntervals: number[]
}

export function useStreamingReveal(markdown: string, enabled: boolean): string {
  const motion = useMotionScale()
  const [revealed, setRevealed] = useState(markdown)
  const playback = useRef<RevealPlayback>({
    enabled: false,
    text: markdown,
    target: markdown,
    arrivedAt: undefined,
    deadline: undefined,
    frameIntervals: [],
  })

  useLayoutEffect(() => {
    const state = playback.current
    const previousTarget = state.target
    state.target = markdown
    let frame: number | undefined

    const finish = (): void => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      frame = undefined
      state.deadline = undefined
      state.text = markdown
      setRevealed(markdown)
    }
    const canAnimate = (): boolean => document.visibilityState !== 'hidden' && motion > 0

    if (!enabled || motion === 0 || typeof window.requestAnimationFrame !== 'function') {
      // The caller already renders the complete batch. Updating reveal state
      // here would add a React render to every rich-text packet.
      state.enabled = false
      state.deadline = undefined
      state.arrivedAt = undefined
      state.frameIntervals.length = 0
      state.text = markdown
      return
    }

    if (!state.enabled || !canAnimate()) {
      state.enabled = true
      finish()
      return
    }

    const now = window.performance.now()
    const arrivalGap = state.arrivedAt === undefined ? MAX_REVEAL_MS : now - state.arrivedAt
    if (markdown !== previousTarget) state.arrivedAt = now
    const append = markdown.startsWith(previousTarget) && markdown.startsWith(state.text)
    if (!append || state.text === '' || markdown.length - state.text.length > MAX_PENDING_LENGTH) {
      finish()
      return
    }

    const baseLength = state.text.length
    const ends = Array.from(
      graphemes.segment(markdown.slice(baseLength)),
      ({ index, segment }) => baseLength + index + segment.length,
    )
    if (ends.length === 0) return

    // Keep an existing deadline when several packets arrive during the same reveal.
    // The next frame catches up if the renderer was busy or the window was throttled.
    const duration = Math.min(72, Math.min(MAX_REVEAL_MS, Math.max(12, arrivalGap)) * motion)
    const deadline = (state.deadline ??= now + duration)
    let shown = 0
    let revealSteps = 0
    let previousFrame: number | undefined
    let frameMs = DEFAULT_FRAME_MS
    const tick = (timestamp: number): void => {
      frame = undefined
      if (!canAnimate()) {
        finish()
        return
      }
      let lastGap = 0
      if (previousFrame !== undefined) {
        lastGap = timestamp - previousFrame
        if (lastGap > 0) {
          state.frameIntervals.push(lastGap)
          if (state.frameIntervals.length > FRAME_SAMPLE_COUNT) state.frameIntervals.shift()
        }
      }
      previousFrame = timestamp

      if (state.frameIntervals.length > 0) {
        const ordered = [...state.frameIntervals].sort((a, b) => a - b)
        // A few missed callbacks should not turn a high-refresh screen into a 60 Hz estimate.
        frameMs = ordered[Math.floor(ordered.length / 4)] ?? DEFAULT_FRAME_MS
      }

      if (shown < ends.length) {
        let framesLeft = Math.max(1, Math.ceil((deadline - timestamp) / Math.max(frameMs, lastGap)))
        const missedFrames = state.frameIntervals.filter((gap) => gap >= frameMs * 1.5).length
        if (state.frameIntervals.length >= 4 && missedFrames * 4 >= state.frameIntervals.length) {
          // Favor larger text batches when DOM work is already missing refreshes.
          framesLeft = Math.min(framesLeft, Math.max(1, 2 - revealSteps))
        }
        revealSteps++
        shown += Math.ceil((ends.length - shown) / framesLeft)
        const end = ends[shown - 1] ?? markdown.length
        state.text = markdown.slice(0, end)
        setRevealed(state.text)
      }
      if (shown < ends.length) frame = window.requestAnimationFrame(tick)
      else state.deadline = undefined
    }
    const onMotionChange = (): void => {
      if (!canAnimate()) finish()
    }
    document.addEventListener('visibilitychange', onMotionChange)
    frame = window.requestAnimationFrame(tick)
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      document.removeEventListener('visibilitychange', onMotionChange)
    }
  }, [enabled, markdown, motion])

  return enabled &&
    motion > 0 &&
    typeof globalThis.requestAnimationFrame === 'function' &&
    revealed !== '' &&
    markdown.startsWith(revealed)
    ? revealed
    : markdown
}
