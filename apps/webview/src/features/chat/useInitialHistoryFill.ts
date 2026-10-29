import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { TimelineNode } from '@dsh-vscode/timeline'

/** Fill the first view with real conversation, using the normal bounded history route. */
export function useInitialHistoryFill(props: {
  readonly sessionId: string
  readonly nodes: readonly TimelineNode[]
  readonly beforeSequence: number | undefined
  readonly hasMore: boolean | undefined
  readonly loading: boolean | undefined
  readonly load: (() => void | Promise<void>) | undefined
  readonly viewport: RefObject<HTMLDivElement | null>
  readonly content: RefObject<HTMLDivElement | null>
  readonly reveal: boolean
}): void {
  const [settled, setSettled] = useState(0)
  const progress = useRef({ sessionId: props.sessionId, attempts: 0, busy: false, stopped: false, key: '' })
  const users = useMemo(
    () => props.nodes.filter((node) => node.kind === 'user-message').length,
    [props.nodes],
  )
  const key = `${props.beforeSequence ?? ''}:${props.nodes.length}:${props.nodes[0]?.id ?? ''}`

  useLayoutEffect(() => {
    const current = { sessionId: props.sessionId, attempts: 0, busy: false, stopped: false, key: '' }
    progress.current = current
    const viewport = props.viewport.current
    // Once the reader takes control, only explicit scrolling/clicks load history.
    const stop = (): void => {
      current.stopped = true
    }
    for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown'])
      viewport?.addEventListener(event, stop, { passive: true })
    return () => {
      current.stopped = true
      for (const event of ['wheel', 'pointerdown', 'touchstart', 'keydown'])
        viewport?.removeEventListener(event, stop)
    }
  }, [props.sessionId, props.viewport])

  useLayoutEffect(() => {
    const viewport = props.viewport.current
    const load = props.load
    if (viewport === null || load === undefined || props.hasMore !== true) return
    const current = progress.current
    if (props.reveal) {
      current.stopped = true
      return
    }
    let frame = 0
    const check = (): void => {
      if (current.stopped || current.busy || props.loading === true || current.attempts >= 12) return
      if (document.visibilityState === 'hidden' || viewport.clientHeight <= 0 || props.nodes.length === 0)
        return
      // Two recent user turns are the minimum; short turns also need enough
      // measured content to fill the viewport after tool groups are collapsed.
      if (users >= 2 && viewport.scrollHeight > viewport.clientHeight + 8) return
      if (current.key === key) {
        current.stopped = true
        return
      }
      current.key = key
      current.attempts++
      current.busy = true
      void (async () => {
        try {
          await load()
        } catch {
          current.stopped = true
        } finally {
          current.busy = false
          if (progress.current === current && !current.stopped) setSettled((value) => value + 1)
        }
      })()
    }
    const schedule = (): void => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(check)
    }
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    observer?.observe(viewport)
    if (props.content.current !== null) observer?.observe(props.content.current)
    document.addEventListener('visibilitychange', schedule)
    schedule()
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      document.removeEventListener('visibilitychange', schedule)
    }
  }, [
    props.viewport,
    props.content,
    props.load,
    props.hasMore,
    props.loading,
    props.nodes,
    props.reveal,
    users,
    key,
    settled,
    props.sessionId,
  ])
}
