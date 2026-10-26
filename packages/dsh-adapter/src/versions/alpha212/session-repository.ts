import { AppError, type SessionDetail, type SessionSummary } from '@dsh-vscode/domain'

import { recordOrUndefined } from '../../repositories/shared/guards.js'
import { requiredRecord, requiredSessionId } from '../../repositories/session/responses.js'
import { unwrapRpcResultValue } from '../rc6/rpc.js'
import { validAlpha171ProjectionBaseline } from '../alpha171/session-wire.js'
import { Rc172SessionRepository } from '../rc172/session-repository.js'

/** Cold stored Sessions must be opened deliberately before migration and fork. */
export class Alpha212SessionRepository extends Rc172SessionRepository {
  private readonly titleRetryAt = new Map<string, number>()

  protected override async hydrateSessionTitles(
    items: readonly SessionSummary[],
    signal?: AbortSignal,
  ): Promise<void> {
    const missing = items.filter(
      (item) =>
        !item.blank &&
        item.formatStatus !== 'migration-required' &&
        !this.hasProjectedTitle(item.id) &&
        (this.titleRetryAt.get(item.id) ?? 0) <= Date.now(),
    )
    let index = 0
    // Exact read-only observations rebuild cold projections without Agent
    // activation. Bound disk work and keep the ordinary list usable on errors.
    await Promise.all(
      Array.from({ length: Math.min(3, missing.length) }, async () => {
        while (index < missing.length) {
          signal?.throwIfAborted()
          const item = missing[index++]
          if (item === undefined) return
          try {
            await this.readColdTitle(item.id, signal)
          } catch {
            signal?.throwIfAborted()
            this.titleRetryAt.set(item.id, Date.now() + 5_000)
          }
        }
      }),
    )
  }

  private async readColdTitle(sessionId: string, signal?: AbortSignal): Promise<void> {
    const value = unwrapRpcResultValue<unknown>(
      await this.remoteTransport.remoteRequest('session/projections', { request: { sessionId } }, signal),
      'session/projections',
    )
    signal?.throwIfAborted()
    if (value === null) {
      this.titleRetryAt.set(sessionId, Date.now() + 30_000)
      return
    }
    const projection = recordOrUndefined(value)
    // Migration is never triggered merely to decorate a directory row.
    if (projection?.kind === 'migration-required') {
      this.titleRetryAt.set(sessionId, Date.now() + 30_000)
      return
    }
    if (projection?.kind !== 'sequenced') throw malformedTitleProjection()
    const { kind, ...baseline } = projection
    void kind
    if (!validAlpha171ProjectionBaseline(baseline) || typeof baseline.asOfSeq !== 'number')
      throw malformedTitleProjection()
    const values = recordOrUndefined(baseline.values)
    if (values?.title === undefined || values.title === null || values.title === '') {
      this.titleRetryAt.set(sessionId, Date.now() + 30_000)
      return
    }
    if (typeof values.title !== 'string') throw malformedTitleProjection()
    this.remember({
      type: 'session.projection.baseline',
      projections: { [sessionId]: { asOfSequence: baseline.asOfSeq, values: { title: values.title } } },
    })
    this.titleRetryAt.delete(sessionId)
  }

  public override async get(sessionId: string, signal?: AbortSignal): Promise<SessionDetail> {
    // A successfully decoded V4 history is authoritative after an explicit open.
    return { ...(await super.get(sessionId, signal)), formatStatus: 'current' }
  }

  protected override mapSessionSummary(value: unknown): SessionSummary {
    const summary = super.mapSessionSummary(value)
    const status = recordOrUndefined(value)?.formatStatus
    if (status !== undefined && status !== 'current' && status !== 'migration-required')
      throw new AppError({
        code: 'PROTOCOL_ERROR',
        message: 'DSH returned an invalid session format status.',
        retryable: false,
      })
    return { ...summary, ...(status === undefined ? {} : { formatStatus: status }) }
  }

  public override async fork(
    sessionId: string,
    atSeq?: number,
    signal?: AbortSignal,
  ): Promise<SessionDetail> {
    let value: unknown
    try {
      value = unwrapRpcResultValue(
        await this.remoteTransport.remoteRequest(
          'session/fork',
          {
            request: { sessionId, allowMigration: false, ...(atSeq === undefined ? {} : { atSeq }) },
          },
          signal,
        ),
        'session/fork',
      )
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.context?.rpcCode === 'session/migration-required' ||
          error.context?.wireCode === 'session/migration-required')
      )
        throw new AppError({
          code: 'INVALID_CONFIGURATION',
          message: 'Open the original session to migrate it before forking.',
          retryable: false,
        })
      throw error
    }
    return this.get(requiredSessionId(requiredRecord(value, 'session fork'), 'session fork'), signal)
  }
}

function malformedTitleProjection(): AppError {
  return new AppError({
    code: 'PROTOCOL_ERROR',
    message: 'DSH returned a malformed session title projection.',
    retryable: false,
  })
}
