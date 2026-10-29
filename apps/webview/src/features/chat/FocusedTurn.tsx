import { useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { Icon } from '../../ui/Icon.js'
import { renderAnswerActions, renderTimelineNode } from './timeline-renderers.js'
import { assistantBlocksFromAggregates, type TimelineNodeRenderContext } from './timeline-shared.js'
import {
  hasFocusedWork,
  summarizeFocusedWork,
  type FocusedAnswerNode,
  type FocusedTurnNode,
} from './focused-timeline-projection.js'
import { FocusedToolActivity } from './FocusedToolActivity.js'
import type { ToolTimelineNode } from './ToolCallCollection.js'
import { producedFilePaths, renderProducedFiles } from './timeline-produced-files.js'

export function FocusedTurn(props: {
  readonly node: FocusedTurnNode
  readonly context: TimelineNodeRenderContext
}): ReactElement {
  const { node, context } = props
  const processId = node.processId ?? node.id
  const bodyId = useId()
  const processRef = useRef<HTMLDivElement>(null)
  const followProcess = useRef(true)
  const [visibleWork, setVisibleWork] = useState(60)
  const compactLive = context.running && node.live === true && (node.processCount ?? node.nodes.length) >= 4
  useLayoutEffect(() => {
    const element = processRef.current
    if (!compactLive || element === null || typeof ResizeObserver === 'undefined') return
    if (context.revealSourceNodeId !== undefined) return
    const observer = new ResizeObserver(() => {
      if (followProcess.current) element.scrollTop = element.scrollHeight
    })
    const content = element.firstElementChild
    if (content !== null) observer.observe(content)
    if (followProcess.current) element.scrollTop = element.scrollHeight
    return () => observer.disconnect()
  }, [compactLive, node.nodes, visibleWork, context.revealSourceNodeId])
  const summary = node.processSummary ?? summarizeFocusedWork(node.nodes)
  const finished = node.foldable
  const live = node.live === true
  const failedCount = summary.failedCount
  const work = node.nodes.filter((member) => member !== node.answer && hasFocusedWork(member))
  let answer: FocusedAnswerNode | undefined = node.answer
  if (answer !== undefined) {
    if (answer.kind === 'assistant-turn') {
      const { reasoning, turnUsage, ...plain } = answer
      const blocks = answer.blocks.length === 0 ? assistantBlocksFromAggregates(answer) : answer.blocks
      const thinking = blocks.filter(
        (block) =>
          block.kind === 'tool' ||
          (block.kind === 'reasoning' && (block.streaming || block.markdown.trim() !== '')),
      )
      if (thinking.length > 0) {
        work.push({
          ...plain,
          ...(reasoning === undefined ? {} : { reasoning }),
          kind: 'assistant-turn',
          markdown: '',
          images: [],
          blocks: thinking,
        })
      }
      answer = {
        ...plain,
        kind: 'assistant-turn',
        blocks: blocks.filter((block) => block.kind === 'message'),
        tools: [],
        turnUsage,
      }
    } else if (answer.reasoning !== undefined) {
      const { reasoning, turnUsage, ...plain } = answer
      if (reasoning.streaming || reasoning.markdown.trim() !== '')
        work.push({ ...plain, markdown: '', images: [], reasoning })
      answer = { ...plain, turnUsage }
    }
  }
  // The footer controls describe the original closing reply, not the split cards.
  const answerActions = renderAnswerActions(node.answer, context)
  const revealDismissedId = `${processId}:reveal-dismissed:${context.revealRequestId ?? context.revealSourceNodeId}`
  const revealed =
    context.revealSourceNodeId !== undefined &&
    node.sourceIds.includes(context.revealSourceNodeId) &&
    !context.expandedDetails.has(revealDismissedId)
  const collapsedId = `${processId}:collapsed`
  // Only the active tail opens by itself. Every settled run — completed, failed,
  // interrupted or steered away mid-Turn — starts folded behind its summary in
  // every transcript view, so reopening a session never pours old work back in.
  const open =
    revealed ||
    (!context.expandedDetails.has(collapsedId) && (live || context.expandedDetails.has(processId)))
  // Every open process reads as the same bounded, compact work log, so no
  // transcript view ever pours a whole Turn into the page at once.
  const compactProcess = open
  const process: ReactElement[] = []
  // A live run mounts only its latest window; a reopened settled turn keeps the
  // whole log scrollable inside the same bounded box.
  const workStart =
    compactLive && context.revealSourceNodeId === undefined ? Math.max(0, work.length - visibleWork) : 0
  if (open)
    for (let index = workStart; index < work.length; index++) {
      const member = work[index]!
      if (member.kind !== 'tool') {
        process.push(
          <div key={member.id} data-source-node-id={member.id}>
            {renderTimelineNode(member, context)}
          </div>,
        )
        continue
      }
      const tools: ToolTimelineNode[] = [member]
      while (work[index + 1]?.kind === 'tool') {
        const next = work[index + 1]!
        if (next.kind !== 'tool') break
        tools.push(next)
        index++
      }
      process.push(
        <div key={member.id}>
          <FocusedToolActivity
            tools={tools}
            expanded={context.expandedDetails}
            onExpandedChange={context.setExpandedDetails}
            translate={context.t}
            transcriptView={context.transcriptView}
            revealSourceNodeId={context.revealSourceNodeId}
            revealRequestId={context.revealRequestId}
            {...(context.onOpenLink === undefined ? {} : { onOpenLink: context.requestOpenLink })}
            {...(context.onLoadImage === undefined ? {} : { onLoadImage: context.onLoadImage })}
          />
        </div>,
      )
    }
  const toggle = (): void =>
    context.setExpandedDetails((current) => {
      const next = new Set(current)
      if (open) {
        next.delete(processId)
        next.add(collapsedId)
        if (revealed) next.add(revealDismissedId)
      } else {
        next.delete(collapsedId)
        next.add(processId)
      }
      return next
    })
  const commandsOnly = summary.toolCount > 0 && summary.commandCount === summary.toolCount
  // A Turn that is still running a call has no settled step count to report.
  const pendingCall = node.live === true && node.nodes.at(-1)?.kind === 'tool'
  const summaryLabel = pendingCall
    ? context.t('timeline.focused.process')
    : summary.toolCount === 0
      ? context.t(finished ? 'timeline.focused.analysisComplete' : 'timeline.focused.process')
      : failedCount > 0
        ? context.t(
            commandsOnly ? 'timeline.focused.commandsWithFailures' : 'timeline.focused.usedToolsWithFailures',
            { count: summary.toolCount, failed: failedCount },
          )
        : context.t(commandsOnly ? 'timeline.focused.commands' : 'timeline.focused.usedTools', {
            count: summary.toolCount,
          })
  return (
    <section
      className="dsh-focused-turn"
      data-turn={node.turn}
      data-process-live={live}
      data-compact-process={compactProcess}
    >
      {work.length === 0 ? null : (
        <>
          <button
            type="button"
            className="dsh-focused-turn__summary"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={toggle}
          >
            <Icon
              name={
                failedCount > 0
                  ? 'alert'
                  : summary.toolCount > 0
                    ? commandsOnly
                      ? 'terminal'
                      : 'tool'
                    : finished
                      ? 'analysis'
                      : 'status'
              }
            />
            <span>{summaryLabel}</span>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} />
          </button>
          <div
            ref={processRef}
            id={bodyId}
            hidden={!open}
            className="dsh-focused-turn__process"
            onScroll={(event) => {
              const element = event.currentTarget
              followProcess.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
            }}
          >
            <div className="dsh-focused-turn__process-content">
              {workStart > 0 ? (
                <button
                  type="button"
                  className="dsh-button dsh-button--secondary dsh-button--compact"
                  onClick={() => {
                    followProcess.current = false
                    const element = processRef.current
                    const previousHeight = element?.scrollHeight ?? 0
                    const previousTop = element?.scrollTop ?? 0
                    setVisibleWork((count) => count + 60)
                    requestAnimationFrame(() => {
                      if (element !== null)
                        element.scrollTop = previousTop + element.scrollHeight - previousHeight
                    })
                  }}
                >
                  {context.t('timeline.loadOlder')}
                </button>
              ) : null}
              {process}
            </div>
          </div>
        </>
      )}
      {answer === undefined ? null : (
        <div className="dsh-focused-turn__answer">{renderTimelineNode(answer, context)}</div>
      )}
      {renderProducedFiles(
        producedFilePaths(node.nodes.flatMap((member) => (member.kind === 'tool' ? [member] : []))),
        context.onOpenLink === undefined ? undefined : context.requestOpenLink,
        context.t,
      )}
      {/* Copy, feedback and branch close the Turn, below every produced file. */}
      {answerActions === null ? null : <div className="dsh-focused-turn__actions">{answerActions}</div>}
    </section>
  )
}
