import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  preserveDisclosurePosition,
  useScrollFollow,
  type ScrollAnchor,
} from '../../components/common/useScrollFollow.js'
import { Icon } from '../../ui/Icon.js'
import { renderAnswerActions, renderAnswerUsage, renderTimelineNode } from './timeline-renderers.js'
import { assistantBlocksFromAggregates, type TimelineNodeRenderContext } from './timeline-shared.js'
import {
  hasFocusedBody,
  hasReadableReasoning,
  summarizeFocusedWork,
  type FocusedAnswerNode,
  type FocusedTurnNode,
  type FocusedWorkNode,
} from './focused-timeline-projection.js'
import { timelineSourceNodeIds } from './timeline-inspector-target.js'
import { FocusedToolActivity } from './FocusedToolActivity.js'
import type { ToolTimelineNode } from './ToolCallCollection.js'
import { producedFilePaths, renderProducedFiles } from './timeline-produced-files.js'

export function FocusedTurn(props: {
  readonly node: FocusedTurnNode
  readonly context: TimelineNodeRenderContext
}): ReactElement {
  const { node, context } = props
  const content = useMemo(() => splitFocusedContent(node.nodes), [node.nodes])
  const lastProcess = content.findLast((part) => part.kind === 'process')
  const live = node.live === true
  // The footer describes the original closing reply, regardless of display segments.
  const answerActions = renderAnswerActions(node.answer, context)
  const answerUsage = renderAnswerUsage(node.answer, context)
  return (
    <section className="dsh-focused-turn" data-turn={node.turn} data-process-live={live}>
      {content.map((part, index) =>
        part.kind === 'process' ? (
          <FocusedProcess
            key={part.key}
            processId={`${node.processId ?? node.id}:${part.key}`}
            members={part.members}
            context={context}
            live={live && part === lastProcess}
            ended={node.foldable || index < content.length - 1}
          />
        ) : (
          <div className="dsh-focused-turn__answer" key={part.key} data-transcript-message-id={part.node.id}>
            {renderTimelineNode(part.node, context)}
          </div>
        ),
      )}
      {renderProducedFiles(
        producedFilePaths(
          node.nodes.flatMap((member) =>
            member.kind === 'tool' ? [member] : member.kind === 'assistant-turn' ? member.tools : [],
          ),
        ),
        context.onOpenLink === undefined ? undefined : context.requestOpenLink,
        context.t,
      )}
      <div
        className="dsh-focused-turn__footer"
        data-visible={answerUsage !== null || answerActions !== null || undefined}
      >
        <div>
          {answerUsage}
          {answerActions}
        </div>
      </div>
    </section>
  )
}

interface ProcessMember {
  readonly key: string
  readonly node: FocusedWorkNode
}

function FocusedProcess(props: {
  readonly processId: string
  readonly members: readonly ProcessMember[]
  readonly context: TimelineNodeRenderContext
  readonly live: boolean
  readonly ended: boolean
}): ReactElement {
  const { processId, members, context, live, ended } = props
  const bodyId = useId()
  const summaryId = useId()
  const earlierWorkAnchor = useRef<ScrollAnchor | undefined>(undefined)
  const [visibleWork, setVisibleWork] = useState(60)
  const summary = useMemo(() => summarizeFocusedWork(members.map((member) => member.node)), [members])
  const finished = ended && summary.settled
  const failedCount = summary.failedCount
  const revealDismissedId = `${processId}:reveal-dismissed:${context.revealRequestId ?? context.revealSourceNodeId}`
  const revealSource = context.revealSourceNodeId
  const revealed =
    revealSource !== undefined &&
    members.some(
      ({ node }) => node.id === revealSource || timelineSourceNodeIds(node).includes(revealSource),
    ) &&
    !context.expandedDetails.has(revealDismissedId)
  const collapsedId = `${processId}:collapsed`
  // Only the active tail opens by itself. Every settled run — completed, failed,
  // interrupted or steered away mid-Turn — starts folded behind its summary in
  // every transcript view, so reopening a session never pours old work back in.
  const open =
    revealed ||
    (!context.expandedDetails.has(collapsedId) && (live || context.expandedDetails.has(processId)))
  const followLiveWork = open && live && context.running && !revealed
  const {
    scrollRef: processRef,
    contentRef: processContentRef,
    captureScrollAnchor,
    restoreScrollAnchor,
  } = useScrollFollow({
    sessionId: processId,
    contentKey: members.at(-1)?.node.id ?? '',
    itemCount: open ? members.length : 0,
    autoFollow: followLiveWork,
    snapToTailOnWheel: followLiveWork,
    smoothTailGrowth: true,
    bottomThreshold: 1,
  })
  useLayoutEffect(() => {
    const anchor = earlierWorkAnchor.current
    if (anchor === undefined) return
    earlierWorkAnchor.current = undefined
    restoreScrollAnchor(anchor)
  }, [restoreScrollAnchor, visibleWork])
  // Every open process reads as the same bounded, compact work log, so no
  // transcript view ever pours a whole Turn into the page at once.
  const process: ReactElement[] = []
  // A live run mounts only its latest window; a reopened settled turn keeps the
  // whole log scrollable inside the same bounded box.
  const workStart = context.running && live && !revealed ? Math.max(0, members.length - visibleWork) : 0
  if (open)
    for (let index = workStart; index < members.length; index++) {
      const { key, node: member } = members[index]!
      if (member.kind !== 'tool') {
        process.push(
          <div key={key} data-source-node-id={member.id}>
            {renderTimelineNode(member, context)}
          </div>,
        )
        continue
      }
      const tools: ToolTimelineNode[] = [member]
      for (let next = members[index + 1]?.node; next?.kind === 'tool'; next = members[index + 1]?.node) {
        tools.push(next)
        index++
      }
      process.push(
        <div key={key}>
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
  const pendingCall = live && !ended && members.at(-1)?.node.kind === 'tool'
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
    <div className="dsh-focused-turn__group">
      <button
        type="button"
        className="dsh-focused-turn__summary"
        aria-expanded={open}
        id={summaryId}
        aria-controls={bodyId}
        onClick={(event) => {
          preserveDisclosurePosition(event.currentTarget)
          toggle()
        }}
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
        role="region"
        aria-labelledby={summaryId}
        tabIndex={open ? 0 : undefined}
      >
        <div ref={processContentRef} className="dsh-focused-turn__process-content">
          {workStart > 0 ? (
            <button
              type="button"
              className="dsh-button dsh-button--secondary dsh-button--compact"
              onClick={() => {
                earlierWorkAnchor.current = captureScrollAnchor()
                setVisibleWork((count) => count + 60)
              }}
            >
              {context.t('timeline.loadOlder')}
            </button>
          ) : null}
          {process}
        </div>
      </div>
    </div>
  )
}

type FocusedContent =
  | { readonly kind: 'process'; readonly key: string; readonly members: ProcessMember[] }
  | { readonly kind: 'reply'; readonly key: string; readonly node: FocusedAnswerNode }

/** A visible reply ends the preceding process and leaves later work in place. */
function splitFocusedContent(nodes: readonly FocusedWorkNode[]): readonly FocusedContent[] {
  const content: FocusedContent[] = []
  const appendProcess = (node: FocusedWorkNode, key: string): void => {
    const previous = content.at(-1)
    const member = { key, node }
    if (previous?.kind === 'process') previous.members.push(member)
    else content.push({ kind: 'process', key, members: [member] })
  }
  for (const node of nodes) {
    if (node.kind === 'tool') {
      appendProcess(node, `tool:${node.id}`)
      continue
    }
    if (node.kind === 'assistant-message') {
      const { reasoning, ...body } = node
      if (reasoning !== undefined && hasReadableReasoning(reasoning))
        appendProcess(
          {
            ...body,
            reasoning,
            markdown: '',
            images: [],
            streaming: reasoning.streaming,
            turnUsage: undefined,
          },
          `reasoning:${node.id}`,
        )
      if (hasFocusedBody(node))
        content.push({ kind: 'reply', key: `reply:${node.id}`, node: { ...body, turnUsage: undefined } })
      continue
    }
    const blocks = node.blocks.length === 0 ? assistantBlocksFromAggregates(node) : node.blocks
    const base = { ...node, images: [], tools: [], turnUsage: undefined }
    delete base.reasoning
    for (const block of blocks) {
      if (block.kind === 'tool') {
        appendProcess(block.node, `tool:${block.node.id}`)
        continue
      }
      const part = { ...base, blocks: [block], streaming: block.streaming }
      if (block.kind === 'reasoning') {
        if (hasReadableReasoning(block))
          appendProcess({ ...part, id: block.id, markdown: '' }, `reasoning:${block.id}`)
      } else if (block.markdown.trim() !== '' || (block.images?.length ?? 0) > 0) {
        content.push({
          kind: 'reply',
          key: `reply:${block.id}`,
          node: { ...part, id: block.id, markdown: block.markdown },
        })
      }
    }
  }
  return content
}
