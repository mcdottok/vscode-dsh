import { useId, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react'
import type { Translate } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'

export type ProviderAddMode = 'catalog' | 'custom'

interface ProviderAddCardProps {
  readonly t: Translate
  readonly mode: ProviderAddMode | undefined
  readonly catalog: ReactNode
  readonly custom: ReactNode
  readonly disabled: boolean
  readonly canOpen: boolean
  readonly onModeChange: (mode: ProviderAddMode) => void
}

const providerAddModes = ['catalog', 'custom'] as const
const swipeDistance = 40
const wheelGestureGapMs = 180

export function ProviderAddCard(props: ProviderAddCardProps): ReactElement | null {
  const { t, mode, catalog, custom, disabled, canOpen, onModeChange } = props
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const tabsRef = useRef<HTMLDivElement>(null)
  const wasExpanded = useRef(false)
  const swipe = useRef<{ id: number; x: number; y: number } | undefined>(undefined)
  const wheelGesture = useRef<{ timestamp: number; distance: number; handled: boolean } | undefined>(
    undefined,
  )
  const suppressClick = useRef(false)
  const available = { catalog: catalog !== null, custom: custom !== null }
  const activeMode = mode === undefined || available[mode] ? mode : available.catalog ? 'catalog' : 'custom'
  const expanded = activeMode !== undefined

  const selectMode = (next: ProviderAddMode): void => {
    if (disabled || next === activeMode || !available[next]) return
    onModeChange(next)
    tabsRef.current?.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus({ preventScroll: true })
  }

  useLayoutEffect(() => {
    if (expanded && !wasExpanded.current) {
      tabsRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
    } else if (!expanded && wasExpanded.current && document.activeElement === document.body) {
      triggerRef.current?.focus({ preventScroll: true })
    }
    wasExpanded.current = expanded
  }, [expanded])

  if (catalog === null && custom === null) return null

  if (activeMode === undefined) {
    return (
      <button
        ref={triggerRef}
        className="dsh-settings__provider-add"
        type="button"
        aria-expanded={false}
        disabled={disabled || !canOpen}
        onClick={() => {
          suppressClick.current = false
          wheelGesture.current = undefined
          onModeChange(catalog === null ? 'custom' : 'catalog')
        }}
      >
        <Icon name="add" />
        {t('settings.addProvider')}
      </button>
    )
  }

  return (
    <div
      className="dsh-settings__provider-add-card"
      onPointerDown={(event) => {
        if (disabled || !event.isPrimary || event.button !== 0) return
        suppressClick.current = false
        swipe.current = undefined
        const target = event.target
        if (!(target instanceof Element)) return
        if (
          !tabsRef.current?.contains(target) &&
          (event.pointerType === 'mouse' ||
            target.closest('input, textarea, select, label, button, a, summary, [role="listbox"]') !== null)
        )
          return
        swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      }}
      onPointerUp={(event) => {
        const start = swipe.current
        if (start?.id !== event.pointerId) return
        swipe.current = undefined
        if (disabled) return
        const x = event.clientX - start.x
        const y = event.clientY - start.y
        if (Math.abs(x) < swipeDistance || Math.abs(x) <= Math.abs(y) * 1.5) return
        suppressClick.current = true
        selectMode(x < 0 ? 'custom' : 'catalog')
      }}
      onPointerCancel={() => {
        swipe.current = undefined
      }}
      onPointerLeave={() => {
        swipe.current = undefined
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current || event.detail === 0) return
        suppressClick.current = false
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <div
        ref={tabsRef}
        className="dsh-settings__provider-add-tabs"
        role="tablist"
        aria-label={t('settings.addProvider')}
        data-active-mode={activeMode}
        onKeyDown={(event) => {
          if (disabled || catalog === null || custom === null) return
          const { key } = event
          if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return
          event.preventDefault()
          const next =
            key === 'Home' ? 'catalog' : key === 'End' || activeMode === 'catalog' ? 'custom' : 'catalog'
          selectMode(next)
        }}
        onWheel={(event) => {
          if (disabled || event.ctrlKey || Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) return
          const previous = wheelGesture.current
          const now = event.timeStamp
          const continuing = previous !== undefined && now - previous.timestamp < wheelGestureGapMs
          const distance = (continuing ? previous.distance : 0) + event.deltaX
          const handled = continuing && previous.handled
          const crossed = Math.abs(distance) >= swipeDistance
          wheelGesture.current = { timestamp: now, distance, handled: handled || crossed }
          if (!handled && crossed) selectMode(distance > 0 ? 'custom' : 'catalog')
        }}
      >
        {providerAddModes.map((option) => (
          <button
            key={option}
            id={`${id}-${option}`}
            className="dsh-settings__provider-add-tab"
            data-mode={option}
            type="button"
            role="tab"
            aria-selected={option === activeMode}
            tabIndex={option === activeMode ? 0 : -1}
            disabled={!available[option]}
            aria-disabled={disabled || undefined}
            onClick={() => selectMode(option)}
          >
            {t(option === 'catalog' ? 'settings.addProvider' : 'settings.addCustomProvider')}
          </button>
        ))}
      </div>
      {providerAddModes.map((option) => (
        <div key={option} role="tabpanel" aria-labelledby={`${id}-${option}`} hidden={option !== activeMode}>
          {option === 'catalog' ? catalog : custom}
        </div>
      ))}
    </div>
  )
}
