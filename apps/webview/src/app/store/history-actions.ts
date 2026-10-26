import type { ProtocolClient } from '../protocol-client.js'
import { requestId } from './ids.js'
import { installTranscript, parseTranscript } from './transcript-state.js'
import type { AppState, StateSetter } from './types.js'

/** The Host prepends older rows; the renderer installs its authoritative window. */
export function createHistoryActions(deps: {
  readonly client: ProtocolClient
  readonly getState: () => AppState
  readonly setState: StateSetter
  readonly getOpenVersion?: () => number
}): { readonly loadOlderHistory: () => Promise<void> } {
  let generation = 0
  return {
    loadOlderHistory: async () => {
      const state = deps.getState()
      const window = state.transcript
      if (window === undefined || state.historyLoading || !window.hasMore) return
      const requestGeneration = ++generation
      deps.setState((current) => ({ ...current, historyLoading: true }))
      const openVersion = deps.getOpenVersion?.()
      const isCurrent = (): boolean =>
        deps.getState().activeSessionId === window.sessionId &&
        deps.getOpenVersion?.() === openVersion
      try {
        let cursor = window
        for (let attempt = 0; attempt < 2; attempt++) {
          let result: unknown
          try {
            result = await deps.client.request<unknown>({
              type: 'session.transcript.navigate',
              requestId: requestId(),
              payload: { sessionId: cursor.sessionId, revision: cursor.revision, direction: 'older' },
            })
          } catch (reason) {
            // Retiring a history read must never surface an error in the next chat.
            if (!isCurrent()) return
            throw reason
          }
          if (!isCurrent()) return
          const next = parseTranscript(result)
          deps.setState((current) => installTranscript(current, next))
          if (
            attempt === 0 && next.hasMore && next.revision > cursor.revision &&
            next.beforeSequence === cursor.beforeSequence
          ) {
            cursor = next
            continue
          }
          break
        }
      } finally {
        if (requestGeneration === generation)
          deps.setState((current) =>
            isCurrent() ? { ...current, historyLoading: false } : current,
          )
      }
    },
  }
}
