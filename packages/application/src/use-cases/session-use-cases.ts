import { AppError } from '@dsh-vscode/domain'
import type {
  PromptAttachment,
  PromptInput,
  QueuedInput,
  RunningInputMode,
  SessionCreateInput,
  SessionDetail,
  SessionHistoryPage,
  SessionHistoryQueryOptions,
  SessionListOptions,
  SessionListQuery,
  SessionPage,
} from '@dsh-vscode/domain'

import type { BackendService } from '../services/backend-service.js'

export class SessionUseCases {
  public constructor(private readonly backendService: BackendService) {}

  public initializeDefaultModel(signal?: AbortSignal): Promise<void> {
    const sessions = this.backendService.requireBackend().sessions
    if (sessions.initializeDefaultModel === undefined)
      throw new AppError({
        code: 'CAPABILITY_UNAVAILABLE',
        message: 'This DSH host does not expose default model initialization.',
        retryable: false,
      })
    return sessions.initializeDefaultModel(signal)
  }

  public list(
    query?: SessionListQuery,
    signal?: AbortSignal,
    options?: SessionListOptions,
  ): Promise<SessionPage> {
    const sessions = this.backendService.requireBackend().sessions
    return options === undefined ? sessions.list(query, signal) : sessions.list(query, signal, options)
  }

  public create(input: SessionCreateInput, signal?: AbortSignal): Promise<SessionDetail> {
    if (input.workspaceId.trim() === '') throw new Error('Workspace is required')
    return this.backendService.requireBackend().sessions.create(input, signal)
  }

  public history(
    sessionId: string,
    beforeSequence?: number,
    signal?: AbortSignal,
    options?: SessionHistoryQueryOptions,
  ): Promise<SessionHistoryPage> {
    return this.backendService.requireBackend().sessions.history(sessionId, beforeSequence, signal, options)
  }

  public remove(sessionId: string, signal?: AbortSignal): Promise<void> {
    return this.backendService.requireBackend().sessions.remove(sessionId, signal)
  }

  public sendPrompt(
    input: PromptInput,
    mode: RunningInputMode = 'queue',
    signal?: AbortSignal,
  ): Promise<void> {
    if (input.text.trim() === '' && input.attachments.length === 0) throw new Error('Prompt cannot be empty')
    return this.backendService.requireBackend().sessions.sendPrompt(input, mode, signal)
  }

  public cancel(sessionId: string, signal?: AbortSignal): Promise<void> {
    return this.backendService.requireBackend().sessions.cancel(sessionId, signal)
  }

  public fork(sessionId: string, atSeq?: number, signal?: AbortSignal): Promise<SessionDetail> {
    return this.backendService.requireBackend().sessions.fork(sessionId, atSeq, signal)
  }

  public readAttachment(
    sessionId: string,
    attachmentId: string,
    signal?: AbortSignal,
  ): Promise<PromptAttachment> {
    return this.backendService.requireBackend().sessions.readAttachment(sessionId, attachmentId, signal)
  }

  public setArchived(sessionId: string, archived: boolean, signal?: AbortSignal): Promise<void> {
    return this.backendService.requireBackend().sessions.setArchived(sessionId, archived, signal)
  }

  public async setAgentTeamMode(
    session: SessionDetail,
    enabled: boolean,
    signal?: AbortSignal,
  ): Promise<void> {
    const backend = this.backendService.requireBackend()
    if (backend.connection.capabilities.compatibilityMode !== 'exact' || !backend.sessions.setAgentTeamMode)
      throw new AppError({
        code: 'CAPABILITY_UNAVAILABLE',
        message: 'This DSH connection does not support Agent Teams configuration.',
        retryable: false,
      })
    if (session.origin === 'subagent')
      throw new AppError({
        code: 'PERMISSION_DENIED',
        message: 'Change Agent Teams from the root session.',
        retryable: false,
      })
    signal?.throwIfAborted()
    const current = await backend.sessions.setAgentTeamMode(session.id, enabled, signal)
    signal?.throwIfAborted()
    if (this.backendService.requireBackend() !== backend)
      throw new AppError({
        code: 'STALE_INTERACTION',
        message: 'The DSH connection changed while saving Agent Teams settings.',
        retryable: true,
      })
    backend.events.publish?.({
      type: 'session.projection',
      sessionId: session.id,
      key: 'agentTeam',
      sequence: current.sequence,
      value: { enabled: current.enabled },
    })
    if (current.enabled !== enabled)
      throw new AppError({
        code: 'STALE_INTERACTION',
        message: 'Agent Teams mode changed before the saved state could be confirmed.',
        retryable: true,
      })
  }

  public enqueuePrompt(
    input: PromptInput,
    mode: RunningInputMode,
    signal?: AbortSignal,
  ): Promise<QueuedInput> {
    if (input.text.trim() === '' && input.attachments.length === 0) throw new Error('Prompt cannot be empty')
    return this.backendService.requireBackend().sessions.enqueuePrompt(input, mode, signal)
  }
}
