import type { ReactElement } from 'react'
import { SettingCard } from '../../components/common/SettingCard.js'
import { SelectMenu } from '../../components/common/SelectMenu.js'
import {
  DSH_UPDATE_PROGRESS_TOTAL_STAGES,
  connectionModeLabel,
  dshUpdateFailureMessage,
  dshUpdateProgressLabel,
  dshUpdateProgressStage,
} from './update-labels.js'

import type { GeneralSettingsTabProps } from './GeneralSettingsTab.js'

export function ConnectionSettingsTab(input: GeneralSettingsTabProps): ReactElement {
  const {
    props,
    t,
    settingsState,
    connectionChoice,
    setConnectionChoice,
    connectionEndpoint,
    setConnectionEndpoint,
    connectionBusy,
    connectionError,
    setConnectionError,
    connectionNotice,
    setConnectionNotice,
    applyConnection,
    dshUpdateBusy,
    checkDshUpdates,
    installDshVersion,
    dshUpdateError,
    availableDshVersions,
    effectiveSelectedDshVersion,
    selectedDshVersionAlreadyInstalled,
    setSelectedDshVersion,
  } = input
  const { onCheckDshUpdates, onInstallDshVersion, dshUpdate, dshUpdateProgress } = props
  return (
    <div
      className="dsh-settings__body"
      id="dsh-settings-panel-connection"
      role="tabpanel"
      aria-labelledby="dsh-settings-tab-connection"
      aria-label={t('settings.connectionAria')}
    >
      {settingsState === undefined ? (
        <p className="dsh-settings__empty" role="status">
          {t('settings.loading')}
        </p>
      ) : settingsState.value === undefined ? (
        <p className="dsh-settings__empty" role="status">
          {t('settings.unavailable')}
        </p>
      ) : (
        (() => {
          const settings = settingsState.value
          return (
            <>
              <details className="dsh-settings__environment">
                <summary>{t('settings.environmentDetails')}</summary>
                <dl className="dsh-settings__facts">
                  <dt>{t('settings.extensionVersion')}</dt>
                  <dd>{settings.extensionVersion}</dd>
                  <dt>{t('settings.connectionMode')}</dt>
                  <dd>{connectionModeLabel(settings.connection.mode, t)}</dd>
                  <dt>{t('settings.runtime')}</dt>
                  <dd>
                    {t(
                      settings.runtime.customExecutableConfigured
                        ? 'settings.runtimeCustom'
                        : 'settings.runtimeDiscovered',
                    )}
                  </dd>
                  <dt>{t('settings.dshVersion')}</dt>
                  <dd>
                    {props.connectedDshVersion ??
                      t(props.connected ? 'settings.versionUnavailable' : 'settings.notConnected')}
                  </dd>
                  <dt>{t('settings.permissionPreset')}</dt>
                  <dd>{settings.security.defaultPermissionPreset}</dd>
                  <dt>{t('settings.defaultAgent')}</dt>
                  <dd>
                    {[settings.defaultAgent.model.providerId, settings.defaultAgent.model.modelId]
                      .filter(Boolean)
                      .join('/') || t('settings.automatic')}
                  </dd>
                </dl>
              </details>
              <SettingCard
                ariaLabel={t('settings.connectionTitle')}
                title={t('settings.connectionTitle')}
                description={t('settings.connectionHint')}
              >
                <div
                  className="dsh-settings__connection-options"
                  role="radiogroup"
                  aria-label={t('settings.connectionMode')}
                >
                  <label
                    className={`dsh-settings__connection-option${
                      connectionChoice === 'custom' ? ' dsh-settings__connection-option--active' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="dsh-connection-mode"
                      value="custom"
                      checked={connectionChoice === 'custom'}
                      onChange={() => {
                        setConnectionChoice('custom')
                        setConnectionError(undefined)
                        setConnectionNotice(undefined)
                      }}
                    />
                    <span>
                      <strong>{t('settings.connectionDesktop')}</strong>
                      <small>{t('settings.connectionCustomHint')}</small>
                    </span>
                  </label>
                  <label
                    className={`dsh-settings__connection-option${
                      connectionChoice === 'auto' ? ' dsh-settings__connection-option--active' : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="dsh-connection-mode"
                      value="auto"
                      checked={connectionChoice === 'auto'}
                      onChange={() => {
                        setConnectionChoice('auto')
                        setConnectionEndpoint('')
                        setConnectionError(undefined)
                        setConnectionNotice(undefined)
                      }}
                    />
                    <span>
                      <strong>{t('settings.connectionLocal')}</strong>
                      <small>{t('settings.connectionAutoHint')}</small>
                    </span>
                  </label>
                </div>
                {connectionChoice === 'custom' ? (
                  <label className="dsh-settings__connection-endpoint">
                    <span>{t('settings.connectionEndpoint')}</span>
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={8192}
                      disabled={connectionBusy}
                      value={connectionEndpoint}
                      placeholder={
                        settings.connection.desktopEndpointConfigured ||
                        settings.connection.customEndpointConfigured
                          ? t('settings.connectionEndpointConfigured')
                          : t('settings.connectionEndpointPlaceholder')
                      }
                      onChange={(event) => {
                        setConnectionEndpoint(event.target.value)
                        setConnectionError(undefined)
                        setConnectionNotice(undefined)
                      }}
                    />
                  </label>
                ) : null}
                {connectionChoice === 'custom' ? (
                  <p className="dsh-settings__connection-notice">{t('settings.connectionDesktopHelp')}</p>
                ) : null}
                {connectionChoice === 'unchanged' ? (
                  <p className="dsh-settings__connection-notice">{t('settings.connectionUnchangedHint')}</p>
                ) : null}
                <div className="dsh-settings__connection-actions">
                  <button
                    className="dsh-button dsh-button--primary dsh-button--compact"
                    type="button"
                    disabled={connectionBusy || connectionChoice === 'unchanged'}
                    onClick={applyConnection}
                  >
                    {connectionBusy
                      ? t('settings.connectionApplying')
                      : t(
                          connectionChoice === 'custom'
                            ? 'settings.connectionDesktopApply'
                            : 'settings.connectionLocalApply',
                        )}
                  </button>
                </div>
                {connectionError === undefined ? null : (
                  <p className="dsh-settings__error" role="alert">
                    {connectionError}
                  </p>
                )}
                {connectionNotice === undefined ? null : (
                  <p className="dsh-settings__connection-notice" role="status">
                    {connectionNotice}
                  </p>
                )}
              </SettingCard>
            </>
          )
        })()
      )}
      {connectionChoice === 'auto' && onCheckDshUpdates !== undefined && onInstallDshVersion !== undefined ? (
        <section className="dsh-settings__runtime-update" aria-label={t('settings.dshUpdateTitle')}>
          <div className="dsh-settings__runtime-update-head">
            <div>
              <h3>{t('settings.dshUpdateTitle')}</h3>
              <p className="dsh-settings__note">{t('settings.connectionLocalInstallHint')}</p>
            </div>
            <button
              className="dsh-button dsh-button--secondary dsh-button--compact dsh-settings__runtime-update-check"
              type="button"
              disabled={dshUpdateBusy !== undefined}
              onClick={checkDshUpdates}
            >
              {dshUpdateBusy === 'check' ? t('settings.dshUpdateChecking') : t('settings.dshUpdateCheck')}
            </button>
          </div>
          {dshUpdate === undefined ? (
            <p className="dsh-settings__empty" role="status">
              {t('settings.dshUpdateLoading')}
            </p>
          ) : dshUpdate.status === 'unavailable' ? (
            <p className="dsh-settings__error" role="alert">
              {dshUpdateFailureMessage(dshUpdate.failure, t)}
            </p>
          ) : (
            <>
              {dshUpdateBusy !== undefined ? (
                <div className="dsh-settings__runtime-update-progress" role="status" aria-live="polite">
                  <div className="dsh-settings__runtime-update-progress-head">
                    <span>{dshUpdateProgressLabel(dshUpdateBusy, dshUpdateProgress, t)}</span>
                    <span>
                      {t('settings.dshUpdateProgressStage', {
                        current: dshUpdateProgressStage(dshUpdateBusy, dshUpdateProgress),
                        total: DSH_UPDATE_PROGRESS_TOTAL_STAGES,
                      })}
                    </span>
                  </div>
                  <div
                    className="dsh-settings__runtime-update-progress-track"
                    role="progressbar"
                    aria-label={t('settings.dshUpdateProgressLabel')}
                    aria-valuemin={0}
                    aria-valuemax={DSH_UPDATE_PROGRESS_TOTAL_STAGES}
                    aria-valuenow={dshUpdateProgressStage(dshUpdateBusy, dshUpdateProgress)}
                    aria-valuetext={dshUpdateProgressLabel(dshUpdateBusy, dshUpdateProgress, t)}
                  >
                    {Array.from({ length: DSH_UPDATE_PROGRESS_TOTAL_STAGES }, (_, index) => {
                      const stage = index + 1
                      const current = dshUpdateProgressStage(dshUpdateBusy, dshUpdateProgress)
                      return (
                        <span
                          className={`dsh-settings__runtime-update-progress-step${
                            stage < current ? ' dsh-settings__runtime-update-progress-step--complete' : ''
                          }${stage === current ? ' dsh-settings__runtime-update-progress-step--active' : ''}`}
                          key={stage}
                        />
                      )
                    })}
                  </div>
                </div>
              ) : null}
              <dl className="dsh-settings__runtime-update-facts">
                {dshUpdate.currentVersion !== dshUpdate.globalVersion ? (
                  <>
                    <dt>{t('settings.dshUpdateCurrent')}</dt>
                    <dd>{dshUpdate.currentVersion ?? t('settings.dshUpdateNotInstalled')}</dd>
                  </>
                ) : null}
                <dt>{t('settings.dshUpdateGlobal')}</dt>
                <dd>{dshUpdate.globalVersion ?? t('settings.dshUpdateNotInstalled')}</dd>
                <dt>{t('settings.dshUpdateLatest')}</dt>
                <dd>{dshUpdate.latestVersion ?? t('settings.dshUpdateUnavailable')}</dd>
              </dl>
              {dshUpdate.updateAvailable ? (
                <p className="dsh-settings__runtime-update-notice" role="status">
                  {t('settings.dshUpdateAvailable', {
                    version: dshUpdate.latestVersion ?? '—',
                  })}
                </p>
              ) : null}
              {selectedDshVersionAlreadyInstalled && effectiveSelectedDshVersion !== undefined ? (
                <p className="dsh-settings__runtime-update-notice" role="status">
                  {t('settings.dshUpdateAlreadyInstalled', {
                    version: effectiveSelectedDshVersion,
                  })}
                </p>
              ) : null}
              <div className="dsh-settings__runtime-update-controls">
                <span>{t('settings.dshUpdateVersion')}</span>
                <SelectMenu
                  className="dsh-settings__runtime-update-version"
                  icon="refresh"
                  density="regular"
                  displayLabel
                  label={effectiveSelectedDshVersion ?? t('settings.dshUpdateUnavailable')}
                  ariaLabel={t('settings.dshUpdateVersion')}
                  title={t('settings.dshUpdateVersion')}
                  value={effectiveSelectedDshVersion ?? ''}
                  disabled={dshUpdateBusy !== undefined}
                  options={availableDshVersions.map((version) => ({
                    value: version,
                    label: version,
                  }))}
                  placement="below"
                  onChange={setSelectedDshVersion}
                />
                <button
                  className="dsh-button dsh-button--primary dsh-button--compact"
                  type="button"
                  disabled={
                    dshUpdateBusy !== undefined ||
                    effectiveSelectedDshVersion === undefined ||
                    selectedDshVersionAlreadyInstalled ||
                    availableDshVersions.length === 0
                  }
                  onClick={installDshVersion}
                >
                  {selectedDshVersionAlreadyInstalled
                    ? t('settings.dshUpdateInstalled')
                    : dshUpdateBusy === 'install'
                      ? t('settings.dshUpdateInstalling')
                      : t('settings.dshUpdateInstall')}
                </button>
              </div>
              {dshUpdate.restartRequired ? (
                <p className="dsh-settings__note">{t('settings.dshUpdateRestart')}</p>
              ) : null}
              {dshUpdateError === undefined ? null : (
                <p className="dsh-settings__error" role="alert">
                  {dshUpdateError}
                </p>
              )}
            </>
          )}
        </section>
      ) : null}
    </div>
  )
}
