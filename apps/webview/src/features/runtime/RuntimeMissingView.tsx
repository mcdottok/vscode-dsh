import { useId, type ReactElement } from 'react'
import type { DiagnosticsSnapshot } from '@dsh-vscode/domain'
import { ContentFlow } from '../../components/common/ContentFlow.js'
import { useI18n } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'
import { DiagnosticsDrawer } from '../diagnostics/DiagnosticsDrawer.js'

export interface RuntimeMissingViewProps {
  readonly searchedLocations: readonly string[]
  readonly busyAction: 'install' | 'select' | undefined
  readonly onAction: (action: 'install' | 'select' | 'copy-command' | 'open-docs') => void
  readonly onOpenConnectionSettings: () => void
  readonly onRetry?: () => void
  readonly onOpenSettings?: () => void
  readonly onReadDiagnostics?: () => Promise<DiagnosticsSnapshot | undefined>
  readonly onReconnectDiagnostics?: () => Promise<void>
  readonly onShowDiagnosticsOutput?: () => Promise<void>
}

export function RuntimeMissingView(props: RuntimeMissingViewProps): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  const searchedLocations = [...new Set(props.searchedLocations.filter((location) => location.trim() !== ''))]
  return (
    <article className="dsh-runtime-missing" aria-labelledby={titleId}>
      <header className="dsh-runtime-missing__title-row">
        <span className="dsh-runtime-missing__icon" aria-hidden="true">
          <Icon name="terminal" />
        </span>
        <h1 id={titleId}>{t('runtime.title')}</h1>
      </header>
      <ContentFlow as="p" className="dsh-runtime-missing__description">
        {t('runtime.description')}
      </ContentFlow>
      <div className="dsh-runtime-missing__actions">
        <button
          className="dsh-button dsh-button--primary"
          type="button"
          disabled={props.busyAction !== undefined}
          onClick={() => props.onAction('install')}
        >
          <Icon name="terminal" />
          {props.busyAction === 'install' ? t('runtime.installing') : t('runtime.install')}
        </button>
        <button
          className="dsh-button dsh-button--secondary"
          type="button"
          onClick={props.onOpenConnectionSettings}
        >
          <Icon name="open-in-editor" />
          {t('runtime.tryDesktop')}
        </button>
      </div>
      <ContentFlow as="p" className="dsh-runtime-missing__description">
        {t('runtime.installHint')}
      </ContentFlow>
      <footer className="dsh-runtime-missing__utilities">
        {props.onRetry === undefined ? null : (
          <button className="dsh-button dsh-button--ghost" type="button" onClick={props.onRetry}>
            <Icon name="refresh" />
            {t('runtime.recheck')}
          </button>
        )}
        <button
          className="dsh-button dsh-button--ghost"
          type="button"
          disabled={props.busyAction !== undefined}
          onClick={() => props.onAction('select')}
        >
          {props.busyAction === 'select' ? t('runtime.selecting') : t('runtime.select')}
        </button>
      </footer>
      <details>
        <summary>{t('runtime.moreOptions')}</summary>
        <div className="dsh-runtime-missing__utilities">
          <button
            className="dsh-button dsh-button--ghost"
            type="button"
            disabled={props.busyAction !== undefined}
            onClick={() => props.onAction('copy-command')}
          >
            {t('runtime.copy')}
          </button>
          {props.onOpenSettings === undefined ? null : (
            <button className="dsh-button dsh-button--ghost" type="button" onClick={props.onOpenSettings}>
              {t('runtime.openSettings')}
            </button>
          )}
          {props.onReadDiagnostics === undefined ||
          props.onReconnectDiagnostics === undefined ||
          props.onShowDiagnosticsOutput === undefined ? null : (
            <DiagnosticsDrawer
              onRead={props.onReadDiagnostics}
              onReconnect={props.onReconnectDiagnostics}
              onShowOutput={props.onShowDiagnosticsOutput}
            />
          )}
          <button
            className="dsh-button dsh-button--ghost"
            type="button"
            disabled={props.busyAction !== undefined}
            onClick={() => props.onAction('open-docs')}
          >
            {t('runtime.docs')}
          </button>
        </div>
        {searchedLocations.length > 0 && (
          <details>
            <summary>{t('runtime.searched', { count: searchedLocations.length })}</summary>
            <ul>
              {searchedLocations.map((location) => (
                <li key={location}>
                  <code>{location}</code>
                </li>
              ))}
            </ul>
          </details>
        )}
      </details>
    </article>
  )
}
