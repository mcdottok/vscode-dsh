import { expect, it, vi } from 'vitest'
import type { BackendEvent, DshBackend } from '@dsh-vscode/domain'
import { createBackendAttach, type BackendAttachDependencies } from './backend-attach.js'

vi.mock('vscode', () => ({}))

it.each([true, false])(
  'cleans up a lost backend and forwards failure only when automatic recovery is unavailable (%s)',
  async (recoverable) => {
    let onEvent: ((event: BackendEvent) => void) | undefined
    const postBackendEvent = vi.fn().mockResolvedValue(true)
    const recoverDesktop = vi.fn(() => recoverable)
    const detach = vi.fn()
    const dependencies = {
      backendService: {
        attach: (_backend: DshBackend, handler: (event: BackendEvent) => void) => {
          onEvent = handler
        },
      },
      stopAllJobFollows: vi.fn(),
      invalidateCurrentWorkspaceSessionDetails: vi.fn(),
      changeTracker: { attach: vi.fn(), detach },
      taskRegistry: { attach: vi.fn(), detach: vi.fn() },
      editorContextProvider: { dispose: vi.fn(), attach: vi.fn() },
      taskFocus: { clearSessionId: vi.fn() },
      currentWorkspaceFolderId: () => undefined,
      postBackendEvent,
      recoverDesktop,
    } as unknown as BackendAttachDependencies
    const attach = createBackendAttach(dependencies)
    const backend = { connection: {} } as DshBackend
    await attach.attach(backend)
    const lost = { type: 'connection.lost', reason: 'Fixture transport closed' } as const
    onEvent?.(lost)
    expect(detach).toHaveBeenCalledOnce()
    expect(recoverDesktop).toHaveBeenCalledOnce()
    expect(postBackendEvent).toHaveBeenCalledTimes(recoverable ? 0 : 1)
  },
)
