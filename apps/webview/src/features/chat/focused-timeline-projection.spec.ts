import { describe, expect, it } from 'vitest'
import type { DisplayTimelineNode } from './timeline-shared.js'
import { createFocusedTimelineProjector } from './focused-timeline-projection.js'

const message = (
  id: string,
  turn: number,
  completed = true,
): Extract<DisplayTimelineNode, { readonly kind: 'assistant-message' }> => ({
  kind: 'assistant-message',
  id,
  markdown: id,
  streaming: !completed,
  turn,
  turnCompleted: completed,
})

describe('focused Turn presentation', () => {
  it('uses the completed transcript tail rather than requiring intermediate steps to close the Turn', () => {
    // closeTurn marks only the final visible reply turnCompleted; settled
    // commentary and reasoning deliberately keep turnCompleted: false.
    const earlier: DisplayTimelineNode = {
      ...message('commentary', 1),
      turnCompleted: false,
    }
    const answer = message('answer', 1)
    const project = createFocusedTimelineProjector()
    const [completed] = project([earlier, answer])
    expect(completed?.kind === 'focused-turn' && completed.foldable).toBe(true)
    expect(completed?.kind === 'focused-turn' && completed.answer).toBe(answer)

    const [stillOpen] = project([message('earlier-completed', 1), { ...answer, turnCompleted: false }])
    expect(stillOpen?.kind === 'focused-turn' && stillOpen.foldable).toBe(false)
  })

  it('selects only the last finalized tool-free reply and preserves original identities', () => {
    const earlier = Object.freeze(message('commentary', 1))
    const answer = Object.freeze(message('answer', 1))
    const source = Object.freeze([earlier, answer])
    const [group] = createFocusedTimelineProjector()(source)
    expect(group?.kind).toBe('focused-turn')
    if (group?.kind !== 'focused-turn') throw new Error('Expected focused turn')
    expect(group.foldable).toBe(true)
    expect(group.answer).toBe(answer)
    expect(group.nodes).toEqual(source)
    expect(group.sourceIds).toEqual(['commentary', 'answer'])
  })

  it('keeps live, interrupted, failed and tool-ending process open', () => {
    for (const source of [
      [message('live', 1, false)],
      [{ ...message('interrupted', 1), interrupted: true } as DisplayTimelineNode],
      [
        message('failed', 1),
        {
          kind: 'turn-terminal',
          id: 'failure',
          turn: 1,
          sequence: 4,
          reason: 'error',
        } as DisplayTimelineNode,
      ],
    ]) {
      const [group] = createFocusedTimelineProjector()(source)
      expect(group?.kind === 'focused-turn' && group.foldable).toBe(false)
    }
    const [group] = createFocusedTimelineProjector()([
      message('commentary', 1),
      {
        kind: 'tool',
        id: 'call',
        tool: {
          id: 'call',
          name: 'dynamic',
          title: 'Dynamic tool',
          category: 'other',
          turn: 1,
          status: 'completed',
          metadata: {},
        },
      },
    ])
    expect(group?.kind === 'focused-turn' && group.answer).toBeUndefined()
  })

  it('does not fold unknown coordinates or cross human input, notices and turn boundaries', () => {
    const unknown: DisplayTimelineNode = {
      kind: 'assistant-message',
      id: 'legacy',
      markdown: 'legacy',
      streaming: false,
    }
    const input: DisplayTimelineNode = { kind: 'user-message', id: 'steer', markdown: 'change direction' }
    const notice: DisplayTimelineNode = { kind: 'notice', id: 'warn', level: 'warning', text: 'Warning' }
    const rows = createFocusedTimelineProjector()([
      unknown,
      message('before', 1),
      input,
      message('after', 1),
      notice,
      message('new', 2),
    ])
    expect(rows.map((row) => row.kind)).toEqual([
      'assistant-message',
      'focused-turn',
      'user-message',
      'focused-turn',
      'notice',
      'focused-turn',
    ])
    expect(rows[0]).toBe(unknown)
    expect(rows[2]).toBe(input)
    expect(rows[4]).toBe(notice)
  })

  it('retains unchanged rows on tail updates and reprojects replaced or prepended history', () => {
    const project = createFocusedTimelineProjector()
    const first: DisplayTimelineNode[] = [
      message('old', 1),
      { kind: 'user-message', id: 'user', markdown: 'next' },
      message('tail', 2, false),
    ]
    const before = project(first)
    expect(project(first)).toBe(before)
    const after = project([...first.slice(0, -1), message('tail', 2)])
    expect(after[0]).toBe(before[0])
    const prepended = project([message('earlier', 0), ...first])
    expect(prepended.length).toBe(4)
    expect(project([message('replacement', 9)])[0]?.id).toBe('focused-turn:replacement')
  })

  it('keeps one Turn in one row without losing a single source message', () => {
    const source = Array.from({ length: 1_000 }, (_, index) => message(`message-${index}`, 1))
    const rows = createFocusedTimelineProjector()(source)
    expect(rows).toHaveLength(1)
    const [group] = rows
    expect(group?.kind === 'focused-turn' && group.sourceIds).toEqual(source.map((node) => node.id))
    expect(group?.kind === 'focused-turn' && group.nodes).toHaveLength(1_000)
    expect(group?.kind === 'focused-turn' && group.id).toBe('focused-turn:message-0')
    expect(group?.kind === 'focused-turn' && group.processCount).toBe(999)
  })

  it('keeps submitted plans outside a folded process', () => {
    const plan: DisplayTimelineNode = {
      kind: 'tool',
      id: 'plan',
      tool: {
        id: 'plan',
        name: 'dynamic-plan',
        title: 'Plan',
        category: 'other',
        turn: 1,
        status: 'completed',
        metadata: {},
        submittedPlan: { title: 'Review plan', markdown: 'Decide this' },
      },
    }
    expect(createFocusedTimelineProjector()([message('before', 1), plan, message('answer', 1)])[1]).toBe(plan)
  })

  it('keeps the whole Turn row open while it is active, failed or interrupted by human input', () => {
    const history = Array.from({ length: 60 }, (_, index) => message(`step-${index}`, 1))
    const project = createFocusedTimelineProjector()
    const completed = project(history)
    expect(completed).toHaveLength(1)
    expect(completed.every((row) => row.kind === 'focused-turn' && row.foldable)).toBe(true)
    for (const source of [
      [...history, message('live', 1, false)],
      [
        ...history,
        { kind: 'turn-terminal' as const, id: 'error', turn: 1, sequence: 90, reason: 'error' as const },
      ],
      [
        ...history,
        { kind: 'user-message' as const, id: 'steer', markdown: 'Change direction' },
        message('next', 1),
      ],
    ])
      expect(
        project(source)
          .filter((row) => row.kind === 'focused-turn')
          .every((row) => !row.foldable),
      ).toBe(true)
  })

  it('reprojects the single Turn row when a completed reply is replaced in place', () => {
    const project = createFocusedTimelineProjector()
    const history = Array.from({ length: 60 }, (_, index) => message(`step-${index}`, 1))
    const before = project(history)
    const after = project([...history.slice(0, -1), message('changed-answer', 1)])
    expect(before).toHaveLength(1)
    expect(after).toHaveLength(1)
    expect(after[0]).not.toBe(before[0])
    const last = after.at(-1)
    expect(last?.kind === 'focused-turn' && last.foldable).toBe(true)
    expect(last?.kind === 'focused-turn' && last.answer?.id).toBe('changed-answer')
  })

  it('does not hide a reply when tool step coordinates cannot establish a final answer', () => {
    const call: DisplayTimelineNode = {
      kind: 'tool',
      id: 'tool',
      tool: {
        id: 'tool',
        name: 'dynamic',
        title: 'Tool',
        category: 'other',
        turn: 1,
        status: 'completed',
        metadata: {},
      },
    }
    const [row] = createFocusedTimelineProjector()([message('commentary', 1), call, message('reply', 1)])
    expect(row?.kind === 'focused-turn' && row.foldable).toBe(false)
  })
})
