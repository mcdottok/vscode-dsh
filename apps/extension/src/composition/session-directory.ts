import type { SessionListQuery, SessionPage, SessionSummary } from '@dsh-vscode/domain'
import type { RequestGatewayDependencies } from './request-gateway-dependencies.js'
import type { CurrentWorkspaceDirectory } from './session-scope.js'
import { sameWorkspacePath } from './workspace-state.js'

export type DirectoryDependencies = Pick<
  RequestGatewayDependencies,
  | 'currentWorkspaceFolders'
  | 'listCurrentWorkspaces'
  | 'listCurrentArchivedSessionIds'
  | 'readCurrentWorkspaceDirectory'
> & { readonly sessionUseCases: Pick<RequestGatewayDependencies['sessionUseCases'], 'list'> }

/** Both session lists use the same DSH summaries and workspace/archive boundary. */
export async function listScopedSessions(
  deps: DirectoryDependencies,
  query: SessionListQuery,
  signal: AbortSignal,
  current?: Pick<CurrentWorkspaceDirectory, 'workspaces'> &
    Partial<Pick<CurrentWorkspaceDirectory, 'registry'>>,
): Promise<SessionPage> {
  signal.throwIfAborted()
  const folders = deps.currentWorkspaceFolders()
  const directory = current ?? (await deps.readCurrentWorkspaceDirectory?.(signal))
  const workspaces = directory?.workspaces ?? (await deps.listCurrentWorkspaces(signal))
  signal.throwIfAborted()
  if (workspaces.length === 0 && folders.length === 0) return { items: [] }
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id))
  const sessionIds = new Set(workspaces.flatMap((workspace) => workspace.sessionIds ?? []))
  const workspaceId = query.workspaceId
  const archived = query.archived ?? false
  if (workspaceId !== undefined && !workspaceIds.has(workspaceId)) return { items: [] }
  const inCurrentWorkspace = (session: SessionSummary): boolean => {
    const belongs =
      (workspaceId === undefined
        ? workspaceIds.has(session.workspaceId)
        : session.workspaceId === workspaceId) || sessionIds.has(session.id)
    const cwd = session.cwd
    return (
      belongs || (cwd !== undefined && folders.some((folder) => sameWorkspacePath(cwd, folder.uri.fsPath)))
    )
  }
  if (directory?.registry !== undefined) {
    const { registry } = directory
    const includeSession = (session: SessionSummary): boolean =>
      inCurrentWorkspace(session) && registry.archivedSessionIds.has(session.id) === archived
    const page = await deps.sessionUseCases.list({ ...query, archived }, signal, {
      workspaceSnapshot: registry,
      includeSession,
    })
    signal.throwIfAborted()
    return { ...page, items: page.items.filter(includeSession) }
  }
  const [archive, page] = await Promise.all([
    deps.listCurrentArchivedSessionIds(workspaces, signal),
    deps.sessionUseCases.list({ ...query, archived }, signal),
  ])
  signal.throwIfAborted()
  const archivedIds = new Set(archive)
  return {
    ...page,
    items: page.items.filter(
      (session) => inCurrentWorkspace(session) && archivedIds.has(session.id) === archived,
    ),
  }
}
