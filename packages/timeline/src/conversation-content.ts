import type { TimelineNode } from './nodes.js'

/** Notices and transient controls cannot stand in for the conversation body. */
export function hasConversationContent(nodes: readonly TimelineNode[]): boolean {
  return nodes.some(
    (node) =>
      node.kind !== 'notice' &&
      node.kind !== 'retry' &&
      node.kind !== 'turn-terminal' &&
      node.kind !== 'event' &&
      (node.kind !== 'tool' || node.tool.preparation === undefined),
  )
}
