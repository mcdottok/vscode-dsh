import type { TranscriptWindow } from '@dsh-vscode/webview-protocol'

/** Only ongoing text appends may share a paint; boundaries and controls stay immediate. */
export function isStreamingTextAppend(
  previous: TranscriptWindow | undefined,
  next: TranscriptWindow | undefined,
): boolean {
  if (
    previous === undefined ||
    next === undefined ||
    previous === next ||
    previous.sessionId !== next.sessionId ||
    previous.historical !== next.historical ||
    previous.lastSequence !== next.lastSequence ||
    previous.activeTurn !== next.activeTurn ||
    previous.activeTurnStartedAt !== next.activeTurnStartedAt ||
    previous.nodes.length !== next.nodes.length
  )
    return false
  let appended = false
  for (let index = 0; index < next.nodes.length; index++) {
    const node = next.nodes[index]!
    const before = previous.nodes[index]!
    if (node === before) continue
    if (
      node.kind !== 'assistant-message' ||
      before.kind !== 'assistant-message' ||
      node.id !== before.id ||
      node.turn !== before.turn ||
      node.step !== before.step ||
      node.liveAttemptId !== before.liveAttemptId ||
      node.streaming !== before.streaming ||
      node.reasoning?.streaming !== before.reasoning?.streaming ||
      (!node.streaming && node.reasoning?.streaming !== true) ||
      (before.markdown.trim() === '' && node.markdown.trim() !== '') ||
      ((before.reasoning?.markdown.trim() ?? '') === '' && (node.reasoning?.markdown.trim() ?? '') !== '') ||
      !node.markdown.startsWith(before.markdown) ||
      !(node.reasoning?.markdown ?? '').startsWith(before.reasoning?.markdown ?? '')
    )
      return false
    appended = true
  }
  return appended
}
