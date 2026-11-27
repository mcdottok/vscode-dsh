import type { Dispatch, ReactElement, RefObject, SetStateAction } from 'react'
import type {
  CustomProviderCreateResult,
  CustomProviderDraft,
  ModelDescriptor,
  ModelProvider,
} from '@dsh-vscode/domain'
import type { Translate } from '../../i18n.js'
import { Icon } from '../../ui/Icon.js'
import { SelectMenu } from '../../components/common/SelectMenu.js'
import { CustomProviderCard, type CustomProviderTemplate } from './CustomProviderCard.js'
import { ProviderAddCard, type ProviderAddMode } from './ProviderAddCard.js'
import { ProviderSettingsEditor, type ProviderSettingChange } from './ProviderSettingsEditor.js'
import { modelReasoningLevels } from './provider-helpers.js'
import type { SettingsDrawerProps } from './settings-drawer-props.js'
import type { DshSettingsState } from './general-controls.js'

interface ModelsSettingsTabProps {
  readonly props: SettingsDrawerProps
  readonly t: Translate
  readonly orderedProviderRows: readonly ModelProvider[]
  readonly modelsByProvider: ReadonlyMap<string, readonly ModelDescriptor[]>
  readonly busyField: string | undefined
  readonly setBusyField: Dispatch<SetStateAction<string | undefined>>
  readonly saveError: string | undefined
  readonly setSaveError: Dispatch<SetStateAction<string | undefined>>
  readonly dshState: DshSettingsState
  readonly dshSettingsSnapshotFresh: boolean
  readonly editingProviderId: string | undefined
  readonly setEditingProviderId: Dispatch<SetStateAction<string | undefined>>
  readonly setAddingProviderId: Dispatch<SetStateAction<string | undefined>>
  readonly setAddingProviderMode: (mode: ProviderAddMode) => void
  readonly closeProviderAddition: () => void
  readonly setRemovingProviderId: Dispatch<SetStateAction<string | undefined>>
  readonly removeProviderTriggerRef: RefObject<HTMLElement | null>
  readonly removeDialogRef: RefObject<HTMLDivElement | null>
  readonly runSecretAction: (key: string, action: () => Promise<void>) => void
  readonly saveProviderChanges: (
    provider: ModelProvider,
    changes: readonly ProviderSettingChange[],
    expectedRevision: number,
    ensureProvider?: boolean,
  ) => Promise<void>
  readonly addableProviders: readonly ModelProvider[]
  readonly addingProvider: ModelProvider | undefined
  readonly addingProviderMode: ProviderAddMode | undefined
  readonly customProviderTemplate: CustomProviderTemplate | undefined
  readonly saveCustomProvider: (
    draft: CustomProviderDraft,
    draftId?: string,
    apiKey?: string,
  ) => Promise<CustomProviderCreateResult>
  readonly pendingProvider: ModelProvider | undefined
  readonly removeProvider: (provider: ModelProvider) => Promise<void>
}

export function ModelsSettingsTab(input: ModelsSettingsTabProps): ReactElement {
  const {
    props,
    t,
    orderedProviderRows,
    modelsByProvider,
    busyField,
    setBusyField,
    saveError,
    setSaveError,
    dshState,
    dshSettingsSnapshotFresh,
    editingProviderId,
    setEditingProviderId,
    setAddingProviderId,
    setAddingProviderMode,
    closeProviderAddition,
    setRemovingProviderId,
    removeProviderTriggerRef,
    removeDialogRef,
    runSecretAction,
    saveProviderChanges,
    addableProviders,
    addingProvider,
    addingProviderMode,
    customProviderTemplate,
    saveCustomProvider,
    pendingProvider,
    removeProvider,
  } = input

  /** The host-described model reasoning levels for one namespace, when any. */
  const reasoningLevelsFor = (namespace: string | undefined): readonly string[] | undefined =>
    dshState.status === 'ready' ? modelReasoningLevels(dshState.snapshot, namespace) : undefined
  return (
    <div
      className="dsh-settings__body"
      id="dsh-settings-panel-models"
      role="tabpanel"
      aria-labelledby="dsh-settings-tab-models"
      aria-label={t('settings.modelsAria')}
    >
      <div className="dsh-settings__toolbar">
        <span className="dsh-settings__summary">
          {t(orderedProviderRows.length === 1 ? 'settings.providerCount' : 'settings.providerCountPlural', {
            count: orderedProviderRows.length,
          })}{' '}
          ·{' '}
          {t(props.models.length === 1 ? 'settings.modelCount' : 'settings.modelCountPlural', {
            count: props.models.length,
          })}
        </span>
        <button
          className="dsh-icon-button"
          type="button"
          aria-label={t('settings.refreshCatalog')}
          title={t('settings.refreshCatalog')}
          disabled={busyField !== undefined}
          onClick={() => {
            if (busyField !== undefined) return
            setSaveError(undefined)
            setBusyField('refresh')
            void props
              .onRefreshCatalog()
              .catch((reason: unknown) =>
                setSaveError(reason instanceof Error ? reason.message : t('settings.updateFailed')),
              )
              .finally(() => setBusyField(undefined))
          }}
        >
          <Icon name="refresh" />
        </button>
      </div>
      {saveError === undefined ? null : (
        <p className="dsh-settings__error" role="alert">
          {saveError}
        </p>
      )}
      {dshState.status === 'loading' ? (
        <p className="dsh-settings__empty" role="status">
          {t('settings.loadingDsh')}
        </p>
      ) : orderedProviderRows.length === 0 ? (
        <p className="dsh-settings__empty">{t('settings.noProviders')}</p>
      ) : (
        <ul className="dsh-settings__providers">
          {orderedProviderRows.map((provider) => {
            const providerModels = modelsByProvider.get(provider.id) ?? []
            const providerName =
              provider.settingsNs === 'llm-deepseek-account' ? t('settings.deepseekAccount') : provider.name
            const secretFields = provider.fields.filter((field) => field.secret)
            const editable =
              dshState.status === 'ready' &&
              dshSettingsSnapshotFresh &&
              provider.settingsNs !== undefined &&
              provider.settingsNs.trim() !== ''
            const isEditing = editingProviderId === provider.id
            return (
              <li
                className="dsh-settings__provider"
                key={provider.id}
                data-active={provider.active === true ? 'true' : undefined}
              >
                <div className="dsh-settings__provider-head">
                  <span className="dsh-settings__provider-mark" aria-hidden="true">
                    {providerMark(providerName, provider.id)}
                  </span>
                  <div className="dsh-settings__provider-identity">
                    <span className="dsh-settings__provider-name">
                      <strong title={provider.id}>{providerName}</strong>
                      {provider.active === true ? (
                        <span className="dsh-settings__provider-active" title={t('settings.activeProvider')}>
                          {t('settings.active')}
                        </span>
                      ) : null}
                    </span>
                    <span className="dsh-settings__provider-meta">
                      {provider.id === provider.name ? null : <code>{provider.id}</code>}
                      <span className="dsh-settings__provider-kind">{provider.kind}</span>
                      <span className="dsh-settings__provider-count">
                        {t(
                          providerModels.length === 1
                            ? 'settings.modelsSummary'
                            : 'settings.modelsSummaryPlural',
                          { count: providerModels.length },
                        )}
                      </span>
                    </span>
                  </div>
                  <div className="dsh-settings__provider-actions">
                    {editable ? (
                      <button
                        className="dsh-button dsh-button--secondary dsh-button--compact"
                        type="button"
                        disabled={!dshSettingsSnapshotFresh || (busyField !== undefined && !isEditing)}
                        onClick={() => {
                          setSaveError(undefined)
                          closeProviderAddition()
                          setEditingProviderId(isEditing ? undefined : provider.id)
                        }}
                      >
                        {isEditing ? t('settings.closeEditor') : t('settings.editProvider')}
                      </button>
                    ) : null}
                    {(provider.settingsPath?.length ?? 0) > 0 ? (
                      <button
                        className="dsh-button dsh-button--secondary dsh-button--compact dsh-settings__provider-remove"
                        type="button"
                        aria-label={t('settings.removeProvider')}
                        title={t('settings.removeProvider')}
                        disabled={busyField !== undefined || !dshSettingsSnapshotFresh}
                        onClick={(event) => {
                          removeProviderTriggerRef.current = event.currentTarget
                          setSaveError(undefined)
                          setRemovingProviderId(provider.id)
                        }}
                      >
                        <Icon name="trash" />
                      </button>
                    ) : null}
                  </div>
                </div>
                {secretFields.length === 0 ? null : (
                  <div className="dsh-settings__provider-summary">
                    {secretFields.map((field) => {
                      const key = `${provider.id}:${field.key}`
                      return (
                        <span className="dsh-settings__provider-credential" key={field.key}>
                          <span className="dsh-settings__credential-copy">
                            <span className="dsh-settings__credential-label">{field.label}</span>
                            <span
                              className={`dsh-settings__field-state${field.value === undefined ? '' : ' dsh-settings__field-state--ok'}`}
                              title={field.label}
                            >
                              <span
                                className="dsh-settings__secret-dot"
                                data-configured={field.value === undefined ? 'false' : 'true'}
                                aria-hidden="true"
                              />
                              {field.value === undefined ? t('settings.missing') : t('settings.configured')}
                            </span>
                          </span>
                          <span className="dsh-settings__credential-actions">
                            <button
                              className="dsh-button dsh-button--secondary dsh-button--compact"
                              type="button"
                              disabled={busyField !== undefined || field.writable === false}
                              onClick={() =>
                                runSecretAction(key, async () => {
                                  await props.onConfigureSecret(provider.id, field.key)
                                })
                              }
                            >
                              {field.value === undefined ? t('settings.configure') : t('settings.replace')}
                            </button>
                            {field.value === undefined ? null : (
                              <button
                                className="dsh-icon-button"
                                type="button"
                                aria-label={t('settings.removeSecret', {
                                  provider: provider.name,
                                  field: field.label,
                                })}
                                title={t('settings.removeSecretTitle')}
                                disabled={busyField !== undefined || field.writable === false}
                                onClick={() =>
                                  runSecretAction(key, async () => {
                                    await props.onRemoveSecret(provider.id, field.key)
                                  })
                                }
                              >
                                <Icon name="trash" />
                              </button>
                            )}
                          </span>
                        </span>
                      )
                    })}
                  </div>
                )}
                {isEditing && dshState.status === 'ready' && provider.settingsNs !== undefined ? (
                  <ProviderSettingsEditor
                    provider={provider}
                    catalogModels={providerModels}
                    settings={dshState.snapshot}
                    reasoningLevels={reasoningLevelsFor(provider.settingsNs)}
                    writable={dshState.snapshot.schema.writable}
                    saving={busyField === `provider:${provider.id}`}
                    onSave={(changes, expectedRevision) =>
                      saveProviderChanges(provider, changes, expectedRevision)
                    }
                    onDiscover={props.onDiscoverModels}
                    onClose={(changed) => {
                      setEditingProviderId(undefined)
                      if (!changed) setSaveError(undefined)
                    }}
                  />
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      <ProviderAddCard
        t={t}
        mode={addingProviderMode}
        disabled={busyField !== undefined}
        onModeChange={(mode) => {
          setSaveError(undefined)
          setEditingProviderId(undefined)
          setAddingProviderMode(mode)
        }}
        catalog={
          addingProvider === undefined || dshState.status !== 'ready' ? null : (
            <>
              <div className="dsh-settings__provider-add-select">
                <span>{t('settings.addProviderSelect')}</span>
                <SelectMenu
                  className="dsh-settings__provider-add-picker"
                  icon="box"
                  density="regular"
                  label={addingProvider.name}
                  ariaLabel={t('settings.addProviderSelect')}
                  title={t('settings.addProviderSelect')}
                  value={addingProvider.id}
                  disabled={busyField !== undefined}
                  options={addableProviders.map((provider) => ({
                    value: provider.id,
                    label: provider.name,
                  }))}
                  placement="below"
                  align="start"
                  onChange={(value) => {
                    const next = addableProviders.find((provider) => provider.id === value)
                    if (next === undefined) return
                    setSaveError(undefined)
                    setAddingProviderId(next.id)
                  }}
                />
              </div>
              <ProviderSettingsEditor
                key={addingProvider.id}
                provider={addingProvider}
                settings={dshState.snapshot}
                reasoningLevels={reasoningLevelsFor(addingProvider.settingsNs)}
                addingFromCatalog
                writable={dshSettingsSnapshotFresh && dshState.snapshot.schema.writable}
                saving={busyField === `provider:${addingProvider.id}`}
                forceSave={(addingProvider.settingsPath?.length ?? 0) > 0}
                onSave={(changes, expectedRevision) =>
                  saveProviderChanges(addingProvider, changes, expectedRevision, true)
                }
                onDiscover={props.onDiscoverModels}
                onClose={(changed) => {
                  closeProviderAddition()
                  if (!changed) setSaveError(undefined)
                }}
              />
            </>
          )
        }
        custom={
          customProviderTemplate === undefined ? null : (
            <CustomProviderCard
              template={customProviderTemplate}
              providers={props.providers}
              reasoningLevels={reasoningLevelsFor(customProviderTemplate.settingsNamespace)}
              writable={
                dshState.status === 'ready' && dshSettingsSnapshotFresh && dshState.snapshot.schema.writable
              }
              saving={busyField !== undefined}
              onClose={(changed) => {
                closeProviderAddition()
                if (!changed) setSaveError(undefined)
              }}
              onCreate={saveCustomProvider}
              onDiscover={props.onDiscoverCustomModels}
            />
          )
        }
        canOpen={dshState.status === 'ready' && dshSettingsSnapshotFresh && dshState.snapshot.schema.writable}
      />
      {pendingProvider === undefined ? null : (
        <div
          ref={removeDialogRef}
          className="dsh-settings__provider-remove-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-label={t('settings.removeProvider')}
        >
          <h3>{t('settings.removeProviderHeading')}</h3>
          <p>{t('settings.removeProviderPrompt', { provider: pendingProvider.name })}</p>
          <div className="dsh-settings__risk-actions">
            <button
              className="dsh-button dsh-button--secondary dsh-button--compact"
              type="button"
              disabled={busyField !== undefined}
              autoFocus
              onClick={() => setRemovingProviderId(undefined)}
            >
              {t('settings.cancel')}
            </button>
            <button
              className="dsh-button dsh-button--danger dsh-button--compact"
              type="button"
              disabled={busyField !== undefined}
              onClick={() => void removeProvider(pendingProvider)}
            >
              {busyField === `remove-provider:${pendingProvider.id}`
                ? t('settings.removingProvider')
                : t('settings.removeProviderConfirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** A quiet monogram anchors each provider row without adding another label. */
function providerMark(name: string, id: string): string {
  const source = name.trim() === '' ? id.trim() : name.trim()
  const first = [...source][0]
  return first === undefined ? '·' : first.toUpperCase()
}
