import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { PopoverCard } from '../../components/common/PopoverCard.js'
import { useViewportMenuPosition } from '../../components/common/useViewportMenuPosition.js'
import { useDismissibleLayer } from '../../components/common/useDismissibleLayer.js'
import { useI18n } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'
import type { AppNotice } from './AppNotices.js'

/** System notifications stay in page chrome, outside the transcript layout. */
export function ToolbarNotices({ notices }: { readonly notices: readonly AppNotice[] }): ReactElement | null {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  useEffect(() => { if (notices.length === 0) setOpen(false) }, [notices.length])
  const position = useViewportMenuPosition({
    open: open && notices.length > 0, anchorRef: triggerRef, menuRef: panelRef,
    placement: 'below', align: 'end',
  })
  useDismissibleLayer({ open: open && notices.length > 0, refs: [rootRef, panelRef], onDismiss: close,
    onEscape: () => { close(); triggerRef.current?.focus() },
  })
  if (notices.length === 0) return null
  const primary = notices.find((notice) => notice.tone === 'danger') ?? notices[0]!
  const label = t('app.showNotices', { count: notices.length })
  return (
    <div ref={rootRef} className={`dsh-toolbar-notices dsh-toolbar-notices--${primary.tone}`}>
      <span className="dsh-sr-only" role="status" aria-atomic="true">{primary.title}</span>
      <button ref={triggerRef} type="button" className="dsh-icon-button dsh-toolbar-notices__trigger"
        aria-label={label} title={`${label}: ${primary.title}`} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((value) => !value)}>
        <Icon name="bell" /><span className="dsh-toolbar-notices__count" aria-hidden="true">{notices.length > 99 ? '99+' : notices.length}</span>
      </button>
      {open ? (
        <PopoverCard ref={panelRef} style={position} className="dsh-toolbar-notices__panel"
          role="dialog" aria-label={t('app.notices')}>
          <header><strong>{t('app.notices')}</strong>
            <button className="dsh-icon-button" type="button" aria-label={t('runtime.closeDetails')} onClick={close}><Icon name="close" /></button>
          </header>
          <div className="dsh-toolbar-notices__list">
            {notices.map((notice) => (
              <article key={notice.id} className={`dsh-toolbar-notices__item dsh-toolbar-notices--${notice.tone}`}>
                <Icon name={notice.tone === 'info' ? 'status' : 'alert'} />
                <div><strong>{notice.title}</strong>{notice.message === undefined ? null : <p>{notice.message}</p>}
                  {notice.action === undefined ? null : <button type="button" className="dsh-button dsh-button--secondary dsh-button--compact" onClick={notice.action.run}>{notice.action.label}</button>}
                </div>
                <button type="button" className="dsh-icon-button" aria-label={notice.dismissLabel}
                  onClick={() => { triggerRef.current?.focus(); notice.onDismiss() }}><Icon name="close" /></button>
              </article>
            ))}
          </div>
        </PopoverCard>
      ) : null}
    </div>
  )
}
