import { useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { publicProtocolErrorCode } from '../../app/protocol-client.js'
import { useI18n } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'

export function AgentTeamDisableDialog(props: {
  readonly onClose: () => void
  readonly onConfirm: () => Promise<void>
  readonly disabled?: boolean
}): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const savingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<'session-writer-held' | 'save'>()
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    if (dialog === null || dialog.open) return
    dialog.showModal()
    cancelRef.current?.focus()
  }, [])

  const cancel = (): void => {
    if (!savingRef.current) dialogRef.current?.close()
  }

  const confirm = async (): Promise<void> => {
    if (savingRef.current || props.disabled === true) return
    savingRef.current = true
    setSaving(true)
    setError(undefined)
    try {
      await props.onConfirm()
      dialogRef.current?.close()
    } catch (reason) {
      setError(publicProtocolErrorCode(reason) === 'SESSION_WRITER_HELD' ? 'session-writer-held' : 'save')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="dsh-modal-dialog dsh-agent-team-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={props.onClose}
      onCancel={(event) => {
        if (savingRef.current) event.preventDefault()
      }}
    >
      <header className="dsh-modal-dialog__header">
        <Icon name="alert" className="dsh-agent-team-dialog__icon" />
        <h2 id={titleId}>{t('model.agentTeamDisableTitle')}</h2>
        <button
          className="dsh-icon-button"
          type="button"
          aria-label={t('common.close')}
          disabled={saving}
          onClick={cancel}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="dsh-agent-team-dialog__description" id={descriptionId}>
        <p>{t('model.agentTeamDisableDetail')}</p>
        <p>{t('model.agentTeamDisableImpact')}</p>
      </div>
      {error === undefined ? null : (
        <p className="dsh-model-picker__warning" role="alert">
          {t(error === 'session-writer-held' ? 'model.sessionWriterHeld' : 'model.agentTeamSaveFailed')}
        </p>
      )}
      <div className="dsh-agent-team-dialog__actions">
        <button
          ref={cancelRef}
          className="dsh-button dsh-button--secondary"
          type="button"
          disabled={saving}
          onClick={cancel}
        >
          {t('common.cancel')}
        </button>
        <button
          className="dsh-button dsh-button--primary"
          type="button"
          disabled={saving || props.disabled === true}
          onClick={() => void confirm()}
        >
          {t(saving ? 'model.applying' : 'model.agentTeamDisableConfirm')}
        </button>
      </div>
    </dialog>
  )
}
