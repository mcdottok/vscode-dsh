import type { DisplayTimelineNode } from './timeline-shared.js'
import { timelineSourceNodeIds } from './timeline-inspector-target.js'
import { terminalPresentationFailed } from '@dsh-vscode/domain'

export type FocusedWorkNode = Extract<
  DisplayTimelineNode,
  { readonly kind: 'assistant-message' | 'assistant-turn' | 'tool' }
>
export type FocusedAnswerNode = Exclude<FocusedWorkNode, { readonly kind: 'tool' }>
export interface FocusedTurnNode {
  readonly kind: 'focused-turn'
  readonly id: string
  readonly turn: number
  readonly nodes: readonly FocusedWorkNode[]
  readonly sourceIds: readonly string[]
  readonly foldable: boolean
  readonly answer: FocusedAnswerNode | undefined
  /** Virtual rows share one process disclosure for the continuous source run. */
  readonly processId?: string
  readonly processCount?: number
  readonly processSummary?: FocusedProcessSummary
  readonly continuation?: boolean
  readonly live?: boolean
}
export type PresentedTimelineNode = DisplayTimelineNode | FocusedTurnNode
export const FOCUSED_PROCESS_SEGMENT_SIZE = 24

export interface FocusedProcessSummary {
  readonly toolCount: number
  readonly commandCount: number
  /** Failed calls stay folded, but the summary must still surface them. */
  readonly failedCount: number
  readonly settled: boolean
}

/** Count structured calls across the whole run, before virtual segmentation. */
export function summarizeFocusedWork(nodes: readonly FocusedWorkNode[]): FocusedProcessSummary {
  const tools = new Map(
    nodes.flatMap((node) =>
      (node.kind === 'tool' ? [node] : node.kind === 'assistant-turn' ? node.tools : [])
        .filter((tool) => tool.tool.preparation === undefined)
        .map((tool) => [tool.tool.id, tool.tool] as const),
    ),
  )
  const calls = [...tools.values()]
  return {
    toolCount: tools.size,
    commandCount: calls.filter((tool) => tool.category === 'execution').length,
    failedCount: calls.filter((tool) => !healthyTool(tool)).length,
    settled: nodes.every(healthy),
  }
}

/** Empty timing/reasoning placeholders are not a readable process. */
export function hasFocusedWork(node: FocusedWorkNode): boolean {
  if (node.kind === 'tool') return true
  return (
    node.interrupted === true ||
    node.streaming ||
    node.reasoning?.streaming === true ||
    (node.reasoning?.markdown.trim() ?? '') !== '' ||
    (node.kind === 'assistant-turn' &&
      (node.tools.length > 0 ||
        node.blocks.some(
          (block) =>
            block.kind === 'tool' ||
            (block.kind === 'reasoning' && (block.streaming || block.markdown.trim() !== '')),
        ))) ||
    hasBody(node)
  )
}

function workTurn(node: DisplayTimelineNode | undefined): number | undefined {
  if (node?.kind === 'assistant-message' || node?.kind === 'assistant-turn') return node.turn
  return node?.kind === 'tool' ? node.tool.turn : undefined
}
function groupable(node: DisplayTimelineNode): node is FocusedWorkNode {
  if (workTurn(node) === undefined) return false
  // A submitted plan remains an independent, decision-relevant surface.
  return node.kind === 'tool'
    ? node.tool.submittedPlan === undefined
    : node.kind === 'assistant-message' ||
        (node.kind === 'assistant-turn' && node.tools.every((tool) => tool.tool.submittedPlan === undefined))
}
function hasBody(node: FocusedWorkNode): node is FocusedAnswerNode {
  return (
    node.kind !== 'tool' &&
    (node.markdown.trim() !== '' ||
      (node.images?.length ?? 0) > 0 ||
      (node.kind === 'assistant-turn' &&
        node.blocks.some(
          (block) =>
            block.kind === 'message' && (block.markdown.trim() !== '' || (block.images?.length ?? 0) > 0),
        )))
  )
}

type FocusedToolView = Extract<FocusedWorkNode, { readonly kind: 'tool' }>['tool']

/** Step coordinate a Turn's reply must beat to prove it closes the Turn. */
function answeredStep(node: FocusedWorkNode): number | undefined {
  return node.kind === 'tool' ? node.tool.step : (node.sequence ?? node.step)
}

function healthyTool(tool: FocusedToolView): boolean {
  return (
    tool.preparation === undefined &&
    tool.status === 'completed' &&
    tool.error === undefined &&
    tool.autoReviewDenial === undefined &&
    !terminalPresentationFailed(tool.presentation)
  )
}

function healthy(node: FocusedWorkNode): boolean {
  if (node.kind === 'tool') return healthyTool(node.tool)
  return (
    // Only the closing reply carries turnCompleted. Earlier settled steps
    // remain healthy; completion is checked against the final transcript tail.
    !node.streaming &&
    node.reasoning?.streaming !== true &&
    node.interrupted !== true &&
    (node.kind !== 'assistant-turn' || node.tools.every((tool) => healthyTool(tool.tool)))
  )
}

interface TurnState {
  readonly first: number
  last: number
  healthy: boolean
  /**
   * A Turn that was aborted is never auto-folded, even when a later step marked
   * it complete: the reader needs the failure or the interrupt in place.
   */
  aborted: boolean
  closed: boolean
}

function turnStates(nodes: readonly DisplayTimelineNode[]): Map<number, TurnState> {
  const turns = new Map<number, TurnState>()
  nodes.forEach((node, index) => {
    const turn = node.kind === 'turn-terminal' ? node.turn : workTurn(node)
    if (turn === undefined) return
    const state = turns.get(turn) ?? {
      first: index,
      last: index,
      healthy: true,
      aborted: false,
      closed: false,
    }
    state.last = index
    if (node.kind === 'turn-terminal') {
      state.healthy = false
      state.aborted = true
    } else if (groupable(node)) {
      state.healthy &&= healthy(node)
      state.closed ||= node.kind !== 'tool' && node.turnCompleted === true
      if (node.kind !== 'tool' && (node.interrupted === true || node.streaming === true)) state.aborted = true
    } else state.healthy = false
    turns.set(turn, state)
  })
  return turns
}

/** Bounded segments preserve row virtualization even for one very long Turn. */
export function createFocusedTimelineProjector(): (
  nodes: readonly DisplayTimelineNode[],
) => readonly PresentedTimelineNode[] {
  let previous:
    | {
        readonly source: readonly DisplayTimelineNode[]
        readonly rows: readonly PresentedTimelineNode[]
        readonly starts: readonly number[]
        readonly turns: ReadonlyMap<number, TurnState>
      }
    | undefined
  return (nodes) => {
    if (previous?.source === nodes) return previous.rows
    let common = 0
    if (previous !== undefined)
      while (
        common < nodes.length &&
        common < previous.source.length &&
        nodes[common] === previous.source[common]
      )
        common++
    const turns = turnStates(nodes)
    // A changed call can alter the first summary even if its virtual row is
    // much later and its health/turn coordinates have not changed.
    const changedTurn = workTurn(nodes[common]) ?? workTurn(previous?.source[common])
    while (
      common > 0 &&
      changedTurn !== undefined &&
      groupable(nodes[common - 1]!) &&
      !hasBody(nodes[common - 1] as FocusedWorkNode) &&
      workTurn(nodes[common - 1]) === changedTurn
    )
      common--
    // A later live/error node can change every bounded segment of its Turn.
    // Revisit that Turn without invalidating older, unrelated history.
    for (const [turn, state] of turns) {
      const before = previous?.turns.get(turn)
      if (
        before !== undefined &&
        (before.last !== state.last ||
          before.healthy !== state.healthy ||
          before.closed !== state.closed ||
          before.aborted !== state.aborted)
      )
        common = Math.min(common, state.first)
    }
    // Revisit the last unchanged segment too: a new boundary can finalize its answer.
    let stableRows = 0
    if (previous !== undefined)
      while (stableRows + 1 < previous.starts.length && previous.starts[stableRows + 1]! < common)
        stableRows++
    const start = previous?.starts[stableRows] ?? 0
    const rows: PresentedTimelineNode[] = previous?.rows.slice(0, stableRows) ?? []
    const starts: number[] = previous?.starts.slice(0, stableRows) ?? []
    for (let index = start; index < nodes.length;) {
      const node = nodes[index]!
      if (!groupable(node)) {
        starts.push(index)
        rows.push(node)
        index++
        continue
      }
      const turn = workTurn(node)!
      const state = turns.get(turn)!
      let runStart = index
      // One Turn is one process: intermediate replies keep their place inside
      // the folded run, so only the non-groupable boundaries split it.
      while (runStart > 0 && groupable(nodes[runStart - 1]!) && workTurn(nodes[runStart - 1]) === turn)
        runStart--
      let runEnd = index + 1
      while (runEnd < nodes.length && groupable(nodes[runEnd]!) && workTurn(nodes[runEnd]) === turn) runEnd++
      const uninterrupted = state.first >= runStart && state.last < runEnd
      const runLast = nodes[runEnd - 1]!
      const runMembers = nodes.slice(runStart, runEnd).filter(groupable)
      // Replies interleaved with tool steps need ordering metadata before one of
      // them can be read as the closing answer; otherwise keep the whole Turn
      // open instead of hiding a reply inside the fold.
      const interleaved =
        runMembers.filter((member) => hasBody(member)).length > 1 &&
        runMembers.some((member) => member.kind === 'tool')
      const replyStep = groupable(runLast) ? answeredStep(runLast) : undefined
      const proven =
        !interleaved ||
        (replyStep !== undefined &&
          runMembers.every((member) => {
            if (member === runLast) return true
            const step = answeredStep(member)
            return step !== undefined && step < replyStep
          }))
      // Only the closing reply of a settled Turn stays outside the fold. Live
      // text stays inside the process until the Turn actually completes.
      const finalReply =
        groupable(runLast) && hasBody(runLast) && runLast.turnCompleted === true && proven
          ? runLast
          : undefined
      const foldable =
        state.closed &&
        !state.aborted &&
        uninterrupted &&
        (finalReply !== undefined || runLast.kind === 'tool')
      const live = !state.closed && runEnd === nodes.length
      const processId = `focused-turn:${nodes[runStart]!.id}`
      const processCount = runEnd - runStart - (finalReply !== undefined ? 1 : 0)
      const processSummary = summarizeFocusedWork(runMembers)
      while (index < runEnd) {
        const continuation = index !== runStart
        starts.push(index)
        const members = nodes
          .slice(index, live ? runEnd : Math.min(runEnd, index + FOCUSED_PROCESS_SEGMENT_SIZE))
          .filter(groupable)
        index += members.length
        const first = members[0]!
        // DSH's final reply is the latest finalized step with no tool calls.
        const answer = index === runEnd ? finalReply : undefined
        rows.push({
          kind: 'focused-turn',
          id: `focused-turn:${first.id}`,
          turn,
          nodes: members,
          sourceIds: members.flatMap(timelineSourceNodeIds),
          foldable,
          answer,
          processId,
          processCount,
          processSummary,
          continuation,
          live,
        })
      }
    }
    previous = { source: nodes, rows, starts, turns }
    return rows
  }
}

export function presentedSourceNodeIds(node: PresentedTimelineNode): readonly string[] {
  return node.kind === 'focused-turn' ? node.sourceIds : timelineSourceNodeIds(node)
}
