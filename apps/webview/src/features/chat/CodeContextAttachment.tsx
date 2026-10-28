import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { MessageAttachment } from '@dsh-vscode/domain'
import type { Translate } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'

/** Prefer the editor; a missing source can still show the captured code inline. */
export function CodeContextAttachment({
  attachment,
  onOpenLink,
  translate: t,
}: {
  readonly attachment: MessageAttachment
  readonly onOpenLink: (href: string, onFailure?: () => void) => void
  readonly translate: Translate
}): ReactElement {
  const [fallback, setFallback] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const previewRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (fallback) previewRef.current?.querySelector('summary')?.focus()
  }, [fallback])
  const label = attachment.name.replace(/:(\d+)-(\d+)$/u, '#$1–$2')
  if (fallback)
    return (
      <details
        ref={previewRef}
        className="dsh-message-context"
        open={expanded}
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary title={attachment.name}>
          <Icon name="code" />
          <span>{label}</span>
          <Icon name="chevron-down" />
        </summary>
        <pre tabIndex={0}>{attachment.previewText}</pre>
        {attachment.previewTruncated === true ? <p>{t('timeline.attachmentPreviewTruncated')}</p> : null}
      </details>
    )
  return (
    <button
      className="dsh-code-context"
      type="button"
      title={t('timeline.revealCodeSelection', { name: attachment.name })}
      onClick={() => {
        if (attachment.sourceLink === undefined) return
        onOpenLink(
          attachment.sourceLink,
          attachment.previewText === undefined
            ? undefined
            : () => {
                setFallback(true)
                setExpanded(true)
              },
        )
      }}
    >
      <Icon name="code" />
      <span>{label}</span>
      <Icon name="chevron-right" />
    </button>
  )
}
