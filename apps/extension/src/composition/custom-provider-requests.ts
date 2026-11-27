import { createHmac, randomBytes } from 'node:crypto'
import {
  AppError,
  type CustomProviderCreateResult,
  type DiscoveredModel,
  type DshBackend,
} from '@dsh-vscode/domain'
import type { WebviewRequest } from '@dsh-vscode/webview-protocol'
import { normalizeOptionalProviderApiKey } from '../vscode/credential-input.js'

type Discovery = Extract<WebviewRequest, { type: 'models.discover.custom' }>['payload']
type SaveInput = Extract<WebviewRequest, { type: 'provider.custom.create' }>['payload']
type Draft = Omit<SaveInput, 'apiKey'>

interface Dependencies {
  readonly requireBackend: () => DshBackend
  readonly discover: DshBackend['models']['discoverModels']
  readonly create: (
    draft: Draft,
    key: string | undefined,
    signal: AbortSignal,
    retryUnconfirmedWrite: boolean,
  ) => Promise<CustomProviderCreateResult>
}

interface SaveAttempt {
  readonly backend: DshBackend
  readonly fingerprint: string
  readonly result: Promise<CustomProviderCreateResult>
  status: 'pending' | 'complete' | 'retry'
}

export class CustomProviderRequests {
  private readonly fingerprintKey = randomBytes(32)
  private readonly saves = new Map<string, SaveAttempt>()

  public constructor(private readonly deps: Dependencies) {}

  public async discover(input: Discovery, signal: AbortSignal): Promise<readonly DiscoveredModel[]> {
    const { apiKey, settingsNamespace, providerId, baseUrl, api } = input
    const key = normalizeOptionalProviderApiKey(apiKey)
    let models: readonly DiscoveredModel[]
    try {
      models = await this.deps.discover(
        {
          settingsNamespace,
          ...(providerId === undefined ? {} : { providerId }),
          ...(baseUrl === undefined ? {} : { baseUrl }),
          ...(api === undefined ? {} : { api }),
          ...(key === undefined ? {} : { apiKey: key }),
        },
        signal,
      )
    } catch (reason: unknown) {
      if (key === undefined || signal.aborted) throw reason
      if (reason instanceof AppError)
        throw new AppError({
          code: reason.code,
          message: reason.message.replaceAll(key, '[redacted]'),
          retryable: reason.retryable,
        })
      throw new AppError({
        code: 'PROTOCOL_ERROR',
        message: 'DSH could not discover models for this provider.',
        retryable: true,
      })
    }
    if (key !== undefined && models.some(({ id, label }) => id.includes(key) || label.includes(key)))
      throw new AppError({
        code: 'PROTOCOL_ERROR',
        message: 'The model list contained the supplied API key.',
        retryable: false,
      })
    return models
  }

  public async save(
    input: SaveInput,
    surfaceId: string | undefined,
    signal: AbortSignal,
  ): Promise<CustomProviderCreateResult> {
    const { apiKey, ...draft } = input
    const key = normalizeOptionalProviderApiKey(apiKey)
    const backend = this.deps.requireBackend()
    signal.throwIfAborted()
    if (surfaceId === undefined || draft.draftId === undefined)
      return this.deps.create(draft, key, signal, false)

    // Include credential changes in retry identity without retaining the credential.
    const fingerprint = createHmac('sha256', this.fingerprintKey)
      .update(JSON.stringify([draft, key]))
      .digest('hex')
    const previous = this.saves.get(surfaceId)
    const sameDraft = previous?.backend === backend && previous.fingerprint === fingerprint
    if (sameDraft && previous.status !== 'retry') return previous.result
    if (previous?.backend === backend && previous.status === 'pending')
      throw new AppError({
        code: 'BACKEND_BUSY',
        message: 'Another provider save is still in progress in this view.',
        retryable: true,
      })
    const reconcilePreviousWrite = sameDraft && previous.status === 'retry'
    const result = this.deps.create(draft, key, signal, reconcilePreviousWrite).then(
      (saved) => {
        attempt.status = saved.credentialError === undefined ? 'complete' : 'retry'
        return saved
      },
      (reason: unknown) => {
        if (this.saves.get(surfaceId) === attempt) {
          if (
            reason instanceof AppError &&
            reason.code === 'BACKEND_UNREACHABLE' &&
            (reconcilePreviousWrite || reason.context?.['customProviderWriteUnconfirmed'] === true)
          )
            attempt.status = 'retry'
          else this.saves.delete(surfaceId)
        }
        throw reason
      },
    )
    const attempt: SaveAttempt = { backend, fingerprint, result, status: 'pending' }
    this.saves.set(surfaceId, attempt)
    return result
  }

  public clearSurface(surfaceId: string): void {
    this.saves.delete(surfaceId)
  }
}
