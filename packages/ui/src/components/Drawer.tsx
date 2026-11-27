import { useCallback, useEffect, useReducer, useRef, type PropsWithChildren, type ReactElement } from 'react'
import { useDismissibleLayer } from '../useDismissibleLayer.js'

export interface DrawerProps extends PropsWithChildren {
  readonly title: string
  readonly open: boolean
  readonly side?: 'left' | 'right'
  readonly onClose: () => void
}

// A fallback for environments without the Web Animations inspection API.
const CLOSE_FALLBACK_MS = 360

type DrawerPhase = 'closed' | 'open' | 'closing'

type DrawerAction = { readonly type: 'sync'; readonly open: boolean } | { readonly type: 'finish' }

export function Drawer(props: DrawerProps): ReactElement | null {
  const { open, onClose } = props
  const [phase, dispatch] = useReducer(drawerReducer, open ? 'open' : 'closed')
  // The prop determines visibility immediately. The phase only keeps an
  // already-mounted surface alive for its exit animation.
  const mounted = open || phase !== 'closed'
  const closing = !open && phase !== 'closed'
  const dialogRef = useRef<HTMLElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const fallbackTimerRef = useRef<number | undefined>(undefined)

  const finishClose = useCallback((): void => {
    if (fallbackTimerRef.current !== undefined) {
      window.clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = undefined
    }
    dispatch({ type: 'finish' })
  }, [])

  useEffect(() => {
    dispatch({ type: 'sync', open })
  }, [open])

  useEffect(() => {
    if (!closing) return
    const animations = dialogRef.current?.getAnimations?.()
    if (animations !== undefined) {
      if (animations.length === 0) {
        finishClose()
        return
      }
      let observing = true
      // Animation.finished tracks a running CSS exit even if its timing
      // changes. Cancellation also completes the non-interactive exit.
      void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
        if (observing) finishClose()
      })
      return () => {
        observing = false
      }
    }
    fallbackTimerRef.current = window.setTimeout(finishClose, CLOSE_FALLBACK_MS)
    return () => {
      if (fallbackTimerRef.current !== undefined) window.clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = undefined
    }
  }, [closing, finishClose])

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialogRef.current?.focus()
    return () => {
      previousFocus.current?.focus()
    }
  }, [open])

  useDismissibleLayer({ open, refs: [dialogRef], trapFocus: true, onDismiss: onClose })

  if (!mounted) return null
  return (
    <div
      className="dsh-drawer__backdrop"
      data-state={closing ? 'closing' : 'open'}
      role="presentation"
      onMouseDown={(event) => {
        if (closing) return
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <section
        ref={dialogRef}
        className={`dsh-drawer dsh-drawer--${props.side ?? 'right'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dsh-drawer-title"
        aria-hidden={closing || undefined}
        inert={closing || undefined}
        tabIndex={-1}
        onAnimationEnd={(event) => {
          if (closing && event.target === dialogRef.current) finishClose()
        }}
      >
        <header className="dsh-drawer__header">
          <h2 id="dsh-drawer-title">{props.title}</h2>
          <button type="button" aria-label="Close" onClick={props.onClose}>
            ×
          </button>
        </header>
        <div className="dsh-drawer__body">{props.children}</div>
      </section>
    </div>
  )
}

function drawerReducer(phase: DrawerPhase, action: DrawerAction): DrawerPhase {
  if (action.type === 'finish') return phase === 'closing' ? 'closed' : phase
  if (action.open) return 'open'
  return phase === 'closed' ? 'closed' : 'closing'
}
