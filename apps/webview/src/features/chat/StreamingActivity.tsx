import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { Translate } from '../../i18n.js'
import whaleMotions from './whale-motions.json'

const { stem, poses, clips } = whaleMotions
const restOutline = stem.start + poses.rest + stem.end
const restPath = `path('${restOutline}')`
const posePaths = new Map(
  Object.entries(poses).map(([pose, outline]) => [pose, `path('${stem.start}${outline}${stem.end}')`]),
)
const easing = 'cubic-bezier(0.333333, 0, 0.666667, 1)'
const whaleClips = clips.map(({ duration, keyframes }) => ({
  duration: duration * 1_000,
  frames: [
    { offset: 0, d: restPath, easing },
    ...keyframes.map(({ at, pose }) => ({
      offset: at / duration,
      d: posePaths.get(pose) ?? restPath,
      easing,
    })),
    { offset: 1, d: restPath },
  ],
}))

function WhaleTail(): ReactElement {
  const pathRef = useRef<SVGPathElement>(null)
  useEffect(() => {
    const path = pathRef.current
    if (typeof path?.animate !== 'function' || !window.CSS?.supports('d', restPath)) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animation: Animation | undefined
    let previousIndex = -1

    const playNext = (): void => {
      const count = whaleClips.length
      const index =
        previousIndex === -1
          ? Math.floor(Math.random() * count)
          : (previousIndex + 1 + Math.floor(Math.random() * (count - 1))) % count
      const clip = whaleClips[index]
      if (clip === undefined) return

      previousIndex = index
      const playing = path.animate(clip.frames, clip.duration)
      animation = playing
      playing.onfinish = () => {
        if (animation === playing) playNext()
      }
    }
    const stop = (): void => {
      const playing = animation
      animation = undefined
      playing?.cancel()
    }
    const syncMotion = (): void => {
      stop()
      if (!reducedMotion.matches) playNext()
    }
    reducedMotion.addEventListener('change', syncMotion)
    syncMotion()
    return () => {
      reducedMotion.removeEventListener('change', syncMotion)
      stop()
    }
  }, [])

  return (
    <svg
      className="dsh-activity-whale"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path ref={pathRef} d={restOutline} />
    </svg>
  )
}

/** Use DSH's turn clock; only older hosts without a timestamp use mount time. */
export function StreamingActivity(props: {
  readonly usingTool?: boolean
  readonly startedAt?: number
  readonly translate: Translate
}): ReactElement {
  const [mountedAt] = useState(() => Date.now())
  const startedAt = props.startedAt ?? mountedAt
  const [now, setNow] = useState(() => Date.now())
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000))
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    const tick = (): void => setNow(Date.now())
    const clear = (): void => {
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
    }
    const visibilityChanged = (): void => {
      clear()
      if (document.visibilityState !== 'hidden') {
        tick()
        timer = setInterval(tick, 1_000)
      }
    }
    if (document.visibilityState !== 'hidden') timer = setInterval(tick, 1_000)
    document.addEventListener('visibilitychange', visibilityChanged)
    return () => {
      clear()
      document.removeEventListener('visibilitychange', visibilityChanged)
    }
  }, [startedAt])

  const { translate: t } = props
  const duration =
    seconds >= 3_600
      ? t('duration.hoursMinutes', {
          hours: Math.floor(seconds / 3_600),
          minutes: Math.floor(seconds / 60) % 60,
        })
      : seconds >= 60
        ? t('duration.minutesSeconds', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
        : t('duration.seconds', { seconds })
  return (
    <span className="dsh-timeline__streaming-status" role="status" aria-live="polite">
      <WhaleTail />
      <span className="dsh-timeline__activity-copy">
        <span>
          {t(props.usingTool === true ? 'timeline.activity.usingTool' : 'timeline.activity.responding')}
        </span>
        <span className="dsh-timeline__activity-elapsed" aria-hidden="true">
          {t('timeline.activity.elapsed', { duration })}
        </span>
      </span>
    </span>
  )
}
