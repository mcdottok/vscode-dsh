import { useCallback, useSyncExternalStore, type SetStateAction } from 'react'
import type { AppState } from './store.js'

// Keep drafts local to this Webview and subscribe only from the composer so
// keystrokes don't re-render the application shell.
const drafts = new Map<string, string>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function sessionDraftKey(sessionId: string): string {
  return `session:${sessionId}`
}

export function pendingDraftKey(revision: number): string {
  return `pending:${revision}`
}

export function selectDraftKey(
  state: Pick<AppState, 'pendingSession' | 'activeSessionId'>,
): string | undefined {
  if (state.pendingSession !== undefined) return pendingDraftKey(state.pendingSession.revision)
  return state.activeSessionId === undefined ? undefined : sessionDraftKey(state.activeSessionId)
}

export function useDraftValue(key: string | undefined): string {
  const get = useCallback(() => readDraft(key), [key])
  return useSyncExternalStore(subscribe, get, get)
}

export function readDraft(key: string | undefined): string {
  return key === undefined ? '' : (drafts.get(key) ?? '')
}

export function setDraft(key: string | undefined, action: SetStateAction<string>): void {
  if (key === undefined) return
  const current = readDraft(key)
  const next = typeof action === 'function' ? action(current) : action
  if (next === current) return
  if (next === '') drafts.delete(key)
  else drafts.set(key, next)
  for (const listener of listeners) listener()
}

export function resetDraft(): void {
  if (drafts.size === 0) return
  drafts.clear()
  for (const listener of listeners) listener()
}
