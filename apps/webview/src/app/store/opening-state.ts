import { TRANSCRIPT_MAX_CHARS, type HostMessage } from '@dsh-vscode/webview-protocol'
import { object } from './unknown-record.js'
import { parseHostDomainEvent } from './event-parser.js'

export interface PendingSessionOpen {
  readonly version: number
  readonly sessionId: string
  readonly messages: HostMessage[]
  replayedMessages: number
  ready: boolean
  overflow: boolean
  chars: number
  transcriptChars: number
}

export interface PendingOpenBuffer {
  readonly sessionId: string | undefined
  readonly clear: () => void
  readonly create: (sessionId: string, version: number) => PendingSessionOpen
  readonly settle: (pending: PendingSessionOpen, completed: boolean) => void
  readonly capture: (sessionId: string, message: HostMessage) => PendingSessionOpen | undefined
  readonly messagesAfterReplay: (pending: PendingSessionOpen) => readonly HostMessage[]
  readonly messagesFrom: (pending: PendingSessionOpen, startIndex: number) => readonly HostMessage[]
}

/** Opening holds one replaceable view and bounded control facts, never a durable journal.
 * Failed/superseded opens release their state; the next open rereads authority.
 */
export function createPendingOpenBuffer(
  onOverflow: (pending: PendingSessionOpen) => void,
): PendingOpenBuffer {
  let active: PendingSessionOpen | undefined
  const read = (pending: PendingSessionOpen, start: number): readonly HostMessage[] => {
    pending.replayedMessages = pending.messages.length
    return pending.messages.slice(start)
  }
  return {
    get sessionId() {
      return active?.sessionId
    },
    clear: () => {
      if (active !== undefined) {
        active.messages.length = 0
        active.chars = 0
        active.transcriptChars = 0
      }
      active = undefined
    },
    create: (sessionId, version) => {
      if (active !== undefined) {
        active.messages.length = 0
        active.chars = 0
        active.transcriptChars = 0
      }
      active = {
        sessionId,
        version,
        messages: [],
        replayedMessages: 0,
        ready: false,
        overflow: false,
        chars: 0,
        transcriptChars: 0,
      }
      return active
    },
    settle: (pending, completed) => {
      if (active !== pending) return
      active = undefined
      pending.messages.length = 0
      if (pending.overflow && completed) onOverflow(pending)
    },
    capture: (sessionId, message) => {
      const pending = active
      if (pending?.sessionId !== sessionId || message.type !== 'event') return undefined
      // Interactions have no advisory list read to race. Apply them immediately
      // to the global pending-interaction map, including during failed opens.
      if (message.name.startsWith('permission.') || message.name.startsWith('question.')) return undefined
      const isTranscript =
        message.name === 'session.transcript' || message.name === 'session.transcript.patch'
      if (!isTranscript && parseHostDomainEvent(message) == null) return undefined
      if (pending.overflow) return pending
      const previous =
        message.name === 'session.transcript'
          ? pending.messages.findIndex(
              (candidate) => candidate.type === 'event' && candidate.name === message.name,
            )
          : -1
      if (previous >= 0) {
        const existing = pending.messages[previous]!
        if (
          existing.type === 'event' &&
          Number(object(existing.payload)?.revision) >= Number(object(message.payload)?.revision)
        )
          return pending
        const removedChars = JSON.stringify(existing).length
        pending.chars -= removedChars
        pending.transcriptChars -= removedChars
        pending.messages.splice(previous, 1)
        if (previous < pending.replayedMessages) pending.replayedMessages--
      }
      const chars = JSON.stringify(message).length
      // The transcript protocol allows a 4 MiB window. Keep its replaceable
      // baseline and bounded patches outside the 1 MiB control-fact budget.
      const transcriptChars = pending.transcriptChars + (isTranscript ? chars : 0)
      const controlChars = pending.chars - pending.transcriptChars + (isTranscript ? 0 : chars)
      if (
        pending.messages.length >= 128 ||
        controlChars > 1024 * 1024 ||
        transcriptChars > 2 * TRANSCRIPT_MAX_CHARS + 4096
      ) {
        pending.messages.length = 0
        pending.chars = 0
        pending.transcriptChars = 0
        pending.overflow = true
      } else {
        pending.messages.push(message)
        pending.chars += chars
        pending.transcriptChars = transcriptChars
      }
      return pending
    },
    messagesAfterReplay: (pending) => read(pending, pending.replayedMessages),
    messagesFrom: (pending, start) => read(pending, start),
  }
}
