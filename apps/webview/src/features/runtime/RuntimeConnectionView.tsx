import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ConnectionLogEntry, ExtensionSettingsSummary } from '@dsh-vscode/domain'
import type { WebviewBackendState } from '../../app/store.js'
import { useI18n } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'

export interface RuntimeConnectionViewProps {
  readonly state: WebviewBackendState
  readonly output?: readonly ConnectionLogEntry[]
  readonly loadingSessionCatalog?: boolean
  readonly initializing?: boolean
  readonly draftPending?: boolean
  readonly onRetry?: () => void
  readonly onOpenSettings?: () => void
  readonly onShowDiagnosticsOutput?: () => Promise<void>
  readonly onConnectDesktop?: () => Promise<void>
  readonly onReadSettings?: () => Promise<ExtensionSettingsSummary | undefined>
}

export function RuntimeConnectionView(props: RuntimeConnectionViewProps): ReactElement {
  const { t } = useI18n()
  const { onReadSettings } = props
  const [loadedSettings, setLoadedSettings] = useState<{
    readonly reader: typeof onReadSettings
    readonly value: ExtensionSettingsSummary | undefined
  }>()
  const settings = loadedSettings?.reader === onReadSettings ? loadedSettings?.value : undefined
  useEffect(() => {
    let current = true
    void onReadSettings?.()
      .then((value) => {
        if (current) setLoadedSettings({ reader: onReadSettings, value })
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [onReadSettings])
  const catalogLoading = props.loadingSessionCatalog === true && props.state.kind === 'connected'
  const idle = props.state.kind === 'idle'
  const initializing = idle && props.initializing === true
  const terminalFailure = ['failed', 'port-conflict', 'runtime-missing'].includes(props.state.kind)
  const pending =
    initializing || catalogLoading || (!terminalFailure && !idle && props.state.kind !== 'connected')
  const [attempt, setAttempt] = useState(0)
  const phase =
    props.state.kind === 'connecting' || props.state.kind === 'discovering' ? props.state.phase : undefined
  const step = useMemo(
    () => (pending ? { kind: props.state.kind, phase, catalogLoading, attempt } : undefined),
    [pending, props.state.kind, phase, catalogLoading, attempt],
  )
  const [expiredStep, setExpiredStep] = useState<typeof step>()
  useEffect(() => {
    if (step === undefined) return
    const timer = window.setTimeout(() => setExpiredStep(step), 30_000)
    return () => window.clearTimeout(timer)
  }, [step])
  const timedOut = step !== undefined && step === expiredStep
  const failure = terminalFailure || timedOut
  const latestAttempt =
    props.output?.findLastIndex((entry) => entry.phase === 'connect' && entry.status === 'started') ?? -1
  const attemptOutput = latestAttempt < 0 ? [] : (props.output?.slice(latestAttempt) ?? [])
  const mode = idle
    ? (settings?.connection.mode ?? attemptOutput[0]?.mode)
    : (attemptOutput[0]?.mode ?? settings?.connection.mode)
  const local = mode === 'new-isolated'
  const desktop =
    mode === 'custom' ||
    mode === 'attach-only' ||
    (mode === 'auto' && settings?.connection.mode === 'auto' && settings.runtime.autoStart === false)
  const helpKey = local
    ? 'runtime.posture.localHelp'
    : desktop
      ? 'runtime.posture.desktopHelp'
      : 'runtime.posture.help'
  const hintKey = local
    ? 'runtime.posture.localHint'
    : desktop
      ? 'runtime.posture.desktopSelectedHint'
      : 'runtime.posture.desktopHint'
  const savedAddressFailure =
    props.state.kind === 'failed' &&
    attemptOutput[0]?.mode === 'custom' &&
    attemptOutput.some(
      (entry) =>
        entry.phase === 'connect' && entry.status === 'failed' && entry.code === 'BACKEND_UNREACHABLE',
    )
  const updateAddress = savedAddressFailure && props.onConnectDesktop !== undefined
  const title = savedAddressFailure
    ? t('runtime.posture.savedAddressTitle')
    : failure
      ? t(
          timedOut
            ? 'runtime.posture.timeoutTitle'
            : props.draftPending
              ? 'runtime.posture.draftDisconnected'
              : 'runtime.connectionProgress.failureTitle',
        )
      : initializing
        ? t('runtime.posture.preparingTitle')
        : idle && (local || desktop)
          ? t(local ? 'runtime.posture.localIdleTitle' : 'runtime.posture.desktopIdleTitle')
          : connectionTitle(props.state, catalogLoading, t)
  const loading = pending && !timedOut
  const retryable =
    timedOut ||
    (idle && !initializing) ||
    ((props.state.kind === 'failed' || props.state.kind === 'port-conflict') && props.state.retryable)
  const message = savedAddressFailure
    ? t('runtime.posture.savedAddressError')
    : timedOut
      ? t('runtime.posture.timeoutHelp')
      : props.state.kind === 'failed' || props.state.kind === 'port-conflict'
        ? props.state.message
        : undefined
  const [outputFailed, setOutputFailed] = useState(false)
  const [desktopBusy, setDesktopBusy] = useState(false)
  const [desktopFailed, setDesktopFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const pane = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useLayoutEffect(() => {
    if (follow.current && pane.current !== null) pane.current.scrollTop = pane.current.scrollHeight
  }, [props.output, expanded])
  return (
    <section
      className="dsh-runtime-connection dsh-runtime-connection--refined"
      aria-labelledby="runtime-connection-title"
      aria-busy={loading}
    >
      <div className="dsh-runtime-connection__header">
        <span
          className="dsh-runtime-connection__emblem"
          data-loading={loading}
          role={loading ? 'progressbar' : undefined}
          aria-label={loading ? title : undefined}
          aria-hidden={loading ? undefined : true}
        >
          <Icon name={loading ? 'refresh' : 'open-in-editor'} />
        </span>
        <h2 id="runtime-connection-title" aria-live="polite">
          {title}
        </h2>
        <p className="dsh-runtime-connection__subtitle">
          {savedAddressFailure
            ? t('runtime.posture.savedAddressHelp')
            : initializing && !failure
              ? t('runtime.posture.preparingHelp')
              : t(
                  failure || idle
                    ? props.draftPending
                      ? 'runtime.posture.draftHelp'
                      : helpKey
                    : 'runtime.posture.wait',
                )}
        </p>
      </div>
      <div className="dsh-runtime-connection__actions">
        {(props.onConnectDesktop === undefined && props.onOpenSettings === undefined) ||
        (props.state.kind === 'connected' && !timedOut) ? null : (
          <button
            className="dsh-button dsh-button--primary"
            type="button"
            disabled={desktopBusy}
            onClick={() => {
              if (!updateAddress && props.onOpenSettings !== undefined) {
                props.onOpenSettings()
                return
              }
              setDesktopBusy(true)
              setDesktopFailed(false)
              void props
                .onConnectDesktop?.()
                .catch(() => setDesktopFailed(true))
                .finally(() => setDesktopBusy(false))
            }}
          >
            <Icon name="open-in-editor" />
            {t(
              updateAddress
                ? 'runtime.updateConnectionAddress'
                : props.onOpenSettings === undefined
                  ? 'runtime.connectDesktop'
                  : 'runtime.chooseConnection',
            )}
          </button>
        )}
        {!updateAddress || props.onOpenSettings === undefined ? null : (
          <button
            className="dsh-button dsh-button--secondary"
            type="button"
            disabled={desktopBusy}
            onClick={props.onOpenSettings}
          >
            {t('runtime.chooseConnection')}
          </button>
        )}
        {!retryable || props.onRetry === undefined ? null : (
          <button
            className="dsh-button dsh-button--secondary"
            type="button"
            disabled={desktopBusy}
            onClick={() => {
              setAttempt((value) => value + 1)
              props.onRetry?.()
            }}
          >
            <Icon name="refresh" />
            {t('runtime.retry')}
          </button>
        )}
      </div>
      {props.onConnectDesktop === undefined || props.state.kind === 'connected' ? null : (
        <p className="dsh-runtime-connection__hint">{t(hintKey)}</p>
      )}
      {!desktopFailed ? null : (
        <p className="dsh-runtime-connection__error" role="alert">
          {t('runtime.desktopFailed')}
        </p>
      )}
      {message === undefined ? null : (
        <p className="dsh-runtime-connection__error" role="alert">
          {message}
        </p>
      )}
      <div className="dsh-runtime-connection__diagnostics">
        <button
          className="dsh-runtime-connection__details-trigger"
          type="button"
          aria-expanded={expanded}
          aria-controls="runtime-connection-output"
          onClick={() => setExpanded((value) => !value)}
        >
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} />
          {t('runtime.posture.diagnostics')}
        </button>
        {expanded ? (
          <div id="runtime-connection-output" className="dsh-runtime-connection__details">
            <div
              className="dsh-runtime-connection__output"
              data-expanded="true"
              role="log"
              aria-label={t('runtime.connectionLog.title')}
              aria-live="off"
              tabIndex={0}
              ref={pane}
              onScroll={(event) => {
                const element = event.currentTarget
                follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
              }}
            >
              {props.output?.length ? (
                props.output.map((entry) => (
                  <p className="dsh-runtime-connection__line" key={entry.id} data-status={entry.status}>
                    <time dateTime={entry.time}>{new Date(entry.time).toTimeString().slice(0, 8)}</time>{' '}
                    <span>{connectionLine(entry, t)}</span>
                  </p>
                ))
              ) : (
                <p>{title}</p>
              )}
            </div>
            {props.onShowDiagnosticsOutput === undefined ? null : (
              <button
                className="dsh-button dsh-button--ghost"
                type="button"
                onClick={() => {
                  void props.onShowDiagnosticsOutput?.().catch(() => setOutputFailed(true))
                }}
              >
                <Icon name="terminal" />
                {t('runtime.connectionLog.openOutput')}
              </button>
            )}
            {!outputFailed ? null : (
              <p className="dsh-runtime-connection__error" role="alert">
                {t('runtime.connectionLog.outputFailed')}
              </p>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}

function connectionLine(
  entry: ConnectionLogEntry,
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string,
): string {
  const phase = t(`runtime.connectionLog.phase.${entry.phase}`)
  const facts = [t(`runtime.connectionLog.status.${entry.status}`, { phase })]
  if (entry.mode !== undefined) facts.push(entry.mode)
  if (entry.attempt !== undefined) facts.push(t('runtime.connectionLog.attempt', { count: entry.attempt }))
  if (entry.count !== undefined) facts.push(t('runtime.connectionLog.count', { count: entry.count }))
  if (entry.candidateSource !== undefined)
    facts.push(t(`runtime.connectionLog.source.${entry.candidateSource}`))
  if (entry.hostVersion !== undefined) facts.push('DSH ' + entry.hostVersion)
  if (entry.ownership !== undefined) facts.push(t(`runtime.connectionLog.ownership.${entry.ownership}`))
  if (entry.code !== undefined) facts.push(entry.code)
  return facts.join(' · ')
}

function connectionTitle(
  state: WebviewBackendState,
  catalogLoading: boolean,
  t: (key: string) => string,
): string {
  if (catalogLoading) return t('runtime.connectionProgress.sessionsTitle')
  if ((state.kind === 'discovering' || state.kind === 'connecting') && state.phase !== undefined)
    return t(`runtime.connectionProgress.phase.${state.phase}.title`)
  switch (state.kind) {
    case 'idle':
      return t('runtime.connectionProgress.idleTitle')
    case 'discovering':
      return t('runtime.connectionProgress.discoveringTitle')
    case 'locating-runtime':
      return t('runtime.connectionProgress.locatingTitle')
    case 'starting':
      return t('runtime.connectionProgress.startingTitle')
    case 'connecting':
      return t('runtime.connectionProgress.connectingTitle')
    case 'stopping':
      return t('runtime.connectionProgress.stoppingTitle')
    case 'failed':
    case 'port-conflict':
      return t('runtime.connectionProgress.failureTitle')
    case 'runtime-missing':
      return t('runtime.title')
    case 'connected':
      return t('runtime.connectionProgress.readyTitle')
  }
}
