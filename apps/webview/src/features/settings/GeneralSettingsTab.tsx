import type { Dispatch, ReactElement, SetStateAction } from 'react'
import type { ExtensionSettingsSummary } from '@dsh-vscode/domain'
import { SettingCard, SettingRow } from '../../components/common/SettingCard.js'
import { Icon } from '../../ui/Icon.js'
import { THEME_PREFERENCE_OPTIONS } from '../../app/ui-preferences.js'
import { formatSettingValue } from './settings-values.js'
import { AccountLifecycle } from '../account/AccountLifecycle.js'
import { AccountProfile } from '../account/AccountProfile.js'
import { accountLifecycleLabels, accountProfileLabels } from './account-labels.js'
import {
  GeneralSettingRow,
  hasPreferencesContent,
  renderFontSizeControl,
  visibleGeneralRows,
  type DshSettingsState,
  type RiskPending,
} from './general-controls.js'
import type { SettingsDrawerProps } from './settings-drawer-props.js'
import type { Translate, Locale } from '../../i18n.js'

const LOCALE_OPTIONS: readonly Locale[] = ['en', 'zh']

function isRiskValue(value: string): boolean {
  return value === 'danger-full-access'
}

export interface GeneralSettingsTabProps {
  readonly props: SettingsDrawerProps
  readonly t: Translate
  readonly settingsState: { readonly value: ExtensionSettingsSummary | undefined } | undefined
  readonly refreshAccountDetails: () => void
  readonly acknowledgeAccountBonus: (orderId: string) => Promise<boolean>
  readonly openAccountUsage: () => void
  readonly openAccountTopUp: () => void
  readonly connectionChoice: 'auto' | 'custom' | 'unchanged'
  readonly setConnectionChoice: Dispatch<SetStateAction<'auto' | 'custom' | 'unchanged'>>
  readonly connectionEndpoint: string
  readonly setConnectionEndpoint: Dispatch<SetStateAction<string>>
  readonly connectionBusy: boolean
  readonly connectionError: string | undefined
  readonly setConnectionError: Dispatch<SetStateAction<string | undefined>>
  readonly connectionNotice: string | undefined
  readonly setConnectionNotice: Dispatch<SetStateAction<string | undefined>>
  readonly applyConnection: () => void
  readonly dshUpdateBusy: 'check' | 'install' | undefined
  readonly checkDshUpdates: () => void
  readonly installDshVersion: () => void
  readonly dshUpdateError: string | undefined
  readonly availableDshVersions: readonly string[]
  readonly effectiveSelectedDshVersion: string | undefined
  readonly selectedDshVersionAlreadyInstalled: boolean
  readonly setSelectedDshVersion: Dispatch<SetStateAction<string | undefined>>
  readonly dshState: DshSettingsState
  readonly dshSettingsSnapshotFresh: boolean
  readonly retryDshSettings: () => void
  readonly savingPath: string | undefined
  readonly riskPending: RiskPending | undefined
  readonly setRiskPending: Dispatch<SetStateAction<RiskPending | undefined>>
  readonly riskAcknowledged: boolean
  readonly setRiskAcknowledged: Dispatch<SetStateAction<boolean>>
  readonly saveSetting: (path: string, value: unknown) => void
  readonly saveError: string | undefined
  readonly busyField: string | undefined
  readonly openSettingsDocument: () => void
  readonly documentError: string | undefined
  readonly openKeyboardShortcuts: () => void
  readonly keyboardShortcutsError: string | undefined
}

export function GeneralSettingsTab(input: GeneralSettingsTabProps): ReactElement {
  const {
    props,
    t,

    refreshAccountDetails,
    acknowledgeAccountBonus,
    openAccountUsage,
    openAccountTopUp,

    dshState,
    dshSettingsSnapshotFresh,
    retryDshSettings,
    savingPath,
    riskPending,
    setRiskPending,
    riskAcknowledged,
    setRiskAcknowledged,
    saveSetting,
    saveError,
    busyField,
    openSettingsDocument,
    documentError,
    openKeyboardShortcuts,
    keyboardShortcutsError,
  } = input
  return (
    <div
      className="dsh-settings__body"
      id="dsh-settings-panel-general"
      role="tabpanel"
      aria-labelledby="dsh-settings-tab-general"
      aria-label={t('settings.generalAria')}
    >
      {props.accountLifecycleAvailable === true ? (
        <>
          <AccountLifecycle
            snapshot={props.accountLifecycleLoading === true ? null : (props.accountLifecycle ?? null)}
            {...(props.accountLifecycleImpact === undefined ? {} : { impact: props.accountLifecycleImpact })}
            sessionExpired={props.accountSessionExpired === true}
            {...(props.accountLifecycleError === undefined ? {} : { hostError: props.accountLifecycleError })}
            requestFailed={props.accountLifecycleRequestFailed === true}
            busy={props.accountLifecycleBusy === true || props.accountLifecycleLoading === true}
            labels={accountLifecycleLabels(t)}
            onSignIn={() => void props.onStartAccountSignIn?.()}
            onCancelSignIn={(attemptId) => void props.onCancelAccountSignIn?.(attemptId)}
            onCheckSignOutImpact={() => void props.onCheckAccountSignOutImpact?.()}
            onSignOut={() => void props.onSignOutAccount?.()}
            onRetry={() => void props.onLoadAccountLifecycle?.()}
          />
          <AccountProfile
            snapshot={props.accountProfileDetails ?? null}
            signedIn={props.accountLifecycle?.status === 'credential-stored'}
            busy={props.accountProfileLoading === true}
            requestFailed={props.accountProfileRequestFailed === true}
            labels={accountProfileLabels(t)}
            locale={props.locale}
            onRefresh={refreshAccountDetails}
            onAcknowledgeBonus={acknowledgeAccountBonus}
            onOpenUsage={openAccountUsage}
            onOpenTopUp={openAccountTopUp}
          />
        </>
      ) : null}
      <SettingCard ariaLabel={t('settings.extensionPreferences')}>
        <SettingRow
          title={t('settings.language.label')}
          description={t('settings.language.hint')}
          control={
            <div className="dsh-settings__segment" role="group" aria-label={t('settings.language.label')}>
              {LOCALE_OPTIONS.map((option) => (
                <button
                  key={option}
                  className={`dsh-settings__segment-item${
                    option === props.locale ? ' dsh-settings__segment-item--active' : ''
                  }`}
                  type="button"
                  aria-pressed={option === props.locale}
                  onClick={() => {
                    if (option !== props.locale) props.onLocaleChange(option)
                  }}
                >
                  {option === 'zh' ? t('locale.chinese') : t('locale.english')}
                </button>
              ))}
            </div>
          }
        />
      </SettingCard>
      <SettingCard ariaLabel={t('settings.appearance.label')}>
        <SettingRow
          title={t('settings.appearance.label')}
          description={t('settings.appearance.hint')}
          control={
            <div className="dsh-settings__segment" role="group" aria-label={t('settings.appearance.label')}>
              {THEME_PREFERENCE_OPTIONS.map((option) => (
                <button
                  key={option}
                  className={`dsh-settings__segment-item${option === props.theme ? ' dsh-settings__segment-item--active' : ''}`}
                  type="button"
                  aria-pressed={option === props.theme}
                  onClick={() => {
                    if (option !== props.theme) props.onThemeChange(option)
                  }}
                >
                  {formatSettingValue(option, t)}
                </button>
              ))}
            </div>
          }
        />
      </SettingCard>
      <SettingCard ariaLabel={t('settings.preferences')} title={t('settings.preferences')}>
        {dshState.status === 'loading' ? (
          <p className="dsh-settings__empty" role="status">
            {t('settings.loadingDsh')}
          </p>
        ) : dshState.status === 'unavailable' ? (
          <>
            <p className="dsh-settings__empty">{t('settings.dshUnavailable')}</p>
            <button
              className="dsh-button dsh-button--secondary dsh-button--compact"
              type="button"
              onClick={retryDshSettings}
            >
              {t('runtime.retry')}
            </button>
          </>
        ) : !hasPreferencesContent(dshState.snapshot) ? (
          // A schema that advertises none of these rows must not read as
          // a broken card: state what the host offers instead of an
          // empty titled box.
          <p className="dsh-settings__empty">{t('settings.preferencesEmpty')}</p>
        ) : (
          <>
            {!dshState.snapshot.schema.writable ? (
              <p className="dsh-settings__empty" role="status">
                {t('settings.readOnly')}
              </p>
            ) : null}
            {!dshSettingsSnapshotFresh ? (
              <div className="dsh-settings__empty" role="status">
                <p>{t('settings.revisionRefreshRequired')}</p>
                <button
                  className="dsh-button dsh-button--secondary dsh-button--compact"
                  type="button"
                  onClick={retryDshSettings}
                >
                  {t('runtime.retry')}
                </button>
              </div>
            ) : null}
            <ul className="dsh-settings__rows">
              {visibleGeneralRows(dshState.snapshot).map((row) => (
                <GeneralSettingRow
                  key={row.path}
                  row={{
                    path: row.path,
                    label: t(row.labelKey),
                    hint: t(row.hintKey),
                    ...(row.defaultValue === undefined ? {} : { defaultValue: row.defaultValue }),
                  }}
                  fields={dshState.snapshot.schema.fields}
                  values={dshState.snapshot.values}
                  writable={dshState.snapshot.schema.writable}
                  saving={savingPath === row.path}
                  disabled={
                    !dshState.snapshot.schema.writable ||
                    savingPath !== undefined ||
                    !dshSettingsSnapshotFresh
                  }
                  riskPending={riskPending?.path === row.path ? riskPending : undefined}
                  riskAcknowledged={riskAcknowledged}
                  onPick={(value) => {
                    if (isRiskValue(value)) {
                      setRiskAcknowledged(false)
                      setRiskPending({ path: row.path, value })
                      return
                    }
                    saveSetting(row.path, value)
                  }}
                  onConfirmRisk={() => {
                    if (riskPending === undefined || !riskAcknowledged) return
                    saveSetting(riskPending.path, riskPending.value)
                  }}
                  onRiskAcknowledgedChange={setRiskAcknowledged}
                  onCancelRisk={() => {
                    setRiskAcknowledged(false)
                    setRiskPending(undefined)
                  }}
                />
              ))}
            </ul>
            {saveError === undefined ? null : (
              <p className="dsh-settings__error" role="alert">
                {saveError}
              </p>
            )}
          </>
        )}
      </SettingCard>
      <SettingCard
        ariaLabel={t('settings.conversationAppearance')}
        title={t('settings.conversationAppearance')}
      >
        <SettingRow
          title={t('settings.conversationFontSize')}
          description={t('settings.conversationFontSizeHint')}
          control={renderFontSizeControl(props.conversationFontSize, props.onConversationFontSizeChange, t)}
        />
      </SettingCard>
      <SettingCard ariaLabel={t('settings.keyboardShortcuts')}>
        <SettingRow
          title={t('settings.keyboardShortcuts')}
          description={t('settings.keyboardShortcutsHint')}
          control={
            <button
              className="dsh-button dsh-button--secondary dsh-button--compact"
              type="button"
              onClick={openKeyboardShortcuts}
            >
              {t('settings.keyboardShortcutsOpen')}
            </button>
          }
          footer={
            keyboardShortcutsError === undefined ? undefined : (
              <span className="dsh-settings__error" role="alert">
                {keyboardShortcutsError}
              </span>
            )
          }
        />
      </SettingCard>
      {dshState.status === 'ready' && dshState.snapshot.schema.hasDocument ? (
        <div className="dsh-settings__document-action">
          <p className="dsh-settings__note">{t('settings.documentDescription')}</p>
          <button
            className="dsh-button dsh-button--secondary dsh-button--compact"
            type="button"
            disabled={busyField !== undefined}
            onClick={openSettingsDocument}
          >
            <Icon name="file" />
            {t('settings.openDocument')}
          </button>
          {documentError === undefined ? null : (
            <span className="dsh-settings__error" role="alert">
              {documentError}
            </span>
          )}
        </div>
      ) : null}
    </div>
  )
}
