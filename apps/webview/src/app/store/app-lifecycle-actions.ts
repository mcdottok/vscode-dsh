import { diagnosticsSnapshotSchema } from '@dsh-vscode/webview-protocol'
import type { ProtocolClient } from '../protocol-client.js'
import { requestId } from './ids.js'
import type { createDshUpdateActions } from './dsh-update.js'
import type { AppActions } from './types.js'

type DshUpdateActions = ReturnType<typeof createDshUpdateActions>

export interface AppLifecycleActionDependencies {
  readonly applyBusyEnterPreference: () => Promise<void>
  readonly checkDshUpdates: DshUpdateActions['checkDshUpdates']
  readonly client: ProtocolClient
  readonly invalidateFeedback: () => void
  readonly markStartupRestoreArmed: () => void
  readonly setConnectionInitializing: (pending: boolean) => void
  readonly refresh: () => Promise<void>
}

export function createAppLifecycleActions(
  deps: AppLifecycleActionDependencies,
): Pick<AppActions, 'initialize' | 'reconnect' | 'readDiagnostics' | 'showDiagnostics'> {
  const {
    applyBusyEnterPreference,
    checkDshUpdates,
    client,
    invalidateFeedback,
    markStartupRestoreArmed,
    refresh,
  } = deps

  return {
    initialize: async () => {
      let armed = false
      deps.setConnectionInitializing(true)
      try {
        try {
          await client.request<unknown>({ type: 'app.ready', requestId: requestId() })
        } finally {
          deps.setConnectionInitializing(false)
        }
        // Official ui-conversation row: the host-side busy-Enter preference is
        // the composer's plain-Enter policy while a turn is running. It is
        // independent of the session/catalog snapshot. Start it alongside the
        // critical refresh, but keep the official default ('queue') on the
        // first-paint path when the settings read is slow or unavailable.
        markStartupRestoreArmed()
        armed = true
        const refreshPromise = refresh()
        void applyBusyEnterPreference()
        await refreshPromise
        // Refresh owns the directory + restore barrier and its surface guard;
        // do not start a second restore after it has reported an outcome.
      } finally {
        // A failed initial handshake must still allow a later successful
        // connection snapshot to prepare the remembered session.
        if (!armed) markStartupRestoreArmed()
        // Runtime/npm inspection competes with connection and session reads.
        // Start it after startup settles, including when connection failed.
        void checkDshUpdates(false).catch(() => undefined)
      }
    },
    reconnect: async () => {
      invalidateFeedback()
      await client.request<unknown>({ type: 'connection.retry', requestId: requestId() })
      await refresh()
    },
    readDiagnostics: async () => {
      const parsed = diagnosticsSnapshotSchema.safeParse(
        await client.request<unknown>({ type: 'diagnostics.snapshot', requestId: requestId() }),
      )
      if (!parsed.success) return undefined
      return {
        extensionVersion: parsed.data.extensionVersion,
        ...(parsed.data.dshVersion === undefined ? {} : { dshVersion: parsed.data.dshVersion }),
        state: parsed.data.state,
        ...(parsed.data.endpointKind === undefined ? {} : { endpointKind: parsed.data.endpointKind }),
        canReconnect: parsed.data.canReconnect,
        recentEvents: parsed.data.recentEvents,
      }
    },
    showDiagnostics: async () => {
      await client.request<unknown>({ type: 'diagnostics.show', requestId: requestId() })
    },
  }
}
