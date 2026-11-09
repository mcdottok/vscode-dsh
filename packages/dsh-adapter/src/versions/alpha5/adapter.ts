import { AppError, type BackendCandidate, type BackendCapabilities } from '@dsh-vscode/domain'
import type { VersionAdapterIdentity } from '../../adapter-base.js'
import { Alpha4VersionAdapter, type Alpha4AdapterOptions } from '../alpha4/adapter.js'
import type { AlphaLoopbackApiClient } from '../alpha/transport.js'
import { isJsonLike, isPlainRecord, isSafeAlphaCursor } from '../alpha/remote-mux.js'

export type Alpha5AdapterOptions = Alpha4AdapterOptions

/**
 * Adapter for DSH 0.1.2-alpha.5.
 *
 * The alpha.4 -> alpha.5 upstream source diff changes storage and projection
 * cache compatibility only; it does not change the Connection/Gateway,
 * Session Controller browser wire, Remote error vocabulary, or Web Profile
 * launch flags consumed by this extension. The current master tree after the
 * alpha.5 tag likewise keeps those wire surfaces stable while changing cold
 * Session persistence internals. Keep the implementation shared with alpha.4
 * but expose an independent version identity so exact alpha.5 connections are
 * never reported as alpha.4 connections.
 */
export class Alpha5VersionAdapter extends Alpha4VersionAdapter {
  public override async probeCompatibility(
    candidate: BackendCandidate,
    signal?: AbortSignal,
  ): Promise<BackendCapabilities | undefined> {
    const capabilities = await super.probeCompatibility(candidate, signal)
    if (capabilities === undefined) return undefined

    // 新版仍能回答 session/list；必须确认旧控制基线，不能据此猜成 Session v0。
    const transport = this.createTransport(candidate.endpoint) as AlphaLoopbackApiClient
    const lifetime = new AbortController()
    const probeSignal = AbortSignal.any([
      lifetime.signal,
      AbortSignal.timeout(this.options.requestTimeoutMs),
      ...(signal === undefined ? [] : [signal]),
    ])
    const stream = transport.openRemoteStream('session/control', {}, probeSignal)
    try {
      const first = await stream.next()
      signal?.throwIfAborted()
      return !first.done && isLegacyControlBaseline(first.value) ? capabilities : undefined
    } catch (error) {
      signal?.throwIfAborted()
      if (
        error instanceof AppError &&
        ['AUTH_REQUIRED', 'PERMISSION_DENIED', 'INVALID_ENDPOINT', 'REQUEST_CANCELLED'].includes(error.code)
      )
        throw error
      return undefined
    } finally {
      lifetime.abort()
      try {
        await stream.return(undefined)
      } finally {
        await transport.close()
      }
    }
  }

  protected override readonly identity: VersionAdapterIdentity = {
    id: 'dsh-0.1.2-alpha.5',
    supportedVersion: '0.1.2-alpha.5',
    protocolVersion: 'alpha5',
    compatibilityPriority: 120,
    fallback: true,
  }
}

function isLegacyControlBaseline(value: unknown): boolean {
  if (!isPlainRecord(value) || value.type !== 'baseline' || !isPlainRecord(value.value)) return false
  const { queues, jobs, projections } = value.value
  if (!isPlainRecord(queues) || !isPlainRecord(jobs) || !isPlainRecord(projections)) return false
  if (
    ![...Object.values(queues), ...Object.values(jobs)].every(
      (rows) => Array.isArray(rows) && rows.every(isPlainRecord),
    )
  )
    return false
  return Object.values(projections).every(
    (projection) =>
      isPlainRecord(projection) &&
      isSafeAlphaCursor(projection.asOfSeq) &&
      isPlainRecord(projection.values) &&
      Object.values(projection.values).every((entry) => isJsonLike(entry)),
  )
}
