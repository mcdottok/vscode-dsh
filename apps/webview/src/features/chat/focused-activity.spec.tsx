// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ReactElement } from 'react'
import type { TimelineNode } from '@dsh-vscode/timeline'
import { ConversationLayoutProvider } from '../../app/ConversationLayoutProvider.js'
import { Timeline } from './Timeline.js'
import { createFocusedTimelineProjector, summarizeFocusedWork } from './focused-timeline-projection.js'
import type { AssistantTurnNode, DisplayTimelineNode } from './timeline-shared.js'
import type { ToolTimelineNode } from './ToolCallCollection.js'

const answer = {
  kind: 'assistant-message',
  id: 'reply',
  markdown: 'The result is ready.',
  turn: 1,
  streaming: false,
  turnCompleted: true,
} as const
const call = (id: string, category = 'execution'): ToolTimelineNode => ({
  kind: 'tool',
  id,
  tool: { id, name: 'dynamic', title: 'Fixture tool', turn: 1, category, status: 'completed', metadata: {} },
})
function conversation(nodes: readonly TimelineNode[]): ReactElement {
  return (
    <ConversationLayoutProvider>
      <Timeline sessionId="fixture" nodes={nodes} streaming={false} />
    </ConversationLayoutProvider>
  )
}
afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('quiet process summaries', () => {
  it('opens command details while retaining the final reply and distinguishes other tool categories', () => {
    const view = render(conversation([call('a'), call('b'), answer]))
    const disclosure = screen.getByRole('button', { name: 'Commands executed: 2' })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByText(answer.markdown)).toBeTruthy()
    expect(view.container.querySelector('.dsh-focused-turn__count')).toBeNull()
    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /Tool calls: 2/u })).toBeTruthy()
    view.rerender(conversation([call('a'), call('b', 'read'), answer]))
    expect(screen.getByRole('button', { name: 'Tools used: 2' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Commands executed/u })).toBeNull()
  })

  it('shows analysis only for real reasoning and removes empty placeholders and repeated metrics', () => {
    const reply = {
      ...answer,
      modelLabel: 'Fixture model',
      timing: { stepStartTime: 1000, firstTokenTime: 2000, completedTime: 3000 },
      reasoning: { markdown: 'Actual reasoning content.', streaming: false },
    }
    const view = render(conversation([reply]))
    fireEvent.click(screen.getByRole('button', { name: 'Analysis complete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show reasoning' }))
    expect(screen.getByText(reply.reasoning.markdown)).toBeTruthy()
    expect(view.container.querySelector('.dsh-timeline__assistant-metrics')).toBeNull()
    expect(screen.queryByText('Fixture model')).toBeNull()
    expect(view.container.querySelector('article[title*="Fixture model"][title*="TTFT 1s"]')).not.toBeNull()
    view.rerender(
      conversation([
        { ...answer, id: 'empty', markdown: '', reasoning: { markdown: ' ', streaming: false } },
        { ...reply, reasoning: { markdown: '', streaming: false } },
      ]),
    )
    expect(view.container.querySelector('.dsh-focused-turn__summary')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show reasoning' })).toBeNull()
    expect(screen.getByText(answer.markdown)).toBeTruthy()
  })

  it('folds failed work behind a summary that still reports the failures', () => {
    const tool = call('failed')
    const view = render(
      conversation([{ ...tool, tool: { ...tool.tool, status: 'failed', error: 'Fixture failure' } }, answer]),
    )
    const summary = screen.getByRole('button', { name: 'Commands executed: 1 · 1 failed' })
    expect(summary.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Failed tool calls: 1')).toBeNull()
    fireEvent.click(summary)
    expect(screen.getByText('Failed tool calls: 1')).toBeTruthy()
    view.rerender(
      conversation([
        { ...answer, interrupted: true, reasoning: { markdown: 'Interrupted reasoning', streaming: false } },
      ]),
    )
    // An interrupted turn is settled history: it folds like any other turn.
    expect(screen.getByRole('button', { name: 'Work details' }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Analysis complete')).toBeNull()
    expect(screen.getAllByText('Interrupted').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: 'Work details' }))
    expect(screen.getByRole('button', { name: 'Work details' }).getAttribute('aria-expanded')).toBe('true')
  })

  it('keeps an unclosed turn open after reconnect and folds structured history', () => {
    const source = [call('incomplete'), { ...answer, turnCompleted: false }]
    const view = render(conversation(source))
    expect(screen.getByRole('button', { name: 'Commands executed: 1' }).getAttribute('aria-expanded')).toBe(
      'true',
    )
    view.rerender(conversation([source[0]!, answer]))
    expect(screen.getByRole('button', { name: 'Commands executed: 1' }).getAttribute('aria-expanded')).toBe(
      'false',
    )
    view.rerender(
      <ConversationLayoutProvider>
        <Timeline
          sessionId="fixture"
          nodes={[source[0]!, answer]}
          streaming={false}
          transcriptView="verbose"
        />
      </ConversationLayoutProvider>,
    )
    expect(screen.getByRole('button', { name: 'Commands executed: 1' }).getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('counts the complete process in one row and refreshes its summary after later category changes', () => {
    const project = createFocusedTimelineProjector()
    const source: DisplayTimelineNode[] = [
      ...Array.from({ length: 55 }, (_, index) => call(`tool-${index}`)),
      answer,
    ]
    const before = project(source)
    expect(before).toHaveLength(1)
    for (const row of before) {
      expect(row.kind === 'focused-turn' && row.processSummary).toEqual({
        toolCount: 55,
        commandCount: 55,
        failedCount: 0,
        settled: true,
      })
    }
    const updated = [...source]
    updated[50] = call('tool-50', 'read')
    const after = project(updated)
    expect(after[0]?.kind === 'focused-turn' && after[0].processSummary?.commandCount).toBe(54)
    expect(after.at(-1)?.kind === 'focused-turn' && after.at(-1)?.id).toBe(before.at(-1)?.id)
  })

  it('deduplicates aggregated tool references and excludes argument preparation from execution counts', () => {
    const tool = call('call')
    const aggregate: AssistantTurnNode = {
      kind: 'assistant-turn',
      id: 'aggregate',
      markdown: '',
      streaming: false,
      tools: [tool],
      blocks: [],
    }
    const preview = call('preview')
    const result = summarizeFocusedWork([
      aggregate,
      tool,
      { ...preview, tool: { ...preview.tool, preparation: { attemptId: 'attempt', updateIndex: 1 } } },
    ])
    expect(result.toolCount).toBe(1)
    expect(result.commandCount).toBe(1)
    expect(result.settled).toBe(false)
  })
})
