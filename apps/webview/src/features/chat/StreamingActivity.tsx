import { useEffect, useState, type ReactElement } from 'react'
import type { Translate } from '../../i18n.js'

/** Decorative tail; the shared motion policy freezes it for Reduced Motion. */
function WhaleTail(): ReactElement {
  return (
    <svg className="dsh-activity-whale" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <g
        className="dsh-activity-whale__body"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          className="dsh-activity-whale__outline"
          d="M6.5 22C7.1 18.1 8.4 15.9 9.1 13.2C9.6 10.8 5.2 8.9 5 5C4.8 3.4 5.1 2.1 5.5 1.5C7.4 3.5 11.5 3.2 12.7 7.2C16.2 6.5 19.6 9.5 22 9.8C19.8 13 17 14 13.3 13.6C10.7 13.2 11.8 18 11.9 22"
        />
      </g>
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
