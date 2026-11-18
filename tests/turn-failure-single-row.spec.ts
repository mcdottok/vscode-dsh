import { describe, expect, it } from 'vitest'
import { normalizeEnvelope } from '../packages/dsh-adapter/src/stream-envelopes.js'
import { expandHistoryRecords } from '../packages/dsh-adapter/src/versions/alpha/session-wire.js'
import { rc222SessionProfile } from '../packages/dsh-adapter/src/versions/rc222/session-wire.js'
import { rc6Mapper } from '../packages/dsh-adapter/src/versions/rc6/mapper.js'
import { reduceTimelineBatch } from '../packages/timeline/src/reducer.js'
import type { TimelineState } from '../packages/timeline/src/nodes.js'

/**
 * One context-window refusal reached the transcript as two identical red cards:
 * the host-only `agent/error` frame carries the message as an error notice, and
 * the durable `turn/end` carries the same text as the turn's failure. This walks
 * the real rc.6 frames through the real reducer so the pair is pinned to one
 * row in whichever order the host delivers them.
 */
const CONTEXT_WINDOW_MESSAGE =
  'Engine protocol predict request returned 400: {"error":{"code":400,"message":"request (9251 tokens) exceeds the available context size (8192 tokens), try increasing it","type":"exceed_context_size_error","n_prompt_tokens":9251,"n_ctx":8192}}'

const initial: TimelineState = { sessionId: 's1', nodes: [], lastSequence: -1 }

const noticeEvent = rc6Mapper.event('host/agent-error', {
  sessionId: 's1',
  message: CONTEXT_WINDOW_MESSAGE,
})
const turnEndEvent = rc6Mapper.event('turn/end', {
  sessionId: 's1',
  data: {
    turn: 4,
    reason: {
      kind: 'error',
      error: { code: 'CONTEXT_WINDOW_EXCEEDED', message: CONTEXT_WINDOW_MESSAGE },
    },
  },
})

describe('one failed turn shows one row', () => {
  it('maps the two frames that carry the same failure', () => {
    expect(noticeEvent).toEqual({
      type: 'notice',
      sessionId: 's1',
      level: 'error',
      text: CONTEXT_WINDOW_MESSAGE,
    })
    expect(turnEndEvent).toEqual({
      type: 'turn.ended',
      sessionId: 's1',
      turn: 4,
      reason: 'error',
      failure: { message: CONTEXT_WINDOW_MESSAGE, code: 'CONTEXT_WINDOW_EXCEEDED' },
    })
  })

  it('keeps the turn row when the notice arrives first', () => {
    const state = reduceTimelineBatch(initial, [
      { sequence: 9, event: noticeEvent },
      { sequence: 10, event: turnEndEvent },
    ])

    expect(state.nodes.map((node) => node.kind)).toEqual(['turn-terminal'])
  })

  it('refuses the notice when the turn already closed', () => {
    const state = reduceTimelineBatch(initial, [
      { sequence: 9, event: turnEndEvent },
      { sequence: 10, event: noticeEvent },
    ])

    expect(state.nodes.map((node) => node.kind)).toEqual(['turn-terminal'])
  })

  it('preserves rc.4 refusal usage and the terminal failure in V4 history', () => {
    // dsh-v0.2.2-rc.4 / 3f321d32bfe382212a8ed8785c1d47a5a300aa23,
    // snapshots/session/deepseek-content-refusal/session.v4.jsonl.
    const failure = {
      message: 'DeepSeek refused to answer under its content safety review',
      code: 'CONTENT_REFUSED',
    }
    const usage = { inputTokens: 12, outputTokens: 5, totalTokens: 17 }
    const attempt = {
      type: 'assistant/attempt',
      seq: 0,
      time: 1,
      data: {
        turn: 1,
        step: 1,
        stream: [
          { type: 'chunk', time: 0, chunk: { type: 'usage', usage } },
          { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'error', failure } } },
        ],
      },
    }
    const turnEnd = {
      type: 'turn/end',
      seq: 1,
      time: 2,
      data: { turn: 1, reason: { kind: 'error', error: failure } },
    }
    const records = [attempt, turnEnd].map((event) => ({ type: 'event', event }))
    const events = expandHistoryRecords(records, 's1', 'v4', false, rc222SessionProfile).map((event) =>
      normalizeEnvelope({ type: 'session/event', sessionId: 's1', event }),
    )

    expect(events).toMatchObject([
      { type: 'assistant.attempt', sessionId: 's1', turn: 1, step: 1, usage },
      { type: 'turn.ended', sessionId: 's1', turn: 1, reason: 'error', failure },
    ])
  })
})
