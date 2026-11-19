import type { FocusedWorkNode, PresentedTimelineNode } from './focused-timeline-projection.js'

/**
 * The Markdown a transcript row publishes for a reader, or `undefined` when
 * the row holds nothing readable.
 *
 * Reasoning, tool calls, notices and statistics stay out. Answer rows publish
 * the same Markdown their own copy button offers (`assistant-message`,
 * `assistant-turn`, `user-message`); a focused turn has no such button, so it
 * publishes the addressed reply. If the whole turn is addressed, it publishes
 * the closing answer or its grouped messages. Pasting Markdown rather than rendered text
 * keeps its headings, lists and code fences.
 */
export function rowCopyMarkdown(node: PresentedTimelineNode, messageId?: string): string | undefined {
  switch (node.kind) {
    case 'assistant-message':
    case 'assistant-turn':
    case 'user-message':
      return readableMarkdown(node.markdown)
    case 'focused-turn':
      if (messageId !== undefined) {
        const message = node.nodes.find((member) => member.id === messageId)
        return message === undefined || message.kind === 'tool'
          ? undefined
          : readableMarkdown(message.markdown)
      }
      // A settled answer is the whole answer, even when it carries only
      // images: its absent text is a strict no-op, never the process text of
      // the messages that produced it.
      if (node.answer !== undefined) return readableMarkdown(node.answer.markdown)
      return groupedMessageMarkdown(node.nodes)
    default:
      return undefined
  }
}

function groupedMessageMarkdown(nodes: readonly FocusedWorkNode[]): string | undefined {
  const parts: string[] = []
  for (const node of nodes) {
    if (node.kind !== 'assistant-message' && node.kind !== 'assistant-turn') continue
    const markdown = readableMarkdown(node.markdown)
    if (markdown !== undefined) parts.push(markdown)
  }
  return parts.length === 0 ? undefined : parts.join('\n\n')
}

function readableMarkdown(markdown: string): string | undefined {
  // Whitespace-only answers count as absent: a caller must be able to tell
  // "nothing to copy" from "copy an empty string", because writing empty text
  // would clear a clipboard the user never asked to change.
  return markdown.trim() === '' ? undefined : markdown
}
