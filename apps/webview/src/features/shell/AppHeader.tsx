import { memo, type ReactElement, type ReactNode } from 'react'
import type { WebviewBackendState } from '../../app/store.js'
import { useI18n } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'
import { ToolbarNotices } from './ToolbarNotices.js'
import type { AppNotice } from './AppNotices.js'
import { RuntimeStatus } from '../runtime/RuntimeStatus.js'

export interface AppHeaderProps {
  readonly notices?: readonly AppNotice[]
  readonly title?: string | undefined
  readonly onRetryConnection: () => void
  readonly runtime: WebviewBackendState
  readonly connectedDshVersion?: string | undefined
  readonly compatibilityWarning?: string | undefined
  readonly sessionControl: ReactNode
  readonly onNewSession: () => void
  readonly onOpenSettings: () => void
}

/** Frequent chat controls stay here; secondary actions live in Settings. */
export const AppHeader = memo(function AppHeader(props: AppHeaderProps): ReactElement {
  const { t } = useI18n()
  return (
    <header className="dsh-app-toolbar" role="toolbar" aria-label={t('app.toolbar')}>
      <span className="dsh-app-toolbar__title" title={props.title || 'DSH'}>
        {props.title || 'DSH'}
      </span>
      <div className="dsh-app-toolbar__actions">
        <RuntimeStatus
          state={props.runtime}
          connectedDshVersion={props.connectedDshVersion}
          compatibilityWarning={props.compatibilityWarning}
          onRetry={props.onRetryConnection}
        />
        <ToolbarNotices notices={props.notices ?? []} />
        {props.runtime.kind === 'connected' ? (
          <>
            <div className="dsh-app-toolbar__history">{props.sessionControl}</div>
            <button
              className="dsh-icon-button"
              type="button"
              aria-label={t('sessions.new')}
              title={t('sessions.new')}
              onClick={props.onNewSession}
            >
              <Icon name="new-chat" />
            </button>
          </>
        ) : null}
        <span className="dsh-app-toolbar__divider" aria-hidden="true" />
        <button
          className="dsh-icon-button"
          type="button"
          aria-label={t('settings.title')}
          title={t('settings.title')}
          onClick={props.onOpenSettings}
        >
          <Icon name="settings" />
        </button>
      </div>
    </header>
  )
})
