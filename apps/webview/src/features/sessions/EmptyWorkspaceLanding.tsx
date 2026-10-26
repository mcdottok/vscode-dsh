import { useState, type ReactElement } from 'react'
import type { AppStore } from '../../app/store.js'
import { useI18n } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'
export function EmptyWorkspaceLanding({ store }: { store: AppStore }): ReactElement {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const run = (action: () => Promise<unknown>): void => {
    setBusy(true)
    setFailed(false)
    void action()
      .catch(() => setFailed(true))
      .finally(() => setBusy(false))
  }
  return (
    <section className="dsh-new-chat dsh-empty-workspace">
      <h2>{t('sessions.browser.welcome')}</h2>
      <p>{t('sessions.browser.chooseHint')}</p>
      <div className="dsh-empty-workspace__actions">
        <button
          className="dsh-button dsh-button--primary"
          disabled={busy}
          onClick={() => run(() => store.workspaceBrowser('choose'))}
        >
          <Icon name="folder" />
          {t('sessions.browser.openFolder')}
        </button>
        <button className="dsh-button" disabled={busy} onClick={() => store.setDrawer('sessions')}>
          {t('sessions.browser.browse')}
        </button>
      </div>
      <button
        className="dsh-button dsh-button--ghost"
        disabled={busy}
        onClick={() => run(() => store.startTemporaryChat())}
      >
        {t('sessions.browser.temporary')}
      </button>
      {failed ? <p role="alert">{t('sessions.browser.openFailed')}</p> : null}
    </section>
  )
}
