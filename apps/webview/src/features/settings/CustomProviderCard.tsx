import { useId, useRef, useState, type ReactElement } from 'react'
import type {
  CustomProviderCreateResult,
  CustomProviderDraft,
  DiscoveredModel,
  ModelDiscoveryInput,
  ModelProvider,
} from '@dsh-vscode/domain'
import { isValidCustomProviderId } from '@dsh-vscode/domain'
import { useI18n } from '../../i18n.js'
import { SelectMenu } from '../../components/common/SelectMenu.js'
import { publicProtocolErrorCode } from '../../app/protocol-client.js'
import { Icon } from '../../ui/Icon.js'
import { ModelListEditor, type EditableModel } from './ModelListEditor.js'
import { validateReasoningEfforts } from './ModelReasoningEfforts.js'
import { protocolReasoningLevels } from './provider-helpers.js'

export interface CustomProviderTemplate {
  readonly settingsNamespace: string
  readonly collectionPath: readonly string[]
  /** Protocols read from the connected DSH Schemastery union. */
  readonly protocols: readonly string[]
  /** Namespace revision captured when this card was opened. */
  readonly revision: number
  readonly api?: string
}

export interface CustomProviderCardProps {
  readonly template: CustomProviderTemplate
  readonly providers: readonly ModelProvider[]
  /** Levels the template namespace's model schema accepts, when the host describes them. */
  readonly reasoningLevels?: readonly string[] | undefined
  readonly writable: boolean
  readonly saving: boolean
  readonly onClose: (changed: boolean) => void
  readonly onCreate: (
    draft: CustomProviderDraft,
    draftId: string,
    apiKey: string,
  ) => Promise<CustomProviderCreateResult>
  readonly onDiscover: (input: ModelDiscoveryInput) => Promise<readonly DiscoveredModel[]>
}

export function CustomProviderCard(props: CustomProviderCardProps): ReactElement {
  const { t } = useI18n()
  const saveHintId = useId()
  const apiKeyId = useId()
  const apiKeyInput = useRef<HTMLInputElement>(null)
  const [keyVisible, setKeyVisible] = useState(false)
  const [draftId] = useState(() => crypto.randomUUID())
  // The write is checked against the exact revision that was visible when the
  // card opened. A route added in another window must become a conflict.
  const [openedAt] = useState(() => props.template.revision)
  const [route, setRoute] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [api, setApi] = useState(props.template.api ?? props.template.protocols[0] ?? '')
  const [models, setModels] = useState<EditableModel[]>([])
  const [error, setError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [unconfirmedDraft, setUnconfirmedDraft] = useState<CustomProviderDraft>()
  const [retryWithLatestRevision, setRetryWithLatestRevision] = useState(false)

  const routeValue = route.trim()
  const displayNameValue = displayName.trim()
  const baseUrlValue = baseUrl.trim()
  const apiValue = api.trim()
  const routeInvalid = routeValue !== '' && !isValidCustomProviderId(routeValue)
  const resolving = unconfirmedDraft !== undefined
  const routeTaken =
    !busy && !committed && !resolving && props.providers.some((provider) => provider.id === routeValue)
  const hasDiscoveryTarget =
    routeValue !== '' && !routeInvalid && !routeTaken && baseUrlValue !== '' && apiValue !== ''
  const modelFailure = validateModels(models)
  const routeReasoning = protocolReasoningLevels(apiValue, props.reasoningLevels)
  const reasoningFailure =
    routeReasoning.levels.length === 0
      ? undefined
      : validateReasoningEfforts(models, routeReasoning.levels, routeReasoning.levelsOnly)
  const normalizedModels = models.map(normalizeModel)
  const ready =
    props.template.protocols.length > 0 &&
    hasDiscoveryTarget &&
    normalizedModels.length > 0 &&
    modelFailure === undefined &&
    reasoningFailure === undefined
  const saving = props.saving || busy
  const disabled = !props.writable || saving
  const profileDisabled = disabled || discovering || committed || resolving
  const canSubmit = !saving && !discovering && (committed || (props.writable && (resolving || ready)))
  const apiOptions = [
    ...(api !== '' && !props.template.protocols.includes(api) ? [{ value: api, label: api }] : []),
    ...props.template.protocols.map((protocol) => ({ value: protocol, label: protocol })),
  ]

  const discoveryInput: Omit<ModelDiscoveryInput, 'apiKey'> = {
    settingsNamespace: props.template.settingsNamespace,
    ...(routeValue === '' ? {} : { providerId: routeValue }),
    ...(baseUrlValue === '' ? {} : { baseUrl: baseUrlValue }),
    ...(apiValue === '' ? {} : { api: apiValue }),
  }

  const save = async (): Promise<void> => {
    if (!canSubmit) return
    const draft: CustomProviderDraft = unconfirmedDraft ?? {
      settingsNamespace: props.template.settingsNamespace,
      collectionPath: [...props.template.collectionPath],
      providerId: routeValue,
      ...(displayNameValue === '' ? {} : { displayName: displayNameValue }),
      api: apiValue,
      baseUrl: baseUrlValue,
      models: normalizedModels.map((model) => ({ ...model })),
      expectedRevision: retryWithLatestRevision ? props.template.revision : openedAt,
    }
    setKeyVisible(false)
    setBusy(true)
    setError(undefined)
    try {
      const outcome = await props.onCreate(draft, draftId, apiKeyInput.current?.value ?? '')
      setUnconfirmedDraft(undefined)
      if (!outcome.profileCommitted) {
        setError(t('settings.providerCreateIncomplete'))
        return
      }
      setCommitted(true)
      if (outcome.credentialError !== undefined) {
        setUnconfirmedDraft(draft)
        setError(t('settings.customProviderCredentialRetry'))
        return
      }
      if (apiKeyInput.current !== null) apiKeyInput.current.value = ''
      props.onClose(true)
    } catch (reason: unknown) {
      const code = publicProtocolErrorCode(reason)
      if (!committed && (code === 'BACKEND_UNREACHABLE' || (resolving && code === 'BACKEND_BUSY'))) {
        setUnconfirmedDraft(draft)
        setError(t('settings.customProviderSaveUnconfirmed'))
      } else {
        if (!committed) setUnconfirmedDraft(undefined)
        if (code === 'SETTINGS_CONFLICT') setRetryWithLatestRevision(true)
        setError(reason instanceof Error ? reason.message : t('settings.updateFailed'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="dsh-settings__custom-provider" aria-label={t('settings.customProvider')}>
      <div className="dsh-settings__custom-provider-grid">
        <label>
          <span>{t('settings.providerId')}</span>
          <input
            type="text"
            required
            aria-invalid={routeInvalid || routeTaken || undefined}
            value={route}
            disabled={profileDisabled}
            onChange={(event) => {
              setError(undefined)
              setRoute(event.target.value)
            }}
          />
        </label>
        <label>
          <span>{t('settings.providerDisplayName')}</span>
          <input
            type="text"
            value={displayName}
            disabled={profileDisabled}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label>
          <span>{t('settings.providerBaseUrl')}</span>
          <input
            type="url"
            required
            value={baseUrl}
            disabled={profileDisabled}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label>
          <span>{t('settings.providerApi')}</span>
          <SelectMenu
            className="dsh-settings__provider-api-select"
            icon="settings"
            menuMode="flow"
            label={api === '' ? t('settings.notSet') : api}
            ariaLabel={t('settings.providerApi')}
            title={t('settings.providerApi')}
            value={api}
            options={apiOptions}
            disabled={profileDisabled}
            onChange={setApi}
          />
        </label>
        <div className="dsh-settings__custom-provider-key">
          <label htmlFor={apiKeyId}>{t('settings.customProviderApiKey')}</label>
          <div className="dsh-settings__custom-provider-key-input">
            <input
              id={apiKeyId}
              ref={apiKeyInput}
              type={keyVisible ? 'text' : 'password'}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={8192}
              disabled={profileDisabled}
              aria-describedby={committed || resolving ? undefined : saveHintId}
              onChange={() => setError(undefined)}
            />
            <button
              className="dsh-icon-button"
              type="button"
              aria-label={t('settings.showCustomProviderApiKey')}
              aria-pressed={keyVisible}
              aria-controls={apiKeyId}
              title={t(
                keyVisible ? 'settings.hideCustomProviderApiKey' : 'settings.showCustomProviderApiKey',
              )}
              disabled={profileDisabled}
              onClick={() => setKeyVisible(!keyVisible)}
            >
              <Icon name={keyVisible ? 'eye-closed' : 'eye'} />
            </button>
          </div>
        </div>
      </div>
      {routeInvalid ? <p className="dsh-settings__error">{t('settings.providerRouteInvalid')}</p> : null}
      {routeTaken ? <p className="dsh-settings__error">{t('settings.providerRouteTaken')}</p> : null}
      {modelFailure?.kind === 'id' ? (
        <p className="dsh-settings__error">{t('settings.modelIdRequired')}</p>
      ) : null}
      {modelFailure?.kind === 'duplicate' ? (
        <p className="dsh-settings__error">{t('settings.modelIdDuplicate')}</p>
      ) : null}
      {modelFailure?.kind === 'capacity' ? (
        <p className="dsh-settings__error">
          {t('settings.invalidCapacity', { field: t(`settings.${modelFailure.field}`) })}
        </p>
      ) : null}
      {modelFailure?.kind === 'input' ? (
        <p className="dsh-settings__error">{t('settings.modelInputRequired')}</p>
      ) : null}
      {committed || resolving ? null : (
        <p id={saveHintId} className="dsh-settings__custom-provider-notice">
          <strong>{t('settings.customProviderModelHint')}</strong>
          {t('settings.customProviderModelFollowup')}
        </p>
      )}
      <ModelListEditor
        models={models}
        inputField="input"
        reasoningLevels={routeReasoning.levels}
        reasoningLevelsOnly={routeReasoning.levelsOnly}
        writable={props.writable && !committed && !resolving}
        saving={saving}
        discoveryDisabled={!hasDiscoveryTarget}
        showSave={false}
        discoveryInput={discoveryInput}
        onDiscover={async (input) => {
          setKeyVisible(false)
          setDiscovering(true)
          setError(undefined)
          try {
            return await props.onDiscover({ ...input, apiKey: apiKeyInput.current?.value ?? '' })
          } finally {
            setDiscovering(false)
          }
        }}
        onChange={(next) => setModels(next.map((model) => ({ ...model })))}
        onSave={(next) => {
          setModels(next.map((model) => ({ ...model })))
          return Promise.resolve()
        }}
      />
      {error === undefined ? null : (
        <p className="dsh-settings__custom-provider-error" role="alert">
          {error}
        </p>
      )}
      {!saving && !discovering && !committed && !resolving && !ready && error === undefined ? (
        <p className="dsh-settings__advanced-hint">
          {t(
            hasDiscoveryTarget
              ? 'settings.customProviderSaveNeedsModel'
              : 'settings.customProviderSaveNeedsTarget',
          )}
        </p>
      ) : null}
      <footer className="dsh-settings__provider-editor-actions">
        <button
          className="dsh-button dsh-button--secondary dsh-button--compact"
          type="button"
          disabled={saving}
          onClick={() => {
            if (apiKeyInput.current !== null) apiKeyInput.current.value = ''
            props.onClose(committed)
          }}
        >
          {t('settings.cancel')}
        </button>
        <button
          className="dsh-button dsh-button--primary dsh-button--compact"
          type="button"
          aria-describedby={committed || resolving ? undefined : saveHintId}
          disabled={!canSubmit}
          onClick={() => void save()}
        >
          {busy
            ? t('settings.savingProvider')
            : committed
              ? t('settings.retryProviderCredential')
              : resolving
                ? t('settings.retryProviderSave')
                : t('settings.saveProvider')}
        </button>
      </footer>
    </section>
  )
}

type ModelFailure =
  | { readonly kind: 'id' }
  | { readonly kind: 'duplicate' }
  | { readonly kind: 'capacity'; readonly field: 'contextWindow' | 'maxTokens' }
  | { readonly kind: 'input' }
  | undefined

function validateModels(models: readonly EditableModel[]): ModelFailure {
  const ids = new Set<string>()
  for (const model of models) {
    const id = model.id.trim()
    if (id === '' || id.length > 256) return { kind: 'id' }
    if (ids.has(id)) return { kind: 'duplicate' }
    ids.add(id)
    const input = model.input
    if (
      input !== undefined &&
      (!Array.isArray(input) || input.some((value) => value !== 'text' && value !== 'image'))
    )
      return { kind: 'input' }
    for (const field of ['contextWindow', 'maxTokens'] as const) {
      const value = model[field]
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0))
        return { kind: 'capacity', field }
    }
  }
  return undefined
}

function normalizeModel(model: EditableModel): EditableModel {
  const { name, ...rest } = model
  return {
    ...rest,
    id: model.id.trim(),
    ...(name === undefined || name.trim() === '' ? {} : { name: name.trim() }),
  }
}
