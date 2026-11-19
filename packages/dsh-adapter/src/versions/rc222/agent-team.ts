import { AppError, type BackendEvent, type SessionProjectionValues } from '@dsh-vscode/domain'
import { recordOrUndefined } from '../../repositories/shared/guards.js'
import { validAlpha171ProjectionBaseline } from '../alpha171/session-wire.js'
import { Rc221SessionRepository } from '../rc221/session-repository.js'
import { unwrapOptionalRpcResultValue, unwrapRpcResultValue } from '../rc6/rpc.js'

const SET_TEAM_MODE = 'agentTeams/setEnabled'

export class Rc222SessionRepository extends Rc221SessionRepository {
  public async setAgentTeamMode(
    sessionId: string,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<{ readonly enabled: boolean; readonly sequence: number }> {
    const result = unwrapOptionalRpcResultValue<unknown>(
      await this.remoteTransport.remoteRequest(SET_TEAM_MODE, { agentId: sessionId, enabled }, signal),
      SET_TEAM_MODE,
    )
    if (result !== undefined)
      throw new AppError({
        code: 'PROTOCOL_ERROR',
        message: 'DSH returned an invalid Agent Teams configuration result.',
        retryable: false,
      })

    signal?.throwIfAborted()
    // The mutation returns void. Re-read the authoritative flag with its cursor
    // so the requester also updates when its live projection is delayed or absent.
    const projection = recordOrUndefined(
      unwrapRpcResultValue<unknown>(
        await this.remoteTransport.remoteRequest('session/projections', { request: { sessionId } }, signal),
        'session/projections',
      ),
    )
    const { kind, ...baseline } = projection ?? {}
    const current = recordOrUndefined(recordOrUndefined(baseline.values)?.agentTeam)?.enabled
    if (
      kind !== 'sequenced' ||
      !validAlpha171ProjectionBaseline(baseline) ||
      typeof baseline.asOfSeq !== 'number' ||
      typeof current !== 'boolean'
    )
      throw new AppError({
        code: 'PROTOCOL_ERROR',
        message: 'DSH did not return the saved Agent Teams projection.',
        retryable: true,
      })
    return { enabled: current, sequence: baseline.asOfSeq }
  }
}

/** Keep the saved flag. Task data and the projection's raw diagnostic stay in DSH. */
export function mapTeamModeValues(
  values: SessionProjectionValues,
  supported: boolean,
): SessionProjectionValues {
  if (!Object.hasOwn(values, 'agentTeam')) return values
  const { agentTeam, ...rest } = values
  const enabled = supported ? recordOrUndefined(agentTeam)?.enabled : undefined
  return typeof enabled === 'boolean' ? { ...rest, agentTeam: enabled } : rest
}

export function mapTeamModeEvent(event: BackendEvent, supported: boolean): BackendEvent {
  if (event.type === 'session.projection' && event.key === 'agentTeam') {
    const enabled = supported ? recordOrUndefined(event.value)?.enabled : undefined
    return { ...event, value: typeof enabled === 'boolean' ? enabled : null }
  }
  if (event.type === 'session.subscribed' && event.projection !== undefined)
    return {
      ...event,
      projection: { ...event.projection, values: mapTeamModeValues(event.projection.values, supported) },
    }
  if (event.type === 'session.projection.baseline')
    return {
      ...event,
      projections: Object.fromEntries(
        Object.entries(event.projections).map(([id, projection]) => [
          id,
          { ...projection, values: mapTeamModeValues(projection.values, supported) },
        ]),
      ),
    }
  return event
}
