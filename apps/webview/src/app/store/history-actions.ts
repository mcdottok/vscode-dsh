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
}): {
  readonly loadOlderHistory: () => Promise<void>
  readonly navigateTranscript: (direction: 'newer' | 'latest') => Promise<void>
} {
  let generation = 0
  return {
    loadOlderHistory: async () => {
      const state = deps.getState()
      const window = state.transcript
      if (window === undefined || state.historyLoading || !state.historyHasMore) return
      const requestGeneration = ++generation
      deps.setState((current) => ({ ...current, historyLoading: true }))
      const openVersion = deps.getOpenVersion?.()
      const isCurrent = (): boolean =>
        requestGeneration === generation &&
        deps.getState().activeSessionId === window.sessionId &&
        deps.getOpenVersion?.() === openVersion
      try {
        let cursor = window
        let beforeSequence = state.historyBeforeSequence
        for (let attempt = 0; attempt < 2; attempt++) {
          let result: unknown
          try {
            result = await deps.client.request<unknown>({
              type: 'session.transcript.navigate',
              requestId: requestId(),
              payload: {
                sessionId: cursor.sessionId,
                revision: cursor.revision,
                direction: 'older',
                ...(beforeSequence === undefined ? {} : { beforeSequence }),
              },
            })
          } catch (reason) {
            // Retiring a history read must never surface an error in the next chat.
            if (!isCurrent()) return
            throw reason
          }
          if (!isCurrent()) return
          const next = parseTranscript(result)
          deps.setState((current) => ({ ...installTranscript(current, next), historyLoading: true }))
          if (
            attempt === 0 &&
            next.hasMore &&
            next.revision > cursor.revision &&
            next.beforeSequence === beforeSequence
          ) {
            cursor = next
            beforeSequence = next.beforeSequence
            continue
          }
          break
        }
      } finally {
        if (requestGeneration === generation)
          deps.setState((current) => ({ ...current, historyLoading: false }))
      }
    },
    navigateTranscript: async (direction) => {
      const state = deps.getState()
      const window = state.transcript
      if (window === undefined) return
      const requestGeneration = ++generation
      const openVersion = deps.getOpenVersion?.()
      const isCurrent = (): boolean =>
        requestGeneration === generation &&
        deps.getState().activeSessionId === window.sessionId &&
        deps.getOpenVersion?.() === openVersion
      if (state.historyLoading) deps.setState((current) => ({ ...current, historyLoading: false }))
      try {
        const result = await deps.client.request<unknown>({
          type: 'session.transcript.navigate',
          requestId: requestId(),
          payload: { sessionId: window.sessionId, revision: window.revision, direction },
        })
        if (isCurrent()) deps.setState((current) => installTranscript(current, parseTranscript(result)))
      } catch (reason) {
        if (isCurrent()) throw reason
      }
    },
  }
}
