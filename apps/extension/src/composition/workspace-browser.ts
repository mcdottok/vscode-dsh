import * as vscode from 'vscode'
import { stat } from 'node:fs/promises'
import { AppError } from '@dsh-vscode/domain'
import { isInjectedUserMessage } from '@dsh-vscode/timeline'
import type { WebviewRequest } from '@dsh-vscode/webview-protocol'
import type { RequestGatewayDependencies } from './request-gateway-dependencies.js'
import { hasLocalWorkspaceAuthority } from '../view/session-workspace-scope.js'
import { sameWorkspacePath } from './workspace-state.js'

export const WORKSPACE_HANDOFF = 'dsh.workspace.browserHandoff'
export const WORKSPACE_BROWSER_STARTED_AT = Date.now()
type BrowserRequest = Extract<WebviewRequest, { type: 'workspace.browser' }>['payload']
export async function workspaceBrowser(
  deps: RequestGatewayDependencies,
  request: BrowserRequest,
  signal: AbortSignal,
): Promise<unknown> {
  if (request.action === 'choose') {
    await vscode.commands.executeCommand('workbench.action.files.openFolder')
    return {}
  }
  if (request.action === 'temporary') {
    if (!vscode.workspace.isTrusted) throw denied()
    const workspace = await deps.ensureCurrentWorkspace(undefined, signal)
    return { workspaceId: workspace.id }
  }
  if (request.action === 'resume') {
    const handoff = deps.context.globalState.get<{ time?: number; path?: string }>(WORKSPACE_HANDOFF)
    if (
      !handoff ||
      typeof handoff.time !== 'number' ||
      handoff.time > WORKSPACE_BROWSER_STARTED_AT ||
      Date.now() - handoff.time > 300_000 ||
      typeof handoff.path !== 'string'
    )
      return {}
  }
  const backend = deps.backendService.requireBackend()
  const workspaces = await deps.workspaceUseCases.list(signal)
  const current = await deps.listCurrentWorkspaces(signal)
  const local = hasLocalWorkspaceAuthority(backend.connection)
  if (request.action === 'resume') {
    const pending = deps.context.globalState.get<{ path: string; sessionId: string; time: number }>(
      WORKSPACE_HANDOFF,
    )
    if (
      !pending ||
      typeof pending.path !== 'string' ||
      typeof pending.sessionId !== 'string' ||
      !Number.isFinite(pending.time) ||
      pending.time > WORKSPACE_BROWSER_STARTED_AT ||
      Date.now() - pending.time > 300_000 ||
      !deps.currentWorkspaceFolders().some((folder) => sameWorkspacePath(folder.uri.fsPath, pending.path))
    )
      return {}
    const workspace = current.find(
      (item) => item.path !== undefined && sameWorkspacePath(item.path, pending.path),
    )
    if (!workspace) return {}
    const page = await backend.sessions.list({ workspaceId: workspace.id }, signal)
    if (!page.items.some((item) => item.id === pending.sessionId)) return {}
    await deps.context.globalState.update(WORKSPACE_HANDOFF, undefined)
    return { sessionId: pending.sessionId }
  }
  if (request.action === 'list')
    return {
      items: workspaces.map((item) => ({
        id: item.id,
        name: item.name,
        count: item.sessionIds?.length ?? item.sessionCount,
        current: current.some((entry) => entry.id === item.id),
        canOpen: local && item.path !== undefined,
      })),
    }
  const workspace = workspaces.find((item) => item.id === request.workspaceId)
  if (!workspace) throw denied()
  const page = await backend.sessions.list({ workspaceId: workspace.id }, signal)
  const archived = new Set(await backend.workspaces.listArchivedSessionIds(signal))
  if (request.action === 'sessions')
    return {
      items: page.items
        .filter((item) => !item.blank)
        .map((item) => ({
          id: item.id,
          title: item.title,
          status: item.status,
          archived: archived.has(item.id),
        })),
    }
  const session = page.items.find((item) => item.id === request.sessionId)
  if (!session) throw denied()
  if (request.action === 'open') {
    if (!local || !vscode.workspace.isTrusted || workspace.path === undefined) throw denied()
    // The path comes only from the authoritative registry, never browser input.
    if (!(await stat(workspace.path)).isDirectory()) throw denied()
    if (session.cwd && !sameWorkspacePath(session.cwd, workspace.path)) throw denied()
    signal.throwIfAborted()
    await deps.context.globalState.update(WORKSPACE_HANDOFF, {
      path: workspace.path,
      sessionId: session.id,
      time: Date.now(),
    })
    try {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(workspace.path), {
        forceNewWindow: true,
      })
    } catch (error) {
      await deps.context.globalState.update(WORKSPACE_HANDOFF, undefined)
      throw error
    }
    return {}
  }
  const history = await backend.sessions.history(session.id, request.beforeSequence, signal, {
    pageSize: 30,
    pagePurpose: 'transcript',
  })
  const messages = new Map<string, { id: string; role: string; text: string }>()
  for (const { event } of history.events) {
    if (event.type === 'message.user') {
      // Match the normal chat's visibility rule before constructing its DTO.
      // Host-authored context can look like prose; its body is not evidence.
      if (isInjectedUserMessage(event)) continue
      messages.set(event.messageId, { id: event.messageId, role: 'user', text: event.markdown })
    } else if (event.type === 'message.delta') {
      const previous = messages.get(event.messageId)
      messages.set(event.messageId, {
        id: event.messageId,
        role: 'assistant',
        text: (previous?.text ?? '') + event.delta,
      })
    } else if (event.type === 'message.completed' && event.markdown !== undefined)
      messages.set(event.messageId, { id: event.messageId, role: 'assistant', text: event.markdown })
  }
  return {
    title: session.title,
    items: [...messages.values()],
    hasMore: history.hasMore,
    beforeSequence: history.beforeSequence,
  }
}
function denied(): AppError {
  return new AppError({
    code: 'PERMISSION_DENIED',
    message: 'This project or session is unavailable in the current connection.',
    retryable: false,
  })
}
