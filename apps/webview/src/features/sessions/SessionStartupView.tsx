import { useEffect, useState, type ReactElement } from 'react'
import type { AppStore } from '../../app/store.js'
import type { SessionStartupState } from '../../app/store/types.js'
import { useI18n } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'
import { EmptyWorkspaceLanding } from './EmptyWorkspaceLanding.js'

export function SessionStartupView({
  store,
  startup,
  directoryStatus,
}: {
  readonly store: AppStore
  readonly startup: SessionStartupState | undefined
  readonly directoryStatus: 'loading' | 'ready' | 'error' | undefined
}): ReactElement {
  const { t } = useI18n()
  const stage = startup?.kind ?? (directoryStatus === 'loading' ? 'loading' : 'ready')
  const pending = stage === 'loading' || stage === 'restoring'
  const [expired, setExpired] = useState<SessionStartupState>()
  useEffect(() => {
    if (!pending || startup === undefined) return
    const timer = window.setTimeout(() => setExpired(startup), 30_000)
    return () => window.clearTimeout(timer)
  }, [pending, startup])
  const timedOut = pending && startup !== undefined && expired === startup
  const failed = stage === 'error' || directoryStatus === 'error'
  if (startup?.kind === 'unavailable')
    return (
      <section className="dsh-new-chat dsh-session-startup" aria-busy={false}>
        <div className="dsh-runtime-connection__emblem" aria-hidden="true">
          <Icon name="alert" />
        </div>
        <h2 aria-live="polite">{t(`sessions.unavailable.${startup.reason}`)}</h2>
        <p>{t('sessions.unavailable.hint')}</p>
        <div className="dsh-empty-workspace__actions">
          <button className="dsh-button dsh-button--primary" onClick={() => store.setDrawer('sessions')}>
            {t('sessions.startup.browse')}
          </button>
          {store.getState().workspaces.length > 0 ? (
            <button
              className="dsh-button dsh-button--secondary"
              onClick={() => {
                void store.stageSession().catch(() => store.setDrawer('sessions'))
              }}
            >
              {t('sessions.unavailable.new')}
            </button>
          ) : (
            <button
              className="dsh-button dsh-button--secondary"
              onClick={() => {
                void store.workspaceBrowser('choose').catch(() => store.setDrawer('sessions'))
              }}
            >
              {t('sessions.browser.openFolder')}
            </button>
          )}
        </div>
      </section>
    )
  if (stage === 'ready' && !failed) return <EmptyWorkspaceLanding store={store} />
  const title = failed
    ? 'sessions.startup.failed'
    : timedOut
      ? 'sessions.startup.slow'
      : stage === 'restoring'
        ? 'sessions.startup.restoring'
        : 'app.workspaceLoading'
  return (
    <section className="dsh-new-chat dsh-session-startup" aria-busy={pending && !timedOut && !failed}>
      <div
        className="dsh-runtime-connection__emblem"
        data-loading={pending && !timedOut && !failed}
        aria-hidden="true"
      >
        <Icon name={failed || timedOut ? 'alert' : 'refresh'} />
      </div>
      <h2 aria-live="polite">{t(title)}</h2>
      <p>
        {t(
          failed
            ? 'sessions.startup.failedHint'
            : timedOut
              ? 'sessions.startup.slowHint'
              : stage === 'restoring'
                ? 'sessions.startup.restoreHint'
                : 'sessions.startup.loadingHint',
        )}
      </p>
      {startup?.kind === 'restoring' && startup.title ? (
        <p className="dsh-session-startup__title">{startup.title}</p>
      ) : null}
      <div className="dsh-empty-workspace__actions">
        {failed || timedOut ? (
          <button
            className="dsh-button dsh-button--primary"
            onClick={() => {
              void store.refreshSessions().catch(() => undefined)
            }}
          >
            <Icon name="refresh" />
            {t('runtime.retry')}
          </button>
        ) : null}
        <button className="dsh-button dsh-button--secondary" onClick={() => store.setDrawer('sessions')}>
          {t('sessions.startup.browse')}
        </button>
      </div>
    </section>
  )
}
